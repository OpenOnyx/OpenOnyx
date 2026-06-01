import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { v4 as uuidv4 } from 'uuid';
import { EMPTY_DOCUMENT_HASH, normalizeVersion, sha256Hex } from '../utils/collabDocument';
import { isSpaceUnlocked, getSpaceKey, encryptText, decryptText } from '../utils/spaces-crypto';

export interface LocalVault {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface LocalVaultCollaborator {
  id: string;
  vault_id: string;
  user_id: string;
  role: 'owner' | 'editor';
  created_at: string;
}

export interface LocalVaultInvite {
  id: string;
  vault_id: string;
  invited_user_email: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface LocalVaultPresence {
  user_id: string;
  vault_id: string;
  active_note_id: string | null;
  last_seen: string;
}

export interface LocalSpace {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  helps_with: string[] | null;
  is_public: boolean;
  visibility: 'local' | 'private' | 'public';
  forked_from: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalNote {
  id: string;
  space_id: string | null;
  vault_id: string | null;
  last_client_id: string | null;
  version?: number;
  last_modified?: string;
  client_id?: string | null;
  content_hash?: string;
  title: string;
  path: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  is_canvas?: boolean;
}

export interface LocalNoteChunk {
  id: string;
  note_id: string;
  content: string;
  embedding: any;
  created_at: string;
  updated_at: string;
}

export interface SyncQueueItem {
  id: string;
  operation: 'insert' | 'update' | 'delete';
  table: 'spaces' | 'notes' | 'note_chunks' | 'vaults' | 'vault_collaborators' | 'vault_invites' | 'vault_presence';
  record_id: string;
  payload: any;
  created_at: number;
  retry_count: number;
}

export interface LocalGroup {
  id: string;
  vault_path: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  auto_save_enabled: boolean;
  layout_state: any;
}

interface OpenObsidianDB extends DBSchema {
  vaults: {
    key: string;
    value: LocalVault;
  };
  vault_collaborators: {
    key: string;
    value: LocalVaultCollaborator;
    indexes: { 'by-vault': string };
  };
  vault_invites: {
    key: string;
    value: LocalVaultInvite;
    indexes: { 'by-vault': string };
  };
  vault_presence: {
    key: string; // "user_id:vault_id"
    value: LocalVaultPresence;
    indexes: { 'by-vault': string };
  };
  spaces: {
    key: string;
    value: LocalSpace;
    indexes: { 'by-owner': string; 'by-visibility': string };
  };
  notes: {
    key: string;
    value: LocalNote;
    indexes: { 'by-space': string; 'by-updated': string; 'by-vault': string };
  };
  note_chunks: {
    key: string;
    value: LocalNoteChunk;
    indexes: { 'by-note': string };
  };
  sync_queue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-created-at': number };
  };
  metadata: {
    key: string;
    value: any;
  };
  groups: {
    key: string;
    value: LocalGroup;
  };
}

let dbPromise: Promise<IDBPDatabase<OpenObsidianDB>>;

async function getPlaintextContent(note: LocalNote): Promise<string> {
  const content = note.content || '';
  if (content.startsWith('__ENCRYPTED_NOTE__:') && note.space_id) {
    if (isSpaceUnlocked(note.space_id)) {
      const spaceKey = getSpaceKey(note.space_id);
      if (spaceKey) {
        try {
          const raw = content.substring('__ENCRYPTED_NOTE__:'.length);
          const { ciphertext, iv, authTag } = JSON.parse(raw);
          return await decryptText(ciphertext, iv, authTag, spaceKey);
        } catch { /* fallback */ }
      }
    }
  }
  return content;
}

async function decryptNoteIfPossible(note: LocalNote | undefined): Promise<LocalNote | undefined> {
  if (!note || !note.content || !note.space_id) return note;
  if (note.content.startsWith('__ENCRYPTED_NOTE__:')) {
    if (isSpaceUnlocked(note.space_id)) {
      const spaceKey = getSpaceKey(note.space_id);
      if (spaceKey) {
        try {
          const raw = note.content.substring('__ENCRYPTED_NOTE__:'.length);
          const { ciphertext, iv, authTag } = JSON.parse(raw);
          const decrypted = await decryptText(ciphertext, iv, authTag, spaceKey);
          return { ...note, content: decrypted };
        } catch (e) {
          console.error('[localDB] Failed to decrypt note content:', e);
        }
      }
    }
  }
  return note;
}

async function decryptNotesIfPossible(notes: LocalNote[]): Promise<LocalNote[]> {
  return Promise.all(notes.map(n => decryptNoteIfPossible(n) as Promise<LocalNote>));
}

async function normalizeNoteMetadata(
  note: LocalNote,
  existing: LocalNote | undefined,
  enqueueSync: boolean,
  clientId?: string,
): Promise<LocalNote> {
  const now = note.updated_at || new Date().toISOString();
  const plainContent = await getPlaintextContent(note);
  const currentHash = enqueueSync ? await sha256Hex(plainContent) : (note.content_hash || await sha256Hex(plainContent));
  const currentVersion = normalizeVersion(note.version ?? existing?.version);

  if (!enqueueSync) {
    return {
      ...note,
      version: currentVersion,
      last_modified: note.last_modified || note.updated_at || existing?.last_modified || now,
      client_id: note.client_id ?? note.last_client_id ?? existing?.client_id ?? null,
      content_hash: currentHash || EMPTY_DOCUMENT_HASH,
    };
  }

  const nextVersion = Math.max(currentVersion, normalizeVersion(existing?.version) + 1);
  return {
    ...note,
    version: nextVersion,
    last_modified: now,
    client_id: clientId || note.client_id || note.last_client_id || null,
    content_hash: currentHash || EMPTY_DOCUMENT_HASH,
  };
}

export function getLocalDB() {
  if (!dbPromise) {
    dbPromise = openDB<OpenObsidianDB>('openobsidian-local', 5, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
          const spaceStore = db.createObjectStore('spaces', { keyPath: 'id' });
          spaceStore.createIndex('by-owner', 'owner_id');

          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('by-space', 'space_id');
          noteStore.createIndex('by-updated', 'updated_at');

          const chunkStore = db.createObjectStore('note_chunks', { keyPath: 'id' });
          chunkStore.createIndex('by-note', 'note_id');

          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('by-created-at', 'created_at');

          db.createObjectStore('metadata');
        }
        if (oldVersion < 2) {
          // Add visibility index if upgrading from v1
          if (db.objectStoreNames.contains('spaces')) {
            const store = transaction.objectStore('spaces');
            if (!store.indexNames.contains('by-visibility')) {
              store.createIndex('by-visibility', 'visibility');
            }
          }
        }
        if (oldVersion < 3) {
          if (db.objectStoreNames.contains('sync_queue')) {
            db.deleteObjectStore('sync_queue');
          }
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('by-created-at', 'created_at');
        }
        if (oldVersion < 4) {
          // Add vault support
          if (!db.objectStoreNames.contains('vaults')) {
            db.createObjectStore('vaults', { keyPath: 'id' });
          }
          
          if (!db.objectStoreNames.contains('vault_collaborators')) {
            const collabStore = db.createObjectStore('vault_collaborators', { keyPath: 'id' });
            collabStore.createIndex('by-vault', 'vault_id');
          }
          
          if (!db.objectStoreNames.contains('vault_invites')) {
            const invitesStore = db.createObjectStore('vault_invites', { keyPath: 'id' });
            invitesStore.createIndex('by-vault', 'vault_id');
          }

          // Composite key: "user_id:vault_id"
          if (!db.objectStoreNames.contains('vault_presence')) {
            const presenceStore = db.createObjectStore('vault_presence', { keyPath: 'id' });
            presenceStore.createIndex('by-vault', 'vault_id');
          }

          if (db.objectStoreNames.contains('notes')) {
            const store = transaction.objectStore('notes');
            if (!store.indexNames.contains('by-vault')) {
              store.createIndex('by-vault', 'vault_id');
            }
          }
        }
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains('groups')) {
            db.createObjectStore('groups', { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
}

export const localDB = {
  // ── Client Identity ─────────────────────────────────────
  async getClientId(): Promise<string> {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('collab_client_id');
      if (stored) return stored;
    }
    const db = await getLocalDB();
    let clientId = await db.get('metadata', 'client_id');
    if (!clientId) {
      clientId = uuidv4();
      await db.put('metadata', clientId, 'client_id');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('collab_client_id', clientId);
    }
    return clientId;
  },

  // ── Vaults ──────────────────────────────────────────────
  async getVault(id: string): Promise<LocalVault | undefined> {
    const db = await getLocalDB();
    return db.get('vaults', id);
  },

  async putVault(vault: LocalVault, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const isExisting = await db.get('vaults', vault.id);
    await db.put('vaults', vault);
    if (enqueueSync) {
      await this.enqueueChange('vaults', isExisting ? 'update' : 'insert', vault.id, vault);
    }
  },

  async deleteVault(id: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    await db.delete('vaults', id);
    if (enqueueSync) {
      await this.enqueueChange('vaults', 'delete', id, { id });
    }
  },

  // ── Vault Collaborators ─────────────────────────────────
  async getVaultCollaborators(vaultId: string): Promise<LocalVaultCollaborator[]> {
    const db = await getLocalDB();
    return db.getAllFromIndex('vault_collaborators', 'by-vault', vaultId);
  },

  async putVaultCollaborator(collab: LocalVaultCollaborator, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const isExisting = await db.get('vault_collaborators', collab.id);
    await db.put('vault_collaborators', collab);
    if (enqueueSync) {
      await this.enqueueChange('vault_collaborators', isExisting ? 'update' : 'insert', collab.id, collab);
    }
  },

  async deleteVaultCollaborator(id: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    await db.delete('vault_collaborators', id);
    if (enqueueSync) {
      await this.enqueueChange('vault_collaborators', 'delete', id, { id });
    }
  },

  // ── Vault Invites ───────────────────────────────────────
  async getVaultInvites(vaultId: string): Promise<LocalVaultInvite[]> {
    const db = await getLocalDB();
    return db.getAllFromIndex('vault_invites', 'by-vault', vaultId);
  },

  async getAllVaultInvites(): Promise<LocalVaultInvite[]> {
    const db = await getLocalDB();
    return db.getAll('vault_invites');
  },

  async putVaultInvite(invite: LocalVaultInvite, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const isExisting = await db.get('vault_invites', invite.id);
    await db.put('vault_invites', invite);
    if (enqueueSync) {
      await this.enqueueChange('vault_invites', isExisting ? 'update' : 'insert', invite.id, invite);
    }
  },

  async deleteVaultInvite(id: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    await db.delete('vault_invites', id);
    if (enqueueSync) {
      await this.enqueueChange('vault_invites', 'delete', id, { id });
    }
  },

  // ── Vault Presence ──────────────────────────────────────
  async getVaultPresence(vaultId: string): Promise<LocalVaultPresence[]> {
    const db = await getLocalDB();
    const records = await db.getAllFromIndex('vault_presence', 'by-vault', vaultId);
    // Return records without the internal 'id' key if we added it
    return records.map(r => {
      const { ...rest } = r as any;
      delete rest.id;
      return rest;
    });
  },

  async putVaultPresence(presence: LocalVaultPresence, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const id = `${presence.user_id}:${presence.vault_id}`;
    await db.put('vault_presence', { ...presence, id } as any);
    if (enqueueSync) {
      await this.enqueueChange('vault_presence', 'update', id, presence);
    }
  },

  async deleteVaultPresence(userId: string, vaultId: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const id = `${userId}:${vaultId}`;
    await db.delete('vault_presence', id);
    if (enqueueSync) {
      await this.enqueueChange('vault_presence', 'delete', id, { user_id: userId, vault_id: vaultId });
    }
  },

  // ── Spaces ──────────────────────────────────────────────
  async getSpaces(): Promise<LocalSpace[]> {
    const db = await getLocalDB();
    return db.getAll('spaces');
  },

  async getSpacesByVisibility(visibility: 'local' | 'private' | 'public'): Promise<LocalSpace[]> {
    const all = await this.getSpaces();
    return all.filter(s => s.visibility === visibility);
  },

  async getSpace(id: string): Promise<LocalSpace | undefined> {
    const db = await getLocalDB();
    return db.get('spaces', id);
  },

  async putSpace(space: LocalSpace, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    if (!space.visibility) {
      space.visibility = space.is_public ? 'public' : 'local';
    }
    const isExisting = await db.get('spaces', space.id);
    await db.put('spaces', space);
    if (enqueueSync && space.visibility !== 'local') {
      await this.enqueueChange('spaces', isExisting ? 'update' : 'insert', space.id, space);
    }
  },

  async deleteSpace(id: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const space = await db.get('spaces', id);
    await db.delete('spaces', id);
    if (enqueueSync && space && space.visibility !== 'local') {
      await this.enqueueChange('spaces', 'delete', id, { id });
    }
  },

  // ── Notes ───────────────────────────────────────────────
  async getNotes(spaceId: string): Promise<LocalNote[]> {
    const db = await getLocalDB();
    const notes = await db.getAllFromIndex('notes', 'by-space', spaceId);
    return decryptNotesIfPossible(notes);
  },

  async getNotesByVault(vaultId: string): Promise<LocalNote[]> {
    const db = await getLocalDB();
    const notes = await db.getAllFromIndex('notes', 'by-vault', vaultId);
    return decryptNotesIfPossible(notes);
  },

  async getNote(id: string): Promise<LocalNote | undefined> {
    const db = await getLocalDB();
    const note = await db.get('notes', id);
    return decryptNoteIfPossible(note);
  },

  /**
   * Find a note by its file path within a given space.
   * Scans all notes for the space and returns the first match.
   */
  async getNoteByPath(spaceId: string, path: string): Promise<LocalNote | undefined> {
    const notes = await this.getNotes(spaceId);
    return notes.find(n => n.path === path && !n.deleted);
  },

  async putNote(note: LocalNote, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    
    // Encrypt if private cloud space and content is not already encrypted
    if (note.space_id) {
      const space = await this.getSpace(note.space_id);
      if (space && space.visibility === 'private') {
        if (note.content && !note.content.startsWith('__ENCRYPTED_NOTE__:')) {
          if (isSpaceUnlocked(note.space_id)) {
            const spaceKey = getSpaceKey(note.space_id);
            if (spaceKey) {
              const enc = await encryptText(note.content, spaceKey);
              note = {
                ...note,
                content: `__ENCRYPTED_NOTE__:${JSON.stringify(enc)}`
              };
            } else {
              throw new Error('Space key not in memory (locked)');
            }
          } else {
            throw new Error('Space is locked');
          }
        }
      }
    }

    const isExisting = await db.get('notes', note.id);
    
    if (enqueueSync) {
      const clientId = await this.getClientId();
      note.last_client_id = clientId;
      note = await normalizeNoteMetadata(note, isExisting, true, clientId);
    } else {
      note = await normalizeNoteMetadata(note, isExisting, false);
    }

    await db.put('notes', note);
    if (enqueueSync) {
      await this.enqueueChange('notes', isExisting ? 'update' : 'insert', note.id, note);
    }
  },

  async deleteNote(id: string, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const note = await db.get('notes', id);
    if (note) {
      note.deleted = true;
      note.updated_at = new Date().toISOString();
      if (enqueueSync) {
        note.last_client_id = await this.getClientId();
      }
      const normalized = await normalizeNoteMetadata(note, note, enqueueSync, note.last_client_id || undefined);
      await db.put('notes', normalized);
      
      if (enqueueSync) {
        await this.enqueueChange('notes', 'delete', id, normalized);
      }
    }
  },

  // ── Chunks ──────────────────────────────────────────────
  async getChunks(noteId: string): Promise<LocalNoteChunk[]> {
    const db = await getLocalDB();
    return db.getAllFromIndex('note_chunks', 'by-note', noteId);
  },

  async putChunk(chunk: LocalNoteChunk, enqueueSync = true): Promise<void> {
    const db = await getLocalDB();
    const isExisting = await db.get('note_chunks', chunk.id);
    await db.put('note_chunks', chunk);
    if (enqueueSync) {
      await this.enqueueChange('note_chunks', isExisting ? 'update' : 'insert', chunk.id, chunk);
    }
  },

  async deleteChunksByNote(noteId: string): Promise<void> {
    const db = await getLocalDB();
    const chunks = await db.getAllFromIndex('note_chunks', 'by-note', noteId);
    for (const chunk of chunks) {
      await db.delete('note_chunks', chunk.id);
      await this.enqueueChange('note_chunks', 'delete', chunk.id, { id: chunk.id });
    }
  },

  // ── Metadata & Sync State ──────────────────────────────
  async setLastSyncTime(time: string): Promise<void> {
    const db = await getLocalDB();
    await db.put('metadata', time, 'last_sync_time');
  },

  async getLastSyncTime(): Promise<string | undefined> {
    const db = await getLocalDB();
    return db.get('metadata', 'last_sync_time') as Promise<string | undefined>;
  },

  async setMeta(key: string, value: any): Promise<void> {
    const db = await getLocalDB();
    await db.put('metadata', value, key);
  },

  async getMeta(key: string): Promise<any> {
    const db = await getLocalDB();
    return db.get('metadata', key);
  },

  // ── Sync Queue ─────────────────────────────────────────
  async enqueueChange(table: string, operation: 'insert' | 'update' | 'delete', record_id: string, payload: any): Promise<void> {
    const db = await getLocalDB();
    await db.put('sync_queue', {
      id: `${table}_${record_id}`,
      operation,
      table: table as any,
      record_id,
      payload,
      created_at: Date.now(),
      retry_count: 0
    });
  },

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    const db = await getLocalDB();
    return db.getAllFromIndex('sync_queue', 'by-created-at');
  },

  async putSyncItem(item: SyncQueueItem): Promise<void> {
    const db = await getLocalDB();
    await db.put('sync_queue', item);
  },

  async removeSyncItem(id: string): Promise<void> {
    const db = await getLocalDB();
    await db.delete('sync_queue', id);
  },

  async clearSyncQueue(): Promise<void> {
    const db = await getLocalDB();
    await db.clear('sync_queue');
  },

  // ── Groups ──────────────────────────────────────────────
  async getGroups(vaultPath: string): Promise<LocalGroup[]> {
    const db = await getLocalDB();
    const all = await db.getAll('groups');
    return all.filter(g => g.vault_path === vaultPath);
  },

  async putGroup(group: LocalGroup): Promise<void> {
    const db = await getLocalDB();
    await db.put('groups', group);
  },

  async deleteGroup(id: string): Promise<void> {
    const db = await getLocalDB();
    await db.delete('groups', id);
  },
};
