import { spawnSync } from 'node:child_process';
import path from 'node:path';

const output = path.resolve(process.argv[2] || '/tmp/openonyx-embedding-benchmark.json');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/embedding-benchmark.test.ts', '--maxWorkers=1'], {
  stdio: 'inherit', env: { ...process.env, EMBEDDING_BENCHMARK_OUTPUT: output },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Mocked model/fixture results: ${output}. These are not ONNX or renderer UI measurements.`);
