/**
 * IPC Handler Registration
 * 
 * Centralizes all IPC channel registrations for clean separation.
 * Each handler validates inputs and delegates to the appropriate manager.
 */

import { app, IpcMain, BrowserWindow, clipboard, dialog, shell } from 'electron';
import * as fs from 'fs/promises';
import * as nodeFs from 'fs';
import * as nodePath from 'path';
import { FileSystemManager } from './fileSystem.js';
import { SearchEngine } from './search.js';
import { allowedExternalUrl } from './externalUrl.js';
import { fetchPublicHttp } from './outboundUrl.js';
import { isInsideRoot } from './pathSafety.js';
import { approveVaultPath, isApprovedVaultPath, seedApprovedVaultPaths } from './vaultAccess.js';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  fsManager: FileSystemManager,
  searchEngine: SearchEngine,
  getMainWindow: () => BrowserWindow | null,
  onVaultPathChange?: (vaultPath: string) => void,
  getPreviousPaths?: () => string[],
  removePreviousPath?: (vaultPath: string) => string[],
): void {
  seedApprovedVaultPaths([
    fsManager.getVaultPath?.(),
    ...(getPreviousPaths ? getPreviousPaths() : []),
  ]);

  type VaultFileChange = {
    type: 'create' | 'modify' | 'delete' | 'rename';
    path: string;
    isDirectory: boolean;
    timestamp: number;
  };

  const watchedDirs = new Map<string, nodeFs.FSWatcher>();
  const pendingChanges = new Map<string, VaultFileChange>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  const normalizeRelativePath = (absolutePath: string): string | null => {
    const vaultPath = fsManager.getVaultPath();
    if (!vaultPath) return null;
    const relative = nodePath.relative(vaultPath, absolutePath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || nodePath.isAbsolute(relative)) return null;
    return relative;
  };

  const shouldIgnoreRelativePath = (relativePath: string): boolean => {
    return relativePath
      .split('/')
      .some((part) => part.startsWith('.') || part === 'node_modules');
  };

  const flushVaultFileChanges = () => {
    flushTimer = null;
    const changes = [...pendingChanges.values()];
    pendingChanges.clear();
    if (changes.length === 0) return;
    getMainWindow()?.webContents.send('vault:file-changes', changes);
  };

  const queueVaultFileChange = (change: VaultFileChange) => {
    if (shouldIgnoreRelativePath(change.path)) return;
    pendingChanges.set(change.path, change);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushVaultFileChanges, 150);
  };

  const closeVaultWatchers = () => {
    for (const watcher of watchedDirs.values()) watcher.close();
    watchedDirs.clear();
    pendingChanges.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (rescanTimer) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
  };

  const scheduleWatcherRescan = () => {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      startVaultWatchers();
    }, 300);
  };

  const watchDirectory = (absoluteDir: string) => {
    if (watchedDirs.has(absoluteDir)) return;
    try {
      const watcher = nodeFs.watch(absoluteDir, (eventType, fileName) => {
        if (!fileName) {
          scheduleWatcherRescan();
          return;
        }

        const absolutePath = nodePath.join(absoluteDir, fileName.toString());
        const relativePath = normalizeRelativePath(absolutePath);
        if (!relativePath || shouldIgnoreRelativePath(relativePath)) return;

        let exists = false;
        let isDirectory = false;
        try {
          const stats = nodeFs.statSync(absolutePath);
          exists = true;
          isDirectory = stats.isDirectory();
        } catch {
          exists = false;
        }

        queueVaultFileChange({
          type: eventType === 'rename' ? (exists ? 'create' : 'delete') : 'modify',
          path: relativePath,
          isDirectory,
          timestamp: Date.now(),
        });

        if (eventType === 'rename') scheduleWatcherRescan();
        if (isDirectory) scheduleWatcherRescan();
      });
      watcher.on('error', (err) => {
        console.warn(`[IPC] Vault watcher failed for ${absoluteDir}:`, err);
        watcher.close();
        watchedDirs.delete(absoluteDir);
      });
      watchedDirs.set(absoluteDir, watcher);
    } catch (err) {
      console.warn(`[IPC] Failed to watch vault directory ${absoluteDir}:`, err);
    }
  };

  function startVaultWatchers() {
    const vaultPath = fsManager.getVaultPath();
    closeVaultWatchers();
    if (!vaultPath) return;

    const walk = (absoluteDir: string) => {
      watchDirectory(absoluteDir);
      let entries: nodeFs.Dirent[] = [];
      try {
        entries = nodeFs.readdirSync(absoluteDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(nodePath.join(absoluteDir, entry.name));
      }
    };

    walk(vaultPath);
  }

  const resolveInsideCurrentVault = (targetPath: string): string => {
    const vaultPath = fsManager.getVaultPath();
    if (!vaultPath) throw new Error('No vault path set');
    const resolved = nodePath.isAbsolute(targetPath)
      ? nodePath.resolve(targetPath)
      : fsManager.getAbsolutePath(targetPath);
    if (!isInsideRoot(vaultPath, resolved)) {
      throw new Error('Path is outside the active vault');
    }
    return resolved;
  };

  // ── Vault Operations ──────────────────────────────
  ipcMain.handle('vault:setPath', async (_event, vaultPath: string) => {
    if (vaultPath && !isApprovedVaultPath(vaultPath)) {
      throw new Error('Vault path must come from a folder dialog or a previously opened vault');
    }
    const success = fsManager.setVaultPath(vaultPath);
    if (success) {
      if (onVaultPathChange) onVaultPathChange(vaultPath);
      // Set CWD to vault path so relative paths in plugins work correctly
      try {
        process.chdir(vaultPath);
        console.log(`[IPC] Changed CWD to: ${vaultPath}`);
      } catch (err) {
        console.warn(`[IPC] Failed to change CWD to ${vaultPath}:`, err);
      }
      
      // Rebuild search index when vault changes
      await searchEngine.buildIndex(fsManager);
      startVaultWatchers();
    }
    return success;
  });

  ipcMain.handle('vault:getPath', () => {
    return fsManager.getVaultPath();
  });

  ipcMain.handle('vault:getPreviousPaths', () => {
    if (getPreviousPaths) return getPreviousPaths();
    return [];
  });

  ipcMain.handle('vault:removePreviousPath', (_event, vaultPath: string) => {
    if (removePreviousPath) return removePreviousPath(vaultPath);
    return [];
  });

  ipcMain.handle('desktop:showOpenDialog', async (_event, options: Electron.OpenDialogOptions) => {
    const owner = getMainWindow();
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    result.filePaths?.forEach((filePath) => approveVaultPath(filePath));
    return result;
  });

  ipcMain.handle('desktop:showSaveDialog', async (_event, options: Electron.SaveDialogOptions) => {
    const owner = getMainWindow();
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    approveVaultPath(result.filePath);
    return result;
  });

  ipcMain.handle('desktop:openPath', async (_event, targetPath: string) => {
    return shell.openPath(resolveInsideCurrentVault(targetPath));
  });
  ipcMain.handle('desktop:openExternal', async (_event, url: string) => {
    await shell.openExternal(allowedExternalUrl(url));
  });
  ipcMain.handle('desktop:showItemInFolder', (_event, targetPath: string) => {
    shell.showItemInFolder(resolveInsideCurrentVault(targetPath));
  });
  ipcMain.handle('desktop:getPath', (_event, name: Parameters<typeof app.getPath>[0]) => app.getPath(name));

  ipcMain.handle('desktop:renamePath', async (_event, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) throw new Error('Missing path');
    if (!isApprovedVaultPath(oldPath)) {
      throw new Error('Source vault is not approved');
    }
    const resolvedOld = nodePath.resolve(oldPath);
    const resolvedNew = nodePath.resolve(newPath);
    const sourceParent = nodePath.dirname(resolvedOld);
    const destParent = nodePath.dirname(resolvedNew);
    if (destParent !== sourceParent && !isApprovedVaultPath(destParent)) {
      throw new Error('Destination is not approved');
    }
    await fs.rename(resolvedOld, resolvedNew);
    approveVaultPath(resolvedNew);
  });

  // ── File Operations ───────────────────────────────
  ipcMain.handle('fs:listFiles', async (_event, dirPath?: string) => {
    return fsManager.listFiles(dirPath || '');
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fsManager.readFile(filePath);
  });

  ipcMain.handle('fs:readBinary', async (_event, filePath: string) => {
    return fsManager.readBinary(filePath);
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fsManager.writeFile(filePath, content);
    // Update search index in background (don't await to avoid blocking)
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:writeBinary', async (_event, filePath: string, content: Uint8Array) => {
    await fsManager.writeBinary(filePath, content);
  });

  ipcMain.handle('fs:createFile', async (_event, filePath: string, content?: string) => {
    await fsManager.createFile(filePath, content || '');
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
    await fsManager.deleteFile(filePath);
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:trashFile', async (_event, filePath: string) => {
    await shell.trashItem(fsManager.getAbsolutePath(filePath));
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:renameFile', async (_event, oldPath: string, newPath: string) => {
    await fsManager.renameFile(oldPath, newPath);
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:createDirectory', async (_event, dirPath: string) => {
    await fsManager.createDirectory(dirPath);
    scheduleWatcherRescan();
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:deleteDirectory', async (_event, dirPath: string) => {
    await fsManager.deleteDirectory(dirPath);
    scheduleWatcherRescan();
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:fileExists', async (_event, filePath: string) => {
    return fsManager.fileExists(filePath);
  });

  ipcMain.handle('fs:getFileTree', async () => {
    return fsManager.getFileTree();
  });

  // ── Search Operations ─────────────────────────────
  ipcMain.handle('search:query', async (_event, query: string) => {
    return searchEngine.search(query);
  });

  ipcMain.handle('search:rebuildIndex', async () => {
    await searchEngine.buildIndex(fsManager);
  });

  // ── Graph Operations ──────────────────────────────
  ipcMain.handle('graph:getData', async () => {
    return fsManager.buildGraph();
  });

  ipcMain.handle('graph:getBacklinks', async (_event, filePath: string) => {
    return fsManager.getBacklinks(filePath);
  });

  // ── Tags ──────────────────────────────────────────
  ipcMain.handle('tags:getAll', async () => {
    return fsManager.getAllTags();
  });

  // ── Daily Notes ───────────────────────────────────
  ipcMain.handle('notes:createDaily', async () => {
    return fsManager.createDailyNote();
  });

  // ── Window Controls ───────────────────────────────
  ipcMain.on('window:minimize', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    getMainWindow()?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return getMainWindow()?.isMaximized() || false;
  });

  ipcMain.handle('window:isFullScreen', () => {
    return getMainWindow()?.isFullScreen() || false;
  });

  // ── Attachments/Images ────────────────────────────
  ipcMain.handle('attachments:saveImage', async (_event, fileName: string, base64Data: string) => {
    return fsManager.saveImage(fileName, base64Data);
  });

  ipcMain.handle('attachments:saveImageDedup', async (_event, fileName: string, base64Data: string) => {
    return fsManager.saveAttachmentDedup(fileName, base64Data);
  });

  // ── .openonyx Data Storage ────────────────────
  ipcMain.handle('data:read', async (_event, relativePath: string) => {
    return fsManager.readDataFile(relativePath);
  });

  ipcMain.handle('data:write', async (_event, relativePath: string, content: string) => {
    await fsManager.writeDataFile(relativePath, content);
  });

  ipcMain.handle('data:delete', async (_event, relativePath: string) => {
    await fsManager.deleteDataFile(relativePath);
  });

  ipcMain.handle('data:list', async (_event, subDir: string) => {
    return fsManager.listDataDir(subDir);
  });

  // ── Network (CORS Bypass) ─────────────────────────
  ipcMain.handle('data:fetch', async (_event, url: string) => {
    try {
      const res = await fetchPublicHttp(url, {
        headers: {
          'User-Agent': 'OpenOnyx/1.0',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}: ${body.slice(0, 200)}`);
      }
      return await res.text();
    } catch (e: any) {
      const causeMsg = e?.cause?.message || e?.cause;
      const fullMsg = causeMsg ? `${e.message} (${causeMsg})` : e.message;
      console.error('[data:fetch] Error:', fullMsg);
      throw e;
    }
  });

  // ── Clipboard ────────────────────────────────────
  ipcMain.handle('clipboard:writeText', async (_event, text: string) => {
    clipboard.writeText(text || '');
  });

  ipcMain.handle('clipboard:readText', async () => {
    return clipboard.readText();
  });

  ipcMain.handle('pdf:exportMarkdown', async (_event, params: { html: string; defaultPath?: string }) => {
    if (!params?.html) throw new Error('No PDF HTML was provided.');

    const owner = getMainWindow();
    const saveResult = owner
      ? await dialog.showSaveDialog(owner, {
          title: 'Export to PDF',
          defaultPath: params.defaultPath || 'Untitled.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : await dialog.showSaveDialog({
          title: 'Export to PDF',
          defaultPath: params.defaultPath || 'Untitled.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true as const, filePath: null };
    }

    const tempHtmlPath = nodePath.join(app.getPath('temp'), `openonyx-export-${Date.now()}.html`);
    let pdfWindow: BrowserWindow | null = null;

    try {
      await fs.writeFile(tempHtmlPath, params.html, 'utf8');
      pdfWindow = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: false,
        },
      });

      await pdfWindow.loadFile(tempHtmlPath);
      await pdfWindow.webContents.executeJavaScript(`
        Promise.all([
          document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
          Promise.all(Array.from(document.images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          }))
        ])
      `);

      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'Letter',
        margins: { marginType: 'default' },
      });
      await fs.writeFile(saveResult.filePath, pdfBuffer);
      return { canceled: false as const, filePath: saveResult.filePath };
    } finally {
      if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
      await fs.unlink(tempHtmlPath).catch(() => {});
    }
  });

  ipcMain.handle('network:request', async (_event, params: any) => {
    try {
      const res = await fetchPublicHttp(params?.url, {
        method: params.method || 'GET',
        headers: {
          'User-Agent': 'OpenOnyx/1.0',
          ...params.headers,
        },
        body: params.body,
      });
      const arrayBuffer = await res.arrayBuffer();
      
      // IPC can clone ArrayBuffer or Uint8Array
      const buffer = new Uint8Array(arrayBuffer);
      
      const text = new TextDecoder().decode(buffer);
      let json = null;
      try { json = JSON.parse(text); } catch { }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => { responseHeaders[key] = val; });

      return {
        status: res.status,
        headers: responseHeaders,
        text,
        json,
        arrayBuffer: buffer.buffer // send back the raw ArrayBuffer
      };
    } catch (err: any) {
      const causeMsg = err?.cause?.message || err?.cause;
      const fullMsg = causeMsg ? `${err.message} (${causeMsg})` : err.message;
      console.error('[network:request] Failed:', fullMsg);
      throw err;
    }
  });

  // ── Thought Model ─────────────────────────────────
  const THOUGHT_MODEL_URL = 'http://127.0.0.1:8765';

  const isConnRefused = (err: unknown): boolean => {
    return err instanceof Error && 'code' in err && (err as any).code === 'ECONNREFUSED';
  };

  interface APIError { detail?: string }

  ipcMain.handle('thoughtModel:build', async (_event, vaultPath: string, numClusters: number = 12) => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vault_path: vaultPath, num_clusters: numClusters }),
      });
      if (!response.ok) {
        const errorData = await response.json() as APIError;
        throw new Error(errorData.detail || 'Build request failed');
      }
      return await response.json();
    } catch (err) {
      if (isConnRefused(err)) {
        throw new Error('Thought Model service not running. Please start it with: cd thought_model && python main.py');
      }
      throw err;
    }
  });

  ipcMain.handle('thoughtModel:status', async (_event, jobId: string) => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/status?job_id=${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        const errorData = await response.json() as APIError;
        throw new Error(errorData.detail || 'Status request failed');
      }
      return await response.json();
    } catch (err) {
      if (isConnRefused(err)) {
        throw new Error('Thought Model service not running');
      }
      throw err;
    }
  });

  ipcMain.handle('thoughtModel:themes', async (_event, jobId: string) => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/themes?job_id=${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        const errorData = await response.json() as APIError;
        throw new Error(errorData.detail || 'Themes request failed');
      }
      return await response.json();
    } catch (err) {
      if (isConnRefused(err)) {
        throw new Error('Thought Model service not running');
      }
      throw err;
    }
  });

  ipcMain.handle('thoughtModel:query', async (_event, jobId: string, query: string, topK: number = 10) => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, query, top_k: topK }),
      });
      if (!response.ok) {
        const errorData = await response.json() as APIError;
        throw new Error(errorData.detail || 'Query request failed');
      }
      return await response.json();
    } catch (err) {
      if (isConnRefused(err)) {
        throw new Error('Thought Model service not running');
      }
      throw err;
    }
  });

  ipcMain.handle('thoughtModel:clear', async (_event, jobId: string) => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/clear?job_id=${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json() as APIError;
        throw new Error(errorData.detail || 'Clear request failed');
      }
      return await response.json();
    } catch (err) {
      if (isConnRefused(err)) {
        throw new Error('Thought Model service not running');
      }
      throw err;
    }
  });

  ipcMain.handle('thoughtModel:health', async () => {
    try {
      const response = await fetch(`${THOUGHT_MODEL_URL}/health`);
      return response.ok;
    } catch {
      return false;
    }
  });
}
