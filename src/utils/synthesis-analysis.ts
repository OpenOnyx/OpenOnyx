import type { EmbeddingStore } from "./embeddings";
import { findSimilar } from "./embedding-vector-math";

export interface NoteCluster {
  center: string;
  members: string[];
  avgSimilarity: number;
  confidence: number; // 0-1 confidence that synthesis would be valuable
}

const GENERIC_NOTE_NAME_TERMS = new Set([
  "advanced", "concept", "concepts", "detail", "details", "implementation",
  "interview", "note", "notes", "overview", "question", "questions", "real",
  "use", "uses", "world",
]);

function pathParts(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function commonDirectoryDepth(paths: string[]): number {
  if (paths.length === 0) return 0;
  const directories = paths.map((path) => pathParts(path).slice(0, -1));
  const shortest = Math.min(...directories.map((parts) => parts.length));
  let depth = 0;
  while (
    depth < shortest
    && directories.every((parts) => parts[depth].toLowerCase() === directories[0][depth].toLowerCase())
  ) {
    depth++;
  }
  return depth;
}

function noteNameTerms(path: string): Set<string> {
  const filename = pathParts(path).at(-1)?.replace(/\.md$/i, "") || path;
  return new Set(
    filename
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 1 && !GENERIC_NOTE_NAME_TERMS.has(term)),
  );
}

function titleAffinity(leftPath: string, rightPath: string): number {
  const left = noteNameTerms(leftPath);
  const right = noteNameTerms(rightPath);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared++;
  return shared / Math.min(left.size, right.size);
}

/**
 * Embeddings from similarly structured study notes can overvalue shared prose
 * such as "overview" or "implementation details". Require more semantic
 * evidence when filenames and the vault's first meaningful folder disagree.
 */
function contextualSimilarity(
  leftPath: string,
  rightPath: string,
  semanticSimilarity: number,
  threshold: number,
  rootDepth: number,
): number {
  const leftDirectory = pathParts(leftPath).slice(0, -1);
  const rightDirectory = pathParts(rightPath).slice(0, -1);
  const leftCategory = leftDirectory[rootDepth]?.toLowerCase();
  const rightCategory = rightDirectory[rootDepth]?.toLowerCase();
  const foldersMatch = Boolean(leftCategory && rightCategory && leftCategory === rightCategory);
  const foldersConflict = Boolean(leftCategory && rightCategory && leftCategory !== rightCategory);
  const nameAffinity = titleAffinity(leftPath, rightPath);
  const contextSupport = Math.max(nameAffinity, foldersMatch ? 1 : 0);
  const missingContextPenalty = Math.min(0.12, Math.max(0.04, 0.26 * (1 - threshold)));
  // Crossing a top-level vault area (for example Algorithms -> Networking)
  // needs notably stronger semantic evidence than notes filed together.
  const folderConflictPenalty = foldersConflict ? 0.12 * (1 - nameAffinity) : 0;
  return semanticSimilarity
    - missingContextPenalty * (1 - contextSupport)
    - folderConflictPenalty;
}

export function getInsightAnalysisLimit(noteCount: number): number {
  if (noteCount <= 0) return 0;
  return Math.min(noteCount, Math.max(120, Math.min(240, Math.ceil(Math.sqrt(noteCount) * 3.4))));
}

export function selectInsightAnalysisPaths(
  store: EmbeddingStore,
  maxNodes = getInsightAnalysisLimit(store.entries.size),
): string[] {
  const paths = Array.from(store.entries.entries())
    .filter(([, entry]) => entry.vector.length > 0)
    .map(([path]) => path);
  if (paths.length <= maxNodes) return paths;
  return Array.from({ length: maxNodes }, (_, index) =>
    paths[Math.floor(index * paths.length / maxNodes)],
  );
}

/**
 * Detect clusters of semantically similar notes.
 * Includes a confidence score for synthesis potential.
 */
