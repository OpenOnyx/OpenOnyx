import React, { useMemo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { MessageSquare, X } from "lucide-react";
import type { NoteComment, PendingComment } from "../../types/comments";
import { CommentInputBox, CommentCard, CommentBadge } from "./CommentComponents";

interface EditorCommentsLayerProps {
  view: EditorView | null;
  containerEl?: HTMLElement | null;
  isReadMode?: boolean;
  comments: NoteComment[];
  pendingComment: PendingComment | null;
  activeCommentId: string | null;
  onSaveComment: (text: string, image?: string) => void;
  onCancelPending: () => void;
  onSelectComment: (commentId: string) => void;
  onResolveComment?: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onReplyComment: (commentId: string, content: string, image?: string) => void;
}

/**
 * Returns the document-relative vertical pixel coordinate for a given position
 * within view.scrollDOM. Uses coordsAtPos when available for visual accuracy
 * (accounts for wrapping, zoom, font size), with lineBlockAt fallback.
 */
function getLineTopForPos(view: EditorView, pos: number): number {
  if (!view || !view.state || !view.state.doc) return 20;
  const docLength = view.state.doc.length;
  const clampedPos = Math.max(0, Math.min(pos, docLength));

  try {
    const coords = view.coordsAtPos(clampedPos);
    if (coords && view.scrollDOM) {
      const scrollRect = view.scrollDOM.getBoundingClientRect();
      const topInScroller = coords.top - scrollRect.top + view.scrollDOM.scrollTop;
      if (Number.isFinite(topInScroller) && topInScroller >= 0) {
        return topInScroller;
      }
    }
  } catch {
    // fallback to lineBlockAt below
  }

  try {
    const block = view.lineBlockAt(clampedPos);
    return Math.max(8, block.top);
  } catch {
    return 20;
  }
}

function isTableRowText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return false;
  if (trimmed.startsWith("|") && trimmed.endsWith("|")) return true;
  return /^[^|]+\|[^|]+/.test(trimmed);
}

function findTableRange(doc: any, lineNumber: number): { start: number; end: number } | null {
  if (lineNumber < 1 || lineNumber > doc.lines || !isTableRowText(doc.line(lineNumber).text)) return null;

  let start = lineNumber;
  while (start > 1 && isTableRowText(doc.line(start - 1).text)) start--;

  let end = lineNumber;
  while (end < doc.lines && isTableRowText(doc.line(end + 1).text)) end++;

  if (end - start < 1) return null;
  return { start, end };
}

