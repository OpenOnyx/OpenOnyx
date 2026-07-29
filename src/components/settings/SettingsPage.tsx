import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Brain,
  CalendarDays,
  Check,
  Command,
  Copy,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Grid2X2,
  Info,
  Keyboard,
  KeyRound,
  Link2,
  Palette,
  Puzzle,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Terminal,
  Type,
  Users,
  Wand2,
  WifiOff,
  X,
} from "lucide-react";
import { PluginSettingsPanel } from "../plugins/PluginSettingsPanel";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import type { PluginRegistration, PluginSettingTabRegistration } from "../../types/plugin";
import type { Command as AppCommand } from "../../types";
import { isDarkTheme } from "../../utils/helpers";
import type { LocalVaultCollaborator, LocalVaultInvite } from "../../lib/localdb";
import { CollaborationPanel } from "../spaces/CollaborationPanel";
import { authManager } from "../../lib/auth";
import { AuthModal } from "../modals/AuthModal";
import {
  AI_PROVIDER_PRESETS,
  DEFAULT_MODEL_ID,
  getModelsForProvider,
  loadSettings,
  saveSettings,
  type AISettings,
} from "../../utils/ai-settings";
import { isModelLoaded, loadStore } from "../../utils/embeddings";
import {
  clearSavedUserDatabaseConfig,
  connectUserDatabase,
  disconnectUserDatabase,
  getUserDatabaseConfig,
  loadSavedUserDatabaseConfig,
  saveUserDatabaseConfig,
  testConnection,
  type UserDatabaseConfig,
} from "../../lib/userDatabase";
import { configureSupabaseClient } from "../../lib/supabase";
import { parseSupabaseEnv } from "../../lib/supabaseConfig";
import databaseSchemaSql from "../../../supabase/schema.sql?raw";
import { version as APP_VERSION } from "../../../package.json";
import { getAPI } from "../../utils/api";

type ThemeSetting =
  | "dark"
  | "light"
  | "oceanic"
  | "dark-plus"
  | "blue-night"
  | "ember-night"
  | "aurora-grove"
  | "paper-sage"
  | "rose-quartz"
  | "system"
  | "custom";

export interface AppSettings {
  theme: ThemeSetting;
  customThemeType: "dark" | "light";
  accentColor: string;
  fontFamily: string;
  customBgPrimary: string;
  customTextPrimary: string;

  fontSize: number;
  editorFontSize: number;
  previewFontSize: number;
  readingViewWidth: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  spellcheck: boolean;
  vimMode: boolean;
  useWikiLinks: boolean;

  autoUpdates: boolean;
  language: "English";
  alwaysFocusNewTabs: boolean;
  defaultView: "editor" | "preview" | "split";
  defaultEditingMode: "live-preview" | "source";
  showEditingModeStatusBar: boolean;
  readableLineLength: boolean;
  strictLineBreaks: boolean;
  propertiesInDocument: "visible" | "hidden" | "source";
  foldHeading: boolean;
  foldIndent: boolean;
  indentationGuides: boolean;
  rightToLeft: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  smartLists: boolean;
  indentUsingTabs: boolean;
  convertPastedHtml: boolean;

  defaultFileToOpen: "last-opened" | "new-tab";
  defaultNoteLocation: "vault" | "same-folder";
  defaultAttachmentLocation: "vault" | "same-folder";
  newLinkFormat: "shortest" | "relative" | "absolute";
  autoUpdateInternalLinks: boolean;
  showAllFileTypes: boolean;
  confirmBeforeDelete: boolean;
  deleteAttachmentsMode: "ask" | "always" | "never";
  deletedFilesMode: "system-trash" | "app-trash" | "permanent";
  excludedFiles: string;
  overrideConfigFolder: string;
  allowUrlCallbacks: boolean;

  inlineTitle: boolean;
  showTabTitleBar: boolean;
  showRibbon: boolean;
  quickFontSizeAdjustment: boolean;
  zoomLevel: number;
  nativeMenus: boolean;
  windowFrameStyle: "hidden" | "native";
  hardwareAcceleration: boolean;

  coreBacklinks: boolean;
  coreCanvas: boolean;
  coreCommandPalette: boolean;
  coreDailyNotes: boolean;
  corePagePreview: boolean;
  coreQuickSwitcher: boolean;
  coreTemplates: boolean;
  backlinksOpenByDefault: boolean;
  backlinksShowUnlinked: boolean;
  canvasDefaultLocation: "vault" | "same-folder";
  canvasMouseWheelBehavior: "pan" | "zoom";
  canvasCtrlDragBehavior: "menu" | "pan";
  canvasShowCardNames: "always" | "hover" | "never";
  canvasSnapToGrid: boolean;
  canvasSnapToObjects: boolean;
  canvasZoomThreshold: number;
  dailyNoteDateFormat: string;
  dailyNoteLocation: string;
  dailyNoteTemplate: string;
  pagePreviewRequireCtrl: boolean;
  pagePreviewSearchLinks: boolean;
  pagePreviewReading: boolean;
  pagePreviewEditing: boolean;
  pagePreviewTabHeader: boolean;
  pagePreviewFiles: boolean;
  pagePreviewProperties: boolean;
  pagePreviewBookmarks: boolean;
  pagePreviewOutline: boolean;
  pagePreviewGraph: boolean;
  templatesFolder: string;
  templateDateFormat: string;
  templateTimeFormat: string;
  pluginAutoUpdates: boolean;
}

type CustomThemeColorKey = "accentColor" | "customBgPrimary" | "customTextPrimary";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accentColor: "#E8A84A",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  customBgPrimary: "#0C0D0F",
  customTextPrimary: "#E8EAED",
  customThemeType: "dark",

  fontSize: 17,
  editorFontSize: 17,
  previewFontSize: 17,
  readingViewWidth: 800,
  lineHeight: 1.5,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellcheck: false,
  vimMode: false,
  useWikiLinks: true,

  autoUpdates: true,
  language: "English",
  alwaysFocusNewTabs: true,
  defaultView: "editor",
  defaultEditingMode: "live-preview",
  showEditingModeStatusBar: true,
  readableLineLength: true,
  strictLineBreaks: false,
  propertiesInDocument: "visible",
  foldHeading: true,
  foldIndent: true,
  indentationGuides: true,
  rightToLeft: false,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  smartLists: true,
  indentUsingTabs: true,
  convertPastedHtml: true,

  defaultFileToOpen: "last-opened",
  defaultNoteLocation: "vault",
  defaultAttachmentLocation: "vault",
  newLinkFormat: "shortest",
  autoUpdateInternalLinks: false,
  showAllFileTypes: false,
  confirmBeforeDelete: true,
  deleteAttachmentsMode: "ask",
  deletedFilesMode: "system-trash",
  excludedFiles: "",
  overrideConfigFolder: ".obsidian",
  allowUrlCallbacks: false,

  inlineTitle: true,
  showTabTitleBar: true,
  showRibbon: true,
  quickFontSizeAdjustment: false,
  zoomLevel: 100,
  nativeMenus: false,
  windowFrameStyle: "hidden",
  hardwareAcceleration: true,

  coreBacklinks: true,
  coreCanvas: true,
  coreCommandPalette: true,
  coreDailyNotes: true,
  corePagePreview: true,
  coreQuickSwitcher: true,
  coreTemplates: true,
  backlinksOpenByDefault: false,
  backlinksShowUnlinked: true,
  canvasDefaultLocation: "vault",
  canvasMouseWheelBehavior: "pan",
  canvasCtrlDragBehavior: "menu",
  canvasShowCardNames: "always",
  canvasSnapToGrid: true,
  canvasSnapToObjects: true,
  canvasZoomThreshold: 60,
  dailyNoteDateFormat: "YYYY-MM-DD",
  dailyNoteLocation: "",
  dailyNoteTemplate: "",
  pagePreviewRequireCtrl: false,
  pagePreviewSearchLinks: true,
  pagePreviewReading: false,
  pagePreviewEditing: true,
  pagePreviewTabHeader: true,
  pagePreviewFiles: true,
  pagePreviewProperties: true,
  pagePreviewBookmarks: true,
  pagePreviewOutline: true,
  pagePreviewGraph: true,
  templatesFolder: "templates",
  templateDateFormat: "YYYY-MM-DD",
  templateTimeFormat: "HH:mm",
  pluginAutoUpdates: false,
};

type SettingsSection =
  | "general"
  | "editor"
  | "files"
  | "appearance"
  | "hotkeys"
  | "keychain"
  | "core-plugins"
  | "plugins"
  | "ai"
  | "database"
  | "backlinks"
  | "canvas"
  | "command-palette"
  | "daily-notes"
  | "page-preview"
  | "quick-switcher"
  | "templates"
  | "collaboration"
  | "about";