export function detectClusters(
  store: EmbeddingStore,
  threshold = 0.55,
  minClusterSize = 3,
  maxNodes = 60,
): NoteCluster[] {
  const uniquePaths: string[] = [];
  const seenTitles = new Set<string>();
  for (const [path, entry] of store.entries) {
    if (entry.vector.length === 0) continue;
    const title = path.split("/").pop()?.replace(/\.md$/i, "").toLowerCase().trim() || path;
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    uniquePaths.push(path);
  }

  // Sample evenly across the index instead of clustering only the first folder.
  const paths = uniquePaths.length <= maxNodes
    ? uniquePaths
    : Array.from({ length: maxNodes }, (_, index) =>
      uniquePaths[Math.floor(index * uniquePaths.length / maxNodes)],
    );
  if (paths.length < minClusterSize) return [];

  const rootDepth = commonDirectoryDepth(paths);
  const similarities = Array.from({ length: paths.length }, () =>
    Array<number>(paths.length).fill(0),
  );
  for (let i = 0; i < paths.length; i++) {
    similarities[i][i] = 1;
    const a = store.entries.get(paths[i])?.vector || [];
    for (let j = i + 1; j < paths.length; j++) {
      const b = store.entries.get(paths[j])?.vector || [];
      if (a.length === 0 || a.length !== b.length) continue;
      let similarity = 0;
      for (let k = 0; k < a.length; k++) similarity += a[k] * b[k];
      const contextual = contextualSimilarity(paths[i], paths[j], similarity, threshold, rootDepth);
      similarities[i][j] = contextual;
      similarities[j][i] = contextual;
    }
  }

  const averageCrossSimilarity = (left: number[], right: number[]): number => {
    let total = 0;
    let pairs = 0;
    for (const a of left) {
      for (const b of right) {
        total += similarities[a][b];
        pairs++;
      }
    }
    return pairs > 0 ? total / pairs : 0;
  };

  // Average-link clustering prevents a chain of weak pairwise matches from
  // turning unrelated notes into one oversized connected component.
  const maxClusterSize = 12;
  const groups: number[][] = paths.map((_, index) => [index]);
  while (groups.length > 1) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestSimilarity = threshold;

    for (let left = 0; left < groups.length; left++) {
      for (let right = left + 1; right < groups.length; right++) {
        if (groups[left].length + groups[right].length > maxClusterSize) continue;
        const similarity = averageCrossSimilarity(groups[left], groups[right]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestLeft = left;
          bestRight = right;
        }
      }
    }

    if (bestLeft === -1 || bestRight === -1) break;
    groups[bestLeft] = [...groups[bestLeft], ...groups[bestRight]];
    groups.splice(bestRight, 1);
  }

  const clusters: NoteCluster[] = [];
  for (const group of groups) {
    if (group.length < minClusterSize) continue;

    let totalSimilarity = 0;
    let pairCount = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        totalSimilarity += similarities[group[i]][group[j]];
        pairCount++;
      }
    }
    const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : threshold;

    let centerIndex = group[0];
    let strongestAverage = -Infinity;
    for (const candidate of group) {
      const others = group.filter((index) => index !== candidate);
      const average = others.reduce((sum, index) => sum + similarities[candidate][index], 0)
        / Math.max(1, others.length);
      if (average > strongestAverage) {
        strongestAverage = average;
        centerIndex = candidate;
      }
    }

    const sizeFactor = Math.min(1, group.length / 8);
    const confidence = Math.min(0.95, avgSimilarity * 0.8 + sizeFactor * 0.2);
    clusters.push({
      center: paths[centerIndex],
      members: group
        .sort((a, b) => similarities[centerIndex][b] - similarities[centerIndex][a])
        .map((index) => paths[index]),
      avgSimilarity,
      confidence,
    });
  }

  return clusters.sort((a, b) => b.confidence - a.confidence);
}

// ── Missing link suggestions ─────────────────────────────────────────────────

export interface MissingLinkSuggestion {
  from: string;
  to: string;
  similarity: number;
  reason: string;
}

/**
 * Detect pairs of notes that are semantically similar but not linked.
 */
