/**
 * IPC Handler Registration
 * 
 * Centralizes all IPC channel registrations for clean separation.
 * Each handler validates inputs and delegates to the appropriate manager.
 */

import { app, IpcMain, BrowserWindow, clipboard, dialog, shell } from 'electron';
import * as fs from 'fs/promises';
import * as nodePath from 'path';
import { FileSystemManager } from './fileSystem.js';
import { SearchEngine } from './search.js';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  fsManager: FileSystemManager,
  searchEngine: SearchEngine,
  getMainWindow: () => BrowserWindow | null,
  onVaultPathChange?: (vaultPath: string) => void,
  getPreviousPaths?: () => string[],
  removePreviousPath?: (vaultPath: string) => string[],
): void {

  // ── Vault Operations ──────────────────────────────
  ipcMain.handle('vault:setPath', async (_event, vaultPath: string) => {
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
    return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
  });

  ipcMain.handle('desktop:showSaveDialog', async (_event, options: Electron.SaveDialogOptions) => {
    const owner = getMainWindow();
    return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options);
  });

  ipcMain.handle('desktop:openPath', async (_event, targetPath: string) => shell.openPath(targetPath));
  ipcMain.handle('desktop:showItemInFolder', (_event, targetPath: string) => shell.showItemInFolder(targetPath));
  ipcMain.handle('desktop:getPath', (_event, name: Parameters<typeof app.getPath>[0]) => app.getPath(name));

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
    searchEngine.buildIndex(fsManager).catch(console.error);
  });

  ipcMain.handle('fs:deleteDirectory', async (_event, dirPath: string) => {
    await fsManager.deleteDirectory(dirPath);
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
      const res = await fetch(url, {
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
      console.error('[data:fetch] Error:', e.message);
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
      const url = params.url;
      const options: RequestInit = {
        method: params.method || 'GET',
        headers: {
          'User-Agent': 'OpenOnyx/1.0',
          ...params.headers,
        },
        body: params.body,
      };

      const res = await fetch(url, options);
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
      console.error('[network:request] Failed:', err.message);
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
