/**
 * API Bridge
 *
 * Provides a unified API interface that uses the real Electron API
 * when running inside Electron, or falls back to a browser-compatible
 * mock for development and testing.
 */

import { createMockAPI } from "./mockAPI";
import { requestFileMetadata } from "./filesystem-ipc";

type API = typeof window.electronAPI;

let _api: API | null = null;
let _rawApi: API | null = null;

type FileChangeDetail = {
  path: string;
  content?: string;
  created?: boolean;
};

function dispatchFileChange(type: string, detail: FileChangeDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function observeFileChanges(api: API): API {
  return {
    ...api,
    fileMetadata: (filePath, expectedVault) => requestFileMetadata(api, filePath, expectedVault),
    async setVaultPath(vaultPath: string): Promise<boolean> {
      // Invalidate before IPC changes the main-process root. A React effect
      // runs too late to protect jobs while the native vault switch is pending.
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('openonyx:vault-changing'));
      const success = await api.setVaultPath(vaultPath);
      if (success && typeof window !== 'undefined') (window as any).__oo_vault_path = vaultPath || undefined;
      return success;
    },
    async createFile(filePath: string, content?: string): Promise<void> {
      const existed = await api.fileExists(filePath).catch(() => false);
      await api.createFile(filePath, content);
      if (existed) return;
      const detail = { path: filePath, content: content || "", created: true };
      dispatchFileChange("openonyx:file-created", detail);
      dispatchFileChange("openonyx:file-written", detail);
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      const existed = await api.fileExists(filePath).catch(() => true);
      await api.writeFile(filePath, content);
      const detail = { path: filePath, content, created: !existed };
      if (!existed) {
        dispatchFileChange("openonyx:file-created", detail);
      }
      dispatchFileChange("openonyx:file-written", detail);
    },
    async createDirectory(dirPath: string): Promise<void> {
      await api.createDirectory(dirPath);
      dispatchFileChange("openonyx:directory-created", { path: dirPath, created: true });
    },
  } as API;
}

export function getAPI(): API {
  if (window.electronAPI) {
    // Electron replaces this bridge when a renderer reloads. Refresh the
    // cached reference so plugin and vault operations never target a stale
    // preload object.
    if (_rawApi !== window.electronAPI) {
      _rawApi = window.electronAPI;
      _api = observeFileChanges(window.electronAPI);
    }
    return _api!;
  }

  if (!_api) {
    // Running in browser — use mock API
    console.log(
      "%c[OpenOnyx] Running in browser mode with mock API",
      "color: #6c63ff; font-weight: bold;",
    );
    _rawApi = createMockAPI();
    _api = observeFileChanges(_rawApi);
  }

  return _api!;
}
