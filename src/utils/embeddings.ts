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

import { embeddingScheduler, StaleEmbeddingError, EmbeddingCapacityError, type EmbeddingPriority } from "./embedding-scheduler";
import { embeddingWorkerClient } from "./embedding-worker-client";
import { CHUNK_CACHE_ID } from "./embedding-worker-contract";
import { countEmbeddingMetric, recordEmbeddingMetric, timeEmbeddingOperation } from "./embedding-performance";

export const getEmbeddingGeneration = () => embeddingScheduler.generation;

export function resolveTransformersWasmPath(
  transformersVersion: string,
  pageHref: string | undefined = typeof window !== "undefined" ? window.location.href : undefined,
  isTest: boolean = typeof process !== "undefined" && process.env.NODE_ENV === "test",
): string {
  if (pageHref && !isTest) {
    // Relative to index.html so this works for both Vite's HTTP server and a
    // packaged Electron app loaded from dist/index.html via file://.
    return new URL("./wasm/", pageHref).href;
  }

  return `https://cdn.jsdelivr.net/npm/@xenova/transformers@${transformersVersion}/dist/`;
}

export function getRemoteEmbeddingModelSubpath(url: string): string | null {
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
    if (parsed.hostname !== "huggingface.co" && parsed.hostname !== "www.huggingface.co") {
      return null;
    }

    const marker = "/Xenova/all-MiniLM-L6-v2/";
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    let subpath = parsed.pathname.substring(index + marker.length);
    if (subpath.startsWith("resolve/main/")) {
      subpath = subpath.substring("resolve/main/".length);
    }
    return subpath || null;
  } catch {
    return null;
  }
}

export function configureTransformersEnv(env: any) {
  // Model downloads are cached by the Electron fetch interceptor below.
  // Transformers.js's separate local-model lookup targets /models/...; Vite's
  // SPA fallback answers that missing URL with index.html and JSON parsing fails.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  if ("useBrowserCache" in env) {
    // Electron uses the vault-backed cache below. Keeping the browser Cache API
    // enabled creates a second cache that can retain SPA fallback HTML forever.
    (env as any).useBrowserCache = false;
  }

  // Electron/Browser compatibility fixes for @xenova/transformers v2.
  // Force the WASM backend and disable Node.js-specific backends.
  if (env.backends?.onnx?.wasm) {
    const wasm = env.backends.onnx.wasm as {
      proxy?: boolean;
      numThreads?: number;
      wasmPaths?: string;
    };
    wasm.proxy = false;
    wasm.numThreads = 1;
    wasm.wasmPaths = resolveTransformersWasmPath(env.version);
  }
}

// ── Model singleton ──────────────────────────────────────────────────────────

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
export const EMBEDDING_SCHEMA_VERSION = 2;
export const EMBEDDING_CHUNK_SIZE = 1200;
export const EMBEDDING_UPDATED_EVENT = "openonyx:embedding-updated";
const EMBEDDING_CHUNK_OVERLAP = 120;
const MAX_STORED_SEGMENT_VECTORS = 8;

let _modelReady = false;
let _loadProgress = 0;
let _disabledReason: string | null = null;
let retryAfter = 0;

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

export const getEmbeddingVectorType = () => _disabledReason ? "lexical-v1" : CHUNK_CACHE_ID;

export function isLexicalFallbackActive(): boolean {
  return _disabledReason !== null;
}

export function isSemanticEmbeddingAvailable(): boolean {
  return _modelReady;
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
  const generation = getEmbeddingGeneration();
  if (!online) {
    const cached = await isModelCached();
    if (generation === getEmbeddingGeneration()) _embeddingsAvailable = _modelReady || cached;
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
    await updateAvailability();
  });
}

export function areEmbeddingsAvailable(): boolean {
  return _embeddingsAvailable;
}

