import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] || '/tmp/openonyx-real-embedding-benchmark');
const label = process.argv[3] || 'baseline';
const assets = path.join(root, label, 'assets');
await mkdir(assets, { recursive: true });
const model = path.join(root, 'models');
for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']) {
  const target = path.join(model, file);
  try { await access(target); continue; } catch {}
  console.log(`Downloading public MiniLM asset: ${file}`);
  const response = await fetch(`https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/${file}`, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
}
await build({ configFile: 'vite.config.ts', mode: 'embedding-benchmark', publicDir: false, build: {
  outDir: assets, emptyOutDir: true, minify: true,
  rollupOptions: { input: { controller: path.resolve('scripts/benchmarks/embedding-controller.ts'), embeddingWorker: path.resolve('src/utils/embeddingWorker.ts') },
    output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js', manualChunks: undefined } },
} });
await mkdir(path.join(root, label, 'wasm'), { recursive: true });
for (const file of ['ort-wasm.wasm', 'ort-wasm-simd.wasm', 'ort-wasm-threaded.wasm', 'ort-wasm-simd-threaded.wasm']) await copyFile(`public/wasm/${file}`, path.join(root, label, 'wasm', file));
await writeFile(path.join(root, label, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Isolated embedding benchmark</title><script type="module" src="./assets/controller.js"></script>');
// This launches only a hidden isolated fixture harness, never OpenOnyx's entry
// point, plugins, existing session or user vault. No manual UI interaction.
const env = { ...process.env, OPENONYX_EMBEDDING_BENCH_ROOT: root, OPENONYX_EMBEDDING_BENCH_LABEL: label };
delete env.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [path.resolve('scripts/benchmarks/embedding-electron.cjs')], { env, stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
if (code !== 0) process.exit(code || 1);
const result = JSON.parse(await readFile(path.join(root, `${label}.json`), 'utf8'));
console.log(JSON.stringify({ label, matrix: result.matrix, indexing: result.indexing, memory: result.memory, error: result.error }, null, 2));
