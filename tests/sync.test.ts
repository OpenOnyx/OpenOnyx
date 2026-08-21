// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine, normalizeSyncPath } from '../src/lib/syncEngine';
import { localDB, getLocalDB } from '../src/lib/localdb';
import { authManager } from '../src/lib/auth';
import { sha256Hex } from '../src/utils/collabDocument';

// ── Mock Supabase Client ──
let remoteNotesForMock: any[] = [];
let upsertedNotes: any[] = [];

const mockFrom = vi.fn((table: string) => {
  let filterId: string | null = null;
  let filterSpaceId: string | null = null;

  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn((col, val) => {
      if (col === 'id') filterId = val;
      if (col === 'space_id') filterSpaceId = val;
      return chain;
    }),
    in: vi.fn((col, vals) => {
      return chain;
    }),
    gte: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => {
      if (filterId) {
        const found = remoteNotesForMock.find(n => n.id === filterId);
        return { data: found || null, error: null };
      }
      return { data: remoteNotesForMock[0] || null, error: null };
    }),
    single: vi.fn(async () => {
      if (filterId) {
        const found = remoteNotesForMock.find(n => n.id === filterId);
        return { data: found || null, error: null };
      }
      return { data: remoteNotesForMock[0] || null, error: null };
    }),
    upsert: vi.fn(async (payload: any) => {
      if (Array.isArray(payload)) {
        upsertedNotes.push(...payload);
      } else {
        upsertedNotes.push(payload);
      }
      return { data: payload, error: null };
    }),
    insert: vi.fn(async (payload: any) => {
      if (Array.isArray(payload)) {
        upsertedNotes.push(...payload);
      } else {
        upsertedNotes.push(payload);
      }
      return { data: payload, error: null };
    }),
    then: (resolve: any) => {
      resolve({ data: remoteNotesForMock, error: null });
    }
  };
  return chain;
});

vi.mock('../src/lib/supabase', () => {
  return {
    supabase: {
      from: (table: string) => mockFrom(table),
    },
    isSupabaseConfigured: true,
    configureSupabaseClient: vi.fn(),
  };
});

// ── Mock Auth Manager ──
vi.mock('../src/lib/auth', () => {
  return {
    authManager: {
      isLoggedIn: () => true,
      getUserId: () => 'test-user-id',
      subscribe: (fn: any) => {
        fn({ user: { id: 'test-user-id' }, isLoading: false });
        return () => {};
      },
    },
  };
});

// ── Mock Collaboration Engine ──
vi.mock('../src/lib/collaborationEngine', () => {
  return {
    collaborationEngine: {
      status: { state: 'ready' },
      getSpaceForVault: vi.fn(async () => ({ id: 'test-space-id' })),
    },
  };
});

// ── Mock Private Crypto ──
vi.mock('../src/lib/privateCrypto', () => {
  return {
    isPrivateCloudSpace: vi.fn(() => false),
    privateCrypto: {
      isUnlocked: vi.fn(() => true),
      encryptNoteContent: vi.fn(async (spaceId, payload) => ({
        content: '',
        content_encrypted: 'mock-encrypted',
        iv: 'mock-iv',
        auth_tag: 'mock-auth-tag',
        encryption_version: 1
      })),
      decryptNoteContent: vi.fn(async (spaceId, note) => note.content || 'mock-decrypted')
    }
  };
});

// ── Mock YDoc Manager ──
export const mockHasDoc = vi.fn((notePath?: string, spaceId?: string) => false);
vi.mock('../src/lib/yDocManager', () => {
  return {
    yDocManager: {
      hasDoc: (notePath: string, spaceId: string) => mockHasDoc(notePath, spaceId),
    },
  };
});

// Helper to clear IndexedDB stores
async function clearDatabase() {
  const db = await getLocalDB();
  const storeNames = Array.from(db.objectStoreNames);
  const tx = db.transaction(storeNames, 'readwrite');
  for (const storeName of storeNames) {
    await tx.objectStore(storeName).clear();
  }
  await tx.done;
}