embeddingWorkerClient.onState = (state) => {
  _modelReady = state === "ready";
  _loadProgress = _modelReady ? 100 : state === 'downloading' ? 20 : 10;
  if (_modelReady) _disabledReason = null;
  const status = _modelReady ? 'Model ready' : state === 'downloading' ? 'Downloading local analysis model...' : 'Loading analysis engine...';
  _onProgress?.(_loadProgress, status);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('openonyx:embedding-model-state', { detail: state }));
};

export function isModelLoaded(): boolean {
  return _modelReady;
}

// ── Markdown stripping ───────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^---[\s\S]*?---\s*/m, "")        // YAML frontmatter
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // wiki links
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // markdown links
    .replace(/^```[^\n]*$/gm, "")               // code fences (retain code content)
    .replace(/`([^`]+)`/g, "$1")                 // inline code content
    .replace(/^#{1,6}\s+/gm, "")               // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")   // bold/italic
    .replace(/<[^>]+>/g, "")                    // HTML
    .replace(/^\s*[-*+]\s+/gm, "")             // lists
    .replace(/^\s*\d+\.\s+/gm, "")             // numbered lists
    .replace(/^>\s*/gm, "")                     // blockquotes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split the complete note into overlapping model-sized chunks. Long notes are
 * never truncated; every part contributes to the note vector and search
 * segments below.
 */
export function chunkTextForEmbedding(
  text: string | null | undefined,
  maxChars = EMBEDDING_CHUNK_SIZE,
  overlapChars = EMBEDDING_CHUNK_OVERLAP,
): string[] {
  const start = performance.now();
  const clean = stripMarkdown(typeof text === "string" ? text : "");
  recordEmbeddingMetric("markdownPreprocessingMs", performance.now() - start);
  const chunkStart = performance.now();
  const chunks = splitCleanTextForEmbedding(clean, maxChars, overlapChars);
  recordEmbeddingMetric("chunkGenerationMs", performance.now() - chunkStart);
  countEmbeddingMetric("chunksPrepared", chunks.length);
  return chunks;
}

function splitCleanTextForEmbedding(clean: string, maxChars = EMBEDDING_CHUNK_SIZE, overlapChars = EMBEDDING_CHUNK_OVERLAP): string[] {
  if (clean.length < 5) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(maxChars * 0.65)) end = boundary;
    }

    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;

    const nextStart = Math.max(start + 1, end - Math.min(overlapChars, Math.floor(maxChars / 3)));
    start = nextStart;
    while (start < clean.length && clean[start] === " ") start++;
  }

  return chunks;
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

const notificationPaths = new Set<string>();
let notificationPending = false;
function notifyEmbeddingUpdated(path: string): void {
  if (typeof window === "undefined") return;
  notificationPaths.add(path);
  if (notificationPending) return;
  notificationPending = true;
  const generation = getEmbeddingGeneration();
  queueMicrotask(() => {
    notificationPending = false;
    const paths = [...notificationPaths]; notificationPaths.clear();
    if (generation !== getEmbeddingGeneration() || !paths.length) return;
    window.dispatchEvent(new CustomEvent(EMBEDDING_UPDATED_EVENT, { detail: paths.length === 1 ? { path: paths[0] } : { paths } }));
  });
}

function normalizeVector(vector: number[]): number[] {
  let squaredMagnitude = 0;
  for (const value of vector) squaredMagnitude += value * value;
  const magnitude = Math.sqrt(squaredMagnitude);
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(EMBEDDING_DIM).fill(0);
  const result = new Array(vectors[0].length).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < result.length; index++) {
      result[index] += vector[index] || 0;
    }
  }
  return normalizeVector(result);
}

function coalesceSegmentVectors(vectors: number[][]): number[][] {
  if (vectors.length <= MAX_STORED_SEGMENT_VECTORS) return vectors;
  return Array.from({ length: MAX_STORED_SEGMENT_VECTORS }, (_, index) => {
    const start = Math.floor(index * vectors.length / MAX_STORED_SEGMENT_VECTORS);
    const end = Math.max(start + 1, Math.floor((index + 1) * vectors.length / MAX_STORED_SEGMENT_VECTORS));
    return averageVectors(vectors.slice(start, end));
  });
}

