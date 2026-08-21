/**
 * Status Bar — Onyx-style full-width footer with breadcrumbs + stats
 */

import React from "react";
import type { QueueStatus } from "../../utils/background-queue";
import type { SyncStatus } from "../../lib/syncEngine";
import {
  Check,
  Circle,
  Home,
  Link2,
  PencilLine,
  CloudUpload,
  CloudOff,
  RefreshCw,
} from "lucide-react";
import { Tab, Theme, ViewMode, FileEntry } from "../../types";
import { countWords, countCharacters } from "../../utils/helpers";
import type { PluginStatusBarItem } from '../../types/plugin';
import { VimModeIndicator } from "./VimModeIndicator";

const statusBarClass =
  "onyx-statusbar relative z-[180] flex h-[28px] w-full shrink-0 items-center justify-between overflow-hidden border-t border-[var(--divider-color)] bg-[var(--status-bar-background)] px-3 text-[12px] font-medium text-[var(--status-bar-text-color)]";
const statusGroupClass = "flex min-w-0 items-center gap-1";
const statusItemClass =
  "inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap px-1.5 text-[12px] leading-none text-[var(--status-bar-text-color)]";
const crumbClass =
  "inline-flex max-w-[160px] items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--text-secondary)]";
const crumbButtonClass =
  `${crumbClass} h-[22px] cursor-pointer rounded-[4px] border-0 bg-transparent px-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]`;
const crumbSepClass = "mx-0.5 text-[var(--text-faint)] opacity-70";

interface StatusBarProps {
  activeTab: Tab | null;
  content: string;
  theme: Theme;
  viewMode: ViewMode;
  fileTree?: FileEntry[];
  queueStatus?: QueueStatus | null;
  pluginStatusBarItems?: PluginStatusBarItem[];
  vimEnabled?: boolean;
  showEditingMode?: boolean;
  backlinkCount?: number;
  syncStatus?: SyncStatus | null;
  onRevealFolder?: (path: string) => void;
}

