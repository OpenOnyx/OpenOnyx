/** Product facts taken from the OpenOnyx repository (package.json, README, docs). */

export const PRODUCT = {
  name: "OpenOnyx",
  version: "1.0.4",
  license: "Apache-2.0",
  tagline: "A local-first knowledge workspace with built-in AI, an open desktop, and files you keep.",
  oneLiner:
    "Write in Markdown. Keep the files. Explore them as a graph. Ask them questions — no plugin shopping list required.",
  description:
    "OpenOnyx is a local-first knowledge workspace with built-in Spaces, an AI graph, and an Apache-2.0 desktop. Your notes stay as Markdown. No account required.",
  repo: "https://github.com/OpenOnyx/OpenOnyx",
  releases: "https://github.com/OpenOnyx/OpenOnyx/releases",
  latestRelease: "https://github.com/OpenOnyx/OpenOnyx/releases/tag/v1.0.4",
  issues: "https://github.com/OpenOnyx/OpenOnyx/issues",
  stack: [
    "Electron 41",
    "React 19",
    "TypeScript 5.8",
    "CodeMirror",
    "D3",
    "Tailwind CSS",
    "Transformers.js",
    "IndexedDB",
    "Supabase (optional)",
  ],
  engines: "Node.js 22 or newer",
  vitePort: 5173,
  noTelemetry: true,
} as const;

export const PRINCIPLES = [
  {
    title: "Local-first by default",
    body: "Notes are normal files in normal folders. Core workflows work offline.",
  },
  {
    title: "Markdown-native",
    body: "Your writing stays portable, readable, and tool-friendly.",
  },
  {
    title: "AI where it helps",
    body: "Retrieval, suggestions, summaries, and inline writing tools are grounded in your vault.",
  },
  {
    title: "Cloud when you choose",
    body: "Supabase-backed Spaces sync and public Spaces are optional. Live multiplayer editing is in the app but currently under maintenance.",
  },
  {
    title: "Plugin-aware",
    body: "OpenOnyx targets Obsidian plugin compatibility through a tested runtime layer.",
  },
] as const;

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Ctrl/Cmd+N", action: "Create note" },
  { keys: "Ctrl/Cmd+S", action: "Save current note" },
  { keys: "Ctrl/Cmd+F", action: "Search inside current note" },
  { keys: "Ctrl/Cmd+Shift+F", action: "Search vault" },
  { keys: "Ctrl/Cmd+O", action: "Quick switcher (notes in the open vault)" },
  { keys: "Ctrl/Cmd+P", action: "Command palette" },
  { keys: "Ctrl/Cmd+G", action: "Open graph" },
  { keys: "Ctrl/Cmd+Shift+C", action: "New canvas" },
  { keys: "Ctrl/Cmd+B", action: "Toggle sidebar" },
  { keys: "Ctrl+Tab", action: "Next tab" },
  { keys: "Ctrl+Shift+Tab", action: "Previous tab" },
  { keys: "Ctrl/Cmd+W", action: "Close active tab" },
  { keys: "Escape", action: "Close modal or transient panel" },
];

export const PLUGINS_TESTED: Array<{ name: string; version: string }> = [
  { name: "Dataview", version: "0.5.70" },
  { name: "Templater", version: "2.22.1" },
  { name: "Tasks", version: "8.1.0" },
  { name: "Calendar", version: "2.0.0-beta.2" },
  { name: "Kanban", version: "2.0.51" },
  { name: "Style Settings", version: "1.0.9" },
  { name: "Advanced Tables", version: "0.23.2" },
  { name: "QuickAdd", version: "2.12.3" },
  { name: "Obsidian Git", version: "2.38.3" },
  { name: "Excalidraw", version: "2.23.12" },
  { name: "Better Export PDF", version: "1.11.0" },
  { name: "Enhancing Export", version: "1.11.1" },
  { name: "Reading Time", version: "1.1.2" },
];

