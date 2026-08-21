# OpenOnyx: Sync & Real-Time Collaboration Technical Specification

## 1. Architectural Principles & Overview

OpenOnyx uses a **local-first architecture**:
1. **Local Primacy**: All read and write operations are executed immediately against the local filesystem (`.md` files) and local IndexedDB. The UI never waits for network requests.
2. **Offline Operating Capacity**: Full editor functionality, search, graph navigation, and note management operate offline without network connection.
3. **Automatic Convergence**: Multi-device and multi-user concurrent edits converge mathematically to identical document states using Conflict-Free Replicated Data Types (**Yjs CRDT**).
4. **End-to-End Encryption (E2EE)**: Private cloud spaces encrypt note content, filenames, and CRDT binary update streams using client-side **AES-256-GCM** before transmission over Supabase.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT NODE                                │
│                                                                         │
│  ┌──────────────────┐      ┌─────────────────┐     ┌─────────────────┐  │
│  │ CodeMirror 6     │ <──> │ Y.Doc (CRDT)    │ <─> │ y-indexeddb     │  │
│  │ Editor View      │      │ Y.Text          │     │ Local IDB       │  │
│  └──────────────────┘      └─────────────────┘     └─────────────────┘  │
│           ▲                         ▲                                   │
│           │                         │                                   │
│           ▼                         ▼                                   │
│  ┌──────────────────┐      ┌─────────────────┐                          │
│  │ Filesystem (.md) │      │ YjsTransport /  │                          │
│  │ Disk Storage     │      │ Crypto Layer    │                          │
│  └──────────────────┘      └─────────────────┘                          │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ Supabase Realtime Broadcast (Encrypted)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SUPABASE BACKEND                              │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌──────────────────────────────┐ │
│  │ Realtime Broadcast / Presence   │   │ Postgres DB (notes, spaces)  │ │
│  └─────────────────────────────────┘   └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

The synchronization and collaboration architecture consists of 6 primary layers:

### Layer 1: Local Database (`src/lib/localdb.ts`)
- Implemented using the `idb` IndexedDB library.
- Stores local vaults, indexed space notes, sync queues, and space encryption keys.
- Key object stores:
  - `notes`: Local cache of space notes (`id`, `space_id`, `path`, `content`, `version`, `content_hash`, `updated_at`).
  - `sync_queue`: Queued mutations (`table`, `operation`, `payload`, `timestamp`) awaiting push to cloud Postgres.
  - `vaults`: Vault metadata and linked cloud space associations.
  - `metadata`: Persistent client identity (`client_id`) and unlocked space encryption keys.

### Layer 2: Encryption Engine (`src/lib/privateCrypto.ts`)
- Client-side cryptographic layer built on Web Crypto API (`crypto.subtle`).
- Provides **AES-256-GCM** authenticated symmetric encryption for private cloud spaces.
- **Space Key Management**:
  - **Password Wrapping**: Space keys wrapped with PBKDF2/Argon2id derived master keys.
  - **RSA-OAEP Keyrings**: Space keys wrapped with 4096-bit RSA public keys for zero-knowledge collaborator invites.
- **Raw Byte Encryption**: Exposes `encryptRawBytes()` and `decryptRawBytes()` for binary Yjs CRDT updates.

### Layer 3: Yjs CRDT Engine (`src/lib/yDocManager.ts`, `src/lib/supabaseProvider.ts`, `src/lib/yjsTransport.ts`, `src/lib/yjsPersistence.ts`)
- Replaces legacy character-offset operation broadcasting with Yjs CRDT.
- **`yDocManager`**:
  - Manages lazy lifecycle of `Y.Doc` instances for active note paths.
  - Maintains `refCount` for split panes sharing the same file.
  - Binds `y-indexeddb` for fast local document restoration.
  - Instantiates local `Y.UndoManager` for user-scoped undo/redo stacks.
- **`YjsTransport`**:
  - Handles Supabase Realtime Broadcast channels (`yjs:<space_id>`).
  - Merges and broadcasts local updates at 50ms intervals (`Y.mergeUpdates()`).
  - Handles peer state vector exchange (`yjs-sync-step1` and `yjs-sync-step2`) on connection/reconnection to compute diffs.
  - Relays Awareness (cursor position, selection, user name, user color).
- **`YjsPersistence`**:
  - Flushes `Y.Text` content to local disk `.md` files at 500ms debounced intervals.
  - Persists snapshots to local IndexedDB and cloud Postgres at 3s debounced intervals.

### Layer 4: Metadata Sync Engine (`src/lib/syncEngine.ts`)
- Handles database-level metadata synchronization between local IndexedDB and Supabase Postgres.
- Runs periodic push/pull cycles for note metadata (titles, paths, deletion status, pinned status, canvas flags).
- Suppresses self-echoes using `last_client_id` tagging.
- Uses `sync_queue` table mutations to ensure zero data loss during network outages.