interface SettingsPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
  commands?: AppCommand[];
  plugins?: PluginRegistration[];
  pluginSettingTabs?: PluginSettingTabRegistration[];
  onEnablePlugin?: (pluginId: string) => Promise<void>;
  onDisablePlugin?: (pluginId: string) => Promise<void>;
  onRefreshPlugins?: () => Promise<void>;
  onReloadPlugin?: (pluginId: string) => Promise<void>;
  onUninstallPlugin?: (pluginId: string) => Promise<boolean>;
  onInstallPlugin?: (repo: string, pluginId: string, version?: string) => Promise<boolean>;
  collaborators?: LocalVaultCollaborator[];
  invitesSent?: LocalVaultInvite[];
  invitesReceived?: LocalVaultInvite[];
  onInviteUser?: (email: string) => void;
  onRemoveCollaborator?: (id: string) => void;
  onAcceptInvite?: (id: string) => void;
  onRejectInvite?: (id: string) => void;
  currentUserEmail?: string;
  vaultPath?: string;
  onVaultReconstructed?: (path: string) => void;
  initialSection?: SettingsSection;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const overlayClass = "fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-[2px]";
const pageClass = "oo-prefs relative flex h-[min(92vh,920px)] w-[min(96vw,1100px)] overflow-hidden rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-0,var(--bg-primary))] text-[var(--oo-text-primary,var(--text-primary))] shadow-[0_24px_64px_rgba(0,0,0,0.45)]";
const sidebarClass = "oo-prefs-nav w-[250px] shrink-0 overflow-y-auto border-r border-[var(--oo-border-subtle,var(--divider-color))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-5 py-7";
const contentClass = "oo-prefs-content min-w-0 flex-1 overflow-y-auto bg-[var(--oo-surface-0,var(--bg-primary))] px-10 pb-12 pt-8";
const closeClass = "absolute right-4 top-4 z-10 rounded-md p-1.5 text-[var(--oo-text-muted,var(--text-muted))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]";
const navHeaderClass = "mb-2 mt-6 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--oo-text-muted,var(--text-muted))] first:mt-0";
const navItemClass = "oo-prefs-nav-item flex h-28px w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]";
const navItemActiveClass = "bg-[var(--oo-accent-muted,var(--bg-active))] text-[var(--oo-text-primary,var(--text-primary))]";
const sectionClass = "mx-auto max-w-[740px]";
const groupTitleClass = "mb-4 mt-7 text-[15px] font-semibold text-[var(--oo-text-primary,var(--text-primary))] first:mt-0";
const cardClass = "oo-prefs-card overflow-hidden rounded-xl border border-[var(--oo-border-subtle,transparent)] bg-[var(--oo-surface-2,var(--bg-elevated))] px-5";
const rowClass = "oo-prefs-row flex min-h-[72px] items-center justify-between gap-6 border-b border-[var(--oo-border-subtle,var(--divider-color))] py-4 last:border-b-0";
const rowInfoClass = "min-w-0 flex-1";
const rowTitleClass = "text-[15px] font-medium leading-snug text-[var(--oo-text-primary,var(--text-primary))]";
const rowDescClass = "mt-1 text-[12.5px] leading-[1.4] text-[var(--oo-text-muted,var(--text-muted))]";
const controlClass = "flex shrink-0 items-center gap-2";
const buttonClass = "rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 py-1.5 text-[13px] text-[var(--oo-text-primary,var(--text-primary))] hover:bg-[var(--bg-hover)]";
const primaryButtonClass = "rounded-md border border-transparent bg-[var(--oo-accent,var(--color-accent))] px-3 py-1.5 text-[13px] font-medium text-[var(--oo-accent-on,var(--text-on-accent))] hover:bg-[var(--oo-accent-hover,var(--color-accent-1))]";
const selectClass = "settings-select h-8 min-w-[130px] rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 pr-8 text-[13px] text-[var(--oo-text-primary,var(--text-primary))] outline-none transition-colors focus:border-[var(--oo-accent,var(--border-strong))]";
const inputClass = "h-8 min-w-[220px] rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 text-[13px] text-[var(--oo-text-primary,var(--text-primary))] outline-none placeholder:text-[var(--oo-text-faint,var(--text-faint))] focus:border-[var(--oo-accent,var(--color-accent))]";
const textareaClass = "min-h-24 w-full rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 py-2 font-mono text-[12px] text-[var(--oo-text-primary,var(--text-primary))] outline-none";
const toggleClass = "relative inline-flex h-[22px] w-10 cursor-pointer items-center rounded-full border transition-colors";
const toggleThumbClass = "absolute left-[2px] h-[18px] w-[18px] rounded-full shadow transition-transform data-[checked=true]:translate-x-[18px]";
const rangeClass = "settings-range w-28";
const kbdClass = "rounded bg-[var(--oo-surface-3,var(--bg-tertiary))] px-2 py-1 font-mono text-[12px] text-[var(--oo-text-secondary,var(--text-secondary))]";
const settingsPageStyle = `
  .settings-select {
    appearance: none;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
      linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
    background-position:
      calc(100% - 15px) 50%,
      calc(100% - 10px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }
  .theme-dark .settings-select {
    color-scheme: dark;
  }
  .theme-light .settings-select {
    color-scheme: light;
  }
  .settings-select option {
    background-color: var(--bg-elevated);
    color: var(--text-primary);
  }
  .settings-select option:checked {
    background-color: var(--bg-active);
    color: var(--text-primary);
  }
  /* 6d: empty active-section filter (no matching SettingRows / panels) */
  .oo-prefs-content[data-prefs-filtering="true"]:not(:has([data-prefs-row])):not(:has([data-prefs-panel])) .oo-prefs-empty-filter {
    display: block;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .settings-range {
    height: 18px;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
    outline: none;
    touch-action: none;
  }
  .settings-range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-accent) 72%, var(--text-primary)) 0%,
      color-mix(in srgb, var(--color-accent) 72%, var(--text-primary)) var(--range-progress, 0%),
      var(--border-medium) var(--range-progress, 0%),
      var(--border-medium) 100%
    );
    transition: background-color 120ms ease;
  }
  .settings-range::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border: 1px solid color-mix(in srgb, var(--text-primary) 32%, transparent);
    border-radius: 999px;
    background: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
    cursor: grab;
    transition: transform 80ms ease, border-color 120ms ease, background-color 120ms ease;
  }
  .settings-range:hover::-webkit-slider-thumb,
  .settings-range:focus-visible::-webkit-slider-thumb {
    transform: scale(1.08);
    border-color: color-mix(in srgb, var(--color-accent) 70%, var(--text-primary));
  }
  .settings-range:active::-webkit-slider-thumb {
    cursor: grabbing;
    transform: scale(1.14);
  }
  .settings-range::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: var(--border-medium);
  }
  .settings-range::-moz-range-progress {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 72%, var(--text-primary));
  }
  .settings-range::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 1px solid color-mix(in srgb, var(--text-primary) 32%, transparent);
    border-radius: 999px;
    background: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
    cursor: grab;
    transition: transform 80ms ease, border-color 120ms ease, background-color 120ms ease;
  }
  .settings-range:active::-moz-range-thumb {
    cursor: grabbing;
    transform: scale(1.14);
  }
`;

/** Preferences search query (MVP 6d). Empty string = no filter. */
const PrefsSearchContext = createContext("");

function prefsNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(prefsNodeText).join(" ");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return prefsNodeText(props.children);
  }
  return "";
}

function matchesPrefsQuery(
  title: ReactNode,
  description: ReactNode | undefined,
  query: string,
): boolean {
  if (!query) return true;
  const haystack = `${prefsNodeText(title)} ${prefsNodeText(description)}`.toLowerCase();
  return haystack.includes(query);
}

function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const prefsQuery = useContext(PrefsSearchContext).trim().toLowerCase();
  const childList = React.Children.toArray(children);
  const titleMatches = Boolean(title && prefsQuery && title.toLowerCase().includes(prefsQuery));

  let visibleChildren: React.ReactNode = children;
  if (prefsQuery && !titleMatches) {
    const matchingRows: React.ReactElement[] = [];
    const chrome: React.ReactElement[] = [];
    for (const child of childList) {
      if (!React.isValidElement(child)) continue;
      const props = child.props as { title?: ReactNode; description?: ReactNode };
      if (!("title" in props) || props.title === undefined) {
        chrome.push(child);
        continue;
      }
      if (matchesPrefsQuery(props.title, props.description, prefsQuery)) {
        matchingRows.push(child);
      }
    }
    // Drop orphan status/chrome when no rows match this group.
    visibleChildren = matchingRows.length > 0 ? [...matchingRows, ...chrome] : [];
  }

  const filteredEmpty =
    prefsQuery &&
    !titleMatches &&
    Array.isArray(visibleChildren) &&
    visibleChildren.length === 0;

  if (filteredEmpty) {
    return null;
  }

  return (
    <section data-prefs-group={title || undefined}>
      {title && <h3 className={groupTitleClass}>{title}</h3>}
      <div className={cardClass}>
        {prefsQuery && !titleMatches ? visibleChildren : children}
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={rowClass} data-prefs-row="">
      <div className={rowInfoClass}>
        <div className={rowTitleClass}>{title}</div>
        {description && <div className={rowDescClass}>{description}</div>}
      </div>
      {children && <div className={controlClass}>{children}</div>}
    </div>
  );
}

