import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkspaceMotion } from "../../lib/motion";
import { Editor } from "../../../../src/components/editor/Editor";
import { GraphView } from "../../../../src/components/graph/GraphView";
import { AIKnowledgeGraph, resetAIGraphCache } from "../../../../src/components/graph/AIKnowledgeGraph";
import { DEFAULT_SETTINGS } from "../../../../src/components/settings/SettingsPage";
import { getAPI } from "../../../../src/utils/api";
import type { FileEntry, Tab, ViewMode } from "../../../../src/types";
import { PLUGINS_TESTED } from "../../data/facts";
import { paletteHotkeyLabel } from "../../lib/hotkey";
import vault from "../../data/real-vault.json";
import { useTheme } from "../../theme";
import { useCommands, type SiteCommand } from "../commands";
import { SiteSpaces } from "./SiteSpaces";

type Surface = "write" | "graph" | "ask" | "look" | "plugins";
type GraphMode = "manual" | "ai";

const START = "01 - Projects/Research/Knowledge Management.md";
const VAULT_PATH = "OO-Test-Vault";
const FILES = vault as Record<string, string>;

const VIEWS: Array<[Surface, string]> = [
  ["write", "write"],
  ["graph", "graph"],
  ["ask", "spaces"],
];

function fileName(path: string) {
  return path.split("/").pop()?.replace(/\.md$/i, "") || path;
}