describe('SyncEngine Tests', () => {
  let engine: SyncEngine;
  let fileMock: Record<string, string> = {};
  let fileTreeMock: any[] = [];

  beforeEach(async () => {
    await clearDatabase();
    remoteNotesForMock = [];
    upsertedNotes = [];
    fileMock = {};
    fileTreeMock = [];
    mockFrom.mockClear();

    // Set window configurations
    (window as any).__oo_vault_path = '/vault';
    if (!(window as any).indexedDB) {
      (window as any).indexedDB = {};
    }
    (window as any).indexedDB.databases = vi.fn(async () => []);
    (window as any).electronAPI = {
      getVaultPath: vi.fn(async () => '/vault'),
      getFileTree: vi.fn(async () => fileTreeMock),
      readFile: vi.fn(async (path: string) => fileMock[path] ?? ''),
      writeFile: vi.fn(async (path: string, content: string) => {
        fileMock[path] = content;
      }),
      deleteFile: vi.fn(async (path: string) => {
        delete fileMock[path];
      }),
      createDirectory: vi.fn(async () => {}),
      fileExists: vi.fn(async (path: string) => path in fileMock),
    };

    engine = new SyncEngine();
    await engine.setActiveVault('/vault');
  });

  it('normalizes relative vault paths correctly', () => {
    expect(normalizeSyncPath('/vault/notes/test.md')).toBe('notes/test.md');
    expect(normalizeSyncPath('notes/test.md')).toBe('notes/test.md');
  });

  it('performs Push Syncing (Local -> Cloud)', async () => {
    // 1. Create a local space so the engine knows it exists
    await localDB.putSpace({
      id: 'test-space-id',
      owner_id: 'test-user-id',
      title: 'Test Space',
      description: null,
      helps_with: null,
      is_public: false,
      visibility: 'public',
      forked_from: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, false);

    // 2. Put a note locally that generates a sync queue item
    await localDB.putNote({
      id: 'note-1',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 1,
      title: 'Hello',
      path: 'Hello.md',
      content: 'Local Hello Content',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, true);

    const queueBefore = await localDB.getSyncQueue();
    expect(queueBefore.length).toBe(1);
    expect(queueBefore[0].record_id).toBe('note-1');

    // 3. Trigger push changes
    const pushedCount = await engine.pushChanges();
    expect(pushedCount).toBe(1);

    // 4. Verify item was upserted to remote and deleted from local queue
    expect(upsertedNotes.length).toBe(1);
    expect(upsertedNotes[0].id).toBe('note-1');
    expect(upsertedNotes[0].content).toBe('Local Hello Content');

    const queueAfter = await localDB.getSyncQueue();
    expect(queueAfter.length).toBe(0);
  });

  it('resolves Push Conflicts by skipping older local versions (LWW)', async () => {
    // 1. Setup local space
    await localDB.putSpace({
      id: 'test-space-id',
      owner_id: 'test-user-id',
      title: 'Test Space',
      description: null,
      helps_with: null,
      is_public: false,
      visibility: 'public',
      forked_from: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, false);

    // 2. Put note locally at version 2
    await localDB.putNote({
      id: 'note-conflict',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 2,
      title: 'Conflict Note',
      path: 'Conflict.md',
      content: 'Old Local Edit',
      content_hash: 'same-hash',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, true);

    // 3. Mock remote note as version 3 (newer than local version 2)
    remoteNotesForMock = [{
      id: 'note-conflict',
      space_id: 'test-space-id',
      version: 3,
      content: 'Newer Remote Edit',
      content_hash: await sha256Hex('Old Local Edit'),
      updated_at: new Date().toISOString(),
    }];

    // 4. Run pushChanges
    const pushedCount = await engine.pushChanges();
    expect(pushedCount).toBe(1); // returned count increments when handled (skipped or processed)

    // Verify it was skipped from remote upsert
    expect(upsertedNotes.length).toBe(0);

    // Verify queue is cleaned up so we can pull the newer version
    const queueAfter = await localDB.getSyncQueue();
    expect(queueAfter.length).toBe(0);
  });

  it('performs Pull Syncing (Cloud -> Local)', async () => {
    // Mock lastSync metadata to be in the past
    await localDB.setMeta('lastSync_test-space-id', new Date(0).toISOString());

    // 1. Mock remote changes
    const remoteTime = new Date().toISOString();
    remoteNotesForMock = [{
      id: 'remote-note-1',
      space_id: 'test-space-id',
      version: 2,
      title: 'Remote Title',
      path: 'notes/remote.md',
      content: 'Fresh Remote Content',
      updated_at: remoteTime,
      created_at: remoteTime,
      deleted: false,
    }];

    // 2. Run pull
    const pulledCount = await engine.pullChanges();
    expect(pulledCount).toBe(1);

    // 3. Verify it was written to local database
    const localNote = await localDB.getNote('remote-note-1');
    expect(localNote).toBeDefined();
    expect(localNote?.content).toBe('Fresh Remote Content');
    expect(localNote?.version).toBe(2);

    // 4. Verify it was written to local filesystem (mocked)
    expect(fileMock['notes/remote.md']).toBe('Fresh Remote Content');
  });

  it('prevents Pull Overwrite if local version is newer (LWW)', async () => {
    // Mock lastSync metadata to be in the past
    await localDB.setMeta('lastSync_test-space-id', new Date(0).toISOString());

    // 1. Put note locally at version 5
    await localDB.putNote({
      id: 'lww-note',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 5,
      title: 'LWW Note',
      path: 'notes/lww.md',
      content: 'New Local Content',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, false); // enqueueSync = false so it doesn't push

    // Save initial filesystem state
    fileMock['notes/lww.md'] = 'New Local Content';

    // 2. Mock remote note as version 4 (older than local version 5)
    remoteNotesForMock = [{
      id: 'lww-note',
      space_id: 'test-space-id',
      version: 4,
      title: 'LWW Note',
      path: 'notes/lww.md',
      content: 'Older Remote Content',
      updated_at: new Date().toISOString(),
      deleted: false,
    }];

    // 3. Run pull
    const pulledCount = await engine.pullChanges();
    expect(pulledCount).toBe(0); // skipped

    // 4. Verify local note content was NOT overwritten
    const localNote = await localDB.getNote('lww-note');
    expect(localNote?.content).toBe('New Local Content');
    expect(fileMock['notes/lww.md']).toBe('New Local Content');
  });

  it('scans local filesystem for offline changes and enqueues them', async () => {
    // 1. Put an existing note locally in the database (synced status)
    const initialTime = Date.now() - 10000;
    await localDB.putNote({
      id: 'offline-note',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 1,
      title: 'Offline test',
      path: 'Offline.md',
      content: 'Original Content',
      pinned: false,
      created_at: new Date(initialTime).toISOString(),
      updated_at: new Date(initialTime).toISOString(),
      deleted: false,
    }, false);

    // 2. Mock filesystem to have a newer modification time and new content
    fileMock['Offline.md'] = 'Updated Content Offline';
    fileTreeMock = [{
      name: 'Offline.md',
      path: 'Offline.md',
      absolutePath: '/vault/Offline.md',
      isDirectory: false,
      extension: '.md',
      modifiedAt: Date.now(),
      size: 'Updated Content Offline'.length,
    }];

    // 3. Run filesystem scan
    await engine.syncLocalFilesystemToDB(true); // force = true

    // 4. Verify localDB is updated and sync queue is populated
    const updatedNote = await localDB.getNote('offline-note');
    expect(updatedNote?.content).toBe('Updated Content Offline');

    const queue = await localDB.getSyncQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].record_id).toBe('offline-note');
    expect(queue[0].payload.content).toBe('Updated Content Offline');
  });

  it('skips LWW overwrite on pull when Yjs hasDoc is active', async () => {
    await localDB.setMeta('lastSync_test-space-id', new Date(0).toISOString());

    mockHasDoc.mockReturnValue(true);

    await localDB.putNote({
      id: 'yjs-note-pull',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 1,
      title: 'Yjs Pull Note',
      path: 'notes/yjs.md',
      content: 'Original Local Content',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, false);

    fileMock['notes/yjs.md'] = 'Original Local Content';

    remoteNotesForMock = [{
      id: 'yjs-note-pull',
      space_id: 'test-space-id',
      version: 2,
      title: 'Yjs Pull Note',
      path: 'notes/yjs.md',
      content: 'Newer Remote Content',
      updated_at: new Date().toISOString(),
      deleted: false,
    }];

    const pulledCount = await engine.pullChanges();
    expect(pulledCount).toBe(0);

    const localNote = await localDB.getNote('yjs-note-pull');
    expect(localNote?.content).toBe('Original Local Content');
    expect(fileMock['notes/yjs.md']).toBe('Original Local Content');

    mockHasDoc.mockReturnValue(false);
  });

  it('skips LWW overwrite on pull when Yjs snapshot exists in IndexedDB', async () => {
    await localDB.setMeta('lastSync_test-space-id', new Date(0).toISOString());

    (window as any).indexedDB.databases.mockResolvedValue([
      { name: 'yjs-test-space-id-notes_yjs_db.md' }
    ]);

    await localDB.putNote({
      id: 'yjs-note-snapshot',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 1,
      title: 'Yjs Snapshot Note',
      path: 'notes/yjs_db.md',
      content: 'Original Local Content',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, false);

    fileMock['notes/yjs_db.md'] = 'Original Local Content';

    remoteNotesForMock = [{
      id: 'yjs-note-snapshot',
      space_id: 'test-space-id',
      version: 2,
      title: 'Yjs Snapshot Note',
      path: 'notes/yjs_db.md',
      content: 'Newer Remote Content',
      updated_at: new Date().toISOString(),
      deleted: false,
    }];

    const pulledCount = await engine.pullChanges();
    expect(pulledCount).toBe(0);

    const localNote = await localDB.getNote('yjs-note-snapshot');
    expect(localNote?.content).toBe('Original Local Content');
    expect(fileMock['notes/yjs_db.md']).toBe('Original Local Content');
  });

  it('creates conflict copy on push conflict instead of dropping the local edit', async () => {
    await localDB.putSpace({
      id: 'test-space-id',
      owner_id: 'test-user-id',
      title: 'Test Space',
      description: null,
      helps_with: null,
      is_public: false,
      visibility: 'public',
      forked_from: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, false);

    await localDB.putNote({
      id: 'note-conflict-copy',
      space_id: 'test-space-id',
      vault_id: null,
      last_client_id: 'client-1',
      version: 2,
      title: 'Conflict Copy Note',
      path: 'ConflictCopy.md',
      content: 'My Divergent Local Edit',
      pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    }, true);

    fileMock['ConflictCopy.md'] = 'My Divergent Local Edit';

    remoteNotesForMock = [{
      id: 'note-conflict-copy',
      space_id: 'test-space-id',
      version: 3,
      content: 'Newer Remote Edit',
      content_hash: 'different-remote-hash',
      updated_at: new Date().toISOString(),
    }];

    const pushedCount = await engine.pushChanges();
    expect(pushedCount).toBe(1);

    expect(fileMock['ConflictCopy (conflict).md']).toBe('My Divergent Local Edit');

    const allNotes = await localDB.getNotes('test-space-id');
    const conflictNote = allNotes.find(n => n.path === 'ConflictCopy (conflict).md');
    expect(conflictNote).toBeDefined();
    expect(conflictNote?.content).toBe('My Divergent Local Edit');

    const queue = await localDB.getSyncQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].record_id).toBe(conflictNote?.id);
  });
});