/** Product delta. Lead with shipped OpenOnyx wins. Do not invent features. */
export const VERSUS_OBSIDIAN: Array<{ item: string; us: string; them: string; win?: boolean }> = [
  {
    item: "Ask the vault",
    us: "Built-in Spaces. Local all-MiniLM-L6-v2 embeddings, RAG chat, citations back to notes.",
    them: "Not built in",
    win: true,
  },
  {
    item: "AI graph",
    us: "Built-in semantic graph — suggested links, bridges, idea islands, clusters.",
    them: "Community plugins",
    win: true,
  },
  {
    item: "AI writing",
    us: "Inline rewrite, expand, simplify, plus vault-grounded answers. Local path needs no key.",
    them: "Community plugins or paid add-ons",
    win: true,
  },
  {
    item: "License",
    us: "Apache-2.0. Read it, fork it, ship it.",
    them: "Closed source (free for personal use)",
    win: true,
  },
  {
    item: "Analytics",
    us: "No product telemetry",
    them: "Proprietary product",
    win: true,
  },
  {
    item: "Cloud",
    us: "Optional. Your Supabase project — you hold the keys.",
    them: "Paid first-party Sync and Publish",
    win: true,
  },
  {
    item: "Themes",
    us: "Dark, light, oceanic, custom themes, plus vault wallpaper with blur and opacity.",
    them: "Themes and community CSS",
    win: true,
  },
  {
    item: "Your notes",
    us: "Plain .md and .canvas on disk. Open the same folder you already have.",
    them: "Same",
  },
  {
    item: "Editor",
    us: "Source, live preview, split, Vim, KaTeX, wiki links, backlinks, WYSIWYG tables.",
    them: "Mature core editor",
  },
  {
    item: "Graph + canvas",
    us: "Interactive graph and portable .canvas boards, next to the notes.",
    them: "Built in",
  },
  {
    item: "Plugins",
    us: "Obsidian-compatible runtime — obsidian@1.13.1, 158/158 exports, permission prompts, crash isolation.",
    them: "Native API and a larger catalog",
  },
  {
    item: "Mobile",
    us: "Desktop today (macOS, Windows, Linux). Phone is in progress.",
    them: "iOS and Android apps",
  },
];

export const STORY = [
  {
    id: "write",
    kicker: "01 · editor",
    title: "Source, preview, split.",
    body: "The same CodeMirror workspace as the desktop app. Wiki links, tables, and live preview — your files, not a database.",
    points: ["Source and live preview", "Wiki links and backlinks", "Split panes"],
    image: "/images/markdown-workspace.png",
    clip: "/videos/write-demo.mp4",
    alt: "OpenOnyx Markdown workspace with split editors",
  },
  {
    id: "graph",
    kicker: "02 · graph",
    title: "The vault as a constellation.",
    body: "Wiki links become a living graph. Search, focus, filter, and pin layout. Dense clusters and lonely notes stop hiding in the folder tree.",
    points: ["D3 physics in a worker", "Canvas2D renderer", "Theme-aware"],
    image: "/images/knowledge-graph.png",
    clip: "/videos/graph-demo.mp4",
    alt: "OpenOnyx knowledge graph of a real vault",
  },
  {
    id: "ai",
    kicker: "03 · local ai",
    title: "A thinking layer that stays on the machine.",
    body: "The AI graph uses local embeddings to suggest links, bridges, and idea islands. Inline writing tools and Spaces answers cite the notes they used. No account required for the local path.",
    points: ["all-MiniLM-L6-v2 on device", "Suggested links and bridges", "Citations back to files"],
    image: "/images/ai-knowledge-graph.png",
    clip: "/videos/ai-demo.mp4",
    alt: "OpenOnyx AI knowledge graph, AI View of a vault",
  },
  {
    id: "canvas",
    kicker: "04 · canvas",
    title: "Maps that are still files.",
    body: "Obsidian-style .canvas documents live beside the Markdown. Nodes, edges, embeds — portable if you leave.",
    points: ["Portable .canvas", "Note embeds", "Same folder as the notes"],
    image: "/images/canvas-workspace.png",
    clip: "/videos/canvas-demo.mp4",
    alt: "OpenOnyx canvas board of a vault atlas",
  },
  {
    id: "spaces",
    kicker: "05 · spaces",
    title: "Ask the folder. Keep the folder.",
    body: "A Space indexes the vault, chunks notes, and answers with sources. Local Spaces sit in IndexedDB. Cloud Spaces are optional and yours.",
    points: ["Local or optional cloud", "RAG with citations", "Remix and fork public Spaces"],
    image: "/images/spaces-dashboard.png",
    clip: "/videos/spaces-demo.mp4",
    alt: "OpenOnyx Spaces chat over an indexed vault",
  },
  {
    id: "sync",
    kicker: "06 · cloud when you choose",
    title: "Sync is a switch. Phone is next.",
    body: "Writing never needs a server. Optional Spaces sync uses your own Supabase project. Live multiplayer editing is in the app, but the collaboration panel currently shows a maintenance notice. A phone client is in progress — same Markdown, same vault.",
    points: ["Offline by default", "Optional Supabase", "Live collab under maintenance"],
    image: "/images/Collaboration-settings.png",
    clip: "/videos/look-demo.mp4",
    alt: "OpenOnyx collaboration settings with the current maintenance notice",
  },
] as const;

