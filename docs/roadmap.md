# Roadmap

This is the public view of where OpenOnyx is pointed. Dates are not commitments. The living backlog is [GitHub Issues](https://github.com/OpenOnyx/OpenOnyx/issues).

## Now — desktop v1.0.4

The current release is a local-first Electron app for macOS, Windows, and Linux:

- Markdown workspace (CodeMirror, wiki links, preview, Vim, tables)
- Graph and on-device AI graph
- Portable `.canvas` boards
- Spaces (local RAG in IndexedDB; optional Supabase)
- Obsidian-compatible plugin runtime
- Themes, wallpaper, and no product telemetry

Cloud is a switch. Live multiplayer editing is available through private cloud spaces backed by Supabase and Yjs. A phone client is in progress and is not released.

## Next

Work that is already visible in the tracker, in roughly this order of importance:

| Theme | Why it matters | Tracking |
| --- | --- | --- |
| Plugin compatibility | Community plugins should trash, stat, and see vault files the way the API claims | [#114](https://github.com/OpenOnyx/OpenOnyx/issues/114), [#74](https://github.com/OpenOnyx/OpenOnyx/issues/74) |
| Vault isolation | `vault://`, `openPath`, and plugin network/fs prompts should stay inside the vault | [#65](https://github.com/OpenOnyx/OpenOnyx/issues/65), [#67](https://github.com/OpenOnyx/OpenOnyx/issues/67) |
| CSS snippets | Load `.css` from `.openonyx/snippets` and `.obsidian/snippets` | [#110](https://github.com/OpenOnyx/OpenOnyx/issues/110) |
| External file watch | Notes edited outside the app should appear without a reload | [#82](https://github.com/OpenOnyx/OpenOnyx/issues/82) |
| Shortcut remapping | Users should own the keymap; Space as Vim leader should not eat typing | [#87](https://github.com/OpenOnyx/OpenOnyx/issues/87), [#88](https://github.com/OpenOnyx/OpenOnyx/issues/88) |

## Later

- Harden live collaboration conflict handling and recovery
- Ship a phone client against the same Markdown vault
- Spaces and search hardening (citations that open the note, incremental search index, real note IDs)

If you want to help, [good first issues](https://github.com/OpenOnyx/OpenOnyx/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are labeled. Propose a new direction as an issue before a large PR.
