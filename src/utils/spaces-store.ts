/**
 * Spaces Store — CRUD for knowledge spaces
 *
 * A Space is a metadata layer over the vault — it doesn't store notes.
 * Notes live in the vault. The Space stores:
 *   - metadata (title, description, helpsWith, visibility, noteCount)
 *   - vector index (for RAG queries)
 *
 * Storage layout (.openonyx/spaces/):
 *   ├── _index.json          — lightweight listing of all spaces
 *   ├── {space-id}.json      — space metadata
 *   └── {space-id}/
 *       └── vectors.json     — vector index for RAG
 */

import { readData, writeData, deleteData, createDebouncedWriter } from "./disk-store";
import { authManager, AuthRequiredError } from "../lib/auth";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { getAPI } from "./api";
import { isPrivateCloudSpace, privateCrypto } from "../lib/privateCrypto";
import { formatSupabaseError } from "../lib/supabaseError";
import { generateDeterministicId } from "./space-ids";
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
  return supabase;
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
  encrypted_space_key?: string | null;
  key_salt?: string | null;
  key_iv?: string | null;
  key_auth_tag?: string | null;
  key_version?: number | null;
  encryption_version?: number | null;
  key_wrapping?: string | null;
  kdf?: string | null;
  kdf_params?: any;
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
    encryptedSpaceKey: remote.encrypted_space_key || null,
    keySalt: remote.key_salt || null,
    keyIv: remote.key_iv || null,
    keyAuthTag: remote.key_auth_tag || null,
    keyVersion: remote.key_version || null,
    encryptionVersion: remote.encryption_version || null,
    keyWrapping: remote.key_wrapping || null,
    kdf: remote.kdf || null,
    kdfParams: remote.kdf_params || null,
  };
}

async function upsertCloudSpace(space: Space): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Add credentials in Settings > Database.");
  }

  // Verify we have an active auth session before making the request
  const client = getClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    console.error('[SpacesStore] upsertCloudSpace: No active auth session! auth.uid() will be null, RLS will reject.');
    throw new Error('You must be logged in to save cloud spaces. Please sign in and try again.');
  }

  const { error } = await client
    .from("spaces" as any)
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
        encrypted_space_key: space.encryptedSpaceKey || null,
        key_salt: space.keySalt || null,
        key_iv: space.keyIv || null,
        key_auth_tag: space.keyAuthTag || null,
        key_version: space.keyVersion ?? 1,
        encryption_version: space.encryptionVersion || null,
        key_wrapping: space.keyWrapping || null,
        kdf: space.kdf || null,
        kdf_params: space.kdfParams || null,
      },
      { onConflict: "id" },
    );

  if (error) throw new Error(formatSupabaseError(error, "Failed to save cloud space."));
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

  console.log(`[SpacesStore] Pushing ${vaultNotes.length} notes to space ${spaceId}`);
  const now = new Date().toISOString();
  const space = await getSpace(spaceId);
  const shouldEncrypt = isPrivateCloudSpace({
    visibility: space?.visibility,
    is_public: space?.visibility === "public",
  });
  if (shouldEncrypt && !privateCrypto.isUnlocked(spaceId)) {
    throw new Error("Unlock this private space before uploading encrypted notes.");
  }

  // Batch upsert in groups of 50 to avoid payload limits
  const BATCH_SIZE = 50;
  let totalInserted = 0;

  for (let i = 0; i < vaultNotes.length; i += BATCH_SIZE) {
    const batch = await Promise.all(vaultNotes.slice(i, i + BATCH_SIZE).map(async (note) => {
      const id = generateDeterministicId(spaceId, note.path);
      const encrypted = shouldEncrypt
        ? await privateCrypto.encryptNoteContent(spaceId, {
            id,
            path: note.path,
            version: 0,
            content: note.content,
          })
        : { content: note.content };
      return {
      // Deterministic ID from space + path so re-indexing upserts cleanly
      id,
      space_id: spaceId,
      title: note.title,
      path: note.path,
      ...encrypted,
      pinned: false,
      created_at: now,
      updated_at: now,
      deleted: false,
      is_canvas: note.is_canvas || false,
      };
    }));

    const { error } = await getClient()
      .from("notes" as any)
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(`[SpacesStore] Batch ${i / BATCH_SIZE + 1} failed:`, formatSupabaseError(error));
      // Try individual inserts as fallback
      let singles = 0;
      for (const row of batch) {
        const { error: singleErr } = await getClient().from("notes" as any).upsert(row, { onConflict: "id" });
        if (!singleErr) singles++;
        else console.error(`[SpacesStore] Single insert failed for ${row.path}:`, formatSupabaseError(singleErr));
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
  const space = await getSpace(spaceId);
  if (space?.visibility === "private") {
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
      console.error(`[SpacesStore] Failed to push chunks batch ${i}: ${formatSupabaseError(error)}`);
    }
  }
}

