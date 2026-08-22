import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PLUGINS_TESTED } from "../../data/facts";
import {
  ASK_PROMPTS,
  VAULT_NOTES,
  VAULT_TREE,
  backlinksTo,
  noteById,
  wordCount,
  type TreeNode,
} from "../../data/vault";
import { VaultGraph } from "../VaultGraph";
import { useTheme } from "../../theme";
import { useCommands, type SiteCommand } from "../commands";
import { SourceView } from "./SourceView";
import { WikiMarkdown } from "./WikiMarkdown";

type View = "write" | "graph" | "ask" | "canvas" | "look" | "plugins";
type EditMode = "source" | "preview" | "live";

const START = "01 - Projects/Research/Knowledge Management.md";

const VIEWS: Array<[View, string]> = [
  ["write", "write"],
  ["graph", "graph"],
  ["ask", "spaces"],
];

const CANVAS_CARDS = [
  { id: "01 - Projects/Research/Knowledge Management.md", x: 6, y: 16, tone: "a" },
  { id: "01 - Projects/Research/Zettelkasten Method.md", x: 38, y: 10, tone: "b" },
  { id: "03 - Resources/Books/Atomic Habits Notes.md", x: 68, y: 18, tone: "c" },
  { id: "01 - Projects/MachineLearning/Transformer Architecture.md", x: 18, y: 54, tone: "d" },
  { id: "00 - Inbox/Reading Queue.md", x: 50, y: 58, tone: "a" },
  { id: "05 - Daily Notes/2024-01-15.md", x: 72, y: 62, tone: "b" },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function Workspace() {
  const { theme, setTheme } = useTheme();
  const { setWorkspaceCommands, openPalette } = useCommands();
  const [activeId, setActiveId] = useState(START);
  const [openTabs, setOpenTabs] = useState<string[]>([START]);
  const [view, setView] = useState<View>("write");
  const [editMode, setEditMode] = useState<EditMode>("live");
  const [query, setQuery] = useState("");
  const [pluginQuery, setPluginQuery] = useState("");
  const [sidebar, setSidebar] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [askId, setAskId] = useState<(typeof ASK_PROMPTS)[number]["id"] | null>(null);
  const [wallpaper, setWallpaper] = useState(false);

  const note = noteById(activeId) ?? VAULT_NOTES[0];
  const backs = useMemo(() => backlinksTo(note.id), [note.id]);
  const asked = ASK_PROMPTS.find((item) => item.id === askId) ?? null;
  const plugins = PLUGINS_TESTED.filter((item) => item.name.toLowerCase().includes(pluginQuery.toLowerCase()));

  const openNote = (id: string) => {
    const found = noteById(id);
    if (!found) return;
    setActiveId(id);
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setView("write");
  };

  useEffect(() => {
    const commands: SiteCommand[] = [
      { id: "view-write", label: "Open editor", category: "View", shortcut: "⌘1", action: () => setView("write") },
      { id: "mode-source", label: "Source mode", category: "Editor", action: () => { setView("write"); setEditMode("source"); } },
      { id: "mode-preview", label: "Preview mode", category: "Editor", action: () => { setView("write"); setEditMode("preview"); } },
      { id: "mode-live", label: "Split source + preview", category: "Editor", action: () => { setView("write"); setEditMode("live"); } },
      { id: "view-graph", label: "Open graph", category: "View", shortcut: "⌘G", action: () => setView("graph") },
      { id: "view-ask", label: "Ask this vault", category: "View", action: () => setView("ask") },
      { id: "view-canvas", label: "Open canvas", category: "View", action: () => setView("canvas") },
      { id: "view-look", label: "Appearance", category: "View", action: () => setView("look") },
      { id: "view-plugins", label: "Plugin runtime", category: "View", action: () => setView("plugins") },
      { id: "toggle-side", label: "Toggle file tree", category: "View", action: () => setSidebar((v) => !v) },
      ...VAULT_NOTES.map((item) => ({
        id: `note-${item.id}`,
        label: item.title,
        category: "Notes",
        action: () => openNote(item.id),
      })),
    ];
    setWorkspaceCommands(commands);
    return () => setWorkspaceCommands([]);
  }, [setWorkspaceCommands]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        setView((current) => (current === "graph" ? "write" : "graph"));
      }
      if (event.key === "1") {
        event.preventDefault();
        setView("write");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeTab = (id: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== id);
      if (id === activeId) {
        const fallback = next[next.length - 1] ?? START;
        setActiveId(fallback);
      }
      return next.length ? next : [START];
    });
  };

  const showTabs = view === "write";

  return (
    <div className={`oo${theme === "light" ? " is-light" : ""}${wallpaper ? " is-wall" : ""}`}>
      <div className="oo-title">
        <div className="oo-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="oo-vault">OO-Test-Vault</div>
        <div className="oo-views" role="tablist" aria-label="Workspace views">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "is-on" : ""} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="oo-k" onClick={openPalette}>
          ⌘K
        </button>
      </div>

      <div className="oo-body">
        <nav className="oo-ribbon" aria-label="Ribbon">
          <button type="button" className={sidebar ? "is-on" : ""} onClick={() => setSidebar((v) => !v)} title="Files">
            <Icon>
              <path d="M4 7h16M4 12h16M4 17h10" />
            </Icon>
          </button>
          <button type="button" className={view === "write" ? "is-on" : ""} onClick={() => setView("write")} title="Editor">
            <Icon>
              <path d="M7 3h8l4 4v14H7z" />
              <path d="M15 3v5h5M9 13h6M9 17h4" />
            </Icon>
          </button>
          <button type="button" className={view === "graph" ? "is-on" : ""} onClick={() => setView(view === "graph" ? "write" : "graph")} title="Graph">
            <Icon>
              <circle cx="6.5" cy="7" r="2.2" />
              <circle cx="17.5" cy="7" r="2.2" />
              <circle cx="12" cy="17" r="2.2" />
              <path d="M8.4 8.2 15.6 8.2M7.6 9.1 10.6 15M16.4 9.1 13.4 15" />
            </Icon>
          </button>
          <button type="button" className={view === "ask" ? "is-on" : ""} onClick={() => setView("ask")} title="Spaces">
            <Icon>
              <path d="M12 3.5l2.2 4.5 5 .7-3.6 3.5.9 4.9L12 14.8 7.5 17.1l.9-4.9L4.8 8.7l5-.7z" />
            </Icon>
          </button>
          <button type="button" className={view === "canvas" ? "is-on" : ""} onClick={() => setView("canvas")} title="Canvas">
            <Icon>
              <rect x="4" y="5" width="7" height="6" rx="1" />
              <rect x="13" y="13" width="7" height="6" rx="1" />
              <path d="M11 8h4M16 11v2" />
            </Icon>
          </button>
        </nav>

        {sidebar && (
          <aside className="oo-side">
            <div className="oo-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search notes…"
                aria-label="Search notes"
              />
            </div>
            <div className="oo-tree">
              {query.trim() ? (
                <ul>
                  {VAULT_NOTES.filter((item) =>
                    `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase()),
                  ).map((item) => (
                    <li key={item.id}>
                      <button type="button" className={item.id === activeId ? "is-on" : ""} onClick={() => openNote(item.id)}>
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                VAULT_TREE.map((node) => (
                  <Tree key={node.type === "folder" ? node.name : node.id} node={node} activeId={activeId} onOpen={openNote} />
                ))
              )}
            </div>
          </aside>
        )}

        <section className="oo-main">
          {showTabs && (
            <div className="oo-tabs">
              {openTabs.map((id) => {
                const tab = noteById(id);
                if (!tab) return null;
                return (
                  <div key={id} className={`oo-tab${id === activeId ? " is-on" : ""}`}>
                    <button type="button" onClick={() => setActiveId(id)}>
                      {tab.title}
                    </button>
                    <button type="button" className="oo-tab-x" onClick={() => closeTab(id)} aria-label={`Close ${tab.title}`}>
                      ×
                    </button>
                  </div>
                );
              })}
              <div className="oo-modes" role="tablist" aria-label="Editor mode">
                {(["source", "preview", "live"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={editMode === mode}
                    className={editMode === mode ? "is-on" : ""}
                    onClick={() => setEditMode(mode)}
                  >
                    {mode === "live" ? "split" : mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`oo-stage is-${view} mode-${editMode}`}>
            {view === "write" && (editMode === "source" || editMode === "live") && (
              <article className="oo-editor is-source">
                <SourceView source={note.body} onOpen={openNote} />
              </article>
            )}
            {view === "write" && (editMode === "preview" || editMode === "live") && (
              <article className="oo-editor">
                <WikiMarkdown source={note.body} onOpen={openNote} />
              </article>
            )}
            {view === "graph" && (
              <div className="oo-graph">
                <VaultGraph
                  className="oo-graph-canvas"
                  light={theme === "light"}
                  focusId={note.id}
                  onSelect={(id) => {
                    if (noteById(id)) openNote(id);
                  }}
                />
              </div>
            )}
            {view === "ask" && (
              <div className="oo-ask">
                <p className="oo-ask-kicker">spaces · local embeddings · all-MiniLM-L6-v2</p>
                <h2>Ask the files. Don’t replace them.</h2>
                <p>
                  On desktop, Spaces chunk the vault and retrieve with citations. These four answers are from this
                  test vault — tap a source to open the note.
                </p>
                <div className="oo-asks">
                  {ASK_PROMPTS.map((item) => (
                    <button key={item.id} type="button" className={askId === item.id ? "is-on" : ""} onClick={() => setAskId(item.id)}>
                      {item.q}
                    </button>
                  ))}
                </div>
                {asked && (
                  <div className="oo-answer">
                    <p>{asked.a}</p>
                    <div className="oo-cites">
                      {asked.cites.map((id) => {
                        const cite = noteById(id);
                        if (!cite) return null;
                        return (
                          <button key={id} type="button" onClick={() => openNote(id)}>
                            {cite.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <figure className="oo-shot">
                  <img src="/images/spaces-dashboard.png" alt="Spaces chat in the OpenOnyx desktop app" />
                  <figcaption>Spaces in the running app</figcaption>
                </figure>
              </div>
            )}
            {view === "canvas" && (
              <div className="oo-canvas">
                <div className="oo-canvas-bar">Vault Atlas · click a card to open the note</div>
                <div className="oo-board">
                  {CANVAS_CARDS.map((card) => {
                    const item = noteById(card.id);
                    if (!item) return null;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={`oo-card tone-${card.tone}${card.id === activeId ? " is-on" : ""}`}
                        style={{ left: `${card.x}%`, top: `${card.y}%` }}
                        onClick={() => openNote(card.id)}
                      >
                        <span>{item.folder}</span>
                        {item.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {view === "look" && (
              <div className="oo-look">
                <p className="oo-ask-kicker">appearance · live on this window</p>
                <h2>Quiet chrome. Your theme.</h2>
                <p>
                  Dark and light apply on this page. The desktop app also has oceanic, custom themes, and a
                  vault wallpaper.
                </p>
                <div className="oo-skins">
                  <button type="button" className={theme === "dark" ? "is-on" : ""} onClick={() => setTheme("dark")}>
                    dark
                  </button>
                  <button type="button" className={theme === "light" ? "is-on" : ""} onClick={() => setTheme("light")}>
                    light
                  </button>
                  <button type="button" className={wallpaper ? "is-on" : ""} onClick={() => setWallpaper((v) => !v)}>
                    wallpaper
                  </button>
                </div>
                <figure className="oo-shot">
                  <img src="/images/themes.png" alt="Appearance settings in OpenOnyx" />
                  <figcaption>Appearance & Theme in the running app</figcaption>
                </figure>
              </div>
            )}
            {view === "plugins" && (
              <div className="oo-plugins">
                <p className="oo-ask-kicker">runtime · obsidian@1.13.1 · 158/158 exports</p>
                <h2>Community plugins, contained.</h2>
                <p>
                  These are the community bundles the desktop test suite loads against the compatibility
                  layer. The app prompts for permissions and isolates crashes.
                </p>
                <input
                  className="oo-plugin-search"
                  value={pluginQuery}
                  onChange={(event) => setPluginQuery(event.target.value)}
                  placeholder="Filter plugins…"
                  aria-label="Filter plugins"
                />
                <ul className="oo-plugin-list">
                  {plugins.map((item) => (
                    <li key={item.name}>
                      <b>{item.name}</b>
                      <span>{item.version}</span>
                    </li>
                  ))}
                </ul>
                <figure className="oo-shot">
                  <img src="/images/plugin-marketplace.png" alt="Plugin marketplace in OpenOnyx" />
                  <figcaption>Marketplace in the running app</figcaption>
                </figure>
              </div>
            )}
          </div>
        </section>

        {view === "write" && (
          <aside className="oo-right">
            <h4>Backlinks</h4>
            {backs.length === 0 && <p className="oo-empty">No incoming links in this slice.</p>}
            {backs.map((item) => (
              <button key={item.id} type="button" onClick={() => openNote(item.id)}>
                {item.title}
              </button>
            ))}
            <h4>In this note</h4>
            <p className="oo-empty">{wordCount(note.body)} words · markdown on disk</p>
          </aside>
        )}
      </div>

      <footer className="oo-status">
        <span>
          {view === "plugins"
            ? "plugin runtime"
            : view === "look"
              ? `appearance · ${theme}${wallpaper ? " · wallpaper" : ""}`
              : view === "canvas"
                ? "Vault Atlas.canvas"
                : note.id.replace(/\.md$/, "")}
        </span>
        <span>
          {view === "plugins"
            ? `${PLUGINS_TESTED.length} tested bundles`
            : view === "write"
              ? `${editMode === "live" ? "source + preview" : editMode} · ${backs.length} backlink${backs.length === 1 ? "" : "s"} · ${wordCount(note.body)} words`
              : `${backs.length} backlink${backs.length === 1 ? "" : "s"} · ${wordCount(note.body)} words · local`}
        </span>
      </footer>
    </div>
  );
}

function Tree({ node, activeId, onOpen }: { node: TreeNode; activeId: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  if (node.type === "file") {
    return (
      <button type="button" className={`tree-file${node.id === activeId ? " is-on" : ""}`} onClick={() => onOpen(node.id)}>
        {node.title}
      </button>
    );
  }
  return (
    <div className="tree-folder">
      <button type="button" className="tree-dir" onClick={() => setOpen((value) => !value)}>
        <span className={`chev${open ? " is-open" : ""}`} />
        {node.name}
      </button>
      {open && (
        <div className="tree-kids">
          {node.children.map((child) => (
            <Tree key={child.type === "folder" ? child.name : child.id} node={child} activeId={activeId} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
