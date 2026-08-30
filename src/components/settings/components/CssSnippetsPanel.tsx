import React, { useCallback, useEffect, useState } from "react";
import {
  getCssSnippets,
  openCssSnippetsFolder,
  refreshCssSnippets,
  setCssSnippetEnabled,
  subscribeCssSnippets,
  type CssSnippet,
} from "../../../lib/cssSnippets";
import { CustomToggle, PreferenceCard } from "./PreferenceCard";

function sourceLabel(snippet: CssSnippet): string {
  return snippet.source === "obsidian" ? ".obsidian/snippets" : ".openonyx/snippets";
}

export function CssSnippetsPanel() {
  const [snippets, setSnippets] = useState<CssSnippet[]>(() => getCssSnippets());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setSnippets(getCssSnippets());
    const unsubscribe = subscribeCssSnippets(sync);
    void refreshCssSnippets().then(sync);
    return unsubscribe;
  }, []);

  const handleRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await refreshCssSnippets();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    setBusy(true);
    try {
      await openCssSnippetsFolder();
      await refreshCssSnippets();
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
        CSS Snippets
      </h3>
      <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-5">
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          Extra stylesheets applied on top of the current theme. Drop <code>.css</code> files into
          {" "}<code>.openonyx/snippets</code>. Vaults that came from Obsidian also load
          {" "}<code>.obsidian/snippets</code>. If the same name exists in both folders, the
          OpenOnyx copy is used. Snippets that only target Obsidian editor classes may do nothing.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={busy}
            className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            disabled={busy}
            className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            Open snippets folder
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border-subtle)]">
          {snippets.length === 0 ? (
            <p className="pt-4 text-[12px] text-[var(--text-muted)]">
              No snippets found. Add <code>.css</code> files to <code>.openonyx/snippets</code> and
              they will appear here.
            </p>
          ) : (
            snippets.map((snippet) => (
              <PreferenceCard
                key={`${snippet.source}:${snippet.name}`}
                title={snippet.name}
                description={sourceLabel(snippet)}
                badge={snippet.source === "obsidian" ? "Obsidian" : undefined}
              >
                <CustomToggle
                  checked={snippet.enabled}
                  onChange={(enabled) => {
                    void setCssSnippetEnabled(snippet.name, enabled);
                  }}
                />
              </PreferenceCard>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
