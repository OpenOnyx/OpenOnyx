/**
 * Markdown Preview
 *
 * Renders markdown content as styled HTML using the `marked` library.
 * Features:
 * - [[wiki-links]] and [[note|alias]] support
 * - [[note#heading]] header links
 * - #tags with click handling
 * - Clickable checkboxes that update source
 * - Obsidian-style callouts/admonitions
 * - ![[embed]] note embeds
 * - Link preview on hover
 * - DOMPurify XSS protection
 */

import React, {
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import { resolveVaultImageSrc } from "../../utils/resolveImageSrc";
import { getSmartEmbed, getDisplayDomain, cleanEmbedUrl, toggleUrlInMarkdown } from "../../utils/urlHelper";
import { runMarkdownPostProcessors } from "../../lib/obsidian-api/markdown";
import type { AppSettings } from "../settings/SettingsPage";

// Enable math formatting
marked.use(markedKatex({ throwOnError: false }));

// Intercept all markdown images (including reference links) to resolve local vault paths
marked.use({
  renderer: {
    image(token) {
      const { href, title, text } = token;
      const resolvedSrc = resolveVaultImageSrc(href);
      const safeSrc = String(resolvedSrc).replace(/"/g, "&quot;");
      const safeAlt = String(text).replace(/"/g, "&quot;");
      return `<img src="${safeSrc}" alt="${safeAlt}" ${title ? `title="${String(title).replace(/"/g, "&quot;")}"` : ""} />`;
    }
  }
});

function isPreviewTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function parsePreviewTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isPreviewTableSeparator(line: string): boolean {
  return isPreviewTableRow(line) && parsePreviewTableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function formatPreviewTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function normalizeMarkdownTables(markdown: string): string {
  const lines = markdown.split("\n");
  const normalized: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isPreviewTableRow(lines[i]) || i + 1 >= lines.length || !isPreviewTableSeparator(lines[i + 1])) {
      normalized.push(lines[i]);
      continue;
    }

    const headerCells = parsePreviewTableCells(lines[i]);
    const columnCount = Math.max(1, headerCells.length);
    const tableLines = [lines[i], lines[i + 1]];
    i += 2;

    while (i < lines.length && isPreviewTableRow(lines[i])) {
      tableLines.push(lines[i]);
      i++;
    }
    i--;

    normalized.push(formatPreviewTableRow(normalizeTableCells(headerCells, columnCount, "")));
    normalized.push(formatPreviewTableRow(normalizeTableCells(parsePreviewTableCells(tableLines[1]), columnCount, "---")));

    for (const row of tableLines.slice(2)) {
      if (isPreviewTableSeparator(row)) continue;
      normalized.push(formatPreviewTableRow(normalizeTableCells(parsePreviewTableCells(row), columnCount, "")));
    }
  }

  return normalized.join("\n");
}

function normalizeTableCells(cells: string[], columnCount: number, fill: string): string[] {
  const normalized = cells.slice(0, columnCount);
  while (normalized.length < columnCount) normalized.push(fill);
  return normalized;
}

// Keep iframe allow and sandbox attributes unchanged during DOMPurify sanitization
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (node.tagName === "IFRAME" && (data.attrName === "allow" || data.attrName === "sandbox")) {
    data.forceKeepAttr = true;
  }
});

// Beautiful SVG icons for premium look
const CALLOUT_ICONS = {
  note: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  tip: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .4 2.5 1.5 3.5.7.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  important: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  warning: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  danger: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  bug: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-4.97 0-9-4.03-9-9 0-4.97 4.03-9 9-9s9 4.03 9 9c0 4.97-4.03 9-9 9Z"/><path d="M12 9v11"/><path d="M3 11h18"/><path d="m19 15 3 3"/><path d="m5 15-3 3"/><path d="m19 7 3-3"/><path d="m5 7-3-3"/></svg>`,
  example: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14h6"/><path d="M9 18h6"/><path d="M9 10h6"/></svg>`,
  quote: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 .25 1 1 1Z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 .25 1 1 1Z"/></svg>`,
  success: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
  question: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
  abstract: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 1 1 3-3h7z"/></svg>`,
  todo: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
};

// Callout type icons and colors
const CALLOUT_TYPES: Record<string, { icon: string; color: string }> = {
  note: { icon: CALLOUT_ICONS.note, color: "#448aff" },
  info: { icon: CALLOUT_ICONS.info, color: "#448aff" },
  tip: { icon: CALLOUT_ICONS.tip, color: "#00c853" },
  hint: { icon: CALLOUT_ICONS.tip, color: "#00c853" },
  important: { icon: CALLOUT_ICONS.important, color: "#ff5252" },
  warning: { icon: CALLOUT_ICONS.warning, color: "#ff9100" },
  caution: { icon: CALLOUT_ICONS.warning, color: "#ff9100" },
  danger: { icon: CALLOUT_ICONS.danger, color: "#ff5252" },
  error: { icon: CALLOUT_ICONS.danger, color: "#ff5252" },
  bug: { icon: CALLOUT_ICONS.bug, color: "#ff5252" },
  example: { icon: CALLOUT_ICONS.example, color: "#7c4dff" },
  quote: { icon: CALLOUT_ICONS.quote, color: "#9e9e9e" },
  cite: { icon: CALLOUT_ICONS.quote, color: "#9e9e9e" },
  success: { icon: CALLOUT_ICONS.success, color: "#00c853" },
  check: { icon: CALLOUT_ICONS.success, color: "#00c853" },
  done: { icon: CALLOUT_ICONS.success, color: "#00c853" },
  question: { icon: CALLOUT_ICONS.question, color: "#448aff" },
  help: { icon: CALLOUT_ICONS.question, color: "#448aff" },
  faq: { icon: CALLOUT_ICONS.question, color: "#448aff" },
  abstract: { icon: CALLOUT_ICONS.abstract, color: "#00b8d4" },
  summary: { icon: CALLOUT_ICONS.abstract, color: "#00b8d4" },
  tldr: { icon: CALLOUT_ICONS.abstract, color: "#00b8d4" },
  todo: { icon: CALLOUT_ICONS.todo, color: "#448aff" },
  failure: { icon: CALLOUT_ICONS.danger, color: "#ff5252" },
  fail: { icon: CALLOUT_ICONS.danger, color: "#ff5252" },
  missing: { icon: CALLOUT_ICONS.danger, color: "#ff5252" },
};

