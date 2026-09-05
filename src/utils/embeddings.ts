/**
 * Embeddings — Local semantic embeddings via Transformers.js
 *
 * Storage: .openonyx/embeddings/ (one JSON file per note, NOT localStorage)
 * Index:   .openonyx/embeddings/_index.json (path→hash map for quick checks)
 *
 * Features:
 *  - Auto-embeds notes on create/update (hash-based change detection)
 *  - Cosine similarity for finding related notes
 *  - Disk-backed with in-memory cache (scales to 1000+ notes)
 *  - Query embedding for RAG retrieval
 *  - Suggestion tracking with temporal weighting
 */

import { readData, writeData, listData, deleteData, createDebouncedWriter } from "./disk-store";

type FeatureExtractionPipeline = any;

export function configureTransformersEnv(env: any) {
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  if ("useBrowserCache" in env) {
    (env as any).useBrowserCache = true;
  }

  // Electron/Browser compatibility fixes for @xenova/transformers v2.
  // Force the WASM backend and disable Node.js-specific backends.
  if (env.backends?.onnx?.wasm) {
    const wasm = env.backends.onnx.wasm as {
      proxy?: boolean;
      wasmPaths?: string;
    };
    wasm.proxy = false;
    wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${env.version}/dist/`;
  }
}

let _transformers: typeof import("@xenova/transformers") | null = null;

if (process.env.NODE_ENV === "test") {
  const mod = await import("@xenova/transformers");
  configureTransformersEnv(mod.env);
  _transformers = mod;
}

async function getTransformers() {
  if (_transformers) return _transformers;
  const mod = await import("@xenova/transformers");
  configureTransformersEnv(mod.env);
  _transformers = mod;
  return mod;
}

// Fetch interceptor to cache Transformers.js model files locally in Electron
if (
  typeof window !== "undefined" &&
  (window as any).electronAPI &&
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "test"
) {
  const originalFetch = window.fetch;

  const getModelSubpath = (url: string): string | null => {
    const marker = "Xenova/all-MiniLM-L6-v2/";
    const index = url.indexOf(marker);
    if (index === -1) return null;
    let sub = url.substring(index + marker.length);
    if (sub.startsWith("resolve/main/")) {
      sub = sub.substring("resolve/main/".length);
    }
    return sub;
  };

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const subpath = getModelSubpath(url);

    if (subpath) {
      const localPath = `.openonyx/models/Xenova/all-MiniLM-L6-v2/${subpath}`;
      try {
        const exists = await (window as any).electronAPI.fileExists(localPath);
        if (exists) {
          if (subpath.endsWith(".json")) {
            const content = await (window as any).electronAPI.readFile(localPath);
            if (content !== null) {
              return new Response(content, {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
          } else if (subpath.endsWith(".onnx")) {
            const content = await (window as any).electronAPI.readBinary(localPath);
            if (content && content.length > 0) {
              return new Response(content, {
                status: 200,
                headers: { "Content-Type": "application/octet-stream" }
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Embeddings Cache] Failed to read local cached file ${localPath}:`, err);
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return new Response("Offline and model file not cached", {
          status: 503,
          statusText: "Service Unavailable"
        });
      }

      try {
        const response = await originalFetch(input, init);
        if (response.ok) {
          const clone = response.clone();
          if (subpath.endsWith(".json")) {
            clone.text().then(text => {
              (window as any).electronAPI.writeFile(localPath, text).catch((err: any) => {
                console.warn(`[Embeddings Cache] Failed to cache JSON file ${localPath}:`, err);
              });
            });
          } else if (subpath.endsWith(".onnx")) {
            clone.arrayBuffer().then(buffer => {
              (window as any).electronAPI.writeBinary(localPath, new Uint8Array(buffer)).catch((err: any) => {
                console.warn(`[Embeddings Cache] Failed to cache binary file ${localPath}:`, err);
              });
            });
          }
        }
        return response;
      } catch (err) {
        console.error(`[Embeddings Cache] Fetch failed for ${url}:`, err);
        throw err;
      }
    }

    return originalFetch(input, init);
  };
}

// ── Model singleton ──────────────────────────────────────────────────────────

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

let _pipeline: FeatureExtractionPipeline | null = null;
let _loadingPromise: Promise<FeatureExtractionPipeline> | null = null;
let _loadProgress = 0;
let _disabledReason: string | null = null;

