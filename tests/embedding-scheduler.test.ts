import { describe, expect, it, vi } from 'vitest';
import { EmbeddingScheduler, StaleEmbeddingError } from '../src/utils/embedding-scheduler';
import { EmbeddingWorkerEngine } from '../src/utils/embedding-worker-engine';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('controlled embedding scheduler', () => {
  it('shares concurrent identical work and bounds pending requests', async () => {
    const scheduler = new EmbeddingScheduler(2);
    const gate = deferred<number>();
    const first = scheduler.schedule('a', 2, () => gate.promise);
    expect(scheduler.schedule('a', 0, async () => 99)).toBe(first);
    const second = scheduler.schedule('b', 2, async () => 2);
    await expect(scheduler.schedule('c', 0, async () => 3)).rejects.toThrow('capacity');
    gate.resolve(1);
    expect(await first).toBe(1);
    expect(await second).toBe(2);
  });

  it('runs an interactive request after the current batch, ahead of background work', async () => {
    const scheduler = new EmbeddingScheduler();
    const gate = deferred<number>();
    const order: string[] = [];
    const running = scheduler.schedule('running', 2, () => gate.promise);
    const background = scheduler.schedule('background', 2, async () => { order.push('background'); return 2; });
    const query = scheduler.schedule('query', 0, async () => { order.push('query'); return 0; });
    gate.resolve(1);
    await Promise.all([running, background, query]);
    expect(order).toEqual(['query', 'background']);
  });

  it('rejects old-vault work without pretending to preempt its computation', async () => {
    const scheduler = new EmbeddingScheduler();
    const gate = deferred<number>();
    const running = scheduler.schedule('old', 2, () => gate.promise);
    const rejected = expect(running).rejects.toBeInstanceOf(StaleEmbeddingError);
    scheduler.invalidate();
    await rejected;
    const next = scheduler.schedule('new', 0, async () => 3);
    gate.resolve(1);
    expect(await next).toBe(3);
  });

  it('gives background work a fair slot during a stream of queries', async () => {
    const scheduler = new EmbeddingScheduler();
    const gate = deferred<number>();
    const running = scheduler.schedule('running', 0, () => gate.promise);
    const order: string[] = [];
    const background = scheduler.schedule('background', 2, async () => { order.push('background'); return 1; });
    const queries = Array.from({ length: 12 }, (_, i) => scheduler.schedule(`q${i}`, 0, async () => { order.push(`q${i}`); return i; }));
    gate.resolve(0);
    await Promise.all([running, background, ...queries]);
    expect(order.indexOf('background')).toBeLessThan(8);
  });

  it('bounds interactive wait by the running batch rather than the background backlog', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new EmbeddingScheduler();
      const run = () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 100));
      const background = Array.from({ length: 10 }, (_, i) => scheduler.schedule(`b${i}`, 2, run));
      const start = Date.now();
      const query = scheduler.schedule('query', 0, async () => Date.now() - start);
      await vi.advanceTimersByTimeAsync(105);
      expect(await query).toBeLessThanOrEqual(102);
      expect(scheduler.size).toBeGreaterThan(0);
      await vi.runAllTimersAsync(); await Promise.all(background);
    } finally { vi.useRealTimers(); }
  });

  it('defers note inference during typing while allowing interactive queries', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new EmbeddingScheduler(); scheduler.typing();
      const order: string[] = [];
      const background = scheduler.schedule('note', 1, async () => { order.push('note'); return 1; });
      const query = scheduler.schedule('query', 0, async () => { order.push('query'); return 0; });
      await vi.advanceTimersByTimeAsync(30);
      expect(await query).toBe(0); expect(order).toEqual(['query']);
      // performance.now is a real clock in this runner; explicitly advance the
      // inactivity threshold through a controlled performance clock.
      vi.spyOn(performance, 'now').mockReturnValue(1000000000);
      await vi.runAllTimersAsync(); await background;
      expect(order).toEqual(['query', 'note']);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
});

describe('worker model lifecycle', () => {
  it('initializes once for concurrent requests and preserves pooling/normalization', async () => {
    const gate = deferred<any>();
    let loads = 0;
    const engine = new EmbeddingWorkerEngine(() => { loads++; return gate.promise; });
    const model = async (texts: string[], options: unknown) => {
      expect(options).toEqual({ pooling: 'mean', normalize: true });
      return { data: new Float32Array(texts.length * 384) };
    };
    const first = engine.infer(['a']); const second = engine.infer(['b', 'c']);
    expect(loads).toBe(1);
    gate.resolve(model);
    expect((await first).length).toBe(384);
    expect((await second).length).toBe(768);
    await engine.infer(['d']);
    expect(loads).toBe(1);
  });

  it('retries a failed initialization and rejects invalid output', async () => {
    let attempts = 0;
    const engine = new EmbeddingWorkerEngine(async () => {
      if (++attempts === 1) throw new Error('load failed');
      return async () => ({ data: new Float32Array(2) });
    });
    await expect(engine.infer(['a'])).rejects.toThrow('load failed');
    await expect(engine.infer(['a'])).rejects.toThrow('Invalid embedding');
    expect(attempts).toBe(2);
  });
});
