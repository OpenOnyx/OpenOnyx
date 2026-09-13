import React, { useState, useRef, useEffect } from "react";
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  AtSign,
  ArrowUp,
  ChevronDown,
  Pencil,
  Trash2,
  CornerDownRight,
  MessageSquare,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { NoteComment, CommentReply } from "../../types/comments";
import { formatRelativeTime } from "../../utils/commentsStore";

interface CommentInputBoxProps {
  initialValue?: string;
  initialImage?: string;
  placeholder?: string;
  onSubmit: (text: string, image?: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
  contained?: boolean;
}

type CommentFormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "code"
  | "link"
  | "bullet-list"
  | "numbered-list"
  | "blockquote"
  | "clear-format";

const commentToolButtonClass =
  "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

let activeCommentEditor: HTMLDivElement | null = null;
let activeCommentEditorAt = 0;

function markActiveCommentEditor(editor: HTMLDivElement | null) {
  activeCommentEditor = editor;
  activeCommentEditorAt = Date.now();
}

function sanitizeCommentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "s", "strike", "mark", "code", "a", "ul", "ol", "li", "blockquote", "br", "div", "p", "span"],
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
  });
}

function isHtmlComment(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function commentValueToHtml(value: string): string {
  if (!value) return "";
  if (isHtmlComment(value)) return sanitizeCommentHtml(value);
  const normalized = value.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  return sanitizeCommentHtml(marked.parse(normalized, { async: false, breaks: true }) as string);
}

function plainTextFromHtml(html = ""): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, " ").trim();
  const div = document.createElement("div");
  div.innerHTML = sanitizeCommentHtml(html);
  return (div.innerText || div.textContent || "").trim();
}

function wrapCurrentSelection(
  editor: HTMLDivElement,
  tagName: "mark" | "code" | "a",
  fallback: string,
  attrs: Record<string, string> = {},
) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    editor.focus();
    document.execCommand("insertHTML", false, `<${tagName}>${fallback}</${tagName}>`);
    return;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.focus();
    document.execCommand("insertHTML", false, `<${tagName}>${fallback}</${tagName}>`);
    return;
  }

  const wrapper = document.createElement(tagName);
  for (const [name, value] of Object.entries(attrs)) {
    wrapper.setAttribute(name, value);
  }

  if (range.collapsed) {
    wrapper.textContent = fallback;
  } else {
    wrapper.appendChild(range.extractContents());
  }

  range.insertNode(wrapper);
  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.addRange(nextRange);
}

function FormattedCommentText({ text, className }: { text: string; className: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: commentValueToHtml(text) }}
    />
  );
}

function applyCommentFormatCommand(
  editor: HTMLDivElement,
  command: CommentFormatCommand,
  setHtml: (next: string) => void,
) {
  editor.focus();

  if (command === "highlight") {
    wrapCurrentSelection(editor, "mark", "highlight");
  } else if (command === "code") {
    wrapCurrentSelection(editor, "code", "code");
  } else if (command === "link") {
    const selectedText = window.getSelection()?.toString();
    wrapCurrentSelection(editor, "a", selectedText || "link text", {
      href: "https://",
      target: "_blank",
      rel: "noreferrer",
    });
  } else if (command === "bullet-list") {
    document.execCommand("insertUnorderedList");
  } else if (command === "numbered-list") {
    document.execCommand("insertOrderedList");
  } else if (command === "blockquote") {
    document.execCommand("formatBlock", false, "blockquote");
  } else if (command === "clear-format") {
    document.execCommand("removeFormat");
    document.execCommand("unlink");
  } else {
    const domCommandMap: Record<Exclude<CommentFormatCommand, "highlight" | "code" | "link" | "bullet-list" | "numbered-list" | "blockquote" | "clear-format">, string> = {
      bold: "bold",
      italic: "italic",
      underline: "underline",
      strikethrough: "strikeThrough",
    };
    document.execCommand(domCommandMap[command]);
  }

  setHtml(sanitizeCommentHtml(editor.innerHTML));
}

