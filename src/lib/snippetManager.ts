/**
 * CSS snippet manager — Obsidian-compatible extra stylesheets.
 *
 * Discovers top-level `.css` files in `.openonyx/snippets` (default) and
 * `.obsidian/snippets` (compat). Enabled names persist in
 * `.openonyx/appearance.json` as `enabledCssSnippets`. Same stem in both
 * folders: the OpenOnyx file wins. Does not write `.obsidian/`.
 */

import { getAPI } from "../utils/api";
import {
  mergeAppearanceEnabled,
  parseEnabledCssSnippets,
  safeCssFileName,
  snippetNameFromFile,
} from "./cssSnippets";

export type SnippetSource = "obsidian" | "openonyx";
export type SnippetStatus = "loaded" | "disabled" | "error";

export interface SnippetMeta {
  id: string;
  fileName: string;
  name: string;
  source: SnippetSource;
  relativePath: string;
  enabled: boolean;
  modifiedAt: number;
  size: number;
  status: SnippetStatus;
  error?: string;
  overridesObsidian?: boolean;
}

const SNIPPET_STYLE_ATTR = "data-snippet-id";
const APPEARANCE_PATH = "appearance.json";
const LEGACY_CONFIG_PATH = "snippets-config.json";
const OPENONYX_DATA_DIR = "snippets";
const OPENONYX_VAULT_DIR = ".openonyx/snippets";
const OBSIDIAN_DIR = ".obsidian/snippets";
const OBSIDIAN_APPEARANCE = ".obsidian/appearance.json";
const POLL_INTERVAL_MS = 2000;
const ABSOLUTE_CSS_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

export function isSnippetPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes(".openonyx/snippets/") ||
    normalized.includes(".obsidian/snippets/")
  );
}

export function rewriteSnippetCssUrls(snippetPath: string, css: string): string {
  const dir = snippetPath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  return css
    .replace(/url\(\s*(['"]?)([^"')]+)\1\s*\)/g, (match, _quote: string, rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed || ABSOLUTE_CSS_URL_RE.test(trimmed) || trimmed.includes("..")) return match;
      return `url("vault://local/${dir}/${trimmed}")`;
    })
    .replace(/@import\s+(['"])([^"']+)\1/g, (match, quote: string, rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed || ABSOLUTE_CSS_URL_RE.test(trimmed) || trimmed.includes("..")) return match;
      return match.replace(`${quote}${rawUrl}${quote}`, `"vault://local/${dir}/${trimmed}"`);
    });
}

