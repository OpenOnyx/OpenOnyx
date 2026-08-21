import { supabase } from './supabase';
import { localDB, type LocalNote, type SyncQueueItem } from './localdb';
import { authManager } from './auth';
import { collaborationEngine } from './collaborationEngine';
import { getAPI } from '../utils/api';
import { normalizeVersion, sha256Hex } from '../utils/collabDocument';
import { v4 as uuidv4 } from 'uuid';
import { isPrivateCloudSpace, privateCrypto } from './privateCrypto';

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
 * Check if a Yjs snapshot exists in IndexedDB for the given space and note path.
 */
export async function hasYjsSnapshot(spaceId: string | null, cleanPath: string): Promise<boolean> {
  if (!spaceId) return false;
  if (typeof window === 'undefined' || !window.indexedDB || !window.indexedDB.databases) {
    return false;
  }
  const dbName = `yjs-${spaceId}-${cleanPath.replace(/[/\\:]/g, '_')}`;
  try {
    const dbs = await window.indexedDB.databases();
    return dbs.some(db => db.name === dbName);
  } catch {
    return false;
  }
}

/**
 * Get the active Supabase client -- either the user's own instance
 * or the default OpenOnyx instance.
 */
function getActiveClient() {
  return supabase;
}

async function toLocalNote(note: any, decryptForSpaceId?: string): Promise<LocalNote> {
  const content = decryptForSpaceId
    ? await privateCrypto.decryptNoteContent(decryptForSpaceId, note)
    : (note.content || '');
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
    content,
    content_encrypted: note.content_encrypted || null,
    iv: note.iv || null,
    auth_tag: note.auth_tag || null,
    encryption_version: note.encryption_version || null,
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

  private _activeSpaceId: string | null = null;

  public get activeSpaceId(): string | null {
    return collaborationEngine.activeSpaceId || this._activeSpaceId;
  }

  public set activeSpaceId(id: string | null) {
    this._activeSpaceId = id;
  }

  private activeVaultPath: string | null = null;
  private clientId: string = '';
  private lastLocalScanTime = 0;
  private activeSpacePrivateCache = new Map<string, boolean>();

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
        this._activeSpaceId = space?.id || null;
      } catch {
        this._activeSpaceId = null;
      }
    } else {
      this._activeSpaceId = null;
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

    if (this.pushDebounceTimeout) clearTimeout(this.pushDebounceTimeout);
    this.pushDebounceTimeout = setTimeout(() => {
      this.pushChanges();
    }, 200);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyStatus(status: SyncStatus) {
    this.listeners.forEach(fn => fn(status));
  }

  private async isPrivateActiveSpace(): Promise<boolean> {
    if (!this.activeSpaceId) return false;
    if (this.activeSpacePrivateCache.has(this.activeSpaceId)) {
      return this.activeSpacePrivateCache.get(this.activeSpaceId) || false;
    }
    const local = await localDB.getSpace(this.activeSpaceId);
    if (local) {
      const result = isPrivateCloudSpace(local);
      this.activeSpacePrivateCache.set(this.activeSpaceId, result);
      return result;
    }
    try {
      const { data } = await getActiveClient()
        .from('spaces')
        .select('visibility, is_public')
        .eq('id', this.activeSpaceId)
        .maybeSingle();
      const result = isPrivateCloudSpace(data as any);
      this.activeSpacePrivateCache.set(this.activeSpaceId, result);
      return result;
    } catch {
      return false;
    }
  }

  async sync(): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) return { pushed: 0, pulled: 0 };
    if (!authManager.isLoggedIn()) return { pushed: 0, pulled: 0 };
    if (collaborationEngine.status.state === 'bootstrapping') return { pushed: 0, pulled: 0 };

    this.isSyncing = true;
    this.notifyStatus({ state: 'syncing' });

    let pushed = 0;
    let pulled = 0;

    try {
      // Sync offline local filesystem edits into IndexedDB/sync_queue first
      await this.syncLocalFilesystemToDB();
      pushed = await this.pushChanges();
      pulled = await this.pullChanges();
      
      // Broadcast a sync notification so peers pull creations/deletions immediately
      if (pushed > 0) {
        collaborationEngine.broadcastSpaceSync();
      }
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

  private async saveConflictCopy(payload: any) {
    try {
      if (!payload.path || !payload.content) return;
      const ext = payload.path.endsWith('.canvas') ? '.canvas' : '.md';
      const basePath = payload.path.slice(0, -ext.length);
      const conflictPath = `${basePath} (conflict)${ext}`;

      const api = getAPI();
      if (conflictPath.includes('/')) {
        const parentDir = conflictPath.split('/').slice(0, -1).join('/');
        try { await api.createDirectory(parentDir); } catch { /* exists */ }
      }

      await api.writeFile(conflictPath, payload.content);

      const conflictId = uuidv4();
      const conflictTitle = conflictPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || conflictPath;
      const now = new Date().toISOString();

      const conflictNote = {
        id: conflictId,
        space_id: payload.space_id,
        vault_id: null,
        last_client_id: this.clientId,
        version: 1,
        last_modified: now,
        client_id: this.clientId,
        content_hash: await sha256Hex(payload.content),
        title: conflictTitle,
        path: conflictPath,
        content: payload.content,
        pinned: false,
        created_at: now,
        updated_at: now,
        deleted: false,
        is_canvas: payload.is_canvas,
      };

      await localDB.putNote(conflictNote, true);

      window.dispatchEvent(new CustomEvent('openonyx:file-written', {
        detail: { path: conflictPath, content: payload.content }
      }));

      console.info(`[SyncEngine] Preserved rejected edit as conflict copy: ${conflictPath}`);
    } catch (err) {
      console.error('[SyncEngine] Failed to save conflict copy:', err);
    }
  }

  // ── Push (Local -> Cloud) ──────────────────────────────────────────────────

  public async pushChanges(): Promise<number> {
    if (collaborationEngine.status.state === 'bootstrapping') return 0;
    if (!this.activeSpaceId) return 0;

    const client = getActiveClient();
    const queue = await localDB.getSyncQueue();
    // Filter queue to only include items for the active space to prevent RLS violations
    // from offline edits/changes made in other spaces from blocking sync.
    const activeQueue = queue.filter(item => {
      const payload = item.payload;
      if (!payload) return false;
      const itemSpaceId = payload.space_id;
      return !itemSpaceId || itemSpaceId === this.activeSpaceId;
    });
    if (activeQueue.length === 0) return 0;
    const isPrivateSpace = await this.isPrivateActiveSpace();

    let count = 0;

    // Group by table:operation for batching
    const batches: Record<string, SyncQueueItem[]> = {};
    for (const item of activeQueue) {
      const key = `${item.table}:${item.operation}`;
      if (!batches[key]) batches[key] = [];
      batches[key].push(item);
    }

    for (const [key, items] of Object.entries(batches)) {
      const [table, op] = key.split(':');

      // Only sync notes and note_chunks for collaboration
      if (table !== 'notes' && table !== 'note_chunks') continue;
      if (isPrivateSpace && table === 'note_chunks') {
        for (const item of items) {
          await localDB.removeSyncItem(item.id);
        }
        continue;
      }
      if (isPrivateSpace && !(await privateCrypto.ensureSpaceUnlocked(this.activeSpaceId))) {
        this.notifyStatus({ state: 'error', error: 'Unlock this private space before syncing encrypted content.' });
        continue;
      }

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
        if (payload.is_canvas && payload.content) {
          try {
            const parsed = JSON.parse(payload.content);
            delete parsed.openonyxCanvasViewportV1;
            payload.content = JSON.stringify(parsed);
          } catch {}
        }
        return payload;
      });

      let finalPayloads: any[] = [];
      try {
        const pushedItemIds = new Set<string>();

        if (op === 'insert' || op === 'update' || op === 'delete') {
          let remoteNotesMap: Map<string, any> | null = null;
          for (let i = 0; i < payloads.length; i++) {
            const payload = payloads[i];
            const originalItem = items[i];

            if (table === 'notes') {
              // Batch-fetch remote notes once (moved outside loop on first iteration)
              if (!remoteNotesMap) {
                try {
                  const noteIds = payloads.map(p => p.id).filter(Boolean);
                  const { data: remotes } = await client
                    .from('notes')
                    .select('id, updated_at, version, content_hash, client_id')
                    .in('id', noteIds);
                  remoteNotesMap = new Map((remotes || []).map((r: any) => [r.id, r]));
                } catch (e) {
                  console.warn('[SyncEngine] Batch remote note fetch failed:', e);
                  remoteNotesMap = new Map();
                }
              }

              try {
                const remote = remoteNotesMap.get(payload.id) || null;

                if (remote) {
                  const remoteVersion = normalizeVersion((remote as any).version);
                  const localVersion = normalizeVersion(payload.version);
                  if (remoteVersion > localVersion) {
                    console.warn(`[SyncEngine][push_rejected_version] Note ID: ${payload.id} | Remote: v${remoteVersion} | Local: v${localVersion}`);
                    if (remote.content_hash !== payload.content_hash) {
                      await this.saveConflictCopy(payload);
                    }
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
                    console.warn(`[SyncEngine][push_rejected_equal_version_hash_conflict] Note ID: ${payload.id} | Version: ${localVersion}`);
                    await this.saveConflictCopy(payload);
                    await localDB.removeSyncItem(originalItem.id);
                    count++;
                    continue;
                  }
                  const remoteTime = new Date(remote.updated_at).getTime();
                  const localTime = new Date(payload.updated_at).getTime();
                  if (remoteVersion === 0 && remoteTime > localTime) {
                    console.warn(`[SyncEngine] Conflict detected for note ${payload.id}: remote is newer (${remote.updated_at} > ${payload.updated_at}). Skipping push to let pull take precedence.`);
                    if (remote.content_hash !== payload.content_hash) {
                      await this.saveConflictCopy(payload);
                    }
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
            if (isPrivateSpace && table === 'notes') {
              const encrypted = await privateCrypto.encryptNoteContent(this.activeSpaceId, payload);
              finalPayloads.push({
                ...payload,
                ...encrypted,
              });
            } else {
              finalPayloads.push(payload);
            }
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
      } catch (err: any) {
        console.error(`[SyncEngine] Push failed for ${table}: ${err?.message || err} | Details: ${JSON.stringify({
          code: err?.code,
          details: err?.details,
          hint: err?.hint,
          message: err?.message,
          payloads: finalPayloads,
          userId: authManager.getUserId(),
          userEmail: authManager.getUser()?.email
        })}`);
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
    const isPrivateSpace = await this.isPrivateActiveSpace();
    if (isPrivateSpace && !privateCrypto.isUnlocked(this.activeSpaceId)) {
      this.notifyStatus({ state: 'error', error: 'Unlock this private space before loading encrypted content.' });
      return 0;
    }
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

        const { yDocManager } = await import('./yDocManager');
        const hasActiveYjs = yDocManager.hasDoc(cleanPath, this.activeSpaceId) ||
          await hasYjsSnapshot(this.activeSpaceId, cleanPath);
        if (hasActiveYjs) {
          console.info(`[SyncEngine] Skipping LWW overwrite for Yjs-managed note: ${cleanPath}`);
          continue;
        }

        let remoteNote: LocalNote;
        try {
          remoteNote = await toLocalNote(remote, isPrivateSpace ? this.activeSpaceId : undefined);
        } catch {
          privateCrypto.enterFailSafe(this.activeSpaceId, cleanPath);
          this.notifyStatus({ state: 'error', error: 'Failed to decrypt private note. Realtime paused to prevent data loss.' });
          continue;
        }
        remoteNote.path = cleanPath;
        const local = await localDB.getNote(remote.id);
        let isRename = false;
        let oldPath = "";

        // LWW: only apply if remote is newer
        if (local) {
          if (local.path !== remoteNote.path) {
            isRename = true;
            oldPath = local.path;
          }
          const remoteVersion = normalizeVersion((remote as any).version);
          const localVersion = normalizeVersion(local.version);
          if (remoteVersion > 0 || localVersion > 0) {
            if (remoteVersion <= localVersion) {
              console.info(`[SyncEngine][pull_overwrite_prevented] Path: ${cleanPath} | Remote: v${remoteVersion} | Local: v${localVersion}`);
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

        // Apply file change to filesystem (write or delete)
        if (cleanPath) {
          try {
            const api = getAPI();
            if (remote.deleted) {
              await api.deleteFile(cleanPath);
              window.dispatchEvent(new CustomEvent('openonyx:file-deleted', {
                detail: { path: cleanPath }
              }));
            } else {
              if (isRename && oldPath) {
                try {
                  await api.deleteFile(oldPath);
                } catch (e) {
                  console.warn('[SyncEngine] Failed to delete old path during remote rename:', e);
                }
              }
              if (cleanPath.includes('/')) {
                const parentDir = cleanPath.split('/').slice(0, -1).join('/');
                try { await api.createDirectory(parentDir); } catch { /* exists */ }
              }
              let finalContent = remoteNote.content || '';
              if (cleanPath.toLowerCase().endsWith('.canvas') && finalContent) {
                try {
                  const existingRaw = await api.readFile(cleanPath);
                  if (existingRaw) {
                    const existingParsed = JSON.parse(existingRaw);
                    if (existingParsed.openonyxCanvasViewportV1) {
                      const remoteParsed = JSON.parse(finalContent);
                      remoteParsed.openonyxCanvasViewportV1 = existingParsed.openonyxCanvasViewportV1;
                      finalContent = JSON.stringify(remoteParsed, null, 2);
                    }
                  }
                } catch {}
              }
              await api.writeFile(cleanPath, finalContent);
              window.dispatchEvent(new CustomEvent('openonyx:file-written', {
                detail: { path: cleanPath, content: finalContent }
              }));
              if (isRename && oldPath) {
                window.dispatchEvent(new CustomEvent('openonyx:file-renamed', {
                  detail: { oldPath, newPath: cleanPath }
                }));
              }
            }
          } catch (err) {
            if (!remote.deleted) {
              console.error('[SyncEngine] Failed to write pulled file:', err);
            }
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
        let fileContent = "";
        if (!localNote) {
          // New file created offline / when collab was off!
          needsSync = true;
        } else {
          // File edited offline / when collab was off!
          const noteTime = new Date(localNote.updated_at || localNote.last_modified || 0).getTime();
          const fileTime = file.modifiedAt;

          // Sync if filesystem file is newer by more than 2 seconds (buffer clock skew)
          if (fileTime - noteTime > 2000) {
            try {
              fileContent = await api.readFile(file.path);
              const hash = await sha256Hex(fileContent);
              if (hash !== localNote.content_hash) {
                needsSync = true;
              }
            } catch (err) {
              console.warn('[SyncEngine] Failed to read file for hash check:', err);
            }
          }
        }

        if (needsSync) {
          try {
            const content = fileContent || (await api.readFile(file.path));
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