export function StatusBar({
  activeTab,
  content,
  viewMode,
  queueStatus,
  pluginStatusBarItems = [],
  vimEnabled = false,
  showEditingMode = true,
  backlinkCount = 0,
  syncStatus = null,
  onRevealFolder,
}: StatusBarProps) {
  const wordCount = content ? countWords(content) : 0;
  const charCount = content ? countCharacters(content) : 0;

  const pathParts =
    activeTab && !activeTab.path.startsWith("__")
      ? activeTab.path.split("/").filter(Boolean)
      : [];
  const noteName =
    pathParts.length > 0
      ? pathParts[pathParts.length - 1].replace(/\.md$/, "").replace(/\.canvas$/, "")
      : activeTab?.name || "";
  const canNavigateBreadcrumbs = Boolean(onRevealFolder && activeTab && pathParts.length > 0);
  const copyActivePath = () => {
    if (!activeTab?.path || activeTab.path.startsWith("__")) return;
    void navigator.clipboard?.writeText(activeTab.path);
  };

  return (
    <div className={statusBarClass}>
      <div className={statusGroupClass} aria-label="Breadcrumbs">
        <button
          type="button"
          className={`${statusItemClass} cursor-pointer rounded-[4px] border-0 bg-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`}
          title="Reveal root folder"
          aria-label="Reveal root folder"
          onClick={() => onRevealFolder?.("")}
          disabled={!canNavigateBreadcrumbs}
        >
          <Home size={13} strokeWidth={1.75} />
        </button>
        {pathParts.slice(0, -1).map((part, i) => {
          const folderPath = pathParts.slice(0, i + 1).join("/");
          return (
            <React.Fragment key={folderPath}>
              <span className={crumbSepClass}>›</span>
              <button
                type="button"
                className={crumbButtonClass}
                title={`Reveal ${folderPath}`}
                aria-label={`Reveal ${folderPath}`}
                onClick={() => onRevealFolder?.(folderPath)}
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
        {noteName && (
          <>
            <span className={crumbSepClass}>›</span>
            <button
              type="button"
              className={`${crumbButtonClass} font-medium text-[var(--text-primary)]`}
              title="Copy note path"
              aria-label="Copy note path"
              onClick={copyActivePath}
            >
              {noteName}
            </button>
          </>
        )}
      </div>

      <div className={statusGroupClass} role="status" aria-label="Status bar">
        {pluginStatusBarItems.map((item, i) => (
          <span
            key={`plugin-status-${item.pluginId}-${i}`}
            className={statusItemClass}
            ref={(el) => {
              if (el && item.el && !el.contains(item.el)) {
                el.innerHTML = '';
                el.appendChild(item.el);
              }
            }}
          />
        ))}
        {/* Sync status indicator */}
        {syncStatus && syncStatus.state === 'syncing' && (
          <span className={statusItemClass} title="Syncing changes...">
            <RefreshCw size={12} strokeWidth={1.75} style={{ animation: 'spin 1.2s linear infinite' }} />
            <span className="max-w-[120px] truncate" style={{ opacity: 0.8 }}>Syncing...</span>
          </span>
        )}
        {syncStatus && syncStatus.state === 'idle' && (syncStatus.pushed || syncStatus.pulled) && (
          <span className={statusItemClass} title={`Pushed ${syncStatus.pushed || 0}, pulled ${syncStatus.pulled || 0}`}>
            <CloudUpload size={12} strokeWidth={1.75} style={{ opacity: 0.7 }} />
            <span style={{ opacity: 0.7 }}>{(syncStatus.pushed || 0) + (syncStatus.pulled || 0)} synced</span>
          </span>
        )}
        {syncStatus && syncStatus.state === 'error' && (
          <span className={statusItemClass} title={syncStatus.error || 'Sync error'}>
            <CloudOff size={12} strokeWidth={1.75} style={{ color: 'var(--text-error, #ef4444)' }} />
            <span className="max-w-[140px] truncate" style={{ color: 'var(--text-error, #ef4444)', opacity: 0.9 }}>Sync error</span>
          </span>
        )}
        {queueStatus && (queueStatus.isRunning || queueStatus.message) && (
          <span className={statusItemClass} title={queueStatus.message}>
            <span className={`h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] ${queueStatus.isRunning ? "animate-pulse" : ""}`} />
            <span className="max-w-[180px] truncate">{queueStatus.message}</span>
            {queueStatus.progress > 0 && queueStatus.progress < 100 && (
              <span className="font-semibold [font-variant-numeric:tabular-nums]">{queueStatus.progress}%</span>
            )}
          </span>
        )}
        {activeTab ? (
          <>
            <span
              className={statusItemClass}
              title={activeTab.isModified ? "Modified" : "Saved"}
            >
              {activeTab.isModified ? (
                <Circle size={9} fill="currentColor" />
              ) : (
                <Check size={13} />
              )}
            </span>
            {backlinkCount > 0 && (
              <span className={statusItemClass} title="Backlinks">
                <Link2 size={12} strokeWidth={1.75} />
                {backlinkCount}
              </span>
            )}
            {showEditingMode && (
              <>
                <span className={statusItemClass} title={viewMode}>
                  {viewMode === "editor" ? (
                    <PencilLine size={13} strokeWidth={1.75} />
                  ) : (
                    <Link2 size={13} strokeWidth={1.75} />
                  )}
                </span>
                <VimModeIndicator vimEnabled={vimEnabled} />
              </>
            )}

            <span className={statusItemClass}>{wordCount} words</span>
            <span className={statusItemClass}>{charCount} chars</span>
          </>
        ) : (
          pluginStatusBarItems.length === 0 && (
            <span className={statusItemClass}>OpenOnyx</span>
          )
        )}
      </div>
    </div>
  );
}
