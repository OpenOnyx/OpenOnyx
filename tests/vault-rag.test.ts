// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  chunkMarkdown,
  collectMarkdownPaths,
  extractCitationIds,
  getVaultRetrievalPlan,
  rankVaultPassages,
  verifyCitationSupport,
} from "../src/utils/vault-rag";
import type { FileEntry } from "../src/types";

function entry(overrides: Partial<FileEntry> & Pick<FileEntry, "name" | "path">): FileEntry {
  return {
    absolutePath: `/vault/${overrides.path}`,
    isDirectory: false,
    extension: "",
    modifiedAt: 0,
    size: 0,
    ...overrides,
  };
}

describe("vault RAG citations", () => {
  it("collects Markdown notes from the live tree even when they are not embedded", () => {
    const tree = [
      entry({
        name: "Systems",
        path: "Systems",
        isDirectory: true,
        children: [
          entry({ name: "Cache.md", path: "Systems/Cache.md", extension: ".md" }),
          entry({ name: "Diagram.canvas", path: "Systems/Diagram.canvas", extension: ".canvas" }),
        ],
      }),
      entry({ name: "README.MD", path: "README.MD" }),
    ];

    expect(collectMarkdownPaths(tree)).toEqual(["Systems/Cache.md", "README.MD"]);
  });

  it("preserves headings and exact line ranges when chunking Markdown", () => {
    const passages = chunkMarkdown("Research/Cache.md", "# Cache\n\nIntro text.\n\n## Eviction\n\nLRU removes the least recently used item.");

    expect(passages).toEqual([
      expect.objectContaining({ heading: "Cache", startLine: 3, endLine: 3, excerpt: "Intro text." }),
      expect.objectContaining({ heading: "Eviction", startLine: 7, endLine: 7, excerpt: "LRU removes the least recently used item." }),
    ]);
  });

  it("ranks the passage containing the query terms above unrelated passages", () => {
    const results = rankVaultPassages("cache eviction policy", [
      { path: "Cooking.md", content: "# Soup\n\nAdd salt and water.", semanticScore: 0.1 },
      { path: "Systems/Cache.md", content: "# Cache\n\nAn LRU eviction policy removes the least recently used entry.", semanticScore: 0.4 },
    ]);

    expect(results[0]).toEqual(expect.objectContaining({ path: "Systems/Cache.md", heading: "Cache", id: 1 }));
    expect(results[0].excerpt).toContain("LRU eviction policy");
  });

  it("prioritizes an exact normalized note title over incidental body matches", () => {
    const results = rankVaultPassages("distributed transactions", [
      {
        path: "Glossary.md",
        content: "# Glossary\n\nDistributed transactions are mentioned repeatedly. Distributed transactions.",
      },
      {
        path: "Systems/Distributed_Transactions.md",
        content: "# Overview\n\nAtomic commits across services.",
      },
    ]);

    expect(results[0].path).toBe("Systems/Distributed_Transactions.md");
  });

  it("keeps identifier lookups focused on passages containing the identifier", () => {
    const results = rankVaultPassages("Where is DEEP_INDEX_SENTINEL: cobalt-orbit-7429-late-section-retrieval-check mentioned?", [
      {
        path: "TestNoteee.md",
        content: "# Test\n\nOpening content.\n\nDEEP_INDEX_SENTINEL: cobalt-orbit-7429-late-section-retrieval-check",
        semanticScore: 0.4,
      },
      {
        path: "Graphs_Implementation_Details.md",
        content: "# Graphs\n\nAdjacency matrices use O(V^2) space and adjacency lists use O(V + E).",
        semanticScore: 0.9,
      },
    ], 8);

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("TestNoteee.md");
    expect(results[0].excerpt).toContain("DEEP_INDEX_SENTINEL");
  });

  it("does not pad focused lexical questions with semantic-only passages", () => {
    const results = rankVaultPassages("who is volt", [
      { path: "Profile.md", content: "VOLT is a computer science student, developer and founder of OpenOnyx.", semanticScore: 0.3 },
      { path: "Test.md", content: "VOLT IS A SUPERHUMAN WHO EXISTS IN 2026.", semanticScore: 0.2 },
      { path: "Virtualization.md", content: "Virtualization creates isolated virtual machines.", semanticScore: 0.95 },
    ], 8);

    expect(results.map((result) => result.path)).toEqual(["Profile.md", "Test.md"]);
  });

  it("keeps broad summaries diverse across notes", () => {
    const results = rankVaultPassages("summarize the main ideas in this vault", [
      { path: "Algorithms.md", content: "# Algorithms\n\nGraphs and dynamic programming.", semanticScore: 0 },
      { path: "Databases.md", content: "# Databases\n\nIndexes and transactions.", semanticScore: 0 },
      { path: "Networks.md", content: "# Networks\n\nProtocols and routing.", semanticScore: 0 },
    ], 3, true);

    expect(new Set(results.map((result) => result.path)).size).toBe(3);
  });

  it("accepts only citation ids that exist in the supplied context", () => {
    expect(extractCitationIds("Claim [2]. Another [99]. Repeated [2] and [1].", 3)).toEqual([2, 1]);
    expect(extractCitationIds("Claim 【2】 and (Source 1).", 3)).toEqual([2, 1]);
  });

  it("scales retrieval breadth with the size of the vault", () => {
    const small = getVaultRetrievalPlan(100, true);
    const large = getVaultRetrievalPlan(5000, true);

    expect(large.candidateLimit).toBeGreaterThan(small.candidateLimit);
    expect(large.passageLimit).toBeGreaterThan(small.passageLimit);
    expect(large.candidateLimit).toBeLessThanOrEqual(1200);
  });

  it("rejects citations that do not support the attached claim", () => {
    const passages = rankVaultPassages("cache eviction", [
      {
        path: "Systems/Cache.md",
        content: "# Cache\n\nLRU eviction removes the least recently used cache entry.",
      },
    ]);

    expect(verifyCitationSupport(
      "LRU removes the least recently used cache entry. [1]",
      passages,
    ).valid).toBe(true);
    expect(verifyCitationSupport(
      "PostgreSQL uses serializable transactions for every cache operation. [1]",
      passages,
    )).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ reason: "unsupported-claim" }),
      ]),
    }));
  });

  it("rejects factual claims without citations and unsupported numbers", () => {
    const passages = rankVaultPassages("cache eviction", [
      {
        path: "Systems/Cache.md",
        content: "# Cache\n\nLRU eviction removes the least recently used cache entry.",
      },
    ]);

    expect(verifyCitationSupport("LRU is a cache eviction policy.", passages).issues[0]?.reason)
      .toBe("missing-citation");
    expect(verifyCitationSupport("LRU improves cache performance by 90%. [1]", passages).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ reason: "unsupported-number" })]));
  });
});
