import { supabase } from './supabase';
import { localDB, type LocalNote, type SyncQueueItem } from './localdb';
import { authManager } from './auth';
import { isSpaceUnlocked } from '../utils/spaces-crypto';
import { getUserSupabaseClient } from './userDatabase';
import { collaborationEngine } from './collaborationEngine';
import { getAPI } from '../utils/api';
import { normalizeVersion, sha256Hex } from '../utils/collabDocument';
import { v4 as uuidv4 } from 'uuid';

/**
 * Normalize an absolute or relative path to a relative path from the active vault root.
 * Safe for cross-platform/cross-collaborator sync where local paths diverge.
 */
export function normalizeSyncPath(filePath: string): string {
  if (!filePath) return '';
  const vaultPath = typeof window !== 'undefined' ? (window as any).__oo_vault_path : null;
  if (!vaultPath) return filePath;

  // Normalize slashes to forward slashes for cross-platform safety
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedVault = vaultPath.replace(/\\/g, '/');

  // Case 1: The path is already under the active vault path
  if (normalizedFile.startsWith(normalizedVault)) {
    let rel = normalizedFile.slice(normalizedVault.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }

  // Case 2: The path is absolute but belongs to a different vault path
  if (normalizedFile.startsWith('/') || /^[a-zA-Z]:/.test(normalizedFile)) {
    const vaultParts = normalizedVault.split('/');
    const fileParts = normalizedFile.split('/');
    
    // Find the last index where both paths match before their respective vault roots
    let lastCommonIndex = -1;
    for (let i = 0; i < Math.min(vaultParts.length - 1, fileParts.length - 1); i++) {
      if (vaultParts[i] === fileParts[i]) {
        lastCommonIndex = i;
      } else {
        break;
      }
    }
    
    if (lastCommonIndex >= 0) {
      const relativeIndex = lastCommonIndex + 2;
      if (relativeIndex < fileParts.length) {
        return fileParts.slice(relativeIndex).join('/');
      }
    }
    
    return fileParts[fileParts.length - 1];
  }

  return filePath;
}

/**
 * Get the active Supabase client -- either the user's own instance
 * or the default OpenObsidian instance.
 */
function getActiveClient() {
  return getUserSupabaseClient() || supabase;
}

function toLocalNote(note: any): LocalNote {
  return {
    id: note.id,
    space_id: note.space_id,
    vault_id: note.vault_id || null,
    last_client_id: note.last_client_id || null,
    version: normalizeVersion(note.version),
    last_modified: note.last_modified || note.updated_at,
    client_id: note.client_id || note.last_client_id || null,
    content_hash: note.content_hash || '',
    title: note.title,
    path: note.path || '',
    content: note.content || '',
    pinned: !!note.pinned,
    created_at: note.created_at,
    updated_at: note.updated_at,
    deleted: !!note.deleted,
    is_canvas: !!note.is_canvas,
  };
}

/**
 * SyncEngine manages local-first data synchronization with Supabase.
 *
 * Responsibilities:
 * - Push: read sync_queue, batch upsert/soft-delete to Supabase
 * - Pull: delta-fetch by updated_at, LWW merge into IndexedDB + filesystem
 *
 * Realtime is owned by CollaborationEngine (not duplicated here).
 * Presence is handled by Supabase Realtime Presence (not DB polling).
 */
export class SyncEngine {
  private isSyncing = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private pushDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private authUnsubscribe: (() => void) | null = null;

  private activeSpaceId: string | null = null;
  private activeSpaceVisibility: string | null = null;
  private activeVaultPath: string | null = null;
  private clientId: string = '';
  private lastLocalScanTime = 0;

  /** Track whether we believe the network is available. */
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;

  constructor() {
    this.init();
  }

  private async init() {
    this.clientId = await localDB.getClientId();
    this.startAutoSync();
  }

  /**
   * Set the active vault and resolve its corresponding cloud space.
   * Called by App.tsx when a vault is opened/switched.
   */
  public async setActiveVault(vaultPath: string | null) {
    this.activeVaultPath = vaultPath;

    if (vaultPath) {
      try {
        const space = await collaborationEngine.getSpaceForVault(vaultPath);
        this.activeSpaceId = space?.id || null;
        if (this.activeSpaceId) {
          const localSpace = await localDB.getSpace(this.activeSpaceId);
          this.activeSpaceVisibility = localSpace?.visibility || null;
        } else {
          this.activeSpaceVisibility = null;
        }
      } catch {
        this.activeSpaceId = null;
        this.activeSpaceVisibility = null;
      }
    } else {
      this.activeSpaceId = null;
      this.activeSpaceVisibility = null;
    }

    // If there's an active space, do an initial sync (push + pull)
    if (this.activeSpaceId) {
      // Force offline edits scan on vault load
      this.syncLocalFilesystemToDB(true).then(() => {
        this.sync();
      });
    }
  }

  private startAutoSync() {
    // Periodic sync -- both push AND pull. The push ensures queued offline
    // edits eventually reach the server even if the user is idle.
    this.syncInterval = setInterval(() => {
      if (this.activeSpaceId && this.isOnline) {
        this.sync();
      }
    }, 15_000); // 15s interval (was 30s pull-only)

    if (typeof window !== 'undefined') {
      // On focus: do a full sync (user may have been away / on another device)
      window.addEventListener('focus', () => {
        if (this.activeSpaceId) this.sync();
      });

      // On reconnect: immediately flush all queued edits + pull latest
      window.addEventListener('online', () => {
        console.log('[SyncEngine] Network online -- triggering full sync');
        this.isOnline = true;
        if (this.activeSpaceId) {
          // Reset retry counts for all queued items so offline edits get
          // another fair chance now that connectivity is restored.
          this.resetRetryCountsAndSync();
        }
      });

      window.addEventListener('offline', () => {
        console.log('[SyncEngine] Network offline -- pausing sync');
        this.isOnline = false;
      });

      // Visibility change: sync when tab becomes active
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.activeSpaceId && this.isOnline) {
          this.sync();
        }
      });
    }

    this.authUnsubscribe = authManager.subscribe((state) => {
      if (state.user && !state.isLoading && this.activeSpaceId) {
        this.sync();
      }
    });
  }

  /**
   * Reset all retry counts in the sync queue and then do a full sync.
   * Called on reconnection so that offline edits don't remain stuck at
   * high retry counts.
   */
  private async resetRetryCountsAndSync() {
    try {
      const queue = await localDB.getSyncQueue();
      for (const item of queue) {
        if (item.retry_count > 0) {
          await localDB.putSyncItem({ ...item, retry_count: 0 });
        }
      }
    } catch (err) {
      console.error('[SyncEngine] Failed to reset retry counts:', err);
    }
    // Force scan of offline edits on reconnection
    await this.syncLocalFilesystemToDB(true);
    this.sync();
  }

  /**
   * Trigger a debounced push. Called by App.tsx when the user edits a note.
   */
  public triggerPush() {
    // Don't push during bootstrap
    if (collaborationEngine.status.state === 'bootstrapping') return;
    if (!this.activeSpaceId) return;
    
    // Don't push if private space is locked
    if (this.activeSpaceVisibility === 'private' && !isSpaceUnlocked(this.activeSpaceId)) {
      console.log('[SyncEngine] Sync push skipped: private space is locked.');
      return;
    }

    if (this.pushDebounceTimeout) clearTimeout(this.pushDebounceTimeout);
    this.pushDebounceTimeout = setTimeout(() => {
      this.pushChanges();
    }, 500);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyStatus(status: SyncStatus) {
    this.listeners.forEach(fn => fn(status));
  }

  async sync(): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) return { pushed: 0, pulled: 0 };
    if (!authManager.isLoggedIn()) return { pushed: 0, pulled: 0 };
    if (collaborationEngine.status.state === 'bootstrapping') return { pushed: 0, pulled: 0 };
    
    // Don't sync if private space is locked
    if (this.activeSpaceId && this.activeSpaceVisibility === 'private') {
      if (!isSpaceUnlocked(this.activeSpaceId)) {
        console.log('[SyncEngine] Sync skipped: private space is locked.');
        return { pushed: 0, pulled: 0 };
      }
    }

    this.isSyncing = true;
    this.notifyStatus({ state: 'syncing' });

    let pushed = 0;
    let pulled = 0;

    try {
      // Sync offline local filesystem edits into IndexedDB/sync_queue first
      await this.syncLocalFilesystemToDB();
      pushed = await this.pushChanges();
      pulled = await this.pullChanges();
      this.notifyStatus({
        state: 'idle',
        lastSync: new Date().toISOString(),
        pushed,
        pulled,
      });
    } catch (err) {
      console.error('[SyncEngine] Sync failed:', err);
      this.notifyStatus({ state: 'error', error: String(err) });
    } finally {
      this.isSyncing = false;
    }

    return { pushed, pulled };
  }

  // ── Push (Local -> Cloud) ──────────────────────────────────────────────────

  public async pushChanges(): Promise<number> {
    if (collaborationEngine.status.state === 'bootstrapping') return 0;
    if (!this.activeSpaceId) return 0;

    const client = getActiveClient();
    const queue = await localDB.getSyncQueue();
    if (queue.length === 0) return 0;

    let count = 0;

    // Group by table:operation for batching
    const batches: Record<string, SyncQueueItem[]> = {};
    for (const item of queue) {
      const key = `${item.table}:${item.operation}`;
      if (!batches[key]) batches[key] = [];
      batches[key].push(item);
    }

    for (const [key, items] of Object.entries(batches)) {
      const [table, op] = key.split(':');

      // Only sync notes and note_chunks for collaboration
      if (table !== 'notes' && table !== 'note_chunks') continue;

      const payloads = items.map(item => {
        const payload = { ...item.payload };
        payload.last_client_id = this.clientId;
        // Ensure space_id is set
        if (this.activeSpaceId && !payload.space_id) {
          payload.space_id = this.activeSpaceId;
        }
        if (payload.path) {
          payload.path = normalizeSyncPath(payload.path);
        }
        return payload;
      });

      try {
        const pushedItemIds = new Set<string>();

        if (op === 'insert' || op === 'update' || op === 'delete') {
          const finalPayloads = [];
          for (let i = 0; i < payloads.length; i++) {
            const payload = payloads[i];
            const originalItem = items[i];

            if (table === 'notes') {
              try {
                const { data: remote } = await client
                  .from('notes')
                  .select('updated_at, version, content_hash, client_id')
                  .eq('id', payload.id)
                  .maybeSingle();

                if (remote) {
                  const remoteVersion = normalizeVersion((remote as any).version);
                  const localVersion = normalizeVersion(payload.version);
                  if (remoteVersion > localVersion) {
                    console.warn('[SyncEngine][push_rejected_version]', {
                      noteId: payload.id,
                      remoteVersion,
                      localVersion,
                    });
                    await localDB.removeSyncItem(originalItem.id);
                    count++;
                    continue;
                  }
                  if (
                    remoteVersion > 0 &&
                    remoteVersion === localVersion &&
                    (remote as any).content_hash &&
                    payload.content_hash &&
                    (remote as any).content_hash !== payload.content_hash &&
                    (remote as any).client_id !== payload.client_id
                  ) {
                    console.warn('[SyncEngine][push_rejected_equal_version_hash_conflict]', {
                      noteId: payload.id,
                      version: localVersion,
                    });
                    await localDB.removeSyncItem(originalItem.id);
                    count++;
                    continue;
                  }
                  const remoteTime = new Date(remote.updated_at).getTime();
                  const localTime = new Date(payload.updated_at).getTime();
                  if (remoteVersion === 0 && remoteTime > localTime) {
                    console.warn(`[SyncEngine] Conflict detected for note ${payload.id}: remote is newer (${remote.updated_at} > ${payload.updated_at}). Skipping push to let pull take precedence.`);
                    // Remove from sync queue so we can pull the newer version
                    await localDB.removeSyncItem(originalItem.id);
                    count++;
                    continue;
                  }
                }
              } catch (e) {
                console.warn('[SyncEngine] Client-side LWW check failed:', e);
              }
            }
            finalPayloads.push(payload);
            pushedItemIds.add(originalItem.id);
          }

          if (finalPayloads.length > 0) {
            const { error } = await client.from(table as any).upsert(finalPayloads);
            if (error) throw error;
            count += finalPayloads.length;
          }
        }

        // Remove successfully pushed items from queue
        for (const itemId of pushedItemIds) {
          await localDB.removeSyncItem(itemId);
        }
      } catch (err) {
        console.error(`[SyncEngine] Push failed for ${table}:`, err);
        // Increment retry count but NEVER drop items. Offline edits must
        // survive indefinitely until connectivity is restored. The retry
        // count is used for exponential backoff, not as a hard limit.
        for (const item of items) {
          // Only increment retry if it was not skipped by the LWW check
          const inQueue = (await localDB.getSyncQueue()).some(q => q.id === item.id);
          if (inQueue) {
            await localDB.putSyncItem({ ...item, retry_count: item.retry_count + 1 });
          }
        }
      }
    }

    return count;
  }

  // ── Pull (Cloud -> Local) ──────────────────────────────────────────────────

  public async pullChanges(): Promise<number> {
    if (!this.activeSpaceId) return 0;
    if (!authManager.isLoggedIn()) return 0;

    const client = getActiveClient();
    // Use a per-space sync time to avoid cross-space/cross-account issues
    const syncTimeKey = `lastSync_${this.activeSpaceId}`;
    const lastSync = await localDB.getMeta(syncTimeKey) || new Date(0).toISOString();
    let count = 0;

    const { data: notes, error } = await client
      .from('notes')
      .select('*')
      .eq('space_id', this.activeSpaceId)
      .gte('updated_at', lastSync);

    if (error) {
      // Empty message errors are usually RLS blocking during auth init -- skip noisy logging
      const msg = error.message || '';
      if (msg) {
        console.error('[SyncEngine] Pull failed:', msg);
      }
      return 0;
    }

    if (notes) {
      for (const remote of notes) {
        const cleanPath = normalizeSyncPath(remote.path);
        const remoteNote = toLocalNote(remote);
        remoteNote.path = cleanPath;
        const local = await localDB.getNote(remote.id);

        // LWW: only apply if remote is newer
        if (local) {
          const remoteVersion = normalizeVersion((remote as any).version);
          const localVersion = normalizeVersion(local.version);
          if (remoteVersion > 0 || localVersion > 0) {
            if (remoteVersion <= localVersion) {
              console.info('[SyncEngine][pull_overwrite_prevented]', {
                path: cleanPath,
                remoteVersion,
                localVersion,
              });
              continue;
            }
          } else {
          const remoteTime = new Date(remote.updated_at).getTime();
          const localTime = new Date(local.updated_at).getTime();
          if (remoteTime <= localTime) continue;
          }
        }

        // Apply to IndexedDB (no sync enqueue -- this came from remote)
        await localDB.putNote(remoteNote, false);

        // Write to filesystem
        if (cleanPath && !remote.deleted) {
          try {
            const api = getAPI();
            if (cleanPath.includes('/')) {
              const parentDir = cleanPath.split('/').slice(0, -1).join('/');
              try { await api.createDirectory(parentDir); } catch { /* exists */ }
            }
            await api.writeFile(cleanPath, remote.content || '');
          } catch (err) {
            console.error('[SyncEngine] Failed to write pulled file:', err);
          }
        }

        count++;
      }
    }

    await localDB.setMeta(syncTimeKey, new Date().toISOString());
    return count;
  }

  /**
   * Scan the local filesystem and sync any new or edited files (offline edits)
   * into IndexedDB and the sync queue.
   */
  public async syncLocalFilesystemToDB(force = false) {
    if (!this.activeVaultPath || !this.activeSpaceId) return;

    const nowTime = Date.now();
    if (!force && nowTime - this.lastLocalScanTime < 60_000) {
      return; // scan at most once per minute unless forced
    }
    this.lastLocalScanTime = nowTime;

    try {
      const api = getAPI();
      const fileTree = await api.getFileTree();
      
      const files: { path: string; modifiedAt: number }[] = [];
      const scan = async (entries: any[]) => {
        for (const e of entries) {
          if (e.isDirectory) {
            if (e.children) await scan(e.children);
          } else if (e.extension === '.md' || e.extension === '.canvas') {
            files.push({
              path: e.path,
              modifiedAt: e.modifiedAt || 0,
            });
          }
        }
      };
      await scan(fileTree);

      let enqueuedAny = false;

      for (const file of files) {
        // Normalize path to relative
        const relativePath = normalizeSyncPath(file.path);
        if (!relativePath) continue;

        // Check if note exists in IndexedDB
        const localNote = await localDB.getNoteByPath(this.activeSpaceId, relativePath);
        
        let needsSync = false;
        if (!localNote) {
          // New file created offline / when collab was off!
          needsSync = true;
        } else {
          // File edited offline / when collab was off!
          const noteTime = new Date(localNote.updated_at || localNote.last_modified || 0).getTime();
          const fileTime = file.modifiedAt;
          
          // Sync if filesystem file is newer by more than 2 seconds (buffer clock skew)
          if (fileTime - noteTime > 2000) {
            needsSync = true;
          }
        }

        if (needsSync) {
          try {
            const content = await api.readFile(file.path);
            const title = relativePath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || relativePath;
            const isCanvas = relativePath.endsWith('.canvas');
            const nowIso = new Date(file.modifiedAt || Date.now()).toISOString();
            
            // Persist the note edit locally and enqueue for cloud sync
            await localDB.putNote({
              id: localNote?.id || uuidv4(),
              space_id: this.activeSpaceId,
              vault_id: null,
              last_client_id: this.clientId,
              version: localNote?.version !== undefined ? normalizeVersion(localNote.version) : 0,
              last_modified: nowIso,
              client_id: this.clientId,
              content_hash: await sha256Hex(content),
              title,
              path: relativePath,
              content,
              pinned: localNote?.pinned || false,
              created_at: localNote?.created_at || nowIso,
              updated_at: nowIso,
              deleted: false,
              is_canvas: isCanvas,
            }, true);
            
            enqueuedAny = true;
          } catch (err) {
            console.error(`[SyncEngine] Failed to sync offline change for ${file.path}:`, err);
          }
        }
      }

      if (enqueuedAny) {
        console.log('[SyncEngine] Detected and enqueued offline edits for sync');
        this.triggerPush();
      }
    } catch (err) {
      console.error('[SyncEngine] Failed to scan filesystem for offline edits:', err);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.pushDebounceTimeout) clearTimeout(this.pushDebounceTimeout);
    if (this.authUnsubscribe) this.authUnsubscribe();
  }
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSync?: string;
  pushed?: number;
  pulled?: number;
  error?: string;
}

export const syncEngine = new SyncEngine();
