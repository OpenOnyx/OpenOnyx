/**
 * SupabaseProvider -- Custom Yjs provider that syncs Y.Doc updates
 * over Supabase Realtime Broadcast channels.
 *
 * Responsibilities:
 *   - Listen for local Y.Doc updates and broadcast them to peers
 *   - Receive remote updates and apply them to the local Y.Doc
 *   - Exchange state vectors on connect/reconnect to catch up on missed updates
 *   - Encrypt/decrypt updates for private spaces
 *   - Relay Awareness (cursor presence) updates
 *   - Debounced snapshot persistence to Supabase `notes` table
 *   - Debounced filesystem writes
 *
 * This provider does NOT use y-websocket. It communicates exclusively
 * through Supabase Realtime Broadcast, reusing the same channel
 * infrastructure that collaborationEngine already manages.
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { supabase } from './supabase';
import { authManager } from './auth';
import { localDB } from './localdb';
import { isPrivateCloudSpace, privateCrypto } from './privateCrypto';
import { getAPI } from '../utils/api';
import { normalizeSyncPath } from './syncEngine';
import { sha256Hex, getYDocContent } from '../utils/collabDocument';
import { v4 as uuidv4 } from 'uuid';

// ── Base64 helpers ──────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface SupabaseProviderOptions {
  /** Space ID this note belongs to. */
  spaceId: string;
  /** Relative note path within the vault (e.g., "Kavitae/Ye ya Voh.md"). */
  notePath: string;
  /** Stable client identifier for self-echo suppression. */
  clientId: string;
  /** User info for awareness state. */
  user: {
    id: string;
    name: string;
    email: string;
    color: string;
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

export class SupabaseProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private readonly spaceId: string;
  private readonly notePath: string;
  private readonly clientId: string;
  private readonly user: SupabaseProviderOptions['user'];

  private channel: ReturnType<typeof supabase.channel> | null = null;
  private destroyed = false;
  private connected = false;

  // ── Update batching ───────────────────────────────────────────────────
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BATCH_INTERVAL_MS = 50;

  // ── Awareness throttling ──────────────────────────────────────────────
  private pendingAwarenessUpdate: Uint8Array | null = null;
  private awarenessThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAwarenessBroadcast = 0;
  private static readonly AWARENESS_THROTTLE_MS = 100;

  // ── Snapshot persistence ──────────────────────────────────────────────
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SNAPSHOT_DEBOUNCE_MS = 3000;

  // ── Filesystem write ──────────────────────────────────────────────────
  private fsWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FS_WRITE_DEBOUNCE_MS = 500;

  // ── Encryption cache ──────────────────────────────────────────────────
  private isPrivate: boolean | null = null;

  constructor(doc: Y.Doc, options: SupabaseProviderOptions) {
    this.doc = doc;
    this.spaceId = options.spaceId;
    this.notePath = options.notePath;
    this.clientId = options.clientId;
    this.user = options.user;

    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField('user', this.user);

    // Bind event handlers
    this.doc.on('update', this._onDocUpdate);
    this.awareness.on('update', this._onAwarenessUpdate);
  }

  // ── Public API ────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.destroyed) return;

    // Resolve encryption status
    this.isPrivate = await this._checkPrivate();

    const channelName = `yjs:${this.spaceId}`;
    console.log(`[YJS] Provider connecting to channel ${channelName} for note: ${this.notePath} (guid: ${this.doc.guid}, isPrivate=${this.isPrivate})`);

    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
      },
    });

    this.channel = channel;

    channel
      .on('broadcast', { event: 'yjs-update' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload || payload.client_id === this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        console.log(`[YJS] Received update from client ${payload.client_id} for ${this.notePath}`);
        void this._handleRemoteUpdate(payload);
      })
      .on('broadcast', { event: 'yjs-awareness' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload || payload.client_id === this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        this._handleRemoteAwareness(payload);
      })
      .on('broadcast', { event: 'yjs-sync-step1' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload || payload.client_id === this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        console.log(`[YJS] Received sync-step1 from client ${payload.client_id}`);
        void this._handleSyncStep1(payload);
      })
      .on('broadcast', { event: 'yjs-sync-step2' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload) return;
        if (payload.target_client_id !== this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        console.log(`[YJS] Received sync-step2 from client ${payload.client_id}`);
        void this._handleSyncStep2(payload);
      })
      .on('broadcast', { event: 'yjs-snapshot-request' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload || payload.client_id === this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        void this._handleSnapshotRequest(payload);
      })
      .on('broadcast', { event: 'yjs-snapshot-response' }, (msg) => {
        if (this.destroyed) return;
        const payload = msg.payload;
        if (!payload) return;
        if (payload.target_client_id !== this.clientId) return;
        if (payload.note_path !== this.notePath) return;
        void this._handleSnapshotResponse(payload);
      })
      .subscribe(async (status) => {
        if (this.destroyed || this.channel !== channel) return;

        console.log(`[YJS] Provider channel status: ${status} for ${this.notePath}`);

        if (status === 'SUBSCRIBED') {
          this.connected = true;
          console.log(`[YJS] Provider subscribed successfully for ${this.notePath}, sending sync-step1`);
          // Request missing updates from peers via state vector exchange
          this._sendSyncStep1();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.connected = false;
          console.warn(`[YJS] Provider channel failed: ${status} for ${this.notePath}`);
        }
      });
  }

  disconnect(): void {
    this.destroyed = true;
    this.connected = false;

    // Clear timers
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.awarenessThrottleTimer) { clearTimeout(this.awarenessThrottleTimer); this.awarenessThrottleTimer = null; }
    if (this.snapshotTimer) { clearTimeout(this.snapshotTimer); this.snapshotTimer = null; }
    if (this.fsWriteTimer) { clearTimeout(this.fsWriteTimer); this.fsWriteTimer = null; }

    // Flush any remaining pending updates synchronously before disconnecting
    this._flushSync();

    // Clean up event handlers
    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);

    // Remove awareness state for this client so other peers see us leave
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'disconnect');

    // Remove channel
    if (this.channel) {
      try { supabase.removeChannel(this.channel); } catch { /* best-effort */ }
      this.channel = null;
    }

    this.pendingUpdates = [];
    this.pendingAwarenessUpdate = null;
  }

  /**
   * Returns true if the provider is currently connected to the channel.
   */
  get isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  // ── Local update handling ─────────────────────────────────────────────

  private _onDocUpdate = (update: Uint8Array, origin: any): void => {
    if (origin === 'remote' || this.destroyed) return;

    this.pendingUpdates.push(update);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this._flush();
      }, SupabaseProvider.BATCH_INTERVAL_MS);
    }

    // Schedule filesystem write and snapshot persistence
    this._scheduleFilesystemWrite();
    this._scheduleSnapshotPersist();
  };

  private async _flush(): Promise<void> {
    this.flushTimer = null;
    if (this.pendingUpdates.length === 0 || !this.channel || !this.connected || this.destroyed) return;

    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];

    try {
      const payload = await this._encodeUpdate(merged);
      await this.channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload,
      });
      console.log(`[YJS] Broadcast sent (${merged.byteLength} bytes) for ${this.notePath}`);
    } catch (err) {
      console.warn('[YJS] Failed to broadcast update:', err);
    }
  }

  /**
   * Synchronous flush for disconnect -- sends remaining updates immediately.
   */
  private _flushSync(): void {
    if (this.pendingUpdates.length === 0 || !this.channel || !this.connected) return;
    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];

    // Fire-and-forget since we're disconnecting
    void this._encodeUpdate(merged).then(payload => {
      this.channel?.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload,
      }).catch(() => { /* best-effort */ });
    }).catch(() => { /* best-effort */ });
  }

  // ── Remote update handling ────────────────────────────────────────────

  private async _handleRemoteUpdate(payload: any): Promise<void> {
    try {
      const update = await this._decodeUpdate(payload);
      Y.applyUpdate(this.doc, update, 'remote');
      // Persist remote edits to local filesystem and IndexedDB.
      // _onDocUpdate skips origin='remote' (to avoid re-broadcasting),
      // so we must explicitly schedule persistence here.
      this._scheduleFilesystemWrite();
      this._scheduleSnapshotPersist();
    } catch (err) {
      console.warn('[YjsProvider] Failed to apply remote update:', err);
    }
  }

  // ── State vector exchange ─────────────────────────────────────────────

  private _sendSyncStep1(): void {
    if (!this.channel || !this.connected || this.destroyed) return;

    const sv = Y.encodeStateVector(this.doc);
    this.channel.send({
      type: 'broadcast',
      event: 'yjs-sync-step1',
      payload: {
        note_path: this.notePath,
        state_vector: bytesToBase64(sv),
        client_id: this.clientId,
      },
    }).catch(err => {
      console.warn('[YjsProvider] Failed to send sync-step1:', err);
    });
  }

  private async _handleSyncStep1(payload: any): Promise<void> {
    if (!this.channel || !this.connected || this.destroyed) return;

    try {
      const remoteSv = base64ToBytes(payload.state_vector);
      // Compute the diff: updates the requester is missing
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      const mySv = Y.encodeStateVector(this.doc);

      const encodedUpdate = await this._encodeUpdateRaw(update);

      this.channel.send({
        type: 'broadcast',
        event: 'yjs-sync-step2',
        payload: {
          note_path: this.notePath,
          update: encodedUpdate,
          state_vector: bytesToBase64(mySv),
          client_id: this.clientId,
          target_client_id: payload.client_id,
        },
      }).catch(err => {
        console.warn('[YjsProvider] Failed to send sync-step2:', err);
      });
    } catch (err) {
      console.warn('[YjsProvider] Failed to handle sync-step1:', err);
    }
  }

  private async _handleSyncStep2(payload: any): Promise<void> {
    try {
      const update = await this._decodeUpdateRaw(payload.update);
      Y.applyUpdate(this.doc, update, 'remote');
      this._scheduleFilesystemWrite();
      this._scheduleSnapshotPersist();

      // After applying their updates, send back our own state vector diff
      // so the responder also gets any updates we have that they don't.
      if (payload.state_vector) {
        const remoteSv = base64ToBytes(payload.state_vector);
        const ourDiff = Y.encodeStateAsUpdate(this.doc, remoteSv);
        if (ourDiff.length > 2) { // Non-empty update (empty updates are 2 bytes)
          const encodedDiff = await this._encodeUpdate(ourDiff);
          this.channel?.send({
            type: 'broadcast',
            event: 'yjs-update',
            payload: encodedDiff,
          }).catch(() => { /* best-effort */ });
        }
      }
    } catch (err) {
      console.warn('[YjsProvider] Failed to handle sync-step2:', err);
    }
  }

  // ── Snapshot request/response (cold start) ────────────────────────────

  /**
   * Request full Y.Doc state from peers. Used when the local doc is empty
   * (new device, cleared IndexedDB, etc.).
   */
  requestSnapshot(): void {
    if (!this.channel || !this.connected || this.destroyed) return;
    this.channel.send({
      type: 'broadcast',
      event: 'yjs-snapshot-request',
      payload: {
        note_path: this.notePath,
        client_id: this.clientId,
      },
    }).catch(err => {
      console.warn('[YjsProvider] Failed to send snapshot request:', err);
    });
  }

  private async _handleSnapshotRequest(payload: any): Promise<void> {
    if (!this.channel || !this.connected || this.destroyed) return;

    try {
      const fullState = Y.encodeStateAsUpdate(this.doc);
      const encoded = await this._encodeUpdateRaw(fullState);

      this.channel.send({
        type: 'broadcast',
        event: 'yjs-snapshot-response',
        payload: {
          note_path: this.notePath,
          state: encoded,
          client_id: this.clientId,
          target_client_id: payload.client_id,
        },
      }).catch(err => {
        console.warn('[YjsProvider] Failed to send snapshot response:', err);
      });
    } catch (err) {
      console.warn('[YjsProvider] Failed to handle snapshot request:', err);
    }
  }

  private async _handleSnapshotResponse(payload: any): Promise<void> {
    try {
      const state = await this._decodeUpdateRaw(payload.state);
      Y.applyUpdate(this.doc, state, 'remote');
      this._scheduleFilesystemWrite();
      this._scheduleSnapshotPersist();
    } catch (err) {
      console.warn('[YjsProvider] Failed to handle snapshot response:', err);
    }
  }

  // ── Awareness ─────────────────────────────────────────────────────────

  private _onAwarenessUpdate = ({ added, updated, removed }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    if (this.destroyed || !this.channel || !this.connected) return;

    const changedClients = [...added, ...updated, ...removed];
    const update = encodeAwarenessUpdate(this.awareness, changedClients);
    this.pendingAwarenessUpdate = update;

    const now = Date.now();
    const elapsed = now - this.lastAwarenessBroadcast;

    if (elapsed >= SupabaseProvider.AWARENESS_THROTTLE_MS) {
      this._sendAwareness();
    } else if (!this.awarenessThrottleTimer) {
      this.awarenessThrottleTimer = setTimeout(
        () => this._sendAwareness(),
        SupabaseProvider.AWARENESS_THROTTLE_MS - elapsed,
      );
    }
  };

  private _sendAwareness(): void {
    this.awarenessThrottleTimer = null;
    if (!this.pendingAwarenessUpdate || !this.channel || !this.connected || this.destroyed) return;

    const update = this.pendingAwarenessUpdate;
    this.pendingAwarenessUpdate = null;
    this.lastAwarenessBroadcast = Date.now();

    this.channel.send({
      type: 'broadcast',
      event: 'yjs-awareness',
      payload: {
        note_path: this.notePath,
        update: bytesToBase64(update),
        client_id: this.clientId,
      },
    }).catch(err => {
      console.warn('[YjsProvider] Failed to broadcast awareness:', err);
    });
  }

  private _handleRemoteAwareness(payload: any): void {
    try {
      const update = base64ToBytes(payload.update);
      applyAwarenessUpdate(this.awareness, update, 'remote');
    } catch (err) {
      console.warn('[YjsProvider] Failed to apply remote awareness:', err);
    }
  }

  // ── Encryption helpers ────────────────────────────────────────────────

  private async _checkPrivate(): Promise<boolean> {
    try {
      const space = await localDB.getSpace(this.spaceId);
      if (space) return isPrivateCloudSpace(space);
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Encode a Yjs update into the broadcast payload format.
   * For private spaces, encrypts the binary update.
   */
  private async _encodeUpdate(update: Uint8Array): Promise<any> {
    if (this.isPrivate && privateCrypto.isUnlocked(this.spaceId)) {
      const encrypted = await privateCrypto.encryptRawBytes(
        this.spaceId,
        update,
        `yjs-update:${this.spaceId}:${this.notePath}`,
      );
      return {
        type: 'encrypted',
        note_path: this.notePath,
        encrypted_payload: encrypted.encrypted_payload,
        iv: encrypted.iv,
        auth_tag: encrypted.auth_tag,
        client_id: this.clientId,
        timestamp: Date.now(),
      };
    }

    return {
      note_path: this.notePath,
      update: bytesToBase64(update),
      client_id: this.clientId,
      timestamp: Date.now(),
    };
  }

  /**
   * Encode a raw update to base64 or encrypted base64, for sync-step2 / snapshot payloads.
   */
  private async _encodeUpdateRaw(update: Uint8Array): Promise<string> {
    if (this.isPrivate && privateCrypto.isUnlocked(this.spaceId)) {
      const encrypted = await privateCrypto.encryptRawBytes(
        this.spaceId,
        update,
        `yjs-sync:${this.spaceId}:${this.notePath}`,
      );
      return JSON.stringify({
        type: 'encrypted',
        encrypted_payload: encrypted.encrypted_payload,
        iv: encrypted.iv,
        auth_tag: encrypted.auth_tag,
      });
    }
    return bytesToBase64(update);
  }

  /**
   * Decode a Yjs update from the broadcast payload format.
   */
  private async _decodeUpdate(payload: any): Promise<Uint8Array> {
    if (payload.type === 'encrypted') {
      return privateCrypto.decryptRawBytes(
        this.spaceId,
        {
          encrypted_payload: payload.encrypted_payload,
          iv: payload.iv,
          auth_tag: payload.auth_tag,
        },
        `yjs-update:${this.spaceId}:${this.notePath}`,
      );
    }
    return base64ToBytes(payload.update);
  }

  /**
   * Decode a raw update from base64 or encrypted base64 string.
   */
  private async _decodeUpdateRaw(encoded: string): Promise<Uint8Array> {
    // Try to parse as JSON (encrypted format)
    try {
      const parsed = JSON.parse(encoded);
      if (parsed.type === 'encrypted') {
        return privateCrypto.decryptRawBytes(
          this.spaceId,
          {
            encrypted_payload: parsed.encrypted_payload,
            iv: parsed.iv,
            auth_tag: parsed.auth_tag,
          },
          `yjs-sync:${this.spaceId}:${this.notePath}`,
        );
      }
    } catch {
      // Not JSON -- treat as base64
    }
    return base64ToBytes(encoded);
  }

  // ── Filesystem write (debounced) ──────────────────────────────────────

  private _scheduleFilesystemWrite(): void {
    if (this.fsWriteTimer) clearTimeout(this.fsWriteTimer);
    this.fsWriteTimer = setTimeout(() => {
      this.fsWriteTimer = null;
      void this._writeToFilesystem();
    }, SupabaseProvider.FS_WRITE_DEBOUNCE_MS);
  }

  private async _writeToFilesystem(): Promise<void> {
    if (this.destroyed) return;
    try {
      const cleanPath = normalizeSyncPath(this.notePath);
      if (!cleanPath) return;
      const isCanvas = cleanPath.toLowerCase().endsWith('.canvas');
      let content = getYDocContent(this.doc, isCanvas);
      const api = getAPI();

      if (isCanvas && content) {
        try {
          const existingRaw = await api.readFile(cleanPath);
          if (existingRaw) {
            const existingParsed = JSON.parse(existingRaw);
            if (existingParsed.openonyxCanvasViewportV1) {
              const remoteParsed = JSON.parse(content);
              remoteParsed.openonyxCanvasViewportV1 = existingParsed.openonyxCanvasViewportV1;
              content = JSON.stringify(remoteParsed, null, 2);
            }
          }
        } catch {}
      }

      // Ensure parent directory exists
      if (cleanPath.includes('/')) {
        const parentDir = cleanPath.split('/').slice(0, -1).join('/');
        try { await api.createDirectory(parentDir); } catch { /* exists */ }
      }

      await api.writeFile(cleanPath, content);
    } catch (err) {
      console.warn('[YjsProvider] Filesystem write failed:', err);
    }
  }

  // ── Snapshot persistence (debounced) ──────────────────────────────────

  private _scheduleSnapshotPersist(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this._persistSnapshot();
    }, SupabaseProvider.SNAPSHOT_DEBOUNCE_MS);
  }

  private async _persistSnapshot(): Promise<void> {
    if (this.destroyed) return;
    try {
      const cleanPath = normalizeSyncPath(this.notePath);
      if (!cleanPath) return;
      const isCanvas = cleanPath.toLowerCase().endsWith('.canvas');
      const content = getYDocContent(this.doc, isCanvas);

      const contentHash = await sha256Hex(content);
      const title = cleanPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || cleanPath;
      const now = new Date().toISOString();

      // Look up existing note record
      let note = await localDB.getNoteByPath(this.spaceId, cleanPath);

      if (note) {
        note.content = content;
        note.updated_at = now;
        note.last_modified = now;
        note.client_id = this.clientId;
        note.content_hash = contentHash;
        note.version = (note.version || 0) + 1;
        await localDB.putNote(note, false); // false = store locally without enqueuing in sync_queue to avoid infinite sync storms
      } else {
        const newNote = {
          id: uuidv4(),
          space_id: this.spaceId,
          vault_id: null,
          last_client_id: null,
          version: 1,
          last_modified: now,
          client_id: this.clientId,
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
        await localDB.putNote(newNote, false);
      }
    } catch (err) {
      console.warn('[YjsProvider] Snapshot persistence failed:', err);
    }
  }
}
