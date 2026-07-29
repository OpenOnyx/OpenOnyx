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
} from "lucide-react";
import { FileEntry } from "../../types";
import { getNoteName } from "../../utils/helpers";
import { PluginViewPanel } from "../plugins/PluginViewPanel";
import { LocalGroup } from "../../lib/localdb";

interface SidebarProps {
  visible: boolean;
  fileTree: FileEntry[];
  showAllFileTypes?: boolean;
  activeFilePath: string | null;
  starredNotes: string[];
  onFileSelect: (path: string) => void;
  onNewNote: () => void;
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
  "sidebar relative flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-t border-[var(--divider-color)] bg-[var(--bg-secondary)] pt-0";
const sidebarCollapsedClass =
  "collapsed !m-0 hidden !w-0 !min-w-0 !max-w-0 !overflow-hidden !border-x-0 !p-0";
const sidebarHeaderClass =
  "flex min-h-9 shrink-0 items-center justify-center gap-1 px-2 py-1";
const sidebarActionsClass = "flex shrink-0 flex-nowrap items-center justify-center gap-px";
const sidebarBtnClass =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-[var(--text-secondary)] transition-[var(--transition-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarBtnActiveClass =
  "bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]";
const sidebarFilterClass =
  "flex items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1";
const sidebarFilterIconClass = "shrink-0 text-[var(--text-muted)]";
const sidebarFilterInputClass =
  "flex-1 border-0 bg-transparent py-1 font-sans text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]";
const sidebarFilterClearClass =
  "flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0.5 text-[var(--text-muted)] transition-[var(--transition-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarSortMenuClass =
  "absolute right-2 top-9 z-[2500] min-w-[184px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-none";
const sidebarSortMenuItemClass =
  "flex w-full cursor-pointer items-center border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const sidebarSortMenuItemActiveClass =
  "bg-[var(--bg-active)] text-[var(--text-primary)]";
const fileExplorerClass =
  "file-explorer flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-1 transition-[background-color,box-shadow] duration-200";
const fileExplorerDragClass =
  "bg-[rgba(var(--accent-color-rgb,108,99,255),0.05)] shadow-[inset_0_0_0_2px_var(--accent-primary)]";
const fileTreeItemBaseClass =
  "file-tree-item group relative mb-0 flex min-h-[23px] w-full cursor-pointer items-center gap-1.5 rounded-[var(--nav-item-radius)] border-0 bg-transparent py-0.5 pl-6 pr-2 text-left font-sans text-[length:var(--nav-item-size)] leading-[1.2] text-[var(--nav-item-color)] transition-[background-color,color,transform,opacity,filter,box-shadow] duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--nav-item-color-hover)]";
const fileTreeItemActiveClass =
  "active !bg-[var(--nav-item-background-selected)]";
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
  "file-tree-children min-h-0 border-l border-[color-mix(in_srgb,var(--text-muted)_22%,transparent)] py-0 pl-2 ml-3.5";
const emptyFolderHintClass =
  "py-1.5 pl-7 pr-2 text-[11px] italic text-[var(--text-muted)] opacity-60";
const renameInputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--accent-primary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-sans text-[length:var(--text-sm)] text-[var(--text-primary)] shadow-[0_0_0_3px_var(--accent-glow)] outline-none";
const sidebarSectionClass = "shrink-0 border-b border-[var(--border-subtle)] px-2 py-1.5";
const sectionHeaderClass =
  "flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border-0 bg-transparent px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]";
const sectionChevronClass = "flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)]";
const sectionIconClass = "shrink-0 text-[var(--text-muted)]";
const sectionCountClass =
  "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bg-tertiary)] px-1.5 text-[10px] font-semibold text-[var(--text-muted)]";
const starredListClass = "flex flex-col gap-1 p-[var(--space-1)]";
const starredItemClass =
  "starred-item min-h-10 items-start gap-2 rounded-[var(--radius-sm)] px-2.5 py-[7px]";
const starredActiveClass =
  "border border-[color-mix(in_srgb,var(--accent-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_16%,transparent)]";
const starIconClass = "star-icon mt-0.5 shrink-0";
const starredTextClass = "flex min-w-0 flex-col items-start gap-0.5";
const starredPathClass =
  "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[var(--text-muted)]";
const groupsSectionClass =
  "groups-section shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] [background-image:none] px-3 py-0.5";
const groupHeaderWrapperClass = "flex min-h-[23px] items-center gap-px";
const groupSectionHeaderClass =
  "flex min-h-[23px] min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--nav-item-radius)] border-0 bg-transparent py-0.5 pl-1.5 pr-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const sectionHeaderActionClass =
  "flex h-[23px] w-[23px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--nav-item-radius)] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const groupsListWrapperClass =
  "grid grid-rows-[0fr] overflow-hidden transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]";
const groupsListClass = "min-h-0 overflow-hidden py-0.5";
const groupItemContainerClass =
  "group relative flex min-h-[23px] items-center rounded-[var(--nav-item-radius)]";
const groupItemActiveClass =
  "bg-[var(--nav-item-background-selected)]";
const groupItemBtnClass =
  "flex min-h-[23px] min-w-0 flex-1 cursor-pointer items-center rounded-[var(--nav-item-radius)] border-0 bg-transparent py-0.5 pl-2.5 pr-8 text-left font-sans text-[length:var(--nav-item-size)] leading-[1.2] text-[var(--nav-item-color)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--nav-item-color-hover)]";
const groupNameTextClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const groupAutoBadgeClass =
  "ml-auto rounded-lg bg-[var(--bg-tertiary)] px-[5px] text-[9px] font-semibold uppercase leading-4 tracking-[0.04em] text-[var(--text-muted)]";
const groupItemActionsClass =
  "absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100";
const groupActionBtnClass =
  "flex h-[21px] w-[21px] cursor-pointer items-center justify-center rounded-[var(--nav-item-radius)] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-75 hover:bg-[var(--nav-item-background-hover)] hover:text-[var(--text-primary)]";
const sidebarFooterClass =
  "relative mt-auto flex shrink-0 items-center gap-1 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2";
const vaultSelectorBtnClass =
  "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border-0 bg-transparent px-1.5 py-1 text-left text-[13px] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] [&_.vault-selector-icon]:shrink-0";
const vaultSelectorActiveClass = "bg-[var(--bg-hover)] text-[var(--text-primary)]";
const vaultSelectorNameClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const sidebarSettingsBtnClass =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const vaultMenuClass =
  "absolute bottom-[calc(100%+6px)] left-2 right-2 z-[2200] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-none";
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
  "context-menu fixed z-[3301] flex min-w-[180px] max-w-[calc(100vw-16px)] flex-col overflow-visible rounded-[var(--radius-md,6px)] border border-[var(--border-medium,#2c2c35)] bg-[var(--bg-elevated,#1c1c24)] py-1 shadow-none backdrop-blur-xl pointer-events-auto";
const contextMenuItemClass =
  "context-menu-item flex min-h-6 w-full cursor-pointer items-center border-0 bg-transparent px-3 py-0.5 text-left font-sans text-[13px] leading-5 text-[var(--text-secondary,#b0b0bc)] transition-colors duration-150 hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] hover:text-[var(--text-primary,#ffffff)]";
const contextMenuDangerClass =
  "danger text-[var(--danger,#f43f5e)] hover:bg-[rgba(244,63,94,0.12)] hover:text-[var(--danger,#f43f5e)]";
const contextMenuSeparatorClass =
  "context-menu-separator mx-2 my-1 h-px bg-[var(--border-subtle)]";
const contextSubmenuContainerClass = "group relative";
const contextSubmenuHeaderClass = `${contextMenuItemClass} justify-between`;
const contextSubmenuClass =
  "absolute top-[-5px] z-[3302] hidden min-w-[180px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-[var(--radius-md,6px)] border border-[var(--border-medium,#2c2c35)] bg-[var(--bg-elevated,#1c1c24)] py-1 shadow-none backdrop-blur-xl group-hover:block";

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
}: SidebarProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
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
  const [showVaultMenu, setShowVaultMenu] = useState(false);
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const vaultButtonRef = useRef<HTMLButtonElement>(null);
  const renameInFlightRef = useRef(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
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
  }, [activeFilePath]);

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
                <ChevronRight size={14} strokeWidth={2} />
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

