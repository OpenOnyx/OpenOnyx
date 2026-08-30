/**
 * App - Root Application Component
 *
 * Manages the global application state including vault selection,
 * theme, active notes, and layout. Coordinates between all major
 * components via prop drilling (simple and predictable for this scale).
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
// Patch HTMLElement.prototype with Obsidian DOM helpers (must be before any plugin code)
import './lib/obsidian-api/dom-extensions';
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { Editor } from "./components/editor/Editor";
import { EditorHeader } from "./components/editor/EditorHeader";
import { FormattingToolbar } from "./components/layout/FormattingToolbar";
import { LeafPaneEditor } from "./components/layout/LeafPaneEditor";
import { NewTabView } from "./components/layout/NewTabView";
import { GraphView } from "./components/graph/GraphView";
import { AIKnowledgeGraph } from "./components/graph/AIKnowledgeGraph";
import { CanvasView } from "./components/canvas/CanvasView";
import { SearchModal } from "./components/modals/SearchModal";
import { BookmarkModal } from "./components/modals/BookmarkModal";
import { BookmarksPanel } from "./components/layout/BookmarksPanel";
import { CommandPalette } from "./components/modals/CommandPalette";
import { BacklinksPanel } from "./components/panels/BacklinksPanel";
import { RightSidebar, RightSidebarTabType } from "./components/layout/RightSidebar";
import { StatusBar } from "./components/layout/StatusBar";
import {
  WelcomeScreen,
  type VaultEntryAction,
  type VaultEntryTransitionPhase,
} from "./components/settings/WelcomeScreen";
import { VaultManager } from "./components/settings/VaultManager";
import { Modal } from "./components/modals/Modal";
import { Ribbon } from "./components/layout/Ribbon";
import { OutlinePane } from "./components/panels/OutlinePane";
import { TagPane } from "./components/panels/TagPane";
import { OutgoingLinksPanel } from "./components/panels/OutgoingLinksPanel";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import {
  SettingsPage,
  AppSettings,
  DEFAULT_SETTINGS,
} from "./components/settings/SettingsPage";
import { TemplateModal } from "./components/modals/TemplateModal";
import { UnlinkedMentionsPanel } from "./components/panels/UnlinkedMentionsPanel";
import { AIPage } from "./components/ai/AIPage";
import { SpacesPage } from "./components/spaces/SpacesPage";
import { DatabaseView } from "./components/settings/DatabaseView";
import {
  embedNote,
  loadStore,
  removeEmbedding,
  renameEmbeddingPath,
  renameEmbeddingsByPrefix,
  removeEmbeddingsByPrefix,
  findSimilar,
  applyHistoryWeighting,
  loadSuggestionHistory,
  loadTransitionMap,
  recordSuggestion,
  recordIgnoredSuggestions,
  getTransitionBoost,
  recordTransition,
  resetEmbeddingsStore,
  areEmbeddingsAvailable,
  type EmbeddingStore,
} from "./utils/embeddings";
import { getAnnotation, getCachedAnnotation, generateFirstThoughtExpansion } from "./utils/ai-core";
import { initializeVault, setQueueStatusCallback, resetQueueState, type QueueStatus } from "./utils/background-queue";
import { type LinkType } from "./components/ai/SuggestionBanner";
import { enrichSuggestions, type EnrichedSuggestion } from "./utils/suggestion-enrichment";
import { resetSynthesisCache } from "./utils/synthesis";
import { clearCache as clearSpacesCache } from "./utils/spaces-store";
import { FileText, Layout } from "lucide-react";
import { Tab, ViewMode, Theme, Command, FileEntry, PaneNode, PaneLeaf, BookmarkEntry } from "./types";
import {
  SplitPaneContainer,
  createLeaf,
  findLeafWithTab,
  findFirstLeaf,
  findLeafById,
  collectAllTabs,
  insertTabIntoLeaf,
  removeTabFromTree,
  setActiveTabInLeaf,
  moveTabInTree,
  splitLeaf,
} from "./components/layout/SplitPaneContainer";
import type { PluginCommand, PluginRibbonAction, PluginStatusBarItem, PluginRegistration, PluginSettingTabRegistration } from "./types/plugin";
import { getNoteName, generateId, debounce, isDarkTheme } from "./utils/helpers";
import { useAppCommands } from "./hooks/useAppCommands";
import { useRenameNote } from "./hooks/useRenameNote";
import { useVaultSession } from "./hooks/useVaultSession";
import { useLayoutGroups } from "./hooks/useLayoutGroups";
import { useInlineSuggestions } from "./hooks/useInlineSuggestions";
import { useFileOperations } from "./hooks/useFileOperations";
import { rewriteWikiLinks } from "./utils/wikiLinks";
import {
  getUngroupedTabsToPreserve,
  isUngroupedTab,
  mergePaneTabsWithPreservedUngrouped,
} from "./utils/tabGroups";
import { getAPI } from "./utils/api";
import { PluginManager } from "./lib/pluginManager";
import { getSnippetManager, stopCssSnippets } from "./lib/cssSnippets";
import { OOApp } from "./lib/obsidian-api/app";
import { TFile } from "./lib/obsidian-api";
import { PluginPermissionModal } from "./components/plugins/PluginPermissionModal";
import { PluginViewPanel } from "./components/plugins/PluginViewPanel";
import type { PluginPermission, PluginManifest } from "./types/plugin";
import {
  FTUXState,
  loadFTUXState,
  saveFTUXState,
} from "./utils/ftux";
import { readData, writeData } from "./utils/disk-store";
import { DragCtx, DragContextData } from "./context/DragContext";
import { initializePersistedUserDatabase } from "./lib/userDatabase";

type AppPluginViewAction = {
  id: string;
  icon: string;
  title: string;
  el: HTMLElement;
};

type AppPluginViewInfo = {
  viewType: string;
  displayText: string;
  icon: string;
  containerEl: HTMLElement;
  side: 'left' | 'right' | 'main';
  pluginId?: string;
  leaf?: any;
  visible?: boolean;
  actions?: AppPluginViewAction[];
};

function setWritableViewProperty(view: any, key: string, value: unknown): void {
  for (let target = view; target; target = Object.getPrototypeOf(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;
    if (!descriptor.writable && !descriptor.set) return;
    break;
  }
  view[key] = value;
}
import {
  initGlobalKeybindings,
  setGlobalKeybindingsEnabled,
} from "./keybindings/globalKeys";
import { GroupModal } from "./components/modals/GroupModal";
const api = getAPI();
const MIN_EDITOR_FONT_SIZE = 12;
const MAX_EDITOR_FONT_SIZE = 24;
type FontZoomScope = "both" | "editor" | "preview";
type GraphMode = "manual" | "ai";

function collectAllActiveTabPaths(node: PaneNode): string[] {
  if ('children' in node && Array.isArray(node.children)) {
    return [
      ...collectAllActiveTabPaths(node.children[0]),
      ...collectAllActiveTabPaths(node.children[1]),
    ];
  } else if ('tabs' in node && Array.isArray(node.tabs)) {
    const activeTab = node.tabs.find((t) => t.id === node.activeTabId);
    return isHostEditableMarkdownPath(activeTab?.path) ? [activeTab.path] : [];
  }
  return [];
}

type RGB = { r: number; g: number; b: number };

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

const hexToRgb = (hex: string): RGB | null => {
  const raw = hex.trim().replace("#", "");
  if (raw.length === 3) {
    const [r, g, b] = raw.split("").map((c) => parseInt(c + c, 16));
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  if (raw.length === 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  return null;
};

const rgbToHex = ({ r, g, b }: RGB): string => {
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mixRgb = (from: RGB, to: RGB, ratio: number): RGB => {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
};

const rgbToRgba = ({ r, g, b }: RGB, alpha: number): string =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${Math.max(
    0,
    Math.min(1, alpha),
  ).toFixed(3)})`;

const relativeLuminance = ({ r, g, b }: RGB): number => {
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
};

const getReadableTextOn = (bg: RGB): string =>
  relativeLuminance(bg) > 0.5 ? "#0a0a0a" : "#f5f5f5";

const CUSTOM_THEME_VARIABLES = [
  "--accent-color",
  "--color-base-00",
  "--color-base-05",
  "--color-base-10",
  "--color-base-20",
  "--color-base-25",
  "--color-base-30",
  "--color-base-35",
  "--color-base-40",
  "--color-base-50",
  "--color-base-60",
  "--color-base-70",
  "--color-base-100",
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--bg-elevated",
  "--bg-launcher",
  "--bg-tree",
  "--bg-toolbar",
  "--bg-hover",
  "--bg-active",
  "--bg-glass",
  "--bg-input",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-muted",
  "--text-faint",
  "--text-link",
  "--color-accent",
  "--color-accent-1",
  "--color-accent-2",
  "--accent-primary",
  "--accent-secondary",
  "--text-on-accent",
  "--accent-glow",
  "--scrollbar-thumb",
  "--scrollbar-thumb-hover",
  "--border-subtle",
  "--border-medium",
  "--border-strong",
  "--divider-color",
  "--titlebar-background",
  "--titlebar-background-focused",
  "--titlebar-text-color",
  "--titlebar-text-color-focused",
  "--status-bar-background",
  "--status-bar-text-color",
  "--tab-container-background",
  "--tab-background-active",
  "--tab-text-color",
  "--tab-text-color-active",
  "--tab-text-color-focused",
  "--tab-text-color-focused-active",
  "--tab-text-color-focused-active-current",
  "--nav-item-color",
  "--nav-item-color-hover",
  "--nav-item-color-active",
  "--nav-item-color-selected",
  "--nav-item-background-hover",
  "--nav-item-background-active",
  "--nav-item-background-selected",
  "--editor-caret",
  "--editor-selection",
  "--editor-selection-focused",
  "--editor-active-line",
  "--editor-active-line-border",
  "--editor-heading",
  "--editor-heading-marker",
  "--editor-link",
  "--editor-link-hover",
  "--editor-tag",
  "--editor-tag-bg",
  "--editor-code",
  "--editor-muted-token",
  "--editor-emphasis",
  "--editor-search-match",
  "--editor-search-match-border",
  "--editor-search-active",
  "--editor-search-active-border",
  "--graph-edge-color",
  "--graph-node-color",
  // Obsidian-standard aliases for plugin compatibility
  "--background-primary",
  "--background-primary-alt",
  "--background-secondary",
  "--background-secondary-alt",
  "--background-modifier-border",
  "--background-modifier-form-field",
  "--background-modifier-error",
  "--background-modifier-success",
  "--background-modifier-box-shadow",
  "--text-normal",
  "--text-accent",
  "--text-accent-hover",
  "--interactive-normal",
  "--interactive-hover",
  "--interactive-accent",
  "--interactive-accent-hover",
  "--interactive-accent-hsl",
  "--link-color",
  "--link-color-hover",
] as const;

const APP_THEME_VALUES = new Set<AppSettings["theme"]>([
  "dark",
  "light",
  "oceanic",
  "dark-plus",
  "blue-night",
  "ember-night",
  "aurora-grove",
  "paper-sage",
  "rose-quartz",
  "system",
  "custom",
]);

const isCanvasFile = (path: string) => path.toLowerCase().endsWith(".canvas");
const isExcalidrawFile = (path: string) => {
  const normalized = path.toLowerCase();
  return normalized.endsWith(".excalidraw") || normalized.endsWith(".excalidraw.md");
};
const isStandaloneExcalidrawFile = (path: string) => {
  const normalized = path.toLowerCase();
  return normalized.endsWith(".excalidraw") && !normalized.endsWith(".excalidraw.md");
};
const isHostEditableMarkdownPath = (path: string | null | undefined): path is string => {
  if (!path) return false;
  if (path === "__new_tab__" || path === GRAPH_TAB_PATH || path === SPACES_TAB_PATH) return false;
  if (path.startsWith("__")) return false;
  if (isCanvasFile(path) || isExcalidrawFile(path)) return false;
  return path.toLowerCase().endsWith(".md");
};
const isKanbanBoard = (frontmatter: Record<string, unknown> | undefined) =>
  typeof frontmatter?.['kanban-plugin'] === 'string'
  && frontmatter['kanban-plugin'].replace(/["']/g, '').toLowerCase() === 'board';
const GRAPH_TAB_PATH = "__graph__.view";
const SPACES_TAB_PATH = "__spaces__.view";



import {
  FIRST_THOUGHT_EXPANSION_IDLE_MS,
  randomInt,
  FIRST_THOUGHT_PROMPTS,
  FIRST_THOUGHT_GHOST_EXAMPLES,
  type FirstThoughtExpandableIntent,
  type FirstThoughtNonExpandableIntent,
  type FirstThoughtIntentClassification,
  type FirstThoughtIntentType,
  type FirstThoughtContext,
  type FirstThoughtSemanticIntent,
  type FirstThoughtTemplate,
  type FirstThoughtExpansionPlan,
  TRANSITION_STOP_WORDS,
  getMeaningfulWordCount,
  normalizeFirstThoughtDraft,
  inferTopic,
  inferFirstThoughtSemanticIntent,
  classifyFirstThoughtIntent,
  getFirstThoughtExpansionPlan,
  expandFirstThoughtDraft,
  extractConceptTokens,
  deriveCurrentConcept,
  getTransitionLikelihood,
} from "./utils/firstThought";

import { syncEngine, type SyncStatus } from "./lib/syncEngine";
import { collaborationEngine, type CollabStatus } from "./lib/collaborationEngine";
import { localDB, LocalGroup } from "./lib/localdb";
import { authManager } from "./lib/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import { v4 as uuidv4 } from "uuid";

const resizerClass =
  "resizer relative z-10 w-1 shrink-0 cursor-ew-resize bg-transparent transition-colors duration-100 after:absolute after:inset-y-0 after:left-px after:w-0.5 after:bg-[var(--divider-color)] after:opacity-100 hover:after:left-0.5 hover:after:w-[3px] hover:after:bg-[var(--interactive-accent)] active:after:left-0.5 active:after:w-[3px] active:after:bg-[var(--interactive-accent)]";
const rightResizerClass = `${resizerClass} right`;

export default function App() {
  // ── Global State ────────────────────────────────────
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [previouslyOpenedVaults, setPreviouslyOpenedVaults] = useState<string[]>([]);
  const [showVaultManager, setShowVaultManager] = useState(false);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>({ state: 'idle' });
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [isNativeFullScreen, setIsNativeFullScreen] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [graphMode, setGraphMode] = useState<GraphMode>("manual");
  const [graphFullScreen, setGraphFullScreen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [folderRevealRequest, setFolderRevealRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [bookmarkStore, setBookmarkStore] = useState<{
    vaultPath: string | null;
    items: BookmarkEntry[];
  }>({ vaultPath: null, items: [] });
  const [bookmarkModalPath, setBookmarkModalPath] = useState<string | null>(null);
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  const [searchInitialMode, setSearchInitialMode] = useState<"search" | "switcher">("switcher");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTabType>("outline");
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string>("home");

  const bookmarks = bookmarkStore.vaultPath === vaultPath ? bookmarkStore.items : [];
  const bookmarkGroups = useMemo(
    () => Array.from(new Set(bookmarks.map((bookmark) => bookmark.group).filter(Boolean))).sort(),
    [bookmarks],
  );

  useEffect(() => {
    initializePersistedUserDatabase();
  }, []);

  useEffect(() => {
    if (!vaultPath) {
      setBookmarkStore({ vaultPath: null, items: [] });
      return;
    }
    try {
      const saved = localStorage.getItem(`openonyx-bookmarks:${vaultPath}`);
      const items = saved ? JSON.parse(saved) as BookmarkEntry[] : [];
      setBookmarkStore({ vaultPath, items: Array.isArray(items) ? items : [] });
    } catch {
      setBookmarkStore({ vaultPath, items: [] });
    }
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath || bookmarkStore.vaultPath !== vaultPath) return;
    localStorage.setItem(
      `openonyx-bookmarks:${vaultPath}`,
      JSON.stringify(bookmarkStore.items),
    );
  }, [bookmarkStore, vaultPath]);

  const saveBookmark = useCallback((path: string, title: string, group: string) => {
    setBookmarkStore((previous) => {
      const items = previous.vaultPath === vaultPath ? previous.items : [];
      const existing = items.find((bookmark) => bookmark.path === path);
      const next = existing
        ? items.map((bookmark) => bookmark.path === path ? { ...bookmark, title, group } : bookmark)
        : [...items, { id: uuidv4(), path, title, group, createdAt: Date.now() }];
      return { vaultPath, items: next };
    });
  }, [vaultPath]);

  const removeBookmark = useCallback((id: string) => {
    setBookmarkStore((previous) => ({
      ...previous,
      items: previous.items.filter((bookmark) => bookmark.id !== id),
    }));
  }, []);

  const removeBookmarksForPath = useCallback((path: string, isDirectory: boolean) => {
    const prefix = `${path.replace(/\/$/, "")}/`;
    setBookmarkStore((previous) => ({
      ...previous,
      items: previous.items.filter((bookmark) => (
        isDirectory ? bookmark.path !== path && !bookmark.path.startsWith(prefix) : bookmark.path !== path
      )),
    }));
  }, []);

  const remapBookmarkPaths = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    const oldPrefix = `${oldPath.replace(/\/$/, "")}/`;
    const newPrefix = `${newPath.replace(/\/$/, "")}/`;
    setBookmarkStore((previous) => ({
      ...previous,
      items: previous.items.map((bookmark) => {
        if (bookmark.path === oldPath) return { ...bookmark, path: newPath };
        if (isDirectory && bookmark.path.startsWith(oldPrefix)) {
          return { ...bookmark, path: `${newPrefix}${bookmark.path.slice(oldPrefix.length)}` };
        }
        return bookmark;
      }),
    }));
  }, []);

  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const customEvent = e as CustomEvent<{ section?: string }>;
      if (customEvent.detail?.section) {
        setSettingsSection(customEvent.detail.section);
      } else {
        setSettingsSection("home");
      }
      setShowSettings(true);
    };
    window.addEventListener("open-settings", handleOpenSettings);
    return () => window.removeEventListener("open-settings", handleOpenSettings);
  }, []);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showUnlinkedMentions, setShowUnlinkedMentions] = useState(false);
  const [showThoughtModel, setShowThoughtModel] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasFilePath, setCanvasFilePath] = useState<string | null>(null);
  const [canvasFullScreen, setCanvasFullScreen] = useState(false);

  const handleToggleBacklinks = useCallback(() => {
    if (!showRightSidebar) {
      setShowRightSidebar(true);
      setRightSidebarTab("backlinks");
    } else if (rightSidebarTab === "backlinks") {
      setShowRightSidebar(false);
    } else {
      setRightSidebarTab("backlinks");
    }
  }, [showRightSidebar, rightSidebarTab]);

  const handleToggleOutgoingLinks = useCallback(() => {
    if (!showRightSidebar) {
      setShowRightSidebar(true);
      setRightSidebarTab("outgoing");
    } else if (rightSidebarTab === "outgoing") {
      setShowRightSidebar(false);
    } else {
      setRightSidebarTab("outgoing");
    }
  }, [showRightSidebar, rightSidebarTab]);

  const handleToggleOutline = useCallback(() => {
    if (!showRightSidebar) {
      setShowRightSidebar(true);
      setRightSidebarTab("outline");
    } else if (rightSidebarTab === "outline") {
      setShowRightSidebar(false);
    } else {
      setRightSidebarTab("outline");
    }
  }, [showRightSidebar, rightSidebarTab]);

  const handleSelectRightTab = useCallback((tab: RightSidebarTabType) => {
    setShowRightSidebar(true);
    setRightSidebarTab(tab);
  }, []);
  const [settings, setSettings] = useState<AppSettings>(() => {
    // Load settings from localStorage on initial render
    try {
      const saved = localStorage.getItem("openonyx-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.theme === "peach-white") parsed.theme = "light";
        if (parsed.theme === "parchment") parsed.theme = "light";
        if (!APP_THEME_VALUES.has(parsed.theme)) parsed.theme = DEFAULT_SETTINGS.theme;
        if (parsed.accentColor === "#8b5cf6") parsed.accentColor = DEFAULT_SETTINGS.accentColor;
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
    return DEFAULT_SETTINGS;
  });
  const [starredNotes, setStarredNotes] = useState<string[]>([]);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [recentCanvasFiles, setRecentCanvasFiles] = useState<string[]>([]);
  const [noteContentCache, setNoteContentCache] = useState<Map<string, string>>(
    new Map(),
  );
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

  // ── Plugin System State ───────────────────────────
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [pluginRibbonActions, setPluginRibbonActions] = useState<PluginRibbonAction[]>([]);
  const [pluginStatusBarItems, setPluginStatusBarItems] = useState<PluginStatusBarItem[]>([]);
  const [pluginList, setPluginList] = useState<PluginRegistration[]>([]);
  const [pluginSettingTabs, setPluginSettingTabs] = useState<PluginSettingTabRegistration[]>([]);
  const pluginManagerRef = useRef<PluginManager | null>(null);
  const ooAppRef = useRef<OOApp | null>(null);
  const openFileRef = useRef<(path: string, mode?: ViewMode) => Promise<void>>(async () => {});
  const pluginFileOpenQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renameRedirectsRef = useRef<Map<string, string>>(new Map());
  const collabSubRef = useRef<{
    vaultPath: string | null;
    userId: string | null;
    spaceId: string | null;
  }>({ vaultPath: null, userId: null, spaceId: null });
  const [pluginViews, setPluginViews] = useState<AppPluginViewInfo[]>([]);
  const leftPluginViews = pluginViews.filter(v => v.side === 'left');
  const activeLeftPluginViews = leftPluginViews.filter(v => v.visible);
  const activeLeftPluginView = activeLeftPluginViews[0] || null;
  const rightPluginViews = pluginViews.filter(v => v.side === 'right');
  const mainPluginViews = pluginViews.filter(v => v.side === 'main');
  // Permission modal state
  const [permissionModalData, setPermissionModalData] = useState<{
    manifest: PluginManifest;
    permissions: PluginPermission[];
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [ftuxState, setFtuxState] = useState<FTUXState>(() => loadFTUXState());
  const [firstThoughtDraft, setFirstThoughtDraft] = useState("");
  const [firstThoughtPromptIndex, setFirstThoughtPromptIndex] = useState(0);
  const [firstThoughtPromptNextIndex, setFirstThoughtPromptNextIndex] = useState<number | null>(null);
  const [firstThoughtPromptCrossfading, setFirstThoughtPromptCrossfading] = useState(false);
  const [firstThoughtPromptFadeMs, setFirstThoughtPromptFadeMs] = useState(220);
  const [firstThoughtPromptOverlapDelayMs, setFirstThoughtPromptOverlapDelayMs] = useState(70);
  const [showFirstThoughtPromptEntry, setShowFirstThoughtPromptEntry] = useState(false);
  const [showFirstThoughtGhostEntry, setShowFirstThoughtGhostEntry] = useState(false);
  const [showFirstThoughtHintEntry, setShowFirstThoughtHintEntry] = useState(false);
  const [isFirstThoughtFocused, setIsFirstThoughtFocused] = useState(false);
  const [hasFirstThoughtKeystroke, setHasFirstThoughtKeystroke] = useState(false);
  const [firstThoughtExpansionPlan, setFirstThoughtExpansionPlan] = useState<FirstThoughtExpansionPlan | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(0);
  const [showFirstThoughtExpansionHint, setShowFirstThoughtExpansionHint] = useState(false);
  const [shownFirstThoughtExpansionDraftKey, setShownFirstThoughtExpansionDraftKey] = useState<string | null>(null);
  const [dismissedFirstThoughtExpansionDraftKey, setDismissedFirstThoughtExpansionDraftKey] = useState<string | null>(null);
  const [vaultEntryTransitionPhase, setVaultEntryTransitionPhase] =
    useState<VaultEntryTransitionPhase>("idle");
  const [isVaultEntryCalmReady, setIsVaultEntryCalmReady] = useState(true);
  const firstThoughtInputRef = useRef<HTMLTextAreaElement | null>(null);
  const firstThoughtPromptIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtPromptFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtEntryPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtEntryGhostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtEntryHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtExpansionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstThoughtAutoFocusSkipRef = useRef(false);
  const vaultEntryTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultEntryCalmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Split pane references and dragging
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [editorPaneWidth, setEditorPaneWidth] = useState(50);

  const handlePaneDrag = useCallback((e: MouseEvent) => {
    if (!mainContentRef.current) return;
    const rect = mainContentRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    if (newWidth > 20 && newWidth < 80) setEditorPaneWidth(newWidth);
  }, []);

  const stopPaneDrag = useCallback(() => {
    document.removeEventListener("mousemove", handlePaneDrag);
    document.removeEventListener("mouseup", stopPaneDrag);
    document.body.style.cursor = "default";
  }, [handlePaneDrag]);

  const startPaneDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.addEventListener("mousemove", handlePaneDrag);
      document.addEventListener("mouseup", stopPaneDrag);
      document.body.style.cursor = "ew-resize";
    },
    [handlePaneDrag, stopPaneDrag],
  );

  // ── Sidebar drag resizer (Obsidian-style: CSS-only during drag, no React re-renders) ──
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [dragCtx, setDragCtx] = useState<DragContextData | null>(null);
  const sidebarWidthRef = useRef(260);
  const showSidebarRef = useRef(true);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const leftSidebarShellRef = useRef<HTMLDivElement>(null);
  const rightSidebarShellRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state (for non-drag updates)
  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);
  useEffect(() => { showSidebarRef.current = showSidebar; }, [showSidebar]);

  useEffect(() => {
    if (!navigator.platform.includes("Mac")) return;

    let disposed = false;
    void api.isFullScreen?.().then((fullScreen) => {
      if (!disposed) setIsNativeFullScreen(fullScreen);
    });

    const unsubscribe = api.onFullScreenChange?.((fullScreen) => {
      setIsNativeFullScreen(fullScreen);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const workspace = ooAppRef.current?.workspace;
    if (workspace) workspace.leftSplit.collapsed = !showSidebar;
  }, [showSidebar]);

  useEffect(() => {
    const workspace = ooAppRef.current?.workspace;
    if (workspace) workspace.rightSplit.collapsed = !showRightSidebar;
  }, [showRightSidebar]);

  const startSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "ew-resize";
    // Disable pointer events on iframes/embeds during drag to prevent stealing mouse
    document.body.classList.add("is-dragging");
    const shell = leftSidebarShellRef.current;
    if (shell) {
      shell.style.transition = "none";
      shell.style.willChange = "width";
    }

    let pendingWidth = sidebarWidthRef.current;
    let rafId: number | null = null;

    const applyWidth = () => {
      rafId = null;
      const newWidth = pendingWidth;
      sidebarWidthRef.current = newWidth;
      if (shell) {
        shell.style.width = `${newWidth}px`;
      }
    };

    const onMove = (ev: MouseEvent) => {
      const requestedWidth = ev.clientX - 48;
      // Keep enough room for the editor while allowing wide plugin layouts.
      // Notebook Navigator's dual-pane minimum can exceed 600px when its
      // navigation pane is resized or its UI scale is increased.
      const maxWidth = Math.max(320, Math.min(960, window.innerWidth - 320));
      if (requestedWidth > 150) {
        const newWidth = Math.min(requestedWidth, maxWidth);
        pendingWidth = newWidth;
        if (rafId === null) {
          rafId = requestAnimationFrame(applyWidth);
        }
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        applyWidth();
      }
      document.body.style.cursor = "default";
      document.body.classList.remove("is-dragging");
      if (shell) {
        shell.style.transition = "";
        shell.style.willChange = "";
        shell.style.width = "var(--sidebar-width)";
      }
      // Commit final value to React state (single re-render)
      setSidebarWidth(sidebarWidthRef.current);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Right Sidebar drag resizer ──
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const rightSidebarWidthRef = useRef(300);
  const rightPluginViewsRef = useRef(rightPluginViews);
  const activeUsersRef = useRef(activeUsers);

  useEffect(() => { rightSidebarWidthRef.current = rightSidebarWidth; }, [rightSidebarWidth]);
  useEffect(() => { rightPluginViewsRef.current = rightPluginViews; }, [rightPluginViews]);
  useEffect(() => { activeUsersRef.current = activeUsers; }, [activeUsers]);

  // Helper to compute dynamic minimum sidebar width
  const getMinRightSidebarWidth = useCallback((pluginViewsList: any[], activeUsersList: any[]) => {
    const numIcons = 3 + pluginViewsList.length;
    const iconsWidth = numIcons * 32 + (numIcons - 1) * 2 + 8; // button: 32px, gap: 2px, padding-left: 8px
    const isMac = navigator.platform.includes("Mac");
    const controlsWidth = isMac ? 0 : 138; // 3 buttons of 46px
    
    let avatarsWidth = 0;
    if (activeUsersList && activeUsersList.length > 0) {
      const visibleCount = Math.min(activeUsersList.length, 3);
      avatarsWidth += 24 + (visibleCount - 1) * 16;
      if (activeUsersList.length > 3) {
        avatarsWidth += 16;
      }
      avatarsWidth += 16; // margin-right
    }
    
    const computedMinWidth = iconsWidth + avatarsWidth + controlsWidth + 16; // 16px safety margin
    return Math.max(200, computedMinWidth);
  }, []);

  // Enforce dynamic minimum sidebar width to prevent icon wrapping/shrinking
  useEffect(() => {
    const minRightWidth = getMinRightSidebarWidth(rightPluginViews, activeUsers);
    if (rightSidebarWidth < minRightWidth) {
      setRightSidebarWidth(minRightWidth);
    }
  }, [rightPluginViews, activeUsers, rightSidebarWidth, getMinRightSidebarWidth]);

  const startRightSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "ew-resize";
    document.body.classList.add("is-dragging");
    const shell = rightSidebarShellRef.current;
    if (shell) {
      shell.style.transition = "none";
      shell.style.willChange = "width";
    }

    let pendingWidth = rightSidebarWidthRef.current;
    let rafId: number | null = null;

    const applyWidth = () => {
      rafId = null;
      const newWidth = pendingWidth;
      rightSidebarWidthRef.current = newWidth;
      if (shell) {
        shell.style.width = `${newWidth}px`;
      }
    };

    const onMove = (ev: MouseEvent) => {
      const ribbonWidth = 48; // Onyx-style launcher width
      const curLeftWidth = sidebarWidthRef.current;
      const leftUsed = showSidebarRef.current ? curLeftWidth : 0;
      const minCenterWidth = 40;
      const maxRightWidth = window.innerWidth - ribbonWidth - leftUsed - minCenterWidth;

      const minRightWidth = getMinRightSidebarWidth(rightPluginViewsRef.current, activeUsersRef.current);
      let newWidth = window.innerWidth - ev.clientX;
      if (newWidth < minRightWidth) newWidth = minRightWidth;
      if (newWidth > maxRightWidth) newWidth = maxRightWidth;

      pendingWidth = newWidth;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyWidth);
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        applyWidth();
      }
      document.body.style.cursor = "default";
      document.body.classList.remove("is-dragging");
      if (shell) {
        shell.style.transition = "";
        shell.style.willChange = "";
        shell.style.width = "var(--right-sidebar-width)";
      }
      setRightSidebarWidth(rightSidebarWidthRef.current);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Thought Model panel drag resizer ──
  const [thoughtModelWidth, setThoughtModelWidth] = useState(400);
  const thoughtModelWidthRef = useRef(400);

  useEffect(() => { thoughtModelWidthRef.current = thoughtModelWidth; }, [thoughtModelWidth]);

  const startThoughtModelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "ew-resize";
    document.body.classList.add("is-dragging");

    const onMove = (ev: MouseEvent) => {
      const appWidth = window.innerWidth - 48;
      const newWidth = appWidth - ev.clientX;
      if (newWidth > 300 && newWidth < 800) {
        thoughtModelWidthRef.current = newWidth;
        const panel = document.querySelector('.thought-model-panel') as HTMLElement;
        if (panel) panel.style.width = `${newWidth}px`;
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "default";
      document.body.classList.remove("is-dragging");
      setThoughtModelWidth(thoughtModelWidthRef.current);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── File & Editor State ─────────────────────────────
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);


  const tabScrollRef = useRef<HTMLDivElement>(null);
  const activeTabScrollFrameRef = useRef<number | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string>("");
  const currentContentRef = useRef<string>("");
  const currentContentPathRef = useRef<string | null>(null);
  const pendingContentUpdateRef = useRef<{ path: string; content: string } | null>(null);
  const contentUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flushContentUpdate = useCallback(() => {
    if (contentUpdateTimeoutRef.current) {
      clearTimeout(contentUpdateTimeoutRef.current);
      contentUpdateTimeoutRef.current = null;
    }
    if (pendingContentUpdateRef.current) {
      const { path, content } = pendingContentUpdateRef.current;
      pendingContentUpdateRef.current = null;
      setCurrentContent(content);
      currentContentPathRef.current = path;

      if (
        isHostEditableMarkdownPath(path)
      ) {
        window.dispatchEvent(
          new CustomEvent("openonyx:note-content-changed", {
            detail: { path, content },
          }),
        );
      }
    }
  }, []);

  useEffect(() => {
    currentContentRef.current = currentContent;
  }, [currentContent]);

  useEffect(() => {
    const activePath = tabs.find((tab) => tab.id === activeTabId)?.path || null;
    if (activePath && currentContentPathRef.current !== activePath) {
      currentContentPathRef.current = null;
      currentContentRef.current = "";
    }
  }, [activeTabId, tabs]);

  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [backlinks, setBacklinks] = useState<string[]>([]);
  
  // Toast notifications state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  // ── Split Pane Tree ──
  const [initialLeaf] = useState(() => createLeaf([]));
  const [paneTree, setPaneTree] = useState<PaneNode>(initialLeaf);
  const [focusedLeafId, setFocusedLeafId] = useState<string>(initialLeaf.id);

  // ── Layout Groups State & Refs ──
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set<string>());


  const [groupModalData, setGroupModalData] = useState<{
    type: "create" | "rename" | "color";
    groupId?: string;
    title: string;
    initialName?: string;
    initialColor?: string;
    tabId?: string;
    filePath?: string;
  } | null>(null);

  const handleOpenNewTab = useCallback((groupId?: any) => {
    const targetGroupId = typeof groupId === "string" ? groupId : null;

    if (activeGroupId && !targetGroupId) {
      // Auto-save the current layout state to the database before exiting the group
      const activeGroup = groups.find((g) => g.id === activeGroupId);
      if (activeGroup) {
        const currentScrolls: Record<string, number> = {};
        const currentCursors: Record<string, number> = {};
        const currentViewModes: Record<string, string> = {};

        const allOpenTabs = collectAllTabs(paneTree);
        for (const tab of allOpenTabs) {
          const cached = scrollCursorCacheRef.current[tab.path];
          if (cached) {
            if (cached.scroll !== undefined) currentScrolls[tab.path] = cached.scroll;
            if (cached.cursor !== undefined) currentCursors[tab.path] = cached.cursor;
            if (cached.viewMode !== undefined) currentViewModes[tab.path] = cached.viewMode;
          }
        }

        const updatedGroup: LocalGroup = {
          ...activeGroup,
          updated_at: new Date().toISOString(),
          layout_state: {
            paneTree,
            activeTabId,
            focusedLeafId,
            scrollPositions: currentScrolls,
            cursorPositions: currentCursors,
            viewModes: currentViewModes,
          },
        };

        // Save layout to local database
        localDB.putGroup(updatedGroup)
          .then(() => {
            setGroups((prev) =>
              prev.map((g) => (g.id === activeGroupId ? updatedGroup : g))
            );
          })
          .catch((err) => console.error("Auto-save group failed before opening blank tab:", err));
      }

      setActiveGroupId(null);

      const ungroupedTabs = getUngroupedTabsToPreserve(tabs, collectAllTabs(paneTree), groups);

      const newTab: Tab = {
        id: generateId(),
        path: "__new_tab__",
        name: "New tab",
        isModified: false,
        groupId: null,
      };

      ungroupedTabs.push(newTab);

      const newTree: PaneLeaf = {
        type: 'leaf',
        id: generateId(),
        tabs: ungroupedTabs,
        activeTabId: newTab.id,
      };

      skipTabSyncRef.current = true;
      setPaneTree(newTree);
      setTabs(ungroupedTabs);
      setActiveTabId(newTab.id);
      setFocusedLeafId(newTree.id);
      setCurrentContent("");
      setBacklinks([]);
      return;
    }

    const newTab: Tab = {
      id: generateId(),
      path: "__new_tab__",
      name: "New tab",
      isModified: false,
      groupId: targetGroupId,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setCurrentContent("");
    setBacklinks([]);
  }, [generateId, activeGroupId, groups, paneTree, activeTabId, focusedLeafId, tabs]);

  // Position and mode cache per file path
  const scrollCursorCacheRef = useRef<Record<string, { scroll?: number, cursor?: number, viewMode?: ViewMode }>>({});

  const handleScrollAndCursorChange = useCallback((path: string, stateUpdate: { scroll?: number, cursor?: number, viewMode?: ViewMode }) => {
    if (!path || path === "__new_tab__") return;
    const current = scrollCursorCacheRef.current[path] || {};
    scrollCursorCacheRef.current[path] = {
      ...current,
      ...stateUpdate,
    };
  }, []);

  const getViewState = useCallback((path: string) => {
    return scrollCursorCacheRef.current[path];
  }, []);

  // Load layout groups for current vault
  useEffect(() => {
    if (!vaultPath) {
      setGroups([]);
      setActiveGroupId(null);
      setHasUnsavedChanges(false);
      return;
    }
    
    localDB.getGroups(vaultPath)
      .then((g) => {
        setGroups(g);
        setActiveGroupId(null);
        setHasUnsavedChanges(false);
      })
      .catch((err) => console.error("Failed to load layout groups:", err));
  }, [vaultPath]);

  // Layout change detection & Auto-save
  useEffect(() => {
    if (!activeGroupId) {
      setHasUnsavedChanges(false);
      return;
    }

    const activeGroup = groups.find((g) => g.id === activeGroupId);
    if (!activeGroup) {
      setHasUnsavedChanges(false);
      return;
    }

    // Normalizing tree helper
    function normalizePaneTree(node: any): any {
      if (!node) return null;
      if (node.type === 'leaf') {
        return {
          type: 'leaf',
          id: node.id,
          activeTabId: node.activeTabId,
          tabs: node.tabs.map((t: any) => ({
            id: t.id,
            path: t.path,
            name: t.name
          }))
        };
      } else if (node.type === 'split') {
        return {
          type: 'split',
          id: node.id,
          direction: node.direction,
          ratio: Math.round(node.ratio * 100) / 100,
          children: [
            normalizePaneTree(node.children[0]),
            normalizePaneTree(node.children[1])
          ]
        };
      }
      return null;
    }

    const currentNorm = JSON.stringify(normalizePaneTree(paneTree));
    const savedNorm = JSON.stringify(normalizePaneTree(activeGroup.layout_state?.paneTree));

    const structChanged =
      currentNorm !== savedNorm ||
      activeTabId !== activeGroup.layout_state?.activeTabId ||
      focusedLeafId !== activeGroup.layout_state?.focusedLeafId;

    if (activeGroup.auto_save_enabled) {
      if (structChanged) {
        // Auto-save: debounce saving to prevent DB spam
        const saveTimer = setTimeout(() => {
          const currentScrolls: Record<string, number> = {};
          const currentCursors: Record<string, number> = {};
          const currentViewModes: Record<string, string> = {};

          const allOpenTabs = collectAllTabs(paneTree);
          for (const tab of allOpenTabs) {
            const cached = scrollCursorCacheRef.current[tab.path];
            if (cached) {
              if (cached.scroll !== undefined) currentScrolls[tab.path] = cached.scroll;
              if (cached.cursor !== undefined) currentCursors[tab.path] = cached.cursor;
              if (cached.viewMode !== undefined) currentViewModes[tab.path] = cached.viewMode;
            }
          }

          const updatedGroup: LocalGroup = {
            ...activeGroup,
            updated_at: new Date().toISOString(),
            layout_state: {
              paneTree,
              activeTabId,
              focusedLeafId,
              scrollPositions: currentScrolls,
              cursorPositions: currentCursors,
              viewModes: currentViewModes,
            },
          };

          localDB.putGroup(updatedGroup)
            .then(() => {
              setGroups((prev) =>
                prev.map((g) => (g.id === activeGroupId ? updatedGroup : g))
              );
              setHasUnsavedChanges(false);
            })
            .catch((err) => console.error("Auto-save group failed:", err));
        }, 1500);

        return () => clearTimeout(saveTimer);
      }
    } else {
      setHasUnsavedChanges(structChanged);
    }
  }, [paneTree, activeTabId, focusedLeafId, activeGroupId, groups]);

  // Sync flat tabs -> pane tree (bridge legacy state to new split system)
  const skipTabSyncRef = useRef<boolean>(false);
  const prevTabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    if (skipTabSyncRef.current) {
      skipTabSyncRef.current = false;
      prevTabsRef.current = tabs;
      return;
    }
    const prevTabs = prevTabsRef.current;
    prevTabsRef.current = tabs;

    // Find tabs that were added
    const prevIds = new Set(prevTabs.map((t) => t.id));
    let addedTabs = tabs.filter((t) => !prevIds.has(t.id));

    if (activeGroupId) {
      addedTabs = addedTabs.filter((t) => t.groupId === activeGroupId);
    } else {
      addedTabs = addedTabs.filter((t) => isUngroupedTab(t, groups));
    }

    // Find tabs that were removed
    const currentIds = new Set(tabs.map((t) => t.id));
    const removedIds = prevTabs.filter((t) => !currentIds.has(t.id)).map((t) => t.id);

    if (addedTabs.length === 0 && removedIds.length === 0) return;

    setPaneTree((prev) => {
      let tree = prev;

      // Remove tabs that were closed
      for (const id of removedIds) {
        const result = removeTabFromTree(tree, id);
        if (!result) {
          tree = createLeaf([]);
          setFocusedLeafId(tree.id);
          return tree;
        }
        tree = result;
      }

      // Add new tabs to the focused leaf
      for (const tab of addedTabs) {
        if (!findLeafWithTab(tree, tab.id)) {
          const targetLeaf = findLeafById(tree, focusedLeafId) || findFirstLeaf(tree);
          tree = insertTabIntoLeaf(tree, targetLeaf.id, tab);
        }
      }

      return tree;
    });
  }, [tabs, focusedLeafId, activeGroupId, groups]);

  // Sync activeTabId -> focused leaf's activeTabId
  useEffect(() => {
    if (!activeTabId) return;
    setPaneTree((prev) => {
      // Find which leaf has this tab and make it active there
      const leaf = findLeafWithTab(prev, activeTabId);
      if (!leaf) return prev;
      if (leaf.activeTabId === activeTabId) return prev;
      return setActiveTabInLeaf(prev, leaf.id, activeTabId);
    });
  }, [activeTabId]);

  // Pane tree change handler (when user drags tabs between panes)
  const handlePaneTreeChange = useCallback((newTree: PaneNode) => {
    setPaneTree(newTree);
    // Sync the flat tabs list from the pane tree
    const allTabs = collectAllTabs(newTree);
    setTabs((prev) =>
      activeGroupId
        ? mergePaneTabsWithPreservedUngrouped(allTabs, prev, groups)
        : allTabs,
    );

    // Sync plugin sides — if a plugin is now in the main pane tree, set its side to 'main'
    const app = ooAppRef.current;
    if (app) {
      let changed = false;
      allTabs.forEach(t => {
        if (t.path.startsWith('__plugin__.')) {
          const viewType = t.path.replace('__plugin__.', '');
          const leaves = app.workspace.getLeavesOfType(viewType);
          leaves.forEach(l => {
            if (l.side !== 'main') {
              l.side = 'main';
              changed = true;
            }
          });
        }
      });
      if (changed) app.workspace.trigger('plugin-views-changed');
    }
  }, [activeGroupId, groups]);

  // Handle tab selection within a specific leaf pane
  const handlePaneTabSelect = useCallback(async (leafId: string, tabId: string) => {
    setFocusedLeafId(leafId);
    setActiveTabId(tabId);
    // Load content for the selected tab
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      if (tab.path === "__new_tab__" || tab.path === GRAPH_TAB_PATH || tab.path === SPACES_TAB_PATH || tab.path.startsWith('__plugin__.')) {
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      if (isCanvasFile(tab.path)) {
        setCanvasFilePath(tab.path);
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      setCurrentContent("");
      setBacklinks([]);
    }
  }, [tabs]);

  // Handle focus change to a leaf pane
  const handleFocusLeaf = useCallback((leafId: string) => {
    setFocusedLeafId(leafId);
    // Set the active tab to the focused leaf's active tab
    setPaneTree((prev) => {
      const leaf = findLeafById(prev, leafId);
      if (leaf && leaf.activeTabId) {
        setActiveTabId(leaf.activeTabId);
      }
      return prev;
    });
  }, []);

  const adjustEditorFontSize = useCallback(
    (delta: number, scope: FontZoomScope = "both") => {
      if (delta === 0) return;

      setSettings((prev) => {
        const clampFontSize = (value: number) =>
          Math.max(MIN_EDITOR_FONT_SIZE, Math.min(MAX_EDITOR_FONT_SIZE, value));

        const currentEditorSize = prev.editorFontSize ?? prev.fontSize;
        const currentPreviewSize = prev.previewFontSize ?? prev.fontSize;

        const nextEditorSize =
          scope === "both" || scope === "editor"
            ? clampFontSize(currentEditorSize + delta)
            : currentEditorSize;
        const nextPreviewSize =
          scope === "both" || scope === "preview"
            ? clampFontSize(currentPreviewSize + delta)
            : currentPreviewSize;
        const nextFontSize =
          scope === "both"
            ? clampFontSize(prev.fontSize + delta)
            : prev.fontSize;

        if (
          nextEditorSize === currentEditorSize &&
          nextPreviewSize === currentPreviewSize &&
          nextFontSize === prev.fontSize
        ) {
          return prev;
        }

        return {
          ...prev,
          fontSize: nextFontSize,
          editorFontSize: nextEditorSize,
          previewFontSize: nextPreviewSize,
        };
      });
    },
    [],
  );

  // ── Modal State ─────────────────────────────────────
  const [modal, setModal] = useState<{
    type: "prompt" | "confirm";
    title: string;
    message: string;
    defaultValue?: string;
    onConfirm?: (result: string | boolean) => void;
  } | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
  }, []);

  // Track system color scheme for 'system' theme option
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // ── Initial Vault Load ──────────────────────────────
  useEffect(() => {
    const checkInitialVault = async () => {
      try {
        const path = await api.getVaultPath();
        if (path) {
          setVaultPath(path);
          (window as any).__oo_vault_path = path;
          setShowSidebar(true);
          const tree = await api.getFileTree();
          setFileTree(tree);
          // Initializing background services for the auto-loaded vault
          runVaultInit(tree);
          
          try {
            const workspaceData = await readData<{ paneTree: PaneNode; activeTabId: string | null; focusedLeafId: string }>("workspace.json");
            if (settings.defaultFileToOpen !== "new-tab" && workspaceData && workspaceData.paneTree) {
              setPaneTree(workspaceData.paneTree);
              setTabs(collectAllTabs(workspaceData.paneTree));
              if (workspaceData.activeTabId) setActiveTabId(workspaceData.activeTabId);
              if (workspaceData.focusedLeafId) setFocusedLeafId(workspaceData.focusedLeafId);
            } else {
              handleOpenNewTab();
            }
          } catch (err) {
            handleOpenNewTab();
          }
        }

        try {
          const previous = await api.getPreviouslyOpenedVaults();
          setPreviouslyOpenedVaults(previous || []);
        } catch (prevErr) {
          console.warn("Failed to load previously opened vaults:", prevErr);
        }
      } catch (err) {
        console.error("Failed to auto-load vault:", err);
      }
    };
    void checkInitialVault();
  }, []);

  // ── Workspace State Persistence ─────────────────────
  useEffect(() => {
    if (!vaultPath) return;
    if (activeGroupId) return;

    const saveTimer = setTimeout(() => {
      writeData("workspace.json", {
        paneTree,
        activeTabId,
        focusedLeafId,
      }).catch((err) => console.error("Failed to save workspace:", err));
    }, 1000);

    return () => clearTimeout(saveTimer);
  }, [paneTree, activeTabId, focusedLeafId, vaultPath, activeGroupId]);

  // Derive theme from settings (handles 'system' preference)
  const theme: Theme =
    settings.theme === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : settings.theme;

  // Apply settings (theme, colors, fonts, etc.)
  useEffect(() => {
    // Apply theme
    document.documentElement.setAttribute("data-theme", theme);
    
    // Determine and apply base theme mode (dark/light) for embeds and components
    const isDark = isDarkTheme(theme, settings);
    document.documentElement.setAttribute("data-theme-mode", isDark ? "dark" : "light");
    document.documentElement.classList.toggle("theme-dark", isDark);
    document.documentElement.classList.toggle("theme-light", !isDark);
    document.body.classList.toggle("theme-dark", isDark);
    document.body.classList.toggle("theme-light", !isDark);

    // Apply CSS custom properties from settings
    const root = document.documentElement;
    root.style.setProperty("--font-family", settings.fontFamily);
    root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
    root.style.setProperty(
      "--editor-pane-font-size",
      `${settings.editorFontSize ?? settings.fontSize}px`,
    );
    root.style.setProperty(
      "--preview-font-size",
      `${settings.previewFontSize ?? settings.fontSize}px`,
    );
    root.style.setProperty(
      "--reading-view-width",
      settings.readableLineLength === false
        ? "none"
        : `${settings.readingViewWidth ?? DEFAULT_SETTINGS.readingViewWidth}px`,
    );
    root.style.setProperty("--editor-line-height", `${settings.lineHeight}`);
    document.body.style.zoom = `${(settings.zoomLevel ?? DEFAULT_SETTINGS.zoomLevel) / 100}`;

    if (theme === "custom") {
      const bg = hexToRgb(settings.customBgPrimary) ?? { r: 21, g: 21, b: 21 };
      const text = hexToRgb(settings.customTextPrimary) ?? { r: 230, g: 230, b: 230 };
      const accent = hexToRgb(settings.accentColor) ?? { r: 59, g: 130, b: 246 };
      const baseBg = rgbToHex(bg);
      const baseText = rgbToHex(text);

      // Accent color variables (solely dependent on settings.accentColor)
      root.style.setProperty("--accent-color", settings.accentColor);
      root.style.setProperty("--color-accent", settings.accentColor);
      root.style.setProperty("--color-accent-1", rgbToRgba(accent, 0.85));
      root.style.setProperty("--color-accent-2", rgbToRgba(accent, 0.7));
      root.style.setProperty("--accent-primary", settings.accentColor);
      root.style.setProperty("--accent-secondary", rgbToRgba(accent, 0.8));
      root.style.setProperty("--text-on-accent", getReadableTextOn(accent));
      root.style.setProperty("--accent-glow", rgbToRgba(accent, 0.16));

      // Background color variables (solely dependent on customBgPrimary)
      root.style.setProperty("--color-base-00", baseBg);
      root.style.setProperty("--color-base-05", baseBg);
      root.style.setProperty("--color-base-10", baseBg);
      root.style.setProperty("--color-base-20", baseBg);
      root.style.setProperty("--color-base-25", baseBg);
      root.style.setProperty("--color-base-30", baseBg);
      root.style.setProperty("--color-base-35", baseBg);

      root.style.setProperty("--bg-primary", baseBg);
      root.style.setProperty("--bg-secondary", baseBg);
      root.style.setProperty("--bg-tertiary", baseBg);
      root.style.setProperty("--bg-elevated", baseBg);
      root.style.setProperty("--bg-launcher", baseBg);
      root.style.setProperty("--bg-tree", baseBg);
      root.style.setProperty("--bg-toolbar", baseBg);
      root.style.setProperty("--bg-input", baseBg);
      root.style.setProperty("--bg-glass", rgbToRgba(bg, 0.98));

      root.style.setProperty("--titlebar-background", baseBg);
      root.style.setProperty("--titlebar-background-focused", baseBg);
      root.style.setProperty("--status-bar-background", baseBg);
      root.style.setProperty("--tab-container-background", baseBg);
      root.style.setProperty("--tab-background-active", baseBg);

      // Text color variables (solely dependent on customTextPrimary)
      root.style.setProperty("--color-base-40", rgbToRgba(text, 0.2));
      root.style.setProperty("--color-base-50", rgbToRgba(text, 0.35));
      root.style.setProperty("--color-base-60", rgbToRgba(text, 0.5));
      root.style.setProperty("--color-base-70", rgbToRgba(text, 0.7));
      root.style.setProperty("--color-base-100", baseText);

      root.style.setProperty("--bg-hover", rgbToRgba(text, 0.08));
      root.style.setProperty("--bg-active", rgbToRgba(text, 0.14));

      root.style.setProperty("--text-primary", baseText);
      root.style.setProperty("--text-secondary", rgbToRgba(text, 0.8));
      root.style.setProperty("--text-tertiary", rgbToRgba(text, 0.65));
      root.style.setProperty("--text-muted", rgbToRgba(text, 0.5));
      root.style.setProperty("--text-faint", rgbToRgba(text, 0.35));
      root.style.setProperty("--text-link", settings.accentColor);

      root.style.setProperty("--scrollbar-thumb", rgbToRgba(text, 0.26));
      root.style.setProperty("--scrollbar-thumb-hover", rgbToRgba(text, 0.42));
      root.style.setProperty("--border-subtle", rgbToRgba(text, 0.1));
      root.style.setProperty("--border-medium", rgbToRgba(text, 0.16));
      root.style.setProperty("--border-strong", rgbToRgba(text, 0.24));
      root.style.setProperty("--divider-color", rgbToRgba(text, 0.1));

      root.style.setProperty("--titlebar-text-color", rgbToRgba(text, 0.8));
      root.style.setProperty("--titlebar-text-color-focused", baseText);
      root.style.setProperty("--status-bar-text-color", rgbToRgba(text, 0.5));

      root.style.setProperty("--tab-text-color", rgbToRgba(text, 0.6));
      root.style.setProperty("--tab-text-color-active", baseText);
      root.style.setProperty("--tab-text-color-focused", baseText);
      root.style.setProperty("--tab-text-color-focused-active", baseText);
      root.style.setProperty("--tab-text-color-focused-active-current", baseText);

      root.style.setProperty("--nav-item-color", rgbToRgba(text, 0.75));
      root.style.setProperty("--nav-item-color-hover", baseText);
      root.style.setProperty("--nav-item-color-active", baseText);
      root.style.setProperty("--nav-item-color-selected", baseText);
      root.style.setProperty("--nav-item-background-hover", rgbToRgba(text, 0.08));
      root.style.setProperty("--nav-item-background-active", rgbToRgba(text, 0.1));
      root.style.setProperty("--nav-item-background-selected", rgbToRgba(text, 0.12));

      root.style.setProperty("--editor-caret", baseText);
      root.style.setProperty("--editor-selection", rgbToRgba(accent, 0.2));
      root.style.setProperty("--editor-selection-focused", rgbToRgba(accent, 0.3));
      root.style.setProperty("--editor-active-line", rgbToRgba(text, 0.04));
      root.style.setProperty("--editor-active-line-border", rgbToRgba(text, 0.1));
      root.style.setProperty("--editor-heading", baseText);
      root.style.setProperty("--editor-heading-marker", rgbToRgba(text, 0.6));
      root.style.setProperty("--editor-link", settings.accentColor);
      root.style.setProperty("--editor-link-hover", settings.accentColor);
      root.style.setProperty("--editor-tag", settings.accentColor);
      root.style.setProperty("--editor-tag-bg", rgbToRgba(accent, 0.18));
      root.style.setProperty("--editor-code", rgbToRgba(text, 0.85));
      root.style.setProperty("--editor-muted-token", rgbToRgba(text, 0.5));
      root.style.setProperty("--editor-emphasis", baseText);
      root.style.setProperty("--editor-search-match", rgbToRgba(accent, 0.24));
      root.style.setProperty("--editor-search-match-border", rgbToRgba(accent, 0.45));
      root.style.setProperty("--editor-search-active", rgbToRgba(accent, 0.34));
      root.style.setProperty("--editor-search-active-border", rgbToRgba(accent, 0.72));

      root.style.setProperty("--graph-edge-color", rgbToRgba(text, 0.35));
      root.style.setProperty("--graph-node-color", settings.accentColor);

      // ── Obsidian-standard CSS variable aliases for plugin compatibility ──
      root.style.setProperty("--background-primary", baseBg);
      root.style.setProperty("--background-primary-alt", baseBg);
      root.style.setProperty("--background-secondary", baseBg);
      root.style.setProperty("--background-secondary-alt", baseBg);
      root.style.setProperty("--background-modifier-border", rgbToRgba(text, 0.16));
      root.style.setProperty("--background-modifier-form-field", rgbToRgba(bg, 0.5));
      root.style.setProperty("--background-modifier-error", "#e05050");
      root.style.setProperty("--background-modifier-success", "#22c55e");
      root.style.setProperty("--background-modifier-box-shadow", rgbToRgba(bg, 0.4));
      root.style.setProperty("--text-normal", baseText);
      root.style.setProperty("--text-accent", settings.accentColor);
      root.style.setProperty("--text-accent-hover", settings.accentColor);
      root.style.setProperty("--interactive-normal", rgbToRgba(text, 0.04));
      root.style.setProperty("--interactive-hover", rgbToRgba(text, 0.08));
      root.style.setProperty("--interactive-accent", settings.accentColor);
      root.style.setProperty("--interactive-accent-hover", settings.accentColor);
      root.style.setProperty("--interactive-accent-hsl", (() => { const r = accent.r / 255, g = accent.g / 255, b = accent.b / 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2; if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6; } return `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`; })());
      root.style.setProperty("--link-color", settings.accentColor);
      root.style.setProperty("--link-color-hover", settings.accentColor);
    } else {
      for (const variableName of CUSTOM_THEME_VARIABLES) {
        root.style.removeProperty(variableName);
      }
    }

    (window as any).__oo_sync_theme_variables_to_body?.();

    window.dispatchEvent(
      new CustomEvent("oo:theme-settings-changed", {
        detail: { theme },
      }),
    );

    // Save settings to localStorage
    localStorage.setItem("openonyx-settings", JSON.stringify(settings));
  }, [settings, theme]);

  useEffect(() => {
    if (settings.vimMode) {
      initGlobalKeybindings();
      setGlobalKeybindingsEnabled(true);
    } else {
      setGlobalKeybindingsEnabled(false);
    }

    window.dispatchEvent(
      new CustomEvent("oo:vim-setting-change", {
        detail: { enabled: settings.vimMode },
      }),
    );
  }, [settings.vimMode]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("oo:spellcheck-setting-change", {
        detail: { enabled: settings.spellcheck },
      }),
    );
  }, [settings.spellcheck]);

  // ── Queue status listener ───────────────────────────
  useEffect(() => {
    setQueueStatusCallback((status) => setQueueStatus(status));
    return () => setQueueStatusCallback(null);
  }, []);

  useEffect(() => {
    saveFTUXState(ftuxState);
  }, [ftuxState]);

  useEffect(() => {
    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    if (
      !settings.backlinksOpenByDefault ||
      settings.coreBacklinks === false ||
      !currentTab?.path ||
      currentTab.path.startsWith("__") ||
      !currentTab.path.toLowerCase().endsWith(".md")
    ) {
      return;
    }
    setShowRightSidebar(true);
    setRightSidebarTab("backlinks");
  }, [activeTabId, settings.backlinksOpenByDefault, settings.coreBacklinks, tabs]);

  useEffect(() => {
    return () => {
      if (firstThoughtPromptIntervalRef.current) {
        clearTimeout(firstThoughtPromptIntervalRef.current);
      }
      if (firstThoughtPromptFadeTimerRef.current) {
        clearTimeout(firstThoughtPromptFadeTimerRef.current);
      }
      if (firstThoughtEntryPromptTimerRef.current) {
        clearTimeout(firstThoughtEntryPromptTimerRef.current);
      }
      if (firstThoughtEntryGhostTimerRef.current) {
        clearTimeout(firstThoughtEntryGhostTimerRef.current);
      }
      if (firstThoughtEntryHintTimerRef.current) {
        clearTimeout(firstThoughtEntryHintTimerRef.current);
      }
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
      }
      if (vaultEntryTransitionTimerRef.current) {
        clearTimeout(vaultEntryTransitionTimerRef.current);
      }
      if (vaultEntryCalmTimerRef.current) {
        clearTimeout(vaultEntryCalmTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (vaultEntryTransitionPhase !== "transitioning") {
      return;
    }

    if (vaultPath && ftuxState.notesCount === 0) {
      setVaultEntryTransitionPhase("entered");
      return;
    }

    if (vaultPath && ftuxState.notesCount > 0) {
      setVaultEntryTransitionPhase("idle");
    }
  }, [ftuxState.notesCount, vaultEntryTransitionPhase, vaultPath]);

  useEffect(() => {
    if (vaultEntryTransitionPhase === "idle") {
      setIsVaultEntryCalmReady(true);
      if (vaultEntryTransitionTimerRef.current) {
        clearTimeout(vaultEntryTransitionTimerRef.current);
        vaultEntryTransitionTimerRef.current = null;
      }
      if (vaultEntryCalmTimerRef.current) {
        clearTimeout(vaultEntryCalmTimerRef.current);
        vaultEntryCalmTimerRef.current = null;
      }
      return;
    }

    setIsVaultEntryCalmReady(false);

    if (vaultEntryTransitionPhase === "entered") {
      if (vaultEntryTransitionTimerRef.current) {
        clearTimeout(vaultEntryTransitionTimerRef.current);
      }
      vaultEntryTransitionTimerRef.current = setTimeout(() => {
        setVaultEntryTransitionPhase("idle");
        vaultEntryTransitionTimerRef.current = null;
      }, 420);

      if (vaultEntryCalmTimerRef.current) {
        clearTimeout(vaultEntryCalmTimerRef.current);
      }
      vaultEntryCalmTimerRef.current = setTimeout(() => {
        setIsVaultEntryCalmReady(true);
        vaultEntryCalmTimerRef.current = null;
      }, 150);
    }

    return () => {
      if (vaultEntryTransitionTimerRef.current) {
        clearTimeout(vaultEntryTransitionTimerRef.current);
        vaultEntryTransitionTimerRef.current = null;
      }
      if (vaultEntryCalmTimerRef.current) {
        clearTimeout(vaultEntryCalmTimerRef.current);
        vaultEntryCalmTimerRef.current = null;
      }
    };
  }, [vaultEntryTransitionPhase]);

  useEffect(() => {
    if (vaultEntryTransitionPhase !== "entered") {
      return;
    }
    if (!(vaultPath !== null && ftuxState.notesCount === 0)) {
      return;
    }

    const focusTimer = setTimeout(() => {
      firstThoughtInputRef.current?.focus();
    }, 80);

    return () => clearTimeout(focusTimer);
  }, [ftuxState.notesCount, vaultPath, vaultEntryTransitionPhase]);

  // Keep the active tab visible when tabs overflow horizontally.
  useEffect(() => {
    const scroller = tabScrollRef.current;
    if (!scroller || !activeTabId) return;

    if (activeTabScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(activeTabScrollFrameRef.current);
    }

    activeTabScrollFrameRef.current = window.requestAnimationFrame(() => {
      activeTabScrollFrameRef.current = null;
      const activeEl = Array.from(
        scroller.querySelectorAll<HTMLElement>(".titlebar-tab"),
      ).find((el) => el.dataset.tabId === activeTabId);

      if (!activeEl) return;

      const padding = 8;
      const tabLeft = activeEl.offsetLeft;
      const tabRight = tabLeft + activeEl.offsetWidth;
      const viewLeft = scroller.scrollLeft;
      const viewRight = viewLeft + scroller.clientWidth;

      if (tabLeft < viewLeft + padding) {
        scroller.scrollLeft = Math.max(0, tabLeft - padding);
      } else if (tabRight > viewRight - padding) {
        scroller.scrollLeft = tabRight - scroller.clientWidth + padding;
      }
    });

    return () => {
      if (activeTabScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(activeTabScrollFrameRef.current);
        activeTabScrollFrameRef.current = null;
      }
    };
  }, [activeTabId]);



  useEffect(() => {
    const isZeroState = vaultPath !== null && ftuxState.notesCount === 0;
    const shouldPausePromptRotation =
      isFirstThoughtFocused || hasFirstThoughtKeystroke;

    const clearPromptTimers = () => {
      if (firstThoughtPromptIntervalRef.current) {
        clearTimeout(firstThoughtPromptIntervalRef.current);
        firstThoughtPromptIntervalRef.current = null;
      }
      if (firstThoughtPromptFadeTimerRef.current) {
        clearTimeout(firstThoughtPromptFadeTimerRef.current);
        firstThoughtPromptFadeTimerRef.current = null;
      }
    };

    if (!isZeroState || shouldPausePromptRotation || !isVaultEntryCalmReady) {
      clearPromptTimers();
      setFirstThoughtPromptCrossfading(false);
      setFirstThoughtPromptNextIndex(null);
      return;
    }

    const cycleDelayMs = randomInt(2200, 2800);
    firstThoughtPromptIntervalRef.current = setTimeout(() => {
      const fadeMs = randomInt(180, 260);
      const overlapRatio = randomInt(62, 72) / 100;
      const overlapDelayMs = Math.max(40, Math.round(fadeMs * overlapRatio));
      const nextIndex =
        (firstThoughtPromptIndex + 1) % FIRST_THOUGHT_PROMPTS.length;

      setFirstThoughtPromptFadeMs(fadeMs);
      setFirstThoughtPromptOverlapDelayMs(overlapDelayMs);
      setFirstThoughtPromptNextIndex(nextIndex);
      setFirstThoughtPromptCrossfading(true);

      if (firstThoughtPromptFadeTimerRef.current) {
        clearTimeout(firstThoughtPromptFadeTimerRef.current);
      }
      firstThoughtPromptFadeTimerRef.current = setTimeout(() => {
        setFirstThoughtPromptIndex(nextIndex);
        setFirstThoughtPromptNextIndex(null);
        setFirstThoughtPromptCrossfading(false);
        firstThoughtPromptFadeTimerRef.current = null;
      }, fadeMs + overlapDelayMs);
    }, cycleDelayMs);

    return () => {
      clearPromptTimers();
    };
  }, [
    firstThoughtPromptIndex,
    ftuxState.notesCount,
    hasFirstThoughtKeystroke,
    isVaultEntryCalmReady,
    isFirstThoughtFocused,
    vaultPath,
  ]);

  useEffect(() => {
    const isZeroState = vaultPath !== null && ftuxState.notesCount === 0;

    if (!isZeroState || !isVaultEntryCalmReady) {
      setShowFirstThoughtPromptEntry(false);
      setShowFirstThoughtGhostEntry(false);
      setShowFirstThoughtHintEntry(false);
      setFirstThoughtExpansionPlan(null);
      setShowFirstThoughtExpansionHint(false);
      setShownFirstThoughtExpansionDraftKey(null);
      setDismissedFirstThoughtExpansionDraftKey(null);
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    setShowFirstThoughtPromptEntry(false);
    setShowFirstThoughtGhostEntry(false);
    setShowFirstThoughtHintEntry(false);
    setFirstThoughtExpansionPlan(null);
    setShowFirstThoughtExpansionHint(false);
    setShownFirstThoughtExpansionDraftKey(null);
    setDismissedFirstThoughtExpansionDraftKey(null);

    const promptDelayMs = vaultEntryTransitionPhase === "entered" ? 0 : 120;
    const ghostDelayMs = vaultEntryTransitionPhase === "entered" ? 180 : 250;
    const hintDelayMs = vaultEntryTransitionPhase === "entered" ? 260 : 350;

    firstThoughtEntryPromptTimerRef.current = setTimeout(() => {
      setShowFirstThoughtPromptEntry(true);
    }, promptDelayMs);
    firstThoughtEntryGhostTimerRef.current = setTimeout(() => {
      setShowFirstThoughtGhostEntry(true);
    }, ghostDelayMs);
    firstThoughtEntryHintTimerRef.current = setTimeout(() => {
      setShowFirstThoughtHintEntry(true);
    }, hintDelayMs);

    return () => {
      if (firstThoughtEntryPromptTimerRef.current) {
        clearTimeout(firstThoughtEntryPromptTimerRef.current);
        firstThoughtEntryPromptTimerRef.current = null;
      }
      if (firstThoughtEntryGhostTimerRef.current) {
        clearTimeout(firstThoughtEntryGhostTimerRef.current);
        firstThoughtEntryGhostTimerRef.current = null;
      }
      if (firstThoughtEntryHintTimerRef.current) {
        clearTimeout(firstThoughtEntryHintTimerRef.current);
        firstThoughtEntryHintTimerRef.current = null;
      }
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
    };
  }, [
    ftuxState.notesCount,
    isVaultEntryCalmReady,
    vaultEntryTransitionPhase,
    vaultPath,
  ]);

  useEffect(() => {
    const element = firstThoughtInputRef.current;
    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${Math.max(96, element.scrollHeight)}px`;
  }, [firstThoughtDraft]);

  useEffect(() => {
    const isZeroState = vaultPath !== null && ftuxState.notesCount === 0;

    if (!isZeroState || !isVaultEntryCalmReady) {
      setFirstThoughtExpansionPlan(null);
      setShowFirstThoughtExpansionHint(false);
      setShownFirstThoughtExpansionDraftKey(null);
      setDismissedFirstThoughtExpansionDraftKey(null);
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    const trimmedDraft = firstThoughtDraft.trim();
    const draftKey = normalizeFirstThoughtDraft(firstThoughtDraft);

    if (!trimmedDraft) {
      setFirstThoughtExpansionPlan(null);
      setShowFirstThoughtExpansionHint(false);
      setShownFirstThoughtExpansionDraftKey(null);
      setDismissedFirstThoughtExpansionDraftKey(null);
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    const immediatePlan = getFirstThoughtExpansionPlan(firstThoughtDraft);
    if (!immediatePlan) {
      setFirstThoughtExpansionPlan(null);
      setShowFirstThoughtExpansionHint(false);
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    if (dismissedFirstThoughtExpansionDraftKey === draftKey) {
      setShowFirstThoughtExpansionHint(false);
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    if (shownFirstThoughtExpansionDraftKey === draftKey) {
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
      return;
    }

    if (firstThoughtExpansionTimerRef.current) {
      clearTimeout(firstThoughtExpansionTimerRef.current);
    }

    firstThoughtExpansionTimerRef.current = setTimeout(async () => {
      const draft = firstThoughtDraft;
      if (dismissedFirstThoughtExpansionDraftKey === normalizeFirstThoughtDraft(draft)) {
        setShowFirstThoughtExpansionHint(false);
        return;
      }
      
      const llmPlan = await generateFirstThoughtExpansion(draft);
      let mappedPlan: FirstThoughtExpansionPlan | null = null;

      if (llmPlan && llmPlan.continuations && llmPlan.continuations.length === 3) {
        mappedPlan = {
          intent: "goal",
          suggestions: llmPlan.continuations.map((c) => ({
            label: c.text,
            template: c.structure,
          })) as [FirstThoughtTemplate, FirstThoughtTemplate, FirstThoughtTemplate],
        };
      } else {
        mappedPlan = getFirstThoughtExpansionPlan(draft);
      }

      const validPlan = mappedPlan;

      if (validPlan && validPlan.suggestions && validPlan.suggestions.length > 0) {
        setFirstThoughtExpansionPlan(validPlan);
        setSelectedSuggestionIndex(0);
        setShowFirstThoughtExpansionHint(true);
        setShownFirstThoughtExpansionDraftKey(
          normalizeFirstThoughtDraft(draft),
        );
      } else {
        setShowFirstThoughtExpansionHint(false);
      }
      firstThoughtExpansionTimerRef.current = null;
    }, FIRST_THOUGHT_EXPANSION_IDLE_MS);

    return () => {
      if (firstThoughtExpansionTimerRef.current) {
        clearTimeout(firstThoughtExpansionTimerRef.current);
        firstThoughtExpansionTimerRef.current = null;
      }
    };
  }, [
    firstThoughtDraft,
    shownFirstThoughtExpansionDraftKey,
    dismissedFirstThoughtExpansionDraftKey,
    ftuxState.notesCount,
    isVaultEntryCalmReady,
    vaultPath,
  ]);

  // Helper: collect all .md metadata from file tree without reading content
  const collectAllMdMetadata = useCallback((entries: FileEntry[]): Array<{ path: string; modifiedAt: number; size: number }> => {
    const result: Array<{ path: string; modifiedAt: number; size: number }> = [];
    for (const entry of entries) {
      if (entry.isDirectory && entry.children) {
        result.push(...collectAllMdMetadata(entry.children));
      } else if (!entry.isDirectory && entry.name.endsWith(".md")) {
        result.push({
          path: entry.path,
          modifiedAt: entry.modifiedAt,
          size: entry.size,
        });
      }
    }
    return result;
  }, []);

  // Helper: run vault initialization (scan + enqueue missing embeddings)
  const runVaultInit = useCallback(async (tree: FileEntry[]) => {
    const mdNotes = collectAllMdMetadata(tree);
    if (mdNotes.length === 0) return;

    // Get current active note and recent files for priority
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activePath = activeTab?.path || null;

    initializeVault(mdNotes, activePath, recentFiles, api);
  }, [collectAllMdMetadata, tabs, activeTabId, recentFiles]);

  const initializeRef = useRef(false);

  // ── Sync global window property for plugin compatibility ─────
  useEffect(() => {
    (window as any).__oo_vault_path = vaultPath;
  }, [vaultPath]);

  // ── Reset Caches and Queue on Vault Path Change ─────
  const prevVaultPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultPath) return;

    // Only reset caches when switching to a genuinely different vault,
    // not on initial mount. This preserves disk-backed embedding cache
    // so initializeVault can skip notes that are already indexed.
    const isVaultSwitch = prevVaultPathRef.current !== null && prevVaultPathRef.current !== vaultPath;
    prevVaultPathRef.current = vaultPath;

    resetQueueState();
    if (isVaultSwitch) {
      resetEmbeddingsStore();
    }
    clearSpacesCache();
    resetSynthesisCache();
  }, [vaultPath]);

  // ── CSS snippets (Appearance) ──────────────────────
  useEffect(() => {
    if (!vaultPath) {
      stopCssSnippets();
      return;
    }
    const mgr = getSnippetManager();
    let cancelled = false;
    void mgr.initialize().then(() => {
      if (cancelled) stopCssSnippets(mgr);
    });
    return () => {
      cancelled = true;
      stopCssSnippets(mgr);
    };
  }, [vaultPath]);

  // ── Initialize Core Systems ────────────────────────
  useEffect(() => {
    const init = async () => {
      // Always initialize plugin system (needed for marketplace even without vault)
      if (!pluginManagerRef.current && !initializeRef.current) {
        initializeRef.current = true;
        try {
          const ooApp = new OOApp();
          ooAppRef.current = ooApp;
          
          const pm = new PluginManager(ooApp, {
            onCommandsChanged: setPluginCommands,
            onRibbonChanged: setPluginRibbonActions,
            onStatusBarChanged: setPluginStatusBarItems,
            onSettingTabsChanged: setPluginSettingTabs,
            onPluginsChanged: setPluginList,
            onPermissionRequired: (manifest, permissions) => {
              return new Promise<boolean>((resolve) => {
                setPermissionModalData({ manifest, permissions, resolve });
              });
            },
          });
          pluginManagerRef.current = pm;

          // Wire up file navigation from plugins
          (window as any).__oo_open_file = (path: string, mode?: ViewMode) => {
            const queuedOpen = pluginFileOpenQueueRef.current.then(async () => {
              await openFileRef.current(path, mode);
              // Plugins can queue several leaf.openFile calls in one turn.
              // Let React commit each tab before the next call reads tab state.
              await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            });
            pluginFileOpenQueueRef.current = queuedOpen.catch(() => {});
            return queuedOpen;
          };

          // Listen for plugin view changes from workspace
          ooApp.workspace.on('plugin-views-changed', () => {
            const views = ooApp.workspace.getActivePluginViews();
            setPluginViews(views.map(v => ({
              viewType: v.viewType,
              displayText: v.displayText,
              icon: v.icon,
              containerEl: v.containerEl,
              side: v.side,
              pluginId: v.pluginId,
              leaf: v.leaf,
              visible: v.visible,
              actions: v.actions || [],
            })));

            // Sync main plugin views to tabs
            const mainViews = views.filter(v => v.side === 'main');
            setTabs((prev) => {
              let updated = [...prev];
              let changed = false;
              mainViews.forEach(v => {
                const path = `__plugin__.${v.viewType}`;
                if (!updated.find(t => t.path === path)) {
                  const id = Math.random().toString(36).substr(2, 9);
                  updated.push({
                    id,
                    path,
                    name: v.displayText || v.viewType,
                    isModified: false,
                  });
                  changed = true;
                  setTimeout(() => setActiveTabId(id), 0);
                }
              });
              const currentMainPaths = mainViews.map(v => `__plugin__.${v.viewType}`);
              updated = updated.filter(t => !t.path.startsWith('__plugin__.') || currentMainPaths.includes(t.path));
              if (updated.length !== prev.length) changed = true;
              return changed ? updated : prev;
            });
          });

          ooApp.workspace.on('sidebar-change', (state: { side: 'left' | 'right'; collapsed: boolean }) => {
            if (state.side === 'left') setShowSidebar(!state.collapsed);
            else setShowRightSidebar(!state.collapsed);
          });

          console.log('[PluginSystem] Plugin manager initialized');
        } catch (pluginErr) {
          console.warn('[PluginSystem] Initialization failed:', pluginErr);
        }
      }

      // Check for saved vault path on startup
      try {
        const savedPath = await api.getVaultPath();
        if (savedPath) {
          // Re-affirm vault path to main process to ensure CWD is set correctly on startup
          await api.setVaultPath(savedPath);
          setVaultPath(savedPath);
          (window as any).__oo_vault_path = savedPath;
          setShowSidebar(true);
        }
      } catch (e) {
        console.log("No saved vault path on startup");
      }
    };
    init();
  }, []);

  // ── Load Plugins when Vault is Active ────────────────
  useEffect(() => {
    if (!vaultPath) return;

    const loadPlugins = async () => {
      const pm = pluginManagerRef.current;
      const ooApp = ooAppRef.current;
      
      if (pm && ooApp) {
        try {
          // Initialize ooApp (now that we have a path)
          try {
            await ooApp.initialize();
          } catch (err) {
            console.error('[OOApp] Initialization failed:', err);
          }

          const tree = await api.getFileTree();
          setFileTree(tree);
          // Trigger background vault initialization
          runVaultInit(tree);

          // Discover and load enabled plugins (requires vault)
          try {
            await pm.discoverPlugins();
            await pm.loadEnabledPlugins();
            // Trigger view initialization after all plugins are loaded
            await ooApp.workspace.initializeViews();
            console.log('[PluginSystem] Plugins loaded successfully for vault:', vaultPath);
          } catch (pluginErr) {
            console.warn('[PluginSystem] Plugin loading failed:', pluginErr);
          }
        } catch (err) {
          console.error('[PluginSystem] Error during vault activation:', err);
        }
      }
    };

    loadPlugins();
  }, [vaultPath]);

  // ── Menu Event Handlers ─────────────────────────────
  useEffect(() => {
    const openGraphFromMenu = () => {
      setGraphMode("manual");
      setShowThoughtModel(false);
      setShowCanvas(false);
      setShowGraph(false);
      const existingGraphTab = tabs.find((t) => t.path === GRAPH_TAB_PATH);
      if (existingGraphTab) {
        setActiveTabId(existingGraphTab.id);
        const leaf = findLeafWithTab(paneTree, existingGraphTab.id);
        if (leaf) {
          setFocusedLeafId(leaf.id);
        }
      } else {
        const graphTab: Tab = {
          id: generateId(),
          path: GRAPH_TAB_PATH,
          name: "Graph",
          isModified: false,
        };
        setTabs((prev) => [...prev, graphTab]);
        setActiveTabId(graphTab.id);
      }
      setCurrentContent("");
      setBacklinks([]);
    };

    api.onMenuEvent("menu:open-vault", handleOpenVault);
    api.onMenuEvent("menu:new-note", handleNewNote);
    api.onMenuEvent("menu:save", handleSave);
    api.onMenuEvent("menu:toggle-graph", openGraphFromMenu);
    api.onMenuEvent("menu:command-palette", () => {
      if (settings.coreCommandPalette !== false) setShowCommandPalette(true);
    });
    api.onMenuEvent("menu:toggle-sidebar", () => setShowSidebar((s) => !s));

    return () => {
      [
        "menu:open-vault",
        "menu:new-note",
        "menu:save",
        "menu:toggle-graph",
        "menu:command-palette",
        "menu:toggle-sidebar",
      ].forEach((ch) => api.removeMenuListener(ch));
    };
  }, [tabs, activeTabId, settings.coreCommandPalette]);

  // ── Keyboard Shortcuts ──────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && !shift && e.key.toLowerCase() === "p" && settings.coreCommandPalette !== false) {
        e.preventDefault();
        e.stopPropagation();
        setShowCommandPalette(true);
      } else if (ctrl && !shift && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("editor:open-search"));
      } else if (ctrl && shift && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSidebar(true);
        setSearchInitialMode("search");
        setShowSearch(true);
      } else if (ctrl && e.key === "n") {
        e.preventDefault();
        handleNewNote();
      } else if (ctrl && e.key.toLowerCase() === "o" && settings.coreQuickSwitcher !== false) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("oo:fuzzy-search"));
      } else if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (ctrl && e.key === "g") {
        e.preventDefault();
        openGraphAsTab();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "c" && settings.coreCanvas !== false) {
        e.preventDefault();
        void handleToggleCanvas();
      } else if (ctrl && e.key === "b") {
        e.preventDefault();
        setShowSidebar((s) => !s);
      } else if (ctrl && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length <= 1) return;
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex === -1) return;
        
        let nextIndex;
        if (shift) {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else {
          nextIndex = (currentIndex + 1) % tabs.length;
        }
        
        const nextTab = tabs[nextIndex];
        if (nextTab) {
          handleTabSelect(nextTab.id);
        }
      } else if (ctrl && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (e.key === "Escape") {
        setShowSearch(false);
        setShowCommandPalette(false);
        setShowSettings(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    const closeSettings = () => setShowSettings(false);
    window.addEventListener("close-settings", closeSettings);

    // Listen for custom events
    const handleOpenDatabase = (e: CustomEvent<{path: string}>) => {
      const tabId = `__database__.${e.detail.path}`;
      const existingLeaf = findLeafWithTab(paneTree, tabId);
      if (existingLeaf) {
        setFocusedLeafId(existingLeaf.id);
        setActiveTabId(tabId);
        setPaneTree((prev) => setActiveTabInLeaf(prev, existingLeaf.id, tabId));
        return;
      }

      const newTab: Tab = {
        id: tabId,
        name: `DB: ${getNoteName(e.detail.path)}`,
        path: tabId,
        isModified: false,
      };

      setPaneTree(prev => {
        // Find leaf to insert into
        const leaf = findLeafWithTab(prev, activeTabId || "") || findFirstLeaf(prev);
        if (leaf) {
          const newTree = insertTabIntoLeaf(prev, leaf.id, newTab);
          return setActiveTabInLeaf(newTree, leaf.id, tabId);
        }
        return prev;
      });
      setActiveTabId(tabId);
    };
    
    window.addEventListener('oo:open-database', handleOpenDatabase as EventListener);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("close-settings", closeSettings);
      window.removeEventListener('oo:open-database', handleOpenDatabase as EventListener);
    };
  }, [activeTabId, tabs, paneTree, settings.coreCommandPalette, settings.coreQuickSwitcher, settings.coreCanvas]);


  const refreshFileTree = useCallback(async () => {
    try {
      const tree = await api.getFileTree();
      setFileTree(tree);
    } catch (e) {
      console.error("Failed to refresh file tree:", e);
    }
  }, []);

  const indexMarkdownFileNow = useCallback(async (path: string, content?: string) => {
    if (!path.toLowerCase().endsWith(".md")) return;
    if (path.startsWith(".trash/") || path.startsWith(".openonyx/")) return;
    if (!areEmbeddingsAvailable()) return;

    try {
      const source = typeof content === "string" ? content : (await api.readFile(path)) || "";
      const store = loadStore();
      const changed = await embedNote(store, path, source);
      if (changed) {
        window.dispatchEvent(
          new CustomEvent("openonyx:embedding-updated", {
            detail: { path },
          }),
        );
      }
    } catch (err) {
      console.warn("[Auto-index] Failed:", err);
    }
  }, []);

  useEffect(() => {
    const onFileCreated = () => {
      void refreshFileTree();
    };

    const onFileWritten = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; content?: string }>).detail;
      if (!detail?.path) return;
      void indexMarkdownFileNow(detail.path, detail.content);
    };

    window.addEventListener("openonyx:file-created", onFileCreated as EventListener);
    window.addEventListener("openonyx:directory-created", onFileCreated as EventListener);
    window.addEventListener("openonyx:file-written", onFileWritten as EventListener);
    return () => {
      window.removeEventListener("openonyx:file-created", onFileCreated as EventListener);
      window.removeEventListener("openonyx:directory-created", onFileCreated as EventListener);
      window.removeEventListener("openonyx:file-written", onFileWritten as EventListener);
    };
  }, [indexMarkdownFileNow, refreshFileTree]);

  const promptForInput = useCallback(
    (
      title: string,
      message: string,
      defaultValue = "",
    ): Promise<string | null> => {
      return new Promise((resolve) => {
        setModal({
          type: "prompt",
          title,
          message,
          defaultValue,
          onConfirm: (result) => {
            if (typeof result !== "string") {
              resolve(null);
              return;
            }
            const trimmed = result.trim();
            resolve(trimmed ? trimmed : null);
          },
        });
      });
    },
    [],
  );

  const {
    loadVaultData,
    refreshPreviouslyOpenedVaults,
    handleShowVaultManager,
    handleOpenVault,
    handleCreateVault,
    handleSwitchVault,
    handleCloseVault,
    handleWelcomeVaultAction,
    handleCopyVaultId,
    handleRenameVault,
    handleMoveVault,
    handleRemoveVaultFromList,
  } = useVaultSession({
    vaultPath,
    setVaultPath,
    previouslyOpenedVaults,
    setPreviouslyOpenedVaults,
    showVaultManager,
    setShowVaultManager,
    vaultEntryTransitionPhase,
    setVaultEntryTransitionPhase,
    settings,
    setShowSidebar,
    setFileTree,
    runVaultInit,
    setPaneTree,
    setTabs,
    setActiveTabId,
    setFocusedLeafId,
    handleOpenNewTab,
    showToast,
    promptForInput,
  });

  const getParentPath = (targetPath: string): string => {
    const normalized = targetPath.replace(/[\\/]+$/, "");
    const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return index > 0 ? normalized.slice(0, index) : normalized;
  };

  const getPathLeafName = (targetPath: string): string =>
    targetPath.replace(/[\\/]+$/, "").split(/[/\\]/).filter(Boolean).pop() ||
    "Untitled vault";

  const joinNativePath = (parentPath: string, name: string): string => {
    const separator = parentPath.includes("\\") ? "\\" : "/";
    return `${parentPath.replace(/[\\/]+$/, "")}${separator}${name}`;
  };


  const getUniqueCanvasPath = useCallback(
    async (requestedName: string): Promise<string> => {
      const safeBase =
        requestedName.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled canvas";
      const canonical = isCanvasFile(safeBase)
        ? safeBase
        : `${safeBase}.canvas`;
      const currentTab = tabs.find((tab) => tab.id === activeTabId);
      const activeFolder =
        settings.canvasDefaultLocation === "same-folder" &&
        currentTab?.path &&
        !currentTab.path.startsWith("__") &&
        currentTab.path.includes("/")
          ? currentTab.path.slice(0, currentTab.path.lastIndexOf("/") + 1)
          : "";
      const basePath = canonical.includes("/") ? canonical : `${activeFolder}${canonical}`;
      const stem = basePath.replace(/\.canvas$/i, "");

      let candidate = basePath;
      let suffix = 2;
      while (await api.fileExists(candidate)) {
        candidate = `${stem} ${suffix}.canvas`;
        suffix += 1;
      }
      return candidate;
    },
    [activeTabId, settings.canvasDefaultLocation, tabs],
  );

  const createCanvasDocumentWithPrompt = useCallback(
    async (defaultName = "Untitled canvas"): Promise<string | null> => {
      if (!vaultPath) return null;

      const input = await promptForInput(
        "New Canvas",
        "Enter canvas name:",
        defaultName,
      );
      if (!input) return null;

      const filePath = await getUniqueCanvasPath(input);
      const initialCanvas = JSON.stringify({ nodes: [], edges: [] }, null, 2);

      try {
        await api.createFile(filePath, initialCanvas);
        await refreshFileTree();
        return filePath;
      } catch {
        return null;
      }
    },
    [vaultPath, refreshFileTree, promptForInput, getUniqueCanvasPath],
  );

  // ── Layout Groups Operations ─────────────────────────
  const {
    handleOpenCreateGroupModal,
    handleSaveGroupConfirm,
    handleRestoreGroup,
    handleOpenPathsAsGroup,
    handleCreateGroupFromPaths,
    handleCreateGroupFromFolder,
    handleCreateGroupFromFile,
    handleCreateGroupFromTab,
    handleUpdateActiveGroup,
    handleRenameGroup,
    handleChangeGroupColor,
    handleDeleteGroup,
    handleDuplicateGroup,
    handleToggleGroupAutoSave,
    handleAddFileToGroup,
    handleToggleGroupCollapse,
    handleAddTabToGroup,
    handleGroupModalClose,
  } = useLayoutGroups({
    vaultPath,
    groups,
    setGroups,
    activeGroupId,
    setActiveGroupId,
    paneTree,
    setPaneTree,
    activeTabId,
    setActiveTabId,
    focusedLeafId,
    setFocusedLeafId,
    tabs,
    setTabs,
    collapsedGroupIds,
    setCollapsedGroupIds,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    setCanvasFilePath,
    setCurrentContent,
    setBacklinks,
    setGroupModalData,
    groupModalData,
    showToast,
    scrollCursorCacheRef,
    skipTabSyncRef,
  });

  // ── Backlinks ───────────────────────────────────────
  const loadBacklinks = useCallback(async (filePath: string) => {
    try {
      const links = await api.getBacklinks(filePath);
      setBacklinks(links);
    } catch {
      setBacklinks([]);
    }
  }, [api]);

  // Load content and backlinks when activeTabId changes
  useEffect(() => {
    if (!activeTabId) {
      setCurrentContent("");
      setBacklinks([]);
      return;
    }
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    
    // Ignore special tabs
    if (
      tab.path === "__new_tab__" ||
      tab.path === GRAPH_TAB_PATH ||
      tab.path === SPACES_TAB_PATH ||
      tab.path.startsWith("__plugin__.")
    ) {
      setCurrentContent("");
      setBacklinks([]);
      return;
    }
    if (isCanvasFile(tab.path)) {
      setCurrentContent("");
      setBacklinks([]);
      return;
    }
    
    let active = true;
    const loadContent = async () => {
      try {
        const content = (await api.readFile(tab.path)) || "";
        if (active) {
          setCurrentContent(content);
          currentContentRef.current = content;
          currentContentPathRef.current = tab.path;
          loadBacklinks(tab.path);
        }
      } catch (err) {
        console.error("Error loading active tab content:", err);
      }
    };
    void loadContent();
    return () => {
      active = false;
    };
  }, [activeTabId, tabs, loadBacklinks]);

  const rememberRenameRedirect = useCallback((oldPath: string, newPath: string) => {
    const redirects = renameRedirectsRef.current;
    redirects.set(oldPath, newPath);
    window.setTimeout(() => {
      if (redirects.get(oldPath) === newPath) redirects.delete(oldPath);
    }, 30_000);
  }, []);

  const resolveRenamedPath = useCallback((path: string): string => {
    const redirects = renameRedirectsRef.current;
    const exact = redirects.get(path);
    if (exact) return exact;
    for (const [oldPath, newPath] of redirects) {
      const oldPrefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
      if (path.startsWith(oldPrefix)) {
        const newPrefix = newPath.endsWith("/") ? newPath : `${newPath}/`;
        return `${newPrefix}${path.slice(oldPrefix.length)}`;
      }
    }
    return path;
  }, []);

  const updateOpenPathsAfterRename = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    rememberRenameRedirect(oldPath, newPath);

    const remapPath = (path: string) => {
      if (path === oldPath) return newPath;
      if (isDirectory) {
        const oldPrefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
        if (path.startsWith(oldPrefix)) {
          const newPrefix = newPath.endsWith("/") ? newPath : `${newPath}/`;
          return `${newPrefix}${path.slice(oldPrefix.length)}`;
        }
      }
      return path;
    };

    setTabs((prev) =>
      prev.map((tab) => {
        const nextPath = remapPath(tab.path);
        return nextPath === tab.path ? tab : { ...tab, path: nextPath, name: getNoteName(nextPath) };
      }),
    );

    setStarredNotes((prev) => prev.map(remapPath));

    if (activeTabId) {
      const active = tabs.find((tab) => tab.id === activeTabId);
      if (active && remapPath(active.path) !== active.path) {
        loadBacklinks(remapPath(active.path));
      }
    }
  }, [activeTabId, loadBacklinks, rememberRenameRedirect, setStarredNotes, setTabs, tabs]);

  const updateEmbeddingsAfterRename = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    const store = loadStore();
    if (isDirectory) {
      renameEmbeddingsByPrefix(store, oldPath, newPath);
      return;
    }
    if (!oldPath.toLowerCase().endsWith(".md")) return;
    if (newPath.toLowerCase().endsWith(".md")) {
      renameEmbeddingPath(store, oldPath, newPath);
    } else {
      removeEmbedding(store, oldPath);
    }
  }, []);

  // ── File Operations ─────────────────────────────────
  const openFile = async (filePath: string, mode?: ViewMode) => {
    filePath = resolveRenamedPath(filePath);
    const targetMode = mode ?? settings.defaultView ?? "editor";
    const cachedViewState = scrollCursorCacheRef.current[filePath] || {};
    if (mode || !cachedViewState.viewMode) {
      scrollCursorCacheRef.current[filePath] = {
        ...cachedViewState,
        viewMode: targetMode,
      };
    }
    // Excalidraw drawings are Markdown-backed but must be opened in the
    // registered Excalidraw view, not the host Markdown editor.
    const app = ooAppRef.current;
    const file = app?.vault.getFileByPath(filePath);
    // Files created or edited by plugins can reach the UI before the regular
    // vault event has populated MetadataCache. Refresh it before routing a
    // Markdown-backed custom view such as Kanban or Excalidraw.
    if (file?.extension === 'md') {
      await app?.metadataCache.updateFileCache(file);
    }
    const isExcalidrawDrawing = isStandaloneExcalidrawFile(filePath)
      || Boolean(file && app?.metadataCache.getFileCache(file)?.frontmatter?.['excalidraw-plugin']);
    if (isExcalidrawDrawing) {
      const workspace = app?.workspace as any;
      if (file && workspace?._viewCreators?.has('excalidraw')) {
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'excalidraw', state: { file: file.path }, active: true });
        if (leaf.view?.getViewType?.() === 'excalidraw') {
          workspace.setActiveLeaf(leaf);
          return;
        }
      }
    }

    // Kanban boards are Markdown files, distinguished by their frontmatter.
    // Route them through the plugin view before the normal Markdown reader.
    const isKanbanDrawing = Boolean(file && isKanbanBoard(
      app?.metadataCache.getFileCache(file)?.frontmatter,
    ));
    if (isKanbanDrawing) {
      const workspace = app?.workspace as any;
      if (file && workspace?._viewCreators?.has('kanban')) {
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'kanban', state: { file: file.path }, active: true });
        if (leaf.view?.getViewType?.() === 'kanban') {
          workspace.setActiveLeaf(leaf);
          return;
        }
      }
    }

    const readOrCreateMissingMarkdown = async (path: string): Promise<string> => {
      const existing = app?.vault.getFileByPath(path);
      if (existing || !path.toLowerCase().endsWith(".md")) {
        return (await api.readFile(path)) || "";
      }
      const noteTitle = getNoteName(path);
      const fallback = `# ${noteTitle}\n\n`;
      await api.createFile(path, fallback);
      if (collaborationEngine.activeSpaceId) {
        await collaborationEngine.persistNoteEdit(path, fallback);
        syncEngine.triggerPush();
      }
      await refreshFileTree();
      return fallback;
    };

    // Track recent files (keep last 20)
    setRecentFiles((prev) => {
      const filtered = prev.filter((p) => p !== filePath);
      return [filePath, ...filtered].slice(0, 20);
    });

    // Determine starting tabs for this operation (filter out active "New tab" if we're replacing it)
    let baseTabs = tabs;
    let replacingNewTabId: string | null = null;
    if (activeTab?.path === "__new_tab__") {
      replacingNewTabId = activeTabId;
      baseTabs = tabs.filter(t => t.id !== activeTabId);
    }

    const existingBaseTab = baseTabs.find((t) => t.path === filePath);
    const isGroupTab = existingBaseTab && existingBaseTab.groupId === activeGroupId;

    if (activeGroupId && !isGroupTab) {
      setActiveGroupId(null);

      const ungroupedTabs = getUngroupedTabsToPreserve(baseTabs, collectAllTabs(paneTree), groups);
      const existingUngroupedTab = existingBaseTab && isUngroupedTab(existingBaseTab, groups)
        ? existingBaseTab
        : null;
      const targetTab = existingUngroupedTab || {
        id: generateId(),
        path: filePath,
        name: getNoteName(filePath),
        isModified: false,
        groupId: null,
      };

      if (!ungroupedTabs.some((tab) => tab.id === targetTab.id)) {
        ungroupedTabs.push(targetTab);
      }

      const newTree: PaneLeaf = {
        type: 'leaf',
        id: generateId(),
        tabs: ungroupedTabs,
        activeTabId: targetTab.id,
      };

      skipTabSyncRef.current = true;
      setPaneTree(newTree);
      setTabs(ungroupedTabs);
      setActiveTabId(targetTab.id);
      setFocusedLeafId(newTree.id);

      if (isCanvasFile(filePath)) {
        setRecentCanvasFiles((prev) => {
          const filtered = prev.filter((p) => p !== filePath);
          return [filePath, ...filtered].slice(0, 12);
        });
        setShowThoughtModel(false);
        setShowGraph(false);
        setShowCanvas(false);
        setCanvasFullScreen(false);
        setCanvasFilePath(filePath);
        setCurrentContent("");
        setBacklinks([]);
      } else {
        const content = await readOrCreateMissingMarkdown(filePath);
        setCurrentContent(content);
        setViewMode(targetMode);
        loadBacklinks(filePath);
      }
      return;
    }

    if (isCanvasFile(filePath)) {
      setRecentCanvasFiles((prev) => {
        const filtered = prev.filter((p) => p !== filePath);
        return [filePath, ...filtered].slice(0, 12);
      });
      setShowThoughtModel(false);
      setShowGraph(false);
      setShowCanvas(false);
      setCanvasFullScreen(false);
      setCanvasFilePath(filePath);
      
      const existingCanvasTab = baseTabs.find((t) => t.path === filePath);
      if (existingCanvasTab) {
        setTabs(baseTabs); // Apply the removal of New Tab if it happened
        setActiveTabId(existingCanvasTab.id);
        const leaf = findLeafWithTab(paneTree, existingCanvasTab.id);
        if (leaf) {
          setFocusedLeafId(leaf.id);
        }
      } else {
        const canvasTab: Tab = {
          id: generateId(),
          path: filePath,
          name: getNoteName(filePath),
          isModified: false,
        };
        setTabs([...baseTabs, canvasTab]);
        setActiveTabId(canvasTab.id);
      }
      setCurrentContent("");
      setBacklinks([]);
      return;
    }

    // Check if tab already exists in our base set
    const existingTab = baseTabs.find((t) => t.path === filePath);
    if (existingTab) {
      setTabs(baseTabs); // Apply removal of New Tab if it happened
      setActiveTabId(existingTab.id);
      const leaf = findLeafWithTab(paneTree, existingTab.id);
      if (leaf) {
        setFocusedLeafId(leaf.id);
      }
      const content = await readOrCreateMissingMarkdown(filePath);
      setCurrentContent(content);
      setViewMode(targetMode);
      loadBacklinks(filePath);
      return;
    }

    // Open new tab
    const content = await readOrCreateMissingMarkdown(filePath);
    const newTab: Tab = {
      id: generateId(),
      path: filePath,
      name: getNoteName(filePath),
      isModified: false,
    };

    setTabs([...baseTabs, newTab]);
    setActiveTabId(newTab.id);
    setCurrentContent(content);
    setViewMode(targetMode);
    loadBacklinks(filePath);
  };

  // Keep plugin-originated opens bound to the current render's tab state.
  openFileRef.current = openFile;

  // Restored tabs are rehydrated from the local workspace layout rather than
  // opened through openFile(). Promote an already-open Kanban Markdown tab as
  // soon as the plugin has registered its view creator.
  useEffect(() => {
    const tabPath = tabs.find((tab) => tab.id === activeTabId)?.path;
    if (!tabPath?.toLowerCase().endsWith('.md')) return;

    let cancelled = false;
    const routeRestoredKanbanTab = async () => {
      const app = ooAppRef.current;
      const file = app?.vault.getFileByPath(tabPath);
      const workspace = app?.workspace as any;
      if (!app || !file || !workspace?._viewCreators?.has('kanban')) return;

      await app.metadataCache.updateFileCache(file);
      if (cancelled || !isKanbanBoard(app.metadataCache.getFileCache(file)?.frontmatter)) return;
      if (workspace.activeLeaf?.view?.getViewType?.() === 'kanban') return;

      const leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: 'kanban', state: { file: file.path }, active: true });
      if (!cancelled && leaf.view?.getViewType?.() === 'kanban') workspace.setActiveLeaf(leaf);
    };

    void routeRestoredKanbanTab().catch((error) => {
      console.error('[Kanban] Failed to route restored board:', error);
    });
    return () => { cancelled = true; };
  }, [activeTabId, pluginList, tabs]);


  const openGraphAsTab = (mode: GraphMode = "manual") => {
    setGraphMode(mode);
    setShowThoughtModel(false);
    setShowCanvas(false);
    setShowGraph(false);

    const existingGraphTab = tabs.find((t) => t.path === GRAPH_TAB_PATH);
    if (existingGraphTab) {
      setActiveTabId(existingGraphTab.id);
      const leaf = findLeafWithTab(paneTree, existingGraphTab.id);
      if (leaf) {
        setFocusedLeafId(leaf.id);
      }
    } else {
      const graphTab: Tab = {
        id: generateId(),
        path: GRAPH_TAB_PATH,
        name: "Graph",
        isModified: false,
      };
      setTabs((prev) => [...prev, graphTab]);
      setActiveTabId(graphTab.id);
    }

    setCurrentContent("");
    setBacklinks([]);
  };

  const openSpacesAsTab = () => {
    setShowThoughtModel(false);
    setShowCanvas(false);
    setShowGraph(false);

    const existingSpacesTab = tabs.find((t) => t.path === SPACES_TAB_PATH);
    if (existingSpacesTab) {
      setActiveTabId(existingSpacesTab.id);
      const leaf = findLeafWithTab(paneTree, existingSpacesTab.id);
      if (leaf) {
        setFocusedLeafId(leaf.id);
      }
    } else {
      const spacesTab: Tab = {
        id: generateId(),
        path: SPACES_TAB_PATH,
        name: "Spaces",
        isModified: false,
      };
      setTabs((prev) => [...prev, spacesTab]);
      setActiveTabId(spacesTab.id);
    }

    setCurrentContent("");
    setBacklinks([]);
  };

  const handleExpandFirstThought = useCallback(() => {
    if (!firstThoughtExpansionPlan) return;
    if (!firstThoughtDraft.trim()) return;

    const suggestion = firstThoughtExpansionPlan.suggestions[selectedSuggestionIndex];
    if (!suggestion) return;

    const expandedDraft = expandFirstThoughtDraft(
      firstThoughtDraft,
      suggestion.template,
    );

    setFirstThoughtDraft(expandedDraft.value);
    setShowFirstThoughtExpansionHint(false);
    setDismissedFirstThoughtExpansionDraftKey(
      normalizeFirstThoughtDraft(expandedDraft.value),
    );

    window.requestAnimationFrame(() => {
      const element = firstThoughtInputRef.current;
      if (!element) return;
      element.focus();
      const cursor = Math.min(expandedDraft.cursor, expandedDraft.value.length);
      element.setSelectionRange(cursor, cursor);
    });
  }, [firstThoughtDraft, firstThoughtExpansionPlan, selectedSuggestionIndex]);

  const handleIgnoreFirstThoughtExpansion = useCallback(() => {
    setShowFirstThoughtExpansionHint(false);
    setDismissedFirstThoughtExpansionDraftKey(
      normalizeFirstThoughtDraft(firstThoughtDraft),
    );
  }, [firstThoughtDraft]);

  const handleCreateFirstThought = useCallback(async () => {
    if (!vaultPath) return;

    const thought = firstThoughtDraft.trim();
    if (!thought) return;

    const slugBase = thought
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .join("-") || `first-thought-${Date.now()}`;

    let candidatePath = `${slugBase}.md`;
    let suffix = 2;
    while (await api.fileExists(candidatePath)) {
      candidatePath = `${slugBase}-${suffix}.md`;
      suffix += 1;
    }

    const heading = thought
      .split(/\n+/)
      .find((line) => line.trim().length > 0)
      ?.trim()
      .slice(0, 80) || "First thought";

    const content = `# ${heading}\n\n${thought}\n`;
    await api.createFile(candidatePath, content);
    if (collaborationEngine.activeSpaceId) {
      await collaborationEngine.persistNoteEdit(candidatePath, content);
      syncEngine.triggerPush();
    }
    await refreshFileTree();
    await openFile(candidatePath, "editor");
    setFirstThoughtDraft("");
    setFirstThoughtExpansionPlan(null);
    setShowFirstThoughtExpansionHint(false);
    setShownFirstThoughtExpansionDraftKey(null);
    setDismissedFirstThoughtExpansionDraftKey(null);

    const store = loadStore();
    void embedNote(store, candidatePath, content);
    void getAnnotation(candidatePath, content)
      .then((annotation) => {
        if (annotation) {
          setInlineAnnotationByPath(prev => ({ ...prev, [candidatePath]: annotation }));
        }
      })
      .catch(() => {
        // ignore annotation failures in FTUX entry
      });
  }, [firstThoughtDraft, refreshFileTree, vaultPath, openFile]);

  const handleToggleCanvas = async () => {
    const path = await createCanvasDocumentWithPrompt("Untitled canvas");
    if (!path) return;
    await openFile(path, "preview");
  };

  const getActiveCanvasPath = useCallback((): string | null => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && isCanvasFile(tab.path)) return tab.path;
    if (showCanvas && canvasFilePath) return canvasFilePath;
    return null;
  }, [tabs, activeTabId, showCanvas, canvasFilePath]);

  const readCanvasDocument = useCallback(async (): Promise<{
    path: string;
    content: string;
  } | null> => {
    const path = getActiveCanvasPath();
    if (!path) return null;
    try {
      const content = await api.readFile(path);
      return {
        path,
        content: content?.trim()
          ? content
          : JSON.stringify({ nodes: [], edges: [] }, null, 2),
      };
    } catch {
      return {
        path,
        content: JSON.stringify({ nodes: [], edges: [] }, null, 2),
      };
    }
  }, [getActiveCanvasPath]);

  const handleDuplicateCanvas = useCallback(async () => {
    const source = await readCanvasDocument();
    if (!source) return;
    const baseName =
      source.path
        .replace(/\.canvas$/i, "")
        .split("/")
        .pop() || "Canvas copy";
    const targetName = await promptForInput(
      "Duplicate Canvas",
      "Enter duplicate canvas name:",
      `${baseName} copy`,
    );
    if (!targetName) return;

    const targetPath = await getUniqueCanvasPath(targetName);
    await api.createFile(targetPath, source.content);
    await refreshFileTree();
    await openFile(targetPath, "preview");
  }, [
    readCanvasDocument,
    promptForInput,
    getUniqueCanvasPath,
    refreshFileTree,
    openFile,
  ]);

  const handleSaveCanvasAs = useCallback(async () => {
    const source = await readCanvasDocument();
    if (!source) return;
    const baseName =
      source.path
        .replace(/\.canvas$/i, "")
        .split("/")
        .pop() || "Canvas";
    const targetName = await promptForInput(
      "Save Canvas As",
      "Enter new canvas name:",
      `${baseName} copy`,
    );
    if (!targetName) return;

    const targetPath = await getUniqueCanvasPath(targetName);
    await api.createFile(targetPath, source.content);
    await refreshFileTree();
    await openFile(targetPath, "preview");
  }, [
    readCanvasDocument,
    promptForInput,
    getUniqueCanvasPath,
    refreshFileTree,
    openFile,
  ]);

  const handleNewNote = async (parentPath?: string) => {
    if (!vaultPath) return;

    setModal({
      type: "prompt",
      title: "New Note",
      message: "Enter note name:",
      onConfirm: async (name) => {
        if (typeof name !== "string" || !name.trim()) return;

        const trimmed = name.trim();
        const fileName = /\.(md|canvas)$/i.test(trimmed)
          ? trimmed
          : `${trimmed}.md`;
        
        let activeFolder = "";
        if (parentPath) {
          activeFolder = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
        } else {
          activeFolder =
            settings.defaultNoteLocation === "same-folder" &&
            activeTab?.path &&
            !activeTab.path.startsWith("__") &&
            activeTab.path.includes("/")
              ? activeTab.path.slice(0, activeTab.path.lastIndexOf("/") + 1)
              : "";
        }
        const targetPath = fileName.includes("/") ? fileName : `${activeFolder}${fileName}`;
        const content = isCanvasFile(fileName)
          ? JSON.stringify({ nodes: [], edges: [] }, null, 2)
          : `# ${trimmed.replace(".md", "")}\n\n`;

        await api.createFile(targetPath, content);
        if (collaborationEngine.activeSpaceId && !isCanvasFile(fileName)) {
          await collaborationEngine.persistNoteEdit(targetPath, content);
          syncEngine.triggerPush();
        }
        await refreshFileTree();
        await openFile(targetPath);
      },
    });
  };

  const handleCreateNamedNote = useCallback(
    async (rawName?: string) => {
      if (!vaultPath) return;

      const trimmed = (rawName || "").trim();
      if (!trimmed) {
        await handleNewNote();
        return;
      }

      const fileName = /\.(md|canvas)$/i.test(trimmed)
        ? trimmed
        : `${trimmed}.md`;
      const content = isCanvasFile(fileName)
        ? JSON.stringify({ nodes: [], edges: [] }, null, 2)
        : `# ${trimmed.replace(/\.md$/i, "")}` + "\n\n";

      await api.createFile(fileName, content);
      if (collaborationEngine.activeSpaceId && !isCanvasFile(fileName)) {
        await collaborationEngine.persistNoteEdit(fileName, content);
        syncEngine.triggerPush();
      }
      await refreshFileTree();
      await openFile(fileName);
    },
    [vaultPath, handleNewNote, refreshFileTree, openFile],
  );

  // ── Inline suggestions (appear inside editor) ──────────────────────────
  const {
    inlineSuggestions,
    setInlineSuggestions,
    nextStepSuggestions,
    setNextStepSuggestions,
    inlineSuggestionsByPath,
    setInlineSuggestionsByPath,
    nextStepSuggestionsByPath,
    setNextStepSuggestionsByPath,
    inlineAnnotationByPath,
    setInlineAnnotationByPath,
    generatingInsightPaths,
    setGeneratingInsightPaths,
    showInlineInsightByTab,
    setShowInlineInsightByTab,
    refreshInlineSuggestions,
    refreshInlineAnnotation,
    handleInlineAccept,
    handleInlineReject,
    handleGenerateInsight,
  } = useInlineSuggestions({
    vaultPath,
    tabs,
    activeTabId,
    paneTree,
    setCurrentContent,
    loadBacklinks,
    currentContentRef,
    collectAllActiveTabPaths,
  });

  const handleSave = async () => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (!isHostEditableMarkdownPath(tab.path)) return;
    if (currentContentPathRef.current !== tab.path) {
      console.warn("[Editor] Refusing to save content for mismatched path", {
        targetPath: tab.path,
        contentPath: currentContentPathRef.current,
      });
      showToast("Save skipped because editor content is still loading. Try again in a moment.", "error");
      return;
    }

    const saveContent = currentContentRef.current;
    await api.writeFile(tab.path, saveContent);
    window.dispatchEvent(
      new CustomEvent("openonyx:note-content-changed", {
        detail: { path: tab.path, content: saveContent },
      }),
    );
    // Auto-embed in background
    void indexMarkdownFileNow(tab.path, saveContent);

    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isModified: false } : t)),
    );
    await refreshFileTree();
  };

  const handleContentChangeGlobal = useCallback(
    (path: string, content: string, markModified = true) => {
      if (!isHostEditableMarkdownPath(path)) return;

      // Keep currentContentRef updated synchronously
      if (activeTabId && tabs.find((t) => t.id === activeTabId)?.path === path) {
        currentContentRef.current = content;
        currentContentPathRef.current = path;

        if (!markModified) {
          if (contentUpdateTimeoutRef.current) {
            clearTimeout(contentUpdateTimeoutRef.current);
            contentUpdateTimeoutRef.current = null;
          }
          pendingContentUpdateRef.current = null;
          setCurrentContent(content);
          loadBacklinks(path);
          return;
        }

        // Debounce setCurrentContent and CustomEvent dispatch
        pendingContentUpdateRef.current = { path, content };
        if (contentUpdateTimeoutRef.current) {
          clearTimeout(contentUpdateTimeoutRef.current);
        }
        contentUpdateTimeoutRef.current = setTimeout(() => {
          contentUpdateTimeoutRef.current = null;
          flushContentUpdate();
        }, 250);
      }

      if (!markModified) return;

      // Mark tab as modified
      setTabs((prev) => {
        const target = prev.find((t) => t.path === path);
        if (target && target.isModified) return prev;
        return prev.map((t) =>
          t.path === path ? { ...t, isModified: true } : t,
        );
      });

      // Auto-embed in background when typing stops
      clearAutoSaveTimer();
      autoSaveTimer.current = setTimeout(() => {
        autoSaveTimer.current = null;
        void indexMarkdownFileNow(path, content);
      }, 2000);
    },
    [activeTabId, tabs, flushContentUpdate, loadBacklinks],
  );

  // Auto-save with debounce
  const handleContentChange = useCallback(
    (content: string) => {
      currentContentRef.current = content;
      const activeTab = tabs.find((t) => t.id === activeTabId);
      currentContentPathRef.current = activeTab?.path || null;
      setCurrentContent(content);

      if (
        activeTab &&
        isHostEditableMarkdownPath(activeTab.path)
      ) {
        window.dispatchEvent(
          new CustomEvent("openonyx:note-content-changed", {
            detail: { path: activeTab.path, content },
          }),
        );
      }

      // Mark tab as modified
      setTabs((prev) => {
        const target = prev.find((t) => t.id === activeTabId);
        if (target && target.isModified) return prev;
        return prev.map((t) =>
          t.id === activeTabId ? { ...t, isModified: true } : t,
        );
      });

      // Auto-save after 2 seconds of no typing
      clearAutoSaveTimer();
      autoSaveTimer.current = setTimeout(async () => {
        autoSaveTimer.current = null;
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab && isHostEditableMarkdownPath(tab.path)) {
          await api.writeFile(tab.path, content);
          window.dispatchEvent(
            new CustomEvent("openonyx:note-content-changed", {
              detail: { path: tab.path, content },
            }),
          );
          // Auto-embed on auto-save (background)
          void indexMarkdownFileNow(tab.path, content);

          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId ? { ...t, isModified: false } : t,
            ),
          );
        }
      }, 2000);
    },
    [activeTabId, tabs, clearAutoSaveTimer],
  );

  useEffect(() => {
    return () => {
      clearAutoSaveTimer();
    };
  }, [clearAutoSaveTimer]);

  const handleTabReorder = useCallback((draggedId: string, targetId: string, insertBefore: boolean) => {
    // Find target tab's groupId
    const targetTab = tabs.find(t => t.id === targetId);
    const targetGroupId = targetTab ? targetTab.groupId : null;

    setPaneTree((prev) => {
      // First update the groupId of the dragged tab in the tree
      const updateTabGroup = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          return {
            ...node,
            tabs: node.tabs.map(t => t.id === draggedId ? { ...t, groupId: targetGroupId } : t)
          };
        }
        return {
          ...node,
          children: [
            updateTabGroup(node.children[0]),
            updateTabGroup(node.children[1])
          ] as [PaneNode, PaneNode]
        };
      };
      const updatedTree = updateTabGroup(prev);
      const newTree = moveTabInTree(updatedTree, draggedId, targetId, insertBefore);
      // Synchronize flat tabs state
      const allTabs = collectAllTabs(newTree);
      setTabs((previousTabs) =>
        activeGroupId
          ? mergePaneTabsWithPreservedUngrouped(allTabs, previousTabs, groups)
          : allTabs,
      );
      return newTree;
    });
  }, [activeGroupId, groups, tabs]);

  const handleTabSelect = async (id: string) => {
    const selectedTab = tabs.find((t) => t.id === id);
    const targetGroupId = selectedTab ? selectedTab.groupId : null;
    const isKnownGroupTab = !!targetGroupId && groups.some((group) => group.id === targetGroupId);

    if (!activeGroupId && isKnownGroupTab) {
      await handleRestoreGroup(targetGroupId, undefined, id);
      return;
    }

    if (activeGroupId && targetGroupId !== activeGroupId) {
      // Auto-save the current layout state to the database before exiting the group
      const activeGroup = groups.find((g) => g.id === activeGroupId);
      if (activeGroup) {
        const currentScrolls: Record<string, number> = {};
        const currentCursors: Record<string, number> = {};
        const currentViewModes: Record<string, string> = {};

        const allOpenTabs = collectAllTabs(paneTree);
        for (const t of allOpenTabs) {
          const cached = scrollCursorCacheRef.current[t.path];
          if (cached) {
            if (cached.scroll !== undefined) currentScrolls[t.path] = cached.scroll;
            if (cached.cursor !== undefined) currentCursors[t.path] = cached.cursor;
            if (cached.viewMode !== undefined) currentViewModes[t.path] = cached.viewMode;
          }
        }

        const updatedGroup: LocalGroup = {
          ...activeGroup,
          updated_at: new Date().toISOString(),
          layout_state: {
            paneTree,
            activeTabId,
            focusedLeafId,
            scrollPositions: currentScrolls,
            cursorPositions: currentCursors,
            viewModes: currentViewModes,
          },
        };

        // Save layout to local database
        localDB.putGroup(updatedGroup)
          .then(() => {
            setGroups((prev) =>
              prev.map((g) => (g.id === activeGroupId ? updatedGroup : g))
            );
          })
          .catch((err) => console.error("Auto-save group failed before switching to ungrouped tab:", err));
      }

      if (isKnownGroupTab) {
        await handleRestoreGroup(targetGroupId, undefined, id);
        return;
      }

      setActiveGroupId(null);

      if (selectedTab) {
        const ungroupedTabs = getUngroupedTabsToPreserve(tabs, collectAllTabs(paneTree), groups);
        if (!ungroupedTabs.some(t => t.id === selectedTab.id)) {
          ungroupedTabs.push(selectedTab);
        }

        const newTree: PaneLeaf = {
          type: 'leaf',
          id: generateId(),
          tabs: ungroupedTabs,
          activeTabId: selectedTab.id,
        };

        skipTabSyncRef.current = true;
        setPaneTree(newTree);
        setTabs(ungroupedTabs);
        setActiveTabId(selectedTab.id);
        setFocusedLeafId(newTree.id);

        if (isCanvasFile(selectedTab.path)) {
          setRecentCanvasFiles((prev) => {
            const filtered = prev.filter((p) => p !== selectedTab.path);
            return [selectedTab.path, ...filtered].slice(0, 12);
          });
          setShowThoughtModel(false);
          setShowGraph(false);
          setShowCanvas(false);
          setCanvasFullScreen(false);
          setCanvasFilePath(selectedTab.path);
          setCurrentContent("");
          setBacklinks([]);
        } else if (selectedTab.path !== "__new_tab__" && selectedTab.path !== GRAPH_TAB_PATH && selectedTab.path !== SPACES_TAB_PATH && !selectedTab.path.startsWith('__plugin__.')) {
          setCurrentContent("");
          setBacklinks([]);
        } else {
          setCurrentContent("");
          setBacklinks([]);
        }
      }
      return;
    }

    setActiveTabId(id);
    
    // Sync with pane tree
    const targetLeaf = findLeafWithTab(paneTree, id);
    if (targetLeaf) {
      setFocusedLeafId(targetLeaf.id);
      setPaneTree((prev) => setActiveTabInLeaf(prev, targetLeaf.id, id));
    }
    const tab = selectedTab;
    if (tab) {
      if (isCanvasFile(tab.path)) {
        await openFile(tab.path, "preview");
        return;
      }
      if (tab.path === GRAPH_TAB_PATH) {
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      if (tab.path === SPACES_TAB_PATH) {
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      if (tab.path.startsWith('__plugin__.')) {
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      if (tab.path === "__new_tab__") {
        setCurrentContent("");
        setBacklinks([]);
        return;
      }
      setCurrentContent("");
      setBacklinks([]);
    }
  };

  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Auto-save before closing
    if (
      tab.isModified &&
      tab.id === activeTabId &&
      isHostEditableMarkdownPath(tab.path) &&
      currentContentPathRef.current === tab.path
    ) {
      await api.writeFile(tab.path, currentContent);
    } else if (
      tab.isModified &&
      tab.id === activeTabId &&
      isHostEditableMarkdownPath(tab.path) &&
      currentContentPathRef.current !== tab.path
    ) {
      console.warn("[Editor] Skipped close-tab write for mismatched content path", {
        targetPath: tab.path,
        contentPath: currentContentPathRef.current,
      });
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      if (newTabs.length > 0) {
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab.id);
        if (
          lastTab.path === "__new_tab__" ||
          isCanvasFile(lastTab.path) || 
          lastTab.path === GRAPH_TAB_PATH || 
          lastTab.path === SPACES_TAB_PATH || 
          lastTab.path.startsWith('__plugin__.')
        ) {
          setCurrentContent("");
          setBacklinks([]);
        } else {
          setCurrentContent("");
          setBacklinks([]);
        }
      } else {
        // Automatically open a new tab if everything is closed
        handleOpenNewTab();
      }
    }
  };

  const selectRelativeTab = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length <= 1) return;
      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      if (currentIndex === -1) return;

      const nextIndex =
        direction === 1
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;

      const nextTab = tabs[nextIndex];
      if (nextTab) {
        void handleTabSelect(nextTab.id);
      }
    },
    [activeTabId, tabs, handleTabSelect],
  );

  useEffect(() => {
    const onSave = () => {
      void handleSave();
    };

    const onCloseTab = () => {
      if (activeTabId) {
        void closeTab(activeTabId);
      }
    };

    const onNewNote = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>;
      void handleCreateNamedNote(customEvent.detail?.name);
    };

    const onSplitView = () => {
      setViewMode("split");
    };

    const onOpenGraph = () => {
      openGraphAsTab();
    };

    const onOpenChat = () => {
      setShowGraph(false);
      setShowCanvas(false);
      setShowThoughtModel(true);
    };

    const onDailyNote = () => {
      if (settings.coreDailyNotes !== false) void handleCreateDailyNote();
    };

    const onFuzzySearch = (_event: Event) => {
      if (settings.coreQuickSwitcher === false) return;
      setShowSidebar(true);
      setShowSearch(true);
    };

    const onToggleBacklinks = () => {
      if (settings.coreBacklinks === false) return;
      handleToggleBacklinks();
    };

    const onGlobalSearch = (event?: Event) => {
      const customEvent = event as CustomEvent<{ query?: string; mode?: "search" | "switcher" }>;
      setSearchInitialQuery(customEvent?.detail?.query || "");
      setSearchInitialMode(customEvent?.detail?.mode || "switcher");
      setShowSidebar(true);
      setShowSearch(true);
    };

    const onShowPrompt = (event: Event) => {
      const customEvent = event as CustomEvent<{
        title: string;
        message: string;
        defaultValue?: string;
        onConfirm: (result: string) => void;
      }>;
      const { title, message, defaultValue, onConfirm } = customEvent.detail || {};
      setModal({
        type: "prompt",
        title: title || "Prompt",
        message: message || "",
        defaultValue: defaultValue || "",
        onConfirm: (result) => {
          if (typeof result === "string") {
            onConfirm?.(result);
          }
        },
      });
    };

    const onRefreshFileTreeEvent = () => {
      void refreshFileTree();
    };

    const onCommandPalette = () => {
      if (settings.coreCommandPalette === false) return;
      setShowCommandPalette(true);
    };

    const onNextTab = () => {
      selectRelativeTab(1);
    };

    const onPrevTab = () => {
      selectRelativeTab(-1);
    };

    const onNoteSaved = (event: Event) => {
      const customEvent = event as CustomEvent<{ path: string }>;
      const path = customEvent.detail?.path;
      if (path) {
        setTabs((prev) =>
          prev.map((t) => (t.path === path ? { ...t, isModified: false } : t))
        );
      }
    };

    const onFileRenamed = (event: Event) => {
      const customEvent = event as CustomEvent<{ oldPath: string; newPath: string; isDirectory?: boolean }>;
      const { oldPath, newPath, isDirectory } = customEvent.detail || {};
      if (!oldPath || !newPath || oldPath === newPath) return;
      updateEmbeddingsAfterRename(oldPath, newPath, Boolean(isDirectory));
      updateOpenPathsAfterRename(oldPath, newPath, Boolean(isDirectory));
      void refreshFileTree();
    };

    const onFileDeleted = (event: Event) => {
      const customEvent = event as CustomEvent<{ path: string; isDirectory?: boolean }>;
      const { path, isDirectory } = customEvent.detail || {};
      if (!path) return;

      // Close tabs
      tabs.forEach((tab) => {
        if (
          isDirectory
            ? (tab.path === path || tab.path.startsWith(path + "/"))
            : tab.path === path
        ) {
          void closeTab(tab.id);
        }
      });

      // Remove embeddings
      const store = loadStore();
      if (isDirectory) {
        removeEmbeddingsByPrefix(store, path);
      } else if (path.toLowerCase().endsWith(".md")) {
        removeEmbedding(store, path);
      }

      // Remove bookmarks
      removeBookmarksForPath(path, Boolean(isDirectory));

      void refreshFileTree();
    };

    window.addEventListener("oo:save", onSave as EventListener);
    window.addEventListener("oo:close-tab", onCloseTab as EventListener);
    window.addEventListener("oo:new-note", onNewNote as EventListener);
    window.addEventListener("oo:split-view", onSplitView as EventListener);
    window.addEventListener("oo:open-graph", onOpenGraph as EventListener);
    window.addEventListener("oo:open-chat", onOpenChat as EventListener);
    window.addEventListener("oo:daily-note", onDailyNote as EventListener);
    window.addEventListener("oo:fuzzy-search", onFuzzySearch as EventListener);
    window.addEventListener("oo:toggle-backlinks", onToggleBacklinks as EventListener);
    window.addEventListener("oo:global-search", onGlobalSearch as EventListener);
    window.addEventListener("oo:show-prompt", onShowPrompt as EventListener);
    window.addEventListener("oo:refresh-file-tree", onRefreshFileTreeEvent as EventListener);
    window.addEventListener("oo:command-palette", onCommandPalette as EventListener);
    window.addEventListener("oo:next-tab", onNextTab as EventListener);
    window.addEventListener("oo:prev-tab", onPrevTab as EventListener);
    window.addEventListener("openonyx:note-saved", onNoteSaved as EventListener);
    window.addEventListener("openonyx:file-renamed", onFileRenamed as EventListener);
    window.addEventListener("openonyx:file-deleted", onFileDeleted as EventListener);

    return () => {
      window.removeEventListener("oo:save", onSave as EventListener);
      window.removeEventListener("oo:close-tab", onCloseTab as EventListener);
      window.removeEventListener("oo:new-note", onNewNote as EventListener);
      window.removeEventListener("oo:split-view", onSplitView as EventListener);
      window.removeEventListener("oo:open-graph", onOpenGraph as EventListener);
      window.removeEventListener("oo:open-chat", onOpenChat as EventListener);
      window.removeEventListener("oo:daily-note", onDailyNote as EventListener);
      window.removeEventListener("oo:fuzzy-search", onFuzzySearch as EventListener);
      window.removeEventListener("oo:toggle-backlinks", onToggleBacklinks as EventListener);
      window.removeEventListener("oo:global-search", onGlobalSearch as EventListener);
      window.removeEventListener("oo:show-prompt", onShowPrompt as EventListener);
      window.removeEventListener("oo:refresh-file-tree", onRefreshFileTreeEvent as EventListener);
      window.removeEventListener("oo:command-palette", onCommandPalette as EventListener);
      window.removeEventListener("oo:next-tab", onNextTab as EventListener);
      window.removeEventListener("oo:prev-tab", onPrevTab as EventListener);
      window.removeEventListener("openonyx:note-saved", onNoteSaved as EventListener);
      window.removeEventListener("openonyx:file-renamed", onFileRenamed as EventListener);
      window.removeEventListener("openonyx:file-deleted", onFileDeleted as EventListener);
    };
  }, [
    activeTabId,
    closeTab,
    handleCreateNamedNote,
    handleSave,
    openGraphAsTab,
    selectRelativeTab,
    refreshFileTree,
    updateEmbeddingsAfterRename,
    updateOpenPathsAfterRename,
    tabs,
    settings.coreBacklinks,
    settings.coreCommandPalette,
    settings.coreDailyNotes,
    settings.coreQuickSwitcher,
  ]);

  // ── Link Navigation ─────────────────────────────────
  const handleLinkClick = async (linkName: string, heading?: string) => {
    const rawLink = decodeURIComponent(linkName).replace(/\\/g, "/").replace(/^\/+/, "");
    const normalizedLink = rawLink.replace(/\.(md|canvas)$/i, "").toLowerCase();
    const linkBaseName = normalizedLink.split("/").pop() || normalizedLink;

    // Get current note's directory path for relative resolution
    const activePath = activeTab?.path || "";
    const activeDir = activePath.includes("/")
      ? activePath.slice(0, activePath.lastIndexOf("/")).toLowerCase()
      : "";

    // Collect all files from fileTree
    const allFiles: { path: string; notePath: string; noteName: string; dirPath: string }[] = [];
    const collectFiles = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const notePath = entry.path.replace(/\.(md|canvas)$/i, "").toLowerCase();
          const noteName = (entry.path.replace(/\.(md|canvas)$/i, "").split("/").pop() || entry.path).toLowerCase();
          const dirPath = entry.path.includes("/")
            ? entry.path.slice(0, entry.path.lastIndexOf("/")).toLowerCase()
            : "";
          allFiles.push({ path: entry.path, notePath, noteName, dirPath });
        }
        if (entry.children) {
          collectFiles(entry.children);
        }
      }
    };
    collectFiles(fileTree);

    // Resolution strategy:
    // 1. Exact full path match (e.g., "FolderB/Test" === "folderb/test")
    let target = allFiles.find((f) => f.notePath === normalizedLink);

    // 2. Suffix path match (e.g., "sub/folderb/test" ends with "/folderb/test")
    if (!target && normalizedLink.includes("/")) {
      target = allFiles.find(
        (f) => f.notePath.endsWith("/" + normalizedLink) || normalizedLink.endsWith("/" + f.notePath),
      );
    }

    // 3. Same directory match (if link is "Test", prefer "Test" in active file's folder)
    if (!target && activeDir) {
      target = allFiles.find(
        (f) => f.dirPath === activeDir && (f.noteName === linkBaseName || f.notePath.endsWith("/" + linkBaseName)),
      );
    }

    // 4. Exact note name match anywhere in the vault
    if (!target) {
      target = allFiles.find((f) => f.noteName === linkBaseName);
    }

    const filePath = target?.path;
    if (filePath) {
      await openFile(filePath, "preview");
      // Scroll to heading if specified
      if (heading) {
        setTimeout(() => {
          const allHeadings = document.querySelectorAll(
            ".markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4, .markdown-preview h5, .markdown-preview h6",
          );
          for (const h of allHeadings) {
            if (h.textContent?.toLowerCase().includes(heading.toLowerCase())) {
              h.scrollIntoView({ behavior: "smooth", block: "start" });
              break;
            }
          }
        }, 100);
      }
    } else {
      // Auto-create note if it doesn't exist
      const newPath = rawLink.toLowerCase().endsWith(".md") || rawLink.toLowerCase().endsWith(".canvas")
        ? rawLink
        : `${rawLink}.md`;
      const targetPath = newPath.includes("/")
        ? newPath
        : (activeDir ? `${activeDir}/${newPath}` : newPath);
      const content = `# ${rawLink.split("/").pop()?.replace(/\.(md|canvas)$/i, "") || rawLink}\n\n`;
      await api.createFile(targetPath, content);
      // Sync newly auto-created note to cloud
      if (collaborationEngine.activeSpaceId) {
        await collaborationEngine.persistNoteEdit(targetPath, content);
        syncEngine.triggerPush();
      }
      await refreshFileTree();
      await openFile(targetPath, "preview");
    }
  };

  // ── File Management ─────────────────────────────────
  // Get list of all note names for autocomplete
  const allNoteNames = useMemo(() => {
    const getNotes = (
      entries: FileEntry[],
    ): { name: string; path: string }[] => {
      const notes: { name: string; path: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory && (entry.extension === ".md" || entry.extension === ".canvas")) {
          // Extract name without extension
          const name =
            entry.path.replace(/\.(md|canvas)$/i, "").split("/").pop() || entry.path;
          notes.push({ name, path: entry.path });
        }
        if (entry.children) {
          notes.push(...getNotes(entry.children));
        }
      }
      return notes;
    };
    return getNotes(fileTree);
  }, [fileTree]);

  const { handleRenameFile, handleMoveFile } = useRenameNote({
    fileTree,
    settings,
    allNoteNames,
    ooAppRef,
    clearAutoSaveTimer,
    updateEmbeddingsAfterRename,
    updateOpenPathsAfterRename,
    remapBookmarkPaths,
    refreshFileTree,
    setModal,
  });

  const {
    handleDeleteFile,
    getAbsoluteVaultPath,
    handleNoteMenuToggleBacklinks,
    handleSplitNotePane,
    handleNoteMenuRename,
    handleNoteMenuMove,
    handleCopyNoteRelativePath,
    handleCopyNoteAbsolutePath,
    handleOpenNoteInDefaultApp,
    handleShowNoteInSystemExplorer,
    handleRevealNoteInNavigation,
    handleCreateFolder,
    handleCreateDailyNote,
    handleTemplateInsert,
    handleImagePaste,
    getNoteContent,
  } = useFileOperations({
    vaultPath,
    settings,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    paneTree,
    setPaneTree,
    focusedLeafId,
    setFocusedLeafId,
    activeGroupId,
    groups,
    currentContent,
    setCurrentContent,
    closeTab,
    refreshFileTree,
    setModal,
    showToast,
    promptForInput,
    clearAutoSaveTimer,
    updateEmbeddingsAfterRename,
    updateOpenPathsAfterRename,
    remapBookmarkPaths,
    removeBookmarksForPath,
    openFile,
    skipTabSyncRef,
    handleRenameFile,
    handleMoveFile,
    allNoteNames,
    noteContentCache,
    setNoteContentCache,
  });

  const handleRevealFolderInNavigation = useCallback((path: string) => {
    setShowSidebar(true);
    setShowSearch(false);
    setShowBookmarks(false);
    ooAppRef.current?.workspace?.revealDefaultView?.("left");
    setFolderRevealRequest((previous) => ({
      path,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);
  const handleRevealFolderHandled = useCallback(() => {
    setFolderRevealRequest(null);
  }, []);

  // ── Commands (for Command Palette) ──────────────────
  const commands = useAppCommands({
    handleNewNote,
    handleOpenVault,
    handleSave,
    openGraphAsTab,
    setShowSidebar,
    setSearchInitialMode,
    setShowSearch,
    settings,
    handleToggleBacklinks,
    handleToggleOutline,
    setShowTags,
    handleToggleOutgoingLinks,
    setShowProperties,
    handleCreateDailyNote,
    setShowTemplateModal,
    setShowThoughtModel,
    setSettings,
    setSettingsSection,
    setShowSettings,
    setViewMode,
    handleToggleCanvas,
    handleDuplicateCanvas,
    handleSaveCanvasAs,
    recentCanvasFiles,
    openFile,
    setShowUnlinkedMentions,
  });

  // Get active tab info
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // ── Collaboration State ────────────────────────────────
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [invitesSent, setInvitesSent] = useState<any[]>([]);
  const [invitesReceived, setInvitesReceived] = useState<any[]>([]);

  const [currentUser, setCurrentUser] = useState(authManager.getUser());
  const [authLoading, setAuthLoading] = useState(authManager.getState().isLoading);

  useEffect(() => {
    const unsub = authManager.subscribe((state) => {
      setCurrentUser(state.user);
      setAuthLoading(state.isLoading);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!vaultPath) return;
    if (!isSupabaseConfigured) {
      collaborationEngine.clearActiveSpace();
      syncEngine.setActiveVault(null);
      setCollaborators([]);
      setActiveUsers([]);
      setInvitesSent([]);
      setInvitesReceived([]);
      return;
    }

    const currentUserId = currentUser?.id || null;
    const prevSub = collabSubRef.current;
    const didContextChange = prevSub.vaultPath !== vaultPath || prevSub.userId !== currentUserId;

    if (didContextChange) {
      // Context changed (e.g. vault switch or login/logout). Fully clear old space.
      collaborationEngine.clearActiveSpace();
      setCollaborators([]);
      setActiveUsers([]);
      setInvitesSent([]);

      collabSubRef.current = {
        vaultPath,
        userId: currentUserId,
        spaceId: null,
      };
    }

    // Connect sync engine to vault
    syncEngine.setActiveVault(vaultPath);

    // One-time initialization: find the space, subscribe to realtime.
    // This runs once per context change (vault switch or login).
    const initCollab = async () => {
      try {
        const space = await collaborationEngine.getSpaceForVault(vaultPath);
        if (space) {
          collabSubRef.current.spaceId = space.id;

          const collabs = await collaborationEngine.getCollaborators(space.id);
          setCollaborators(collabs);

          const sent = await collaborationEngine.getSentInvites(space.id);
          setInvitesSent(sent);

          // Subscribe to realtime changes + presence (called ONCE, not in polling)
          await collaborationEngine.subscribeToSpace(space.id);
        } else {
          setCollaborators([]);
          setActiveUsers([]);
          setInvitesSent([]);
        }
      } catch (err) {
        console.error('[App] Failed to init collab state:', err);
      }

      try {
        const incoming = await collaborationEngine.getIncomingInvites();
        setInvitesReceived(incoming);
      } catch { /* ignore */ }
    };

    // Lightweight polling: only refreshes collaborator lists and invites.
    // Does NOT call subscribeToSpace (that would tear down and recreate the channel).
    const refreshCollabData = async () => {
      const spaceId = collabSubRef.current.spaceId;
      if (!spaceId) return;

      try {
        const collabs = await collaborationEngine.getCollaborators(spaceId);
        setCollaborators(collabs);

        const sent = await collaborationEngine.getSentInvites(spaceId);
        setInvitesSent(sent);
      } catch { /* ignore */ }

      try {
        const incoming = await collaborationEngine.getIncomingInvites();
        setInvitesReceived(incoming);
      } catch { /* ignore */ }
    };

    // Listen for realtime presence updates from CollaborationEngine
    const unsubActiveUsers = collaborationEngine.onActiveUsersChange((users) => {
      setActiveUsers(users);
    });

    initCollab();
    const interval = setInterval(refreshCollabData, 15000);

    return () => {
      clearInterval(interval);
      unsubActiveUsers();
      // We DO NOT unsubscribe here to avoid tearing down the channel on every render.
      // Unsubscription is handled on context change (above) or actual component unmount (below).
    };
  }, [vaultPath, currentUser, authLoading]);

  // Unmount-only cleanup for collaboration and syncEngine
  useEffect(() => {
    return () => {
      collaborationEngine.clearActiveSpace();
      syncEngine.setActiveVault(null);
    };
  }, []);

  // Listen to collaboration bootstrapping status globally
  useEffect(() => {
    const unsub = collaborationEngine.onStatusChange((status) => {
      setCollabStatus(status);
      if (status.state === 'bootstrapping') {
        setShowSettings(false); // Close Settings modal instantly so the user can see the progress!
      }
      if (status.state === 'syncing' || status.state === 'ready') {
        if (vaultPath) {
          syncEngine.setActiveVault(vaultPath);
        }
        (async () => {
          const tree = await api.getFileTree();
          setFileTree(tree);
          runVaultInit(tree);
        })();
      }
    });
    return unsub;
  }, [vaultPath]);

  // Listen to sync engine status for the status bar indicator
  useEffect(() => {
    const unsub = syncEngine.onStatusChange((status) => {
      setSyncStatus(status);
      if (status.state === 'idle' && (status.pulled ?? 0) > 0) {
        void refreshFileTree();
      }
      // Auto-clear the "N synced" idle indicator after 5 seconds
      if (status.state === 'idle' && (status.pushed || status.pulled)) {
        const timer = setTimeout(() => {
          setSyncStatus((prev) => {
            if (prev && prev.state === 'idle') {
              return { state: 'idle', lastSync: prev.lastSync };
            }
            return prev;
          });
        }, 5000);
        return () => clearTimeout(timer);
      }
    });
    return unsub;
  }, [refreshFileTree]);

  // Update presence when active note changes
  useEffect(() => {
    collaborationEngine.updatePresenceNote(activeTab?.path || null);
  }, [activeTab?.path]);

  // Combine collaborators for the SettingsPage display
  const displayCollaborators = React.useMemo(() => {
    return [...collaborators].sort((a, b) => {
      if (a.role === 'owner') return -1;
      if (b.role === 'owner') return 1;
      return 0;
    });
  }, [collaborators]);

  const handleInviteUser = async (email: string) => {
    const space = await collaborationEngine.getSpaceForVault(vaultPath || '');
    if (!space) return;
    try {
      await collaborationEngine.sendInvite(space.id, email);
      const sent = await collaborationEngine.getSentInvites(space.id);
      setInvitesSent(sent);
    } catch (err: any) {
      console.error('[App] Failed to send invite:', err);
    }
  };

  const handleRemoveCollaborator = async (id: string) => {
    setCollaborators((prev: any[]) => prev.filter((c: any) => c.id !== id));
  };

  const handleAcceptInvite = async (id: string) => {
    try {
      await collaborationEngine.acceptInvite(id);
      setInvitesReceived((prev: any[]) => prev.filter((i: any) => i.id !== id));
    } catch (err: any) {
      console.error('[App] Failed to accept invite:', err);
    }
  };

  const handleRejectInvite = async (id: string) => {
    try {
      await collaborationEngine.rejectInvite(id);
      setInvitesReceived((prev: any[]) => prev.filter((i: any) => i.id !== id));
    } catch (err: any) {
      console.error('[App] Failed to reject invite:', err);
    }
  };

  const activeTabIsCanvas = !!activeTab && isCanvasFile(activeTab.path);
  const activeTabIsGraph = !!activeTab && activeTab.path === GRAPH_TAB_PATH;
  const activeTabIsSpaces = !!activeTab && activeTab.path === SPACES_TAB_PATH;
  const activeTabIsPlugin = !!activeTab && activeTab.path.startsWith('__plugin__.');

  // Sync active file path to plugin API
  (window as any).__oo_active_file = activeTab?.path || null;
  useEffect(() => {
    const app = ooAppRef.current;
    if (!app) return;
    const path = activeTab?.path;
    const isFile = Boolean(
      path
      && path !== '__new_tab__'
      && path !== GRAPH_TAB_PATH
      && path !== SPACES_TAB_PATH
      && !path.startsWith('__plugin__.'),
    );
    const file = isFile ? app.vault.getFileByPath(path!) : null;
    const view = app.workspace.activeLeaf?.view;

    if (view?.getViewType?.() === 'markdown') {
      setWritableViewProperty(view, 'file', file);
      (view as any).data = file ? currentContentRef.current : '';
    }
    if (app.workspace.activeEditor) {
      setWritableViewProperty(app.workspace.activeEditor, 'file', file);
      setWritableViewProperty(app.workspace.activeEditor, 'view', view);
    }
    (app.workspace as any).lastActiveFile = file;
    app.workspace.trigger('file-open', file);
  }, [activeTab?.path]);

  const isFTUXZeroState = Boolean(vaultPath) && ftuxState.notesCount === 0;

  const hasAuxPane = showGraph || showCanvas;
  const shouldShowEditorPane =
    (!showGraph || !graphFullScreen) &&
    (!showCanvas || !canvasFullScreen) &&
    (activeTab || !hasAuxPane);
  const shouldShowPaneResizer =
    shouldShowEditorPane && !graphFullScreen && !canvasFullScreen && hasAuxPane;

  const showVaultEntryTransitionScene =
    vaultEntryTransitionPhase !== "idle" &&
    (!vaultPath || isFTUXZeroState);

  const renderFTUXZeroState = () => (
    <div className={`ftux-zero-state ${hasFirstThoughtKeystroke ? "is-activated" : ""}`}>
      <form
        className={`ftux-first-thought-form ${hasFirstThoughtKeystroke ? "has-content" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateFirstThought();
        }}
      >
        <div className="ftux-orientation-line">Start with a thought</div>

        <div
          className={`ftux-first-thought-shell ${isFirstThoughtFocused ? "is-focused" : ""} ${hasFirstThoughtKeystroke ? "is-typed" : ""}`}
        >
          <div
            className={`ftux-dynamic-prompt ${showFirstThoughtPromptEntry ? "is-visible" : ""} ${firstThoughtPromptCrossfading ? "is-crossfading" : ""} ${hasFirstThoughtKeystroke ? "is-hidden is-instant-hidden" : ""}`}
            style={{
              "--ftux-prompt-fade-ms": `${firstThoughtPromptFadeMs}ms`,
              "--ftux-prompt-overlap-delay-ms": `${firstThoughtPromptOverlapDelayMs}ms`,
            } as React.CSSProperties}
          >
            <span className="ftux-dynamic-prompt-text is-current">
              {FIRST_THOUGHT_PROMPTS[firstThoughtPromptIndex]}
            </span>
            {firstThoughtPromptNextIndex !== null && (
              <span className="ftux-dynamic-prompt-text is-next">
                {FIRST_THOUGHT_PROMPTS[firstThoughtPromptNextIndex]}
              </span>
            )}
          </div>

          <textarea
            ref={firstThoughtInputRef}
            className="ftux-first-thought-input"
            value={firstThoughtDraft}
            rows={3}
            onChange={(event) => {
              const next = event.target.value;
              setFirstThoughtDraft(next);
              if (showFirstThoughtExpansionHint) {
                setShowFirstThoughtExpansionHint(false);
              }
              if (!hasFirstThoughtKeystroke && next.length > 0) {
                if (firstThoughtPromptIntervalRef.current) {
                  clearTimeout(firstThoughtPromptIntervalRef.current);
                  firstThoughtPromptIntervalRef.current = null;
                }
                if (firstThoughtPromptFadeTimerRef.current) {
                  clearTimeout(firstThoughtPromptFadeTimerRef.current);
                  firstThoughtPromptFadeTimerRef.current = null;
                }
                if (firstThoughtEntryPromptTimerRef.current) {
                  clearTimeout(firstThoughtEntryPromptTimerRef.current);
                  firstThoughtEntryPromptTimerRef.current = null;
                }
                if (firstThoughtEntryGhostTimerRef.current) {
                  clearTimeout(firstThoughtEntryGhostTimerRef.current);
                  firstThoughtEntryGhostTimerRef.current = null;
                }
                if (firstThoughtEntryHintTimerRef.current) {
                  clearTimeout(firstThoughtEntryHintTimerRef.current);
                  firstThoughtEntryHintTimerRef.current = null;
                }
                setFirstThoughtPromptCrossfading(false);
                setFirstThoughtPromptNextIndex(null);
                setHasFirstThoughtKeystroke(true);
              }
            }}
            onFocus={() => {
              if (!firstThoughtAutoFocusSkipRef.current) {
                firstThoughtAutoFocusSkipRef.current = true;
                return;
              }
              setIsFirstThoughtFocused(true);
            }}
            onBlur={() => setIsFirstThoughtFocused(false)}
            onKeyDown={(event) => {
              if (!isFirstThoughtFocused) {
                setIsFirstThoughtFocused(true);
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (firstThoughtDraft.trim().length > 0) {
                  void handleCreateFirstThought();
                }
              }
            }}
            placeholder={FIRST_THOUGHT_PROMPTS[firstThoughtPromptIndex]}
            aria-label="Write your first thought"
            autoFocus
          />
        </div>

        {showFirstThoughtExpansionHint && firstThoughtExpansionPlan && (
          <div className="ftux-inline-expand-hint ftux-inline-expand-hint-fade-in">
            <div className="ftux-inline-expand-title">Continue this:</div>
            <ul className="ftux-inline-expand-list" style={{ listStyleType: "none", paddingLeft: 0, marginTop: "8px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {firstThoughtExpansionPlan.suggestions.map((suggestion, index) => (
                <li
                  key={`${firstThoughtExpansionPlan.intent}-${index}`}
                  style={{
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: index === selectedSuggestionIndex ? "1px solid var(--border-strong)" : "1px solid transparent",
                    background: index === selectedSuggestionIndex ? "var(--bg-active)" : "transparent",
                    transition: "all 0.2s ease"
                  }}
                  onClick={() => setSelectedSuggestionIndex(index)}
                  onMouseEnter={(e) => {
                    if (index !== selectedSuggestionIndex) {
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (index !== selectedSuggestionIndex) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <span style={{ marginRight: "8px", opacity: 0.5 }}>•</span>
                  {suggestion.label}
                </li>
              ))}
            </ul>
            <div className="ftux-inline-expand-actions">
              <button
                type="button"
                className="ftux-inline-expand-btn ftux-inline-expand-btn-primary"
                onClick={handleExpandFirstThought}
              >
                Continue
              </button>
              <button
                type="button"
                className="ftux-inline-expand-btn"
                onClick={handleIgnoreFirstThoughtExpansion}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className={`ftux-ghost-examples ${showFirstThoughtGhostEntry ? "is-visible" : ""} ${hasFirstThoughtKeystroke ? "is-hidden" : ""}`}>
          {FIRST_THOUGHT_GHOST_EXAMPLES.map((example) => (
            <div key={example} className="ftux-ghost-example">
              {example}
            </div>
          ))}
        </div>

        <div className={`ftux-intelligence-hint ${showFirstThoughtHintEntry ? "is-visible" : ""} ${hasFirstThoughtKeystroke ? "is-hidden" : ""}`}>
          Your thoughts will start connecting
        </div>
      </form>
    </div>
  );



  // Auto-switch away from detached plugin views in the right sidebar
  useEffect(() => {
    if (
      rightSidebarTab !== "outline" &&
      rightSidebarTab !== "backlinks" &&
      rightSidebarTab !== "outgoing" &&
      rightSidebarTab !== "ai"
    ) {
      const stillExists = rightPluginViews.some((v) => v.viewType === rightSidebarTab);
      if (!stillExists) {
        setRightSidebarTab("outline");
      }
    }
  }, [rightPluginViews, rightSidebarTab]);

  // Auto-open and focus when a new right plugin view is registered
  const prevRightViewsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentTypes = rightPluginViews.map(v => v.viewType);
    const prevTypes = prevRightViewsRef.current;
    
    // Find if there's any new viewType that was not in prevTypes
    const added = currentTypes.find(t => !prevTypes.includes(t));
    if (added) {
      setRightSidebarTab(added);
      setShowRightSidebar(true);
    }
    prevRightViewsRef.current = currentTypes;
  }, [rightPluginViews]);

  // Helper to render regular active tabs (canvas, database, plugin, editor)
  const renderActiveTabContent = useCallback((leafActiveTab: Tab, leaf: PaneLeaf): React.ReactNode => {
    const isThisFocused = leaf.id === focusedLeafId;
    const tabIsCanvas = isCanvasFile(leafActiveTab.path);
    const tabIsPlugin = leafActiveTab.path.startsWith('__plugin__.');

    if (tabIsCanvas) {
      return (
        <CanvasView
          onClose={() => closeTab(leafActiveTab.id)}
          isFullScreen={false}
          onToggleFullScreen={() => setCanvasFullScreen((f) => !f)}
          theme={theme}
          vaultPath={vaultPath!}
          fileTree={fileTree}
          canvasFilePath={leafActiveTab.path}
          spaceId={collaborationEngine.activeSpaceId || undefined}
          onOpenFile={(path) => openFile(path)}
          onNewCanvas={() => { void handleToggleCanvas(); }}
          onDuplicateCanvas={() => { void handleDuplicateCanvas(); }}
          onSaveCanvasAs={() => { void handleSaveCanvasAs(); }}
          recentCanvasFiles={recentCanvasFiles}
          onOpenRecentCanvas={(path) => { void openFile(path, "preview"); }}
        />
      );
    }

    if (leafActiveTab.path.startsWith("__database__.")) {
      const folderPath = leafActiveTab.path.split("__database__.")[1];
      
      const findNodeByPath = (nodes: FileEntry[], targetPath: string): FileEntry | undefined => {
        for (const node of nodes) {
          if (node.path === targetPath) return node;
          if (node.children) {
            const found = findNodeByPath(node.children, targetPath);
            if (found) return found;
          }
        }
        return undefined;
      };

      const folderNode = findNodeByPath(fileTree, folderPath);
      if (!folderNode) {
        return <div className="p-8 text-text-muted">Folder not found: {folderPath}</div>;
      }

      return (
        <DatabaseView
          folderNode={folderNode}
          onOpenFile={openFile}
        />
      );
    }

    if (tabIsPlugin) {
      return (
        <div className="main-plugin-view-container" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', pointerEvents: 'auto' }}>
          <PluginViewPanel
            views={pluginViews.filter(v => `__plugin__.${v.viewType}` === leafActiveTab.path)}
            onClose={(viewType) => {
              const app = ooAppRef.current;
              if (app) app.workspace.detachLeavesOfType(viewType);
            }}
            isMainView={true}
          />
        </div>
      );
    }

    // Regular markdown note
    const currentPath = leafActiveTab?.path || "";
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activeTabIdPath = activeTab?.path || "";

    const leafSuggestions =
      inlineSuggestionsByPath[currentPath] ||
      (currentPath === activeTabIdPath ? inlineSuggestions : []);

    const leafNextStepSuggestions =
      nextStepSuggestionsByPath[currentPath] ||
      (currentPath === activeTabIdPath ? nextStepSuggestions : []);

    return (
      <LeafPaneEditor
        leaf={leaf}
        activeTab={leafActiveTab}
        theme={theme}
        settings={settings}
        allNoteNames={allNoteNames}
        editorSuggestions={leafSuggestions}
        editorNextStepSuggestions={leafNextStepSuggestions}
        inlineAnnotation={inlineAnnotationByPath[leafActiveTab.path] || getCachedAnnotation(leafActiveTab.path)}
        showInlineInsight={!!showInlineInsightByTab[leafActiveTab.id]}
        isFocused={isThisFocused}
        onFocusLeaf={handleFocusLeaf}
        onTabSelect={(leafId, tabId) => handlePaneTabSelect(leafId, tabId)}
        onTabClose={closeTab}
        onLinkClick={handleLinkClick}
        onImagePaste={handleImagePaste}
        getNoteContent={getNoteContent}
        onAdjustFontSize={adjustEditorFontSize}
        onAcceptSuggestion={handleInlineAccept}
        onRejectSuggestion={handleInlineReject}
        onOpenNote={(path) => openFile(path)}
        onToggleInsight={(show) => setShowInlineInsightByTab((prev) => ({ ...prev, [leafActiveTab.id]: show }))}
        onContentChangeGlobal={handleContentChangeGlobal}
        activeUsers={activeUsers}
        getViewState={getViewState}
        onViewStateChange={handleScrollAndCursorChange}
        onGenerateInsight={() => handleGenerateInsight(leafActiveTab.path, leafActiveTab.id)}
        isGeneratingInsight={generatingInsightPaths.has(leafActiveTab.path)}
        onToggleBacklinks={handleNoteMenuToggleBacklinks}
        onSplitRight={(leafId, tab) => handleSplitNotePane(leafId, tab, "right")}
        onSplitDown={(leafId, tab) => handleSplitNotePane(leafId, tab, "bottom")}
        onRenameFileMenu={(path) => void handleNoteMenuRename(path)}
        onMoveFileMenu={(path) => void handleNoteMenuMove(path)}
        onBookmarkFile={setBookmarkModalPath}
        onCopyRelativePath={handleCopyNoteRelativePath}
        onCopyAbsolutePath={handleCopyNoteAbsolutePath}
        onOpenInDefaultApp={(path) => void handleOpenNoteInDefaultApp(path)}
        onShowInSystemExplorer={handleShowNoteInSystemExplorer}
        onRevealInNavigation={handleRevealNoteInNavigation}
        onDeleteFile={(path) => handleDeleteFile(path, false)}
        onPromptInput={promptForInput}
        onShowToast={showToast}
        canCopyAbsolutePath={!!vaultPath}
      />
    );
  }, [
    focusedLeafId, theme, vaultPath, fileTree, viewMode,
    inlineSuggestions, nextStepSuggestions, inlineSuggestionsByPath, nextStepSuggestionsByPath,
    activeTabId, tabs, inlineAnnotationByPath, showInlineInsightByTab,
    mainPluginViews, recentCanvasFiles, allNoteNames, handlePaneTabSelect, activeUsers,
    getViewState, handleScrollAndCursorChange, handleGenerateInsight,
    generatingInsightPaths, handleNoteMenuToggleBacklinks, handleSplitNotePane,
    handleNoteMenuRename, handleNoteMenuMove, handleCopyNoteRelativePath,
    handleCopyNoteAbsolutePath, handleOpenNoteInDefaultApp,
    handleShowNoteInSystemExplorer, handleRevealNoteInNavigation,
    handleDeleteFile, promptForInput, showToast
  ]);

  const renderGraphShell = useCallback(
    ({
      onNodeClick,
      onClose,
      isFullScreen,
      localNodePath,
    }: {
      onNodeClick: (noteName: string, heading?: string, notePath?: string) => void;
      onClose: () => void;
      isFullScreen: boolean;
      localNodePath?: string;
    }) => (
      <div className="graph-mode-shell">
        <div className="graph-mode-switch" role="tablist" aria-label="Graph mode">
          <button
            type="button"
            className={`graph-mode-btn ${graphMode !== "ai" ? "active" : ""}`}
            onClick={() => setGraphMode("manual")}
          >
            Manual
          </button>
          <button
            type="button"
            className={`graph-mode-btn ${graphMode === "ai" ? "active" : ""}`}
            onClick={() => setGraphMode("ai")}
          >
            AI View
          </button>
        </div>

        <div style={{ display: graphMode === "ai" ? "block" : "none", height: "100%", width: "100%" }}>
          <AIKnowledgeGraph
            onNodeClick={onNodeClick}
            onClose={onClose}
            isFullScreen={isFullScreen}
            onToggleFullScreen={() => setGraphFullScreen((f) => !f)}
            theme={theme}
            vaultPath={vaultPath}
            fileTree={fileTree}
            localNodePath={localNodePath}
            onCreateGroupFromPaths={handleCreateGroupFromPaths}
            onOpenPathsAsGroup={handleOpenPathsAsGroup}
          />
        </div>
        <div style={{ display: graphMode !== "ai" ? "block" : "none", height: "100%", width: "100%" }}>
          <GraphView
            onNodeClick={onNodeClick}
            onClose={onClose}
            isFullScreen={isFullScreen}
            onToggleFullScreen={() => setGraphFullScreen((f) => !f)}
            theme={theme}
            vaultPath={vaultPath}
            localNodePath={localNodePath}
          />
        </div>
      </div>
    ),
    [
      graphMode,
      handleCreateGroupFromPaths,
      handleOpenPathsAsGroup,
      fileTree,
      setGraphFullScreen,
      setGraphMode,
      theme,
      vaultPath,
    ],
  );

  // Render content for a single leaf pane in the split system
  const renderPaneContent = useCallback((leaf: PaneLeaf): React.ReactNode => {
    const leafActiveTab = leaf.tabs.find((t) => t.id === leaf.activeTabId);
    if (!leafActiveTab) {
      return (
        <NewTabView
          onNewNote={() => {
            window.dispatchEvent(new CustomEvent("oo:new-note"));
          }}
          onSearch={() => {
            window.dispatchEvent(new CustomEvent("oo:fuzzy-search"));
          }}
        />
      );
    }

    const spacesTab = leaf.tabs.find((t) => t.path === SPACES_TAB_PATH);
    const graphTab = leaf.tabs.find((t) => t.path === GRAPH_TAB_PATH);

    const activePath = leafActiveTab.path;
    const activeIsSpaces = activePath === SPACES_TAB_PATH;
    const activeIsGraph = activePath === GRAPH_TAB_PATH;

    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        {/* Render active tab content (only if not special persistent tabs) */}
        {!activeIsSpaces && !activeIsGraph && (
          <div style={{ width: "100%", height: "100%" }}>
            {renderActiveTabContent(leafActiveTab, leaf)}
          </div>
        )}

        {/* Keep-Alive: Keep SpacesPage mounted in the DOM if it's open */}
        {spacesTab && (
          <div
            style={{
              display: activeIsSpaces ? "block" : "none",
              width: "100%",
              height: "100%",
            }}
          >
            <SpacesPage
              onClose={() => closeTab(spacesTab.id)}
              fileTree={fileTree}
              onOpenNote={(path) => { openFile(path); }}
              vaultPath={vaultPath || undefined}
            />
          </div>
        )}

        {/* Keep-Alive: Keep Graph View mounted in the DOM if it's open */}
        {graphTab && (
          <div
            style={{
              display: activeIsGraph ? "block" : "none",
              width: "100%",
              height: "100%",
            }}
          >
            {renderGraphShell({
              onNodeClick: async (
                linkName: string,
                heading?: string,
                notePath?: string,
              ) => {
                setViewMode("preview");
                if (notePath) {
                  await openFile(notePath, "preview");
                  return;
                }
                await handleLinkClick(linkName, heading);
              },
              onClose: () => closeTab(graphTab.id),
              isFullScreen: false,
              localNodePath: undefined,
            })}
          </div>
        )}
      </div>
    );
  }, [
    tabs, fileTree, closeTab, openFile,
    renderActiveTabContent, handleLinkClick, renderGraphShell
  ]);

  return (
    <DragCtx.Provider value={{ dragCtx, setDragCtx }}>
      <div 
        className={`app${settings.backgroundImage ? " has-wallpaper" : ""}`}
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
          "--right-sidebar-width": `${rightSidebarWidth}px`,
          ...(settings.backgroundImage ? {
            "--inner-panel-bg": "transparent",
            "--bg-primary": "rgba(0, 0, 0, 0.40)",
            "--bg-secondary": "rgba(0, 0, 0, 0.40)",
            "--bg-tertiary": "rgba(0, 0, 0, 0.40)",
            "--bg-elevated": "rgba(0, 0, 0, 0.55)",
            "--bg-tree": "rgba(0, 0, 0, 0.40)",
            "--bg-launcher": "rgba(0, 0, 0, 0.40)",
            "--bg-toolbar": "rgba(0, 0, 0, 0.40)",
            "--bg-input": "rgba(0, 0, 0, 0.40)",
            "--bg-glass": "rgba(0, 0, 0, 0.55)",
            "--titlebar-background": "rgba(0, 0, 0, 0.40)",
            "--titlebar-background-focused": "rgba(0, 0, 0, 0.40)",
            "--status-bar-background": "rgba(0, 0, 0, 0.40)",
            "--tab-container-background": "rgba(0, 0, 0, 0.40)",
            "--tab-background-active": "rgba(0, 0, 0, 0.55)",
            "--background-primary": "rgba(0, 0, 0, 0.40)",
            "--background-primary-alt": "rgba(0, 0, 0, 0.40)",
            "--background-secondary": "rgba(0, 0, 0, 0.40)",
            "--background-secondary-alt": "rgba(0, 0, 0, 0.40)",
          } : {})
        } as any}
      >
        {settings.backgroundImage && (
          <div
            className="app-wallpaper-layer"
            style={{
              backgroundImage: `url(${settings.backgroundImage})`,
              filter: settings.backgroundBlur ? `blur(${settings.backgroundBlur}px)` : undefined,
              opacity: (settings.backgroundOpacity ?? 40) / 100,
            }}
          />
        )}
        <div className="relative z-[1] flex flex-row flex-1 min-h-0 overflow-hidden">
        {vaultPath && !isFTUXZeroState && settings.showRibbon !== false && (
          <Ribbon
            onToggleExplorer={() => {
              setShowSidebar((s) => {
                const next = !s;
                if (next) {
                  setShowSearch(false);
                  setShowBookmarks(false);
                }
                return next;
              });
            }}
            onHome={() => {
              setShowSearch(false);
              setShowBookmarks(false);
              setShowSidebar(true);
              ooAppRef.current?.workspace?.revealDefaultView?.('left');
            }}
            onSearch={() => {
              setShowSidebar(true);
              setSearchInitialMode("search");
              setShowBookmarks(false);
              setShowSearch(true);
            }}
            onBookmarks={() => {
              setShowSidebar(true);
              setShowSearch(false);
              setShowBookmarks(true);
            }}
            onGraph={() => {
              openGraphAsTab();
            }}
            onSettings={() => {
              setSettingsSection("home");
              setShowSettings(true);
            }}
            onDailyNote={() => {
              if (settings.coreDailyNotes !== false) void handleCreateDailyNote();
            }}
            onThoughtModel={() => {
              if (showRightSidebar && rightSidebarTab === "ai") {
                setShowRightSidebar(false);
              } else {
                setRightSidebarTab("ai");
                setShowRightSidebar(true);
              }
            }}
            onSpaces={() => {
              openSpacesAsTab();
            }}
            onCanvas={() => {
              if (settings.coreCanvas !== false) void handleToggleCanvas();
            }}
            pluginRibbonActions={pluginRibbonActions}
            showSettingsButton
            hasWallpaper={Boolean(settings.backgroundImage)}
            activeLeftPluginView={activeLeftPluginView}
          />
        )}
        {vaultPath && !isFTUXZeroState && (
          <div
            ref={leftSidebarShellRef}
            className="relative h-full min-w-0 shrink-0 overflow-hidden transition-[width] duration-150 ease-out will-change-[width] workspace-split mod-left-split"
            style={{ width: showSidebar ? "var(--sidebar-width)" : 0 }}
          >
            <div className="h-full w-full">
              {showBookmarks ? (
                <BookmarksPanel
                  bookmarks={bookmarks}
                  activeFilePath={activeTab?.path || null}
                  onOpen={(path) => void openFile(path)}
                  onRemove={removeBookmark}
                />
              ) : showSearch ? (
                <SearchModal
                  onClose={() => {
                    setShowSearch(false);
                  }}
                  onSelect={(path) => {
                    setShowSearch(false);
                    openFile(path);
                  }}
                  recentFiles={recentFiles}
                  starredNotes={starredNotes}
                  fileTree={fileTree}
                  initialQuery={searchInitialQuery}
                  initialMode={searchInitialMode}
                  onQueryChange={setSearchInitialQuery}
                  onModeChange={setSearchInitialMode}
                />
              ) : (
                <Sidebar
                  visible={true}
                  fileTree={fileTree}
                  showAllFileTypes={settings.showAllFileTypes}
                  activeFilePath={activeTab?.path || null}
                  starredNotes={starredNotes}
                  onFileSelect={openFile}
                  onNewNote={handleNewNote}
                  onNewFolder={handleCreateFolder}
                  onDeleteFile={handleDeleteFile}
                  onRenameFile={handleRenameFile}
                  onMoveFile={handleMoveFile}
                  onRefresh={refreshFileTree}
                  onCollapse={() => setShowSidebar(false)}
                  onToggleStar={(path) => {
                    setStarredNotes((prev) =>
                      prev.includes(path)
                        ? prev.filter((p) => p !== path)
                        : [...prev, path],
                    );
                  }}
                  vaultPath={vaultPath}
                  onOpenVault={handleOpenVault}
                  onManageVaults={() => {
                    void handleShowVaultManager();
                  }}
                  previouslyOpenedVaults={previouslyOpenedVaults}
                  onSwitchVault={handleSwitchVault}
                  onSettings={() => {
                    setSettingsSection("home");
                    setShowSettings(true);
                  }}
                  pluginViews={activeLeftPluginViews}
                  onClosePluginView={(viewType) => {
                    const app = ooAppRef.current;
                    if (app) app.workspace.detachLeavesOfType(viewType);
                  }}
                  groups={groups}
                  activeGroupId={activeGroupId}
                  onCreateGroup={handleOpenCreateGroupModal}
                  onCreateGroupFromFile={handleCreateGroupFromFile}
                  onCreateGroupFromFolder={handleCreateGroupFromFolder}
                  onBookmarkFile={setBookmarkModalPath}
                  onRestoreGroup={handleRestoreGroup}
                  onRenameGroup={handleRenameGroup}
                  onChangeGroupColor={handleChangeGroupColor}
                  onDeleteGroup={handleDeleteGroup}
                  onDuplicateGroup={handleDuplicateGroup}
                  onToggleGroupAutoSave={handleToggleGroupAutoSave}
                  onAddFileToGroup={handleAddFileToGroup}
                  hasWallpaper={Boolean(settings.backgroundImage)}
                  revealFolderRequest={folderRevealRequest}
                  onRevealFolderHandled={handleRevealFolderHandled}
                />
              )}
            </div>
            {showSidebar && (
              <div
                className={resizerClass}
                onMouseDown={startSidebarDrag}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  height: "100%",
                  zIndex: 100,
                }}
              />
            )}
          </div>
        )}

          <div
            className="app-body flex flex-col flex-1 min-w-0 overflow-hidden"
            ref={appBodyRef}
          >
            <TitleBar
              theme={theme}
              onToggleSidebar={() => setShowSidebar((s) => !s)}
              showSidebar={showSidebar}
              onToggleRightSidebar={() => setShowRightSidebar((s) => !s)}
              showRightSidebar={showRightSidebar}
              leftWidth={0}
              onSearch={() => {
                setShowSidebar(true);
                setSearchInitialMode("search");
                setShowBookmarks(false);
                setShowSearch(true);
              }}
              onToggleExplorer={() => {
                setShowSidebar(true);
                setShowSearch(false);
                setShowBookmarks(false);
                ooAppRef.current?.workspace?.revealDefaultView?.('left');
              }}
              onToggleBookmarks={() => {
                setShowSidebar(true);
                setShowSearch(false);
                setShowBookmarks(true);
              }}
              bookmarksActive={showBookmarks}
              tabs={tabs}
              activeTabId={activeTabId}
              onTabSelect={handleTabSelect}
              onTabClose={closeTab}
              onNewTab={handleOpenNewTab}
              onTabReorder={handleTabReorder}
              tabScrollRef={tabScrollRef}
              activeUsers={activeUsers}
              
              groups={groups}
              activeGroupId={activeGroupId}
              hasUnsavedChanges={hasUnsavedChanges}
              onRestoreGroup={handleRestoreGroup}
              onSaveGroup={handleUpdateActiveGroup}
              onRenameGroup={handleRenameGroup}
              onChangeGroupColor={handleChangeGroupColor}
              onToggleGroupAutoSave={handleToggleGroupAutoSave}
              onDuplicateGroup={handleDuplicateGroup}
              onDeleteGroup={handleDeleteGroup}
              onCreateGroupFromTab={handleCreateGroupFromTab}
              onAddTabToGroup={handleAddTabToGroup}
              onRemoveTabFromGroup={(tabId) => handleAddTabToGroup(tabId, null)}
              onMoveTabToGroup={handleAddTabToGroup}
              collapsedGroupIds={collapsedGroupIds}
              onToggleGroupCollapse={handleToggleGroupCollapse}
              activeRightTab={rightSidebarTab}
              setActiveRightTab={handleSelectRightTab}
              leftPluginViews={leftPluginViews}
              activeLeftViewType={activeLeftPluginView?.viewType || null}
              onSelectLeftPluginView={(viewType) => {
                const view = leftPluginViews.find(v => v.viewType === viewType);
                if (view?.leaf) {
                  void ooAppRef.current?.workspace?.revealLeaf?.(view.leaf);
                  setShowSidebar(true);
                  setShowSearch(false);
                  setShowBookmarks(false);
                }
              }}
              rightPluginViews={rightPluginViews}
              rightSidebarWidth={rightSidebarWidth}
              isFullScreen={isNativeFullScreen}
            />
            <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
              <div className={`editor-column flex flex-col flex-1 min-w-0 overflow-hidden ${settings.backgroundImage ? '' : 'bg-[var(--bg-primary)]'}`}>
                {vaultPath && !isFTUXZeroState && activeTab?.path && activeTab.path !== "__new_tab__" && !activeTab.path.startsWith("__") && viewMode !== "preview" && (
                  <FormattingToolbar />
                )}
                <div
                  className={`main-content flex min-w-0 flex-1 overflow-hidden ${settings.backgroundImage ? '' : 'bg-[var(--bg-primary)]'}`}
                  ref={mainContentRef}
          style={{
            display: "flex",
            flexDirection: "row",
            width: "100%",
            height: "100%",
          }}
        >
          {showVaultEntryTransitionScene ? (
            <div
              className={`vault-entry-transition-scene phase-${vaultEntryTransitionPhase}`}
            >
              <div className="vault-entry-layer vault-entry-layer-welcome">
                <WelcomeScreen
                  onOpenVault={handleWelcomeVaultAction}
                  currentVaultPath={vaultPath}
                  previouslyOpenedVaults={previouslyOpenedVaults}
                  onSwitchVault={handleSwitchVault}
                  onRemoveVaultFromList={handleRemoveVaultFromList}
                  transitionPhase={vaultEntryTransitionPhase}
                  theme={theme}
                  settings={settings} 
                />
              </div>

              {isFTUXZeroState && (
                <div className="vault-entry-layer vault-entry-layer-thought">
                  {renderFTUXZeroState()}
                </div>
              )}
            </div>
          ) : !vaultPath ? (
            <WelcomeScreen
              onOpenVault={handleWelcomeVaultAction}
              currentVaultPath={vaultPath}
              previouslyOpenedVaults={previouslyOpenedVaults}
              onSwitchVault={handleSwitchVault}
              onRemoveVaultFromList={handleRemoveVaultFromList}
              transitionPhase="idle"
              theme={theme}
              settings={settings}
            />
          ) : isFTUXZeroState ? (
            renderFTUXZeroState()
          ) : (
            <>
              {/* Split Pane System -- replaces the single editor pane */}
              {shouldShowEditorPane && (
                <div
                  className="workspace-split mod-vertical mod-root"
                  style={{
                    flex: hasAuxPane ? `0 0 ${editorPaneWidth}%` : 1,
                    height: "100%",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                  }}
                >

                  <SplitPaneContainer
                    paneTree={paneTree}
                    onPaneTreeChange={handlePaneTreeChange}
                    renderContent={renderPaneContent}
                    onNewTab={handleNewNote}
                    onTabClose={closeTab}
                    onTabSelect={handlePaneTabSelect}
                    focusedLeafId={focusedLeafId}
                    onFocusLeaf={handleFocusLeaf}
                  />
                </div>
              )}

              {/* Resizer for Graph/Canvas */}
              {shouldShowPaneResizer && (
                <div className={resizerClass} onMouseDown={startPaneDrag} />
              )}

              {/* Graph View pane (legacy side pane mode) */}
              {showGraph && !activeTabIsGraph && (
                <div
                  style={{
                    flex:
                      graphFullScreen || !shouldShowEditorPane
                        ? 1
                        : `0 0 calc(${100 - editorPaneWidth}% - 4px)`,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minWidth: 0,
                  }}
                >
                  {renderGraphShell({
                    onNodeClick: async (
                      linkName: string,
                      heading?: string,
                      notePath?: string,
                    ) => {
                      setViewMode("preview");
                      if (graphFullScreen) {
                        setGraphFullScreen(false);
                      }
                      if (notePath) {
                        await openFile(notePath, "preview");
                        return;
                      }
                      await handleLinkClick(linkName, heading);
                    },
                    onClose: () => setShowGraph(false),
                    isFullScreen: graphFullScreen,
                    localNodePath: activeTab?.path,
                  })}
                </div>
              )}
              {/* Canvas View pane */}
              {showCanvas && (
                <div
                  style={{
                    flex:
                      canvasFullScreen || !shouldShowEditorPane
                        ? 1
                        : `0 0 calc(${100 - editorPaneWidth}% - 4px)`,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minWidth: 0,
                  }}
                >
                  <CanvasView
                    onClose={() => setShowCanvas(false)}
                    isFullScreen={canvasFullScreen}
                    onToggleFullScreen={() => setCanvasFullScreen((f) => !f)}
                    theme={theme}
                    vaultPath={vaultPath}
                    fileTree={fileTree}
                    canvasFilePath={canvasFilePath}
                    spaceId={collaborationEngine.activeSpaceId || undefined}
                    onOpenFile={(path) => openFile(path)}
                    onNewCanvas={() => {
                      void handleToggleCanvas();
                    }}
                    onDuplicateCanvas={() => {
                      void handleDuplicateCanvas();
                    }}
                    onSaveCanvasAs={() => {
                      void handleSaveCanvasAs();
                    }}
                    recentCanvasFiles={recentCanvasFiles}
                    onOpenRecentCanvas={(path) => {
                      void openFile(path, "preview");
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

        {/* Thought Model Panel - independent of graph */}
        {/* Right Sidebar Container */}
        {showRightSidebar && !isFTUXZeroState && (
          <div
            ref={rightSidebarShellRef}
            className="relative flex h-full min-w-0 shrink-0 flex-row overflow-hidden transition-[width] duration-150 ease-out will-change-[width]"
            style={{ width: showRightSidebar ? "var(--right-sidebar-width)" : 0 }}
          >
            <div
              className={rightResizerClass}
              onMouseDown={startRightSidebarDrag}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                zIndex: 100,
              }}
            />
            <div className="flex h-full min-w-0 w-full flex-row overflow-hidden">
              <RightSidebar
                activeTab={rightSidebarTab}
                currentContent={currentContent}
                allNoteNames={allNoteNames}
                handleLinkClick={handleLinkClick}
                backlinks={backlinks}
                openFile={openFile}
                activeFilePath={activeTab?.path || null}
                activeFileName={activeTab?.name || ""}
                showUnlinkedMentions={settings.backlinksShowUnlinked !== false}
                width={rightSidebarWidth}
                vaultPath={vaultPath}
                theme={theme}
                fileTree={fileTree}
                onClose={() => setShowRightSidebar(false)}
                rightPluginViews={rightPluginViews}
                onClosePluginView={(viewType) => {
                  const app = ooAppRef.current;
                  if (app) {
                    app.workspace.detachLeavesOfType(viewType);
                  }
                }}
              />
            </div>
          </div>
        )}
            </div>
          </div>
        </div>

      {!isFTUXZeroState && !activeTabIsSpaces && (
        <StatusBar
          activeTab={activeTab || null}
          content={currentContent}
          theme={theme}
          viewMode={viewMode}
          fileTree={fileTree}
          queueStatus={queueStatus}
          pluginStatusBarItems={pluginStatusBarItems}
          vimEnabled={settings.vimMode}
          showEditingMode={settings.showEditingModeStatusBar !== false}
          backlinkCount={backlinks.length}
          syncStatus={syncStatus}
          onRevealFolder={handleRevealFolderInNavigation}
        />
      )}
    </div>

      {showCommandPalette && (
        <CommandPalette
          commands={[
            ...commands,
            ...pluginCommands.map(pc => ({
              id: pc.id,
              label: pc.name,
              action: () => {
                const activeEditor = ooAppRef.current?.workspace.activeEditor;
                if (pc.editorCallback && activeEditor?.editor) {
                  pc.editorCallback(activeEditor.editor, activeEditor);
                } else if (pc.editorCheckCallback && activeEditor?.editor) {
                  pc.editorCheckCallback(false, activeEditor.editor, activeEditor);
                } else if (pc.callback) {
                  pc.callback();
                } else if (pc.checkCallback) {
                  pc.checkCallback(false);
                }
              },
              category: pc.pluginId,
            })),
          ]}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {showSettings && (
        <SettingsPage
          settings={settings}
          onSettingsChange={setSettings}
          onClose={() => {
            setShowSettings(false);
            setSettingsSection("home");
          }}
          initialSection={settingsSection as any}
          commands={[
            ...commands,
            ...pluginCommands.map(pc => ({
              id: pc.id,
              label: pc.name,
              shortcut: pc.hotkeys?.map((hotkey: any) => hotkey.modifiers?.concat(hotkey.key).join("+")).join(", "),
              action: () => {},
              category: pc.pluginId,
            })),
          ]}
          plugins={pluginList}
          pluginSettingTabs={pluginSettingTabs}
          onEnablePlugin={async (id) => { await pluginManagerRef.current?.enablePlugin(id); }}
          onDisablePlugin={async (id) => { await pluginManagerRef.current?.disablePlugin(id); }}
          onRefreshPlugins={async () => {
            await pluginManagerRef.current?.discoverPlugins();
          }}
          onReloadPlugin={async (id) => { await pluginManagerRef.current?.reloadPlugin(id); }}
          onUninstallPlugin={async (id) => {
            const pluginManager = pluginManagerRef.current;
            if (!pluginManager) return false;
            return pluginManager.uninstallPlugin(id);
          }}
          onInstallPlugin={async (repo, id, version) => {
            const pm = pluginManagerRef.current;
            if (!pm) {
              throw new Error('Plugin manager not initialized. Try restarting the app.');
            }
            try {
              const result = await pm.installFromGithubRepo(repo, id, version);
              return result;
            } catch (e: any) {
              console.error('[App] Plugin install error:', e);
              throw e;
            }
          }}
          collaborators={displayCollaborators}
          invitesSent={invitesSent}
          invitesReceived={invitesReceived}
          onInviteUser={handleInviteUser}
          onRemoveCollaborator={handleRemoveCollaborator}
          onAcceptInvite={handleAcceptInvite}
          onRejectInvite={handleRejectInvite}
          currentUserEmail={authManager.getUser()?.email}
          vaultPath={vaultPath || undefined}
          onVaultReconstructed={async (newPath) => {
            await loadVaultData(newPath);
            setShowSettings(false); // Close settings
          }}

        />
      )}

      {permissionModalData && (
        <PluginPermissionModal
          manifest={permissionModalData.manifest}
          permissions={permissionModalData.permissions}
          onApprove={() => {
            permissionModalData.resolve(true);
            setPermissionModalData(null);
          }}
          onDeny={() => {
            permissionModalData.resolve(false);
            setPermissionModalData(null);
          }}
        />
      )}

      {showTemplateModal && (
        <TemplateModal
          onClose={() => setShowTemplateModal(false)}
          onInsert={handleTemplateInsert}
          currentNoteName={activeTab?.name}
          templatesFolder={settings.templatesFolder}
          dateFormat={settings.templateDateFormat}
          timeFormat={settings.templateTimeFormat}
        />
      )}

      {bookmarkModalPath && (
        <BookmarkModal
          path={bookmarkModalPath}
          initialTitle={
            bookmarks.find((bookmark) => bookmark.path === bookmarkModalPath)?.title
              || getNoteName(bookmarkModalPath)
          }
          groups={bookmarkGroups}
          onClose={(result) => {
            const path = bookmarkModalPath;
            setBookmarkModalPath(null);
            if (result) saveBookmark(path, result.title, result.group);
          }}
        />
      )}

      {groupModalData && (
        <GroupModal
          title={groupModalData.title}
          initialName={groupModalData.initialName}
          initialColor={groupModalData.initialColor}
          onClose={handleGroupModalClose}
        />
      )}

      {modal && (
        <Modal
          type={modal.type}
          title={modal.title}
          message={modal.message}
          defaultValue={modal.defaultValue}
          onClose={(result) => {
            setModal(null);
            modal.onConfirm?.(result);
          }}
        />
      )}

      {collabStatus.state === 'bootstrapping' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 10, 12, 0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            background: 'rgba(25, 25, 30, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '40px',
            width: '450px',
            maxWidth: '90%',
            boxShadow: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: '3px solid color-mix(in srgb, var(--color-accent, var(--accent-primary, #3b82f6)) 20%, transparent)',
              borderTopColor: 'var(--color-accent, var(--accent-primary, #3b82f6))',
              animation: 'spin 1s linear infinite',
              marginBottom: '24px'
            }} />
            <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 600 }}>Reconstructing Vault</h2>
            <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: 'rgba(255, 255, 255, 0.6)', minHeight: '20px' }}>
              {collabStatus.progress.message}
            </p>
            <div style={{
              width: '100%',
              height: '6px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '3px',
              overflow: 'hidden',
              marginBottom: '12px'
            }}>
              <div style={{
                height: '100%',
                background: 'var(--color-accent, var(--accent-primary, #3b82f6))',
                width: `${collabStatus.progress.total > 0 ? Math.round((collabStatus.progress.current / collabStatus.progress.total) * 100) : 0}%`,
                transition: 'width 0.2s ease-out',
                borderRadius: '3px'
              }} />
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.4)', fontWeight: 500 }}>
              {collabStatus.progress.current} of {collabStatus.progress.total} files
            </div>
          </div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
      {showVaultManager && (
        <VaultManager
          currentVaultPath={vaultPath}
          previouslyOpenedVaults={previouslyOpenedVaults}
          theme={theme}
          settings={settings}
          onCreateVault={handleCreateVault}
          onOpenVault={handleOpenVault}
          onSwitchVault={handleSwitchVault}
          onCloseVault={handleCloseVault}
          onRevealVault={(path) => {
            void api.showItemInFolder(path);
          }}
          onCopyVaultId={handleCopyVaultId}
          onRenameVault={handleRenameVault}
          onMoveVault={handleMoveVault}
          onRemoveVaultFromList={handleRemoveVaultFromList}
          onClose={() => setShowVaultManager(false)}
        />
      )}
      {toast && (
        <div className="fixed bottom-[var(--space-8)] right-[var(--space-8)] z-[300] flex flex-col gap-[var(--space-2)]">
          <div
            className={`flex max-w-[360px] items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-secondary)] shadow-none ${
              toast.type === "success"
                ? "border-l-[3px] border-l-[var(--success)]"
                : toast.type === "error"
                  ? "border-l-[3px] border-l-[var(--danger)]"
                  : "border-l-[3px] border-l-[var(--info)]"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </DragCtx.Provider>
  );
}
