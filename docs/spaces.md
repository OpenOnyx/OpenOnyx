# OpenOnyx Spaces Feature Specification

This document provides a comprehensive, pin-to-pin description of the **Spaces** feature in OpenOnyx. It outlines the core architecture, data pipelines, database schemas, synchronization engine, and the visual/interactive design systems that power this local-first knowledge management system.

---

## 1. What is a Space?

A **Space** is a context-aware, queryable knowledge layer constructed over a user's vault notes. Unlike generic folder architectures or tag groupings that require manual organization, a Space automatically indexes and synthesizes notes, allowing the user to converse with their thoughts via an AI-assisted "thinking layer."

OpenOnyx spaces support three visibility levels:
1. **Local**: Stored strictly on the current device within IndexedDB. All AI embedding, indexing, and chat reasoning occur completely offline.
2. **Private**: Automatically backed up to the cloud (Supabase) in the background. Content is fully secure and only accessible by the authenticated owner.
3. **Public**: Synced to the cloud and published to the Explore Marketplace, allowing other OpenOnyx users to discover, upvote, read, and "Remix" (fork) the space into their own vaults.

---

## 2. Core Architecture & Lifecycles

The Spaces system operates as a multi-tier pipeline extending from raw local files to in-browser Web Workers, local databases, and remote cloud databases.

