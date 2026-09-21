import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Check, Copy } from "lucide-react";
import type { VaultCitation } from "../../utils/vault-rag";

interface CitedMarkdownAnswerProps {
  answer: string;
  citations: VaultCitation[];
  className: string;
  citationClassName: string;
  onOpenNote: (path: string) => void;
}

interface CitationPreview {
  citation: VaultCitation;
  top: number;
  left: number;
  anchorTop: number;
  anchorBottom: number;
}

function citationLabel(citation: VaultCitation): string {
  const fileName = citation.path.split("/").pop()?.replace(/\.md$/i, "") || citation.title;
  const readable = fileName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (readable.length <= 28) return readable;
  return `${readable.slice(0, 27).trimEnd()}…`;
}

export function renderCitedMarkdownHtml(
  markdown: string,
  citations: VaultCitation[],
  citationClassName: string,
): string {
  const rendered = marked.parse(markdown, { async: false, breaks: true, gfm: true }) as string;
  const sanitized = DOMPurify.sanitize(rendered);
  if (typeof document === "undefined") return sanitized;

  const citationsById = new Map(citations.map((citation) => [citation.id, citation]));
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  const walker = document.createTreeWalker(template.content, 4);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const parent = textNode.parentElement;
    if (!parent?.closest("code, pre, a, button") && /\[\d+]/.test(textNode.data)) {
      textNodes.push(textNode);
    }
  }

  for (const textNode of textNodes) {
    const fragment = document.createDocumentFragment();
    const citationPattern = /\[(\d+)]/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = citationPattern.exec(textNode.data)) !== null) {
      const citation = citationsById.get(Number(match[1]));
      if (!citation) continue;
      fragment.append(textNode.data.slice(cursor, match.index));
      const button = document.createElement("button");
      button.type = "button";
      button.className = citationClassName;
      button.dataset.vaultCitation = String(citation.id);
      button.title = `${citation.path}, lines ${citation.startLine}-${citation.endLine}`;
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = citationLabel(citation);
      button.append(label);
      fragment.append(button);
      cursor = match.index + match[0].length;
    }

    if (cursor === 0) continue;
    fragment.append(textNode.data.slice(cursor));
    textNode.replaceWith(fragment);
  }

  return template.innerHTML;
}

interface CitationHandlers {
  onOpen: (citation: VaultCitation) => void;
  onPreview: (citation: VaultCitation, target: HTMLButtonElement) => void;
  onPreviewEnd: () => void;
}

export function MarkdownReadingView({ markdown, className = "" }: { markdown: string; className?: string }) {
  const content = useMemo(() => {
    const html = renderCitedMarkdownHtml(markdown, [], "");
    return htmlToReactNodes(html, []);
  }, [markdown]);

  return <div className={`markdown-rendered ${className}`}>{content}</div>;
}

function htmlToReactNodes(
  html: string,
  citations: VaultCitation[],
  handlers?: CitationHandlers,
): React.ReactNode[] {
  if (typeof document === "undefined") return [html];

  const citationsById = new Map(citations.map((citation) => [citation.id, citation]));
  const template = document.createElement("template");
  template.innerHTML = html;

  const convert = (node: Node, key: string): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;

    const citationId = Number(node.dataset.vaultCitation);
    const citation = citationsById.get(citationId);
    if (node.tagName === "BUTTON" && citation && handlers) {
      return (
        <button
          key={key}
          type="button"
          className={node.className}
          aria-label={`Source: ${citation.path}, lines ${citation.startLine} to ${citation.endLine}`}
          onClick={() => handlers.onOpen(citation)}
          onMouseEnter={(event) => handlers.onPreview(citation, event.currentTarget)}
          onMouseLeave={handlers.onPreviewEnd}
          onFocus={(event) => handlers.onPreview(citation, event.currentTarget)}
          onBlur={handlers.onPreviewEnd}
        >
          {citationLabel(citation)}
        </button>
      );
    }

    const tag = node.tagName.toLowerCase();
    const props: Record<string, unknown> = { key };
    if (node.className) props.className = node.className;
    if (node.title) props.title = node.title;
    if (tag === "a") {
      props.href = node.getAttribute("href") || undefined;
      props.rel = "noreferrer";
      props.target = "_blank";
    }
    if (tag === "input") {
      props.type = node.getAttribute("type") || undefined;
      props.checked = node.hasAttribute("checked");
      props.readOnly = true;
    }

    const children = Array.from(node.childNodes).map((child, index) =>
      convert(child, `${key}.${index}`),
    );
    return React.createElement(tag, props, ...children);
  };

  return Array.from(template.content.childNodes).map((node, index) =>
    convert(node, `markdown.${index}`),
  );
}

