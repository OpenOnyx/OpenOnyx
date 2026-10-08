import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('initializes the PDF worker when the runtime lacks Math.sumPrecise', () => {
  // Use a fresh worker-like realm so existing polyfills cannot mask the regression.
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    Math.sumPrecise = undefined;
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    if (typeof globalThis.pdfjsWorker?.WorkerMessageHandler !== 'function') {
      throw new Error('PDF worker did not initialize');
    }
    console.log(Math.sumPrecise([1e20, 1, -1e20]));
  `], { encoding: 'utf8' });
  expect(result.trim()).toBe('1');
});
