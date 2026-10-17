import { describe, expect, it, vi } from 'vitest';
import { insightSnapshot } from '../src/utils/semantic-analysis';
import { detectClusters, detectMissingLinks, detectUnwrittenInsights } from '../src/utils/synthesis-analysis';
import type { EmbeddingStore } from '../src/utils/embeddings';

describe('off-thread semantic analysis compatibility', () => {
  it('preserves capped analysis with duplicate titles and bounded vector transfers', async () => {
    const store: EmbeddingStore = { entries: new Map() };
    for (let i = 0; i < 500; i++) {
      const group = i % 4;
      const vector = [0, 0, 0, 0]; vector[group] = 1;
      const path = `folder-${group}/Subject_${i % 300}.md`;
      store.entries.set(path, { path, hash: path, updatedAt: 0, vector });
    }
    const snapshot = insightSnapshot(store);
    expect(snapshot.entries.length).toBeLessThanOrEqual(snapshot.limit * 2);
    const contents = new Map([...store.entries.keys()].map((path) => [path, 'Example content.']));
    const sent: any[] = [];
    const scope = { onmessage: undefined as any, postMessage: (message: unknown) => sent.push(message) };
    vi.stubGlobal('self', scope);
    try {
      await import('../src/utils/semanticAnalysisWorker');
      scope.onmessage({ data: { id: 1, request: { type: 'insights', ...snapshot, contents: [...contents], signalLimit: 8 } } });
      expect(sent[0].result).toEqual({
        clusters: detectClusters(store, 0.55, 3, snapshot.limit),
        missingLinks: detectMissingLinks(store, contents, 0.4, 8, snapshot.limit),
        insights: detectUnwrittenInsights(store, contents, 0.48, snapshot.limit, 8),
      });
      scope.onmessage({ data: { id: 2, request: { type: 'pairs', entries: [['a', new Float64Array([1, 0])], ['b', new Float64Array([0.5, Math.sqrt(0.75)])]] } } });
      expect(sent[1]).toEqual({ id: 2, result: [{ source: 'a', target: 'b', similarity: 0.5 }] });
    } finally { vi.unstubAllGlobals(); }
  });
});
