import { StateEffect, StateField, Extension } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet } from "@codemirror/view";
import type { NoteComment } from "../../types/comments";
import { normalizeCommentAnchors } from "../../utils/comment-anchors";

export interface PendingCommentRange {
  from: number;
  to: number;
}

export const setCommentsEffect = StateEffect.define<NoteComment[]>();
export const setPendingCommentEffect = StateEffect.define<PendingCommentRange | null>();
export const setActiveCommentEffect = StateEffect.define<string | null>();

interface CommentExtensionState {
  comments: NoteComment[];
  pending: PendingCommentRange | null;
  activeId: string | null;
  decorations: DecorationSet;
}

function buildDecorations(
  comments: NoteComment[],
  pending: PendingCommentRange | null,
  activeId: string | null,
  docLength: number
): DecorationSet {
  const items: { from: number; to: number; deco: Decoration }[] = [];

  for (const c of comments) {
    if (c.resolved) continue;
    const from = Math.max(0, Math.min(c.from, docLength));
    const to = Math.max(from, Math.min(c.to, docLength));
    if (from < to) {
      const isActive = c.id === activeId;
      items.push({
        from,
        to,
        deco: Decoration.mark({
          class: `cm-comment-highlight${isActive ? " cm-comment-active" : ""}`,
          attributes: { "data-comment-id": c.id },
        }),
      });
    }
  }

  if (pending) {
    const from = Math.max(0, Math.min(pending.from, docLength));
    const to = Math.max(from, Math.min(pending.to, docLength));
    if (from < to) {
      items.push({
        from,
        to,
        deco: Decoration.mark({
          class: "cm-comment-highlight cm-comment-pending",
          attributes: { "data-comment-pending": "true" },
        }),
      });
    }
  }

  // Sort items by 'from' ascending, then 'to' ascending
  items.sort((a, b) => a.from - b.from || a.to - b.to);

  // Use Decoration.set(items, true) to build decoration set (handles sorting)
  return Decoration.set(
    items.map((it) => it.deco.range(it.from, it.to)),
    true
  );
}

export const commentStateField = StateField.define<CommentExtensionState>({
  create(state) {
    return {
      comments: [],
      pending: null,
      activeId: null,
      decorations: Decoration.none,
    };
  },
  update(value, tr) {
    let comments = value.comments;
    let pending = value.pending;
    let activeId = value.activeId;
    let needsRebuild = false;

    if (tr.docChanged) {
      // Map existing comment coordinates across changes
      comments = comments.map((c) => {
        // Use the changeset source length rather than a possibly stale
        // document snapshot. Comments can arrive asynchronously while a
        // note is being replaced during tab/file activation.
        const sourceLength = tr.changes.length;
        const safeFrom = Math.max(0, Math.min(c.from, sourceLength));
        const safeTo = Math.max(0, Math.min(c.to, sourceLength));
        const newFrom = tr.changes.mapPos(safeFrom, 1);
        const newTo = tr.changes.mapPos(safeTo, -1);
        return {
          ...c,
          from: newFrom,
          to: Math.max(newFrom, newTo),
        };
      });

      if (pending) {
        const sourceLength = tr.changes.length;
        const safeFrom = Math.max(0, Math.min(pending.from, sourceLength));
        const safeTo = Math.max(0, Math.min(pending.to, sourceLength));
        const newFrom = tr.changes.mapPos(safeFrom, 1);
        const newTo = tr.changes.mapPos(safeTo, -1);
        pending = {
          from: newFrom,
          to: Math.max(newFrom, newTo),
        };
      }
      needsRebuild = true;
    }

    for (const e of tr.effects) {
      if (e.is(setCommentsEffect)) {
        comments = normalizeCommentAnchors(e.value, tr.newDoc.toString());
        needsRebuild = true;
      } else if (e.is(setPendingCommentEffect)) {
        pending = e.value;
        needsRebuild = true;
      } else if (e.is(setActiveCommentEffect)) {
        activeId = e.value;
        needsRebuild = true;
      }
    }

    if (needsRebuild) {
      const decorations = buildDecorations(
        comments,
        pending,
        activeId,
        tr.newDoc.length
      );
      return { comments, pending, activeId, decorations };
    }

    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (val) => val.decorations),
});

const commentClickDomHandler = EditorView.domEventHandlers({
  click(event, view) {
    const target = event.target as HTMLElement | null;
    const highlight = target?.closest(".cm-comment-highlight") as HTMLElement | null;
    if (highlight) {
      const commentId = highlight.getAttribute("data-comment-id");
      if (commentId) {
        view.dispatch({
          effects: setActiveCommentEffect.of(commentId),
        });
        window.dispatchEvent(
          new CustomEvent("openonyx:select-comment", {
            detail: { commentId },
          })
        );
      }
    }
  },
  mouseover(event) {
    const target = event.target as HTMLElement | null;
    const highlight = target?.closest(".cm-comment-highlight") as HTMLElement | null;
    const commentId = highlight?.getAttribute("data-comment-id");
    if (commentId) {
      window.dispatchEvent(
        new CustomEvent("openonyx:hover-comment", {
          detail: { commentId },
        })
      );
    }
  },
  mouseout(event) {
    const target = event.target as HTMLElement | null;
    const highlight = target?.closest(".cm-comment-highlight") as HTMLElement | null;
    const commentId = highlight?.getAttribute("data-comment-id");
    if (commentId) {
      window.dispatchEvent(
        new CustomEvent("openonyx:hover-comment", {
          detail: { commentId: null },
        })
      );
    }
  },
});

const commentTheme = EditorView.theme({
  ".cm-comment-highlight": {
    backgroundColor: "rgba(246, 196, 3, 0.25) !important",
    borderBottom: "2px solid #f6c403 !important",
    borderRadius: "2px !important",
    paddingBottom: "1px",
    cursor: "pointer",
    transition: "background-color 0.15s ease, border-color 0.15s ease",
  },
  ".cm-comment-highlight:hover, .cm-comment-highlight.cm-comment-active": {
    backgroundColor: "rgba(246, 196, 3, 0.4) !important",
    borderBottomColor: "#fde047 !important",
  },
  ".cm-comment-pending": {
    backgroundColor: "rgba(246, 196, 3, 0.25) !important",
    borderBottom: "2px solid #f6c403 !important",
    borderRadius: "2px !important",
  },
});

export function commentExtension(): Extension {
  return [commentStateField, commentClickDomHandler, commentTheme];
}
