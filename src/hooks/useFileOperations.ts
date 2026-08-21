import { useCallback } from "react";
import { Tab, PaneNode, FileEntry } from "../types";
import { getAPI } from "../utils/api";
import { localDB } from "../lib/localdb";
import { collaborationEngine } from "../lib/collaborationEngine";
import { syncEngine } from "../lib/syncEngine";
import { getNoteName, generateId } from "../utils/helpers";
import { loadStore, removeEmbedding, removeEmbeddingsByPrefix } from "../utils/embeddings";
import {
  splitLeaf,
  collectAllTabs,
  findLeafWithTab,
} from "../components/layout/SplitPaneContainer";
import {
  mergePaneTabsWithPreservedUngrouped,
} from "../utils/tabGroups";

const api = getAPI();
const GRAPH_TAB_PATH = "__graph__.view";
const SPACES_TAB_PATH = "__spaces__.view";

interface FileOperationsOptions {
  vaultPath: string | null;
  settings: any;
  tabs: Tab[];
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  paneTree: PaneNode;
  setPaneTree: React.Dispatch<React.SetStateAction<PaneNode>>;
  focusedLeafId: string;
  setFocusedLeafId: (id: string) => void;
  activeGroupId: string | null;
  groups: any[];
  currentContent: string;
  setCurrentContent: (content: string) => void;
  closeTab: (id: string) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  setModal: (modal: any) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  promptForInput: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
  clearAutoSaveTimer: () => void;
  updateEmbeddingsAfterRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  updateOpenPathsAfterRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  remapBookmarkPaths: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  removeBookmarksForPath: (path: string, isDirectory: boolean) => void;
  openFile: (path: string) => Promise<void>;
  skipTabSyncRef: React.MutableRefObject<boolean>;
  handleRenameFile: (oldPath: string, newName: string) => Promise<void>;
  handleMoveFile: (oldPath: string, newPath: string) => Promise<void>;
  allNoteNames: { name: string; path: string }[];
  noteContentCache: Map<string, string>;
  setNoteContentCache: React.Dispatch<React.SetStateAction<Map<string, string>>>;
}