function displayName(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export class SnippetManager {
  private snippets = new Map<string, SnippetMeta>();
  private cssCache = new Map<string, string>();
  private enabled = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private alive = true;
  private listeners = new Set<() => void>();

  isAlive(): boolean {
    return this.alive;
  }

  async initialize(options?: { pollMs?: number | null }): Promise<void> {
    if (!this.alive) return;
    if (this.initialized) {
      await this.refresh();
      return;
    }
    this.initialized = true;
    await this.loadEnabledFromDisk();
    if (!this.alive) return;
    await this.scan();
    if (!this.alive) return;
    await this.loadAllEnabled();
    if (!this.alive) return;
    this.bindFileListeners();
    const pollMs = options?.pollMs === undefined ? POLL_INTERVAL_MS : options.pollMs;
    if (pollMs && pollMs > 0) {
      this.pollTimer = setInterval(() => {
        if (!this.alive) return;
        void this.pollForChanges();
      }, pollMs);
    }
    this.emit();
  }

  destroy(): void {
    if (!this.alive && !this.initialized) {
      this.enabled.clear();
      this.listeners.clear();
      return;
    }
    this.alive = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.unbindFileListeners();
    this.unloadAll();
    this.snippets.clear();
    this.cssCache.clear();
    this.enabled.clear();
    this.listeners.clear();
    this.initialized = false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnippets(): SnippetMeta[] {
    return Array.from(this.snippets.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  getSnippetNames(): string[] {
    return this.getSnippets().map((snippet) => snippet.id);
  }

  getEnabledSnippets(): Set<string> {
    return this.enabled;
  }

  async scan(): Promise<SnippetMeta[]> {
    if (!this.alive) return [];
    const api = getAPI();
    const discovered = new Map<string, SnippetMeta>();

    const add = (
      fileName: string,
      source: SnippetSource,
      relativePath: string,
      modifiedAt: number,
      size: number,
    ) => {
      const safe = safeCssFileName(fileName);
      const id = snippetNameFromFile(fileName);
      if (!safe || !id) return;
      if (discovered.has(id) && source === "obsidian") {
        const current = discovered.get(id);
        if (current) current.overridesObsidian = true;
        return;
      }
      const existing = this.snippets.get(id);
      const enabled = this.enabled.has(id);
      discovered.set(id, {
        id,
        fileName: safe,
        name: displayName(id),
        source,
        relativePath,
        enabled,
        modifiedAt,
        size,
        status: enabled ? (existing?.status === "error" ? "error" : "loaded") : "disabled",
        error: existing?.error,
        overridesObsidian: existing?.overridesObsidian,
      });
    };

    try {
      const names = await api.dataList(OPENONYX_DATA_DIR);
      for (const fileName of names) {
        add(fileName, "openonyx", `${OPENONYX_VAULT_DIR}/${safeCssFileName(fileName) || fileName}`, 0, 0);
      }
    } catch {
      /* missing */
    }

    try {
      const files = typeof api.listFiles === "function" ? await api.listFiles(OPENONYX_VAULT_DIR) : [];
      for (const file of files || []) {
        if (file.isDirectory) continue;
        add(file.name, "openonyx", `${OPENONYX_VAULT_DIR}/${safeCssFileName(file.name) || file.name}`, file.modifiedAt || 0, file.size || 0);
      }
    } catch {
      /* missing */
    }

    try {
      const files = typeof api.listFiles === "function" ? await api.listFiles(OBSIDIAN_DIR) : [];
      for (const file of files || []) {
        if (file.isDirectory) continue;
        add(file.name, "obsidian", `${OBSIDIAN_DIR}/${safeCssFileName(file.name) || file.name}`, file.modifiedAt || 0, file.size || 0);
      }
    } catch {
      /* missing */
    }

    for (const [id] of this.snippets) {
      if (!discovered.has(id)) this.unloadSnippetCSS(id);
    }

    this.snippets = discovered;
    return this.getSnippets();
  }

  async enable(id: string): Promise<void> {
    if (!this.alive) return;
    if (!id || id.includes("/") || id.includes("\\")) return;
    const snippet = this.snippets.get(id);
    if (!snippet) return;
    snippet.enabled = true;
    this.enabled.add(id);
    await this.loadSnippetCSS(snippet);
    await this.persistEnabled();
    this.emit();
  }

  async disable(id: string): Promise<void> {
    if (!this.alive) return;
    const snippet = this.snippets.get(id);
    if (!snippet) return;
    snippet.enabled = false;
    snippet.status = "disabled";
    snippet.error = undefined;
    this.enabled.delete(id);
    this.unloadSnippetCSS(id);
    await this.persistEnabled();
    this.emit();
  }

  async toggle(id: string): Promise<void> {
    const snippet = this.snippets.get(id);
    if (!snippet) return;
    if (snippet.enabled) await this.disable(id);
    else await this.enable(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) await this.enable(id);
    else await this.disable(id);
  }

  async refresh(): Promise<void> {
    if (!this.alive) return;
    await this.scan();
    await this.loadAllEnabled();
    this.emit();
  }

  async reloadAll(): Promise<void> {
    this.cssCache.clear();
    await this.refresh();
  }

  async createSnippet(name: string): Promise<string | null> {
    if (!this.alive) return null;
    const id = snippetNameFromFile(`${name.replace(/[^a-zA-Z0-9\-_ ]/g, "").trim()}.css`);
    if (!id) return null;
    const fileName = `${id}.css`;
    const path = `${OPENONYX_VAULT_DIR}/${fileName}`;
    const api = getAPI();
    try {
      await api.createDirectory(OPENONYX_VAULT_DIR);
      await api.createFile(
        path,
        `/* ${id}\n * Enable this snippet in Settings → CSS Snippets.\n */\n`,
      );
      await this.scan();
      this.emit();
      return id;
    } catch (err) {
      console.error("[SnippetManager] Failed to create snippet:", err);
      return null;
    }
  }

  async renameSnippet(id: string, newName: string): Promise<boolean> {
    if (!this.alive) return false;
    const snippet = this.snippets.get(id);
    const nextId = snippetNameFromFile(`${newName.replace(/[^a-zA-Z0-9\-_ ]/g, "").trim()}.css`);
    if (!snippet || !nextId) return false;
    if (nextId === id) return true;
    if (this.snippets.has(nextId)) return false;
    const dir = snippet.source === "openonyx" ? OPENONYX_VAULT_DIR : OBSIDIAN_DIR;
    const newPath = `${dir}/${nextId}.css`;
    const api = getAPI();
    try {
      if (typeof api.fileExists === "function" && (await api.fileExists(newPath))) return false;
      await api.renameFile(snippet.relativePath, newPath);
      const wasEnabled = this.enabled.has(id);
      this.enabled.delete(id);
      if (wasEnabled) this.enabled.add(nextId);
      this.unloadSnippetCSS(id);
      this.cssCache.delete(id);
      await this.persistEnabled();
      await this.scan();
      if (wasEnabled) await this.enable(nextId);
      this.emit();
      return true;
    } catch (err) {
      console.error("[SnippetManager] Failed to rename snippet:", err);
      return false;
    }
  }

  async duplicateSnippet(id: string): Promise<string | null> {
    const snippet = this.snippets.get(id);
    if (!snippet) return null;
    const api = getAPI();
    try {
      const content = await api.readFile(snippet.relativePath);
      if (content === null) return null;
      let copyName = `${id}-copy`;
      let counter = 1;
      while (this.snippets.has(copyName)) copyName = `${id}-copy-${counter++}`;
      const dir = snippet.source === "openonyx" ? OPENONYX_VAULT_DIR : OBSIDIAN_DIR;
      await api.writeFile(`${dir}/${copyName}.css`, content);
      await this.scan();
      this.emit();
      return copyName;
    } catch (err) {
      console.error("[SnippetManager] Failed to duplicate snippet:", err);
      return null;
    }
  }

  async deleteSnippet(id: string): Promise<boolean> {
    const snippet = this.snippets.get(id);
    if (!snippet) return false;
    const api = getAPI();
    try {
      this.unloadSnippetCSS(id);
      this.cssCache.delete(id);
      this.enabled.delete(id);
      if (typeof api.trashFile === "function") await api.trashFile(snippet.relativePath);
      else await api.deleteFile(snippet.relativePath);
      await this.persistEnabled();
      this.snippets.delete(id);
      this.emit();
      return true;
    } catch (err) {
      console.error("[SnippetManager] Failed to delete snippet:", err);
      return false;
    }
  }

  async importSnippets(): Promise<string[]> {
    const api = getAPI();
    if (typeof api.showOpenDialog !== "function" || typeof api.snippetsImport !== "function") return [];
    const result = await api.showOpenDialog({
      title: "Import CSS Snippets",
      filters: [{ name: "CSS Files", extensions: ["css"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result?.canceled || !result.filePaths?.length) return [];
    const imported = await api.snippetsImport(result.filePaths);
    await this.scan();
    this.emit();
    return imported || [];
  }

  async exportSnippet(id: string): Promise<boolean> {
    const snippet = this.snippets.get(id);
    if (!snippet) return false;
    const api = getAPI();
    if (typeof api.showSaveDialog !== "function" || typeof api.snippetsExport !== "function") return false;
    const result = await api.showSaveDialog({
      title: "Export CSS Snippet",
      defaultPath: snippet.fileName,
      filters: [{ name: "CSS Files", extensions: ["css"] }],
    });
    if (result?.canceled || !result.filePath) return false;
    await api.snippetsExport(snippet.relativePath, result.filePath);
    return true;
  }

  async revealSnippet(id: string): Promise<void> {
    const snippet = this.snippets.get(id);
    if (!snippet || typeof getAPI().showItemInFolder !== "function") return;
    await getAPI().showItemInFolder(snippet.relativePath);
  }

  async openSnippetsFolder(): Promise<void> {
    const api = getAPI();
    try {
      await api.createDirectory(OPENONYX_VAULT_DIR);
    } catch {
      /* dataList also creates the dir */
    }
    try {
      await api.dataList(OPENONYX_DATA_DIR);
    } catch {
      /* ignore */
    }
    if (typeof api.openPath === "function") await api.openPath(OPENONYX_VAULT_DIR);
  }

  async openInEditor(id: string): Promise<void> {
    const snippet = this.snippets.get(id);
    if (!snippet) return;
    window.dispatchEvent(new CustomEvent("close-settings"));
    const openFile = (window as unknown as { __oo_open_file?: (path: string) => Promise<void> }).__oo_open_file;
    if (openFile) await openFile(snippet.relativePath);
  }

  private async loadSnippetCSS(snippet: SnippetMeta): Promise<void> {
    if (!this.alive) return;
    try {
      let css = this.cssCache.get(snippet.id);
      if (!css) {
        const raw = await this.readSnippetCss(snippet);
        if (raw === "") {
          snippet.status = "error";
          snippet.error = "File not found";
          return;
        }
        css = rewriteSnippetCssUrls(snippet.relativePath, raw);
        this.cssCache.set(snippet.id, css);
      }
      if (!this.alive) return;
      this.unloadSnippetCSS(snippet.id);
      if (typeof document === "undefined") return;
      const style = document.createElement("style");
      style.setAttribute(SNIPPET_STYLE_ATTR, snippet.id);
      style.setAttribute("data-oo-snippet", snippet.id);
      style.setAttribute("data-snippet-source", snippet.source);
      style.textContent = css;
      document.head.appendChild(style);
      snippet.status = "loaded";
      snippet.error = undefined;
    } catch (err) {
      snippet.status = "error";
      snippet.error = err instanceof Error ? err.message : "Failed to load snippet";
    }
  }

  private async readSnippetCss(snippet: SnippetMeta): Promise<string> {
    const api = getAPI();
    const fileName = safeCssFileName(snippet.fileName);
    if (!fileName) return "";
    if (snippet.source === "openonyx") {
      try {
        const fromData = await api.dataRead(`${OPENONYX_DATA_DIR}/${fileName}`);
        if (fromData) return fromData;
      } catch {
        /* fall through */
      }
      try {
        return (await api.readFile(`${OPENONYX_VAULT_DIR}/${fileName}`)) || "";
      } catch {
        return "";
      }
    }
    try {
      return (await api.readFile(`${OBSIDIAN_DIR}/${fileName}`)) || "";
    } catch {
      return "";
    }
  }

  private unloadSnippetCSS(id: string): void {
    this.cssCache.delete(id);
    if (typeof document === "undefined") return;
    document.querySelectorAll(`style[${SNIPPET_STYLE_ATTR}]`).forEach((el) => {
      if (el.getAttribute(SNIPPET_STYLE_ATTR) === id) el.remove();
    });
    document.querySelectorAll(`style[data-oo-snippet]`).forEach((el) => {
      if (el.getAttribute("data-oo-snippet") === id) el.remove();
    });
  }

  private unloadAll(): void {
    this.cssCache.clear();
    if (typeof document === "undefined") return;
    document.querySelectorAll(`style[${SNIPPET_STYLE_ATTR}], style[data-oo-snippet]`).forEach((el) => el.remove());
  }

  private async loadAllEnabled(): Promise<void> {
    for (const snippet of this.getSnippets()) {
      if (snippet.enabled) await this.loadSnippetCSS(snippet);
      else this.unloadSnippetCSS(snippet.id);
    }
  }

  private async loadEnabledFromDisk(): Promise<void> {
    const api = getAPI();
    const local = parseEnabledCssSnippets(await api.dataRead(APPEARANCE_PATH).catch(() => null));
    if (local) {
      this.enabled = new Set(local);
      return;
    }

    try {
      const legacyRaw = await api.dataRead(LEGACY_CONFIG_PATH);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as { enabledSnippets?: Record<string, boolean> };
        const names = Object.entries(parsed.enabledSnippets || {})
          .filter(([, on]) => on)
          .map(([name]) => name);
        this.enabled = new Set(names);
        await this.persistEnabled();
        return;
      }
    } catch {
      /* ignore */
    }

    try {
      const fromObsidian = parseEnabledCssSnippets(await api.readFile(OBSIDIAN_APPEARANCE));
      if (fromObsidian) {
        this.enabled = new Set(fromObsidian);
        await this.persistEnabled();
        return;
      }
    } catch {
      /* ignore */
    }
  }

  private async persistEnabled(): Promise<void> {
    if (!this.alive) return;
    try {
      const existing = await getAPI().dataRead(APPEARANCE_PATH).catch(() => null);
      await getAPI().dataWrite(
        APPEARANCE_PATH,
        mergeAppearanceEnabled(existing, Array.from(this.enabled)),
      );
    } catch (err) {
      console.warn("[SnippetManager] Failed to persist appearance.json:", err);
    }
  }

  private async pollForChanges(): Promise<void> {
    if (!this.alive) return;
    const before = this.getSnippetNames().join("|") + this.getSnippets().map((s) => s.modifiedAt).join(",");
    await this.scan();
    await this.loadAllEnabled();
    const after = this.getSnippetNames().join("|") + this.getSnippets().map((s) => s.modifiedAt).join(",");
    if (before !== after) this.emit();
  }

  private onFileEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ path?: string; oldPath?: string; newPath?: string }>).detail || {};
    const paths = [detail.path, detail.oldPath, detail.newPath].filter(Boolean) as string[];
    if (paths.some(isSnippetPath)) void this.refresh();
  };

  private fileListenersBound = false;

  private bindFileListeners(): void {
    if (this.fileListenersBound || typeof window === "undefined") return;
    window.addEventListener("openonyx:file-written", this.onFileEvent);
    window.addEventListener("openonyx:file-created", this.onFileEvent);
    window.addEventListener("openonyx:file-deleted", this.onFileEvent);
    window.addEventListener("openonyx:file-renamed", this.onFileEvent);
    this.fileListenersBound = true;
  }

  private unbindFileListeners(): void {
    if (!this.fileListenersBound || typeof window === "undefined") return;
    window.removeEventListener("openonyx:file-written", this.onFileEvent);
    window.removeEventListener("openonyx:file-created", this.onFileEvent);
    window.removeEventListener("openonyx:file-deleted", this.onFileEvent);
    window.removeEventListener("openonyx:file-renamed", this.onFileEvent);
    this.fileListenersBound = false;
  }

  private emit(): void {
    if (!this.alive) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("snippets-changed", { detail: { snippets: this.getSnippets() } }));
    }
  }
}

let instance: SnippetManager | null = null;

export function getSnippetManager(): SnippetManager {
  if (!instance || !instance.isAlive()) instance = new SnippetManager();
  return instance;
}

export function peekSnippetManager(): SnippetManager | null {
  return instance && instance.isAlive() ? instance : null;
}

export function destroySnippetManager(): void {
  instance?.destroy();
  instance = null;
}

export async function startCssSnippets(options?: { pollMs?: number | null }): Promise<SnippetManager> {
  const mgr = getSnippetManager();
  await mgr.initialize(options);
  return mgr;
}

export function stopCssSnippets(target?: SnippetManager): void {
  if (target) {
    target.destroy();
    if (instance === target) instance = null;
    return;
  }
  destroySnippetManager();
}

export function refreshCssSnippets(): Promise<void> {
  const mgr = peekSnippetManager();
  if (!mgr) return Promise.resolve();
  return mgr.refresh();
}

export async function setCssSnippetEnabled(name: string, enabled: boolean): Promise<void> {
  const mgr = peekSnippetManager();
  if (!mgr) return;
  await mgr.setEnabled(name, enabled);
}

export function getCssSnippets() {
  return (peekSnippetManager()?.getSnippets() ?? []).map((snippet) => ({
    name: snippet.id,
    fileName: snippet.fileName,
    path: snippet.relativePath,
    source: snippet.source,
    enabled: snippet.enabled,
  }));
}

export function getCssSnippetNames(): string[] {
  return peekSnippetManager()?.getSnippetNames() ?? [];
}

export function getEnabledCssSnippetSet(): Set<string> {
  return peekSnippetManager()?.getEnabledSnippets() ?? new Set();
}

export function subscribeCssSnippets(listener: () => void): () => void {
  return getSnippetManager().subscribe(listener);
}

export async function openCssSnippetsFolder(): Promise<void> {
  await getSnippetManager().openSnippetsFolder();
}

export function resetCssSnippetsForTests(): void {
  destroySnippetManager();
}

export const cssSnippetsApi = {
  get snippets() {
    return getCssSnippetNames();
  },
  get enabledSnippets() {
    return getEnabledCssSnippetSet();
  },
  theme: "",
  themes: {} as Record<string, unknown>,
  requestLoadSnippets: () => refreshCssSnippets(),
  setCssEnabledStatus: (snippet: string, enabled: boolean) => setCssSnippetEnabled(snippet, enabled),
  loadSnippet: (snippet: string) => setCssSnippetEnabled(snippet, true),
  unloadSnippet: (snippet: string) => {
    void setCssSnippetEnabled(snippet, false);
  },
};
