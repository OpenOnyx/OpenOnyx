const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const root = process.env.OPENONYX_EMBEDDING_BENCH_ROOT;
const label = process.env.OPENONYX_EMBEDDING_BENCH_LABEL;
if (!root || !label || !root.startsWith('/tmp/openonyx-real-embedding-')) throw new Error('Benchmark requires its isolated /tmp directory');
app.setPath('userData', path.join(root, `electron-${label}`));
let window; let server; let monitor; let deadline;
const memory = { peakRendererKiB: 0, peakTotalKiB: 0, cpuSamples: [] };
app.whenReady().then(async () => {
  const { FileSystemManager } = await import(path.join(process.cwd(), 'dist-electron/fileSystem.js'));
  const manager = new FileSystemManager();
  const vault = path.join(root, label, 'vault'); await fs.mkdir(vault, { recursive: true });
  manager.setVaultPath(vault);
  const notes = [];
  for (let i = 0; i < 48; i++) {
    const source = Array.from({ length: i % 4 === 0 ? 28 : 3 }, (_, j) => `Paragraph ${j} of fixture ${i} covers ${['neural networks', 'network routing', 'ancient history', 'plant biology'][i % 4]}. Evidence, examples and practical applications connect ideas across this topic.`).join('\n\n');
    const notePath = `note-${i}.md`;
    // Each label is a fresh synthetic vault. Never overwrite a user vault.
    await manager.writeFile(notePath, source);
    notes.push({ path: notePath, ...await manager.fileMetadata(notePath) });
  }
  ipcMain.handle('bench:config', () => ({ root: vault, notes, worker: '../assets/embeddingWorker.js', label }));
  ipcMain.handle('bench:vault', () => vault);
  ipcMain.handle('bench:metadata', (_event, name) => manager.fileMetadata(name));
  ipcMain.handle('bench:read', (_event, name) => manager.readFile(name));
  ipcMain.handle('bench:dataRead', (_event, name) => manager.readDataFile(name));
  ipcMain.handle('bench:dataWrite', (_event, name, content, expectedVault) => {
    if (expectedVault !== vault) throw new Error('Benchmark vault mismatch');
    return manager.writeDataFile(name, content);
  });
  ipcMain.handle('bench:dataList', (_event, name) => manager.listDataDir(name));
  ipcMain.handle('bench:model', async (_event, subpath) => {
    if (typeof subpath !== 'string' || subpath.includes('..') || !/^(?:[\w-]+\/)*[\w.-]+\.(onnx|json)$/.test(subpath)) throw new Error('Invalid benchmark model path');
    try { return new Uint8Array(await fs.readFile(path.join(root, 'models', subpath))); } catch { return null; }
  });
  ipcMain.handle('bench:report', async (_event, report) => {
    await fs.writeFile(path.join(root, `${label}.json`), JSON.stringify({ ...report, memory, hardware: { cpu: os.cpus()[0].model, cores: os.availableParallelism(), ramBytes: os.totalmem(), electron: process.versions.electron } }, null, 2));
    console.log(`Isolated real-inference report written: ${path.join(root, `${label}.json`)}`);
    clearTimeout(deadline); clearInterval(monitor); server?.close(); app.exit(report.error ? 1 : 0);
  });
  const base = path.join(root, label);
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    if (label.includes('threading')) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'text/html');
    try { res.end(await fs.readFile(file)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'embedding-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, details) => {
    if (details && typeof details === 'object' && details.level === 'error') console.error(details.message);
  });
  monitor = setInterval(() => {
    const metrics = app.getAppMetrics();
    memory.peakTotalKiB = Math.max(memory.peakTotalKiB, metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0));
    const renderer = metrics.find((item) => item.type === 'Tab');
    if (renderer) { memory.peakRendererKiB = Math.max(memory.peakRendererKiB, renderer.memory.workingSetSize); memory.cpuSamples.push(renderer.cpu.percentCPUUsage); }
  }, 100);
  deadline = setTimeout(() => { console.error('Isolated benchmark timed out'); app.exit(1); }, 600000);
  if (label.includes('file-probe')) await window.loadFile(path.join(base, 'index.html'));
  else await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
}).catch((error) => { console.error(error); app.exit(1); });