function CommentFormattingControls({
  editorRef,
  html,
  setHtml,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  html: string;
  setHtml: (next: string) => void;
}) {
  const run = (command: CommentFormatCommand) => {
    const editor = editorRef.current;
    if (!editor) return;
    applyCommentFormatCommand(editor, command, setHtml);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-[var(--border-subtle)] pb-1"
      onMouseDown={(event) => {
        // Keep the editor selection active while a toolbar button is pressed.
        if ((event.target as HTMLElement).closest("button")) event.preventDefault();
      }}
    >
      <button type="button" title="Bold" className={commentToolButtonClass} onClick={() => run("bold")}><Bold className="h-3.5 w-3.5" /></button>
      <button type="button" title="Italic" className={commentToolButtonClass} onClick={() => run("italic")}><Italic className="h-3.5 w-3.5" /></button>
      <button type="button" title="Underline" className={commentToolButtonClass} onClick={() => run("underline")}><Underline className="h-3.5 w-3.5" /></button>
      <button type="button" title="Strikethrough" className={commentToolButtonClass} onClick={() => run("strikethrough")}><Strikethrough className="h-3.5 w-3.5" /></button>
      <button type="button" title="Highlight" className={commentToolButtonClass} onClick={() => run("highlight")}><Highlighter className="h-3.5 w-3.5" /></button>
      <button type="button" title="Inline code" className={commentToolButtonClass} onClick={() => run("code")}><Code className="h-3.5 w-3.5" /></button>
      <button type="button" title="Link" className={commentToolButtonClass} onClick={() => run("link")}><Link2 className="h-3.5 w-3.5" /></button>
      <button type="button" title="Bullet list" className={commentToolButtonClass} onClick={() => run("bullet-list")}><List className="h-3.5 w-3.5" /></button>
      <button type="button" title="Numbered list" className={commentToolButtonClass} onClick={() => run("numbered-list")}><ListOrdered className="h-3.5 w-3.5" /></button>
      <button type="button" title="Quote" className={commentToolButtonClass} onClick={() => run("blockquote")}><Quote className="h-3.5 w-3.5" /></button>
      <button type="button" title="Clear formatting" className={commentToolButtonClass} onClick={() => run("clear-format")}><RemoveFormatting className="h-3.5 w-3.5" /></button>
    </div>
  );
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
  contained = false,
}) => {
  const [html, setHtml] = useState(() => commentValueToHtml(initialValue));
  const [image, setImage] = useState<string | null>(initialImage || null);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      const initialHtml = commentValueToHtml(initialValue);
      inputRef.current.innerHTML = initialHtml;
      setHtml(initialHtml);
    }
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus, initialValue]);

  const handleSubmit = () => {
    const cleanHtml = sanitizeCommentHtml(html).trim();
    const plainText = inputRef.current?.innerText.trim() || "";
    if (plainText || image) {
      onSubmit(cleanHtml, image || undefined);
      setHtml("");
      setImage(null);
      if (inputRef.current) inputRef.current.innerHTML = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
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
    const plainText = e.clipboardData?.getData("text/plain");
    if (plainText) {
      e.preventDefault();
      document.execCommand("insertText", false, plainText);
      setHtml(sanitizeCommentHtml(inputRef.current?.innerHTML || ""));
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

  const canSubmit = plainTextFromHtml(html).length > 0 || Boolean(image);

  return (
    <div
      className={`cm-comment-input-box flex ${contained ? "w-full min-w-0" : "w-[310px]"} flex-col rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-2 shadow-xl transition-all ${
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
        <div className="relative group overflow-hidden rounded-md border border-[var(--border-medium)] bg-[var(--bg-primary)]">
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

      <CommentFormattingControls editorRef={inputRef} html={html} setHtml={setHtml} />

      {/* Input Row */}
      <div className="flex min-h-[48px] items-end gap-1.5">
        <div
          ref={inputRef}
          role="textbox"
          aria-label={image ? "Add a caption" : placeholder}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={image ? "Add a caption (optional)..." : placeholder}
          className="cm-comment-rich-editor max-h-[120px] min-h-[40px] flex-1 cursor-text overflow-y-auto bg-transparent py-1 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none empty:before:pointer-events-none empty:before:text-[var(--text-muted)] empty:before:content-[attr(data-placeholder)] [&_a]:text-[var(--text-link)] [&_a]:underline [&_blockquote]:m-0 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-medium)] [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-[var(--bg-tertiary)] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[var(--editor-code)] [&_mark]:rounded-sm [&_mark]:bg-[var(--editor-search-match)] [&_mark]:px-0.5"
          onInput={(e) => setHtml(sanitizeCommentHtml(e.currentTarget.innerHTML))}
          onKeyDown={handleKeyDown}
          onFocus={(e) => markActiveCommentEditor(e.currentTarget)}
          onPaste={handlePaste}
        />
        <div className="flex items-center gap-1 pl-1">
          <div className="flex flex-col items-center gap-0.5">
            <button
            type="button"
            title="Attach image"
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
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
                  }
                  inputRef.current?.focus();
                  if (!file.type.startsWith("image/")) {
                    document.execCommand("insertText", false, `Attachment: ${file.name}`);
                    setHtml(sanitizeCommentHtml(inputRef.current?.innerHTML || ""));
                  }
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
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
            onClick={() => {
              inputRef.current?.focus();
              document.execCommand("insertText", false, "@");
              setHtml(sanitizeCommentHtml(inputRef.current?.innerHTML || ""));
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
                ? "cursor-pointer bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90"
                : "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-faint)]"
            }`}
          >
            <ArrowUp className="h-3 w-3 stroke-[2.5]" />
            </button>
          </div>
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
          ? "bg-[var(--bg-active)] text-[var(--text-primary)] shadow-sm"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
  isTargetHovered?: boolean;
  embedded?: boolean;
  onSelect?: () => void;
  onResolve?: () => void;
  onDelete?: () => void;
  onEdit?: (content: string, image?: string) => void;
  onReply?: (content: string, image?: string) => void;
  onClose?: () => void;
  defaultCollapsed?: boolean;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  isActive = false,
  isTargetHovered = false,
  embedded = false,
  onSelect,
  onDelete,
  onEdit,
  onReply,
  onClose,
  defaultCollapsed = false,
}) => {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [replyHtml, setReplyHtml] = useState("");
  const [replyImage, setReplyImage] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const replyInputRef = useRef<HTMLDivElement>(null);
  const parsedComment = getCommentImage(comment);
  const replyCount = comment.replies?.length || 0;
  const commentBlockCount = parsedComment.text.match(/<(?:p|div|br|li)\b/gi)?.length || 0;
  const hasCollapsibleDetail = Boolean(
    parsedComment.image ||
      replyCount > 0 ||
      plainTextFromHtml(parsedComment.text).length > 80 ||
      commentBlockCount > 1,
  );
  const collapsedSummaryLabel = parsedComment.image && replyCount
    ? `Show image and ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
    : parsedComment.image
      ? "Show image"
      : replyCount
        ? `Show ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
        : isCollapsed
          ? "Show more"
          : "Show less";

  useEffect(() => {
    setIsCollapsed(defaultCollapsed);
  }, [comment.id, defaultCollapsed]);

  const handleSendReply = () => {
    const cleanHtml = sanitizeCommentHtml(replyHtml).trim();
    if ((plainTextFromHtml(cleanHtml) || replyImage) && onReply) {
      onReply(cleanHtml, replyImage || undefined);
      setReplyHtml("");
      setReplyImage(null);
      setIsReplying(false);
      if (replyInputRef.current) replyInputRef.current.innerHTML = "";
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
    const plainText = e.clipboardData?.getData("text/plain");
    if (plainText) {
      e.preventDefault();
      document.execCommand("insertText", false, plainText);
      setReplyHtml(sanitizeCommentHtml(replyInputRef.current?.innerHTML || ""));
    }
  };

  return (
    <div
      className={
        embedded
          ? `cm-comment-card group relative w-full text-left transition-all py-1 ${isEditing ? "z-[80]" : isActive ? "z-[70]" : "z-0"} ${isTargetHovered ? "cm-comment-card-sweep" : ""}`
          : `cm-comment-card group relative w-[300px] rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 text-left shadow-md transition-all hover:border-[var(--border-strong)] ${isEditing ? "z-[80]" : isActive ? "z-[70]" : "z-0"} ${isTargetHovered ? "cm-comment-card-sweep" : ""}`
      }
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Top Header Row - no profile picture avatar */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-[var(--text-primary)] tracking-tight">
            {comment.author.name}
          </span>
          <span className="text-[11.5px] font-normal text-[var(--text-muted)]">
            {formatRelativeTime(comment.createdAt)}
            {comment.editedAt ? " edited" : ""}
          </span>
        </div>

        {/* Action buttons on hover */}
        <div
          className={`flex items-center gap-1 transition-opacity ${
            showActions ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <button
              type="button"
              title="Edit comment"
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setIsReplying(false);
                setIsEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {hasCollapsibleDetail && !isEditing && (
            <button
              type="button"
              title={isCollapsed ? "Expand comment" : "Collapse comment"}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setIsReplying(false);
                setIsCollapsed((value) => !value);
              }}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title="Delete comment"
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[#f87171] transition-colors cursor-pointer"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              title="Close"
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <CommentInputBox
            initialValue={parsedComment.text}
            initialImage={parsedComment.image || undefined}
            placeholder="Edit comment..."
            contained
            onSubmit={(text, image) => {
              onEdit?.(text, image);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
            autoFocus
          />
        </div>
      ) : (
        <>

      {/* Comment Text Body */}
      {parsedComment.text ? (
        <FormattedCommentText
          text={parsedComment.text}
          className={`mt-1 break-words text-[13px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap [&_p]:m-0 [&_p+p]:mt-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 ${isCollapsed ? "cm-comment-collapsed-body max-h-[42px] overflow-hidden" : ""}`}
        />
      ) : null}

      {hasCollapsibleDetail ? (
        <button
          type="button"
          className="mt-0.5 flex max-w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed((value) => !value);
          }}
        >
          <ChevronDown className={`h-3 w-3 opacity-80 transition-transform ${isCollapsed ? "-rotate-90" : "rotate-0"}`} />
          <span className="truncate">{collapsedSummaryLabel}</span>
        </button>
      ) : null}

      {/* Comment Image (Image 3 requirement) */}
      {parsedComment.image && !isCollapsed && (
        <div className="mt-2 overflow-hidden rounded-md border border-[var(--border-medium)] bg-[var(--bg-primary)]">
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
      {comment.replies && comment.replies.length > 0 && !isCollapsed && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-[var(--border-subtle)] pt-2">
          {comment.replies.map((rep) => {
            const parsedRep = getReplyImage(rep);
            return (
              <div key={rep.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                    {rep.author.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {formatRelativeTime(rep.createdAt)}
                  </span>
                </div>
                {parsedRep.text ? (
                  <FormattedCommentText
                    text={parsedRep.text}
                    className="mt-0.5 text-[12px] text-[var(--text-primary)] break-words whitespace-pre-wrap [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5"
                  />
                ) : null}
                {parsedRep.image && (
                  <div className="mt-1.5 overflow-hidden rounded border border-[var(--border-medium)] bg-[var(--bg-primary)]">
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
        </>
      )}

      {/* Reply Toggle & Input - flush with left padding, supports pasting images */}
      {onReply && !isEditing && (
        <div className={isCollapsed ? "mt-0.5" : "mt-2 pt-0.5"}>
          {!isReplying ? (
            <button
              type="button"
              className="flex items-center gap-1 text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
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
              className="mt-1 flex flex-col gap-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-1.5"
              onClick={(e) => e.stopPropagation()}
              onPaste={handleReplyPaste}
            >
              {/* Attached Reply Image Preview */}
              {replyImage && (
                <div className="relative group overflow-hidden rounded border border-[var(--border-medium)] bg-[var(--bg-primary)]">
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

              <CommentFormattingControls editorRef={replyInputRef} html={replyHtml} setHtml={setReplyHtml} />

              <div className="flex items-end gap-1.5">
                <div
                  ref={replyInputRef}
                  role="textbox"
                  aria-label="Reply"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder={replyImage ? "Add reply text (optional)..." : "Reply (paste image or text)..."}
                  className="cm-comment-rich-editor max-h-[100px] min-h-[38px] flex-1 cursor-text overflow-y-auto bg-transparent py-1 text-[12px] leading-relaxed text-[var(--text-primary)] outline-none empty:before:pointer-events-none empty:before:text-[var(--text-muted)] empty:before:content-[attr(data-placeholder)] [&_a]:text-[var(--text-link)] [&_a]:underline [&_blockquote]:m-0 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-medium)] [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-[var(--bg-tertiary)] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[var(--editor-code)] [&_mark]:rounded-sm [&_mark]:bg-[var(--editor-search-match)] [&_mark]:px-0.5"
                  onInput={(e) => setReplyHtml(sanitizeCommentHtml(e.currentTarget.innerHTML))}
                  onFocus={(e) => markActiveCommentEditor(e.currentTarget)}
                  onPaste={handleReplyPaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    } else if (e.key === "Escape") {
                      setIsReplying(false);
                      setReplyHtml("");
                      setReplyImage(null);
                      if (replyInputRef.current) replyInputRef.current.innerHTML = "";
                    }
                  }}
                />
                <button
                  type="button"
                  title="Attach image"
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
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
                  disabled={!plainTextFromHtml(replyHtml) && !replyImage}
                  onClick={handleSendReply}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:bg-[var(--bg-active)] disabled:text-[var(--text-faint)] cursor-pointer disabled:cursor-not-allowed"
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