### Layer 5: Space & Presence Orchestrator (`src/lib/collaborationEngine.ts`)
- Manages vault-to-space mapping (`linked_vaults` table).
- Handles user presence tracking via Supabase Realtime Presence (`channel.track()`).
- Emits presence state events (`onActiveUsersChange`) for titlebar collaborator avatar rendering.
- Manages space invitation lifecycle, role verification, and workspace switching.

### Layer 6: CodeMirror 6 Editor Binding (`src/components/editor/Editor.tsx` & `src/components/layout/LeafPaneEditor.tsx`)
- Integrates `y-codemirror.next`'s `yCollab` extension.
- Binds `Y.Text` directly to CodeMirror 6 `EditorState`.
- Replaces standard CodeMirror `history()` with `yUndoManagerKeymap` so undoing an edit only undoes local edits, never peer edits.
- Renders remote cursors and selection highlights via Awareness protocols.

---

## 3. Real-Time Collaboration Flow (Yjs CRDT)

### Initial Document Load Sequence
```
User opens Note Tab -> LeafPaneEditor
   │
   ├─► 1. Request Y.Doc from yDocManager.openDoc(path, spaceId)
   │      │
   │      ├─► 2. Initialize Y.Doc & Y.Text("content")
   │      ├─► 3. Hydrate state from y-indexeddb (IndexedDB)
   │      └─► 4. If Y.Text is empty, hydrate from local disk file (.md)
   │
   ├─► 5. Instantiate YjsTransport & connect Supabase Broadcast channel
   │      │
   │      └─► 6. Broadcast `yjs-sync-step1` with local State Vector
   │             │
   │             └─► Peer receives step1 -> computes diff -> replies with `yjs-sync-step2`
   │
   └─► 7. Create `yCollab` extension & bind to CodeMirror 6 EditorView
```

### Keystroke Propagation Sequence
```
Local Keystroke in CodeMirror
   │
   ├─► 1. CodeMirror dispatches transaction -> updates Y.Text
   │
   ├─► 2. Y.Doc emits 'update' event (binary Uint8Array)
   │
   ├─► 3. YjsTransport queues update in 50ms batching window
   │
   ├─► 4. Batch timer fires -> Y.mergeUpdates(pending)
   │
   ├─► 5. If Private Space: Encrypt Uint8Array via privateCrypto.encryptRawBytes()
   │
   ├─► 6. Broadcast over Supabase Realtime channel (`event: yjs-update`)
   │
   ├─► 7. Peer receives broadcast -> Decrypts Uint8Array (if private)
   │
   └─► 8. Peer applies update via Y.applyUpdate(doc, update, 'remote')
          │
          └─► yCollab extension updates peer's CodeMirror EditorView cleanly
```

---

## 4. Database Schema

### Supabase Postgres Tables

#### `spaces`
```sql
CREATE TABLE public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `notes`
```sql
CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES public.spaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  content_encrypted TEXT,
  iv TEXT,
  auth_tag TEXT,
  encryption_version INT DEFAULT 1,
  version INT DEFAULT 1,
  content_hash TEXT,
  client_id TEXT,
  last_client_id TEXT,
  last_modified TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  pinned BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false,
  is_canvas BOOLEAN DEFAULT false,
  CONSTRAINT notes_space_path_unique UNIQUE (space_id, path)
);
```

#### `space_collaborators`
```sql
CREATE TABLE public.space_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  joined_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. End-to-End Encryption Spec

For spaces where `visibility === 'private'`:
1. **Plaintext Protection**: Note content is NEVER transmitted or stored in unencrypted form on Supabase servers.
2. **Authenticated Encryption**: Uses AES-256-GCM with 96-bit random IVs and 128-bit authentication tags.
3. **Additional Authenticated Data (AAD)**: Note metadata (`note:<space_id>:<id>:<path>:<version>`) is bound to the ciphertext to prevent ciphertext tampering or swapping attacks.
4. **CRDT Update Encryption**: Yjs binary updates are encrypted as Uint8Array blobs using `privateCrypto.encryptRawBytes(spaceId, bytes, aad)` before being placed on the Realtime Broadcast wire.

---

## 6. Offline Support & Reconnection Protocol

1. **Offline Operations**:
   - Edits update the local `Y.Doc`, local `y-indexeddb`, and the disk file `.md` immediately.
   - Metadata changes (renames, deletes, pins) are queued in local IndexedDB `sync_queue`.
2. **Reconnection Sequence**:
   - Upon network restoration or space focus, `YjsTransport` re-subscribes to the Supabase Realtime channel.
   - Client sends `yjs-sync-step1` containing `Y.encodeStateVector(doc)`.
   - Connected peers compare state vectors and return `yjs-sync-step2` containing only the missing updates.
   - `syncEngine` pushes any pending `sync_queue` database mutations to Postgres.
