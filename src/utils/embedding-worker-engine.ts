/** Injectable model lifecycle, shared by the actual worker and deterministic tests. */
import { embeddingMetricsEnabled } from './embedding-performance';
export class EmbeddingWorkerEngine {
  private model: any;
  private loading?: Promise<any>;
  lastLoadMs = 0;
  lastInferenceMs = 0;
  lastTokenizationMs = 0;
  lastOnnxMs = 0;
  lastSequenceLength = 0;
  constructor(private readonly load: () => Promise<any>) {}
  get ready(): boolean { return !!this.model; }
  async infer(texts: string[]): Promise<Float32Array> {
    if (!this.model) {
      this.loading ||= (async () => {
        const start = performance.now();
        try {
          this.model = await this.load();
          if (embeddingMetricsEnabled) this.instrumentModel();
          return this.model;
        }
        finally { this.lastLoadMs = performance.now() - start; this.loading = undefined; }
      })();
      await this.loading;
    } else this.lastLoadMs = 0;
    const start = performance.now();
    this.lastTokenizationMs = 0; this.lastOnnxMs = 0;
    const output = await this.model(texts, { pooling: 'mean', normalize: true });
    this.lastInferenceMs = performance.now() - start;
    if (!(output?.data instanceof Float32Array) || output.data.length !== texts.length * 384 || output.data.some((value: number) => !Number.isFinite(value))) {
      throw new Error('Invalid embedding worker output');
    }
    return output.data;
  }

  private instrumentModel(): void {
    // Proxies preserve the tokenizer's callable object and configuration. No
    // text or token IDs are retained. ONNX timing wraps the actual session run.
    if (typeof this.model.tokenizer === 'function') {
      this.model.tokenizer = new Proxy(this.model.tokenizer, { apply: (target, receiver, args) => {
        const start = performance.now();
        const result = Reflect.apply(target, receiver, args) as { input_ids?: { dims?: number[] } };
        this.lastTokenizationMs += performance.now() - start;
        this.lastSequenceLength = result.input_ids?.dims?.[1] || 0;
        return result;
      } });
    }
    const session = this.model.model?.session;
    if (typeof session?.run === 'function') {
      const run = session.run.bind(session);
      session.run = async (...args: any[]) => {
        const start = performance.now();
        try { return await run(...args); }
        finally { this.lastOnnxMs += performance.now() - start; }
      };
    }
  }
}
