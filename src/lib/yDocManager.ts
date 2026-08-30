/**
 * YDocManager -- Manages the lifecycle of Yjs Y.Doc instances for open notes.
 *
 * Responsibilities:
 *   - Lazy Y.Doc creation when a note tab is opened
 *   - IndexedDB persistence via y-indexeddb
 *   - Filesystem initialization for new docs
 *   - SupabaseProvider connection for real-time sync
 *   - Y.UndoManager creation scoped to local edits
 *   - Cleanup when tabs are closed
 *   - Deduplication of concurrent openDoc() calls (React Strict Mode safe)
 *
 * Instrumentation: Every event logs with [YJS] prefix for full observability.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';
import { SupabaseProvider, type SupabaseProviderOptions } from './supabaseProvider';
import { localDB } from './localdb';
import { isSupabaseConfigured } from './supabase';
import { authManager } from './auth';
import { getAPI } from '../utils/api';
import { normalizeSyncPath } from './syncEngine';
import { populateYDocFromCanvasJSON } from '../utils/collabDocument';

// ── Types ───────────────────────────────────────────────────────────────────

export interface OpenDocResult {
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  provider: SupabaseProvider;
}

interface DocEntry {
  doc: Y.Doc;
  text: Y.Text;
  provider: SupabaseProvider;
  idbPersistence: IndexeddbPersistence;
  undoManager: Y.UndoManager;
  refCount: number;
}

// ── Color assignment for awareness ──────────────────────────────────────────

const AWARENESS_COLORS = [
  '#3b82f6', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0ea5e9', '#0891b2', '#65a30d', '#ea580c', '#e11d48',
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return AWARENESS_COLORS[Math.abs(hash) % AWARENESS_COLORS.length];
}

// ── Manager ─────────────────────────────────────────────────────────────────

class YDocManagerImpl {
  private entries = new Map<string, DocEntry>();
  private clientId: string | null = null;

  /**
   * In-flight openDoc promises, keyed by `${spaceId}:${cleanPath}`.
   * Prevents React Strict Mode double-mount from creating two Y.Doc
   * instances for the same note. The second call coalesces onto the
   * first call's Promise and increments refCount when it resolves.
   */
  private pendingOpens = new Map<string, Promise<OpenDocResult>>();
  private pendingRefCounts = new Map<string, number>();

  /**
   * Open (or reuse) a Y.Doc for the given note path.
   *
   * If a doc is already open for this path, its reference count is incremented
   * and the same doc is returned. This supports split panes viewing the same note.
   *
   * If an openDoc call is already in-flight for this key (e.g. React Strict Mode
   * double-mount), the second call coalesces onto the first call's Promise.
   */
  async openDoc(notePath: string, spaceId: string): Promise<OpenDocResult> {
    const cleanPath = normalizeSyncPath(notePath) || notePath;
    const key = `${spaceId}:${cleanPath}`;

    // 1. Reuse existing doc if already fully open (split panes)
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount++;
      console.log(`[YJS] Reused document for note: ${cleanPath} (guid: ${existing.doc.guid}, refCount: ${existing.refCount})`);
      return {
        doc: existing.doc,
        text: existing.text,
        awareness: existing.provider.awareness,
        undoManager: existing.undoManager,
        provider: existing.provider,
      };
    }

    // 2. Coalesce onto in-flight open if one exists (React Strict Mode guard)
    const pending = this.pendingOpens.get(key);
    if (pending) {
      console.log(`[YJS] Coalescing onto in-flight openDoc for note: ${cleanPath}`);
      this.pendingRefCounts.set(key, (this.pendingRefCounts.get(key) || 0) + 1);
      return pending;
    }

    // 3. Create a new doc -- store the Promise immediately to prevent races
    const openPromise = this._createDoc(key, cleanPath, spaceId);
    this.pendingOpens.set(key, openPromise);

    try {
      const result = await openPromise;
      // Add any pending ref counts accumulated while creating the doc
      const pendingCount = this.pendingRefCounts.get(key) || 0;
      if (pendingCount > 0) {
        const entry = this.entries.get(key);
        if (entry) {
          entry.refCount += pendingCount;
          console.log(`[YJS] Applied pending ref counts (${pendingCount}) to note: ${cleanPath} (new refCount: ${entry.refCount})`);
        }
      }
      return result;
    } finally {
      this.pendingOpens.delete(key);
      this.pendingRefCounts.delete(key);
    }
  }

  /**
   * Internal: actually creates the Y.Doc, hydrates it, connects the provider.
   */
  private async _createDoc(key: string, cleanPath: string, spaceId: string): Promise<OpenDocResult> {
    // Ensure client ID is loaded
    if (!this.clientId) {
      this.clientId = await localDB.getClientId();
    }

    const isCanvas = cleanPath.toLowerCase().endsWith('.canvas');

    // Create a new Y.Doc
    const doc = new Y.Doc();
    const text = doc.getText('content');
    console.log(`[YJS] Created document for note: ${cleanPath} (guid: ${doc.guid})`);

    // 1. Restore from IndexedDB (offline state)
    const idbKey = `yjs-${spaceId}-${cleanPath.replace(/[/\\:]/g, '_')}`;
    const idbPersistence = new IndexeddbPersistence(idbKey, doc);
    await idbPersistence.whenSynced;

    const canvasNodesSize = () => doc.getMap('nodes').size;
    const canvasEdgesSize = () => doc.getMap('edges').size;
    const isDocPopulated = () => {
      if (isCanvas) {
        return canvasNodesSize() > 0 || canvasEdgesSize() > 0;
      } else {
        return text.length > 0;
      }
    };

    console.log(`[YJS] Hydrated document from IndexedDB (${isCanvas ? `nodes: ${canvasNodesSize()}, edges: ${canvasEdgesSize()}` : `${text.length} chars`})`);

    // 2. Resolve user info for awareness
    const user = authManager.getUser();
    const userId = authManager.getUserId() || 'anonymous';
    const userInfo: SupabaseProviderOptions['user'] = {
      id: userId,
      name: user?.email?.split('@')[0] || 'Anonymous',
      email: user?.email || '',
      color: getColorForUser(userId),
    };

    // 3. Create provider and connect
    const provider = new SupabaseProvider(doc, {
      spaceId,
      notePath: cleanPath,
      clientId: this.clientId,
      user: userInfo,
    });
    await provider.connect();

    // 4. If doc is empty after IndexedDB restore, wait for peer sync before hydrating from filesystem
    if (!isDocPopulated()) {
      const shouldWait = typeof navigator !== 'undefined' && navigator.onLine && isSupabaseConfigured;
      if (shouldWait) {
        console.log(`[YJS] Document empty after IndexedDB, waiting up to 300ms for peer sync...`);
        await new Promise<void>((resolve) => {
          const startTime = Date.now();
          const interval = setInterval(() => {
            if (isDocPopulated() || Date.now() - startTime >= 300) {
              clearInterval(interval);
              resolve();
            }
          }, 30);
        });
      }
    }

    // 4b. Reconcile / repair duplicated IndexedDB state against local filesystem
    if (!isCanvas && isDocPopulated()) {
      try {
        const api = getAPI();
        const diskContent = await api.readFile(cleanPath);
        if (diskContent && diskContent.length > 0) {
          const cleanDisk = diskContent.trim();
          const currentText = text.toString();

          // Fast O(1) check for bloated or duplicated text snapshots
          let needsRepair = false;
          const currentLen = text.length;

          if (currentLen > 100000 && currentLen > cleanDisk.length * 1.5) {
            // Extreme document bloat from previous duplication bugs
            needsRepair = true;
          } else if (cleanDisk.length > 20 && currentLen > cleanDisk.length * 1.2) {
            if (currentText.slice(0, cleanDisk.length) === cleanDisk) {
              needsRepair = true;
            }
          }

          const sanitizedDisk = stripDuplicateMarkdownBlocks(diskContent);
          if (needsRepair || sanitizedDisk !== diskContent) {
            console.warn(`[YJS] Repairing duplicated/bloated text for ${cleanPath} (${currentLen} -> ${sanitizedDisk.length} chars).`);
            doc.transact(() => {
              text.delete(0, text.length);
              text.insert(0, sanitizedDisk);
            }, 'dedup-repair');
            try { await idbPersistence.clearData(); } catch {}
            try { await api.writeFile(cleanPath, sanitizedDisk); } catch {}
          }
        }
      } catch {
        // best effort
      }
    }

    // 5. If doc is STILL empty and has no transaction history, initialize from local filesystem
    if (!isDocPopulated() && doc.store.clients.size === 0) {
      if (isCanvas) {
        try {
          const api = getAPI();
          const fileContent = await api.readFile(cleanPath);
          if (fileContent && fileContent.length > 0) {
            populateYDocFromCanvasJSON(doc, fileContent);
            console.log(`[YJS] Hydrated canvas document from filesystem (.canvas)`);
          }
        } catch {
          // File may not exist yet (new note)
        }
      } else {
        try {
          const api = getAPI();
          const rawContent = await api.readFile(cleanPath);
          if (rawContent && rawContent.length > 0) {
            const fileContent = stripDuplicateMarkdownBlocks(rawContent);
            doc.transact(() => {
              if (text.length > 0) {
                text.delete(0, text.length);
              }
              text.insert(0, fileContent);
            }, 'init');
            console.log(`[YJS] Hydrated document from filesystem (.md) (${fileContent.length} chars)`);
          }
        } catch {
          // File may not exist yet (new note)
        }
      }
    }

    // If the doc is still empty after IndexedDB + filesystem + peer sync wait, request snapshot from peers
    if (!isDocPopulated()) {
      provider.requestSnapshot();
    }

    // 5. Create undo manager scoped to local edits
    const undoManager = isCanvas
      ? new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges'), doc.getMap('scribbles'), doc.getMap('metadata')], {
          trackedOrigins: new Set([null]),
          captureTimeout: 500,
        })
      : new Y.UndoManager(text, {
          trackedOrigins: new Set([null]),
          captureTimeout: 500,
        });

    const entry: DocEntry = {
      doc,
      text,
      provider,
      idbPersistence,
      undoManager,
      refCount: 1,
    };

    this.entries.set(key, entry);

    return {
      doc,
      text,
      awareness: provider.awareness,
      undoManager,
      provider,
    };
  }

  /**
   * Close a Y.Doc for the given note path.
   * Decrements reference count; actually destroys only when refCount reaches 0.
   */
  closeDoc(notePath: string, spaceId: string): void {
    const cleanPath = normalizeSyncPath(notePath) || notePath;
    const key = `${spaceId}:${cleanPath}`;

    const entry = this.entries.get(key);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount > 0) {
      console.log(`[YJS] Decremented refCount for note: ${cleanPath} (remaining: ${entry.refCount})`);
      return;
    }

    // Fully clean up
    console.log(`[YJS] Destroyed document for note: ${cleanPath} (guid: ${entry.doc.guid})`);
    entry.provider.disconnect();
    entry.undoManager.destroy();
    entry.idbPersistence.destroy();
    entry.doc.destroy();
    this.entries.delete(key);
  }

  /**
   * Check if a doc is currently open for the given note path.
   */
  hasDoc(notePath: string, spaceId: string): boolean {
    const cleanPath = normalizeSyncPath(notePath) || notePath;
    const key = `${spaceId}:${cleanPath}`;
    return this.entries.has(key);
  }

  /**
   * Get an already-open doc entry. Returns undefined if not open.
   */
  getDoc(notePath: string, spaceId: string): OpenDocResult | undefined {
    const cleanPath = normalizeSyncPath(notePath) || notePath;
    const key = `${spaceId}:${cleanPath}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return {
      doc: entry.doc,
      text: entry.text,
      awareness: entry.provider.awareness,
      undoManager: entry.undoManager,
      provider: entry.provider,
    };
  }

  /**
   * Close all open docs. Call on vault switch or app unmount.
   */
  closeAll(): void {
    for (const [key, entry] of this.entries) {
      console.log(`[YJS] Destroying open document on closeAll: ${key}`);
      entry.provider.disconnect();
      entry.undoManager.destroy();
      entry.idbPersistence.destroy();
      entry.doc.destroy();
    }
    this.entries.clear();
    this.pendingOpens.clear();
  }

  /**
   * Get the number of currently open docs.
   */
  get openDocCount(): number {
    return this.entries.size;
  }
}

export function stripDuplicateMarkdownBlocks(content: string): string {
  if (!content || content.length < 50) return content;
  const sections = content.split(/(?=\n#\s|^#\s)/);
  if (sections.length <= 1) return content;

  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduplicated.push(section);
  }

  if (deduplicated.length < sections.length) {
    return deduplicated.join('');
  }
  return content;
}

export const yDocManager = new YDocManagerImpl();
