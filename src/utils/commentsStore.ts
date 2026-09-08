import { v4 as uuidv4 } from "uuid";
import { readData, writeData } from "./disk-store";
import { authManager } from "../lib/auth";
import type { NoteComment, CommentAuthor, CommentReply } from "../types/comments";

const STORAGE_FILE = "comments.json";
const LOCAL_STORAGE_PREFIX = "openonyx:comments:";
const COMMENTS_EVENT = "openonyx:comments-changed";

// In-memory cache: notePath -> NoteComment[]
const commentsCache = new Map<string, NoteComment[]>();
let isDiskLoaded = false;
let allDiskComments: Record<string, NoteComment[]> = {};

export function getCurrentUser(): CommentAuthor {
  if (typeof window !== "undefined") {
    const customName = localStorage.getItem("openonyx:user_name");
    const customAvatar = localStorage.getItem("openonyx:user_avatar");
    if (customName) {
      return {
        name: customName,
        avatar: customAvatar || "/default-avatar.png",
      };
    }
  }

  const authUser = authManager.getUser();
  if (authUser) {
    const meta = authUser.user_metadata;
    const name =
      meta?.full_name ||
      meta?.name ||
      authUser.email?.split("@")[0] ||
      "Varshith Programmer";
    const avatar = meta?.avatar_url || "/default-avatar.png";
    return { name, avatar };
  }

  return {
    name: "Varshith Programmer",
    avatar: "/default-avatar.png",
  };
}

export function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Synchronously get comments for a note from in-memory cache or localStorage.
 * Used for zero-delay initial rendering.
 */
export function getCommentsSync(notePath: string): NoteComment[] {
  if (!notePath) return [];
  if (commentsCache.has(notePath)) {
    return commentsCache.get(notePath)!;
  }
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + notePath);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          commentsCache.set(notePath, parsed);
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return [];
}

/**
 * Asynchronously load comments for a note from diskStore or localStorage.
 */
export async function loadComments(notePath: string): Promise<NoteComment[]> {
  if (!notePath) return [];

  if (!isDiskLoaded) {
    try {
      const diskData = await readData<Record<string, NoteComment[]>>(STORAGE_FILE);
      if (diskData && typeof diskData === "object") {
        allDiskComments = diskData;
        for (const [path, list] of Object.entries(diskData)) {
          if (Array.isArray(list)) {
            commentsCache.set(path, list);
          }
        }
      }
    } catch (e) {
      console.warn("[CommentsStore] Error reading comments from disk:", e);
    }
    isDiskLoaded = true;
  }

  if (commentsCache.has(notePath)) {
    return commentsCache.get(notePath)!;
  }

  return getCommentsSync(notePath);
}

/**
 * Save comments for a note to in-memory cache, localStorage, and diskStore.
 */
export async function saveComments(
  notePath: string,
  comments: NoteComment[]
): Promise<void> {
  if (!notePath) return;

  commentsCache.set(notePath, comments);
  allDiskComments[notePath] = comments;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        LOCAL_STORAGE_PREFIX + notePath,
        JSON.stringify(comments)
      );
    } catch {
      // ignore
    }
  }

  try {
    await writeData(STORAGE_FILE, allDiskComments);
  } catch (e) {
    console.warn("[CommentsStore] Error writing comments to disk:", e);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(COMMENTS_EVENT, {
        detail: { notePath, comments },
      })
    );
  }
}

/**
 * Add a new comment to a note.
 */
export async function addComment(
  notePath: string,
  data: {
    from: number;
    to: number;
    selectedText: string;
    content: string;
  }
): Promise<NoteComment> {
  const current = await loadComments(notePath);
  const newComment: NoteComment = {
    id: uuidv4(),
    notePath,
    from: data.from,
    to: data.to,
    selectedText: data.selectedText,
    content: data.content,
    author: getCurrentUser(),
    createdAt: Date.now(),
    resolved: false,
    replies: [],
  };

  const next = [...current, newComment];
  await saveComments(notePath, next);
  return newComment;
}

/**
 * Delete a comment by ID.
 */
export async function deleteComment(
  notePath: string,
  commentId: string
): Promise<void> {
  const current = await loadComments(notePath);
  const next = current.filter((c) => c.id !== commentId);
  await saveComments(notePath, next);
}

/**
 * Resolve or toggle resolution for a comment.
 */
export async function resolveComment(
  notePath: string,
  commentId: string
): Promise<void> {
  const current = await loadComments(notePath);
  const next = current.map((c) =>
    c.id === commentId ? { ...c, resolved: !c.resolved } : c
  );
  await saveComments(notePath, next);
}

/**
 * Add a reply to a comment.
 */
export async function addReply(
  notePath: string,
  commentId: string,
  content: string
): Promise<NoteComment | null> {
  const current = await loadComments(notePath);
  const reply: CommentReply = {
    id: uuidv4(),
    author: getCurrentUser(),
    content,
    createdAt: Date.now(),
  };

  let updatedComment: NoteComment | null = null;
  const next = current.map((c) => {
    if (c.id === commentId) {
      updatedComment = {
        ...c,
        replies: [...(c.replies || []), reply],
      };
      return updatedComment;
    }
    return c;
  });

  if (updatedComment) {
    await saveComments(notePath, next);
  }
  return updatedComment;
}

/**
 * Subscribe to comments updates.
 */
export function subscribeToComments(
  callback: (notePath: string, comments: NoteComment[]) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ notePath: string; comments: NoteComment[] }>;
    if (custom.detail) {
      callback(custom.detail.notePath, custom.detail.comments);
    }
  };

  window.addEventListener(COMMENTS_EVENT, handler);
  return () => {
    window.removeEventListener(COMMENTS_EVENT, handler);
  };
}
