/**
 * YjsTransport -- Handles sending/receiving Yjs binary updates and
 * awareness data over Supabase Realtime Broadcast.
 *
 * Responsibilities:
 *   - Channel management (subscribe, reconnect, cleanup)
 *   - Sending Yjs updates (with 50ms batching via Y.mergeUpdates)
 *   - Receiving Yjs updates from peers (applied via Y.applyUpdate)
 *   - State vector exchange on connection/reconnection
 *   - Awareness relay for cursor/presence
 *
 * Instrumentation: Every event logs with [YJS] prefix for full observability.
 */

import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { supabase } from './supabase';

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

export interface YjsTransportCallbacks {
  /** Called when a remote Yjs update arrives. The caller applies it to the Y.Doc. */
  onRemoteUpdate: (update: Uint8Array) => void;
  /** Encode a raw update for the wire. For encrypted spaces, encrypt here. */
  encodePayload: (update: Uint8Array, purpose: 'update' | 'sync') => Promise<string>;
  /** Decode a wire payload back to raw bytes. For encrypted spaces, decrypt here. */
  decodePayload: (encoded: string, purpose: 'update' | 'sync') => Promise<Uint8Array>;
}

// ── Transport ───────────────────────────────────────────────────────────────

export class YjsTransport {
  readonly awareness: Awareness;

  private readonly doc: Y.Doc;
  private readonly notePath: string;
  private readonly channelName: string;
  private readonly clientId: string;
  private readonly callbacks: YjsTransportCallbacks;

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

  constructor(
    doc: Y.Doc,
    notePath: string,
    channelName: string,
    clientId: string,
    callbacks: YjsTransportCallbacks,
  ) {
    this.doc = doc;
    this.notePath = notePath;
    this.channelName = channelName;
    this.clientId = clientId;
    this.callbacks = callbacks;
    this.awareness = new Awareness(doc);

    this.doc.on('update', this._onDocUpdate);
    this.awareness.on('update', this._onAwarenessUpdate);
  }

  // ── Public API ────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.destroyed) return;
    console.log(`[YJS] Transport connecting to channel ${this.channelName} for note: ${this.notePath}`);

    const channel = supabase.channel(this.channelName, {
      config: { broadcast: { self: false } },
    });

    this.channel = channel;

