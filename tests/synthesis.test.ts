// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingStore } from "../src/utils/embeddings";
import {
  detectClusters,
  generateSynthesis,
  getInsightAnalysisLimit,
  parseSynthesisResponse,
  selectInsightAnalysisPaths,
} from "../src/utils/synthesis";
import { saveSettings } from "../src/utils/ai-settings";

function normalized(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / magnitude);
}

function storeFrom(entries: Array<[string, number[]]>): EmbeddingStore {
  return {
    entries: new Map(entries.map(([path, vector]) => [path, {
      path,
      hash: path,
      vector: normalized(vector),
      updatedAt: 1,
    }])),
  };
}

describe("synthesis intelligence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps distinct cohesive topics in separate clusters", () => {
    const store = storeFrom([
      ["Neural_Networks_Overview.md", [1, 0.05, 0]],
      ["Neural_Networks_Training.md", [0.98, 0.1, 0]],
      ["Transformer_Architecture.md", [0.96, 0.15, 0]],
      ["TCP_Overview.md", [0.02, 1, 0]],
      ["Routing_Algorithms.md", [0.08, 0.98, 0]],
      ["Wireless_Networks.md", [0.12, 0.96, 0]],
    ]);

    const clusters = detectClusters(store, 0.8, 3, 20);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => new Set(cluster.members))).toEqual(expect.arrayContaining([
      new Set(["Neural_Networks_Overview.md", "Neural_Networks_Training.md", "Transformer_Architecture.md"]),
      new Set(["TCP_Overview.md", "Routing_Algorithms.md", "Wireless_Networks.md"]),
    ]));
  });

  it("does not merge a transitive similarity chain into one topic", () => {
    const store = storeFrom([
      ["A.md", [1, 0]],
      ["Bridge.md", [0.8, 0.6]],
      ["C.md", [0.28, 0.96]],
    ]);

    const clusters = detectClusters(store, 0.7, 2, 20);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
  });

  it("does not cluster template-similar notes from unrelated vault areas", () => {
    const store = storeFrom([
      ["Computer_Networks/Transport_Layer/Transport_Layer_Overview.md", [1, 0.16, 0, 0]],
      ["Computer_Networks/Network_Layer/Network_Layer_Overview.md", [0.99, 0.18, 0, 0]],
      ["Computer_Networks/OSI_Model/OSI_Model_Interview_Questions.md", [0.98, 0.2, 0, 0]],
      ["Algorithms/Divide_and_Conquer/Divide_and_Conquer_Advanced_Concepts.md", [0.65, 0.76, 0, 0]],
      ["Distributed_Systems/MapReduce/MapReduce_Implementation_Details.md", [0.65, 0, 0.76, 0]],
      ["System_Design/Consistent_Hashing/Consistent_Hashing_Implementation_Details.md", [0.65, 0, 0, 0.76]],
    ]);

    const clusters = detectClusters(store, 0.55, 3, 20);

    expect(clusters).toHaveLength(1);
    expect(new Set(clusters[0].members)).toEqual(new Set([
      "Computer_Networks/Transport_Layer/Transport_Layer_Overview.md",
      "Computer_Networks/Network_Layer/Network_Layer_Overview.md",
      "Computer_Networks/OSI_Model/OSI_Model_Interview_Questions.md",
    ]));
  });

  it("scales insight analysis and samples across the complete index", () => {
    const entries = Array.from({ length: 5000 }, (_, index) => [
      `Area_${String(index).padStart(3, "0")}/Note_${index}.md`,
      [1, index / 1000, 0],
    ] as [string, number[]]);
    const store = storeFrom(entries);
    const limit = getInsightAnalysisLimit(store.entries.size);
    const selected = selectInsightAnalysisPaths(store, limit);

    expect(limit).toBeGreaterThan(120);
    expect(selected).toHaveLength(limit);
    expect(selected[0]).toBe("Area_000/Note_0.md");
    expect(selected.at(-1)).toMatch(/Note_49\d{2}\.md$/);
  });

  it("preserves the full structured explanation from an AI synthesis", () => {
    const parsed = parseSynthesisResponse(`INSIGHT:
### Shared idea
The notes share a concrete concern.

### Why these notes connect
- **Note A** supplies the mechanism.
- **Note B** shows the consequence.

### Topic recommendation
**Strong topic.** The evidence is cohesive.

CONFIDENCE: 0.82`);

    expect(parsed?.insight).toContain("### Why these notes connect");
    expect(parsed?.insight).toContain("Note B");
    expect(parsed?.confidence).toBe(0.82);
  });

  it("rejects model drafting text instead of exposing it as a synthesis", () => {
    expect(parseSynthesisResponse(
      "We need to cite the notes. The prompt requires a recommendation, so I should choose Related collection.",
    )).toBeNull();
  });

  it("removes preamble and retries malformed model output as structured Markdown", async () => {
    saveSettings({
      apiKey: "test-key",
      modelId: "mistralai/mistral-small-3.2-24b-instruct",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "We need to reason about the prompt before answering." } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: `Draft removed.
INSIGHT:
### Shared idea
Both notes support focused data-structure interview preparation.

### Why these notes connect
- **Disjoint_Set_Interview_Questions** covers connectivity problems.
- **Arrays_Interview_Questions** covers indexed collection problems.

### Topic recommendation
**Related collection.** They share a study purpose but cover distinct structures.

CONFIDENCE: 0.61` } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSynthesis([
      { title: "Disjoint_Set_Interview_Questions", content: "Union find connectivity components and path compression." },
      { title: "Arrays_Interview_Questions", content: "Two sum rotation indexing and contiguous ranges." },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.insight).toMatch(/^### Shared idea/);
    expect(result?.insight).not.toContain("Draft removed");
    expect(result?.insight).not.toContain("We need");
  });

  it("generates a fresh synthesis after the active model changes", async () => {
    const responseFor = (label: string) => new Response(JSON.stringify({
      choices: [{ message: { content: `INSIGHT:
### Shared idea
${label} produced the final comparison.

### Why these notes connect
- **Model_Scope_Note_A** supplies one perspective.
- **Model_Scope_Note_B** supplies another perspective.

### Topic recommendation
**Related collection.** The notes are useful together but remain distinct.

CONFIDENCE: 0.64` } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor("First model"))
      .mockResolvedValueOnce(responseFor("Second model"));
    vi.stubGlobal("fetch", fetchMock);
    const notes = [
      { title: "Model_Scope_Note_A", content: "Graph traversal queues breadth edges vertices." },
      { title: "Model_Scope_Note_B", content: "Transaction isolation locks commits rollback." },
    ];

    saveSettings({
      apiKey: "test-key",
      modelId: "mistralai/mistral-small-3.2-24b-instruct",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });
    expect((await generateSynthesis(notes))?.insight).toContain("First model");

    saveSettings({
      apiKey: "test-key",
      modelId: "nvidia/nemotron-3-super-120b-a12b:free",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });
    expect((await generateSynthesis(notes))?.insight).toContain("Second model");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
