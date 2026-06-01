/**
 * CollaborationEngine -- Orchestrates real-time vault collaboration.
 *
 * A "private cloud space" is a Supabase mirror of a local vault.
 * Local vault is ALWAYS the source of truth.
 *
 * Owner flow:
 *   1. Create cloud space (indexes + uploads all vault files)
 *   2. Wait for status: 'ready'
 *   3. Send invites to collaborators
 *
 * Receiver flow:
 *   1. Accept invite (creates space_collaborator record via RPC)
 *   2. Check if already linked (linked_vaults)
 *   3. If not linked: select folder -> download snapshot -> reconstruct vault
 *   4. Bootstrap lock prevents edits/sync during reconstruction
 *   5. Start realtime sync
 *
 * Realtime:
 *   - Subscribes to postgres_changes on notes (filtered by space_id)
 *   - Uses last_client_id to skip self-echo
 *   - Last-Write-Wins conflict resolution
 */

import { supabase } from './supabase';
import { authManager } from './auth';
import { getUserSupabaseClient } from './userDatabase';
import { localDB } from './localdb';
import { normalizeSyncPath } from './syncEngine';
import { v4 as uuidv4 } from 'uuid';
import { getAPI } from '../utils/api';
import type { CollabOperation, CursorPresence } from '../utils/collabOperations';
import { normalizeVersion, sha256Hex } from '../utils/collabDocument';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CloudSpace {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: 'processing' | 'ready' | 'error';
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceInvite {
  id: string;
  space_id: string;
  sender_id: string;
  receiver_id: string | null;
  receiver_email: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  space_title?: string;
  sender_email?: string;
}

export interface LinkedVault {
  id: string;
  space_id: string;
  user_id: string;
  local_vault_path: string;
  is_bootstrapping: boolean;
  created_at: string;
}

export interface SpaceCollaborator {
  id: string;
  space_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  email?: string;
}

export interface SpaceSnapshot {
  space: any;
  notes: any[];
  paths: string[];
}

export interface UploadProgress {
  phase: 'indexing' | 'uploading' | 'finalizing';
  current: number;
  total: number;
  message: string;
}

export type CollabStatus =
  | { state: 'idle' }
  | { state: 'creating'; progress: UploadProgress }
  | { state: 'ready'; space: CloudSpace }
  | { state: 'bootstrapping'; progress: { current: number; total: number; message: string } }
  | { state: 'syncing' }
  | { state: 'error'; message: string };

export interface ActiveUser {
  id: string;
  email: string;
  name: string;
  color: string;
  isEditing: boolean;
  activeNoteId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
  return getUserSupabaseClient() || supabase;
}

function normalizePath(p: string): string {
  if (!p) return '';
  let normalized = p.replace(/\\/g, '/');
  while (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

const COLLABORATOR_COLORS = [
  '#3b82f6', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0ea5e9', '#0891b2', '#65a30d', '#ea580c', '#e11d48',
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}

async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Engine ───────────────────────────────────────────────────────────────────

type StatusListener = (status: CollabStatus) => void;
type ActiveUsersListener = (users: ActiveUser[]) => void;
type RemoteChangeListener = (table: string, payload: any) => void;
export interface RemoteDocumentMeta {
  version: number;
  last_modified?: string;
  client_id?: string | null;
  content_hash?: string;
}

type RemoteDocUpdateListener = (
  path: string,
  content: string,
  senderClientId: string,
  isBroadcast: boolean,
  meta?: RemoteDocumentMeta,
) => void;
type RemoteOperationListener = (path: string, ops: CollabOperation[]) => void;
type RemoteCursorListener = (presence: CursorPresence) => void;

class CollaborationEngine {
  private listeners = new Set<StatusListener>();
  private activeUsersListeners = new Set<ActiveUsersListener>();
  private changeListeners = new Set<RemoteChangeListener>();
  private remoteDocListeners = new Set<RemoteDocUpdateListener>();
  private remoteOpListeners = new Set<RemoteOperationListener>();
  private remoteCursorListeners = new Set<RemoteCursorListener>();
  private _status: CollabStatus = { state: 'idle' };
  private _activeSpaceId: string | null = null;
  private activeSpaceVisibility: string | null = null;
  private _activeUsers: ActiveUser[] = [];
  private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
  private clientId: string = '';
  private lastAppliedTimestamps = new Map<string, number>();
  private _collabPaused: boolean = false;
  private realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeReconnectAttempt = 0;
  private reconnectingSpaceId: string | null = null;
  private lastPresenceNoteId: string | null = null;
  private lastPresenceTyping = false;
  private incomingOperationQueues = new Map<string, CollabOperation[]>();
  private incomingOperationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private appliedOperationIds = new Set<string>();
  constructor() {
    this._collabPaused = typeof localStorage !== 'undefined' ? localStorage.getItem('collab_paused') === 'true' : false;
    
    // Synchronously initialize client ID to avoid async race conditions
    if (typeof localStorage !== 'undefined') {
      let stored = localStorage.getItem('collab_client_id');
      if (!stored) {
        stored = this.generateUUID();
        localStorage.setItem('collab_client_id', stored);
      }
      this.clientId = stored;
    } else {
      this.clientId = this.generateUUID();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.ensureRealtimeConnected());
      window.addEventListener('focus', () => this.ensureRealtimeConnected());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.ensureRealtimeConnected();
        }
      });
    }
    
    this.init();
  }

  get status() { return this._status; }
  get activeSpaceId() { return this._activeSpaceId; }
  get activeUsers() { return this._activeUsers; }
  get currentClientId() { return this.clientId; }
  get collabPaused() { return this._collabPaused; }

  setCollabPaused(paused: boolean) {
    this._collabPaused = paused;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('collab_paused', paused ? 'true' : 'false');
    }
    
    if (paused) {
      // Untrack presence to hide avatar/cursor for other users
      if (this.realtimeChannel) {
        try {
          this.realtimeChannel.untrack();
        } catch { /* best-effort */ }
      }
      this.notifyActiveUsers([]);
    } else {
      // Re-track presence to show online
      if (this.realtimeChannel) {
        const userId = authManager.getUserId();
        const user = authManager.getUser();
        if (userId) {
          this.realtimeChannel.track({
            user_id: userId,
            email: user?.email || '',
            online_at: new Date().toISOString(),
          }).catch(err => console.error('[Collab] Failed to track presence on resume:', err));
        }
        // Force sync presence
        this.handlePresenceSync();
      }
    }
    
    // Notify all status listeners to trigger a re-render
    this.notify(this._status);
  }

  async init() {
    // Already populated synchronously, but make sure to sync with DB just in case
    this.clientId = await localDB.getClientId();
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onActiveUsersChange(fn: ActiveUsersListener): () => void {
    this.activeUsersListeners.add(fn);
    return () => this.activeUsersListeners.delete(fn);
  }

  onRemoteChange(fn: RemoteChangeListener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /**
   * Register a listener for full-content document updates (DB-level fallback).
   */
  onRemoteDocumentUpdate(fn: RemoteDocUpdateListener): () => void {
    this.remoteDocListeners.add(fn);
    return () => this.remoteDocListeners.delete(fn);
  }

  /**
   * Register a listener for granular editing operations received via Broadcast.
   */
  onRemoteOperation(fn: RemoteOperationListener): () => void {
    this.remoteOpListeners.add(fn);
    return () => this.remoteOpListeners.delete(fn);
  }

  /**
   * Register a listener for remote cursor presence updates.
   */
  onRemoteCursor(fn: RemoteCursorListener): () => void {
    this.remoteCursorListeners.add(fn);
    return () => this.remoteCursorListeners.delete(fn);
  }

  private notify(status: CollabStatus) {
    this._status = status;
    this.listeners.forEach(fn => fn(status));
  }

  private notifyActiveUsers(users: ActiveUser[]) {
    this._activeUsers = users;
    this.activeUsersListeners.forEach(fn => fn(users));
  }

  // ── Owner: Create Cloud Space ──────────────────────────────────────────────

  async createCloudSpace(spaceName: string, vaultPath: string): Promise<string> {
    const user = authManager.requireAuth();
    const client = getClient();
    const api = getAPI();
    const spaceId = uuidv4();
    const now = new Date().toISOString();

    this.notify({
      state: 'creating',
      progress: { phase: 'indexing', current: 0, total: 0, message: 'Creating cloud space...' },
    });

    try {
      // Create space with status: processing
      console.log('[Collab] Creating space', spaceId, 'for vault', vaultPath);
      const { error: spaceErr } = await client.from('spaces').insert({
        id: spaceId,
        owner_id: user.id,
        title: spaceName,
        description: `Cloud mirror of vault: ${spaceName}`,
        visibility: 'private',
        is_public: false,
        status: 'processing',
        created_at: now,
        updated_at: now,
      });

      if (spaceErr) {
        throw new Error(`Failed to create space: ${spaceErr.message || spaceErr.code || JSON.stringify(spaceErr)}`);
      }

      // Add owner as collaborator
      const { error: collabErr } = await client.from('space_collaborators').insert({
        space_id: spaceId,
        user_id: user.id,
        role: 'owner',
      });
      if (collabErr) {
        console.warn('[Collab] Failed to add owner as collaborator:', collabErr.message || JSON.stringify(collabErr));
      }

      // Scan vault files
      this.notify({
        state: 'creating',
        progress: { phase: 'indexing', current: 0, total: 0, message: 'Scanning vault files...' },
      });

      console.log('[Collab] Scanning file tree...');
      const fileTree = await api.getFileTree();
      const files: { path: string; title: string; content: string; isCanvas: boolean }[] = [];

      const scan = async (entries: any[]) => {
        for (const e of entries) {
          if (e.isDirectory) {
            if (e.children) await scan(e.children);
          } else if (e.extension === '.md' || e.extension === '.canvas') {
            try {
              const content = await api.readFile(e.path);
              files.push({
                path: e.path,
                title: e.name.replace(/\.(md|canvas)$/, ''),
                content,
                isCanvas: e.extension === '.canvas',
              });
            } catch {
              // Skip unreadable files
            }
          }
        }
      };
      await scan(fileTree);

      const total = files.length;
      console.log(`[Collab] Found ${total} files to upload`);
      this.notify({
        state: 'creating',
        progress: { phase: 'uploading', current: 0, total, message: `Uploading ${total} files...` },
      });

      // Batch upload notes -- continue on partial failures
      const BATCH_SIZE = 50;
      let uploaded = 0;

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batchFiles = files.slice(i, i + BATCH_SIZE);
        const batch = await Promise.all(batchFiles.map(async f => ({
          id: uuidv4(),
          space_id: spaceId,
          version: 0,
          last_modified: now,
          client_id: this.clientId,
          content_hash: await sha256Hex(f.content),
          title: f.title,
          path: f.path,
          content: f.content,
          is_canvas: f.isCanvas,
          pinned: false,
          deleted: false,
          created_at: now,
          updated_at: now,
        })));

        try {
          const { error: insertErr } = await client.from('notes').insert(batch);
          if (insertErr) {
            const detail = insertErr.message || insertErr.code || insertErr.hint || JSON.stringify(insertErr);
            console.error(`[Collab] Batch ${i / BATCH_SIZE + 1} insert failed:`, detail);
            // Try inserting one-by-one as fallback
            let singles = 0;
            for (const row of batch) {
              const { error: singleErr } = await client.from('notes').insert(row);
              if (!singleErr) singles++;
            }
            console.log(`[Collab] Fallback: inserted ${singles}/${batch.length} individually`);
            uploaded += singles;
          } else {
            uploaded += batch.length;
            console.log(`[Collab] Batch ${i / BATCH_SIZE + 1}: inserted ${batch.length} notes`);
          }
        } catch (batchErr: any) {
          console.error(`[Collab] Batch ${i / BATCH_SIZE + 1} exception:`, batchErr);
        }

        this.notify({
          state: 'creating',
          progress: {
            phase: 'uploading',
            current: Math.min(i + BATCH_SIZE, total),
            total,
            message: `Uploaded ${Math.min(i + BATCH_SIZE, total)}/${total}...`,
          },
        });
      }

      console.log(`[Collab] Upload complete: ${uploaded}/${total} notes`);

      // Finalize
      this.notify({
        state: 'creating',
        progress: { phase: 'finalizing', current: total, total, message: 'Finalizing...' },
      });

      const normalizedVaultPath = normalizePath(vaultPath);
      await client.from('linked_vaults').insert({
        space_id: spaceId,
        user_id: user.id,
        local_vault_path: normalizedVaultPath,
        is_bootstrapping: false,
      });

      await client.from('spaces').update({ status: 'ready' }).eq('id', spaceId);
      await localDB.putSpace({
        id: spaceId,
        owner_id: user.id,
        title: spaceName,
        description: null,
        helps_with: null,
        is_public: false,
        visibility: 'private',
        forked_from: null,
        created_at: now,
        updated_at: now,
      }, false);
      await localDB.setMeta(`collab_space_${normalizedVaultPath}`, spaceId);
      this._activeSpaceId = spaceId;
      this.activeSpaceVisibility = 'private';

      const space: CloudSpace = {
        id: spaceId,
        owner_id: user.id,
        title: spaceName,
        description: null,
        status: 'ready',
        visibility: 'private',
        created_at: now,
        updated_at: now,
      };

      this.notify({ state: 'ready', space });
      return spaceId;
    } catch (err: any) {
      const errMsg = err.message || 'Unknown error during space creation';
      console.error('[Collab] createCloudSpace failed:', errMsg);
      this.notify({ state: 'error', message: errMsg });
      throw err;
    }
  }

  // ── Owner: Send Invite ─────────────────────────────────────────────────────

  async sendInvite(spaceId: string, emailOrUserId: string): Promise<SpaceInvite> {
    const user = authManager.requireAuth();
    const client = getClient();

    // Verify space is ready
    const { data: space } = await client.from('spaces')
      .select('status')
      .eq('id', spaceId)
      .single();
    if (!space || space.status !== 'ready') {
      throw new Error('Space is not ready yet. Wait for upload to complete.');
    }

    const isEmail = emailOrUserId.includes('@');
    const invite: any = {
      id: uuidv4(),
      space_id: spaceId,
      sender_id: user.id,
      receiver_email: isEmail ? emailOrUserId : '',
      role: 'editor',
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    if (isEmail) {
      // Try to resolve user ID from email
      const { data: recv } = await client.from('users')
        .select('id')
        .eq('email', emailOrUserId)
        .single();
      if (recv) invite.receiver_id = recv.id;
    } else {
      // Direct user ID
      invite.receiver_id = emailOrUserId;
      const { data: recv } = await client.from('users')
        .select('email')
        .eq('id', emailOrUserId)
        .single();
      if (recv) invite.receiver_email = recv.email;
    }

    const { error } = await client.from('space_invites').insert(invite);
    if (error) throw new Error(error.message);
    return invite;
  }

  // ── Invites ────────────────────────────────────────────────────────────────

  async getIncomingInvites(): Promise<SpaceInvite[]> {
    const user = authManager.getUser();
    if (!user?.email) return [];
    const client = getClient();

    const { data } = await client
      .from('space_invites')
      .select('*, spaces:space_id(title), sender:sender_id(email)')
      .or(`receiver_email.eq.${user.email},receiver_id.eq.${user.id}`)
      .eq('status', 'pending');

    return (data || []).map((r: any) => ({
      ...r,
      space_title: r.spaces?.title || 'Unknown',
      sender_email: r.sender?.email || r.sender_id,
    }));
  }

  async getSentInvites(spaceId?: string): Promise<SpaceInvite[]> {
    const user = authManager.getUser();
    if (!user) return [];
    const client = getClient();

    let q = client.from('space_invites').select('*').eq('sender_id', user.id);
    if (spaceId) q = q.eq('space_id', spaceId);
    const { data } = await q;
    return (data || []) as unknown as SpaceInvite[];
  }

  // ── Accept / Reject ────────────────────────────────────────────────────────

  async acceptInvite(inviteId: string): Promise<{
    spaceId: string;
    alreadyLinked: boolean;
    linkedVault?: LinkedVault;
  }> {
    const user = authManager.requireAuth();
    const client = getClient();

    // RPC handles status update + collaborator creation
    const { error: rpcErr } = await client.rpc('accept_space_invite', {
      p_invite_id: inviteId,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    // Get the space_id from the invite
    const { data: invite } = await client.from('space_invites')
      .select('space_id')
      .eq('id', inviteId)
      .single();
    if (!invite) throw new Error('Invite not found after accepting');

    // Check if already linked
    const { data: existing } = await client.from('linked_vaults')
      .select('*')
      .eq('space_id', invite.space_id)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      return {
        spaceId: invite.space_id,
        alreadyLinked: true,
        linkedVault: existing as LinkedVault,
      };
    }

    return { spaceId: invite.space_id, alreadyLinked: false };
  }

  async rejectInvite(inviteId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reject_space_invite', {
      p_invite_id: inviteId,
    });
    if (error) throw new Error(error.message);
  }

  // ── Snapshot & Reconstruction ──────────────────────────────────────────────

  async getSpaceSnapshot(spaceId: string): Promise<SpaceSnapshot> {
    const client = getClient();

    return retryAsync(async () => {
      const { data, error } = await client.rpc('get_space_snapshot', {
        p_space_id: spaceId,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Empty snapshot returned');

      const snapshot = data as unknown as SpaceSnapshot;
      if (!snapshot.notes || !Array.isArray(snapshot.notes)) {
        throw new Error('Invalid snapshot: missing notes array');
      }
      return snapshot;
    }, 3, 1000);
  }

  async reconstructVault(
    spaceId: string,
    localPath: string,
    snapshot: SpaceSnapshot,
    onProgress?: (c: number, t: number, m: string) => void,
  ): Promise<void> {
    const user = authManager.requireAuth();
    const client = getClient();
    const api = getAPI();
    
    const normalizedLocalPath = normalizePath(localPath);
    
    // Set the main process vault path first so we write to the correct folder!
    await api.setVaultPath(localPath);

    const notes = snapshot.notes || [];
    const total = notes.length;

    // Step 1: Set bootstrap lock
    this.notify({
      state: 'bootstrapping',
      progress: { current: 0, total, message: 'Setting up vault link...' },
    });

    await client.from('linked_vaults').upsert({
      space_id: spaceId,
      user_id: user.id,
      local_vault_path: normalizedLocalPath,
      is_bootstrapping: true,
    });

    try {
      // Step 2: Create directory structure
      const dirs = new Set<string>();
      for (const n of notes) {
        if (n.path?.includes('/')) {
          const parts = n.path.split('/');
          parts.pop(); // Remove filename
          let cur = '';
          for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            dirs.add(cur);
          }
        }
      }

      // Sort by depth to create parents first
      const sortedDirs = [...dirs].sort(
        (a, b) => a.split('/').length - b.split('/').length,
      );

      for (const d of sortedDirs) {
        try {
          await api.createDirectory(d);
        } catch {
          // Directory already exists
        }
      }

      // Step 3: Write files and store in IndexedDB
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const ext = note.is_canvas ? '.canvas' : '.md';
        const filePath = note.path || `${note.title}${ext}`;
        const progressMsg = `Writing ${note.title}${ext} (${i + 1}/${total})`;

        this.notify({
          state: 'bootstrapping',
          progress: { current: i + 1, total, message: progressMsg },
        });
        onProgress?.(i + 1, total, progressMsg);

        // Ensure parent directory exists
        if (filePath.includes('/')) {
          const parentDir = filePath.split('/').slice(0, -1).join('/');
          try {
            await api.createDirectory(parentDir);
          } catch {
            // Already exists
          }
        }

        // Write file to disk
        try {
          await api.createFile(filePath, note.content || '');
        } catch (err) {
          console.error(`[Collab] Write failed: ${filePath}`, err);
        }

        // Store in IndexedDB (no sync enqueue -- we just downloaded this)
        await localDB.putNote({
          id: note.id,
          space_id: spaceId,
          vault_id: null,
          last_client_id: null,
          version: normalizeVersion(note.version),
          last_modified: note.last_modified || note.updated_at,
          client_id: note.client_id || note.last_client_id || null,
          content_hash: note.content_hash || await sha256Hex(note.content || ''),
          title: note.title,
          path: filePath,
          content: note.content || '',
          pinned: note.pinned || false,
          created_at: note.created_at,
          updated_at: note.updated_at,
          deleted: false,
          is_canvas: note.is_canvas || false,
        }, false);
      }

      // Step 4: Release bootstrap lock
      await client.from('linked_vaults')
        .update({ is_bootstrapping: false })
        .eq('space_id', spaceId)
        .eq('user_id', user.id);

      // Save space details in local cache if present in snapshot
      if (snapshot.space) {
        await localDB.putSpace({
          id: snapshot.space.id,
          owner_id: snapshot.space.owner_id,
          title: snapshot.space.title,
          description: snapshot.space.description || null,
          helps_with: snapshot.space.helps_with || null,
          is_public: snapshot.space.is_public || false,
          visibility: (snapshot.space.visibility || 'private') as 'local' | 'private' | 'public',
          forked_from: snapshot.space.forked_from || null,
          created_at: snapshot.space.created_at || new Date().toISOString(),
          updated_at: snapshot.space.updated_at || new Date().toISOString(),
        }, false);
      }

      // Step 5: Store vault-space mapping
      await localDB.setMeta(`collab_space_${normalizedLocalPath}`, spaceId);
      this._activeSpaceId = spaceId;

      this.notify({ state: 'syncing' });
    } catch (err) {
      // Bootstrap lock stays true on failure -- allows resume on retry
      console.error('[Collab] Vault reconstruction failed:', err);
      this.notify({
        state: 'error',
        message: err instanceof Error ? err.message : 'Vault reconstruction failed',
      });
      throw err;
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getSpaceForVault(vaultPath: string): Promise<CloudSpace | null> {
    const normPath = normalizePath(vaultPath);
    let spaceId = await localDB.getMeta(`collab_space_${normPath}`);
    const client = getClient();
    const user = authManager.getUser();

    if (!spaceId && user) {
      // Fallback: Query remote linked_vaults table to see if this vault is linked to a space!
      const { data: linked } = await client.from('linked_vaults')
        .select('space_id, local_vault_path')
        .eq('user_id', user.id);

      const match = (linked || []).find(l => normalizePath(l.local_vault_path) === normPath);
      if (match?.space_id) {
        spaceId = match.space_id;
        await localDB.setMeta(`collab_space_${normPath}`, spaceId);
      }
    }

    if (!spaceId) return null;

    try {
      const { data, error } = await client.from('spaces')
        .select('*')
        .eq('id', spaceId)
        .single();

      if (data) {
        // Cache space details locally
        await localDB.putSpace({
          id: data.id,
          owner_id: data.owner_id,
          title: data.title,
          description: data.description,
          helps_with: data.helps_with || null,
          is_public: data.is_public || false,
          visibility: (data.visibility || 'private') as 'local' | 'private' | 'public',
          forked_from: data.forked_from || null,
          created_at: data.created_at,
          updated_at: data.updated_at,
        }, false);

        this._activeSpaceId = spaceId;
        this.activeSpaceVisibility = data.visibility || 'private';
        return data as CloudSpace;
      }

      if (error) {
        console.warn('[Collab] Remote space query failed, checking local cache:', error.message);
        const isNotFoundError = error.code === 'PGRST116' || 
          error.message?.includes('no rows') || 
          error.message?.includes('single JSON object') ||
          error.message?.includes('JSON object requested');

        if (isNotFoundError) {
          console.warn('[Collab] Space does not exist on remote server. Clearing dead local link and cache.');
          await localDB.setMeta(`collab_space_${normPath}`, null);
          await localDB.deleteSpace(spaceId);
          if (this._activeSpaceId === spaceId) {
            this._activeSpaceId = null;
          }
          return null;
        }
      }
    } catch (err) {
      console.warn('[Collab] Exception fetching space details, checking local cache:', err);
    }

    // Fallback: load from local IndexedDB cache
    const cachedSpace = await localDB.getSpace(spaceId);
    if (cachedSpace) {
      console.log('[Collab] Using cached space details for space:', spaceId);
      this._activeSpaceId = spaceId;
      this.activeSpaceVisibility = cachedSpace.visibility || 'private';
      return {
        id: cachedSpace.id,
        owner_id: cachedSpace.owner_id,
        title: cachedSpace.title,
        description: cachedSpace.description,
        visibility: cachedSpace.visibility,
        status: 'ready',
        created_at: cachedSpace.created_at,
        updated_at: cachedSpace.updated_at,
      } as CloudSpace;
    }

    return null;
  }

  async getCollaborators(spaceId: string): Promise<SpaceCollaborator[]> {
    const client = getClient();
    const { data } = await client.from('space_collaborators')
      .select('*, users:user_id(email)')
      .eq('space_id', spaceId);

    return (data || []).map((r: any) => ({
      ...r,
      email: r.users?.email || r.user_id,
    }));
  }

  async getAvailableSpacesToLink(): Promise<CloudSpace[]> {
    const user = authManager.getUser();
    if (!user) return [];
    const client = getClient();

    const { data, error } = await client
      .from('space_collaborators')
      .select('space_id, spaces (*)')
      .eq('user_id', user.id);

    if (error) {
      console.error('[Collab] Failed to get available spaces to link:', error);
      return [];
    }

    const spaces = (data || [])
      .map((r: any) => r.spaces)
      .filter((s): s is CloudSpace => !!s && s.status === 'ready');

    return spaces;
  }

  async linkSpaceToVault(spaceId: string, vaultPath: string): Promise<void> {
    const user = authManager.requireAuth();
    const client = getClient();
    
    const normalizedPath = normalizePath(vaultPath);
    console.log('[Collab] Linking space', spaceId, 'to vault', normalizedPath);

    const { error } = await client.from('linked_vaults').upsert({
      space_id: spaceId,
      user_id: user.id,
      local_vault_path: normalizedPath,
      is_bootstrapping: false,
    });

    if (error) {
      throw new Error(`Failed to link vault in cloud: ${error.message}`);
    }

    try {
      const { data: space } = await client.from('spaces')
        .select('*')
        .eq('id', spaceId)
        .single();

      if (space) {
        await localDB.putSpace({
          id: space.id,
          owner_id: space.owner_id,
          title: space.title,
          description: space.description || null,
          helps_with: space.helps_with || null,
          is_public: space.is_public || false,
          visibility: (space.visibility || 'private') as 'local' | 'private' | 'public',
          forked_from: space.forked_from || null,
          created_at: space.created_at,
          updated_at: space.updated_at,
        }, false);
        this.activeSpaceVisibility = space.visibility || 'private';
      }
    } catch (e) {
      console.warn('[Collab] Failed to cache linked space details:', e);
    }

    await localDB.setMeta(`collab_space_${normalizedPath}`, spaceId);
    this._activeSpaceId = spaceId;

    this.notify({ state: 'syncing' });
  }

  // ── Realtime ───────────────────────────────────────────────────────────────

  async subscribeToSpace(spaceId: string) {
    const userId = authManager.getUserId();
    // Do NOT subscribe if the user is not authenticated yet -- presence key
    // would be undefined and create ghost entries.
    if (!userId) {
      console.warn('[Collab] subscribeToSpace: skipping -- userId is null');
      return;
    }

    // Fetch space details first to determine visibility
    let space = await localDB.getSpace(spaceId);
    if (!space) {
      try {
        const { data } = await getClient().from('spaces').select('*').eq('id', spaceId).single();
        if (data) {
          space = {
            id: data.id,
            owner_id: data.owner_id,
            title: data.title,
            description: data.description,
            helps_with: data.helps_with || null,
            is_public: data.is_public || false,
            visibility: (data.visibility || 'private') as 'local' | 'private' | 'public',
            forked_from: data.forked_from || null,
            created_at: data.created_at,
            updated_at: data.updated_at,
          };
          await localDB.putSpace(space, false);
        }
      } catch (err) {
        console.warn('[Collab] Failed to fetch space details for subscription:', err);
      }
    }

    const visibility = space?.visibility || 'public';
    this.activeSpaceVisibility = visibility;

    if (visibility === 'private') {
      console.log('[Collab] Skipping realtime subscription for private cloud space:', spaceId);
      this.unsubscribeFromSpace();
      this._activeSpaceId = spaceId;
      if (space) {
        this.notify({ state: 'ready', space: { ...space, status: 'ready' } as any });
      }
      return;
    }

    this.clearRealtimeReconnect();

    const currentState = this.realtimeChannel ? (this.realtimeChannel as any).state : null;
    // Already subscribed/subscribing to this exact space with a usable channel.
    if (
      this.realtimeChannel &&
      this._activeSpaceId === spaceId &&
      (currentState === 'joined' || currentState === 'joining')
    ) {
      return;
    }

    this.unsubscribeFromSpace();
    this._activeSpaceId = spaceId;

    // Guarantee clientId is loaded before any broadcast/filter logic runs.
    if (!this.clientId) {
      this.clientId = await localDB.getClientId();
    }

    const client = getClient();

    this.realtimeChannel = client
      .channel(`space:${spaceId}`, {
        config: {
          presence: { key: userId },
          broadcast: { self: false },
        },
      })
      // Listen for note changes via Postgres replication (fallback / persistence)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          if (this._collabPaused) return;
          this.handleRemoteNoteChange(payload);
        },
      )
      // Listen for granular editing operations via Broadcast
      .on('broadcast', { event: 'doc-ops' }, (msg) => {
        if (this._collabPaused) return;
        const { path, ops, clientId: senderClientId } = msg.payload || {};
        // Skip if no payload, or if this is our own echo (should not happen
        // with self:false but guard defensively), or if clientId is empty.
        if (!path || !ops) return;
        if (senderClientId && this.clientId && senderClientId === this.clientId) return;
        const normalizedOps = (ops as CollabOperation[])
          .filter(op => {
            const opClientId = op.client_id || op.clientId || senderClientId;
            if (opClientId && this.clientId && opClientId === this.clientId) return false;
            if (!op.operation_id) {
              console.warn('[Collab][op_rejected] missing operation_id', { path, senderClientId });
              return false;
            }
            if (this.appliedOperationIds.has(op.operation_id)) {
              console.info('[Collab][op_duplicate] skipping already applied operation', { path, operation_id: op.operation_id });
              return false;
            }
            return true;
          });

        if (normalizedOps.length === 0) return;

        const clientPathKey = `${senderClientId || normalizedOps[0]?.client_id || 'unknown'}:${path}`;
        const lastTs = this.lastAppliedTimestamps.get(clientPathKey) || 0;
        const freshOps = normalizedOps;
        if (freshOps.length > 0) {
          const maxTs = Math.max(lastTs, ...freshOps.map(op => op.timestamp));
          this.lastAppliedTimestamps.set(clientPathKey, maxTs);
          this.enqueueIncomingOperations(path, freshOps);
        }
      })
      // Listen for full-document sync via Broadcast (fallback for large edits)
      .on('broadcast', { event: 'doc-full' }, (msg) => {
        if (this._collabPaused) return;
        const { path, content, clientId: senderClientId, version, last_modified, client_id, content_hash } = msg.payload || {};
        if (!path || content === undefined) return;
        if (senderClientId && this.clientId && senderClientId === this.clientId) return;
        this.remoteDocListeners.forEach(fn => fn(path, content, senderClientId || client_id || '', true, {
          version: normalizeVersion(version),
          last_modified,
          client_id: client_id || senderClientId || null,
          content_hash,
        }));
      })
      // Listen for cursor presence updates via Broadcast
      .on('broadcast', { event: 'cursor-presence' }, (msg) => {
        if (this._collabPaused) return;
        const presence = msg.payload as CursorPresence | undefined;
        if (!presence || presence.user_id === userId) return;
        this.remoteCursorListeners.forEach(fn => fn(presence));
      })
      // Track presence
      .on('presence', { event: 'sync' }, () => {
        this.handlePresenceSync();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && !this._collabPaused) {
          this.realtimeReconnectAttempt = 0;
          this.reconnectingSpaceId = null;
          const user = authManager.getUser();
          try {
            await this.realtimeChannel?.track({
              user_id: userId,
              email: user?.email || '',
              active_note_id: this.lastPresenceNoteId,
              is_typing: this.lastPresenceTyping,
              online_at: new Date().toISOString(),
            });
            this.dispatchRealtimeEvent('connected', spaceId);
          } catch (err) {
            console.error('[Collab] Failed to track presence after subscribe:', err);
            this.scheduleRealtimeReconnect(spaceId);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.dispatchRealtimeEvent('disconnected', spaceId);
          console.warn('[Collab] Realtime channel status:', status);
          this.scheduleRealtimeReconnect(spaceId);
        }
      });
  }

  unsubscribeFromSpace() {
    if (this.realtimeChannel) {
      // Clean up our presence entry before destroying the channel
      // to prevent ghost avatar lingering.
      try {
        this.realtimeChannel.untrack();
      } catch { /* best-effort */ }
      this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }
    // NOTE: we intentionally do NOT clear _activeSpaceId here.
    // The space ID is metadata about which space this vault is linked to,
    // and must persist across channel reconnections. Clearing it breaks
    // all guards in LeafPaneEditor that check `collaborationEngine.activeSpaceId`.
    this.notifyActiveUsers([]);
  }

  /**
   * Explicitly clear the active space context. Call this only when
   * the vault is actually being switched or the app is unmounting.
   */
  clearActiveSpace() {
    this.clearRealtimeReconnect();
    this.unsubscribeFromSpace();
    this._activeSpaceId = null;
    this.activeSpaceVisibility = null;
  }

  private ensureRealtimeConnected() {
    if (this._collabPaused) return;
    if (!this._activeSpaceId) return;
    if (this.activeSpaceVisibility === 'private') return;
    if (!authManager.getUserId()) return;

    const state = this.realtimeChannel ? (this.realtimeChannel as any).state : null;
    if (state === 'joined' || state === 'joining') return;
    this.scheduleRealtimeReconnect(this._activeSpaceId, 0);
  }

  private scheduleRealtimeReconnect(spaceId: string, overrideDelay?: number) {
    if (this._collabPaused) return;
    if (!authManager.getUserId()) return;
    if (this.realtimeReconnectTimer && this.reconnectingSpaceId === spaceId) return;

    this.reconnectingSpaceId = spaceId;
    const delay = overrideDelay ?? Math.min(30_000, 1_000 * Math.pow(2, this.realtimeReconnectAttempt));
    this.realtimeReconnectAttempt += 1;

    this.realtimeReconnectTimer = setTimeout(() => {
      this.realtimeReconnectTimer = null;
      if (this._activeSpaceId !== spaceId || this._collabPaused) return;
      this.subscribeToSpace(spaceId).catch((err) => {
        console.error('[Collab] Realtime reconnect failed:', err);
        this.scheduleRealtimeReconnect(spaceId);
      });
    }, delay);
  }

  private clearRealtimeReconnect() {
    if (this.realtimeReconnectTimer) {
      clearTimeout(this.realtimeReconnectTimer);
      this.realtimeReconnectTimer = null;
    }
    this.reconnectingSpaceId = null;
  }

  private dispatchRealtimeEvent(type: 'connected' | 'disconnected', spaceId: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('collaboration:realtime', {
      detail: { type, spaceId },
    }));
  }

  private enqueueIncomingOperations(path: string, ops: CollabOperation[]) {
    const queue = this.incomingOperationQueues.get(path) || [];
    queue.push(...ops);
    queue.sort((a, b) => {
      const versionDelta = normalizeVersion(a.version) - normalizeVersion(b.version);
      if (versionDelta !== 0) return versionDelta;
      return a.timestamp - b.timestamp;
    });
    this.incomingOperationQueues.set(path, queue);

    if (this.incomingOperationTimers.has(path)) return;
    const timer = setTimeout(() => {
      this.incomingOperationTimers.delete(path);
      const pending = this.incomingOperationQueues.get(path) || [];
      this.incomingOperationQueues.delete(path);
      if (pending.length === 0) return;
      this.remoteOpListeners.forEach(fn => fn(path, pending));
    }, 0);
    this.incomingOperationTimers.set(path, timer);
  }

  markOperationApplied(operationId: string) {
    if (!operationId) return;
    this.appliedOperationIds.add(operationId);
    if (this.appliedOperationIds.size > 5000) {
      const recent = [...this.appliedOperationIds].slice(-2500);
      this.appliedOperationIds = new Set(recent);
    }
  }

  async triggerSafeResync(path: string, localVersion: number): Promise<void> {
    const spaceId = this._activeSpaceId;
    if (!spaceId) return;

    const cleanPath = normalizeSyncPath(path);
    if (!cleanPath) return;

    console.warn('[Collab][resync_triggered]', { path: cleanPath, localVersion, spaceId });
    const client = getClient();
    const { data: remote, error } = await client
      .from('notes')
      .select('id, space_id, vault_id, last_client_id, version, last_modified, client_id, content_hash, title, path, content, pinned, created_at, updated_at, deleted, is_canvas')
      .eq('space_id', spaceId)
      .eq('path', cleanPath)
      .maybeSingle();

    if (error) {
      console.warn('[Collab][resync_failed]', { path: cleanPath, message: error.message });
      return;
    }
    if (!remote) return;

    const remoteVersion = normalizeVersion((remote as any).version);
    if (remoteVersion <= localVersion) {
      console.info('[Collab][resync_kept_local]', { path: cleanPath, localVersion, remoteVersion });
      return;
    }
    const remoteHash = (remote as any).content_hash || await sha256Hex(remote.content || '');

    await localDB.putNote({
      id: remote.id,
      space_id: remote.space_id,
      vault_id: remote.vault_id || null,
      last_client_id: remote.last_client_id || null,
      version: remoteVersion,
      last_modified: (remote as any).last_modified || remote.updated_at,
      client_id: (remote as any).client_id || remote.last_client_id || null,
      content_hash: remoteHash,
      title: remote.title,
      path: cleanPath,
      content: remote.content || '',
      pinned: !!remote.pinned,
      created_at: remote.created_at,
      updated_at: remote.updated_at,
      deleted: !!remote.deleted,
      is_canvas: !!remote.is_canvas,
    }, false);

    if (cleanPath && !remote.deleted) {
      const api = getAPI();
      if (cleanPath.includes('/')) {
        const parentDir = cleanPath.split('/').slice(0, -1).join('/');
        try { await api.createDirectory(parentDir); } catch { /* exists */ }
      }
      await api.writeFile(cleanPath, remote.content || '');
    }

    this.remoteDocListeners.forEach(fn => fn(cleanPath, remote.content || '', (remote as any).client_id || remote.last_client_id || '', false, {
      version: remoteVersion,
      last_modified: (remote as any).last_modified || remote.updated_at,
      client_id: (remote as any).client_id || remote.last_client_id || null,
      content_hash: remoteHash,
    }));
  }

  private handlePresenceSync() {
    if (!this.realtimeChannel) return;
    if (this._collabPaused) {
      this.notifyActiveUsers([]);
      return;
    }

    const presenceState = this.realtimeChannel.presenceState();
    const currentUserId = authManager.getUserId();

    // Collect ALL presence entries, then deduplicate by user_id.
    // A single user can have multiple presence entries from reconnections,
    // multiple tabs, or presence key drift. Without deduplication this
    // causes the "10 avatars for 2 users" bug.
    const byUserId = new Map<string, any>();

    for (const [_key, presences] of Object.entries(presenceState)) {
      for (const p of presences as any[]) {
        if (!p.user_id) continue; // Skip entries without a user_id
        if (p.user_id === currentUserId) continue; // Skip self

        const existing = byUserId.get(p.user_id);
        if (!existing || (p.online_at && (!existing.online_at || p.online_at > existing.online_at))) {
          byUserId.set(p.user_id, p);
        }
      }
    }

    const users: ActiveUser[] = [];
    for (const p of byUserId.values()) {
      users.push({
        id: p.user_id,
        email: p.email || '',
        name: p.email?.split('@')[0] || '',
        color: getColorForUser(p.user_id),
        isEditing: !!p.is_typing,
        activeNoteId: p.active_note_id || null,
      });
    }

    this.notifyActiveUsers(users);
  }

  async updatePresenceNote(noteId: string | null, isTyping: boolean = false) {
    if (this._collabPaused) return;
    this.lastPresenceNoteId = noteId;
    this.lastPresenceTyping = isTyping;
    if (!this.realtimeChannel) {
      this.ensureRealtimeConnected();
      return;
    }
    const userId = authManager.getUserId();
    if (!userId) return;

    const user = authManager.getUser();
    try {
      await this.realtimeChannel.track({
        user_id: userId,
        email: user?.email || '',
        active_note_id: noteId,
        is_typing: isTyping,
        online_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[Collab] Presence update failed; reconnecting realtime channel:', err);
      if (this._activeSpaceId) this.scheduleRealtimeReconnect(this._activeSpaceId);
    }
  }

  private async handleRemoteNoteChange(payload: any) {
    if (this._collabPaused) return;
    // Skip self-echo
    if (payload.new?.last_client_id === this.clientId) return;

    const eventType = payload.eventType;
    const remoteNote = payload.new;

    if (!remoteNote) return;

    const cleanPath = normalizeSyncPath(remoteNote.path);
    if (!cleanPath) return;

    // Last-Write-Wins
    const localNote = await localDB.getNote(remoteNote.id);
    if (localNote) {
      const remoteVersion = normalizeVersion(remoteNote.version);
      const localVersion = normalizeVersion(localNote.version);
      if (remoteVersion > 0 || localVersion > 0) {
        if (remoteVersion <= localVersion) {
          console.info('[Collab][overwrite_prevented]', {
            path: cleanPath,
            source: 'postgres_changes',
            remoteVersion,
            localVersion,
          });
          return;
        }
      } else {
        const remoteTime = new Date(remoteNote.updated_at).getTime();
        const localTime = new Date(localNote.updated_at).getTime();
        if (remoteTime <= localTime) return; // Local is newer, skip
      }
    }

    // Apply to IndexedDB (no sync enqueue -- this came from remote)
    await localDB.putNote({
      id: remoteNote.id,
      space_id: remoteNote.space_id,
      vault_id: remoteNote.vault_id || null,
      last_client_id: remoteNote.last_client_id || null,
      version: normalizeVersion(remoteNote.version),
      last_modified: remoteNote.last_modified || remoteNote.updated_at,
      client_id: remoteNote.client_id || remoteNote.last_client_id || null,
      content_hash: remoteNote.content_hash || await sha256Hex(remoteNote.content || ''),
      title: remoteNote.title,
      path: cleanPath,
      content: remoteNote.content || '',
      pinned: !!remoteNote.pinned,
      created_at: remoteNote.created_at,
      updated_at: remoteNote.updated_at,
      deleted: !!remoteNote.deleted,
      is_canvas: !!remoteNote.is_canvas,
    }, false);

    // Write to local filesystem if we have a path
    if (cleanPath && !remoteNote.deleted) {
      try {
        const api = getAPI();
        // Ensure parent directory exists
        if (cleanPath.includes('/')) {
          const parentDir = cleanPath.split('/').slice(0, -1).join('/');
          try { await api.createDirectory(parentDir); } catch { /* exists */ }
        }
        await api.writeFile(cleanPath, remoteNote.content || '');
      } catch (err) {
        console.error('[Collab] Failed to write remote change to disk:', err);
      }
    } else if (cleanPath && remoteNote.deleted) {
      try {
        const api = getAPI();
        await api.deleteFile(cleanPath);
      } catch {
        // File might not exist locally
      }
    }

    // Notify remote doc listeners so the editor can refresh the open file
    if (cleanPath && !remoteNote.deleted) {
      this.remoteDocListeners.forEach(fn => fn(cleanPath, remoteNote.content || '', remoteNote.client_id || remoteNote.last_client_id || '', false, {
        version: normalizeVersion(remoteNote.version),
        last_modified: remoteNote.last_modified || remoteNote.updated_at,
        client_id: remoteNote.client_id || remoteNote.last_client_id || null,
        content_hash: remoteNote.content_hash,
      }));
    }

    // Notify listeners (for editor refresh)
    this.changeListeners.forEach(fn => fn('notes', payload));
  }

  // ── Broadcast: Operation-Based Sync ──────────────────────────────────────

  /**
   * Internal state for operation batching. Instead of sending one broadcast
   * per keystroke (which overwhelms Supabase rate limits during fast typing),
   * we accumulate operations for up to 50ms and flush them in a single message.
   */
  private opBatchBuffer = new Map<string, CollabOperation[]>();
  private opBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly OP_BATCH_INTERVAL = 50; // ms

  /**
   * Internal state for cursor presence throttling. Cursor positions are
   * broadcast at most once per 100ms to avoid competing with ops for
   * channel bandwidth.
   */
  private cursorThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCursorPresence: CursorPresence | null = null;
  private lastCursorBroadcast = 0;
  private static readonly CURSOR_THROTTLE_MS = 100;

  /**
   * Broadcast granular editing operations to all connected peers.
   * Operations are batched in a 50ms window to reduce broadcast frequency.
   * This is ephemeral -- it does NOT write to the database.
   */
  broadcastOperations(path: string, ops: CollabOperation[]) {
    if (this._collabPaused) return;
    if (this.activeSpaceVisibility === 'private') return;
    if (ops.length === 0) return;
    if (!this.realtimeChannel || (this.realtimeChannel as any).state !== 'joined') {
      this.ensureRealtimeConnected();
      return;
    }

    const cleanPath = normalizeSyncPath(path);
    if (!cleanPath) return;

    // Accumulate ops for this path
    const existing = this.opBatchBuffer.get(cleanPath) || [];
    existing.push(...ops);
    this.opBatchBuffer.set(cleanPath, existing);

    // Schedule flush if not already pending
    if (!this.opBatchTimer) {
      this.opBatchTimer = setTimeout(() => this.flushOpBatch(), CollaborationEngine.OP_BATCH_INTERVAL);
    }
  }

  private flushOpBatch() {
    this.opBatchTimer = null;
    if (!this.realtimeChannel || (this.realtimeChannel as any).state !== 'joined' || this._collabPaused) {
      this.opBatchBuffer.clear();
      this.ensureRealtimeConnected();
      return;
    }

    for (const [path, ops] of this.opBatchBuffer) {
      if (ops.length === 0) continue;
      void this.realtimeChannel.send({
        type: 'broadcast',
        event: 'doc-ops',
        payload: {
          path,
          ops,
          clientId: this.clientId,
        },
      }).then((result: any) => {
        if (result !== 'ok') {
          console.warn('[Collab] doc-ops broadcast failed:', result);
          this.ensureRealtimeConnected();
        }
      }).catch((err: any) => {
        console.warn('[Collab] doc-ops broadcast error:', err);
        this.ensureRealtimeConnected();
      });
    }
    this.opBatchBuffer.clear();
  }

  /**
   * Broadcast the full document content to all connected peers.
   * Used as a fallback for large edits (paste, AI generation) where
   * granular operations may fail to apply cleanly on diverged documents.
   */
  async broadcastFullDocument(path: string, content: string, meta?: Partial<RemoteDocumentMeta>) {
    if (this._collabPaused) return;
    if (this.activeSpaceVisibility === 'private') return;
    if (!this.realtimeChannel || (this.realtimeChannel as any).state !== 'joined') {
      this.ensureRealtimeConnected();
      return;
    }

    const cleanPath = normalizeSyncPath(path);
    if (!cleanPath) return;

    // Clear any pending ops for this path -- the full doc supersedes them
    this.opBatchBuffer.delete(cleanPath);

    void this.realtimeChannel.send({
      type: 'broadcast',
      event: 'doc-full',
      payload: {
        path: cleanPath,
        content,
        version: normalizeVersion(meta?.version),
        last_modified: meta?.last_modified || new Date().toISOString(),
        client_id: meta?.client_id || this.clientId,
        content_hash: meta?.content_hash || await sha256Hex(content),
        clientId: this.clientId,
      },
    }).then((result: any) => {
      if (result !== 'ok') {
        console.warn('[Collab] doc-full broadcast failed:', result);
        this.ensureRealtimeConnected();
      }
    }).catch((err: any) => {
      console.warn('[Collab] doc-full broadcast error:', err);
      this.ensureRealtimeConnected();
    });
  }

  /**
   * Broadcast cursor position / selection to all connected peers.
   * Throttled to at most once per 100ms to avoid overwhelming the channel
   * during fast typing (when both ops and cursors compete for bandwidth).
   */
  broadcastCursorPresence(presence: CursorPresence) {
    if (this._collabPaused) return;
    if (this.activeSpaceVisibility === 'private') return;
    if (!this.realtimeChannel) {
      this.ensureRealtimeConnected();
      return;
    }

    this.pendingCursorPresence = presence;

    const now = Date.now();
    const elapsed = now - this.lastCursorBroadcast;

    if (elapsed >= CollaborationEngine.CURSOR_THROTTLE_MS) {
      // Enough time has passed -- send immediately
      this.sendCursorPresence();
    } else if (!this.cursorThrottleTimer) {
      // Schedule for later
      this.cursorThrottleTimer = setTimeout(
        () => this.sendCursorPresence(),
        CollaborationEngine.CURSOR_THROTTLE_MS - elapsed,
      );
    }
    // else: already scheduled, the latest position will be sent when timer fires
  }

  private sendCursorPresence() {
    this.cursorThrottleTimer = null;
    if (!this.pendingCursorPresence || !this.realtimeChannel || (this.realtimeChannel as any).state !== 'joined' || this._collabPaused) {
      this.ensureRealtimeConnected();
      return;
    }

    void this.realtimeChannel.send({
      type: 'broadcast',
      event: 'cursor-presence',
      payload: this.pendingCursorPresence,
    }).then((result: any) => {
      if (result !== 'ok') {
        console.warn('[Collab] cursor broadcast failed:', result);
        this.ensureRealtimeConnected();
      }
    }).catch((err: any) => {
      console.warn('[Collab] cursor broadcast error:', err);
      this.ensureRealtimeConnected();
    });
    this.lastCursorBroadcast = Date.now();
    this.pendingCursorPresence = null;
  }

  /**
   * Persist a local note edit to IndexedDB and enqueue it for sync to Supabase.
   * This is the bridge between "user typed in the editor" and "the edit lands
   * in the cloud notes table". Without this, edits only live on local disk.
   *
   * Debounce this externally -- it does DB I/O on every call.
   */
  async persistNoteEdit(path: string, content: string, meta?: Partial<RemoteDocumentMeta>): Promise<void> {
    if (this._collabPaused) return;
    const spaceId = this._activeSpaceId;
    if (!spaceId) return;

    const cleanPath = normalizeSyncPath(path);
    if (!cleanPath) return;

    const now = new Date().toISOString();
    const version = meta?.version !== undefined ? normalizeVersion(meta.version) : undefined;
    const contentHash = meta?.content_hash || await sha256Hex(content);
    const title = cleanPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || cleanPath;
    const isCanvas = cleanPath.endsWith('.canvas');

    try {
      // Look up existing note record by path
      let note = await localDB.getNoteByPath(spaceId, cleanPath);

      if (note) {
        // Update existing note
        note.content = content;
        note.updated_at = now;
        if (version !== undefined) note.version = version;
        note.last_modified = meta?.last_modified || now;
        note.client_id = meta?.client_id || this.clientId;
        note.content_hash = contentHash;
        note.path = cleanPath;
        await localDB.putNote(note, true);
      } else {
        // Create a new note record (file was created locally)
        const newNote = {
          id: uuidv4(),
          space_id: spaceId,
          vault_id: null,
          last_client_id: null,
          version,
          last_modified: meta?.last_modified || now,
          client_id: meta?.client_id || this.clientId,
          content_hash: contentHash,
          title,
          path: cleanPath,
          content,
          pinned: false,
          created_at: now,
          updated_at: now,
          deleted: false,
          is_canvas: isCanvas,
        };
        await localDB.putNote(newNote, true);
      }
    } catch (err) {
      console.error('[Collab] persistNoteEdit failed:', err);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose() {
    // Clear batch/throttle timers
    if (this.opBatchTimer) { clearTimeout(this.opBatchTimer); this.opBatchTimer = null; }
    if (this.cursorThrottleTimer) { clearTimeout(this.cursorThrottleTimer); this.cursorThrottleTimer = null; }
    this.clearRealtimeReconnect();
    this.opBatchBuffer.clear();
    this.pendingCursorPresence = null;

    this.clearActiveSpace();
    this.listeners.clear();
    this.activeUsersListeners.clear();
    this.changeListeners.clear();
    this.remoteDocListeners.clear();
    this.remoteOpListeners.clear();
    this.remoteCursorListeners.clear();
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

export const collaborationEngine = new CollaborationEngine();