const yieldToRenderer = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const chunkCache = new Map<string, number[]>();
const MAX_CHUNK_CACHE = 2048;
const MAX_WORKER_BATCH_CHUNKS = 4;
const MAX_PENDING_CHUNK_REQUESTS = 256;
export const markEmbeddingTyping = () => embeddingScheduler.typing();

function cacheChunk(key: string, vector: number[]): void {
  chunkCache.delete(key);
  chunkCache.set(key, vector);
  if (chunkCache.size > MAX_CHUNK_CACHE) chunkCache.delete(chunkCache.keys().next().value!);
}

interface PendingChunkRequest {
  key: string;
  text: string;
  priority: EmbeddingPriority;
  generation: number;
  isCurrent: () => boolean;
  created: number;
  running: boolean;
  promise: Promise<number[]>;
  resolve: (vector: number[]) => void;
  reject: (reason: unknown) => void;
}

// Each individual chunk has one in-flight promise. A short collection window
// lets independent notes share a bounded worker request without changing their
// note-level aggregation or cache identity.
const pendingChunkRequests = new Map<string, PendingChunkRequest>();
let chunkBatchFlushQueued = false;
let chunkBatchTimer: ReturnType<typeof setTimeout> | null = null;
let chunkBatchSequence = 0;

function resetChunkBatcher(): void {
  if (chunkBatchTimer) clearTimeout(chunkBatchTimer);
  chunkBatchTimer = null;
  chunkBatchFlushQueued = false;
  for (const request of pendingChunkRequests.values()) request.reject(new StaleEmbeddingError());
  pendingChunkRequests.clear();
}

function scheduleChunkBatchFlush(priority: EmbeddingPriority): void {
  if (chunkBatchFlushQueued && priority === 0 && chunkBatchTimer) {
    clearTimeout(chunkBatchTimer);
    chunkBatchTimer = null;
    chunkBatchFlushQueued = false;
  }
  if (chunkBatchFlushQueued) return;
  chunkBatchFlushQueued = true;
  const flush = () => {
    chunkBatchTimer = null;
    chunkBatchFlushQueued = false;
    void flushChunkBatch();
  };
  // Queries do not wait for a collection timer. Background work waits one
  // turn so a queue batch can contribute chunks from several notes.
  if (priority === 0) queueMicrotask(flush);
  else chunkBatchTimer = setTimeout(flush, 8);
}

async function flushChunkBatch(): Promise<void> {
  const candidates = [...pendingChunkRequests.values()]
    .filter((request) => !request.running)
    .sort((a, b) => a.priority - b.priority || a.created - b.created);
  for (const request of candidates) {
    if (request.generation === getEmbeddingGeneration() && request.isCurrent()) continue;
    pendingChunkRequests.delete(request.key);
    request.reject(new StaleEmbeddingError());
  }
  const batch = candidates.filter((request) => pendingChunkRequests.get(request.key) === request && !request.running)
    .slice(0, MAX_WORKER_BATCH_CHUNKS);
  if (!batch.length) return;
  for (const request of batch) request.running = true;
  const priority = batch.reduce<EmbeddingPriority>((best, request) => Math.min(best, request.priority) as EmbeddingPriority, 2);
  const generation = batch[0].generation;
  countEmbeddingMetric('workerChunkBatches');
  recordEmbeddingMetric('workerChunkBatchSize', batch.length);
  try {
    const data = await embeddingScheduler.schedule(
      `chunk-batch:${generation}:${++chunkBatchSequence}`,
      priority,
      () => embeddingWorkerClient.infer(
        batch.map((request) => request.text), generation,
        resolveTransformersWasmPath('2.17.2', typeof window !== 'undefined' ? window.location.href : undefined, false),
      ),
    );
    if (generation !== getEmbeddingGeneration()) throw new StaleEmbeddingError();
    batch.forEach((request, index) => {
      if (pendingChunkRequests.get(request.key) !== request) return;
      pendingChunkRequests.delete(request.key);
      if (!request.isCurrent()) { request.reject(new StaleEmbeddingError()); return; }
      const vector = Array.from(data.subarray(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM));
      cacheChunk(request.key, vector);
      request.resolve(vector);
    });
  } catch (error) {
    for (const request of batch) {
      if (pendingChunkRequests.get(request.key) === request) pendingChunkRequests.delete(request.key);
      request.reject(error);
    }
  } finally {
    if (pendingChunkRequests.size) scheduleChunkBatchFlush(2);
  }
}

