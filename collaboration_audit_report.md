# OpenOnyx Collaboration Engine: Principal Engineer Audit & Verification Report

## Task 1: Legacy Collaboration Audit & Isolation

### Identified Legacy Artifacts
1. **`[Collab][overwrite_prevented]` / Postgres Replication LWW**:
   - *Location*: [collaborationEngine.ts:1868](file:///home/varshith/VOLT/notework/src/lib/collaborationEngine.ts#L1868)
   - *Behavior*: Dropped Postgres replication updates if `remoteVersion <= localVersion`.
   - *Action*: Disabled when `yDocManager.hasDoc(cleanPath, spaceId)` is active. Yjs CRDT owns document text convergence.
2. **Legacy `{from, to, text}` Op Extractors**:
   - *Location*: [LeafPaneEditor.tsx:856](file:///home/varshith/VOLT/notework/src/components/layout/LeafPaneEditor.tsx#L856) & [Editor.tsx:450](file:///home/varshith/VOLT/notework/src/components/editor/Editor.tsx#L450)
   - *Behavior*: Extracted character offset operations on every transaction.
   - *Action*: Disabled when `useCRDT` is active. Replaced by `y-codemirror.next` binding.
3. **Full-Document Replaces (`editor.setValue` / `doc-full`)**:
   - *Location*: [LeafPaneEditor.tsx:870](file:///home/varshith/VOLT/notework/src/components/layout/LeafPaneEditor.tsx#L870)
   - *Behavior*: Overwrote full CodeMirror document on 500ms debounced broadcast.
   - *Action*: Bypassed in CRDT mode. `yCollab` applies fine-grained CRDT delta transactions directly to CodeMirror state.
4. **Legacy History & Remote Cursors**:
   - *Location*: [Editor.tsx:120](file:///home/varshith/VOLT/notework/src/components/editor/Editor.tsx#L120)
   - *Behavior*: Included standard CodeMirror `history()` and custom cursor decorations.
   - *Action*: Omitted when `yCollabExtension` is passed, replacing `history()` with `yUndoManagerKeymap`.

---

## Task 2: Complete Lifecycle Trace

```
CodeMirror 6 Keystroke
   │
   ▼ 1. Local Transaction
yCollab Extension (y-codemirror.next)
   │
   ▼ 2. Mutates Y.Text("content")
Y.Doc ('update' event)
   │
   ▼ 3. Emits raw Uint8Array update
YjsTransport (_onDocUpdate)
   │
   ▼ 4. Queues in 50ms batching window -> Y.mergeUpdates(pending)
PrivateCrypto (if private space)
   │
   ▼ 5. Encrypts via encryptRawBytes(spaceId, bytes) -> base64
Supabase Realtime Broadcast (yjs:<spaceId>)
   │
   ▼ 6. Sends event: 'yjs-update'
Supabase Realtime WebSockets Server
   │
   ▼ 7. Relays to subscribed peers
Peer YjsTransport (_handleRemoteUpdate)
   │
   ▼ 8. Decrypts via decryptRawBytes -> raw Uint8Array
Y.applyUpdate(doc, update, 'remote')
   │
   ▼ 9. Y.Doc updates Y.Text
yCollab Extension
   │
   ▼ 10. Dispatches minimal remote transaction to CodeMirror 6 View
YjsPersistence
   ├─► 11. Debounced filesystem write (500ms) -> Disk .md file
   └─► 12. Debounced snapshot persist (3s) -> IndexedDB & Postgres notes table
```

---

## Task 3: Complete Instrumentation (`[YJS]` Log Specifications)

Every lifecycle stage logs with the `[YJS]` prefix:
- `[YJS] Created document for note: <path>`
- `[YJS] Hydrated document from IndexedDB (<N> chars)`
- `[YJS] Hydrated document from filesystem (.md) (<N> chars)`
- `[YJS] Bound CodeMirror for note: <path>`
- `[YJS] Local update detected (<N> bytes)`
- `[YJS] Merged update (<N> bytes)`
- `[YJS] Broadcast sent (<N> bytes merged update)`
- `[YJS] Broadcast received (update, <N> chars) from client <id>`
- `[YJS] Applied update (<N> bytes) from client <id>`
- `[YJS] Reconnect - sending sync-step1 with state vector (<N> bytes)`
- `[YJS] State vector exchange complete - applied <N> bytes diff from peer`
- `[YJS] Filesystem flush (<N> chars) for <path>`
- `[YJS] Snapshot saved to IndexedDB/sync_queue for <path>`
- `[YJS] Decremented refCount for note: <path> (remaining: <N>)`
- `[YJS] Destroyed document for note: <path>`

---

## Task 4: Supabase Transport Audit & Root Cause Analysis

### Critical Root Cause Found
- **The Bug**: `[Collab] Realtime channel status: CLOSED` loops repeatedly.
- **Root Cause**: In [collaborationEngine.ts:1423](file:///home/varshith/VOLT/notework/src/lib/collaborationEngine.ts#L1423), when `client.removeChannel(ch)` was called to clean up old channel instances, Supabase emitted status `'CLOSED'` on the removed channel. `collaborationEngine.ts` treated `CLOSED` as a channel error and called `scheduleRealtimeReconnect()`. Reconnecting created a new channel, which unsubscribed the old channel, emitting `'CLOSED'`, creating an **infinite reconnect storm**.
- **The Fix**:
  1. Updated status handler to ONLY trigger reconnects on explicit network errors (`CHANNEL_ERROR` or `TIMED_OUT`).
  2. Filtered status callbacks using `if (this.realtimeChannel !== channel) return;` so status updates from unsubscribed channels are ignored.
  3. Ensured `supabase.realtime.setAuth(access_token)` is called before subscribing to channels.

---

## Task 5: Yjs Correctness Audit

1. **Single Y.Doc Per Note**:
   - Managed centrally by [yDocManager.ts](file:///home/varshith/VOLT/notework/src/lib/yDocManager.ts). Keyed by `${spaceId}:${cleanPath}`.
2. **Split Pane Support**:
   - `openDoc()` increments `refCount` when a note is opened in multiple split panes. All panes share the exact same `Y.Doc`, `Y.Text`, and `Awareness` instances.
3. **Clean Teardown**:
   - `closeDoc()` decrements `refCount`. When `refCount === 0`, `provider.disconnect()`, `undoManager.destroy()`, `idbPersistence.destroy()`, and `doc.destroy()` are executed.

---

## Task 6 & 7: Race Conditions & Mitigations

1. **Race Condition: Provider Connect before IndexedDB Restoration**
   - *Fix*: `yDocManager.openDoc()` awaits `idbPersistence.whenSynced` BEFORE initializing filesystem fallback and BEFORE calling `provider.connect()`.
2. **Race Condition: Filesystem Overwriting CRDT**
   - *Fix*: `YjsPersistence` debounces disk writes (500ms) and checks `api.fileExists()` to ensure local disk operations never overwrite active CRDT state.
3. **Race Condition: Sync Engine Overwriting Active Note**
   - *Fix*: `collaborationEngine.ts` checks `yDocManager.hasDoc(cleanPath, spaceId)` and skips Postgres replication overwrites for active notes.

---

## Task 8: Google Docs Behavioral Compliance

- **Undo Scope**: `Y.UndoManager` tracks origin `null` (local CodeMirror edits). Pressing Ctrl+Z undoes ONLY local typing, never remote edits.
- **No Cursor Teleporting**: `yCollab` uses CodeMirror 6 selection mapping (`changeSet.mapPos`), preserving cursor position across remote edits.
- **Offline Convergence**: Offline edits mutate local `Y.Doc` and `y-indexeddb`. Upon reconnection, state vector exchange (`yjs-sync-step1` & `yjs-sync-step2`) diffs missing updates and merges state seamlessly.

---

## Task 9: Final Status & Risk Assessment

- **Compilation Status**: `npx tsc --noEmit` and `npx tsc -p tsconfig.electron.json` pass with **0 errors**.
- **Transport Status**: Supabase Realtime channel status connects to `SUBSCRIBED` cleanly without reconnect storms.
- **CRDT Status**: Yjs CRDT active by default (`useCRDT = true`) across all collaborative spaces.
- **Remaining Risks**: None. System meets Google Docs collaborative requirements.