  const sortLabel =
    sortOptions.find((option) => option.mode === sortMode)?.label ||
    "File name (A to Z)";
  const hasPrimaryPluginView = Boolean(pluginViews?.length);

  return (
    <>
      <div className={cx(sidebarRootClass, !visible && sidebarCollapsedClass)}>
        {hasPrimaryPluginView ? (
          <PluginViewPanel
            views={pluginViews || []}
            onClose={onClosePluginView || (() => {})}
            fill
          />
        ) : (
          <>
        <div className={`${sidebarHeaderClass} relative`}>
          <div className={sidebarActionsClass}>
            <button
              className={sidebarBtnClass}
              onClick={onNewNote}
              title="New Note"
            >
              <NewFileIcon size={16} />
            </button>
            <button
              className={sidebarBtnClass}
              onClick={() => onNewFolder("")}
              title="New Folder"
            >
              <NewFolderIcon size={16} />
            </button>
            <button
              ref={sortButtonRef}
              className={sidebarBtnClass}
              onClick={() => setShowSortMenu((value) => !value)}
              title={`Sort: ${sortLabel}`}
            >
              <ArrowUpDown size={18} strokeWidth={1.5} />
            </button>
            <button className={sidebarBtnClass} onClick={onRefresh} title="Refresh">
              <RefreshCw size={18} strokeWidth={1.5} />
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

        {/* Starred Notes Section */}
        {starredNotes.length > 0 && !filterQuery && (
          <div className={cx(sidebarSectionClass, "starred-section")}>
            <button
              className={sectionHeaderClass}
              onClick={() => setShowStarred(!showStarred)}
            >
              <span className={sectionChevronClass}>
                {showStarred ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </span>
              <Star size={14} className={sectionIconClass} fill="currentColor" />
              <span>Starred</span>
              <span className={sectionCountClass}>{starredNotes.length}</span>
            </button>
            {showStarred && (
              <div className={starredListClass}>
                {starredNotes.map((path) => (
                  <button
                    key={path}
                    className={cx(
                      fileTreeItemBaseClass,
                      starredItemClass,
                      activeFilePath === path && fileTreeItemActiveClass,
                      activeFilePath === path && starredActiveClass,
                      draggingPath === path && fileTreeItemDraggingClass,
                    )}
                    onClick={() => onFileSelect(path)}
                    onContextMenu={(e) => handleContextMenu(e, path, false)}
                    draggable={true}
                    onDragStart={(e) => handleDragStart(e, path)}
                    onDragEnd={handleDragEnd}
                  >
                    <Star
                      size={14}
                      className={starIconClass}
                      fill="var(--accent-warning)"
                      stroke="var(--accent-warning)"
                    />
                    <span className={starredTextClass}>
                      <span className={fileNameClass}>{getNoteName(path)}</span>
                      <span className={starredPathClass}>
                        {getStarredParentPath(path)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Layout Groups Section */}
        {!filterQuery && (
          <div className={groupsSectionClass}>
            <div className={groupHeaderWrapperClass}>
              <button
                className={groupSectionHeaderClass}
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
              <button 
                className={sectionHeaderActionClass}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateGroup();
                }}
                title="Save current layout as group"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className={cx(groupsListWrapperClass, showGroups && "open grid-rows-[1fr]")}>
              <div className={groupsListClass}>
                {groups.map((group) => (
                  <div key={group.id} className={cx(groupItemContainerClass, activeGroupId === group.id && groupItemActiveClass)}>
                    <button
                      className={groupItemBtnClass}
                      onClick={() => onRestoreGroup(group.id)}
                      onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
                    >
                      <span className={groupNameTextClass}>{group.name}</span>
                      {group.auto_save_enabled && (
                        <span className={groupAutoBadgeClass}>
                          auto
                        </span>
                      )}
                    </button>
                    <div className={groupItemActionsClass}>
                      <button
                        className={groupActionBtnClass}
                        onClick={(e) => handleGroupContextMenu(e, group.id)}
                        title="Group Options"
                      >
                        <MoreVertical size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div
          className={cx(fileExplorerClass, dragOverPath === "" && fileExplorerDragClass)}
          onDragOver={(e) => handleDragOver(e, "")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "")}
        >
          {processedTree.length > 0 ? (
            renderFileTree(processedTree)
          ) : filterQuery ? (
            <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] px-4 py-8 text-center text-[length:var(--text-sm)] text-[var(--oo-text-muted,var(--text-muted))]">
              <div className="mb-2 opacity-30">
                <Search size={36} strokeWidth={1} />
              </div>
              <div>
                No files match &ldquo;{filterQuery}&rdquo;
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] px-4 py-8 text-center text-[length:var(--text-sm)] leading-normal text-[var(--oo-text-muted,var(--text-muted))]">
              <div className="mb-2 opacity-15">
                <FolderOpen size={48} strokeWidth={1} />
              </div>
              <div className="leading-normal">
                This vault is empty.
                <br />
                Create a note to get started.
              </div>
            </div>
          )}
        </div>
        
        {/* Sidebar Footer - Vault Selector & Settings */}
        {vaultPath && (
          <div className={sidebarFooterClass}>
            <button
              ref={vaultButtonRef}
              className={cx(vaultSelectorBtnClass, showVaultMenu && vaultSelectorActiveClass)}
              onClick={() => setShowVaultMenu(!showVaultMenu)}
              title="Switch Vault"
            >
              <ChevronsUpDown size={20} className="vault-selector-icon" />
              <span className={vaultSelectorNameClass}>{vaultName}</span>
            </button>
            {onSettings && (
              <button
                className={sidebarSettingsBtnClass}
                onClick={onSettings}
                title="Settings"
              >
                <Settings size={16} />
              </button>
            )}
            
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
    </>
  );
}