function requestSemanticChunk(chunk: string, priority: EmbeddingPriority, generation: number, isCurrent: () => boolean): Promise<number[]> {
  const key = `${CHUNK_CACHE_ID}:${chunk}`;
  const cached = chunkCache.get(key);
  if (cached) { countEmbeddingMetric('chunkCacheHits'); return Promise.resolve(cached); }
  const existing = pendingChunkRequests.get(key);
  if (existing) {
    existing.priority = Math.min(existing.priority, priority) as EmbeddingPriority;
    countEmbeddingMetric('duplicatesAvoided');
    scheduleChunkBatchFlush(priority);
    return existing.promise;
  }
  if (pendingChunkRequests.size >= MAX_PENDING_CHUNK_REQUESTS) return Promise.reject(new EmbeddingCapacityError());
  let resolve!: (vector: number[]) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<number[]>((yes, no) => { resolve = yes; reject = no; });
  const request: PendingChunkRequest = { key, text: chunk, priority, generation, isCurrent, created: performance.now(), running: false, promise, resolve, reject };
  pendingChunkRequests.set(key, request);
  scheduleChunkBatchFlush(priority);
  return promise;
}

async function embedCleanChunks(cleanChunks: string[], priority: EmbeddingPriority = 0, generation = getEmbeddingGeneration(), isCurrent: () => boolean = () => true): Promise<number[][]> {
  if (_disabledReason && _disabledReason !== "website-lexical" && Date.now() >= retryAfter && areEmbeddingsAvailable()) _disabledReason = null;
  if (generation !== getEmbeddingGeneration() || !isCurrent()) throw new StaleEmbeddingError();
  const kind = _disabledReason ? 'lexical-v1' : CHUNK_CACHE_ID;
  const missing = [...new Set(cleanChunks.filter((chunk) => !chunkCache.has(`${kind}:${chunk}`)))];
  countEmbeddingMetric('chunkCacheHits', cleanChunks.length - missing.length);
  if (missing.length) {
    if (_disabledReason) {
      for (const chunk of missing) cacheChunk(`${kind}:${chunk}`, lexicalEmbedText(chunk));
    } else {
      try {
        await Promise.all(missing.map((chunk) => requestSemanticChunk(chunk, priority, generation, isCurrent)));
      } catch (error) {
        if (error instanceof StaleEmbeddingError || error instanceof EmbeddingCapacityError) throw error;
        if (!_disabledReason) {
          console.warn('[Embeddings] Worker unavailable; using keyword fallback', error);
          _disabledReason = error instanceof Error ? error.message : 'Embedding worker unavailable';
          _modelReady = false;
          retryAfter = Date.now() + 30000;
          embeddingWorkerClient.dispose();
        }
        _onProgress?.(100, 'Using keyword search (semantic model not loaded)');
        for (const chunk of missing) cacheChunk(`lexical-v1:${chunk}`, lexicalEmbedText(chunk));
      }
    }
  }
  if (generation !== getEmbeddingGeneration() || !isCurrent()) throw new StaleEmbeddingError();
  const finalKind = _disabledReason ? 'lexical-v1' : CHUNK_CACHE_ID;
  const vectors = cleanChunks.map((chunk) => chunkCache.get(`${finalKind}:${chunk}`) || lexicalEmbedText(chunk));
  if (_disabledReason) await yieldToRenderer();
  return vectors;
}

