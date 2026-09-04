/**
 * Obsidian API Compatibility — Plugin Base Class
 *
 * This is what plugin authors extend via `export default class MyPlugin extends Plugin`.
 * All callbacks registered through this class are wrapped in crash isolation.
 *
 * IMPORTANT: Uses function-based constructor (not ES6 class) for compatibility
 * with ES5-compiled plugins that use `Plugin.call(this)` for super constructor.
 */

import { Component, Notice, PluginSettingTab } from './components';
import { setIcon } from './utils';
import {
  registerMarkdownCodeBlockProcessor,
  registerMarkdownPostProcessor,
} from './markdown';
import type { IComponent } from './components';
import type { PluginManifest } from '../../types/plugin';
import { safePluginCall } from '../pluginDevTools';

import { getAPI } from '../../utils/api';
const api = () => getAPI();

/**
 * Wrap a callback for crash isolation.
 * If the wrapped function throws, it's caught, logged, and the app continues.
 */
function guardCallback(pluginId: string, fn: (...args: any[]) => any, context: string): (...args: any[]) => any {
  return (...args: any[]) => {
    const win = window as any;
    const previousPluginId = win.__oo_active_plugin_id;
    win.__oo_active_plugin_id = pluginId;
    const { result, shouldDisable } = safePluginCall(pluginId, () => fn(...args), context);
    if (previousPluginId === undefined) delete win.__oo_active_plugin_id;
    else win.__oo_active_plugin_id = previousPluginId;
    if (shouldDisable) {
      new (Notice as any)(`Plugin "${pluginId}" disabled — too many errors.`);
      (window as any).__oo_auto_disable_plugin?.(pluginId);
    }
    return result;
  };
}

// ── Plugin (function-based for ES5 compat) ──────────

/** Interface for Plugin instances */
export interface IPlugin extends IComponent {
  app: any;
  manifest: PluginManifest;
  settings: any;
  addCommand(command: any): any;
  removeCommand(commandId: string): void;
  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
  addStatusBarItem(): HTMLElement;
  addSettingTab(settingTab: PluginSettingTab): void;
  registerView(type: string, viewCreator: (leaf: any) => any): void;
  registerExtensions(extensions: string[], viewType: string): void;
  registerMarkdownPostProcessor(postProcessor: any, sortOrder?: number): any;
  registerMarkdownCodeBlockProcessor(language: string, handler: any, sortOrder?: number): any;
  registerEditorExtension(extension: any): void;
  registerBasesView(viewId: string, registration: any): void;
  registerEditorSuggest(editorSuggest: any): void;
  registerCliHandler(command: string, description: string, flags: any, handler: any): void;
  registerObsidianProtocolHandler(action: string, handler: (params: any) => any): void;
  registerHoverLinkSource(id: string, info: { display: string, defaultMod: boolean }): void;
  loadData(): Promise<any>;
  saveData(data: any): Promise<void>;
  onUserEnable(): void;
  onExternalSettingsChange(): void;
  load(): void;
}

export interface PluginConstructor {
  new(app: any, manifest: PluginManifest): IPlugin;
  prototype: IPlugin;
}

function _Plugin(this: any, app: any, manifest: PluginManifest) {
  (Component as any).call(this);
  this.app = app;
  this.manifest = manifest;
  this.settings = [];

  // Internal registries for cleanup
  this._commands = [];
  this._ribbonActions = [];
  this._statusBarItems = [];
  this._settingTabs = [];
  this._registeredViews = [];
  this._styles = [];
  this._markdownPostProcessors = [];
  this._editorExtensions = [];
  this._editorSuggests = [];
  this._protocolHandlers = [];
  this._hoverLinkSources = [];
  this._basesViews = [];
  this._cliHandlers = [];
}

// Inherit from Component
_Plugin.prototype = Object.create((Component as any).prototype);
_Plugin.prototype.constructor = _Plugin;

// ── Commands ──────────────────────────────────────

_Plugin.prototype.addCommand = function (command: {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: any, view: any) => void;
  editorCheckCallback?: (checking: boolean, editor: any, view: any) => boolean | void;
  hotkeys?: any[];
  icon?: string;
}): any {
  const fullId = `${this.manifest.id}:${command.id}`;

  // Wrap callbacks in crash isolation
  const guarded = { ...command };
  if (guarded.callback) {
    guarded.callback = guardCallback(this.manifest.id, guarded.callback, `command:${command.id}`) as () => void;
  }
  if (guarded.checkCallback) {
    guarded.checkCallback = guardCallback(this.manifest.id, guarded.checkCallback, `checkCommand:${command.id}`) as (checking: boolean) => boolean | void;
  }
  if (guarded.editorCallback) {
    guarded.editorCallback = guardCallback(this.manifest.id, guarded.editorCallback, `editorCommand:${command.id}`) as (editor: any, view: any) => void;
  }
  if (guarded.editorCheckCallback) {
    guarded.editorCheckCallback = guardCallback(this.manifest.id, guarded.editorCheckCallback, `editorCheckCommand:${command.id}`) as (checking: boolean, editor: any, view: any) => boolean | void;
  }

  const cmd = { ...guarded, id: fullId };
  this._commands.push(cmd);

  // Register with app's command system
  (window as any).__oo_register_command?.({
    ...guarded,
    id: fullId,
    name: `${this.manifest.name}: ${command.name}`,
    pluginId: this.manifest.id,
  });
  return cmd;
};

