# Preferences copy inventory

Authoritative inventory after **PR 6b** (IA regroup + labels) and **PR 6c** (host copy rewrite).

**Constraints honored**

- Settings keys and control behavior unchanged
- Section ids (`general`, `core-plugins`, `plugins`, …) unchanged
- Preferences search (**6d**) not implemented

## Nav IA (6b)

| Group | Sections (ids) | Labels |
| --- | --- | --- |
| Workspace | `general`, `editor`, `appearance`, `hotkeys` | General, Editor, Appearance, Keyboard |
| Files | `files`, `templates`, `daily-notes` | Files & links, Templates, Daily notes |
| Intelligence | `ai`, `database` | AI, Database |
| Modules | `core-plugins`, `plugins`, `backlinks`, `canvas`, `command-palette`, `page-preview`, `quick-switcher` | Built-in modules, Extensions, Backlinks, Canvas, Command palette, Link previews, Quick open |
| Account | `collaboration`, `keychain`, `about` | Collaboration, Keychain, About |

Window chrome: **Preferences** header in nav; close `aria-label` = “Close preferences”.

## Label renames (6b)

| Before | After |
| --- | --- |
| Options (header) | Workspace |
| OpenOnyx (header) | Intelligence / Account split |
| Core plugins (header + item) | Modules / Built-in modules |
| Community plugins | Extensions |
| Files and links | Files & links |
| Configure AI | AI |
| Hotkeys | Keyboard |
| Page preview | Link previews |
| Quick switcher | Quick open |

## High-risk row rewrites (6c sample; full set in `SettingsPage.tsx`)

| Before | After | Key |
| --- | --- | --- |
| Readable line length | Comfortable line width | `readableLineLength` |
| Strict line breaks | Preserve single line breaks | `strictLineBreaks` |
| Show ribbon | Show activity rail | `showRibbon` |
| Ribbon menu configuration | Activity rail actions | — (nav only) |
| Base color scheme | Theme | `theme` |
| Always focus new tabs | Focus newly opened tabs | `alwaysFocusNewTabs` |
| Show editing mode in status bar | Show editor mode in status strip | `showEditingModeStatusBar` |
| Fold heading | Collapsible headings | `foldHeading` |
| Use [[Wikilinks]] | Prefer wiki-style links | `useWikiLinks` |
| Community plugins (browse) | Browse extensions | — |
| Page preview / Quick switcher modules | Link previews / Quick open | `corePagePreview`, `coreQuickSwitcher` |

All static `SettingRow` titles and descriptions in `src/components/settings/SettingsPage.tsx` were rewritten in this pass (≈70+ rows). Dynamic titles (command list, model names) are left as data-driven labels.

## Group headers rewritten

| Before | After |
| --- | --- |
| Behavior | Typing & behavior |
| Trash | Deletion |
| Interface | Chrome |
| Font | Typography |
| Installed plugins | Installed extensions |
| Available Models | Models |
| System Status | Status |
| Local Storage | Local storage |

## Preferences search (6d) — implemented

MVP only (no global row catalog):

1. **Nav filter** — section labels matching query; **active section always stays visible**
2. **Active-section row filter** — `SettingGroup` hides non-matching `SettingRow`s by title/description text
3. **Go to** — jump list for other sections whose labels match
4. **Empty state** — shown when the active section has no matching rows/panels (`:has()` CSS)

Not in scope: cross-section row index / `preferencesCatalog.ts`.

## Acceptance

- [x] Nav regrouped Workspace / Files / Intelligence / Modules / Account
- [x] Module/extension/activity-rail language
- [x] Host strings in OpenOnyx voice; non-affiliation retained on About
- [x] Setting keys unchanged
- [x] Preferences search MVP (6d)
