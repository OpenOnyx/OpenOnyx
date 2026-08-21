import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  CirclePlus,
  Clipboard,
  Code2,
  Copy,
  ExternalLink,
  FileDown,
  FolderInput,
  FolderOpen,
  GitMerge,
  History,
  Lightbulb,
  Link,
  MoreVertical,
  PanelBottomOpen,
  PanelRightOpen,
  PenLine,
  Pencil,
  Replace,
  Search,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { ViewMode } from "../../types";

interface EditorHeaderProps {
  filePath: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleInsight?: () => void;
  activeEditors?: any[];
  onToggleBacklinks?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onOpenInNewWindow?: () => void;
  onRename?: () => void;
  onMoveFile?: () => void;
  onBookmark?: () => void;
  onMergeFile?: () => void;
  onAddProperty?: () => void;
  onExportPdf?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onCopyRelativePath?: () => void;
  onCopyAbsolutePath?: () => void;
  onOpenVersionHistory?: () => void;
  onOpenLinkedView?: () => void;
  onOpenInDefaultApp?: () => void;
  onShowInSystemExplorer?: () => void;
  onRevealInNavigation?: () => void;
  onDeleteFile?: () => void;
  canCopyAbsolutePath?: boolean;
  showFormattingToolbar?: boolean;
  modifiedAt?: number | null;
  createdAt?: number | null;
  isFocused?: boolean;
}

const editorChromeClass =
  "onyx-note-chrome flex shrink-0 flex-col border-b border-[var(--divider-color)] bg-[var(--bg-primary)]";
const editorHeaderClass =
  "flex h-10 min-h-10 select-none items-center justify-between bg-[var(--bg-primary)] px-4";
const editorHeaderSideClass = "flex flex-[0_0_auto] items-center gap-1.5";
const editorHeaderRightClass = `${editorHeaderSideClass} justify-end`;
const editorHeaderCenterClass =
  "flex min-w-0 flex-1 justify-center overflow-hidden px-4";
const breadcrumbsClass =
  "flex min-w-0 items-center overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--text-muted)]";
const breadcrumbPartClass =
  "max-w-[150px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap transition-colors duration-150 hover:text-[var(--text-secondary)]";
const activeBreadcrumbPartClass =
  "max-w-[250px] font-medium text-[var(--text-secondary)]";
const breadcrumbSeparatorClass = "mx-1 shrink-0 opacity-50";
const editorHeaderBtnClass =
  "flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent px-2 text-[var(--text-muted)] transition-all duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const insightBtnClass =
  "h-8 gap-1.5 py-0 pl-2 pr-2 text-[13px] text-[var(--text-secondary)]";
const menuBackdropClass = "fixed inset-0 z-[3600] bg-transparent";
const menuClass =
  "fixed z-[3601] w-[205px] overflow-visible rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-[5px] text-[13px] text-[var(--text-secondary)] shadow-[var(--shadow-md)]";
const menuItemClass =
  "group/menu-item flex min-h-[28px] w-full items-center gap-2 border-0 bg-transparent px-3 py-0.5 text-left font-[inherit] leading-5 text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const menuItemDangerClass = "text-[var(--danger)] hover:text-[var(--danger)]";
const menuItemDisabledClass =
  "cursor-default opacity-45 hover:bg-transparent hover:text-[var(--text-secondary)]";
const menuIconClass = "flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)]";
const menuLabelClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const menuCheckClass = "ml-auto flex h-4 w-4 shrink-0 items-center justify-center";
const menuSeparatorClass = "mx-0 my-1 h-px bg-[var(--border-subtle)]";
const submenuContainerClass = "group/submenu relative";
const submenuClass =
  "absolute left-[calc(100%-2px)] top-[-5px] z-[3602] hidden w-[178px] rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-[5px] shadow-[var(--shadow-md)] group-hover/submenu:block";

const noteTitleBandClass =
  "flex items-start gap-3 px-8 pt-6 pb-2 bg-[var(--bg-primary)]";
const noteIconBadgeClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border-subtle)]";
const noteTitleTextClass =
  "m-0 text-[1.65rem] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-primary)]";
const noteMetaClass =
  "mt-1 text-[12.5px] text-[var(--text-muted)]";

function MenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={menuIconClass}>
      <Icon size={15} strokeWidth={1.6} />
    </span>
  );
}

function clampMenuPosition(x: number, y: number, width = 205, height = 430) {
  const margin = 8;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin)),
  };
}