async function fetchRemoteSpaces(): Promise<SpaceIndexEntry[]> {
  if (!isSupabaseConfigured) return [];
  if (!authManager.isLoggedIn()) return [];

  const userId = authManager.getUserId();
  if (!userId) return [];

  // Fetch all remote spaces owned by the current user (both public and private)
  const { data: ownSpaces, error: ownErr } = await getClient()
    .from("spaces" as any)
    .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at, status, encrypted_space_key, key_salt, key_iv, key_auth_tag, key_version, encryption_version, key_wrapping, kdf, kdf_params")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });

  if (ownErr) {
    console.error("[SpacesStore] Failed to fetch own spaces:", ownErr);
    return [];
  }

  const rawSpaces = (ownSpaces || []) as unknown as RemoteSpaceRow[];

  // Fetch note counts for each space
  const countMap: Record<string, number> = {};
  await Promise.all(rawSpaces.map(async (row) => {
    try {
      const { count, error: countErr } = await getClient()
        .from("notes" as any)
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
        .from("spaces" as any)
        .select("id, title, description, helps_with, owner_id, visibility, is_public, forked_from, created_at, updated_at, encrypted_space_key, key_salt, key_iv, key_auth_tag, key_version, encryption_version, key_wrapping, kdf, kdf_params")
        .eq("id", id)
        .single();

      if (remote) {
        // Fetch accurate count
        const { count } = await getClient()
          .from("notes" as any)
          .select("*", { count: "exact", head: true })
          .eq("space_id", id)
          .eq("deleted", false);

        const remoteSpace = mapRemoteToSpace(remote as unknown as RemoteSpaceRow, count || 0);
        
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
  encryptionPassword?: string;
}): Promise<Space> {
  const now = new Date().toISOString();
  const visibility = data.visibility || "local";

  let ownerId = "local";
  if (visibility !== "local") {
    if (!isSupabaseConfigured) {
      throw new Error("Cloud spaces require Supabase configuration. Add credentials in Settings > Database.");
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
    if (space.visibility === "private") {
      if (!data.encryptionPassword) {
        throw new Error("Encryption password is required for private cloud spaces.");
      }
      await privateCrypto.ensureUserKeyring();
      const { raw } = await privateCrypto.generateSpaceKey();
      const wrapped = await privateCrypto.wrapSpaceKeyWithPassword(raw, data.encryptionPassword);
      await privateCrypto.unlockWithRawKey(space.id, raw);
      Object.assign(space, {
        encryptedSpaceKey: wrapped.encrypted_space_key,
        keySalt: wrapped.key_salt || null,
        keyIv: wrapped.key_iv,
        keyAuthTag: wrapped.key_auth_tag,
        keyVersion: wrapped.key_version,
        encryptionVersion: wrapped.encryption_version,
        keyWrapping: wrapped.key_wrapping,
        kdf: wrapped.kdf || null,
        kdfParams: wrapped.kdf_params || null,
      });
    }
    await upsertCloudSpace(space);
    let memberWrapped: any = null;
    if (space.visibility === "private") {
      const raw = privateCrypto.getRawSpaceKey(space.id);
      if (raw) {
        try {
          memberWrapped = await privateCrypto.wrapSpaceKeyForUser(raw, ownerId);
        } catch {
          memberWrapped = null;
        }
      }
    }
    try {
      await getClient().from("space_collaborators" as any).insert({
        space_id: space.id,
        user_id: ownerId,
        role: "owner",
        encrypted_space_key: memberWrapped?.encrypted_space_key || null,
        key_iv: memberWrapped?.key_iv || null,
        key_auth_tag: memberWrapped?.key_auth_tag || null,
        key_version: memberWrapped?.key_version || null,
        encryption_version: memberWrapped?.encryption_version || null,
        key_wrapping: memberWrapped?.key_wrapping || null,
        invited_at: now,
        accepted_at: now,
      } as any);
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
        .from("spaces" as any)
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
  onProgress?: (done: number, total: number) => void,
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
        .from("notes" as any)
        .select("path, title, content, created_at, is_canvas")
        .eq("space_id", source.id)
        .eq("deleted", false);

      if (cloudNotes && cloudNotes.length > 0) {
        const total = cloudNotes.length;
        if (onProgress) onProgress(0, total);

        const api = getAPI();
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

        // Pre-scan directories to create them in order
        const directoriesToCreate = new Set<string>();
        const notesToCreate = [];

        for (const note of cloudNotes as any[]) {
          let subPath = "";
          if (note.path && note.path.trim() !== "") {
            subPath = stripSpacePrefix(note.path, source.title);
          } else {
            const extension = (note as any).is_canvas ? ".canvas" : ".md";
            subPath = `${note.title.replace(/[\\/:*?"<>|]/g, "")}${extension}`;
          }

          const targetNotePath = `${newSpaceFolder}/${subPath}`;
          notesToCreate.push({ targetNotePath, content: note.content });

          if (subPath.includes("/")) {
            const parts = subPath.split("/");
            parts.pop(); // Remove filename
            let currentPath = newSpaceFolder;
            for (const part of parts) {
              currentPath = `${currentPath}/${part}`;
              directoriesToCreate.add(currentPath);
            }
          }
        }

        // Create directories sequentially (usually very small in count and very fast)
        const sortedDirs = Array.from(directoriesToCreate).sort((a, b) => a.length - b.length);
        for (const dir of sortedDirs) {
          try {
            await api.createDirectory(dir);
          } catch (e) {
            // Ignore if directory already exists
          }
        }

        // Write files in parallel batches of 15 to prevent resource exhaustion while maximizing I/O speed
        const concurrency = 15;
        let done = 0;
        const chunks = [];
        for (let i = 0; i < notesToCreate.length; i += concurrency) {
          chunks.push(notesToCreate.slice(i, i + concurrency));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (note) => {
              await api.writeFile(note.targetNotePath, note.content);
              done++;
            })
          );
          if (onProgress) onProgress(done, total);
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
