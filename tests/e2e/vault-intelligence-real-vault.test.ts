// @vitest-environment jsdom

import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EMBEDDING_SCHEMA_VERSION,
  chunkTextForEmbedding,
  loadStore,
  resetEmbeddingsStore,
  seedLexicalEmbeddings,
} from "../../src/utils/embeddings";
import {
  getVaultRetrievalPlan,
  rankVaultPassages,
  type VaultRagDocument,
} from "../../src/utils/vault-rag";

const vaultRoot = process.env.OO_EVAL_VAULT;
const describeRealVault = vaultRoot ? describe : describe.skip;

const IGNORED_DIRECTORIES = new Set([".git", ".openonyx", ".trash", "node_modules"]);

async function collectMarkdownFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        paths.push(...await collectMarkdownFiles(root, path.join(current, entry.name)));
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      paths.push(path.relative(root, path.join(current, entry.name)).replace(/\\/g, "/"));
    }
  }
  return paths.sort();
}

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) =>
    items[Math.floor(index * items.length / limit)],
  );
}

describeRealVault("Vault Intelligence real-vault evaluation", () => {
  let documents: VaultRagDocument[] = [];

  beforeAll(async () => {
    const paths = await collectMarkdownFiles(vaultRoot!);
    documents = await Promise.all(paths.map(async (notePath) => ({
      path: notePath,
      content: await fs.readFile(path.join(vaultRoot!, notePath), "utf8"),
    })));
    seedLexicalEmbeddings(Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    ));
  }, 60_000);

  afterAll(() => {
    resetEmbeddingsStore();
  });

  it("evaluates a vault in the target 500–5,000 note range", () => {
    expect(documents.length).toBeGreaterThanOrEqual(500);
    expect(documents.length).toBeLessThanOrEqual(5000);
  });

  it("keeps the complete contents of long notes available to the embedding pipeline", () => {
    const longNotes = documents.filter((document) => document.content.length > 1500);
    const store = loadStore();
    expect(longNotes.length).toBeGreaterThan(0);

    for (const document of sampleEvenly(longNotes, 40)) {
      const chunks = chunkTextForEmbedding(document.content);
      const indexed = store.entries.get(document.path);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.at(-1)?.length).toBeGreaterThan(0);
      expect(indexed?.schemaVersion).toBe(EMBEDDING_SCHEMA_VERSION);
      expect(indexed?.segmentVectors?.length).toBeGreaterThan(1);
    }
  });

  it("retrieves real notes from title-derived questions with high recall", () => {
    const titleCounts = new Map<string, number>();
    for (const document of documents) {
      const title = path.basename(document.path, ".md").toLowerCase();
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    const candidates = documents.filter((document) => {
      const title = path.basename(document.path, ".md");
      const titleTerms = path.basename(document.path, ".md").split(/[_\-\s]+/).filter((term) => term.length > 3);
      return titleTerms.length >= 2 && titleCounts.get(title.toLowerCase()) === 1;
    });
    const queries = sampleEvenly(candidates, 32);
    let hits = 0;

    for (const target of queries) {
      const query = path.basename(target.path, ".md").replace(/[_-]+/g, " ");
      const plan = getVaultRetrievalPlan(documents.length, false);
      const results = rankVaultPassages(query, documents, plan.passageLimit, false);
      if (results.some((result) => result.path === target.path)) hits++;
    }

    const recall = queries.length > 0 ? hits / queries.length : 0;
    console.info(`[Vault Intelligence eval] ${documents.length} notes · title recall@adaptive=${recall.toFixed(3)}`);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it("builds a diverse broad-summary evidence set", () => {
    const plan = getVaultRetrievalPlan(documents.length, true);
    const results = rankVaultPassages(
      "Summarize the main ideas in this vault",
      documents,
      plan.passageLimit,
      true,
    );

    expect(results.length).toBe(plan.passageLimit);
    expect(new Set(results.map((result) => result.path)).size).toBe(results.length);
    console.info(`[Vault Intelligence eval] broad summary uses ${results.length} distinct notes`);
  }, 60_000);
});
