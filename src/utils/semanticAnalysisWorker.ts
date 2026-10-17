import { cosineSimilarity } from './embedding-vector-math';
import { detectClusters, detectMissingLinks, detectUnwrittenInsights } from './synthesis-analysis';
import type { AnalysisRequest, SimilarityPair } from './semantic-analysis';
import type { EmbeddingStore } from './embeddings';

const scope = self as unknown as { onmessage: (event: MessageEvent<{ id: number; request: AnalysisRequest }>) => void; postMessage: (data: unknown) => void };
scope.onmessage = ({ data: { id, request } }) => {
  try {
    if (request.type === 'pairs') {
      const pairs: SimilarityPair[] = [];
      for (let i = 0; i < request.entries.length; i++) {
        for (let j = i + 1; j < request.entries.length; j++) {
          pairs.push({ source: request.entries[i][0], target: request.entries[j][0], similarity: cosineSimilarity(request.entries[i][1], request.entries[j][1]) });
        }
      }
      pairs.sort((a, b) => b.similarity - a.similarity);
      scope.postMessage({ id, result: pairs });
    } else {
      const selected = new Map(request.entries);
      // Preserve full path order and sample selection without transferring all
      // vectors. Every vector consulted by the capped algorithms is included.
      const unused = new Array(request.entries[0]?.[1].length || 384).fill(0);
      const store: EmbeddingStore = { entries: new Map(request.paths.map((path) => [path, {
        path, hash: path, updatedAt: 0, vector: selected.has(path) ? Array.from(selected.get(path)!) : unused,
      }])) };
      const contents = new Map(request.contents);
      scope.postMessage({ id, result: {
        clusters: detectClusters(store, 0.55, 3, request.limit),
        missingLinks: detectMissingLinks(store, contents, 0.4, request.signalLimit, request.limit),
        insights: detectUnwrittenInsights(store, contents, 0.48, request.limit, request.signalLimit),
      } });
    }
  } catch (error) { scope.postMessage({ id, error: String(error) }); }
};
