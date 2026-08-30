# CSS snippets (#110)

**Issue:** [#110](https://github.com/OpenOnyx/OpenOnyx/issues/110)  
**Branch:** `feat/css-snippets-110`

Drop `.css` files into the vault, toggle them in **Settings → CSS Snippets**, and they apply on top of the current theme.

## Shipped behavior

| Piece | What users get |
| --- | --- |
| Folders | `.openonyx/snippets/*.css` (default) and `.obsidian/snippets/*.css` (compat). Top-level `.css` only. |
| UI | Settings → **CSS Snippets**: list, toggle, Refresh, Open folder, Import, New, Edit, Export. OpenOnyx rows also have Rename / Delete. |
| Persist | `.openonyx/appearance.json` → `enabledCssSnippets`. Seed once from `.obsidian/appearance.json` if the OpenOnyx file is missing. Never write `.obsidian/`. |
| Collision | Same stem in both folders: the OpenOnyx file wins. Badge: “overrides .obsidian”. |
| Edit | Opens the file in the note editor as plain text (no Markdown toolbar or Reading view). Edit of an Obsidian snippet **copies** it to `.openonyx/snippets` first. |
| Live update | In-app writes apply immediately. External editors are picked up by a 2s poll until [#82](https://github.com/OpenOnyx/OpenOnyx/issues/82). |
| Plugin API | `app.customCss` is the same store as the settings panel. |
| Honesty | Community snippets that only target Obsidian editor classes (`.cm-s-obsidian`, HyperMD) may do nothing. Common Obsidian CSS variables are aliased onto OpenOnyx tokens. |

## Out of scope

- Pixel-perfect every community snippet
- A CSS language mode or marketplace
- Theme packages (`.obsidian/themes`)
- OS-level vault watching (#82)
- A phone client
- Writing `.obsidian/appearance.json` or mutating `.obsidian/snippets` from Rename / Delete / Edit
