/**
 * Background Queue — Persistent, non-blocking job processor
 *
 * Storage: .openonyx/queue.json (resumes across restarts)
 *
 * Features:
 *  - Vault initialization (batch embedding of existing notes)
 *  - Priority queue: active note (P0) > recent notes (P1) > remaining (P2)
 *  - Background annotation generation
 *  - Progress reporting without exposing technical details
 *  - Queue persists across app restarts
 *  - Temporal weighting (recently edited notes processed first)
 */

import {
  areEmbeddingsAvailable,
  invalidateEmbeddingPath,
  EMBEDDING_SCHEMA_VERSION,
  loadStoreAsync,
  embedNote,
  refreshEmbeddingMetadataIfUnchanged,
  pruneMissingEmbeddings,
} from "./embeddings";
import { recordEmbeddingMetric, countEmbeddingMetric, timeEmbeddingOperation } from "./embedding-performance";
import { getAnnotation } from "./ai-core";
import { readData, writeData } from "./disk-store";
import { requestFileMetadata, MissingIpcCapabilityError } from "./filesystem-ipc";

// ── Job types ────────────────────────────────────────────────────────────────

export interface BackgroundJob {
  id: string;
  type: "embed" | "annotate";
  path: string;
  content: string;
  priority: number; // lower = higher priority
  enqueuedAt: number;
  modifiedAt?: number;
  size?: number;
}

// Persisted queue state (content is NOT persisted — loaded on demand)
interface PersistedQueue {
  jobs: Array<{
    id: string;
    type: string;
    path: string;
    priority: number;
    enqueuedAt: number;
    modifiedAt?: number;
    size?: number;
  }>;
  processedCount: number;
  totalCount: number;
  lastUpdated: number;
}

// ── Queue state ──────────────────────────────────────────────────────────────

let _queue: BackgroundJob[] = [];
const queuedJobs = new Map<string, BackgroundJob>();
const activeJobs = new Map<string, BackgroundJob>();
const cancelledJobs = new WeakSet<BackgroundJob>();
let queueGeneration = 0;
let initialization: Promise<{ enqueued: number; alreadyIndexed: number }> | null = null;
let initializationKey = "";
let vaultIndexStarted: number | null = null;
const jobKey = (job: BackgroundJob) => `${job.type}:${job.path}`;
let _isProcessing = false;
let _processedCount = 0;
let _totalCount = 0;
let _onStatusChange: ((status: QueueStatus) => void) | null = null;
let _queueLoaded = false;
let infrastructureError: MissingIpcCapabilityError | null = null;
let metadataPreflight: { api: any; generation: number; promise: Promise<boolean> } | null = null;

export interface QueueStatus {
  isRunning: boolean;
  processed: number;
  total: number;
  message: string;
  progress: number; // 0-100
}

export function setQueueStatusCallback(cb: ((status: QueueStatus) => void) | null): void {
  _onStatusChange = cb;
}

let _lastReportTime = 0;
let _reportTimeout: ReturnType<typeof setTimeout> | null = null;

function reportStatus(message?: string, immediate = false): void {
  const now = Date.now();
  const isFinalOrImportant = immediate || !_isProcessing || message !== undefined || _processedCount >= _totalCount;

  if (isFinalOrImportant || now - _lastReportTime >= 500) {
    if (_reportTimeout) {
      clearTimeout(_reportTimeout);
      _reportTimeout = null;
    }
    _lastReportTime = now;
    const progress = _totalCount > 0 ? Math.round((_processedCount / _totalCount) * 100) : 0;
    _onStatusChange?.({
      isRunning: _isProcessing,
      processed: _processedCount,
      total: _totalCount,
      message: message || getDefaultMessage(),
      progress,
    });
  } else if (!_reportTimeout) {
    _reportTimeout = setTimeout(() => {
      _reportTimeout = null;
      reportStatus(message);
    }, 500 - (now - _lastReportTime));
  }
}

function getDefaultMessage(): string {
  if (!_isProcessing) return "";
  const remaining = _totalCount - _processedCount;
  if (remaining <= 0) return "Analysis complete";
  if (remaining === 1) return "Analyzing 1 more note...";
  return `Analyzing ${remaining} more notes...`;
}

// ── Queue persistence ────────────────────────────────────────────────────────

