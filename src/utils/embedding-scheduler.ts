import { countEmbeddingMetric, recordEmbeddingMetric } from './embedding-performance';

export type EmbeddingPriority = 0 | 1 | 2;
export class StaleEmbeddingError extends Error {
  constructor() { super('Embedding request superseded or vault changed'); this.name = 'StaleEmbeddingError'; }
}
export class EmbeddingCapacityError extends Error {
  constructor() { super("Embedding scheduler capacity reached"); this.name = "EmbeddingCapacityError"; }
}
interface Task<T> {
  key: string;
  priority: EmbeddingPriority;
  generation: number;
  created: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
}

/** One inference at a time. Cancellation is logical, never ONNX preemption. */
export class EmbeddingScheduler {
  private pending: Task<any>[] = [];
  private tasks = new Map<string, Task<any>>();
  private running = false;
  private served = 0;
  private typingUntil = 0;
  generation = 0;
  constructor(readonly capacity = 128) {}

  typing(): void { this.typingUntil = performance.now() + 750; }
  invalidate(): void {
    this.generation++;
    for (const task of this.tasks.values()) task.reject(new StaleEmbeddingError());
    this.pending = [];
    this.tasks.clear();
  }
  get size(): number { return this.tasks.size; }

  schedule<T>(key: string, priority: EmbeddingPriority, run: () => Promise<T>): Promise<T> {
    const existing = this.tasks.get(key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority) as EmbeddingPriority;
      countEmbeddingMetric('duplicatesAvoided');
      return existing.promise;
    }
    if (this.tasks.size >= this.capacity) return Promise.reject(new EmbeddingCapacityError());
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const task: Task<T> = { key, priority, run, resolve, reject, promise, generation: this.generation, created: performance.now() };
    this.tasks.set(key, task);
    this.pending.push(task);
    void this.drain();
    return promise;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        // Aging plus a periodic oldest-job slot prevents background starvation.
        this.pending.sort((a, b) => a.priority - b.priority || a.created - b.created);
        const fair = ++this.served % 8 === 0;
        const index = fair ? this.pending.reduce((best, task, i, list) => task.created < list[best].created ? i : best, 0) : 0;
        if (this.pending[index].priority > 0 && performance.now() < this.typingUntil) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          continue;
        }
        const task = this.pending.splice(index, 1)[0];
        recordEmbeddingMetric('queueWaitMs', performance.now() - task.created);
        try {
          const value = await task.run();
          if (task.generation !== this.generation) task.reject(new StaleEmbeddingError());
          else task.resolve(value);
        } catch (error) { task.reject(error); }
        finally { if (this.tasks.get(task.key) === task) this.tasks.delete(task.key); }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally { this.running = false; }
  }
}

export const embeddingScheduler = new EmbeddingScheduler();
