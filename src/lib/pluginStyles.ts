/**
 * Plugin Style Injection
 *
 * Obsidian loads each enabled plugin's styles.css into the app-level document
 * without selector rewriting. Do the same here so community plugin CSS keeps
 * its intended cascade, specificity, and workspace/modal selectors.
 */

const PLUGIN_STYLE_ATTR = 'data-plugin-id';
const PLUGIN_ASSET_ROOT = 'vault://local/.openonyx/plugins';
const ABSOLUTE_CSS_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

function splitUrlSuffix(rawUrl: string): { path: string; suffix: string } {
  const queryIdx = rawUrl.indexOf('?');
  const hashIdx = rawUrl.indexOf('#');
  const cutPoints = [queryIdx, hashIdx].filter(idx => idx >= 0);
  const suffixIdx = cutPoints.length ? Math.min(...cutPoints) : -1;

  if (suffixIdx === -1) return { path: rawUrl, suffix: '' };
  return {
    path: rawUrl.slice(0, suffixIdx),
    suffix: rawUrl.slice(suffixIdx),
  };
}

function encodePluginAssetPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .split('/')
    .map(segment => {
      if (segment === '.' || segment === '..') return segment;
      return encodeURIComponent(segment);
    })
    .join('/');
}

function pluginAssetUrl(pluginId: string, rawUrl: string): string {
  const { path, suffix } = splitUrlSuffix(rawUrl.trim());
  const encodedPluginId = encodeURIComponent(pluginId);
  const encodedPath = encodePluginAssetPath(path);
  return `${PLUGIN_ASSET_ROOT}/${encodedPluginId}/${encodedPath}${suffix}`;
}

export function rewritePluginCssUrls(pluginId: string, css: string): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote: string, rawUrl: string) => {
      const trimmedUrl = rawUrl.trim();
      if (!trimmedUrl || ABSOLUTE_CSS_URL_RE.test(trimmedUrl)) return match;
      return `url("${pluginAssetUrl(pluginId, trimmedUrl)}")`;
    })
    .replace(/@import\s+(["'])([^"']+)\1/g, (match, quote: string, rawUrl: string) => {
      const trimmedUrl = rawUrl.trim();
      if (!trimmedUrl || ABSOLUTE_CSS_URL_RE.test(trimmedUrl)) return match;
      return match.replace(`${quote}${rawUrl}${quote}`, `"${pluginAssetUrl(pluginId, trimmedUrl)}"`);
    });
}

export function injectPluginStyles(pluginId: string, css: string): void {
  // Remove existing styles for this plugin first
  removePluginStyles(pluginId);

  const style = document.createElement('style');
  style.setAttribute(PLUGIN_STYLE_ATTR, pluginId);
  style.textContent = rewritePluginCssUrls(pluginId, css);
  document.head.appendChild(style);
}

export function removePluginStyles(pluginId: string): void {
  const existing = document.querySelectorAll(`style[${PLUGIN_STYLE_ATTR}="${pluginId}"]`);
  existing.forEach(el => el.remove());
}

/** Get the scope container class name for a plugin */
export function getPluginScopeClass(pluginId: string): string {
  return `oo-plugin-scope-${pluginId}`;
}