async function persistQueue(): Promise<void> {
  const state: PersistedQueue = {
    jobs: _queue.map((j) => ({
      id: j.id,
      type: j.type,
      path: j.path,
      priority: j.priority,
      enqueuedAt: j.enqueuedAt,
      modifiedAt: j.modifiedAt,
      size: j.size,
    })),
    processedCount: _processedCount,
    totalCount: _totalCount,
    lastUpdated: Date.now(),
  };
  await writeData("queue.json", state);
}

/**
 * Load persisted queue state from disk.
 * Content is NOT stored — will be loaded on demand during processing.
 */
async function loadPersistedQueue(): Promise<void> {
  if (_queueLoaded) return;
  _queueLoaded = true;

  const generation = queueGeneration;
  const state = await readData<PersistedQueue>("queue.json");
  if (generation !== queueGeneration) return;
  if (!state || !state.jobs || state.jobs.length === 0) return;

  // Only restore if the queue was saved recently (< 24h)
  const MAX_AGE = 24 * 60 * 60 * 1000;
  if (Date.now() - state.lastUpdated > MAX_AGE) {
    await writeData("queue.json", { jobs: [], processedCount: 0, totalCount: 0, lastUpdated: Date.now() });
    return;
  }

  _processedCount = state.processedCount;
  _totalCount = state.totalCount;

  // Jobs need content to be loaded — defer to processing
  for (const job of state.jobs) {
    enqueueJob({
      id: job.id,
      type: job.type as "embed" | "annotate",
      path: job.path,
      content: "", // Will be loaded on demand
      priority: job.priority,
      enqueuedAt: job.enqueuedAt,
      modifiedAt: job.modifiedAt,
      size: job.size,
    });
  }
  sortQueue();
}

// ── Queue operations ─────────────────────────────────────────────────────────

export function enqueueJob(job: BackgroundJob): void {
  const key = jobKey(job);
  const active = activeJobs.get(key);
  if (active && job.content && active.content === job.content) { countEmbeddingMetric('duplicateIndexEventsAvoided'); return; }
  if (active && job.type === "embed") invalidateEmbeddingPath(job.path);
  const existing = queuedJobs.get(key);
  if (existing) {
    existing.content = job.content;
    existing.modifiedAt = job.modifiedAt;
    existing.size = job.size;
    existing.priority = Math.min(existing.priority, job.priority);
    existing.enqueuedAt = job.enqueuedAt;
    countEmbeddingMetric('duplicateIndexEventsAvoided');
    return;
  }
  // Queue holds vault metadata; retain at most 128 full source snapshots.
  if (_queue.length >= 128 && job.priority >= 2) job.content = "";
  _queue.push(job);
  queuedJobs.set(key, job);
  _totalCount = _processedCount + _queue.length;
}

export function cancelNoteJobs(path: string, directory = false): void {
  const matches = (job: BackgroundJob) => job.path === path || (directory && job.path.startsWith(`${path.replace(/\/$/, "")}/`));
  for (const job of [..._queue, ...activeJobs.values()]) {
    if (!matches(job)) continue;
    cancelledJobs.add(job); invalidateEmbeddingPath(job.path); queuedJobs.delete(jobKey(job));
  }
  _queue = _queue.filter((job) => !matches(job));
  _totalCount = _processedCount + _queue.length + activeJobs.size;
}

export function enqueueJobs(jobs: BackgroundJob[]): void {
  for (const job of jobs) enqueueJob(job);
}

function sortQueue(): void {
  _queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Within same priority, process recently edited notes first (temporal weighting)
    return b.enqueuedAt - a.enqueuedAt;
  });
}

// ── Batch processor ──────────────────────────────────────────────────────────

// This bounds filesystem preparation. The embedding worker independently caps
// actual ONNX calls at four chunks, so loading six notes here cannot create
// competing model executions.
const BATCH_SIZE = 6;

async function pauseForInfrastructure(error: MissingIpcCapabilityError, runGeneration: number): Promise<void> {
  if (runGeneration !== queueGeneration) return;
  if (!infrastructureError) console.error("[Queue] Indexing paused: native IPC capability unavailable", error);
  infrastructureError = error;
  _isProcessing = false;
  reportStatus("Indexing paused: fully restart OpenOnyx to update its native API", true);
  await persistQueue();
}

