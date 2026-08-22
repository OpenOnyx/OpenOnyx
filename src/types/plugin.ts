/**
 * Plugin System Type Definitions
 *
 * Types for the OpenOnyx plugin ecosystem.
 * The PluginManifest interface matches Obsidian's format exactly
 * so existing community plugin manifests work without modification.
 */

// ── Permissions ───────────────────────────────────────

/** Granular permission types for plugin capabilities */
export type PluginPermission = 'filesystem' | 'network' | 'ui' | 'editor' | 'system';

/** Granted when a manifest omits permissions. Filesystem and network must be explicit. */
export const DEFAULT_PLUGIN_PERMISSIONS: PluginPermission[] = ['ui', 'editor'];

/** Human-readable descriptions for permission labels */
export const PERMISSION_DESCRIPTIONS: Record<PluginPermission, { label: string; description: string; risk: 'low' | 'medium' | 'high' }> = {
  filesystem: {
    label: 'File System Access',
    description: 'Read and write files in your vault',
    risk: 'medium',
  },
  network: {
    label: 'Network Access',
    description: 'Make HTTP requests to external services',
    risk: 'high',
  },
  ui: {
    label: 'UI Access',
    description: 'Add ribbon icons, commands, modals, and settings tabs',
    risk: 'low',
  },
  editor: {
    label: 'Editor Access',
    description: 'Modify the editor and process Markdown content',
    risk: 'medium',
  },
  system: {
    label: 'System Access',
    description: 'Access platform information and Electron APIs',
    risk: 'high',
  },
};

/** Stored approval record per plugin */
export interface PluginApproval {
  permissions: PluginPermission[];
  approvedAt: number;
  version: string;
}

/** Persisted permissions map — stored in plugin-permissions.json */
export interface PluginApprovals {
  [pluginId: string]: PluginApproval;
}

// ── Manifest ──────────────────────────────────────────

/** Matches Obsidian's manifest.json format exactly */
export interface PluginManifest {
  /** Unique plugin identifier */
  id: string;
  /** Display name */
  name: string;
  /** Author name */
  author: string;
  /** Semantic version string */
  version: string;
  /** Minimum app version required */
  minAppVersion: string;
  /** Plugin description */
  description: string;
  /** Whether the plugin requires desktop (Node/Electron) APIs */
  isDesktopOnly?: boolean;
  /** Author website URL */
  authorUrl?: string;
  /** Donation/funding URL */
  fundingUrl?: string | Record<string, string>;
  /** Vault-relative path to plugin folder (injected at load time) */
  dir?: string;
  /** Requested permissions (OpenOnyx extension) */
  permissions?: PluginPermission[];
}

// ── Plugin State ──────────────────────────────────────

/** Plugin lifecycle state */
export type PluginState = 'installed' | 'enabled' | 'disabled' | 'errored' | 'loading';

/** Runtime tracking for a loaded plugin */
export interface PluginRegistration {
  manifest: PluginManifest;
  state: PluginState;
  /** The instantiated Plugin object (null if not loaded) */
  instance: any | null;
  /** Error message if state is 'errored' */
  error?: string;
  /** Time taken to load (ms) */
  loadTimeMs?: number;
  /** Cumulative error count */
  errorCount?: number;
  /** Timestamp of last error */
  lastErrorAt?: number;
  /** Approved permissions */
  approvedPermissions?: PluginPermission[];
}

// ── UI Registrations ──────────────────────────────────

/** A command registered by a plugin */
export interface PluginCommand {
  /** Unique command ID (format: pluginId:commandName) */
  id: string;
  /** Display name */
  name: string;
  /** Plugin that registered this command */
  pluginId: string;
  /** Simple callback */
  callback?: () => void;
  /** Check callback — return false to hide from palette */
  checkCallback?: (checking: boolean) => boolean | void;
  /** Editor-scoped callback */
  editorCallback?: (editor: any, view: any) => void;
  /** Editor check callback */
  editorCheckCallback?: (checking: boolean, editor: any, view: any) => boolean | void;
  /** Default hotkeys */
  hotkeys?: Array<{ modifiers: string[]; key: string }>;
  /** Icon for the command */
  icon?: string;
}

/** A ribbon icon action registered by a plugin */
export interface PluginRibbonAction {
  pluginId: string;
  icon: string;
  title: string;
  callback: (evt: MouseEvent) => void;
  /** The DOM element for removal */
  el?: HTMLElement;
}

/** A status bar item registered by a plugin */
export interface PluginStatusBarItem {
  pluginId: string;
  el: HTMLElement;
}

/** A settings tab registered by a plugin */
export interface PluginSettingTabRegistration {
  pluginId: string;
  name: string;
  /** The SettingTab instance */
  tab: any;
}

/** A view type registered by a plugin */
export interface PluginViewRegistration {
  pluginId: string;
  type: string;
  /** Factory function to create the view */
  viewCreator: (leaf: any) => any;
}

/** Serialized plugin enable state — stored in community-plugins.json */
export type EnabledPluginList = string[];

/** Event emitted when plugin state changes */
export interface PluginStateChangeEvent {
  pluginId: string;
  previousState: PluginState;
  newState: PluginState;
}

// ── Marketplace Foundation ────────────────────────────

/** Registry entry for a publicly available plugin */
export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  downloadUrl: string;
  repository?: string;
  repo?: string;
  downloads?: number;
  minAppVersion?: string;
  permissions?: PluginPermission[];
  lastUpdated?: string;
}
