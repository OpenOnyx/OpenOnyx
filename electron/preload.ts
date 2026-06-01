/**
 * Preload Script - Bridge between Main and Renderer
 * 
 * Exposes a secure API to the renderer process via contextBridge.
 * All filesystem and system operations are proxied through IPC channels.
 */

import { contextBridge, ipcRenderer } from 'electron';

/** Type-safe API exposed to the renderer */
const electronAPI = {
  // ── Vault Operations ──────────────────────────────
  openVaultDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  
  setVaultPath: (vaultPath: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:setPath', vaultPath),

  getVaultPath: (): Promise<string | null> =>
    ipcRenderer.invoke('vault:getPath'),

  setCryptoKey: (spaceId: string, base64Key: string | null, visibility: string | null = 'private'): Promise<void> =>
    ipcRenderer.invoke('vault:setCryptoKey', spaceId, base64Key, visibility),

  getPreviouslyOpenedVaults: (): Promise<string[]> =>
    ipcRenderer.invoke('vault:getPreviousPaths'),

  // ── File Operations ───────────────────────────────
  listFiles: (dirPath?: string): Promise<any[]> =>
    ipcRenderer.invoke('fs:listFiles', dirPath),
  
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  
  createFile: (filePath: string, content?: string): Promise<void> =>
    ipcRenderer.invoke('fs:createFile', filePath, content),
  
  deleteFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('fs:deleteFile', filePath),
  
  renameFile: (oldPath: string, newPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:renameFile', oldPath, newPath),
  
  createDirectory: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:createDirectory', dirPath),
  
  deleteDirectory: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:deleteDirectory', dirPath),

  fileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:fileExists', filePath),

  getFileTree: (): Promise<any> =>
    ipcRenderer.invoke('fs:getFileTree'),

  // ── Search Operations ─────────────────────────────
  search: (query: string): Promise<any[]> =>
    ipcRenderer.invoke('search:query', query),
  
  rebuildIndex: (): Promise<void> =>
    ipcRenderer.invoke('search:rebuildIndex'),

  // ── Graph Operations ──────────────────────────────
  getGraphData: (): Promise<any> =>
    ipcRenderer.invoke('graph:getData'),

  getBacklinks: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('graph:getBacklinks', filePath),

  // ── Window Controls ───────────────────────────────
  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window:maximize'),
  closeWindow: (): void => ipcRenderer.send('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  // ── Menu Event Listeners ──────────────────────────
  onMenuEvent: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = [
      'menu:open-vault', 'menu:new-note', 'menu:save',
      'menu:toggle-graph', 'menu:command-palette', 'menu:toggle-sidebar',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  removeMenuListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // ── Daily Note ────────────────────────────────────
  createDailyNote: (): Promise<string> =>
    ipcRenderer.invoke('notes:createDaily'),

  // ── Tags ──────────────────────────────────────────
  getAllTags: (): Promise<Record<string, string[]>> =>
    ipcRenderer.invoke('tags:getAll'),

  // ── Attachments/Images ────────────────────────────
  saveImage: (fileName: string, base64Data: string): Promise<string> =>
    ipcRenderer.invoke('attachments:saveImage', fileName, base64Data),

  saveImageDedup: (fileName: string, base64Data: string): Promise<{ relativePath: string; isDuplicate: boolean }> =>
    ipcRenderer.invoke('attachments:saveImageDedup', fileName, base64Data),

  // ── .openobsidian Data Storage ────────────────────
  dataRead: (relativePath: string): Promise<string | null> =>
    ipcRenderer.invoke('data:read', relativePath),

  dataWrite: (relativePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('data:write', relativePath, content),

  dataDelete: (relativePath: string): Promise<void> =>
    ipcRenderer.invoke('data:delete', relativePath),

  dataList: (subDir: string): Promise<string[]> =>
    ipcRenderer.invoke('data:list', subDir),

  dataFetch: (url: string): Promise<string> =>
    ipcRenderer.invoke('data:fetch', url),

  // ── Clipboard ────────────────────────────────────
  writeClipboardText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:writeText', text),

  readClipboardText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard:readText'),

  networkRequest: (params: any): Promise<any> =>
    ipcRenderer.invoke('network:request', params),

  // ── Thought Model ─────────────────────────────────
  thoughtModel: {
    build: (vaultPath: string, numClusters?: number): Promise<{ job_id: string; status: string }> =>
      ipcRenderer.invoke('thoughtModel:build', vaultPath, numClusters),
    
    status: (jobId: string): Promise<{
      job_id: string;
      status: string;
      progress?: number;
      message?: string;
      error?: string;
      total_notes?: number;
      total_chunks?: number;
    }> => ipcRenderer.invoke('thoughtModel:status', jobId),
    
    themes: (jobId: string): Promise<{
      themes: Array<{
        cluster_id: number;
        keywords: string[];
        representative_chunks: Array<{
          chunk_id: string;
          note_id: string;
          note_path: string;
          note_title: string;
          chunk_text: string;
        }>;
        note_count: number;
      }>;
      total_notes: number;
      total_chunks: number;
    }> => ipcRenderer.invoke('thoughtModel:themes', jobId),
    
    query: (jobId: string, query: string, topK?: number): Promise<{
      query: string;
      results: Array<{
        score: number;
        note_title: string;
        note_path: string;
        chunk_text: string;
        cluster_id: number;
      }>;
    }> => ipcRenderer.invoke('thoughtModel:query', jobId, query, topK),
    
    clear: (jobId: string): Promise<{ status: string; job_id: string }> =>
      ipcRenderer.invoke('thoughtModel:clear', jobId),
    
    health: (): Promise<boolean> =>
      ipcRenderer.invoke('thoughtModel:health'),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} else {
  // If contextIsolation is off, attach directly to the window object.
  // Using globalThis to bypass TS errors since DOM lib is omitted in electron tsconfig.
  const win = (globalThis as any).window;
  if (win) {
    win.electronAPI = electronAPI;
    win.ipcRenderer = ipcRenderer;
  }
}

export type ElectronAPI = typeof electronAPI;
