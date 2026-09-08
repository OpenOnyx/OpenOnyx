import React, { useState, useRef, useEffect } from "react";
import {
  Paperclip,
  AtSign,
  ArrowUp,
  Check,
  Trash2,
  CornerDownRight,
  MoreVertical,
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

interface CommentCardProps {
  comment: NoteComment;
  isActive?: boolean;
  onSelect?: () => void;
  onResolve?: () => void;
  onDelete?: () => void;
  onReply?: (content: string) => void;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  isActive = false,
  onSelect,
  onResolve,
  onDelete,
  onReply,
}) => {
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showActions, setShowActions] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const handleSendReply = () => {
    if (replyText.trim() && onReply) {
      onReply(replyText.trim());
      setReplyText("");
      setIsReplying(false);
    }
  };

  return (
    <div
      className={`group relative w-[300px] rounded-lg border bg-[#1c1c1c] p-3 text-left shadow-md transition-all ${
        isActive
          ? "border-[var(--accent-primary,#facc15)] shadow-[0_0_12px_rgba(250,204,21,0.15)]"
          : "border-[#2c2d2c] hover:border-[#444]"
      }`}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-800 text-[10px] font-bold text-white">
            {!avatarError && (comment.author.avatar || "/default-avatar.png") ? (
              <img
                src={comment.author.avatar || "/default-avatar.png"}
                alt={comment.author.name}
                className="h-full w-full object-cover"
                onError={() => setAvatarError(true)}
              />
            ) : (
              (comment.author.name[0] || "U").toUpperCase()
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-white tracking-tight">
              {comment.author.name}
            </span>
            <span className="text-[12px] font-normal text-[#888888]">
              {formatRelativeTime(comment.createdAt)}
            </span>
          </div>
        </div>

        {/* Action buttons on hover */}
        <div
          className={`flex items-center gap-1 transition-opacity ${
            showActions ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {onResolve && (
            <button
              type="button"
              title="Resolve comment"
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-[#4ade80]"
              onClick={onResolve}
            >
              <Check className="h-3.5 w-3.5 stroke-[2.5]" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title="Delete comment"
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-[#f87171]"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Comment Body */}
      <div className="ml-[32px] mt-1 break-words text-[13px] leading-relaxed text-[#ededed] whitespace-pre-wrap">
        {comment.content}
      </div>

      {/* Threaded Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-[32px] mt-2.5 flex flex-col gap-2 border-t border-[#2e2e2e] pt-2">
          {comment.replies.map((rep) => (
            <div key={rep.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-[#ccc]">
                  {rep.author.name}
                </span>
                <span className="text-[11px] text-[#777]">
                  {formatRelativeTime(rep.createdAt)}
                </span>
              </div>
              <div className="text-[12px] text-[#ddd] break-words">
                {rep.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply Toggle & Input */}
      {onReply && (
        <div className="ml-[32px] mt-2 pt-1">
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
