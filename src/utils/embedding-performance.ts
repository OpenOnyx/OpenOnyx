/** Local development diagnostics. Samples are bounded and never leave the app. */
export const embeddingMetricsEnabled = import.meta.env.DEV || ['test', 'embedding-benchmark'].includes(import.meta.env.MODE);
const enabled = embeddingMetricsEnabled;
const samples = new Map<string, number[]>();
const counters = new Map<string, number>();

export function recordEmbeddingMetric(name: string, value: number): void {
  if (!enabled) return;
  const values = samples.get(name) || [];
  if (values.length === 256) values.shift();
  values.push(value);
  samples.set(name, values);
}

export function countEmbeddingMetric(name: string, amount = 1): void {
  if (enabled) counters.set(name, (counters.get(name) || 0) + amount);
}

export function embeddingPerformanceSnapshot() {
  const summaries = Object.fromEntries([...samples].map(([name, values]) => {
    const ordered = [...values].sort((a, b) => a - b);
    return [name, { count: values.length, average: values.reduce((sum, value) => sum + value, 0) / values.length, p95: ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] }];
  }));
  return { counters: Object.fromEntries(counters), samples: Object.fromEntries(samples), summaries };
}

export async function timeEmbeddingOperation<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const start = performance.now();
  try { return await run(); } finally { recordEmbeddingMetric(name, performance.now() - start); }
}

export function resetEmbeddingPerformance(): void {
  counters.clear();
  samples.clear();
}

export function startEmbeddingResponsivenessMonitor(): () => void {
  if (!enabled || typeof window === 'undefined') return () => {};
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    recordEmbeddingMetric('eventLoopDelayMs', Math.max(0, now - last - 100));
    last = now;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (memory) recordEmbeddingMetric('rendererHeapBytes', memory.usedJSHeapSize);
  }, 100);
  let observer: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recordEmbeddingMetric('rendererLongTaskMs', entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
  }
  Object.assign(window, { __embeddingPerformance: embeddingPerformanceSnapshot });
  return () => { clearInterval(timer); observer?.disconnect(); };
}