interface MarkdownPreviewProps {
  content: string;
  onLinkClick: (linkName: string, heading?: string) => void;
  onCheckboxToggle?: (lineIndex: number, checked: boolean) => void;
  onEmbed?: (noteName: string) => string | null;
  onGetLinkPreview?: (noteName: string) => string | null;
  onImageClick?: (src: string, alt: string) => void;
  theme?: string;
  settings?: AppSettings;
  onContentChange?: (content: string) => void;
  constrainWidth?: boolean;
}

const linkPreviewClass = "bg-(--bg-elevated) border border-(--border-medium) rounded-lg shadow-none max-w-[400px] max-h-[300px] overflow-hidden flex flex-col animate-fade-in";
const linkPreviewHeaderClass = "px-3 py-2 border-b border-(--border-subtle) bg-(--bg-secondary)";
const linkPreviewTitleClass = "font-semibold text-[var(--text-sm)] text-(--text-link)";
const linkPreviewContentClass = "p-3 overflow-auto text-[var(--text-sm)] leading-normal text-(--text-secondary) [&_p]:mt-0 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_.preview-empty]:text-(--text-muted) [&_.preview-empty]:italic [&_h1]:text-[var(--text-base)] [&_h1]:mt-0 [&_h1]:mb-2 [&_h2]:text-[var(--text-base)] [&_h2]:mt-0 [&_h2]:mb-2 [&_h3]:text-[var(--text-base)] [&_h3]:mt-0 [&_h3]:mb-2 [&_code]:bg-(--bg-code) [&_code]:px-1 [&_code]:py-px [&_code]:rounded-[3px] [&_code]:text-[0.9em] markdown-rendered";
const markdownPreviewClass =
  "markdown-preview [&_.embed-container]:my-[var(--space-4)] [&_.embed-container]:overflow-hidden [&_.embed-container]:rounded-[var(--radius-md)] [&_.embed-container]:border [&_.embed-container]:border-[var(--border-medium)] [&_.embed-container]:bg-[var(--bg-secondary)] [&_.embed-content]:p-[var(--space-3)] [&_.embed-content]:text-[length:var(--text-sm)] [&_.embed-content]:text-[var(--text-secondary)] [&_.embed-icon]:opacity-60 [&_.embed-missing]:bg-[var(--bg-secondary)] [&_.embed-missing]:p-[var(--space-3)] [&_.embed-missing]:italic [&_.embed-missing]:text-[var(--text-muted)] [&_.embed-title]:flex [&_.embed-title]:items-center [&_.embed-title]:gap-[var(--space-2)] [&_.embed-title]:border-b [&_.embed-title]:border-[var(--border-subtle)] [&_.embed-title]:bg-[var(--bg-tertiary)] [&_.embed-title]:px-[var(--space-3)] [&_.embed-title]:py-[var(--space-2)] [&_.embed-title]:text-[length:var(--text-sm)] [&_.embed-title]:font-medium [&_.embed-title]:text-[var(--text-link)]";

function schedulePreviewIdleWork(callback: () => void, timeout = 500): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };
  const idleWindow = window as typeof window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(id);
    };
  }

  const id = window.setTimeout(run, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

function headingLevel(el: Element): number {
  const match = el.tagName.match(/^H([1-6])$/);
  return match ? Number(match[1]) : 0;
}

function getFoldableHeadingContent(heading: HTMLElement): HTMLElement[] {
  const level = headingLevel(heading);
  if (!level) return [];
  const content: HTMLElement[] = [];
  let node = heading.nextElementSibling as HTMLElement | null;
  while (node) {
    const nextLevel = headingLevel(node);
    if (nextLevel > 0 && nextLevel <= level) break;
    content.push(node);
    node = node.nextElementSibling as HTMLElement | null;
  }
  return content;
}

function setHeadingFoldButtonIcon(button: HTMLButtonElement, collapsed: boolean): void {
  let svg = button.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    button.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px;flex:0 0 auto;transition:transform 160ms cubic-bezier(0.2,0,0,1)">',
      '<path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>',
      "</svg>",
    ].join("");
    svg = button.querySelector<SVGSVGElement>("svg");
  }
  if (svg) {
    svg.style.transform = `rotate(${collapsed ? "0deg" : "90deg"})`;
  }
}

const HEADING_FOLD_ANIMATION_MS = 220;
const headingFoldTimers = new WeakMap<HTMLElement, number>();

