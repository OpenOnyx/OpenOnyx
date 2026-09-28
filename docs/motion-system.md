# OpenOnyx motion system

OpenOnyx motion communicates state, preserves spatial continuity, and confirms input. It is intentionally quiet: if motion calls attention to itself, it is too strong.

## Foundation

| Token | Value | Use |
| --- | ---: | --- |
| Instant | 90ms | Reduced-motion fades and tiny state acknowledgements |
| Button | 110ms | Press and release |
| Hover | 140ms | Hover, focus, selection, and menu appearance |
| Tab | 170ms | Tab state and compact content changes |
| Dialog | 180ms | Dialogs, toasts, and validation |
| Panel | 200ms | Sidebars, drawers, and disclosure |
| Loading | 180ms | Result replacement, highlights, and progress changes |
| Ease out | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances and direct manipulation release |
| Standard | `cubic-bezier(0.2, 0, 0, 1)` | State-to-state changes |
| Ease in | `cubic-bezier(0.4, 0, 1, 1)` | Exits |

Distances are limited to 4px for compact UI and 8px for cards or dialogs. Scale is limited to 98% for press and menu entrance. Width and grid-track animation are reserved for the two application sidebars and small disclosure regions; everything else uses opacity and transform.

## Interaction specification

### Explorer

| Interaction | Enter/change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Folder disclosure | Children reveal with grid-track + opacity, 200ms ease out; chevron rotates, 170ms | 0 | Reverse over 200ms; children unmount afterward | Preserves parent/child continuity without measuring content height |
| Note insertion | Fade + 4px upward settle, 170ms ease out | 0 | Fade + 4px upward, 140ms ease in | Makes file operations legible without shifting attention |
| Note deletion | Remaining rows settle in place; removed row uses the standard list-item exit when deletion is initiated in-app | 0 | 140ms ease in | Confirms which note left the list |
| Selection | Background, text, border, and shadow, 140ms ease out | 0 | Reverse, 140ms | Connects click/keyboard focus to the resulting editor state |
| Hover | Background and text, 140ms ease out | 0 | 110ms | Affordance only; no position change |
| Drag | Source to 98% and 40% opacity, 110ms; target inset ring and 4px nudge, 140ms | 0 | Restore, 110ms | Separates the moving object from its destination |

Only the expanded branch is retained for collapse. Closed branches do not remain mounted, so large vaults do not pay for hidden trees.

### Tabs and editor content

| Interaction | Enter/change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Open tab | Fade + 4px upward settle, 170ms ease out | 0 | — | Shows where the new workspace object appeared |
| Close tab | Fade + 4px upward + 98% scale, 170ms ease in | 0 | Tab is removed after motion completes | Confirms the exact tab being closed |
| Reorder | Dragged tab dims; insertion edge transitions over 140ms | 0 | Restore, 110ms | Prioritizes drop position over decorative movement |
| Switch tab | Editor host fades and settles upward 5px, 170ms ease out | 0 | Previous pixels are replaced immediately | Reorients the user while keeping switching fast |
| Edit/preview switch | Same 5px/170ms content transition | 0 | Immediate replacement | Connects two representations of the same note |

Typing, cursor movement, document scrolling, and text selection are never animated.

### Editor surfaces

| Interaction | Enter/change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Markdown preview update | Highlight/background changes crossfade, 180ms | 0 | 90ms fade | Prevents rendered changes from flashing while typing remains immediate |
| Callout disclosure | Chevron rotation + content disclosure, 170–200ms | 0 | Reverse | Shows containment and disclosure state |
| Code highlighting | Color/background transition, 180ms | 0 | 90ms | Softens asynchronous syntax-token replacement |
| Search highlight | Background/border/color, 180ms | 0 | Fade, 90ms | Makes new matches readable without pulsing |
| Inline toolbar | Fade + 4px downward-origin settle, 140ms | 0 | Fade, 110ms | Keeps the toolbar visually attached to the selection |
| Slash/autocomplete menu | Fade + 4px settle, 140ms | 0 | Fade, 110ms | Clarifies that the menu is contextual, not a new screen |
| Find/replace panel | Fade + 4px settle, 140ms | 0 | Fade, 110ms | Anchors the panel to the editor corner |

### Vault Intelligence