export function CitedMarkdownAnswer({
  answer,
  citations,
  className,
  citationClassName,
  onOpenNote,
}: CitedMarkdownAnswerProps) {
  const [preview, setPreview] = useState<CitationPreview | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cancelPreviewClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const showPreview = useCallback((citation: VaultCitation, button: HTMLButtonElement) => {
    cancelPreviewClose();
    const rect = button.getBoundingClientRect();
    const width = Math.min(340, Math.max(260, window.innerWidth - 24));
    setPreview({
      citation,
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 320)),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
    });
  }, [cancelPreviewClose]);
  const queuePreviewClose = useCallback(() => {
    cancelPreviewClose();
    closeTimerRef.current = setTimeout(() => setPreview(null), 180);
  }, [cancelPreviewClose]);
  useEffect(() => cancelPreviewClose, [cancelPreviewClose]);
  const copyAnswer = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(answer);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = answer;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1600);
    } catch {
      setIsCopied(false);
    }
  }, [answer]);
  const content = useMemo(() => {
    const html = renderCitedMarkdownHtml(answer, citations, citationClassName);
    return htmlToReactNodes(html, citations, {
      onOpen: (citation) => onOpenNote(citation.path),
      onPreview: showPreview,
      onPreviewEnd: queuePreviewClose,
    });
  }, [answer, citationClassName, citations, onOpenNote, queuePreviewClose, showPreview]);
  const previewContent = useMemo(() => {
    if (!preview) return null;
    const html = renderCitedMarkdownHtml(preview.citation.excerpt.trim(), [], "");
    return htmlToReactNodes(html, []);
  }, [preview]);
  useLayoutEffect(() => {
    if (!preview || !previewRef.current) return;
    const card = previewRef.current.getBoundingClientRect();
    const margin = 12;
    const below = preview.anchorBottom + 8;
    const above = preview.anchorTop - card.height - 8;
    let top = below;
    let left = preview.left;
    if (below + card.height > window.innerHeight - margin && above >= margin) {
      top = above;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - card.height - margin));
    if (card.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - card.width - margin);
    }
    if (card.left < margin) left = margin;
    if (Math.abs(top - preview.top) > 1 || Math.abs(left - preview.left) > 1) {
      setPreview((current) => current ? { ...current, top, left } : current);
    }
  }, [preview]);

  return (
    <>
      <div className={`${className} markdown-rendered`}>
        {content}
        <div className="mt-4 flex justify-end border-t border-(--border-subtle) pt-2">
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] border border-transparent px-2 text-[10px] font-medium text-(--text-muted) transition-[background-color,color] duration-[160ms] hover:bg-(--bg-active) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)"
            onClick={() => void copyAnswer()}
            title="Copy response as Markdown"
            aria-label="Copy response as Markdown"
          >
            {isCopied ? <Check size={12} /> : <Copy size={12} />}
            {isCopied ? "Copied" : "Copy Markdown"}
          </button>
        </div>
      </div>
      {preview && (
        <div
          ref={previewRef}
          role="tooltip"
          className="ai-panel-item pointer-events-auto fixed z-[10000] max-h-[calc(100vh-24px)] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-md border border-(--border-medium) bg-(--bg-elevated) p-3 shadow-xl"
          style={{ top: preview.top, left: preview.left }}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={queuePreviewClose}
        >
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-(--text-primary)">
              {preview.citation.path.split("/").pop() || preview.citation.title}
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-(--text-muted)">
              Quoted passage · lines {preview.citation.startLine}–{preview.citation.endLine}
            </div>
            {preview.citation.heading && (
              <div className="mt-1 truncate text-[10px] text-(--text-faint)">
                Under {preview.citation.heading}
              </div>
            )}
          </div>
          <div className="markdown-rendered vault-ai-source mt-2 max-h-[min(224px,calc(100vh-160px))] overflow-auto border-l-2 border-(--border-strong) pl-2.5 text-(--text-secondary)">
            {previewContent}
          </div>
        </div>
      )}
    </>
  );
}