function clearHeadingFoldTimer(el: HTMLElement): void {
  const timer = headingFoldTimers.get(el);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    headingFoldTimers.delete(el);
  }
}

function createHeadingFoldWrapper(heading: HTMLElement, elements: HTMLElement[]): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "heading-fold-content";
  wrapper.dataset.headingFoldCollapsed = "false";
  wrapper.style.display = "block";
  heading.after(wrapper);
  for (const el of elements) {
    wrapper.appendChild(el);
  }
  return wrapper;
}

function finishExpandedHeadingFold(wrapper: HTMLElement): void {
  wrapper.style.height = "auto";
  wrapper.style.overflow = "";
  wrapper.style.opacity = "";
  wrapper.style.pointerEvents = "";
  wrapper.style.transition = "";
  wrapper.style.willChange = "";
}

function finishCollapsedHeadingFold(wrapper: HTMLElement): void {
  wrapper.style.display = "none";
  wrapper.style.height = "0px";
  wrapper.style.overflow = "hidden";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.transition = "";
  wrapper.style.willChange = "";
}

function animateHeadingFoldContent(wrapper: HTMLElement, collapsed: boolean): void {
  clearHeadingFoldTimer(wrapper);
  wrapper.dataset.headingFoldCollapsed = String(collapsed);

  const transition = [
    `height ${HEADING_FOLD_ANIMATION_MS}ms cubic-bezier(0.2,0,0,1)`,
    `opacity ${Math.max(120, HEADING_FOLD_ANIMATION_MS - 40)}ms ease`,
  ].join(",");

  if (collapsed) {
    if (wrapper.style.display === "none") return;

    const startHeight = wrapper.getBoundingClientRect().height;
    wrapper.style.transition = "none";
    wrapper.style.display = "block";
    wrapper.style.overflow = "hidden";
    wrapper.style.height = `${startHeight}px`;
    wrapper.style.opacity = "1";
    wrapper.style.pointerEvents = "none";
    wrapper.style.willChange = "height, opacity";
    void wrapper.offsetHeight;
    wrapper.style.transition = transition;

    window.requestAnimationFrame(() => {
      if (wrapper.dataset.headingFoldCollapsed !== "true") return;
      wrapper.style.height = "0px";
      wrapper.style.opacity = "0";
    });

    const timer = window.setTimeout(() => {
      if (wrapper.dataset.headingFoldCollapsed === "true") {
        finishCollapsedHeadingFold(wrapper);
      }
      headingFoldTimers.delete(wrapper);
    }, HEADING_FOLD_ANIMATION_MS);
    headingFoldTimers.set(wrapper, timer);
    return;
  }

  wrapper.style.transition = "none";
  wrapper.style.display = "block";
  wrapper.style.overflow = "hidden";
  wrapper.style.height = "0px";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.willChange = "height, opacity";
  void wrapper.offsetHeight;
  const targetHeight = wrapper.scrollHeight;
  wrapper.style.transition = transition;

  window.requestAnimationFrame(() => {
    if (wrapper.dataset.headingFoldCollapsed === "true") return;
    wrapper.style.height = `${targetHeight}px`;
    wrapper.style.opacity = "1";
  });

  const timer = window.setTimeout(() => {
    if (wrapper.dataset.headingFoldCollapsed !== "true") {
      finishExpandedHeadingFold(wrapper);
    }
    headingFoldTimers.delete(wrapper);
  }, HEADING_FOLD_ANIMATION_MS);
  headingFoldTimers.set(wrapper, timer);
}

function installHeadingFoldControls(container: HTMLElement): void {
  container.querySelectorAll(".heading-fold-toggle").forEach((el) => el.remove());
  const headings = Array.from(
    container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );

  for (const heading of headings) {
    const foldableContent = getFoldableHeadingContent(heading);
    if (foldableContent.length === 0) continue;
    const foldWrapper = createHeadingFoldWrapper(heading, foldableContent);

    heading.style.position = "relative";
    heading.style.paddingLeft = heading.style.paddingLeft || "0";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "heading-fold-toggle";
    button.setAttribute("aria-label", "Fold heading");
    button.setAttribute("aria-expanded", "true");
    setHeadingFoldButtonIcon(button, false);
    button.style.cssText = [
      "position:absolute",
      "left:-24px",
      "top:50%",
      "transform:translateY(-50%)",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "width:20px",
      "height:20px",
      "border:0",
      "border-radius:var(--radius-sm)",
      "background:transparent",
      "color:var(--text-muted)",
      "opacity:0",
      "cursor:pointer",
      "font-size:12px",
      "line-height:1",
      "transition:opacity 120ms ease,color 120ms ease,background-color 120ms ease,transform 120ms ease",
    ].join(";");

    const show = () => {
      button.style.opacity = "1";
    };
    const hide = () => {
      if (button.dataset.collapsed !== "true") button.style.opacity = "0";
    };
    heading.addEventListener("mouseenter", show);
    heading.addEventListener("mouseleave", hide);
    button.addEventListener("mouseenter", show);
    button.addEventListener("mouseleave", hide);
    button.addEventListener("mouseover", () => {
      button.style.backgroundColor = "var(--bg-hover)";
      button.style.color = "var(--text-primary)";
    });
    button.addEventListener("mouseout", () => {
      button.style.backgroundColor = "transparent";
      button.style.color = "var(--text-muted)";
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isCollapsed = button.dataset.collapsed === "true";
      const nextCollapsed = !isCollapsed;
      button.dataset.collapsed = String(nextCollapsed);
      setHeadingFoldButtonIcon(button, nextCollapsed);
      button.setAttribute("aria-label", nextCollapsed ? "Unfold heading" : "Fold heading");
      button.setAttribute("aria-expanded", String(!nextCollapsed));
      button.style.opacity = nextCollapsed ? "1" : "0";
      animateHeadingFoldContent(foldWrapper, nextCollapsed);
    });

    heading.prepend(button);
  }
}

