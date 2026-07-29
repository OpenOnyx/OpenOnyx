/**
 * Plugin Manager — Secure Runtime
 *
 * Production-ready plugin lifecycle manager with:
 * - Blob URL execution (CSP-safe — no eval/new Function)
 * - Permission system with approval persistence
 * - Crash isolation with auto-disable
 * - Version compatibility checks
 * - Manifest caching & parallel loading
 */

import * as obsidianApi from './obsidian-api';
import { OOApp } from './obsidian-api/app';
import { Plugin } from './obsidian-api/plugin';
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmCommands from '@codemirror/commands';
import * as cmLanguage from '@codemirror/language';
import * as cmSearch from '@codemirror/search';
import { NodeProp } from '@lezer/common';
import * as lezerHighlight from '@lezer/highlight';
import * as lezerLr from '@lezer/lr';
import JSZip from 'jszip';
import type { IPlugin } from './obsidian-api/plugin';
import { injectPluginStyles, removePluginStyles, injectPluginBaseCss, getPluginScopeClass } from './pluginStyles';
import {
  safePluginCall,
  safePluginCallAsync,
  pluginErrorTracker,
  pluginLogStore,
  PluginLogger,
  isVersionCompatible,
} from './pluginDevTools';
import type {
  PluginManifest,
  PluginRegistration,
  PluginState,
  PluginCommand,
  PluginRibbonAction,
  PluginStatusBarItem,
  PluginSettingTabRegistration,
  EnabledPluginList,
  PluginPermission,
  PluginApprovals,
} from '../types/plugin';

import { getAPI } from '../utils/api';
const api = () => getAPI();

// ── Constants ────────────────────────────────────────

const cmLanguageExports = cmLanguage as Record<string, unknown>;
const cmLanguageCompat = {
  ...cmLanguage,
  tokenClassNodeProp: cmLanguageExports["tokenClassNodeProp"] ?? new NodeProp<string>({ deserialize: (value) => value }),
};

const frontendPluginModules: Record<string, any> = {
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/commands': cmCommands,
  '@codemirror/language': cmLanguageCompat,
  '@codemirror/search': cmSearch,
  '@lezer/highlight': lezerHighlight,
  '@lezer/lr': lezerLr,
};

const APP_VERSION = '1.13.1';
const LOAD_TIMEOUT_MS = 8000;
const MAX_PARALLEL_LOADS = 3;

// Default permissions plugins get if manifest doesn't declare any
// (Obsidian compat: existing plugins don't have permissions in manifest)
const DEFAULT_PERMISSIONS: PluginPermission[] = ['filesystem', 'network', 'ui', 'editor'];

export interface PluginBundleFiles {
  manifestText: string;
  mainText: string;
  stylesText: string | null;
}

export async function extractPluginBundleFromZip(data: ArrayBuffer): Promise<PluginBundleFiles> {
  const zip = await JSZip.loadAsync(data);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const findFile = (name: string) => files
    .filter((entry) => entry.name.split('/').pop() === name)
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  const manifest = findFile('manifest.json');
  const main = findFile('main.js');
  const styles = findFile('styles.css');
  if (!manifest || !main) throw new Error('ZIP does not contain manifest.json and main.js');
  return {
    manifestText: await manifest.async('text'),
    mainText: await main.async('text'),
    stylesText: styles ? await styles.async('text') : null,
  };
}

// ── Callbacks ────────────────────────────────────────

export interface PluginManagerCallbacks {
  onCommandsChanged: (commands: PluginCommand[]) => void;
  onRibbonChanged: (actions: PluginRibbonAction[]) => void;
  onStatusBarChanged: (items: PluginStatusBarItem[]) => void;
  onSettingTabsChanged: (tabs: PluginSettingTabRegistration[]) => void;
  onPluginsChanged: (plugins: PluginRegistration[]) => void;
  /** Called when a plugin needs permission approval */
  onPermissionRequired?: (
    manifest: PluginManifest,
    permissions: PluginPermission[],
  ) => Promise<boolean>;
}

// ── Plugin Manager ───────────────────────────────────

export class PluginManager {
  private _app: OOApp;
  private _plugins: Map<string, PluginRegistration> = new Map();
  private _commands: PluginCommand[] = [];
  private _ribbonActions: PluginRibbonAction[] = [];
  private _statusBarItems: PluginStatusBarItem[] = [];
  private _settingTabs: PluginSettingTabRegistration[] = [];
  private _callbacks: PluginManagerCallbacks;
  private _manifestCache: Map<string, PluginManifest> = new Map();
  private _scriptElements: Map<string, HTMLScriptElement> = new Map();
  private _loggers: Map<string, PluginLogger> = new Map();
  private _editorExtensions: Map<string, any[]> = new Map();

