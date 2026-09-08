import React, { useMemo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import type { NoteComment, PendingComment } from "../../types/comments";
import { CommentInputBox, CommentCard } from "./CommentComponents";

interface EditorCommentsLayerProps {
  view: EditorView | null;
  comments: NoteComment[];
  pendingComment: PendingComment | null;
  activeCommentId: string | null;
  onSaveComment: (text: string) => void;
  onCancelPending: () => void;
  onSelectComment: (commentId: string) => void;
  onResolveComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onReplyComment: (commentId: string, content: string) => void;
}

interface LayoutItem {
  key: string;
  isPending: boolean;
  comment?: NoteComment;
  targetTop: number;
  computedTop: number;
}

export const EditorCommentsLayer: React.FC<EditorCommentsLayerProps> = ({
  view,
  comments,
  pendingComment,
  activeCommentId,
  onSaveComment,
  onCancelPending,
  onSelectComment,
  onResolveComment,
  onDeleteComment,
  onReplyComment,
}) => {
  // Update tick to trigger re-measurement when doc or viewport changes
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    if (!view) return;

    // Listen to scroll and resize
    const handleScroll = () => setLayoutTick((t) => (t + 1) % 10000);
    const scrollEl = view.scrollDOM;
    scrollEl?.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      scrollEl?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [view]);

  // Compute non-overlapping layout positions
  const layoutItems = useMemo<LayoutItem[]>(() => {
    if (!view) return [];

    const items: LayoutItem[] = [];
    const docLength = view.state.doc.length;

    // Existing active comments
    for (const c of comments) {
      if (c.resolved) continue;
      let targetTop = 20;
      try {
        const pos = Math.max(0, Math.min(c.from, docLength));
        const line = view.lineBlockAt(pos);
        targetTop = line.top;
      } catch {
        targetTop = 20;
      }
      items.push({
        key: c.id,
        isPending: false,
        comment: c,
        targetTop,
        computedTop: targetTop,
      });
    }

    // Pending draft comment
    if (pendingComment) {
      let targetTop = pendingComment.targetTop;
      try {
        const pos = Math.max(0, Math.min(pendingComment.from, docLength));
        const line = view.lineBlockAt(pos);
        targetTop = line.top;
      } catch {
        targetTop = pendingComment.targetTop || 20;
      }
      items.push({
        key: "pending-comment",
        isPending: true,
        targetTop,
        computedTop: targetTop,
      });
    }

    // Sort ascending by targetTop
    items.sort((a, b) => a.targetTop - b.targetTop);

    // Collision avoidance: ensure adjacent cards don't overlap
    let currentY = 16;
    const MIN_GAP = 12;

    for (const item of items) {
      const desiredY = Math.max(16, item.targetTop);
      const actualY = Math.max(desiredY, currentY);
      item.computedTop = actualY;

      const estimatedHeight = item.isPending ? 44 : 76;
      currentY = actualY + estimatedHeight + MIN_GAP;
    }

    return items;
  }, [view, comments, pendingComment, layoutTick]);

  if (!view || !view.scrollDOM) return null;
  if (layoutItems.length === 0) return null;

  const content = (
    <div
      className="cm-comments-layer pointer-events-none absolute right-[28px] top-0 z-[40] w-[320px]"
      style={{
        height: `${Math.max(
          view.scrollDOM.scrollHeight || 0,
          view.contentDOM.offsetHeight || 0,
          800
        )}px`,
      }}
    >
      {layoutItems.map((item) => {
        if (item.isPending) {
          return (
            <div
              key="pending-comment"
              className="pointer-events-auto absolute right-0 transition-all duration-150 ease-out"
              style={{ top: `${item.computedTop}px` }}
            >
              <CommentInputBox
                onSubmit={onSaveComment}
                onCancel={onCancelPending}
                autoFocus
              />
            </div>
          );
        }

        if (item.comment) {
          const c = item.comment;
          const isActive = c.id === activeCommentId;
          return (
            <div
              key={c.id}
              className="pointer-events-auto absolute right-0 transition-all duration-150 ease-out"
              style={{ top: `${item.computedTop}px` }}
            >
              <CommentCard
                comment={c}
                isActive={isActive}
                onSelect={() => {
                  onSelectComment(c.id);
                  try {
                    view.dispatch({
                      selection: { anchor: c.from },
                      scrollIntoView: true,
                    });
                  } catch {
                    // ignore
                  }
                }}
                onResolve={() => onResolveComment(c.id)}
                onDelete={() => onDeleteComment(c.id)}
                onReply={(text) => onReplyComment(c.id, text)}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );

  return createPortal(content, view.scrollDOM);
};
