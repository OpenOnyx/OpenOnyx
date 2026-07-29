/**
 * New tab empty state — centered actions with quiet OpenOnyx monogram.
 */
import React from "react";
import { Plus, Search } from "lucide-react";

interface NewTabViewProps {
  onNewNote: () => void;
  onSearch: () => void;
  onClose?: () => void;
}

const actionClass =
  "flex w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-2,var(--bg-secondary))] px-4 py-3 text-[var(--oo-text-primary,var(--text-primary))] transition-all duration-150 hover:border-[var(--oo-border-medium,var(--border-medium))] hover:bg-[var(--bg-hover)] active:scale-[0.98]";

export function NewTabView({ onNewNote, onSearch }: NewTabViewProps) {
  return (
    <div className="relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-[var(--oo-surface-0,var(--bg-primary))]">
      {/* Low-opacity monogram watermark */}
      <img
        src="logos/logo-dark.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[42%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 opacity-[0.05]"
      />

      <div className="relative z-[1] flex w-full max-w-[300px] flex-col items-center gap-5 px-4">
        <div className="text-center">
          <div className="text-[13px] font-medium text-[var(--oo-text-secondary,var(--text-secondary))]">
            New tab
          </div>
          <p className="mt-1 text-[12px] text-[var(--oo-text-muted,var(--text-muted))]">
            Start writing or jump to a note
          </p>
        </div>

        <div className="flex w-full flex-col gap-2.5">
          <button type="button" onClick={onNewNote} className={actionClass}>
            <span className="text-[var(--oo-text-muted,var(--text-muted))]">
              <Plus size={18} />
            </span>
            <span className="flex-1 text-left text-sm font-medium">Create new note</span>
            <span className="rounded bg-[var(--oo-surface-3,var(--bg-active))] px-1.5 py-0.5 font-mono text-[11px] text-[var(--oo-text-muted,var(--text-muted))]">
              Ctrl + N
            </span>
          </button>

          <button type="button" onClick={onSearch} className={actionClass}>
            <span className="text-[var(--oo-text-muted,var(--text-muted))]">
              <Search size={18} />
            </span>
            <span className="flex-1 text-left text-sm font-medium">Quick open</span>
            <span className="rounded bg-[var(--oo-surface-3,var(--bg-active))] px-1.5 py-0.5 font-mono text-[11px] text-[var(--oo-text-muted,var(--text-muted))]">
              Ctrl + O
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
