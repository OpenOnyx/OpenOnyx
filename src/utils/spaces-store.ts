/**
 * Spaces Store — CRUD for knowledge spaces
 *
 * A Space is a metadata layer over the vault — it doesn't store notes.
 * Notes live in the vault. The Space stores:
 *   - metadata (title, description, helpsWith, visibility, noteCount)
 *   - vector index (for RAG queries)
 *
 * Storage layout (.openobsidian/spaces/):
 *   ├── _index.json          — lightweight listing of all spaces
 *   ├── {space-id}.json      — space metadata
 *   └── {space-id}/
 *       └── vectors.json     — vector index for RAG
 */

import { readData, writeData, deleteData, createDebouncedWriter } from "./disk-store";
import { authManager, AuthRequiredError } from "../lib/auth";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { getUserSupabaseClient } from "../lib/userDatabase";
import { getAPI } from "./api";
import type {
  Space,
  SpaceIndexEntry,
  SpaceVectorIndex,
  SpaceVisibility,
  SpaceChunk,
} from "../types/spaces";

// ── Helpers ──────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";

function generateId(): string {
  return uuidv4();
}

function getClient() {
  return getUserSupabaseClient() || supabase;
}

function normalizeVisibility(value: string | null | undefined): SpaceVisibility {
  if (value === "public" || value === "private" || value === "local") return value;
  return "local";
}

function toIndexEntry(space: Space): SpaceIndexEntry {
  return {
    id: space.id,
    title: space.title,
    description: space.description,
    helpsWith: space.helpsWith || [],
    visibility: space.visibility,
    ownerId: space.ownerId,
    noteCount: space.noteCount || 0,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    status: space.status,
  };
}

type RemoteSpaceRow = {
  id: string;
  title: string;
  description: string | null;
  helps_with: string[] | null;
  owner_id: string;
  visibility: string | null;
  is_public: boolean;
  forked_from: string | null;
  created_at: string;
  updated_at: string;
  status: string | null;
};

function mapRemoteToSpace(remote: RemoteSpaceRow, noteCount: number = 0): Space {
  const visibility = normalizeVisibility(remote.visibility) === "local"
    ? (remote.is_public ? "public" : "private")
    : normalizeVisibility(remote.visibility);

  return {
    id: remote.id,
    title: remote.title,
    description: remote.description || "",
    helpsWith: remote.helps_with || [],
    visibility,
    ownerId: remote.owner_id,
    noteCount,
    createdAt: remote.created_at,
    updatedAt: remote.updated_at,
    forkedFrom: remote.forked_from || undefined,
    status: remote.status || 'ready',
  };
}

async function upsertCloudSpace(space: Space): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.");
  }

  const { error } = await getClient()
    .from("spaces")
    .upsert(
      {
        id: space.id,
        owner_id: space.ownerId,
        title: space.title,
        description: space.description || null,
        helps_with: space.helpsWith,
        visibility: space.visibility,
        is_public: space.visibility === "public",
        forked_from: space.forkedFrom || null,
        created_at: space.createdAt,
        updated_at: space.updatedAt,
        status: space.status || 'ready',
      },
      { onConflict: "id" },
    );

  if (error) throw error;
}

/**
 * Push all vault notes for a space into Supabase's `notes` table.
 * Called after indexing when the space is not local.
 * Each vault note becomes a row in the cloud notes table.
 */
