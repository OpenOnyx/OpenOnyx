import { EmbeddingWorkerEngine } from './embedding-worker-engine';
import { LOCAL_EMBEDDING_MODEL, type EmbeddingWorkerRequest, type EmbeddingWorkerResponse } from './embedding-worker-contract';

const scope = self as unknown as {
  postMessage: (message: EmbeddingWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: (event: MessageEvent<EmbeddingWorkerRequest>) => void;
};
let wasmPath = '';
let generation = 0;
let threads = 1;
let resourceId = 0;
const resources = new Map<number, { resolve: (data?: string | ArrayBuffer) => void; reject: (error: Error) => void }>();
function cache(operation: 'read' | 'write', subpath: string, data?: string | ArrayBuffer): Promise<string | ArrayBuffer | undefined> {
  const id = ++resourceId;
  return new Promise((resolve, reject) => {
    resources.set(id, { resolve, reject });
    scope.postMessage({ type: 'cache', id, generation, operation, subpath, data }, data instanceof ArrayBuffer ? [data] : []);
  });
}
const originalFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, self.location.href);
  const marker = '/Xenova/all-MiniLM-L6-v2/resolve/main/';
  const subpath = parsed.hostname === 'huggingface.co' && parsed.pathname.includes(marker) ? parsed.pathname.split(marker)[1] : undefined;
  if (!subpath || (!subpath.endsWith('.onnx') && !subpath.endsWith('.json'))) return originalFetch(input, init);
  const stored = await cache('read', subpath);
  if (stored !== undefined) return new Response(stored);
  // The initial ONNX file is large enough that a generic queue message makes
  // a healthy first run look stuck. This is only state, never note content.
  scope.postMessage({ type: 'state', state: 'downloading' });
  const response = await originalFetch(input, init);
  if (!response.ok) return response;
  const data = subpath.endsWith('.json') ? await response.text() : await response.arrayBuffer();
  // Return one buffer to the runtime; transfer only a copy when populating disk.
  await cache('write', subpath, typeof data === 'string' ? data : data.slice(0));
  return new Response(data);
};
const engine = new EmbeddingWorkerEngine(async () => {
  scope.postMessage({ type: 'state', state: 'loading' });
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.backends.onnx.wasm.numThreads = threads;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = wasmPath;
  return pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL, { quantized: true });
});

function supportedThreadCount(): 1 | 2 | 4 {
  // ONNX's threaded WASM build requires cross-origin isolation. Electron's
  // packaged file:// renderer does not guarantee that property, so retain a
  // single-thread fallback unless the runtime itself proves it is available.
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return 1;
  const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1;
  return cores >= 4 ? 4 : cores >= 2 ? 2 : 1;
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'cache-result') {
    const pending = resources.get(data.id);
    resources.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.data);
    return;
  }
  generation = data.generation;
  wasmPath = data.wasmPath;
  if (!engine.ready) {
    const supported = supportedThreadCount();
    // Benchmarks can request a smaller supported count. Production chooses the
    // conservative runtime-supported value once, before the model is loaded.
    const requested = import.meta.env.MODE === 'embedding-benchmark' ? data.benchmarkThreads || supported : supported;
    threads = Math.min(requested, supported) as 1 | 2 | 4;
  }
  const receivedAt = performance.timeOrigin + performance.now();
  const cold = !engine.ready;
  try {
    const vectors = await engine.infer(data.texts);
    scope.postMessage({ type: 'state', state: 'ready' });
    scope.postMessage({ type: 'result', id: data.id, generation: data.generation, vectors, cold, loadMs: engine.lastLoadMs, inferenceMs: engine.lastInferenceMs,
      tokenizationMs: engine.lastTokenizationMs, onnxMs: engine.lastOnnxMs, sequenceLength: engine.lastSequenceLength, threads, receivedAt, sentAt: performance.timeOrigin + performance.now() }, [vectors.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, generation: data.generation, error: error instanceof Error ? error.message : String(error) });
  }
};
