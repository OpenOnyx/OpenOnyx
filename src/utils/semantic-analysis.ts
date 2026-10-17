import type { EmbeddingStore } from './embeddings';
import { getInsightAnalysisLimit, selectInsightAnalysisPaths, type NoteCluster, type MissingLinkSuggestion, type UnwrittenInsight } from './synthesis-analysis';

export interface SimilarityPair { source: string; target: string; similarity: number }
export interface InsightResult { clusters: NoteCluster[]; missingLinks: MissingLinkSuggestion[]; insights: UnwrittenInsight[] }
export type AnalysisRequest =
  | { type: 'pairs'; entries: Array<[string, Float64Array]> }
  | { type: 'insights'; paths: string[]; entries: Array<[string, Float64Array]>; contents: Array<[string, string]>; limit: number; signalLimit: number };

/** Copy only the bounded sample needed by the unchanged analysis algorithms. */
export function insightSnapshot(store: EmbeddingStore): { paths: string[]; entries: Array<[string, Float64Array]>; limit: number } {
  const limit = getInsightAnalysisLimit(store.entries.size);
  const selected = new Set(selectInsightAnalysisPaths(store, limit));
  const uniquePaths: string[] = [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const [path, entry] of store.entries) {
    if (!entry.vector.length) continue;
    paths.push(path);
    const title = path.split('/').pop()?.replace(/\.md$/i, '').toLowerCase().trim() || path;
    if (!seen.has(title)) { seen.add(title); uniquePaths.push(path); }
  }
  const clusterPaths = uniquePaths.length <= limit ? uniquePaths : Array.from({ length: limit }, (_, i) => uniquePaths[Math.floor(i * uniquePaths.length / limit)]);
  for (const path of clusterPaths) selected.add(path);
  return { paths, limit, entries: [...selected].map((path) => [path, new Float64Array(store.entries.get(path)!.vector)]) };
}

export class SemanticAnalysisClient {
  private worker?: Worker;
  private id = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  run<T extends SimilarityPair[] | InsightResult>(request: AnalysisRequest): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./semanticAnalysisWorker.ts', import.meta.url), { type: 'module', name: 'semantic-analysis' });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
      };
      this.worker.onerror = () => this.dispose();
      this.worker.onmessageerror = () => this.dispose();
    }
    // Call sites cancel superseded work, so requests never accumulate silently.
    if (this.pending.size >= 2) return Promise.reject(new Error('Semantic analysis queue is busy'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(), 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, request }, request.entries.map(([, vector]) => vector.buffer));
    });
  }
  dispose(): void {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Semantic analysis cancelled')); }
    this.pending.clear();
  }
}
