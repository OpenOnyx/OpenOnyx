import { useCallback } from "react";
import { getNoteName } from "../utils/helpers";
import { rewriteWikiLinks } from "../utils/wikiLinks";
import { collaborationEngine } from "../lib/collaborationEngine";
import { localDB } from "../lib/localdb";
import { syncEngine } from "../lib/syncEngine";
import { TFile } from "../lib/obsidian-api";
import { FileEntry } from "../types";
import { getAPI } from "../utils/api";

const api = getAPI();
const isCanvasFile = (path: string) => path.toLowerCase().endsWith(".canvas");

interface RenameNoteOptions {
  fileTree: FileEntry[];
  settings: any;
  allNoteNames: { name: string; path: string }[];
  ooAppRef: React.MutableRefObject<any>;
  clearAutoSaveTimer: () => void;
  updateEmbeddingsAfterRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  updateOpenPathsAfterRename: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  remapBookmarkPaths: (oldPath: string, newPath: string, isDirectory: boolean) => void;
  refreshFileTree: () => Promise<void>;
  setModal: (modal: any) => void;
}

export function useRenameNote({
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
}: RenameNoteOptions) {
  const handleRenameFile = useCallback(async (oldPath: string, newName: string) => {
    clearAutoSaveTimer();

    const findEntryByPath = (entries: FileEntry[], targetPath: string): FileEntry | null => {
      for (const entry of entries) {
        if (entry.path === targetPath) return entry;
        if (entry.isDirectory && entry.children) {
          const found = findEntryByPath(entry.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    };

    const existingEntry = findEntryByPath(fileTree, oldPath);
    const isDirectory = existingEntry?.isDirectory === true;

    const dir = oldPath.includes("/")
      ? oldPath.substring(0, oldPath.lastIndexOf("/") + 1)
      : "";
    const raw = newName.trim();
    const hasExt = /\.[a-z0-9]+$/i.test(raw);
    const inferredExt = isCanvasFile(oldPath) ? ".canvas" : ".md";
    const normalized = isDirectory
      ? raw
      : hasExt
        ? raw
        : `${raw}${inferredExt}`;
    const newPath = dir + normalized;
    if (!raw || oldPath === newPath) return;

    // Propagate rename to collaboration database & sync queue
    const spaceId = collaborationEngine.activeSpaceId;
    if (spaceId) {
      if (isDirectory) {
        const notes = await localDB.getNotes(spaceId);
        const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
        const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`;
        for (const note of notes) {
          if (note.path === oldPath) {
            note.path = newPath;
            note.title = newPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
            note.updated_at = new Date().toISOString();
            await localDB.putNote(note, true);
          } else if (note.path.startsWith(oldPrefix)) {
            const nextPath = `${newPrefix}${note.path.slice(oldPrefix.length)}`;
            note.path = nextPath;
            note.title = nextPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
            note.updated_at = new Date().toISOString();
            await localDB.putNote(note, true);
          }
        }
      } else {
        const note = await localDB.getNoteByPath(spaceId, oldPath);
        if (note) {
          note.path = newPath;
          note.title = newPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
          note.updated_at = new Date().toISOString();
          await localDB.putNote(note, true);
        }
      }
      syncEngine.triggerPush();
    }

    const app = ooAppRef.current;
    const vaultEntry = app?.vault.getAbstractFileByPath(oldPath);
    if (vaultEntry && app) {
      await app.vault.rename(vaultEntry, newPath);
    } else {
      await api.renameFile(oldPath, newPath);
      await app?.vault.refreshFiles?.();
    }

    updateEmbeddingsAfterRename(oldPath, newPath, isDirectory);
    updateOpenPathsAfterRename(oldPath, newPath, isDirectory);
    remapBookmarkPaths(oldPath, newPath, isDirectory);

    if (
      settings.autoUpdateInternalLinks &&
      !isDirectory &&
      oldPath.toLowerCase().endsWith(".md") &&
      newPath.toLowerCase().endsWith(".md")
    ) {
      const oldName = getNoteName(oldPath);
      const newName = getNoteName(newPath);
      for (const note of allNoteNames) {
        if (!note.path.toLowerCase().endsWith(".md")) continue;
        try {
          const text = await api.readFile(note.path);
          const updated = rewriteWikiLinks(text, oldName, newName);
          if (updated !== text) {
            await api.writeFile(note.path, updated);
          }
        } catch {
          // Keep rename successful even if one link update fails.
        }
      }
    }

    await refreshFileTree();
  }, [
    fileTree,
    settings,
    allNoteNames,
    ooAppRef,
    clearAutoSaveTimer,
    updateEmbeddingsAfterRename,
    updateOpenPathsAfterRename,
    remapBookmarkPaths,
    refreshFileTree,
  ]);

  const handleMoveFile = useCallback(async (oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;

    clearAutoSaveTimer();

    try {
      // Propagate move/rename to collaboration database & sync queue
      const spaceId = collaborationEngine.activeSpaceId;
      if (spaceId) {
        const isFile = oldPath.toLowerCase().endsWith(".md") || oldPath.toLowerCase().endsWith(".canvas");
        if (isFile) {
          const note = await localDB.getNoteByPath(spaceId, oldPath);
          if (note) {
            note.path = newPath;
            note.title = newPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
            note.updated_at = new Date().toISOString();
            await localDB.putNote(note, true);
          }
        } else {
          // Folder move
          const notes = await localDB.getNotes(spaceId);
          const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
          const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`;
          for (const note of notes) {
            if (note.path === oldPath) {
              note.path = newPath;
              note.title = newPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
              note.updated_at = new Date().toISOString();
              await localDB.putNote(note, true);
            } else if (note.path.startsWith(oldPrefix)) {
              const nextPath = `${newPrefix}${note.path.slice(oldPrefix.length)}`;
              note.path = nextPath;
              note.title = nextPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || newPath;
              note.updated_at = new Date().toISOString();
              await localDB.putNote(note, true);
            }
          }
        }
        syncEngine.triggerPush();
      }

      const app = ooAppRef.current;
      const vaultEntry = app?.vault.getAbstractFileByPath(oldPath);
      const isDirectory = Boolean(vaultEntry && !(vaultEntry instanceof TFile))
        || !(oldPath.toLowerCase().endsWith(".md") || oldPath.toLowerCase().endsWith(".canvas"));
      if (vaultEntry && app) {
        await app.vault.rename(vaultEntry, newPath);
      } else {
        await api.renameFile(oldPath, newPath);
        await app?.vault.refreshFiles?.();
      }

      updateEmbeddingsAfterRename(oldPath, newPath, isDirectory);
      updateOpenPathsAfterRename(oldPath, newPath, isDirectory);
      remapBookmarkPaths(oldPath, newPath, isDirectory);

      await refreshFileTree();
    } catch (err) {
      console.error("Move failed:", err);
      setModal({
        type: "confirm",
        title: "Move Failed",
        message: `Could not move ${oldPath} to ${newPath}.`,
      });
    }
  }, [
    ooAppRef,
    clearAutoSaveTimer,
    updateEmbeddingsAfterRename,
    updateOpenPathsAfterRename,
    remapBookmarkPaths,
    refreshFileTree,
    setModal,
  ]);

  return { handleRenameFile, handleMoveFile };
}
