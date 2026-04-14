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
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/editor/Editor";
import { GraphView } from "./components/graph/GraphView";
import { CanvasView } from "./components/canvas/CanvasView";
import { SearchModal } from "./components/SearchModal";
import { CommandPalette } from "./components/CommandPalette";
import { BacklinksPanel } from "./components/BacklinksPanel";
import { StatusBar } from "./components/StatusBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Modal } from "./components/Modal";
import { Ribbon } from "./components/Ribbon";
import { OutlinePane } from "./components/OutlinePane";
import { TagPane } from "./components/TagPane";
import { OutgoingLinksPanel } from "./components/OutgoingLinksPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import {
  SettingsPage,
  AppSettings,
  DEFAULT_SETTINGS,
} from "./components/SettingsPage";
import { TemplateModal } from "./components/TemplateModal";
import { UnlinkedMentionsPanel } from "./components/UnlinkedMentionsPanel";
import { ThoughtModelPage } from "./components/ThoughtModelPage";
import { FileText, Layout } from "lucide-react";
import { Tab, ViewMode, Theme, Command, FileEntry } from "./types";
import { getNoteName, generateId, debounce } from "./utils/helpers";
import { getAPI } from "./utils/api";

const api = getAPI();
const MIN_EDITOR_FONT_SIZE = 12;
const MAX_EDITOR_FONT_SIZE = 24;
type FontZoomScope = "both" | "editor" | "preview";

const isCanvasFile = (path: string) => path.toLowerCase().endsWith(".canvas");
const GRAPH_TAB_PATH = "__graph__.view";

