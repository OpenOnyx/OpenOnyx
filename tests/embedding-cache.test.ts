// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@xenova/transformers';
import {
  chunkTextForEmbedding,
  EMBEDDING_SCHEMA_VERSION,
  EMBEDDING_UPDATED_EVENT,
  embedNote,
  getRemoteEmbeddingModelSubpath,
  isLexicalFallbackActive,
  refreshEmbeddingMetadataIfUnchanged,
  resetEmbeddingsStore,
  resolveTransformersWasmPath,
  searchByQuery,
  seedLexicalEmbeddings,
  simpleHash,
  type EmbeddingStore,
} from '../src/utils/embeddings';

beforeEach(() => {
  resetEmbeddingsStore();
  (window as any).electronAPI = {
    dataRead: vi.fn(async () => null),
    dataWrite: vi.fn(async () => {}),
    dataDelete: vi.fn(async () => {}),
    dataList: vi.fn(async () => []),
  };
});

describe('embedding cache metadata refresh', () => {
  it('uses the disk-cached remote model configuration with WASM runtime path', () => {
    expect(env.allowLocalModels).toBe(false);
    expect(env.allowRemoteModels).toBe(true);
    expect(env.useBrowserCache).toBe(false);
    expect(env.backends.onnx.wasm.proxy).toBe(false);
    expect(env.backends.onnx.wasm.wasmPaths).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@xenova\/transformers@/);
  });

  it('resolves WASM assets beside index.html in dev and packaged builds', () => {
    expect(resolveTransformersWasmPath('2.17.2', 'http://localhost:5173/index.html', false))
      .toBe('http://localhost:5173/wasm/');
    expect(resolveTransformersWasmPath('2.17.2', 'file:///opt/OpenOnyx/resources/app.asar/dist/index.html', false))
      .toBe('file:///opt/OpenOnyx/resources/app.asar/dist/wasm/');
  });

  it('only caches model files fetched from the remote model host', () => {
    expect(getRemoteEmbeddingModelSubpath(
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
    )).toBe('tokenizer.json');
    expect(getRemoteEmbeddingModelSubpath(
      'http://localhost:5173/models/Xenova/all-MiniLM-L6-v2/tokenizer.json',
    )).toBeNull();
  });

  it('updates cached file metadata without re-embedding unchanged content', () => {
    const content = '# Cached note\n\nSame content.';
    const store: EmbeddingStore = {
      entries: new Map([
        [
          'Cached.md',
          {
            path: 'Cached.md',
            hash: simpleHash(content),
            vector: [0.1, 0.2, 0.3],
            segmentVectors: [[0.1, 0.2, 0.3]],
            schemaVersion: EMBEDDING_SCHEMA_VERSION,
            updatedAt: 100,
            modifiedAt: 1000,
            size: 12,
          },
        ],
      ]),
    };

    const refreshed = refreshEmbeddingMetadataIfUnchanged(
      store,
      'Cached.md',
      content,
      2000,
      content.length,
    );

    expect(refreshed).toBe(true);
    expect(store.entries.get('Cached.md')).toMatchObject({
      hash: simpleHash(content),
      vector: [0.1, 0.2, 0.3],
      modifiedAt: 2000,
      size: content.length,
    });
  });

  it('does not refresh metadata when content changed', () => {
    const store: EmbeddingStore = {
      entries: new Map([
        [
          'Changed.md',
          {
            path: 'Changed.md',
            hash: simpleHash('old content'),
            vector: [0.1, 0.2, 0.3],
            updatedAt: 100,
            modifiedAt: 1000,
            size: 11,
          },
        ],
      ]),
    };

    const refreshed = refreshEmbeddingMetadataIfUnchanged(
      store,
      'Changed.md',
      'new content',
      2000,
      11,
    );

    expect(refreshed).toBe(false);
    expect(store.entries.get('Changed.md')?.modifiedAt).toBe(1000);
  });

  it('indexes the complete note instead of truncating after the opening section', () => {
    const marker = 'late-section-unique-concept';
    const chunks = chunkTextForEmbedding(`${'opening material '.repeat(180)} ${marker}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.includes(marker))).toBe(true);
  });

  it('forces legacy single-vector entries to be re-indexed', () => {
    const content = '# Legacy note\n\nContent that previously used only the opening section.';
    const store: EmbeddingStore = {
      entries: new Map([
        ['Legacy.md', {
          path: 'Legacy.md',
          hash: simpleHash(content),
          vector: [0.1, 0.2, 0.3],
          updatedAt: 100,
        }],
      ]),
    };

    expect(refreshEmbeddingMetadataIfUnchanged(store, 'Legacy.md', content, 200, content.length))
      .toBe(false);
  });

  it('does not initialize an embedding backend when there are no indexed notes', async () => {
    const results = await searchByQuery({ entries: new Map() }, 'first question');

    expect(results).toEqual([]);
    expect(isLexicalFallbackActive()).toBe(false);
  });

  it('notifies live intelligence views after an index entry changes', async () => {
    seedLexicalEmbeddings({});
    const listener = vi.fn();
    window.addEventListener(EMBEDDING_UPDATED_EVENT, listener);

    await embedNote({ entries: new Map() }, 'Fresh.md', 'A newly indexed knowledge note.');

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'Fresh.md' });
    window.removeEventListener(EMBEDDING_UPDATED_EVENT, listener);
  });
});
