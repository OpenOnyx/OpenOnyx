/**
 * YjsPersistence -- Handles debounced persistence of Y.Doc content to:
 *   - Local filesystem (.md files)
 *   - IndexedDB (via notes table for sync)
 *
 * Responsibilities:
 *   - Flushes Y.Text content to disk file at 500ms debounced intervals.
 *   - Flushes snapshot to IndexedDB and Supabase notes table at 3s debounced intervals.
 *   - Handles file existence check before writing.
 *
 * Instrumentation: Uses [YJS] prefix for full observability.
 */

import * as Y from 'yjs';
import { getAPI } from '../utils/api';
import { normalizeSyncPath } from './syncEngine';
import { localDB } from './localdb';
import { sha256Hex } from '../utils/collabDocument';
import { v4 as uuidv4 } from 'uuid';

export interface YjsPersistenceOptions {
  spaceId: string;
  notePath: string;
  clientId: string;
}

export class YjsPersistence {
  private readonly doc: Y.Doc;
  private readonly text: Y.Text;
  private readonly spaceId: string;
  private readonly notePath: string;
  private readonly clientId: string;
  private readonly cleanPath: string;

  private destroyed = false;

  // ── Filesystem write ──────────────────────────────────────────────────
  private fsWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFsWriteTime = 0;
  private static readonly FS_WRITE_DEBOUNCE_MS = 500;

  // ── Snapshot persistence ──────────────────────────────────────────────
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SNAPSHOT_DEBOUNCE_MS = 3000;

  constructor(doc: Y.Doc, options: YjsPersistenceOptions) {
    this.doc = doc;
    this.text = doc.getText('content');
    this.spaceId = options.spaceId;
    this.notePath = options.notePath;
    this.clientId = options.clientId;
    this.cleanPath = normalizeSyncPath(options.notePath) || options.notePath;

    this.doc.on('update', this._onDocUpdate);
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.off('update', this._onDocUpdate);

    // Flush any pending writes immediately
    if (this.fsWriteTimer) {
      clearTimeout(this.fsWriteTimer);
      this.fsWriteTimer = null;
      void this._writeToFilesystem();
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
      void this._persistSnapshot();
    }
  }

  // ── Event handler ─────────────────────────────────────────────────────

  private _onDocUpdate = (_update: Uint8Array, origin: any): void => {
    if (origin === 'remote' || this.destroyed) return;
    this._scheduleFilesystemWrite();
    this._scheduleSnapshotPersist();
  };

  // ── Filesystem write (debounced) ───────────────────────────────────────

  private _scheduleFilesystemWrite(): void {
    if (this.fsWriteTimer) clearTimeout(this.fsWriteTimer);
    this.fsWriteTimer = setTimeout(() => {
      this.fsWriteTimer = null;
      void this._writeToFilesystem();
    }, YjsPersistence.FS_WRITE_DEBOUNCE_MS);
  }

  private async _writeToFilesystem(): Promise<void> {
    if (this.destroyed) return;
    try {
      const content = this.text.toString();
      const api = getAPI();
      if (!this.cleanPath) return;

      try {
        await api.fileExists(this.cleanPath);
      } catch {
        // File system check failed -- proceed with write
      }

      // Ensure parent directory exists
      if (this.cleanPath.includes('/')) {
        const parentDir = this.cleanPath.split('/').slice(0, -1).join('/');
        try { await api.createDirectory(parentDir); } catch { /* exists */ }
      }

      await api.writeFile(this.cleanPath, content);
      this.lastFsWriteTime = Date.now();
      console.log(`[YJS] Filesystem flush (${content.length} chars) for ${this.cleanPath}`);
    } catch (err) {
      console.warn('[YJS] Filesystem write failed:', err);
    }
  }

  // ── Snapshot persistence (debounced) ──────────────────────────────────

  private _scheduleSnapshotPersist(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this._persistSnapshot();
    }, YjsPersistence.SNAPSHOT_DEBOUNCE_MS);
  }

  private async _persistSnapshot(): Promise<void> {
    if (this.destroyed) return;
    try {
      const content = this.text.toString();
      if (!this.cleanPath) return;

      const contentHash = await sha256Hex(content);
      const title = this.cleanPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || this.cleanPath;
      const isCanvas = this.cleanPath.endsWith('.canvas');
      const now = new Date().toISOString();

      let note = await localDB.getNoteByPath(this.spaceId, this.cleanPath);

      if (note) {
        note.content = content;
        note.updated_at = now;
        note.last_modified = now;
        note.client_id = this.clientId;
        note.content_hash = contentHash;
        note.version = (note.version || 0) + 1;
        await localDB.putNote(note, false);
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
          path: this.cleanPath,
          content,
          pinned: false,
          created_at: now,
          updated_at: now,
          deleted: false,
          is_canvas: isCanvas,
        };
        await localDB.putNote(newNote, false);
      }
      console.log(`[YJS] Snapshot saved to IndexedDB for ${this.cleanPath}`);
    } catch (err) {
      console.warn('[YJS] Snapshot persistence failed:', err);
    }
  }

  get lastWriteTime(): number {
    return this.lastFsWriteTime;
  }
}