/** Inject the base plugin CSS (Notice container, Modal styles, Setting styles) */
export function injectPluginBaseCss(): void {
  if (document.querySelector('style[data-plugin-base]')) return;

  const style = document.createElement('style');
  style.setAttribute('data-plugin-base', 'true');
  style.textContent = `
/* ── Native WorkspaceLeaf / ItemView host ─────────────────────────── */
/* Layout and interaction only. Plugin and application colour variables are
 * intentionally left untouched. */
.oo-plugin-leaf.workspace-leaf-content {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  pointer-events: auto;
}

.oo-plugin-leaf.workspace-leaf-content > .view-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: 0;
  min-height: var(--header-height, 36px);
  padding: 0 var(--size-4-2, 8px);
  border-bottom: 1px solid var(--divider-color);
  pointer-events: auto;
}

.oo-plugin-leaf .view-header-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--icon-m, 18px);
  height: var(--icon-m, 18px);
  margin-inline-end: var(--size-4-2, 8px);
}

.oo-plugin-leaf .view-header-title-container {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
}

.oo-plugin-leaf .view-header-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oo-plugin-leaf .view-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--size-2-1, 2px);
  margin-inline-start: auto;
  pointer-events: auto;
}

.oo-plugin-leaf.workspace-leaf-content > .view-content {
  position: relative;
  display: block;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  pointer-events: auto;
}

/* ── Obsidian CSS Variable Defaults (fallback layer for plugins) ── */
:root {
  --background-primary: var(--bg-primary, #181825);
  --background-primary-alt: var(--bg-secondary, #1e1e2e);
  --background-secondary: var(--bg-secondary, #1e1e2e);
  --background-secondary-alt: var(--bg-tertiary, #252536);
  --background-modifier-border: var(--border-medium, rgba(255,255,255,0.16));
  --background-modifier-form-field: var(--bg-input, rgba(255,255,255,0.04));
  --background-modifier-error: #e05050;
  --background-modifier-success: #22c55e;
  --background-modifier-box-shadow: rgba(0,0,0,0.4);
  --text-normal: var(--text-primary, #dcddde);
  --text-accent: var(--color-accent, #7c5cfc);
  --text-accent-hover: var(--color-accent-1, #6b55e0);
  --interactive-normal: var(--bg-elevated, rgba(255,255,255,0.06));
  --interactive-hover: var(--bg-hover, rgba(255,255,255,0.1));
  --interactive-accent: var(--color-accent, #7c5cfc);
  --interactive-accent-hover: var(--color-accent-1, #6b55e0);
  --link-color: var(--text-link, var(--color-accent, #7c5cfc));
  --link-color-hover: var(--color-accent-1, #6b55e0);
  --font-monospace: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  --cursor: pointer;
  /* Obsidian plugins place temporary editors and menus above board content. */
  --layer-cover: 20;
  --layer-popover: 30;
  --layer-menu: 40;
  --layer-modal: 50;
  --layer-notice: 60;
  --radius-s: 4px;
  --radius-m: 8px;
  --radius-l: 12px;
}

/* Kanban's embedded CodeMirror editor does not inherit the host editor
 * extension. Use the theme foreground for a reliably visible dark-theme caret.
 */
.theme-dark .kanban-plugin .cm-content,
.theme-dark .kanban-plugin .cm-line,
.theme-dark .kanban-plugin .cm-editor {
  caret-color: var(--text-normal, var(--text-primary)) !important;
}

.theme-dark .kanban-plugin .cm-cursor,
.theme-dark .kanban-plugin .cm-dropCursor {
  border-left-color: var(--text-normal, var(--text-primary)) !important;
}

/* Only plugin ribbon buttons use the same 20px size as app ribbon icons. */
.oo-plugin-ribbon-btn .svg-icon {
  width: 20px !important;
  height: 20px !important;
}

/* ── Plugin Notice Container ─────────────────────── */
.oo-notice-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 360px;
}

.oo-notice {
  pointer-events: auto;
  background: var(--bg-elevated, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  animation: oo-notice-in 0.2s ease;
}

@keyframes oo-notice-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

/* ── Plugin Modal ────────────────────────────────── */
.oo-plugin-modal-container {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.oo-plugin-modal-container .modal-bg {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
}

.oo-plugin-modal {
  position: relative;
  background: var(--bg-primary, #181825);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  padding: 20px;
  min-width: 400px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 1;
}

.oo-plugin-modal .modal-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-right: 32px;
  color: var(--text-primary, #e0e0e0);
}

.oo-plugin-modal .modal-title:empty {
  display: none;
  margin: 0;
  padding: 0;
}

.oo-plugin-modal .modal-content {
  min-width: 0;
  color: var(--text-secondary, #b0b0b0);
  font-size: 14px;
  line-height: 1.6;
}

/* ── Plugin Setting ──────────────────────────────── */
.oo-plugin-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.05));
  gap: 16px;
}

.oo-plugin-setting .setting-item-info {
  flex: 1;
  min-width: 0;
}

.oo-plugin-setting .setting-item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #e0e0e0);
}

.oo-plugin-setting .setting-item-description {
  font-size: 12px;
  color: var(--text-muted, #888);
  margin-top: 2px;
}

.oo-plugin-setting .setting-item-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.oo-plugin-setting.setting-item-heading {
  border-bottom: none;
  padding-top: 20px;
}

.oo-plugin-setting.setting-item-heading .setting-item-name {
  font-size: 16px;
  font-weight: 600;
}

/* ── Plugin UI Widgets ───────────────────────────── */
.oo-plugin-text-input,
.oo-plugin-textarea,
.oo-plugin-search-input {
  background: var(--bg-input, rgba(255,255,255,0.05));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-primary, #e0e0e0);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.oo-plugin-text-input:focus,
.oo-plugin-textarea:focus,
.oo-plugin-search-input:focus {
  border-color: var(--accent-primary, var(--color-accent, #3b82f6));
}

.oo-plugin-textarea { min-height: 60px; resize: vertical; }

.oo-plugin-btn {
  background: var(--bg-hover, rgba(255,255,255,0.06));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 6px;
  padding: 6px 14px;
  color: var(--text-primary, #e0e0e0);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.oo-plugin-btn:hover { background: var(--bg-active, rgba(255,255,255,0.1)); }
.oo-plugin-btn.mod-cta {
  background: var(--accent-primary, var(--color-accent, #3b82f6));
  color: white;
  border-color: transparent;
}
.oo-plugin-btn.mod-cta:hover { filter: brightness(1.1); }
.oo-plugin-btn.mod-warning { background: #ef4444; color: white; border-color: transparent; }

.oo-plugin-toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--bg-hover, rgba(255,255,255,0.1));
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}

.oo-plugin-toggle::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-muted, #888);
  top: 3px;
  left: 3px;
  transition: all 0.2s;
}

.oo-plugin-toggle.is-enabled {
  background: var(--accent-primary, var(--color-accent, #3b82f6));
}

.oo-plugin-toggle.is-enabled::after {
  background: var(--text-on-accent, white);
  left: 19px;
}

.oo-plugin-dropdown {
  background: var(--bg-input, rgba(255,255,255,0.05));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-primary, #e0e0e0);
  font-size: 13px;
}

/* ── Plugin Menu ─────────────────────────────────── */
.oo-plugin-menu {
  background: var(--bg-elevated, #1e1e2e);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  z-index: 9500;
}

.oo-plugin-menu .menu-item {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-primary, #e0e0e0);
  cursor: pointer;
  transition: background 0.1s;
}

.oo-plugin-menu .menu-item:hover { background: var(--bg-hover, rgba(255,255,255,0.06)); }
.oo-plugin-menu .menu-separator { height: 1px; background: var(--border-subtle, rgba(255,255,255,0.05)); margin: 4px 0; }

/* ── Plugin Ribbon Button ────────────────────────── */
.oo-plugin-ribbon-btn {
  cursor: pointer;
}

/* ── Plugin Status Bar Item ──────────────────────── */
.oo-plugin-status-item {
  font-size: 12px;
  color: var(--text-muted, #888);
}

/* ── SuggestModal / FuzzySuggestModal ────────────── */

/* The modal used for Suggest/FuzzySuggest should look like Obsidian's
   quick-switcher: a compact panel centered near the top of the viewport
   with an input and a scrollable list of results. */

/* Position the prompt modal near the top of the viewport */
.oo-plugin-modal-container:has(.prompt) {
  align-items: flex-start;
  padding-top: 15vh;
}

.modal-container.oo-plugin-modal-container .modal.oo-plugin-modal.prompt {
  padding: 0;
  overflow: hidden;
  min-width: 500px;
  max-width: 600px;
  max-height: 60vh;
  border-radius: 10px;
}

.prompt .modal-content {
  padding: 0;
}

/* ── Prompt Input ────────────────────────────────── */
.prompt-input-container {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
}

.prompt-input {
  width: 100%;
  background: transparent;
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text-primary, #e0e0e0);
  font-size: 15px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.prompt-input:focus {
  border-color: var(--accent-primary, var(--color-accent, #7c5cfc));
  box-shadow: 0 0 0 2px rgba(124, 92, 252, 0.15);
}

.prompt-input::placeholder {
  color: var(--text-muted, #666);
}

/* ── Suggestion Container ────────────────────────── */
.suggestion-container {
  max-height: 50vh;
  overflow-y: auto;
  padding: 4px 0;
  overscroll-behavior: contain;
}

.oo-input-suggest.oo-modal-input-suggest {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 8px;
  background: var(--bg-secondary, #16171a);
}

.excalidraw-modal .modal.oo-plugin-modal,
.modal.oo-plugin-modal.excalidraw-modal {
  width: min(640px, calc(100vw - 48px));
  min-width: min(640px, calc(100vw - 48px));
  max-height: min(720px, calc(100vh - 64px));
  overflow: hidden;
  padding: 22px;
}

.excalidraw-modal .modal.oo-plugin-modal .modal-content,
.modal.oo-plugin-modal.excalidraw-modal .modal-content {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
}

.excalidraw-modal .modal.oo-plugin-modal .setting-item,
.modal.oo-plugin-modal.excalidraw-modal .setting-item {
  display: block;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
}

.excalidraw-modal .modal.oo-plugin-modal .setting-item-info,
.modal.oo-plugin-modal.excalidraw-modal .setting-item-info {
  display: none;
}

.excalidraw-modal .modal.oo-plugin-modal .setting-item-control,
.modal.oo-plugin-modal.excalidraw-modal .setting-item-control {
  width: 100%;
}

.excalidraw-modal .modal.oo-plugin-modal input,
.excalidraw-modal .modal.oo-plugin-modal .text-input,
.excalidraw-modal .modal.oo-plugin-modal .search-input,
.modal.oo-plugin-modal.excalidraw-modal input,
.modal.oo-plugin-modal.excalidraw-modal .text-input,
.modal.oo-plugin-modal.excalidraw-modal .search-input {
  width: 100%;
  box-sizing: border-box;
}

.excalidraw-modal .suggestion-container,
.modal.oo-plugin-modal.excalidraw-modal .oo-input-suggest.oo-modal-input-suggest {
  width: min(596px, calc(100vw - 92px)) !important;
  max-width: min(596px, calc(100vw - 92px));
  box-sizing: border-box;
  margin-top: 0;
  margin-right: auto;
  margin-left: auto;
  max-height: min(440px, calc(100vh - 280px));
  border-color: var(--border-medium, rgba(255,255,255,0.12));
  background: var(--bg-primary, #111316);
}

body > .suggestion-container:not(.editor-suggest):not(.oo-input-suggest) {
  width: min(596px, calc(100vw - 92px)) !important;
  max-width: min(596px, calc(100vw - 92px));
  box-sizing: border-box;
  border: 1px solid var(--border-medium, rgba(255,255,255,0.12));
  border-radius: 8px;
  background: var(--bg-primary, #111316);
}

.excalidraw-modal .suggestion-item,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 52px;
  padding: 8px 10px 8px 14px;
  gap: 10px;
}

.excalidraw-modal .suggestion-item .suggestion-content,
.excalidraw-modal .suggestion-item > :first-child,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-content,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item > :first-child {
  display: block;
  min-width: 0;
}

.excalidraw-modal .suggestion-item .suggestion-title,
.excalidraw-modal .suggestion-item .suggestion-note,
.excalidraw-modal .suggestion-item .suggestion-flair,
.excalidraw-modal .suggestion-item .suggestion-aux,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-title,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-note,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-flair,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-aux {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.excalidraw-modal .suggestion-item .suggestion-title,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-title {
  color: var(--text-primary, #e6e6e6);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
}

.excalidraw-modal .suggestion-item .suggestion-note,
.excalidraw-modal .suggestion-item .suggestion-aux,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-note,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .suggestion-aux {
  color: var(--text-muted, #8b8f98);
  font-size: 12px;
  line-height: 1.3;
}

.excalidraw-modal .suggestion-item .clickable-icon,
.excalidraw-modal .suggestion-item .obsidian-icon,
.excalidraw-modal .suggestion-item svg,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .clickable-icon,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item .obsidian-icon,
.modal.oo-plugin-modal.excalidraw-modal .suggestion-item svg {
  justify-self: end;
  flex: 0 0 auto;
}

.suggestion-container::-webkit-scrollbar {
  width: 6px;
}

.suggestion-container::-webkit-scrollbar-track {
  background: transparent;
}

.suggestion-container::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 3px;
}

.suggestion-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.2);
}

/* ── Suggestion Item ─────────────────────────────── */
.suggestion-item {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #dcddde);
  transition: background-color 0.06s ease;
  line-height: 1.4;
  min-height: 32px;
  gap: 8px;
}

.suggestion-item > * {
  min-width: 0;
}

.suggestion-item,
.suggestion-item .suggestion-title,
.suggestion-item .suggestion-note,
.suggestion-item .suggestion-content,
.suggestion-item .suggestion-aux,
.suggestion-item span,
.suggestion-item div {
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-item .suggestion-title,
.suggestion-item .suggestion-note,
.suggestion-item .suggestion-aux {
  white-space: nowrap;
}

.suggestion-item .suggestion-content {
  flex: 1 1 auto;
}

.suggestion-item:hover {
  background: var(--bg-hover, rgba(255,255,255,0.04));
}

.suggestion-item.is-selected {
  background: var(--bg-active, rgba(124, 92, 252, 0.12));
  color: var(--text-primary, #ffffff);
}

.suggestion-item.is-selected:hover {
  background: var(--bg-active, rgba(124, 92, 252, 0.16));
}

/* Suggestion text highlight (for fuzzy matching) */
.suggestion-highlight {
  color: var(--accent-primary, var(--color-accent, #7c5cfc));
  font-weight: 600;
}

/* ── Suggestion Empty State ──────────────────────── */
.suggestion-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted, #666);
  font-size: 13px;
  font-style: italic;
}

/* ── Prompt Instructions (e.g. hotkey hints) ─────── */
.prompt-instructions {
  display: flex;
  gap: 16px;
  padding: 6px 14px;
  border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  font-size: 11px;
  color: var(--text-muted, #666);
}

.prompt-instruction {
  display: flex;
  align-items: center;
  gap: 4px;
}

.prompt-instruction-command {
  font-family: monospace;
  background: rgba(255,255,255,0.06);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}

/* ── Icons Plugin Specific ───────────────────────── */
.suggestion-item .obsidian-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.suggestion-item .obsidian-icon.react-icon > svg {
  width: 18px;
  height: 18px;
  vertical-align: middle;
}

.suggestion-item .obsidian-icon + span,
.suggestion-item .obsidian-icon ~ span {
  margin-left: 4px;
}

/* Icons plugin rendered icons in document body */
.obsidian-icon {
  font-size: inherit;
  display: inline-block;
  width: 1.5em;
  text-align: center;
  vertical-align: middle;
}

.obsidian-icon.react-icon > svg {
  vertical-align: middle;
  fill: currentColor;
}

/* ── Modal Close Button ──────────────────────────── */
.modal-close-button {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  border-radius: 4px;
  font-size: 18px;
  line-height: 1;
  transition: background 0.1s, color 0.1s;
  z-index: 2;
}

.modal-close-button:hover {
  background: var(--bg-hover, rgba(255,255,255,0.06));
  color: var(--text-primary, #e0e0e0);
}

/* ── Extra Settings Button (used by many plugins) ── */
.extra-setting-button,
.clickable-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s, color 0.1s;
}

.extra-setting-button:hover,
.clickable-icon:hover {
  background: var(--bg-hover, rgba(255,255,255,0.06));
  color: var(--text-primary, #e0e0e0);
}

.extra-setting-button .svg-icon,
.clickable-icon .svg-icon {
  width: 16px;
  height: 16px;
}

/* ── Color Picker ────────────────────────────────── */
input[type="color"] {
  -webkit-appearance: none;
  appearance: none;
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  background: none;
}

input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}

input[type="color"]::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}

/* ── Slider ──────────────────────────────────────── */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: var(--bg-hover, rgba(255,255,255,0.1));
  border-radius: 2px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-primary, var(--color-accent, #7c5cfc));
  cursor: pointer;
  border: 2px solid var(--bg-primary, #181825);
}
`;
  document.head.appendChild(style);
}