function checkMetadataInfrastructure(api: any, runGeneration: number): Promise<boolean> {
  if (infrastructureError) return Promise.resolve(false);
  if (metadataPreflight && metadataPreflight.api === api && metadataPreflight.generation === runGeneration) return metadataPreflight.promise;
  const promise = (async () => {
    try {
      // Probe the real handler before consuming jobs or pruning embeddings.
      await requestFileMetadata(api, ".", typeof window !== "undefined" ? (window as any).__oo_vault_path : undefined);
      return runGeneration === queueGeneration;
    } catch (error) {
      if (runGeneration !== queueGeneration) return false;
      if (!(error instanceof MissingIpcCapabilityError)) throw error;
      await pauseForInfrastructure(error, runGeneration);
      return false;
    }
  })();
  metadataPreflight = { api, generation: runGeneration, promise };
  void promise.finally(() => { if (metadataPreflight?.promise === promise) metadataPreflight = null; }).catch(() => {});
  return promise;
}

/** Explicit retry after the native capability is repaired; no automatic spin. */
export async function resumeProcessing(api?: any): Promise<void> {
  const generation = queueGeneration;
  try {
    await requestFileMetadata(api, ".", typeof window !== "undefined" ? (window as any).__oo_vault_path : undefined);
  } catch (error) {
    if (error instanceof MissingIpcCapabilityError) { await pauseForInfrastructure(error, generation); return; }
    throw error;
  }
  if (generation !== queueGeneration) return;
  infrastructureError = null;
  await startProcessing(api);
}

async function processBatch(api: any, runGeneration: number): Promise<boolean> {
  if (runGeneration !== queueGeneration) return false;
  if (!areEmbeddingsAvailable()) {
    _queue = [];
    queuedJobs.clear(); activeJobs.clear();
    _isProcessing = false;
    reportStatus("Local analysis fallback ready");
    await persistQueue();
    return false;
  }

  sortQueue();
  const batch = _queue.splice(0, BATCH_SIZE);
  for (const job of batch) { queuedJobs.delete(jobKey(job)); activeJobs.set(jobKey(job), job); }
  if (batch.length === 0) return true;

  const store = await loadStoreAsync();
  const outcomes = await Promise.all(batch.map(async (job) => {
    if (cancelledJobs.has(job) || runGeneration !== queueGeneration) return { job, cancelled: true };
    try {
      // Load content on demand. This is intentionally parallel only within the
      // small preparation batch; ONNX remains serialized by the scheduler.
      let content = job.content;
      if (!content && api?.readFile) {
        try { content = await timeEmbeddingOperation('noteReadMs', () => api.readFile(job.path)); }
        catch { return { job, skipped: true }; }
      }
      if (runGeneration !== queueGeneration || cancelledJobs.has(job)) return { job, cancelled: true };
      job.content = content;
      if (typeof content !== 'string') return { job, skipped: true };
      if (job.type === 'embed') {
        // Vault scans already supplied a stat result. Reuse it for startup;
        // watcher/save jobs without one still use the validated native IPC.
        const metadata = job.modifiedAt !== undefined && job.size !== undefined
          ? (countEmbeddingMetric('metadataReuse'), { modifiedAt: job.modifiedAt, size: job.size })
          : await timeEmbeddingOperation('metadataReadMs', () => requestFileMetadata(api, job.path, typeof window !== 'undefined' ? (window as any).__oo_vault_path : undefined));
        if (runGeneration !== queueGeneration || cancelledJobs.has(job)) return { job, cancelled: true };
        if (metadata === null) return { job, skipped: true };
        await embedNote(store, job.path, content, metadata.modifiedAt, metadata.size, job.priority === 0 ? 1 : 2);
      } else {
        await getAnnotation(job.path, content);
      }
      return { job, completed: true };
    } catch (error) {
      return { job, error };
    }
  }));

  if (runGeneration !== queueGeneration) return false;
  const infrastructure = outcomes.find((outcome) => outcome.error instanceof MissingIpcCapabilityError)?.error as MissingIpcCapabilityError | undefined;
  for (const outcome of outcomes) {
    const { job } = outcome;
    if (activeJobs.get(jobKey(job)) === job) activeJobs.delete(jobKey(job));
    if (outcome.cancelled) continue;
    if (outcome.error instanceof MissingIpcCapabilityError) {
      if (!cancelledJobs.has(job) && !queuedJobs.has(jobKey(job))) enqueueJob(job);
      continue;
    }
    if (outcome.error) console.warn(`[Queue] Failed ${job.type} for ${job.path}:`, outcome.error);
    _processedCount++;
    reportStatus();
  }
  if (infrastructure) {
    await pauseForInfrastructure(infrastructure, runGeneration);
    return false;
  }

  // Persist queue state periodically
  if (_processedCount % 10 === 0) {
    persistQueue();
  }

  return true;
}