async function embedTextWithSegments(
  text: string | null | undefined,
  priority: EmbeddingPriority = 0,
  generation = getEmbeddingGeneration(),
  isCurrent: () => boolean = () => true,
  preparedChunks?: string[],
): Promise<{ vector: number[]; segmentVectors: number[][] }> {
  const chunks = preparedChunks || chunkTextForEmbedding(text);
  if (chunks.length === 0) {
    return { vector: new Array(EMBEDDING_DIM).fill(0), segmentVectors: [] };
  }

  let chunkVectors = await embedCleanChunks(chunks, priority, generation, isCurrent);
  // A partial backend failure must never mix semantic and lexical spaces.
  if (_disabledReason) chunkVectors = chunks.map(lexicalEmbedText);

  const aggregateStart = performance.now();
  const aggregate = { vector: averageVectors(chunkVectors), segmentVectors: coalesceSegmentVectors(chunkVectors) };
  recordEmbeddingMetric("chunkAggregationMs", performance.now() - aggregateStart);
  return aggregate;
}

export async function embedText(text: string | null | undefined, priority: EmbeddingPriority = 0): Promise<number[]> {
  return (await embedTextWithSegments(text, priority)).vector;
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
  segmentVectors?: number[][];
  schemaVersion?: number;
  vectorType?: string;
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
    const generation = getEmbeddingGeneration();
    try {
      // Load individual embedding files. Older or interrupted writes may have
      // entry files without a fresh index, so the files are the source of truth.
      const files = await listData("embeddings");
      const walk = async (prefix: string): Promise<string[]> => {
        const names = await listData(`embeddings/${prefix}`);
        const result: string[] = [];
        for (const name of names) {
          if (name.endsWith(".json")) result.push(`${prefix}/${name}`);
          else result.push(...await walk(`${prefix}/${name}`));
        }
        return result;
      };
      if (files.includes("v3")) files.push(...await walk("v3"));
      // Load legacy first, modern entries last. Never delete legacy caches.
      files.sort((a, b) => Number(a.startsWith("v3/")) - Number(b.startsWith("v3/")));
      for (const file of files) {
        if (file === "_index.json") continue;
        if (!file.endsWith(".json")) continue;
        try {
          const entry = await readData<StoredEmbedding>(`embeddings/${file}`);
          if (generation !== getEmbeddingGeneration()) return;
          if (entry && typeof entry.path === "string" && Array.isArray(entry.vector) && entry.vector.every(Number.isFinite)) {
            if (!_memoryStore.entries.has(entry.path) || (file.startsWith("v3/") && !entryFiles.get(entry.path)?.startsWith("v3/"))) _memoryStore.entries.set(entry.path, entry);
            entryFiles.set(entry.path, file);
          }
        } catch { /* skip corrupt files */ }
      }
    } catch (err) {
      console.warn("[Embeddings] Failed to load from disk:", err);
      // Try fallback from localStorage (migration)
      await tryMigrateFromLocalStorage();
    }
    if (generation !== getEmbeddingGeneration()) return;
    _isLoaded = true;
    _isLoading = false;
  })();

  return _loadPromise;
}

/**
 * Migrate existing localStorage embeddings to disk (one-time).
 */
async function tryMigrateFromLocalStorage(): Promise<void> {
  try {
    const raw = localStorage.getItem("openonyx-embeddings-v2");
    if (!raw) return;
    const data: { entries: StoredEmbedding[] } = JSON.parse(raw);
    for (const e of data.entries) {
      _memoryStore.entries.set(e.path, e);
    }
    // Persist to disk
    await persistAllToDisk();
    // Retain the legacy backup; failed/switch-interrupted migration must never lose data.
    console.log(`[Embeddings] Migrated ${data.entries.length} entries from localStorage to disk`);
  } catch { /* silent */ }
}

/**
 * Write all embeddings to disk (used during migration or bulk operations).
 */
