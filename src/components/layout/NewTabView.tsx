import React from 'react';
import { Plus, Search } from 'lucide-react';

interface NewTabViewProps {
  onNewNote: () => void;
  onSearch: () => void;
  onClose?: () => void;
}

export function NewTabView({ onNewNote, onSearch }: NewTabViewProps) {
  return (
    <div className="onyx-new-tab-view flex items-center justify-center h-full w-full bg-[var(--bg-primary)] select-none">
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col gap-2.5 w-full max-w-[280px]">
          <button
            type="button"
            onClick={onNewNote}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[var(--bg-hover)] hover:border-[var(--border-medium)] active:scale-[0.98]"
          >
            <span className="text-[var(--text-muted)]"><Plus size={18} /></span>
            <span className="text-sm font-medium flex-1 text-left">Create new note</span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-active)]">Ctrl + N</span>
          </button>
          
          <button
            type="button"
            onClick={onSearch}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer transition-all duration-150 hover:bg-[var(--bg-hover)] hover:border-[var(--border-medium)] active:scale-[0.98]"
          >
            <span className="text-[var(--text-muted)]"><Search size={18} /></span>
            <span className="text-sm font-medium flex-1 text-left">Go to file</span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-active)]">Ctrl + O</span>
          </button>
        </div>
      </div>
    </div>
  );
}

