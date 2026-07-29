/**
 * Search Modal / Quick Switcher
 *
 * Full-text search across all vault notes with fuzzy matching.
 * Shows recent files when no search query is entered.
 * Supports keyboard navigation (arrow keys + Enter).
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { Search, Clock, FileText, Star, X } from "lucide-react";
import { SearchResult, FileEntry } from "../../types";
import { debounce, getNoteName } from "../../utils/helpers";
import { getAPI } from "../../utils/api";

interface SearchModalProps {
  onClose: () => void;
  onSelect: (path: string) => void;
  recentFiles?: string[];
  starredNotes?: string[];
  fileTree?: FileEntry[];
  initialQuery?: string;
  initialMode?: "search" | "switcher";
  onQueryChange?: (query: string) => void;
  onModeChange?: (mode: "search" | "switcher") => void;
}

const api = getAPI();

function highlightText(value: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return value;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escaped})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[var(--oo-accent-muted,rgba(232,168,74,0.35))] px-0.5 text-[var(--oo-text-primary,var(--text-primary))]"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ),
  );
}

// Get all notes from file tree
function getAllNotes(entries: FileEntry[]): { name: string; path: string }[] {
  const notes: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory && entry.extension === ".md") {
      notes.push({ name: getNoteName(entry.name), path: entry.path });
    }
    if (entry.children) {
      notes.push(...getAllNotes(entry.children));
    }
  }
  return notes;
}

export function SearchModal({
  onClose,
  onSelect,
  recentFiles = [],
  starredNotes = [],
  fileTree = [],
  initialQuery = "",
  initialMode = "switcher",
  onQueryChange,
  onModeChange,
}: SearchModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"search" | "switcher">(initialMode); // Start in switcher mode
  const inputRef = useRef<HTMLInputElement>(null);

  // All notes for quick switching
  const allNotes = useMemo(() => getAllNotes(fileTree), [fileTree]);

  // Quick filter for switcher mode (just filename matching, no content search)
  const filteredNotes = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allNotes
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [query, allNotes]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced full-text search
  const performSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }
      const res = await api.search(searchQuery);
      setResults(res);
      setSelectedIndex(0);
    }, 200),
    [],
  );

  // Sync persisted search state when the sidebar swaps between Explorer/Search.
  useEffect(() => {
    setQuery(initialQuery);
    setMode(initialMode);
    setSelectedIndex(0);
    if (initialMode === "search" && initialQuery.trim()) {
      void performSearch(initialQuery);
    } else if (!initialQuery.trim()) {
      setResults([]);
    }
  }, [initialQuery, initialMode, performSearch]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
    if (mode === "search") {
      performSearch(value);
    }
  };

  // Current display items
  const displayItems = useMemo(() => {
    if (mode === "search") {
      return results.map((r) => ({
        name: getNoteName(r.name),
        path: r.path,
        match: r.matches[0]?.value,
      }));
    } else {
      // Switcher mode: show filtered notes or recent+starred
      if (query.trim()) {
        return filteredNotes;
      } else {
        // Show starred first, then recent
        const items: {
          name: string;
          path: string;
          isStarred?: boolean;
          isRecent?: boolean;
        }[] = [];
        const added = new Set<string>();

        starredNotes.forEach((path) => {
          if (!added.has(path)) {
            items.push({ name: getNoteName(path), path, isStarred: true });
            added.add(path);
          }
        });

        recentFiles.forEach((path) => {
          if (!added.has(path)) {
            items.push({ name: getNoteName(path), path, isRecent: true });
            added.add(path);
          }
        });

        return items.slice(0, 10);
      }
    }
  }, [mode, query, results, filteredNotes, recentFiles, starredNotes]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, displayItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (displayItems[selectedIndex]) {
        onSelect(displayItems[selectedIndex].path);
      }
    } else if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      setMode((m) => {
        const nextMode = m === "search" ? "switcher" : "search";
        onModeChange?.(nextMode);
        if (nextMode === "search" && query.trim()) {
          performSearch(query);
        }
        return nextMode;
      });
      setSelectedIndex(0);
    }
  };

  const groupedSearchResults = useMemo(
    () =>
      results.map((result) => ({
        ...result,
        title: getNoteName(result.name),
        snippets: result.matches.slice(0, 3).map((match) => match.value),
      })),
    [results],
  );

  return (
    <div className="sidebar relative flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-t border-[var(--oo-border-subtle,var(--divider-color))] bg-[var(--oo-surface-1,var(--bg-secondary))] text-[var(--oo-text-primary,var(--text-primary))]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--oo-border-subtle,var(--border-subtle))] px-3 py-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-0,var(--bg-primary))] px-2.5">
          <Search size={16} className="shrink-0 text-[var(--oo-text-muted,var(--text-muted))]" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--oo-text-primary,var(--text-primary))] outline-none placeholder:text-[var(--oo-text-muted,var(--text-muted))]"
            type="text"
            placeholder={mode === "search" ? "Search vault…" : "Quick open…"}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--bg-hover)] text-[var(--oo-text-muted,var(--text-muted))] hover:text-[var(--oo-text-primary,var(--text-primary))]"
              onClick={() => {
                setQuery("");
                setResults([]);
                onQueryChange?.("");
              }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between px-4 pb-1 text-xs text-[var(--oo-text-muted,var(--text-muted))]">
        <span>
          {mode === "search"
            ? `${results.length} result${results.length === 1 ? "" : "s"}`
            : `${displayItems.length} item${displayItems.length === 1 ? "" : "s"}`}
        </span>
        <span>{mode === "search" ? "Content search" : "Quick open"}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {mode === "search" ? (
          groupedSearchResults.length > 0 ? (
            groupedSearchResults.map((result) => (
              <div key={result.path} className="mb-3">
                <button
                  className="flex w-full cursor-pointer items-center justify-between rounded border-0 bg-transparent px-1 py-1 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  onClick={() => onSelect(result.path)}
                  title={result.path}
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {result.title}
                  </span>
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {result.matches.length}
                  </span>
                </button>
                <div className="overflow-hidden rounded-md border border-[var(--border-medium)] bg-[var(--bg-primary)]">
                  {result.snippets.map((snippet, index) => (
                    <button
                      key={`${result.path}-${index}`}
                      className="block w-full cursor-pointer border-0 border-b border-[var(--border-subtle)] bg-transparent px-3 py-2 text-left text-xs leading-relaxed text-[var(--text-secondary)] last:border-b-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      onClick={() => onSelect(result.path)}
                    >
                      ...{highlightText(snippet.slice(0, 220), query)}...
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-32 items-center justify-center text-xs text-[var(--text-muted)]">
              {query ? "No results found" : "Type to search the vault"}
            </div>
          )
        ) : displayItems.length > 0 ? (
          displayItems.map((item: any, index) => (
            <button
              key={item.path}
              className={`flex w-full cursor-pointer items-center gap-2 rounded border-0 px-2 py-1.5 text-left text-sm transition-colors ${
                index === selectedIndex
                  ? "bg-[var(--oo-accent-muted,var(--bg-active))] text-[var(--oo-text-primary,var(--text-primary))]"
                  : "bg-transparent text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
              }`}
              onClick={() => onSelect(item.path)}
              onMouseEnter={() => setSelectedIndex(index)}
              title={item.path}
            >
              <span className="shrink-0 text-[var(--oo-text-muted,var(--text-muted))]">
                {item.isStarred ? <Star size={14} /> : item.isRecent ? <Clock size={14} /> : <FileText size={14} />}
              </span>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {item.name}
              </span>
            </button>
          ))
        ) : (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--oo-text-muted,var(--text-muted))]">
            {query ? "No notes match" : "Start typing to find notes"}
          </div>
        )}
      </div>
    </div>
  );
}
