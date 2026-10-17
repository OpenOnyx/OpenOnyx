import type { EmbeddingStore, SimilarNote } from "./embeddings";

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function findSimilar(
  store: EmbeddingStore,
  notePath: string,
  threshold = 0.35,
  maxResults = 20,
): SimilarNote[] {
  const entry = store.entries.get(notePath);
  if (!entry || entry.vector.length === 0) return [];

  const activeTitle = notePath.split("/").pop()?.replace(/\.md$/, "").toLowerCase().trim();
  const seenTitles = new Set<string>();
  if (activeTitle) seenTitles.add(activeTitle);

  const results: SimilarNote[] = [];
  for (const [path, other] of store.entries) {
    if (path === notePath) continue;
    const title = path.split("/").pop()?.replace(/\.md$/, "").toLowerCase().trim() || "";
    if (!title || seenTitles.has(title)) continue;

    if (other.vector.length !== entry.vector.length) continue;
    const sim = cosineSimilarity(entry.vector, other.vector);
    if (sim >= threshold) {
      seenTitles.add(title);
      results.push({ path, similarity: sim });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, maxResults);
}