| Interaction | Enter/change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Ask / Suggest / Insights | Panel fade + 8px upward settle, 170ms ease out | 0 | Fade, 110ms | Reinforces the tab change without moving the panel frame |
| Tab indicator | Color/background and underline scale, 160–170ms | 0 | Reverse | Makes the current mode unambiguous |
| AI answer | Card fade + 8px upward settle, 180ms | 0 | Fade, 140ms | Separates the completed answer from loading state |
| Streamed text batch | New semantic block fades in, 90ms; update at most every 40–60ms | 0 | None | Shows progress without animating individual characters or causing reflow churn |
| Suggestion/insight cards | Fade + 8px upward settle, 180ms | 25ms per item, capped at 100ms | Fade + 4px upward, 140ms | Establishes scan order while keeping long lists fast |
| Source/concept chips | Fade, 180ms | 25ms, maximum three chips | Fade, 90ms | Makes evidence provenance easy to parse |
| Sources drawer | Fade + 8px from right, 200ms | 0 | Reverse, 180ms | Preserves the relationship between answer and evidence |
| Confidence badge | Opacity/color, 180ms | 0 | Fade, 90ms | Communicates recalculation without implying certainty is animated data |
| Accept/reject | Press 110ms, then card exit 140ms | 0 | Fade + 4px upward | Confirms the action before the list closes the gap |
| Model/index loading | Progress width, 180ms; subtle linear shimmer, 1.4s | 0 | Fade, 90ms | Shows ongoing work without a dominant spinner |

Staggering stops after five cards and never applies to every result in a large vault. Stream transports should append text in semantic batches, not per token; the current non-streaming answer path uses the completed-answer entrance only.

### Sidebars, search, graph, and overlays

| Surface | Enter/change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Left/right sidebar | Width + opacity, 200ms ease out | 0 | Reverse; heavy content unmounts after 200ms | Maintains spatial continuity and avoids background work while closed |
| Core right-sidebar view | Fade + 4px from top, 170ms | 0 | Fade, 110ms | Clarifies panel replacement inside a stable frame |
| Plugin panel | Standard sidebar shell only | 0 | Standard shell | Avoids imposing motion on plugin-owned content |
| Search open | Standard left-sidebar panel transition | 0 | Reverse | Keeps search tied to navigation |
| Search result update | Fade, 180ms; first 20 results only | 0 | Immediate replacement | Avoids blocking input and prevents mass animation |
| Context menu | Fade + 98% to 100%, 140ms, origin at click anchor | 0 | Fade, 110ms | Makes menu provenance clear |
| Dialog | Backdrop fade and surface fade + 8px/99% settle, 180ms | 0 | Fade + 4px/99%, 160ms | Establishes modality without mobile-style travel |
| Toast | Fade + 8px upward settle, 180ms | 0 | Fade + 4px downward, 180ms | Confirms background work, then clears quietly |
| Graph initial data | One canvas-wide node fade; edges begin after 12%, total 180ms | 0 | Immediate on filter removal | Communicates graph readiness with one batched redraw |
| Graph zoom/focus | Target interpolation per frame, approximately 150–200ms | 0 | N/A | Maintains object constancy while staying responsive to wheel and drag input |
| Graph selection | Ring/alpha redraw in the existing canvas frame | 0 | Immediate redraw | Avoids DOM work and per-node animations on large graphs |

### Controls and loading

| Interaction | Change | Delay | Exit | Why |
| --- | --- | ---: | --- | --- |
| Button hover | Background/text/border brighten, 140ms | 0 | 110ms | Fast affordance confirmation |
| Button press | Scale to 98%, 110ms | 0 | Return with ease out, 110ms | Gives tactile feedback without bounce |
| Focus ring | Ring opacity/shadow, 140ms | 0 | 90ms | Preserves keyboard location |
| Input focus | Border and ring, 140ms | 0 | 110ms | Makes the active field clear |
| Placeholder | Opacity to 68%, 140ms | 0 | Reverse | Reduces competition with entered text |
| Validation | Border/message fade, 180ms | 0 | 90ms | Communicates status without a disruptive pop |
| Skeleton | Low-contrast shimmer, 1.4s linear | 0 | Fade, 90ms | Indicates structure and progress |
| Spinner | Constant linear rotation only when no skeleton shape is possible | 0 | Fade, 90ms | Keeps indeterminate work recognizable and compact |

## Performance rules

- Animate only `transform` and `opacity` by default. Sidebar width and small disclosure grid tracks are deliberate exceptions.
- Never assign `will-change` permanently to repeated list rows. It is reserved for a transitioning editor host and the two panel shells.
- Cap result animation at 20 items and AI stagger at 100ms. Never stagger graph nodes, full search result sets, or explorer trees.
- Keep graph animation in the existing Canvas2D render loop. Edges and nodes share one reveal scalar and one animation frame.
- Disable transitions during pointer-driven resize. Drag and pan update synchronously with the pointer.
- Loading motion must not delay data display or keyboard input.

## Reduced motion

When `prefers-reduced-motion: reduce` is active:

- Remove translation, scale, stagger, shimmer, pulse, and spinner rotation.
- Keep short 90ms opacity/color fades so state changes remain understandable.
- Make graph zoom/focus changes immediate and skip the initial graph reveal.
- Keep explorer disclosure at 90ms without translating children.
- Preserve all focus, selection, validation, and loading semantics.

The implementation tokens and selectors live in `src/styles/motion.css`. Component-specific JavaScript is used only where an exit must finish before unmount or where Canvas2D needs a shared reveal clock.
