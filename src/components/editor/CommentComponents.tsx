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
  initialImage?: string;
  placeholder?: string;
  onSubmit: (text: string, image?: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

export function getCommentImage(comment: NoteComment): { text: string; image: string | null } {
  if (comment.image) {
    return { text: comment.content, image: comment.image };
  }
  const mdImgMatch = comment.content?.match(/!\[(.*?)\]\((data:image\/[^)]+|https?:\/\/[^)]+|blob:[^)]+)\)/);
  if (mdImgMatch) {
    const cleanText = comment.content.replace(mdImgMatch[0], "").trim();
    return { text: cleanText, image: mdImgMatch[2] };
  }
  if (comment.content?.startsWith("data:image/")) {
    return { text: "", image: comment.content };
  }
  return { text: comment.content || "", image: null };
}

export function getReplyImage(reply: CommentReply): { text: string; image: string | null } {
  if (reply.image) {
    return { text: reply.content, image: reply.image };
  }
  const mdImgMatch = reply.content?.match(/!\[(.*?)\]\((data:image\/[^)]+|https?:\/\/[^)]+|blob:[^)]+)\)/);
  if (mdImgMatch) {
    const cleanText = reply.content.replace(mdImgMatch[0], "").trim();
    return { text: cleanText, image: mdImgMatch[2] };
  }
  if (reply.content?.startsWith("data:image/")) {
    return { text: "", image: reply.content };
  }
  return { text: reply.content || "", image: null };
}

