/**
 * Spaces — Type definitions for knowledge spaces
 *
 * A Space is a queryable knowledge layer over the user's entire vault.
 * Notes live in the vault — the Space indexes them automatically.
 * No manual note management needed.
 */

// ── Core Space Model ─────────────────────────────────────────────────────────

export type SpaceVisibility = "local" | "private" | "public";

export interface Space {
  id: string;
  title: string;
  description: string;
  helpsWith: string[];
  visibility: SpaceVisibility;
  ownerId: string;
  /** Number of vault notes indexed at last build */
  noteCount: number;
  createdAt: string;
  updatedAt: string;
  forkedFrom?: string;
  status?: string;
  encryptedSpaceKey?: string | null;
  keySalt?: string | null;
  keyIv?: string | null;
  keyAuthTag?: string | null;
  keyVersion?: number | null;
  encryptionVersion?: number | null;
  keyWrapping?: string | null;
  kdf?: string | null;
  kdfParams?: any;
}

// ── Vector Store Types ───────────────────────────────────────────────────────

export interface SpaceChunk {
  id: string;
  spaceId: string;
  /** Vault-relative note path (e.g. "projects/ideas.md") */
  notePath: string;
  /** Note title extracted from filename */
  noteTitle: string;
  chunkText: string;
  vector: number[];
  startOffset: number;
  endOffset: number;
  noteHash?: string;
}

export interface SpaceVectorIndex {
  spaceId: string;
  chunks: SpaceChunk[];
  updatedAt: string;
}

// ── Space Index (lightweight listing for marketplace) ────────────────────────

export interface SpaceIndexEntry {
  id: string;
  title: string;
  description: string;
  helpsWith: string[];
  visibility: SpaceVisibility;
  ownerId: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
  status?: string;
}

// ── Chat Types ───────────────────────────────────────────────────────────────

export interface SpaceChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<string | {
    noteTitle: string;
    notePath?: string;
    chunkText?: string;
    similarity?: number;
  }>;
  timestamp: number;
}

export interface SpaceConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// ── Remix/Fork Types ─────────────────────────────────────────────────────────

export interface SpaceForkRequest {
  sourceSpaceId: string;
  newTitle: string;
  newDescription?: string;
}
