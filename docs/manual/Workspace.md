# Workspace

The workspace is the full OpenOnyx desktop surface: ribbon, sidebar, editor tabs, split panes, right sidebar, graph views, modals, and status information. It is designed around one rule: the vault folder is the source of truth, and every workspace surface should help you read or change those files deliberately.

## What the workspace contains

The main workspace is divided into three practical regions:

- The left side holds vault navigation, file tools, and plugin or app panels.
- The center holds editable tabs, previews, canvas boards, graph views, settings, and AI pages.
- The right side holds contextual panels such as backlinks, outgoing links, properties, outline, and related note tools.

The exact layout can change as you open notes, split panes, toggle sidebars, or run commands. OpenOnyx saves enough workspace state to return you to a familiar place after reopening a vault.

## Open, close, and focus panels

Use the sidebar toggle when you want more reading room. Use the command palette when you do not remember where a feature lives. If a panel is contextual, it updates from the active note or active tab.

For long writing sessions, collapse the surfaces you are not using. For review sessions, keep the outline, backlinks, or search results visible beside the note.

## Split panes and tabs

Tabs are for multiple files. Splits are for comparing context. Use them differently:

- Open a second tab when you are switching between tasks.
- Split the editor when two notes need to stay visible at the same time.
- Keep a graph or canvas open beside a note when structure matters.
- Close stale tabs before starting focused writing.

## Workspace state

OpenOnyx stores workspace layout data in app data rather than inside your Markdown notes. That means changing the visible arrangement does not modify note content. Files change only when you edit, rename, move, create, or delete vault items.

## Good workflow

1. Open the vault.
2. Use the file explorer or quick switcher to open the note.
3. Keep only the relevant panels visible.
4. Use splits for source material, outline, graph, or canvas.
5. Close panels when the task changes.

## Troubleshooting

If the workspace opens somewhere unexpected, use quick switcher, file explorer, or search to return to the file. If layout state seems stale, close unused tabs and reopen the vault. Your Markdown files are independent of the workspace layout.

## Continue learning

- [File Explorer](<File Explorer.md>)
- [Tabs and Panes](<Tabs and Panes.md>)
- [Command Palette](<Command Palette.md>)

