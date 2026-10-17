// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EmbeddingWorkerClient } from '../src/utils/embedding-worker-client';
import { embeddingScheduler } from '../src/utils/embedding-scheduler';

function fakeWorker() {
  return { onmessage: null as any, onerror: null as any, onmessageerror: null as any,
    sent: [] as any[], terminated: false,
    postMessage(data: unknown) { this.sent.push(data); }, terminate() { this.terminated = true; },
  };
}

describe('embedding worker transport', () => {
  it('matches IDs and transfers cache resources independently of inference replies', async () => {
    const port = fakeWorker();
    const client = new EmbeddingWorkerClient(() => port, async () => new ArrayBuffer(4));
    const generation = embeddingScheduler.generation;
    const promise = client.infer(['example'], generation, 'file:///resources/app.asar/dist/wasm/');
    const request = port.sent[0];
    port.onmessage({ data: { type: 'result', id: 99, generation, vectors: new Float32Array(384) } });
    port.onmessage({ data: { type: 'cache', id: 7, generation, operation: 'read', subpath: 'onnx/model_quantized.onnx' } });
    await Promise.resolve();
    expect(port.sent[1]).toMatchObject({ type: 'cache-result', id: 7 });
    port.onmessage({ data: { type: 'state', state: 'ready' } });
    port.onmessage({ data: { type: 'result', id: request.id, generation, vectors: new Float32Array(384), cold: true, loadMs: 2, inferenceMs: 1 } });
    expect((await promise).length).toBe(384);
    client.invalidate();
    expect(port.terminated).toBe(false);
    client.dispose();
  });

  it('rejects crashes and creates a new worker on the next request', async () => {
    const ports = [fakeWorker(), fakeWorker()]; let created = 0;
    const client = new EmbeddingWorkerClient(() => ports[created++]);
    const generation = embeddingScheduler.generation;
    const first = client.infer(['first'], generation, '/wasm/');
    const rejected = expect(first).rejects.toThrow('crashed');
    ports[0].onerror();
    await rejected;
    const next = client.infer(['next'], generation, '/wasm/');
    const id = ports[1].sent[0].id;
    ports[1].onmessage({ data: { type: 'result', id, generation, vectors: new Float32Array(384), cold: true, loadMs: 1, inferenceMs: 1 } });
    await next;
    expect(created).toBe(2);
    client.dispose();
  });

  it('rejects mismatched generations and discards old worker replies', async () => {
    const port = fakeWorker(); const client = new EmbeddingWorkerClient(() => port);
    const generation = embeddingScheduler.generation;
    const first = client.infer(['old'], generation, '/wasm/');
    const rejected = expect(first).rejects.toThrow('vault changed');
    const id = port.sent[0].id;
    port.onmessage({ data: { type: 'result', id, generation: generation + 1, vectors: new Float32Array(384) } });
    await rejected;
    client.dispose();
  });
});
