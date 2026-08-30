import React, { useState, useEffect, useCallback, useRef } from "react";
import { CustomToggle } from "./PreferenceCard";
import type { SnippetManager, SnippetMeta } from "../../../lib/snippetManager";

interface CSSSnippetsManagerProps {
  snippetManager: SnippetManager;
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

type SortMode = "name" | "modified" | "size" | "status";

function sortSnippets(snippets: SnippetMeta[], mode: SortMode): SnippetMeta[] {
  const sorted = [...snippets];
  switch (mode) {
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "modified":
      return sorted.sort((a, b) => b.modifiedAt - a.modifiedAt);
    case "size":
      return sorted.sort((a, b) => b.size - a.size);
    case "status":
      return sorted.sort((a, b) => {
        const order = { error: 0, loaded: 1, disabled: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      });
    default:
      return sorted;
  }
}

// ── Status Dot Component ──────────────────────────────────────────────

function StatusDot({ status, error }: { status: SnippetMeta["status"]; error?: string }) {
  const colors = {
    loaded: "bg-emerald-500",
    disabled: "bg-[var(--text-muted)]",
    error: "bg-red-500",
  };

  return (
    <div className="relative group">
      <span
        className={`inline-block h-2 w-2 rounded-full ${colors[status]} ${
          status === "loaded" ? "shadow-[0_0_6px_rgba(16,185,129,0.5)]" : ""
        } ${status === "error" ? "animate-pulse" : ""}`}
      />
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 text-[11px] text-red-400 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
          <div className="font-semibold text-red-300 mb-1">CSS Error</div>
          <div className="font-mono text-[10px] leading-relaxed break-words">{error}</div>
        </div>
      )}
    </div>
  );
}

// ── Context Menu Component ────────────────────────────────────────────

interface ContextMenuProps {
  snippet: SnippetMeta;
  snippetManager: SnippetManager;
  onClose: () => void;
  onAction: () => void;
}