function buildTree(paths: string[]): FileEntry[] {
  const root: FileEntry[] = [];
  const dirs = new Map<string, FileEntry>();

  const ensureDir = (dirPath: string): FileEntry[] => {
    if (!dirPath) return root;
    const existing = dirs.get(dirPath);
    if (existing?.children) return existing.children;
    const parent = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    const name = dirPath.split("/").pop() || dirPath;
    const node: FileEntry = {
      name,
      path: dirPath,
      absolutePath: `${VAULT_PATH}/${dirPath}`,
      isDirectory: true,
      extension: "",
      children: [],
      modifiedAt: Date.now(),
      size: 0,
    };
    dirs.set(dirPath, node);
    ensureDir(parent).push(node);
    return node.children!;
  };

  for (const filePath of [...paths].sort()) {
    const slash = filePath.lastIndexOf("/");
    const dir = slash === -1 ? "" : filePath.slice(0, slash);
    const name = slash === -1 ? filePath : filePath.slice(slash + 1);
    ensureDir(dir).push({
      name,
      path: filePath,
      absolutePath: `${VAULT_PATH}/${filePath}`,
      isDirectory: false,
      extension: name.includes(".") ? `.${name.split(".").pop()}` : "",
      modifiedAt: Date.now(),
      size: FILES[filePath]?.length ?? 0,
    });
  }
  return root;
}

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
  const shellRef = useRef<HTMLDivElement>(null);
  const [activePath, setActivePath] = useState(START);
  const [openTabs, setOpenTabs] = useState<string[]>([START]);
  const [contents, setContents] = useState<Record<string, string>>(() => ({ ...FILES }));
  const [surface, setSurface] = useState<Surface>("write");
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth <= 760 ? "editor" : "split",
  );
  const [graphMode, setGraphMode] = useState<GraphMode>("manual");
  const [query, setQuery] = useState("");
  const [pluginQuery, setPluginQuery] = useState("");
  const [sidebar, setSidebar] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [wallpaper, setWallpaper] = useState(false);
  const settings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      theme,
      defaultView: viewMode,
      defaultEditingMode: "source" as const,
      readableLineLength: false,
      showLineNumbers: true,
      backgroundImage: wallpaper ? "/images/wallpaper-background.png" : "",
    }),
    [theme, viewMode, wallpaper],
  );

  const notes = useMemo(
    () =>
      Object.keys(FILES)
        .filter((path) => path.toLowerCase().endsWith(".md"))
        .map((path) => ({ name: fileName(path), path })),
    [],
  );
  const fileTree = useMemo(() => buildTree(Object.keys(FILES)), []);
  const tabs: Tab[] = openTabs.map((path) => ({
    id: path,
    path,
    name: fileName(path),
    isModified: contents[path] !== FILES[path],
  }));
  const content = contents[activePath] ?? "";
  const plugins = PLUGINS_TESTED.filter((item) => item.name.toLowerCase().includes(pluginQuery.toLowerCase()));

  const openNote = (path: string) => {
    if (!FILES[path] && !contents[path]) {
      const byName = notes.find((note) => note.name.toLowerCase() === fileName(path).toLowerCase());
      if (!byName) return;
      path = byName.path;
    }
    setActivePath(path);
    setOpenTabs((current) => (current.includes(path) ? current : [...current, path]));
    setSurface("write");
  };

  const closeTab = (path: string) => {
    setOpenTabs((current) => {
      const next = current.filter((item) => item !== path);
      if (path === activePath) setActivePath(next[next.length - 1] ?? START);
      return next.length ? next : [START];
    });
  };

  useEffect(() => {
    void getAPI().setVaultPath(VAULT_PATH);
    resetAIGraphCache();
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 760) {
        setSidebar(false);
        setViewMode((mode) => (mode === "split" ? "editor" : mode));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const commands: SiteCommand[] = [
      { id: "view-write", label: "Open editor", category: "View", action: () => setSurface("write") },
      { id: "mode-source", label: "Source mode", category: "Editor", action: () => { setSurface("write"); setViewMode("editor"); } },
      { id: "mode-preview", label: "Preview mode", category: "Editor", action: () => { setSurface("write"); setViewMode("preview"); } },
      { id: "mode-live", label: "Split source + preview", category: "Editor", action: () => { setSurface("write"); setViewMode("split"); } },
      { id: "view-graph", label: "Open graph", category: "View", shortcut: "⌘G", action: () => setSurface("graph") },
      { id: "view-ai", label: "Open AI graph", category: "View", action: () => { setSurface("graph"); setGraphMode("ai"); } },
      { id: "view-ask", label: "Ask this vault", category: "View", action: () => setSurface("ask") },
      { id: "view-look", label: "Appearance", category: "View", action: () => setSurface("look") },
      { id: "view-plugins", label: "Plugin runtime", category: "View", action: () => setSurface("plugins") },
      { id: "toggle-side", label: "Toggle file tree", category: "View", action: () => setSidebar((value) => !value) },
      ...notes.map((note) => ({
        id: `note-${note.path}`,
        label: note.name,
        category: "Notes",
        action: () => openNote(note.path),
      })),
    ];
    setWorkspaceCommands(commands);
    return () => setWorkspaceCommands([]);
  }, [notes, setWorkspaceCommands]);



  const visibleTree = query.trim()
    ? notes.filter((note) => `${note.name} ${contents[note.path] ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    : null;

  useWorkspaceMotion({
    root: shellRef,
    surface,
    activePath,
    viewMode,
    sidebar,
  });

  return (
    <div
      ref={shellRef}
      className={`oo oo-real${theme === "light" ? " is-light" : ""}${wallpaper ? " is-wall" : ""}`}
      data-theme={theme}
    >
      <div className="oo-title">
        <div className="oo-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="oo-vault">OO-Test-Vault</div>
        <div className="oo-views" role="tablist" aria-label="Workspace views">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={surface === id} className={surface === id ? "is-on" : ""} onClick={() => setSurface(id)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="oo-k" onClick={openPalette}>
          {paletteHotkeyLabel()}
        </button>
      </div>

      <div className="oo-body">
        <nav className="oo-ribbon" aria-label="Ribbon">
          <button type="button" className={sidebar ? "is-on" : ""} onClick={() => setSidebar((value) => !value)} title="Files">
            <Icon>
              <path d="M4 7h16M4 12h16M4 17h10" />
            </Icon>
          </button>
          <button type="button" className={surface === "write" ? "is-on" : ""} onClick={() => setSurface("write")} title="Editor">
            <Icon>
              <path d="M7 3h8l4 4v14H7z" />
              <path d="M15 3v5h5M9 13h6M9 17h4" />
            </Icon>
          </button>
          <button type="button" className={surface === "graph" ? "is-on" : ""} onClick={() => setSurface(surface === "graph" ? "write" : "graph")} title="Graph">
            <Icon>
              <circle cx="6.5" cy="7" r="2.2" />
              <circle cx="17.5" cy="7" r="2.2" />
              <circle cx="12" cy="17" r="2.2" />
              <path d="M8.4 8.2 15.6 8.2M7.6 9.1 10.6 15M16.4 9.1 13.4 15" />
            </Icon>
          </button>
          <button type="button" className={surface === "ask" ? "is-on" : ""} onClick={() => setSurface("ask")} title="Spaces">
            <Icon>
              <path d="M12 3.5l2.2 4.5 5 .7-3.6 3.5.9 4.9L12 14.8 7.5 17.1l.9-4.9L4.8 8.7l5-.7z" />
            </Icon>
          </button>
        </nav>

        {sidebar && surface !== "ask" && (
          <aside className="oo-side">
            <div className="oo-search">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes…" aria-label="Search notes" />
            </div>
            <div className="oo-tree">
              {visibleTree ? (
                <ul>
                  {visibleTree.map((note) => (
                    <li key={note.path}>
                      <button type="button" className={note.path === activePath ? "is-on" : ""} onClick={() => openNote(note.path)}>
                        {note.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                fileTree.map((node) => (
                  <Tree key={node.path} node={node} activePath={activePath} onOpen={openNote} />
                ))
              )}
            </div>
          </aside>
        )}

        <section className="oo-main">
          {surface === "write" && (
            <>
              <div className="oo-tabs">
                {tabs.map((tab) => (
                  <div key={tab.id} className={`oo-tab${tab.id === activePath ? " is-on" : ""}`}>
                    <button type="button" onClick={() => setActivePath(tab.path)}>
                      {tab.name}
                    </button>
                    <button type="button" className="oo-tab-x" onClick={() => closeTab(tab.path)} aria-label={`Close ${tab.name}`}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="oo-modes" role="tablist" aria-label="Editor mode">
                {([
                  ["editor", "source"],
                  ["preview", "preview"],
                  ["split", "split"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={viewMode === mode}
                    className={viewMode === mode ? "is-on" : ""}
                    onClick={() => setViewMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="oo-real-editor">
                <div className="oo-editor-veil" aria-hidden />
                <Editor
                  tabs={tabs}
                  activeTabId={activePath}
                  content={content}
                  viewMode={viewMode}
                  availableNotes={notes}
                  onAdjustFontSize={() => undefined}
                  onTabSelect={(id) => setActivePath(id)}
                  onTabClose={closeTab}
                  onContentChange={(next, _user, path) => {
                    const target = path || activePath;
                    setContents((current) => ({ ...current, [target]: next }));
                    void getAPI().writeFile(target, next);
                  }}
                  onViewModeChange={setViewMode}
                  onLinkClick={(name) => openNote(name)}
                  onGetNoteContent={(name) => {
                    const found = notes.find((note) => note.name.toLowerCase() === name.toLowerCase());
                    return found ? contents[found.path] ?? FILES[found.path] ?? null : null;
                  }}
                  onOpenNote={openNote}
                  theme={theme}
                  settings={settings}
                />
              </div>
            </>
          )}

          {surface === "graph" && (
            <div className="oo-real-graph">
              <div className="graph-mode-switch" role="tablist" aria-label="Graph mode">
                <button
                  type="button"
                  className={`graph-mode-btn${graphMode !== "ai" ? " active" : ""}`}
                  onClick={() => setGraphMode("manual")}
                >
                  Manual
                </button>
                <button
                  type="button"
                  className={`graph-mode-btn${graphMode === "ai" ? " active" : ""}`}
                  onClick={() => {
                    resetAIGraphCache();
                    setGraphMode("ai");
                  }}
                >
                  AI View
                </button>
              </div>
              <div className="oo-graph-live">
                {graphMode === "ai" ? (
                  <AIKnowledgeGraph
                    onNodeClick={(_name, _heading, path) => path && openNote(path)}
                    onClose={() => setSurface("write")}
                    theme={theme}
                    vaultPath={VAULT_PATH}
                    fileTree={fileTree}
                    localNodePath={activePath}
                  />
                ) : (
                  <GraphView
                    onNodeClick={(_name, _heading, path) => path && openNote(path)}
                    onClose={() => setSurface("write")}
                    theme={theme}
                    vaultPath={VAULT_PATH}
                    localNodePath={activePath}
                  />
                )}
              </div>
            </div>
          )}

          {surface === "ask" && (
            <div className="oo-real-spaces">
              <SiteSpaces onOpenNote={openNote} />
            </div>
          )}

          {surface === "look" && (
            <div className="oo-look">
              <p className="oo-ask-kicker">appearance · live on this window</p>
              <h2>Quiet chrome. Your theme.</h2>
              <p>Dark and light apply on this page. The desktop app also has oceanic, custom themes, and a vault wallpaper.</p>
              <div className="oo-skins">
                <button type="button" className={theme === "dark" ? "is-on" : ""} onClick={() => setTheme("dark")}>
                  dark
                </button>
                <button type="button" className={theme === "light" ? "is-on" : ""} onClick={() => setTheme("light")}>
                  light
                </button>
                <button type="button" className={wallpaper ? "is-on" : ""} onClick={() => setWallpaper((value) => !value)}>
                  wallpaper
                </button>
              </div>
            </div>
          )}

          {surface === "plugins" && (
            <div className="oo-plugins">
              <p className="oo-ask-kicker">runtime · obsidian@1.13.1 · 158/158 exports</p>
              <h2>Community plugins, contained.</h2>
              <p>These are the community bundles the desktop test suite loads against the compatibility layer.</p>
              <input className="oo-plugin-search" value={pluginQuery} onChange={(event) => setPluginQuery(event.target.value)} placeholder="Filter plugins…" aria-label="Filter plugins" />
              <ul className="oo-plugin-list">
                {plugins.map((item) => (
                  <li key={item.name}>
                    <b>{item.name}</b>
                    <span>{item.version}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <footer className="oo-status">
        <span>
          {surface === "graph"
            ? `${graphMode === "ai" ? "AI graph" : "graph"} · ${notes.length} notes`
            : surface === "ask"
              ? "spaces · real index"
              : `${activePath.replace(/\.md$/, "")}`}
        </span>
        <span>
          {surface === "write" ? `${viewMode} · ${content.split(/\s+/).filter(Boolean).length} words · live editor` : "OO-Test-Vault"}
        </span>
      </footer>
    </div>
  );
}

function Tree({
  node,
  activePath,
  onOpen,
}: {
  node: FileEntry;
  activePath: string;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!node.isDirectory) {
    return (
      <button type="button" className={`tree-file${node.path === activePath ? " is-on" : ""}`} onClick={() => onOpen(node.path)}>
        {fileName(node.path)}
      </button>
    );
  }
  return (
    <div className="tree-folder">
      <button type="button" className="tree-dir" onClick={() => setOpen((value) => !value)}>
        <span className={`chev${open ? " is-open" : ""}`} />
        {node.name}
      </button>
      {open && node.children?.map((child) => <Tree key={child.path} node={child} activePath={activePath} onOpen={onOpen} />)}
    </div>
  );
}