export async function startProcessing(api?: any): Promise<void> {
  if (_isProcessing) return;
  if (_queue.length === 0 || infrastructureError) return;
  const generation = queueGeneration;
  if (_queue.some((job) => job.type === "embed") && !await checkMetadataInfrastructure(api, generation)) return;
  // Concurrent starts may have awaited the same preflight.
  if (_isProcessing || generation !== queueGeneration) return;

  _isProcessing = true;
  const runGeneration = queueGeneration;
  const started = performance.now();
  reportStatus("Analyzing your notes...");

  while (_queue.length > 0) {
    const canContinue = await processBatch(api, runGeneration);
    if (!canContinue) return;
    // Yield after each bounded preparation batch. A fixed 100 ms sleep used to
    // cost seconds on a large vault even while the machine was otherwise idle.
    await timeEmbeddingOperation('backgroundYieldMs', () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }

  if (runGeneration !== queueGeneration) return;
  recordEmbeddingMetric("indexProcessingMs", performance.now() - started);
  recordEmbeddingMetric("vaultIndexMs", performance.now() - (vaultIndexStarted ?? started));
  vaultIndexStarted = null;
  recordEmbeddingMetric("notesPerSecond", _processedCount / Math.max(1, performance.now() - started) * 1000);
  _isProcessing = false;
  _processedCount = 0;
  _totalCount = 0;
  reportStatus("Analysis complete");

  // Clear persisted queue
  await writeData("queue.json", { jobs: [], processedCount: 0, totalCount: 0, lastUpdated: Date.now() });

  setTimeout(() => {
    if (!_isProcessing) {
      reportStatus("");
    }
  }, 3000);
}

export function cancelProcessing(): void {
  queueGeneration++;
  queuedJobs.clear(); activeJobs.clear();
  _queue = [];
  _isProcessing = false;
  _processedCount = 0;
  _totalCount = 0;
  reportStatus("");
  writeData("queue.json", { jobs: [], processedCount: 0, totalCount: 0, lastUpdated: Date.now() });
}

export function resetQueueState(): void {
  queueGeneration++;
  queuedJobs.clear(); activeJobs.clear();
  initialization = null; initializationKey = ""; vaultIndexStarted = null;
  if (_reportTimeout) clearTimeout(_reportTimeout);
  _reportTimeout = null;
  _queue = [];
  _isProcessing = false;
  _processedCount = 0;
  _totalCount = 0;
  _queueLoaded = false;
  infrastructureError = null;
  metadataPreflight = null;
  reportStatus("");
}

if (typeof window !== "undefined") window.addEventListener("openonyx:vault-changing", resetQueueState);

if (typeof window !== 'undefined') {
  window.addEventListener('openonyx:embedding-model-state', ((event: CustomEvent<'loading' | 'downloading' | 'ready'>) => {
    if (!_isProcessing) return;
    if (event.detail === 'downloading') {
      reportStatus('Downloading local analysis model...', true);
    } else if (event.detail === 'loading') {
      reportStatus('Loading local analysis engine...', true);
    } else {
      reportStatus(undefined, true);
    }
  }) as EventListener);
}

export function getQueueLength(): number {
  return _queue.length;
}

export function isQueueRunning(): boolean {
  return _isProcessing;
}

// ── Vault initialization ─────────────────────────────────────────────────────

export interface VaultNoteMetadata {
  path: string;
  modifiedAt: number;
  size: number;
}

/**
 * Scan all notes in the vault and enqueue embedding jobs for any that
 * are missing from the embedding store. Supports queue resumption from disk.
 */
async function initializeVaultInternal(
  allNotes: VaultNoteMetadata[],
  activeNotePath?: string | null,
  recentPaths: string[] = [],
  api?: any,
): Promise<{ enqueued: number; alreadyIndexed: number }> {
  if (!areEmbeddingsAvailable()) {
    _isProcessing = false;
    _processedCount = 0;
    _totalCount = allNotes.length;
    reportStatus("Local analysis fallback ready");
    return { enqueued: 0, alreadyIndexed: allNotes.length };
  }

  const runGeneration = queueGeneration;
  // Load any persisted queue state first
  await loadPersistedQueue();
  if (runGeneration !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };
  if (!await checkMetadataInfrastructure(api, runGeneration)) {
    if (runGeneration !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };
    const recent = new Set(recentPaths);
    for (const note of allNotes) enqueueJob({
      id: `embed-${note.path}`, type: "embed", path: note.path, content: "",
      priority: note.path === activeNotePath ? 0 : recent.has(note.path) ? 1 : 2,
      enqueuedAt: Date.now(), modifiedAt: note.modifiedAt, size: note.size,
    });
    await persistQueue();
    return { enqueued: allNotes.length, alreadyIndexed: 0 };
  }

  // CRITICAL: await disk-loaded embeddings so we can skip notes that
  // already have cached embeddings. Without this, the in-memory Map is
  // empty and every note looks "new", causing full re-analysis.
  const store = await loadStoreAsync();
  if (runGeneration !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };

  // Prune any stored embeddings for notes that have been deleted from the vault
  const validNotePaths = new Set(allNotes.map((n) => n.path));
  pruneMissingEmbeddings(store, validNotePaths);

  let enqueued = 0;
  let alreadyIndexed = 0;
  const recentSet = new Set(recentPaths);
  const now = Date.now();

  if (!_isProcessing) _processedCount = 0;

  for (const note of allNotes) {
    if (runGeneration !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };
    const existing = store.entries.get(note.path);
    const hasStoredSignal = existing?.vector?.some((value) => Math.abs(value) > 1e-8);
    const isUnchanged = existing &&
                        existing.schemaVersion === EMBEDDING_SCHEMA_VERSION &&
                        existing.vectorType !== "lexical-v1" &&
                        existing.modifiedAt === note.modifiedAt &&
                        existing.size === note.size &&
                        (hasStoredSignal || note.size < 5);
    if (isUnchanged) {
      alreadyIndexed++;
      continue;
    }

    if (existing && api?.readFile) {
      try {
        const content = await api.readFile(note.path);
        if (runGeneration !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };
        if (
          typeof content === "string" &&
          refreshEmbeddingMetadataIfUnchanged(store, note.path, content, note.modifiedAt, note.size)
        ) {
          alreadyIndexed++;
          continue;
        }
      } catch {
        // If content cannot be read here, let the queue processor handle/skip it.
      }
    }

    let priority = 2;
    if (note.path === activeNotePath) priority = 0;
    else if (recentSet.has(note.path)) priority = 1;

    enqueueJob({
      id: `embed-${note.path}`,
      type: "embed",
      path: note.path,
      content: "",
      priority,
      enqueuedAt: now,
      modifiedAt: note.modifiedAt,
      size: note.size,
    });
    enqueued++;
  }

  _totalCount = _processedCount + _queue.length + activeJobs.size;

  if (_queue.length > 0) {
    // Persist queue before starting
    await persistQueue();
    if (runGeneration === queueGeneration) void startProcessing(api);
  }

  return { enqueued, alreadyIndexed };
}

/** Coalesce duplicate scans; delay startup inference until the editor can paint. */
export function initializeVault(
  allNotes: VaultNoteMetadata[], activeNotePath?: string | null, recentPaths: string[] = [], api?: any,
): Promise<{ enqueued: number; alreadyIndexed: number }> {
  const key = JSON.stringify(allNotes);
  if (initialization && initializationKey === key) return initialization;
  const generation = queueGeneration;
  if (vaultIndexStarted === null) vaultIndexStarted = performance.now();
  const prior = initialization;
  initializationKey = key;
  const promise = (async () => {
    if (prior) await prior;
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (generation !== queueGeneration) return { enqueued: 0, alreadyIndexed: 0 };
    return initializeVaultInternal(allNotes, activeNotePath, recentPaths, api);
  })();
  initialization = promise;
  void promise.finally(() => { if (initialization === promise) initialization = null; }).catch(() => {});
  return promise;
}
