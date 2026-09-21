import type { NoteComment } from "../types/comments";

export interface CommentSourceRange {
  from: number;
  to: number;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Convert the common inline Markdown forms into the text visible in reading mode. */
export function getCommentDisplayText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!~-])/g, "$1")
    .trim();
}

function nearestOccurrence(source: string, query: string, preferredFrom: number): CommentSourceRange | null {
  if (!query) return null;
  const haystack = source.toLowerCase();
  const needle = query.toLowerCase();
  let index = haystack.indexOf(needle);
  let best: CommentSourceRange | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (index !== -1) {
    const distance = Math.abs(index - preferredFrom);
    if (distance < bestDistance) {
      best = { from: index, to: index + query.length };
      bestDistance = distance;
    }
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return best;
}

/**
 * Resolve a persisted comment back to Markdown source coordinates. Reading
 * mode selections contain rendered text, so their exact source can include
 * formatting markers between the selected words.
 */
export function resolveCommentSourceRange(
  source: string,
  from: number,
  to: number,
  selectedText: string,
): CommentSourceRange {
  const safeFrom = Math.max(0, Math.min(from, source.length));
  const safeTo = Math.max(safeFrom, Math.min(to, source.length));
  const selectedVisible = getCommentDisplayText(selectedText);
  const current = source.slice(safeFrom, safeTo);
  if (
    safeFrom < safeTo
    && normalizeText(getCommentDisplayText(current)) === normalizeText(selectedVisible)
  ) {
    return { from: safeFrom, to: safeTo };
  }

  const exact = nearestOccurrence(source, selectedText.trim(), safeFrom)
    || nearestOccurrence(source, selectedVisible, safeFrom);
  if (exact) return exact;

  const tokens = selectedVisible.split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const separator = "(?:\\s|[*_~=`#\\[\\]()>+\\-])+";
    const pattern = tokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(separator);
    try {
      const regex = new RegExp(pattern, "gi");
      let match: RegExpExecArray | null;
      let best: CommentSourceRange | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      while ((match = regex.exec(source)) !== null) {
        const distance = Math.abs(match.index - safeFrom);
        if (distance < bestDistance) {
          best = { from: match.index, to: match.index + match[0].length };
          bestDistance = distance;
        }
      }
      if (best) return best;
    } catch {
      // Fall through to the last known valid source range.
    }
  }

  return { from: safeFrom, to: safeTo };
}

export function normalizeCommentAnchors(comments: NoteComment[], source: string): NoteComment[] {
  return comments.map((comment) => {
    const range = resolveCommentSourceRange(
      source,
      comment.from,
      comment.to,
      comment.selectedText,
    );
    return range.from === comment.from && range.to === comment.to
      ? comment
      : { ...comment, ...range };
  });
}
