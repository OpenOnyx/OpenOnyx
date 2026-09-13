import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CompareTable } from "../components/CompareTable";
import { DOWNLOADS, FEATURES, PLUGINS_TESTED, PRODUCT, SHORTCUTS } from "./facts";

function Steps({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="docs-steps">
      {items.map((item) => (
        <li key={item.title}>
          <b>{item.title}</b>
          <p>{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="docs-note">
      <strong>Note</strong>
      <div>{children}</div>
    </div>
  );
}

function Caution({ children }: { children: ReactNode }) {
  return (
    <div className="docs-note is-caution">
      <strong>Caution</strong>
      <div>{children}</div>
    </div>
  );
}

function Hub({
  title,
  blurb,
  more,
  links,
}: {
  title: string;
  blurb: string;
  more?: { to: string; label: string };
  links: Array<{ to: string; title: string; body: string }>;
}) {
  return (
    <section className="docs-hub">
      <h2>{title}</h2>
      <p>{blurb}</p>
      <ul>
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to}>{link.title}</Link>
            <span> — {link.body}</span>
          </li>
        ))}
      </ul>
      {more && (
        <p className="docs-hub-more">
          <Link to={more.to}>{more.label}</Link>
        </p>
      )}
    </section>
  );
}

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
    title: "Documentation",
    group: "Get going",
    summary:
      "OpenOnyx is an open source desktop app for notes you keep as files. This site is the official documentation for install, daily use, the built-in thinking layer, and optional cloud.",
    body: (
      <>
        <p>
          You point the app at a folder — a vault — and write Markdown there. The editor, graph, search,
          Spaces, and plugins all read those files. Nothing important lives only inside the app. You do not
          need an account to start.
        </p>
        <Note>
          Current desktop release is v{PRODUCT.version} (Apache-2.0). Official builds are on{" "}
          <a href={PRODUCT.latestRelease}>GitHub Releases</a>. A phone client is in progress and is not
          documented here yet.
        </Note>

        <Hub
          title="Get going"
          blurb="Install the desktop, open a folder, and see what ships in the box."
          more={{ to: "/docs/install", label: "Start with install" }}
          links={[
            { to: "/docs/install", title: "Install", body: "macOS, Windows, Linux, or build from source." },
            { to: "/docs/vault", title: "Open a vault", body: "A vault is a folder. Create one or open one you already have." },
            { to: "/docs/features", title: "What's included", body: "The twelve surfaces in the current desktop." },
            { to: "/docs/obsidian", title: "Coming from Obsidian", body: "Open the same folder. Then use Spaces and the AI graph." },
          ]}
        />
        <Hub
          title="Daily use"
          blurb="The work you do every day: write, find, map, and board."
          more={{ to: "/docs/write", label: "Start writing" }}
          links={[
            { to: "/docs/write", title: "Write notes", body: "Source, preview, split, wiki links, Vim, and tables." },
            { to: "/docs/find", title: "Find anything", body: "Quick switcher, vault search, and the command palette." },
            { to: "/docs/graph", title: "Graph", body: "Wiki links as a map, plus a local AI view." },
            { to: "/docs/canvas", title: "Canvas", body: "Portable .canvas boards next to your notes." },
          ]}
        />
        <Hub
          title="Thinking layer"
          blurb="Ask the vault, load community plugins, and set the look. These ship in the desktop."
          more={{ to: "/docs/spaces", label: "Open Spaces" }}
          links={[
            { to: "/docs/spaces", title: "Spaces and AI", body: "Local embeddings, cited answers, optional rewrite." },
            { to: "/docs/plugins", title: "Plugins", body: "Obsidian-compatible runtime, marketplace, crash isolation." },
            { to: "/docs/themes", title: "Themes and wallpaper", body: "Dark, light, oceanic, custom themes, vault wallpaper." },
          ]}
        />
        <Hub
          title="Optional cloud"
          blurb="Writing never needs a server. Turn these on only if you want them."
          more={{ to: "/docs/privacy", label: "Read the privacy model" }}
          links={[
            { to: "/docs/sync", title: "Sync and collaboration", body: "Your Supabase project. Live multiplayer is under maintenance." },
            { to: "/docs/privacy", title: "Privacy", body: "Offline by default. No product telemetry." },
          ]}
        />
        <Hub
          title="Reference"
          blurb="Look up shortcuts and how the desktop is put together."
          links={[
            { to: "/docs/shortcuts", title: "Keyboard", body: "Shortcuts wired in the current renderer." },
            { to: "/docs/develop", title: "Develop", body: "Clone, run, and the process boundary." },
          ]}
        />
      </>
    ),
  },
  {
    slug: "features",
    title: "What's included",
    group: "Get going",
    summary:
      "Twelve surfaces ship in the desktop: writing, search, graph, AI graph, canvas, Spaces, AI writing, plugins, themes, privacy, optional cloud, and export. This page is the inventory, not a wishlist.",
    body: (
      <>
        <p>
          After install you already have the workspace and the thinking layer. You do not hunt a plugin to
          ask the vault a question or to see a semantic graph. Below is what is in the current desktop build,
          with a short “what it is” for each surface.
        </p>
        <p>
          Coming from Obsidian? Open the same folder, then start with Spaces and the AI graph — those are the
          layers they do not ship. See <Link to="/docs/obsidian">Coming from Obsidian</Link>.
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
        <Note>
          Coming from Obsidian? Open the same folder. Then use Spaces and the AI graph — those are the layers
          they do not ship. See <Link to="/docs/obsidian">Coming from Obsidian</Link>.
        </Note>
      </>
    ),
  },
  {
    slug: "install",
    title: "Install",
    group: "Get going",
    summary:
      "Install the official desktop build for macOS, Windows, or Linux from GitHub Releases. Local writing needs no account. You can also build from source with Node.js 22.",
    body: (
      <>
        <p>
          OpenOnyx is an Electron desktop app. Download the installer for your OS from{" "}
          <a href={PRODUCT.releases}>GitHub Releases</a> (current tag is {PRODUCT.version}), then open a
          folder. After the window is up, go to <Link to="/docs/vault">Open a vault</Link>.
        </p>
        <h2>macOS</h2>
        <p>
          Download the <code>.dmg</code> or <code>.zip</code> from the release. Drag OpenOnyx into
          Applications, then launch it from there.
        </p>
        <Caution>{DOWNLOADS.macNote}</Caution>
        <h2>Windows</h2>
        <p>
          Download the <code>.exe</code> installer from the same release. Signing is provided by SignPath.io
          with a certificate from SignPath Foundation.
        </p>
        <Note>{DOWNLOADS.windowsNote}</Note>
        <h2>Linux</h2>
        <p>
          Use <code>.AppImage</code>, <code>.deb</code>, or Arch <code>.pkg.tar.zst</code>. There is no official{" "}
          <code>.rpm</code>. You can also run the installer script:
        </p>
        <pre>{DOWNLOADS.linuxInstall}</pre>
        <h2>From source</h2>
        <p>
          Requires Node.js 22 or newer. This starts the Electron main process, Vite on port {PRODUCT.vitePort},
          and the desktop window against that dev server.
        </p>
        <pre>{`git clone https://github.com/OpenOnyx/OpenOnyx.git
cd OpenOnyx
npm install
npm run dev`}</pre>
        <p>
          Next: <Link to="/docs/vault">open a vault</Link>, then <Link to="/docs/write">write a note</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "vault",
    title: "Open a vault",
    group: "Get going",
    summary:
      "A vault is any folder you choose. OpenOnyx reads the Markdown and canvas files in that folder and remembers recent vaults so you can switch without hunting the disk.",
    body: (
      <>
        <p>
          Think of the vault as “this project’s notes folder,” not an account. You can keep a research vault, a
          work vault, and a personal vault as three different folders and switch between them.
        </p>
        <h2>Create or open</h2>
        <Steps
          items={[
            {
              title: "First launch",
              body: "The welcome flow can create a new folder or open an existing one — including a folder you already use in Obsidian.",
            },
            {
              title: "Switch later",
              body: (
                <>
                  <code>File → Open Vault</code> changes folders. <code>Ctrl/Cmd+O</code> inside a vault is the
                  note quick switcher, not “open another vault.”
                </>
              ),
            },
            {
              title: "What the app writes",
              body: (
                <>
                  Your notes stay <code>.md</code> files. Cache and indexes go in <code>.openonyx</code> inside
                  the vault. You can ignore that folder in git if you want.
                </>
              ),
            },
          ]}
        />
        <h2>Suggested layout</h2>
        <p>
          You do not have to use a special structure. Ordinary folders are the source of truth. The bundled
          test vault happens to use numbered PARA-style folders — <code>00 - Inbox</code>,{" "}
          <code>01 - Projects</code>, <code>02 - Areas</code>, <code>03 - Resources</code>,{" "}
          <code>04 - Archive</code> — plus daily notes and templates. Copy that only if it helps.
        </p>
        <Note>
          Coming from Obsidian? Point OpenOnyx at the same folder. Then read{" "}
          <Link to="/docs/obsidian">Coming from Obsidian</Link> for what transfers and what you gain.
        </Note>
      </>
    ),
  },
  {
    slug: "obsidian",
    title: "Coming from Obsidian",
    group: "Get going",
    summary:
      "Open the folder you already have. Wiki links, graph, and canvas stay on disk. Then you get Spaces, an AI graph, and an Apache-2.0 desktop Obsidian does not ship.",
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
            <b>AI writing</b> — optional OpenAI or OpenRouter keys unlock rewrite, expand, and simplify. Local
            embeddings need no key.
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
        <Note>You can keep using Obsidian on the same folder. The files do not belong to either app.</Note>
      </>
    ),
  },
  {
    slug: "write",
    title: "Write notes",
    group: "Daily use",
    summary:
      "Write in a CodeMirror workspace: source, live preview, or split. Wiki links, backlinks, KaTeX, Vim, and tables that edit as tables. The preview is sanitized.",
    body: (
      <>
        <p>
          Click a file in the explorer, or press <code>Ctrl/Cmd+O</code> and type its name. The note opens as
          a tab. You are editing the file on disk — save with <code>Ctrl/Cmd+S</code>.
        </p>
        <h2>Three ways to look at the same file</h2>
        <ul className="docs-points">
          <li>
            <b>Source</b>
            <p>The Markdown as you typed it, with line numbers if you left them on.</p>
          </li>
          <li>
            <b>Preview</b>
            <p>Rendered reading view. HTML is sanitized before it is shown.</p>
          </li>
          <li>
            <b>Split</b>
            <p>Source on one side, preview on the other. This is the default on a wide window.</p>
          </li>
        </ul>
        <h2>Wiki links</h2>
        <p>
          Type <code>[[Note name]]</code>. Aliases and headings work: <code>[[Note|label]]</code>,{" "}
          <code>[[Note#Heading]]</code>. Backlinks, outgoing links, and unlinked mentions show in the right
          sidebar. The graph is those links drawn as a map.
        </p>
        <h2>Also in the editor</h2>
        <ul>
          <li>KaTeX for math</li>
          <li>Tags, outline, and properties panels</li>
          <li>Vim mode, including editor commands for common workflows</li>
          <li>WYSIWYG tables — insert rows and columns without editing pipe syntax</li>
          <li>Tab groups, split panes, and recent files</li>
          <li>
            Formatting: <code>Ctrl/Cmd+B</code> bold, <code>Ctrl/Cmd+I</code> italic,{" "}
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
    summary:
      "Search the vault, jump to a note, or run a command without digging through folders. Bookmarks and daily notes are built in.",
    body: (
      <>
        <p>
          In a large folder, browsing the tree is the slow path. Use search first. Each shortcut below does one
          job — they are not aliases of each other.
        </p>
        <ul className="docs-points">
          <li>
            <b>
              <span className="kbd">Ctrl/Cmd+O</span> — open a note
            </b>
            <p>Quick switcher. Type part of a file name and jump. This does not search file contents.</p>
          </li>
          <li>
            <b>
              <span className="kbd">Ctrl/Cmd+Shift+F</span> — search the vault
            </b>
            <p>Fuzzy search across notes when you remember a phrase, not the title.</p>
          </li>
          <li>
            <b>
              <span className="kbd">Ctrl/Cmd+F</span> — search this note
            </b>
            <p>Find and replace inside the file you already have open.</p>
          </li>
          <li>
            <b>
              <span className="kbd">Ctrl/Cmd+P</span> — command palette
            </b>
            <p>
              Run app commands (new note, graph, Spaces, theme). On this website the palette is{" "}
              <code>Ctrl/Cmd+K</code>.
            </p>
          </li>
        </ul>
        <p>
          Bookmarks, daily notes, and the file explorer (context menus for notes, folders, assets, and canvases)
          cover the rest. The full shortcut list is on <Link to="/docs/shortcuts">Keyboard</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "graph",
    title: "Graph",
    group: "Daily use",
    summary:
      "The graph is your wiki links drawn as a map. A second AI view adds suggested links, bridges, and idea islands from embeddings that run on the machine.",
    body: (
      <>
        <p>
          Press <code>Ctrl/Cmd+G</code>. Each node is a note. Each edge is a <code>[[wiki link]]</code> you
          already wrote. Dense clusters are topics you have connected. Isolated dots are notes that never got a
          link.
        </p>
        <h2>Two views</h2>
        <ul className="docs-points">
          <li>
            <b>Graph</b>
            <p>Only the links you typed. Use this to see the structure you already have.</p>
          </li>
          <li>
            <b>AI graph</b>
            <p>
              Semantic similarity on top of those links — suggested connections, bridges between clusters, and
              idea islands. Embeddings run locally with <code>all-MiniLM-L6-v2</code>. No account.
            </p>
          </li>
        </ul>
        <h2>What you can do there</h2>
        <ul>
          <li>Search, focus, filter, and center a node</li>
          <li>Tune physics and display</li>
          <li>Keep a persistent layout in local storage</li>
        </ul>
        <p>
          Layout is D3 in a worker, drawn with Canvas2D. The homepage graph is the same idea on the real{" "}
          <code>OO-Test-Vault</code>, not a mock picture.
        </p>
      </>
    ),
  },
  {
    slug: "canvas",
    title: "Canvas",
    group: "Daily use",
    summary:
      "A canvas is a board saved as a .canvas file next to your notes. Nodes, edges, and embedded Markdown stay portable if you leave the app.",
    body: (
      <>
        <p>
          Use a canvas when a folder list is the wrong shape — a map of a project, a reading stack, a
          comparison. It is still a file. OpenOnyx uses the Obsidian <code>.canvas</code> format, so the same
          board can live in both apps.
        </p>
        <h2>Create and open</h2>
        <p>
          <code>Ctrl/Cmd+Shift+C</code> creates a new board. Existing <code>.canvas</code> files show up in the
          explorer like any other note. Duplicate and save-as are on the board.
        </p>
        <h2>What you can put on it</h2>
        <ul>
          <li>Nodes and edges, with a toolbar</li>
          <li>Embedded Markdown notes from the same vault</li>
          <li>A recent-boards list so you can get back to the last map</li>
        </ul>
      </>
    ),
  },
  {
    slug: "spaces",
    title: "Spaces and AI",
    group: "Thinking layer",
    summary:
      "A Space lets you ask the vault a question and get an answer with citations. Embeddings run on the machine. Optional OpenAI or OpenRouter keys unlock rewrite, expand, and simplify.",
    body: (
      <>
        <p>
          Open Spaces from the ribbon or the command palette. Create a Space, let it index the folder, then
          type a question in plain language. The answer should point back at the notes it used.
        </p>
        <p>
          Under the hood, OpenOnyx scans <code>.md</code> and <code>.canvas</code> files, chunks the text, and
          embeds the chunks in the app with <code>@xenova/transformers</code> and{" "}
          <code>all-MiniLM-L6-v2</code> (384 dimensions). Local embeddings do not need an API key.
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
    summary:
      "Community plugins load through an Obsidian-compatible runtime: marketplace, permission prompts, and crash isolation. Compatibility is tested against the public API, not every private hook.",
    body: (
      <>
        <p>
          You do not rewrite your plugin list from scratch. OpenOnyx implements the public Obsidian plugin API
          against <code>obsidian@1.13.1</code>. A runtime audit checks 158 of 158 official exports. Plugins
          install from a marketplace UI. They ask for permissions, and a crash in one plugin is isolated from
          the rest of the app.
        </p>
        <p>
          Plugins that depend on undocumented Obsidian internals can still need adapters. Compatibility is
          against the public API, not every private hook.
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
      </>
    ),
  },
  {
    slug: "themes",
    title: "Themes and wallpaper",
    group: "Thinking layer",
    summary:
      "Dark, light, oceanic, and custom themes apply across the editor, graph, and settings. You can also set a vault wallpaper and keep type readable with blur and opacity.",
    body: (
      <>
        <p>
          Open Appearance from the command palette or the workspace chrome. Themes are for long sessions: quiet
          surfaces, Inter, restrained contrast. A theme change hits the editor, the graph, settings, and
          plugin views together.
        </p>
        <ul className="docs-points">
          <li>
            <b>Built-in themes</b>
            <p>Dark, light, and oceanic. Custom themes can be added on top.</p>
          </li>
          <li>
            <b>Wallpaper</b>
            <p>
              Upload an image behind the workspace. Blur and opacity sliders keep the Markdown readable. The
              live editor on the homepage has the same control.
            </p>
          </li>
          <li>
            <b>Translucent panels</b>
            <p>Editor and sidebar can sit on the wallpaper without washing out the type.</p>
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "sync",
    title: "Sync and collaboration",
    group: "Optional cloud",
    summary:
      "Writing never needs a server. If you want Spaces sync, you bring your own Supabase project. Live multiplayer editing is in the app but currently shows a maintenance notice.",
    body: (
      <>
        <p>
          Skip this page if you only want a local folder. Cloud is a switch, not a login wall. When you do turn
          it on, you use your own Supabase project: enable the <code>vector</code> extension, run{" "}
          <code>supabase/schema.sql</code>, and paste the project URL plus anon key into settings (or{" "}
          <code>.env.local</code>).
        </p>
        <Caution>
          The collaboration panel currently shows a maintenance notice: real-time multiplayer editing has
          known issues and is being fixed. Do not treat live co-editing as ready. Offline Spaces sync is still
          in the tree.
        </Caution>
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
    summary:
      "Editing, search, graph, and local Spaces work offline. There is no product telemetry. Cloud and remote models only see what you send after you turn them on.",
    body: (
      <>
        <p>
          Default is local. You can use the app on a plane. Anything that leaves the machine is something you
          switched on.
        </p>
        <ul className="docs-points">
          <li>
            <b>Offline first</b>
            <p>Core editing, search, graph, local embeddings, and local Spaces do not need a network.</p>
          </li>
          <li>
            <b>Files stay files</b>
            <p>Notes live in the folder you chose. The app is not a second copy of your vault.</p>
          </li>
          <li>
            <b>Caches stay on the device</b>
            <p>Indexes and embeddings stay local unless you enable a cloud-backed Space.</p>
          </li>
          <li>
            <b>Isolated renderer</b>
            <p>The window is context-isolated. Filesystem access goes through a preload IPC bridge.</p>
          </li>
          <li>
            <b>You choose the cloud</b>
            <p>
              Supabase is optional. A remote LLM receives only the prompt and the retrieved chunks for that
              question.
            </p>
          </li>
          <li>
            <b>No product telemetry</b>
            <p>The desktop does not phone home with usage analytics.</p>
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "shortcuts",
    title: "Keyboard",
    group: "Reference",
    summary:
      "These are the shortcuts wired in the desktop today. The website palette is Ctrl/Cmd+K; the app palette is Ctrl/Cmd+P.",
    body: (
      <>
        <p>
          Memorize four: <code>Ctrl/Cmd+O</code> to open a note, <code>Ctrl/Cmd+P</code> for commands,{" "}
          <code>Ctrl/Cmd+G</code> for the graph, <code>Ctrl/Cmd+S</code> to save. The rest is below. This
          website’s command palette uses <code>Ctrl/Cmd+K</code> so it does not fight the browser.
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
    summary:
      "Clone the repo, run the desktop against Vite, and see how the renderer talks to the filesystem through preload IPC. Node.js 22 or newer.",
    body: (
      <>
        <p>
          This page is for people changing the app. Day-to-day writing does not need it. Requires Node.js 22 or
          newer.
        </p>
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
