/**
 * Status Bar
 *
 * Full-width inset status strip (Onyx Studio shell).
 * Plugin status items still mount into this host container.
 */

import React from "react";
import type { QueueStatus } from "../../utils/background-queue";
import {
  Check,
  Circle,
  Link2,
  PencilLine,
} from "lucide-react";
import { Tab, Theme, ViewMode, FileEntry } from "../../types";
import { countWords, countCharacters } from "../../utils/helpers";
import type { PluginStatusBarItem } from '../../types/plugin';
import { VimModeIndicator } from "./VimModeIndicator";

const statusBarClass =
  "oo-status-strip relative z-[180] flex h-[var(--oo-status-height,28px)] w-full shrink-0 items-center justify-end overflow-hidden border-t border-[var(--oo-border-subtle,var(--status-bar-border-color,var(--divider-color)))] bg-[var(--oo-surface-1,var(--status-bar-background,var(--bg-secondary)))] text-[12px] font-medium text-[var(--oo-text-muted,var(--status-bar-text-color,var(--text-muted)))] shadow-none";
const statusGroupClass = "flex min-w-0 items-center justify-end gap-0.5 pr-2";
const statusItemClass =
  "inline-flex h-[var(--oo-status-height,28px)] shrink-0 items-center gap-1 whitespace-nowrap border-l border-[var(--oo-border-subtle,var(--border-subtle))] px-2 text-[12px] leading-none text-[var(--oo-text-secondary,var(--text-primary))] first:border-l-0";
const statusIconItemClass =
  "inline-flex h-[var(--oo-status-height,28px)] w-[24px] shrink-0 items-center justify-center border-l border-[var(--oo-border-subtle,var(--border-subtle))] text-[var(--oo-text-secondary,var(--text-primary))] first:border-l-0";

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
}: StatusBarProps) {
  const wordCount = content ? countWords(content) : 0;
  const charCount = content ? countCharacters(content) : 0;

  return (
    <div className={statusBarClass}>
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
        {queueStatus && (queueStatus.isRunning || queueStatus.message) && (
          <span className={statusItemClass} title={queueStatus.message}>
            <span className={`h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] ${queueStatus.isRunning ? "animate-pulse" : ""}`} />
            <span className="max-w-[220px] truncate">{queueStatus.message}</span>
            {queueStatus.progress > 0 && queueStatus.progress < 100 && (
              <span className="font-semibold [font-variant-numeric:tabular-nums]">{queueStatus.progress}%</span>
            )}
          </span>
        )}
        {activeTab ? (
          <>
            <span
              className={statusIconItemClass}
              title={activeTab.isModified ? "Modified" : "Saved"}
            >
              {activeTab.isModified ? (
                <Circle size={10} fill="currentColor" />
              ) : (
                <Check size={13} />
              )}
            </span>
            {backlinkCount > 0 && (
              <span className={statusItemClass} title="Backlinks">
                {backlinkCount} backlinks
              </span>
            )}
            {showEditingMode && (
              <>
                <span className={statusIconItemClass} title={viewMode}>
                  {viewMode === "editor" ? <PencilLine size={14} /> : <Link2 size={14} />}
                </span>
                <VimModeIndicator vimEnabled={vimEnabled} />
              </>
            )}
            <span className={statusItemClass}>{wordCount} words</span>
            <span className={statusItemClass}>{charCount} characters</span>
          </>
        ) : (
          pluginStatusBarItems.length === 0 && <span className={statusItemClass}>OpenOnyx</span>
        )}
      </div>
    </div>
  );
}
