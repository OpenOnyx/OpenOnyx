import { getAPI } from './api';
import { embeddingScheduler, StaleEmbeddingError } from './embedding-scheduler';
import { countEmbeddingMetric, recordEmbeddingMetric } from './embedding-performance';
import type { EmbeddingWorkerRequest, EmbeddingWorkerResponse } from './embedding-worker-contract';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
interface Pending {
  generation: number;
  resolve: (vectors: Float32Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sentAt: number;
}

export class EmbeddingWorkerClient {
  private worker?: WorkerPort;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  ready = false;
  onState?: (state: 'loading' | 'downloading' | 'ready') => void;
  constructor(
    private readonly createWorker: () => WorkerPort = () => new Worker(new URL('./embeddingWorker.ts', import.meta.url), { type: 'module', name: 'local-embeddings' }),
    private readonly resource: (request: Extract<EmbeddingWorkerResponse, { type: 'cache' }>) => Promise<string | ArrayBuffer | undefined> = modelCacheResource,
  ) {}

  dispose(reason = new StaleEmbeddingError()): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(reason); }
    this.pending.clear();
  }
  invalidate(): void {
    // Retain a loaded model across vaults, but terminate a partial load whose
    // cache RPCs belong to the previous vault. Never reload per note.
    if (!this.ready) this.dispose();
  }
  infer(texts: string[], generation: number, wasmPath: string): Promise<Float32Array> {
    if (!this.worker) {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<EmbeddingWorkerResponse>) => {
        if (this.worker !== worker) return;
        const response = event.data;
        if (response.type === 'state') { this.ready = response.state === 'ready'; this.onState?.(response.state); return; }
        if (response.type === 'cache') {
          void this.resource(response).then((data) => {
            if (this.worker !== worker) return;
            const message: EmbeddingWorkerRequest = { type: 'cache-result', id: response.id, generation: response.generation, data };
            worker.postMessage(message, data instanceof ArrayBuffer ? [data] : []);
          }).catch((error) => {
            if (this.worker === worker) worker.postMessage({ type: 'cache-result', id: response.id, generation: response.generation, error: String(error) } satisfies EmbeddingWorkerRequest);
          });
          return;
        }
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.generation !== pending.generation || response.generation !== embeddingScheduler.generation) { pending.reject(new StaleEmbeddingError()); return; }
        if (response.type === 'error') { pending.reject(new Error(response.error)); return; }
        recordEmbeddingMetric(response.cold ? 'modelColdLoadMs' : 'modelWarmLoadMs', response.loadMs);
        recordEmbeddingMetric(texts.length === 1 ? 'singleChunkMs' : 'batchMs', response.inferenceMs);
        if (response.tokenizationMs !== undefined) recordEmbeddingMetric('tokenizationMs', response.tokenizationMs);
        if (response.onnxMs !== undefined) recordEmbeddingMetric('onnxMs', response.onnxMs);
        if (response.receivedAt !== undefined) recordEmbeddingMetric('workerRequestTransferMs', Math.max(0, response.receivedAt - pending.sentAt));
        if (response.sentAt !== undefined) recordEmbeddingMetric('workerResponseTransferMs', Math.max(0, performance.timeOrigin + performance.now() - response.sentAt));
        countEmbeddingMetric('chunksInferred', response.vectors.length / 384);
        pending.resolve(response.vectors);
      };
      const failed = () => this.dispose(new Error('Embedding worker crashed or returned an unreadable message'));
      worker.onerror = failed;
      worker.onmessageerror = failed;
    }
    const id = ++this.nextId;
    countEmbeddingMetric('inferenceRequests');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(new Error('Embedding worker timed out')), 180000);
      this.pending.set(id, { generation, resolve, reject, timer, sentAt: performance.timeOrigin + performance.now() });
      this.worker!.postMessage({ type: 'infer', id, generation, texts, wasmPath } satisfies EmbeddingWorkerRequest);
    });
  }
}

async function modelCacheResource(request: Extract<EmbeddingWorkerResponse, { type: 'cache' }>): Promise<string | ArrayBuffer | undefined> {
  if (request.generation !== embeddingScheduler.generation) throw new StaleEmbeddingError();
  if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(json|onnx)$/.test(request.subpath) || request.subpath.includes('..')) throw new Error('Invalid model cache path');
  if (typeof window === 'undefined' || !window.electronAPI) return undefined;
  const api = getAPI();
  const vault = (window as any).__oo_vault_path as string | undefined;
  if (!vault) return undefined;
  if (request.operation === 'write') {
    try {
      const bytes = typeof request.data === 'string' ? new TextEncoder().encode(request.data) : request.data ? new Uint8Array(request.data) : undefined;
      if (bytes) await api.embeddingCacheWrite(request.subpath, bytes, vault);
    } catch (error) { console.warn('[Embeddings] Model cache write failed', error); }
    return undefined;
  }
  const bytes = await api.embeddingCacheRead(request.subpath, vault);
  if (request.generation !== embeddingScheduler.generation) throw new StaleEmbeddingError();
  if (bytes?.length) {
    if (request.subpath.endsWith('.json')) {
      try { const text = new TextDecoder().decode(bytes); JSON.parse(text); return text; }
      catch { return undefined; }
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return undefined;
}

export const embeddingWorkerClient = new EmbeddingWorkerClient();

if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => embeddingWorkerClient.dispose());
if (import.meta.hot) import.meta.hot.dispose(() => embeddingWorkerClient.dispose());
