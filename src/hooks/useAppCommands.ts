import { useMemo } from "react";
import { Command } from "../types";
import { getNoteName } from "../utils/helpers";

interface AppCommandsOptions {
  handleNewNote: () => void;
  handleOpenVault: () => void;
  handleSave: () => void;
  openGraphAsTab: (type?: any) => void;
  setShowSidebar: (show: boolean | ((prev: boolean) => boolean)) => void;
  setSearchInitialMode: (mode: any) => void;
  setShowSearch: (show: boolean) => void;
  settings: any;
  handleToggleBacklinks: () => void;
  handleToggleOutline: () => void;
  setShowTags: (show: boolean | ((prev: boolean) => boolean)) => void;
  handleToggleOutgoingLinks: () => void;
  setShowProperties: (show: boolean | ((prev: boolean) => boolean)) => void;
  handleCreateDailyNote: () => void;
  setShowTemplateModal: (show: boolean) => void;
  setShowThoughtModel: (show: boolean) => void;
  setSettings: (s: any) => void;
  setSettingsSection: (section: string) => void;
  setShowSettings: (show: boolean) => void;
  setViewMode: (mode: any) => void;
  handleToggleCanvas: () => void;
  handleDuplicateCanvas: () => void;
  handleSaveCanvasAs: () => void;
  recentCanvasFiles: string[];
  openFile: (path: string, mode?: any) => void;
  setShowUnlinkedMentions: (show: boolean | ((prev: boolean) => boolean)) => void;
}

export function useAppCommands({
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
}: AppCommandsOptions): Command[] {
  return useMemo<Command[]>(() => {
    return [
      {
        id: "new-note",
        label: "New Note",
        shortcut: "Ctrl+N",
        action: handleNewNote,
        category: "File",
      },
      {
        id: "open-vault",
        label: "Open Vault",
        shortcut: "Ctrl+O",
        action: handleOpenVault,
        category: "File",
      },
      {
        id: "save",
        label: "Save Current Note",
        shortcut: "Ctrl+S",
        action: handleSave,
        category: "File",
      },
      {
        id: "search-file",
        label: "Find/Replace in Note",
        shortcut: "Ctrl+F",
        action: () =>
          document.dispatchEvent(new CustomEvent("editor:open-search")),
        category: "Search",
      },
      {
        id: "search-vault",
        label: "Search Entire Vault",
        shortcut: "Ctrl+Shift+F",
        action: () => {
          setShowSidebar(true);
          setSearchInitialMode("search");
          setShowSearch(true);
        },
        category: "Search",
      },
      {
        id: "graph",
        label: "Open Graph Tab",
        shortcut: "Ctrl+G",
        action: () => openGraphAsTab(),
        category: "View",
      },
      {
        id: "graph-ai",
        label: "Open AI Graph Tab",
        action: () => {
          openGraphAsTab("ai");
        },
        category: "View",
      },
      {
        id: "sidebar",
        label: "Toggle Sidebar",
        shortcut: "Ctrl+B",
        action: () => setShowSidebar((s) => !s),
        category: "View",
      },
      {
        id: "backlinks",
        label: "Toggle Backlinks Panel",
        action: () => {
          if (settings.coreBacklinks !== false) handleToggleBacklinks();
        },
        category: "View",
      },
      {
        id: "outline",
        label: "Toggle Outline",
        action: handleToggleOutline,
        category: "View",
      },
      {
        id: "tags",
        label: "Toggle Tag Pane",
        action: () => setShowTags((t) => !t),
        category: "View",
      },
      {
        id: "outgoing-links",
        label: "Toggle Outgoing Links",
        action: handleToggleOutgoingLinks,
        category: "View",
      },
      {
        id: "properties",
        label: "Toggle Properties Panel",
        action: () => setShowProperties((p) => !p),
        category: "View",
      },
      {
        id: "daily-note",
        label: "Create Daily Note",
        action: handleCreateDailyNote,
        category: "Notes",
      },
      {
        id: "insert-template",
        label: "Insert Template",
        action: () => {
          if (settings.coreTemplates !== false) setShowTemplateModal(true);
        },
        category: "Notes",
      },
      {
        id: "thought-model",
        label: "Open AI Assistant",
        action: () => setShowThoughtModel(true),
        category: "AI",
      },
      {
        id: "theme",
        label: "Toggle Theme",
        action: () =>
          setSettings((s: any) => ({
            ...s,
            theme: s.theme === "dark" ? "light" : "dark",
          })),
        category: "Settings",
      },
      {
        id: "settings",
        label: "Open Settings",
        action: () => {
          setSettingsSection("home");
          setShowSettings(true);
        },
        category: "Settings",
      },
      {
        id: "editor-mode",
        label: "Live Preview",
        action: () => setViewMode("editor"),
        category: "View",
      },
      {
        id: "preview-mode",
        label: "Preview View",
        action: () => setViewMode("preview"),
        category: "View",
      },
      {
        id: "split-mode",
        label: "Split View",
        action: () => setViewMode("split"),
        category: "View",
      },
      {
        id: "canvas",
        label: "New Canvas",
        shortcut: "Ctrl+Shift+C",
        action: () => {
          if (settings.coreCanvas !== false) void handleToggleCanvas();
        },
        category: "Canvas",
      },
      {
        id: "canvas-duplicate",
        label: "Duplicate Active Canvas",
        action: () => {
          void handleDuplicateCanvas();
        },
        category: "Canvas",
      },
      {
        id: "canvas-save-as",
        label: "Save Canvas As",
        action: () => {
          void handleSaveCanvasAs();
        },
        category: "Canvas",
      },
      ...recentCanvasFiles.slice(0, 8).map((path, index) => ({
        id: `canvas-recent-${index}`,
        label: `Open Recent Canvas: ${getNoteName(path)}`,
        action: () => {
          void openFile(path, "preview");
        },
        category: "Canvas",
      })),
      {
        id: "unlinked-mentions",
        label: "Toggle Unlinked Mentions",
        action: () => setShowUnlinkedMentions((u) => !u),
        category: "View",
      },
    ];
  }, [
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
  ]);
}