interface LineCommentGroup {
  lineNumber: number;
  comments: NoteComment[];
  targetTop: number;
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
  containerEl,
  isReadMode = false,
  comments,
  pendingComment,
  activeCommentId,
  onSaveComment,
  onCancelPending,
  onSelectComment,
  onDeleteComment,
  onReplyComment,
}) => {
  // Update tick to trigger re-measurement when doc, font size, content width, or viewport changes
  const [layoutTick, setLayoutTick] = useState(0);
  const [openPopoverLine, setOpenPopoverLine] = useState<number | null>(null);

  const targetScrollEl = isReadMode && containerEl ? containerEl : (view?.scrollDOM || containerEl || null);

  useEffect(() => {
    if (!targetScrollEl) return;

    const handleUpdate = () => setLayoutTick((t) => (t + 1) % 10000);

    targetScrollEl.addEventListener("scroll", handleUpdate, { passive: true });
    window.addEventListener("resize", handleUpdate, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => handleUpdate());
      ro.observe(targetScrollEl);
      if (view?.contentDOM) ro.observe(view.contentDOM);
      const previewChild = targetScrollEl.querySelector(".markdown-preview");
      if (previewChild) ro.observe(previewChild);
    }

    return () => {
      targetScrollEl.removeEventListener("scroll", handleUpdate);
      window.removeEventListener("resize", handleUpdate);
      ro?.disconnect();
    };
  }, [targetScrollEl, view]);

  // If an active comment is selected, open its popover in compact mode
  useEffect(() => {
    if (!activeCommentId) return;
    const comment = comments.find((c) => c.id === activeCommentId);
    if (!comment) return;
    try {
      if (view) {
        const docLength = view.state.doc.length;
        const line = view.state.doc.lineAt(Math.max(0, Math.min(comment.from, docLength)));
        setOpenPopoverLine(line.number);
      } else {
        setOpenPopoverLine(1);
      }
    } catch {
      setOpenPopoverLine(1);
    }
  }, [activeCommentId, comments, view]);

  // Close compact popover on Escape or click outside
  useEffect(() => {
    if (openPopoverLine === null) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".cm-comment-popover") &&
        !target.closest(".cm-comment-badge")
      ) {
        setOpenPopoverLine(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenPopoverLine(null);
      }
    };
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPopoverLine]);

  // Compute line top in either Editor mode or Read Mode
  const getLineTop = (pos: number, commentId?: string, isPending?: boolean): number => {
    // 1. If it's a pending comment and we have a valid targetTop, always honor it
    if (isPending && pendingComment?.targetTop && pendingComment.targetTop > 0) {
      return pendingComment.targetTop;
    }

    const scrollEl = targetScrollEl || (view?.scrollDOM ?? null);

    // 2. If a comment highlight mark exists in the DOM, compute its exact visual position
    // (Works in BOTH Read Mode and Editor Mode!)
    if (scrollEl && commentId) {
      const mark = scrollEl.querySelector(`.cm-comment-highlight[data-comment-id="${commentId}"]`);
      if (mark) {
        const cRect = scrollEl.getBoundingClientRect();
        const mRect = mark.getBoundingClientRect();
        return Math.max(8, mRect.top - cRect.top + scrollEl.scrollTop);
      }
    }

    // 3. If pending mark exists in DOM
    if (scrollEl && isPending) {
      const pendingMark = scrollEl.querySelector(".cm-comment-highlight.cm-comment-pending");
      if (pendingMark) {
        const cRect = scrollEl.getBoundingClientRect();
        const mRect = pendingMark.getBoundingClientRect();
        return Math.max(8, mRect.top - cRect.top + scrollEl.scrollTop);
      }
    }

    // 4. In Read Mode, if mark wasn't found, estimate based on pos ratio
    if (isReadMode && scrollEl) {
      const docLen = view?.state?.doc?.length || 1;
      const ratio = Math.max(0, Math.min(pos / docLen));
      return Math.max(20, ratio * (scrollEl.scrollHeight || 600));
    }

    // 5. In Editor Mode, check if pos is inside a table line
    if (view && scrollEl) {
      try {
        const docLength = view.state.doc.length;
        const clampedPos = Math.max(0, Math.min(pos, docLength));
        const line = view.state.doc.lineAt(clampedPos);
        const lineNum = line.number;
        const tableRange = findTableRange(view.state.doc, lineNum);
        if (tableRange) {
          const tableStartLine = view.state.doc.line(tableRange.start);
          const tableWrappers = Array.from(scrollEl.querySelectorAll<HTMLElement>(".cm-live-table-wrapper"));
          let matchingWrapper: HTMLElement | null = null;
          for (const w of tableWrappers) {
            const wPos = view.posAtDOM(w);
            if (wPos >= tableStartLine.from && wPos <= view.state.doc.line(tableRange.end).to) {
              matchingWrapper = w;
              break;
            }
          }
          if (matchingWrapper) {
            const tableEl = matchingWrapper.querySelector("table");
            if (tableEl) {
              if (lineNum === tableRange.start) {
                const headerTr = tableEl.querySelector("thead tr");
                if (headerTr) {
                  const r = headerTr.getBoundingClientRect();
                  const cRect = scrollEl.getBoundingClientRect();
                  return Math.max(8, r.top - cRect.top + scrollEl.scrollTop);
                }
              } else if (lineNum >= tableRange.start + 2) {
                const bodyRowIdx = lineNum - (tableRange.start + 2);
                const bodyTrs = tableEl.querySelectorAll("tbody tr");
                const targetTr = bodyTrs[bodyRowIdx] || bodyTrs[bodyTrs.length - 1];
                if (targetTr) {
                  const r = targetTr.getBoundingClientRect();
                  const cRect = scrollEl.getBoundingClientRect();
                  return Math.max(8, r.top - cRect.top + scrollEl.scrollTop);
                }
              }
            }
          }
        }
      } catch {
        // fallback to getLineTopForPos below
      }

      return getLineTopForPos(view, pos);
    }

    return 20;
  };

  // Space calculation: check if there is room for full 300px cards in the right margin
  const spaceInfo = useMemo(() => {
    if (!targetScrollEl) {
      return { hasEnoughSpace: false, rightMargin: 0 };
    }
    const scrollerRect = targetScrollEl.getBoundingClientRect();
    const contentChild =
      (isReadMode ? targetScrollEl.querySelector(".markdown-preview") : view?.contentDOM) ||
      targetScrollEl.firstElementChild;
    const contentRect = contentChild ? contentChild.getBoundingClientRect() : scrollerRect;
    const rightMargin = scrollerRect.right - contentRect.right;
    return {
      hasEnoughSpace: rightMargin >= 320,
      rightMargin,
    };
  }, [targetScrollEl, view, isReadMode, layoutTick]);

  // Compact mode groups by line (Image 1)
  const lineGroups = useMemo<LineCommentGroup[]>(() => {
    if (!targetScrollEl) return [];
    const docLength = view?.state?.doc?.length || 0;
    const map = new Map<number, { comments: NoteComment[]; targetTop: number }>();

    for (const c of comments) {
      if (c.resolved) continue;
      let lineNum = 1;
      try {
        if (view) {
          const line = view.state.doc.lineAt(Math.max(0, Math.min(c.from, docLength)));
          lineNum = line.number;
        } else {
          lineNum = Math.floor(c.from / 80) + 1;
        }
      } catch {
        lineNum = 1;
      }

      const top = getLineTop(c.from, c.id);
      // Group comments with matching line or close vertical distance
      let grouped = false;
      for (const [existingLine, data] of map.entries()) {
        if (existingLine === lineNum || Math.abs(data.targetTop - top) < 22) {
          data.comments.push(c);
          grouped = true;
          break;
        }
      }

      if (!grouped) {
        map.set(lineNum, { comments: [c], targetTop: top });
      }
    }

    return Array.from(map.entries())
      .map(([lineNum, data]) => ({
        lineNumber: lineNum,
        comments: data.comments,
        targetTop: data.targetTop,
      }))
      .sort((a, b) => a.targetTop - b.targetTop);
  }, [targetScrollEl, view, comments, isReadMode, layoutTick]);

  // Wide mode layout items with vertical collision avoidance (Image 3)
  const wideLayoutItems = useMemo<LayoutItem[]>(() => {
    if (!targetScrollEl) return [];

    const items: LayoutItem[] = [];

    // Existing active comments
    for (const c of comments) {
      if (c.resolved) continue;
      const targetTop = getLineTop(c.from, c.id);
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
      const targetTop = getLineTop(pendingComment.from, undefined, true);
      items.push({
        key: "pending-comment",
        isPending: true,
        targetTop,
        computedTop: targetTop,
      });
    }

    // Sort ascending by targetTop
    items.sort((a, b) => a.targetTop - b.targetTop);

    // Collision avoidance: ensure adjacent cards don't overlap vertically
    let currentY = 16;
    const MIN_GAP = 12;

    for (const item of items) {
      const desiredY = Math.max(16, item.targetTop);
      const actualY = Math.max(desiredY, currentY);
      item.computedTop = actualY;

      const replyCount = item.comment?.replies?.length || 0;
      const estimatedHeight = item.isPending ? 48 : 74 + replyCount * 38;
      currentY = actualY + estimatedHeight + MIN_GAP;
    }

    return items;
  }, [targetScrollEl, view, comments, pendingComment, isReadMode, layoutTick]);

  if (!targetScrollEl) return null;
  const hasComments = comments.some((c) => !c.resolved);
  if (!hasComments && !pendingComment) return null;

  const isCompactMode = !spaceInfo.hasEnoughSpace;

  const content = (
    <div
      className="cm-comments-layer pointer-events-none absolute left-0 right-0 top-0 z-[40]"
      style={{
        height: `${Math.max(
          targetScrollEl.scrollHeight || 0,
          targetScrollEl.clientHeight || 0,
          800
        )}px`,
      }}
    >
      {/* ── Compact Mode (Image 1): Line Badges + Click-to-Open Popover ── */}
      {isCompactMode && (
        <>
          {lineGroups.map((group) => {
            const isPopoverOpen = openPopoverLine === group.lineNumber;
            return (
              <div
                key={`badge-line-${group.lineNumber}`}
                className="pointer-events-auto absolute right-[14px] transition-all duration-150 ease-out"
                style={{ top: `${group.targetTop}px` }}
              >
                <CommentBadge
                  count={group.comments.length}
                  isActive={isPopoverOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenPopoverLine(isPopoverOpen ? null : group.lineNumber);
                  }}
                />

                {/* Popover shown ONLY when clicked (Image 1 requirement) */}
                {isPopoverOpen && (
                  <div
                    className="cm-comment-popover pointer-events-auto absolute right-0 top-7 z-[60] flex w-[310px] flex-col gap-2.5 rounded-lg border border-[#383838] bg-[#1a1a1a] p-3 shadow-2xl transition-all"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-[#2c2c2c] pb-1.5">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#aaa]">
                        <MessageSquare className="h-3.5 w-3.5 text-[#888]" />
                        <span>
                          {group.comments.length} comment
                          {group.comments.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        title="Close"
                        className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2a2a2a] hover:text-white"
                        onClick={() => setOpenPopoverLine(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      {group.comments.map((c, idx) => (
                        <div key={c.id} className={idx > 0 ? "border-t border-[#2a2a2a] pt-2" : ""}>
                          <CommentCard
                            comment={c}
                            isActive={c.id === activeCommentId}
                            embedded={true}
                            onSelect={() => {
                              onSelectComment(c.id);
                              if (view) {
                                try {
                                  view.dispatch({
                                    selection: { anchor: c.from },
                                    scrollIntoView: true,
                                  });
                                } catch {}
                              }
                            }}
                            onDelete={() => onDeleteComment(c.id)}
                            onReply={(text, img) => onReplyComment(c.id, text, img)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pending Comment Input in Compact Mode */}
          {pendingComment && (
            <div
              className="pointer-events-auto absolute right-[14px] z-[65] transition-all duration-150 ease-out"
              style={{
                top: `${getLineTop(pendingComment.from, undefined, true)}px`,
              }}
            >
              <CommentInputBox
                initialImage={pendingComment.image}
                onSubmit={(text, img) => onSaveComment(text, img)}
                onCancel={onCancelPending}
                autoFocus
              />
            </div>
          )}
        </>
      )}

      {/* ── Wide Mode (Image 3): Full Cards in Right Margin ── */}
      {!isCompactMode && (
        <>
          {wideLayoutItems.map((item) => {
            if (item.isPending) {
              return (
                <div
                  key="pending-comment"
                  className="pointer-events-auto absolute right-[20px] transition-all duration-150 ease-out"
                  style={{ top: `${item.computedTop}px` }}
                >
                  <CommentInputBox
                    initialImage={pendingComment?.image}
                    onSubmit={(text, img) => onSaveComment(text, img)}
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
                  className="pointer-events-auto absolute right-[20px] transition-all duration-150 ease-out"
                  style={{ top: `${item.computedTop}px` }}
                >
                  <CommentCard
                    comment={c}
                    isActive={isActive}
                    onSelect={() => {
                      onSelectComment(c.id);
                      if (view) {
                        try {
                          view.dispatch({
                            selection: { anchor: c.from },
                            scrollIntoView: true,
                          });
                        } catch {}
                      }
                    }}
                    onDelete={() => onDeleteComment(c.id)}
                    onReply={(text, img) => onReplyComment(c.id, text, img)}
                  />
                </div>
              );
            }

            return null;
          })}
        </>
      )}
    </div>
  );

  return createPortal(content, targetScrollEl);
};