function rangeProgressStyle(value: number, min: number, max: number): React.CSSProperties {
  const progress = max <= min ? 0 : ((value - min) / (max - min)) * 100;
  return {
    "--range-progress": `${Math.max(0, Math.min(100, progress))}%`,
  } as React.CSSProperties;
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={cx(toggleClass, disabled && "cursor-not-allowed opacity-50")}
      data-checked={checked}
      style={{
        backgroundColor: checked ? "var(--accent-primary, var(--color-accent, var(--oo-accent, #E8A84A)))" : "var(--bg-tertiary)",
        borderColor: checked ? "var(--border-strong)" : "var(--border-medium)",
        boxShadow: checked ? "inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 14%, transparent)" : "none",
      }}
      onClick={() => !disabled && onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
    >
      <span
        className={toggleThumbClass}
        data-checked={checked}
        style={{
          backgroundColor: checked ? "var(--text-on-accent, #ffffff)" : "var(--text-primary)",
        }}
      />
    </button>
  );
}

function StatusLine({ type, message }: { type: "success" | "error" | "info" | "idle"; message: React.ReactNode }) {
  if (!message) return null;
  const color = type === "success" ? "text-[var(--success)]" : type === "error" ? "text-[var(--danger)]" : "text-[var(--text-muted)]";
  return (
    <div className={cx("mt-2 flex items-center gap-1.5 text-[12.5px]", color)}>
      {type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
      <span>{message}</span>
    </div>
  );
}

export function SettingsPage({
  settings,
  onSettingsChange,
  onClose,
  commands = [],
  plugins = [],
  pluginSettingTabs = [],
  onEnablePlugin,
  onDisablePlugin,
  onRefreshPlugins,
  onReloadPlugin,
  onUninstallPlugin,
  onInstallPlugin,
  vaultPath,
  onVaultReconstructed,
  initialSection,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection || "general");
  const [localSettings, setLocalSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, ...settings });
  const [customThemeDraft, setCustomThemeDraft] = useState(() => ({
    accentColor: settings.accentColor,
    customBgPrimary: settings.customBgPrimary,
    customTextPrimary: settings.customTextPrimary,
  }));
  const [isBrowsingPlugins, setIsBrowsingPlugins] = useState(false);
  const [searchHotkey, setSearchHotkey] = useState("");
  /** Preferences search (6d MVP): nav + active-section rows + jump-to-section. */
  const [prefsSearch, setPrefsSearch] = useState("");
  const [currentUser, setCurrentUser] = useState(authManager.getUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"login" | "signup">("login");
  const [updateStatus, setUpdateStatus] = useState<React.ReactNode>("");
  const [updateType, setUpdateType] = useState<"success" | "error" | "info" | "idle">("info");
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadSettings());
  const [store, setStore] = useState(() => loadStore());
  const indexedCount = store.entries.size;

  const [databaseConfig, setDatabaseConfig] = useState<UserDatabaseConfig>(() => (
    loadSavedUserDatabaseConfig() ||
    getUserDatabaseConfig() || {
      supabaseUrl: "",
      anonKey: "",
    }
  ));
  const [databaseEnvText, setDatabaseEnvText] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState<{ type: "idle" | "success" | "error" | "info"; message: string }>(() => (
    loadSavedUserDatabaseConfig()
      ? { type: "success", message: "Saved local Supabase credentials are active." }
      : { type: "idle", message: "" }
  ));
  const [databaseSchemaCopyStatus, setDatabaseSchemaCopyStatus] = useState<{ type: "idle" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const [isTestingDatabase, setIsTestingDatabase] = useState(false);

  const isDark = isDarkTheme(localSettings.theme, localSettings);
  const models = getModelsForProvider(aiSettings.provider);
  const matchedModel = models.find((m) => m.id === aiSettings.modelId);
  const isCustomModel = !matchedModel && aiSettings.provider === "openrouter";
  const customModelInputValue = aiSettings.provider === "openrouter"
    ? (isCustomModel ? aiSettings.modelId : aiSettings.customModelId || "")
    : "";
  const trimmedCustomModelInput = customModelInputValue.trim();
  const isCustomModelSelected = isCustomModel && !!trimmedCustomModelInput && aiSettings.modelId === trimmedCustomModelInput;
  const customModelDescription = isCustomModelSelected
    ? "Active custom OpenRouter model."
    : trimmedCustomModelInput
      ? "Saved custom model. Select it to make it active."
      : "Use any other OpenRouter model by entering its ID.";
  const currentModel = matchedModel || (isCustomModel ? {
    id: aiSettings.modelId,
    label: aiSettings.modelId,
    shortLabel: aiSettings.modelId.split("/").pop() || aiSettings.modelId,
    description: "Custom OpenRouter Model",
    supportsGrounding: false,
  } : models[0]);

  useEffect(() => {
    const unsub = authManager.subscribe((state) => setCurrentUser(state.user));
    return unsub;
  }, []);

  useEffect(() => {
    setLocalSettings({ ...DEFAULT_SETTINGS, ...settings });
  }, [settings]);

  useEffect(() => {
    setCustomThemeDraft({
      accentColor: localSettings.accentColor,
      customBgPrimary: localSettings.customBgPrimary,
      customTextPrimary: localSettings.customTextPrimary,
    });
  }, [localSettings.accentColor, localSettings.customBgPrimary, localSettings.customTextPrimary]);

  useEffect(() => {
    if (activeSection !== "ai") return;
    const interval = setInterval(() => setStore(loadStore()), 3000);
    return () => clearInterval(interval);
  }, [activeSection]);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
    onSettingsChange(updated);
  };

  const updateCustomThemeDraft = (key: CustomThemeColorKey, value: string) => {
    setCustomThemeDraft((current) => ({ ...current, [key]: value }));
    if (!value) return;
    setLocalSettings((current) => {
      if (current[key] === value) return current;
      const updated = { ...current, [key]: value };
      onSettingsChange(updated);
      return updated;
    });
  };

  const commitCustomThemeColor = (key: CustomThemeColorKey, value: string) => {
    if (!value || localSettings[key] === value) return;
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
    onSettingsChange(updated);
  };

  const updateAISettings = (patch: Partial<AISettings>) => {
    setAiSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
    window.dispatchEvent(new Event("ai-settings-changed"));
  };

  const normalizedDatabaseConfig = (): UserDatabaseConfig => ({
    supabaseUrl: databaseConfig.supabaseUrl.trim(),
    anonKey: databaseConfig.anonKey.trim(),
  });

  const handleImportDatabaseEnv = () => {
    const parsed = parseSupabaseEnv(databaseEnvText);
    if (!parsed.supabaseUrl && !parsed.anonKey) {
      setDatabaseStatus({ type: "error", message: "Could not find VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in that text." });
      return;
    }
    setDatabaseConfig((current) => ({
      supabaseUrl: parsed.supabaseUrl || current.supabaseUrl,
      anonKey: parsed.anonKey || current.anonKey,
    }));
    setDatabaseStatus({ type: "info", message: "Imported credentials. Save to activate them." });
  };

  const handleTestDatabaseConnection = async () => {
    const config = normalizedDatabaseConfig();
    if (!config.supabaseUrl || !config.anonKey) {
      setDatabaseStatus({ type: "error", message: "Supabase URL and anon key are required." });
      return;
    }
    setIsTestingDatabase(true);
    setDatabaseStatus({ type: "info", message: "Testing Supabase connection..." });
    try {
      const result = await testConnection(config);
      setDatabaseStatus(result.ok ? { type: "success", message: "Connection verified." } : { type: "error", message: result.error || "Connection failed." });
    } finally {
      setIsTestingDatabase(false);
    }
  };

  const handleSaveDatabaseConfig = async () => {
    const config = normalizedDatabaseConfig();
    if (!config.supabaseUrl || !config.anonKey) {
      setDatabaseStatus({ type: "error", message: "Supabase URL and anon key are required." });
      return;
    }
    try {
      // Configure the Supabase client FIRST so it is already pointing at the
      // new credentials when saveUserDatabaseConfig fires the config-changed
      // event (which triggers authManager.refreshConfiguration internally).
      configureSupabaseClient(config);
      const saved = saveUserDatabaseConfig(config);
      connectUserDatabase(saved);
      await authManager.refreshConfiguration();
      setDatabaseConfig(saved);
      setDatabaseStatus({ type: "success", message: "Saved locally. Cloud features now use these credentials." });
    } catch (err: any) {
      setDatabaseStatus({ type: "error", message: err.message || "Failed to save database credentials." });
    }
  };

  const handleClearDatabaseConfig = async () => {
    clearSavedUserDatabaseConfig();
    disconnectUserDatabase();
    configureSupabaseClient();
    await authManager.refreshConfiguration();
    setDatabaseConfig({ supabaseUrl: "", anonKey: "" });
    setDatabaseEnvText("");
    setDatabaseStatus({ type: "info", message: "Local Supabase credentials cleared." });
  };

  const handleCopyDatabaseSchema = async () => {
    try {
      await getAPI().writeClipboardText(databaseSchemaSql);
      setDatabaseSchemaCopyStatus({ type: "success", message: "Copied schema.sql migration to clipboard." });
    } catch {
      setDatabaseSchemaCopyStatus({ type: "error", message: "Failed to copy migration SQL." });
    }
  };

  const handleCheckForUpdates = async () => {
    if (isCheckingUpdates) return;
    setIsCheckingUpdates(true);
    setUpdateType("info");
    setUpdateStatus("Checking for updates...");

    try {
      const response = await fetch("https://api.github.com/repos/OpenOnyx/OpenOnyx/releases/latest");
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Repository not found (HTTP 404). If the GitHub repository is private, the update checker cannot access it.");
        }
        throw new Error(`Failed to fetch release info (HTTP ${response.status}).`);
      }
      const data = await response.json();
      const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, "") : "";

      if (!latestVersion) {
        setUpdateType("error");
        setUpdateStatus("Could not determine the latest version from GitHub.");
        return;
      }

      // Semantic version comparison
      const currentVersion = APP_VERSION;
      const currentParts = currentVersion.split(".").map(Number);
      const latestParts = latestVersion.split(".").map(Number);

      let isNewer = false;
      for (let i = 0; i < 3; i++) {
        const latestPart = latestParts[i] || 0;
        const currentPart = currentParts[i] || 0;
        if (latestPart > currentPart) {
          isNewer = true;
          break;
        } else if (latestPart < currentPart) {
          break;
        }
      }

      if (isNewer) {
        // Detect OS platform to recommend the right asset
        const userAgent = navigator.userAgent.toLowerCase();
        let targetExt = "";
        let targetName = "";

        if (userAgent.includes("win")) {
          targetExt = ".exe";
          targetName = "Windows Installer (.exe)";
        } else if (userAgent.includes("mac")) {
          targetExt = ".dmg";
          targetName = "macOS Disk Image (.dmg)";
        } else if (userAgent.includes("linux")) {
          // On Linux, prefer .pkg.tar.zst for Arch, or .AppImage / .deb
          if (userAgent.includes("arch") || userAgent.includes("manjaro")) {
            targetExt = ".pkg.tar.zst";
            targetName = "Arch Linux Package (.pkg.tar.zst)";
          } else if (userAgent.includes("ubuntu") || userAgent.includes("debian")) {
            targetExt = ".deb";
            targetName = "Debian Package (.deb)";
          } else {
            targetExt = ".AppImage";
            targetName = "Linux AppImage (.AppImage)";
          }
        }

        // Search for a matching asset
        let matchedAsset = null;
        if (data.assets && Array.isArray(data.assets)) {
          if (targetExt) {
            matchedAsset = data.assets.find((asset: any) => asset.name.toLowerCase().endsWith(targetExt));
          }
          if (!matchedAsset && userAgent.includes("linux")) {
            matchedAsset = data.assets.find((asset: any) => asset.name.toLowerCase().endsWith(".appimage")) ||
              data.assets.find((asset: any) => asset.name.toLowerCase().endsWith(".deb")) ||
              data.assets.find((asset: any) => asset.name.toLowerCase().endsWith(".pkg.tar.zst"));
          }
        }

        const downloadUrl = matchedAsset ? matchedAsset.browser_download_url : data.html_url;
        const assetLabel = matchedAsset ? `Download ${targetName || matchedAsset.name}` : "Open Releases Page";

        setUpdateType("success");
        setUpdateStatus(
          <span className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span>New version v{latestVersion} is available!</span>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-link)] font-semibold underline hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1"
            >
              {assetLabel}
            </a>
          </span>
        );
      } else {
        setUpdateType("success");
        setUpdateStatus(`You are up to date! Version ${currentVersion} is the latest version.`);
      }
    } catch (err: any) {
      setUpdateType("error");
      setUpdateStatus(err.message || "Failed to check for updates. Rate limit or connection issue.");
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  // Preferences nav IA (PR 6b): section ids unchanged; labels + grouping only.
  type PrefsNavItem = {
    id: SettingsSection;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  };

  const workspaceSections: PrefsNavItem[] = [
    { id: "general", label: "General", icon: Settings },
    { id: "editor", label: "Editor", icon: Type },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "hotkeys", label: "Keyboard", icon: Keyboard },
  ];

  const filesSections: PrefsNavItem[] = [
    { id: "files", label: "Files & links", icon: FileText },
    { id: "templates", label: "Templates", icon: Copy },
    { id: "daily-notes", label: "Daily notes", icon: CalendarDays },
  ];

  const intelligenceSections: PrefsNavItem[] = [
    { id: "ai", label: "AI", icon: Brain },
    { id: "database", label: "Database", icon: Database },
  ];

  const modulesSections: PrefsNavItem[] = [
    { id: "core-plugins", label: "Built-in modules", icon: Puzzle },
    { id: "plugins", label: "Extensions", icon: Puzzle },
    { id: "backlinks", label: "Backlinks", icon: Link2 },
    { id: "canvas", label: "Canvas", icon: Grid2X2 },
    { id: "command-palette", label: "Command palette", icon: Terminal },
    { id: "page-preview", label: "Link previews", icon: Eye },
    { id: "quick-switcher", label: "Quick open", icon: Search },
  ];

  const accountSections: PrefsNavItem[] = [
    { id: "collaboration", label: "Collaboration", icon: Users },
    { id: "keychain", label: "Keychain", icon: KeyRound },
    { id: "about", label: "About", icon: Info },
  ];

  const allNavSections: PrefsNavItem[] = [
    ...workspaceSections,
    ...filesSections,
    ...intelligenceSections,
    ...modulesSections,
    ...accountSections,
  ];

  const prefsQuery = prefsSearch.trim().toLowerCase();

  const filterNavItems = (items: PrefsNavItem[]) => {
    if (!prefsQuery) return items;
    // Keep the active section visible so in-section row filtering remains usable
    // even when the section label itself does not match the query.
    return items.filter(
      (item) =>
        item.id === activeSection ||
        item.label.toLowerCase().includes(prefsQuery),
    );
  };

  const jumpSections = !prefsQuery
    ? ([] as PrefsNavItem[])
    : allNavSections.filter(
        (item) =>
          item.id !== activeSection &&
          item.label.toLowerCase().includes(prefsQuery),
      );

  const activeSectionLabel =
    allNavSections.find((item) => item.id === activeSection)?.label || activeSection;

  const commandRows = useMemo(() => {
    const baseCommands = commands.length > 0 ? commands : [
      { id: "new-note", label: "Create new note", shortcut: "Ctrl+N", action: () => { }, category: "Notes" },
      { id: "save", label: "Save current note", shortcut: "Ctrl+S", action: () => { }, category: "Notes" },
      { id: "search-file", label: "Find inside current note", shortcut: "Ctrl+F", action: () => { }, category: "Search" },
      { id: "search-vault", label: "Search all notes in vault", shortcut: "Ctrl+Shift+F", action: () => { }, category: "Search" },
      { id: "command-palette", label: "Open command palette", shortcut: "Ctrl+P", action: () => { }, category: "Command palette" },
    ];
    return baseCommands
      .map((cmd) => ({
        ...cmd,
        searchable: `${cmd.label} ${cmd.shortcut || "Blank"} ${cmd.category || ""}`.toLowerCase(),
      }))
      .filter((cmd) => cmd.searchable.includes(searchHotkey.toLowerCase()))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [commands, searchHotkey]);

  const renderNavSection = (items: PrefsNavItem[]) =>
    items.map((item) => (
      <button
        key={item.id}
        className={cx(navItemClass, activeSection === item.id && navItemActiveClass)}
        onClick={() => setActiveSection(item.id)}
      >
        <item.icon size={16} />
        <span>{item.label}</span>
      </button>
    ));

  const renderNavGroup = (label: string, items: PrefsNavItem[]) => {
    const filtered = filterNavItems(items);
    if (filtered.length === 0) return null;
    return (
      <>
        <div className={navHeaderClass}>{label}</div>
        {renderNavSection(filtered)}
      </>
    );
  };

  return (
    <div className={overlayClass}>
      <style>{settingsPageStyle}</style>
      <div className={pageClass}>
        {isBrowsingPlugins ? (
          <PluginMarketplace
            onClose={() => setIsBrowsingPlugins(false)}
            onInstall={onInstallPlugin || (async () => false)}
            installedPluginIds={plugins.map((p) => p.manifest.id)}
          />
        ) : (
          <PrefsSearchContext.Provider value={prefsSearch}>
          <>
            <button className={closeClass} onClick={onClose} aria-label="Close preferences">
              <X size={20} />
            </button>
            <aside className={sidebarClass}>
              <div className="mb-3 px-1 text-[13px] font-semibold tracking-tight text-[var(--oo-text-primary,var(--text-primary))]">
                Preferences
              </div>
              <div className="mb-4 px-1">
                <label className="sr-only" htmlFor="oo-prefs-search">
                  Search preferences
                </label>
                <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-2.5">
                  <Search size={15} className="shrink-0 text-[var(--oo-text-muted,var(--text-muted))]" />
                  <input
                    id="oo-prefs-search"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--oo-text-primary,var(--text-primary))] outline-none placeholder:text-[var(--oo-text-faint,var(--text-faint))]"
                    type="search"
                    value={prefsSearch}
                    onChange={(e) => setPrefsSearch(e.target.value)}
                    placeholder="Search preferences…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {prefsSearch && (
                    <button
                      type="button"
                      className="rounded p-0.5 text-[var(--oo-text-muted,var(--text-muted))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
                      onClick={() => setPrefsSearch("")}
                      aria-label="Clear preferences search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {jumpSections.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    <div className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--oo-text-muted,var(--text-muted))]">
                      Go to
                    </div>
                    {jumpSections.map((item) => (
                      <button
                        key={`jump-${item.id}`}
                        type="button"
                        className={cx(navItemClass, "text-[13px]")}
                        onClick={() => setActiveSection(item.id)}
                      >
                        <item.icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                {prefsQuery &&
                  filterNavItems(allNavSections).length === 0 &&
                  jumpSections.length === 0 && (
                    <p className="mt-2 px-0.5 text-[11px] leading-snug text-[var(--oo-text-muted,var(--text-muted))]">
                      No sections match “{prefsSearch.trim()}”.
                    </p>
                  )}
              </div>
              {renderNavGroup("Workspace", workspaceSections)}
              {renderNavGroup("Files", filesSections)}
              {renderNavGroup("Intelligence", intelligenceSections)}
              {renderNavGroup("Modules", modulesSections)}
              {renderNavGroup("Account", accountSections)}
            </aside>

            <main
              className={contentClass}
              data-prefs-section={activeSection}
              data-prefs-filtering={prefsQuery ? "true" : undefined}
            >
              {prefsQuery && (
                <p className="mx-auto mb-4 max-w-[740px] text-[12px] text-[var(--oo-text-muted,var(--text-muted))]">
                  Filtering <span className="font-medium text-[var(--oo-text-secondary,var(--text-secondary))]">{activeSectionLabel}</span>
                  {" "}for “{prefsSearch.trim()}”. Other matching sections appear under Go to.
                </p>
              )}
              <div
                className="oo-prefs-empty-filter mx-auto hidden max-w-[740px] rounded-xl border border-dashed border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-2,var(--bg-elevated))] px-5 py-8 text-center"
                role="status"
              >
                <p className="text-[13px] text-[var(--oo-text-secondary,var(--text-secondary))]">
                  No settings match “{prefsSearch.trim()}” in {activeSectionLabel}.
                </p>
                <p className="mt-1 text-[12px] text-[var(--oo-text-muted,var(--text-muted))]">
                  Try another phrase, clear search, or use Go to for other sections.
                </p>
              </div>
              {activeSection === "general" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow
                      title={`Version ${APP_VERSION}`}
                      description={(
                        <>
                          Installed version {APP_VERSION}.{" "}
                          <button className="text-[var(--text-link)] underline" onClick={() => setActiveSection("about")}>
                            View changelog
                          </button>
                          <StatusLine type={updateType} message={updateStatus} />
                        </>
                      )}
                    >
                      <button className={buttonClass} onClick={handleCheckForUpdates} disabled={isCheckingUpdates}>
                        {isCheckingUpdates ? "Checking..." : "Check for updates"}
                      </button>
                    </SettingRow>
                    <SettingRow title="Language" description="Interface language. More languages may be added later.">
                      <select className={selectClass} value={localSettings.language} onChange={(e) => updateSetting("language", e.target.value as AppSettings["language"])}>
                        <option>English</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="Help" description="Documentation and community resources for OpenOnyx.">
                      <button className={buttonClass} onClick={() => window.open("https://github.com/OpenOnyx/OpenOnyx", "_blank", "noopener,noreferrer")}>Open docs</button>
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Account">
                    <SettingRow
                      title="Your account"
                      description={currentUser ? <>Signed in as <strong>{currentUser.email}</strong>.</> : "Sign in to use optional cloud Spaces and collaboration features."}
                    >
                      {currentUser ? (
                        <button className={buttonClass} onClick={() => void authManager.signOut()}>Sign out</button>
                      ) : (
                        <>
                          <button className={buttonClass} onClick={() => { setAuthModalMode("login"); setShowAuthModal(true); }}>Sign in</button>
                          <button className={buttonClass} onClick={() => { setAuthModalMode("signup"); setShowAuthModal(true); }}>Create account</button>
                        </>
                      )}
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "editor" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Focus newly opened tabs" description="Switch to a tab as soon as you open a link in a new tab.">
                      <Toggle checked={localSettings.alwaysFocusNewTabs} onChange={(v) => updateSetting("alwaysFocusNewTabs", v)} />
                    </SettingRow>
                    <SettingRow title="Default tab view" description="How new Markdown tabs open: edit, read, or split.">
                      <select className={selectClass} value={localSettings.defaultView} onChange={(e) => updateSetting("defaultView", e.target.value as AppSettings["defaultView"])}>
                        <option value="editor">Editor</option>
                        <option value="preview">Reading</option>
                        <option value="split">Split</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="Default editor mode" description="Live preview or raw source for new editing tabs.">
                      <select className={selectClass} value={localSettings.defaultEditingMode} onChange={(e) => updateSetting("defaultEditingMode", e.target.value as AppSettings["defaultEditingMode"])}>
                        <option value="live-preview">Live preview</option>
                        <option value="source">Source</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="Show editor mode in status strip" description="Show the edit/read mode indicator in the status strip.">
                      <Toggle checked={localSettings.showEditingModeStatusBar} onChange={(v) => updateSetting("showEditingModeStatusBar", v)} />
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Display">
                    <SettingRow title="Comfortable line width" description="Limit line width for long-form reading. Less text fits on screen, but paragraphs are easier to scan.">
                      <Toggle checked={localSettings.readableLineLength} onChange={(v) => updateSetting("readableLineLength", v)} />
                    </SettingRow>
                    <SettingRow title="Line width" description="Maximum content width when comfortable line width is on.">
                      <input className={rangeClass} type="range" min={640} max={1180} step={1} value={localSettings.readingViewWidth} style={rangeProgressStyle(localSettings.readingViewWidth, 640, 1180)} onChange={(e) => updateSetting("readingViewWidth", Number(e.target.value))} />
                      <span className="w-14 text-right text-xs text-[var(--text-muted)]">{localSettings.readingViewWidth}px</span>
                    </SettingRow>
                    <SettingRow title="Preserve single line breaks" description="Keep single newlines in reading view instead of collapsing them.">
                      <Toggle checked={localSettings.strictLineBreaks} onChange={(v) => updateSetting("strictLineBreaks", v)} />
                    </SettingRow>
                    <SettingRow title="Properties display" description="How note properties appear at the top of the document.">
                      <select className={selectClass} value={localSettings.propertiesInDocument} onChange={(e) => updateSetting("propertiesInDocument", e.target.value as AppSettings["propertiesInDocument"])}>
                        <option value="visible">Visible</option>
                        <option value="hidden">Hidden</option>
                        <option value="source">Source</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="Collapsible headings" description="Fold or expand content under each heading.">
                      <Toggle checked={localSettings.foldHeading} onChange={(v) => updateSetting("foldHeading", v)} />
                    </SettingRow>
                    <SettingRow title="Line numbers" description="Show line numbers in the editor gutter.">
                      <Toggle checked={localSettings.showLineNumbers} onChange={(v) => updateSetting("showLineNumbers", v)} />
                    </SettingRow>
                    <SettingRow title="Indentation guides" description="Show vertical guides for nested lists and blocks.">
                      <Toggle checked={localSettings.indentationGuides} onChange={(v) => updateSetting("indentationGuides", v)} />
                    </SettingRow>
                    <SettingRow title="Right-to-left (RTL)" description="Default note text direction is right-to-left.">
                      <Toggle checked={localSettings.rightToLeft} onChange={(v) => updateSetting("rightToLeft", v)} />
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Typing & behavior">
                    <SettingRow title="Spellcheck" description="Underline spelling suggestions while editing.">
                      <Toggle checked={localSettings.spellcheck} onChange={(v) => updateSetting("spellcheck", v)} />
                    </SettingRow>
                    <SettingRow title="Auto-pair brackets" description="Insert matching brackets and quotes as you type.">
                      <Toggle checked={localSettings.autoPairBrackets} onChange={(v) => updateSetting("autoPairBrackets", v)} />
                    </SettingRow>
                    <SettingRow title="Auto-pair Markdown marks" description="Pair formatting marks for bold, italic, code, and similar syntax.">
                      <Toggle checked={localSettings.autoPairMarkdown} onChange={(v) => updateSetting("autoPairMarkdown", v)} />
                    </SettingRow>
                    <SettingRow title="Indent with tabs" description="Insert a tab character when you press Tab.">
                      <Toggle checked={localSettings.indentUsingTabs} onChange={(v) => updateSetting("indentUsingTabs", v)} />
                    </SettingRow>
                    <SettingRow title="Tab display width" description="How many spaces wide a tab character appears.">
                      <input className={rangeClass} type="range" min={2} max={8} step={1} value={localSettings.tabSize} style={rangeProgressStyle(localSettings.tabSize, 2, 8)} onChange={(e) => updateSetting("tabSize", Number(e.target.value))} />
                      <span className="w-8 text-right text-xs text-[var(--text-muted)]">{localSettings.tabSize}</span>
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Advanced">
                    <SettingRow title="Vim key bindings" description="Enable Vim-style keys in the editor.">
                      <Toggle checked={localSettings.vimMode} onChange={(v) => updateSetting("vimMode", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "files" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Startup file" description="What opens when you launch OpenOnyx with a vault.">
                      <select className={selectClass} value={localSettings.defaultFileToOpen} onChange={(e) => updateSetting("defaultFileToOpen", e.target.value as AppSettings["defaultFileToOpen"])}>
                        <option value="last-opened">Last opened note</option>
                        <option value="new-tab">Empty new tab</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="New note location" description="Folder used when you create a new note.">
                      <select className={selectClass} value={localSettings.defaultNoteLocation} onChange={(e) => updateSetting("defaultNoteLocation", e.target.value as AppSettings["defaultNoteLocation"])}>
                        <option value="vault">Vault root</option>
                        <option value="same-folder">Same folder as the active file</option>
                      </select>
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Links">
                    <SettingRow title="Update links after rename" description="Offer to rewrite links when a file is renamed.">
                      <Toggle checked={localSettings.autoUpdateInternalLinks} onChange={(v) => updateSetting("autoUpdateInternalLinks", v)} />
                    </SettingRow>
                    <SettingRow title="Prefer wiki-style links" description="Create [[wiki links]] instead of standard Markdown links when possible.">
                      <Toggle checked={localSettings.useWikiLinks} onChange={(v) => updateSetting("useWikiLinks", v)} />
                    </SettingRow>
                    <SettingRow title="Show non-Markdown files" description="List all file types in the explorer and quick open.">
                      <Toggle checked={localSettings.showAllFileTypes} onChange={(v) => updateSetting("showAllFileTypes", v)} />
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Deletion">
                    <SettingRow title="Confirm file deletion" description="Ask before deleting files from the vault.">
                      <Toggle checked={localSettings.confirmBeforeDelete} onChange={(v) => updateSetting("confirmBeforeDelete", v)} />
                    </SettingRow>
                    <SettingRow title="After delete" description="Where deleted files go.">
                      <select className={selectClass} value={localSettings.deletedFilesMode} onChange={(e) => updateSetting("deletedFilesMode", e.target.value as AppSettings["deletedFilesMode"])}>
                        <option value="system-trash">System trash</option>
                        <option value="app-trash">App trash</option>
                        <option value="permanent">Delete permanently</option>
                      </select>
                    </SettingRow>
                  </SettingGroup>

                </div>
              )}

              {activeSection === "appearance" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Theme" description="Color theme for the OpenOnyx workspace.">
                      <select className={selectClass} value={localSettings.theme} onChange={(e) => updateSetting("theme", e.target.value as AppSettings["theme"])}>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="system">Match system</option>
                        <option value="dark-plus">Dark+</option>
                        <option value="blue-night">Blue Night</option>
                        <option value="oceanic">Oceanic</option>
                        <option value="ember-night">Ember Night</option>
                        <option value="aurora-grove">Aurora Grove</option>
                        <option value="paper-sage">Paper Sage</option>
                        <option value="rose-quartz">Rose Quartz</option>
                        <option value="custom">Custom</option>
                      </select>
                    </SettingRow>
                    {localSettings.theme === "custom" && (
                      <>
                        <SettingRow title="Custom theme mode" description="Treat the custom theme as dark or light for assets and contrast.">
                          <select className={selectClass} value={localSettings.customThemeType || "dark"} onChange={(e) => updateSetting("customThemeType", e.target.value as "dark" | "light")}>
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                          </select>
                        </SettingRow>
                        <SettingRow title="Accent color" description="Highlight color for selection, focus, and primary actions.">
                          <input
                            type="color"
                            className="h-8 w-10 rounded border border-[var(--border-medium)] bg-transparent"
                            value={customThemeDraft.accentColor}
                            onInput={(e) => updateCustomThemeDraft("accentColor", e.currentTarget.value)}
                            onBlur={(e) => commitCustomThemeColor("accentColor", e.currentTarget.value)}
                            onPointerUp={(e) => commitCustomThemeColor("accentColor", e.currentTarget.value)}
                            onKeyUp={(e) => {
                              if (e.key === "Enter") commitCustomThemeColor("accentColor", e.currentTarget.value);
                            }}
                          />
                        </SettingRow>
                        <SettingRow title="Background color">
                          <input
                            type="color"
                            className="h-8 w-10 rounded border border-[var(--border-medium)] bg-transparent"
                            value={customThemeDraft.customBgPrimary}
                            onInput={(e) => updateCustomThemeDraft("customBgPrimary", e.currentTarget.value)}
                            onBlur={(e) => commitCustomThemeColor("customBgPrimary", e.currentTarget.value)}
                            onPointerUp={(e) => commitCustomThemeColor("customBgPrimary", e.currentTarget.value)}
                            onKeyUp={(e) => {
                              if (e.key === "Enter") commitCustomThemeColor("customBgPrimary", e.currentTarget.value);
                            }}
                          />
                        </SettingRow>
                        <SettingRow title="Text color">
                          <input
                            type="color"
                            className="h-8 w-10 rounded border border-[var(--border-medium)] bg-transparent"
                            value={customThemeDraft.customTextPrimary}
                            onInput={(e) => updateCustomThemeDraft("customTextPrimary", e.currentTarget.value)}
                            onBlur={(e) => commitCustomThemeColor("customTextPrimary", e.currentTarget.value)}
                            onPointerUp={(e) => commitCustomThemeColor("customTextPrimary", e.currentTarget.value)}
                            onKeyUp={(e) => {
                              if (e.key === "Enter") commitCustomThemeColor("customTextPrimary", e.currentTarget.value);
                            }}
                          />
                        </SettingRow>
                      </>
                    )}
                  </SettingGroup>

                  <SettingGroup title="Chrome">
                    <SettingRow title="Show activity rail" description="Show the vertical activity rail on the side of the window.">
                      <Toggle checked={localSettings.showRibbon} onChange={(v) => updateSetting("showRibbon", v)} />
                    </SettingRow>
                    <SettingRow title="Activity rail actions" description="Manage built-in modules that appear as rail actions.">
                      <button className={buttonClass} onClick={() => setActiveSection("core-plugins")}>Manage</button>
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Typography">
                    <SettingRow title="Interface font" description="Default typeface for the OpenOnyx interface.">
                      <select className={selectClass} value={localSettings.fontFamily} onChange={(e) => updateSetting("fontFamily", e.target.value)}>
                        <option value={'"IBM Plex Sans", system-ui, sans-serif'}>IBM Plex Sans</option>
                        <option value="Inter, system-ui, sans-serif">Inter</option>
                        <option value="'SF Pro Display', system-ui, sans-serif">SF Pro</option>
                        <option value="'Segoe UI', system-ui, sans-serif">Segoe UI</option>
                        <option value="Georgia, serif">Georgia</option>
                        <option value={'"IBM Plex Mono", monospace'}>IBM Plex Mono</option>
                        <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                      </select>
                    </SettingRow>
                    <SettingRow title="Font size" description="Base size for editing and reading views.">
                      <input className={rangeClass} type="range" min={12} max={24} value={localSettings.fontSize} style={rangeProgressStyle(localSettings.fontSize, 12, 24)} onChange={(e) => {
                        const value = Number(e.target.value);
                        const updated = { ...localSettings, fontSize: value, editorFontSize: value, previewFontSize: value };
                        setLocalSettings(updated);
                        onSettingsChange(updated);
                      }} />
                      <span className="w-10 text-right text-xs text-[var(--text-muted)]">{localSettings.fontSize}px</span>
                    </SettingRow>
                    <SettingRow title="Pinch / Ctrl+scroll font size" description="Change font size with Ctrl+scroll or trackpad pinch.">
                      <Toggle checked={localSettings.quickFontSizeAdjustment} onChange={(v) => updateSetting("quickFontSizeAdjustment", v)} />
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Advanced">
                    <SettingRow title="Zoom level" description="Scale the entire application UI.">
                      <input className={rangeClass} type="range" min={80} max={140} value={localSettings.zoomLevel} style={rangeProgressStyle(localSettings.zoomLevel, 80, 140)} onChange={(e) => updateSetting("zoomLevel", Number(e.target.value))} />
                      <span className="w-10 text-right text-xs text-[var(--text-muted)]">{localSettings.zoomLevel}%</span>
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "hotkeys" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Filter commands" description={`Showing ${commandRows.length} commands.`}>
                      <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3">
                        <Search size={16} className="text-[var(--text-muted)]" />
                        <input className="w-52 bg-transparent text-sm outline-none placeholder:text-[var(--text-faint)]" value={searchHotkey} onChange={(e) => setSearchHotkey(e.target.value)} placeholder="Filter..." />
                      </div>
                    </SettingRow>
                    {commandRows.map((cmd) => (
                      <SettingRow key={cmd.id} title={cmd.category ? `${cmd.category}: ${cmd.label}` : cmd.label}>
                        <span className={kbdClass}>{cmd.shortcut || "Blank"}</span>
                      </SettingRow>
                    ))}
                  </SettingGroup>
                </div>
              )}

              {activeSection === "keychain" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="AI credentials" description="Provider API keys stored locally in this app profile.">
                      <button className={buttonClass} onClick={() => setActiveSection("ai")}>Manage</button>
                    </SettingRow>
                    <SettingRow title="Database credentials" description="Supabase URL and anon key stored locally when configured.">
                      <button className={buttonClass} onClick={() => setActiveSection("database")}>Manage</button>
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "core-plugins" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Backlinks" description="Show notes that link to the active note.">
                      <Toggle checked={localSettings.coreBacklinks} onChange={(v) => updateSetting("coreBacklinks", v)} />
                    </SettingRow>
                    <SettingRow title="Canvas" description="Create visual boards with notes, cards, and media.">
                      <Toggle checked={localSettings.coreCanvas} onChange={(v) => updateSetting("coreCanvas", v)} />
                    </SettingRow>
                    <SettingRow title="Command palette" description="Run any command from a searchable palette.">
                      <Toggle checked={localSettings.coreCommandPalette} onChange={(v) => updateSetting("coreCommandPalette", v)} />
                    </SettingRow>
                    <SettingRow title="Daily notes" description="Create a note for today's date with one action.">
                      <Toggle checked={localSettings.coreDailyNotes} onChange={(v) => updateSetting("coreDailyNotes", v)} />
                    </SettingRow>
                    <SettingRow title="Link previews" description="Preview linked notes and files on hover.">
                      <Toggle checked={localSettings.corePagePreview} onChange={(v) => updateSetting("corePagePreview", v)} />
                    </SettingRow>
                    <SettingRow title="Quick open" description="Jump to notes by name.">
                      <Toggle checked={localSettings.coreQuickSwitcher} onChange={(v) => updateSetting("coreQuickSwitcher", v)} />
                    </SettingRow>
                    <SettingRow title="Templates" description="Insert reusable Markdown templates into notes.">
                      <Toggle checked={localSettings.coreTemplates} onChange={(v) => updateSetting("coreTemplates", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "backlinks" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Open backlinks by default" description="Show the Backlinks panel when a note loads.">
                      <Toggle checked={localSettings.backlinksOpenByDefault} onChange={(v) => updateSetting("backlinksOpenByDefault", v)} />
                    </SettingRow>
                    <SettingRow title="Include unlinked mentions" description="Also list notes that mention this file name without a formal link.">
                      <Toggle checked={localSettings.backlinksShowUnlinked} onChange={(v) => updateSetting("backlinksShowUnlinked", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "canvas" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="New canvas location" description="Where new canvas files are created.">
                      <select className={selectClass} value={localSettings.canvasDefaultLocation} onChange={(e) => updateSetting("canvasDefaultLocation", e.target.value as AppSettings["canvasDefaultLocation"])}>
                        <option value="vault">Vault root</option>
                        <option value="same-folder">Same folder as the active file</option>
                      </select>
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "command-palette" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Enable command palette" description="Open with Ctrl+P to search app and extension commands.">
                      <Toggle checked={localSettings.coreCommandPalette} onChange={(v) => updateSetting("coreCommandPalette", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "daily-notes" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Daily note date format" description="How daily note file names are built from the date.">
                      <input className={inputClass} value={localSettings.dailyNoteDateFormat} onChange={(e) => updateSetting("dailyNoteDateFormat", e.target.value)} />
                    </SettingRow>
                    <SettingRow title="Daily note folder" description="Folder for new daily notes.">
                      <input className={inputClass} value={localSettings.dailyNoteLocation} onChange={(e) => updateSetting("dailyNoteLocation", e.target.value)} placeholder="e.g. Daily" />
                    </SettingRow>
                    <SettingRow title="Daily note template" description="Optional template note applied to new daily notes.">
                      <input className={inputClass} value={localSettings.dailyNoteTemplate} onChange={(e) => updateSetting("dailyNoteTemplate", e.target.value)} placeholder="e.g. Templates/Daily" />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "page-preview" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Require Ctrl for hover preview" description="Only show link previews while holding Ctrl (or Cmd).">
                      <Toggle checked={localSettings.pagePreviewRequireCtrl} onChange={(v) => updateSetting("pagePreviewRequireCtrl", v)} />
                    </SettingRow>
                    <SettingRow title="Previews in reading view" description="Allow link previews while reading.">
                      <Toggle checked={localSettings.pagePreviewReading} onChange={(v) => updateSetting("pagePreviewReading", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "quick-switcher" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Enable quick open" description="Use Ctrl+O to search and open notes.">
                      <Toggle checked={localSettings.coreQuickSwitcher} onChange={(v) => updateSetting("coreQuickSwitcher", v)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "templates" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Template folder" description="Folder that holds reusable Markdown templates.">
                      <input className={inputClass} value={localSettings.templatesFolder} onChange={(e) => updateSetting("templatesFolder", e.target.value)} />
                    </SettingRow>
                    <SettingRow title="Template date format" description="Format for {{date}} placeholders in templates.">
                      <input className={inputClass} value={localSettings.templateDateFormat} onChange={(e) => updateSetting("templateDateFormat", e.target.value)} />
                    </SettingRow>
                    <SettingRow title="Template time format" description="Format for {{time}} placeholders in templates.">
                      <input className={inputClass} value={localSettings.templateTimeFormat} onChange={(e) => updateSetting("templateTimeFormat", e.target.value)} />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "plugins" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Browse extensions" description="Find and install community extensions via the compatibility runtime.">
                      <button className={primaryButtonClass} onClick={() => setIsBrowsingPlugins(true)}>Browse</button>
                    </SettingRow>
                    <SettingRow title="Installed extensions" description={`You have ${plugins.length} extension${plugins.length === 1 ? "" : "s"} installed.`} />
                  </SettingGroup>
                  <div data-prefs-panel="">
                    <h3 className={groupTitleClass}>Installed extensions</h3>
                    <PluginSettingsPanel
                      plugins={plugins}
                      settingTabs={pluginSettingTabs}
                      onEnablePlugin={onEnablePlugin || (async () => { })}
                      onDisablePlugin={onDisablePlugin || (async () => { })}
                      onRefresh={onRefreshPlugins || (async () => { })}
                      onReloadPlugin={onReloadPlugin}
                      onUninstallPlugin={onUninstallPlugin}
                      onInstallPlugin={onInstallPlugin}
                      onBrowse={() => setIsBrowsingPlugins(true)}
                    />
                  </div>
                </div>
              )}

              {activeSection === "ai" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Provider" description="Remote AI provider used for advanced reasoning and writing tools.">
                      {AI_PROVIDER_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          className={cx(buttonClass, aiSettings.provider === preset.id && "border-[var(--color-accent)]")}
                          onClick={() => {
                            const nextKey = aiSettings.providerKeys?.[preset.id] || "";
                            const nextModels = getModelsForProvider(preset.id);
                            updateAISettings({
                              provider: preset.id,
                              apiKey: nextKey,
                              modelId: nextModels[0]?.id || DEFAULT_MODEL_ID,
                              providerKeys: { ...aiSettings.providerKeys, [aiSettings.provider]: aiSettings.apiKey },
                            });
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </SettingRow>
                    <SettingRow
                      title="API key"
                      description={(
                        <>
                          API key for the selected provider.{" "}
                          <a className="inline-flex items-center gap-1 text-[var(--text-link)] underline" href={AI_PROVIDER_PRESETS.find((p) => p.id === aiSettings.provider)?.keyUrl} target="_blank" rel="noopener noreferrer">
                            Get key <ExternalLink size={12} />
                          </a>
                        </>
                      )}
                    >
                      <input className={inputClass} type="password" value={aiSettings.apiKey} onChange={(e) => updateAISettings({ apiKey: e.target.value })} placeholder={AI_PROVIDER_PRESETS.find((p) => p.id === aiSettings.provider)?.keyPlaceholder} />
                    </SettingRow>
                  </SettingGroup>

                  <SettingGroup title="Models">
                    {models.map((model) => (
                      <SettingRow key={model.id} title={model.label} description={model.description}>
                        <button className={cx(buttonClass, aiSettings.modelId === model.id && "border-[var(--color-accent)]")} onClick={() => updateAISettings({ modelId: model.id })}>
                          {aiSettings.modelId === model.id ? "Selected" : "Select"}
                        </button>
                      </SettingRow>
                    ))}
                    {aiSettings.provider === "openrouter" && (
                      <SettingRow title="Custom model" description={customModelDescription}>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <input
                            className={inputClass}
                            value={customModelInputValue}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              updateAISettings(isCustomModel ? { modelId: nextValue, customModelId: nextValue } : { customModelId: nextValue });
                            }}
                            placeholder="e.g. deepseek/deepseek-v4-flash:free"
                          />
                          <button
                            className={cx(buttonClass, isCustomModelSelected && "border-[var(--color-accent)]")}
                            disabled={!trimmedCustomModelInput}
                            onClick={() => updateAISettings({ modelId: trimmedCustomModelInput, customModelId: trimmedCustomModelInput })}
                          >
                            {isCustomModelSelected ? "Selected" : "Select"}
                          </button>
                        </div>
                      </SettingRow>
                    )}
                  </SettingGroup>

                  <SettingGroup title="Status">
                    <SettingRow title="Local analysis engine" description="Background indexer and local embeddings store.">
                      <span className={cx("inline-flex items-center gap-1.5 text-[12.5px]", isModelLoaded() ? "text-[var(--success)]" : "text-[var(--text-muted)]")}>
                        {isModelLoaded() ? <Check size={14} /> : <AlertCircle size={14} />}
                        {isModelLoaded() ? `Running - ${indexedCount} notes indexed` : "Starts automatically on first note save"}
                      </span>
                    </SettingRow>
                    <SettingRow title="Remote LLM connection" description="Status of the configured remote model provider.">
                      <span className={cx("inline-flex items-center gap-1.5 text-[12.5px]", aiSettings.apiKey ? "text-[var(--success)]" : "text-[var(--text-muted)]")}>
                        {aiSettings.apiKey ? <Check size={14} /> : <AlertCircle size={14} />}
                        {aiSettings.apiKey ? `Connected: ${currentModel?.shortLabel || currentModel?.label}` : "No API key — local analysis still works"}
                      </span>
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "database" && (
                <div className={sectionClass}>
                  <SettingGroup>
                    <SettingRow title="Supabase URL" description="Project URL from your Supabase dashboard API settings.">
                      <input className={inputClass} value={databaseConfig.supabaseUrl} onChange={(e) => setDatabaseConfig((current) => ({ ...current, supabaseUrl: e.target.value }))} placeholder="https://project.supabase.co" />
                    </SettingRow>
                    <SettingRow title="Anon public key" description="Use the public anon key only. Never paste a service-role key.">
                      <input className={inputClass} type="password" value={databaseConfig.anonKey} onChange={(e) => setDatabaseConfig((current) => ({ ...current, anonKey: e.target.value }))} placeholder="eyJhbGciOi..." />
                    </SettingRow>
                  </SettingGroup>

                  {(!prefsQuery || matchesPrefsQuery("Import from .env", "environment variables VITE_SUPABASE", prefsQuery)) && (
                    <div data-prefs-row="">
                      <h3 className={groupTitleClass}>Import from .env</h3>
                      <textarea className={textareaClass} value={databaseEnvText} onChange={(e) => setDatabaseEnvText(e.target.value)} placeholder={"VITE_SUPABASE_URL=https://project.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOi..."} />
                      <div className="mt-3 flex justify-end">
                        <button className={buttonClass} onClick={handleImportDatabaseEnv}>Import values</button>
                      </div>
                    </div>
                  )}

                  <SettingGroup title="Schema migration">
                    <SettingRow title="Database setup SQL" description="Copy the bundled schema migration and run it in the Supabase SQL editor.">
                      <button className={cx(buttonClass, "inline-flex items-center gap-2")} onClick={handleCopyDatabaseSchema}>
                        <Copy size={14} /> Copy SQL
                      </button>
                    </SettingRow>
                    <div className="px-0 pb-3">
                      <StatusLine type={databaseSchemaCopyStatus.type === "idle" ? "info" : databaseSchemaCopyStatus.type} message={databaseSchemaCopyStatus.message} />
                    </div>
                  </SettingGroup>

                  <SettingGroup title="Local storage">
                    <SettingRow title="Saved credentials" description="Credentials are stored locally for this app and restored on startup.">
                      <button className={buttonClass} onClick={handleTestDatabaseConnection} disabled={isTestingDatabase}>{isTestingDatabase ? "Testing..." : "Test"}</button>
                      <button className={primaryButtonClass} onClick={handleSaveDatabaseConfig}>Save</button>
                      <button className={buttonClass} onClick={handleClearDatabaseConfig}>Clear</button>
                    </SettingRow>
                    <div className="px-0 pb-3">
                      <StatusLine type={databaseStatus.type} message={databaseStatus.message} />
                    </div>
                  </SettingGroup>
                </div>
              )}

              {activeSection === "collaboration" && (
                <div className={sectionClass} data-prefs-panel="">
                  <CollaborationPanel
                    vaultPath={vaultPath || null}
                    isSettingsMode={true}
                    onVaultReconstructed={onVaultReconstructed}
                    onGoToAccount={() => setActiveSection("general")}
                  />
                </div>
              )}

              {activeSection === "about" && (
                <div className={sectionClass} data-prefs-panel="">
                  <div className="flex flex-col items-center py-8">
                    {/* Logo container with static contrast background (no hover scale animation) */}
                    <div className={`mb-6 flex items-center justify-center p-4 rounded-2xl shadow-sm border ${isDark ? "bg-[#18181b] border-neutral-800/80" : "bg-white border-neutral-200/60"} h-24 w-24`}>
                      <img src={isDark ? "logos/logo-dark.png" : "logos/logo-light.png"} alt="OpenOnyx logo" className="h-full w-full object-contain" />
                    </div>

                    <h2 className="mb-1 text-2xl font-bold tracking-tight text-[var(--text-primary)]">OpenOnyx</h2>
                    <div className="mb-6 flex items-center gap-2">
                      <span className="rounded-full bg-[var(--bg-tertiary)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                        v{APP_VERSION}
                      </span>
                      <span className="rounded-full bg-[rgba(52,211,153,0.12)] px-2.5 py-0.5 text-[11px] font-semibold text-[#34d399] border border-[rgba(52,211,153,0.2)]">
                        Local-First
                      </span>
                    </div>

                    <p className="max-w-lg text-center text-sm leading-relaxed text-[var(--text-secondary)] mb-10">
                      A local-first knowledge studio for creating, linking, and exploring Markdown vaults.
                    </p>

                    <p className="max-w-xl text-center text-[12px] leading-relaxed text-[var(--text-muted)] mb-10 px-4">
                      OpenOnyx is an independent open-source project. It can open Markdown vault folders and optionally run community extensions through a compatibility runtime for interoperability. OpenOnyx is not affiliated with, endorsed by, or related to Obsidian or Dynalist Inc.
                    </p>

                    {/* Features Grid */}
                    <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3 mb-10">
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-center sm:text-left">
                        <h4 className="mb-1 text-[13px] font-semibold text-[var(--text-primary)]">Private by default</h4>
                        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">Notes stay on your device as plain Markdown files you control.</p>
                      </div>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-center sm:text-left">
                        <h4 className="mb-1 text-[13px] font-semibold text-[var(--text-primary)]">Linked knowledge</h4>
                        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">Explore connections across your vault as an interactive graph.</p>
                      </div>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-center sm:text-left">
                        <h4 className="mb-1 text-[13px] font-semibold text-[var(--text-primary)]">Works offline</h4>
                        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">Core workflows work offline. Sync only when you choose.</p>
                      </div>
                    </div>

                    {/* Community / Help Section */}
                    <div className="w-full max-w-2xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 mb-8">
                      <h4 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                        Resources
                      </h4>
                      <div className="flex items-center gap-6">
                        <a href="https://github.com/OpenOnyx/OpenOnyx" target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                          GitHub
                        </a>
                        <a href="https://github.com/OpenOnyx/OpenOnyx/wiki" target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                          Documentation
                        </a>
                        <a href="https://github.com/OpenOnyx/OpenOnyx/issues" target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                          Report an issue
                        </a>
                      </div>
                    </div>

                    {/* Factory reset button */}
                    <div className="w-full max-w-2xl border-t border-[var(--border-subtle)] pt-6 flex flex-col items-center gap-3">
                      <button className={cx(buttonClass, "inline-flex items-center border-dashed border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500/50")} onClick={() => onSettingsChange(DEFAULT_SETTINGS)}>
                        Reset preferences to defaults
                      </button>
                      <p className="text-[11px] text-[var(--text-muted)]">Restores all preferences to factory defaults. Vault files are not deleted.</p>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </>
          </PrefsSearchContext.Provider>
        )}
      </div>
      {showAuthModal && (
        <AuthModal
          initialMode={authModalMode}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
