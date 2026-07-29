import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface BookmarkModalProps {
  path: string;
  initialTitle: string;
  groups: string[];
  onClose: (result: { title: string; group: string } | null) => void;
}

export function BookmarkModal({ path, initialTitle, groups, onClose }: BookmarkModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [group, setGroup] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const save = () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle) onClose({ title: trimmedTitle, group });
  };

  return (
    <div
      className="oo-host-modal-overlay fixed inset-0 z-[5000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onMouseDown={() => onClose(null)}
    >
      <div
        className="oo-host-modal w-full max-w-[544px] rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-float,var(--bg-elevated))] p-4 text-[var(--oo-text-primary,var(--text-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmark-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose(null);
          if (event.key === "Enter") save();
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="bookmark-modal-title" className="m-0 text-lg font-semibold tracking-tight">Add bookmark</h2>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[var(--oo-text-muted,var(--text-muted))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
            onClick={() => onClose(null)}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>

        <label className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-[var(--oo-border-subtle,var(--border-subtle))] pb-2.5 text-[13px]">
          <span className="text-[var(--oo-text-secondary,var(--text-secondary))]">Path</span>
          <input
            value={path.replace(/\.[^/.]+$/, "")}
            readOnly
            className="min-w-0 rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-2.5 py-1.5 text-[13px] text-[var(--oo-text-muted,var(--text-secondary))] outline-none"
          />
        </label>

        <label className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-[var(--oo-border-subtle,var(--border-subtle))] py-2.5 text-[13px]">
          <span className="text-[var(--oo-text-secondary,var(--text-secondary))]">Title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-0 rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-2.5 py-1.5 text-[13px] text-[var(--oo-text-primary,var(--text-primary))] outline-none focus:border-[var(--oo-accent,var(--accent-primary))]"
          />
        </label>

        <label className="grid grid-cols-[160px_1fr] items-center gap-4 py-2.5 text-[13px]">
          <span className="text-[var(--oo-text-secondary,var(--text-secondary))]">Bookmark group</span>
          <input
            list="bookmark-groups"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="No group"
            className="min-w-0 rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-2.5 py-1.5 text-[13px] text-[var(--oo-text-primary,var(--text-primary))] outline-none focus:border-[var(--oo-accent,var(--accent-primary))]"
          />
          <datalist id="bookmark-groups">
            {groups.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3.5 py-1.5 text-[13px] text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
            onClick={() => onClose(null)}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-[var(--oo-accent,var(--accent-primary))] bg-[var(--oo-accent,var(--accent-primary))] px-3.5 py-1.5 text-[13px] font-medium text-[var(--oo-accent-on,var(--text-on-accent))] disabled:opacity-50"
            disabled={!title.trim()}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