type ProgressCallback = (progress: number, status: string) => void;
let _onProgress: ProgressCallback | null = null;

export function setProgressCallback(cb: ProgressCallback | null): void {
  _onProgress = cb;
}

export function getLoadProgress(): number {
  return _loadProgress;
}

export function getEmbeddingDisabledReason(): string | null {
  return _disabledReason;
}

export function isLexicalFallbackActive(): boolean {
  return _disabledReason !== null;
}

export function isSemanticEmbeddingAvailable(): boolean {
  return _pipeline !== null;
}

let _embeddingsAvailable = typeof navigator !== "undefined" ? navigator.onLine : true;

export async function isModelCached(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if ((window as any).electronAPI) {
    try {
      return await (window as any).electronAPI.fileExists(".openonyx/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx");
    } catch {
      return false;
    }
  }

  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open("transformers-cache");
      const keys = await cache.keys();
      return keys.some(key => key.url.includes("model_quantized.onnx"));
    }
  } catch {
    return false;
  }
  return false;
}

export async function updateAvailability(): Promise<void> {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (!online) {
    const cached = await isModelCached();
    _embeddingsAvailable = cached;
  } else {
    _embeddingsAvailable = true;
  }
}

if (typeof window !== "undefined") {
  updateAvailability();

  window.addEventListener("online", () => {
    _embeddingsAvailable = true;
  });

  window.addEventListener("offline", async () => {
    _embeddingsAvailable = await isModelCached();
  });
}

export function areEmbeddingsAvailable(): boolean {
  return _embeddingsAvailable;
}

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      _loadProgress = 10;
      _onProgress?.(10, "Loading analysis engine...");
      
      // Explicitly catch pipeline errors
      const { pipeline } = await getTransformers();
      const p = await pipeline("feature-extraction", MODEL_ID).catch(err => {
        console.warn("[Embeddings] Pipeline creation failed; using local fallback analysis for this session:", err);
        throw err;
      });

      if (!p) throw new Error("Pipeline creation returned null");

      _loadProgress = 100;
      _disabledReason = null;
      _onProgress?.(100, "Model ready");
      _pipeline = p as FeatureExtractionPipeline;
      _loadingPromise = null;
      return _pipeline;
    } catch (err) {
      _loadingPromise = null;
      _loadProgress = 0;
      _disabledReason = err instanceof Error ? err.message : "Analysis engine failed to load";
      _onProgress?.(100, "Using keyword search (semantic model not loaded)");
      throw err;
    }
  })();

  return _loadingPromise;
}

export function isModelLoaded(): boolean {
  return _pipeline !== null;
}

