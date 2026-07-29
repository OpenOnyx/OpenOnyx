/**
 * API Bridge
 *
 * Provides a unified API interface that uses the real Electron API
 * when running inside Electron, or falls back to a browser-compatible
 * mock for development and testing.
 */

import { createMockAPI } from "./mockAPI";

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
      "color: #E8A84A; font-weight: bold;",
    );
    _rawApi = createMockAPI();
    _api = observeFileChanges(_rawApi);
  }

  return _api!;
}
