import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CompareTable } from "../components/CompareTable";
import { FEATURES, PLUGINS_TESTED, PRODUCT, SHORTCUTS } from "./facts";

export type DocPage = {
  slug: string;
  title: string;
  group: string;
  summary: string;
  body: ReactNode;
};

export const DOC_PAGES: DocPage[] = [
  {
    slug: "start",
    title: "Start here",
    group: "Get going",
    summary:
      "OpenOnyx is a local-first knowledge workspace with built-in Spaces, an AI graph, and an Apache-2.0 desktop. Files stay files.",
    body: (
      <>
        <p>
          OpenOnyx is a desktop knowledge app with the thinking layer already in the box. You point it at a
          folder — a vault — and write Markdown files there. The editor, graph, search, Spaces, and AI graph
          all read those files. Nothing important lives only inside the app database.
        </p>
        <div className="callout">
          You do not need an account, a cloud project, or an API key to write, search, open the graph, or ask a
          local Space. Those extras stay optional.
        </div>
        <h2>First ten minutes</h2>
        <ol>
          <li>
            Install from <a href={PRODUCT.latestRelease}>v{PRODUCT.version} Releases</a>.
          </li>
          <li>Open a folder — a new vault, or the one you already use in Obsidian.</li>
          <li>
            Write a note. Link it with <code>[[Another note]]</code>.
          </li>
          <li>
            <code>Ctrl/Cmd+G</code> opens the graph. <code>Ctrl/Cmd+P</code> opens the command palette.
          </li>
        </ol>
        <h2>What stays on disk</h2>
        <p>
          Notes are <code>.md</code> files. Canvases are <code>.canvas</code> files. App cache lives in{" "}
          <code>.openonyx</code> inside the vault. You can open the same folder in any other editor.
        </p>
        <h2>What ships in the desktop</h2>
        <p>
          Spaces, the AI graph, inline writing tools, an Obsidian-compatible plugin runtime, themes, wallpaper,
          and optional cloud — not a catalog you assemble after install. The full list is on{" "}
          <Link to="/docs/features">What's included</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "features",
    title: "What's included",
    group: "Get going",
    summary:
      "Every surface that ships in OpenOnyx: editor, search, graph, AI graph, canvas, Spaces, writing tools, plugins, themes, privacy, optional cloud, and export.",
    body: (
      <>
        <p>
          OpenOnyx is the workspace plus the thinking layer. These are the features in the desktop app today —
          not a wishlist, and not a plugin you have to hunt down first.
        </p>
        {FEATURES.map((item) => (
          <section key={item.id}>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <ul>
              {item.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ))}
        <div className="callout">
          Coming from Obsidian? Open the same folder. Then use Spaces and the AI graph — those are the layers
          they do not ship. See <Link to="/docs/obsidian">Coming from Obsidian</Link>.
        </div>
      </>
    ),
  },
  {
    slug: "install",
    title: "Install",
    group: "Get going",
    summary: "macOS, Windows, Linux, and building from source.",
    body: (
      <>
        <p>
          Official binaries are attached to{" "}
          <a href={PRODUCT.releases}>GitHub Releases</a>. Current tagged version is {PRODUCT.version}.
        </p>
        <h2>macOS</h2>
        <p>
          Download the <code>.dmg</code> or <code>.zip</code> from the release and move the app to Applications.
        </p>
        <div className="callout">
          If Gatekeeper says the app is from an unidentified developer or is damaged, right-click OpenOnyx.app →
          Open, or run <code>xattr -cr /Applications/OpenOnyx.app</code>.
        </div>
        <h2>Windows</h2>
        <p>
          Download the <code>.exe</code> installer. Signing is provided by SignPath.io with a certificate from
          SignPath Foundation.
        </p>
        <h2>Linux</h2>
        <p>
          Use <code>.AppImage</code>, <code>.deb</code>, or Arch <code>.pkg.tar.zst</code> from the current
          release, or:
        </p>
        <pre>curl -fsSL https://raw.githubusercontent.com/OpenOnyx/OpenOnyx/main/scripts/install.sh | bash</pre>
        <h2>From source</h2>
        <p>Requires Node.js 22 or newer (see package.json engines).</p>
        <pre>{`git clone https://github.com/OpenOnyx/OpenOnyx.git
cd OpenOnyx
npm install
npm run dev`}</pre>
        <p>
          That compiles the Electron main process, starts Vite on port {PRODUCT.vitePort}, and launches the
          desktop window against it.
        </p>
      </>
    ),
  },
  {
    slug: "vault",
    title: "Open a vault",
    group: "Get going",
    summary: "A vault is a folder. Treat it like one.",
    body: (
      <>
        <p>
          A vault is any folder you choose. OpenOnyx remembers recently opened vaults so you can switch without
          hunting through the disk.
        </p>
        <h2>Create or open</h2>
        <ul>
          <li>The welcome flow can create a new vault folder or open an existing one.</li>
          <li>
            After a vault is open, <code>File → Open Vault</code> switches folders.{" "}
            <code>Ctrl/Cmd+O</code> in the window is the note quick switcher.
          </li>
          <li>You can keep more than one vault — research, work, personal — and switch between them.</li>
        </ul>
        <h2>Suggested layout</h2>
        <p>
          The bundled test vault uses numbered PARA-style folders: <code>00 - Inbox</code>,{" "}
          <code>01 - Projects</code>, <code>02 - Areas</code>, <code>03 - Resources</code>,{" "}
          <code>04 - Archive</code>, daily notes, and templates. You do not have to use that layout. Ordinary
          folders are the source of truth.
        </p>
      </>
    ),
  },
  {
    slug: "obsidian",
    title: "Coming from Obsidian",
    group: "Get going",
    summary:
      "Open the same folder. Keep wiki links, graph, and canvas — then add built-in Spaces, an AI graph, and an Apache-2.0 desktop.",
    body: (
      <>
        <p>
          A vault is a folder of Markdown. Point OpenOnyx at the folder you already use. Notes, wiki links, tags,
          and <code>.canvas</code> files stay on disk. Then you get a thinking layer they do not ship.
        </p>
        <h2>Why people switch</h2>
        <ul>
          <li>
            <b>Spaces</b> — ask the vault with local embeddings and citations. No extra plugin.
          </li>
          <li>
            <b>AI graph</b> — suggested links, bridges, and idea islands from on-device embeddings.
          </li>
          <li>
            <b>AI writing</b> — inline rewrite, expand, and simplify, plus answers grounded in your notes.
          </li>
          <li>
            <b>Your cloud, or none</b> — optional Supabase that you own. No required account, no product
            telemetry.
          </li>
          <li>
            <b>Apache-2.0</b> — the desktop is open. Read it, fork it, ship it.
          </li>
        </ul>
        <h2>OpenOnyx vs Obsidian</h2>
        <CompareTable />
        <h2>What transfers</h2>
        <ul>
          <li>Write, graph, canvas, and daily notes work on the files you already have.</li>
          <li>
            Community plugins go through the Obsidian-compatible runtime. Compatibility is tested against real
            bundles; it is not a promise that every plugin is perfect.
          </li>
          <li>Spaces and the AI graph read the vault. They do not rewrite it.</li>
          <li>There is no mobile app yet. The desktop build is Electron for macOS, Windows, and Linux.</li>
        </ul>
        <h2>First session</h2>
        <ol>
          <li>Install from Releases, then Open vault → pick your existing folder.</li>
          <li>
            Press <code>Ctrl/Cmd+P</code> for the command palette, <code>Ctrl/Cmd+G</code> for the graph.
          </li>
          <li>Open Spaces and ask a question over the notes you already wrote.</li>
        </ol>
        <div className="callout">
          You can keep using Obsidian on the same folder. The files do not belong to either app.
        </div>
      </>
    ),
  },
  {
    slug: "write",
    title: "Write notes",
    group: "Daily use",
    summary: "CodeMirror workspace with source, preview, split, wiki links, Vim, KaTeX, and WYSIWYG tables.",
    body: (
      <>
        <p>
          Writing happens in a CodeMirror editor. You can stay in source, use live preview, or split the pane.
          Rendering is sanitized.
        </p>
        <h2>Wiki links</h2>
        <p>
          Link with <code>[[Note name]]</code>. Aliases and headings work: <code>[[Note|label]]</code>,{" "}
          <code>[[Note#Heading]]</code>. Backlinks, outgoing links, and unlinked mentions show up in the right
          sidebar.
        </p>
        <h2>More of the editor</h2>
        <ul>
          <li>KaTeX for math</li>
          <li>Tags, outline, and properties panels</li>
          <li>Vim mode, including editor commands for common workflows</li>
          <li>WYSIWYG tables — insert rows and columns without editing pipe syntax</li>
          <li>Tab groups, split panes, and recent files</li>
          <li>
            In-editor formatting: <code>Ctrl/Cmd+B</code> bold, <code>Ctrl/Cmd+I</code> italic,{" "}
            <code>Ctrl/Cmd+E</code> or <code>Ctrl/Cmd+`</code> inline code,{" "}
            <code>Ctrl/Cmd+Shift+X</code> strikethrough
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "find",
    title: "Find anything",
    group: "Daily use",
    summary: "Fuzzy vault search, quick switcher, command palette, bookmarks, and daily notes — built in.",
    body: (
      <>
        <p>Large vaults stay usable if you search first and browse second.</p>
        <ul>
          <li>
            <code>Ctrl/Cmd+Shift+F</code> — fuzzy search across the vault
          </li>
          <li>
            <code>Ctrl/Cmd+F</code> — search (and replace) inside the current note
          </li>
          <li>
            <code>Ctrl/Cmd+P</code> — command palette
          </li>
          <li>
            <code>Ctrl/Cmd+O</code> — quick switcher
          </li>
        </ul>
        <p>
          Bookmarks, daily notes, and the file explorer (with context menus for notes, folders, assets, and
          canvases) cover the rest. Global shortcuts are listed under Keyboard.
        </p>
      </>
    ),
  },
  {
    slug: "graph",
    title: "Graph",
    group: "Daily use",
    summary: "Interactive graph plus a built-in AI view: suggested links, bridges, and idea islands.",
    body: (
      <>
        <p>
          Open the graph with <code>Ctrl/Cmd+G</code>. Manual view uses your wiki links. AI view adds semantic
          similarity from local embeddings — suggested links, bridges between clusters, and isolated idea
          islands.
        </p>
        <h2>What you can do there</h2>
        <ul>
          <li>Search, focus, filter, and center a node</li>
          <li>Tune physics and display</li>
          <li>Keep a persistent layout in local storage</li>
          <li>D3 force layout in a worker, drawn with Canvas2D</li>
        </ul>
        <p>
          The homepage animation is not a mock: it is laid out from real notes and <code>[[wiki links]]</code>{" "}
          in <code>OO-Test-Vault</code>.
        </p>
      </>
    ),
  },
  {
    slug: "canvas",
    title: "Canvas",
    group: "Daily use",
    summary: "Portable .canvas boards next to your notes — nodes, embeds, duplicate and save-as.",
    body: (
      <>
        <p>
          Canvas files use the Obsidian <code>.canvas</code> format and live in the vault.{" "}
          <code>Ctrl/Cmd+Shift+C</code> creates a new board. Open an existing <code>.canvas</code> file from
          the explorer.
        </p>
        <ul>
          <li>Nodes, edges, and a toolbar</li>
          <li>Embed Markdown notes on the board</li>
          <li>Duplicate and save-as</li>
          <li>Recent canvas tracking</li>
        </ul>
      </>
    ),
  },
  {
    slug: "spaces",
    title: "Spaces and AI",
    group: "Thinking layer",
    summary: "Built-in RAG: local embeddings, cited answers, and optional inline rewrite — no extra plugin.",
    body: (
      <>
        <p>
          A Space is a queryable layer over your notes. OpenOnyx scans <code>.md</code> and <code>.canvas</code>{" "}
          files, chunks text, and embeds the chunks in the browser with <code>@xenova/transformers</code> and
          the <code>all-MiniLM-L6-v2</code> model (384 dimensions). No embedding API key is required.
        </p>
        <h2>Visibility</h2>
        <ul>
          <li>
            <b>Local</b> — IndexedDB only. Indexing and retrieval stay on the device.
          </li>
          <li>
            <b>Private</b> — backed up to your Supabase project. Designed around client-side encryption and key
            wrapping.
          </li>
          <li>
            <b>Public</b> — published for discovery, upvotes, and remix/fork.
          </li>
        </ul>
        <h2>Asking a question</h2>
        <p>
          Your prompt is embedded locally. OpenOnyx retrieves the closest chunks (IndexedDB cosine search, or{" "}
          <code>match_note_chunks</code> on Supabase for remote spaces), then sends that context to the LLM you
          configured. Answers are meant to cite the notes they came from.
        </p>
        <h2>Inline writing</h2>
        <p>
          Optional OpenAI or OpenRouter keys in settings unlock inline rewrite/expand/simplify actions. Local
          embeddings still do not need those keys.
        </p>
      </>
    ),
  },
  {
    slug: "plugins",
    title: "Plugins",
    group: "Thinking layer",
    summary: "Obsidian-compatible runtime (158/158 exports), marketplace, permission prompts, crash isolation.",
    body: (
      <>
        <p>
          OpenOnyx implements the public Obsidian plugin API against <code>obsidian@1.13.1</code>. A runtime
          export audit checks 158 of 158 official exports. Community plugins load through a marketplace UI with
          permission prompts and crash isolation.
        </p>
        <h2>Bundles exercised in CI-style tests</h2>
        <table>
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {PLUGINS_TESTED.map((plugin) => (
              <tr key={plugin.name}>
                <td>{plugin.name}</td>
                <td>{plugin.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Plugins that depend on undocumented Obsidian internals can still need adapters. Compatibility is
          against the public API, not every private hook.
        </p>
      </>
    ),
  },
  {
    slug: "themes",
    title: "Themes and wallpaper",
    group: "Thinking layer",
    summary: "Dark, light, oceanic, custom themes, and a vault wallpaper with blur and opacity.",
    body: (
      <>
        <p>
          The chrome is built for long sessions: quiet surfaces, Inter, restrained contrast. Themes apply across
          editor, graph, settings, and plugin views.
        </p>
        <ul>
          <li>Dark, light, oceanic, and custom themes</li>
          <li>Upload a wallpaper image</li>
          <li>Blur and opacity controls so type stays readable</li>
          <li>Translucent editor and sidebar panels</li>
        </ul>
      </>
    ),
  },
  {
    slug: "sync",
    title: "Sync and collaboration",
    group: "Optional cloud",
    summary: "Optional Supabase sync. Live multiplayer is in the app but currently under maintenance.",
    body: (
      <>
        <p>
          Cloud features use your own Supabase project. Enable the <code>vector</code> extension, run{" "}
          <code>supabase/schema.sql</code>, and paste the project URL plus anon key into settings (or{" "}
          <code>.env.local</code>).
        </p>
        <div className="callout">
          The collaboration panel currently shows a maintenance notice: real-time multiplayer editing has
          known issues and is being fixed. Do not treat live co-editing as ready. Offline Spaces sync is still
          in the tree.
        </div>
        <h2>How sync behaves</h2>
        <ul>
          <li>Mutations go through a durable IndexedDB queue and are retried when you are back online.</li>
          <li>Successive edits to the same note collapse; a later delete drops pending writes.</li>
          <li>Local-only Spaces never upload.</li>
          <li>
            If a push is rejected, the local edit is kept as <code>Note (conflict).md</code> instead of being
            dropped.
          </li>
          <li>
            Notes with an active Yjs document are designed to merge peer-to-peer instead of last-write-wins
            pull. That path is the one currently under maintenance.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "privacy",
    title: "Privacy",
    group: "Optional cloud",
    summary: "Offline by default. No product telemetry. Cloud and remote LLMs only if you turn them on.",
    body: (
      <>
        <ul>
          <li>Core editing, search, graph, local embeddings, and local Spaces work offline.</li>
          <li>Notes are files in the vault you chose.</li>
          <li>Indexes, embeddings, and caches stay on device unless you enable cloud-backed features.</li>
          <li>The renderer is context-isolated; filesystem access goes through a preload IPC bridge.</li>
          <li>Supabase is optional. Remote LLMs receive only the prompt and retrieved context you asked for.</li>
          <li>The project does not include product analytics or telemetry.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "shortcuts",
    title: "Keyboard",
    group: "Reference",
    summary: "The shortcuts wired in the app today.",
    body: (
      <>
        <p>
          These are the shortcuts wired in the desktop renderer today. The website command palette uses{" "}
          <code>Ctrl/Cmd+K</code>; the app palette is <code>Ctrl/Cmd+P</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Shortcut</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((row) => (
              <tr key={row.keys}>
                <td>
                  <span className="kbd">{row.keys}</span>
                </td>
                <td>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: "develop",
    title: "Develop",
    group: "Reference",
    summary: "Commands, architecture, and how the processes talk.",
    body: (
      <>
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>npm run dev</code>
              </td>
              <td>Build Electron, start Vite, launch the app</td>
            </tr>
            <tr>
              <td>
                <code>npm run lint</code>
              </td>
              <td>
                <code>tsc --noEmit</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>npm run build</code>
              </td>
              <td>Type-check, build renderer, build Electron</td>
            </tr>
            <tr>
              <td>
                <code>npm run package</code>
              </td>
              <td>Write installers to release/</td>
            </tr>
            <tr>
              <td>
                <code>npm run test:all-checks</code>
              </td>
              <td>Full local verification, including fixtures</td>
            </tr>
          </tbody>
        </table>
        <h2>Process boundary</h2>
        <pre>{`Renderer  (React, CodeMirror, D3, Spaces, plugins)
    → window.electronAPI
Preload  (contextBridge)
    → ipcMain
Main     (windows, vault filesystem, search, dialogs)
    → Local vault (Markdown, canvas, assets, .openonyx)`}</pre>
        <p>
          Stack as listed in the README: Electron, React, TypeScript, CodeMirror, D3, Tailwind CSS,
          Transformers.js, IndexedDB, and optional Supabase.
        </p>
      </>
    ),
  },
];

export const DOC_GROUPS = [...new Set(DOC_PAGES.map((page) => page.group))];

export function docBySlug(slug: string) {
  return DOC_PAGES.find((page) => page.slug === slug) ?? DOC_PAGES[0];
}

export function neighbors(slug: string) {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  return {
    prev: index > 0 ? DOC_PAGES[index - 1] : null,
    next: index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : null,
  };
}
