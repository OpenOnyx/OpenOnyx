const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function electronSources(root) {
  const sources = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) sources.push(file);
    }
  }
  walk(path.join(root, 'electron'));
  return sources;
}

function staleElectronSources(root) {
  const configTime = fs.statSync(path.join(root, 'tsconfig.electron.json')).mtimeMs;
  return electronSources(root).filter((source) => {
    const output = path.join(root, 'dist-electron', path.relative(path.join(root, 'electron'), source).replace(/\.ts$/, '.js'));
    return !fs.existsSync(output) || fs.statSync(output).mtimeMs < Math.max(fs.statSync(source).mtimeMs, configTime);
  });
}

function ensureElectronBuildFresh(root, compile = () => {
  const compiler = require.resolve('typescript/bin/tsc', { paths: [root] });
  return spawnSync(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.electron.json')], { cwd: root, stdio: 'inherit' });
}) {
  if (!staleElectronSources(root).length) return;
  console.warn('[dev] Electron sources are newer than the compiled main/preload. Rebuilding before launch...');
  const result = compile();
  if (result.error || result.status !== 0) throw result.error || new Error('Electron compilation failed; application was not started');
  if (staleElectronSources(root).length) throw new Error('Electron output remains stale after compilation; application was not started');
}

function watchElectronSources(root, onChange) {
  const directories = new Set(electronSources(root).map((source) => path.dirname(source)));
  const watchers = [...directories].map((directory) => fs.watch(directory, (_event, name) => {
    if (!name || String(name).endsWith('.ts')) onChange();
  }));
  watchers.push(fs.watch(path.join(root, 'tsconfig.electron.json'), onChange));
  return () => { for (const watcher of watchers) watcher.close(); };
}

module.exports = { staleElectronSources, ensureElectronBuildFresh, watchElectronSources };