function SnippetContextMenu({ snippet, snippetManager, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const actions = [
    {
      label: "Edit",
      action: async () => {
        await snippetManager.openInEditor(snippet.id);
        onClose();
      },
    },
    {
      label: "Reveal in File Manager",
      action: async () => {
        await snippetManager.revealSnippet(snippet.id);
        onClose();
      },
    },
    { divider: true },
    {
      label: "Rename",
      action: async () => {
        const newName = prompt("New snippet name:", snippet.id);
        if (newName && newName !== snippet.id) {
          await snippetManager.renameSnippet(snippet.id, newName);
          onAction();
        }
        onClose();
      },
    },
    {
      label: "Duplicate",
      action: async () => {
        await snippetManager.duplicateSnippet(snippet.id);
        onAction();
        onClose();
      },
    },
    {
      label: "Export",
      action: async () => {
        await snippetManager.exportSnippet(snippet.id);
        onClose();
      },
    },
    { divider: true },
    {
      label: "Delete",
      danger: true,
      action: async () => {
        if (confirm(`Delete snippet "${snippet.name}"? This will move it to your system trash.`)) {
          await snippetManager.deleteSnippet(snippet.id);
          onAction();
        }
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-xl animate-in fade-in slide-in-from-top-1 duration-100"
    >
      {actions.map((item, idx) =>
        item.divider ? (
          <div
            key={`div-${idx}`}
            className="my-1 h-px bg-[var(--border-subtle)]"
          />
        ) : (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[12px] transition-colors ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export function CSSSnippetsManager({ snippetManager }: CSSSnippetsManagerProps) {
  const [snippets, setSnippets] = useState<SnippetMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const refreshSnippets = useCallback(() => {
    setSnippets(snippetManager.getSnippets());
  }, [snippetManager]);

  // Listen for snippet changes
  useEffect(() => {
    refreshSnippets();
    const handler = () => refreshSnippets();
    window.addEventListener("snippets-changed", handler);
    return () => window.removeEventListener("snippets-changed", handler);
  }, [refreshSnippets]);

  // Auto-focus create input
  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus();
    }
  }, [isCreating]);

  const handleToggle = useCallback(
    async (id: string) => {
      await snippetManager.toggle(id);
      refreshSnippets();
    },
    [snippetManager, refreshSnippets],
  );

  const handleRefresh = useCallback(async () => {
    await snippetManager.refresh();
    refreshSnippets();
  }, [snippetManager, refreshSnippets]);

  const handleReloadAll = useCallback(async () => {
    await snippetManager.reloadAll();
    refreshSnippets();
  }, [snippetManager, refreshSnippets]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await snippetManager.createSnippet(newName.trim());
    setNewName("");
    setIsCreating(false);
    refreshSnippets();
  }, [snippetManager, newName, refreshSnippets]);

  const handleImport = useCallback(async () => {
    await snippetManager.importSnippets();
    refreshSnippets();
  }, [snippetManager, refreshSnippets]);

  // Filter and sort
  const filtered = sortSnippets(
    snippets.filter((s) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.fileName.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    }),
    sortMode,
  );

  const errorCount = snippets.filter((s) => s.status === "error").length;
  const enabledCount = snippets.filter((s) => s.enabled).length;

  return (
    <div>
      {/* Section Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            CSS Snippets
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Custom CSS stylesheets loaded from your vault. Compatible with Obsidian snippets.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {snippets.length > 0 && (
            <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--text-muted)] border border-[var(--border-subtle)]">
              {enabledCount}/{snippets.length}
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 border border-red-500/20">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter snippets..."
            className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-medium)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              x
            </button>
          )}
        </div>

        {/* Sort */}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 text-[11px] font-medium text-[var(--text-primary)] outline-none cursor-pointer"
        >
          <option value="name">Name</option>
          <option value="modified">Modified</option>
          <option value="size">Size</option>
          <option value="status">Status</option>
        </select>

        {/* Action Buttons */}
        <button
          type="button"
          onClick={handleRefresh}
          title="Refresh snippet list"
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleReloadAll}
          title="Reload all enabled snippets"
          className="h-8 shrink-0 flex items-center justify-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
          Reload
        </button>
      </div>

      {/* Create / Import Row */}
      <div className="mb-4 flex items-center gap-2">
        {isCreating ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              ref={createInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setNewName("");
                }
              }}
              placeholder="Snippet name (e.g. my-custom-theme)"
              className="h-8 flex-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-primary,var(--text-primary))]"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim()}
              className="h-8 rounded-md bg-[var(--accent-primary,var(--text-primary))] px-3 text-[11px] font-semibold text-[var(--bg-primary)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewName("");
              }}
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="h-8 rounded-md border border-dashed border-[var(--border-medium)] bg-transparent px-3 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              + New Snippet
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              Import .css
            </button>
          </>
        )}
      </div>

      {/* Snippet List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-medium)] bg-[var(--bg-secondary)] p-8 text-center">
          {snippets.length === 0 ? (
            <>
              <div className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">
                No CSS Snippets
              </div>
              <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-[var(--text-muted)]">
                Place <code className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px]">.css</code> files
                in <code className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px]">.obsidian/snippets/</code> or{" "}
                <code className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[10px]">.openonyx/snippets/</code> in
                your vault, or use the buttons above to create or import snippets.
              </p>
            </>
          ) : (
            <div className="text-[12px] text-[var(--text-muted)]">
              No snippets match "{searchQuery}"
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          {filtered.map((snippet, idx) => (
            <div
              key={snippet.id}
              className={`flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--bg-hover)] ${
                idx === 0 ? "rounded-t-xl" : ""
              } ${idx === filtered.length - 1 ? "rounded-b-xl" : ""} ${
                idx < filtered.length - 1
                  ? "border-b border-[var(--border-subtle)]"
                  : ""
              }`}
            >
              {/* Status Dot */}
              <StatusDot status={snippet.status} error={snippet.error} />

              {/* Name & Meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {snippet.name}
                  </span>
                  <span className="shrink-0 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-muted)] border border-[var(--border-subtle)]">
                    {snippet.source === "obsidian" ? ".obsidian" : ".openonyx"}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                  <span className="font-mono">{snippet.fileName}</span>
                  <span>{formatFileSize(snippet.size)}</span>
                  <span>{formatRelativeTime(snippet.modifiedAt)}</span>
                </div>
              </div>

              {/* Toggle */}
              <CustomToggle
                checked={snippet.enabled}
                onChange={() => void handleToggle(snippet.id)}
              />

              {/* Context Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenuId(contextMenuId === snippet.id ? null : snippet.id);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                {contextMenuId === snippet.id && (
                  <SnippetContextMenu
                    snippet={snippet}
                    snippetManager={snippetManager}
                    onClose={() => setContextMenuId(null)}
                    onAction={refreshSnippets}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Design Tokens Info */}
      <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
          Snippet Authoring
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Snippets can reference OpenOnyx design tokens via{" "}
          <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[10px]">
            --oo-color-*
          </code>
          ,{" "}
          <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[10px]">
            --oo-spacing-*
          </code>
          , and{" "}
          <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[10px]">
            --oo-radius-*
          </code>{" "}
          CSS custom properties. These adapt automatically to theme changes.
        </p>
      </div>
    </div>
  );
}
