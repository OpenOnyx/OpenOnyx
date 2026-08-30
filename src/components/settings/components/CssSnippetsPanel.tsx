import React, { useCallback, useEffect, useRef, useState } from "react";
import { getSnippetManager, type SnippetMeta } from "../../../lib/snippetManager";
import { CustomToggle } from "./PreferenceCard";

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CssSnippetsPanel() {
  const [snippets, setSnippets] = useState<SnippetMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const createRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => {
      const mgr = getSnippetManager();
      setSnippets(mgr.isAlive() ? mgr.getSnippets() : []);
    };
    const unsub = getSnippetManager().subscribe(sync);
    window.addEventListener("snippets-changed", sync);
    void getSnippetManager().refresh().then(sync);
    return () => {
      unsub();
      window.removeEventListener("snippets-changed", sync);
    };
  }, []);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  const run = useCallback(async (fn: (mgr: ReturnType<typeof getSnippetManager>) => Promise<unknown>) => {
    setBusy(true);
    try {
      const mgr = getSnippetManager();
      if (!mgr.isAlive()) return;
      await fn(mgr);
      setSnippets(getSnippetManager().isAlive() ? getSnippetManager().getSnippets() : []);
    } finally {
      setBusy(false);
    }
  }, []);

  const enabledCount = snippets.filter((snippet) => snippet.enabled).length;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            CSS Snippets
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
            Extra stylesheets on top of the current theme. Files live in{" "}
            <code>.openonyx/snippets</code>. Vaults from Obsidian also load{" "}
            <code>.obsidian/snippets</code>. Same name: the OpenOnyx file wins.
          </p>
        </div>
        {snippets.length > 0 && (
          <span className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
            {enabledCount}/{snippets.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run((mgr) => mgr.refresh())}
          className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          Refresh
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run((mgr) => mgr.openSnippetsFolder())}
          className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          Open folder
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run((mgr) => mgr.importSnippets())}
          className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          Import .css
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setCreating(true)}
          className="h-8 rounded-lg border border-dashed border-[var(--border-medium)] px-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          + New
        </button>
      </div>

      {creating && (
        <div className="mt-3 flex items-center gap-2">
          <input
            ref={createRef}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void run(async (mgr) => {
                  const id = await mgr.createSnippet(newName);
                  setNewName("");
                  setCreating(false);
                  if (id) await mgr.openInEditor(id);
                });
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="snippet-name"
            className="h-8 flex-1 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-2.5 text-xs text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            disabled={!newName.trim() || busy}
            onClick={() =>
              void run(async (mgr) => {
                const id = await mgr.createSnippet(newName);
                setNewName("");
                setCreating(false);
                if (id) await mgr.openInEditor(id);
              })
            }
            className="h-8 rounded-md bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--bg-primary)] disabled:opacity-40"
          >
            Create
          </button>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-secondary)]">
        {snippets.length === 0 ? (
          <p className="p-5 text-[12px] text-[var(--text-muted)]">
            No snippets yet. Drop a <code>.css</code> file into <code>.openonyx/snippets</code> or
            use New / Import.
          </p>
        ) : (
          snippets.map((snippet) => (
            <div
              key={`${snippet.source}:${snippet.id}`}
              className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  snippet.status === "error"
                    ? "bg-red-500"
                    : snippet.enabled
                      ? "bg-emerald-500"
                      : "bg-[var(--text-muted)]"
                }`}
                title={snippet.error || snippet.status}
              />
              <div className="min-w-0 flex-1">
                {renamingId === snippet.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={renameValue}
                      autoFocus
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void run(async (mgr) => {
                            const ok = await mgr.renameSnippet(snippet.id, renameValue);
                            if (ok) setRenamingId(null);
                          });
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      className="h-7 min-w-0 flex-1 rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-2 text-xs"
                    />
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setRenamingId(null)}
                      className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                      {snippet.id}
                    </span>
                    <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-muted)]">
                      {snippet.source === "obsidian" ? ".obsidian" : ".openonyx"}
                    </span>
                    {snippet.overridesObsidian && (
                      <span
                        className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]"
                        title="A file with this name also exists in .obsidian/snippets. The OpenOnyx copy is the one that loads."
                      >
                        overrides .obsidian
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-0.5 flex gap-3 text-[10px] text-[var(--text-muted)]">
                  <span className="font-mono">{snippet.fileName}</span>
                  {snippet.size > 0 && <span>{formatFileSize(snippet.size)}</span>}
                </div>
              </div>
              <CustomToggle
                checked={snippet.enabled}
                onChange={() => void run((mgr) => mgr.toggle(snippet.id))}
              />
              <button
                type="button"
                title="Edit in OpenOnyx"
                onClick={() => void run((mgr) => mgr.openInEditor(snippet.id))}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Edit
              </button>
              <button
                type="button"
                title="Rename"
                onClick={() => {
                  setRenamingId(snippet.id);
                  setRenameValue(snippet.id);
                }}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Rename
              </button>
              <button
                type="button"
                title="Export"
                onClick={() => void run((mgr) => mgr.exportSnippet(snippet.id))}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Export
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete snippet “${snippet.id}”?`)) {
                    void run((mgr) => mgr.deleteSnippet(snippet.id));
                  }
                }}
                className="text-[11px] text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