function formatMetaDate(ts?: number | null): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export function EditorHeader({
  filePath,
  viewMode,
  onViewModeChange,
  onToggleInsight,
  onToggleBacklinks,
  onSplitRight,
  onSplitDown,
  onOpenInNewWindow,
  onRename,
  onMoveFile,
  onBookmark,
  onMergeFile,
  onAddProperty,
  onExportPdf,
  onFind,
  onReplace,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onOpenVersionHistory,
  onOpenLinkedView,
  onOpenInDefaultApp,
  onShowInSystemExplorer,
  onRevealInNavigation,
  onDeleteFile,
  canCopyAbsolutePath,
  showFormattingToolbar = true,
  modifiedAt,
  createdAt,
  isFocused,
}: EditorHeaderProps) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menuPosition) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuPosition(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuPosition]);

  useEffect(() => {
    const handleFormat = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (isFocused && customEvent.detail?.command === "more") {
        const toolbarMoreBtn = document.querySelector('.onyx-toolbar [title="More"]');
        if (toolbarMoreBtn) {
          const rect = toolbarMoreBtn.getBoundingClientRect();
          setMenuPosition(clampMenuPosition(rect.right - 205, rect.bottom + 4));
        } else {
          setMenuPosition({ x: window.innerWidth - 250, y: 50 });
        }
      }
    };
    document.addEventListener("editor:format", handleFormat);
    return () => document.removeEventListener("editor:format", handleFormat);
  }, [isFocused]);

  const pathParts = filePath.split("/").filter(Boolean);
  const fileName =
    filePath === "__new_tab__"
      ? "New tab"
      : pathParts.pop()?.replace(/\.md$/, "") || "";
  const isReadingView = viewMode === "preview";
  const isSpecial = filePath === "__new_tab__" || filePath.startsWith("__");


  const runAction = (action?: () => void) => {
    if (!action) return;
    setMenuPosition(null);
    action();
  };

  const renderItem = (
    label: string,
    icon: LucideIcon,
    action?: () => void,
    options: { danger?: boolean; disabled?: boolean; checked?: boolean; trailing?: React.ReactNode } = {},
  ) => (
    <button
      type="button"
      className={`${menuItemClass} ${options.danger ? menuItemDangerClass : ""} ${options.disabled ? menuItemDisabledClass : "cursor-pointer"}`}
      onClick={() => !options.disabled && runAction(action)}
      disabled={options.disabled}
    >
      <MenuIcon icon={icon} />
      <span className={menuLabelClass}>{label}</span>
      {options.trailing ?? (
        options.checked ? (
          <span className={menuCheckClass}>
            <Check size={14} strokeWidth={1.6} />
          </span>
        ) : null
      )}
    </button>
  );

  const createdLabel = formatMetaDate(createdAt);
  const modifiedLabel = formatMetaDate(modifiedAt);

  return (
    <div className={editorChromeClass}>
      <div className={editorHeaderClass}>
        <div className={editorHeaderSideClass}>
          <button
            className={`${editorHeaderBtnClass} ${insightBtnClass}`}
            onClick={onToggleInsight}
            title="Note Insights"
          >
            <Lightbulb size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className={editorHeaderCenterClass}>
          {!isSpecial && (
            <span className="font-medium text-[var(--text-secondary)] text-[13px] max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap">
              {fileName}
            </span>
          )}
        </div>

        <div className={editorHeaderRightClass}>
          <button
            className={editorHeaderBtnClass}
            onClick={() =>
              onViewModeChange(viewMode === "editor" ? "preview" : "editor")
            }
            title={viewMode === "editor" ? "Reading view" : "Editing view"}
          >
            {viewMode === "editor" ? (
              <BookOpen size={16} strokeWidth={1.5} />
            ) : (
              <PenLine size={16} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>



      {menuPosition && (
        <div
          className={menuBackdropClass}
          onClick={() => setMenuPosition(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuPosition(null);
          }}
        >
          <div
            className={menuClass}
            style={{ left: menuPosition.x, top: menuPosition.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {renderItem("Backlinks in document", Link, onToggleBacklinks)}
            {renderItem(
              "Reading view",
              BookOpen,
              () => onViewModeChange(isReadingView ? "editor" : "preview"),
              { checked: isReadingView },
            )}
            <div className={menuSeparatorClass} />
            {renderItem("Rename...", Pencil, onRename)}
            {renderItem("Move file to...", FolderInput, onMoveFile)}
            {renderItem("Bookmark...", Bookmark, onBookmark)}
            {renderItem("Export to PDF...", FileDown, onExportPdf)}
            <div className={menuSeparatorClass} />
            {renderItem("Find...", Search, onFind)}
            {renderItem("Replace...", Replace, onReplace)}
            <div className={menuSeparatorClass} />
            <div className={submenuContainerClass}>
              <button type="button" className={`${menuItemClass} cursor-default`}>
                <MenuIcon icon={Clipboard} />
                <span className={menuLabelClass}>Copy path</span>
                <ChevronRight size={14} strokeWidth={1.6} />
              </button>
              <div className={submenuClass}>
                {renderItem("Relative path", Copy, onCopyRelativePath)}
                {renderItem("Absolute path", Copy, onCopyAbsolutePath, {
                  disabled: !canCopyAbsolutePath,
                })}
              </div>
            </div>
            <div className={menuSeparatorClass} />
            {renderItem("Open in default app", ExternalLink, onOpenInDefaultApp)}
            {renderItem("Show in system explorer", FolderOpen, onShowInSystemExplorer)}
            {renderItem("Reveal file in navigation", PanelBottomOpen, onRevealInNavigation)}
            <div className={menuSeparatorClass} />
            {renderItem("Delete file", Trash2, onDeleteFile, { danger: true })}
          </div>
        </div>
      )}
    </div>
  );
}
