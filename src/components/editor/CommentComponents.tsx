import React, { useState, useRef, useEffect } from "react";
import {
  Paperclip,
  AtSign,
  ArrowUp,
  Trash2,
  CornerDownRight,
  MessageSquare,
  X,
} from "lucide-react";
import type { NoteComment, CommentReply } from "../../types/comments";
import { formatRelativeTime } from "../../utils/commentsStore";

interface CommentInputBoxProps {
  initialValue?: string;
  placeholder?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

export const CommentInputBox: React.FC<CommentInputBoxProps> = ({
  initialValue = "",
  placeholder = "Add a comment...",
  onSubmit,
  onCancel,
  autoFocus = true,
}) => {
  const [text, setText] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
      setText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div
      className="cm-comment-input-box flex h-[40px] w-[310px] items-center gap-1.5 rounded-lg border border-[#383838] bg-[#242626] px-3 shadow-lg transition-all"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        className="flex-1 bg-transparent text-[13px] text-[#f5f5f5] outline-none placeholder:text-[#737373]"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center gap-2 pl-1">
        <button
          type="button"
          title="Attach file"
          className="flex h-5 w-5 items-center justify-center rounded text-[#8a8a8a] transition-colors hover:text-[#d4d4d4]"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.onchange = () => {
              if (input.files && input.files[0]) {
                setText((prev) => `${prev} [Attachment: ${input.files![0].name}]`);
                inputRef.current?.focus();
              }
            };
            input.click();
          }}
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Mention someone"
          className="flex h-5 w-5 items-center justify-center rounded text-[#8a8a8a] transition-colors hover:text-[#d4d4d4]"
          onClick={() => {
            setText((prev) => `${prev}@`);
            inputRef.current?.focus();
          }}
        >
          <AtSign className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Submit comment"
          disabled={!hasText}
          onClick={handleSubmit}
          className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
            hasText
              ? "cursor-pointer bg-[#f5f5f5] text-[#1e1e1e] hover:bg-white"
              : "cursor-not-allowed bg-[#383838] text-[#737373]"
          }`}
        >
          <ArrowUp className="h-3 w-3 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};

export interface CommentBadgeProps {
  count: number;
  isActive?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

/**
 * Compact Notion-style comment indicator shown when space is limited (Image 1)
 */
export const CommentBadge: React.FC<CommentBadgeProps> = ({
  count,
  isActive = false,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cm-comment-badge group flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-normal transition-all cursor-pointer select-none ${
        isActive
          ? "bg-[#333] text-white shadow-sm"
          : "text-[#999999] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]"
      }`}
      title={`${count} comment${count > 1 ? "s" : ""}`}
    >
      <MessageSquare className="h-3.5 w-3.5 opacity-80 group-hover:opacity-100" />
      <span className="leading-none">{count}</span>
    </button>
  );
};

interface CommentCardProps {
  comment: NoteComment;
  isActive?: boolean;
  embedded?: boolean;
  onSelect?: () => void;
  onResolve?: () => void;
  onDelete?: () => void;
  onReply?: (content: string) => void;
  onClose?: () => void;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  isActive = false,
  embedded = false,
  onSelect,
  onDelete,
  onReply,
  onClose,
}) => {
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showActions, setShowActions] = useState(false);

  const handleSendReply = () => {
    if (replyText.trim() && onReply) {
      onReply(replyText.trim());
      setReplyText("");
      setIsReplying(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? "group relative w-full text-left transition-all py-1"
          : "group relative w-[300px] rounded-lg border border-[#2c2d2c] bg-[#1e1e1e] p-3 text-left shadow-md transition-all hover:border-[#383838]"
      }
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Top Header Row - no profile picture avatar */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-[#f0f0f0] tracking-tight">
            {comment.author.name}
          </span>
          <span className="text-[11.5px] font-normal text-[#888888]">
            {formatRelativeTime(comment.createdAt)}
          </span>
        </div>

        {/* Action buttons on hover - ONLY delete button, no tick mark */}
        <div
          className={`flex items-center gap-1 transition-opacity ${
            showActions ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {onDelete && (
            <button
              type="button"
              title="Delete comment"
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-[#f87171] transition-colors"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              title="Close"
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-white transition-colors"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Comment Body - flush with left padding */}
      <div className="mt-1.5 break-words text-[13px] leading-relaxed text-[#ededed] whitespace-pre-wrap">
        {comment.content}
      </div>

      {/* Threaded Replies - flush with left padding, no profile picture */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2 border-t border-[#2a2a2a] pt-2">
          {comment.replies.map((rep) => (
            <div key={rep.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium text-[#ccc]">
                  {rep.author.name}
                </span>
                <span className="text-[11px] text-[#777]">
                  {formatRelativeTime(rep.createdAt)}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-[#ddd] break-words whitespace-pre-wrap">
                {rep.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply Toggle & Input - flush with left padding */}
      {onReply && (
        <div className="mt-2 pt-0.5">
          {!isReplying ? (
            <button
              type="button"
              className="flex items-center gap-1 text-[11.5px] font-medium text-[#888] transition-colors hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                setIsReplying(true);
              }}
            >
              <CornerDownRight className="h-3 w-3" />
              Reply
            </button>
          ) : (
            <div
              className="mt-1 flex items-center gap-1.5 rounded-md border border-[#383838] bg-[#222] px-2 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                autoFocus
                placeholder="Reply..."
                className="flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#666]"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  } else if (e.key === "Escape") {
                    setIsReplying(false);
                    setReplyText("");
                  }
                }}
              />
              <button
                type="button"
                disabled={!replyText.trim()}
                onClick={handleSendReply}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#111] disabled:bg-[#444] disabled:text-[#777]"
              >
                <ArrowUp className="h-2.5 w-2.5 stroke-[2.5]" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