export async function pushSpaceNotes(
  spaceId: string,
  vaultNotes: { path: string; title: string; content: string; is_canvas?: boolean }[],
): Promise<void> {
  if (!isSupabaseConfigured || !authManager.isLoggedIn()) {
    console.warn('[SpacesStore] pushSpaceNotes skipped: Supabase not configured or not logged in');
    return;
  }

  const spaceData = await getSpace(spaceId);
  if (spaceData && spaceData.visibility === 'private') {
    console.log('[SpacesStore] pushSpaceNotes skipped: private E2EE space.');
    return;
  }

  console.log(`[SpacesStore] Pushing ${vaultNotes.length} notes to space ${spaceId}`);
  const now = new Date().toISOString();

  // Batch upsert in groups of 50 to avoid payload limits
  const BATCH_SIZE = 50;
  let totalInserted = 0;

  for (let i = 0; i < vaultNotes.length; i += BATCH_SIZE) {
    const batch = vaultNotes.slice(i, i + BATCH_SIZE).map((note) => ({
      // Deterministic ID from space + path so re-indexing upserts cleanly
      id: generateDeterministicId(spaceId, note.path),
      space_id: spaceId,
      title: note.title,
      path: note.path,
      content: note.content,
      pinned: false,
      created_at: now,
      updated_at: now,
      deleted: false,
      is_canvas: note.is_canvas || false,
    }));

    const { error } = await getClient()
      .from("notes")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(`[SpacesStore] Batch ${i / BATCH_SIZE + 1} failed:`, error.message || error.code || error.hint || JSON.stringify(error));
      // Try individual inserts as fallback
      let singles = 0;
      for (const row of batch) {
        const { error: singleErr } = await getClient().from("notes").upsert(row, { onConflict: "id" });
        if (!singleErr) singles++;
        else console.error(`[SpacesStore] Single insert failed for ${row.path}:`, singleErr.message || JSON.stringify(singleErr));
      }
      totalInserted += singles;
    } else {
      totalInserted += batch.length;
    }
  }

  console.log(`[SpacesStore] Push complete: ${totalInserted}/${vaultNotes.length} notes`);
}

/**
 * Pushes vector chunks to the cloud note_chunks table.
 */
export async function pushSpaceChunks(
  spaceId: string,
  chunks: SpaceChunk[],
): Promise<void> {
  if (!isSupabaseConfigured || !authManager.isLoggedIn()) return;

  const spaceData = await getSpace(spaceId);
  if (spaceData && spaceData.visibility === 'private') {
    console.log('[SpacesStore] pushSpaceChunks skipped: private E2EE space.');
    return;
  }

  // 1. Delete old chunks for this space to avoid duplicates
  await getClient()
    .from("note_chunks")
    .delete()
    .eq("space_id", spaceId);

  const BATCH_SIZE = 50;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE).map((chunk) => ({
      space_id: spaceId,
      note_id: generateDeterministicId(spaceId, chunk.notePath),
      content: chunk.chunkText,
      embedding: `[${chunk.vector.join(",")}]`,
    }));

    const { error } = await getClient()
      .from("note_chunks")
      .insert(batch);

    if (error) {
      console.error(`[SpacesStore] Failed to push chunks batch ${i}: ${JSON.stringify(error)}`);
    }
  }
}

/**
 * Generate a deterministic UUID v5-style ID from space ID + note path.
 * This ensures re-indexing upserts the same rows rather than creating duplicates.
 */
function generateDeterministicId(spaceId: string, notePath: string): string {
  const input = `${spaceId}:${notePath}`;
  // Simple hash-based UUID generation (not cryptographic, just deterministic)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  // Convert to a UUID-like format using the hash, ensuring exact segment lengths
  const h1 = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  const h2 = Math.abs(hash * 31).toString(16).padStart(8, '0').slice(0, 8);
  const h3 = Math.abs(hash * 37).toString(16).padStart(8, '0').slice(0, 8);
  const h4 = Math.abs(hash * 41).toString(16).padStart(8, '0').slice(0, 8);

  // Format: 8-4-4-4-12
  return `${h1}-${h2.slice(0, 4)}-4${h2.slice(5, 8)}-${h3.slice(0, 4)}-${h4}${h1.slice(0, 4)}`;
}

