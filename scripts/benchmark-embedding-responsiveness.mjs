import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

// Isolated deterministic CPU load. Demonstrates event-loop isolation, not real
// ONNX performance, Electron input latency, or GPU/memory behavior.
const workMs = 200;
const busy = () => { const start = performance.now(); while (performance.now() - start < workMs) {} };
async function measure(run) {
  let ticks = 0; let maxDelayMs = 0; let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(); ticks++; maxDelayMs = Math.max(maxDelayMs, now - last - 5); last = now;
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 10));
  ticks = 0; maxDelayMs = 0; last = performance.now();
  const start = performance.now(); await run(); const durationMs = performance.now() - start;
  await new Promise((resolve) => setTimeout(resolve, 10)); clearInterval(timer);
  return { durationMs, heartbeatTicks: ticks, maxDelayMs };
}
const before = await measure(async () => busy());
const worker = new Worker(`const { parentPort } = require('node:worker_threads'); parentPort.on('message', (ms) => { const start = performance.now(); while(performance.now() - start < ms) {} parentPort.postMessage('done'); }); parentPort.postMessage('ready');`, { eval: true });
await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
const after = await measure(() => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage(workMs); }));
await worker.terminate();
const report = { kind: 'mocked CPU; Node event loop; NOT Electron/ONNX/UI measurements', workMs, before, after };
const output = process.argv[2] || '/tmp/openonyx-embedding-responsiveness.json';
writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
