/**
 * CSS snippets — extra stylesheets on top of the current theme.
 *
 * Discovers top-level `.css` files in `.openonyx/snippets` (default) and
 * `.obsidian/snippets` (compat). Enabled names persist in
 * `.openonyx/appearance.json` as `enabledCssSnippets`, seeded from
 * Obsidian's appearance.json when OpenOnyx has no record yet.
 *
 * Each enabled snippet is a `style[data-oo-snippet]` tag. Built-in theme
 * CSS is never rewritten. This module does not write `.obsidian/`.
 */

import { getAPI } from "../utils/api";

export type CssSnippetSource = "openonyx" | "obsidian";

export interface CssSnippet {
  name: string;
  fileName: string;
  path: string;
  source: CssSnippetSource;
  enabled: boolean;
}

export interface AppearanceFile {
  enabledCssSnippets?: string[];
  [key: string]: unknown;
}

const SNIPPET_ATTR = "data-oo-snippet";
const APPEARANCE_PATH = "appearance.json";
const OPENONYX_SNIPPETS_DIR = "snippets";
const OPENONYX_VAULT_SNIPPETS = ".openonyx/snippets";
const OBSIDIAN_SNIPPETS_DIR = ".obsidian/snippets";
const OBSIDIAN_APPEARANCE_PATH = ".obsidian/appearance.json";
const LOCAL_STORAGE_KEY = "oo_plugin_enabled-css-snippets";
const DEFAULT_POLL_MS = 2000;

const enabledSet = new Set<string>();
const injectedCss = new Map<string, string>();
const listeners = new Set<() => void>();

let snippets: CssSnippet[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let refreshChain: Promise<void> = Promise.resolve();
let fileListenersBound = false;

function onSnippetsFileEvent(event: Event): void {
  const detail = (event as CustomEvent<{ path?: string; oldPath?: string; newPath?: string }>).detail || {};
  const paths = [detail.path, detail.oldPath, detail.newPath].filter(Boolean) as string[];
  if (paths.some(isSnippetPath)) {
    void refreshCssSnippets();
  }
}

export function snippetNameFromFile(fileName: string): string | null {
  const base = safeCssFileName(fileName);
  if (!base) return null;
  return base.slice(0, -4);
}

/** Basename-only `.css` file. Rejects traversal and hidden names. */
export function safeCssFileName(fileName: string): string | null {
  const base = fileName.replace(/\\/g, "/").split("/").pop() || "";
  if (!base || base.startsWith(".") || base.includes("\0")) return null;
  if (!base.toLowerCase().endsWith(".css")) return null;
  const stem = base.slice(0, -4);
  if (!stem || stem === "." || stem === "..") return null;
  return base;
}

export function parseEnabledCssSnippets(raw: string | null | undefined): string[] | null {
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw) as AppearanceFile;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.enabledCssSnippets)) return [];
    return parsed.enabledCssSnippets.filter((name): name is string =>
      typeof name === "string" && name.trim().length > 0 && !name.includes("/") && !name.includes("\\"),
    );
  } catch {
    return null;
  }
}

export function mergeAppearanceEnabled(existingRaw: string | null | undefined, enabled: string[]): string {
  let existing: AppearanceFile = {};
  if (existingRaw && existingRaw.trim()) {
    try {
      const parsed = JSON.parse(existingRaw) as AppearanceFile;
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch {
      existing = {};
    }
  }
  return JSON.stringify(
    {
      ...existing,
      enabledCssSnippets: [...enabled].sort((a, b) => a.localeCompare(b)),
    },
    null,
    2,
  );
}

export function isSnippetPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes(".openonyx/snippets/") ||
    normalized.includes(".obsidian/snippets/") ||
    /(^|\/)snippets\/[^/]+\.css$/i.test(normalized)
  );
}

export function getCssSnippets(): CssSnippet[] {
  return snippets.map((snippet) => ({ ...snippet }));
}

export function getEnabledCssSnippetSet(): Set<string> {
  return enabledSet;
}

export function getCssSnippetNames(): string[] {
  return snippets.map((snippet) => snippet.name);
}

export function subscribeCssSnippets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[CssSnippets] listener failed:", err);
    }
  }
}

function canUseDom(): boolean {
  return typeof document !== "undefined";
}

function injectSnippet(name: string, css: string): void {
  if (!canUseDom()) return;
  removeInjected(name);
  const style = document.createElement("style");
  style.setAttribute(SNIPPET_ATTR, name);
  style.textContent = css;
  document.head.appendChild(style);
  injectedCss.set(name, css);
}