async function fetchRemoteSpaces(): Promise<SpaceIndexEntry[]> {
  if (!isSupabaseConfigured) return [];

  const rawSpaces: RemoteSpaceRow[] = [];

  // 1. Fetch public spaces
  const { data: publicSpaces, error: publicErr } = await getClient()
    .from("spaces")
    .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at, status")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false });

  if (publicErr) {
    console.error("[SpacesStore] Failed to fetch public spaces:", publicErr);
  } else if (publicSpaces) {
    rawSpaces.push(...(publicSpaces as RemoteSpaceRow[]));
  }

  // 2. Fetch private spaces if logged in
  if (authManager.isLoggedIn()) {
    const userId = authManager.getUserId();
    if (userId) {
      const { data: ownSpaces, error: ownErr } = await getClient()
        .from("spaces")
        .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at, status")
        .eq("owner_id", userId)
        .eq("visibility", "private")
        .order("updated_at", { ascending: false });

      if (ownErr) {
        console.error("[SpacesStore] Failed to fetch own spaces:", ownErr);
      } else if (ownSpaces) {
        for (const s of ownSpaces) {
          if (!rawSpaces.find(rs => rs.id === s.id)) {
            rawSpaces.push(s as RemoteSpaceRow);
          }
        }
      }

      // 2b. Fetch spaces where user is a collaborator
      const { data: collabRelations, error: collabRelationsErr } = await getClient()
        .from("space_collaborators")
        .select("space_id")
        .eq("user_id", userId);

      if (collabRelationsErr) {
        console.error("[SpacesStore] Failed to fetch collaborator spaces:", collabRelationsErr);
      } else if (collabRelations && collabRelations.length > 0) {
        const collabSpaceIds = collabRelations.map(cr => cr.space_id);
        const { data: collabSpaces, error: collabSpacesErr } = await getClient()
          .from("spaces")
          .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at, status")
          .in("id", collabSpaceIds);

        if (collabSpacesErr) {
          console.error("[SpacesStore] Failed to fetch collaborator spaces details:", collabSpacesErr);
        } else if (collabSpaces) {
          for (const s of collabSpaces) {
            if (!rawSpaces.find(rs => rs.id === s.id)) {
              rawSpaces.push(s as RemoteSpaceRow);
            }
          }
        }
      }
    }
  }

  // 3. Fetch note counts for each space
  const countMap: Record<string, number> = {};
  await Promise.all(rawSpaces.map(async (row) => {
    try {
      const { count, error: countErr } = await getClient()
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("space_id", row.id)
        .eq("deleted", false);
      
      if (!countErr && count !== null) {
        countMap[row.id] = count;
      }
    } catch {
      // Silent fallback to 0
    }
  }));

  const results: SpaceIndexEntry[] = rawSpaces.map(row =>
    toIndexEntry(mapRemoteToSpace(row, countMap[row.id] || 0))
  );

  // Sort by most recently updated
  const finalResults = results.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (finalResults.length > 0) {
    console.log(`[SpacesStore] Fetched ${finalResults.length} remote spaces.`);
  }

  return finalResults;
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let _indexCache: SpaceIndexEntry[] | null = null;
const _spaceCache = new Map<string, Space>();
const _debouncedWrite = createDebouncedWriter(800);

// ── Index operations ─────────────────────────────────────────────────────────

async function loadIndex(): Promise<SpaceIndexEntry[]> {
  if (_indexCache) return _indexCache;
  const data = await readData<SpaceIndexEntry[]>("spaces/_index.json");
  _indexCache = (data || []).map((entry) => ({
    ...entry,
    helpsWith: entry.helpsWith || [],
    visibility: normalizeVisibility((entry as any).visibility),
    ownerId: (entry as any).ownerId || "local",
  }));
  return _indexCache;
}

async function saveIndex(entries: SpaceIndexEntry[]): Promise<void> {
  _indexCache = entries;
  await writeData("spaces/_index.json", entries);
}

async function upsertIndexEntry(entry: SpaceIndexEntry): Promise<void> {
  const index = await loadIndex();
  const idx = index.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    index[idx] = entry;
  } else {
    index.push(entry);
  }
  await saveIndex(index);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<SpaceIndexEntry[]> {
  const localEntries = await loadIndex();
  const merged = new Map<string, SpaceIndexEntry>(localEntries.map((entry) => [entry.id, entry]));

  const remoteEntries = await fetchRemoteSpaces();
  for (const remote of remoteEntries) {
    const existing = merged.get(remote.id);
    // For remote spaces, the cloud note count is the source of truth
    merged.set(remote.id, {
      ...remote,
      noteCount: remote.noteCount > 0 ? remote.noteCount : (existing?.noteCount ?? 0),
    });
  }

  const result = Array.from(merged.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  _indexCache = result;
  return result;
}

export async function getSpace(id: string): Promise<Space | null> {
  const cached = _spaceCache.get(id);
  if (cached) return cached;

  const localSpace = await readData<Space>(`spaces/${id}.json`);
  let space: Space | null = null;

  if (localSpace) {
    space = {
      ...localSpace,
      description: localSpace.description || "",
      helpsWith: localSpace.helpsWith || [],
      visibility: normalizeVisibility((localSpace as any).visibility),
      ownerId: (localSpace as any).ownerId || "local",
      noteCount: localSpace.noteCount || 0,
    };
  }

  // If it's potentially a cloud space, fetch fresh metadata
  if (isSupabaseConfigured && (!space || space.visibility !== "local")) {
    try {
      const { data: remote } = await getClient()
        .from("spaces")
        .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at")
        .eq("id", id)
        .single();

      if (remote) {
        // Fetch accurate count
        const { count } = await getClient()
          .from("notes")
          .select("*", { count: "exact", head: true })
          .eq("space_id", id)
          .eq("deleted", false);

        const remoteSpace = mapRemoteToSpace(remote as RemoteSpaceRow, count || 0);
        
        if (space) {
          space = { ...space, ...remoteSpace };
        } else {
          space = remoteSpace;
        }
      }
    } catch (err) {
      console.warn(`[SpacesStore] Failed to fetch remote metadata for ${id}:`, err);
    }
  }

  if (space) {
    _spaceCache.set(id, space);
  }
  return space;
}

export async function createSpace(data: {
  title: string;
  description: string;
  helpsWith: string[];
  noteCount?: number;
  visibility?: SpaceVisibility;
  forkedFrom?: string;
}): Promise<Space> {
  const now = new Date().toISOString();
  const visibility = data.visibility || "local";

  let ownerId = "local";
  if (visibility !== "local") {
    if (!isSupabaseConfigured) {
      throw new Error("Cloud spaces require Supabase configuration. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.");
    }
    const user = authManager.requireAuth();
    ownerId = user.id;
  }

  const space: Space = {
    id: generateId(),
    title: data.title,
    description: data.description,
    helpsWith: data.helpsWith,
    visibility,
    ownerId,
    noteCount: data.noteCount || 0,
    createdAt: now,
    updatedAt: now,
    forkedFrom: data.forkedFrom,
  };

  if (space.visibility !== "local") {
    await upsertCloudSpace(space);
    try {
      await getClient().from("space_collaborators").insert({
        space_id: space.id,
        user_id: ownerId,
        role: "owner",
      });
    } catch (collabErr) {
      console.warn("[SpacesStore] Failed to add owner as collaborator:", collabErr);
    }
  }

  await writeData(`spaces/${space.id}.json`, space);
  _spaceCache.set(space.id, space);
  await upsertIndexEntry(toIndexEntry(space));

  return space;
}

export async function updateSpace(
  id: string,
  patch: Partial<Omit<Space, "id" | "createdAt">>,
): Promise<Space | null> {
  const space = await getSpace(id);
  if (!space) return null;

  let ownerId = patch.ownerId ?? space.ownerId;
  const visibility = patch.visibility ?? space.visibility;

  if (visibility !== "local" && ownerId === "local") {
    const user = authManager.getUser();
    if (!user) {
      throw new AuthRequiredError("You must be logged in to update cloud spaces.");
    }
    ownerId = user.id;
  }

  const updated: Space = {
    ...space,
    ...patch,
    ownerId,
    visibility,
    updatedAt: new Date().toISOString(),
  };

  if (updated.visibility !== "local" && authManager.isLoggedIn()) {
    await upsertCloudSpace(updated);
  }

  await writeData(`spaces/${id}.json`, updated);
  _spaceCache.set(id, updated);
  await upsertIndexEntry(toIndexEntry(updated));

  return updated;
}

export async function deleteSpace(id: string): Promise<void> {
  const existing = await getSpace(id);
  if (!existing) throw new Error("Space not found.");

  // ── Permission checks based on visibility ──
  if (existing.visibility !== "local") {
    // Cloud spaces (private / public): require login + ownership
    if (!authManager.isLoggedIn()) {
      throw new AuthRequiredError("Sign in to delete cloud spaces.");
    }
    const userId = authManager.getUserId();
    if (!userId || existing.ownerId !== userId) {
      throw new Error("You can only delete spaces you own.");
    }
    // Remove from cloud with owner guard
    if (isSupabaseConfigured) {
      const { error } = await getClient()
        .from("spaces")
        .delete()
        .eq("id", id)
        .eq("owner_id", userId);
      if (error) throw error;
    }
  }
  // Local spaces are always deletable — they belong to this vault.

  // ── Remove local data ──
  await deleteData(`spaces/${id}.json`);
  await deleteData(`spaces/${id}/vectors.json`);
  await deleteData(`spaces/${id}/chat.json`);
  
  // Clean up all conversation logs and their index file
  try {
    const convs = await loadSpaceConversations(id);
    for (const c of convs) {
      await deleteSpaceConversationMessages(id, c.id);
    }
  } catch { /* ignore */ }
  await deleteData(`spaces/${id}/conversations.json`);

  _spaceCache.delete(id);

  const index = await loadIndex();
  const filtered = index.filter((e) => e.id !== id);
  await saveIndex(filtered);
}

// ── Fork / Remix ─────────────────────────────────────────────────────────────

/**
 * Fork / Remix a space.
 *
 * Rules:
 *  - Remixed spaces ALWAYS start as LOCAL (user can publish later).
 *  - If the source's vector index exists locally, it is copied.
 *    (For Explore forks, the index won't exist locally — expected.)
 *  - Returns the new Space object saved to the vault.
 */
export async function forkSpace(
  sourceId: string,
  overrides?: { title?: string; description?: string },
): Promise<Space | null> {
  const source = await getSpace(sourceId);
  if (!source) return null;

  const forkedSpace = await createSpace({
    title: overrides?.title || `${source.title} (Remix)`,
    description: overrides?.description || source.description,
    helpsWith: [...(source.helpsWith || [])],
    noteCount: source.noteCount,
    visibility: "local",
    forkedFrom: source.id,
  });

  // 1. Download notes from Supabase if the source is not local
  if (source.visibility !== "local" && isSupabaseConfigured) {
    try {
      const { data: cloudNotes } = await getClient()
        .from("notes")
        .select("path, title, content, created_at, is_canvas")
        .eq("space_id", source.id)
        .eq("deleted", false);

      if (cloudNotes && cloudNotes.length > 0) {
        const api = getAPI();
        const originalSpaceFolder = `Spaces/${source.title.replace(/[\\/:*?"<>|]/g, "")}`;
        const newSpaceFolder = `Spaces/${forkedSpace.title.replace(/[\\/:*?"<>|]/g, "")}`;
        await api.createDirectory(newSpaceFolder);

        const stripSpacePrefix = (path: string, spaceTitle: string): string => {
          const exactPrefix = `Spaces/${spaceTitle.replace(/[\\/:*?"<>|]/g, "")}/`;
          if (path.startsWith(exactPrefix)) {
            return path.slice(exactPrefix.length);
          }
          if (path.startsWith("Spaces/")) {
            const parts = path.split("/");
            if (parts.length > 2) {
              return parts.slice(2).join("/");
            }
          }
          return path;
        };

        for (const note of cloudNotes) {
          let subPath = "";
          if (note.path && note.path.trim() !== "") {
            subPath = stripSpacePrefix(note.path, source.title);
          } else {
            const extension = (note as any).is_canvas ? ".canvas" : ".md";
            subPath = `${note.title.replace(/[\\/:*?"<>|]/g, "")}${extension}`;
          }

          const targetNotePath = `${newSpaceFolder}/${subPath}`;

          // Create necessary subdirectories via the API before creating file
          if (subPath.includes("/")) {
            const parts = subPath.split("/");
            parts.pop(); // remove file name
            let currentPath = newSpaceFolder;
            for (const part of parts) {
              currentPath = `${currentPath}/${part}`;
              try {
                await api.createDirectory(currentPath);
              } catch (e) {
                // Ignore if directory already exists
              }
            }
          }

          await api.writeFile(targetNotePath, note.content);
        }
      }
    } catch (err) {
      console.error("[SpacesStore] Failed to download notes for remix:", err);
    }
  }

  // 2. Copy the source's vector index if available locally
  try {
    const sourceIndex = await loadVectorIndex(sourceId);
    if (sourceIndex && sourceIndex.chunks.length > 0) {
      const forkedIndex: SpaceVectorIndex = {
        spaceId: forkedSpace.id,
        chunks: sourceIndex.chunks.map((chunk, i) => ({
          ...chunk,
          id: `chunk-${i}-${Date.now()}`,
          spaceId: forkedSpace.id,
        })),
        updatedAt: new Date().toISOString(),
      };
      await saveVectorIndex(forkedIndex);
    }
  } catch {
    // Source vector index not available — expected for fresh cloud remixes
  }

  return forkedSpace;
}

// ── Vector Index ─────────────────────────────────────────────────────────────

export async function loadVectorIndex(
  spaceId: string,
): Promise<SpaceVectorIndex | null> {
  return readData<SpaceVectorIndex>(`spaces/${spaceId}/vectors.json`);
}

export async function saveVectorIndex(index: SpaceVectorIndex): Promise<void> {
  _debouncedWrite(`spaces/${index.spaceId}/vectors.json`, index);
}

export function clearCache(): void {
  _indexCache = null;
  _spaceCache.clear();
}

// ── Chat History Store ───────────────────────────────────────────────────────

import type { SpaceChatMessage, SpaceConversation } from "../types/spaces";

export async function loadSpaceChat(
  spaceId: string,
): Promise<SpaceChatMessage[]> {
  const data = await readData<SpaceChatMessage[]>(`spaces/${spaceId}/chat.json`);
  return data || [];
}

export async function saveSpaceChat(
  spaceId: string,
  messages: SpaceChatMessage[],
): Promise<void> {
  await writeData(`spaces/${spaceId}/chat.json`, messages);
}

export async function loadSpaceConversations(
  spaceId: string,
): Promise<SpaceConversation[]> {
  const data = await readData<SpaceConversation[]>(`spaces/${spaceId}/conversations.json`);
  return data || [];
}

export async function saveSpaceConversations(
  spaceId: string,
  conversations: SpaceConversation[],
): Promise<void> {
  await writeData(`spaces/${spaceId}/conversations.json`, conversations);
}

export async function loadSpaceConversationMessages(
  spaceId: string,
  conversationId: string,
): Promise<SpaceChatMessage[]> {
  const data = await readData<SpaceChatMessage[]>(`spaces/${spaceId}/chats/${conversationId}.json`);
  return data || [];
}

export async function saveSpaceConversationMessages(
  spaceId: string,
  conversationId: string,
  messages: SpaceChatMessage[],
): Promise<void> {
  await writeData(`spaces/${spaceId}/chats/${conversationId}.json`, messages);
}

export async function deleteSpaceConversationMessages(
  spaceId: string,
  conversationId: string,
): Promise<void> {
  await deleteData(`spaces/${spaceId}/chats/${conversationId}.json`);
}
