import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ env: { allowLocalModels: true, useBrowserCache: true, backends: { onnx: { wasm: {} as any } } }, loads: 0, options: undefined as unknown }));
vi.mock('@xenova/transformers', () => ({
  env: mock.env,
  pipeline: async (task: string, model: string, options: unknown) => {
    expect(task).toBe('feature-extraction'); expect(model).toBe('Xenova/all-MiniLM-L6-v2');
    mock.loads++; mock.options = options;
    // Exercise the actual worker's cache RPC while offline.
    const response = await self.fetch('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx');
    expect((await response.arrayBuffer()).byteLength).toBe(4);
    return async (texts: string[]) => ({ data: new Float32Array(texts.length * 384) });
  },
}));

describe('actual embedding worker entry with injected model', () => {
  it('loads cached files through RPC and keeps one model with packaged WASM URLs', async () => {
    const sent: any[] = []; const network = vi.fn();
    const scope = { location: { href: 'file:///resources/app.asar/dist/assets/embeddingWorker.js' }, fetch: network, onmessage: undefined as any,
      postMessage: (message: any) => {
        sent.push(message);
        if (message.type === 'cache') queueMicrotask(() => scope.onmessage({ data: { type: 'cache-result', id: message.id, generation: message.generation, data: new ArrayBuffer(4) } }));
      },
    };
    vi.stubGlobal('self', scope);
    try {
      await import('../src/utils/embeddingWorker');
      await scope.onmessage({ data: { type: 'infer', id: 1, generation: 3, texts: ['first'], wasmPath: 'file:///resources/app.asar/dist/wasm/' } });
      await scope.onmessage({ data: { type: 'infer', id: 2, generation: 4, texts: ['second', 'third'], wasmPath: 'file:///resources/app.asar/dist/wasm/' } });
      expect(mock.loads).toBe(1); expect(mock.options).toEqual({ quantized: true });
      expect(network).not.toHaveBeenCalled();
      expect(mock.env.backends.onnx.wasm).toMatchObject({ numThreads: 1, proxy: false, wasmPaths: 'file:///resources/app.asar/dist/wasm/' });
      expect(sent.filter((message) => message.type === 'result').map((message) => [message.id, message.generation, message.vectors.length])).toEqual([[1, 3, 384], [2, 4, 768]]);
    } finally { vi.unstubAllGlobals(); }
  });
});