function removeInjected(name: string): void {
  injectedCss.delete(name);
  if (!canUseDom()) return;
  document.querySelectorAll(`style[${SNIPPET_ATTR}]`).forEach((el) => {
    if (el.getAttribute(SNIPPET_ATTR) === name) el.remove();
  });
}

function removeAllInjected(): void {
  injectedCss.clear();
  if (!canUseDom()) return;
  document.querySelectorAll(`style[${SNIPPET_ATTR}]`).forEach((el) => el.remove());
}

function persistEnabledLocally(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Array.from(enabledSet)));
  } catch {
    /* ignore quota / private mode */
  }
}

function seedEnabledFromLocalStorage(): void {
  try {
    if (typeof localStorage === "undefined" || enabledSet.size > 0) return;
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const name of parsed) {
      if (typeof name === "string" && name && !name.includes("/")) enabledSet.add(name);
    }
  } catch {
    /* ignore */
  }
}

async function readAppearanceRaw(): Promise<string | null> {
  try {
    return (await getAPI().dataRead(APPEARANCE_PATH)) ?? null;
  } catch {
    return null;
  }
}

async function persistEnabled(): Promise<void> {
  persistEnabledLocally();
  try {
    const existing = await readAppearanceRaw();
    await getAPI().dataWrite(APPEARANCE_PATH, mergeAppearanceEnabled(existing, Array.from(enabledSet)));
  } catch (err) {
    console.warn("[CssSnippets] Failed to persist appearance.json:", err);
  }
}

async function loadEnabledFromDisk(): Promise<void> {
  const api = getAPI();
  const local = parseEnabledCssSnippets(await readAppearanceRaw());
  if (local) {
    enabledSet.clear();
    for (const name of local) enabledSet.add(name);
    persistEnabledLocally();
    return;
  }

  let obsidianRaw: string | null = null;
  try {
    obsidianRaw = (await api.readFile(OBSIDIAN_APPEARANCE_PATH)) ?? null;
  } catch {
    obsidianRaw = null;
  }
  const fromObsidian = parseEnabledCssSnippets(obsidianRaw);
  if (fromObsidian) {
    enabledSet.clear();
    for (const name of fromObsidian) enabledSet.add(name);
    await persistEnabled();
    return;
  }

  seedEnabledFromLocalStorage();
}

function listCssFileNames(entries: Array<{ name?: string; isDirectory?: boolean } | string>): string[] {
  const names: string[] = [];
  for (const entry of entries) {
    const fileName = typeof entry === "string" ? entry : entry.isDirectory ? "" : (entry.name || "");
    const safe = safeCssFileName(fileName);
    if (safe) names.push(safe);
  }
  return names;
}