export default function App() {
  // ── Global State ────────────────────────────────────
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showGraph, setShowGraph] = useState(false);
  const [graphFullScreen, setGraphFullScreen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showBacklinks, setShowBacklinks] = useState(true);
  const [showOutline, setShowOutline] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showOutgoingLinks, setShowOutgoingLinks] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showUnlinkedMentions, setShowUnlinkedMentions] = useState(false);
  const [showThoughtModel, setShowThoughtModel] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasFilePath, setCanvasFilePath] = useState<string | null>(null);
  const [canvasFullScreen, setCanvasFullScreen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    // Load settings from localStorage on initial render
    try {
      const saved = localStorage.getItem("notework-settings");
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
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

  // Sidebar drag resizer
  const [sidebarWidth, setSidebarWidth] = useState(260);

  const handleSidebarDrag = useCallback((e: MouseEvent) => {
    const newWidth = e.clientX - 48; // minus ribbon width
    if (newWidth > 150 && newWidth < 600) setSidebarWidth(newWidth);
  }, []);

  const stopSidebarDrag = useCallback(() => {
    document.removeEventListener("mousemove", handleSidebarDrag);
    document.removeEventListener("mouseup", stopSidebarDrag);
    document.body.style.cursor = "default";
  }, [handleSidebarDrag]);

  const startSidebarDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.addEventListener("mousemove", handleSidebarDrag);
      document.addEventListener("mouseup", stopSidebarDrag);
      document.body.style.cursor = "ew-resize";
    },
    [handleSidebarDrag, stopSidebarDrag],
  );

  // Thought Model panel drag resizer
  const [thoughtModelWidth, setThoughtModelWidth] = useState(400);

  const handleThoughtModelDrag = useCallback((e: MouseEvent) => {
    const appWidth = window.innerWidth - 48; // minus ribbon
    const newWidth = appWidth - e.clientX;
    if (newWidth > 300 && newWidth < 800) setThoughtModelWidth(newWidth);
  }, []);

  const stopThoughtModelDrag = useCallback(() => {
    document.removeEventListener("mousemove", handleThoughtModelDrag);
    document.removeEventListener("mouseup", stopThoughtModelDrag);
    document.body.style.cursor = "default";
  }, [handleThoughtModelDrag]);

  const startThoughtModelDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.addEventListener("mousemove", handleThoughtModelDrag);
      document.addEventListener("mouseup", stopThoughtModelDrag);
      document.body.style.cursor = "ew-resize";
    },
    [handleThoughtModelDrag, stopThoughtModelDrag],
  );

  // ── File & Editor State ─────────────────────────────
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [backlinks, setBacklinks] = useState<string[]>([]);

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

    // Apply CSS custom properties from settings
    const root = document.documentElement;
    root.style.setProperty("--accent-color", settings.accentColor);
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
    root.style.setProperty("--editor-line-height", `${settings.lineHeight}`);

    if (theme === "custom") {
      root.style.setProperty("--bg-primary", settings.customBgPrimary);
      root.style.setProperty("--text-primary", settings.customTextPrimary);
      // derive some other basic colors for decent UI
      root.style.setProperty("--bg-secondary", settings.customBgPrimary);
      root.style.setProperty("--bg-elevated", settings.customBgPrimary);
      root.style.setProperty("--text-secondary", settings.customTextPrimary);
      root.style.setProperty("--text-muted", settings.customTextPrimary);
    } else {
      root.style.removeProperty("--bg-primary");
      root.style.removeProperty("--text-primary");
      root.style.removeProperty("--bg-secondary");
      root.style.removeProperty("--bg-elevated");
      root.style.removeProperty("--text-secondary");
      root.style.removeProperty("--text-muted");
    }

    // Save settings to localStorage
    localStorage.setItem("notework-settings", JSON.stringify(settings));
  }, [settings, theme]);

  // ── Initialize Vault ────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const savedPath = await api.getVaultPath();
        if (savedPath) {
          setVaultPath(savedPath);
          await refreshFileTree();
        }
      } catch (e) {
        console.log("No saved vault path");
      }
    };
    init();
  }, []);

  // ── Menu Event Handlers ─────────────────────────────
  useEffect(() => {
    const openGraphFromMenu = () => {
      setShowThoughtModel(false);
      setShowCanvas(false);
      setShowGraph(false);
      const existingGraphTab = tabs.find((t) => t.path === GRAPH_TAB_PATH);
      if (existingGraphTab) {
        setActiveTabId(existingGraphTab.id);
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
    api.onMenuEvent("menu:command-palette", () => setShowCommandPalette(true));
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
  }, [tabs, activeTabId, currentContent]);

  // ── Keyboard Shortcuts ──────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && e.key === "p") {
        e.preventDefault();
        setShowCommandPalette(true);
      } else if (ctrl && !shift && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("editor:open-search"));
      } else if (ctrl && shift && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
      } else if (ctrl && e.key === "n") {
        e.preventDefault();
        handleNewNote();
      } else if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (ctrl && e.key === "g") {
        e.preventDefault();
        openGraphAsTab();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void handleToggleCanvas();
      } else if (ctrl && e.key === "b") {
        e.preventDefault();
        setShowSidebar((s) => !s);
      } else if (ctrl && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (e.key === "Escape") {
        setShowSearch(false);
        setShowCommandPalette(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, tabs, currentContent]);

  // ── Vault Operations ────────────────────────────────
  const handleOpenVault = async () => {
    try {
      const path = await api.openVaultDialog();
      if (path) {
        await api.setVaultPath(path);
        setVaultPath(path);
        setTabs([]);
        setActiveTabId(null);
        setCurrentContent("");
        await refreshFileTree();
      }
    } catch (e) {
      console.error("Failed to open vault:", e);
      alert("Failed to open vault. It may be too large or inaccessible.");
    }
  };

  const refreshFileTree = async () => {
    try {
      const tree = await api.getFileTree();
      setFileTree(tree);
    } catch (e) {
      console.error("Failed to refresh file tree:", e);
    }
  };

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

  const getUniqueCanvasPath = useCallback(
    async (requestedName: string): Promise<string> => {
      const safeBase =
        requestedName.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled canvas";
      const canonical = isCanvasFile(safeBase)
        ? safeBase
        : `${safeBase}.canvas`;
      const stem = canonical.replace(/\.canvas$/i, "");

      let candidate = canonical;
      let suffix = 2;
      while (await api.fileExists(candidate)) {
        candidate = `${stem} ${suffix}.canvas`;
        suffix += 1;
      }
      return candidate;
    },
    [],
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

  // ── File Operations ─────────────────────────────────
  const openFile = async (filePath: string, mode?: ViewMode) => {
    // Track recent files (keep last 20)
    setRecentFiles((prev) => {
      const filtered = prev.filter((p) => p !== filePath);
      return [filePath, ...filtered].slice(0, 20);
    });

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
      const existingCanvasTab = tabs.find((t) => t.path === filePath);
      if (existingCanvasTab) {
        setActiveTabId(existingCanvasTab.id);
      } else {
        const canvasTab: Tab = {
          id: generateId(),
          path: filePath,
          name: getNoteName(filePath),
          isModified: false,
        };
        setTabs((prev) => [...prev, canvasTab]);
        setActiveTabId(canvasTab.id);
      }
      setCurrentContent("");
      setBacklinks([]);
      return;
    }

    // Check if tab already exists
    const existingTab = tabs.find((t) => t.path === filePath);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      const content = await api.readFile(filePath);
      setCurrentContent(content);
      setViewMode(mode || "preview");
      loadBacklinks(filePath);
      return;
    }

    // Open new tab
    const content = await api.readFile(filePath);
    const newTab: Tab = {
      id: generateId(),
      path: filePath,
      name: getNoteName(filePath),
      isModified: false,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setCurrentContent(content);
    setViewMode(mode || "preview");
    loadBacklinks(filePath);
  };

  const openGraphAsTab = () => {
    setShowThoughtModel(false);
    setShowCanvas(false);
    setShowGraph(false);

    const existingGraphTab = tabs.find((t) => t.path === GRAPH_TAB_PATH);
    if (existingGraphTab) {
      setActiveTabId(existingGraphTab.id);
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

  const handleNewNote = async () => {
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
        const content = isCanvasFile(fileName)
          ? JSON.stringify({ nodes: [], edges: [] }, null, 2)
          : `# ${trimmed.replace(".md", "")}\n\n`;

        await api.createFile(fileName, content);
        await refreshFileTree();
        await openFile(fileName);
      },
    });
  };

  const handleSave = async () => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (isCanvasFile(tab.path) || tab.path === GRAPH_TAB_PATH) return;

    await api.writeFile(tab.path, currentContent);
    if (tab.path.toLowerCase().endsWith(".md")) {
      window.dispatchEvent(
        new CustomEvent("notework:note-content-changed", {
          detail: { path: tab.path, content: currentContent },
        }),
      );
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isModified: false } : t)),
    );
    await refreshFileTree();
  };

  // Auto-save with debounce
  const handleContentChange = useCallback(
    (content: string) => {
      setCurrentContent(content);

      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (
        activeTab &&
        !isCanvasFile(activeTab.path) &&
        activeTab.path !== GRAPH_TAB_PATH &&
        activeTab.path.toLowerCase().endsWith(".md")
      ) {
        window.dispatchEvent(
          new CustomEvent("notework:note-content-changed", {
            detail: { path: activeTab.path, content },
          }),
        );
      }

      // Mark tab as modified
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, isModified: true } : t,
        ),
      );

      // Auto-save after 2 seconds of no typing
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab) {
          await api.writeFile(tab.path, content);
          if (tab.path.toLowerCase().endsWith(".md")) {
            window.dispatchEvent(
              new CustomEvent("notework:note-content-changed", {
                detail: { path: tab.path, content },
              }),
            );
          }
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId ? { ...t, isModified: false } : t,
            ),
          );
        }
      }, 2000);
    },
    [activeTabId, tabs],
  );

  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Auto-save before closing
    if (
      tab.isModified &&
      tab.id === activeTabId &&
      !isCanvasFile(tab.path) &&
      tab.path !== GRAPH_TAB_PATH
    ) {
      await api.writeFile(tab.path, currentContent);
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      if (newTabs.length > 0) {
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab.id);
        if (isCanvasFile(lastTab.path) || lastTab.path === GRAPH_TAB_PATH) {
          setCurrentContent("");
          setBacklinks([]);
        } else {
          const content = await api.readFile(lastTab.path);
          setCurrentContent(content);
          loadBacklinks(lastTab.path);
        }
      } else {
        setActiveTabId(null);
        setCurrentContent("");
        setBacklinks([]);
      }
    }
  };

  // ── Link Navigation ─────────────────────────────────
  const handleLinkClick = async (linkName: string, heading?: string) => {
    // Find the note by name
    const findNote = (entries: FileEntry[], name: string): string | null => {
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const noteName = getNoteName(entry.path);
          if (noteName.toLowerCase() === name.toLowerCase()) {
            return entry.path;
          }
        }
        if (entry.children) {
          const found = findNote(entry.children, name);
          if (found) return found;
        }
      }
      return null;
    };

    const filePath = findNote(fileTree, linkName);
    if (filePath) {
      await openFile(filePath, "preview");
      // TODO: Scroll to heading if specified
      if (heading) {
        // Dispatch event to scroll to heading in preview
        setTimeout(() => {
          const headingEl = document.querySelector(
            `.markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4, .markdown-preview h5, .markdown-preview h6`,
          );
          // Find the heading that matches
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
      const newPath = `${linkName}.md`;
      const content = `# ${linkName}\n\n`;
      await api.createFile(newPath, content);
      await refreshFileTree();
      await openFile(newPath, "preview");
    }
  };

  // ── Backlinks ───────────────────────────────────────
  const loadBacklinks = async (filePath: string) => {
    try {
      const links = await api.getBacklinks(filePath);
      setBacklinks(links);
    } catch {
      setBacklinks([]);
    }
  };

  // ── File Management ─────────────────────────────────
  const handleDeleteFile = async (filePath: string, isDir: boolean = false) => {
    setModal({
      type: "confirm",
      title: isDir ? "Delete Folder" : "Delete File",
      message: `Delete "${getNoteName(filePath)}"${isDir ? " and all its contents" : ""}?`,
      onConfirm: async (confirmed) => {
        if (!confirmed) return;

        try {
          if (isDir) {
            await api.deleteDirectory(filePath);
          } else {
            await api.deleteFile(filePath);
          }

          // Close tab if open (for files) or close all tabs within the folder
          if (isDir) {
            // Close all tabs that are within this directory
            tabs.forEach((tab) => {
              if (
                tab.path.startsWith(filePath + "/") ||
                tab.path === filePath
              ) {
                closeTab(tab.id);
              }
            });
          } else {
            const tab = tabs.find((t) => t.path === filePath);
            if (tab) closeTab(tab.id);
          }

          await refreshFileTree();
        } catch (error) {
          console.error("Failed to delete:", error);
        }
      },
    });
  };

  const handleRenameFile = async (oldPath: string, newName: string) => {
    const dir = oldPath.includes("/")
      ? oldPath.substring(0, oldPath.lastIndexOf("/") + 1)
      : "";
    const raw = newName.trim();
    const hasExt = /\.[a-z0-9]+$/i.test(raw);
    const inferredExt = isCanvasFile(oldPath) ? ".canvas" : ".md";
    const normalized = hasExt ? raw : `${raw}${inferredExt}`;
    const newPath = dir + normalized;

    await api.renameFile(oldPath, newPath);

    // Update tab if open
    setTabs((prev) =>
      prev.map((t) =>
        t.path === oldPath
          ? { ...t, path: newPath, name: getNoteName(newPath) }
          : t,
      ),
    );

    await refreshFileTree();
  };

  const handleCreateFolder = async (parentPath: string) => {
    setModal({
      type: "prompt",
      title: "New Folder",
      message: "Enter folder name:",
      onConfirm: async (name) => {
        if (typeof name !== "string" || !name.trim()) return;

        const folderPath = parentPath ? `${parentPath}/${name}` : name;
        await api.createDirectory(folderPath);
        await refreshFileTree();
      },
    });
  };

  const handleCreateDailyNote = async () => {
    const filePath = await api.createDailyNote();
    await refreshFileTree();
    await openFile(filePath);
  };

  // Handle template insertion
  const handleTemplateInsert = (templateContent: string) => {
    if (activeTabId) {
      // Insert at cursor or append
      const newContent = currentContent + "\n" + templateContent;
      setCurrentContent(newContent);
      // Mark as modified
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, isModified: true } : t,
        ),
      );
    }
  };

  // Handle image paste/drop - embed compressed inline data URL (no attachments folder write)
  const handleImagePaste = async (file: File): Promise<string | null> => {
    const readFileAsDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === "string" && result.startsWith("data:image/")) {
            resolve(result);
            return;
          }
          reject(new Error("Unsupported image data"));
        };
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
      });

    const loadImage = (imageFile: File) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const blobUrl = URL.createObjectURL(imageFile);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error("Failed to decode image"));
        };
        image.src = blobUrl;
      });

    const compressImageData = async (imageFile: File): Promise<string> => {
      const original = await readFileAsDataUrl(imageFile);
      const image = await loadImage(imageFile);
      const naturalWidth = image.naturalWidth || image.width || 1;
      const naturalHeight = image.naturalHeight || image.height || 1;
      const longestEdge = Math.max(naturalWidth, naturalHeight);
      const baseMaxEdge = Math.min(1600, longestEdge);
      const targetLength = 90000;
      const scaleSteps = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
      const qualitySteps = [0.84, 0.76, 0.68, 0.6, 0.52, 0.45];

      let best = original;

      for (const scale of scaleSteps) {
        const maxEdge = Math.max(320, Math.round(baseMaxEdge * scale));
        const ratio = Math.min(1, maxEdge / longestEdge);
        const width = Math.max(1, Math.round(naturalWidth * ratio));
        const height = Math.max(1, Math.round(naturalHeight * ratio));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) break;
        context.drawImage(image, 0, 0, width, height);

        for (const quality of qualitySteps) {
          const webpData = canvas.toDataURL("image/webp", quality);
          const candidate = webpData.startsWith("data:image/webp")
            ? webpData
            : canvas.toDataURL("image/jpeg", quality);

          if (candidate.length < best.length) {
            best = candidate;
          }

          if (best.length <= targetLength) {
            return best;
          }
        }
      }

      return best;
    };

    try {
      return await compressImageData(file);
    } catch (err) {
      console.error("Failed to embed image:", err);
      return null;
    }
  };

  // Get list of all note names for autocomplete
  const allNoteNames = useMemo(() => {
    const getNotes = (
      entries: FileEntry[],
    ): { name: string; path: string }[] => {
      const notes: { name: string; path: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory && entry.extension === ".md") {
          // Extract name without extension
          const name =
            entry.path.replace(/\.md$/, "").split("/").pop() || entry.path;
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

  // Get note content for embeds - uses cache or fetches
  const getNoteContent = useCallback(
    (noteName: string): string | null => {
      // Check cache first
      const cached = noteContentCache.get(noteName);
      if (cached !== undefined) return cached;

      // Find the note path
      const note = allNoteNames.find(
        (n) => n.name.toLowerCase() === noteName.toLowerCase(),
      );

      if (!note) return null;

      // Async fetch and update cache (won't be immediate but will work on re-render)
      api.readFile(note.path).then((content) => {
        setNoteContentCache((prev) => new Map(prev).set(noteName, content));
      });

      return null;
    },
    [noteContentCache, allNoteNames],
  );

  // ── Commands (for Command Palette) ──────────────────
  const commands: Command[] = [
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
      action: () => setShowSearch(true),
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
      id: "sidebar",
      label: "Toggle Sidebar",
      shortcut: "Ctrl+B",
      action: () => setShowSidebar((s) => !s),
      category: "View",
    },
    {
      id: "backlinks",
      label: "Toggle Backlinks Panel",
      action: () => setShowBacklinks((b) => !b),
      category: "View",
    },
    {
      id: "outline",
      label: "Toggle Outline",
      action: () => setShowOutline((o) => !o),
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
      action: () => setShowOutgoingLinks((o) => !o),
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
      action: () => setShowTemplateModal(true),
      category: "Notes",
    },
    {
      id: "thought-model",
      label: "Open Thought Model",
      action: () => setShowThoughtModel(true),
      category: "AI",
    },
    {
      id: "theme",
      label: "Toggle Theme",
      action: () =>
        setSettings((s) => ({
          ...s,
          theme: s.theme === "dark" ? "light" : "dark",
        })),
      category: "Settings",
    },
    {
      id: "settings",
      label: "Open Settings",
      action: () => setShowSettings(true),
      category: "Settings",
    },
    {
      id: "editor-mode",
      label: "Editor View",
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
        void handleToggleCanvas();
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

  // Get active tab info
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTabIsCanvas = !!activeTab && isCanvasFile(activeTab.path);
  const activeTabIsGraph = !!activeTab && activeTab.path === GRAPH_TAB_PATH;
  const hasAuxPane = showGraph || showCanvas;
  const shouldShowEditorPane =
    (!showGraph || !graphFullScreen) &&
    (!showCanvas || !canvasFullScreen) &&
    (activeTab || !hasAuxPane);
  const shouldShowPaneResizer =
    shouldShowEditorPane && !graphFullScreen && !canvasFullScreen && hasAuxPane;

  return (
    <div className="app">
      <TitleBar
        theme={theme}
        onCommandPalette={() => setShowCommandPalette(true)}
        commands={commands}
      />

      <div
        className="app-body"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as any}
      >
        {vaultPath && (
          <Ribbon
            onNewNote={handleNewNote}
            onSearch={() => {
              document.dispatchEvent(new CustomEvent("editor:open-search"));
            }}
            onGraph={() => {
              openGraphAsTab();
            }}
            onToggleExplorer={() => setShowSidebar((s) => !s)}
            onSettings={() => setShowSettings(true)}
            onDailyNote={handleCreateDailyNote}
            onToggleTags={() => setShowTags((t) => !t)}
            onToggleOutline={() => setShowOutline((o) => !o)}
            onThoughtModel={() => {
              setShowGraph(false);
              setShowCanvas(false);
              setShowThoughtModel((t) => !t);
            }}
            onCanvas={() => {
              void handleToggleCanvas();
            }}
          />
        )}
        <Sidebar
          visible={showSidebar}
          fileTree={fileTree}
          activeFilePath={activeTab?.path || null}
          starredNotes={starredNotes}
          onFileSelect={openFile}
          onNewNote={handleNewNote}
          onNewFolder={handleCreateFolder}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
          onRefresh={refreshFileTree}
          onCollapse={() => setShowSidebar(false)}
          onToggleStar={(path) => {
            setStarredNotes((prev) =>
              prev.includes(path)
                ? prev.filter((p) => p !== path)
                : [...prev, path],
            );
          }}
        />

        {showSidebar && vaultPath && (
          <div
            className="resizer"
            onMouseDown={startSidebarDrag}
            style={{ zIndex: 100 }}
          />
        )}

        <div
          className="main-content"
          ref={mainContentRef}
          style={{
            display: "flex",
            flexDirection: "row",
            width: "100%",
            height: "100%",
          }}
        >
          {!vaultPath ? (
            <WelcomeScreen onOpenVault={handleOpenVault} />
          ) : (
            <>
              {/* Editor pane - hidden when graph/canvas is fullscreen, or when no note is open and an auxiliary pane is visible */}
              {shouldShowEditorPane && (
                <div
                  style={{
                    flex: hasAuxPane ? `0 0 ${editorPaneWidth}%` : 1,
                    height: "100%",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {activeTab ? (
                    <Editor
                      tabs={tabs}
                      activeTabId={activeTabId!}
                      content={currentContent}
                      viewMode={viewMode}
                      specialContent={
                        activeTabIsCanvas ? (
                          <CanvasView
                            onClose={() => closeTab(activeTab.id)}
                            isFullScreen={false}
                            onToggleFullScreen={() =>
                              setCanvasFullScreen((f) => !f)
                            }
                            theme={theme}
                            vaultPath={vaultPath}
                            fileTree={fileTree}
                            canvasFilePath={activeTab.path}
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
                        ) : activeTabIsGraph ? (
                          <GraphView
                            onNodeClick={async (
                              linkName,
                              heading,
                              notePath,
                            ) => {
                              setViewMode("preview");
                              if (notePath) {
                                await openFile(notePath, "preview");
                                return;
                              }
                              await handleLinkClick(linkName, heading);
                            }}
                            onClose={() => closeTab(activeTab.id)}
                            isFullScreen={false}
                            onToggleFullScreen={() =>
                              setGraphFullScreen((f) => !f)
                            }
                            theme={theme}
                            vaultPath={vaultPath}
                            localNodePath={undefined}
                          />
                        ) : undefined
                      }
                      availableNotes={allNoteNames}
                      onAdjustFontSize={adjustEditorFontSize}
                      onTabSelect={async (id) => {
                        setActiveTabId(id);
                        const tab = tabs.find((t) => t.id === id);
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
                          const content = await api.readFile(tab.path);
                          setCurrentContent(content);
                          loadBacklinks(tab.path);
                        }
                      }}
                      onTabClose={closeTab}
                      onContentChange={handleContentChange}
                      onViewModeChange={setViewMode}
                      onLinkClick={handleLinkClick}
                      onImagePaste={handleImagePaste}
                      onGetNoteContent={getNoteContent}
                    />
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <FileText
                          size={48}
                          strokeWidth={1}
                          color="var(--text-muted)"
                        />
                      </div>
                      <div className="empty-text">
                        Select a note or create a new one
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resizer for Graph/Canvas */}
              {shouldShowPaneResizer && (
                <div className="resizer" onMouseDown={startPaneDrag} />
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
                  }}
                >
                  <GraphView
                    onNodeClick={async (linkName, heading, notePath) => {
                      setViewMode("preview");
                      if (graphFullScreen) {
                        setGraphFullScreen(false);
                      }
                      if (notePath) {
                        await openFile(notePath, "preview");
                        return;
                      }
                      await handleLinkClick(linkName, heading);
                    }}
                    onClose={() => setShowGraph(false)}
                    isFullScreen={graphFullScreen}
                    onToggleFullScreen={() => setGraphFullScreen((f) => !f)}
                    theme={theme}
                    vaultPath={vaultPath}
                    localNodePath={activeTab?.path}
                  />
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
                  }}
                >
                  <CanvasView
                    onClose={() => setShowCanvas(false)}
                    isFullScreen={canvasFullScreen}
                    onToggleFullScreen={() => setCanvasFullScreen((f) => !f)}
                    theme={theme}
                    autoHideDrawingControls={
                      settings.autoHideDrawingControls ?? true
                    }
                    vaultPath={vaultPath}
                    fileTree={fileTree}
                    canvasFilePath={canvasFilePath}
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

        {/* Thought Model Panel - independent of graph */}
        {showThoughtModel && vaultPath && (
          <>
            <div
              className="resizer"
              onMouseDown={startThoughtModelDrag}
              style={{ zIndex: 100 }}
            />
            <div
              className="thought-model-panel"
              style={{ width: `${thoughtModelWidth}px` }}
            >
              <ThoughtModelPage
                vaultPath={vaultPath}
                theme={theme}
                onOpenNote={(path) => {
                  openFile(path);
                }}
                onClose={() => setShowThoughtModel(false)}
                isFullScreen={false}
                onToggleFullScreen={() => {}}
              />
            </div>
          </>
        )}

        {/* Right Panels */}
        {activeTab && !showGraph && !activeTabIsCanvas && !activeTabIsGraph && (
          <>
            {showOutline && (
              <OutlinePane
                content={currentContent}
                onHeadingClick={(line) => {
                  // Scroll to line in editor
                  document.dispatchEvent(
                    new CustomEvent("editor:goto-line", { detail: line }),
                  );
                }}
                visible={showOutline}
              />
            )}

            {showOutgoingLinks && (
              <OutgoingLinksPanel
                content={currentContent}
                existingNotes={allNoteNames.map((n) => n.path)}
                onLinkClick={handleLinkClick}
                visible={showOutgoingLinks}
              />
            )}

            {showBacklinks && (
              <BacklinksPanel
                backlinks={backlinks}
                onBacklinkClick={openFile}
                onClose={() => setShowBacklinks(false)}
              />
            )}

            {showUnlinkedMentions && (
              <UnlinkedMentionsPanel
                currentNotePath={activeTab?.path || null}
                currentNoteName={activeTab?.name || ""}
                visible={showUnlinkedMentions}
                onNavigate={(path, line) => {
                  openFile(path);
                  // TODO: Scroll to line after file opens
                }}
              />
            )}
          </>
        )}

        {showTags && (
          <TagPane
            visible={showTags}
            onTagClick={(filePath) => openFile(filePath)}
          />
        )}
      </div>

      <StatusBar
        activeTab={activeTab || null}
        content={currentContent}
        theme={theme}
        viewMode={viewMode}
        fileTree={fileTree}
      />

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onSelect={(path) => {
            setShowSearch(false);
            openFile(path);
          }}
          recentFiles={recentFiles}
          starredNotes={starredNotes}
          fileTree={fileTree}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {showSettings && (
        <SettingsPage
          settings={settings}
          onSettingsChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showTemplateModal && (
        <TemplateModal
          onClose={() => setShowTemplateModal(false)}
          onInsert={handleTemplateInsert}
          currentNoteName={activeTab?.name}
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
    </div>
  );
}
