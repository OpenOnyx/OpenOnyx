// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/ai-core", () => ({
  askAI: vi.fn(),
}));

import { askAI } from "../src/utils/ai-core";
import { answerVaultQuestion, type VaultCitation } from "../src/utils/vault-rag";

const passages: VaultCitation[] = [{
  id: 1,
  path: "Systems/Cache.md",
  title: "Cache",
  heading: "Eviction",
  startLine: 8,
  endLine: 8,
  excerpt: "LRU eviction removes the least recently used cache entry.",
  score: 1,
}];

describe("vault answer citation audit", () => {
  beforeEach(() => {
    vi.mocked(askAI).mockReset();
  });

  it("uses the audited answer when its cited evidence supports the claim", async () => {
    vi.mocked(askAI)
      .mockResolvedValueOnce("PostgreSQL coordinates every cache eviction. [1]")
      .mockResolvedValueOnce("LRU eviction removes the least recently used cache entry. [1]");

    const result = await answerVaultQuestion("How does LRU eviction work?", passages);

    expect(askAI).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain("least recently used");
    expect(result.answer).not.toContain("PostgreSQL");
  });

  it("falls back to source-faithful excerpts when neither model draft verifies", async () => {
    vi.mocked(askAI)
      .mockResolvedValueOnce("PostgreSQL coordinates every cache eviction. [1]")
      .mockResolvedValueOnce("Redis guarantees a 99% cache hit rate. [1]");

    const result = await answerVaultQuestion("How does LRU eviction work?", passages);

    expect(result.answer).toContain("## Verified passages");
    expect(result.answer).toContain("LRU eviction removes the least recently used cache entry.");
  });
});