export const CommentInputBox: React.FC<CommentInputBoxProps> = ({
  initialValue = "",
  initialImage,
  placeholder = "Add a comment...",
  onSubmit,
  onCancel,
  autoFocus = true,
}) => {
  const [text, setText] = useState(initialValue);
  const [image, setImage] = useState<string | null>(initialImage || null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleSubmit = () => {
    if (text.trim() || image) {
      onSubmit(text.trim(), image || undefined);
      setText("");
      setImage(null);
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              setImage(reader.result);
            }
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const canSubmit = text.trim().length > 0 || Boolean(image);

  return (
    <div
      className={`cm-comment-input-box flex w-[310px] flex-col rounded-lg border border-[#383838] bg-[#242626] p-2 shadow-xl transition-all ${
        image ? "gap-2" : "gap-1"
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Attached Image Preview */}
      {image && (
        <div className="relative group overflow-hidden rounded-md border border-[#3a3a3a] bg-[#161616]">
          <img
            src={image}
            alt="Pasted attachment"
            className="max-h-[140px] w-full object-contain"
          />
          <button
            type="button"
            title="Remove image"
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setImage(null);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Input Row */}
      <div className="flex h-[32px] items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent text-[13px] text-[#f5f5f5] outline-none placeholder:text-[#737373]"
          placeholder={image ? "Add a caption (optional)..." : placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="flex items-center gap-2 pl-1">
          <button
            type="button"
            title="Attach image"
            className="flex h-5 w-5 items-center justify-center rounded text-[#8a8a8a] transition-colors hover:text-[#d4d4d4] cursor-pointer"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = () => {
                if (input.files && input.files[0]) {
                  const file = input.files[0];
                  if (file.type.startsWith("image/")) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") {
                        setImage(reader.result);
                      }
                    };
                    reader.readAsDataURL(file);
                  } else {
                    setText((prev) => `${prev} [Attachment: ${file.name}]`);
                  }
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
            className="flex h-5 w-5 items-center justify-center rounded text-[#8a8a8a] transition-colors hover:text-[#d4d4d4] cursor-pointer"
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
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
              canSubmit
                ? "cursor-pointer bg-[#f5f5f5] text-[#1e1e1e] hover:bg-white"
                : "cursor-not-allowed bg-[#383838] text-[#737373]"
            }`}
          >
            <ArrowUp className="h-3 w-3 stroke-[2.5]" />
          </button>
        </div>
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
  onReply?: (content: string, image?: string) => void;
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
  const [replyImage, setReplyImage] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const handleSendReply = () => {
    if ((replyText.trim() || replyImage) && onReply) {
      onReply(replyText.trim(), replyImage || undefined);
      setReplyText("");
      setReplyImage(null);
      setIsReplying(false);
    }
  };

  const handleReplyPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              setReplyImage(reader.result);
            }
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  };

  const parsedComment = getCommentImage(comment);

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
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-[#f87171] transition-colors cursor-pointer"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              title="Close"
              className="flex h-5 w-5 items-center justify-center rounded text-[#888] hover:bg-[#2e2e2e] hover:text-white transition-colors cursor-pointer"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Comment Text Body */}
      {parsedComment.text ? (
        <div className="mt-1.5 break-words text-[13px] leading-relaxed text-[#ededed] whitespace-pre-wrap">
          {parsedComment.text}
        </div>
      ) : null}

      {/* Comment Image (Image 3 requirement) */}
      {parsedComment.image && (
        <div className="mt-2 overflow-hidden rounded-md border border-[#2c2d2c] bg-[#141414]">
          <img
            src={parsedComment.image}
            alt="Comment attachment"
            className="max-h-[220px] w-full rounded-md object-contain cursor-pointer transition-transform duration-150 hover:brightness-105"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("openonyx:open-lightbox", {
                  detail: { src: parsedComment.image, alt: "Comment attachment" },
                })
              );
            }}
          />
        </div>
      )}

      {/* Threaded Replies - flush with left padding, no profile picture */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-[#2a2a2a] pt-2">
          {comment.replies.map((rep) => {
            const parsedRep = getReplyImage(rep);
            return (
              <div key={rep.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-[#ccc]">
                    {rep.author.name}
                  </span>
                  <span className="text-[11px] text-[#777]">
                    {formatRelativeTime(rep.createdAt)}
                  </span>
                </div>
                {parsedRep.text ? (
                  <div className="mt-0.5 text-[12px] text-[#ddd] break-words whitespace-pre-wrap">
                    {parsedRep.text}
                  </div>
                ) : null}
                {parsedRep.image && (
                  <div className="mt-1.5 overflow-hidden rounded border border-[#2c2d2c] bg-[#141414]">
                    <img
                      src={parsedRep.image}
                      alt="Reply attachment"
                      className="max-h-[160px] w-full rounded object-contain cursor-pointer transition-transform duration-150 hover:brightness-105"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(
                          new CustomEvent("openonyx:open-lightbox", {
                            detail: { src: parsedRep.image, alt: "Reply attachment" },
                          })
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reply Toggle & Input - flush with left padding, supports pasting images */}
      {onReply && (
        <div className="mt-2 pt-0.5">
          {!isReplying ? (
            <button
              type="button"
              className="flex items-center gap-1 text-[11.5px] font-medium text-[#888] transition-colors hover:text-white cursor-pointer"
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
              className="mt-1 flex flex-col gap-1.5 rounded-md border border-[#383838] bg-[#222] p-1.5"
              onClick={(e) => e.stopPropagation()}
              onPaste={handleReplyPaste}
            >
              {/* Attached Reply Image Preview */}
              {replyImage && (
                <div className="relative group overflow-hidden rounded border border-[#333] bg-[#141414]">
                  <img
                    src={replyImage}
                    alt="Pasted reply attachment"
                    className="max-h-[100px] w-full object-contain"
                  />
                  <button
                    type="button"
                    title="Remove image"
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyImage(null);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <input
                  ref={replyInputRef}
                  type="text"
                  autoFocus
                  placeholder={replyImage ? "Add reply text (optional)..." : "Reply (paste image or text)..."}
                  className="flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#666]"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onPaste={handleReplyPaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    } else if (e.key === "Escape") {
                      setIsReplying(false);
                      setReplyText("");
                      setReplyImage(null);
                    }
                  }}
                />
                <button
                  type="button"
                  title="Attach image"
                  className="flex h-4 w-4 items-center justify-center rounded text-[#888] hover:text-[#ccc] cursor-pointer"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = () => {
                      if (input.files && input.files[0]) {
                        const file = input.files[0];
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            setReplyImage(reader.result);
                          }
                        };
                        reader.readAsDataURL(file);
                        replyInputRef.current?.focus();
                      }
                    };
                    input.click();
                  }}
                >
                  <Paperclip className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!replyText.trim() && !replyImage}
                  onClick={handleSendReply}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#111] disabled:bg-[#444] disabled:text-[#777] cursor-pointer disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-2.5 w-2.5 stroke-[2.5]" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
