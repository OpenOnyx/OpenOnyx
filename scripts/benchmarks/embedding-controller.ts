import { embeddingPerformanceSnapshot, resetEmbeddingPerformance, startEmbeddingResponsivenessMonitor } from '../../src/utils/embedding-performance';
import { embedNote, loadStore, loadStoreAsync, resetEmbeddingsStore, searchByQuery } from '../../src/utils/embeddings';
import { embeddingWorkerClient } from '../../src/utils/embedding-worker-client';
import { enqueueJobs, startProcessing, resetQueueState, initializeVault, setQueueStatusCallback } from '../../src/utils/background-queue';

const bridge = (window as any).benchmark;
const report: any = { kind: 'Real MiniLM, ONNX Runtime Web, isolated Electron synthetic vault; no application UI or user vault', matrix: [], indexing: {} };
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)] || 0;

async function modelMatrix(config: any) {
  // Production-like nonisolated HTTP context: report unsupported thread counts,
  // rather than labeling a single-thread fallback as a successful thread test.
  for (const threads of [1, 2, 4]) {
    for (const batchSize of [4, 8, 16, 32]) {
      if (threads > 1 && (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')) {
        report.matrix.push({ threads, batchSize, supported: false, reason: 'SharedArrayBuffer/cross-origin isolation unavailable in this context' }); continue;
      }
      const workerUrl = new URL('embeddingWorker.js', new URL('.', import.meta.url));
      const worker = new Worker(workerUrl, { type: 'module' });
      let id = 0;
      const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
      worker.onmessage = async ({ data }) => {
        if (data.type === 'cache') {
          const bytes = await bridge.model(data.subpath);
          const payload = bytes ? data.subpath.endsWith('.json') ? new TextDecoder().decode(bytes) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : undefined;
          worker.postMessage({ type: 'cache-result', id: data.id, generation: data.generation, data: payload }, payload instanceof ArrayBuffer ? [payload] : []); return;
        }
        if (data.type === 'state') return;
        const waiter = pending.get(data.id); pending.delete(data.id);
        if (data.type === 'error') waiter?.reject(new Error(data.error)); else waiter?.resolve(data);
      };
      const infer = (texts: string[]) => new Promise<any>((resolve, reject) => {
        const requestId = ++id; pending.set(requestId, { resolve, reject });
        worker.postMessage({ type: 'infer', id: requestId, generation: 1, texts, wasmPath: new URL('../wasm/', import.meta.url).href, benchmarkThreads: threads });
      });
      try {
        const chunks = Array.from({ length: batchSize }, (_, i) => `Synthetic fixture ${i}: ${'Evidence and examples connect neural networks, learning algorithms and useful applications. '.repeat(12)}`);
        const cold = await infer(chunks);
        const latency: number[] = [], tokenization: number[] = [], onnx: number[] = [];
        for (let repetition = 0; repetition < 4; repetition++) {
          const result = await infer(chunks);
          latency.push(result.inferenceMs); tokenization.push(result.tokenizationMs); onnx.push(result.onnxMs);
        }
        report.matrix.push({ threads, batchSize, supported: true, effectiveThreads: cold.threads, coldLoadMs: cold.loadMs, inferenceAverageMs: average(latency), inferenceP95Ms: p95(latency), tokenizationAverageMs: average(tokenization), onnxAverageMs: average(onnx), chunksPerSecond: batchSize / average(latency) * 1000 });
      } catch (error) { report.matrix.push({ threads, batchSize, supported: false, error: String(error) }); }
      finally { worker.terminate(); }
    }
  }
}

async function main() {
  const config = await bridge.config();
  report.context = { protocol: location.protocol, crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined" };
  if (config.label.includes("threading") || config.label.includes("file-probe")) { await modelMatrix(config); return; }
  (window as any).__oo_vault_path = config.root;
  resetQueueState(); resetEmbeddingsStore(); resetEmbeddingPerformance();
  const stopMonitor = startEmbeddingResponsivenessMonitor();
  let query: Promise<any> | undefined; let queryMs = 0; let progressUpdates = 0;
  setQueueStatusCallback((status) => {
    progressUpdates++;
    if (!query && status.processed >= 8) {
      const start = performance.now();
      query = searchByQuery(loadStore(), 'How do neural network learning algorithms use evidence?', 5).then((result) => { queryMs = performance.now() - start; return result; });
    }
  });
  enqueueJobs(config.notes.map((note: any) => ({ id: note.path, type: 'embed', ...note, content: '', priority: 2, enqueuedAt: 1 })));
  const start = performance.now(); await startProcessing((window as any).electronAPI); const elapsedMs = performance.now() - start;
  if (query) await query;
  const coldStats = embeddingPerformanceSnapshot();
  report.indexing.cold = { notes: config.notes.length, elapsedMs, notesPerSecond: config.notes.length / elapsedMs * 1000, chunksInferred: coldStats.counters.chunksInferred, chunksPerSecond: (coldStats.counters.chunksInferred || 0) / elapsedMs * 1000, queryMs, progressUpdates, metrics: coldStats };
  // Let the actual debounced atomic persistence finish before testing restart.
  await new Promise((resolve) => setTimeout(resolve, 2300));
  resetQueueState(); resetEmbeddingsStore(); resetEmbeddingPerformance();
  const warmStart = performance.now(); const warm = await initializeVault(config.notes, null, [], (window as any).electronAPI);
  report.indexing.warm = { ...warm, elapsedMs: performance.now() - warmStart, metrics: embeddingPerformanceSnapshot() };
  const store = await loadStoreAsync();
  const content = await (window as any).electronAPI.readFile('note-0.md');
  resetEmbeddingPerformance(); const editStart = performance.now();
  await embedNote(store, 'note-0.md', content.replace('Paragraph 12', 'Revised paragraph twelve'), undefined, undefined, 1);
  report.indexing.edit = { elapsedMs: performance.now() - editStart, metrics: embeddingPerformanceSnapshot() };
  stopMonitor(); embeddingWorkerClient.dispose();
  await modelMatrix(config);
}
main().catch((error) => { report.error = String(error); }).finally(async () => { await bridge.report(report); });
