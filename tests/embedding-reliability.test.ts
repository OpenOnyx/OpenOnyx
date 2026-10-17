// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ calls: 0, chunks: 0, batches: [] as string[][], delay: null as null | (() => Promise<void>), disk: new Map<string, any>() }));
vi.mock('../src/utils/disk-store', () => ({
  readData: async (path: string) => fake.disk.get(path) || null,
  listData: async (path: string) => [...new Set([...fake.disk.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split('/')[0]))],
  deleteData: async (path: string) => { fake.disk.delete(path); },
  writeData: async (path: string, data: unknown) => { fake.disk.set(path, data); },
  createDebouncedWriter: () => Object.assign((path: string, data: unknown) => { fake.disk.set(path, data); }, { cancel: () => {}, flush: async () => {} }),
}));
vi.mock('../src/utils/embedding-worker-client', () => ({ embeddingWorkerClient: {
  ready: true, dispose: () => {}, invalidate: () => {},
  infer: async (texts: string[]) => {
    fake.calls++; fake.chunks += texts.length; fake.batches.push([...texts]);
    if (fake.delay) await fake.delay();
    const output = new Float32Array(texts.length * 384);
    for (let i = 0; i < texts.length; i++) output[i * 384 + (/dog|canine/.test(texts[i]) ? 1 : 0)] = 1;
    return output;
  },
} }));
import { chunkTextForEmbedding, embedNote, embeddingFileName, EMBEDDING_SCHEMA_VERSION, getEmbeddingGeneration, invalidateEmbeddingPath, loadStoreAsync, resetEmbeddingsStore, searchByQuery, simpleHash, type EmbeddingStore } from '../src/utils/embeddings';

beforeEach(() => {
  fake.disk.clear(); fake.calls = 0; fake.chunks = 0; fake.batches = []; fake.delay = null;
  resetEmbeddingsStore();
});

describe('embedding reliability and compatibility', () => {
  it('shares identical saves and retains the latest revision', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    await Promise.all(Array.from({ length: 10 }, () => embedNote(store, 'note.md', 'cat feline content')));
    expect(fake.calls).toBe(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fake.delay = () => gate;
    const old = embedNote(store, 'note.md', 'cat older revision');
    await vi.waitFor(() => expect(fake.calls).toBe(2));
    const latest = embedNote(store, 'note.md', 'dog canine latest revision');
    release();
    expect(await old).toBe(false);
    expect(await latest).toBe(true);
    expect(store.entries.get('note.md')!.hash).toBe(simpleHash('dog canine latest revision'));
  });

  it('combines independent note chunks into one bounded worker request', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    await Promise.all([
      embedNote(store, 'first.md', 'first independent note about woodland ecology'),
      embedNote(store, 'second.md', 'second independent note about distributed systems'),
    ]);
    expect(fake.calls).toBe(1);
    expect(fake.batches).toEqual([[expect.stringContaining('first independent'), expect.stringContaining('second independent')]]);
  });

  it('does not persist deleted notes or old-vault results', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); fake.delay = () => gate;
    const old = embedNote(store, 'old.md', 'old vault content');
    await vi.waitFor(() => expect(fake.calls).toBe(1));
    const generation = getEmbeddingGeneration(); resetEmbeddingsStore();
    expect(getEmbeddingGeneration()).toBeGreaterThan(generation);
    release(); expect(await old).toBe(false); expect(store.entries.size).toBe(0);
    fake.delay = null;
    const deleted = embedNote(store, 'deleted.md', 'deleted content');
    invalidateEmbeddingPath('deleted.md');
    expect(await deleted).toBe(false);
  });

  it('reuses paragraph chunks across edits, insertions, formatting, and restarts', async () => {
    let store: EmbeddingStore = { entries: new Map() };
    const content = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} discusses unique subject ${i} with examples and supporting reasoning.\n\n`).join('');
    await embedNote(store, 'long.md', content);
    const total = fake.chunks;
    expect(total).toBeGreaterThan(4);
    const edited = content.replace('unique subject 50', 'novel subject 50');
    await embedNote(store, 'long.md', edited);
    expect(fake.chunks - total).toBeLessThan(total / 2);
    const beforeInsert = fake.chunks;
    const inserted = edited.replace('Paragraph 60', 'An inserted paragraph adds detail.\n\nParagraph 60');
    await embedNote(store, 'long.md', inserted);
    expect(fake.chunks - beforeInsert).toBeLessThan(total / 2);
    const beforeFormatting = fake.chunks;
    await embedNote(store, 'long.md', `---\ntitle: Example\n---\n${inserted}`);
    expect(fake.chunks).toBe(beforeFormatting);
    resetEmbeddingsStore(); store = await loadStoreAsync();
    await embedNote(store, 'long.md', inserted.replace('subject 90', 'context 90'));
    expect(fake.chunks - beforeFormatting).toBeLessThan(total / 2);
  });

  it('keeps legacy schema-2 embeddings and recovers modern files without an index', async () => {
    const content = 'legacy compatible note';
    fake.disk.set('embeddings/legacy.json', { path: 'legacy.md', hash: simpleHash(content), vector: [1, 0], schemaVersion: EMBEDDING_SCHEMA_VERSION, updatedAt: 1 });
    const store = await loadStoreAsync();
    expect(await embedNote(store, 'legacy.md', content)).toBe(false);
    expect(fake.calls).toBe(0);
    await embedNote(store, 'a/b.md', 'cat content');
    await embedNote(store, 'a_b.md', 'dog content');
    expect(embeddingFileName('a/b.md')).not.toBe(embeddingFileName('a_b.md'));
    fake.disk.delete('embeddings/_index.json'); resetEmbeddingsStore();
    const loaded = await loadStoreAsync();
    expect(loaded.entries.has('a/b.md')).toBe(true);
    expect(loaded.entries.has('a_b.md')).toBe(true);
  });

  it('invalidates incompatible chunk identities without invalidating existing note vectors', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    const content = 'content about a cat '.repeat(150);
    await embedNote(store, 'version.md', content);
    const cache = fake.disk.get(`embedding-chunks/${embeddingFileName('version.md')}`);
    cache.identity = 'incompatible-model'; resetEmbeddingsStore();
    const loaded = await loadStoreAsync(); const prior = fake.chunks;
    await embedNote(loaded, 'version.md', `---\ntitle: Changed\n---\n${content}`);
    expect(fake.chunks - prior).toBe(new Set(chunkTextForEmbedding(content)).size);
  });

  it('preserves dimensions, normalization, chunk aggregation and search ranking', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    await embedNote(store, 'cat.md', 'cat feline subject');
    await embedNote(store, 'dog.md', 'dog canine subject');
    const vector = store.entries.get('cat.md')!.vector;
    expect(vector.length).toBe(384);
    expect(vector.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1);
    expect((await searchByQuery(store, 'cat feline question'))[0].path).toBe('cat.md');
    expect((await searchByQuery(store, 'dog canine question'))[0].path).toBe('dog.md');
  });
});