    channel
      .on('broadcast', { event: 'yjs-update' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.client_id === this.clientId || p.note_path !== this.notePath) return;
        console.log(`[YJS] Broadcast received (update, ${p.data?.length || 0} chars) from client ${p.client_id}`);
        void this._handleRemoteUpdate(p);
      })
      .on('broadcast', { event: 'yjs-awareness' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.client_id === this.clientId || p.note_path !== this.notePath) return;
        this._handleRemoteAwareness(p);
      })
      .on('broadcast', { event: 'yjs-sync-step1' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.client_id === this.clientId || p.note_path !== this.notePath) return;
        console.log(`[YJS] Broadcast received (sync-step1) from client ${p.client_id}`);
        void this._handleSyncStep1(p);
      })
      .on('broadcast', { event: 'yjs-sync-step2' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.target_client_id !== this.clientId || p.note_path !== this.notePath) return;
        console.log(`[YJS] Broadcast received (sync-step2) from client ${p.client_id}`);
        void this._handleSyncStep2(p);
      })
      .on('broadcast', { event: 'yjs-snapshot-request' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.client_id === this.clientId || p.note_path !== this.notePath) return;
        void this._handleSnapshotRequest(p);
      })
      .on('broadcast', { event: 'yjs-snapshot-response' }, (msg) => {
        if (this.destroyed) return;
        const p = msg.payload;
        if (!p || p.target_client_id !== this.clientId || p.note_path !== this.notePath) return;
        void this._handleSnapshotResponse(p);
      })
      .subscribe(async (status) => {
        if (this.destroyed || this.channel !== channel) return;
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          console.log(`[YJS] Subscribed to channel ${this.channelName}`);
          this._sendSyncStep1();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.connected = false;
          console.warn(`[YJS] Channel subscription error (${status}) for ${this.notePath}`);
        } else if (status === 'CLOSED') {
          this.connected = false;
          console.log(`[YJS] Channel closed cleanly for ${this.notePath}`);
        }
      });
  }

  disconnect(): void {
    console.log(`[YJS] Transport disconnecting for ${this.notePath}`);
    this.destroyed = true;
    this.connected = false;

    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.awarenessThrottleTimer) { clearTimeout(this.awarenessThrottleTimer); this.awarenessThrottleTimer = null; }

    // Flush remaining updates before disconnect
    this._flushSync();

    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'disconnect');

    if (this.channel) {
      try { supabase.removeChannel(this.channel); } catch { /* best-effort */ }
      this.channel = null;
    }

    this.pendingUpdates = [];
    this.pendingAwarenessUpdate = null;
  }

  requestSnapshot(): void {
    if (!this.channel || !this.connected || this.destroyed) return;
    console.log(`[YJS] Requesting snapshot for ${this.notePath}`);
    this.channel.send({
      type: 'broadcast',
      event: 'yjs-snapshot-request',
      payload: { note_path: this.notePath, client_id: this.clientId },
    }).catch(err => console.warn('[YJS] Snapshot request failed:', err));
  }

  get isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  // ── Local update handling ─────────────────────────────────────────────

  private _onDocUpdate = (update: Uint8Array, origin: any): void => {
    if (origin === 'remote' || this.destroyed) return;
    console.log(`[YJS] Local update detected (${update.byteLength} bytes)`);
    this.pendingUpdates.push(update);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this._flush(), YjsTransport.BATCH_INTERVAL_MS);
    }
  };

  private async _flush(): Promise<void> {
    this.flushTimer = null;
    if (this.pendingUpdates.length === 0 || !this.channel || !this.connected || this.destroyed) return;

    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    console.log(`[YJS] Merged update (${merged.byteLength} bytes)`);

    try {
      const encoded = await this.callbacks.encodePayload(merged, 'update');
      await this.channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: {
          note_path: this.notePath,
          data: encoded,
          client_id: this.clientId,
          timestamp: Date.now(),
        },
      });
      console.log(`[YJS] Broadcast sent (${merged.byteLength} bytes merged update)`);
    } catch (err) {
      console.warn('[YJS] Broadcast update failed:', err);
    }
  }

  private _flushSync(): void {
    if (this.pendingUpdates.length === 0 || !this.channel || !this.connected) return;
    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    void this.callbacks.encodePayload(merged, 'update').then(encoded => {
      this.channel?.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: {
          note_path: this.notePath,
          data: encoded,
          client_id: this.clientId,
          timestamp: Date.now(),
        },
      }).catch(() => { /* best-effort on disconnect */ });
    }).catch(() => { /* best-effort */ });
  }

  // ── Remote update handling ────────────────────────────────────────────

  private async _handleRemoteUpdate(payload: any): Promise<void> {
    try {
      const update = await this.callbacks.decodePayload(payload.data, 'update');
      this.callbacks.onRemoteUpdate(update);
      console.log(`[YJS] Applied update (${update.byteLength} bytes) from client ${payload.client_id}`);
    } catch (err) {
      console.warn('[YJS] Failed to apply remote update:', err);
    }
  }

  // ── State vector exchange ─────────────────────────────────────────────

  private _sendSyncStep1(): void {
    if (!this.channel || !this.connected || this.destroyed) return;
    const sv = Y.encodeStateVector(this.doc);
    console.log(`[YJS] Reconnect - sending sync-step1 with state vector (${sv.byteLength} bytes)`);
    this.channel.send({
      type: 'broadcast',
      event: 'yjs-sync-step1',
      payload: {
        note_path: this.notePath,
        state_vector: bytesToBase64(sv),
        client_id: this.clientId,
      },
    }).catch(err => console.warn('[YJS] sync-step1 failed:', err));
  }

  private async _handleSyncStep1(payload: any): Promise<void> {
    if (!this.channel || !this.connected || this.destroyed) return;
    try {
      const remoteSv = base64ToBytes(payload.state_vector);
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      const mySv = Y.encodeStateVector(this.doc);
      const encoded = await this.callbacks.encodePayload(update, 'sync');

      console.log(`[YJS] Handling sync-step1 from ${payload.client_id}, sending sync-step2 (${update.byteLength} bytes diff)`);
      this.channel.send({
        type: 'broadcast',
        event: 'yjs-sync-step2',
        payload: {
          note_path: this.notePath,
          data: encoded,
          state_vector: bytesToBase64(mySv),
          client_id: this.clientId,
          target_client_id: payload.client_id,
        },
      }).catch(err => console.warn('[YJS] sync-step2 failed:', err));
    } catch (err) {
      console.warn('[YJS] Failed to handle sync-step1:', err);
    }
  }

  private async _handleSyncStep2(payload: any): Promise<void> {
    try {
      const update = await this.callbacks.decodePayload(payload.data, 'sync');
      Y.applyUpdate(this.doc, update, 'remote');
      console.log(`[YJS] State vector exchange complete - applied ${update.byteLength} bytes diff from peer`);

      // Send back our own diff so the responder also gets our updates
      if (payload.state_vector) {
        const remoteSv = base64ToBytes(payload.state_vector);
        const ourDiff = Y.encodeStateAsUpdate(this.doc, remoteSv);
        if (ourDiff.length > 2) {
          const encoded = await this.callbacks.encodePayload(ourDiff, 'update');
          this.channel?.send({
            type: 'broadcast',
            event: 'yjs-update',
            payload: {
              note_path: this.notePath,
              data: encoded,
              client_id: this.clientId,
              timestamp: Date.now(),
            },
          }).catch(() => { /* best-effort */ });
        }
      }
    } catch (err) {
      console.warn('[YJS] Failed to handle sync-step2:', err);
    }
  }

  // ── Snapshot ───────────────────────────────────────────────────────────

  private async _handleSnapshotRequest(payload: any): Promise<void> {
    if (!this.channel || !this.connected || this.destroyed) return;
    try {
      const fullState = Y.encodeStateAsUpdate(this.doc);
      const encoded = await this.callbacks.encodePayload(fullState, 'sync');
      console.log(`[YJS] Responding to snapshot request from ${payload.client_id} (${fullState.byteLength} bytes)`);
      this.channel.send({
        type: 'broadcast',
        event: 'yjs-snapshot-response',
        payload: {
          note_path: this.notePath,
          data: encoded,
          client_id: this.clientId,
          target_client_id: payload.client_id,
        },
      }).catch(err => console.warn('[YJS] Snapshot response failed:', err));
    } catch (err) {
      console.warn('[YJS] Failed to handle snapshot request:', err);
    }
  }

  private async _handleSnapshotResponse(payload: any): Promise<void> {
    try {
      const state = await this.callbacks.decodePayload(payload.data, 'sync');
      Y.applyUpdate(this.doc, state, 'remote');
      console.log(`[YJS] Snapshot applied (${state.byteLength} bytes) from ${payload.client_id}`);
    } catch (err) {
      console.warn('[YJS] Failed to handle snapshot response:', err);
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

    if (elapsed >= YjsTransport.AWARENESS_THROTTLE_MS) {
      this._sendAwareness();
    } else if (!this.awarenessThrottleTimer) {
      this.awarenessThrottleTimer = setTimeout(
        () => this._sendAwareness(),
        YjsTransport.AWARENESS_THROTTLE_MS - elapsed,
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
    }).catch(err => console.warn('[YJS] Awareness broadcast failed:', err));
  }

  private _handleRemoteAwareness(payload: any): void {
    try {
      const update = base64ToBytes(payload.update);
      applyAwarenessUpdate(this.awareness, update, 'remote');
    } catch (err) {
      console.warn('[YJS] Failed to apply remote awareness:', err);
    }
  }
}