### A. The Automated Indexing Lifecycle
When a space is created or selected, the app initiates an asynchronous indexing process controlled by [spaces-processing.ts](file:///home/varshith/VOLT/notework/src/utils/spaces-processing.ts):
1. **File Tree Scan**: The engine traverses the entire active vault directory, locating all `.md` (Markdown) and `.canvas` (Obsidian Canvas) files.
2. **Content Extraction**: Textual content is read, stripping out heavy formatting while preserving headers, lists, tags, and inline links.
3. **Semantic Chunking**: Long notes are parsed into small, overlapping semantic chunks (average 500-1000 characters) to ensure localized semantic meaning is retained during search.
4. **Local Embedding Generation**: Chunks are processed by a browser-native Web Worker running `@xenova/transformers` loaded with the `all-MiniLM-L6-v2` model. This converts raw text into dense 384-dimensional vector embeddings without sending text to an external API.
5. **Local Storage**: Chunks, metadata, and embeddings are committed to IndexedDB.

### B. The Retrieval-Augmented Generation (RAG) Query Lifecycle
When a user asks a question inside a Space, the AI uses a local-first retrieval loop managed by [spaces-rag.ts](file:///home/varshith/VOLT/notework/src/utils/spaces-rag.ts):
1. **Query Embedding**: The user's prompt is embedded locally using the same Web Worker model.
2. **Semantic Similarity Search**:
   * For **Local Spaces**: The engine runs a local cosine similarity search across all stored chunks in IndexedDB.
   * For **Remote Spaces**: It issues an RPC similarity query (`match_note_chunks`) to the remote Supabase database.
3. **Context Construction**: The top $K$ matching chunks are retrieved, ranked by similarity score, and formatted with clear citation links.
4. **Strict Context Prompting**: The system formats a prompt that binds the AI to prioritize the retrieved context, speak as a "distilled version" of the vault, and avoid hallucinating generic assistant-style answers.
5. **Streaming Generation**: The prompt is dispatched to the chosen LLM provider (configured via OpenAI/OpenRouter APIs), and the response is streamed back character-by-character to the chat window.

---

## 3. Database Schema Definitions

To ensure seamless coordination between offline and online states, both the local database (IndexedDB) and the remote database (Supabase) share structurally symmetric schemas.

### A. Local IndexedDB Schema (`openonyx-local`)
Defined in [localdb.ts](file:///home/varshith/VOLT/notework/src/lib/localdb.ts), the database consists of several primary object stores:
* **`spaces`**: Keyed by `id` (UUID). Contains `title`, `description`, `helps_with` (tags), `note_count`, `visibility` ('local' | 'private' | 'public'), `owner_id`, `created_at`, and `updated_at`.
* **`notes`**: Keyed by `id` (UUID). Tracks note-level metadata, including the parent `space_id`, `title`, `pinned`, `is_canvas`, and `deleted` (for soft-deletions).
* **`note_chunks`**: Keyed by `id` (UUID). Stores raw text `content` and the floating-point `embedding` vector array. Includes an index on `by-note` for cascading deletions.
* **`sync_queue`**: A persistent transaction log storing mutations (`insert`, `update`, `delete`) containing exact payload copies and `retry_count` flags to guarantee delivery.

### B. Supabase Cloud Schema
Defined in [schema.sql](file:///home/varshith/VOLT/notework/supabase/schema.sql), this PostgreSQL database provides cloud-side indexing, RLS, and similarity matching:
* **Soft-Deletes**: The `notes` table contains a `deleted` column. A trigger blocks deleted notes from showing up in vector searches.
* **High-Speed Vector Similarity**: Uses the `pgvector` extension to run fast cosine similarity searches inside PostgreSQL functions:
  * `match_note_chunks`: Similarity matches chunks within a specific space.
  * `match_spaces`: Similarity matches entire public spaces for discovery.

---

## 4. The Resilient Synchronization Engine

The [SyncEngine](file:///home/varshith/VOLT/notework/src/lib/syncEngine.ts) is a robust background process executing the offline-first synchronization logic.

### A. Queue-Based Mutations & Deduplication
Every write operation to the local database is intercepted by the `enqueueChange` helper. The change is stored in `sync_queue` using a unique key (`${table}_${record_id}`). 
Before pushing, `dedupeQueue()` runs to clean up redundant actions:
* If a note has multiple successive local edits, the IndexedDB natural key-overwriting mechanism collapses them into a single `update` item.
* If a note is updated but subsequently deleted, the engine drops all pending `insert`/`update` logs for that record and queues only a single `delete` operation, saving network bandwidth.

### B. Push Synchronization (Local → Cloud)
1. **Intelligent Batching**: Rather than executing one HTTP request per change, the engine groups queued mutations by table and operation, executing bulk `.upsert()` or `.delete().in()` requests.
2. **Local-Only Protection**: The engine detects if resources belong to a space marked `visibility: 'local'`. If so, it purges them from the queue without uploading.
3. **Retry Mechanics & Conflict Preservation**: If an upload fails due to temporary network issues, the items remain in the queue. Unlike simple assistant items, offline edits are preserved indefinitely until connectivity is restored. To handle push conflicts without losing user changes, if a local edit is rejected (due to a newer version or content-hash mismatch on the remote server), the SyncEngine saves a local conflict copy named `Note (conflict).md`, commits it to IndexedDB and the sync queue, and removes the original rejected item from the queue.
4. **Offline Awareness**: The engine monitors `navigator.onLine`. If offline, it pauses sync operations immediately without destroying the transaction queue.

### C. Pull Synchronization (Cloud → Local)
1. **Delta Fetching**: Pull cycles rely on a persisted `last_sync_time` metadata flag. The engine queries only records modified (`updated_at >= last_sync_time`) since the last successful sync.
2. **Last-Write-Wins (LWW) Resolution**: When merging remote records into IndexedDB, the engine compares timestamps. A remote change will only overwrite local data if `remote.updated_at >= local.updated_at`. For collaborative notes managed under Yjs (real-time collaboration), Yjs serves as the source of truth. The LWW pull engine does not overwrite notes that have active Yjs documents (open Y.Docs or local Yjs snapshots in IndexedDB). Changes to these notes are merged and synced peer-to-peer using Yjs updates instead of Postgres LWW.
3. **Cascading Deletions**: When a note is soft-deleted on another client, the pull engine detects `deleted: true` and cascades the deletion down to IndexedDB, dropping all local vector chunks associated with that note.

---

## 5. UI Component Hierarchy

The front-end user experience is managed by two main views within a virtual Tab layer in `App.tsx`:

### A. Spaces Marketplace View
Displays a clean, premium dashboard of all available spaces with features to:
* **Create Spaces**: A modal capturing title, description, tags, and visibility settings.
* **Remix / Fork**: Allows users to duplicate any public space, cloning its note layouts and embeddings into a private local-first duplicate.
* **Account Connectivity**: Shows current connection status, Supabase credentials state, and user auth details.

### B. Space View & Chat Pane
Constructs the interactive workflow inside an active space:
* **Index Progress Bar**: Monitors background parsing and embedding, showing a loading spinner and a progress indicator.
* **Suggested Queries**: Preset tags to help users kickstart their search.
* **Streaming Chat Window**: Rendered in complete Markdown with scrolling hooks to stay aligned during real-time generation.
* **Vault Previews**: Shows list of recent files, enabling users to click and navigate directly to the physical Markdown editor.

---

## 6. Integration Checklist

Local Spaces work without an account or environment configuration. To enable the optional Spaces cloud sync feature in a deployment, ensure that:
1. **Environment Variables**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are defined in your `.env.local`.
2. **Engine Bootstrapping**: Import `syncEngine` inside your main entry file [main.tsx](file:///home/varshith/VOLT/notework/src/main.tsx) to ensure background processes are fully instantiated on startup.
3. **In-UI Status Observers**: Subscribe your interface to `syncEngine.onStatusChange(state)` to render state changes dynamically in the interface.
