import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('dist');
const assets = await readdir(path.join(root, 'assets'));
for (const prefix of ['embeddingWorker-', 'semanticAnalysisWorker-']) {
  const name = assets.find((entry) => entry.startsWith(prefix) && entry.endsWith('.js'));
  assert(name, `Missing production ${prefix} asset`);
  const source = await readFile(path.join(root, 'assets', name), 'utf8');
  assert(!source.includes('/src/') && !source.includes('localhost:5173'), 'Development-only worker URL');
  for (const match of source.matchAll(/import\("(\.\/[^"\n]+)"\)/g)) {
    await stat(path.resolve(root, 'assets', match[1]));
  }
}
for (const file of ['ort-wasm.wasm', 'ort-wasm-simd.wasm']) {
  assert((await stat(path.join(root, 'wasm', file))).size > 0, `Missing ${file}`);
}
const packageConfig = JSON.parse(await readFile('package.json', 'utf8'));
assert(packageConfig.build.files.includes('dist/**/*'), 'Workers must ship in every Electron target');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert(html.includes("worker-src 'self'"), 'Existing CSP must permit bundled workers');
if (process.argv[2]) {
  const asar = await import('@electron/asar');
  const archive = path.resolve(process.argv[2]);
  const files = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''));
  for (const prefix of ['embeddingWorker-', 'semanticAnalysisWorker-']) {
    const worker = files.find((entry) => entry.startsWith(`dist/assets/${prefix}`) && entry.endsWith('.js'));
    assert(worker, `Missing packaged ${prefix}`);
    const source = asar.extractFile(archive, worker).toString('utf8');
    for (const match of source.matchAll(/import\("(\.\/[^"\n]+)"\)/g)) {
      assert(files.includes(path.posix.normalize(path.posix.join('dist/assets', match[1]))), 'Missing packaged worker dependency');
    }
  }
  for (const wasm of ['ort-wasm.wasm', 'ort-wasm-simd.wasm']) {
    assert(files.includes(`dist/wasm/${wasm}`), `Missing packaged ${wasm}`);
  }
  console.log('Actual ASAR contains embedding/analysis workers, their dependencies and local WASM. Application not launched.');
}
console.log('Production worker imports, WASM assets, packaging inclusion and CSP verified statically. Packaged runtime not tested.');
