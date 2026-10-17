export const LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_EMBEDDING_DIM = 384;
export const CHUNK_CACHE_ID = `${LOCAL_EMBEDDING_MODEL}:quantized:markdown-v2:mean:normalized:semantic`;

export type EmbeddingWorkerRequest =
  | { type: 'infer'; id: number; generation: number; texts: string[]; wasmPath: string; benchmarkThreads?: 1 | 2 | 4 }
  | { type: 'cache-result'; id: number; generation: number; data?: string | ArrayBuffer; error?: string };
export type EmbeddingWorkerResponse =
  | { type: 'result'; id: number; generation: number; vectors: Float32Array; loadMs: number; inferenceMs: number; cold: boolean; tokenizationMs?: number; onnxMs?: number; sequenceLength?: number; threads?: number; receivedAt?: number; sentAt?: number }
  | { type: 'error'; id: number; generation: number; error: string }
  | { type: 'state'; state: 'loading' | 'downloading' | 'ready' }
  | { type: 'cache'; id: number; generation: number; operation: 'read' | 'write'; subpath: string; data?: string | ArrayBuffer };
