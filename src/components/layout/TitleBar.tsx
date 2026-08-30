/**
 * TitleBar - Custom window title bar (Obsidian-style)
 *
 * Unified top bar with:
 *   Left: action icons aligned above the ribbon + sidebar
 *   Center: editor tabs starting at the editor content boundary
 *   Right: window controls (minimize, maximize, close)
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Tab, Theme } from "../../types";
import { TabPreviewCard } from "./TabPreviewCard";
import { getAPI } from "../../utils/api";
import { DragCtx } from "../../context/DragContext";
import { LocalGroup } from "../../lib/localdb";
import {
  PanelLeft,
  PanelRight,
  Search,
  Bookmark,
  Plus,
  Minus,
  Square,
  FolderOpen,
  X,
  Trash2,
  Copy,
  Save,
  Link2Off,
  List,
  Sparkles,
} from "lucide-react";

// Custom Backlinks (incoming arrow) SVG
function BacklinksIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <path d="M2 17v5h5" />
      <line x1="2" y1="22" x2="7" y2="17" />
    </svg>
  );
}

// Custom Outgoing links (outgoing arrow) SVG
function OutgoingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <path d="M22 17v5h-5" />
      <line x1="22" y1="22" x2="17" y2="17" />
    </svg>
  );
}

export const GROUP_COLORS = [
  { name: "Blue", value: "#1a73e8" },
  { name: "Red", value: "#d93025" },
  { name: "Yellow", value: "#f29900" },
  { name: "Green", value: "#188038" },
  { name: "Pink", value: "#d01884" },
  { name: "Purple", value: "#a142f4" },
  { name: "Cyan", value: "#007b83" },
  { name: "Orange", value: "#fa7b17" },
  { name: "Grey", value: "#5f6368" },
];

function getContrastColor(hexColor: string): string {
  if (!hexColor) return "#ffffff";
  const hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "#111111" : "#ffffff";
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "#111111" : "#ffffff";
  }
  return "#ffffff";
}

function groupAndSortTabs(tabsList: Tab[], groupsList: LocalGroup[]): Tab[] {
  const grouped: Record<string, Tab[]> = {};
  const ungrouped: Tab[] = [];
  const groupOrder: string[] = [];
  
  for (const tab of tabsList) {
    const hasGroup = tab.groupId && groupsList.some(g => g.id === tab.groupId);
    if (hasGroup && tab.groupId) {
      if (!grouped[tab.groupId]) {
        grouped[tab.groupId] = [];
        groupOrder.push(tab.groupId);
      }
      grouped[tab.groupId].push(tab);
    } else {
      ungrouped.push(tab);
    }
  }
  
  const sorted: Tab[] = [...ungrouped];
  for (const gId of groupOrder) {
    sorted.push(...grouped[gId]);
  }
  return sorted;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const titlebarClass =
  "titlebar mod-top onyx-titlebar relative z-[3200] flex h-[var(--titlebar-height)] min-h-[var(--titlebar-height)] w-full shrink-0 select-none items-center bg-[var(--titlebar-background,var(--bg-secondary))] text-[length:var(--font-ui-small)] border-b border-[var(--divider-color)] [-webkit-app-region:drag]";
const titlebarDragHandleClass =
  "absolute inset-0 z-[1] pointer-events-auto [-webkit-app-region:drag]";
const titlebarLeftClass =
  "titlebar-left relative z-[2] flex h-full shrink-0 items-center bg-transparent pointer-events-auto [-webkit-app-region:drag]";
const titlebarRibbonSlotClass =
  "flex h-full w-[var(--ribbon-width)] shrink-0 items-center justify-center";
const titlebarActionBtnClass =
  "titlebar-action-btn flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[var(--text-secondary)] transition-all duration-120 pointer-events-auto [-webkit-app-region:no-drag] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const titlebarVaultActionsClass = "flex items-center gap-0.5 px-2";
const titlebarTabsClass =
  "workspace-tab-header-container relative z-[2] flex h-full min-w-0 flex-1 items-center overflow-hidden pl-1 pr-3 pointer-events-auto [-webkit-app-region:drag]";
const titlebarTabScrollClass =
  "relative z-[1] flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-1 pointer-events-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [-webkit-app-region:drag]";
const titlebarTabSlotClass =
  "flex h-full min-w-[80px] max-w-[180px] shrink items-center";
const titlebarInactiveTabSlotClass = "";
const titlebarActiveTabSlotClass = "";
const titlebarGroupSlotClass =
  "flex h-full shrink-0 items-center";
const titlebarTabsRemainderClass =
  "h-full min-w-0 flex-1 shrink-0 pointer-events-auto [-webkit-app-region:drag]";
const titlebarTabClass =
  "titlebar-tab workspace-tab-header group relative z-[2] flex h-[30px] w-full min-w-0 cursor-grab items-center gap-1 whitespace-nowrap rounded-[8px] border border-transparent bg-transparent px-1 font-[var(--font-sans)] text-[13px] text-[var(--tab-text-color)] transition-[background-color,border-color,color,box-shadow] duration-75 [-webkit-app-region:no-drag] [scroll-margin-inline-start:6px] active:cursor-grabbing hover:bg-[var(--bg-hover)]";
const titlebarTabActiveClass =
  "active mod-active is-active z-[4] !border-[var(--border-subtle)] !bg-[var(--tab-background-active)] !text-[var(--tab-text-color-focused-active-current)] shadow-[0_1px_3px_rgba(15,23,42,0.08)]";
const titlebarTabDropLeftClass =
  "drop-target-left !shadow-[inset_2px_0_0_var(--accent-color,#2563eb)]";
const titlebarTabDropRightClass =
  "drop-target-right !shadow-[inset_-2px_0_0_var(--accent-color,#2563eb)]";
const titlebarGroupedTabClass =
  "grouped-tab !rounded-[8px] opacity-75 transition-[background-color,opacity] duration-75 hover:opacity-95 before:!hidden after:!hidden";
const titlebarGroupedActiveTabClass =
  "!bg-[var(--tab-background-active)] !shadow-[0_1px_3px_rgba(15,23,42,0.08)] opacity-100";
const titlebarTabInnerClass =
  "tab-inner workspace-tab-header-inner flex h-full w-full items-center gap-1.5 overflow-hidden rounded-[8px] px-2";
const titlebarTabDotClass = "shrink-0 text-[8px] text-[var(--text-muted)]";
const titlebarTabTitleClass =
  "workspace-tab-header-inner-title flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left leading-none";
const titlebarTabCloseClass =
  "workspace-tab-header-inner-close-button flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[10px] text-[var(--text-muted)] opacity-0 transition-[var(--transition-fast)] group-hover:opacity-100 group-hover:text-[var(--tab-text-color-focused)] group-[.active]:opacity-100 group-[.active]:text-[var(--tab-text-color-focused)] hover:bg-[var(--bg-hover)] hover:text-[var(--tab-text-color-focused-active-current)]";
const titlebarNewTabClass =
  "titlebar-new-tab titlebar-btn ml-0.5 !h-7 !w-7 shrink-0 !rounded-[8px]";
const titlebarNewTabSlotClass =
  "flex h-full shrink-0 items-center";
const titlebarRightControlsClass =
  "relative z-[2] flex shrink-0 items-center pl-3 pr-4 pointer-events-auto [-webkit-app-region:no-drag]";
const titlebarControlsClass =
  "titlebar-controls relative z-[2] flex h-full shrink-0 items-center gap-1 px-1.5 pointer-events-auto [-webkit-app-region:no-drag]";
const titlebarBtnClass =
  "titlebar-btn flex h-7 w-9 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-[var(--text-muted)] transition-[background-color,border-color,color,transform] duration-100 pointer-events-auto [-webkit-app-region:no-drag] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]";
const titlebarCloseBtnClass = "close hover:border-[#ef4444] hover:bg-[#ef4444] hover:text-white";
interface TitlebarTabItemProps {
  tab: Tab;
  tabGroup: LocalGroup | null;
  isActive: boolean;
  isDropLeft: boolean;
  isDropRight: boolean;
  onClick: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (event: React.DragEvent, tabId: string) => void;
  onDragOver: (event: React.DragEvent, tabId: string) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent, tabId: string) => void;
  onContextMenu: (event: React.MouseEvent, tab: Tab) => void;
}

const TitlebarTabItem = React.memo(function TitlebarTabItem({
  tab,
  tabGroup,
  isActive,
  isDropLeft,
  isDropRight,
  onClick,
  onClose,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onDrop,
  onContextMenu,
}: TitlebarTabItemProps) {
  const tabRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);

  const handleMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      if (tabRef.current) {
        setPreviewRect(tabRef.current.getBoundingClientRect());
        setShowPreview(true);
      }
    }, 180);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setShowPreview(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <div
      className={cx(
        titlebarTabSlotClass,
        isActive
          ? titlebarActiveTabSlotClass
          : titlebarInactiveTabSlotClass,
      )}
    >
      <div
        ref={tabRef}
        data-tab-id={tab.id}
        data-tooltip={tab.name}
        className={cx(
          titlebarTabClass,
          isActive && titlebarTabActiveClass,
          isDropLeft && titlebarTabDropLeftClass,
          isDropRight && titlebarTabDropRightClass,
          tabGroup && titlebarGroupedTabClass,
          tabGroup && isActive && titlebarGroupedActiveTabClass,
        )}
        style={{
          "--tab-group-color": tabGroup?.color,
        } as React.CSSProperties}
        onClick={() => onClick(tab.id)}
        draggable
        onDragStart={(event) => onDragStart(event, tab.id)}
        onDragOver={(event) => onDragOver(event, tab.id)}
        onDragLeave={onDragLeave}
        onDragEnd={onDragEnd}
        onDrop={(event) => onDrop(event, tab.id)}
        onContextMenu={(event) => onContextMenu(event, tab)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {tabGroup && (
          <div
            className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none z-[5]"
            style={{ backgroundColor: tabGroup.color }}
          />
        )}
        <div className={titlebarTabInnerClass}>
          {tab.isModified && (
            <span className={titlebarTabDotClass}>{"\u25CF"}</span>
          )}
          <span className={titlebarTabTitleClass}>{tab.name}</span>
          <button
            className={titlebarTabCloseClass}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <TabPreviewCard
        tabName={tab.name}
        tabPath={tab.path}
        targetRect={previewRect}
        visible={showPreview}
      />
    </div>
  );
});

const titlebarGroupPillClass =
  "titlebar-group-pill inline-flex h-5 shrink-0 cursor-pointer select-none items-center justify-center self-center rounded border-0 px-1.5 py-0.5 mx-1 ml-1.5 font-sans text-[11px] font-bold shadow-none transition-[transform,filter] duration-120 hover:brightness-115 active:scale-[0.97] pointer-events-auto [-webkit-app-region:no-drag]";
const titlebarGroupActiveClass =
  "active-group outline outline-1 outline-current";
const titlebarGroupNameClass =
  "titlebar-group-name max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap leading-none";
const groupEditorPopupClass =
  "group-editor-popup fixed z-[3301] flex w-60 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--border-medium,#2d2f33)] bg-[var(--bg-elevated,#1e1f22)] p-3 shadow-none backdrop-blur-2xl pointer-events-auto";
const groupEditorInputClass =
  "group-editor-input box-border w-full rounded border-[1.5px] border-[var(--border-medium,#2d2f33)] bg-[var(--bg-secondary,#18191c)] px-2.5 py-1.5 font-sans text-[13px] text-[var(--text-primary,#ffffff)] outline-none transition-colors duration-150 focus:border-current";
const groupEditorColorsClass =
  "group-editor-colors flex flex-wrap justify-between gap-2 px-0.5 py-1";
const groupEditorColorBtnClass =
  "group-editor-color-btn relative h-5 w-5 cursor-pointer rounded-full border-0 p-0 transition-[transform,box-shadow] duration-120 hover:scale-115";
const groupEditorColorSelectedClass =
  "selected shadow-[0_0_0_2px_var(--bg-elevated,#1e1f22),0_0_0_4px_currentColor]";
const groupEditorDividerClass =
  "group-editor-divider my-0.5 h-px bg-[var(--border-subtle,rgba(255,255,255,0.08))]";
const groupEditorItemClass =
  "group-editor-item flex w-full cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2 py-1.5 text-left font-sans text-[13px] text-[var(--text-secondary,#b0b0bc)] transition-colors duration-120 hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] hover:text-[var(--text-primary,#ffffff)]";
const groupEditorDangerItemClass =
  "danger text-[var(--danger,#ef4444)] hover:bg-[rgba(239,68,68,0.12)] hover:text-[var(--danger,#ef4444)]";
const groupEditorCheckClass =
  "group-editor-check inline-flex w-[15px] items-center justify-center text-xs font-bold text-[var(--color-accent,#3b82f6)]";
const contextMenuBackdropClass =
  "context-menu-backdrop fixed inset-0 z-[3300] bg-transparent pointer-events-auto";
const contextMenuClass =
  "context-menu fixed z-[3301] flex min-w-[180px] max-w-[calc(100vw-16px)] flex-col overflow-visible rounded-[var(--radius-md,6px)] border border-[var(--border-medium,#2c2c35)] bg-[var(--bg-elevated,#1c1c24)] py-1 shadow-none backdrop-blur-xl pointer-events-auto";
const contextMenuItemClass =
  "context-menu-item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-sans text-[13px] text-[var(--text-secondary,#b0b0bc)] transition-colors duration-150 hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] hover:text-[var(--text-primary,#ffffff)]";
const contextSubmenuContainerClass = "context-menu-submenu-container group relative";
const contextSubmenuHeaderClass = `${contextMenuItemClass} submenu-header justify-between`;
const contextSubmenuClass =
  "context-menu-submenu absolute left-[98%] top-[-4px] z-[3302] hidden min-w-40 rounded-[var(--radius-md,6px)] border border-[var(--border-medium,#2c2c35)] bg-[var(--bg-elevated,#1c1c24)] py-1 shadow-none backdrop-blur-xl group-hover:block";
const contextGroupDotClass = "group-color-dot inline-block h-2 w-2 shrink-0 rounded-full";

const MENU_VIEWPORT_MARGIN = 8;

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - width - MENU_VIEWPORT_MARGIN);
  const maxY = Math.max(MENU_VIEWPORT_MARGIN, window.innerHeight - height - MENU_VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(x, MENU_VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(y, MENU_VIEWPORT_MARGIN), maxY),
  };
}

interface PluginViewActionInfo {
  id: string;
  icon: string;
  title: string;
  el: HTMLElement;
}

interface TitlebarPluginViewInfo {
  viewType: string;
  displayText: string;
  icon: string;
  containerEl: HTMLElement;
  side: 'left' | 'right' | 'main';
  pluginId?: string;
  visible?: boolean;
  actions?: PluginViewActionInfo[];
}

interface TitleBarProps {
  theme: Theme;
  onToggleSidebar?: () => void;
  showSidebar?: boolean;
  onToggleRightSidebar?: () => void;
  showRightSidebar?: boolean;
  onSearch?: () => void;
  onToggleExplorer?: () => void;
  onToggleBookmarks?: () => void;
  bookmarksActive?: boolean;
  /** Width of the left section (ribbon + sidebar) so tabs align with editor */
  leftWidth?: number;
  /** Tab data */
  tabs?: Tab[];
  activeTabId?: string | null;
  onTabSelect?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewTab?: (groupId?: string) => void;
  onTabReorder?: (draggedId: string, targetId: string, insertBefore: boolean) => void;
  tabScrollRef?: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
  activeUsers?: { id: string, name: string, email: string, color?: string, isEditing?: boolean }[];
  onInvite?: () => void;
  
  // Tab-groups refactoring props
  groups?: LocalGroup[];
  activeGroupId?: string | null;
  hasUnsavedChanges?: boolean;
  onRestoreGroup?: (groupId: string) => void;
  onSaveGroup?: (groupId: string) => void;
  onRenameGroup?: (groupId: string, currentName: string) => void;
  onChangeGroupColor?: (groupId: string, currentColor: string) => void;
  onToggleGroupAutoSave?: (groupId: string) => void;
  onDuplicateGroup?: (groupId: string) => void;
  onDeleteGroup?: (groupId: string) => void;
  onCreateGroupFromTab?: (tabId: string) => void;
  onAddTabToGroup?: (tabId: string, groupId: string) => void;
  onRemoveTabFromGroup?: (tabId: string) => void;
  onMoveTabToGroup?: (tabId: string, groupId: string) => void;
  collapsedGroupIds?: Set<string>;
  onToggleGroupCollapse?: (groupId: string) => void;
  activeRightTab?: string;
  setActiveRightTab?: (tab: string) => void;
  leftPluginViews?: TitlebarPluginViewInfo[];
  activeLeftViewType?: string | null;
  onSelectLeftPluginView?: (viewType: string) => void;
  rightPluginViews?: TitlebarPluginViewInfo[];
  rightSidebarWidth?: number;
  isFullScreen?: boolean;
}

