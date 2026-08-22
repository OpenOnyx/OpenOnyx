import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PRODUCT } from "../data/facts";
import { DOC_PAGES } from "../data/docs";

export type SiteCommand = {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
};

type CommandApi = {
  setWorkspaceCommands: (commands: SiteCommand[]) => void;
  openPalette: () => void;
};

const CommandCtx = createContext<CommandApi | null>(null);

export function useCommands() {
  const ctx = useContext(CommandCtx);
  if (!ctx) throw new Error("useCommands needs CommandProvider");
  return ctx;
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<SiteCommand[]>([]);

  const base = useMemo<SiteCommand[]>(
    () => [
      { id: "go-product", label: "Product", category: "Go to", action: () => navigate("/") },
      { id: "go-docs", label: "Docs", category: "Go to", action: () => navigate("/docs/start") },
      { id: "go-download", label: "Download", category: "Go to", action: () => navigate("/download") },
      {
        id: "go-source",
        label: "Source on GitHub",
        category: "Go to",
        action: () => window.open(PRODUCT.repo, "_blank", "noreferrer"),
      },
      ...DOC_PAGES.map((page) => ({
        id: `doc-${page.slug}`,
        label: page.title,
        category: `Docs · ${page.group}`,
        action: () => navigate(`/docs/${page.slug}`),
      })),
    ],
    [navigate],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("openonyx:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("openonyx:palette", onOpen);
    };
  }, []);

  const api = useMemo<CommandApi>(
    () => ({
      setWorkspaceCommands: setWorkspace,
      openPalette: () => setOpen(true),
    }),
    [],
  );

  return (
    <CommandCtx.Provider value={api}>
      {children}
      {open && <CommandPalette commands={[...workspace, ...base]} onClose={() => setOpen(false)} />}
    </CommandCtx.Provider>
  );
}

function score(command: SiteCommand, query: string) {
  const hay = `${command.category} ${command.label}`.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (hay.startsWith(q)) return 3;
  if (hay.includes(q)) return 2;
  return q.split(/\s+/).every((part) => hay.includes(part)) ? 1 : 0;
}

function CommandPalette({ commands, onClose }: { commands: SiteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = commands.filter((command) => score(command, query) > 0);
  const selected = filtered[index];

  useEffect(() => {
    setIndex(0);
  }, [query]);

  return (
    <div className="palette-scrim" onClick={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <span aria-hidden>⌘</span>
          <input
            autoFocus
            value={query}
            placeholder="Open a note, switch view, jump to docs…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, Math.max(filtered.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && selected) {
                selected.action();
                onClose();
              }
            }}
          />
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matches</div>}
          {filtered.map((command, i) => (
            <button
              key={command.id}
              type="button"
              className={`palette-row${i === index ? " is-active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                command.action();
                onClose();
              }}
            >
              <span>
                <span className="palette-cat">{command.category}</span>
                {command.label}
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