export function useFileOperations({
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
}: FileOperationsOptions) {

  const handleDeleteFile = async (filePath: string, isDir: boolean = false) => {
    const performDelete = async () => {
      try {
        clearAutoSaveTimer();

        // Propagate delete to collaboration database & sync queue
        const spaceId = collaborationEngine.activeSpaceId;
        if (spaceId) {
          if (isDir) {
            const notes = await localDB.getNotes(spaceId);
            const dirPrefix = filePath.endsWith('/') ? filePath : `${filePath}/`;
            for (const note of notes) {
              if (note.path === filePath || note.path.startsWith(dirPrefix)) {
                await localDB.deleteNote(note.id, true);
              }
            }
          } else {
            const note = await localDB.getNoteByPath(spaceId, filePath);
            if (note) {
              await localDB.deleteNote(note.id, true);
            }
          }
          syncEngine.triggerPush();
        }

        if (settings.deletedFilesMode === "system-trash" && (api as any).trashFile) {
          await (api as any).trashFile(filePath);
          if (isDir) {
            const store = loadStore();
            removeEmbeddingsByPrefix(store, filePath);
          } else if (filePath.toLowerCase().endsWith(".md")) {
            const store = loadStore();
            removeEmbedding(store, filePath);
          }
        } else if (!isDir && settings.deletedFilesMode === "app-trash") {
          const trashPath = `.trash/${filePath}`;
          const content = await api.readFile(filePath);
          await api.createFile(trashPath, content);
          await api.deleteFile(filePath);
          if (filePath.toLowerCase().endsWith(".md")) {
            const store = loadStore();
            removeEmbedding(store, filePath);
          }
        } else {
          if (isDir) {
            await api.deleteDirectory(filePath);
            const store = loadStore();
            removeEmbeddingsByPrefix(store, filePath);
          } else {
            await api.deleteFile(filePath);
            if (filePath.toLowerCase().endsWith(".md")) {
              const store = loadStore();
              removeEmbedding(store, filePath);
            }
          }
        }
        removeBookmarksForPath(filePath, isDir);

        // Close tab if open (for files) or close all tabs within the folder
        if (isDir) {
          // Close all tabs that are within this directory
          tabs.forEach((tab) => {
            if (
              tab.path.startsWith(filePath + "/") ||
              tab.path === filePath
            ) {
              void closeTab(tab.id);
            }
          });
        } else {
          const tab = tabs.find((t) => t.path === filePath);
          if (tab) void closeTab(tab.id);
        }

        await refreshFileTree();
      } catch (error) {
        console.error("Failed to delete:", error);
      }
    };

    if (settings.confirmBeforeDelete === false) {
      await performDelete();
      return;
    }

    setModal({
      type: "confirm",
      title: isDir ? "Delete Folder" : "Delete File",
      message: `Delete "${getNoteName(filePath)}"${isDir ? " and all its contents" : ""}?`,
      onConfirm: async (confirmed: boolean) => {
        if (!confirmed) return;
        await performDelete();
      },
    });
  };

  const getAbsoluteVaultPath = useCallback(
    (relativePath: string): string | null => {
      if (!vaultPath) return null;
      const separator = vaultPath.includes("\\") ? "\\" : "/";
      const normalizedVault = vaultPath.replace(/[\\/]+$/, "");
      const normalizedRelative = relativePath.replace(/^[/\\]+/, "").replace(/[\\/]+/g, separator);
      return `${normalizedVault}${separator}${normalizedRelative}`;
    },
    [vaultPath],
  );

  const handleNoteMenuToggleBacklinks = useCallback(() => {
    // Note menu action: toggle display of backlinks in right sidebar
  }, []);

  const handleSplitNotePane = useCallback(
    (leafId: string, tab: Tab, zone: "right" | "bottom") => {
      if (!tab.path || tab.path === "__new_tab__") return;
      const splitTab: Tab = {
        ...tab,
        id: generateId(),
        isModified: false,
      };
      const nextTree = splitLeaf(paneTree, leafId, splitTab, zone);
      const nextTabs = collectAllTabs(nextTree);
      if (!nextTabs.some((candidate) => candidate.id === splitTab.id)) return;
      const splitLeafTarget = findLeafWithTab(nextTree, splitTab.id);

      skipTabSyncRef.current = true;
      setPaneTree(nextTree);
      setTabs((previousTabs) =>
        activeGroupId
          ? mergePaneTabsWithPreservedUngrouped(nextTabs, previousTabs, groups)
          : nextTabs,
      );
      setActiveTabId(splitTab.id);
      if (splitLeafTarget) setFocusedLeafId(splitLeafTarget.id);
    },
    [activeGroupId, groups, paneTree, skipTabSyncRef, setPaneTree, setTabs, setActiveTabId, setFocusedLeafId],
  );

  const handleNoteMenuRename = useCallback(
    async (path: string) => {
      const currentName = path.split("/").pop() || getNoteName(path);
      const nextName = await promptForInput("Rename file", "Enter a new file name:", currentName);
      if (!nextName) return;
      if (/[\\/]/.test(nextName)) {
        showToast("File name cannot contain path separators.", "error");
        return;
      }
      await handleRenameFile(path, nextName);
    },
    [handleRenameFile, promptForInput, showToast],
  );

  const handleNoteMenuMove = useCallback(
    async (path: string) => {
      const nextPathInput = await promptForInput("Move file to", "Enter a vault-relative destination path:", path);
      if (!nextPathInput) return;

      const trimmed = nextPathInput.replace(/^[/\\]+/, "").trim();
      if (!trimmed || trimmed === path) return;

      const oldExt = path.match(/\.[a-z0-9]+$/i)?.[0] || "";
      const nextPath = /\.[a-z0-9]+$/i.test(trimmed) || !oldExt ? trimmed : `${trimmed}${oldExt}`;
      await handleMoveFile(path, nextPath);
    },
    [handleMoveFile, promptForInput],
  );

  const handleCopyNoteRelativePath = useCallback(
    (path: string) => {
      void api.writeClipboardText(path);
      showToast("Copied relative path", "success");
    },
    [showToast],
  );

  const handleCopyNoteAbsolutePath = useCallback(
    (path: string) => {
      const absolutePath = getAbsoluteVaultPath(path);
      if (!absolutePath) {
        showToast("No vault path is available.", "error");
        return;
      }
      void api.writeClipboardText(absolutePath);
      showToast("Copied absolute path", "success");
    },
    [getAbsoluteVaultPath, showToast],
  );

  const handleOpenNoteInDefaultApp = useCallback(
    async (path: string) => {
      const absolutePath = getAbsoluteVaultPath(path);
      if (!absolutePath) {
        showToast("No vault path is available.", "error");
        return;
      }
      const error = await api.openPath(absolutePath);
      if (error) showToast("Could not open file in default app.", "error");
    },
    [getAbsoluteVaultPath, showToast],
  );

  const handleShowNoteInSystemExplorer = useCallback(
    (path: string) => {
      const absolutePath = getAbsoluteVaultPath(path);
      if (!absolutePath) {
        showToast("No vault path is available.", "error");
        return;
      }
      void api.showItemInFolder(absolutePath);
    },
    [getAbsoluteVaultPath, showToast],
  );

  const handleRevealNoteInNavigation = useCallback((path: string) => {
    // Reveal note in sidebar navigation
  }, []);

  const handleCreateFolder = async (parentPath: string) => {
    setModal({
      type: "prompt",
      title: "New Folder",
      message: "Enter folder name:",
      onConfirm: async (name: string) => {
        if (typeof name !== "string" || !name.trim()) return;

        const folderPath = parentPath ? `${parentPath}/${name}` : name;
        await api.createDirectory(folderPath);
        await refreshFileTree();
      },
    });
  };

  const formatDailyNoteDate = (format: string) => {
    const date = new Date();
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return (format || "YYYY-MM-DD")
      .replace(/YYYY/g, yyyy)
      .replace(/MM/g, mm)
      .replace(/DD/g, dd);
  };

  const handleCreateDailyNote = async () => {
    if (settings.coreDailyNotes === false) {
      showToast("Daily notes plugin is disabled.", "info");
      return;
    }

    const baseName = formatDailyNoteDate(settings.dailyNoteDateFormat);
    const folder = settings.dailyNoteLocation.trim().replace(/^\/+|\/+$/g, "");
    const filePath = `${folder ? `${folder}/` : ""}${baseName.endsWith(".md") ? baseName : `${baseName}.md`}`;

    let content = `# ${baseName}\n\n`;
    const templatePath = settings.dailyNoteTemplate.trim();
    if (templatePath) {
      try {
        content = (await api.readFile(templatePath.endsWith(".md") ? templatePath : `${templatePath}.md`)) || content;
      } catch {
        showToast("Daily note template was not found. Created a blank daily note.", "info");
      }
    }

    if (!(await api.fileExists(filePath))) {
      await api.createFile(filePath, content);
      if (collaborationEngine.activeSpaceId) {
        await collaborationEngine.persistNoteEdit(filePath, content);
        syncEngine.triggerPush();
      }
      await refreshFileTree();
    }
    await openFile(filePath);
  };

  const handleTemplateInsert = (templateContent: string) => {
    if (activeTabId) {
      const newContent = currentContent + "\n" + templateContent;
      setCurrentContent(newContent);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, isModified: true } : t,
        ),
      );
    }
  };

  const handleImagePaste = async (file: File): Promise<string | null> => {
    const readFileAsDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === "string") {
            resolve(result);
          } else {
            reject(new Error("FileReader result is not a string"));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

    try {
      const dataUrl = await readFileAsDataUrl(file);
      return dataUrl;
    } catch (err) {
      console.error("Failed to read image as data URL:", err);
      return null;
    }
  };

  const getNoteContent = useCallback(
    (noteName: string): string | null => {
      const cached = noteContentCache.get(noteName);
      if (cached !== undefined) return cached;

      const note = allNoteNames.find(
        (n) => n.name.toLowerCase() === noteName.toLowerCase(),
      );

      if (!note) return null;
      api.readFile(note.path).then((content) => {
        setNoteContentCache((prev) => {
          const next = new Map(prev);
          next.set(noteName, content);
          return next;
        });
      });

      return null;
    },
    [noteContentCache, allNoteNames, setNoteContentCache],
  );

  return {
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
  };
}