export const DOWNLOADS = {
  macNote:
    'If macOS says the app is from an unidentified developer or is "damaged", right-click OpenOnyx.app and choose Open, or run: xattr -cr /Applications/OpenOnyx.app',
  windowsNote:
    "Download the .exe installer from Releases. Free code signing is provided by SignPath.io; the certificate is issued by SignPath Foundation.",
  linuxNote:
    "Download .AppImage, .deb, or Arch .pkg.tar.zst from Releases, or run the official installer script.",
  linuxInstall: "curl -fsSL https://raw.githubusercontent.com/OpenOnyx/OpenOnyx/main/scripts/install.sh | bash",
} as const;

export const FEATURES = [
  {
    id: "write",
    kicker: "01",
    title: "Markdown workspace",
    body: "CodeMirror editor with live preview, source mode, split panes, tab groups, backlinks, tags, outline, properties, and wiki links. Tables edit as tables, not pipe syntax.",
    points: ["Wiki links", "KaTeX math", "Vim mode", "WYSIWYG tables", "Sanitized preview"],
    href: "/docs/write",
  },
  {
    id: "find",
    kicker: "02",
    title: "Search and navigation",
    body: "Quick switcher, fuzzy vault search, in-note find and replace, bookmarks, daily notes, and a file explorer that treats folders as the source of truth.",
    points: ["Vault search", "Quick switcher", "Daily notes", "Bookmarks"],
    href: "/docs/find",
  },
  {
    id: "graph",
    kicker: "03",
    title: "Knowledge graph",
    body: "An interactive graph of the vault. Dense clusters, isolated notes, and hubs become visible. D3 physics in a worker, drawn with Canvas2D.",
    points: ["Search and focus", "Persistent layout", "Theme-aware"],
    href: "/docs/graph",
  },
  {
    id: "ai-graph",
    kicker: "04",
    title: "AI knowledge graph",
    body: "Semantic similarity on top of manual links. Suggested connections, bridge notes, idea islands, clusters, and directional reading flows — on device.",
    points: ["Local embeddings", "Suggested links", "Bridges and islands"],
    href: "/docs/graph",
  },
  {
    id: "canvas",
    kicker: "05",
    title: "Canvas",
    body: "Obsidian-style .canvas files live beside your notes. Nodes, edges, embedded Markdown, duplicate and save-as.",
    points: ["Portable .canvas", "Note embeds", "Recent boards"],
    href: "/docs/canvas",
  },
  {
    id: "spaces",
    kicker: "06",
    title: "Spaces",
    body: "Index the vault, embed locally with all-MiniLM-L6-v2, and ask questions with citations. Local in IndexedDB. Cloud Spaces are optional and yours.",
    points: ["Local RAG", "Citations", "Remix public Spaces"],
    href: "/docs/spaces",
  },
  {
    id: "ai-write",
    kicker: "07",
    title: "AI writing",
    body: "Optional OpenAI or OpenRouter keys unlock inline rewrite, expand, and simplify. Spaces answers stay grounded in the notes they used.",
    points: ["Inline actions", "Vault-grounded answers", "Local embeddings need no key"],
    href: "/docs/spaces",
  },
  {
    id: "plugins",
    kicker: "08",
    title: "Plugin runtime",
    body: "Obsidian-compatible API, marketplace, and permission prompts. Compatibility is tested against real community plugin bundles.",
    points: ["158/158 public API", "Crash isolation", "Tested bundles"],
    href: "/docs/plugins",
  },
  {
    id: "themes",
    kicker: "09",
    title: "Themes and wallpaper",
    body: "Dark, light, oceanic, and custom themes across editor, graph, and settings. Upload a wallpaper and tune blur and opacity so type stays readable.",
    points: ["Built-in themes", "Custom wallpaper", "Translucent panels"],
    href: "/docs/themes",
  },
  {
    id: "privacy",
    kicker: "10",
    title: "Local-first privacy",
    body: "Core editing, search, graph, local embeddings, and local Spaces work offline. No product telemetry. The renderer is context-isolated.",
    points: ["Offline by default", "No telemetry", "IPC filesystem bridge"],
    href: "/docs/privacy",
  },
  {
    id: "sync",
    kicker: "11",
    title: "Optional cloud",
    body: "Bring your own Supabase project for Spaces sync. Offline queue, last-write-wins, conflict copies. Live multiplayer is in the app but currently under maintenance.",
    points: ["Your project", "Offline queue", "No required account"],
    href: "/docs/sync",
  },
  {
    id: "export",
    kicker: "12",
    title: "Export tooling",
    body: "Managed Pandoc 3.10 WASM backend for export plugins, plus Node and Electron shims so desktop plugin workflows keep working.",
    points: ["Pandoc backend", "Plugin shims", "Canvas compat tests"],
    href: "/docs/plugins",
  },
] as const;