  constructor(app: OOApp, callbacks: PluginManagerCallbacks) {
    this._app = app;
    this._callbacks = callbacks;
    const appPlugins = (this._app as any).plugins;
    appPlugins.enablePlugin = (id: string) => this.loadPlugin(id);
    appPlugins.enablePluginAndSave = (id: string) => this.enablePlugin(id);
    appPlugins.disablePlugin = (id: string) => this.unloadPlugin(id);
    appPlugins.disablePluginAndSave = (id: string) => this.disablePlugin(id);
    appPlugins.loadPlugin = (id: string) => this.loadPlugin(id);
    appPlugins.unloadPlugin = (id: string) => this.unloadPlugin(id);
    appPlugins.uninstallPlugin = (id: string) => this.uninstallPlugin(id);
    appPlugins.getPluginFolder = (manifest: PluginManifest) =>
      manifest?.dir || `.openonyx/plugins/${manifest?.id || ''}`;
    this._setupGlobalHooks();
    (window as any).__oo_cm_commands = cmCommands;
    (window as any).__oo_cm_editor_view = cmView.EditorView;
    injectPluginBaseCss();
  }

  // ── Global Hooks ──────────────────────────────────

  private _setupGlobalHooks(): void {
    const win = window as any;
    const bridge = api() as any;
    const electron = (() => {
      try { return win.require?.('electron') || {}; } catch { return {}; }
    })();
    try {
      Object.setPrototypeOf(this._app.vault.adapter, obsidianApi.FileSystemAdapter.prototype);
    } catch {
      // Adapter remains usable even if another runtime locked its prototype.
    }
    const shell = {
      ...(electron.shell || {}),
      openPath: (targetPath: string) => bridge.openPath?.(targetPath) ?? Promise.resolve(''),
      showItemInFolder: (targetPath: string) => bridge.showItemInFolder?.(targetPath),
      openExternal: (url: string) => bridge.openPath?.(url) ?? Promise.resolve(''),
    };
    // Some established plugins access Electron through window.electron rather
    // than require('electron'). Modern Electron no longer exposes `remote` in
    // the renderer, so provide the subset used by Obsidian plugins.
    const remote = electron.remote || {
      app: {
        getPath: (name: string) => name === 'home' ? '' : this._app.vault.adapter.getBasePath(),
      },
      getCurrentWindow: () => ({
        isMaximized: () => false,
        maximize: () => {},
        unmaximize: () => {},
        minimize: () => {},
        close: () => window.close(),
        isFullScreen: () => false,
        setFullScreen: () => {},
      }),
      getCurrentWebContents: () => ({
        getZoomFactor: () => 1,
        setZoomFactor: () => {},
      }),
      clipboard: {
        readText: () => '',
        writeText: (text: string) => void bridge.writeClipboardText?.(text),
        availableFormats: () => [],
        has: () => false,
        read: () => '',
      },
      dialog: {
        showOpenDialog: (options: any) => bridge.showOpenDialog(options),
        showSaveDialog: (options: any) => bridge.showSaveDialog(options),
      },
      shell,
    };
    const electronCompat = { ...electron, remote, shell };
    win.electron = electronCompat;
    const previousRequire = typeof win.require === 'function' ? win.require.bind(win) : null;
    win.require = (id: string) => {
      if (id === 'electron') return electronCompat;
      if (id === 'obsidian') return obsidianApi;
      if (frontendPluginModules[id]) return frontendPluginModules[id];
      if (previousRequire) return previousRequire(id);
      throw new Error(`Cannot require module '${id}' in this renderer`);
    };
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => bridge.writeClipboardText?.(text) ?? Promise.resolve(),
          readText: () => bridge.readClipboardText?.() ?? Promise.resolve(''),
        },
      });
    }

    win.__oo_register_command = (cmd: PluginCommand) => {
      // Deduplicate by command ID
      this._commands = this._commands.filter(c => c.id !== cmd.id);
      this._commands.push(cmd);
      (this._app as any).commands?.addCommand?.(cmd);
      this._callbacks.onCommandsChanged([...this._commands]);
    };

    win.__oo_unregister_command = (cmdId: string) => {
      this._commands = this._commands.filter(c => c.id !== cmdId);
      (this._app as any).commands?.removeCommand?.(cmdId);
      this._callbacks.onCommandsChanged([...this._commands]);
    };

    win.__oo_register_ribbon = (action: PluginRibbonAction) => {
      // Deduplicate by pluginId + title
      this._ribbonActions = this._ribbonActions.filter(a => !(a.pluginId === action.pluginId && a.title === action.title));
      this._ribbonActions.push(action);
      this._callbacks.onRibbonChanged([...this._ribbonActions]);
    };

    win.__oo_unregister_ribbon = (pluginId: string) => {
      this._ribbonActions = this._ribbonActions.filter(a => a.pluginId !== pluginId);
      this._callbacks.onRibbonChanged([...this._ribbonActions]);
    };

    win.__oo_register_statusbar = (pluginId: string, el: HTMLElement) => {
      // Deduplicate by pluginId
      this._statusBarItems = this._statusBarItems.filter(i => i.pluginId !== pluginId);
      this._statusBarItems.push({ pluginId, el });
      this._callbacks.onStatusBarChanged([...this._statusBarItems]);
    };

    win.__oo_unregister_statusbar = (pluginId: string) => {
      this._statusBarItems = this._statusBarItems.filter(i => i.pluginId !== pluginId);
      this._callbacks.onStatusBarChanged([...this._statusBarItems]);
    };

    win.__oo_register_setting_tab = (tab: PluginSettingTabRegistration) => {
      // Deduplicate by pluginId
      this._settingTabs = this._settingTabs.filter(t => t.pluginId !== tab.pluginId);
      this._settingTabs.push(tab);
      this._callbacks.onSettingTabsChanged([...this._settingTabs]);
    };

    win.__oo_unregister_setting_tab = (pluginId: string) => {
      this._settingTabs = this._settingTabs.filter(t => t.pluginId !== pluginId);
      this._callbacks.onSettingTabsChanged([...this._settingTabs]);
    };

    const publishEditorExtensions = () => {
      const entries = Array.from(this._editorExtensions.entries()).flatMap(([pluginId, extensions]) => (
        extensions.map((extension) => ({ pluginId, extension }))
      ));
      win.__oo_editor_extension_entries = entries;
      win.__oo_editor_extensions = entries.map((entry) => entry.extension);
      window.dispatchEvent(new CustomEvent('obsidian:editor-extensions-changed'));
    };

    win.__oo_register_editor_ext = (pluginId: string, extension: any) => {
      const extensions = this._editorExtensions.get(pluginId) || [];
      extensions.push(extension);
      this._editorExtensions.set(pluginId, extensions);
      publishEditorExtensions();
    };

    win.__oo_unregister_editor_ext = (pluginId: string, extension: any) => {
      const extensions = (this._editorExtensions.get(pluginId) || []).filter((item) => item !== extension);
      if (extensions.length > 0) this._editorExtensions.set(pluginId, extensions);
      else this._editorExtensions.delete(pluginId);
      publishEditorExtensions();
    };

    // Auto-disable hook from crash isolation
    win.__oo_auto_disable_plugin = (pluginId: string) => {
      console.warn(`[PluginManager] Auto-disabling ${pluginId} due to repeated errors`);
      this.disablePlugin(pluginId);
    };

    win.__oo_open_file = (path: string) => {
      // Connected by App.tsx
    };
  }

  // ── Discovery ─────────────────────────────────────

  async discoverPlugins(): Promise<PluginRegistration[]> {
    try {
      const pluginDirs = await api().dataList('plugins');
      const enabledList = await this._getEnabledList();
      const approvals = await this._getApprovals();
      const results: PluginRegistration[] = [];

      for (const dir of pluginDirs) {
        try {
          // Use cache if available
          let manifest = this._manifestCache.get(dir);

          if (!manifest) {
            const manifestJson = await api().dataRead(`plugins/${dir}/manifest.json`);
            if (!manifestJson) continue;
            manifest = JSON.parse(manifestJson) as PluginManifest;
            manifest.dir = `.openonyx/plugins/${manifest.id}`;
            this._manifestCache.set(dir, manifest);
          }

          const state: PluginState = enabledList.includes(manifest.id) ? 'enabled' : 'disabled';
          const approval = approvals[manifest.id];

          const reg: PluginRegistration = {
            manifest,
            state,
            instance: null,
            approvedPermissions: approval?.permissions,
          };
          this._plugins.set(manifest.id, reg);
          (this._app as any).plugins.manifests[manifest.id] = manifest;
          results.push(reg);
        } catch (e) {
          console.warn(`[PluginManager] Failed to read plugin in ${dir}:`, e);
        }
      }

      this._callbacks.onPluginsChanged(this.getPluginList());
      return results;
    } catch (e) {
      console.warn('[PluginManager] Discovery failed:', e);
      return [];
    }
  }

  // ── Version Check ─────────────────────────────────

  private _checkVersion(manifest: PluginManifest): { compatible: boolean; message?: string } {
    if (!manifest.minAppVersion) return { compatible: true };
    if (isVersionCompatible(manifest.minAppVersion, APP_VERSION)) {
      return { compatible: true };
    }
    return {
      compatible: false,
      message: `Requires app v${manifest.minAppVersion}+ (current: v${APP_VERSION})`,
    };
  }

  // ── Permission System ─────────────────────────────

  private async _getApprovals(): Promise<PluginApprovals> {
    try {
      const data = await api().dataRead('plugin-permissions.json');
      return data ? JSON.parse(data) : {};
    } catch { return {}; }
  }

  private async _saveApprovals(approvals: PluginApprovals): Promise<void> {
    await api().dataWrite('plugin-permissions.json', JSON.stringify(approvals, null, 2));
  }

  private async _checkPermissions(manifest: PluginManifest): Promise<boolean> {
    const requestedPermissions = manifest.permissions || DEFAULT_PERMISSIONS;
    const approvals = await this._getApprovals();
    const existing = approvals[manifest.id];

    // Check if already approved (any version)
    if (existing) {
      const allApproved = requestedPermissions.every(p => existing.permissions.includes(p));
      if (allApproved) return true;
    }

    // Need approval — ask via callback
    if (this._callbacks.onPermissionRequired) {
      const approved = await this._callbacks.onPermissionRequired(manifest, requestedPermissions);
      if (approved) {
        approvals[manifest.id] = {
          permissions: requestedPermissions,
          approvedAt: Date.now(),
          version: manifest.version,
        };
        await this._saveApprovals(approvals);

        // Update registration
        const reg = this._plugins.get(manifest.id);
        if (reg) reg.approvedPermissions = requestedPermissions;

        return true;
      }
      return false;
    }

    // No callback set — auto-approve (dev mode / first run)
    approvals[manifest.id] = {
      permissions: requestedPermissions,
      approvedAt: Date.now(),
      version: manifest.version,
    };
    await this._saveApprovals(approvals);
    return true;
  }

  private _buildRequireShim(manifest: PluginManifest, permissions: PluginPermission[]): (id: string) => any {
    return (id: string): any => {
      if (id === 'obsidian') {
        // Return a permission-filtered API surface
        return this._buildGuardedApi(manifest.id, permissions);
      }
      
      // Provide built-in frontend modules
      if (frontendPluginModules[id]) return frontendPluginModules[id];

      if (id === 'electron') {
        let electron: any = {};
        try { electron = (window as any).require?.('electron') || {}; } catch { /* bridge only */ }
        const bridge = api() as any;
        const home = (() => {
          try { return (window as any).require?.('os')?.homedir?.() || ''; } catch { return ''; }
        })();
        const shell = {
          ...(electron.shell || {}),
          openPath: (targetPath: string) => bridge.openPath?.(targetPath) ?? Promise.resolve(''),
          showItemInFolder: (targetPath: string) => bridge.showItemInFolder?.(targetPath),
          openExternal: (url: string) => bridge.openPath?.(url) ?? Promise.resolve(''),
        };
        return {
          ...electron,
          shell,
          remote: electron.remote || {
            app: {
              getPath: (name: string) => {
                if (name === 'documents') return home ? `${home}/Documents` : this._app.vault.adapter.getBasePath();
                if (name === 'home') return home;
                return this._app.vault.adapter.getBasePath();
              },
            },
            dialog: {
              showOpenDialog: (options: any) => bridge.showOpenDialog(options),
              showSaveDialog: (options: any) => bridge.showSaveDialog(options),
            },
            shell,
          },
        };
      }
      
      // Fallback to real node modules or electron modules if nodeIntegration is enabled
      if (typeof (window as any).require !== 'undefined') {
        try {
          return (window as any).require(id);
        } catch (e) {
          // Ignore and fall through to warning
        }
      }
      
      console.warn(`[Plugin:${manifest.id}] Unsupported require('${id}')`);
      return {};
    };
  }

  /** Build a permission-guarded obsidian API object */
  private _buildGuardedApi(pluginId: string, permissions: PluginPermission[]): any {
    const fullApi = { ...obsidianApi };
    try {
      Object.setPrototypeOf(this._app.vault.adapter, fullApi.FileSystemAdapter.prototype);
    } catch {
      // Adapter remains usable even if another runtime locked its prototype.
    }

    // If network permission is missing, block requestUrl
    if (!permissions.includes('network')) {
      fullApi.requestUrl = (() => {
        throw new Error(`[Plugin:${pluginId}] Network access denied — 'network' permission not granted`);
      }) as any;
      fullApi.request = fullApi.requestUrl;
    }

    return fullApi;
  }

  // ── Loading (Blob URL Execution) ──────────────────

  async loadPlugin(pluginId: string): Promise<boolean> {
    const reg = this._plugins.get(pluginId);
    if (!reg) { console.error(`[PluginManager] Plugin not found: ${pluginId}`); return false; }
    if (reg.instance) { console.warn(`[PluginManager] Plugin already loaded: ${pluginId}`); return true; }

    const startTime = performance.now();
    reg.state = 'loading';
    this._callbacks.onPluginsChanged(this.getPluginList());

    try {
      const manifest = reg.manifest;

      // ── Vault check (don't load plugins if no vault is active, except maybe internal ones)
      const vaultPath = await api().getVaultPath();
      if (!vaultPath) {
        throw new Error(`Cannot load plugin ${pluginId}: No vault path set. Plugins must be loaded within a vault context.`);
      }

      // ── Version check
      const compat = this._checkVersion(manifest);
      if (!compat.compatible) {
        throw new Error(compat.message || 'Incompatible version');
      }

      // ── Permission check
      const permitted = await this._checkPermissions(manifest);
      if (!permitted) {
        reg.state = 'disabled';
        this._callbacks.onPluginsChanged(this.getPluginList());
        return false;
      }

      // ── Read main.js
      const mainJs = await api().dataRead(`plugins/${pluginId}/main.js`);
      if (!mainJs) throw new Error(`No main.js found for plugin ${pluginId}`);

      // ── Read and inject plugin styles.css with document-level cascade (compat)
      const stylesCss = await api().dataRead(`plugins/${pluginId}/styles.css`);
      if (stylesCss) injectPluginStyles(pluginId, stylesCss);

      // ── Create per-plugin logger
      const logger = new PluginLogger(pluginId);
      this._loggers.set(pluginId, logger);

      // ── Ensure plugin data directory exists (some plugins write files there immediately)
      await api().createDirectory(`plugins/${pluginId}`).catch(() => {});

      // ── Execute via Blob URL (CSP-safe)
      const permissions = manifest.permissions || DEFAULT_PERMISSIONS;
      const instance = await this._executePluginBlob(mainJs, manifest, permissions);

      reg.instance = instance;
      reg.state = 'enabled';
      reg.error = undefined;
      reg.loadTimeMs = Math.round(performance.now() - startTime);
      (this._app as any).plugins.plugins[pluginId] = instance;
      (this._app as any).plugins.enabledPlugins.add(pluginId);

      // ── Call onload with crash isolation
      const loadResult = await safePluginCallAsync(
        pluginId,
        async () => {
          const win = window as any;
          const previousPluginId = win.__oo_active_plugin_id;
          win.__oo_active_plugin_id = pluginId;
          try {
            return await Promise.resolve(instance.load() as any);
          } finally {
            if (previousPluginId === undefined) delete win.__oo_active_plugin_id;
            else win.__oo_active_plugin_id = previousPluginId;
          }
        },
        'onload',
      );
      if (loadResult.shouldDisable) {
        throw new Error(`Plugin crashed during onload: ${loadResult.error}`);
      }

      console.log(`[PluginManager] Loaded: ${manifest.name} v${manifest.version} (${reg.loadTimeMs}ms)`);
      this._callbacks.onPluginsChanged(this.getPluginList());
      return true;
    } catch (e: any) {
      console.error(`[PluginManager] Failed to load ${pluginId}:`, e);
      pluginErrorTracker.record(pluginId, e, 'loadPlugin');
      reg.state = 'errored';
      reg.error = e.message || 'Unknown error';
      reg.errorCount = (reg.errorCount || 0) + 1;
      reg.lastErrorAt = Date.now();
      reg.loadTimeMs = Math.round(performance.now() - startTime);
      this._callbacks.onPluginsChanged(this.getPluginList());
      return false;
    }
  }

  /**
   * Execute plugin code via Blob URL + <script> tag.
   *
   * This bypasses CSP `script-src 'self'` restrictions because:
   * - Blob URLs created by the page are treated as same-origin
   * - Unlike `new Function()` / `eval()`, script tag loading is not blocked by CSP
   *
   * The plugin code is wrapped in an IIFE that receives require/module/exports
   * from pre-set global variables, then cleaned up immediately after execution.
   */
  private _executePluginBlob(mainJs: string, manifest: PluginManifest, permissions: PluginPermission[]): Promise<IPlugin> {
    return new Promise((resolve, reject) => {
      // Generate safe global key from plugin ID
      const safeId = manifest.id.replace(/[^a-zA-Z0-9_]/g, '_');
      const globalKey = `__oo_plugin_${safeId}_${Date.now()}`;

      // Set up module/exports on a temp global
      const moduleExports: any = {};
      const moduleObj = { exports: moduleExports };
      const requireShim = this._buildRequireShim(manifest, permissions);

      (window as any)[globalKey] = {
        require: requireShim,
        module: moduleObj,
        exports: moduleExports,
        app: this._app,
        moment: (window as any).moment,
      };

      // Wrap the plugin code
      const wrappedCode = `
(function(){
  var __ctx = window["${globalKey}"];
  var require = __ctx.require;
  var module = __ctx.module;
  var exports = __ctx.exports;
  // Ensure critical globals are available inside the blob
  window.app = window.app || __ctx.app;
  window.moment = window.moment || __ctx.moment;
  // Blob scripts do not consistently resolve window properties as bare
  // identifiers. Obsidian exposes these names to plugins as globals.
  var activeWindow = window.activeWindow || window;
  var activeDocument = window.activeDocument || document;
  ${mainJs}
})();
window["${globalKey}"].__done = true;
`;
      const blob = new Blob([wrappedCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const pluginBlobUrls = ((window as any).__oo_plugin_blob_urls ||= new Map<string, string>());
      pluginBlobUrls.set(blobUrl, manifest.id);

      const script = document.createElement('script');
      script.src = blobUrl;
      script.setAttribute('data-plugin-id', manifest.id);

      // Timeout guard
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Plugin ${manifest.id} timed out during load (${LOAD_TIMEOUT_MS}ms)`));
      }, LOAD_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(blobUrl);
        script.remove();
        // Clean up the global — keep module reference for extraction
      };

      script.onload = () => {
        cleanup();

        try {
          const ctx = (window as any)[globalKey];
          delete (window as any)[globalKey];

          if (!ctx || !ctx.__done) {
            reject(new Error(`Plugin ${manifest.id} script did not execute`));
            return;
          }

          // Extract the plugin class
          const PluginClass = ctx.module.exports.default || ctx.module.exports;
          if (typeof PluginClass !== 'function') {
            reject(new Error(`Plugin ${manifest.id} does not export a class`));
            return;
          }

          // Instantiate
          const instance = new PluginClass(this._app, manifest);
          resolve(instance);
        } catch (e: any) {
          reject(new Error(`Plugin ${manifest.id} instantiation error: ${e.message}`));
        }
      };

      script.onerror = (event) => {
        cleanup();
        delete (window as any)[globalKey];
        reject(new Error(`Plugin ${manifest.id} script failed to load`));
      };

      // Store reference for cleanup
      this._scriptElements.set(manifest.id, script);

      // Execute
      document.head.appendChild(script);
    });
  }

  // ── Unloading ─────────────────────────────────────

  async unloadPlugin(pluginId: string): Promise<void> {
    const reg = this._plugins.get(pluginId);
    if (!reg?.instance) return;

    // Crash-safe unload
    safePluginCall(pluginId, () => {
      const win = window as any;
      const previousPluginId = win.__oo_active_plugin_id;
      win.__oo_active_plugin_id = pluginId;
      try {
        return reg.instance.unload();
      } finally {
        if (previousPluginId === undefined) delete win.__oo_active_plugin_id;
        else win.__oo_active_plugin_id = previousPluginId;
      }
    }, 'onunload');

    removePluginStyles(pluginId);
    pluginLogStore.clearPlugin(pluginId);

    // Remove script element if still around
    const script = this._scriptElements.get(pluginId);
    if (script) {
      script.remove();
      this._scriptElements.delete(pluginId);
    }
    const pluginBlobUrls = (window as any).__oo_plugin_blob_urls as Map<string, string> | undefined;
    if (pluginBlobUrls) {
      for (const [url, id] of pluginBlobUrls) {
        if (id === pluginId) {
          URL.revokeObjectURL(url);
          pluginBlobUrls.delete(url);
        }
      }
    }

    this._loggers.delete(pluginId);

    reg.instance = null;
    reg.state = 'disabled';
    reg.error = undefined;
    delete (this._app as any).plugins.plugins[pluginId];
    (this._app as any).plugins.enabledPlugins.delete(pluginId);

    this._callbacks.onPluginsChanged(this.getPluginList());
  }

  // ── Enable/Disable ────────────────────────────────

  async enablePlugin(pluginId: string): Promise<boolean> {
    const success = await this.loadPlugin(pluginId);
    if (success) await this._addToEnabledList(pluginId);
    return success;
  }

  async disablePlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this._removeFromEnabledList(pluginId);
  }

  async uninstallPlugin(pluginId: string): Promise<boolean> {
    if (!this._plugins.has(pluginId)) return false;

    await this.disablePlugin(pluginId);
    await api().deleteDirectory(`.openonyx/plugins/${pluginId}`);
    await api().dataDelete(`plugins/${pluginId}/data.json`).catch(() => {});

    this._plugins.delete(pluginId);
    this._manifestCache.delete(pluginId);
    delete (this._app as any).plugins.manifests[pluginId];
    delete (this._app as any).plugins.plugins[pluginId];
    (this._app as any).plugins.enabledPlugins.delete(pluginId);
    this._callbacks.onPluginsChanged(this.getPluginList());
    return true;
  }

  // ── Load All Enabled (Parallel) ───────────────────

  async loadEnabledPlugins(): Promise<void> {
    const enabledList = await this._getEnabledList();
    const toLoad = enabledList.filter(id => this._plugins.has(id));

    // Parallel loading with concurrency limit
    const chunks: string[][] = [];
    for (let i = 0; i < toLoad.length; i += MAX_PARALLEL_LOADS) {
      chunks.push(toLoad.slice(i, i + MAX_PARALLEL_LOADS));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(id => this.loadPlugin(id)));
    }
  }

  // ── Install from Github Repo (Marketplace) ────────

  async installFromGithubRepo(repo: string, expectedPluginId: string, registryVersion?: string): Promise<boolean> {
    console.log(`[PluginManager] Installing from Github: ${repo} → ${expectedPluginId}`);

    const fetchText = (url: string) => api().dataFetch(url);
    const fetchBinary = async (url: string): Promise<ArrayBuffer> => {
      const response = await api().networkRequest({
        url,
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }
      return response.arrayBuffer;
    };

    const readZipBundle = async (url: string): Promise<PluginBundleFiles> => {
      return extractPluginBundleFromZip(await fetchBinary(url));
    };

    const readLooseBundle = async (
      manifestUrl: string,
      mainUrl: string,
      stylesUrl?: string,
    ): Promise<PluginBundleFiles> => {
      const [manifestText, mainText] = await Promise.all([
        fetchText(manifestUrl),
        fetchText(mainUrl),
      ]);
      let stylesText: string | null = null;
      if (stylesUrl) {
        try { stylesText = await fetchText(stylesUrl); } catch { /* styles.css is optional */ }
      }
      return { manifestText, mainText, stylesText };
    };

    console.log(`[PluginManager] Step 1: Resolving release bundle...`);
    const strategies: Array<{ label: string; load: () => Promise<PluginBundleFiles> }> = [];
    let repositoryVersion = registryVersion;
    for (const branch of ['HEAD', 'main', 'master']) {
      try {
        const candidate = JSON.parse(
          await fetchText(`https://raw.githubusercontent.com/${repo}/${branch}/manifest.json`),
        ) as PluginManifest;
        if (candidate.id === expectedPluginId && candidate.version) {
          repositoryVersion = candidate.version;
          break;
        }
      } catch {
        // Some repositories keep release files outside the default branch root.
      }
    }

    const releaseApiUrls = [
      ...(repositoryVersion ? [
        `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(repositoryVersion)}`,
        `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(`v${repositoryVersion}`)}`,
      ] : []),
      `https://api.github.com/repos/${repo}/releases/latest`,
    ];
    const releases: any[] = [];
    for (const url of releaseApiUrls) {
      try {
        const release = JSON.parse(await fetchText(url));
        if (release?.assets && !releases.some((entry) => entry.id === release.id)) releases.push(release);
      } catch (error) {
        console.warn(`[PluginManager] Release API unavailable: ${url}`, error);
      }
    }

    for (const release of releases) {
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const manifestAsset = assets.find((asset: any) => asset.name.toLowerCase() === 'manifest.json');
      const mainAsset = assets.find((asset: any) => asset.name.toLowerCase() === 'main.js');
      const stylesAsset = assets.find((asset: any) => asset.name.toLowerCase() === 'styles.css');
      if (manifestAsset && mainAsset) {
        strategies.push({
          label: `loose release assets (${release.tag_name})`,
          load: () => readLooseBundle(
            manifestAsset.browser_download_url,
            mainAsset.browser_download_url,
            stylesAsset?.browser_download_url,
          ),
        });
      }

      for (const asset of assets.filter((entry: any) => entry.name.toLowerCase().endsWith('.zip'))) {
        strategies.push({
          label: `release ZIP ${asset.name} (${release.tag_name})`,
          load: () => readZipBundle(asset.browser_download_url),
        });
      }
    }

    const releaseTags = [...new Set([
      repositoryVersion,
      repositoryVersion ? `v${repositoryVersion}` : undefined,
      ...releases.map((release) => release.tag_name),
    ].filter((entry): entry is string => Boolean(entry)))];
    for (const releaseTag of releaseTags) {
      const releaseBase = `https://github.com/${repo}/releases/download/${encodeURIComponent(releaseTag)}`;
      strategies.push({
        label: `release tag ${releaseTag}`,
        load: () => readLooseBundle(
          `${releaseBase}/manifest.json`,
          `${releaseBase}/main.js`,
          `${releaseBase}/styles.css`,
        ),
      });
    }

    for (const branch of ['HEAD', 'main', 'master']) {
      const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
      strategies.push({
        label: `repository ${branch}`,
        load: () => readLooseBundle(
          `${rawBase}/manifest.json`,
          `${rawBase}/main.js`,
          `${rawBase}/styles.css`,
        ),
      });
    }

    let bundle: PluginBundleFiles | null = null;
    const failures: string[] = [];
    for (const strategy of strategies) {
      try {
        bundle = await strategy.load();
        console.log(`[PluginManager] Resolved ${expectedPluginId} from ${strategy.label}`);
        break;
      } catch (error: any) {
        failures.push(`${strategy.label}: ${error.message}`);
      }
    }
    if (!bundle) {
      throw new Error(`No installable plugin bundle found for ${repo}. ${failures.join(' | ')}`);
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(bundle.manifestText) as PluginManifest;
    } catch {
      throw new Error(`Downloaded manifest.json is invalid JSON`);
    }
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Downloaded manifest.json is missing id, name, or version');
    }
    if (manifest.id !== expectedPluginId) {
      throw new Error(`Plugin ID mismatch: registry requested ${expectedPluginId}, bundle contains ${manifest.id}`);
    }

    const existing = this._plugins.get(manifest.id);
    const wasEnabled = !!existing?.instance || (await this._getEnabledList()).includes(manifest.id);
    if (existing?.instance) await this.unloadPlugin(manifest.id);

    console.log(`[PluginManager] Step 2: Saving ${manifest.name} v${manifest.version}...`);
    const pluginDir = `plugins/${manifest.id}`;
    try {
      await api().dataWrite(`${pluginDir}/manifest.json`, bundle.manifestText);
      await api().dataWrite(`${pluginDir}/main.js`, bundle.mainText);
      if (bundle.stylesText) await api().dataWrite(`${pluginDir}/styles.css`, bundle.stylesText);
      else await api().dataDelete(`${pluginDir}/styles.css`).catch(() => {});
    } catch (e: any) {
      throw new Error(`Failed to save plugin files to disk: ${e.message}`);
    }

    await this.discoverPlugins();

    console.log(`[PluginManager] Step 3: ${existing ? 'Updating' : 'Enabling'} ${manifest.id}...`);
    const loadSuccess = existing && !wasEnabled
      ? true
      : await this.enablePlugin(manifest.id);
    if (!loadSuccess) {
      const registration = this._plugins.get(manifest.id);
      throw new Error(registration?.error || `${manifest.name} installed but failed to load`);
    }
    console.log(`[PluginManager] Installed and enabled ${manifest.name} v${manifest.version}`);
    return true;
  }

  // ── Enabled list persistence ──────────────────────

  private async _getEnabledList(): Promise<EnabledPluginList> {
    try {
      const data = await api().dataRead('community-plugins.json');
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  private async _saveEnabledList(list: EnabledPluginList): Promise<void> {
    await api().dataWrite('community-plugins.json', JSON.stringify(list, null, 2));
  }

  private async _addToEnabledList(pluginId: string): Promise<void> {
    const list = await this._getEnabledList();
    if (!list.includes(pluginId)) {
      list.push(pluginId);
      await this._saveEnabledList(list);
    }
  }

  private async _removeFromEnabledList(pluginId: string): Promise<void> {
    const list = await this._getEnabledList();
    await this._saveEnabledList(list.filter(id => id !== pluginId));
  }

  // ── Hot Reload (Dev Mode) ─────────────────────────

  async reloadPlugin(pluginId: string): Promise<boolean> {
    // Invalidate cache
    this._manifestCache.delete(pluginId);
    pluginErrorTracker.clearPlugin(pluginId);

    await this.unloadPlugin(pluginId);

    // Re-read manifest
    try {
      const manifestJson = await api().dataRead(`plugins/${pluginId}/manifest.json`);
      if (manifestJson) {
        const manifest = JSON.parse(manifestJson) as PluginManifest;
        manifest.dir = `.openonyx/plugins/${manifest.id}`;
        this._manifestCache.set(pluginId, manifest);
        const reg = this._plugins.get(pluginId);
        if (reg) reg.manifest = manifest;
      }
    } catch (e) {
      console.warn(`[PluginManager] Failed to re-read manifest for ${pluginId}:`, e);
    }

    return this.loadPlugin(pluginId);
  }

  // ── Accessors ─────────────────────────────────────

  getPluginList(): PluginRegistration[] {
    return Array.from(this._plugins.values());
  }

  getPlugin(pluginId: string): PluginRegistration | undefined {
    return this._plugins.get(pluginId);
  }

  getCommands(): PluginCommand[] { return [...this._commands]; }
  getRibbonActions(): PluginRibbonAction[] { return [...this._ribbonActions]; }
  getStatusBarItems(): PluginStatusBarItem[] { return [...this._statusBarItems]; }
  getSettingTabs(): PluginSettingTabRegistration[] { return [...this._settingTabs]; }

  getPluginLogger(pluginId: string): PluginLogger | undefined {
    return this._loggers.get(pluginId);
  }

  /** Destroy the plugin manager and unload all plugins */
  async destroy(): Promise<void> {
    for (const [pluginId] of this._plugins) {
      await this.unloadPlugin(pluginId);
    }
    this._plugins.clear();
    this._commands = [];
    this._ribbonActions = [];
    this._statusBarItems = [];
    this._settingTabs = [];
    this._manifestCache.clear();
    this._scriptElements.clear();
    this._loggers.clear();
    this._editorExtensions.clear();
    (window as any).__oo_editor_extensions = [];
    (window as any).__oo_editor_extension_entries = [];
  }
}