export function detectMissingLinks(
  store: EmbeddingStore,
  noteContents: Map<string, string>,
  threshold = 0.4,
  maxResults = 10,
  maxNodes = getInsightAnalysisLimit(store.entries.size),
): MissingLinkSuggestion[] {
  const results: MissingLinkSuggestion[] = [];
  const seen = new Set<string>();

  const candidatePaths = selectInsightAnalysisPaths(store, maxNodes);
  const analysisStore: EmbeddingStore = {
    entries: new Map(candidatePaths.flatMap((path) => {
      const entry = store.entries.get(path);
      return entry ? [[path, entry] as const] : [];
    })),
  };
  for (const path of candidatePaths) {
    const content = noteContents.get(path) || "";
    const similar = findSimilar(analysisStore, path, threshold, 8);

    for (const { path: targetPath, similarity } of similar) {
      const key = [path, targetPath].sort().join("<>");
      if (seen.has(key)) continue;
      seen.add(key);

      const targetName = targetPath.split("/").pop()?.replace(/\.md$/, "") || "";
      const isLinked = content.includes(`[[${targetName}]]`);

      const sourceName = path.split("/").pop()?.replace(/\.md$/, "") || "";
      const targetContent = noteContents.get(targetPath) || "";
      const isReverseLinked = targetContent.includes(`[[${sourceName}]]`);

      if (!isLinked && !isReverseLinked) {
        results.push({
          from: path,
          to: targetPath,
          similarity,
          reason: `${Math.round(similarity * 100)}% similar but not linked`,
        });
      }
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}

// ── Unwritten insight detection ──────────────────────────────────────────────

export interface UnwrittenInsight {
  type: "bridge_gap" | "cluster_gap";
  description: string;
  relatedNotes: string[];
  confidence: number;
}

/**
 * Detect conceptual gaps — places where ideas are related but not connected.
 * Returns insights like "These ideas seem related but are not connected."
 */
export function detectUnwrittenInsights(
  store: EmbeddingStore,
  noteContents: Map<string, string>,
  threshold = 0.48,
  maxNodes = getInsightAnalysisLimit(store.entries.size),
  maxResults = 8,
): UnwrittenInsight[] {
  const insights: UnwrittenInsight[] = [];
  const clusters = detectClusters(store, 0.55, 3, maxNodes);

  // 1. Bridge gaps: notes with high similarity to multiple clusters
  const allPaths = Array.from(store.entries.keys());
  const paths = selectInsightAnalysisPaths(store, maxNodes);
  const rootDepth = commonDirectoryDepth(allPaths);
  for (const path of paths) {
    const clusterMemberships: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      const clusterSims = clusters[i].members
        .filter((m) => m !== path)
        .map((m) => {
          const entry = store.entries.get(path);
          const other = store.entries.get(m);
          if (!entry || !other) return 0;
          let dot = 0;
          for (let k = 0; k < entry.vector.length; k++) dot += entry.vector[k] * other.vector[k];
          return contextualSimilarity(path, m, dot, threshold, rootDepth);
        });
      const avgSim = clusterSims.length > 0
        ? clusterSims.reduce((a, b) => a + b, 0) / clusterSims.length
        : 0;
      if (avgSim > threshold) clusterMemberships.push(i);
    }

    // If a note bridges 2+ clusters, it's a potential connecting concept
    if (clusterMemberships.length >= 2 && !clusters.some((c) => c.members.includes(path))) {
      const relatedClusters = clusterMemberships.map((i) => clusters[i]);
      const centerNames = relatedClusters.slice(0, 2).map((c) => {
        const name = c.center.split("/").pop()?.replace(/\.md$/, "") || c.center;
        return name;
      });
      const additionalClusterCount = Math.max(0, relatedClusters.length - centerNames.length);
      const additionalClusters = additionalClusterCount > 0
        ? `, plus ${additionalClusterCount} related cluster${additionalClusterCount === 1 ? "" : "s"}`
        : "";
      insights.push({
        type: "bridge_gap",
        description: `This note could connect ${centerNames.join(" and ")}${additionalClusters}.`,
        relatedNotes: [...new Set([path, ...relatedClusters.slice(0, 2).flatMap((c) => c.members.slice(0, 2))])].slice(0, 4),
        confidence: 0.7,
      });
    }
  }

  // 2. Cluster gaps: clusters that are semantically close but unconnected
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i];
      const b = clusters[j];

      // Check if any cross-cluster links exist
      let hasLink = false;
      for (const pathA of a.members) {
        const contentA = noteContents.get(pathA) || "";
        for (const pathB of b.members) {
          const nameB = pathB.split("/").pop()?.replace(/\.md$/, "") || "";
          if (contentA.includes(`[[${nameB}]]`)) {
            hasLink = true;
            break;
          }
        }
        if (hasLink) break;
      }

      if (!hasLink) {
        // Check semantic distance between cluster centers
        const centerA = store.entries.get(a.center);
        const centerB = store.entries.get(b.center);
        if (centerA && centerB) {
          let dot = 0;
          for (let k = 0; k < centerA.vector.length; k++) {
            dot += centerA.vector[k] * centerB.vector[k];
          }
          const similarity = contextualSimilarity(
            a.center,
            b.center,
            dot,
            threshold,
            rootDepth,
          );
          if (similarity > threshold) {
            const nameA = a.center.split("/").pop()?.replace(/\.md$/, "") || "";
            const nameB = b.center.split("/").pop()?.replace(/\.md$/, "") || "";
            insights.push({
              type: "cluster_gap",
              description: `${nameA} and ${nameB} share themes but are not connected yet.`,
              relatedNotes: [a.center, b.center],
              confidence: Math.min(0.9, similarity),
            });
          }
        }
      }
    }
  }

  return insights.sort((a, b) => b.confidence - a.confidence).slice(0, maxResults);
}

