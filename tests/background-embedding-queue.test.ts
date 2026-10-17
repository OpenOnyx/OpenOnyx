// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ embed: vi.fn(async (..._args: any[]) => true), generation: 0, invalidate: vi.fn(), store: { entries: new Map() }, disk: new Map<string, unknown>(), prune: vi.fn() }));
vi.mock('../src/utils/embeddings', () => ({
  areEmbeddingsAvailable: () => true, EMBEDDING_SCHEMA_VERSION: 2,
  getEmbeddingGeneration: () => state.generation, invalidateEmbeddingPath: state.invalidate,
  loadStoreAsync: async () => state.store, embedNote: state.embed,
  refreshEmbeddingMetadataIfUnchanged: () => false, pruneMissingEmbeddings: state.prune,
}));
vi.mock('../src/utils/ai-core', () => ({ getAnnotation: async () => {} }));
vi.mock('../src/utils/disk-store', () => ({
  readData: async (path: string) => state.disk.get(path), writeData: async (path: string, value: unknown) => { state.disk.set(path, value); },
}));
import { cancelNoteJobs, enqueueJob, getQueueLength, initializeVault, resetQueueState, startProcessing, resumeProcessing, isQueueRunning, setQueueStatusCallback } from '../src/utils/background-queue';
const metadata = vi.fn(async () => ({ modifiedAt: 100, size: 7 }));
const job = (path: string, content: string, priority = 2) => ({ id: path, type: 'embed' as const, path, content, priority, enqueuedAt: 1 });

beforeEach(() => { resetQueueState(); state.store.entries.clear(); state.disk.clear(); state.embed.mockClear(); state.invalidate.mockClear(); metadata.mockClear(); state.prune.mockClear(); setQueueStatusCallback(null); });
describe('authoritative note indexing queue', () => {
  it('coalesces duplicate events with the latest source and upgraded priority', async () => {
    enqueueJob(job('background.md', 'background'));
    enqueueJob(job('note.md', 'old')); enqueueJob(job('note.md', 'latest', 0));
    expect(getQueueLength()).toBe(2);
    await startProcessing({ fileMetadata: metadata });
    expect(state.embed.mock.calls[0]).toEqual([state.store, 'note.md', 'latest', 100, 7, 1]);
    expect(state.embed).toHaveBeenCalledTimes(2);
  });

  it('reuses vault-scan metadata and only probes the native handler once', async () => {
    enqueueJob({ ...job('scanned.md', 'snapshot'), modifiedAt: 123, size: 8 });
    await startProcessing({ fileMetadata: metadata });
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(state.embed).toHaveBeenCalledWith(state.store, 'scanned.md', 'snapshot', 123, 8, 2);
  });

  it('cancels deleted or moved directory jobs', async () => {
    enqueueJob(job('folder/note.md', 'content')); enqueueJob(job('other.md', 'other'));
    cancelNoteJobs('folder', true);
    await startProcessing({ fileMetadata: metadata });
    expect(state.embed).toHaveBeenCalledTimes(1);
    expect(state.embed.mock.calls[0][1]).toBe('other.md');
  });

  it('coalesces initialization and cancels a delayed old-vault scan', async () => {
    const notes = [{ path: 'old.md', modifiedAt: 1, size: 10 }];
    const first = initializeVault(notes, null, [], { readFile: async () => 'content' });
    expect(initializeVault(notes)).toBe(first);
    resetQueueState();
    expect(await first).toEqual({ enqueued: 0, alreadyIndexed: 0 });
    expect(state.embed).not.toHaveBeenCalled();
    expect(getQueueLength()).toBe(0);
  });
});


describe('metadata IPC infrastructure failures', () => {
  it('uses metadata and skips a deleted file without deleting stored embeddings', async () => {
    state.store.entries.set('deleted.md', { hash: 'previous' });
    enqueueJob(job('present.md', 'current'));
    enqueueJob(job('deleted.md', 'stale snapshot'));
    await startProcessing({ fileMetadata: async (path: string) => path === 'deleted.md' ? null : { modifiedAt: 200, size: 42 } });
    expect(state.embed).toHaveBeenCalledExactlyOnceWith(state.store, 'present.md', 'current', 200, 42, 2);
    expect(state.store.entries.has('deleted.md')).toBe(true);
  });

  it('pauses once on a missing main handler, retains jobs, and resumes after repair', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const status = vi.fn(); setQueueStatusCallback(status);
    const api = { fileMetadata: vi.fn(async (_path: string): Promise<any> => { throw new Error("Error invoking remote method 'fs:fileMetadata': No handler registered for 'fs:fileMetadata'"); }) };
    try {
      for (let i = 0; i < 10; i++) enqueueJob(job(`note-${i}.md`, 'content'));
      await Promise.all(Array.from({ length: 20 }, () => startProcessing(api)));
      expect(api.fileMetadata).toHaveBeenCalledTimes(1);
      expect(state.embed).not.toHaveBeenCalled();
      expect(getQueueLength()).toBe(10); expect(isQueueRunning()).toBe(false);
      expect(state.disk.get('queue.json')).toMatchObject({ jobs: expect.arrayContaining([expect.objectContaining({ path: 'note-0.md' })]) });
      await startProcessing(api); await startProcessing(api);
      expect(api.fileMetadata).toHaveBeenCalledTimes(1); expect(errorLog).toHaveBeenCalledTimes(1);
      expect(status.mock.calls.at(-1)![0].message).toContain('restart');
      api.fileMetadata.mockResolvedValue({ modifiedAt: 200, size: 42 });
      await resumeProcessing(api);
      expect(state.embed).toHaveBeenCalledTimes(10); expect(getQueueLength()).toBe(0);
    } finally { errorLog.mockRestore(); }
  });

  it('retains the unprocessed batch if the handler disappears after preflight', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = { fileMetadata: vi.fn(async (path: string) => {
      if (path === 'broken.md') throw new Error("No handler registered for 'fs:fileMetadata'");
      return { modifiedAt: 1, size: 10 };
    }) };
    try {
      enqueueJob(job('good.md', 'good')); enqueueJob(job('broken.md', 'broken')); enqueueJob(job('later.md', 'later'));
      await startProcessing(api);
      // The bounded preparation batch reads independent notes concurrently;
      // only the failed note is retained after the capability disappears.
      expect(state.embed).toHaveBeenCalledTimes(2); expect(getQueueLength()).toBe(1);
      api.fileMetadata.mockResolvedValue({ modifiedAt: 1, size: 10 });
      await resumeProcessing(api);
      expect(state.embed).toHaveBeenCalledTimes(3);
    } finally { errorLog.mockRestore(); }
  });

  it('treats an old preload without metadata as infrastructure failure and preserves initialization jobs', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const notes = [{ path: 'cached.md', modifiedAt: 1, size: 10 }];
      state.store.entries.set('cached.md', { hash: 'previous' });
      await initializeVault(notes, null, [], {});
      expect(state.embed).not.toHaveBeenCalled(); expect(getQueueLength()).toBe(1);
      expect(state.store.entries.has('cached.md')).toBe(true);
      expect(state.prune).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally { errorLog.mockRestore(); }
  });
});