// ── Markdown stripping ───────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^---[\s\S]*?---\s*/m, "")        // YAML frontmatter
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // wiki links
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // markdown links
    .replace(/```[\s\S]*?```/g, "")             // code blocks
    .replace(/`[^`]+`/g, "")                    // inline code
    .replace(/^#{1,6}\s+/gm, "")               // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")   // bold/italic
    .replace(/<[^>]+>/g, "")                    // HTML
    .replace(/^\s*[-*+]\s+/gm, "")             // lists
    .replace(/^\s*\d+\.\s+/gm, "")             // numbered lists
    .replace(/^>\s*/gm, "")                     // blockquotes
    .replace(/\s+/g, " ")
    .trim();
}

// ── Hashing ──────────────────────────────────────────────────────────────────

export function simpleHash(text: string | null | undefined): string {
  const source = typeof text === "string" ? text : "";
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) - h + source.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ── Embedding generation ─────────────────────────────────────────────────────

function hashNumber(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addHashedFeature(vector: number[], feature: string, weight: number): void {
  const hash = hashNumber(feature);
  const index = hash % EMBEDDING_DIM;
  const sign = hash & 1 ? 1 : -1;
  vector[index] += sign * weight;
}

const EMBEDDING_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "not", "no", "nor",
  "this", "that", "these", "those", "it", "its", "they", "them", "their",
  "you", "your", "we", "our", "he", "she", "him", "her", "my", "me",
  "what", "which", "who", "whom", "how", "when", "where", "why",
  "if", "then", "else", "so", "as", "than", "very", "just", "also",
  "about", "up", "out", "all", "some", "any", "each", "every", "both",
  "more", "most", "other", "into", "over", "after", "before", "between",
  "through", "during", "without", "within", "along", "around", "like",
  "here", "there", "now", "still", "already", "even", "much", "many",
  "well", "back", "only", "such", "make", "use", "using", "used",
  "one", "two", "three", "new", "old", "first", "last", "next", "same",
]);

function lexicalEmbedText(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !EMBEDDING_STOP_WORDS.has(token))
    .slice(0, 320);

  if (tokens.length === 0) return vector;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    addHashedFeature(vector, `w:${token}`, 1.0);

    if (i > 0) {
      addHashedFeature(vector, `b:${tokens[i - 1]}_${token}`, 0.6);
    }
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function hasVectorSignal(vector: number[] | undefined): boolean {
  return Array.isArray(vector) && vector.some((value) => Math.abs(value) > 1e-8);
}

export async function embedText(text: string | null | undefined): Promise<number[]> {
  const clean = stripMarkdown(typeof text === "string" ? text : "").substring(0, 1500);
  if (clean.length < 5) {
    return new Array(EMBEDDING_DIM).fill(0);
  }

  if (_disabledReason) {
    return lexicalEmbedText(clean);
  }

  try {
    const embedder = await getEmbedder();
    const output = await embedder(clean, { pooling: "mean", normalize: true });
    if (!output?.data) {
      return lexicalEmbedText(clean);
    }
    return Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
  } catch {
    return lexicalEmbedText(clean);
  }
}

// ── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ── Embedding store (in-memory cache + disk persistence) ─────────────────────

export interface StoredEmbedding {
  path: string;
  hash: string;
  vector: number[];
  updatedAt: number;
  modifiedAt?: number;
  size?: number;
}

export interface EmbeddingStore {
  entries: Map<string, StoredEmbedding>;
}

// Index: maps path → hash (lightweight, loaded first for quick change detection)
interface EmbeddingIndex {
  [path: string]: { hash: string; updatedAt: number };
}

// In-memory cache (loaded lazily from disk)
let _memoryStore: EmbeddingStore = { entries: new Map() };
let _isLoaded = false;
let _isLoading = false;
let _loadPromise: Promise<void> | null = null;

// Debounced writer to batch disk writes
const _debouncedWrite = createDebouncedWriter(1000);

/**
 * Ensure embeddings are loaded from disk into memory.
 */
async function ensureLoaded(): Promise<void> {
  if (_isLoaded) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    _isLoading = true;
    try {
      // Load individual embedding files. Older or interrupted writes may have
      // entry files without a fresh index, so the files are the source of truth.
      const files = await listData("embeddings");
      for (const file of files) {
        if (file === "_index.json") continue;
        if (!file.endsWith(".json")) continue;
        try {
          const entry = await readData<StoredEmbedding>(`embeddings/${file}`);
          if (entry && entry.path && entry.vector) {
            _memoryStore.entries.set(entry.path, entry);
          }
        } catch { /* skip corrupt files */ }
      }
    } catch (err) {
      console.warn("[Embeddings] Failed to load from disk:", err);
      // Try fallback from localStorage (migration)
      tryMigrateFromLocalStorage();
    }
    _isLoaded = true;
    _isLoading = false;
  })();

  return _loadPromise;
}

/**
 * Migrate existing localStorage embeddings to disk (one-time).
 */
function tryMigrateFromLocalStorage(): void {
  try {
    const raw = localStorage.getItem("openonyx-embeddings-v2");
    if (!raw) return;
    const data: { entries: StoredEmbedding[] } = JSON.parse(raw);
    for (const e of data.entries) {
      _memoryStore.entries.set(e.path, e);
    }
    // Persist to disk
    persistAllToDisk();
    // Remove from localStorage after migration
    localStorage.removeItem("openonyx-embeddings-v2");
    console.log(`[Embeddings] Migrated ${data.entries.length} entries from localStorage to disk`);
  } catch { /* silent */ }
}

/**
 * Write all embeddings to disk (used during migration or bulk operations).
 */
async function persistAllToDisk(): Promise<void> {
  const index: EmbeddingIndex = {};
  for (const [path, entry] of _memoryStore.entries) {
    const safeName = path.replace(/[/\\]/g, "_").replace(/\.md$/, "") + ".json";
    index[path] = { hash: entry.hash, updatedAt: entry.updatedAt };
    await writeData(`embeddings/${safeName}`, entry);
  }
  await writeData("embeddings/_index.json", index);
}

/**
 * Persist a single embedding entry to disk.
 */
function persistEntry(entry: StoredEmbedding): void {
  const safeName = entry.path.replace(/[/\\]/g, "_").replace(/\.md$/, "") + ".json";
  _debouncedWrite(`embeddings/${safeName}`, entry);

  // Also update index (debounced)
  const index: EmbeddingIndex = {};
  for (const [p, e] of _memoryStore.entries) {
    index[p] = { hash: e.hash, updatedAt: e.updatedAt };
  }
  _debouncedWrite("embeddings/_index.json", index);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the embedding store (returns in-memory cache, loading from disk if needed).
 */
export function loadStore(): EmbeddingStore {
  if (!_isLoaded && !_isLoading) {
    // Trigger async load but return what we have
    ensureLoaded();
  }
  return _memoryStore;
}

/**
 * Explicitly load from disk (async version).
 */
export async function loadStoreAsync(): Promise<EmbeddingStore> {
  await ensureLoaded();
  return _memoryStore;
}

export function saveStore(_store: EmbeddingStore): void {
  // No-op — individual entries are persisted via persistEntry
  // This maintains backward API compatibility
}

export function resetEmbeddingsStore(): void {
  _memoryStore = { entries: new Map() };
  _isLoaded = false;
  _isLoading = false;
  _loadPromise = null;
  _disabledReason = null;
}

/** Seed the in-memory store with the app's lexical fallback — no model download. */
export function seedLexicalEmbeddings(files: Record<string, string>): number {
  _disabledReason = "website-lexical";
  _isLoaded = true;
  _isLoading = false;
  _loadPromise = null;
  _memoryStore = { entries: new Map() };
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    const source = typeof content === "string" ? content : "";
    const clean = stripMarkdown(source).substring(0, 1500);
    const vector = clean.length < 5 ? new Array(EMBEDDING_DIM).fill(0) : lexicalEmbedText(clean);
    _memoryStore.entries.set(path, {
      path,
      hash: simpleHash(source),
      vector,
      updatedAt: Date.now(),
      modifiedAt: Date.now(),
      size: source.length,
    });
  }
  return _memoryStore.entries.size;
}

/**
 * Embed a note if its content has changed.
 */
export async function embedNote(
  store: EmbeddingStore,
  path: string,
  content: string | null | undefined,
  modifiedAt?: number,
  size?: number,
): Promise<boolean> {
  const source = typeof content === "string" ? content : "";
  const hash = simpleHash(source);
  const existing = store.entries.get(path);

  if (existing && existing.hash === hash) {
    const cleanLength = stripMarkdown(source).length;
    if (cleanLength < 5 || hasVectorSignal(existing.vector)) return false;
  }

  const vector = await embedText(source);
  const entry: StoredEmbedding = {
    path,
    hash,
    vector,
    updatedAt: Date.now(),
    modifiedAt: modifiedAt ?? Date.now(),
    size: size ?? source.length,
  };
  store.entries.set(path, entry);
  _memoryStore.entries.set(path, entry);

  // Persist to disk (debounced)
  persistEntry(entry);

  return true;
}

/**
 * Refresh stored filesystem metadata when the note content hash still matches.
 * This avoids re-running embeddings when only mtime precision or stat metadata
 * changed across app/vault loads.
 */
export function refreshEmbeddingMetadataIfUnchanged(
  store: EmbeddingStore,
  path: string,
  content: string,
  modifiedAt?: number,
  size?: number,
): boolean {
  const existing = store.entries.get(path);
  if (!existing || existing.hash !== simpleHash(content)) return false;

  const nextModifiedAt = modifiedAt ?? existing.modifiedAt;
  const nextSize = size ?? existing.size;
  if (existing.modifiedAt === nextModifiedAt && existing.size === nextSize) {
    return true;
  }

  const updated: StoredEmbedding = {
    ...existing,
    modifiedAt: nextModifiedAt,
    size: nextSize,
    updatedAt: Date.now(),
  };
  store.entries.set(path, updated);
  _memoryStore.entries.set(path, updated);
  persistEntry(updated);
  return true;
}

/**
 * Remove an embedding (when note is deleted).
 */
export function removeEmbedding(store: EmbeddingStore, path: string): void {
  store.entries.delete(path);
  _memoryStore.entries.delete(path);

  const safeName = path.replace(/[/\\]/g, "_").replace(/\.md$/, "") + ".json";
  deleteData(`embeddings/${safeName}`);

  // Update index
  const index: EmbeddingIndex = {};
  for (const [p, e] of _memoryStore.entries) {
    index[p] = { hash: e.hash, updatedAt: e.updatedAt };
  }
  _debouncedWrite("embeddings/_index.json", index);
}

/**
 * Rename/move a single embedding path without re-embedding content.
 */
export function renameEmbeddingPath(
  store: EmbeddingStore,
  oldPath: string,
  newPath: string,
): boolean {
  if (oldPath === newPath) return false;

  const existing = store.entries.get(oldPath);
  if (!existing) return false;

  const oldSafeName = oldPath.replace(/[/\\]/g, "_").replace(/\.md$/, "") + ".json";
  deleteData(`embeddings/${oldSafeName}`);

  const updated: StoredEmbedding = {
    ...existing,
    path: newPath,
    updatedAt: Date.now(),
  };

  store.entries.delete(oldPath);
  _memoryStore.entries.delete(oldPath);
  store.entries.set(newPath, updated);
  _memoryStore.entries.set(newPath, updated);

  persistEntry(updated);
  return true;
}

/**
 * Rename/move all embeddings within a directory prefix.
 */
export function renameEmbeddingsByPrefix(
  store: EmbeddingStore,
  oldPrefix: string,
  newPrefix: string,
): number {
  if (!oldPrefix || oldPrefix === newPrefix) return 0;

  const normalizedOldPrefix = oldPrefix.endsWith("/") ? oldPrefix : `${oldPrefix}/`;
  const normalizedNewPrefix = newPrefix.endsWith("/") ? newPrefix : `${newPrefix}/`;

  let moved = 0;
  const entries = Array.from(store.entries.values());
  for (const entry of entries) {
    const path = entry.path;
    if (!(path === oldPrefix || path.startsWith(normalizedOldPrefix))) continue;

    const nextPath = path === oldPrefix
      ? newPrefix
      : `${normalizedNewPrefix}${path.slice(normalizedOldPrefix.length)}`;

    if (renameEmbeddingPath(store, path, nextPath)) {
      moved += 1;
    }
  }

  return moved;
}

/**
 * Remove all embeddings within a directory prefix.
 */
export function removeEmbeddingsByPrefix(
  store: EmbeddingStore,
  prefix: string,
): number {
  if (!prefix) return 0;

  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const paths = Array.from(store.entries.keys()).filter(
    (path) => path === prefix || path.startsWith(normalizedPrefix),
  );

  for (const path of paths) {
    removeEmbedding(store, path);
  }

  return paths.length;
}

// ── Similarity search ────────────────────────────────────────────────────────

export interface SimilarNote {
  path: string;
  similarity: number;
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

export async function searchByQuery(
  store: EmbeddingStore,
  query: string,
  maxResults = 8,
): Promise<SimilarNote[]> {
  const queryVec = await embedText(query);
  const results: SimilarNote[] = [];

  for (const [path, entry] of store.entries) {
    if (entry.vector.length !== queryVec.length) continue;
    const sim = cosineSimilarity(queryVec, entry.vector);
    if (sim > 0.15) {
      results.push({ path, similarity: sim });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, maxResults);
}

// ── Suggestion tracking ──────────────────────────────────────────────────────

export interface SuggestionRecord {
  sourcePath: string;
  targetPath: string;
  action: "accepted" | "rejected" | "ignored";
  timestamp: number;
}

export interface TransitionMap {
  [concept: string]: Record<string, number>;
}

// Suggestion history is small — keep in localStorage for now
const SUGGESTION_HISTORY_KEY = "openonyx-suggestion-history-v1";
const TRANSITION_MAP_KEY = "openonyx-suggestion-transitions-v1";

function normalizeTransitionConcept(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function saveTransitionMap(map: TransitionMap): void {
  try {
    localStorage.setItem(TRANSITION_MAP_KEY, JSON.stringify(map));
  } catch {
    // Ignore persistence failures so suggestions remain functional.
  }
}

export function loadTransitionMap(): TransitionMap {
  try {
    const raw = localStorage.getItem(TRANSITION_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as TransitionMap;
  } catch {
    return {};
  }
}

export function recordTransition(fromConcept: string, toConcept: string): void {
  const from = normalizeTransitionConcept(fromConcept);
  const to = normalizeTransitionConcept(toConcept);
  if (!from || !to || from === to) return;

  const map = loadTransitionMap();
  if (!map[from]) map[from] = {};
  map[from][to] = (map[from][to] || 0) + 1;

  const entries = Object.entries(map[from]).sort((a, b) => b[1] - a[1]);
  map[from] = Object.fromEntries(entries.slice(0, 24));

  saveTransitionMap(map);
}

export function getTransitionBoost(
  fromConcept: string,
  candidateConcepts: string[],
): number {
  const from = normalizeTransitionConcept(fromConcept);
  if (!from || candidateConcepts.length === 0) return 0;

  const map = loadTransitionMap();
  const transitions = map[from];
  if (!transitions) return 0;

  const normalizedCandidates = candidateConcepts
    .map((concept) => normalizeTransitionConcept(concept))
    .filter(Boolean);
  if (normalizedCandidates.length === 0) return 0;

  const totalCount = Object.values(transitions).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (totalCount <= 0) return 0;

  let bestProbability = 0;
  for (const candidate of normalizedCandidates) {
    const probability = (transitions[candidate] || 0) / totalCount;
    if (probability > bestProbability) bestProbability = probability;
  }

  return Math.min(0.1, bestProbability * 0.14);
}

export function loadSuggestionHistory(): SuggestionRecord[] {
  try {
    const raw = localStorage.getItem(SUGGESTION_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function recordSuggestion(record: SuggestionRecord): void {
  const history = loadSuggestionHistory();
  history.push(record);
  const trimmed = history.slice(-500);
  try {
    localStorage.setItem(SUGGESTION_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

/**
 * Record that suggestions were shown but not acted upon (decay trigger).
 * Call this when a user navigates away from a note without acting on suggestions.
 */
export function recordIgnoredSuggestions(
  sourcePath: string,
  shownPaths: string[],
): void {
  const history = loadSuggestionHistory();
  const now = Date.now();
  for (const targetPath of shownPaths) {
    // Only record ignore once per 30-minute window per pair
    const recentIgnore = history.find(
      (r) =>
        r.sourcePath === sourcePath &&
        r.targetPath === targetPath &&
        r.action === "ignored" &&
        now - r.timestamp < 30 * 60 * 1000,
    );
    if (!recentIgnore) {
      history.push({ sourcePath, targetPath, action: "ignored", timestamp: now });
    }
  }
  const trimmed = history.slice(-500);
  try {
    localStorage.setItem(SUGGESTION_HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

/**
 * Apply suggestion weighting with temporal recency boost and decay.
 * - Accepted targets get boosted (+0.05)
 * - Rejected targets get demoted (-0.15)
 * - Ignored targets decay gradually (-0.03 per ignore)
 * - Recently edited notes get a temporal boost (+0.05)
 */
export function applyHistoryWeighting(
  sourcePath: string,
  results: SimilarNote[],
  recentPaths: string[] = [],
): SimilarNote[] {
  const history = loadSuggestionHistory();
  const boosts = new Map<string, number>();
  const recentSet = new Set(recentPaths);

  for (const record of history) {
    if (record.sourcePath === sourcePath) {
      const current = boosts.get(record.targetPath) || 0;
      if (record.action === "accepted") {
        boosts.set(record.targetPath, current + 0.05);
      } else if (record.action === "rejected") {
        boosts.set(record.targetPath, current - 0.15);
      } else if (record.action === "ignored") {
        // Gradual decay for ignored suggestions
        boosts.set(record.targetPath, current - 0.03);
      }
    }
  }

  return results
    .map((r) => {
      let sim = r.similarity + (boosts.get(r.path) || 0);
      // Temporal boost: +5% for recently accessed notes
      if (recentSet.has(r.path)) sim += 0.05;
      return { ...r, similarity: Math.max(0, sim) };
    })
    .filter((r) => r.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity);
}
