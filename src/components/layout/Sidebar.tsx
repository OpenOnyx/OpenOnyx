/**
 * Sidebar - File Explorer Panel
 *
 * Shows the vault's file tree with expand/collapse for directories,
 * context menus for file operations, and drag-and-drop support.
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  RefreshCw,
  FileEdit,
  Trash2,
  Star,
  ChevronDown,
  ChevronLeft,
  Search,
  X,
  ArrowUpDown,
  Palette,
  Image,
  FileCode,
  File,
  ChevronsUpDown,
  Check,
  Library,
  Settings,
  Plus,
  MoreVertical,
  Copy,
  Home,
} from "lucide-react";
import { FileEntry } from "../../types";
import { getNoteName } from "../../utils/helpers";
import { PluginViewPanel } from "../plugins/PluginViewPanel";
import { LocalGroup } from "../../lib/localdb";
import { getAPI } from "../../utils/api";

interface SidebarProps {
  visible: boolean;
  fileTree: FileEntry[];
  showAllFileTypes?: boolean;
  activeFilePath: string | null;
  starredNotes: string[];
  onFileSelect: (path: string) => void;
  onNewNote: (parentPath?: string) => void;
  onNewFolder: (parentPath: string) => void;
  onDeleteFile: (path: string, isDir: boolean) => void;
  onRenameFile: (oldPath: string, newName: string) => void;
  onMoveFile: (oldPath: string, newPath: string) => void | Promise<void>;
  onRefresh: () => void;
  onToggleStar: (path: string) => void;
  onCollapse: () => void;
  vaultPath?: string;
  onOpenVault?: () => void;
  onManageVaults?: () => void;
  previouslyOpenedVaults?: string[];
  onSwitchVault?: (path: string) => void;
  onSettings?: () => void;
  pluginViews?: Array<{ viewType: string; displayText: string; icon: string; containerEl: HTMLElement; pluginId?: string }>;
  onClosePluginView?: (viewType: string) => void;
  groups?: LocalGroup[];
  onAddFileToGroup?: (path: string, groupId: string) => void | Promise<void>;
  activeGroupId?: string | null;
  onCreateGroup?: () => void;
  onCreateGroupFromFile?: (path: string) => void;
  onCreateGroupFromFolder?: (folderName: string, paths: string[]) => void | Promise<void>;
  onBookmarkFile?: (path: string) => void;
  onRestoreGroup?: (id: string) => void;
  onRenameGroup?: (id: string, name: string) => void;
  onChangeGroupColor?: (id: string, color: string) => void;
  onDeleteGroup?: (id: string) => void;
  onDuplicateGroup?: (id: string) => void;
  onToggleGroupAutoSave?: (id: string) => void;
  hasWallpaper?: boolean;
  revealFolderRequest?: { path: string; nonce: number } | null;
  onRevealFolderHandled?: () => void;
}

type SortMode =
  | "name-asc"
  | "name-desc"
  | "modified-desc"
  | "modified-asc"
  | "type-asc"
  | "type-desc";

// ── File Type Helpers ────────────────────────────────────────────────────────


function countChildren(entries: FileEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory && e.children) count += countChildren(e.children);
    else count++;
  }
  return count;
}

function sortEntries(entries: FileEntry[], mode: SortMode): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Directories always first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    switch (mode) {
      case "modified-desc": {
        const difference = (b.modifiedAt || 0) - (a.modifiedAt || 0);
        return difference || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      case "modified-asc": {
        const difference = (a.modifiedAt || 0) - (b.modifiedAt || 0);
        return difference || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      case "type-asc": {
        const extA = a.extension || "";
        const extB = b.extension || "";
        if (extA !== extB) return extA.localeCompare(extB);
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      case "type-desc": {
        const extA = a.extension || "";
        const extB = b.extension || "";
        if (extA !== extB) return extB.localeCompare(extA);
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      case "name-desc":
        return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      case "name-asc":
      default:
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
  });

  return sorted.map((e) =>
    e.isDirectory && e.children
      ? { ...e, children: sortEntries(e.children, mode) }
      : e,
  );
}

function filterTree(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries;
  const q = query.toLowerCase();
  return entries.reduce<FileEntry[]>((acc, entry) => {
    if (entry.isDirectory && entry.children) {
      const filtered = filterTree(entry.children, query);
      if (filtered.length > 0) {
        acc.push({ ...entry, children: filtered });
      }
    } else if (entry.name.toLowerCase().includes(q)) {
      acc.push(entry);
    }
    return acc;
  }, []);
}

function collectGroupableFilePaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];

  const walk = (items: FileEntry[]) => {
    for (const entry of items) {
      if (entry.isDirectory) {
        walk(entry.children || []);
        continue;
      }

      if (entry.extension === ".md" || entry.extension === ".canvas") {
        paths.push(entry.path);
      }
    }
  };

  walk(entries);
  return paths;
}

function findNodeByPath(entries: FileEntry[], path: string): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.isDirectory && entry.children) {
      const found = findNodeByPath(entry.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function NewFileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 61.49"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M36,16.7a11.82,11.82,0,0,0,1.48-8.43,10.21,10.21,0,0,0-4.8-6.87c-5.05-3-11.8-1-15,4.42l-2.31,3.9L33.69,20.6Zm-4.22-3.43-9.09-5.4C24.51,5.47,27.63,4.6,30,6a4.91,4.91,0,0,1,2.29,3.35A6.4,6.4,0,0,1,31.78,13.27Z" />
      <path d="M1.51,53.93l1.57.78,15.27-8.25L31,25.19,12.62,14.3,0,35.58.08,51.41A3,3,0,0,0,1.51,53.93Zm13-32.32,9.17,5.44L14.51,42.47,5.39,47.4,5.34,37Z" />
      <rect y="56.16" width="64" height="5.33" rx="2.67" />
    </svg>
  );
}

function NewFolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 58.67"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M45.33,50.67h5.34V56A2.67,2.67,0,1,0,56,56V50.67h5.33a2.67,2.67,0,0,0,0-5.34H56V40a2.67,2.67,0,1,0-5.33,0v5.33H45.33a2.67,2.67,0,0,0,0,5.34Z" />
      <path d="M34.67,53.33H8a2.67,2.67,0,0,1-2.67-2.66v-32A2.67,2.67,0,0,1,8,16H58.67V29.33A2.66,2.66,0,0,0,61.33,32h0A2.66,2.66,0,0,0,64,29.33V8a8,8,0,0,0-8-8H45.33a8,8,0,0,0-6.4,3.2l-5.6,7.47H8a8,8,0,0,0-8,8v32a8,8,0,0,0,8,8H34.67A2.67,2.67,0,0,0,37.33,56h0A2.67,2.67,0,0,0,34.67,53.33ZM43.2,6.4a2.68,2.68,0,0,1,2.13-1.07H56A2.68,2.68,0,0,1,58.67,8v2.67H40Z" />
    </svg>
  );
}

const sidebarRootClass =
  "sidebar onyx-tree workspace-leaf-content nav-files-container relative flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-tree,var(--bg-secondary))] pt-0";
const sidebarCollapsedClass =
  "collapsed !m-0 hidden !w-0 !min-w-0 !max-w-0 !overflow-hidden !border-x-0 !p-0";
const sidebarHeaderClass =
  "flex min-h-8 shrink-0 items-center justify-between gap-1 px-2 py-1";
const sidebarActionsClass = "flex shrink-0 flex-nowrap items-center justify-end gap-px ml-auto";
const sidebarBtnClass =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-[var(--text-secondary)] transition-[var(--transition-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarBtnActiveClass =
  "bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]";
const sidebarFilterClass =
  "onyx-quick-search mx-2 mt-2 mb-1.5 flex items-center gap-2 rounded-full bg-[var(--bg-input,var(--bg-tertiary))] px-3 py-1.5 shadow-none";
const sidebarFilterIconClass = "shrink-0 text-[var(--text-muted)]";
const sidebarFilterInputClass =
  "flex-1 min-w-0 border-0 bg-transparent py-0.5 font-sans text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]";
const sidebarFilterClearClass =
  "flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0.5 text-[var(--text-muted)] transition-[var(--transition-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarSortMenuClass =
  "sort-menu absolute right-2 top-9 z-[2500] min-w-[184px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]";
const sidebarSortMenuItemClass =
  "flex w-full cursor-pointer items-center border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarSortMenuItemActiveClass =
  "bg-[var(--bg-active)] text-[var(--text-primary)]";
const fileExplorerClass =
  "file-explorer nav-files-container flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-6 pt-0.5 transition-[background-color,box-shadow] duration-200";
const fileExplorerDragClass =
  "bg-[rgba(var(--accent-color-rgb,37,99,235),0.05)] shadow-[inset_0_0_0_2px_var(--accent-primary)]";
const fileTreeItemBaseClass =
  "file-tree-item tree-item-self nav-file-title group relative mb-px flex min-h-[28px] w-full cursor-pointer items-center gap-1.5 rounded-[var(--nav-item-radius,6px)] border-0 bg-transparent py-0.5 pl-6 pr-2 text-left font-sans text-[13px] leading-[1.3] text-[var(--nav-item-color)] transition-[background-color,color,box-shadow] duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--nav-item-color-hover)]";
const fileTreeItemActiveClass =
  "active !bg-[var(--bg-tree-selected,var(--nav-item-background-selected))] !text-[var(--nav-item-color-selected)] shadow-[0_1px_2px_rgba(15,23,42,0.06)] font-medium";
const fileTreeItemDraggingClass =
  "dragging scale-[0.98] bg-[var(--bg-hover)] opacity-40 grayscale-[0.5] [&_.name]:text-[1.1em] [&_.name]:font-semibold [&_.name]:text-[var(--accent-primary)]";
const fileTreeItemDragOverClass =
  "z-10 translate-x-1 !bg-[var(--nav-item-background-hover)] shadow-[inset_0_0_0_2px_var(--accent-primary)]";
const fileNameClass = "name flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const chevronClass =
  "chevron absolute left-1.5 flex text-[var(--text-muted)] transition-transform duration-150";
const folderCountClass =
  "folder-count ml-auto shrink-0 rounded-lg bg-[var(--bg-tertiary)] px-[5px] text-[10px] leading-4 text-[var(--text-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100";
const treeChildrenWrapperClass =
  "file-tree-children-wrapper grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]";
const treeChildrenClass =
  "file-tree-children min-h-0 py-0 pl-2 ml-2";
const emptyFolderHintClass =
  "py-1.5 pl-7 pr-2 text-[11px] italic text-[var(--text-muted)] opacity-60";
const renameInputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--accent-primary)] bg-[var(--bg-primary)] px-1.5 py-0.5 font-sans text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[0_0_0_3px_var(--accent-glow)] outline-none";
const sidebarSectionClass = "shrink-0 px-2 py-1.5";
const sectionHeaderClass =
  "flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border-0 bg-transparent px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]";
const sectionChevronClass = "flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)]";
const sectionIconClass = "shrink-0 text-[var(--text-muted)]";
const sectionCountClass =
  "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bg-tertiary)] px-1.5 text-[10px] font-semibold text-[var(--text-muted)]";
const starredListClass = "flex flex-col gap-0.5 p-[var(--space-1)]";
const starredItemClass =
  "starred-item min-h-9 items-start gap-2 rounded-[var(--nav-item-radius,6px)] px-2.5 py-[6px]";
const starredActiveClass =
  "!bg-[var(--bg-tree-selected,#fff)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]";
const starIconClass = "star-icon mt-0.5 shrink-0";
const starredTextClass = "flex min-w-0 flex-col items-start gap-0.5";
const starredPathClass =
  "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[var(--text-muted)]";
const groupsSectionClass =
  "groups-section shrink-0 bg-transparent [background-image:none] px-2 py-0.5";
const groupHeaderWrapperClass = "flex min-h-[28px] items-center gap-px";
const groupSectionHeaderClass =
  "flex min-h-[28px] min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--nav-item-radius)] border-0 bg-transparent py-0.5 pl-1.5 pr-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const sectionHeaderActionClass =
  "flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--nav-item-radius)] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const groupsListWrapperClass =
  "grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]";
const groupsListClass = "min-h-0 overflow-hidden py-0.5";
const groupItemContainerClass =
  "group relative flex min-h-[28px] items-center rounded-[var(--nav-item-radius)]";
const groupItemActiveClass =
  "!bg-[var(--bg-tree-selected,#fff)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]";
const groupItemBtnClass =
  "flex min-h-[28px] min-w-0 flex-1 cursor-pointer items-center rounded-[var(--nav-item-radius)] border-0 bg-transparent py-0.5 pl-2.5 pr-8 text-left font-sans text-[13px] leading-[1.3] text-[var(--nav-item-color)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--nav-item-color-hover)]";
const groupNameTextClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const groupAutoBadgeClass =
  "ml-auto rounded-lg bg-[var(--bg-tertiary)] px-[5px] text-[9px] font-semibold uppercase leading-4 tracking-[0.04em] text-[var(--text-muted)]";
const groupItemActionsClass =
  "absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100";
const groupActionBtnClass =
  "flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[var(--nav-item-radius)] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const sidebarFooterClass =
  "relative mt-auto flex shrink-0 items-center gap-1 border-t border-[var(--border-subtle)] bg-[var(--bg-tree,var(--bg-secondary))] p-2";
const vaultSelectorBtnClass =
  "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-1.5 py-1 text-left text-[13px] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] [&_.vault-selector-icon]:shrink-0";
const vaultSelectorActiveClass = "bg-[var(--bg-hover)] text-[var(--text-primary)]";
const vaultSelectorNameClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const sidebarSettingsBtnClass =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const vaultMenuClass =
  "vault-menu absolute top-[calc(100%+2px)] left-0 w-[200px] z-[2200] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]";
const vaultMenuHeaderClass =
  "px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]";
const vaultMenuItemClass =
  "flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const vaultMenuCurrentClass = "text-[var(--text-primary)]";
const vaultMenuActionClass = "[&_.action-icon]:text-[var(--text-muted)]";
const vaultNameClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const vaultCheckIconClass = "shrink-0 text-[var(--accent-primary)]";
const vaultMenuSeparatorClass = "mx-2 my-1 h-px bg-[var(--border-subtle)]";
const contextMenuClass =
  "context-menu fixed z-[3301] flex min-w-[180px] max-w-[calc(100vw-16px)] flex-col overflow-visible rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)] pointer-events-auto";
const contextMenuItemClass =
  "context-menu-item flex min-h-7 w-full cursor-pointer items-center border-0 bg-transparent px-3 py-1 text-left font-sans text-[13px] leading-5 text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const contextMenuDangerClass =
  "danger text-[var(--danger,#f43f5e)] hover:bg-[rgba(244,63,94,0.12)] hover:text-[var(--danger,#f43f5e)]";
const contextMenuSeparatorClass =
  "context-menu-separator mx-2 my-1 h-px bg-[var(--border-subtle)]";
const contextSubmenuContainerClass = "group relative";
const contextSubmenuHeaderClass = `${contextMenuItemClass} justify-between`;
const contextSubmenuClass =
  "absolute top-[-5px] z-[3302] hidden min-w-[180px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)] group-hover:block";

const MENU_VIEWPORT_MARGIN = 8;
const SIDEBAR_CONTEXT_MENU_WIDTH = 220;
const FILE_CONTEXT_MENU_HEIGHT = 190;
const FOLDER_CONTEXT_MENU_HEIGHT = 148;
const GROUP_CONTEXT_MENU_HEIGHT = 280;

function clampMenuPosition(
  x: number,
  y: number,
  width = SIDEBAR_CONTEXT_MENU_WIDTH,
  height = FILE_CONTEXT_MENU_HEIGHT,
) {
  const maxX = Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - width - MENU_VIEWPORT_MARGIN);
  const maxY = Math.max(MENU_VIEWPORT_MARGIN, window.innerHeight - height - MENU_VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(x, MENU_VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(y, MENU_VIEWPORT_MARGIN), maxY),
  };
}

export function Sidebar({
  visible,
  fileTree,
  showAllFileTypes = false,
  activeFilePath,
  starredNotes,
  onFileSelect,
  onNewNote,
  onNewFolder,
  onDeleteFile,
  onRenameFile,
  onMoveFile,
  onRefresh,
  onToggleStar,
  onCollapse,
  vaultPath,
  onOpenVault,
  onManageVaults,
  previouslyOpenedVaults = [],
  onSwitchVault,
  onSettings,
  pluginViews,
  onClosePluginView,
  groups = [],
  activeGroupId = null,
  onCreateGroup = () => {},
  onCreateGroupFromFile = () => {},
  onCreateGroupFromFolder = () => {},
  onBookmarkFile = () => {},
  onRestoreGroup = () => {},
  onRenameGroup = () => {},
  onChangeGroupColor = () => {},
  onDeleteGroup = () => {},
  onDuplicateGroup = () => {},
  onToggleGroupAutoSave = () => {},
  onAddFileToGroup = () => {},
  hasWallpaper = false,
  revealFolderRequest = null,
  onRevealFolderHandled,
}: SidebarProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [isFoldersCollapsed, setIsFoldersCollapsed] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [moveModal, setMoveModal] = useState<{
    path: string;
    isDir: boolean;
  } | null>(null);
  const [showStarred, setShowStarred] = useState(true);
  const [showGroups, setShowGroups] = useState(true);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number;
    y: number;
    groupId: string;
  } | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const availableDirectories = useMemo(() => {
    if (!moveModal) return [];
    
    const dirs: Array<{ path: string; name: string; depth: number }> = [
      { path: "", name: "Root Directory ( / )", depth: 0 }
    ];
    
    const walk = (items: FileEntry[], depth: number) => {
      for (const entry of items) {
        if (entry.isDirectory) {
          // Do not include the folder itself or any subfolder of the folder being moved
          if (moveModal.isDir && (entry.path === moveModal.path || entry.path.startsWith(moveModal.path + "/"))) {
            continue;
          }
          dirs.push({
            path: entry.path,
            name: entry.name,
            depth: depth + 1
          });
          if (entry.children) {
            walk(entry.children, depth + 1);
          }
        }
      }
    };
    walk(fileTree, 0);
    return dirs;
  }, [fileTree, moveModal]);
  const [showVaultMenu, setShowVaultMenu] = useState(false);
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const vaultButtonRef = useRef<HTMLButtonElement>(null);
  const renameInFlightRef = useRef(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const isMac = typeof window !== "undefined" && navigator.platform.toLowerCase().includes("mac");
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Click outside handler for vault menu
  useEffect(() => {
    if (!showVaultMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        vaultMenuRef.current &&
        !vaultMenuRef.current.contains(e.target as Node) &&
        vaultButtonRef.current &&
        !vaultButtonRef.current.contains(e.target as Node)
      ) {
        setShowVaultMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showVaultMenu]);

  useEffect(() => {
    if (!showSortMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        !sortButtonRef.current?.contains(e.target as Node) &&
        !sortMenuRef.current?.contains(e.target as Node)
      ) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSortMenu]);

  const vaultName = vaultPath ? vaultPath.split(/[/\\]/).pop() : "Vault";
  const otherVaults = previouslyOpenedVaults.filter((p) => p !== vaultPath);

  // Process file tree: filter then sort
  const processedTree = useMemo(() => {
    const filterSupportedTypes = (entries: FileEntry[]): FileEntry[] =>
      entries.reduce<FileEntry[]>((acc, entry) => {
        if (entry.isDirectory) {
          const children = filterSupportedTypes(entry.children || []);
          acc.push({ ...entry, children });
          return acc;
        }
        if (showAllFileTypes || entry.extension === ".md" || entry.extension === ".canvas") {
          acc.push(entry);
        }
        return acc;
      }, []);
    const visibleTree = showAllFileTypes ? fileTree : filterSupportedTypes(fileTree);
    const filtered = filterTree(visibleTree, filterQuery);
    return sortEntries(filtered, sortMode);
  }, [fileTree, filterQuery, sortMode, showAllFileTypes]);

  // When filtering, auto-expand all directories so matches are visible
  const effectiveExpanded = useMemo(() => {
    if (!filterQuery) return expandedDirs;
    const allDirs = new Set<string>();
    function walk(entries: FileEntry[]) {
      for (const e of entries) {
        if (e.isDirectory) {
          allDirs.add(e.path);
          if (e.children) walk(e.children);
        }
      }
    }
    walk(processedTree);
    return allDirs;
  }, [filterQuery, expandedDirs, processedTree]);

  useEffect(() => {
    if (!activeFilePath) return;
    const parts = activeFilePath.split("/");
    const idx = activeFilePath.lastIndexOf("/");
    const parentPath = idx <= 0 ? "" : activeFilePath.slice(0, idx);

    setSelectedFolder((current) => {
      if (current === "starred" && starredNotes.includes(activeFilePath)) {
        return current;
      }
      if (current === parentPath) {
        return current;
      }
      return parentPath;
    });

    if (parts.length < 2) return;
    setExpandedDirs((previous) => {
      const next = new Set(previous);
      let parent = "";
      let changed = false;
      for (const part of parts.slice(0, -1)) {
        parent = parent ? `${parent}/${part}` : part;
        if (!next.has(parent)) {
          next.add(parent);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [activeFilePath, starredNotes]);

  useEffect(() => {
    if (!revealFolderRequest) return;
    const targetPath = revealFolderRequest.path;
    const maxRevealAttempts = 20;
    let frame = 0;
    let attempts = 0;

    setFilterQuery("");
    setSelectedFolder(targetPath);
    setIsFoldersCollapsed(false);

    setExpandedDirs((previous) => {
      const next = new Set(previous);
      let currentPath = "";
      let changed = false;

      for (const part of targetPath.split("/").filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!next.has(currentPath)) {
          next.add(currentPath);
          changed = true;
        }
      }

      return changed ? next : previous;
    });

    const revealTarget = () => {
      const folderItems = document.querySelectorAll<HTMLElement>("[data-sidebar-folder-path]");
      const target = Array.from(folderItems).find(
        (element) => element.dataset.sidebarFolderPath === targetPath,
      );
      if (target) {
        target.scrollIntoView({ block: "nearest" });
        onRevealFolderHandled?.();
        return;
      }

      attempts += 1;
      if (attempts < maxRevealAttempts) {
        frame = window.requestAnimationFrame(revealTarget);
      }
    };

    frame = window.requestAnimationFrame(revealTarget);

    return () => window.cancelAnimationFrame(frame);
  }, [onRevealFolderHandled, revealFolderRequest]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    path: string,
    isDir: boolean,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      ...clampMenuPosition(
        e.clientX,
        e.clientY,
        SIDEBAR_CONTEXT_MENU_WIDTH,
        isDir ? FOLDER_CONTEXT_MENU_HEIGHT : FILE_CONTEXT_MENU_HEIGHT,
      ),
      path,
      isDir,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleGroupContextMenu = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupContextMenu({
      ...clampMenuPosition(e.clientX, e.clientY, SIDEBAR_CONTEXT_MENU_WIDTH, GROUP_CONTEXT_MENU_HEIGHT),
      groupId,
    });
  };

  const startRename = (path: string) => {
    renameInFlightRef.current = false;
    setRenamingPath(path);
    setRenameValue(getNoteName(path));
    closeContextMenu();
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameInFlightRef.current) return;

    if (renamingPath && renameValue.trim()) {
      renameInFlightRef.current = true;
      onRenameFile(renamingPath, renameValue.trim());
      setTimeout(() => {
        renameInFlightRef.current = false;
      }, 0);
    }
    setRenamingPath(null);
    setRenameValue("");
  };

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";
    setDraggingPath(path);
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverPath(targetPath);
  };

  const handleDragLeave = () => {
    setDragOverPath(null);
  };

  const handleDragEnd = () => {
    setDraggingPath(null);
    setDragOverPath(null);
  };

  const handleDrop = async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    setDraggingPath(null);
    const sourcePath = e.dataTransfer.getData("text/plain");
    
    // Safety check: don't move a folder into itself or its child
    if (sourcePath && targetDir.startsWith(sourcePath + "/")) {
      return;
    }

    if (sourcePath && sourcePath !== targetDir) {
      const parts = sourcePath.split("/");
      const fileName = parts.pop() || sourcePath;
      
      // If we are moving a folder, we need its name too
      const newPath = targetDir ? `${targetDir}/${fileName}` : fileName;
      
      if (sourcePath === newPath) return;

      try {
        await onMoveFile(sourcePath, newPath);
      } catch (err) {
        console.error("Move failed:", err);
      }
    }
  };

  const sortOptions: Array<{
    mode: SortMode;
    label: string;
  }> = [
    { mode: "name-asc", label: "File name (A to Z)" },
    { mode: "name-desc", label: "File name (Z to A)" },
    { mode: "modified-desc", label: "Modified time (new to old)" },
    { mode: "modified-asc", label: "Modified time (old to new)" },
    { mode: "type-asc", label: "File extension (A to Z)" },
    { mode: "type-desc", label: "File extension (Z to A)" },
  ];

  const renderFileTree = (entries: FileEntry[], depth: number = 0) => {
    return entries.map((entry) => {
      const isExpanded = effectiveExpanded.has(entry.path);
      const isActive = entry.path === activeFilePath;
      const isDragOver = entry.path === dragOverPath;
      const isDragging = entry.path === draggingPath;
      const isRenaming = entry.path === renamingPath;
      const childCount = entry.isDirectory && entry.children ? countChildren(entry.children) : 0;

      return (
        <React.Fragment key={entry.path}>
          <button
            className={cx(
              fileTreeItemBaseClass,
              isActive && fileTreeItemActiveClass,
              isDragOver && fileTreeItemDragOverClass,
              isDragging && fileTreeItemDraggingClass,
            )}
            onClick={() => {
              if (entry.isDirectory) {
                toggleDir(entry.path);
              } else if (
                entry.extension === ".md" ||
                entry.extension === ".canvas"
              ) {
                onFileSelect(entry.path);
              }
            }}
            onContextMenu={(e) =>
              handleContextMenu(e, entry.path, entry.isDirectory)
            }
            draggable={true}
            onDragStart={(e) => handleDragStart(e, entry.path)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => {
              const targetPath = entry.isDirectory ? entry.path : (entry.path.split('/').slice(0, -1).join('/'));
              handleDragOver(e, targetPath);
            }}
            onDragLeave={handleDragLeave}
            onDrop={(e) => {
              const targetPath = entry.isDirectory ? entry.path : (entry.path.split('/').slice(0, -1).join('/'));
              handleDrop(e, targetPath);
            }}
          >
            {entry.isDirectory && (
              <span className={cx(chevronClass, isExpanded && "open rotate-90")}>
                <ChevronRight size={16} strokeWidth={2.25} />
              </span>
            )}

            {isRenaming ? (
              <form onSubmit={handleRenameSubmit} style={{ flex: 1 }}>
                <input
                  className={renameInputClass}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </form>
            ) : (
              <span className={fileNameClass}>
                {entry.isDirectory ? entry.name : getNoteName(entry.name)}
              </span>
            )}
            {entry.isDirectory && childCount > 0 && !isRenaming && (
              <span className={folderCountClass}>{childCount}</span>
            )}
          </button>

          {entry.isDirectory && entry.children && (
            <div className={cx(treeChildrenWrapperClass, isExpanded && "open grid-rows-[1fr]")}>
              <div className={treeChildrenClass}>
                {entry.children.length > 0 ? (
                  renderFileTree(sortEntries(entry.children, sortMode), depth + 1)
                ) : (
                  <div className={emptyFolderHintClass}>Empty</div>
                )}
              </div>
            </div>
          )}
        </React.Fragment>
      );
    });
  };

  const getStarredParentPath = (path: string) => {
    const idx = path.lastIndexOf("/");
    if (idx <= 0) return "Vault root";
    return path.slice(0, idx);
  };

  const getNotesForView = useCallback(() => {
    const allFiles: FileEntry[] = [];
    const collect = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (entry.children) collect(entry.children);
        } else {
          if (showAllFileTypes || entry.extension === ".md" || entry.extension === ".canvas") {
            allFiles.push(entry);
          }
        }
      }
    };
    collect(fileTree);

    let filtered = allFiles;
    if (selectedFolder === "starred") {
      filtered = allFiles.filter((f) => starredNotes.includes(f.path));
    } else {
      const targetFolder = selectedFolder || "";
      filtered = allFiles.filter((f) => {
        const idx = f.path.lastIndexOf("/");
        const parent = idx <= 0 ? "" : f.path.slice(0, idx);
        return parent === targetFolder;
      });
    }

    if (filterQuery) {
      const query = filterQuery.toLowerCase();
      filtered = filtered.filter((f) => f.name.toLowerCase().includes(query));
    }

    return sortEntries(filtered, sortMode);
  }, [fileTree, selectedFolder, filterQuery, sortMode, starredNotes, showAllFileTypes]);

  const notesList = useMemo(() => getNotesForView(), [getNotesForView]);

  const groupedNotes = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = startOfToday - 29 * 24 * 60 * 60 * 1000;

    const sections: Array<{ id: string; title: string; notes: FileEntry[] }> = [
      { id: "today", title: "Today", notes: [] },
      { id: "yesterday", title: "Yesterday", notes: [] },
      { id: "sevenDays", title: "Previous 7 days", notes: [] },
      { id: "thirtyDays", title: "Previous 30 days", notes: [] },
      { id: "older", title: "Older", notes: [] },
    ];

    for (const note of notesList) {
      const time = note.modifiedAt || 0;
      if (time >= startOfToday) {
        sections[0].notes.push(note);
      } else if (time >= startOfYesterday) {
        sections[1].notes.push(note);
      } else if (time >= sevenDaysAgo) {
        sections[2].notes.push(note);
      } else if (time >= thirtyDaysAgo) {
        sections[3].notes.push(note);
      } else {
        sections[4].notes.push(note);
      }
    }

    return sections.filter((s) => s.notes.length > 0);
  }, [notesList]);

  useEffect(() => {
    const api = getAPI();
    notesList.forEach((note) => {
      if (previews[note.path] !== undefined) return;
      if (note.extension === ".canvas") {
        setPreviews((prev) => ({ ...prev, [note.path]: "Canvas Document" }));
        return;
      }
      api.readFile(note.path)
        .then((content) => {
          let clean = content
            .replace(/^---\r?\n[\s\S]*?\r?\n---/g, '')
            .replace(/^#+\s+/gm, '')
            .replace(/\[\[(.*?)\]\]/g, '$1')
            .replace(/[*\-_`#]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const snippet = clean.slice(0, 100) || "No additional text";
          setPreviews((prev) => ({ ...prev, [note.path]: snippet }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [note.path]: "No additional text" }));
        });
    });
  }, [notesList, previews]);

  const countDescendantNotes = (entry: FileEntry): number => {
    if (!entry.isDirectory) return 0;
    let count = 0;
    const walk = (children: FileEntry[]) => {
      for (const child of children) {
        if (child.isDirectory) {
          if (child.children) walk(child.children);
        } else {
          if (showAllFileTypes || child.extension === ".md" || child.extension === ".canvas") {
            count++;
          }
        }
      }
    };
    if (entry.children) walk(entry.children);
    return count;
  };

  const renderFoldersOnlyTree = (entries: FileEntry[], depth: number = 0) => {
    const dirs = entries.filter((e) => e.isDirectory);
    return dirs.map((entry) => {
      const childDirs = (entry.children || []).filter((c) => c.isDirectory);
      const directNotes = (entry.children || []).filter(
        (c) => !c.isDirectory && (showAllFileTypes || c.extension === ".md" || c.extension === ".canvas")
      );
      const hasNoNotesButHasSubfolders = directNotes.length === 0 && childDirs.length > 0;
      const isExpanded = effectiveExpanded.has(entry.path);
      const isSelected = selectedFolder === entry.path;
      const isDragOver = dragOverPath === entry.path;
      const noteCount = countDescendantNotes(entry);
      const isRenaming = entry.path === renamingPath;

      return (
        <React.Fragment key={entry.path}>
          <button
            data-sidebar-folder-path={entry.path}
            className={cx(
              "nn-folder-item",
              isSelected && "active",
              isDragOver && "bg-[rgba(var(--accent-color-rgb,37,99,235),0.08)] shadow-[inset_0_0_0_1px_var(--accent-primary)]",
              entry.path === draggingPath && "opacity-40 scale-[0.98]"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={(e) => {
              if (isRenaming) {
                e.stopPropagation();
                return;
              }
              e.stopPropagation();
              if (hasNoNotesButHasSubfolders) {
                toggleDir(entry.path);
              } else {
                setSelectedFolder(entry.path);
                setIsFoldersCollapsed(true);
              }
            }}
            onDoubleClick={(e) => {
              if (isRenaming) {
                e.stopPropagation();
                return;
              }
              e.stopPropagation();
              toggleDir(entry.path);
            }}
            onContextMenu={(e) => handleContextMenu(e, entry.path, true)}
            draggable={!isRenaming}
            onDragStart={(e) => handleDragStart(e, entry.path)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, entry.path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, entry.path)}
          >
            <span
              style={{
                width: '16px',
                minWidth: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.15s ease',
                transform: isExpanded ? 'rotate(90deg)' : 'none',
                visibility: childDirs.length > 0 ? 'visible' : 'hidden',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                toggleDir(entry.path);
              }}
            >
              <ChevronRight size={14} strokeWidth={2.25} />
            </span>
            <Folder size={14} className="shrink-0 opacity-70" />
            {isRenaming ? (
              <form onSubmit={handleRenameSubmit} onClick={(e) => e.stopPropagation()} style={{ flex: 1 }}>
                <input
                  className={renameInputClass}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setRenamingPath(null);
                      setRenameValue("");
                    }
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </form>
            ) : (
              <>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {entry.name}
                </span>
                {noteCount > 0 && (
                  <span className="text-[11px] text-[var(--text-muted,#8a8a8f)] ml-auto tabular-nums">
                    {noteCount}
                  </span>
                )}
              </>
            )}
          </button>
          {isExpanded && childDirs.length > 0 && (
            <div className="file-tree-children">
              {renderFoldersOnlyTree(sortEntries(entry.children || [], sortMode), depth + 1)}
            </div>
          )}
        </React.Fragment>
      );
    });
  };

  const getRelativeDate = (timestamp: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    
    if (
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    ) {
      return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear()
    ) {
      return "Yesterday";
    }
    
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: "long" });
    }
    
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const sortLabel =
    sortOptions.find((option) => option.mode === sortMode)?.label ||
    "File name (A to Z)";
  const hasPrimaryPluginView = Boolean(pluginViews?.length);

  return (
    <>
      <div 
        className={cx(sidebarRootClass, !visible && sidebarCollapsedClass)}
        style={{
          ...isMac ? { paddingTop: '32px' } : {},
          ...(hasWallpaper ? {} : { backgroundColor: 'var(--bg-tree, var(--bg-secondary))' })
        }}
      >
        {hasPrimaryPluginView ? (
          <PluginViewPanel
            views={pluginViews || []}
            onClose={onClosePluginView || (() => {})}
            fill
          />
        ) : (
          <>
            {/* Quick search */}
            <div className={sidebarFilterClass}>
              <Search size={14} className={sidebarFilterIconClass} strokeWidth={1.75} />
              <input
                type="search"
                className={sidebarFilterInputClass}
                placeholder="Search notes..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                aria-label="Quick search"
              />
              {filterQuery && (
                <button
                  type="button"
                  className={sidebarFilterClearClass}
                  onClick={() => setFilterQuery("")}
                  title="Clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Top Vault Selector Toolbar */}
            <div className={`${sidebarHeaderClass} relative`}>
              {vaultPath && (
                <div className="relative flex items-center min-w-0 flex-1 mr-2">
                  <button
                    ref={vaultButtonRef}
                    className={cx(vaultSelectorBtnClass, showVaultMenu && vaultSelectorActiveClass)}
                    onClick={() => setShowVaultMenu(!showVaultMenu)}
                    title="Switch Vault"
                    style={{ padding: '2px 6px', height: '28px' }}
                  >
                    <ChevronsUpDown size={16} className="vault-selector-icon" />
                    <span className={vaultSelectorNameClass} style={{ fontSize: '12px' }}>{vaultName}</span>
                  </button>
                  
                  {showVaultMenu && (
                    <div className={vaultMenuClass} ref={vaultMenuRef}>
                      {[vaultPath, ...otherVaults].filter(Boolean).map((path) => {
                        const value = path as string;
                        const name = value.split(/[/\\]/).pop() || value;
                        const isCurrent = value === vaultPath;
                        return (
                          <button
                            key={value}
                            className={cx(vaultMenuItemClass, isCurrent && vaultMenuCurrentClass)}
                            onClick={() => {
                              setShowVaultMenu(false);
                              if (!isCurrent) onSwitchVault?.(value);
                            }}
                            title={value}
                          >
                            <span className={vaultNameClass}>{name}</span>
                            {isCurrent && <Check size={14} className={vaultCheckIconClass} />}
                          </button>
                        );
                      })}
                      <div className={vaultMenuSeparatorClass} />
                      {(onManageVaults || onOpenVault) && (
                        <button
                          className={cx(vaultMenuItemClass, vaultMenuActionClass)}
                          onClick={() => {
                            setShowVaultMenu(false);
                            if (onManageVaults) {
                              onManageVaults();
                            } else {
                              onOpenVault?.();
                            }
                          }}
                        >
                          <Library size={14} className="action-icon" />
                          <span>Manage vaults...</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              <div className={sidebarActionsClass}>
                <button
                  className={sidebarBtnClass}
                  onClick={() => onNewNote(selectedFolder && selectedFolder !== "starred" ? selectedFolder : "")}
                  title="New Note"
                >
                  <Plus size={15} />
                </button>
                <button
                  className={sidebarBtnClass}
                  onClick={() => onNewFolder(selectedFolder && selectedFolder !== "starred" ? selectedFolder : "")}
                  title="New Folder"
                >
                  <Folder size={15} />
                </button>
                <button
                  ref={sortButtonRef}
                  className={sidebarBtnClass}
                  onClick={() => setShowSortMenu((value) => !value)}
                  title={`Sort: ${sortLabel}`}
                >
                  <ArrowUpDown size={16} strokeWidth={1.5} />
                </button>
                <button className={sidebarBtnClass} onClick={onRefresh} title="Refresh">
                  <RefreshCw size={16} strokeWidth={1.5} />
                </button>
              </div>
              
              {showSortMenu && (
                <div ref={sortMenuRef} className={sidebarSortMenuClass}>
                  {sortOptions.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      className={cx(
                        sidebarSortMenuItemClass,
                        sortMode === option.mode && sidebarSortMenuItemActiveClass,
                      )}
                      aria-pressed={sortMode === option.mode}
                      onClick={() => {
                        setSortMode(option.mode);
                        setShowSortMenu(false);
                      }}
                    >
                      <span className="min-w-0">{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Apple Notes Content Wrapper */}
            <div className="nn-explorer-container flex-1">
              {/* Left column: Folders, Groups */}
              {!isFoldersCollapsed ? (
                <div
                  className="nn-folders-pane"
                  style={{ width: "100%" }}
                >
                  {/* Special / virtual views */}
                  <button
                    data-sidebar-folder-path=""
                    className={cx(
                      "nn-folder-item",
                      selectedFolder === "" && "active",
                      dragOverPath === "" && "bg-[rgba(var(--accent-color-rgb,37,99,235),0.08)] shadow-[inset_0_0_0_1px_var(--accent-primary)]"
                    )}
                    onClick={() => {
                      setSelectedFolder("");
                      setIsFoldersCollapsed(true);
                    }}
                    onDragOver={(e) => handleDragOver(e, "")}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, "")}
                  >
                    <Home size={15} className="shrink-0 opacity-70" />
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">Root Directory</span>
                  </button>
                  
                  <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />
                  
                  {/* Folders tree */}
                  <div className="sidebar-section">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Folders
                    </div>
                    {processedTree.length > 0 ? (
                      renderFoldersOnlyTree(processedTree)
                    ) : (
                      <div className="px-2 py-1.5 text-xs italic text-[var(--text-muted)]">No folders</div>
                    )}
                  </div>

                  <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />

                  {/* Groups list */}
                  {groups.length > 0 && (
                    <div className="sidebar-section">
                      <button
                        className={sectionHeaderClass}
                        onClick={() => setShowGroups(!showGroups)}
                      >
                        <span className={sectionChevronClass}>
                          {showGroups ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </span>
                        <span>Groups</span>
                        <span className={sectionCountClass}>{groups.length}</span>
                      </button>
                      {showGroups && (
                        <div className="flex flex-col gap-0.5 mt-1">
                          {groups.map((group) => (
                            <div
                              key={group.id}
                              className={cx(
                                "nn-folder-item",
                                activeGroupId === group.id && "active"
                              )}
                            >
                              <button
                                className="flex-1 bg-transparent border-0 p-0 m-0 text-left cursor-pointer text-current flex items-center min-w-0"
                                onClick={() => onRestoreGroup(group.id)}
                                onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
                              >
                                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{group.name}</span>
                                {group.auto_save_enabled && (
                                  <span className={groupAutoBadgeClass}>
                                    auto
                                  </span>
                                )}
                              </button>
                              <button
                                className="p-1 hover:bg-[var(--bg-hover)] rounded border-0 bg-transparent text-[var(--text-muted)]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGroupContextMenu(e, group.id);
                                }}
                              >
                                <MoreVertical size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Right column: Notes cards */
                <div 
                  className="nn-notes-pane file-explorer"
                  onDragOver={(e) => handleDragOver(e, "")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "")}
                  style={{ width: "100%" }}
                >
                  <div className="nn-compact-header">
                    <button
                      className="nn-back-btn"
                      onClick={() => {
                        setIsFoldersCollapsed(false);
                      }}
                      title="Back to Folders"
                    >
                      <ChevronLeft size={16} />
                      <span>Back</span>
                    </button>
                    <span className="text-xs font-semibold text-[var(--text-primary)] ml-auto pr-2">
                      {selectedFolder === "" ? "Root Directory" : selectedFolder ? selectedFolder.split("/").pop() : "Root Directory"}
                    </span>
                  </div>
                {groupedNotes.length > 0 ? (
                  groupedNotes.map((section) => {
                    const isCollapsed = collapsedSections[section.id];
                    return (
                      <React.Fragment key={section.id}>
                        <button
                          className="nn-section-header"
                          onClick={() =>
                            setCollapsedSections((prev) => ({
                              ...prev,
                              [section.id]: !prev[section.id],
                            }))
                          }
                        >
                          <span>{section.title}</span>
                          <ChevronDown
                            size={12}
                            className="nn-section-header-chevron"
                            style={{
                              transform: isCollapsed ? "rotate(-90deg)" : "none",
                            }}
                          />
                        </button>
                        {!isCollapsed &&
                          section.notes.map((note) => {
                            const isActive = note.path === activeFilePath;
                            const isStarred = starredNotes.includes(note.path);
                            const snippet = previews[note.path];
                            const dateStr = getRelativeDate(note.modifiedAt);
                            const isCanvas = note.extension === ".canvas";

                            const isRenaming = note.path === renamingPath;
                            return (
                              <div
                                key={note.path}
                                className={cx("nn-note-card", isActive && "active")}
                                onClick={(e) => {
                                  if (isRenaming) {
                                    e.stopPropagation();
                                    return;
                                  }
                                  onFileSelect(note.path);
                                }}
                                onContextMenu={(e) => handleContextMenu(e, note.path, false)}
                                draggable={!isRenaming}
                                onDragStart={(e) => handleDragStart(e, note.path)}
                              >
                                {isRenaming ? (
                                  <form onSubmit={handleRenameSubmit} onClick={(e) => e.stopPropagation()} style={{ width: '100%', marginBottom: '4px' }}>
                                    <input
                                      className={renameInputClass}
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onBlur={handleRenameSubmit}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                          setRenamingPath(null);
                                          setRenameValue("");
                                        }
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </form>
                                ) : (
                                  <div className="nn-card-title">{getNoteName(note.name)}</div>
                                )}
                                <div className="nn-card-meta">
                                  {snippet && snippet !== "No additional text" && (
                                    <div className="nn-card-snippet">{snippet}</div>
                                  )}
                                  <div className="nn-card-date">{dateStr}</div>
                                </div>
                                {(isCanvas || isStarred) && (
                                  <div className="nn-card-indicators">
                                    {isCanvas && <span className="nn-badge">Canvas</span>}
                                    {isStarred && <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[var(--text-muted)] p-4">
                    <FileText size={24} className="opacity-30" />
                    <div>No notes here</div>
                  </div>
                )}
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 3300 }}
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
          <div
            className={contextMenuClass}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {!contextMenu.isDir && (
              <>
                <button
                  className={contextMenuItemClass}
                  onClick={() => {
                    onFileSelect(contextMenu.path);
                    closeContextMenu();
                  }}
                >
                  Open
                </button>
                <button
                  className={contextMenuItemClass}
                  onClick={() => {
                    onToggleStar(contextMenu.path);
                    closeContextMenu();
                  }}
                >
                  {starredNotes.includes(contextMenu.path) ? "Unstar" : "Star"}
                </button>
                <div className={contextSubmenuContainerClass}>
                  <button className={contextSubmenuHeaderClass}>
                    <span>Add to group</span>
                    <span aria-hidden="true">›</span>
                  </button>
                  <div
                    className={cx(
                      contextSubmenuClass,
                      contextMenu.x + SIDEBAR_CONTEXT_MENU_WIDTH * 2 + MENU_VIEWPORT_MARGIN > window.innerWidth
                        ? "right-[calc(100%-2px)]"
                        : "left-[calc(100%-2px)]",
                    )}
                  >
                    {groups.length > 0 ? groups.map((group) => (
                      <button
                        key={group.id}
                        className={contextMenuItemClass}
                        onClick={() => {
                          void onAddFileToGroup(contextMenu.path, group.id);
                          closeContextMenu();
                        }}
                      >
                        {group.name}
                      </button>
                    )) : (
                      <button
                        className={contextMenuItemClass}
                        onClick={() => {
                          const path = contextMenu.path;
                          closeContextMenu();
                          onCreateGroupFromFile(path);
                        }}
                      >
                        Create new group
                      </button>
                    )}
                  </div>
                </div>
                <button
                  className={contextMenuItemClass}
                  onClick={() => {
                    const path = contextMenu.path;
                    closeContextMenu();
                    onBookmarkFile(path);
                  }}
                >
                  Add bookmark
                </button>
              </>
            )}
            <button
              className={contextMenuItemClass}
              onClick={() => startRename(contextMenu.path)}
            >
              Rename
            </button>
            <button
              className={contextMenuItemClass}
              onClick={() => {
                const path = contextMenu.path;
                const isDir = contextMenu.isDir;
                closeContextMenu();
                setMoveModal({ path, isDir });
              }}
            >
              Move to...
            </button>
            {contextMenu.isDir && (
              <button
                className={contextMenuItemClass}
                onClick={() => {
                  onNewFolder(contextMenu.path);
                  closeContextMenu();
                }}
              >
                New Subfolder
              </button>
            )}
            {contextMenu.isDir && (
              <button
                className={contextMenuItemClass}
                onClick={() => {
                  const folder = findNodeByPath(fileTree, contextMenu.path);
                  const paths = folder?.children ? collectGroupableFilePaths(folder.children) : [];
                  const folderName = folder?.name || contextMenu.path.split("/").filter(Boolean).pop() || "Folder";
                  closeContextMenu();
                  void onCreateGroupFromFolder(folderName, paths);
                }}
              >
                Create group from folder
              </button>
            )}
            <div className={contextMenuSeparatorClass} />
            <button
              className={cx(contextMenuItemClass, contextMenuDangerClass)}
              onClick={() => {
                onDeleteFile(contextMenu.path, contextMenu.isDir);
                closeContextMenu();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Group Context Menu */}
      {groupContextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 3300 }}
            onClick={() => setGroupContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setGroupContextMenu(null);
            }}
          />
          <div
            className={contextMenuClass}
            style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
          >
            {(() => {
              const group = groups.find((g) => g.id === groupContextMenu.groupId);
              if (!group) return null;
              return (
                <>
                  <button
                    className={contextMenuItemClass}
                    onClick={() => {
                      onToggleGroupAutoSave(group.id);
                      setGroupContextMenu(null);
                    }}
                  >
                    <Check size={14} style={{ marginRight: 8, opacity: group.auto_save_enabled ? 1 : 0 }} /> 
                    <span>Auto-update Layout</span>
                  </button>
                  <div className={contextMenuSeparatorClass} />
                  <button
                    className={contextMenuItemClass}
                    onClick={() => {
                      onRenameGroup(group.id, group.name);
                      setGroupContextMenu(null);
                    }}
                  >
                    <FileEdit size={14} style={{ marginRight: 8 }} /> Rename
                  </button>
                  <button
                    className={contextMenuItemClass}
                    onClick={() => {
                      onChangeGroupColor(group.id, group.color);
                      setGroupContextMenu(null);
                    }}
                  >
                    <Palette size={14} style={{ marginRight: 8 }} /> Change Color
                  </button>
                  <button
                    className={contextMenuItemClass}
                    onClick={() => {
                      onDuplicateGroup(group.id);
                      setGroupContextMenu(null);
                    }}
                  >
                    <Copy size={14} style={{ marginRight: 8 }} /> Duplicate
                  </button>
                  <div className={contextMenuSeparatorClass} />
                  <button
                    className={cx(contextMenuItemClass, contextMenuDangerClass)}
                    onClick={() => {
                      onDeleteGroup(group.id);
                      setGroupContextMenu(null);
                    }}
                  >
                    <Trash2 size={14} style={{ marginRight: 8 }} /> Delete
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
      {moveModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="absolute inset-0" onClick={() => setMoveModal(null)} />
          <div className="relative flex flex-col w-[min(90vw,440px)] max-h-[75vh] rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xl overflow-hidden z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Move {moveModal.isDir ? "Folder" : "Note"}
              </span>
              <button
                type="button"
                onClick={() => setMoveModal(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1 max-h-[40vh]">
              <div className="px-2 pb-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Select Destination Folder
              </div>
              {availableDirectories.map((dir) => {
                const displayName = dir.name;
                const currentParent = moveModal.path.substring(0, moveModal.path.lastIndexOf("/"));
                const isCurrentParent = currentParent === dir.path;
                
                return (
                  <button
                    key={dir.path}
                    type="button"
                    onClick={async () => {
                      if (isCurrentParent) {
                        setMoveModal(null);
                        return;
                      }
                      const parts = moveModal.path.split("/");
                      const fileName = parts.pop() || moveModal.path;
                      const nextPath = dir.path ? `${dir.path}/${fileName}` : fileName;
                      
                      try {
                        await onMoveFile(moveModal.path, nextPath);
                      } catch (err) {
                        console.error("Move failed:", err);
                      }
                      setMoveModal(null);
                    }}
                    className={cx(
                      "flex items-center gap-2 rounded-md py-1.5 px-3 text-left transition-colors duration-150 text-xs w-full",
                      isCurrentParent 
                        ? "text-[var(--text-muted)] bg-[var(--bg-secondary)] cursor-not-allowed opacity-60" 
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                    style={{ paddingLeft: `${dir.depth * 16 + 12}px` }}
                    disabled={isCurrentParent}
                  >
                    <Folder size={14} className="shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {displayName}
                    </span>
                    {isCurrentParent && (
                      <span className="text-[10px] italic text-[var(--text-muted)] ml-auto shrink-0">
                        Current Parent
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              <button
                type="button"
                onClick={() => setMoveModal(null)}
                className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
