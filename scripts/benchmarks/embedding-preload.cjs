const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('benchmark', {
  config: () => ipcRenderer.invoke('bench:config'),
  model: (subpath) => ipcRenderer.invoke('bench:model', subpath),
  report: (result) => ipcRenderer.invoke('bench:report', result),
});
contextBridge.exposeInMainWorld('electronAPI', {
  dataRead: (path) => ipcRenderer.invoke('bench:dataRead', path),
  dataWrite: (path, content, vault) => ipcRenderer.invoke('bench:dataWrite', path, content, vault),
  dataList: (path) => ipcRenderer.invoke('bench:dataList', path),
  dataDelete: () => Promise.reject(new Error('Benchmark cannot delete embedding data')),
  getVaultPath: () => ipcRenderer.invoke('bench:vault'),
  fileMetadata: (path) => ipcRenderer.invoke('bench:metadata', path),
  readFile: (path) => ipcRenderer.invoke('bench:read', path),
  embeddingCacheRead: (subpath) => ipcRenderer.invoke('bench:model', subpath),
  embeddingCacheWrite: () => Promise.resolve(),
});
