# Plan: Obsidian-compatible CSS snippets

**Issue:** [#110](https://github.com/OpenOnyx/OpenOnyx/issues/110)  
**Branch:** `feat/css-snippets-110` (from current `main`; completes `origin/css-snippet`)  
**Status:** implemented on that branch — not yet on `main`

This is the working plan for first-class CSS snippets. It is based on Obsidian’s documented behavior, the current OpenOnyx tree, and the parked `feat/css-snippets` prototype.

---

## 1. Goal

Let a user drop `.css` files into a vault folder, toggle them in **Settings → Appearance**, and have those styles apply on top of the current theme — the same workflow as Obsidian.

What “compatible” means for this PR:

- Same folder contract (plus an OpenOnyx default folder)
- Same enable/disable + persist + live apply
- Same plugin surface (`app.customCss`)
- Existing Obsidian snippet files in an opened vault are discovered and can be turned on

What it does **not** mean:

- Every community snippet looking identical (our DOM and editor are not Obsidian’s)
- A shipped phone client
- An in-app CSS editor
- OS-level vault watching ([#82](https://github.com/OpenOnyx/OpenOnyx/issues/82))

---

## 2. How Obsidian does it

Source: [Obsidian Help — CSS snippets](https://help.obsidian.md/Extending+Obsidian/CSS+snippets) and the public `app.customCss` / `appearance.json` contract.

| Piece | Behavior |
| --- | --- |
| Location | `<vault>/.obsidian/snippets/*.css` only. Create the folder if missing. Name = filename without `.css`. |
| UI | Settings → **Appearance → CSS snippets**. List every file. Toggle each one. **Open snippets folder**. **Reload snippets**. |
| Enable state | `<vault>/.obsidian/appearance.json` field `enabledCssSnippets: string[]` (stems, not paths). |
| Load order | Theme first. Then every enabled snippet, stacked. Snippets win over the theme when specificity matches. |
| Live update | Folder is watched. Save / add / remove / rename applies without restart. |
| Plugin API | `app.customCss.snippets`, `enabledSnippets` (`Set`), `requestLoadSnippets()`, `setCssEnabledStatus(name, enabled)`, `loadSnippet` / `unloadSnippet`. |
| Trust | User-authored CSS injected as stylesheets. No sanitizer. `url()` and `@import` are allowed. |

Community snippets typically target Obsidian DOM (`.markdown-preview-view`, `.cm-s-obsidian`, `.nav-file-title`, `.workspace-leaf`) and variables (`--h1-color`, `--color-base-00`, `--font-text-size`, `--accent-h/s/l`). They are not a portable CSS language.

---

## 3. What OpenOnyx has today

### User-facing

Nothing. Appearance is `LiveThemeStudio`: presets, custom colors, wallpaper. No snippet list, no folder, no injection.

### Plugin stub

`src/lib/obsidian-api/app.ts` already exposes `app.customCss`:

- `requestLoadSnippets()` lists `.obsidian/snippets` via `vault.adapter.list`
- Enabled names go to localStorage `enabled-css-snippets`
- `loadSnippet` / `unloadSnippet` only mutate a `Set`
- **No CSS is ever injected**

### Theme / DOM (relevant to snippet hit-rate)

- `html[data-theme]` + CSS variables: `--bg-primary`, `--text-primary`, and some Obsidian-like `--color-base-*` / `--color-accent*`
- `document.body` gets `theme-dark` or `theme-light`
- Preview uses `.markdown-preview-view` (`src/tailwind.css`)
- Plugin views use `.workspace-leaf-content`
- Editor is CodeMirror 6 — **not** `.cm-s-obsidian` / HyperMD

### Disk and IPC (constraints)

| Fact | Why it matters |
| --- | --- |
| `listFiles` skips names starting with `.` | Sidebar stays clean. Listing an **explicit** path (`.obsidian/snippets`) still returns the `.css` files inside. |
| `listDataDir('snippets')` | Lists `.openonyx/snippets` and creates the data dir. Prefer this for the OpenOnyx folder. |
| No OS file watcher | #82 is open. In-app writes fire `openonyx:file-written`. Edits from another editor need a poll until #82 lands. |
| `desktop:openPath` is vault-jailed (#112) | “Open folder” must pass a vault-relative path such as `.openonyx/snippets`, not a raw absolute string. |

### Parked prototype

Local branch `feat/css-snippets` (`c34f7b3`) already has the right shape (~840 lines):

- `src/lib/cssSnippets.ts`
- `src/components/settings/components/CssSnippetsPanel.tsx`
- Appearance hook in `LiveThemeStudio`
- `app.customCss` pointed at the real module
- `tests/css-snippets.test.ts`

It is based on `f87bf49` and is **behind current `main`** (security jail, vault adapter fixes). Do not merge it. Port it onto a fresh branch from `main`.

---

## 4. Compatibility we will claim

| Ships in this PR | Does not ship |
| --- | --- |
| Drop-in folders, toggles, persist, restart | Pixel-perfect every community snippet |
| `--color-base-*`, `--color-accent*`, `.markdown-preview-view`, `body.theme-dark` | Selectors that only exist in Obsidian’s CM5/HyperMD (` .cm-s-obsidian`, `.HyperMD-header`) |
| Same vault’s `.obsidian/snippets` + seed from its `appearance.json` | Variables we never defined (`--h1-color` unless we add aliases later) |
| `app.customCss` actually applies CSS | Mobile |

Issue #110’s “reuse without modification” is the **folder / toggle / API** contract. Full visual parity is a later theme-compat pass.

---

## 5. Design

### Folders

| Path | Role |
| --- | --- |
| `<vault>/.openonyx/snippets/*.css` | Default. “Open folder” creates and opens this. |
| `<vault>/.obsidian/snippets/*.css` | Compat. Discovered if present. |

Same stem in both folders → **OpenOnyx file wins**. Only top-level `.css` files (no recursion). Name is the stem, case-preserved, compared case-sensitively to match Obsidian.

### Persistence

File: `<vault>/.openonyx/appearance.json`

```json
{
  "enabledCssSnippets": ["readable-line-length", "callout-tweaks"]
}
```

Rules:

1. If this file exists and parses, it is the source of truth.
2. If it is missing, read `.obsidian/appearance.json` `enabledCssSnippets` once and write the OpenOnyx file.
3. Do not overwrite other keys if the file already has them (merge).
4. localStorage is only a last-resort seed for the plugin stub’s old key; disk wins after first vault open.

Do **not** write back into `.obsidian/appearance.json`. OpenOnyx must not mutate the user’s Obsidian settings.

### Injection

- One `<style data-oo-snippet="name">` per enabled snippet in `document.head`.
- Set `textContent` (same pattern as `src/lib/pluginStyles.ts`). Never `innerHTML`.
- Built-in theme CSS is never rewritten.
- Disable or missing file → remove that tag.
- Close / switch vault → remove every snippet tag.

Trust model matches Obsidian: the user put the file in their vault. No CSS parser. Do not invent a sanitizer in this PR.

### Live reload

Until #82:

1. Listen for `openonyx:file-written` / `file-created` / `file-deleted` / `file-renamed` when the path is under either snippets dir.
2. Poll every 2s while a vault is open (covers VS Code / Obsidian / Finder edits).
3. Appearance **Refresh** button forces a rescan.

### Plugin API

Replace the stub with the same module the UI uses so Style Settings / snippet managers see one list and one enable set.

---

## 6. Implementation steps

Work on a **new** branch from current `main`. Cherry-pick or rewrite the parked files; then fix the jail and App wiring.

### Step 1 — Core module

Port `src/lib/cssSnippets.ts`:

- `discoverSnippets()`, `setCssSnippetEnabled()`, `refreshCssSnippets()`
- `startCssSnippets()` / `stopCssSnippets()`
- `openCssSnippetsFolder()` using vault-relative `.openonyx/snippets`
- Subscribe helper for the settings panel

### Step 2 — App lifecycle

In `src/App.tsx`, start on `vaultPath` set, stop on change/clear. A cancelled start (vault closed mid-load) must not leave tags behind.

### Step 3 — Appearance UI

- `CssSnippetsPanel` under `LiveThemeStudio`: list, toggle, Refresh, Open folder, empty state, source badge (`.obsidian` vs `.openonyx`).
- Copy: extra stylesheets on top of the theme; drop `.css` into `.openonyx/snippets`; Obsidian vaults also see `.obsidian/snippets`.

### Step 4 — Plugin wiring

`OOApp.customCss = cssSnippetsApi` (parked diff). Keep the plugin-runtime test that this object exists; extend it so enable actually injects.

### Step 5 — Security / rebase (required on current `main`)

- `openPath('.openonyx/snippets')` only — no absolute path built in the renderer.
- Read/list only under the two snippet directories. Reject `..`.
- Confirm `listFiles('.obsidian/snippets')` still works after the vault adapter changes on `main`.

### Step 6 — Tests

Keep and tighten `tests/css-snippets.test.ts`:

- Parse / merge `appearance.json` without clobbering other keys
- Stem from filename; ignore non-`.css`; OpenOnyx wins on name collision
- Enable persists; inject and remove tags
- Seed from Obsidian when OpenOnyx has no record; never write `.obsidian/appearance.json`
- `app.customCss` is the same store as the UI
- Explicit `.obsidian/snippets` listing works; root `listFiles('')` still hides dotfolders

### Step 7 — Docs

One short note in contributor docs (this file + a line in `docs/README.md`). Honest sentence: snippets that only target Obsidian editor classes may do nothing until we add class aliases.

---

## 7. Manual verification

1. Empty vault → Open folder → add `headings.css` → appears in the list → toggle on → preview headings change.
2. Toggle off → styles gone. Restart with it enabled → styles back.
3. Open a real Obsidian vault that already has `.obsidian/snippets` and `enabledCssSnippets` → list matches, enabled set seeded, OpenOnyx `appearance.json` created.
4. Same stem in both folders → OpenOnyx file is the one injected.
5. Edit the file in an external editor → within ~2s (or Refresh) the style updates.
6. Close vault → no leftover `style[data-oo-snippet]` in the document.
7. “Open folder” opens Finder/Explorer on `.openonyx/snippets` and does not trip the `openPath` jail.

---

## 8. Out of scope

- Phone / tablet
- Full Obsidian class and variable alias layer
- In-app snippet editor or marketplace
- OS-level vault watch (#82)
- Theme packages (`.obsidian/themes`) — different feature
- Writing into `.obsidian/appearance.json`

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Users expect every downloaded snippet to “just work” | Document the DOM/variable overlap. Do not advertise pixel-perfect Obsidian CSS. |
| 2s poll is wasteful / laggy | Cheap: list two small dirs. Replace with #82 later. |
| Parked branch + `openPath` jail | New branch from `main`; vault-relative open. |
| Plugin stub and UI diverge | One module, both call it. |

---

## 10. Done when

- Appearance has a CSS Snippets section that matches the Obsidian workflow (folder, reload, toggles).
- `.openonyx/snippets` and `.obsidian/snippets` are both discovered.
- Enabled set survives restart via `.openonyx/appearance.json`.
- `app.customCss` applies CSS, not just names.
- Unit tests above pass. Manual checklist above is run.
- #110 can be closed by the PR (`Fixes #110`).
