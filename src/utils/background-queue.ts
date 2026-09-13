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
  loadStoreAsync,
  embedNote,
  refreshEmbeddingMetadataIfUnchanged,
  pruneMissingEmbeddings,
  type EmbeddingStore,
} from "./embeddings";
import { getAnnotation } from "./ai-core";
import { readData, writeData } from "./disk-store";

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
let _isProcessing = false;
let _processedCount = 0;
let _totalCount = 0;
let _onStatusChange: ((status: QueueStatus) => void) | null = null;
let _queueLoaded = false;

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

  if (isFinalOrImportant || now - _lastReportTime >= 250) {
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
    }, 250 - (now - _lastReportTime));
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

  const state = await readData<PersistedQueue>("queue.json");
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
    _queue.push({
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
  const existing = _queue.findIndex((j) => j.path === job.path && j.type === job.type);
  if (existing >= 0) {
    if (job.priority < _queue[existing].priority) {
      _queue[existing].priority = job.priority;
      _queue[existing].content = job.content;
    }
    return;
  }
  _queue.push(job);
  _totalCount = _processedCount + _queue.length;
  sortQueue();
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

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 100;

async function processBatch(api: any): Promise<boolean> {
  if (!areEmbeddingsAvailable()) {
    _queue = [];
    _isProcessing = false;
    reportStatus("Local analysis fallback ready");
    await persistQueue();
    return false;
  }

  const batch = _queue.splice(0, BATCH_SIZE);
  if (batch.length === 0) return true;

  const store = await loadStoreAsync();

  for (const job of batch) {
    try {
      // Load content on demand if empty (from persisted queue)
      let content = job.content;
      if (!content && api?.readFile) {
        try {
          content = await api.readFile(job.path);
        } catch {
          _processedCount++;
          reportStatus();
          continue;
        }
      }

      if (typeof content !== "string") {
        _processedCount++;
        reportStatus();
        continue;
      }

      if (job.type === "embed") {
        await embedNote(store, job.path, content, job.modifiedAt, job.size);
      } else if (job.type === "annotate") {
        await getAnnotation(job.path, content);
      }
    } catch (err) {
      console.warn(`[Queue] Failed ${job.type} for ${job.path}:`, err);
    }
    _processedCount++;
    reportStatus();
  }

  // Persist queue state periodically
  if (_processedCount % 10 === 0) {
    persistQueue();
  }

  return true;
}

export async function startProcessing(api?: any): Promise<void> {
  if (_isProcessing) return;
  if (_queue.length === 0) return;

  _isProcessing = true;
  reportStatus("Analyzing your notes...");

  while (_queue.length > 0) {
    const canContinue = await processBatch(api);
    if (!canContinue) return;
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
  }

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
  _queue = [];
  _isProcessing = false;
  _processedCount = 0;
  _totalCount = 0;
  reportStatus("");
  writeData("queue.json", { jobs: [], processedCount: 0, totalCount: 0, lastUpdated: Date.now() });
}

export function resetQueueState(): void {
  _queue = [];
  _isProcessing = false;
  _processedCount = 0;
  _totalCount = 0;
  _queueLoaded = false;
  reportStatus("");
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
export async function initializeVault(
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

  // Load any persisted queue state first
  await loadPersistedQueue();

  // CRITICAL: await disk-loaded embeddings so we can skip notes that
  // already have cached embeddings. Without this, the in-memory Map is
  // empty and every note looks "new", causing full re-analysis.
  const store = await loadStoreAsync();

  // Prune any stored embeddings for notes that have been deleted from the vault
  const validNotePaths = new Set(allNotes.map((n) => n.path));
  pruneMissingEmbeddings(store, validNotePaths);

  let enqueued = 0;
  let alreadyIndexed = 0;
  const recentSet = new Set(recentPaths);
  const now = Date.now();

  _processedCount = 0;

  for (const note of allNotes) {
    const existing = store.entries.get(note.path);
    const hasStoredSignal = existing?.vector?.some((value) => Math.abs(value) > 1e-8);
    const isUnchanged = existing &&
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

  _totalCount = enqueued;

  if (enqueued > 0) {
    // Persist queue before starting
    await persistQueue();
    startProcessing(api);
  }

  return { enqueued, alreadyIndexed };
}