function parseImageRenderMeta(title?: string): {
  width?: number;
  crop: "contain" | "cover";
  offsetX: number;
  offsetY: number;
} {
  const raw = title || "";
  const widthMatch = raw.match(/(?:^|[\s,])w(?:idth)?=(\d{2,4})/i);
  const cropMatch = raw.match(/(?:^|[\s,])crop=(cover|contain)/i);
  const offsetXMatch = raw.match(/(?:^|[\s,])ox=(-?\d{1,4})/i);
  const offsetYMatch = raw.match(/(?:^|[\s,])oy=(-?\d{1,4})/i);
  const width = widthMatch
    ? Math.max(120, Math.min(1400, Number(widthMatch[1])))
    : undefined;
  const crop = (cropMatch?.[1] as "contain" | "cover") || "contain";
  const offsetX = offsetXMatch
    ? Math.max(-1200, Math.min(1200, Number(offsetXMatch[1])))
    : 0;
  const offsetY = offsetYMatch
    ? Math.max(-1200, Math.min(1200, Number(offsetYMatch[1])))
    : 0;
  return { width, crop, offsetX, offsetY };
}

function protectFencedCodeBlocks(text: string): {
  text: string;
  restore: (value: string) => string;
} {
  const blocks: string[] = [];
  const protectedText = text.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3[ \t]*(?=\n|$)/g,
    (match) => {
      const token = `\uE000CODE_BLOCK_${blocks.length}\uE000`;
      blocks.push(match);
      return token;
    },
  );

  return {
    text: protectedText,
    restore: (value: string) =>
      value.replace(/\uE000CODE_BLOCK_(\d+)\uE000/g, (_, index) => blocks[Number(index)] || ""),
  };
}

