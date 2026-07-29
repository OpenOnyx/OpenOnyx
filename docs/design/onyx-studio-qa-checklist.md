# Onyx Studio visual QA checklist

Use after each visual redesign PR. Capture screenshots under `docs/images/studio-qa/` when preparing PR 10 marketing assets (after Preferences string freeze).

## Owners

- Product: visual acceptance / trade-dress distance
- Eng: plugin regressions + layout math

## Always

- [x] No “Open Obsidian”, Obsidian logo/wordmark, or purple gem branding in UI, README banner, or packaging (banner + logos + app icons refreshed)
- [x] Non-affiliation language present in About and README plugin section
- [ ] Focus rings visible on keyboard navigation
- [ ] Light + dark theme smoke (and one named theme)

## Docs product screenshots (manual — PR10)

`docs/images/markdown-workspace.png`, `knowledge-graph.png`, `canvas-workspace.png`, `plugin-marketplace.png`, `spaces-dashboard.png`, `ai-*.png`, `Collaboration-settings.png` still show pre-redesign chrome. Refresh after a local build when ready for public relaunch:

1. `npm run dev` with OO-Test-Vault
2. Capture Welcome, shell, Preferences, graph, palette
3. Replace files under `docs/images/` (keep names for README links)

## Surfaces

| Surface | Pass criteria |
| --- | --- |
| Welcome | OpenOnyx logo + wordmark; Open/Create vault CTAs |
| Shell | Activity rail + navigator + editor; layered surfaces; rail aligns with title-bar left gutter |
| Preferences | Distinct chrome; IA labels; no bare `.setting-item` on host rows |
| Command palette | Host elevation/type; shortcuts readable |
| Graph | Theme-driven nodes/edges (not hardcoded gray parity) |
| Plugin settings tab | Community plugin Setting UI still usable |
| Excalidraw (if installed) | Opens; theme vars on body via `__oo_sync_theme_variables_to_body` |
| Status strip | Full-width; does not clip last editor line; toast above strip |
| Plugin ribbon icon | Still mounts and clicks |

## Commands

```bash
npm run lint
npm run build
# After token / plugin bridge PRs:
npm run test:plugin-compat
```