_Plugin.prototype.removeCommand = function (commandId: string): void {
  const fullId = commandId.includes(':') ? commandId : `${this.manifest.id}:${commandId}`;
  this._commands = this._commands.filter((command: any) => command.id !== fullId);
  (window as any).__oo_unregister_command?.(fullId);
};

// ── Ribbon ────────────────────────────────────────

_Plugin.prototype.addRibbonIcon = function (icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement {
  const guardedCallback = guardCallback(this.manifest.id, callback, `ribbon:${title}`) as (evt: MouseEvent) => void;

  const el = document.createElement('div');
  el.className = 'ribbon-btn oo-plugin-ribbon-btn';
  el.dataset.tooltip = title;
  el.removeAttribute('title');
  setIcon(el, icon);
  el.addEventListener('click', guardedCallback);

  const action = { icon, title, callback: guardedCallback, el };
  this._ribbonActions.push(action);
  const ribbonItem = {
    id: `${this.manifest.id}:${title}`,
    icon,
    title,
    buttonEl: el,
    hidden: false,
  };
  const ribbonItems = this.app?.workspace?.leftRibbon?.items;
  if (Array.isArray(ribbonItems)) ribbonItems.push(ribbonItem);
  this.register(() => {
    const items = this.app?.workspace?.leftRibbon?.items;
    if (Array.isArray(items)) {
      const index = items.indexOf(ribbonItem);
      if (index >= 0) items.splice(index, 1);
    }
  });
  (window as any).__oo_register_ribbon?.({
    pluginId: this.manifest.id,
    id: ribbonItem.id,
    icon, title, callback: guardedCallback, el,
  });
  return el;
};

// ── Status Bar ────────────────────────────────────

_Plugin.prototype.addStatusBarItem = function (): HTMLElement {
  const el = document.createElement('span');
  el.className = 'status-item oo-plugin-status-item';

  // Add setText helper for Obsidian compatibility
  (el as any).setText = function (text: string) {
    this.textContent = text;
  };

  this._statusBarItems.push(el);
  (window as any).__oo_register_statusbar?.(this.manifest.id, el);
  this.register(() => {
    (window as any).__oo_unregister_statusbar?.(this.manifest.id, el);
  });
  return el;
};

// ── Settings ──────────────────────────────────────

_Plugin.prototype.addSettingTab = function (settingTab: PluginSettingTab): void {
  // Wrap display() in crash isolation
  const originalDisplay = settingTab.display.bind(settingTab);
  settingTab.display = guardCallback(
    this.manifest.id,
    originalDisplay,
    'settingTab:display',
  ) as () => void;

  this._settingTabs.push(settingTab);
  (window as any).__oo_register_setting_tab?.({
    pluginId: this.manifest.id,
    name: this.manifest.name,
    tab: settingTab,
  });
};

// ── Views ─────────────────────────────────────────

_Plugin.prototype.registerView = function (type: string, viewCreator: (leaf: any) => any): void {
  (viewCreator as any).__pluginId = this.manifest.id;
  this._registeredViews.push({ type, creator: viewCreator });
  this.app.workspace.registerViewCreator(type, viewCreator);
};

_Plugin.prototype.registerExtensions = function (extensions: string[], viewType: string): void {
  this.app.workspace.registerExtensions?.(extensions, viewType);
  (window as any).__oo_register_extensions?.(this.manifest.id, extensions, viewType);
  this.register(() => {
    this.app.workspace.unregisterExtensions?.(extensions, viewType);
    (window as any).__oo_unregister_extensions?.(this.manifest.id, extensions);
  });
};

// ── Markdown Processing ───────────────────────────

_Plugin.prototype.registerMarkdownPostProcessor = function (postProcessor: any, sortOrder?: number): any {
  this._markdownPostProcessors.push(postProcessor);
  this.register(registerMarkdownPostProcessor(this.manifest.id, postProcessor, sortOrder));
  return postProcessor;
};

_Plugin.prototype.registerMarkdownCodeBlockProcessor = function (language: string, handler: (source: string, el: HTMLElement, ctx: any) => any, sortOrder?: number): any {
  const processor = { language, handler };
  this._markdownPostProcessors.push(processor);
  this.register(registerMarkdownCodeBlockProcessor(this.manifest.id, language, handler, sortOrder));
  return processor;
};

// ── Editor Extensions ─────────────────────────────

_Plugin.prototype.registerEditorExtension = function (extension: any): void {
  this._editorExtensions.push(extension);
  (window as any).__oo_register_editor_ext?.(this.manifest.id, extension);
  this.register(() => (window as any).__oo_unregister_editor_ext?.(this.manifest.id, extension));
};

_Plugin.prototype.registerEditorSuggest = function (editorSuggest: any) {
  this._editorSuggests.push(editorSuggest);
  (window as any).__oo_register_editor_suggest?.(this.manifest.id, editorSuggest);
  this.register(() => {
    editorSuggest?.close?.();
    editorSuggest?.unload?.();
    (window as any).__oo_unregister_editor_suggest?.(this.manifest.id, editorSuggest);
  });
};

_Plugin.prototype.registerObsidianProtocolHandler = function (action: string, handler: (params: any) => any) {
  const guarded = guardCallback(this.manifest.id, handler, `protocol:${action}`);
  this._protocolHandlers.push({ action, handler: guarded });
  (window as any).__oo_register_protocol_handler?.(this.manifest.id, action, guarded);
  this.register(() => (window as any).__oo_unregister_protocol_handler?.(this.manifest.id, action));
};

_Plugin.prototype.registerHoverLinkSource = function (id: string, info: { display: string, defaultMod: boolean }) {
  this._hoverLinkSources.push({ id, info });
  this.app.workspace.registerHoverLinkSource?.(id, info);
  (window as any).__oo_register_hover_link_source?.(this.manifest.id, id, info);
  this.register(() => {
    this.app.workspace.unregisterHoverLinkSource?.(id);
    (window as any).__oo_unregister_hover_link_source?.(this.manifest.id, id);
  });
};

_Plugin.prototype.registerBasesView = function (viewId: string, registration: any): void {
  this._basesViews.push({ viewId, registration });
  (window as any).__oo_register_bases_view?.(this.manifest.id, viewId, registration);
  this.register(() => (window as any).__oo_unregister_bases_view?.(this.manifest.id, viewId));
};

_Plugin.prototype.registerCliHandler = function (
  command: string,
  description: string,
  flags: any,
  handler: any,
): void {
  const registration = {
    command,
    description,
    flags,
    handler: guardCallback(this.manifest.id, handler, `cli:${command}`),
  };
  this._cliHandlers.push(registration);
  (window as any).__oo_register_cli_handler?.(this.manifest.id, registration);
  this.register(() => (window as any).__oo_unregister_cli_handler?.(this.manifest.id, command));
};

// ── Data Management ───────────────────────────────

_Plugin.prototype.loadData = async function (): Promise<any> {
  try {
    const data = await api().dataRead(`plugins/${this.manifest.id}/data.json`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

_Plugin.prototype.saveData = async function (data: any): Promise<void> {
  try {
    await api().dataWrite(
      `plugins/${this.manifest.id}/data.json`,
      JSON.stringify(data, null, 2)
    );
  } catch (e) {
    console.error(`[Plugin:${this.manifest.id}] Failed to save data:`, e);
  }
};

// ── Lifecycle Hooks ───────────────────────────────

_Plugin.prototype.onUserEnable = function (): void { /* override */ };
_Plugin.prototype.onExternalSettingsChange = function (): void { /* override */ };

// ── Cleanup on unload ─────────────────────────────

_Plugin.prototype._cleanupPluginRegistrations = function (): void {
  // Remove commands
  for (const cmd of this._commands) {
    (window as any).__oo_unregister_command?.(cmd.id);
  }
  this._commands = [];

  // Remove ribbon actions
  for (const action of this._ribbonActions) {
    action.el?.remove();
    (window as any).__oo_unregister_ribbon?.(this.manifest.id);
  }
  this._ribbonActions = [];

  // Remove status bar items
  for (const el of this._statusBarItems) {
    el.remove();
    (window as any).__oo_unregister_statusbar?.(this.manifest.id);
  }
  this._statusBarItems = [];

  // Remove setting tabs
  for (const _tab of this._settingTabs) {
    (window as any).__oo_unregister_setting_tab?.(this.manifest.id);
  }
  this._settingTabs = [];

  // Unregister views
  for (const view of this._registeredViews) {
    this.app.workspace.detachLeavesOfType(view.type);
    this.app.workspace.unregisterViewCreator?.(view.type);
  }
  this._registeredViews = [];
};

_Plugin.prototype.unload = function (): void {
  if (!this._loaded) return;
  try {
    (Component as any).prototype.unload.call(this);
  } finally {
    this._cleanupPluginRegistrations();
  }
};

_Plugin.prototype.onunload = function (): void { /* override */ };

// Cast the function constructor to the class-like type
export const Plugin = _Plugin as unknown as PluginConstructor;
