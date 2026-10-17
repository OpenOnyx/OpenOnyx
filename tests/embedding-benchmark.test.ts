// @vitest-environment jsdom
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

const model = vi.hoisted(() => ({ calls: 0, chunks: 0 }));
vi.mock('../src/utils/embedding-worker-client', () => ({
  embeddingWorkerClient: {
    ready: true, invalidate: () => {}, dispose: () => {},
    infer: async (batch: string[]) => {
      model.calls++; model.chunks += batch.length;
      const start = performance.now();
      while (performance.now() - start < 0.15) { /* matched mocked baseline load */ }
      const data = new Float32Array(batch.length * 384);
      for (let i = 0; i < batch.length; i++) data[i * 384] = 1;
      return data;
    },
  },
}));
vi.mock('../src/utils/disk-store', () => ({
  readData: async () => null, listData: async () => [], deleteData: async () => {}, writeData: async () => {},
  createDebouncedWriter: () => Object.assign(() => {}, { cancel: () => {}, flush: async () => {} }),
}));

import { embedNote, resetEmbeddingsStore, type EmbeddingStore } from '../src/utils/embeddings';
const results: unknown[] = [];
beforeAll(() => { (window as any).electronAPI = {}; });
afterAll(() => {
  const output = process.env.EMBEDDING_BENCHMARK_OUTPUT;
  if (output) writeFileSync(output, JSON.stringify({ kind: 'mocked inference; jsdom event loop; no application runtime', results }, null, 2));
});

describe('reproducible embedding fixtures', () => {
  for (const count of [50, 500, 2000]) {
    it(`indexes ${count} notes and repeated long-note revisions`, async () => {
      resetEmbeddingsStore();
      model.calls = 0; model.chunks = 0;
      const store: EmbeddingStore = { entries: new Map() };
      let last = performance.now(); let maxDelay = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now(); maxDelay = Math.max(maxDelay, now - last - 5); last = now;
      }, 5);
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        const prose = `Note ${i} covers topic ${i} and deterministic knowledge relationships. `;
        await embedNote(store, `fixture-${i}.md`, prose.repeat(i % 10 === 0 ? 80 : 4), i, prose.length);
      }
      const durationMs = performance.now() - start;
      const indexingCalls = model.calls;
      const repeated = 'A repeated save containing identical deterministic content.';
      const prior = model.calls;
      await Promise.all(Array.from({ length: 10 }, () => embedNote(store, 'repeated.md', repeated)));
      const duplicateCalls = model.calls - prior;
      const long = Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: topic ${i} has several distinct concepts and examples.\n\n`).join('');
      await embedNote(store, 'long.md', long);
      const beforeEdit = model.chunks;
      await embedNote(store, 'long.md', long.replace('topic 50', 'theme 50'));
      const editedChunks = model.chunks - beforeEdit;
      clearInterval(heartbeat);
      results.push({ count, durationMs, notesPerSecond: count / durationMs * 1000, indexingCalls, duplicateCalls, editedChunks, maxMockEventLoopDelayMs: maxDelay });
    }, 30000);
  }
});