async function persistAllToDisk(): Promise<void> {
  const generation = getEmbeddingGeneration();
  const index: EmbeddingIndex = {};
  for (const [path, entry] of _memoryStore.entries) {
    if (generation !== getEmbeddingGeneration()) throw new StaleEmbeddingError();
    const safeName = embeddingFileName(path);
    index[path] = { hash: entry.hash, updatedAt: entry.updatedAt };
    await writeData(`embeddings/${safeName}`, entry);
  }
  await writeData("embeddings/_index.json", index);
}

/**
 * Persist a single embedding entry to disk.
 */
let indexTimer: ReturnType<typeof setTimeout> | null = null;
const entryFiles = new Map<string, string>();

// UTF-8 hexadecimal is injective; hash-only names could still collide. Long
// paths use nested 120-character components to respect filesystem limits.
export function embeddingFileName(path: string): string {
  const hex = Array.from(new TextEncoder().encode(path), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `v3/${hex.match(/.{1,120}/g)?.join("/") || "empty"}.json`;
}

function scheduleIndexWrite(): void {
  if (indexTimer) return;
  indexTimer = setTimeout(() => {
    indexTimer = null;
    const index: EmbeddingIndex = {};
    for (const [path, entry] of _memoryStore.entries) index[path] = { hash: entry.hash, updatedAt: entry.updatedAt };
    _debouncedWrite("embeddings/_index.json", index);
  }, 1000);
}

function persistEntry(entry: StoredEmbedding): void {
  const safeName = embeddingFileName(entry.path);
  entryFiles.set(entry.path, safeName);
  _debouncedWrite(`embeddings/${safeName}`, entry);
  scheduleIndexWrite();
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
  embeddingScheduler.invalidate();
  embeddingWorkerClient.invalidate();
  resetChunkBatcher();
  chunkCache.clear();
  entryFiles.clear();
  noteRequests.clear();
  noteRevisions.clear();
  _debouncedWrite.cancel();
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = null;
  _memoryStore = { entries: new Map() };
  _isLoaded = false;
  _isLoading = false;
  _loadPromise = null;
  _disabledReason = null;
  _modelReady = embeddingWorkerClient.ready;
  void updateAvailability();
}

if (typeof window !== "undefined") window.addEventListener("openonyx:vault-changing", resetEmbeddingsStore);

/** Seed the in-memory store with the app's lexical fallback — no model download. */
export function seedLexicalEmbeddings(files: Record<string, string>): number {
  resetEmbeddingsStore();
  _disabledReason = "website-lexical";
  _isLoaded = true;
  _isLoading = false;
  _loadPromise = null;
  _memoryStore = { entries: new Map() };
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    const source = typeof content === "string" ? content : "";
    const chunks = chunkTextForEmbedding(source);
    const chunkVectors = chunks.map(lexicalEmbedText);
    const vector = averageVectors(chunkVectors);
    _memoryStore.entries.set(path, {
      path,
      hash: simpleHash(source),
      vector,
      segmentVectors: coalesceSegmentVectors(chunkVectors),
      schemaVersion: EMBEDDING_SCHEMA_VERSION,
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
interface PersistedChunkCache { identity: string; chunks: Array<{ text: string; vector: number[] }> }

/** Retain unchanged chunk anchors after insertions; fill uncovered regions with
 * the existing overlapping splitter. New/legacy notes keep original boundaries. */
export function reuseEmbeddingChunkBoundaries(source: string, previous: string[]): string[] {
  const clean = stripMarkdown(source);
  if (!previous.length || clean.length < 5) return chunkTextForEmbedding(source);
  const anchors: Array<{ start: number; text: string }> = [];
  let cursor = 0;
  for (const text of previous) {
    const start = clean.indexOf(text, cursor);
    if (start < 0) continue;
    anchors.push({ start, text });
    cursor = Math.max(start + 1, start + text.length - EMBEDDING_CHUNK_OVERLAP - 1);
  }
  if (!anchors.length) return chunkTextForEmbedding(source);
  const chunks: string[] = [];
  let covered = 0;
  for (const anchor of anchors) {
    if (anchor.start > covered) {
      chunks.push(...splitCleanTextForEmbedding(clean.slice(Math.max(0, covered - EMBEDDING_CHUNK_OVERLAP), Math.min(clean.length, anchor.start + EMBEDDING_CHUNK_OVERLAP))));
    }
    chunks.push(anchor.text);
    covered = Math.max(covered, anchor.start + anchor.text.length);
  }
  if (covered < clean.length) chunks.push(...splitCleanTextForEmbedding(clean.slice(Math.max(0, covered - EMBEDDING_CHUNK_OVERLAP))));
  return chunks;
}

const noteRequests = new Map<string, { source: string; promise: Promise<boolean> }>();
const noteRevisions = new Map<string, number>();

export function invalidateEmbeddingPath(path: string): void {
  noteRevisions.set(path, (noteRevisions.get(path) || 0) + 1);
  noteRequests.delete(path);
}

/** Same path/content shares a promise; only the latest revision may persist. */
export function embedNote(
  store: EmbeddingStore,
  path: string,
  content: string | null | undefined,
  modifiedAt?: number,
  size?: number,
  priority: EmbeddingPriority = 1,
): Promise<boolean> {
  const source = typeof content === "string" ? content : "";
  const pending = noteRequests.get(path);
  if (pending?.source === source) { countEmbeddingMetric('duplicatesAvoided'); return pending.promise; }
  const generation = getEmbeddingGeneration();
  const revision = (noteRevisions.get(path) || 0) + 1;
  noteRevisions.set(path, revision);
  const current = () => generation === getEmbeddingGeneration() && noteRevisions.get(path) === revision;
  const promise = (async () => {
    const hash = simpleHash(source);
    const existing = store.entries.get(path);
    if (existing && existing.hash === hash && existing.schemaVersion === EMBEDDING_SCHEMA_VERSION && (existing.vectorType !== "lexical-v1" || _disabledReason)) {
      if (stripMarkdown(source).length < 5 || hasVectorSignal(existing.vector)) return false;
    }
    const started = performance.now();
    const cachePath = `embedding-chunks/${embeddingFileName(path)}`;
    const saved = await timeEmbeddingOperation("chunkCacheReadMs", () => readData<PersistedChunkCache>(cachePath));
    if (!current()) return false;
    const identity = _disabledReason ? "lexical-v1" : CHUNK_CACHE_ID;
    const compatible = saved?.identity === identity && Array.isArray(saved.chunks) && saved.chunks.every((chunk) => typeof chunk.text === "string" && chunk.text.length >= 5 && Array.isArray(chunk.vector) && chunk.vector.length === EMBEDDING_DIM && chunk.vector.every(Number.isFinite));
    if (compatible) for (const chunk of saved!.chunks) cacheChunk(`${identity}:${chunk.text}`, chunk.vector);
    const chunks = reuseEmbeddingChunkBoundaries(source, compatible ? saved!.chunks.map((chunk) => chunk.text) : []);
    const { vector, segmentVectors } = await embedTextWithSegments(source, priority, generation, current, chunks);
    if (!current()) return false;
    const entry: StoredEmbedding = {
      path, hash, vector, segmentVectors, schemaVersion: EMBEDDING_SCHEMA_VERSION,
      vectorType: _disabledReason ? "lexical-v1" : CHUNK_CACHE_ID,
      updatedAt: Date.now(), modifiedAt, size,
    };
    store.entries.set(path, entry);
    _memoryStore.entries.set(path, entry);
    persistEntry(entry);
    const finalIdentity = _disabledReason ? "lexical-v1" : CHUNK_CACHE_ID;
    // Auxiliary cache is bounded per note, loaded only for an edited note, and
    // never required to read existing v2 embeddings.
    _debouncedWrite(cachePath, {
      identity: finalIdentity,
      chunks: chunks.slice(0, 64).filter((text) => chunkCache.has(`${finalIdentity}:${text}`)).map((text) => ({ text, vector: chunkCache.get(`${finalIdentity}:${text}`)! })),
    } satisfies PersistedChunkCache);
    notifyEmbeddingUpdated(path);
    countEmbeddingMetric('notesIndexed');
    recordEmbeddingMetric('noteIndexMs', performance.now() - started);
    return true;
  })().catch((error) => { if (error instanceof StaleEmbeddingError) return false; throw error; });
  noteRequests.set(path, { source, promise });
  void promise.finally(() => {
    if (noteRequests.get(path)?.promise === promise) noteRequests.delete(path);
  }).catch(() => {});
  return promise;
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
  if (
    !existing
    || existing.hash !== simpleHash(content)
    || existing.schemaVersion !== EMBEDDING_SCHEMA_VERSION
    || (existing.vectorType === "lexical-v1" && !_disabledReason)
  ) return false;

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
  invalidateEmbeddingPath(path);
  _debouncedWrite.cancel(`embedding-chunks/${embeddingFileName(path)}`);
  store.entries.delete(path);
  _memoryStore.entries.delete(path);

  const safeName = entryFiles.get(path) || embeddingFileName(path);
  _debouncedWrite.cancel(`embeddings/${safeName}`);
  deleteData(`embeddings/${safeName}`);
  entryFiles.delete(path);

  scheduleIndexWrite();
  notifyEmbeddingUpdated(path);
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
  invalidateEmbeddingPath(oldPath);
  invalidateEmbeddingPath(newPath);
  _debouncedWrite.cancel(`embedding-chunks/${embeddingFileName(oldPath)}`);

  const existing = store.entries.get(oldPath);
  if (!existing) return false;

  const oldSafeName = entryFiles.get(oldPath) || embeddingFileName(oldPath);
  _debouncedWrite.cancel(`embeddings/${oldSafeName}`);
  deleteData(`embeddings/${oldSafeName}`);
  entryFiles.delete(oldPath);

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
  notifyEmbeddingUpdated(newPath);
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

/**
 * Prune embeddings for notes that no longer exist in the vault.
 */
export function pruneMissingEmbeddings(
  store: EmbeddingStore,
  validPaths: Set<string> | string[],
): number {
  const validSet = validPaths instanceof Set ? validPaths : new Set(validPaths);
  const toRemove: string[] = [];

  for (const path of store.entries.keys()) {
    if (!validSet.has(path)) {
      toRemove.push(path);
    }
  }

  for (const path of toRemove) {
    removeEmbedding(store, path);
  }

  return toRemove.length;
}

// ── Similarity search ────────────────────────────────────────────────────────

export interface SimilarNote {
  path: string;
  similarity: number;
}

export { findSimilar } from "./embedding-vector-math";

export async function searchByQuery(
  store: EmbeddingStore,
  query: string,
  maxResults = 8,
): Promise<SimilarNote[]> {
  // There is nothing to compare against, so avoid starting the heavyweight
  // model (and potentially logging a backend warning) on a brand-new vault.
  if (store.entries.size === 0) return [];

  const started = performance.now();
  const generation = getEmbeddingGeneration();
  const queryVec = await embedText(query, 0);
  const results: SimilarNote[] = [];

  let compared = 0;
  let lastYield = performance.now();
  for (const [path, entry] of store.entries) {
    if (++compared % 64 === 0 && performance.now() - lastYield >= 4) { await yieldToRenderer(); lastYield = performance.now(); }
    if (generation !== getEmbeddingGeneration()) throw new StaleEmbeddingError();
    if (entry.vectorType && entry.vectorType !== (_disabledReason ? "lexical-v1" : CHUNK_CACHE_ID)) continue;
    if (entry.vector.length !== queryVec.length) continue;
    const vectors = entry.segmentVectors?.length ? entry.segmentVectors : [entry.vector];
    const sim = Math.max(
      cosineSimilarity(queryVec, entry.vector),
      ...vectors
        .filter((vector) => vector.length === queryVec.length)
        .map((vector) => cosineSimilarity(queryVec, vector)),
    );
    if (sim > 0.15) {
      results.push({ path, similarity: sim });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  recordEmbeddingMetric("semanticQueryMs", performance.now() - started);
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