export function MarkdownPreview({
  content,
  onLinkClick,
  onCheckboxToggle,
  onEmbed,
  onGetLinkPreview,
  onImageClick,
  theme,
  settings,
  onContentChange,
  constrainWidth = true,
}: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [debouncedContent, setDebouncedContent] = useState("");
  const contentRef = useRef(content);
  contentRef.current = content;
  const [processorVersion, setProcessorVersion] = useState(0);

  useEffect(() => {
    const handleProcessorsChanged = () => setProcessorVersion((version) => version + 1);
    window.addEventListener('obsidian:markdown-processors-changed', handleProcessorsChanged);
    return () => window.removeEventListener('obsidian:markdown-processors-changed', handleProcessorsChanged);
  }, []);

  useEffect(() => {
    let cancelIdle: (() => void) | null = null;
    const handler = setTimeout(() => {
      cancelIdle = schedulePreviewIdleWork(() => {
        setDebouncedContent(content);
      }, 500);
    }, content.length > 8000 ? 80 : 0);

    return () => {
      clearTimeout(handler);
      cancelIdle?.();
    };
  }, [content]);

  const [linkPreview, setLinkPreview] = useState<{
    noteName: string;
    content: string | null;
    position: { x: number; y: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Process callouts (Obsidian-style admonitions)
  const processCallouts = (text: string): string => {
    // Match > [!type] or > [!type]+ or > [!type]- with optional title
    const calloutRegex = /^(>\s*)\[!(\w+)\]([+-]?)(?:[ \t]+(.*))?$/gm;

    return text.replace(
      calloutRegex,
      (match, prefix, type, foldState, title) => {
        const calloutType = type.toLowerCase();
        const config = CALLOUT_TYPES[calloutType] || CALLOUT_TYPES.note;
        const displayTitle =
          title || calloutType.charAt(0).toUpperCase() + calloutType.slice(1);
        const isFoldable = foldState === "+" || foldState === "-";
        const isCollapsed = foldState === "-";

        return `${prefix}<div class="callout callout-${calloutType}" data-callout="${calloutType}" data-foldable="${isFoldable}" data-collapsed="${isCollapsed}" style="--callout-color: ${config.color}">
> <div class="callout-title"><span class="callout-icon">${config.icon}</span><span class="callout-title-text">${displayTitle}</span>${isFoldable ? '<span class="callout-fold">▼</span>' : ""}</div>
> <div class="callout-content">`;
      },
    );
  };

  // Close callout blocks
  const closeCallouts = (html: string): string => {
    // Clean up empty paragraph tags inside callouts
    let cleaned = html.replace(
      /<div class="callout-content">\s*<\/p>/g,
      '<div class="callout-content">',
    );

    // Safely close callouts only for blockquotes that actually opened them
    const parts = cleaned.split(/(<\/blockquote>)/);
    let openCalloutsCount = 0;
    
    return parts.map((part) => {
      if (part === "</blockquote>") {
        if (openCalloutsCount > 0) {
          openCalloutsCount--;
          return "</div></div></blockquote>";
        }
        return part;
      }
      
      const matches = part.match(/<div class="callout callout-/g);
      if (matches) {
        openCalloutsCount += matches.length;
      }
      return part;
    }).join("");
  };

  // Generate premium HTML wrapper card for URL previews
  const getUrlPreviewMarkup = useCallback((url: string, currentTheme: string, customAttrs?: { width?: string; height?: string; style?: string }) => {
    const isNoEmbed = url.includes("#no-embed");
    const urlWithHashCleaned = url.replace(/#no-embed/g, "").trim();
    const cleanUrl = cleanEmbedUrl(urlWithHashCleaned);

    // Extract custom dimensions from hash/fragment (e.g. #width=600&height=175)
    let hashAttrs: { width?: string; height?: string } = {};
    try {
      const hashIndex = cleanUrl.indexOf("#");
      if (hashIndex !== -1) {
        const hash = cleanUrl.substring(hashIndex);
        const widthMatch = hash.match(/[#&]width=([^&]+)/i);
        const heightMatch = hash.match(/[#&]height=([^&]+)/i);
        if (widthMatch) hashAttrs.width = decodeURIComponent(widthMatch[1]);
        if (heightMatch) hashAttrs.height = decodeURIComponent(heightMatch[1]);
      }
    } catch {}

    // Strip hash from cleanUrl before resolving to avoid regex matches breaking
    const cleanUrlWithoutHash = cleanUrl.split("#")[0];
    const displayDomain = getDisplayDomain(cleanUrlWithoutHash);
    
    // Resolve smart embed settings
    const config = getSmartEmbed(cleanUrlWithoutHash);
    const embedSrc = config.src;
    
    const finalStyle = customAttrs?.style;
    const finalWidth = customAttrs?.width || hashAttrs.width;
    const finalHeight = customAttrs?.height || hashAttrs.height;

    // Check if the registry config or overrides define dimensions
    const hasCustomWidth = !!finalWidth || (config.attrs.style && (!!config.attrs.style.width || !!config.attrs.style.maxWidth));
    const hasCustomHeight = !!finalHeight || (config.attrs.style && !!config.attrs.style.height);

    let cardStyle = "";
    let bodyStyle = "";

    if (finalStyle) {
      cardStyle = finalStyle;
    } else {
      if (hasCustomWidth) {
        const rawWidth = finalWidth || (config.attrs.style ? (config.attrs.style.width || config.attrs.style.maxWidth) : "");
        if (rawWidth) {
          const w = String(rawWidth).endsWith('%') || String(rawWidth).endsWith('px') || String(rawWidth).endsWith('vh') || String(rawWidth).endsWith('vw') ? rawWidth : `${rawWidth}px`;
          cardStyle = `max-width: ${w}; width: 100%; margin: 8px auto;`;
        }
      }
      if (hasCustomHeight) {
        const rawHeight = finalHeight || (config.attrs.style ? config.attrs.style.height : "");
        if (rawHeight) {
          const h = String(rawHeight).endsWith('%') || String(rawHeight).endsWith('px') || String(rawHeight).endsWith('vh') || String(rawHeight).endsWith('vw') ? rawHeight : `${rawHeight}px`;
          bodyStyle = `height: ${h}; aspect-ratio: auto;`;
        }
      }
    }

    const sandboxAttr = config.attrs.sandbox ? `sandbox="${config.attrs.sandbox}"` : '';
    const embedAttrs = `${config.attrs.allow ? `allow="${config.attrs.allow}"` : ''} ${config.attrs.allowFullScreen ? 'allowfullscreen' : ''} ${sandboxAttr}`;
    const badge = config.badge;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${displayDomain}&sz=32`;

    if (isNoEmbed) {
      // Link only mode
      return `<div class="url-preview-card link-only" data-url="${url}" style="position: relative; ${cardStyle}">
        <div class="url-preview-header">
          <div class="url-preview-info">
            <img class="url-preview-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">
            <span class="url-preview-title">${displayDomain}</span>
          </div>
          <div class="url-preview-actions">
            <span class="url-preview-badge">${badge} (Link)</span>
            <a class="url-preview-action-btn" href="${cleanUrl}" target="_blank" rel="noopener noreferrer" title="Open in new tab">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        </div>
        <div class="url-preview-link-body" style="padding: 12px 16px 12px 44px; font-size: 13px;">
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color, #3b82f6); text-decoration: underline; word-break: break-all;">
            ${cleanUrl}
          </a>
        </div>
        <button class="url-preview-toggle-floating url-preview-toggle-btn" title="Convert to Iframe Embed">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
        </button>
      </div>`;
    }

    // Embed mode
    return `<div class="url-preview-card embed-only" data-url="${url}" style="position: relative; ${cardStyle}">
      <div class="url-preview-body" style="position: relative; ${bodyStyle}">
        <iframe class="url-preview-iframe" src="${embedSrc}" ${embedAttrs} style="height:100%; width:100%; border: none;"></iframe>
      </div>
      <button class="url-preview-toggle-floating url-preview-toggle-btn" title="Convert to Link only">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
    </div>`;
  }, []);

  // Configure marked for GFM (GitHub Flavored Markdown) support
  const renderedHtml = useMemo(() => {
    if (!debouncedContent) return "";

    let processed = debouncedContent;
    // Convert ==highlight== to <mark>highlight</mark>
    processed = processed.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
    const protectedCode = protectFencedCodeBlocks(processed);
    processed = protectedCode.text;
    processed = normalizeMarkdownTables(processed);

    // Convert url to preview (iframe) - standalone URLs or markdown links to ANY URL
    processed = processed.replace(
      /^(?:[ \t]*)(https?:\/\/[^\s]+)(?:[ \t]*)$/gm,
      (match, url) => `<div class="url-preview-placeholder" data-url="${url.trim()}"></div>`
    );

    processed = processed.replace(
      /^(?:[ \t]*)\[[^\]]*\]\((https?:\/\/[^\s)]+)\)(?:[ \t]*)$/gm,
      (match, url) => `<div class="url-preview-placeholder" data-url="${url.trim()}"></div>`
    );

    // Process embeds ![[note]] before other processing
    processed = processed.replace(
      /!\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
      (match, noteName, heading, displayText) => {
        const embedContent = onEmbed ? onEmbed(noteName) : null;
        if (embedContent) {
          return `<div class="embed-container" data-embed="${noteName}">
            <div class="embed-title">${noteName}${heading ? " › " + heading : ""}</div>
            <div class="embed-content">${embedContent}</div>
          </div>`;
        }
        return `<div class="embed-container embed-missing" data-embed="${noteName}">
          <span class="embed-icon">📄</span> ${displayText || noteName} (not found)
        </div>`;
      },
    );

    // Process wiki-links with alias and heading support
    processed = processed.replace(
      /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
      (match, noteName, heading, alias) => {
        const displayText =
          alias || (heading ? `${noteName} › ${heading}` : noteName);
        const dataHeading = heading ? ` data-heading="${heading}"` : "";
        return `<a class="wiki-link" data-link="${noteName}"${dataHeading} href="#">${displayText}</a>`;
      },
    );

    // Process tags
    processed = processed.replace(
      /(?:^|\s)(#[a-zA-Z][a-zA-Z0-9_/-]*)/gm,
      ' <span class="tag" data-tag="$1">$1</span>',
    );

    // Render markdown image metadata controls
    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (match, alt, src, title) => {
        const { width, crop, offsetX, offsetY } = parseImageRenderMeta(title);
        const styleParts: string[] = [];
        if (width) {
          styleParts.push(`max-width:${Math.round(width)}px`);
          styleParts.push("width:100%");
        }
        if (crop === "cover") {
          styleParts.push("aspect-ratio:4 / 3");
          styleParts.push("object-fit:cover");
          styleParts.push(`object-position:calc(50% + ${Math.round(offsetX)}px) calc(50% + ${Math.round(offsetY)}px)`);
        }
        const safeAlt = String(alt).replace(/"/g, "&quot;");
        const resolvedSrc = resolveVaultImageSrc(String(src));
        const safeSrc = resolvedSrc.replace(/"/g, "&quot;");
        return `<img src="${safeSrc}" alt="${safeAlt}"${styleParts.length ? ` style="${styleParts.join(";")}"` : ""} />`;
      },
    );

    // Process callouts
    processed = processCallouts(processed);

    // Checkboxes
    let lineNum = 0;
    processed = processed.replace(
      /^(\s*[-*+]\s+)\[([ xX])\]/gm,
      (match, prefix, checked) => {
        const isChecked = checked.toLowerCase() === "x";
        return `${prefix}<input type="checkbox" class="task-checkbox" data-line="${lineNum++}" ${isChecked ? "checked" : ""}>`;
      },
    );
    processed = protectedCode.restore(processed);

    if (settings?.propertiesInDocument === "hidden") {
      processed = processed.replace(/^---\n[\s\S]*?\n---\n?/, "");
    }

    // Parse markdown to HTML
    let html = marked.parse(processed, {
      gfm: true,
      breaks: settings?.strictLineBreaks !== true,
    }) as string;
    html = closeCallouts(html);
    html = html.replace(
      /<li>\s*(<input\b[^>]*class="task-checkbox"[^>]*>)/g,
      '<li class="task-list-item">$1',
    );

    // --- Unified Smart Embed Resolver ---
    // Handle both raw iframes and Twitter blockquotes
    const themeValue = document.documentElement.getAttribute("data-theme-mode") || (theme === "dark" ? "dark" : "light");

    // Fix Twitter theme in the HTML string itself
    html = html.replace(/<blockquote class="twitter-tweet"/g, `<blockquote class="twitter-tweet" data-theme="${themeValue}"`);

    // Parse URL preview placeholders into premium cards and strip any wrapping paragraphs
    html = html.replace(
      /(?:<p>)?<div class="url-preview-placeholder" data-url="([^"]+)"><\/div>(?:<\/p>)?/g,
      (match, url) => {
        return getUrlPreviewMarkup(url, theme || "dark");
      }
    );

    // Handle all other raw empty iframes via the registry (ignore already-wrapped ones)
    html = html.replace(/<iframe\s+([^>]*src="([^"]+)"[^>]*)><\/iframe>/g, (match, attrs, src) => {
      if (attrs.includes("url-preview-iframe")) {
        return match;
      }
      
      // Extract width, height, and style attributes from attrs
      const widthMatch = attrs.match(/width=(["'])(.*?)\1/i);
      const heightMatch = attrs.match(/height=(["'])(.*?)\1/i);
      const styleMatch = attrs.match(/style=(["'])(.*?)\1/i);
      
      const customAttrs = {
        width: widthMatch ? widthMatch[2] : undefined,
        height: heightMatch ? heightMatch[2] : undefined,
        style: styleMatch ? styleMatch[2] : undefined,
      };

      return getUrlPreviewMarkup(src, theme || "dark", customAttrs);
    });

    // Sanitize
    return DOMPurify.sanitize(html, {
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|vault):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      ADD_ATTR: ["data-link", "data-tag", "data-line", "data-heading", "data-embed", "data-callout", "data-foldable", "data-collapsed", "data-theme", "data-video-id", "data-url", "data-active-player", "checked", "type", "style", "frameborder", "allow", "allowfullscreen", "scrolling", "width", "height", "sandbox", "src", "onmouseover", "onmouseout", "onerror", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "cx", "cy", "r", "x", "y", "rx", "ry", "x1", "y1", "x2", "y2", "d"],
      ADD_TAGS: ["span", "input", "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "mspace", "msqrt", "mfrac", "table", "tbody", "tr", "mtd", "mtr", "annotation", "iframe", "blockquote", "div", "svg", "path", "circle", "line", "rect", "polyline"],
      ADD_DATA_URI_TAGS: ["img"],
    });
  }, [debouncedContent, onEmbed, theme, getSmartEmbed, getUrlPreviewMarkup]);

  // Handle clicks on wiki-links, tags, and checkboxes
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;

      // Handle image click for fullscreen preview
      if (target.tagName === "IMG" && !target.classList.contains("yt-poster-img") && onImageClick) {
        const image = target as HTMLImageElement;
        if (image.src) {
          e.preventDefault();
          e.stopPropagation();
          onImageClick(image.src, image.alt || "Image");
          return;
        }
      }

      // Handle URL preview toggle mode (iframe vs link)
      const toggleBtn = target.closest(".url-preview-toggle-btn");
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        const card = toggleBtn.closest(".url-preview-card");
        const cardUrl = card?.getAttribute("data-url");
        if (card && cardUrl && onContentChange) {
          const isCurrentlyLinkOnly = card.classList.contains("link-only");
          const nextContent = toggleUrlInMarkdown(contentRef.current, cardUrl, !isCurrentlyLinkOnly);
          onContentChange(nextContent);
        }
        return;
      }

      // Handle wiki-link clicks
      if (target.classList.contains("wiki-link")) {
        e.preventDefault();
        e.stopPropagation();
        const linkName = target.getAttribute("data-link");
        const heading = target.getAttribute("data-heading");
        if (linkName) {
          onLinkClick(linkName, heading || undefined);
        }
      }

      // Handle checkbox clicks
      if (target.classList.contains("task-checkbox")) {
        const lineIndex = parseInt(target.getAttribute("data-line") || "0", 10);
        const isChecked = (target as HTMLInputElement).checked;
        if (onCheckboxToggle) {
          onCheckboxToggle(lineIndex, isChecked);
        }
      }

      // Handle callout fold toggle
      if (
        target.classList.contains("callout-fold") ||
        target.classList.contains("callout-title")
      ) {
        const callout = target.closest(".callout");
        if (callout && callout.getAttribute("data-foldable") === "true") {
          const isCollapsed = callout.getAttribute("data-collapsed") === "true";
          callout.setAttribute(
            "data-collapsed",
            isCollapsed ? "false" : "true",
          );
        }
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onLinkClick, onCheckboxToggle, onImageClick, onContentChange]);

  // Handle link hover for preview
  useEffect(() => {
    const container = previewRef.current;
    if (!container || !onGetLinkPreview || settings?.corePagePreview === false || settings?.pagePreviewReading === false) return;

    const handleMouseEnter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("wiki-link")) {
        if (settings?.pagePreviewRequireCtrl && !e.ctrlKey && !e.metaKey) return;
        const linkName = target.getAttribute("data-link");
        if (!linkName) return;

        // Clear any existing timeout
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }

        // Delay showing preview
        hoverTimeoutRef.current = setTimeout(() => {
          const previewContent = onGetLinkPreview(linkName);
          const rect = target.getBoundingClientRect();
          setLinkPreview({
            noteName: linkName,
            content: previewContent,
            position: { x: rect.left, y: rect.bottom + 5 },
          });
        }, 400); // 400ms delay before showing
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("wiki-link")) {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        // Small delay before hiding to allow moving to preview
        setTimeout(() => {
          setLinkPreview(null);
        }, 100);
      }
    };

    container.addEventListener("mouseover", handleMouseEnter);
    container.addEventListener("mouseout", handleMouseLeave);

    return () => {
      container.removeEventListener("mouseover", handleMouseEnter);
      container.removeEventListener("mouseout", handleMouseLeave);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [onGetLinkPreview, settings?.corePagePreview, settings?.pagePreviewReading, settings?.pagePreviewRequireCtrl]);

  // Render preview content for link preview popup
  const renderPreviewContent = useCallback((content: string | null) => {
    if (!content) return '<p class="preview-empty">Note not found</p>';

    // Remove frontmatter
    let text = content.replace(/^---[\s\S]*?---\s*/m, "");

    // Truncate to ~500 chars for preview
    if (text.length > 500) {
      text = text.slice(0, 500) + "...";
    }

    // Render markdown
    const html = marked.parse(text, { async: false, breaks: true }) as string;
    return DOMPurify.sanitize(html);
  }, []);

  // Use a ref to track the last rendered HTML to avoid unnecessary DOM updates that reload iframes
  const lastHtmlRef = useRef<string>("");

  // Manually update the DOM and upgrade iframes injected by plugins
  useEffect(() => {
    if (!previewRef.current) return;
    let processorCleanup: (() => void) | undefined;
    let cancelled = false;
    let observer: MutationObserver | null = null;

    if (lastHtmlRef.current !== renderedHtml || processorVersion > 0) {
      previewRef.current.innerHTML = renderedHtml;
      lastHtmlRef.current = renderedHtml;
    }

    // Function to upgrade YouTube iframes into HD Posters
    const upgradeYouTubeIframe = (iframe: HTMLIFrameElement) => {
      const src = iframe.src || "";
      if (!src.includes("youtube.com") && !src.includes("youtu.be")) return;
      if (iframe.dataset.hdPosterApplied || iframe.dataset.activePlayer === "true") return;

      const videoId = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?]+)/)?.[1];
      if (!videoId) return;

      iframe.dataset.hdPosterApplied = "true";

      const hdThumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      const hqThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      const wrapper = document.createElement("div");
      wrapper.className = "yt-hd-poster";
      wrapper.style.cssText = "position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; cursor: pointer; margin: 16px 0;";

      wrapper.innerHTML = `
        <img class="yt-poster-img" src="${hdThumb}" onerror="this.src='${hqThumb}'" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.2s;">
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 68px; height: 48px; background: rgba(255, 0, 0, 0.9); border-radius: 12px; display: flex; align-items: center; justify-content: center; pointer-events: none; box-shadow: none;">
          <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; fill: white;"><path d="M8 5v14l11-7z"/></svg>
        </div>
      `;

      wrapper.onmouseover = () => { (wrapper.querySelector('img') as HTMLImageElement).style.opacity = '0.8'; };
      wrapper.onmouseout = () => { (wrapper.querySelector('img') as HTMLImageElement).style.opacity = '1'; };

      wrapper.onclick = () => {
        wrapper.innerHTML = `<iframe data-active-player="true" class="url-preview-iframe" src="https://www.youtube.com/embed/${videoId}?autoplay=1&vq=hd1080" allow="fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen style="width:100%; height:100%; border:none; border-radius: 12px;"></iframe>`;
      };

      if (iframe.parentNode) {
        iframe.parentNode.replaceChild(wrapper, iframe);
      }
    };

    const cancelIdle = schedulePreviewIdleWork(() => {
      if (cancelled || !previewRef.current) return;

      installHeadingFoldControls(previewRef.current);

      // Handle Twitter embeds: if twit-blockquote exists, ensure widgets script is loaded and triggered
      if (renderedHtml.includes("twitter-tweet")) {
        // Apply theme to blockquotes before Twitter script processes them
        const tweets = previewRef.current.querySelectorAll("blockquote.twitter-tweet");
        tweets.forEach(tweet => {
          tweet.setAttribute("data-theme", document.documentElement.getAttribute("data-theme-mode") || (theme === "dark" ? "dark" : "light"));
        });

        const injectTwitter = () => {
          if (!(window as any).twttr) {
            const script = document.createElement("script");
            script.src = "https://platform.twitter.com/widgets.js";
            script.async = true;
            document.head.appendChild(script);
          } else if ((window as any).twttr.widgets) {
            (window as any).twttr.widgets.load(previewRef.current);
          }
        };
        injectTwitter();
      }

      void runMarkdownPostProcessors(
        previewRef.current,
        (window as any).__oo_active_file || '',
      ).then((cleanup) => {
        if (cancelled) cleanup();
        else processorCleanup = cleanup;
      });

      // Upgrade existing iframes
      previewRef.current.querySelectorAll("iframe").forEach((el) => upgradeYouTubeIframe(el as HTMLIFrameElement));

      // Watch for iframes injected asynchronously by plugins (like obsidian-convert-url-to-iframe)
      observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // ELEMENT_NODE
              const el = node as HTMLElement;
              const iframes = el.tagName === "IFRAME" ? [el as HTMLIFrameElement] : Array.from(el.querySelectorAll("iframe"));
              iframes.forEach(upgradeYouTubeIframe);
            }
          });
        });
      });

      observer.observe(previewRef.current, { childList: true, subtree: true });
    }, 700);

    return () => {
      cancelled = true;
      cancelIdle();
      processorCleanup?.();
      observer?.disconnect();
    };
  }, [renderedHtml, theme, processorVersion]);

  return (
    <>
      <div
        ref={previewRef}
        className={markdownPreviewClass}
        style={constrainWidth ? {
          width: "100%",
          maxWidth: "var(--reading-view-width)",
          margin: "0 auto",
        } : undefined}
      />

      {/* Link Preview Popup */}
      {linkPreview && (
        <div
          className={linkPreviewClass}
          style={{
            position: "fixed",
            left: linkPreview.position.x,
            top: linkPreview.position.y,
            zIndex: 10000,
          }}
          onMouseEnter={() => {
            // Keep preview open while hovering
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={() => setLinkPreview(null)}
        >
          <div className={linkPreviewHeaderClass}>
            <span className={linkPreviewTitleClass}>{linkPreview.noteName}</span>
          </div>
          <div
            className={linkPreviewContentClass}
            dangerouslySetInnerHTML={{
              __html: renderPreviewContent(linkPreview.content),
            }}
          />
        </div>
      )}
    </>
  );
}