import { setIcon } from "../../lib/obsidian-api/utils";

function PluginIcon({ iconId, className }: { iconId: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
      setIcon(containerRef.current, iconId);
      const svg = containerRef.current.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        svg.setAttribute("stroke-width", "1.5");
        if (className) {
          svg.setAttribute("class", className);
        }
      }
    }
  }, [iconId, className]);

  return <span ref={containerRef} className="flex items-center justify-center" />;
}

function triggerPluginAction(action: PluginViewActionInfo) {
  action.el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

export function TitleBar({
  theme,
  onToggleSidebar,
  showSidebar = true,
  onToggleRightSidebar,
  showRightSidebar = true,
  onSearch,
  onToggleExplorer,
  onToggleBookmarks,
  bookmarksActive = false,
  leftWidth,
  tabs = [],
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
  onTabReorder,
  activeRightTab,
  setActiveRightTab,
  tabScrollRef,
  children,
  activeUsers = [],
  onInvite,
  
  groups = [],
  activeGroupId = null,
  hasUnsavedChanges = false,
  onRestoreGroup,
  onSaveGroup,
  onRenameGroup,
  onChangeGroupColor,
  onToggleGroupAutoSave,
  onDuplicateGroup,
  onDeleteGroup,
  onCreateGroupFromTab,
  onAddTabToGroup,
  onRemoveTabFromGroup,
  onMoveTabToGroup,
  collapsedGroupIds = new Set<string>(),
  onToggleGroupCollapse,
  leftPluginViews = [],
  activeLeftViewType = null,
  onSelectLeftPluginView,
  rightPluginViews = [],
  rightSidebarWidth = 300,
  isFullScreen = false,
}: TitleBarProps) {
  const api = getAPI();
  const isMac = navigator.platform.includes("Mac");
  const shouldReserveMacTrafficLights = false;
  const titlebarRef = useRef<HTMLDivElement>(null);
  const { setDragCtx } = React.useContext(DragCtx);

  const [dragOverTabId, setDragOverTabId] = React.useState<string | null>(null);
  const [dragDirection, setDragDirection] = React.useState<'left' | 'right' | null>(null);
  const [tabContextMenu, setTabContextMenu] = React.useState<{
    x: number;
    y: number;
    tab: Tab;
  } | null>(null);

  const [groupPopup, setGroupPopup] = React.useState<{
    x: number;
    y: number;
    group: LocalGroup;
  } | null>(null);

  const sortedTabs = React.useMemo(() => {
    return groupAndSortTabs(tabs, groups);
  }, [tabs, groups]);

  const renderItems = React.useMemo(() => {
    const items: Array<
      | { type: "group-header"; group: LocalGroup; key: string; tabsCount: number; isCollapsed: boolean }
      | { type: "tab"; tab: Tab; key: string; tabGroup: LocalGroup | null }
    > = [];
    
    // 1. Add each group pill, followed by its active tabs (if any and not collapsed)
    for (const group of groups) {
      const activeGroupTabs = sortedTabs.filter(t => t.groupId === group.id);
      const isCollapsed = collapsedGroupIds.has(group.id);
      
      items.push({
        type: "group-header",
        group,
        key: `group-header-${group.id}`,
        tabsCount: activeGroupTabs.length,
        isCollapsed,
      });

      if (!isCollapsed) {
        for (const tab of activeGroupTabs) {
          items.push({
            type: "tab",
            tab,
            key: `tab-${tab.id}`,
            tabGroup: group,
          });
        }
      }
    }

    // 2. Add all ungrouped tabs at the end (so they appear next to/aside of the group names)
    const ungroupedTabs = sortedTabs.filter(t => !t.groupId || !groups.some(g => g.id === t.groupId));
    for (const tab of ungroupedTabs) {
      items.push({
        type: "tab",
        tab,
        key: `tab-${tab.id}`,
        tabGroup: null,
      });
    }
    
    return items;
  }, [sortedTabs, groups, collapsedGroupIds]);

  const activeLeftPluginView = leftPluginViews.find((view) => view.viewType === activeLeftViewType);
  const activeRightPluginView = rightPluginViews.find((view) => view.viewType === activeRightTab);

  const handleTabClick = React.useCallback((tabId: string) => {
    if (tabId === activeTabId) return;
    onTabSelect?.(tabId);
  }, [activeTabId, onTabSelect]);

  const handleDragStart = React.useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.effectAllowed = "move";
    const tabObj = tabs.find(t => t.id === tabId);
    if (tabObj) {
      e.dataTransfer.setData("application/x-openonyx-tab", tabObj.path);
      setDragCtx({
        type: 'tab',
        tab: tabObj
      });
    }
  }, [setDragCtx, tabs]);

  const handleDragEnd = React.useCallback(() => {
    setDragCtx(null);
  }, [setDragCtx]);

  const handleDragOver = React.useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isRightHalf = x > rect.width / 2;
    const nextDirection = isRightHalf ? 'right' : 'left';
    
    setDragOverTabId((current) => current === tabId ? current : tabId);
    setDragDirection((current) => current === nextDirection ? current : nextDirection);
  }, []);

  const handleDragLeave = React.useCallback(() => {
    setDragOverTabId(null);
    setDragDirection(null);
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    const draggedTabId = e.dataTransfer.getData("text/plain");
    
    setDragOverTabId(null);
    setDragDirection(null);
    
    if (draggedTabId && draggedTabId !== targetTabId) {
      const isRightHalf = dragDirection === 'right';
      onTabReorder?.(draggedTabId, targetTabId, !isRightHalf);
    }
  }, [dragDirection, onTabReorder]);

  const handleTabClose = React.useCallback((tabId: string) => {
    onTabClose?.(tabId);
  }, [onTabClose]);

  const handleTabContextMenu = React.useCallback((e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    const position = clampMenuPosition(e.clientX, e.clientY, 220, 180);
    setTabContextMenu({
      x: position.x,
      y: position.y,
      tab,
    });
  }, []);

  React.useEffect(() => {
    const el = tabScrollRef?.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [tabScrollRef]);

  return (
    <div
      className={titlebarClass}
      ref={titlebarRef}
      style={{
        backgroundColor: "var(--titlebar-background, var(--bg-secondary))"
      }}
      onDoubleClick={(e) => {
        if (
          e.target === e.currentTarget ||
          (e.target as HTMLElement).classList.contains("titlebar-drag-handle")
        ) {
          api.maximizeWindow();
        }
      }}
    >
      {/* Background drag handle for window movement */}
      <div
        className={cx(titlebarDragHandleClass, "titlebar-drag-handle")}
        onDoubleClick={() => api.maximizeWindow()}
      />

      {/* Left action icons - spans over ribbon + sidebar */}
      <div
        className={titlebarLeftClass}
        style={{
          width: leftWidth
            ? `${shouldReserveMacTrafficLights ? Math.max(leftWidth, 120) : leftWidth}px`
            : undefined,
          minWidth: leftWidth
            ? `${shouldReserveMacTrafficLights ? Math.max(leftWidth, 120) : leftWidth}px`
            : undefined,
          paddingLeft: shouldReserveMacTrafficLights ? "75px" : undefined,
          boxSizing: "border-box",
        }}
      >
        {onToggleExplorer && (
          <button
            title="File Explorer"
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
            onClick={onToggleExplorer}
          />
        )}

            {leftPluginViews.map((view) => (
              <button
                key={view.viewType}
                className={`${titlebarActionBtnClass} ${
                  activeLeftViewType === view.viewType
                    ? "bg-(--bg-active) !text-(--text-primary)"
                    : "text-(--text-muted) hover:text-(--text-secondary)"
                }`}
                onClick={() => onSelectLeftPluginView?.(view.viewType)}
                data-tooltip={view.displayText}
              >
                <PluginIcon iconId={view.icon} />
              </button>
            ))}
            {activeLeftPluginView?.actions?.map((action) => (
              <button
                key={action.id}
                className={titlebarActionBtnClass}
                onClick={() => triggerPluginAction(action)}
                data-tooltip={action.title}
              >
                <PluginIcon iconId={action.icon} />
              </button>
            ))}
      </div>

      {/* Center: tabs - starts at editor content boundary */}
      <div className={titlebarTabsClass}>
        <div 
          className={titlebarTabScrollClass}
          ref={tabScrollRef}
        >
          {renderItems.map((item) => {
            if (item.type === "group-header") {
              const { group, tabsCount, isCollapsed } = item;
              return (
                <div key={item.key} className={titlebarGroupSlotClass}>
                  <div
                    className={cx(
                      titlebarGroupPillClass,
                      activeGroupId === group.id && titlebarGroupActiveClass,
                      isCollapsed && "is-collapsed",
                    )}
                    style={{
                      backgroundColor: group.color,
                      color: getContrastColor(group.color),
                    }}
                    onClick={() => {
                      if (group.id === activeGroupId) {
                        onToggleGroupCollapse?.(group.id);
                      } else {
                        onRestoreGroup?.(group.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const position = clampMenuPosition(rect.left, rect.bottom + 4, 240, 430);
                      setGroupPopup({
                        x: position.x,
                        y: position.y,
                        group,
                      });
                    }}
                    data-tooltip={`Group: ${group.name} (${tabsCount} tabs)`}
                  >
                    <span className={titlebarGroupNameClass}>
                      {group.name}
                      {group.id === activeGroupId && hasUnsavedChanges ? " *" : ""}
                    </span>
                  </div>
                </div>
              );
            } else {
              const { tab, tabGroup } = item;
              const isActive = tab.id === activeTabId;
              return (
                <TitlebarTabItem
                  key={item.key}
                  tab={tab}
                  tabGroup={tabGroup}
                  isActive={isActive}
                  isDropLeft={dragOverTabId === tab.id && dragDirection === "left"}
                  isDropRight={dragOverTabId === tab.id && dragDirection === "right"}
                  onClick={handleTabClick}
                  onClose={handleTabClose}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                  onContextMenu={handleTabContextMenu}
                />
              );
            }
          })}
          {onNewTab && (
            <div className={titlebarNewTabSlotClass}>
              <button
                className={titlebarNewTabClass}
                onClick={() => onNewTab?.()}
                data-tooltip="New tab"
              >
                <Plus size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
          <div aria-hidden="true" className={titlebarTabsRemainderClass} />
        </div>
      </div>

      {/* Right: sidebar toggle and right sidebar container */}
      <div className="relative z-[2] flex h-full shrink-0 items-center pointer-events-auto [-webkit-app-region:drag]">
        {onToggleRightSidebar && (
          <button
            className={titlebarActionBtnClass}
            onClick={onToggleRightSidebar}
            data-tooltip={showRightSidebar ? "Close right sidebar" : "Open right sidebar"}
            style={{ marginRight: showRightSidebar ? '8px' : '0' }}
          >
            <PanelRight size={20} strokeWidth={1.5} />
          </button>
        )}

        <div
          className="flex h-full items-center justify-between flex-nowrap overflow-hidden"
          style={
            showRightSidebar && rightSidebarWidth
              ? {
                  width: `${rightSidebarWidth}px`,
                  minWidth: `${rightSidebarWidth}px`,
                  borderLeft: "1px solid var(--border-subtle)",
                  paddingLeft: "8px",
                  boxSizing: "border-box",
                }
              : {
                  paddingLeft: "8px",
                }
          }
        >
          {/* Active Tab Icons (only shown when sidebar is open) */}
          {showRightSidebar && activeRightTab && setActiveRightTab && (
            <div className="flex items-center gap-0.5 flex-nowrap flex-shrink min-w-0 overflow-hidden">
              <button
                className={`${titlebarActionBtnClass} ${
                  activeRightTab === "backlinks"
                    ? "bg-(--bg-active) !text-(--text-primary)"
                    : "text-(--text-muted) hover:text-(--text-secondary)"
                }`}
                onClick={() => setActiveRightTab("backlinks")}
                data-tooltip="Backlinks"
              >
                <BacklinksIcon />
              </button>

              <button
                className={`${titlebarActionBtnClass} ${
                  activeRightTab === "outgoing"
                    ? "bg-(--bg-active) !text-(--text-primary)"
                    : "text-(--text-muted) hover:text-(--text-secondary)"
                }`}
                onClick={() => setActiveRightTab("outgoing")}
                data-tooltip="Outgoing links"
              >
                <OutgoingIcon />
              </button>

              <button
                className={`${titlebarActionBtnClass} ${
                  activeRightTab === "outline"
                    ? "bg-(--bg-active) !text-(--text-primary)"
                    : "text-(--text-muted) hover:text-(--text-secondary)"
                }`}
                onClick={() => setActiveRightTab("outline")}
                data-tooltip="Outline"
              >
                <List size={20} strokeWidth={1.5} />
              </button>

              <button
                className={`${titlebarActionBtnClass} ${
                  activeRightTab === "ai"
                    ? "bg-(--bg-active) !text-(--text-primary)"
                    : "text-(--text-muted) hover:text-(--text-secondary)"
                }`}
                onClick={() => setActiveRightTab("ai")}
                data-tooltip="AI Assistant"
              >
                <Sparkles size={20} strokeWidth={1.5} />
              </button>

              {rightPluginViews.map((view) => (
                <button
                  key={view.viewType}
                  className={`${titlebarActionBtnClass} ${
                    activeRightTab === view.viewType
                      ? "bg-(--bg-active) !text-(--text-primary)"
                      : "text-(--text-muted) hover:text-(--text-secondary)"
                  }`}
                  onClick={() => setActiveRightTab(view.viewType)}
                  data-tooltip={view.displayText}
                >
                  <PluginIcon iconId={view.icon} />
                </button>
              ))}

              {activeRightPluginView?.actions?.map((action) => (
                <button
                  key={action.id}
                  className={titlebarActionBtnClass}
                  onClick={() => triggerPluginAction(action)}
                  data-tooltip={action.title}
                >
                  <PluginIcon iconId={action.icon} />
                </button>
              ))}
            </div>
          )}

          {/* Spacer if sidebar is open, to push avatars/controls to the right */}
          <div className="flex-1" />

          {/* Collaborator Avatars & Window Controls */}
          <div className="flex items-center flex-shrink-0">
            {/* Active Users */}
            <div style={{ display: 'flex', alignItems: 'center', marginRight: '16px', gap: '4px' }}>
              {activeUsers.slice(0, 3).map((u, i) => (
                <div 
                  key={u.id}
                  data-tooltip={`${u.name || u.email} - ${u.isEditing ? 'Editing' : 'Viewing'}`}
                  style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    backgroundColor: u.color || 'var(--interactive-accent)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 'bold', zIndex: 3 - i,
                    marginLeft: i > 0 ? '-8px' : 0, border: '2px solid var(--background-primary)',
                    position: 'relative'
                  }}
                >
                  {(u.name || u.email || '?')[0].toUpperCase()}
                  {u.isEditing && (
                    <div style={{
                      position: 'absolute', bottom: '-2px', right: '-2px',
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: '#10b981', border: '1px solid var(--background-primary)'
                    }} data-tooltip="Editing" />
                  )}
                </div>
              ))}
              {activeUsers.length > 3 && (
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  backgroundColor: 'var(--background-modifier-border)',
                  color: 'var(--text-normal)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 'bold', marginLeft: '-8px', border: '2px solid var(--background-primary)'
                }}>
                  +{activeUsers.length - 3}
                </div>
              )}
              {onInvite && (
                <button
                  className={titlebarActionBtnClass}
                  style={{ marginLeft: '4px', width: '24px', height: '24px', padding: 0 }}
                  onClick={onInvite}
                  data-tooltip="Invite collaborators"
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Minimize / Maximize / Close */}
            {!isMac && (
              <div className={titlebarControlsClass}>
                <button
                  className={titlebarBtnClass}
                  onClick={() => api.minimizeWindow()}
                  aria-label="Minimize"
                >
                  <Minus size={14} strokeWidth={1.8} />
                </button>
                <button
                  className={titlebarBtnClass}
                  onClick={() => api.maximizeWindow()}
                  aria-label="Maximize"
                >
                  <Square size={12} strokeWidth={1.7} />
                </button>
                <button
                  className={`${titlebarBtnClass} ${titlebarCloseBtnClass}`}
                  onClick={() => api.closeWindow()}
                  aria-label="Close"
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {tabContextMenu && (
        <div
          className={contextMenuBackdropClass}
          onClick={() => setTabContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setTabContextMenu(null);
          }}
        >
          <div
            className={contextMenuClass}
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {tabContextMenu.tab.groupId ? (
              <>
                <button
                  className={contextMenuItemClass}
                  onClick={() => {
                    onRemoveTabFromGroup?.(tabContextMenu.tab.id);
                    setTabContextMenu(null);
                  }}
                >
                  Remove from Group
                </button>
                {groups.filter(g => g.id !== tabContextMenu.tab.groupId).length > 0 && (
                  <div className={contextSubmenuContainerClass}>
                    <div className={contextSubmenuHeaderClass}>
                      Move to Group &rarr;
                    </div>
                    <div className={contextSubmenuClass}>
                      {groups.filter(g => g.id !== tabContextMenu.tab.groupId).map(g => (
                        <button
                          key={g.id}
                          className={contextMenuItemClass}
                          onClick={() => {
                            onMoveTabToGroup?.(tabContextMenu.tab.id, g.id);
                            setTabContextMenu(null);
                          }}
                        >
                          <span className={contextGroupDotClass} style={{ backgroundColor: g.color }} />
                          {g.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {groups.length > 0 && (
                  <div className={contextSubmenuContainerClass}>
                    <div className={contextSubmenuHeaderClass}>
                      Add to Group &rarr;
                    </div>
                    <div className={contextSubmenuClass}>
                      {groups.map(g => (
                        <button
                          key={g.id}
                          className={contextMenuItemClass}
                          onClick={() => {
                            onAddTabToGroup?.(tabContextMenu.tab.id, g.id);
                            setTabContextMenu(null);
                          }}
                        >
                          <span className={contextGroupDotClass} style={{ backgroundColor: g.color }} />
                          {g.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  className={contextMenuItemClass}
                  onClick={() => {
                    onCreateGroupFromTab?.(tabContextMenu.tab.id);
                    setTabContextMenu(null);
                  }}
                >
                  Create New Group from Tab
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {groupPopup && (
        <div
          className={contextMenuBackdropClass}
          onClick={() => setGroupPopup(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setGroupPopup(null);
          }}
        >
          <div
            className={groupEditorPopupClass}
            style={{ left: groupPopup.x, top: groupPopup.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input name field */}
            <input
              type="text"
              className={groupEditorInputClass}
              style={{ borderColor: groupPopup.group.color }}
              defaultValue={groupPopup.group.name}
              placeholder="Group name"
              onChange={(e) => {
                const val = e.target.value.trim();
                if (val) {
                  onRenameGroup?.(groupPopup.group.id, val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setGroupPopup(null);
                }
              }}
              autoFocus
            />

            {/* Color picker circles */}
            <div className={groupEditorColorsClass}>
              {GROUP_COLORS.map((c) => {
                const isSelected = groupPopup.group.color.toLowerCase() === c.value.toLowerCase();
                return (
                  <button
                    key={c.value}
                    className={cx(groupEditorColorBtnClass, isSelected && groupEditorColorSelectedClass)}
                    style={{
                      backgroundColor: c.value,
                      color: c.value,
                    }}
                    onClick={() => {
                      onChangeGroupColor?.(groupPopup.group.id, c.value);
                      setGroupPopup(prev => prev ? {
                        ...prev,
                        group: { ...prev.group, color: c.value }
                      } : null);
                    }}
                    data-tooltip={c.name}
                  />
                );
              })}
            </div>

            <div className={groupEditorDividerClass} />

            {/* Action list */}
            <button
              className={groupEditorItemClass}
              onClick={() => {
                onNewTab?.(groupPopup.group.id);
                setGroupPopup(null);
              }}
            >
              <Plus size={15} />
              <span>New tab in group</span>
            </button>

            <button
              className={groupEditorItemClass}
              onClick={() => {
                const tabsToUngroup = tabs.filter(t => t.groupId === groupPopup.group.id);
                tabsToUngroup.forEach(t => {
                  onRemoveTabFromGroup?.(t.id);
                });
                onDeleteGroup?.(groupPopup.group.id);
                setGroupPopup(null);
              }}
            >
              <Link2Off size={15} />
              <span>Ungroup</span>
            </button>

            <button
              className={groupEditorItemClass}
              onClick={() => {
                const tabsToClose = sortedTabs.filter(t => t.groupId === groupPopup.group.id);
                tabsToClose.forEach(t => {
                  onTabClose?.(t.id);
                });
                setGroupPopup(null);
              }}
            >
              <X size={15} />
              <span>Close grouped tabs</span>
            </button>

            <div className={groupEditorDividerClass} />

            <button
              className={groupEditorItemClass}
              onClick={() => {
                onSaveGroup?.(groupPopup.group.id);
                setGroupPopup(null);
              }}
            >
              <Save size={15} />
              <span>Save current layout to group</span>
            </button>

            <button
              className={groupEditorItemClass}
              onClick={() => {
                onToggleGroupAutoSave?.(groupPopup.group.id);
                setGroupPopup(prev => prev ? {
                  ...prev,
                  group: { ...prev.group, auto_save_enabled: !prev.group.auto_save_enabled }
                } : null);
              }}
            >
              <span className={groupEditorCheckClass}>
                {groupPopup.group.auto_save_enabled ? "✓" : ""}
              </span>
              <span>Enable Auto-save</span>
            </button>

            <button
              className={groupEditorItemClass}
              onClick={() => {
                onDuplicateGroup?.(groupPopup.group.id);
                setGroupPopup(null);
              }}
            >
              <Copy size={15} />
              <span>Duplicate group</span>
            </button>

            <div className={groupEditorDividerClass} />

            <button
              className={cx(groupEditorItemClass, groupEditorDangerItemClass)}
              onClick={() => {
                onDeleteGroup?.(groupPopup.group.id);
                setGroupPopup(null);
              }}
            >
              <Trash2 size={15} />
              <span>Delete group</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