async function discoverSnippets(): Promise<CssSnippet[]> {
  const api = getAPI();
  const found = new Map<string, CssSnippet>();

  const add = (fileName: string, source: CssSnippetSource, path: string) => {
    const name = snippetNameFromFile(fileName);
    if (!name || found.has(name)) return;
    found.set(name, {
      name,
      fileName: safeCssFileName(fileName)!,
      path,
      source,
      enabled: enabledSet.has(name),
    });
  };

  try {
    const openonyxFiles = await api.dataList(OPENONYX_SNIPPETS_DIR);
    for (const fileName of listCssFileNames(openonyxFiles)) {
      add(fileName, "openonyx", `${OPENONYX_SNIPPETS_DIR}/${fileName}`);
    }
  } catch {
    /* data dir unavailable */
  }

  try {
    const listed = typeof api.listFiles === "function"
      ? await api.listFiles(OPENONYX_VAULT_SNIPPETS)
      : [];
    for (const fileName of listCssFileNames(listed || [])) {
      add(fileName, "openonyx", `${OPENONYX_SNIPPETS_DIR}/${fileName}`);
    }
  } catch {
    /* hidden dir listing unavailable */
  }

  try {
    const listed = typeof api.listFiles === "function"
      ? await api.listFiles(OBSIDIAN_SNIPPETS_DIR)
      : [];
    for (const fileName of listCssFileNames(listed || [])) {
      add(fileName, "obsidian", `${OBSIDIAN_SNIPPETS_DIR}/${fileName}`);
    }
  } catch {
    /* Obsidian snippets folder missing */
  }

  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function readSnippetCss(snippet: CssSnippet): Promise<string> {
  const api = getAPI();
  const fileName = safeCssFileName(snippet.fileName);
  if (!fileName) return "";

  if (snippet.source === "openonyx") {
    try {
      const fromData = await api.dataRead(`${OPENONYX_SNIPPETS_DIR}/${fileName}`);
      if (fromData) return fromData;
    } catch {
      /* fall through to vault read */
    }
    try {
      return (await api.readFile(`${OPENONYX_VAULT_SNIPPETS}/${fileName}`)) || "";
    } catch {
      return "";
    }
  }
  try {
    return (await api.readFile(`${OBSIDIAN_SNIPPETS_DIR}/${fileName}`)) || "";
  } catch {
    return "";
  }
}

async function applyEnabledCss(next: CssSnippet[]): Promise<void> {
  const enabledNames = new Set(next.filter((snippet) => snippet.enabled).map((snippet) => snippet.name));

  for (const name of Array.from(injectedCss.keys())) {
    if (!enabledNames.has(name)) removeInjected(name);
  }

  for (const snippet of next) {
    if (!snippet.enabled) continue;
    const css = await readSnippetCss(snippet);
    if (injectedCss.get(snippet.name) === css) continue;
    injectSnippet(snippet.name, css);
  }
}

async function runRefresh(): Promise<void> {
  snippets = await discoverSnippets();
  await applyEnabledCss(snippets);
  notify();
}

export function refreshCssSnippets(): Promise<void> {
  refreshChain = refreshChain.then(runRefresh, runRefresh);
  return refreshChain;
}

export async function setCssSnippetEnabled(name: string, enabled: boolean): Promise<void> {
  if (!name || name.includes("/") || name.includes("\\")) return;

  if (enabled) enabledSet.add(name);
  else enabledSet.delete(name);

  snippets = snippets.map((snippet) =>
    snippet.name === name ? { ...snippet, enabled } : snippet,
  );

  await persistEnabled();

  if (enabled) {
    const snippet = snippets.find((item) => item.name === name);
    if (snippet) {
      const css = await readSnippetCss(snippet);
      injectSnippet(name, css);
    }
  } else {
    removeInjected(name);
  }

  notify();
}

export async function openCssSnippetsFolder(): Promise<void> {
  const api = getAPI();
  try {
    await api.createDirectory(OPENONYX_VAULT_SNIPPETS);
  } catch {
    /* dataList also creates the OpenOnyx data dir */
  }
  try {
    await api.dataList(OPENONYX_SNIPPETS_DIR);
  } catch {
    /* ignore */
  }
  if (typeof api.openPath !== "function") return;
  await api.openPath(OPENONYX_VAULT_SNIPPETS);
}

function bindFileListeners(): void {
  if (fileListenersBound || typeof window === "undefined") return;
  window.addEventListener("openonyx:file-written", onSnippetsFileEvent);
  window.addEventListener("openonyx:file-created", onSnippetsFileEvent);
  window.addEventListener("openonyx:file-deleted", onSnippetsFileEvent);
  window.addEventListener("openonyx:file-renamed", onSnippetsFileEvent);
  fileListenersBound = true;
}

function unbindFileListeners(): void {
  if (!fileListenersBound || typeof window === "undefined") return;
  window.removeEventListener("openonyx:file-written", onSnippetsFileEvent);
  window.removeEventListener("openonyx:file-created", onSnippetsFileEvent);
  window.removeEventListener("openonyx:file-deleted", onSnippetsFileEvent);
  window.removeEventListener("openonyx:file-renamed", onSnippetsFileEvent);
  fileListenersBound = false;
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function startCssSnippets(options?: { pollMs?: number | null }): Promise<void> {
  started = true;
  await loadEnabledFromDisk();
  await refreshCssSnippets();
  bindFileListeners();
  stopPolling();
  const pollMs = options?.pollMs === undefined ? DEFAULT_POLL_MS : options.pollMs;
  if (pollMs && pollMs > 0) {
    pollTimer = setInterval(() => {
      void refreshCssSnippets();
    }, pollMs);
  }
}

export function stopCssSnippets(): void {
  started = false;
  stopPolling();
  unbindFileListeners();
  removeAllInjected();
  snippets = [];
  notify();
}

export function isCssSnippetsStarted(): boolean {
  return started;
}

/** Test helper — resets in-memory snippet state without touching disk. */
export function resetCssSnippetsForTests(): void {
  stopCssSnippets();
  enabledSet.clear();
  injectedCss.clear();
  snippets = [];
  refreshChain = Promise.resolve();
}

export const cssSnippetsApi = {
  get snippets() {
    return getCssSnippetNames();
  },
  get enabledSnippets() {
    return enabledSet;
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