/** Inject OpenOnyx design tokens as CSS custom properties for snippet authors */
export function injectDesignTokens(): void {
  if (document.querySelector('style[data-openonyx-tokens]')) return;

  const style = document.createElement('style');
  style.setAttribute('data-openonyx-tokens', 'true');
  style.textContent = `
/* ── OpenOnyx Design Tokens ──────────────────────────────────────────
 * Stable CSS custom properties for CSS snippet and theme authors.
 * These alias the internal theme variables and automatically update
 * when the user changes themes.
 * ──────────────────────────────────────────────────────────────────── */
:root {
  /* Colors */
  --oo-color-bg-primary: var(--bg-primary);
  --oo-color-bg-secondary: var(--bg-secondary);
  --oo-color-bg-tertiary: var(--bg-tertiary);
  --oo-color-bg-elevated: var(--bg-elevated);
  --oo-color-bg-hover: var(--bg-hover);
  --oo-color-bg-active: var(--bg-active);
  --oo-color-text-primary: var(--text-primary);
  --oo-color-text-secondary: var(--text-secondary);
  --oo-color-text-muted: var(--text-muted);
  --oo-color-text-faint: var(--text-faint, var(--text-muted));
  --oo-color-accent: var(--accent-primary, var(--color-accent));
  --oo-color-accent-hover: var(--color-accent-1, var(--color-accent));
  --oo-color-accent-active: var(--color-accent-2, var(--color-accent));
  --oo-color-text-on-accent: var(--text-on-accent, #ffffff);
  --oo-color-border-subtle: var(--border-subtle);
  --oo-color-border-medium: var(--border-medium);
  --oo-color-border-strong: var(--border-strong, var(--border-medium));
  --oo-color-divider: var(--divider-color, var(--border-subtle));

  /* Typography */
  --oo-font-sans: var(--font-text, Inter, system-ui, -apple-system, sans-serif);
  --oo-font-mono: var(--font-monospace, ui-monospace, SFMono-Regular, monospace);
  --oo-font-size-xs: 11px;
  --oo-font-size-sm: 13px;
  --oo-font-size-md: 15px;
  --oo-font-size-lg: 18px;
  --oo-font-size-xl: 22px;

  /* Spacing */
  --oo-spacing-xs: 4px;
  --oo-spacing-sm: 8px;
  --oo-spacing-md: 16px;
  --oo-spacing-lg: 24px;
  --oo-spacing-xl: 32px;
  --oo-spacing-2xl: 48px;

  /* Border Radius */
  --oo-radius-xs: 2px;
  --oo-radius-sm: 4px;
  --oo-radius-md: 8px;
  --oo-radius-lg: 12px;
  --oo-radius-xl: 16px;
  --oo-radius-full: 9999px;

  /* Shadows */
  --oo-shadow-sm: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.1));
  --oo-shadow-md: var(--shadow-md, 0 2px 8px rgba(0, 0, 0, 0.15));
  --oo-shadow-lg: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.2));

  /* Transitions */
  --oo-transition-fast: 0.1s ease;
  --oo-transition-normal: 0.2s ease;
  --oo-transition-slow: 0.3s ease;
}
`;
  document.head.appendChild(style);
}

