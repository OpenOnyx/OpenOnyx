/**
 * Editor - Main Markdown Editing Component
 *
 * Features:
 * - CodeMirror 6 for the editor with markdown syntax highlighting
 * - Live markdown preview using the `marked` library
 * - Split view showing both editor and preview
 * - Tab management for multiple open notes
 * - Wiki-link [[link]] support in both editor and preview
 * - Link autocomplete when typing [[
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Lightbulb, BookOpen, Pen, RefreshCw, Sparkles, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Compartment, EditorState, Transaction, StateEffect, StateField, EditorSelection } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  ViewUpdate,
  Decoration,
  DecorationSet,
  ViewPlugin,
  WidgetType,
  Command,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { closeBrackets } from "@codemirror/autocomplete";
import { search, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Tab, ViewMode } from "../../types";
import { MarkdownPreview } from "./MarkdownPreview";
import { marked } from "marked";
import { SearchReplace } from "./SearchReplace";
import { getDisplayDomain } from "../../utils/urlHelper";
import {
  Editor as ObsidianEditor,
  MarkdownView,
  Menu,
  TFile,
  editorEditorField,
  editorInfoField,
  editorLivePreviewField,
  setEditorEditorEffect,
  setEditorInfoEffect,
  setEditorLivePreviewEffect,
} from "../../lib/obsidian-api";
import { getAPI } from "../../utils/api";
import {
  linkAutocomplete,
  linkAutocompleteTheme,
  setAvailableNotes,
} from "../../utils/linkAutocomplete";
import { headingFold, foldTheme } from "../../utils/headingFold";
import { resolveVaultImageSrc } from "../../utils/resolveImageSrc";
import { vimCompartment, toggleVimMode } from "../../editor/vimExtension";
import { type LinkType } from "../ai/SuggestionBanner";
import type { EnrichedSuggestion } from "../../utils/suggestion-enrichment";
import type { CollabOperation, CursorPresence } from "../../utils/collabOperations";
import { extractOperations } from "../../utils/collabOperations";
import { remoteCursorsExtension, setCursorsEffect } from "../../utils/remoteCursorsPlugin";
import { authManager } from "../../lib/auth";
import { loadAIConfig, getBaseUrl, getProviderHeaders, parseProviderError } from "../../utils/ai-settings";
import type { AppSettings } from "../settings/SettingsPage";

const validPluginEditorExtensionCache = new WeakMap<object, boolean>();
const invalidPluginEditorExtensions = new Set<any>();

type PluginEditorExtensionEntry = {
  pluginId?: string;
  extension: any;
};

const codeMirrorPluginExceptionSink = EditorView.exceptionSink.of((exception) => {
  console.warn("[CodeMirror Plugin Error]", exception);
});

const pluginExtensionValidationDoc = [
  "# Heading",
  "",
  "- [ ] Task item",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| A | B |",
  "",
  "```",
  "code",
  "```",
  "",
  "[[Link]] #tag",
].join("\n");

function isPluginEditorExtensionUsable(extension: any, pluginId?: string): boolean {
  if (!extension) return false;
  if (typeof extension === "object" || typeof extension === "function") {
    const cached = validPluginEditorExtensionCache.get(extension);
    if (cached !== undefined) return cached;
  } else if (invalidPluginEditorExtensions.has(extension)) {
    return false;
  }

  try {
    let validationException: unknown = null;
    const state = EditorState.create({
      doc: pluginExtensionValidationDoc,
      extensions: [
        EditorView.exceptionSink.of((exception) => {
          validationException = exception;
        }),
        editorInfoField,
        editorEditorField,
        editorLivePreviewField,
        markdown(),
        EditorView.lineWrapping,
        extension,
      ],
    });
    if (typeof document !== "undefined") {
      const parent = document.createElement("div");
      const view = new EditorView({ state, parent });
      view.destroy();
      parent.remove();
    }
    if (validationException) throw validationException;
    if (typeof extension === "object" || typeof extension === "function") {
      validPluginEditorExtensionCache.set(extension, true);
    }
    return true;
  } catch (error) {
    if (typeof extension === "object" || typeof extension === "function") {
      validPluginEditorExtensionCache.set(extension, false);
    } else {
      invalidPluginEditorExtensions.add(extension);
    }
    const owner = pluginId ? ` from ${pluginId}` : "";
    console.warn(`[PluginSystem] Skipping incompatible CodeMirror extension${owner}`, error);
    return false;
  }
}

function getPluginEditorExtensionEntries(): PluginEditorExtensionEntry[] {
  const entries = (window as any).__oo_editor_extension_entries;
  if (Array.isArray(entries)) {
    return entries.filter((entry) => entry && "extension" in entry);
  }

  const extensions = (window as any).__oo_editor_extensions;
  if (!Array.isArray(extensions)) return [];
  return extensions.map((extension) => ({ extension }));
}

function getSafePluginEditorExtensions(): any[] {
  return getPluginEditorExtensionEntries()
    .filter(({ extension, pluginId }) => isPluginEditorExtensionUsable(extension, pluginId))
    .map(({ extension }) => extension);
}

function setWritableViewProperty(view: any, key: string, value: unknown): void {
  for (let target = view; target; target = Object.getPrototypeOf(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;
    if (!descriptor.writable && !descriptor.set) return;
    break;
  }
  view[key] = value;
}

const resizerClass =
  "resizer relative z-10 w-1 shrink-0 cursor-ew-resize bg-transparent transition-colors duration-100 after:absolute after:inset-y-0 after:left-px after:w-0.5 after:bg-[var(--divider-color)] after:opacity-100 hover:after:left-0.5 hover:after:w-[3px] hover:after:bg-[var(--interactive-accent)] active:after:left-0.5 active:after:w-[3px] active:after:bg-[var(--interactive-accent)]";
const inlineAiToolbarClass =
  "inline-ai-toolbar flex min-w-[400px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-0 shadow-none transition-all duration-150";
const inlineAiButtonsRowClass = "flex w-full items-center";
const inlineAiButtonsRowPromptClass =
  "border-b border-[var(--border-subtle)]";
const inlineAiButtonClass =
  "inline-ai-btn flex flex-1 cursor-pointer items-center justify-center rounded-none border-0 bg-transparent px-3.5 py-2.5 text-center text-[12.5px] font-semibold text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--border-subtle)]";
const inlineAiButtonActiveClass =
  "bg-[var(--bg-active)] text-[var(--text-primary)]";
const inlineAiPromptRowClass =
  "flex w-full items-center gap-2 bg-[var(--bg-primary)] px-2.5 py-2";
const inlineAiPromptInputClass =
  "inline-ai-prompt-input flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-[7px] text-[12.5px] text-[var(--text-primary)] outline-none transition-all duration-150 placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:bg-[var(--bg-primary)]";
const inlineAiPromptSubmitClass =
  "inline-ai-prompt-submit cursor-pointer rounded-[var(--radius-sm)] border-0 bg-[var(--accent-primary)] px-3.5 py-[7px] text-xs font-semibold text-[var(--text-on-accent)] transition-all duration-150 hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:bg-[var(--bg-active)] disabled:text-[var(--text-muted)]";
const inlineAiLoadingClass =
  "inline-ai-toolbar flex min-w-[200px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-5 py-2.5 text-[12.5px] text-[var(--text-secondary)]";
const inlineAiExplanationClass =
  "flex w-[340px] flex-col overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--color-base-25)] shadow-none backdrop-blur-xl";
const inlineAiExplanationHeaderClass =
  "flex items-center justify-between border-b border-[var(--border-strong)] bg-[var(--bg-hover)] px-3 py-2 text-[11px] font-semibold text-[var(--text-primary)]";
const inlineAiExplanationCloseClass =
  "flex cursor-pointer rounded border-0 bg-transparent p-0.5 text-[var(--text-muted)] transition-all duration-150 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]";
const inlineAiExplanationBodyClass =
  "max-h-[200px] overflow-y-auto p-3 text-[11px] leading-normal text-[var(--text-secondary)]";
const inlineAiDecisionFooterClass =
  "absolute bottom-4 right-4 z-[5100] flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-2.5 py-2 shadow-none";
const inlineAiDecisionButtonClass =
  "cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const inlineAiDecisionAcceptClass =
  "border-transparent bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--accent-secondary)] hover:text-[var(--text-on-accent)]";
const editorAnnotationClass =
  "mx-[clamp(24px,5vw,72px)] my-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-4 shadow-none";
const editorAnnotationHeaderClass =
  "mb-2 flex items-center justify-between";
const editorAnnotationTitleClass =
  "flex items-center text-[13px] font-semibold uppercase tracking-[0.05em] text-[var(--text-primary)]";
const editorAnnotationActionsClass = "flex items-center gap-2";
const editorAnnotationIconBtnClass =
  "flex cursor-pointer items-center justify-center rounded border-0 bg-transparent p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const editorAnnotationTextClass =
  "text-sm leading-normal text-[var(--text-secondary)]";
const editorAnnotationLoadingClass =
  "flex items-center gap-2 text-[13px] text-[var(--text-muted)]";
const editorAnnotationEmptyClass =
  "flex flex-col items-start gap-2";
const editorAnnotationEmptyTextClass =
  "text-[13px] text-[var(--text-muted)]";
const editorAnnotationGenerateClass =
  "flex cursor-pointer items-center gap-1.5 rounded border-0 bg-[var(--accent-color,#3b82f6)] px-3 py-1.5 text-xs font-medium text-white";
const editorContainerClass =
  "editor-container relative flex min-h-0 flex-1 flex-row overflow-hidden";
const editorLightboxBackdropClass =
  "fixed inset-0 z-[9999] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-primary)_45%,transparent)] backdrop-blur-[3px]";
const editorLightboxModalClass =
  "relative flex max-h-[min(88vh,900px)] max-w-[min(92vw,1200px)] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-[var(--space-3)] shadow-none";
const editorLightboxCloseClass =
  "absolute right-2 top-2 h-7 w-7 cursor-pointer rounded-full border border-[var(--border-medium)] bg-[var(--bg-secondary)] text-xl leading-none text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]";
const editorLightboxImageClass =
  "h-auto max-h-[min(82vh,820px)] w-auto max-w-[min(88vw,1120px)] rounded-[var(--radius-md)] object-contain";

interface EditorProps {
  tabs: Tab[];
  availableNotes?: { name: string; path: string }[];
  activeTabId: string;
  content: string;
  viewMode: ViewMode;
  specialContent?: React.ReactNode;
  onAdjustFontSize: (
    delta: number,
    scope: "both" | "editor" | "preview",
  ) => void;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onContentChange: (content: string, isUserEdit?: boolean, path?: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onLinkClick: (linkName: string, heading?: string) => void;
  onGetNoteContent?: (noteName: string) => string | null;
  onImagePaste?: (file: File) => Promise<string | null>;
  // Inline suggestions (from embedding similarity)
  suggestions?: EnrichedSuggestion[];
  nextStepSuggestions?: EnrichedSuggestion[];
  onAcceptSuggestion?: (path: string, linkType: LinkType) => void;
  onRejectSuggestion?: (path: string) => void;
  onOpenNote?: (path: string) => void;
  // Inline annotation
  annotation?: string | null;
  showInsight?: boolean;
  onToggleInsight?: (show: boolean) => void;
  theme?: string;
  settings?: AppSettings;
  // Collaboration: operation-based sync
  onCollabOperations?: (ops: CollabOperation[]) => void;
  onCursorChange?: (cursor: { from: number; to: number }) => void;
  remoteCursors?: CursorPresence[];
  /** The local client ID, used to tag extracted operations. */
  localClientId?: string;
  /** Called when the CodeMirror EditorView is created or destroyed. */
  onEditorViewReady?: (view: import("@codemirror/view").EditorView | null) => void;
  getViewState?: (path: string) => { scroll?: number; cursor?: number } | undefined;
  onViewStateChange?: (path: string, state: { scroll?: number; cursor?: number }) => void;
  readOnly?: boolean;
  onGenerateInsight?: () => void;
  isGeneratingInsight?: boolean;
  isFocused?: boolean;
  /**
   * When provided, the editor uses Yjs CRDT collaboration instead of the legacy
   * operation-based system. This Extension array should contain the output of
   * yCollab() and yUndoManagerKeymap from y-codemirror.next.
   * When set, history() and remoteCursorsExtension() are omitted, and
   * extractOperations / onCollabOperations are not called.
   */
  yCollabExtension?: import("@codemirror/state").Extension;
}

function getEditorSettingsExtensions(settings?: AppSettings) {
  return [
    settings?.showLineNumbers ? lineNumbers() : [],
    settings?.wordWrap !== false ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(settings?.tabSize ?? 2),
    EditorView.contentAttributes.of({
      dir: settings?.rightToLeft ? "rtl" : "ltr",
    }),
    EditorView.theme({
      ".cm-scroller": {
        overflowX: settings?.wordWrap === false ? "auto" : "hidden",
      },
      ".cm-line": {
        borderLeft:
          settings?.indentationGuides === false
            ? "none"
            : "1px solid var(--indentation-guide-color, var(--border-subtle))",
      },
    }),
  ];
}

const toggleFormat = (marker: string): Command => {
  return (view: EditorView) => {
    const { state, dispatch } = view;
    if (state.readOnly) return false;

    const changes = state.changeByRange((range) => {
      const { from, to } = range;
      if (from === to) {
        return {
          changes: { from, to, insert: `${marker}${marker}` },
          range: EditorSelection.range(from + marker.length, from + marker.length),
        };
      }

      const selectedText = state.doc.sliceString(from, to);
      const prefix = state.doc.sliceString(Math.max(0, from - marker.length), from);
      const suffix = state.doc.sliceString(to, Math.min(state.doc.length, to + marker.length));

      if (prefix === marker && suffix === marker) {
        return {
          changes: [
            { from: from - marker.length, to: from, insert: "" },
            { from: to, to: to + marker.length, insert: "" },
          ],
          range: EditorSelection.range(from - marker.length, to - marker.length),
        };
      } else if (selectedText.startsWith(marker) && selectedText.endsWith(marker)) {
        return {
          changes: { from, to, insert: selectedText.slice(marker.length, -marker.length) },
          range: EditorSelection.range(from, to - marker.length * 2),
        };
      } else {
        return {
          changes: { from, to, insert: `${marker}${selectedText}${marker}` },
          range: EditorSelection.range(from + marker.length, to + marker.length),
        };
      }
    });

    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
};

const toggleBold = toggleFormat("**");
const toggleItalic = toggleFormat("*");
const toggleCode = toggleFormat("`");
const toggleStrikethrough = toggleFormat("~~");

const handleBackspace = (view: EditorView): boolean => {
  const { state, dispatch } = view;
  if (state.readOnly) return false;

  let changes: { from: number; to: number; insert: string }[] = [];
  let selectionUpdated = false;

  const newRanges = state.selection.ranges.map((range) => {
    if (!range.empty) {
      return range;
    }
    const pos = range.head;
    const line = state.doc.lineAt(pos);

    const regex = new RegExp(MARKDOWN_IMAGE_GLOBAL_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;

      if (pos === to) {
        changes.push({ from, to, insert: "" });
        selectionUpdated = true;
        return EditorSelection.cursor(from);
      }
    }
    return range;
  });

  if (selectionUpdated) {
    dispatch(state.update({
      changes,
      selection: EditorSelection.create(newRanges),
      userEvent: "delete.backward"
    }));
    return true;
  }

  return false;
};

const handleDelete = (view: EditorView): boolean => {
  const { state, dispatch } = view;
  if (state.readOnly) return false;

  let changes: { from: number; to: number; insert: string }[] = [];
  let selectionUpdated = false;

  const newRanges = state.selection.ranges.map((range) => {
    if (!range.empty) {
      return range;
    }
    const pos = range.head;
    const line = state.doc.lineAt(pos);

    const regex = new RegExp(MARKDOWN_IMAGE_GLOBAL_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;

      if (pos === from) {
        changes.push({ from, to, insert: "" });
        selectionUpdated = true;
        return EditorSelection.cursor(from);
      }
    }
    return range;
  });

  if (selectionUpdated) {
    dispatch(state.update({
      changes,
      selection: EditorSelection.create(newRanges),
      userEvent: "delete.forward"
    }));
    return true;
  }

  return false;
};

function getEditorKeymapExtensions(settings?: AppSettings) {
  return keymap.of([
    { key: "Mod-b", run: toggleBold },
    { key: "Mod-i", run: toggleItalic },
    { key: "Mod-e", run: toggleCode },
    { key: "Mod-`", run: toggleCode },
    { key: "Mod-Shift-x", run: toggleStrikethrough },
    { key: "Backspace", run: handleBackspace },
    { key: "Delete", run: handleDelete },
    ...defaultKeymap,
    ...historyKeymap,
    ...(settings?.indentUsingTabs === false ? [] : [indentWithTab]),
  ]);
}

function getEditorBehaviorExtensions(settings?: AppSettings) {
  return [
    settings?.autoPairBrackets === false && settings?.autoPairMarkdown === false
      ? []
      : closeBrackets(),
    settings?.foldHeading === false ? [] : [headingFold(), foldTheme],
    settings?.defaultEditingMode === "source" ? [] : markdownLivePreviewPlugin(),
  ];
}

/**
 * CodeMirror plugin to highlight [[wiki-links]] in the editor.
 * Creates decorations for text matching the [[...]] pattern.
 */
function wikiLinkPlugin(onLinkClick: (name: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const decorations: any[] = [];
        const doc = view.state.doc;

        for (const { from, to } of view.visibleRanges) {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;

          for (let i = startLine; i <= endLine; i++) {
            const line = doc.line(i);
            const regex = /\[\[([^\]]+)\]\]/g;
            let match;

            while ((match = regex.exec(line.text)) !== null) {
              const fromPos = line.from + match.index;
              const toPos = fromPos + match[0].length;

              if (fromPos < toPos) {
                decorations.push(
                  Decoration.mark({
                    class: "cm-wikilink",
                    attributes: {
                      "data-link": match[1],
                      title: `Open: ${match[1]}`,
                    },
                  }).range(fromPos, toPos),
                );
              }
            }
          }
        }

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click: (e: MouseEvent, view: EditorView) => {
          const target = e.target as HTMLElement;
          if (
            target.classList.contains("cm-wikilink") ||
            target.closest(".cm-wikilink")
          ) {
            const linkEl = target.classList.contains("cm-wikilink")
              ? target
              : (target.closest(".cm-wikilink") as HTMLElement);
            const linkName = linkEl?.getAttribute("data-link");
            if (linkName && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onLinkClick(linkName);
            }
          }
        },
      },
    },
  );
}

/**
 * CodeMirror plugin to highlight #tags in the editor.
 */
function tagPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const decorations: any[] = [];
        const doc = view.state.doc;

        for (const { from, to } of view.visibleRanges) {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;

          for (let i = startLine; i <= endLine; i++) {
            const line = doc.line(i);
            const regex = /(?:^|\s)(#[a-zA-Z][a-zA-Z0-9_-]*)/g;
            let match;

            while ((match = regex.exec(line.text)) !== null) {
              const tag = match[1];
              // Skip hex color codes (e.g. #ef4444) from tag decorators
              const hexColorRegex = /^#[a-fA-F0-9]{3,4}$|^#[a-fA-F0-9]{6}$|^#[a-fA-F0-9]{8}$/;
              if (hexColorRegex.test(tag)) {
                continue;
              }

              const tagStart =
                line.from + match.index + (match[0].startsWith(" ") ? 1 : 0);
              const tagEnd = tagStart + match[1].length;

              if (tagStart < tagEnd) {
                decorations.push(
                  Decoration.mark({ class: "cm-tag-mark" }).range(tagStart, tagEnd),
                );
              }
            }
          }
        }

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

type ImageCropMode = "contain" | "cover";

interface MarkdownImageMatch {
  from: number;
  to: number;
  alt: string;
  src: string;
  width?: number;
  crop: ImageCropMode;
  offsetX: number;
  offsetY: number;
}

const MARKDOWN_IMAGE_GLOBAL_REGEX =
  /!\[([^\]]*)\]\((<[^>]+>|[^)\s"]+)(?:\s+"([^"]*)")?\)|!\[\[([^\n\]|]+)(?:\|([^\n\]]+))?\]\]/g;
const MARKDOWN_IMAGE_SINGLE_REGEX =
  /^!\[([^\]]*)\]\((<[^>]+>|[^)\s"]+)(?:\s+"([^"]*)")?\)$/;

function parseImageMeta(title?: string): {
  width?: number;
  crop: ImageCropMode;
  offsetX: number;
  offsetY: number;
} {
  const raw = title || "";
  const widthMatch = raw.match(/(?:^|[\s,])w(?:idth)?=(\d{2,4})/i);
  const cropMatch = raw.match(/(?:^|[\s,])crop=(cover|contain)/i);
  const offsetXMatch = raw.match(/(?:^|[\s,])ox=(-?\d{1,4})/i);
  const offsetYMatch = raw.match(/(?:^|[\s,])oy=(-?\d{1,4})/i);

  const parsedWidth = widthMatch ? Number(widthMatch[1]) : undefined;
  const width = Number.isFinite(parsedWidth)
    ? Math.max(120, Math.min(1400, parsedWidth!))
    : undefined;
  const crop: ImageCropMode = (cropMatch?.[1] as ImageCropMode) || "contain";
  const offsetX = offsetXMatch
    ? Math.max(-1200, Math.min(1200, Number(offsetXMatch[1])))
    : 0;
  const offsetY = offsetYMatch
    ? Math.max(-1200, Math.min(1200, Number(offsetYMatch[1])))
    : 0;
  return { width, crop, offsetX, offsetY };
}

function parseMarkdownImage(
  markdown: string,
  from: number,
  to: number,
): MarkdownImageMatch | null {
  // Standard markdown image: ![alt](src "title")
  const stdMatch = markdown.match(MARKDOWN_IMAGE_SINGLE_REGEX);
  if (stdMatch) {
    let [, alt, src, title] = stdMatch;
    if (src.startsWith("<") && src.endsWith(">")) {
      src = src.slice(1, -1).trim();
    }
    const { width, crop, offsetX, offsetY } = parseImageMeta(title);
    return { from, to, alt: alt || "", src, width, crop, offsetX, offsetY };
  }

  // Wiki embed image: ![[filename.png]] or ![[filename.png|400]]
  const wikiMatch = markdown.match(/^!\[\[([^\n\]|]+)(?:\|([^\n\]]+))?\]\]$/);
  if (wikiMatch) {
    const [, rawSrc, rawOpt] = wikiMatch;
    let src = rawSrc.trim();
    let alt = "";
    let width: number | undefined = undefined;

    if (rawOpt) {
      const parts = rawOpt.split("|");
      for (const part of parts) {
        const trimmed = part.trim();
        if (/^\d{2,4}$/.test(trimmed)) {
          width = Number(trimmed);
        } else {
          alt = trimmed;
        }
      }
    }

    return {
      from,
      to,
      alt,
      src,
      width: width ? Math.max(120, Math.min(1400, width)) : undefined,
      crop: "contain",
      offsetX: 0,
      offsetY: 0,
    };
  }

  return null;
}

function buildMarkdownImage(
  alt: string,
  src: string,
  width?: number,
  crop: ImageCropMode = "contain",
  offsetX = 0,
  offsetY = 0,
): string {
  const attrs: string[] = [];
  if (width) attrs.push(`w=${Math.round(width)}`);
  if (crop === "cover") {
    attrs.push("crop=cover");
    if (offsetX !== 0) attrs.push(`ox=${Math.round(offsetX)}`);
    if (offsetY !== 0) attrs.push(`oy=${Math.round(offsetY)}`);
  }
  const title = attrs.join(" ");
  return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
}

function applyWidgetImageStyles(
  img: HTMLImageElement,
  image: MarkdownImageMatch,
): void {
  const width = image.width ?? 420;
  img.style.width = `${width}px`;
  img.style.maxWidth = "100%";
  if (image.crop === "cover") {
    img.style.objectFit = "cover";
    img.style.aspectRatio = "4 / 3";
    img.style.objectPosition = `calc(50% + ${Math.round(image.offsetX)}px) calc(50% + ${Math.round(image.offsetY)}px)`;
  } else {
    img.style.objectFit = "contain";
    img.style.aspectRatio = "auto";
    img.style.objectPosition = "center center";
  }
}

class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly image: MarkdownImageMatch,
    private readonly view?: EditorView,
  ) {
    super();
  }

  get estimatedHeight(): number {
    return 240;
  }

  eq(other: MarkdownImageWidget): boolean {
    return (
      this.image.alt === other.image.alt &&
      this.image.src === other.image.src &&
      this.image.width === other.image.width &&
      this.image.crop === other.image.crop &&
      this.image.offsetX === other.image.offsetX &&
      this.image.offsetY === other.image.offsetY &&
      this.image.from === other.image.from &&
      this.image.to === other.image.to
    );
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-image-widget";
    root.setAttribute("contenteditable", "false");
    root.dataset.from = String(this.image.from);
    root.dataset.to = String(this.image.to);
    root.dataset.width = String(this.image.width ?? 420);
    root.dataset.crop = this.image.crop;
    root.dataset.ox = String(this.image.offsetX);
    root.dataset.oy = String(this.image.offsetY);
    root.dataset.alt = this.image.alt;
    root.dataset.src = this.image.src;

    const stage = document.createElement("div");
    stage.className = "cm-image-widget-stage";
    root.appendChild(stage);

    const img = document.createElement("img");
    img.className = "cm-image-widget-image";
    img.src = resolveVaultImageSrc(this.image.src);
    img.alt = this.image.alt || "Image";
    img.addEventListener("load", () => {
      if (this.view) {
        try { this.view.requestMeasure(); } catch { }
      }
    });
    applyWidgetImageStyles(img, this.image);
    stage.appendChild(img);

    const metaRow = document.createElement("div");
    metaRow.className = "cm-image-widget-meta";
    metaRow.style.width = `${this.image.width ?? 420}px`;
    metaRow.style.maxWidth = "100%";

    const widthLabel = document.createElement("span");
    widthLabel.className = "cm-image-widget-width";
    widthLabel.textContent = `${this.image.width ?? 420}px`;
    metaRow.appendChild(widthLabel);

    const deleteButton = document.createElement("button");
    deleteButton.className = "cm-image-widget-delete";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete-image";
    deleteButton.title = "Delete image";
    deleteButton.textContent = "Delete";
    metaRow.appendChild(deleteButton);

    root.appendChild(metaRow);

    return root;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function imageWidgetPlugin(onOpenLightbox: (src: string, alt: string) => void) {
  let activeDragCleanup: (() => void) | null = null;

  const getWidgetRange = (view: EditorView, widgetEl: HTMLElement): { from: number; to: number } | null => {
    const pos = view.posAtDOM(widgetEl);
    if (pos < 0) return null;

    const line = view.state.doc.lineAt(pos);
    const regex = new RegExp(MARKDOWN_IMAGE_GLOBAL_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      if (pos >= from && pos <= to) {
        return { from, to };
      }
    }
    return null;
  };

  const getMaxRenderableWidth = (view: EditorView) => {
    const content = view.dom.querySelector(".cm-content") as HTMLElement | null;
    const scroller = view.dom.querySelector(
      ".cm-scroller",
    ) as HTMLElement | null;
    const raw =
      (content?.getBoundingClientRect().width ||
        scroller?.getBoundingClientRect().width ||
        view.dom.getBoundingClientRect().width) - 24;
    const safe = Number.isFinite(raw) ? Math.floor(raw) : 1400;
    return Math.max(120, Math.min(1400, safe));
  };

  const clampWidth = (candidate: number, maxWidth: number) =>
    Math.max(120, Math.min(maxWidth, Math.round(candidate)));

  const cleanupDrag = () => {
    if (activeDragCleanup) {
      activeDragCleanup();
      activeDragCleanup = null;
    }
    document.body.style.cursor = "default";
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      destroy() {
        cleanupDrag();
      }

      buildDecorations(view: EditorView): DecorationSet {
        const decorations: any[] = [];
        const doc = view.state.doc;

        for (const { from, to } of view.visibleRanges) {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;

          for (let i = startLine; i <= endLine; i++) {
            const line = doc.line(i);
            const regex = new RegExp(MARKDOWN_IMAGE_GLOBAL_REGEX.source, "g");
            let match: RegExpExecArray | null;

            while ((match = regex.exec(line.text)) !== null) {
              const fromPos = line.from + match.index;
              const toPos = fromPos + match[0].length;
              const parsed = parseMarkdownImage(match[0], fromPos, toPos);
              if (!parsed) continue;

              decorations.push(
                Decoration.replace({
                  widget: new MarkdownImageWidget(parsed, view),
                }).range(fromPos, toPos),
              );
            }
          }
        }

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown: (e: MouseEvent, view: EditorView) => {
          const target = e.target as HTMLElement;
          const widget = target.closest(
            ".cm-image-widget",
          ) as HTMLElement | null;
          if (!widget) return;

          e.preventDefault();
          e.stopPropagation();
          view.dom.blur();

          const range = getWidgetRange(view, widget);
          if (!range) return;
          const { from, to } = range;

          const current = view.state.doc.sliceString(from, to);
          const parsed = parseMarkdownImage(current, from, to);
          if (!parsed) return;

          const button = target.closest(
            "[data-action]",
          ) as HTMLButtonElement | null;
          if (button) {
            const action = button.dataset.action;
            if (action === "delete-image") {
              const currentRange = getWidgetRange(view, widget);
              if (!currentRange) return;
              view.dispatch({
                changes: { from: currentRange.from, to: currentRange.to, insert: "" },
                selection: { anchor: currentRange.from },
              });
              return;
            }
            return;
          }

          const imageEl = widget.querySelector(
            ".cm-image-widget-image",
          ) as HTMLImageElement | null;
          if (!imageEl) return;

          cleanupDrag();

          const stage = target.closest(
            ".cm-image-widget-stage",
          ) as HTMLElement | null;
          if (!stage) return;

          const rect = imageEl.getBoundingClientRect();
          const edgeThreshold = 10;
          const nearLeft = Math.abs(e.clientX - rect.left) <= edgeThreshold;
          const nearRight = Math.abs(rect.right - e.clientX) <= edgeThreshold;
          const isResizeFromEdge = nearLeft || nearRight;
          const isImageSurface = !!target.closest(".cm-image-widget-stage");

          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth =
            (parsed.width ??
              Math.round(imageEl.getBoundingClientRect().width)) ||
            420;
          const startOx = parsed.offsetX;
          const startOy = parsed.offsetY;
          const maxWidth = getMaxRenderableWidth(view);
          const resizeDirection = nearLeft ? -1 : 1;
          let moved = false;

          const onMove = (event: MouseEvent) => {
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
              moved = true;
            }
            if (!moved) return;

            if (isResizeFromEdge) {
              const nextWidth = clampWidth(
                startWidth + resizeDirection * dx,
                maxWidth,
              );
              imageEl.style.width = `${nextWidth}px`;
              const widthBadge = widget.querySelector(
                ".cm-image-widget-width",
              ) as HTMLElement | null;
              if (widthBadge) widthBadge.textContent = `${nextWidth}px`;
              const metaRow = widget.querySelector(
                ".cm-image-widget-meta",
              ) as HTMLElement | null;
              if (metaRow) metaRow.style.width = `${nextWidth}px`;
              return;
            }

            const nextOx = Math.max(
              -1200,
              Math.min(1200, Math.round(startOx + dx)),
            );
            const nextOy = Math.max(
              -1200,
              Math.min(1200, Math.round(startOy + dy)),
            );
            imageEl.style.objectFit = "cover";
            imageEl.style.aspectRatio = "4 / 3";
            imageEl.style.objectPosition = `calc(50% + ${nextOx}px) calc(50% + ${nextOy}px)`;
          };

          const onUp = (event: MouseEvent) => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "default";
            activeDragCleanup = null;

            if (!moved) {
              if (isImageSurface) {
                onOpenLightbox(parsed.src, parsed.alt || "Image");
              }
              return;
            }

            const currentRange = getWidgetRange(view, widget);
            if (!currentRange) return;

            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const nextWidth = isResizeFromEdge
              ? clampWidth(startWidth + resizeDirection * dx, maxWidth)
              : startWidth;
            const nextCrop = isResizeFromEdge ? parsed.crop : "cover";
            const nextOx = isResizeFromEdge
              ? parsed.offsetX
              : Math.max(-1200, Math.min(1200, Math.round(startOx + dx)));
            const nextOy = isResizeFromEdge
              ? parsed.offsetY
              : Math.max(-1200, Math.min(1200, Math.round(startOy + dy)));

            const replacement = buildMarkdownImage(
              parsed.alt,
              parsed.src,
              nextWidth,
              nextCrop,
              nextOx,
              nextOy,
            );
            view.dispatch({
              changes: { from: currentRange.from, to: currentRange.to, insert: replacement },
              selection: { anchor: currentRange.from + replacement.length },
            });
          };

          activeDragCleanup = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          document.body.style.cursor = isResizeFromEdge ? "ew-resize" : "grab";
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        },

        mousemove: (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const widget = target.closest(
            ".cm-image-widget",
          ) as HTMLElement | null;
          if (!widget) return;
          const imageEl = widget.querySelector(
            ".cm-image-widget-image",
          ) as HTMLImageElement | null;
          if (!imageEl) return;
          const rect = imageEl.getBoundingClientRect();
          const edgeThreshold = 10;
          const nearLeft = Math.abs(e.clientX - rect.left) <= edgeThreshold;
          const nearRight = Math.abs(rect.right - e.clientX) <= edgeThreshold;
          imageEl.style.cursor = nearLeft || nearRight ? "ew-resize" : "grab";
        },

        mouseleave: (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          const imageEl = target
            .closest(".cm-image-widget")
            ?.querySelector(
              ".cm-image-widget-image",
            ) as HTMLImageElement | null;
          if (imageEl) imageEl.style.cursor = "grab";
        },

        click: (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest(".cm-image-widget")) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
      },
    },
  );
}

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: [
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
      t.heading,
    ],
    color: "var(--editor-heading)",
    fontWeight: "700",
  },
  {
    tag: [t.processingInstruction, t.contentSeparator],
    color: "var(--editor-heading-marker)",
    fontWeight: "600",
  },
  { tag: [t.comment, t.quote, t.meta], color: "var(--editor-muted-token)" },
  {
    tag: [t.keyword, t.operator, t.punctuation],
    color: "var(--editor-heading-marker)",
  },
  {
    tag: [t.atom, t.bool, t.number, t.string, t.regexp],
    color: "var(--editor-code)",
  },
  {
    tag: [t.link, t.url],
    color: "var(--editor-link)",
    textDecoration: "underline",
  },
  { tag: [t.strong], color: "var(--editor-emphasis)", fontWeight: "700" },
  { tag: [t.emphasis], color: "var(--editor-emphasis)", fontStyle: "italic" },
  {
    tag: [t.strikethrough],
    color: "var(--editor-muted-token)",
    textDecoration: "line-through",
  },
  {
    tag: [t.monospace],
    color: "var(--editor-code)",
    fontFamily: "var(--font-mono)",
  },
  { tag: [t.name, t.propertyName, t.labelName], color: "var(--text-primary)" },
  {
    tag: [t.invalid],
    color: "var(--danger)",
    textDecoration: "wavy underline",
  },
]);

class EmptyInlineWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-hidden-mark";
    return span;
  }
}

class InlineTextWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly className: string,
  ) {
    super();
  }

  eq(other: InlineTextWidget): boolean {
    return this.text === other.text && this.className === other.className;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked;
  }

  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.tabIndex = -1;
    input.className = "cm-live-task-checkbox";
    input.setAttribute("aria-hidden", "true");
    return input;
  }
}

class MarkdownCalloutWidget extends WidgetType {
  constructor(
    private readonly calloutType: string,
    private readonly title: string,
    private readonly body: string,
    private readonly startLine: number,
    private readonly endLine: number,
    private readonly isFoldable: boolean = false,
    private readonly isCollapsed: boolean = false,
  ) {
    super();
  }

  eq(other: MarkdownCalloutWidget): boolean {
    return (
      this.calloutType === other.calloutType &&
      this.title === other.title &&
      this.body === other.body &&
      this.startLine === other.startLine &&
      this.endLine === other.endLine &&
      this.isFoldable === other.isFoldable &&
      this.isCollapsed === other.isCollapsed
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const isCaution = this.calloutType === "caution" || this.calloutType === "warning";
    const div = document.createElement("div");
    div.className = `docs-note ${isCaution ? "is-caution" : ""} callout callout-${this.calloutType}`;
    div.setAttribute("data-callout", this.calloutType);
    if (this.isFoldable) {
      div.setAttribute("data-foldable", "true");
      div.setAttribute("data-collapsed", this.isCollapsed ? "true" : "false");
    }

    const strong = document.createElement("strong");
    strong.className = "callout-title";

    const titleSpan = document.createElement("span");
    titleSpan.className = "callout-title-text";
    titleSpan.textContent = this.title;
    strong.appendChild(titleSpan);

    if (this.isFoldable) {
      const foldSpan = document.createElement("span");
      foldSpan.className = "callout-fold";
      foldSpan.setAttribute("aria-hidden", "true");
      foldSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      strong.appendChild(foldSpan);

      foldSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const collapsed = div.getAttribute("data-collapsed") === "true";
        div.setAttribute("data-collapsed", collapsed ? "false" : "true");
      });
    }

    div.appendChild(strong);

    if (this.body.trim()) {
      const contentDiv = document.createElement("div");
      contentDiv.className = "callout-content";
      try {
        contentDiv.innerHTML = marked.parse(this.body, { async: false, breaks: true }) as string;
      } catch {
        contentDiv.textContent = this.body;
      }
      div.appendChild(contentDiv);
    }

    div.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      if ((e.target as HTMLElement).closest(".callout-fold")) return;
      e.preventDefault();

      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      const lineStart = view.state.doc.line(this.startLine);
      const lineEnd = view.state.doc.line(this.endLine);

      let targetPos = pos;
      if (targetPos === null || targetPos < lineStart.from || targetPos > lineEnd.to) {
        const isTitle = (e.target as HTMLElement).closest(".callout-title");
        const targetLineNum = isTitle ? this.startLine : Math.min(this.startLine + 1, this.endLine);
        const targetLine = view.state.doc.line(targetLineNum);
        targetPos = targetLine.from + targetLine.text.length;
      }

      view.dispatch({
        selection: { anchor: targetPos },
      });
      view.focus();
    });

    div.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest("a");
      if (link) {
        const href = link.getAttribute("href");
        if (href) {
          e.preventDefault();
          window.open(href, "_blank");
        }
      }
    });

    return div;
  }

  ignoreEvent(e: Event): boolean {
    if (e.target && (e.target as HTMLElement).closest("a")) return true;
    return false;
  }
}

class MarkdownTableWidget extends WidgetType {
  constructor(private readonly rows: string[], private readonly startLine: number) {
    super();
  }

  eq(other: MarkdownTableWidget): boolean {
    return this.rows.join("\n") === other.rows.join("\n") && this.startLine === other.startLine;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-live-table-wrapper";
    wrapper.title = "Edit table";
    
    wrapper.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".cm-live-table-controls")) {
        e.stopPropagation();
        return;
      }
      const target = e.target as HTMLElement;
      const tr = target.closest("tr");
      let lineOffset = 0;
      if (tr && tr.parentElement) {
        const rows = Array.from(table.querySelectorAll("tr"));
        const rowIndex = rows.indexOf(tr);
        if (rowIndex >= 0) {
          lineOffset = rowIndex;
        }
      }
      const targetLineNum = Math.min(this.startLine + lineOffset, this.startLine + this.rows.length - 1);
      const targetLine = view.state.doc.line(targetLineNum);
      view.dispatch({
        selection: { anchor: targetLine.from + Math.min(targetLine.text.length, 2) },
      });
      view.focus();
    });

    const table = document.createElement("table");
    table.className = "cm-live-table";
    wrapper.appendChild(table);

    const saveTable = () => {
      const pos = view.posAtDOM(wrapper);
      if (pos < 0) return;
      const startLine = view.state.doc.lineAt(pos).number;
      const range = getTableRange(view.state.doc, startLine);
      if (!range) return;
      const from = view.state.doc.line(range.start).from;
      const to = view.state.doc.line(range.end).to;
      const newMarkdown = serializeTableDOMToMarkdown(table);
      const currentMarkdown = view.state.sliceDoc(from, to);
      if (currentMarkdown !== newMarkdown) {
        view.dispatch({
          changes: { from, to, insert: newMarkdown },
          userEvent: "input",
        });
      }
    };

    const parsedRows = this.rows.map(parseTableCells);
    const separatorIndex = parsedRows.findIndex((cells) =>
      cells.every((cell) => /^:?-+:?$/.test(cell.trim())),
    );
    const rawHeaderRows = separatorIndex > 0 ? parsedRows.slice(0, separatorIndex) : [];
    const columnCount = Math.max(1, rawHeaderRows[0]?.length || parsedRows[0]?.length || 1);
    const normalizeCells = (cells: string[], fill = "") => {
      const normalized = cells.slice(0, columnCount);
      while (normalized.length < columnCount) normalized.push(fill);
      return normalized;
    };
    const headerRows = rawHeaderRows.map((row) => normalizeCells(row));
    const bodyRows = (separatorIndex >= 0 ? parsedRows.slice(separatorIndex + 1) : parsedRows)
      .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell.trim())))
      .map((row) => normalizeCells(row));

    if (headerRows.length > 0) {
      const thead = document.createElement("thead");
      table.appendChild(thead);
      for (const row of headerRows) {
        const tr = document.createElement("tr");
        thead.appendChild(tr);
        for (const cell of row) {
          const th = document.createElement("th");
          renderTableCellMarkdown(th, cell);
          tr.appendChild(th);
          setupEditableCell(th, view, saveTable, wrapper);
        }
      }
    }

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    for (const row of bodyRows) {
      const tr = document.createElement("tr");
      tbody.appendChild(tr);
      for (const cell of row) {
        const td = document.createElement("td");
        renderTableCellMarkdown(td, cell);
        tr.appendChild(td);
        setupEditableCell(td, view, saveTable, wrapper);
      }
    }

    const controls = document.createElement("div");
    controls.className = "cm-live-table-controls";
    controls.setAttribute("contenteditable", "false");

    const addRowBtn = document.createElement("button");
    addRowBtn.type = "button";
    addRowBtn.className = "cm-live-table-control";
    addRowBtn.textContent = "+ Row";
    addRowBtn.title = "Add row below";
    addRowBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cols = table.rows[0]?.cells.length || 1;
      const tBody = table.querySelector("tbody") || table;
      const tr = document.createElement("tr");
      tBody.appendChild(tr);
      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        tr.appendChild(td);
        setupEditableCell(td, view, saveTable, wrapper);
      }
      (tr.cells[0] as HTMLElement).focus();
      saveTable();
    });
    controls.appendChild(addRowBtn);

    const deleteRowBtn = document.createElement("button");
    deleteRowBtn.type = "button";
    deleteRowBtn.className = "cm-live-table-control";
    deleteRowBtn.textContent = "- Row";
    deleteRowBtn.title = "Delete last row";
    deleteRowBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tBody = table.querySelector("tbody");
      if (tBody && tBody.rows.length > 1) {
        tBody.deleteRow(tBody.rows.length - 1);
        saveTable();
      }
    });
    controls.appendChild(deleteRowBtn);

    const addColBtn = document.createElement("button");
    addColBtn.type = "button";
    addColBtn.className = "cm-live-table-control";
    addColBtn.textContent = "+ Col";
    addColBtn.title = "Add column to the right";
    addColBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const theadTrs = table.querySelectorAll("thead tr");
      theadTrs.forEach((tr) => {
        const th = document.createElement("th");
        tr.appendChild(th);
        setupEditableCell(th, view, saveTable, wrapper);
      });
      
      const tbodyTrs = table.querySelectorAll("tbody tr");
      tbodyTrs.forEach((tr) => {
        const td = document.createElement("td");
        tr.appendChild(td);
        setupEditableCell(td, view, saveTable, wrapper);
      });
      
      const firstRow = table.rows[0];
      if (firstRow) {
        (firstRow.cells[firstRow.cells.length - 1] as HTMLElement).focus();
      }
      saveTable();
    });
    controls.appendChild(addColBtn);

    const deleteColBtn = document.createElement("button");
    deleteColBtn.type = "button";
    deleteColBtn.className = "cm-live-table-control";
    deleteColBtn.textContent = "- Col";
    deleteColBtn.title = "Delete last column";
    deleteColBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rows = table.rows;
      if (rows.length > 0 && rows[0].cells.length > 1) {
        for (let r = 0; r < rows.length; r++) {
          rows[r].deleteCell(rows[r].cells.length - 1);
        }
        saveTable();
      }
    });
    controls.appendChild(deleteColBtn);

    wrapper.appendChild(controls);

    return wrapper;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const activeEl = document.activeElement;
    if (activeEl && dom.contains(activeEl)) {
      return true;
    }
    return false;
  }
}

function escapeTableHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderTableCellMarkdown(cell: HTMLElement, source: string) {
  let html = escapeTableHtml(source);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[^\w*])\*([^*]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^\w_])_([^_]+)_/g, "$1<em>$2</em>");
  cell.innerHTML = html;
}

type TableAction = "add-row-below" | "add-column-right";

class MarkdownTableControlsWidget extends WidgetType {
  constructor(private readonly lineNumber: number) {
    super();
  }

  eq(other: MarkdownTableControlsWidget): boolean {
    return this.lineNumber === other.lineNumber;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-live-table-controls";
    root.setAttribute("contenteditable", "false");

    const addButton = (action: TableAction, label: string, title: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-live-table-control";
      button.dataset.tableAction = action;
      button.dataset.tableLine = String(this.lineNumber);
      button.title = title;
      button.textContent = label;
      root.appendChild(button);
    };

    addButton("add-row-below", "+ Row", "Add row below");
    addButton("add-column-right", "+ Column", "Add column to the right");

    return root;
  }
}

function parseTableCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function htmlToMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<code>(.*?)<\/code>/gi, "`$1`");
  text = text.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i>(.*?)<\/i>/gi, "*$1*");
  text = text.replace(/<del>(.*?)<\/del>/gi, "~~$1~~");
  text = text.replace(/<s>(.*?)<\/s>/gi, "~~$1~~");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return text.trim();
}

function serializeTableDOMToMarkdown(tableEl: HTMLTableElement): string {
  const rows: string[][] = [];
  const thead = tableEl.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("th").forEach((th) => {
        cells.push(htmlToMarkdown(th.innerHTML));
      });
      rows.push(cells);
    });
  }
  const columnCount = rows[0]?.length || tableEl.querySelector("tbody tr")?.querySelectorAll("td").length || 1;
  const separatorRow = Array.from({ length: columnCount }, () => "---");
  rows.push(separatorRow);
  const tbody = tableEl.querySelector("tbody");
  if (tbody) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("td").forEach((td) => {
        cells.push(htmlToMarkdown(td.innerHTML));
      });
      rows.push(cells);
    });
  }
  return rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

function setupEditableCell(
  cell: HTMLTableCellElement,
  view: EditorView,
  saveTable: () => void,
  wrapper: HTMLElement,
) {
  cell.contentEditable = "true";
  cell.style.outline = "none";
  const stopProp = (e: Event) => e.stopPropagation();

  cell.addEventListener("focus", () => {
    const tr = cell.parentElement;
    const table = tr?.closest("table");
    let lineOffset = 0;
    if (tr && table) {
      const rows = Array.from(table.querySelectorAll("tr"));
      const rowIndex = rows.indexOf(tr as HTMLTableRowElement);
      if (rowIndex >= 0) {
        lineOffset = rowIndex;
      }
    }
    const pos = view.posAtDOM(wrapper);
    if (pos >= 0) {
      const startLine = view.state.doc.lineAt(pos).number;
      const targetLine = view.state.doc.line(Math.min(startLine + lineOffset, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: targetLine.from + Math.min(targetLine.text.length, 2) },
      });
    }
  });

  cell.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const cells = Array.from(cell.closest("table")?.querySelectorAll("th, td") || []);
      const index = cells.indexOf(cell);
      if (index >= 0) {
        const nextCell = cells[index + (e.shiftKey ? -1 : 1)] as HTMLElement;
        if (nextCell) {
          nextCell.focus();
          const range = document.createRange();
          range.selectNodeContents(nextCell);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const tr = cell.parentElement;
      const table = tr?.closest("table");
      if (tr && table) {
        const colIndex = Array.from(tr.children).indexOf(cell);
        const trs = Array.from(table.querySelectorAll("tr")) as Element[];
        const rowIndex = trs.indexOf(tr as Element);
        const nextTr = trs[rowIndex + 1];
        if (nextTr) {
          const nextCell = nextTr.children[colIndex] as HTMLElement;
          if (nextCell) nextCell.focus();
        } else {
          const columnCount = table.rows[0]?.cells.length || 1;
          const tbody = table.querySelector("tbody") || table;
          const newTr = document.createElement("tr");
          tbody.appendChild(newTr);
          for (let c = 0; c < columnCount; c++) {
            const td = document.createElement("td");
            newTr.appendChild(td);
            setupEditableCell(td, view, saveTable, wrapper);
          }
          (newTr.cells[colIndex] as HTMLElement || newTr.cells[0]).focus();
          saveTable();
        }
      }
    } else if (e.key === "ArrowUp") {
      const tr = cell.parentElement;
      const table = tr?.closest("table");
      if (tr && table) {
        const trs = Array.from(table.querySelectorAll("tr")) as Element[];
        const rowIndex = trs.indexOf(tr as Element);
        if (rowIndex > 0) {
          e.preventDefault();
          e.stopPropagation();
          const colIndex = Array.from(tr.children).indexOf(cell);
          const prevTr = trs[rowIndex - 1];
          const prevCell = prevTr.children[colIndex] as HTMLElement;
          if (prevCell) prevCell.focus();
        } else {
          const pos = view.posAtDOM(wrapper);
          if (pos >= 0) {
            e.preventDefault();
            e.stopPropagation();
            view.dispatch({ selection: { anchor: pos } });
            view.focus();
          }
        }
      }
    } else if (e.key === "ArrowDown") {
      const tr = cell.parentElement;
      const table = tr?.closest("table");
      if (tr && table) {
        const trs = Array.from(table.querySelectorAll("tr")) as Element[];
        const rowIndex = trs.indexOf(tr as Element);
        if (rowIndex < trs.length - 1) {
          e.preventDefault();
          e.stopPropagation();
          const colIndex = Array.from(tr.children).indexOf(cell);
          const nextTr = trs[rowIndex + 1];
          const nextCell = nextTr.children[colIndex] as HTMLElement;
          if (nextCell) nextCell.focus();
        } else {
          const pos = view.posAtDOM(wrapper);
          if (pos >= 0) {
            const startLine = view.state.doc.lineAt(pos).number;
            const range = getTableRange(view.state.doc, startLine);
            if (range) {
              e.preventDefault();
              e.stopPropagation();
              const endLinePos = view.state.doc.line(range.end).to;
              const targetPos = Math.min(view.state.doc.length, endLinePos + 1);
              view.dispatch({ selection: { anchor: targetPos } });
              view.focus();
            }
          }
        }
      }
    } else {
      e.stopPropagation();
    }
  });

  cell.addEventListener("keyup", stopProp);
  cell.addEventListener("keypress", stopProp);
  cell.addEventListener("mousedown", stopProp);
  cell.addEventListener("mouseup", stopProp);
  cell.addEventListener("click", stopProp);

  cell.addEventListener("input", () => {
    saveTable();
  });
}

function isTableRow(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return false;
  if (trimmed.startsWith("|") && trimmed.endsWith("|")) return true;
  return /^[^|]+\|[^|]+/.test(trimmed);
}

function isTableSeparator(text: string): boolean {
  if (!isTableRow(text)) return false;
  return parseTableCells(text).every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function getTableRange(doc: EditorState["doc"], lineNumber: number): { start: number; end: number } | null {
  if (lineNumber < 1 || lineNumber > doc.lines || !isTableRow(doc.line(lineNumber).text)) return null;

  let start = lineNumber;
  while (start > 1 && isTableRow(doc.line(start - 1).text)) start--;

  let end = lineNumber;
  while (end < doc.lines && isTableRow(doc.line(end + 1).text)) end++;

  if (end - start < 1) return null;
  const hasSeparator = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    .some((line) => isTableSeparator(doc.line(line).text));
  return hasSeparator ? { start, end } : null;
}

function normalizeTableRows(rows: string[]): string[] {
  const maxColumns = Math.max(1, ...rows.map((row) => parseTableCells(row).length));
  return rows.map((row) => {
    const cells = parseTableCells(row);
    while (cells.length < maxColumns) {
      cells.push(isTableSeparator(row) ? "---" : "");
    }
    return formatTableRow(cells);
  });
}

function applyTableAction(view: EditorView, action: TableAction, lineNumber: number) {
  const tableRange = getTableRange(view.state.doc, lineNumber);
  if (!tableRange) return;

  const rows = Array.from({ length: tableRange.end - tableRange.start + 1 }, (_, index) =>
    view.state.doc.line(tableRange.start + index).text,
  );
  const normalizedRows = normalizeTableRows(rows);
  const activeRowIndex = Math.max(0, Math.min(lineNumber - tableRange.start, normalizedRows.length - 1));
  const columnCount = Math.max(1, ...normalizedRows.map((row) => parseTableCells(row).length));

  let nextRows = normalizedRows;
  if (action === "add-row-below") {
    const insertIndex = activeRowIndex + 1;
    const nextRow = formatTableRow(Array.from({ length: columnCount }, () => ""));
    nextRows = [
      ...normalizedRows.slice(0, insertIndex),
      nextRow,
      ...normalizedRows.slice(insertIndex),
    ];
  } else if (action === "add-column-right") {
    nextRows = normalizedRows.map((row) => {
      const cells = parseTableCells(row);
      const insertAt = Math.max(1, cells.length);
      cells.splice(insertAt, 0, isTableSeparator(row) ? "---" : "");
      return formatTableRow(cells);
    });
  }

  const startLine = view.state.doc.line(tableRange.start);
  const endLine = view.state.doc.line(tableRange.end);
  const nextText = nextRows.join("\n");
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: nextText },
    selection: { anchor: startLine.from },
    userEvent: "input",
  });
  view.focus();
}

function hideMarkdownSyntax(decorations: any[], from: number, to: number) {
  if (to <= from) return;
  decorations.push(
    Decoration.replace({
      widget: new EmptyInlineWidget(),
      inclusive: false,
    }).range(from, to),
  );
}

function replaceMarkdownSyntax(
  decorations: any[],
  from: number,
  to: number,
  widget: WidgetType,
) {
  if (to <= from) return;
  decorations.push(
    Decoration.replace({
      widget,
      inclusive: false,
    }).range(from, to),
  );
}

function addInlineRange(
  decorations: any[],
  lineFrom: number,
  match: RegExpExecArray,
  groups: { open: number; content: number; close: number },
  className: string,
) {
  const open = match[groups.open];
  const content = match[groups.content];
  const close = match[groups.close];
  if (!open || !content || !close) return;

  const openFrom = lineFrom + match.index;
  const contentFrom = openFrom + open.length;
  const contentTo = contentFrom + content.length;
  const closeTo = contentTo + close.length;

  if (contentFrom >= contentTo) return;

  hideMarkdownSyntax(decorations, openFrom, contentFrom);
  decorations.push(Decoration.mark({ class: className }).range(contentFrom, contentTo));
  hideMarkdownSyntax(decorations, contentTo, closeTo);
}

function addInactiveInlinePreviewDecorations(
  decorations: any[],
  lineFrom: number,
  lineText: string,
) {
  const inlineCodeRegex = /(`)([^`\n]+)(`)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCodeRegex.exec(lineText)) !== null) {
    addInlineRange(decorations, lineFrom, match, { open: 1, content: 2, close: 3 }, "cm-live-code");
  }

  const strongRegex = /(\*\*|__)(?=\S)(.+?\S)(\1)/g;
  while ((match = strongRegex.exec(lineText)) !== null) {
    addInlineRange(decorations, lineFrom, match, { open: 1, content: 2, close: 3 }, "cm-live-strong");
  }

  const strikeRegex = /(~~)(?=\S)(.+?\S)(~~)/g;
  while ((match = strikeRegex.exec(lineText)) !== null) {
    addInlineRange(decorations, lineFrom, match, { open: 1, content: 2, close: 3 }, "cm-live-strike");
  }

  const highlightRegex = /(^|\s)(==)([^\s=](?:[^\n=]*?[^\s=])?)(==)(?=\s|[.,;:!?\x27\x22]|$)/g;
  while ((match = highlightRegex.exec(lineText)) !== null) {
    const prefix = match[1] || "";
    const marker = match[2];
    const content = match[3];
    const openFrom = lineFrom + match.index + prefix.length;
    const contentFrom = openFrom + marker.length;
    const contentTo = contentFrom + content.length;
    const closeTo = contentTo + marker.length;
    if (contentFrom < contentTo) {
      hideMarkdownSyntax(decorations, openFrom, contentFrom);
      decorations.push(Decoration.mark({ class: "cm-live-highlight" }).range(contentFrom, contentTo));
      hideMarkdownSyntax(decorations, contentTo, closeTo);
    }
  }

  const emphasisRegex = /(^|[^\w*])(\*|_)(?=\S)([^*_]+?\S)(\2)(?!\w)/g;
  while ((match = emphasisRegex.exec(lineText)) !== null) {
    const prefix = match[1] || "";
    const marker = match[2];
    const content = match[3];
    const openFrom = lineFrom + match.index + prefix.length;
    const contentFrom = openFrom + marker.length;
    const contentTo = contentFrom + content.length;
    const closeTo = contentTo + marker.length;
    if (contentFrom < contentTo) {
      hideMarkdownSyntax(decorations, openFrom, contentFrom);
      decorations.push(Decoration.mark({ class: "cm-live-emphasis" }).range(contentFrom, contentTo));
      hideMarkdownSyntax(decorations, contentTo, closeTo);
    }
  }

  const markdownLinkRegex = /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  while ((match = markdownLinkRegex.exec(lineText)) !== null) {
    if (match[1] === "!") continue;
    const fullFrom = lineFrom + match.index;
    const labelFrom = fullFrom + 1;
    const labelTo = labelFrom + match[2].length;
    const fullTo = fullFrom + match[0].length;
    if (labelFrom < labelTo) {
      hideMarkdownSyntax(decorations, fullFrom, labelFrom);
      decorations.push(
        Decoration.mark({
          class: "cm-live-link",
          attributes: { title: match[3] },
        }).range(labelFrom, labelTo),
      );
      hideMarkdownSyntax(decorations, labelTo, fullTo);
    }
  }

  const wikiLinkRegex = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const fullFrom = lineFrom + match.index;
    const target = match[1];
    const alias = match[2];
    if (alias) {
      const aliasFrom = fullFrom + 2 + target.length + 1;
      const aliasTo = aliasFrom + alias.length;
      if (aliasFrom < aliasTo) {
        hideMarkdownSyntax(decorations, fullFrom, aliasFrom);
        decorations.push(
          Decoration.mark({
            class: "cm-live-wikilink",
            attributes: { "data-link": target, title: `Open: ${target}` },
          }).range(aliasFrom, aliasTo),
        );
        hideMarkdownSyntax(decorations, aliasTo, fullFrom + match[0].length);
      }
    } else {
      const contentFrom = fullFrom + 2;
      const contentTo = contentFrom + target.length;
      if (contentFrom < contentTo) {
        hideMarkdownSyntax(decorations, fullFrom, contentFrom);
        decorations.push(
          Decoration.mark({
            class: "cm-live-wikilink",
            attributes: { "data-link": target, title: `Open: ${target}` },
          }).range(contentFrom, contentTo),
        );
        hideMarkdownSyntax(decorations, contentTo, fullFrom + match[0].length);
      }
    }
  }
}

function addInactiveInlineHTMLDecorations(
  decorations: any[],
  lineFrom: number,
  lineText: string,
) {
  const htmlRegex = /(<([a-zA-Z]+)([^>]*)>)([\s\S]*?)(<\/\2>)/g;
  let match;
  while ((match = htmlRegex.exec(lineText)) !== null) {
    const openTag = match[1];
    const tagName = match[2].toLowerCase();
    const attrs = match[3];
    const content = match[4];
    const closeTag = match[5];

    // Calculate absolute offsets
    const openFrom = lineFrom + match.index;
    const contentFrom = openFrom + openTag.length;
    const contentTo = contentFrom + content.length;
    const closeTo = contentTo + closeTag.length;

    // Build the style/attributes object to apply to the content range
    const attributes: Record<string, string> = {
      class: "cm-live-html-content"
    };
    
    // Parse style attribute if present
    const styleMatch = attrs.match(/style=(["\x27])(.*?)\1/i);
    if (styleMatch) {
      let styleStr = styleMatch[2].trim().replace(/;+$/, "");
      if (/background-color\s*:/i.test(styleStr) || /background\s*:/i.test(styleStr)) {
        styleStr += "; color: #000000 !important;";
      }
      attributes.style = styleStr;
    }
    
    // Parse class attribute if present
    const classMatch = attrs.match(/class=(["\x27])(.*?)\1/i);
    if (classMatch) {
      attributes.class = "cm-live-html-content " + classMatch[2];
    }

    // Default styles for common tag names
    if (tagName === "u") {
      attributes.style = (attributes.style || "") + ";text-decoration:underline";
    } else if (tagName === "i" || tagName === "em") {
      attributes.style = (attributes.style || "") + ";font-style:italic";
    } else if (tagName === "b" || tagName === "strong") {
      attributes.style = (attributes.style || "") + ";font-weight:bold";
    } else if (tagName === "s" || tagName === "del") {
      attributes.style = (attributes.style || "") + ";text-decoration:line-through";
    } else if (tagName === "mark") {
      attributes.style = (attributes.style || "") + ";background-color:#ffff00;color:#000000 !important";
    }

    // Hide opening and closing tags
    hideMarkdownSyntax(decorations, openFrom, contentFrom);
    hideMarkdownSyntax(decorations, contentTo, closeTo);

    // Apply decorations to content range
    if (contentFrom < contentTo && Object.keys(attributes).length > 0) {
      decorations.push(
        Decoration.mark({ attributes }).range(contentFrom, contentTo)
      );
    }
  }
}

function addInactiveBlockPreviewDecorations(
  decorations: any[],
  lineFrom: number,
  lineText: string,
) {
  const indentText = lineText.match(/^\s*/)?.[0] || "";
  const indent = indentText.replace(/\t/g, "    ").length;
  const listMatch = lineText.match(/^(\s*)(?:<[a-zA-Z]+[^>]*>)?((?:[-*+])|\d+[.)])\s+(\[[ xX]\]\s+)?/);
  if (listMatch) {
    // Hide the leading spaces to let the padding handle the indentation cleanly
    if (listMatch[1].length > 0) {
      hideMarkdownSyntax(decorations, lineFrom, lineFrom + listMatch[1].length);
    }

    const tagMatch = listMatch[0].match(/^(?:\s*)(?:<[a-zA-Z]+[^>]*>)/);
    const offset = tagMatch ? tagMatch[0].length : listMatch[1].length;
    const markerFrom = lineFrom + offset;
    const markerTo = markerFrom + listMatch[2].length;

    const checkbox = listMatch[3];
    if (checkbox) {
      const checkboxFrom = markerTo + 1;
      const checkboxTo = checkboxFrom + checkbox.length;
      hideMarkdownSyntax(decorations, markerFrom, checkboxFrom);
      replaceMarkdownSyntax(
        decorations,
        checkboxFrom,
        checkboxTo,
        new CheckboxWidget(/\[[xX]\]/.test(checkbox)),
      );
    } else {
      const markerText = /^\d/.test(listMatch[2]) ? listMatch[2] : "•";
      replaceMarkdownSyntax(
        decorations,
        markerFrom,
        markerTo,
        new InlineTextWidget(markerText, "cm-live-list-marker"),
      );
    }

    const depth = indent === 0 ? 0 : Math.min(6, Math.floor((indent - 1) / 4) + 1);
    decorations.push(
      Decoration.line({
        attributes: {
          class: `${checkbox ? "cm-live-task-line" : "cm-live-list-line"} cm-live-indent-${depth}`,
        },
      }).range(lineFrom),
    );
    return;
  }

  const quoteMatch = lineText.match(/^(\s*)(?:<[a-zA-Z]+[^>]*>)?(>+\s*)/);
  if (quoteMatch) {
    // Hide the leading spaces
    if (quoteMatch[1].length > 0) {
      hideMarkdownSyntax(decorations, lineFrom, lineFrom + quoteMatch[1].length);
    }

    const tagMatch = quoteMatch[0].match(/^(?:\s*)(?:<[a-zA-Z]+[^>]*>)/);
    const offset = tagMatch ? tagMatch[0].length : quoteMatch[1].length;
    hideMarkdownSyntax(decorations, lineFrom + offset, lineFrom + offset + quoteMatch[2].length);

    decorations.push(
      Decoration.line({
        attributes: { class: "cm-live-blockquote-line" },
      }).range(lineFrom),
    );
  }
}

/**
 * Live Preview plugin — hides common Markdown syntax on non-active lines
 * and applies rendered styling while keeping the active line source-visible.
 */
function markdownLivePreviewPlugin() {
  const headingRegex = /^([ \t]*)(?:<[a-zA-Z]+[^>]*>)?(#{1,6})\s/;
  const codeFenceRegex = /^\s*```/;

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const decorations: any[] = [];
        const state = view.state;
        const doc = state.doc;
        const selection = state.selection;

        // Get the set of lines that have a cursor
        const activeLinesSet = new Set<number>();
        for (const range of selection.ranges) {
          const startLine = doc.lineAt(range.from).number;
          const endLine = doc.lineAt(range.to).number;
          for (let l = startLine; l <= endLine; l++) {
            activeLinesSet.add(l);
          }
        }

        for (const { from, to } of view.visibleRanges) {
          const startLineNum = doc.lineAt(from).number;
          const endLineNum = doc.lineAt(to).number;

          let inCodeBlock = false;
          for (let check = 1; check < startLineNum; check++) {
            if (codeFenceRegex.test(doc.line(check).text)) {
              inCodeBlock = !inCodeBlock;
            }
          }

          for (let i = startLineNum; i <= endLineNum; i++) {
            const line = doc.line(i);
            const isFence = codeFenceRegex.test(line.text);
            const match = headingRegex.exec(line.text);
            const isActive = activeLinesSet.has(i);

            if (isFence) {
              if (!isActive) {
                decorations.push(
                  Decoration.line({
                    attributes: { class: "cm-live-codeblock-line" },
                  }).range(line.from),
                );
              }
              inCodeBlock = !inCodeBlock;
              continue;
            }

            if (inCodeBlock) {
              if (!isActive) {
                decorations.push(
                  Decoration.line({
                    attributes: { class: "cm-live-codeblock-line" },
                  }).range(line.from),
                );
              }
              continue;
            }

            // Callout block detection
            const calloutMatch = line.text.match(/^[ \t]*(?:<[a-zA-Z]+[^>]*>)?>+[ \t]*\[!(\w+)\]([+-]?)(?:[ \t]+(.*?))?[ \t]*$/i);
            if (calloutMatch) {
              const calloutStart = i;
              const calloutType = calloutMatch[1].toLowerCase();
              const foldChar = calloutMatch[2];
              const isFoldable = foldChar === "+" || foldChar === "-";
              const isCollapsed = foldChar === "-";
              const customTitle = calloutMatch[3]?.trim();
              const displayTitle = customTitle || calloutType.toUpperCase();

              // Collect callout lines
              let calloutEnd = i;
              while (calloutEnd + 1 <= doc.lines && /^[ \t]*(?:<[a-zA-Z]+[^>]*>)?>+/.test(doc.line(calloutEnd + 1).text)) {
                // If the next line is a new callout header, stop this callout block
                if (/^[ \t]*(?:<[a-zA-Z]+[^>]*>)?>+[ \t]*\[!\w+\]/i.test(doc.line(calloutEnd + 1).text)) {
                  break;
                }
                calloutEnd++;
              }

              let isCalloutFocused = false;
              for (let c = calloutStart; c <= calloutEnd; c++) {
                if (activeLinesSet.has(c)) {
                  isCalloutFocused = true;
                  break;
                }
              }

              if (!isCalloutFocused) {
                const bodyLines: string[] = [];
                for (let c = calloutStart + 1; c <= calloutEnd; c++) {
                  const lText = doc.line(c).text;
                  const stripped = lText.replace(/^[ \t]*(?:<[a-zA-Z]+[^>]*>)?>+[ \t]?/, "");
                  bodyLines.push(stripped);
                }
                const bodyText = bodyLines.join("\n");

                // Replace calloutStart line content with the rendered MarkdownCalloutWidget
                decorations.push(
                  Decoration.replace({
                    widget: new MarkdownCalloutWidget(calloutType, displayTitle, bodyText, calloutStart, calloutEnd, isFoldable, isCollapsed),
                  }).range(line.from, line.to),
                );

                // Hide subsequent callout lines within their own line boundaries without replacing line breaks
                for (let j = calloutStart + 1; j <= calloutEnd; j++) {
                  const subLine = doc.line(j);
                  if (subLine.from < subLine.to) {
                    decorations.push(
                      Decoration.replace({
                        widget: new EmptyInlineWidget(),
                      }).range(subLine.from, subLine.to),
                    );
                  }
                  decorations.push(
                    Decoration.line({
                      attributes: {
                        class: "cm-hidden-line",
                        style: "display: none !important; height: 0 !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; line-height: 0 !important; overflow: hidden !important;",
                      },
                    }).range(subLine.from),
                  );
                }

                i = calloutEnd;
                continue;
              } else {
                // Focused mode: user clicked into the callout to edit
                for (let c = calloutStart; c <= calloutEnd; c++) {
                  const cLine = doc.line(c);
                  const isCurrentActive = activeLinesSet.has(c);
                  const isFirst = c === calloutStart;
                  const isLast = c === calloutEnd;

                  const positionClass = isFirst && isLast
                    ? "cm-live-callout-first cm-live-callout-last"
                    : isFirst
                    ? "cm-live-callout-first"
                    : isLast
                    ? "cm-live-callout-last"
                    : "cm-live-callout-mid";

                  decorations.push(
                    Decoration.line({
                      attributes: {
                        class: `cm-live-callout-line ${positionClass} cm-live-callout-${calloutType}`,
                      },
                    }).range(cLine.from),
                  );

                  if (isFirst) {
                    if (!isCurrentActive) {
                      decorations.push(
                        Decoration.replace({
                          widget: new InlineTextWidget(displayTitle, "cm-live-callout-title"),
                        }).range(cLine.from, cLine.to),
                      );
                    }
                  } else {
                    if (!isCurrentActive) {
                      const prefixMatch = cLine.text.match(/^[ \t]*(?:<[a-zA-Z]+[^>]*>)?>+[ \t]?/);
                      if (prefixMatch) {
                        hideMarkdownSyntax(decorations, cLine.from, cLine.from + prefixMatch[0].length);
                      }
                    }
                  }
                }

                i = calloutEnd;
                continue;
              }
            }

            if (isTableRow(line.text) && i < doc.lines && isTableSeparator(doc.line(i + 1).text)) {
              const tableStart = i;
              const tableRows: string[] = [line.text, doc.line(i + 1).text];
              let tableEnd = i + 1;
              while (tableEnd + 1 <= doc.lines && isTableRow(doc.line(tableEnd + 1).text)) {
                tableEnd++;
                tableRows.push(doc.line(tableEnd).text);
              }

              let isTableFocused = false;
              for (let c = tableStart; c <= tableEnd; c++) {
                if (activeLinesSet.has(c)) {
                  isTableFocused = true;
                  break;
                }
              }

              if (isTableFocused) {
                for (let j = tableStart; j <= tableEnd; j++) {
                  const subLine = doc.line(j);
                  const isSep = isTableSeparator(subLine.text);
                  decorations.push(
                    Decoration.line({
                      attributes: {
                        class: `HyperMD-table-row ${isSep ? 'cm-live-table-source-separator' : 'cm-live-table-source-row'}`,
                      },
                    }).range(subLine.from),
                  );
                }
                i = tableEnd;
                continue;
              }

              // Replace tableStart line content with the rendered MarkdownTableWidget
              decorations.push(
                Decoration.replace({
                  widget: new MarkdownTableWidget(tableRows, tableStart),
                }).range(line.from, line.to),
              );

              // Hide subsequent table lines within their own line boundaries without replacing line breaks (\n)
              for (let j = tableStart + 1; j <= tableEnd; j++) {
                const subLine = doc.line(j);
                if (subLine.from < subLine.to) {
                  decorations.push(
                    Decoration.replace({
                      widget: new EmptyInlineWidget(),
                    }).range(subLine.from, subLine.to),
                  );
                }
                decorations.push(
                  Decoration.line({
                    attributes: { style: "display: none;" },
                  }).range(subLine.from),
                );
              }

              i = tableEnd;
              continue;
            }

            if (match) {
              const level = match[2].length;

              if (!isActive) {
                // Hide the `# ` prefix on non-active heading lines
                const tagMatch = match[0].match(/^(?:[ \t]*)(?:<[a-zA-Z]+[^>]*>)/);
                const offset = tagMatch ? tagMatch[0].length : match[1].length;
                const hashesLength = match[2].length + 1; // plus space
                hideMarkdownSyntax(decorations, line.from + offset, line.from + offset + hashesLength);
              }

              // Apply heading font size as a line decoration
              const sizes = ["2.0em", "1.6em", "1.37em", "1.25em", "1.1em", "1em"];
              const fontSize = sizes[level - 1] || "1em";
              decorations.push(
                Decoration.line({
                  attributes: {
                    style: `font-size: ${fontSize}; line-height: 1.3; font-weight: 700; font-family: var(--font-family); color: var(--editor-heading);`,
                    class: `cm-heading-${level}`,
                  },
                }).range(line.from),
              );
            }

            if (!isActive) {
              addInactiveBlockPreviewDecorations(
                decorations,
                line.from,
                line.text,
              );
              addInactiveInlinePreviewDecorations(decorations, line.from, line.text);
              addInactiveInlineHTMLDecorations(decorations, line.from, line.text);
            }
          }
        }

        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

const INLINE_PHRASE_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "this", "that", "these", "those", "it", "its", "they", "them",
  "their", "you", "your", "we", "our", "i", "me", "my", "as", "if", "then",
  "also", "very", "just", "really", "about", "into", "over", "after", "before",
]);

interface ParsedListLine {
  lineNumber: number;
  from: number;
  to: number;
  indent: string;
  marker: string;
  hasChecklist: boolean;
  content: string;
}

interface SectionHeading {
  lineNumber: number;
  level: number;
  title: string;
}

interface ActiveListSectionContext {
  heading: SectionHeading;
  sectionStartLine: number;
  sectionEndLine: number;
  sectionContent: string;
  listItems: ParsedListLine[];
  activeList: ParsedListLine;
  listPrefix: string;
  anchorPos: number;
  anchorLine: number;
  replaceFrom: number;
  replaceTo: number;
  isPlaceholderLine: boolean;
}

const SECTION_HEADING_REGEX = /^(#{2,6})\s+(.+?)\s*$/;
const SECTION_LIST_ITEM_REGEX = /^(\s*)([-*+]\s+)(\[[ xX]\]\s+)?(.+?)\s*$/;
const SECTION_LIST_PLACEHOLDER_REGEX = /^(\s*)([-*+]\s+)(\[[ xX]\]\s*)?$/;
const SECTION_STOP_WORDS = new Set([
  ...INLINE_PHRASE_STOP_WORDS,
  "todo",
  "tasks",
  "notes",
  "items",
  "list",
  "section",
]);

const SECTION_GENERATION_SIMILARITY_FLOOR = 0.38;
const SECTION_PRIMARY_RELEVANCE_THRESHOLD = 0.48;
const SECTION_DISPLAY_CAP = 2;
const SECTION_FORCED_MINIMUM_RELEVANCE_FLOOR = 0.34;
const SECTION_SEMANTIC_DUPLICATE_OVERLAP = 0.72;
const SUGGESTION_STABILITY_WINDOW_MS = 2600;
const SUGGESTION_SIGNIFICANT_IMPROVEMENT_DELTA = 0.12;
const INTENT_SHIFT_COSINE_THRESHOLD = 0.5;
const INTENT_SHIFT_RESET_WINDOW_MS = 1800;
const SECTION_EXPLORATION_BOOST_WEIGHT = 0.15;
const CONFIDENCE_HIGH_SIMILARITY = 0.72;
const CONFIDENCE_MEDIUM_SIMILARITY = 0.56;
const SECTION_SUGGESTION_DEBUG =
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

const SECTION_INTENT_FALLBACK_RULES: Array<{ pattern: RegExp; keywords: string[] }> = [
  {
    pattern: /\b(learn|study|reading|research|explore|practice|skills?)\b/i,
    keywords: [
      "learn",
      "learning",
      "guide",
      "basics",
      "fundamentals",
      "concept",
      "course",
      "practice",
      "tutorial",
      "skill",
      "skills",
    ],
  },
  {
    pattern: /\b(project|build|roadmap|planning|milestone|deliver)\b/i,
    keywords: ["project", "planning", "roadmap", "implementation", "architecture", "workflow"],
  },
  {
    pattern: /\b(career|work|job|interview)\b/i,
    keywords: ["career", "interview", "resume", "networking", "skills", "development"],
  },
  {
    pattern: /\b(finance|money|invest|budget)\b/i,
    keywords: ["finance", "budget", "investment", "savings", "tax", "planning"],
  },
  {
    pattern: /\b(health|fitness|wellness)\b/i,
    keywords: ["health", "fitness", "exercise", "sleep", "nutrition", "wellness"],
  },
];

interface SectionSuggestionPlan {
  suggestions: EnrichedSuggestion[];
  lowConfidencePaths: Set<string>;
  deferredMinimum: boolean;
  topSignalScore: number;
}

function normalizeSuggestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSectionText(value: string): string[] {
  return normalizeSuggestionText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !SECTION_STOP_WORDS.has(token));
}

function tokenOverlapScore(source: string[], target: string[]): number {
  if (source.length === 0 || target.length === 0) return 0;
  const targetSet = new Set(target);
  const overlap = source.filter((token) => targetSet.has(token)).length;
  return overlap / Math.max(1, Math.min(source.length, target.length));
}

function buildRecencyWeightedTokenMap(items: ParsedListLine[]): Map<string, number> {
  const weights = new Map<string, number>();
  items.forEach((item, index) => {
    const decay = Math.max(0.5, 1 - index * 0.22);
    const tokens = tokenizeSectionText(item.content);
    for (const token of tokens) {
      const current = weights.get(token) || 0;
      if (decay > current) {
        weights.set(token, decay);
      }
    }
  });
  return weights;
}

function weightedTokenOverlapScore(
  weightedSourceTokens: Map<string, number>,
  targetTokens: string[],
): number {
  if (weightedSourceTokens.size === 0 || targetTokens.length === 0) return 0;
  const uniqueTarget = new Set(targetTokens);
  let overlap = 0;
  uniqueTarget.forEach((token) => {
    overlap += weightedSourceTokens.get(token) || 0;
  });
  return overlap / Math.max(1, Math.min(weightedSourceTokens.size, uniqueTarget.size));
}

function buildTokenFrequencyMap(value: string): Map<string, number> {
  const map = new Map<string, number>();
  const tokens = tokenizeSectionText(value);
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function cosineSimilarityFromTokenMaps(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [, value] of a) {
    normA += value * value;
  }
  for (const [, value] of b) {
    normB += value * value;
  }
  if (normA === 0 || normB === 0) return 0;

  for (const [token, value] of a) {
    const other = b.get(token);
    if (!other) continue;
    dot += value * other;
  }

  return dot / Math.sqrt(normA * normB);
}

function buildIntentContextSnapshot(
  doc: EditorState["doc"],
  cursorPos: number,
  sectionContext: ActiveListSectionContext | null,
): string {
  if (sectionContext) {
    const recentItems = sectionContext.listItems
      .filter((item) => item.lineNumber <= sectionContext.anchorLine)
      .sort((a, b) => b.lineNumber - a.lineNumber)
      .slice(0, 4)
      .map((item) => item.content)
      .join(" ");

    return [
      sectionContext.heading.title,
      recentItems,
      sectionContext.activeList.content,
      sectionContext.sectionContent,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const cursorLine = doc.lineAt(cursorPos).number;
  const startLine = Math.max(1, cursorLine - 2);
  const endLine = Math.min(doc.lines, cursorLine + 2);
  const lines: string[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    lines.push(doc.line(lineNumber).text);
  }
  return lines.join("\n");
}

function resolveSuggestionConfidence(
  similarity: number,
  forceLowConfidence = false,
): "high" | "medium" | "low" {
  if (forceLowConfidence) return "low";
  if (similarity >= CONFIDENCE_HIGH_SIMILARITY) return "high";
  if (similarity >= CONFIDENCE_MEDIUM_SIMILARITY) return "medium";
  return "low";
}

function extractSectionIntentFallbackKeywords(headingTitle: string): string[] {
  const matched = SECTION_INTENT_FALLBACK_RULES.filter((rule) =>
    rule.pattern.test(headingTitle),
  );
  if (matched.length === 0) return [];
  return [...new Set(matched.flatMap((rule) => rule.keywords))];
}

function keywordOverlapScore(candidateTokens: string[], keywords: string[]): number {
  if (candidateTokens.length === 0 || keywords.length === 0) return 0;
  const keywordSet = new Set(keywords);
  const overlap = candidateTokens.filter((token) => keywordSet.has(token)).length;
  return overlap / Math.max(1, Math.min(candidateTokens.length, keywords.length));
}

function normalizedTextOverlap(a: string, b: string): number {
  const tokensA = tokenizeSectionText(a);
  const tokensB = tokenizeSectionText(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  setA.forEach((token) => {
    if (setB.has(token)) intersection += 1;
  });
  return intersection / Math.max(1, Math.min(setA.size, setB.size));
}

function looksLikeMinorVariation(a: string, b: string): boolean {
  const normalizedA = normalizeSuggestionText(a);
  const normalizedB = normalizeSuggestionText(b);
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  if (
    Math.min(normalizedA.length, normalizedB.length) >= 6 &&
    (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA))
  ) {
    return true;
  }

  return normalizedTextOverlap(normalizedA, normalizedB) >= SECTION_SEMANTIC_DUPLICATE_OVERLAP;
}

function parseListLine(
  lineText: string,
  lineNumber: number,
  from: number,
  to: number,
): ParsedListLine | null {
  const match = lineText.match(SECTION_LIST_ITEM_REGEX);
  if (!match) return null;

  return {
    lineNumber,
    from,
    to,
    indent: match[1] || "",
    marker: match[2] || "- ",
    hasChecklist: Boolean(match[3]),
    content: (match[4] || "").trim(),
  };
}

function findNearestHeading(
  doc: EditorState["doc"],
  cursorLineNumber: number,
): SectionHeading | null {
  for (let lineNumber = cursorLineNumber; lineNumber >= 1; lineNumber--) {
    const line = doc.line(lineNumber);
    const match = line.text.match(SECTION_HEADING_REGEX);
    if (!match) continue;

    return {
      lineNumber,
      level: match[1].length,
      title: (match[2] || "").trim(),
    };
  }

  return null;
}

function findSectionEndLine(
  doc: EditorState["doc"],
  headingLineNumber: number,
  headingLevel: number,
): number {
  for (let lineNumber = headingLineNumber + 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const match = line.text.match(SECTION_HEADING_REGEX);
    if (!match) continue;

    const level = match[1].length;
    if (level <= headingLevel) {
      return lineNumber - 1;
    }
  }

  return doc.lines;
}

function detectActiveListSectionContext(
  doc: EditorState["doc"],
  cursorPos: number,
): ActiveListSectionContext | null {
  const cursorLine = doc.lineAt(cursorPos);
  const cursorLineNumber = cursorLine.number;

  const heading = findNearestHeading(doc, cursorLineNumber);
  if (!heading) return null;

  const sectionStartLine = heading.lineNumber + 1;
  const sectionEndLine = findSectionEndLine(doc, heading.lineNumber, heading.level);
  if (sectionStartLine > sectionEndLine) return null;
  if (cursorLineNumber < sectionStartLine || cursorLineNumber > sectionEndLine) return null;

  const sectionLines: string[] = [];
  const listItems: ParsedListLine[] = [];

  for (let lineNumber = sectionStartLine; lineNumber <= sectionEndLine; lineNumber++) {
    const line = doc.line(lineNumber);
    sectionLines.push(line.text);
    const parsed = parseListLine(line.text, lineNumber, line.from, line.to);
    if (parsed) listItems.push(parsed);
  }

  if (listItems.length === 0) return null;

  let activeList = parseListLine(
    cursorLine.text,
    cursorLineNumber,
    cursorLine.from,
    cursorLine.to,
  );
  let listPrefix = "";
  let isPlaceholderLine = false;
  let replaceFrom = cursorLine.to;
  let replaceTo = cursorLine.to;

  if (activeList) {
    listPrefix = `${activeList.indent}${activeList.marker}${activeList.hasChecklist ? "[ ] " : ""}`;
  } else {
    const placeholder = cursorLine.text.match(SECTION_LIST_PLACEHOLDER_REGEX);

    if (placeholder) {
      const hasNearbyList = listItems.some(
        (item) => Math.abs(item.lineNumber - cursorLineNumber) <= 2,
      );
      if (!hasNearbyList) return null;

      activeList = {
        lineNumber: cursorLineNumber,
        from: cursorLine.from,
        to: cursorLine.to,
        indent: placeholder[1] || "",
        marker: placeholder[2] || "- ",
        hasChecklist: Boolean(placeholder[3]),
        content: "",
      };
      listPrefix = `${activeList.indent}${activeList.marker}${activeList.hasChecklist ? "[ ] " : ""}`;
      isPlaceholderLine = true;
      replaceFrom = cursorLine.from;
      replaceTo = cursorLine.to;
    } else if (cursorLine.text.trim() === "") {
      const previousLineNumber = cursorLineNumber - 1;
      if (previousLineNumber < sectionStartLine) return null;

      const previousLine = doc.line(previousLineNumber);
      const previousList = parseListLine(
        previousLine.text,
        previousLineNumber,
        previousLine.from,
        previousLine.to,
      );
      if (!previousList || cursorLineNumber - previousList.lineNumber > 1) return null;

      activeList = previousList;
      listPrefix = `${previousList.indent}${previousList.marker}${previousList.hasChecklist ? "[ ] " : ""}`;
      isPlaceholderLine = true;
      replaceFrom = cursorLine.from;
      replaceTo = cursorLine.to;
    } else {
      return null;
    }
  }

  if (!activeList) return null;

  return {
    heading,
    sectionStartLine,
    sectionEndLine,
    sectionContent: sectionLines.join("\n"),
    listItems,
    activeList,
    listPrefix,
    anchorPos: isPlaceholderLine ? replaceTo : activeList.to,
    anchorLine: isPlaceholderLine ? cursorLineNumber : activeList.lineNumber,
    replaceFrom,
    replaceTo,
    isPlaceholderLine,
  };
}

function buildSectionScopedSuggestions(
  context: ActiveListSectionContext,
  candidates: EnrichedSuggestion[],
  debugSource = "section-primary",
  allowForcedMinimum = false,
  resetBias = false,
): SectionSuggestionPlan {
  if (candidates.length === 0) {
    return {
      suggestions: [],
      lowConfidencePaths: new Set(),
      deferredMinimum: false,
      topSignalScore: 0,
    };
  }

  const recentListItems = [...context.listItems]
    .filter((item) => item.lineNumber <= context.anchorLine)
    .sort((a, b) => b.lineNumber - a.lineNumber)
    .slice(0, 3);
  const recentTokenWeights = buildRecencyWeightedTokenMap(recentListItems);

  const sectionIntentTokens = tokenizeSectionText(context.heading.title);
  const sectionContextTokens = tokenizeSectionText(context.sectionContent);
  const fallbackIntentKeywords = extractSectionIntentFallbackKeywords(
    context.heading.title,
  );

  const existingItems = new Set(
    context.listItems
      .map((item) => normalizeSuggestionText(item.content))
      .filter(Boolean),
  );

  const generationCandidates = candidates
    .filter((candidate, index, source) =>
      source.findIndex((item) => item.path === candidate.path) === index,
    )
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 30);

  const afterSimilarityFilter = generationCandidates.filter(
    (candidate) => candidate.similarity >= SECTION_GENERATION_SIMILARITY_FLOOR,
  );

  const withSectionSignals = afterSimilarityFilter
    .map((candidate) => {
      const candidateTokens = tokenizeSectionText(
        `${candidate.title} ${candidate.sharedConcepts.join(" ")}`,
      );
      const recentListOverlap = weightedTokenOverlapScore(
        recentTokenWeights,
        candidateTokens,
      );
      const intentOverlap = tokenOverlapScore(sectionIntentTokens, candidateTokens);
      const contextOverlap = tokenOverlapScore(sectionContextTokens, candidateTokens);
      const keywordOverlap = keywordOverlapScore(
        candidateTokens,
        fallbackIntentKeywords,
      );
      const hasSectionSignal =
        recentListOverlap > 0 || intentOverlap > 0 || contextOverlap > 0 || keywordOverlap > 0;

      const recencyRelevanceWeight = resetBias ? 0.06 : 0.2;
      const contextRelevanceWeight = resetBias ? 0.15 : 0.11;
      const intentRelevanceWeight = resetBias ? 0.11 : 0.08;
      const keywordRelevanceWeight = resetBias ? 0.07 : 0.05;

      const relevance =
        candidate.similarity +
        recentListOverlap * recencyRelevanceWeight +
        contextOverlap * contextRelevanceWeight +
        intentOverlap * intentRelevanceWeight +
        keywordOverlap * keywordRelevanceWeight;

      const fallbackRelevance = resetBias
        ? contextOverlap * 0.38 +
        intentOverlap * 0.28 +
        keywordOverlap * 0.2 +
        candidate.similarity * 0.14
        : recentListOverlap * 0.52 +
        contextOverlap * 0.24 +
        intentOverlap * 0.12 +
        keywordOverlap * 0.08 +
        candidate.similarity * 0.04;

      // Fallback exploration should only nudge rank order, never dominate strong matches.
      const explorationBoost = Math.max(0, 1 - recentListOverlap) * SECTION_EXPLORATION_BOOST_WEIGHT;

      return {
        candidate,
        relevance,
        fallbackRelevance,
        explorationBoost,
        recentListOverlap,
        intentOverlap,
        contextOverlap,
        keywordOverlap,
        hasSectionSignal,
      };
    })
    .filter((entry) => entry.hasSectionSignal);

  const existingItemTexts = context.listItems
    .map((item) => item.content)
    .filter(Boolean);

  const seenTitles: string[] = [];
  const afterDedup = withSectionSignals.filter((entry) => {
    const normalizedTitle = normalizeSuggestionText(entry.candidate.title);
    if (!normalizedTitle) return false;
    if (existingItems.has(normalizedTitle)) return false;
    if (existingItemTexts.some((itemText) => looksLikeMinorVariation(entry.candidate.title, itemText))) {
      return false;
    }
    if (seenTitles.some((seen) => looksLikeMinorVariation(seen, entry.candidate.title))) {
      return false;
    }
    seenTitles.push(entry.candidate.title);
    return true;
  });

  const primary = afterDedup
    .filter((entry) => entry.relevance >= SECTION_PRIMARY_RELEVANCE_THRESHOLD && entry.candidate.similarity >= 0.35)
    .sort((a, b) => b.relevance - a.relevance);

  const lowConfidencePaths = new Set<string>();
  const finalEntries = primary.slice(0, SECTION_DISPLAY_CAP);
  const deferredMinimum = false;

  const suggestions = finalEntries
    .slice(0, SECTION_DISPLAY_CAP)
    .map((entry) => entry.candidate);
  const topSignalScore = finalEntries[0]
    ? Math.max(
      finalEntries[0].relevance,
      finalEntries[0].fallbackRelevance + finalEntries[0].explorationBoost * 0.35,
    )
    : 0;

  if (SECTION_SUGGESTION_DEBUG) {
    console.debug("[section-suggestions]", {
      source: debugSource,
      heading: context.heading.title,
      totalCandidates: generationCandidates.length,
      afterSimilarityFilter: afterSimilarityFilter.length,
      afterSectionFilter: withSectionSignals.length,
      afterDeduplication: afterDedup.length,
      finalDisplayed: suggestions.length,
      usedFallback: primary.length === 0 && suggestions.length > 0,
      forcedMinimum:
        allowForcedMinimum &&
        primary.length === 0 &&
        suggestions.length > 0 &&
        lowConfidencePaths.size > 0,
      deferredMinimum,
      allowForcedMinimum,
      resetBias,
    });
  }

  return { suggestions, lowConfidencePaths, deferredMinimum, topSignalScore };
}



function wireSuggestionAction(
  button: HTMLButtonElement,
  callback: () => void,
): void {
  button.tabIndex = -1;
  button.setAttribute("contenteditable", "false");
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    callback();
  });
}



class EndOfNoteSuggestionsWidget extends WidgetType {
  private readonly key: string;

  constructor(
    private readonly suggestions: EnrichedSuggestion[],
    private readonly nextStepSuggestions: EnrichedSuggestion[],
    private readonly onAccept: (path: string) => void,
    private readonly isClosing: boolean = false,
  ) {
    super();
    this.key = nextStepSuggestions.map(
      (suggestion) => `${suggestion.path}:${Math.round(suggestion.similarity * 100)}`,
    ).join("|") + (isClosing ? ":closing" : "");
  }

  eq(other: EndOfNoteSuggestionsWidget): boolean {
    return this.key === other.key;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "editor-virtual-end-suggestions" + (this.isClosing ? " editor-virtual-end-suggestions--closing" : "");
    root.setAttribute("contenteditable", "false");
    root.style.userSelect = "none";
    root.style.caretColor = "transparent";

    const uniqueNextSteps = this.nextStepSuggestions.filter(
      (candidate, index, list) =>
        list.findIndex(
          (item) =>
            item.path === candidate.path ||
            item.title.toLowerCase().trim() === candidate.title.toLowerCase().trim(),
        ) === index,
    );

    if (uniqueNextSteps.length > 0) {
      const heading = document.createElement("div");
      heading.className = "editor-virtual-end-heading editor-virtual-end-heading--next-step";
      heading.textContent = "You may be moving toward...";
      root.appendChild(heading);

      for (const suggestion of uniqueNextSteps) {
        const line = document.createElement("div");
        line.className = "editor-virtual-end-line";

        const noteButton = document.createElement("button");
        noteButton.type = "button";
        noteButton.className = "editor-virtual-end-note editor-virtual-end-note--next-step";
        noteButton.textContent = `-> [[${suggestion.title}]]`;
        wireSuggestionAction(noteButton, () => this.onAccept(suggestion.path));
        line.appendChild(noteButton);
        root.appendChild(line);
      }
    }

    return root;
  }

  updateDOM(dom: HTMLElement): boolean {
    const expectedClass = "editor-virtual-end-suggestions" + (this.isClosing ? " editor-virtual-end-suggestions--closing" : "");
    if (dom.className !== expectedClass) {
      dom.className = expectedClass;
    }

    // Smoothly update children in place to prevent animation re-triggers
    dom.innerHTML = "";

    const uniqueNextSteps = this.nextStepSuggestions.filter(
      (candidate, index, list) =>
        list.findIndex(
          (item) =>
            item.path === candidate.path ||
            item.title.toLowerCase().trim() === candidate.title.toLowerCase().trim(),
        ) === index,
    );

    if (uniqueNextSteps.length > 0) {
      const heading = document.createElement("div");
      heading.className = "editor-virtual-end-heading editor-virtual-end-heading--next-step";
      heading.textContent = "You may be moving toward...";
      dom.appendChild(heading);

      for (const suggestion of uniqueNextSteps) {
        const line = document.createElement("div");
        line.className = "editor-virtual-end-line";

        const noteButton = document.createElement("button");
        noteButton.type = "button";
        noteButton.className = "editor-virtual-end-note editor-virtual-end-note--next-step";
        noteButton.textContent = `-> [[${suggestion.title}]]`;
        wireSuggestionAction(noteButton, () => this.onAccept(suggestion.path));
        line.appendChild(noteButton);
        dom.appendChild(line);
      }
    }

    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }
}



interface SuggestionContentStateFieldOptions {
  endSuggestions: EnrichedSuggestion[];
  nextStepSuggestions: EnrichedSuggestion[];
  showEndSuggestions: boolean;
  isActivelyTyping: boolean;
  isClosing?: boolean;
  onEndAccept: (path: string) => void;
  getStableEnd: () => { paths: string[]; topSimilarity: number; until: number } | null;
  setStableEnd: (val: { paths: string[]; topSimilarity: number; until: number } | null) => void;
  getPreviousContextVector: () => Map<string, number> | null;
  setPreviousContextVector: (val: Map<string, number> | null) => void;
  getIntentShiftUntil: () => number;
  setIntentShiftUntil: (val: number) => void;
}

function buildSuggestionsDecorations(
  state: EditorState,
  options: SuggestionContentStateFieldOptions,
): DecorationSet {
  const decorations: any[] = [];
  const doc = state.doc;
  const cursorPos = state.selection.main.head;
  const cursorLine = doc.lineAt(cursorPos).number;
  const now = Date.now();
  const sectionContext = detectActiveListSectionContext(doc, cursorPos);
  const contextSnapshot = buildIntentContextSnapshot(
    doc,
    cursorPos,
    sectionContext,
  );
  const currentContextVector = buildTokenFrequencyMap(contextSnapshot);

  const intentShiftUntil = options.getIntentShiftUntil();
  let resetBiasForThisPass = now < intentShiftUntil;

  const previousContextVector = options.getPreviousContextVector();
  if (previousContextVector && currentContextVector.size > 0) {
    const contextSimilarity = cosineSimilarityFromTokenMaps(
      previousContextVector,
      currentContextVector,
    );
    if (contextSimilarity < INTENT_SHIFT_COSINE_THRESHOLD) {
      const nextIntentShiftUntil = now + INTENT_SHIFT_RESET_WINDOW_MS;
      options.setIntentShiftUntil(nextIntentShiftUntil);
      resetBiasForThisPass = true;
      options.setStableEnd(null);
    }
  }

  if (currentContextVector.size > 0) {
    options.setPreviousContextVector(currentContextVector);
  }

  if (options.showEndSuggestions && options.endSuggestions.length > 0) {
    const nearEndStartLine = Math.max(1, doc.lines - 2);
    const editingEndLocation =
      options.isActivelyTyping && cursorLine >= nearEndStartLine;

    if (!editingEndLocation) {
      let endSuggestions = options.endSuggestions;
      const stableEnd = options.getStableEnd();
      if (stableEnd && now < stableEnd.until) {
        const topIncomingSimilarity = endSuggestions[0]?.similarity ?? 0;
        const shouldKeepStableSuggestions =
          !resetBiasForThisPass &&
          topIncomingSimilarity <=
          stableEnd.topSimilarity +
          SUGGESTION_SIGNIFICANT_IMPROVEMENT_DELTA;

        if (shouldKeepStableSuggestions) {
          const stableSuggestions = stableEnd.paths
            .map((path) =>
              options.endSuggestions.find((suggestion) => suggestion.path === path),
            )
            .filter((suggestion): suggestion is EnrichedSuggestion => Boolean(suggestion));
          if (stableSuggestions.length > 0) {
            endSuggestions = stableSuggestions;
          }
        }
      }

      const currentStableEnd = options.getStableEnd();
      if (!currentStableEnd || now >= currentStableEnd.until) {
        options.setStableEnd({
          paths: endSuggestions.map((suggestion) => suggestion.path),
          topSimilarity: endSuggestions[0]?.similarity ?? 0,
          until: now + SUGGESTION_STABILITY_WINDOW_MS,
        });
      }

      decorations.push(
        Decoration.widget({
          widget: new EndOfNoteSuggestionsWidget(
            endSuggestions,
            options.nextStepSuggestions,
            options.onEndAccept,
            options.isClosing || false,
          ),
          side: 1,
          block: false,
        }).range(doc.length),
      );
    }
  }

  if (
    options.showEndSuggestions &&
    options.endSuggestions.length === 0 &&
    options.nextStepSuggestions.length > 0
  ) {
    decorations.push(
      Decoration.widget({
        widget: new EndOfNoteSuggestionsWidget(
          [],
          options.nextStepSuggestions,
          options.onEndAccept,
          options.isClosing || false,
        ),
        side: 1,
        block: false,
      }).range(doc.length),
    );
  }

  if (decorations.length === 0) return Decoration.none;
  return Decoration.set(decorations, true);
}

function suggestionContentStateField(options: SuggestionContentStateFieldOptions) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildSuggestionsDecorations(state, options);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return buildSuggestionsDecorations(tr.state, options);
      }
      return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
function cleanInlineAIResponse(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/```(?:analysis|reasoning|thinking)[\s\S]*?```/gi, "")
    .trim();

  const finalTagMatch = cleaned.match(/<openonyx_final>([\s\S]*?)<\/openonyx_final>/i);
  if (finalTagMatch?.[1]) {
    cleaned = finalTagMatch[1].trim();
  } else {
    const finalMarkers = [
      /(?:^|\n)\s*(?:final answer|final output|final result|final|answer|result|rewritten markdown|modified text|expanded text|simplified text)\s*:\s*/gi,
      /(?:^|\n)\s*now produce final answer\s*:\s*/gi,
    ];
    for (const marker of finalMarkers) {
      const matches = Array.from(cleaned.matchAll(marker));
      const lastMatch = matches[matches.length - 1];
      if (lastMatch?.index !== undefined) {
        cleaned = cleaned.slice(lastMatch.index + lastMatch[0].length).trim();
      }
    }
    cleaned = cleaned.replace(/^(?:just\s+)?(?:the\s+)?(?:rewritten|modified|expanded|simplified)?\s*(?:markdown|text)?\s*:?\s*/i, "").trim();
  }

  // Strip leading/trailing markdown code block markers if the model wrapped the response
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) {
      cleaned = cleaned.substring(firstNewline + 1);
    } else {
      cleaned = cleaned.substring(3);
    }

    // Strip trailing code block marker if present
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
  }

  // Strip leading and trailing quotes if the model wrapped the response in quotes
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  } else if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }

  return cleaned.trim();
}

type InlineAIPreviewSpec = {
  from: number;
  to: number;
  before: string;
  after: string;
};

const setInlineAIPreviewEffect = StateEffect.define<InlineAIPreviewSpec | null>();

class InlineAIInsertWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  eq(other: InlineAIInsertWidget): boolean {
    return this.text === other.text;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-inline-ai-insert";
    root.textContent = this.text || " ";
    return root;
  }
}

type InlineDiffToken = {
  text: string;
  start: number;
  end: number;
  isSpace: boolean;
};

function tokenizeInlineDiff(text: string): InlineDiffToken[] {
  const tokens: InlineDiffToken[] = [];
  const regex = /(\s+|[^\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isSpace: /^\s+$/.test(match[0]),
    });
  }

  return tokens;
}

function buildInlineAIPreviewDecorations(spec: InlineAIPreviewSpec | null): DecorationSet {
  if (!spec) return Decoration.none;
  const from = Math.max(0, spec.from);
  const to = Math.max(from, spec.to);
  const beforeTokens = tokenizeInlineDiff(spec.before);
  const afterTokens = tokenizeInlineDiff(spec.after);
  const decorations: any[] = [];

  const dp = Array.from(
    { length: beforeTokens.length + 1 },
    () => Array<number>(afterTokens.length + 1).fill(0),
  );

  for (let i = beforeTokens.length - 1; i >= 0; i--) {
    for (let j = afterTokens.length - 1; j >= 0; j--) {
      dp[i][j] = beforeTokens[i].text === afterTokens[j].text
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const addRemoved = (token: InlineDiffToken) => {
    if (token.isSpace) return;
    const rFrom = from + token.start;
    const rTo = from + token.end;
    if (rFrom < rTo) {
      decorations.push(
        Decoration.mark({ class: "cm-inline-ai-removed" }).range(rFrom, rTo),
      );
    }
  };

  const addInsert = (pos: number, text: string) => {
    if (!text) return;
    decorations.push(
      Decoration.widget({
        widget: new InlineAIInsertWidget(text),
        side: -1,
      }).range(pos),
    );
  };

  let i = 0;
  let j = 0;
  let pendingInsertPos: number | null = null;
  let pendingInsertText = "";
  const flushInsert = () => {
    if (pendingInsertPos !== null && pendingInsertText) {
      addInsert(pendingInsertPos, pendingInsertText);
    }
    pendingInsertPos = null;
    pendingInsertText = "";
  };

  while (i < beforeTokens.length || j < afterTokens.length) {
    if (
      i < beforeTokens.length &&
      j < afterTokens.length &&
      beforeTokens[i].text === afterTokens[j].text
    ) {
      flushInsert();
      i++;
      j++;
      continue;
    }

    const shouldInsert =
      j < afterTokens.length &&
      (i >= beforeTokens.length || dp[i][j + 1] > dp[i + 1][j]);

    if (shouldInsert) {
      const insertPos = i < beforeTokens.length ? from + beforeTokens[i].start : to;
      if (pendingInsertPos === null) pendingInsertPos = insertPos;
      if (pendingInsertPos === insertPos) {
        pendingInsertText += afterTokens[j].text;
      } else {
        flushInsert();
        pendingInsertPos = insertPos;
        pendingInsertText = afterTokens[j].text;
      }
      j++;
    } else if (i < beforeTokens.length) {
      flushInsert();
      addRemoved(beforeTokens[i]);
      i++;
    }
  }
  flushInsert();

  return Decoration.set(decorations, true);
}

const inlineAIPreviewField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setInlineAIPreviewEffect)) {
        return buildInlineAIPreviewDecorations(effect.value);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

async function executeInlineAIOperation(
  text: string,
  operation: "rewrite" | "expand" | "simplify" | "explain" | "custom",
  customInstruction?: string,
  fullNoteContent?: string,
  noteTitle?: string
): Promise<string> {
  const config = loadAIConfig();
  if (!config) {
    throw new Error("No API key configured. Please add one in AI Settings.");
  }

  let prompt = "";
  if (operation === "rewrite") {
    prompt = `You are a professional writing assistant. Rewrite the exact text provided below to make it more polished, clear, and professional, while keeping the meaning identical.
The original text is in Markdown format. You MUST preserve the exact markdown formatting, headings, bold/italic markup, bullet points, lists, task list checkboxes (e.g., - [ ], - [x]), blockquotes, tables, links, and indentation of the original text.
Do NOT omit any list syntax or surrounding structure. If the original text starts with a bullet point or checklist, the rewritten text MUST start with the exact same prefix.
Return ONLY the rewritten markdown text. Do not add any introductory or concluding text, do not wrap the response in quotation marks, and do not use any emojis.

Original text to rewrite:
${text}`;
  } else if (operation === "expand") {
    prompt = `You are a professional writing assistant. Expand the exact text provided below by adding useful detail and depth, while maintaining the original tone and intent.
The original text is in Markdown format. You MUST preserve the exact markdown formatting, headings, bold/italic markup, bullet points, lists, task list checkboxes (e.g., - [ ], - [x]), blockquotes, tables, links, and indentation of the original text.
Do NOT omit any list syntax or surrounding structure. If the original text starts with a bullet point or checklist, the expanded text MUST start with the exact same prefix.
Return ONLY the expanded markdown text. Do not add any introductory or concluding text, do not wrap the response in quotation marks, and do not use any emojis.

Original text to expand:
${text}`;
  } else if (operation === "simplify") {
    prompt = `You are a professional writing assistant. Simplify the exact text provided below to make it extremely clear, simple, and direct, while keeping the core meaning identical.
The original text is in Markdown format. You MUST preserve the exact markdown formatting, headings, bold/italic markup, bullet points, lists, task list checkboxes (e.g., - [ ], - [x]), blockquotes, tables, links, and indentation of the original text.
Do NOT omit any list syntax or surrounding structure. If the original text starts with a bullet point or checklist, the simplified text MUST start with the exact same prefix.
Return ONLY the simplified markdown text. Do not add any introductory or concluding text, do not wrap the response in quotation marks, and do not use any emojis.

Original text to simplify:
${text}`;
  } else if (operation === "explain") {
    prompt = `You are a professional writing assistant. Explain the key concept, meaning, and context of the following highlighted text in a clear, concise paragraph. Return ONLY the explanation paragraph, with no introduction, surrounding quotes, or emojis:\n\n"${text}"`;
  } else if (operation === "custom") {
    prompt = `You are an intelligent, precise AI writing assistant inside a local-first markdown editor. 
You have been asked to perform the following instruction on the SELECTED TEXT: "${customInstruction}".

To help you perform this task accurately and in a highly context-aware manner, here is the context of the ACTIVE NOTE:
Note Title: ${noteTitle || "Untitled"}
Full Note Content:
"""
${fullNoteContent || text}
"""

Here is the SPECIFIC SELECTED TEXT you must modify:
"""
${text}
"""

INSTRUCTIONS:
1. Apply the instruction ("${customInstruction}") to the SELECTED TEXT appropriately.
2. Use the FULL NOTE CONTENT and Title as context to intelligently fill in details, resolve references, or deduce relevant information. For example, if asked to fill in review sections or lists, pull relevant events, tasks, and accomplishments from the rest of the note. Do not literally insert the raw instruction text into the blank spaces; instead, fill them with meaningful, contextual content.
3. You MUST preserve the exact markdown formatting, headings, bold/italic markup, bullet points, lists, task list checkboxes (e.g., - [ ], - [x]), blockquotes, tables, links, and indentation of the original selected text as much as possible.
4. Return ONLY the modified version of the SELECTED TEXT. Do not add any introductory or concluding text, do not wrap the response in quotation marks, and do not use any emojis.`;
  }

  const baseUrl = getBaseUrl(config);
  const finalOnlyPrompt = `${prompt}

Return the final replacement only inside these exact tags:
<openonyx_final>
...
</openonyx_final>
Do not include analysis, reasoning, planning, explanations, labels, or commentary outside those tags.`;
  const requestBody: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: 4096,
    temperature: 0.3,
    messages: [
      { role: "system", content: "You are a precise writing assistant inside a local-first markdown editor. Never reveal reasoning, analysis, chain-of-thought, planning, or explanations. Respond only with the final requested replacement text inside <openonyx_final> tags, preserving list styles, indentation, headings, tables, and markdown markup exactly." },
      { role: "user", content: finalOnlyPrompt },
    ],
  };
  if (config.provider === "openrouter") {
    requestBody.include_reasoning = false;
    requestBody.reasoning = { exclude: true };
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getProviderHeaders(config),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await parseProviderError(response));
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) {
    throw new Error("Empty response from AI.");
  }
  return cleanInlineAIResponse(result);
}

export function Editor({
  tabs,
  activeTabId,
  content,
  viewMode,
  availableNotes,
  specialContent,
  onAdjustFontSize,
  onTabSelect,
  onTabClose,
  onContentChange,
  onViewModeChange,
  onLinkClick,
  onGetNoteContent,
  onImagePaste,
  suggestions,
  nextStepSuggestions,
  onAcceptSuggestion,
  onRejectSuggestion,
  onOpenNote,
  annotation,
  showInsight,
  onToggleInsight,
  theme,
  settings,
  onCollabOperations,
  onCursorChange,
  remoteCursors,
  localClientId,
  onEditorViewReady,
  getViewState,
  onViewStateChange,
  readOnly = false,
  onGenerateInsight,
  isGeneratingInsight = false,
  isFocused = false,
  yCollabExtension,
}: EditorProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activePath = activeTab?.path;

  const activeTabName = useMemo(() => {
    if (!activeTab || !activeTab.path) return "";
    if (activeTab.path === "__new_tab__") return "New tab";
    const parts = activeTab.path.split("/");
    return parts[parts.length - 1].replace(/\.md$/, "");
  }, [activeTab]);

  const onViewStateChangeRef = useRef(onViewStateChange);
  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  const getViewStateRef = useRef(getViewState);
  useEffect(() => {
    getViewStateRef.current = getViewState;
  }, [getViewState]);

  const activePathRef = useRef(activePath);
  const pendingViewStateRestorePathRef = useRef<string | null>(null);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    pendingViewStateRestorePathRef.current = activePath || null;
  }, [activePath]);

  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const viewRef = useRef<EditorView | null>(null);
  const obsidianEditorRef = useRef<ObsidianEditor | null>(null);
  const contentRef = useRef(content);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  // Tracks the timestamp of the last local (user) edit. Used by the content
  // sync effect to avoid replacing the CM document with stale debounced
  // content while the user is actively typing.
  const lastLocalEditTsRef = useRef<number>(0);
  const [internalShowInsight, setInternalShowInsight] = useState(false);
  const isInsightVisible = showInsight !== undefined ? showInsight : internalShowInsight;
  const toggleInsight = (val: boolean) => {
    if (onToggleInsight) onToggleInsight(val);
    setInternalShowInsight(val);
  };
  const wheelRemainderRef = useRef(0);
  const suggestionContentCompartmentRef = useRef(new Compartment());
  const pluginExtensionsCompartmentRef = useRef(new Compartment());
  const spellcheckCompartmentRef = useRef(new Compartment());
  const editorSettingsCompartmentRef = useRef(new Compartment());
  const editorKeymapCompartmentRef = useRef(new Compartment());
  const editorBehaviorCompartmentRef = useRef(new Compartment());
  const collabCompartmentRef = useRef(new Compartment());
  const typingPauseTimerRef = useRef<number | null>(null);
  const flowTriggerDelayTimerRef = useRef<number | null>(null);
  const flowTriggerWindowTimerRef = useRef<number | null>(null);
  const sectionPauseTimerRef = useRef<number | null>(null);
  const sectionEnterTriggerTimerRef = useRef<number | null>(null);


  // Refs for collaboration callbacks -- avoids stale closures in the CodeMirror
  // update listener which is created once per tab and never re-created when
  // the collab space becomes active asynchronously.
  const onContentChangeRef = useRef(onContentChange);
  const onCollabOperationsRef = useRef(onCollabOperations);
  const onCursorChangeRef = useRef(onCursorChange);
  const localClientIdRef = useRef(localClientId);

  // Keep callback refs in sync on every render
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
    onCollabOperationsRef.current = onCollabOperations;
    onCursorChangeRef.current = onCursorChange;
    localClientIdRef.current = localClientId;
  });

  // Ref for the Yjs CRDT collaboration extension. Stored as a ref so the
  // CodeMirror extension array (created once per EditorState) reads the
  // value that was current at view-creation time.
  const yCollabExtensionRef = useRef(yCollabExtension);
  useEffect(() => {
    yCollabExtensionRef.current = yCollabExtension;
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: collabCompartmentRef.current.reconfigure(
          yCollabExtension
            ? [yCollabExtension]
            : [history(), remoteCursorsExtension()]
        ),
      });
      console.log(`[YJS] Reconfigured editor collaboration compartment (yCollabExtension is ${yCollabExtension ? "defined" : "undefined"})`);
    }
  }, [yCollabExtension]);

  const [editorWidth, setEditorWidth] = useState(50); // percentage
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [editorMountTick, setEditorMountTick] = useState(0);

  // isActivelyTyping is stored as a ref to avoid re-rendering the entire
  // Editor component on every single keystroke. We only promote to state
  // when the value *changes* (true->false or false->true) so that derived
  // UI (suggestion visibility) updates correctly without per-keystroke renders.
  const isActivelyTypingRef = useRef(false);
  const [isActivelyTyping, setIsActivelyTyping] = useState(false);
  const [isSuggestionIdle, setIsSuggestionIdle] = useState(false);
  const [isSectionPauseReady, setIsSectionPauseReady] = useState(false);
  const [hasSectionEnterTrigger, setHasSectionEnterTrigger] = useState(false);
  const [, setSectionRetryPending] = useState(false);
  const [allowForcedSectionMinimum, setAllowForcedSectionMinimum] = useState(false);
  const [hasFlowTrigger, setHasFlowTrigger] = useState(false);
  const [isNearNoteEnd, setIsNearNoteEnd] = useState(false);

  // Smoothly animated suggestions closing states
  const [renderedNextStepSuggestions, setRenderedNextStepSuggestions] = useState<EnrichedSuggestion[]>([]);
  const [renderedShowEndSuggestions, setRenderedShowEndSuggestions] = useState(false);
  const [isClosingSuggestions, setIsClosingSuggestions] = useState(false);
  const closingTimeoutRef = useRef<number | null>(null);

  // Persistent refs for stable suggestions and context shifts
  const stableEndRef = useRef<{ paths: string[]; topSimilarity: number; until: number } | null>(null);
  const previousContextVectorRef = useRef<Map<string, number> | null>(null);
  const intentShiftUntilRef = useRef<number>(0);

  const [imageLightbox, setImageLightbox] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lightboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPanning) {
      const onMouseMove = (e: MouseEvent) => {
        setPanOffset({
          x: e.clientX - panStartRef.current.x,
          y: e.clientY - panStartRef.current.y,
        });
      };
      const onMouseUp = () => {
        setIsPanning(false);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      return () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };
    }
  }, [isPanning]);

  useEffect(() => {
    const el = lightboxRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 0.15;
      const nextScale = e.deltaY < 0
        ? Math.min(5, zoomScale + zoomFactor)
        : Math.max(0.5, zoomScale - zoomFactor);
      setZoomScale(nextScale);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [imageLightbox, zoomScale]);

  const isSpecialTab = !!specialContent;

  const syncObsidianEditorContext = useCallback(() => {
    const view = viewRef.current;
    const obsidianEditor = obsidianEditorRef.current;
    if (!view || !obsidianEditor) return;

    const obsidianApp = (window as any).__oo_app;
    const currentPath = activePathRef.current || (window as any).__oo_active_file || '';
    const currentFile = obsidianApp?.vault?.getFileByPath?.(currentPath) || null;

    view.dispatch({
      effects: [
        setEditorInfoEffect.of({
          file: currentFile,
          editor: obsidianEditor,
          node: view.dom,
          view,
        }),
        setEditorEditorEffect.of(obsidianEditor),
        setEditorLivePreviewEffect.of(true),
      ],
    });

    if (obsidianApp?.workspace) {
      obsidianApp.workspace.activeEditor = {
        editor: obsidianEditor,
        file: currentFile,
      };
      const mainLeaf = obsidianApp.workspace.getMainLeaf?.() || obsidianApp.workspace.activeLeaf;
      if (mainLeaf?.view) {
        mainLeaf.view.editor = obsidianEditor;
        mainLeaf.view.sourceMode = { cmEditor: obsidianEditor, editor: obsidianEditor, sourceMode: true };
        setWritableViewProperty(mainLeaf.view, 'file', currentFile);
        mainLeaf.view.file = currentFile;
      }
    }
  }, []);

  useEffect(() => {
    if (isSpecialTab) return;
    syncObsidianEditorContext();
  }, [activePath, editorMountTick, isSpecialTab, syncObsidianEditorContext]);

  const readVimModeSetting = useCallback((): boolean => {
    try {
      const saved = localStorage.getItem("openonyx-settings");
      if (!saved) return false;
      const parsed = JSON.parse(saved) as { vimMode?: boolean };
      return !!parsed.vimMode;
    } catch {
      return false;
    }
  }, []);

  const readSpellcheckSetting = useCallback((): boolean => {
    try {
      const saved = localStorage.getItem("openonyx-settings");
      if (!saved) return false;
      const parsed = JSON.parse(saved) as { spellcheck?: boolean };
      return !!parsed.spellcheck;
    } catch {
      return false;
    }
  }, []);

  const [selectionRange, setSelectionRange] = useState<{ rect: DOMRect; text: string; from: number; to: number } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationCoords, setExplanationCoords] = useState<{ x: number; y: number } | null>(null);
  const [isInlineQuerying, setIsInlineQuerying] = useState(false);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [customPromptText, setCustomPromptText] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [pendingInlineEdit, setPendingInlineEdit] = useState<{
    operation: "rewrite" | "expand" | "simplify" | "custom";
    before: string;
    after: string;
    from: number;
    to: number;
    rect: DOMRect;
  } | null>(null);

  useEffect(() => {
    setPendingInlineEdit(null);
    viewRef.current?.dispatch({
      effects: setInlineAIPreviewEffect.of(null),
    });
  }, [activePath]);

  const handleSelectionChange = useCallback(() => {
    if (isSpecialTab) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (pendingInlineEdit) return;
      if (isInputFocused) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.closest(".inline-ai-toolbar") || activeEl.classList.contains("inline-ai-prompt-input"))) {
        return;
      }
      // Only call setState if we actually have a value to clear -- avoids
      // re-rendering on every keystroke when there's no text selection.
      setSelectionRange((prev) => prev === null ? prev : null);
      return;
    }

    try {
      const range = sel.getRangeAt(0);
      const isInsideEditor = editorRef.current?.contains(range.commonAncestorContainer) || previewRef.current?.contains(range.commonAncestorContainer);
      if (!isInsideEditor) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.closest(".inline-ai-toolbar") || activeEl.classList.contains("inline-ai-prompt-input"))) {
          return;
        }
        setSelectionRange(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      const view = viewRef.current;

      let from = 0;
      let to = 0;

      if (view) {
        if (editorRef.current?.contains(range.commonAncestorContainer)) {
          const cmFrom = view.state.selection.main.from;
          const cmTo = view.state.selection.main.to;
          if (cmFrom !== cmTo) {
            from = cmFrom;
            to = cmTo;
          } else {
            try {
              from = view.posAtDOM(range.startContainer, range.startOffset);
              to = view.posAtDOM(range.endContainer, range.endOffset);
            } catch (e) {
              from = cmFrom;
              to = cmTo;
            }
          }

          // Safe fallback: if we got collapsed boundaries but the selection is not empty, find it via substring index
          const selectedText = sel.toString().trim();
          if (from === to && selectedText) {
            const docString = view.state.doc.toString();
            const index = docString.indexOf(selectedText);
            if (index !== -1) {
              from = index;
              to = index + selectedText.length;
            }
          }
        } else if (previewRef.current?.contains(range.commonAncestorContainer)) {
          const selectedText = sel.toString().trim();
          const docString = view.state.doc.toString();
          const index = docString.indexOf(selectedText);
          if (index !== -1) {
            from = index;
            to = index + selectedText.length;
          } else {
            from = view.state.selection.main.from;
            to = view.state.selection.main.to;
          }
        }
      }

      setSelectionRange({
        rect,
        text: sel.toString(),
        from,
        to
      });
    } catch (e) {
      // Ignore transient selection range errors
    }
  }, [isSpecialTab, isInputFocused, pendingInlineEdit]);

  const applyPendingInlineEdit = useCallback(() => {
    if (!pendingInlineEdit) return;
    const view = viewRef.current;
    if (!view) return;

    const doc = view.state.doc.toString();
    let from = pendingInlineEdit.from;
    let to = pendingInlineEdit.to;
    if (doc.slice(from, to) !== pendingInlineEdit.before) {
      const fallbackIndex = doc.indexOf(pendingInlineEdit.before);
      if (fallbackIndex === -1) {
        alert("The selected text changed before this AI edit was applied. Run the edit again.");
        setPendingInlineEdit(null);
        return;
      }
      from = fallbackIndex;
      to = fallbackIndex + pendingInlineEdit.before.length;
    }

    view.dispatch({
      changes: { from, to, insert: pendingInlineEdit.after },
      selection: { anchor: from + pendingInlineEdit.after.length },
      effects: setInlineAIPreviewEffect.of(null),
    });
    view.focus();
    window.getSelection()?.removeAllRanges();
    setPendingInlineEdit(null);
    setSelectionRange(null);
    setShowPromptInput(false);
    setCustomPromptText("");
  }, [pendingInlineEdit]);

  const discardPendingInlineEdit = useCallback(() => {
    viewRef.current?.dispatch({
      effects: setInlineAIPreviewEffect.of(null),
    });
    setPendingInlineEdit(null);
    setShowPromptInput(false);
    setCustomPromptText("");
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [handleSelectionChange]);

  const handleInlineAction = async (
    operation: "rewrite" | "expand" | "simplify" | "explain" | "custom",
    customInstruction?: string
  ) => {
    if (!selectionRange) return;
    const { text } = selectionRange;

    setIsInlineQuerying(true);
    setExplanation(null);
    setExplanationCoords(null);

    try {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      const noteTitle = activeTab?.name || activeTab?.path?.split("/").pop()?.replace(".md", "") || "";
      const result = await executeInlineAIOperation(
        text,
        operation,
        customInstruction,
        content || "",
        noteTitle
      );
      if (operation === "explain") {
        setExplanation(result);
        setExplanationCoords({
          x: selectionRange.rect.left + window.scrollX,
          y: selectionRange.rect.bottom + window.scrollY + 8
        });
      } else {
        const view = viewRef.current;
        if (view) {
          view.dispatch({
            effects: setInlineAIPreviewEffect.of({
              from: selectionRange.from,
              to: selectionRange.to,
              before: text,
              after: result,
            }),
          });
          setPendingInlineEdit({
            operation,
            before: text,
            after: result,
            from: selectionRange.from,
            to: selectionRange.to,
            rect: selectionRange.rect,
          });
        } else {
          // If in preview or fallback mode, copy rewritten text to clipboard
          await navigator.clipboard.writeText(result);
          alert("Rewritten text copied to clipboard (editor view not focused).");
        }
        setShowPromptInput(false);
        setCustomPromptText("");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Inline AI operation failed.");
    } finally {
      setIsInlineQuerying(false);
    }
  };

  const activeSuggestions = useMemo(() => suggestions || [], [suggestions]);
  const activeNextStepSuggestions = useMemo(
    () => nextStepSuggestions || [],
    [nextStepSuggestions],
  );
  const endOfNoteSuggestions = useMemo(() => {
    const broaderPool = activeSuggestions
      .filter((suggestion) => suggestion.group === "broader")
      .sort((a, b) => b.similarity - a.similarity);
    const primary = broaderPool
      .filter((suggestion) => suggestion.similarity >= 0.4)
      .slice(0, 3);
    if (primary.length > 0) return primary;
    return broaderPool.slice(0, Math.min(1, broaderPool.length));
  }, [activeSuggestions]);
  const nextStepEndSuggestions = useMemo(() => {
    const docText = content || "";
    return activeNextStepSuggestions
      .filter((suggestion) => {
        const titleEscaped = suggestion.title.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const regex = new RegExp(`\\[\\[${titleEscaped}(\\|[^\\]]+)?\\]\\]`, "i");
        return !regex.test(docText);
      })
      .filter((suggestion) => suggestion.similarity >= 0.35)
      .slice(0, 3);
  }, [activeNextStepSuggestions, content]);
  const showEndSuggestionContent =
    !isSpecialTab &&
    (activeSuggestions.length > 0 || nextStepEndSuggestions.length > 0) &&
    !isActivelyTyping &&
    (isSuggestionIdle || isNearNoteEnd || hasFlowTrigger);

  const markActiveTyping = useCallback(() => {
    // Update the ref synchronously (no render) on every keystroke.
    // Only promote to state when the value actually *transitions*.
    if (!isActivelyTypingRef.current) {
      isActivelyTypingRef.current = true;
      setIsActivelyTyping(true);
    }
    if (typingPauseTimerRef.current) {
      window.clearTimeout(typingPauseTimerRef.current);
    }
    typingPauseTimerRef.current = window.setTimeout(() => {
      isActivelyTypingRef.current = false;
      setIsActivelyTyping(false);
      typingPauseTimerRef.current = null;
    }, 750);
  }, []);

  const markFlowTrigger = useCallback(() => {
    setHasFlowTrigger(false);
    if (flowTriggerDelayTimerRef.current) {
      window.clearTimeout(flowTriggerDelayTimerRef.current);
      flowTriggerDelayTimerRef.current = null;
    }
    if (flowTriggerWindowTimerRef.current) {
      window.clearTimeout(flowTriggerWindowTimerRef.current);
      flowTriggerWindowTimerRef.current = null;
    }

    flowTriggerDelayTimerRef.current = window.setTimeout(() => {
      setHasFlowTrigger(true);
      flowTriggerDelayTimerRef.current = null;

      flowTriggerWindowTimerRef.current = window.setTimeout(() => {
        setHasFlowTrigger(false);
        flowTriggerWindowTimerRef.current = null;
      }, 1600);
    }, 190);
  }, []);

  const markSectionPauseReady = useCallback(() => {
    setIsSectionPauseReady(false);
    if (sectionPauseTimerRef.current) {
      window.clearTimeout(sectionPauseTimerRef.current);
      sectionPauseTimerRef.current = null;
    }

    sectionPauseTimerRef.current = window.setTimeout(() => {
      setIsSectionPauseReady(true);
      sectionPauseTimerRef.current = null;
    }, 380);
  }, []);

  const markSectionEnterTrigger = useCallback(() => {
    setHasSectionEnterTrigger(true);
    if (sectionEnterTriggerTimerRef.current) {
      window.clearTimeout(sectionEnterTriggerTimerRef.current);
    }
    sectionEnterTriggerTimerRef.current = window.setTimeout(() => {
      setHasSectionEnterTrigger(false);
      sectionEnterTriggerTimerRef.current = null;
    }, 900);
  }, []);

  const didCompleteSentenceOrParagraph = useCallback((update: ViewUpdate): boolean => {
    let triggered = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      const text = inserted.toString();
      if (text.includes(".") || text.includes("!") || text.includes("?") || text.includes("\n")) {
        triggered = true;
      }
    });
    return triggered;
  }, []);

  const didPressEnter = useCallback((update: ViewUpdate): boolean => {
    let pressedEnter = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (inserted.toString().includes("\n")) {
        pressedEnter = true;
      }
    });
    return pressedEnter;
  }, []);

  const isNearScrollEnd = useCallback((element: HTMLElement | null): boolean => {
    if (!element) return false;
    const remaining = element.scrollHeight - (element.scrollTop + element.clientHeight);
    return remaining <= 220;
  }, []);

  const updateEndSuggestionProximity = useCallback(() => {
    if (isSpecialTab) {
      setIsNearNoteEnd(false);
      return;
    }

    const editorVisible = viewMode === "editor" || viewMode === "split";
    const previewVisible = viewMode === "preview" || viewMode === "split";
    const editorScroller = editorVisible
      ? ((viewRef.current?.scrollDOM as HTMLElement | null) || null)
      : null;
    const previewScroller = previewVisible ? previewRef.current : null;

    setIsNearNoteEnd(
      isNearScrollEnd(editorScroller) || isNearScrollEnd(previewScroller),
    );
  }, [isNearScrollEnd, isSpecialTab, viewMode]);

  useEffect(() => {
    if (isSpecialTab || activeSuggestions.length === 0) {
      setIsSuggestionIdle(false);
      return;
    }

    setIsSuggestionIdle(false);
    const timer = window.setTimeout(() => {
      setIsSuggestionIdle(true);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [activeSuggestions.length, activeTabId, content, isSpecialTab]);

  useEffect(() => {
    setHasFlowTrigger(false);
    setIsSectionPauseReady(false);
    setHasSectionEnterTrigger(false);
    setSectionRetryPending(false);
    setAllowForcedSectionMinimum(false);
    if (flowTriggerDelayTimerRef.current) {
      window.clearTimeout(flowTriggerDelayTimerRef.current);
      flowTriggerDelayTimerRef.current = null;
    }
    if (flowTriggerWindowTimerRef.current) {
      window.clearTimeout(flowTriggerWindowTimerRef.current);
      flowTriggerWindowTimerRef.current = null;
    }
    if (sectionPauseTimerRef.current) {
      window.clearTimeout(sectionPauseTimerRef.current);
      sectionPauseTimerRef.current = null;
    }
    if (sectionEnterTriggerTimerRef.current) {
      window.clearTimeout(sectionEnterTriggerTimerRef.current);
      sectionEnterTriggerTimerRef.current = null;
    }
  }, [activeTabId]);

  // Keep track of previous nextStepEndSuggestions and showEndSuggestionContent to animate closing smoothly
  useEffect(() => {
    const targetShow = showEndSuggestionContent;
    const targetSuggestions = nextStepEndSuggestions;

    // Case 1: We want to show suggestions (both show flag is true AND we have suggestions)
    if (targetShow && targetSuggestions.length > 0) {
      if (closingTimeoutRef.current) {
        window.clearTimeout(closingTimeoutRef.current);
        closingTimeoutRef.current = null;
      }
      setIsClosingSuggestions(false);
      setRenderedNextStepSuggestions(targetSuggestions);
      setRenderedShowEndSuggestions(true);
    }
    // Case 2: We are currently showing suggestions, but we should now hide them
    else if (renderedShowEndSuggestions && !isClosingSuggestions) {
      setIsClosingSuggestions(true);

      if (closingTimeoutRef.current) {
        window.clearTimeout(closingTimeoutRef.current);
      }

      closingTimeoutRef.current = window.setTimeout(() => {
        setIsClosingSuggestions(false);
        setRenderedShowEndSuggestions(false);
        setRenderedNextStepSuggestions([]);
        closingTimeoutRef.current = null;
      }, 350); // 350ms matching the CSS collapse animation duration
    }
  }, [showEndSuggestionContent, nextStepEndSuggestions, renderedShowEndSuggestions, isClosingSuggestions]);

  // Immediately clear closing state and hide suggestions when switching tabs
  useEffect(() => {
    if (closingTimeoutRef.current) {
      window.clearTimeout(closingTimeoutRef.current);
      closingTimeoutRef.current = null;
    }
    setIsClosingSuggestions(false);
    setRenderedShowEndSuggestions(false);
    setRenderedNextStepSuggestions([]);

    // Clear stable suggestion refs
    stableEndRef.current = null;
    previousContextVectorRef.current = null;
    intentShiftUntilRef.current = 0;
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      if (typingPauseTimerRef.current) {
        window.clearTimeout(typingPauseTimerRef.current);
      }
      if (flowTriggerDelayTimerRef.current) {
        window.clearTimeout(flowTriggerDelayTimerRef.current);
      }
      if (flowTriggerWindowTimerRef.current) {
        window.clearTimeout(flowTriggerWindowTimerRef.current);
      }
      if (sectionPauseTimerRef.current) {
        window.clearTimeout(sectionPauseTimerRef.current);
      }
      if (sectionEnterTriggerTimerRef.current) {
        window.clearTimeout(sectionEnterTriggerTimerRef.current);
      }
      if (closingTimeoutRef.current) {
        window.clearTimeout(closingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isSpecialTab) {
      setIsNearNoteEnd(false);
      return;
    }

    const handleScroll = () => {
      updateEndSuggestionProximity();
      if (activePathRef.current && viewRef.current) {
        onViewStateChangeRef.current?.(activePathRef.current, {
          scroll: viewRef.current.scrollDOM.scrollTop,
        });
      }
    };
    const editorScroller = viewRef.current?.scrollDOM as HTMLElement | null;
    const previewScroller = previewRef.current;

    editorScroller?.addEventListener("scroll", handleScroll, { passive: true });
    previewScroller?.addEventListener("scroll", handleScroll, { passive: true });

    const rafId = window.requestAnimationFrame(updateEndSuggestionProximity);

    return () => {
      window.cancelAnimationFrame(rafId);
      editorScroller?.removeEventListener("scroll", handleScroll);
      previewScroller?.removeEventListener("scroll", handleScroll);
    };
  }, [
    activeTabId,
    editorMountTick,
    isSpecialTab,
    updateEndSuggestionProximity,
    viewMode,
  ]);

  useEffect(() => {
    if (isSpecialTab) return;
    const rafId = window.requestAnimationFrame(updateEndSuggestionProximity);
    return () => window.cancelAnimationFrame(rafId);
  }, [content, isSpecialTab, updateEndSuggestionProximity]);
  const handleOpenImageLightbox = useCallback((src: string, alt: string) => {
    setImageLightbox({ src, alt });
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
  }, []);

  // Update available notes for autocomplete
  useEffect(() => {
    if (availableNotes) {
      setAvailableNotes(availableNotes);
    }
  }, [availableNotes]);

  // Handle checkbox toggle in preview - updates the source markdown
  const handleCheckboxToggle = useCallback(
    (checkboxIndex: number, checked: boolean) => {
      const lines = content.split("\n");
      let currentCheckbox = 0;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\s*[-*+]\s+)\[([ xX])\]/);
        if (match) {
          if (currentCheckbox === checkboxIndex) {
            // Toggle the checkbox
            lines[i] = lines[i].replace(
              /^(\s*[-*+]\s+)\[([ xX])\]/,
              `$1[${checked ? "x" : " "}]`,
            );
            onContentChange(lines.join("\n"), true, activePathRef.current || undefined);
            return;
          }
          currentCheckbox++;
        }
      }
    },
    [content, onContentChange],
  );

  const handleEndOfNoteAccept = useCallback(
    (path: string) => {
      const view = viewRef.current;
      if (!view) return;

      // Refocus editor to avoid browser scrolling to top due to widget DOM destruction focus loss
      view.focus();

      const targetName = path.split("/").pop()?.replace(/\.md$/, "") || path;
      const linkText = `[[${targetName}]]`;
      const currentDoc = view.state.doc.toString();
      const separator = currentDoc.endsWith("\n") ? "\n" : "\n\n";
      const insert = separator + linkText + "\n";

      view.dispatch({
        changes: { from: view.state.doc.length, to: view.state.doc.length, insert },
        selection: { anchor: view.state.doc.length + insert.length },
        scrollIntoView: true,
      });

      onAcceptSuggestion?.(path, "related");
    },
    [onAcceptSuggestion],
  );

  // Resizer logic
  const handleDrag = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    if (newWidth > 15 && newWidth < 85) setEditorWidth(newWidth);
  }, []);

  const stopDrag = useCallback(() => {
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", stopDrag);
    document.body.style.cursor = "default";
  }, [handleDrag]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.addEventListener("mousemove", handleDrag);
      document.addEventListener("mouseup", stopDrag);
      document.body.style.cursor = "ew-resize";
    },
    [handleDrag, stopDrag],
  );

  // Ctrl/Cmd + wheel to zoom editor/preview text size
  const handleZoomWheel = useCallback(
    (e: WheelEvent) => {
      if (settings?.quickFontSizeAdjustment === false) return;
      if (!(e.ctrlKey || e.metaKey)) return;

      const targetNode = e.target as Node | null;
      const targetElement =
        targetNode instanceof HTMLElement ? targetNode : null;
      if (isSpecialTab) {
        const isCanvasNoteBody = !!targetElement?.closest(".cv-embedded-md");
        if (!isCanvasNoteBody) return;
      }

      e.preventDefault();
      e.stopPropagation();

      let scope: "both" | "editor" | "preview" = "both";
      if (isSpecialTab) {
        scope = "preview";
      } else if (e.shiftKey) {
        if (targetNode && editorRef.current?.contains(targetNode)) {
          scope = "editor";
        } else if (targetNode && previewRef.current?.contains(targetNode)) {
          scope = "preview";
        } else {
          return;
        }
      }

      wheelRemainderRef.current += e.deltaY;
      const threshold = 80;
      const steps = Math.trunc(Math.abs(wheelRemainderRef.current) / threshold);
      if (steps === 0) return;

      const direction = wheelRemainderRef.current < 0 ? 1 : -1;
      onAdjustFontSize(direction * steps, scope);
      wheelRemainderRef.current -=
        Math.sign(wheelRemainderRef.current) * steps * threshold;
    },
    [onAdjustFontSize, isSpecialTab, settings?.quickFontSizeAdjustment],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleZoomWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleZoomWheel);
  }, [handleZoomWheel]);

  // Handle image paste from clipboard
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!onImagePaste || !viewRef.current) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const imagePath = await onImagePaste(file);
            if (imagePath) {
              // Insert markdown image syntax at cursor
              const view = viewRef.current;
              const pos = view.state.selection.main.head;
              const imageMarkdown = `![${file.name}](${imagePath})`;
              view.dispatch({
                changes: { from: pos, insert: imageMarkdown },
                selection: { anchor: pos + imageMarkdown.length },
              });
            }
          }
          break;
        }
      }
    },
    [onImagePaste],
  );

  // Handle image drop
  const handleDrop = useCallback(
    async (e: DragEvent) => {
      if (!onImagePaste || !viewRef.current) return;

      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          e.preventDefault();
          const imagePath = await onImagePaste(file);
          if (imagePath) {
            const view = viewRef.current;
            const pos = view.state.selection.main.head;
            const imageMarkdown = `![${file.name}](${imagePath})`;
            view.dispatch({
              changes: { from: pos, insert: imageMarkdown },
              selection: { anchor: pos + imageMarkdown.length },
            });
          }
          break;
        }
      }
    },
    [onImagePaste],
  );

  // Add paste/drop listeners to editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.addEventListener("paste", handlePaste as any);
    editor.addEventListener("drop", handleDrop as any);
    editor.addEventListener("dragover", (e) => e.preventDefault());

    return () => {
      editor.removeEventListener("paste", handlePaste as any);
      editor.removeEventListener("drop", handleDrop as any);
    };
  }, [handlePaste, handleDrop]);

  // Keep contentRef in sync
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Initialize/update CodeMirror
  useEffect(() => {
    if (isSpecialTab) {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
        obsidianEditorRef.current = null;
      }
      return;
    }
    if (!editorRef.current) return;

    // If view already exists, just update content
    if (viewRef.current) {
      // When Yjs CRDT collaboration is active, ytext is the authoritative source of truth.
      // Do not dispatch full-document replacements on content prop updates,
      // as ySync would interpret them as local user edits and duplicate content.
      if (yCollabExtensionRef.current) {
        return;
      }
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== content) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentDoc.length,
            insert: content,
          },
          annotations: [
            Transaction.userEvent.of("setContent"),
            Transaction.addToHistory.of(false),
          ],
        });
      }
      return;
    }

    // Create new editor view
    const cachedState = activePathRef.current ? getViewStateRef.current?.(activePathRef.current) : undefined;
    const initialCursor = cachedState?.cursor ?? 0;
    const initialScroll = cachedState?.scroll ?? 0;

    const state = EditorState.create({
      doc: content,
      selection: { anchor: Math.min(initialCursor, content.length) },
      extensions: [
        codeMirrorPluginExceptionSink,
        // Dynamically configured collaboration compartment (Yjs yCollab vs legacy history/cursors)
        collabCompartmentRef.current.of(
          yCollabExtensionRef.current
            ? [yCollabExtensionRef.current]
            : [history(), remoteCursorsExtension()]
        ),
        search(),
        highlightSelectionMatches(),
        editorKeymapCompartmentRef.current.of(getEditorKeymapExtensions(settings)),
        markdown(),
        editorSettingsCompartmentRef.current.of(getEditorSettingsExtensions(settings)),
        syntaxHighlighting(markdownHighlightStyle),
        linkAutocomplete(),
        linkAutocompleteTheme,
        editorBehaviorCompartmentRef.current.of(getEditorBehaviorExtensions(settings)),
        wikiLinkPlugin(onLinkClick),
        tagPlugin(),
        imageWidgetPlugin(handleOpenImageLightbox),
        // These fields are part of Obsidian's CM6 contract. Community editor
        // extensions (Advanced Canvas, Icon Folder, and others) read them
        // directly through state.field(...).
        editorInfoField,
        editorEditorField,
        editorLivePreviewField,
        vimCompartment.of([]),
        spellcheckCompartmentRef.current.of(
          EditorView.contentAttributes.of({ spellcheck: readSpellcheckSetting() ? "true" : "false" })
        ),
        pluginExtensionsCompartmentRef.current.of(
          getSafePluginEditorExtensions(),
        ),
        suggestionContentCompartmentRef.current.of(
          suggestionContentStateField({
            endSuggestions: endOfNoteSuggestions,
            nextStepSuggestions: renderedNextStepSuggestions,
            showEndSuggestions: renderedShowEndSuggestions,
            isActivelyTyping,
            isClosing: isClosingSuggestions,
            onEndAccept: handleEndOfNoteAccept,
            getStableEnd: () => stableEndRef.current,
            setStableEnd: (val) => { stableEndRef.current = val; },
            getPreviousContextVector: () => previousContextVectorRef.current,
            setPreviousContextVector: (val) => { previousContextVectorRef.current = val; },
            getIntentShiftUntil: () => intentShiftUntilRef.current,
            setIntentShiftUntil: (val) => { intentShiftUntilRef.current = val; },
          }),
        ),
        inlineAIPreviewField,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet && activePathRef.current) {
            onViewStateChangeRef.current?.(activePathRef.current, {
              cursor: update.state.selection.main.head,
            });
            try {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos).number;
              document.dispatchEvent(
                new CustomEvent("editor:cursor-line", {
                  detail: { line, path: activePathRef.current },
                })
              );
            } catch (err) {
              console.error("Error dispatching cursor-line event:", err);
            }
          }
          if ((update.selectionSet || update.docChanged || update.focusChanged) && activePathRef.current) {
            try {
              const pos = update.state.selection.main.head;
              const lineObj = update.state.doc.lineAt(pos);
              let headingLevel: number | null = null;
              const match = lineObj.text.match(/^(#{1,6})\s/);
              if (match) {
                headingLevel = match[1].length;
              }
              document.dispatchEvent(
                new CustomEvent("editor:format-state", {
                  detail: { path: activePathRef.current, heading: headingLevel },
                })
              );
            } catch (err) {
              // Ignore
            }
          }
          if (update.docChanged) {
            // A change is a "user edit" if it changed the doc AND is not
            // explicitly marked as remote (from collaboration) or a
            // programmatic content-sync ('setContent').  This catches
            // raw view.dispatch() calls from paste, drop, image insert,
            // and AI suggestions that lack userEvent annotations.
            const isRemoteOrSync = update.transactions.some(
              (tr) =>
                tr.annotation(Transaction.remote) ||
                tr.isUserEvent("setContent"),
            );
            const isUserEdit = !isRemoteOrSync;
            // Read from refs to avoid stale closures -- the CM view is
            // created once per tab and these callbacks change when the
            // collab space becomes active asynchronously.
            onContentChangeRef.current(update.state.doc.toString(), isUserEdit, activePathRef.current || undefined);
            if (isUserEdit) {
              // Record that a local edit just happened, so the content-sync
              // effect knows not to overwrite the CM doc with stale content.
              lastLocalEditTsRef.current = Date.now();

              // Extract granular operations for legacy collaboration broadcast.
              // Skip when Yjs CRDT is active -- Yjs handles update propagation
              // via its own doc.on('update') listener, not through extracted ops.
              if (!yCollabExtensionRef.current) {
                const collabOps = onCollabOperationsRef.current;
                const cid = localClientIdRef.current;
                if (collabOps && cid) {
                  const allOps = extractOperations(update.changes, cid, authManager.getUserId() || undefined);
                  if (allOps.length > 0) {
                    collabOps(allOps);
                  }
                }
              }

              markActiveTyping();
              markSectionPauseReady();
              setSectionRetryPending((pending) => {
                if (pending) {
                  setAllowForcedSectionMinimum(true);
                  return false;
                }
                setAllowForcedSectionMinimum(false);
                return pending;
              });
              const pressedEnter = didPressEnter(update);
              if (didCompleteSentenceOrParagraph(update)) {
                markFlowTrigger();
              }
              if (pressedEnter) {
                markSectionEnterTrigger();
              } else {
                setHasSectionEnterTrigger(false);
              }
            }
          }
          // Cursor/selection change detection for presence broadcast.
          // Only broadcast when the selection change was NOT caused by a remote
          // transaction -- otherwise we bounce cursor positions back to peers,
          // creating feedback loops.
          const cursorCb = onCursorChangeRef.current;
          if (update.selectionSet && cursorCb && !update.transactions.some(tr => tr.annotation(Transaction.remote))) {
            const sel = update.state.selection.main;
            cursorCb({ from: sel.from, to: sel.to });
          }
        }),
        EditorView.domEventHandlers({
          click(event, view) {
            const target = event.target as HTMLElement | null;
            const button = target?.closest<HTMLButtonElement>("[data-table-action][data-table-line]");
            if (!button) return false;
            event.preventDefault();
            event.stopPropagation();
            const action = button.dataset.tableAction as TableAction | undefined;
            const lineNumber = Number(button.dataset.tableLine);
            if ((action === "add-row-below" || action === "add-column-right") && Number.isFinite(lineNumber)) {
              applyTableAction(view, action, lineNumber);
              return true;
            }
            return false;
          },
        }),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "var(--editor-pane-font-size)",
            color: "var(--text-primary)",
            backgroundColor: "transparent",
            caretColor: "var(--editor-caret)",
          },
          ".cm-scroller": {
            overflowY: "auto",
            overflowX: "hidden",
            "--font-family": "var(--font-sans, Inter, system-ui, sans-serif)",
            "--font-mono": "var(--font-mono, monospace)",
            fontFamily: "var(--font-family)",
            lineHeight: "1.3 !important",
          },
          ".cm-content": {
            padding: "20px 40px",
            maxWidth: "var(--reading-view-width)",
            margin: "0 auto",
            caretColor: "var(--editor-caret)",
            lineHeight: "1.3 !important",
          },
          ".cm-line": {
            padding: "0 2px",
            borderRadius: "4px",
            caretColor: "var(--editor-caret)",
            lineHeight: "1.3 !important",
          },
          ".cm-line[class*='cm-heading-'] span": {
            fontFamily: "var(--font-family) !important",
            fontWeight: "700 !important",
          },
          ".cm-live-highlight, mark": {
            color: "#000000 !important",
          },
          ".cm-live-html-content *, .cm-live-highlight *, mark *": {
            color: "inherit !important",
            fontStyle: "inherit !important",
            fontWeight: "inherit !important",
            textDecoration: "inherit !important",
          },
          ".cm-heading-1": {
            paddingTop: "6px !important",
            paddingBottom: "2px !important",
          },
          ".cm-heading-2": {
            paddingTop: "5px !important",
            paddingBottom: "2px !important",
          },
          ".cm-heading-3": {
            paddingTop: "4px !important",
            paddingBottom: "1px !important",
          },
          ".cm-heading-4": {
            paddingTop: "3px !important",
            paddingBottom: "1px !important",
          },
          ".cm-heading-5": {
            paddingTop: "2px !important",
            paddingBottom: "1px !important",
          },
          ".cm-heading-6": {
            paddingTop: "2px !important",
            paddingBottom: "1px !important",
          },
          ".cm-cursorLayer .cm-cursor": {
            borderLeft: "2px solid var(--editor-caret)",
            maxHeight: "1.2em !important",
            animation: "smooth-cursor-blink 1s ease-in-out infinite !important",
            transition: "none !important",
          },
          ".cm-cursor": {
            maxHeight: "1.2em !important",
            animation: "smooth-cursor-blink 1s ease-in-out infinite !important",
            transition: "none !important",
          },
          ".cm-dropCursor": {
            borderLeft: "2px solid var(--editor-caret)",
            maxHeight: "1.2em !important",
          },
          ".cm-fatCursor": {
            backgroundColor: "var(--editor-caret)",
          },
          ".cm-activeLine": {
            backgroundColor: "var(--editor-active-line)",
          },
          ".cm-focused .cm-activeLine": {
            boxShadow: "inset 0 0 0 1px var(--editor-active-line-border)",
          },
          ".cm-selectionBackground": {
            backgroundColor: "var(--editor-selection)",
          },
          ".cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
          {
            backgroundColor: "var(--editor-selection-focused)",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
          },
          ".cm-wikilink": {
            color: "var(--editor-link)",
            textDecoration: "none",
            cursor: "pointer",
            transition: "color 0.2s",
            borderBottom: "1px dotted transparent",
          },
          ".cm-wikilink:hover": {
            color: "var(--editor-link-hover)",
            borderBottomColor: "var(--editor-link-hover)",
          },
          ".cm-tag-mark": {
            color: "var(--editor-tag)",
            backgroundColor: "var(--editor-tag-bg)",
            fontWeight: "600",
            borderRadius: "999px",
            padding: "0 5px",
          },
          ".cm-live-hidden-mark": {
            display: "inline-block",
            width: "0",
            overflow: "hidden",
            opacity: "0",
            pointerEvents: "none",
          },
          ".cm-live-strong": {
            fontWeight: "700",
            color: "var(--editor-emphasis)",
          },
          ".cm-live-emphasis": {
            fontStyle: "italic",
            color: "var(--editor-emphasis)",
          },
          ".cm-live-strike": {
            textDecoration: "line-through",
            color: "var(--editor-muted-token)",
          },
          ".cm-live-highlight": {
            backgroundColor: "#ffff00",
            borderRadius: "2px",
            padding: "0 2px",
            color: "#000000 !important",
          },
          ".cm-live-code": {
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--editor-code)",
            fontFamily: "var(--font-mono)",
            padding: "2px 6px",
            fontSize: "0.9em",
            border: "1px solid var(--border-subtle)",
          },
          ".cm-live-link, .cm-live-wikilink": {
            color: "var(--editor-link)",
            textDecoration: "none",
            borderBottom: "1px dotted transparent",
            cursor: "pointer",
          },
          ".cm-live-link:hover, .cm-live-wikilink:hover": {
            color: "var(--editor-link-hover)",
            borderBottomColor: "var(--editor-link-hover)",
          },
          ".cm-live-codeblock-line": {
            backgroundColor: "var(--bg-secondary)",
            color: "var(--editor-code)",
            fontFamily: "var(--font-mono)",
          },
          ".cm-live-codeblock-line.cm-line": {
            borderRadius: "0",
          },
          ".cm-live-table-wrapper": {
            width: "100%",
            overflowX: "auto",
            padding: "0",
            margin: "1.5rem 0",
          },
          ".cm-live-table": {
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-family)",
            fontSize: "var(--editor-pane-font-size)",
            color: "var(--text-primary)",
            border: "var(--table-border-width, 1px) solid var(--table-border-color, var(--border-medium))",
          },
          ".cm-live-table th, .cm-live-table td": {
            border: "var(--table-border-width, 1px) solid var(--table-border-color, var(--border-medium))",
            padding: "0.6rem 1rem",
            verticalAlign: "top",
          },
          ".cm-live-table th": {
            backgroundColor: "var(--table-header-background, var(--bg-tertiary))",
            color: "var(--table-header-color, var(--text-primary))",
            fontWeight: "600",
          },
          ".cm-live-table tr:nth-child(even) td": {
            backgroundColor: "var(--table-row-alt-background, var(--bg-secondary))",
          },
          ".cm-live-table-source-row": {
            backgroundColor: "color-mix(in_srgb,var(--bg-secondary)_30%,transparent)",
          },
          ".cm-live-table-source-separator": {
            color: "var(--editor-muted-token)",
            backgroundColor: "color-mix(in_srgb,var(--bg-secondary)_45%,transparent)",
          },
          ".cm-live-table-controls": {
            display: "flex",
            justifyContent: "flex-end",
            gap: "6px",
            padding: "4px 0 8px",
          },
          ".cm-live-table-control": {
            cursor: "pointer",
            border: "1px solid var(--border-subtle)",
            borderRadius: "4px",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-secondary)",
            padding: "3px 7px",
            fontFamily: "var(--font-family)",
            fontSize: "11px",
            lineHeight: "1.2",
          },
          ".cm-live-table-control:hover": {
            backgroundColor: "var(--bg-hover)",
            color: "var(--text-primary)",
            borderColor: "var(--border-medium)",
          },
          ".cm-live-list-marker": {
            display: "inline-block",
            minWidth: "1.15em",
            color: "var(--text-secondary)",
            fontWeight: "600",
          },
          ".cm-live-task-checkbox": {
            WebkitAppearance: "none",
            appearance: "none",
            width: "1.15em",
            height: "1.15em",
            border: "1px solid var(--border-medium)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--bg-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            margin: "0 0.4em 0 0",
            verticalAlign: "middle",
            cursor: "default",
            opacity: "1",
            pointerEvents: "none",
            transition: "background-color 120ms ease-in-out, border-color 120ms ease-in-out",
          },
          ".cm-live-task-checkbox:checked": {
            backgroundColor: "var(--color-accent)",
            borderColor: "var(--color-accent)",
          },
          ".cm-live-task-checkbox::after": {
            content: "\"\"",
            position: "absolute",
            top: "45%",
            left: "50%",
            width: "0.32em",
            height: "0.62em",
            borderStyle: "solid",
            borderColor: "var(--text-on-accent)",
            borderWidth: "0 2.2px 2.2px 0",
            transform: "translate(-50%, -50%) rotate(45deg) scale(0)",
            transformOrigin: "center",
            transition: "transform 120ms ease-out",
          },
          ".cm-live-task-checkbox:checked::after": {
            transform: "translate(-50%, -50%) rotate(45deg) scale(1.1)",
          },
          ".cm-live-list-line": {
            position: "relative",
          },
          ".cm-live-task-line": {
            position: "relative",
          },
          ".cm-live-indent-1": { paddingLeft: "1.5em" },
          ".cm-live-indent-2": { paddingLeft: "3.0em" },
          ".cm-live-indent-3": { paddingLeft: "4.5em" },
          ".cm-live-indent-4": { paddingLeft: "6.0em" },
          ".cm-live-indent-5": { paddingLeft: "7.5em" },
          ".cm-live-indent-6": { paddingLeft: "9.0em" },
          ".cm-live-blockquote-line": {
            borderLeft: "3px solid var(--border-medium)",
            color: "var(--text-secondary)",
            paddingLeft: "0.8em",
            fontStyle: "italic",
          },
          ".cm-searchMatch": {
            backgroundColor: "var(--editor-search-match)",
            borderBottom: "1px solid var(--editor-search-match-border)",
          },
          ".cm-searchMatch-selected": {
            backgroundColor: "var(--editor-search-active)",
            border: "1px solid var(--editor-search-active-border)",
            borderRadius: "1px",
          },
          ".cm-inline-ai-removed": {
            backgroundColor: "color-mix(in srgb, var(--danger, #ef4444) 24%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--danger, #ef4444) 65%, transparent)",
            color: "var(--text-primary)",
            textDecoration: "line-through",
            textDecorationColor: "color-mix(in srgb, var(--danger, #ef4444) 75%, transparent)",
            borderRadius: "2px",
          },
          ".cm-inline-ai-insert": {
            display: "inline",
            padding: "0 2px",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            borderRadius: "2px",
            backgroundColor: "rgba(34, 197, 94, 0.24)",
            color: "#bbf7d0",
            fontFamily: "var(--font-family)",
            lineHeight: "1.3 !important",
          },
          ".cm-collab-cursor-wrapper": {
            position: "relative",
            display: "inline-block",
            width: "0",
            height: "0",
            verticalAlign: "text-top",
            pointerEvents: "none",
            userSelect: "none",
          },
          ".cm-collab-cursor": {
            position: "absolute",
            top: "0",
            left: "-1px",
            width: "0",
            height: "1.2em",
            pointerEvents: "none",
            zIndex: "10",
          },
          ".cm-collab-cursor-label": {
            position: "absolute",
            bottom: "100%",
            left: "-1px",
            transform: "translateY(-2px)",
            whiteSpace: "nowrap",
            fontSize: "10px",
            fontWeight: "600",
            lineHeight: "1",
            color: "#ffffff",
            padding: "2px 6px",
            borderRadius: "4px 4px 4px 0",
            pointerEvents: "none",
            zIndex: "11",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          },
          ".cm-collab-selection": {
            borderRadius: "2px",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    const obsidianEditor = new ObsidianEditor(view);
    obsidianEditorRef.current = obsidianEditor;
    syncObsidianEditorContext();
    const handleEditorFocusIn = () => {
      const workspace = (window as any).__oo_app?.workspace;
      const mainLeaf = workspace?.getMainLeaf?.();
      if (mainLeaf && workspace?.activeLeaf !== mainLeaf) {
        workspace.setActiveLeaf(mainLeaf);
      }
    };
    editorRef.current?.addEventListener('focusin', handleEditorFocusIn);
    if (initialScroll > 0) {
      setTimeout(() => {
        if (view.scrollDOM) {
          view.scrollDOM.scrollTop = initialScroll;
        }
      }, 0);
    }
    toggleVimMode(view, readVimModeSetting());
    onEditorViewReady?.(view);
    setEditorMountTick((tick) => tick + 1);

    // Broadcast initial cursor position so remote users see our cursor
    // immediately without waiting for a manual selection change.
    const cursorCb = onCursorChangeRef.current;
    if (cursorCb) {
      const sel = view.state.selection.main;
      cursorCb({ from: sel.from, to: sel.to });
    }

    return () => {
      const obsidianApp = (window as any).__oo_app;
      if (obsidianApp?.workspace?.activeEditor?.editor === obsidianEditor) {
        obsidianApp.workspace.activeEditor = null;
      }
      view.destroy();
      viewRef.current = null;
      obsidianEditorRef.current = null;
      onEditorViewReady?.(null);
    };
  }, [activePath, isSpecialTab, readOnly, syncObsidianEditorContext]); // Recreate on file switches so undo history stays file-local.

  useEffect(() => {
    const applyPluginExtensions = () => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: pluginExtensionsCompartmentRef.current.reconfigure(
          getSafePluginEditorExtensions(),
        ),
      });
    };
    window.addEventListener('obsidian:editor-extensions-changed', applyPluginExtensions);
    return () => window.removeEventListener('obsidian:editor-extensions-changed', applyPluginExtensions);
  }, []);

  useEffect(() => {
    if (isSpecialTab) return;

    const applyVimSetting = (enabled: boolean) => {
      if (!viewRef.current) return;
      toggleVimMode(viewRef.current, enabled);
    };

    applyVimSetting(readVimModeSetting());

    const handleVimSettingChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;
      applyVimSetting(!!customEvent.detail?.enabled);
    };

    window.addEventListener(
      "oo:vim-setting-change",
      handleVimSettingChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        "oo:vim-setting-change",
        handleVimSettingChange as EventListener,
      );
    };
  }, [isSpecialTab, readVimModeSetting]);

  useEffect(() => {
    if (isSpecialTab) return;

    const applySpellcheckSetting = (enabled: boolean) => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: spellcheckCompartmentRef.current.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: enabled ? "true" : "false" })
        ),
      });
    };

    applySpellcheckSetting(readSpellcheckSetting());

    const handleSpellcheckSettingChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;
      applySpellcheckSetting(!!customEvent.detail?.enabled);
    };

    window.addEventListener(
      "oo:spellcheck-setting-change",
      handleSpellcheckSettingChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        "oo:spellcheck-setting-change",
        handleSpellcheckSettingChange as EventListener,
      );
    };
  }, [isSpecialTab, readSpellcheckSetting]);

  useEffect(() => {
    if (isSpecialTab || !viewRef.current) return;

    viewRef.current.dispatch({
      effects: editorSettingsCompartmentRef.current.reconfigure(
        getEditorSettingsExtensions(settings),
      ),
    });
  }, [
    isSpecialTab,
    settings?.showLineNumbers,
    settings?.wordWrap,
    settings?.tabSize,
    settings?.rightToLeft,
    settings?.indentationGuides,
  ]);

  useEffect(() => {
    if (isSpecialTab || !viewRef.current) return;

    viewRef.current.dispatch({
      effects: [
        editorKeymapCompartmentRef.current.reconfigure(
          getEditorKeymapExtensions(settings),
        ),
        editorBehaviorCompartmentRef.current.reconfigure(
          getEditorBehaviorExtensions(settings),
        ),
      ],
    });
  }, [
    isSpecialTab,
    settings?.indentUsingTabs,
    settings?.autoPairBrackets,
    settings?.autoPairMarkdown,
    settings?.foldHeading,
    settings?.defaultEditingMode,
  ]);

  useEffect(() => {
    if (isSpecialTab || !viewRef.current) return;

    viewRef.current.dispatch({
      effects: suggestionContentCompartmentRef.current.reconfigure(
        suggestionContentStateField({
          endSuggestions: endOfNoteSuggestions,
          nextStepSuggestions: renderedNextStepSuggestions,
          showEndSuggestions: renderedShowEndSuggestions,
          isActivelyTyping,
          isClosing: isClosingSuggestions,
          onEndAccept: handleEndOfNoteAccept,
          getStableEnd: () => stableEndRef.current,
          setStableEnd: (val) => { stableEndRef.current = val; },
          getPreviousContextVector: () => previousContextVectorRef.current,
          setPreviousContextVector: (val) => { previousContextVectorRef.current = val; },
          getIntentShiftUntil: () => intentShiftUntilRef.current,
          setIntentShiftUntil: (val) => { intentShiftUntilRef.current = val; },
        }),
      ),
    });
  }, [
    didPressEnter,
    endOfNoteSuggestions,
    renderedNextStepSuggestions,
    renderedShowEndSuggestions,
    isClosingSuggestions,
    handleEndOfNoteAccept,
    isActivelyTyping,
    isSpecialTab,
  ]);

  // Update content when it changes externally (tab switch or remote broadcast).
  // CRITICAL: We must NOT replace the CM doc if the change originated from a
  // local user edit.  The debounced `content` prop always lags behind the
  // real CM document by up to 250ms. Without this guard the effect would
  // overwrite the document with stale content, erasing characters the user
  // typed since the last debounce flush (the "auto-backspace" bug).
  useEffect(() => {
    if (isSpecialTab) return;
    if (!viewRef.current) return;

    // When Yjs CRDT collaboration is active, ytext is the authoritative source of truth.
    // Do not dispatch full-document replacements on content prop updates.
    if (yCollabExtensionRef.current) {
      return;
    }

    // If the user edited locally very recently, the content prop is stale.
    // Skip the full-doc replace to avoid clobbering ongoing typing.
    const msSinceLocalEdit = Date.now() - lastLocalEditTsRef.current;
    if (msSinceLocalEdit < 500) return;

    const currentDoc = viewRef.current.state.doc.toString();
    if (currentDoc !== content) {
      const newContent = content || "";
      // Preserve cursor position: clamp to new document length
      const oldSel = viewRef.current.state.selection;
      const maxPos = newContent.length;
      const clampedAnchor = Math.min(oldSel.main.anchor, maxPos);
      const clampedHead = Math.min(oldSel.main.head, maxPos);

      viewRef.current.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: newContent },
        selection: { anchor: clampedAnchor, head: clampedHead },
        annotations: [
          Transaction.remote.of(true),
          Transaction.userEvent.of("setContent"),
          Transaction.addToHistory.of(false),
        ],
      });
    }
  }, [content, isSpecialTab]);

  useEffect(() => {
    if (isSpecialTab || !activePath || pendingViewStateRestorePathRef.current !== activePath) return;
    const view = viewRef.current;
    if (!view) return;
    if (content.length === 0 && view.state.doc.length === 0) return;

    const cachedState = getViewStateRef.current?.(activePath);
    const cursor = Math.min(cachedState?.cursor ?? 0, view.state.doc.length);
    view.dispatch({
      selection: { anchor: cursor },
    });

    const restoreScroll = cachedState?.scroll ?? 0;
    const rafId = window.requestAnimationFrame(() => {
      if (activePathRef.current === activePath && view.scrollDOM) {
        view.scrollDOM.scrollTop = restoreScroll;
      }
    });
    pendingViewStateRestorePathRef.current = null;

    return () => window.cancelAnimationFrame(rafId);
  }, [activePath, content, isSpecialTab]);

  // Push remote cursor presence data into CodeMirror state
  useEffect(() => {
    if (!viewRef.current) return;
    const localUserId = authManager.getUserId();
    const visibleRemoteCursors = (remoteCursors || []).filter((cursor) => {
      if (activePath && cursor.file_path !== activePath) return false;
      if (cursor.client_id && localClientId && cursor.client_id === localClientId) return false;
      if (!cursor.client_id && localUserId && cursor.user_id === localUserId) return false;
      return true;
    });
    viewRef.current.dispatch({
      effects: setCursorsEffect.of(visibleRemoteCursors),
    });
  }, [activePath, localClientId, remoteCursors]);

  // Handle custom search / format events from Ribbon, toolbar, or App
  useEffect(() => {
    if (isSpecialTab) return;
    const handleOpenSearch = () => {
      setIsSearchOpen(true);
    };

    const wrapSelection = (before: string, after: string = before, placeholder = "text") => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      const insert = selected
        ? `${before}${selected}${after}`
        : `${before}${placeholder}${after}`;
      const cursorFrom = from + before.length;
      const cursorTo = selected
        ? from + before.length + selected.length
        : from + before.length + placeholder.length;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursorFrom, head: cursorTo },
      });
      view.focus();
    };

    const prefixLine = (prefix: string | null) => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);

      const isHeadingCmd = prefix === null || prefix.startsWith("#");

      if (isHeadingCmd) {
        const headingMatch = line.text.match(/^(#{1,6}\s+)/);
        let cleanText = line.text;
        let offset = 0;
        if (headingMatch) {
          cleanText = line.text.substring(headingMatch[1].length);
          offset = -headingMatch[1].length;
        }

        const newText = prefix ? `${prefix}${cleanText}` : cleanText;
        const newOffset = prefix ? prefix.length : 0;

        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: Math.max(line.from, from + offset + newOffset) },
        });
      } else if (prefix) {
        const already = line.text.startsWith(prefix);
        if (already) {
          view.dispatch({
            changes: { from: line.from, to: line.from + prefix.length, insert: "" },
          });
        } else {
          view.dispatch({
            changes: { from: line.from, insert: prefix },
            selection: { anchor: from + prefix.length },
          });
        }
      }
      view.focus();
    };

    const handleFormat = (e: Event) => {
      if (!isFocusedRef.current) return;
      if (viewModeRef.current === "preview" || readOnlyRef.current) return;

      const command = (e as CustomEvent<{ command: string }>).detail?.command;
      if (!command) return;
      switch (command) {
        case "bold":
          wrapSelection("**", "**", "bold text");
          break;
        case "italic":
          wrapSelection("*", "*", "italic text");
          break;
        case "underline":
          wrapSelection("<u>", "</u>", "underlined");
          break;
        case "strikethrough":
          wrapSelection("~~", "~~", "struck");
          break;
        case "highlight":
          wrapSelection("==", "==", "highlight");
          break;
        case "code":
          wrapSelection("`", "`", "code");
          break;
        case "link":
          wrapSelection("[", "](url)", "link text");
          break;
        case "image": {
          const view = viewRef.current;
          if (!view) break;

          (async () => {
            try {
              const result = await getAPI().showOpenDialog({
                title: "Choose Images",
                buttonLabel: "Insert",
                properties: ["openFile", "multiSelections"],
                filters: [
                  { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }
                ]
              });

              if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return;
              }

              let insertionText = "";
              for (const filePath of result.filePaths) {
                const fileName = filePath.split(/[/\\]/).pop() || "image.png";
                
                // Read binary data from the file path
                const binaryData = await getAPI().readBinary(filePath);
                
                // Convert Uint8Array to base64 (fast, native, memory-efficient FileReader)
                const base64Data = await new Promise<string>((resolve, reject) => {
                  const blob = new Blob([binaryData as any]);
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const res = reader.result as string;
                    const base64 = res.split(",")[1];
                    resolve(base64);
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
                
                // Save image with content-hash deduplication
                const saveResult = await getAPI().saveImageDedup(fileName, base64Data);
                
                // Extract filename without extension for alt text
                const extIdx = fileName.lastIndexOf(".");
                const altText = extIdx !== -1 ? fileName.substring(0, extIdx) : fileName;
                
                insertionText += `![${altText}](${saveResult.relativePath})\n`;
              }

              const { from, to } = view.state.selection.main;
              view.dispatch({
                changes: { from, to, insert: insertionText },
                selection: { anchor: from + insertionText.length }
              });
              view.focus();
            } catch (err) {
              console.error("Failed to select/import images:", err);
            }
          })();
          break;
        }
        case "heading-1":
          prefixLine("# ");
          break;
        case "heading-2":
          prefixLine("## ");
          break;
        case "heading-3":
          prefixLine("### ");
          break;
        case "heading-4":
          prefixLine("#### ");
          break;
        case "heading-normal":
          prefixLine(null);
          break;
        case "bullet-list":
          prefixLine("- ");
          break;
        case "numbered-list":
          prefixLine("1. ");
          break;
        case "blockquote":
          prefixLine("> ");
          break;
        case "font-size-small":
          wrapSelection('<span style="font-size: 0.85em;">', "</span>", "small text");
          break;
        case "font-size-normal":
          wrapSelection('<span style="font-size: 1.0em;">', "</span>", "normal text");
          break;
        case "font-size-medium":
          wrapSelection('<span style="font-size: 1.2em;">', "</span>", "medium text");
          break;
        case "font-size-large":
          wrapSelection('<span style="font-size: 1.5em;">', "</span>", "large text");
          break;
        case "font-size-xl":
          wrapSelection('<span style="font-size: 2.0em;">', "</span>", "extra large text");
          break;
        case "text-color":
          wrapSelection('<span style="color: #ef4444;">', "</span>", "colored text");
          break;
        case "align-left":
          wrapSelection('<div align="left">', "</div>", "left aligned text");
          break;
        case "align-center":
          wrapSelection('<div align="center">', "</div>", "centered text");
          break;
        case "align-right":
          wrapSelection('<div align="right">', "</div>", "right aligned text");
          break;
        case "align-justify":
          wrapSelection('<div align="justify">', "</div>", "justified text");
          break;
        case "clear-format": {
          const view = viewRef.current;
          if (!view) break;
          const { from, to } = view.state.selection.main;
          const selected = view.state.sliceDoc(from, to);
          if (selected) {
            const cleared = selected
              .replace(/\*\*([^*]+)\*\*/g, "$1")
              .replace(/\*([^*]+)\*/g, "$1")
              .replace(/~~([^~]+)~~/g, "$1")
              .replace(/==([^=]+)==/g, "$1")
              .replace(/<u>([^<]+)<\/u>/g, "$1")
              .replace(/`([^`]+)`/g, "$1")
              .replace(/<span[^>]*>([^<]+)<\/span>/g, "$1")
              .replace(/<div[^>]*>([^<]+)<\/div>/g, "$1")
              .replace(/<p[^>]*>([^<]+)<\/p>/g, "$1");
            view.dispatch({
              changes: { from, to, insert: cleared },
              selection: { anchor: from, head: from + cleared.length },
            });
          }
          view.focus();
          break;
        }
        case "table": {
          const view = viewRef.current;
          if (!view) break;
          const { from, to } = view.state.selection.main;
          const table =
            "\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n";
          view.dispatch({
            changes: { from, to, insert: table },
            selection: { anchor: from + table.length },
          });
          view.focus();
          break;
        }
        default:
          break;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener(
      "editor:open-search",
      handleOpenSearch as EventListener,
    );
    document.addEventListener("editor:format", handleFormat as EventListener);
    document.addEventListener("keydown", handleKeyDown);

    const handleGotoLine = (e: any) => {
      const line = e.detail;
      const view = viewRef.current;
      if (view && typeof line === "number") {
        try {
          const safeLine = Math.max(1, Math.min(line, view.state.doc.lines));
          const linePos = view.state.doc.line(safeLine);
          view.dispatch({
            selection: { anchor: linePos.from, head: linePos.from },
            scrollIntoView: true,
          });
          view.focus();
        } catch (err) {
          console.error("Error scrolling to line:", err);
        }
      }
    };

    document.addEventListener(
      "editor:goto-line",
      handleGotoLine as EventListener,
    );

    return () => {
      document.removeEventListener(
        "editor:open-search",
        handleOpenSearch as EventListener,
      );
      document.removeEventListener("editor:format", handleFormat as EventListener);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener(
        "editor:goto-line",
        handleGotoLine as EventListener,
      );
    };
  }, [isSpecialTab]);

  useEffect(() => {
    if (isSpecialTab || !activeTabId) return;

    const handleHighlightText = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string; text: string }>;
      const { path, text } = customEvent.detail;
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (activeTab && activeTab.path === path && viewRef.current && text) {
        const docString = viewRef.current.state.doc.toString();
        const index = docString.indexOf(text);
        if (index !== -1) {
          viewRef.current.dispatch({
            selection: { anchor: index, head: index + text.length },
            scrollIntoView: true,
          });
          viewRef.current.focus();
        } else {
          const indexLower = docString.toLowerCase().indexOf(text.toLowerCase());
          if (indexLower !== -1) {
            viewRef.current.dispatch({
              selection: { anchor: indexLower, head: indexLower + text.length },
              scrollIntoView: true,
            });
            viewRef.current.focus();
          }
        }
      }
    };

    document.addEventListener("editor:highlight-text", handleHighlightText as EventListener);
    return () => {
      document.removeEventListener("editor:highlight-text", handleHighlightText as EventListener);
    };
  }, [activeTabId, tabs, isSpecialTab]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const app = (window as any).__oo_app;
    if (!app) return;

    const getSettings = () => {
      try {
        const saved = localStorage.getItem("openonyx-settings");
        if (saved) return JSON.parse(saved);
      } catch (err) { }
      return null;
    };

    const toggleInlineFormat = (prefix: string, suffix: string = prefix) => {
      const view = viewRef.current;
      if (!view) return;
      const state = view.state;
      const main = state.selection.main;
      const selectedText = state.sliceDoc(main.from, main.to);
      const isWrapped = selectedText.startsWith(prefix) && selectedText.endsWith(suffix);

      let newText = '';
      let newAnchor = main.from;
      let newHead = main.to;

      if (isWrapped) {
        newText = selectedText.slice(prefix.length, selectedText.length - suffix.length);
        newAnchor = main.from;
        newHead = main.to - prefix.length - suffix.length;
      } else {
        newText = prefix + selectedText + suffix;
        newAnchor = main.from + prefix.length;
        newHead = main.to + prefix.length;
      }

      view.dispatch({
        changes: { from: main.from, to: main.to, insert: newText },
        selection: { anchor: isWrapped ? main.from : newAnchor, head: isWrapped ? newHead : newHead }
      });
      view.focus();
    };

    const toggleBlockFormat = (blockPrefix: string) => {
      const view = viewRef.current;
      if (!view) return;
      const state = view.state;
      const main = state.selection.main;
      const line = state.doc.lineAt(main.from);
      const lineText = line.text;
      const hasPrefix = lineText.startsWith(blockPrefix);

      let newText = '';
      if (hasPrefix) {
        newText = lineText.slice(blockPrefix.length);
      } else {
        newText = blockPrefix + lineText;
      }

      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newText },
        selection: { anchor: Math.max(line.from, main.from + (hasPrefix ? -blockPrefix.length : blockPrefix.length)) }
      });
      view.focus();
    };

    const insertContent = (content: string, cursorOffset: number = 0) => {
      const view = viewRef.current;
      if (!view) return;
      const main = view.state.selection.main;

      view.dispatch({
        changes: { from: main.from, to: main.to, insert: content },
        selection: { anchor: main.from + cursorOffset }
      });
      view.focus();
    };

    const addLink = async () => {
      const view = viewRef.current;
      if (!view) return;
      const settings = getSettings();
      const useWikiLinks = settings ? settings.useWikiLinks !== false : true;
      const main = view.state.selection.main;
      const selectedText = view.state.sliceDoc(main.from, main.to);

      let clipboardText = '';
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (err) { }

      const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(clipboardText.trim());

      let insertText = '';
      let newAnchor = main.from;
      if (isUrl) {
        insertText = `[${selectedText}](${clipboardText.trim()})`;
        newAnchor = main.from + insertText.length;
      } else if (useWikiLinks) {
        insertText = `[[${selectedText}]]`;
        newAnchor = main.from + insertText.length;
      } else {
        insertText = `[${selectedText}]()`;
        newAnchor = main.from + selectedText.length + 3;
      }

      view.dispatch({
        changes: { from: main.from, to: main.to, insert: insertText },
        selection: { anchor: newAnchor }
      });
      view.focus();
    };

    const addExternalLink = async () => {
      const view = viewRef.current;
      if (!view) return;
      const main = view.state.selection.main;
      const selectedText = view.state.sliceDoc(main.from, main.to);

      let clipboardText = '';
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (err) { }

      const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(clipboardText.trim());

      let insertText = '';
      let newAnchor = main.from;
      if (isUrl) {
        insertText = `[${selectedText}](${clipboardText.trim()})`;
        newAnchor = main.from + insertText.length;
      } else {
        insertText = `[${selectedText}]()`;
        newAnchor = main.from + selectedText.length + 3;
      }

      view.dispatch({
        changes: { from: main.from, to: main.to, insert: insertText },
        selection: { anchor: newAnchor }
      });
      view.focus();
    };

    const searchSelection = () => {
      if (!selection) return;
      const event = new CustomEvent('oo:global-search', {
        detail: {
          query: selection,
          mode: 'search'
        }
      });
      window.dispatchEvent(event);
    };

    const extractSelection = () => {
      const view = viewRef.current;
      if (!view || !selection) return;

      const event = new CustomEvent('oo:show-prompt', {
        detail: {
          title: 'Extract Selection to Note',
          message: 'Enter a name for the new note:',
          defaultValue: '',
          onConfirm: async (fileName: string) => {
            if (!fileName || !fileName.trim()) return;
            const cleanName = fileName.trim();
            const notePath = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;

            try {
              await getAPI().createFile(notePath, selection);

              window.dispatchEvent(new CustomEvent('oo:refresh-file-tree'));

              const main = view.state.selection.main;
              const linkText = `[[${cleanName}]]`;
              view.dispatch({
                changes: { from: main.from, to: main.to, insert: linkText },
                selection: { anchor: main.from + linkText.length }
              });
              view.focus();
            } catch (err) {
              console.error('Failed to extract selection:', err);
            }
          }
        }
      });
      window.dispatchEvent(event);
    };

    const menu = new Menu();

    const findLinkOrEmbedAtCursor = (lineText: string, posInLine: number) => {
      const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
      let match;
      while ((match = mdLinkRegex.exec(lineText)) !== null) {
        const start = match.index;
        const end = mdLinkRegex.lastIndex;
        if (posInLine >= start && posInLine <= end) {
          return {
            type: 'md-link',
            text: match[0],
            label: match[1],
            url: match[2],
            start,
            end
          };
        }
      }

      const iframeRegex = /<iframe[^>]+src=(["'])(.*?)\1[^>]*>.*?<\/iframe>/gi;
      iframeRegex.lastIndex = 0;
      while ((match = iframeRegex.exec(lineText)) !== null) {
        const start = match.index;
        const end = iframeRegex.lastIndex;
        if (posInLine >= start && posInLine <= end) {
          return {
            type: 'iframe',
            text: match[0],
            url: match[2],
            start,
            end
          };
        }
      }

      const urlRegex = /https?:\/\/[^\s\)\>]+/g;
      while ((match = urlRegex.exec(lineText)) !== null) {
        const start = match.index;
        const end = urlRegex.lastIndex;
        if (posInLine >= start && posInLine <= end) {
          return {
            type: 'raw-url',
            text: match[0],
            url: match[0],
            start,
            end
          };
        }
      }

      return null;
    };

    const cmView = viewRef.current;
    let detected = null;
    let targetFrom = 0;
    let targetTo = 0;

    if (cmView) {
      const state = cmView.state;
      const main = state.selection.main;
      const line = state.doc.lineAt(main.from);
      const lineText = line.text;
      const posInLine = main.from - line.from;

      if (!main.empty) {
        const selectionText = state.sliceDoc(main.from, main.to).trim();
        const mdLinkMatch = selectionText.match(/^\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/i);
        if (mdLinkMatch) {
          detected = {
            type: 'md-link',
            text: selectionText,
            label: mdLinkMatch[1],
            url: mdLinkMatch[2]
          };
          targetFrom = main.from;
          targetTo = main.to;
        } else {
          const iframeMatch = selectionText.match(/^<iframe[^>]+src=(["'])(.*?)\1[^>]*>.*?<\/iframe>$/i);
          if (iframeMatch) {
            detected = {
              type: 'iframe',
              text: selectionText,
              url: iframeMatch[2]
            };
            targetFrom = main.from;
            targetTo = main.to;
          } else {
            const urlMatch = selectionText.match(/^https?:\/\/[^\s\)\>]+$/i);
            if (urlMatch) {
              detected = {
                type: 'raw-url',
                text: selectionText,
                url: selectionText
              };
              targetFrom = main.from;
              targetTo = main.to;
            }
          }
        }
      } else {
        const cursorDetect = findLinkOrEmbedAtCursor(lineText, posInLine);
        if (cursorDetect) {
          detected = cursorDetect;
          targetFrom = line.from + cursorDetect.start;
          targetTo = line.from + cursorDetect.end;
        }
      }
    }

    if (detected && cmView) {
      if (detected.type === 'md-link') {
        menu.addItem((item: any) =>
          item
            .setTitle('Convert link to iframe embed')
            .setIcon('video')
            .onClick(() => {
              const replacement = `<iframe src="${detected.url}"></iframe>`;
              cmView.dispatch({
                changes: { from: targetFrom, to: targetTo, insert: replacement },
                selection: { anchor: targetFrom + replacement.length }
              });
              cmView.focus();
            })
        );
        menu.addSeparator();
      } else if (detected.type === 'iframe') {
        menu.addItem((item: any) =>
          item
            .setTitle('Convert embed to text link')
            .setIcon('link')
            .onClick(() => {
              const domain = getDisplayDomain(detected.url);
              const replacement = `[${domain}](${detected.url})`;
              cmView.dispatch({
                changes: { from: targetFrom, to: targetTo, insert: replacement },
                selection: { anchor: targetFrom + replacement.length }
              });
              cmView.focus();
            })
        );
        menu.addSeparator();
      } else if (detected.type === 'raw-url') {
        menu.addItem((item: any) =>
          item
            .setTitle('Convert URL to iframe embed')
            .setIcon('video')
            .onClick(() => {
              const replacement = `<iframe src="${detected.url}"></iframe>`;
              cmView.dispatch({
                changes: { from: targetFrom, to: targetTo, insert: replacement },
                selection: { anchor: targetFrom + replacement.length }
              });
              cmView.focus();
            })
        );
        menu.addItem((item: any) =>
          item
            .setTitle('Convert URL to text link')
            .setIcon('link')
            .onClick(() => {
              const domain = getDisplayDomain(detected.url);
              const replacement = `[${domain}](${detected.url})`;
              cmView.dispatch({
                changes: { from: targetFrom, to: targetTo, insert: replacement },
                selection: { anchor: targetFrom + replacement.length }
              });
              cmView.focus();
            })
        );
        menu.addSeparator();
      }
    }

    const selection = viewRef.current?.state.sliceDoc(
      viewRef.current.state.selection.main.from,
      viewRef.current.state.selection.main.to
    ) || '';
    const searchTitle = selection
      ? `Search for "${selection.length > 20 ? selection.substring(0, 20) + '...' : selection}"`
      : 'Search for selection';

    menu.addItem((item: any) => item.setTitle('Add link').setIcon('link').onClick(() => { void addLink(); }));
    menu.addItem((item: any) => item.setTitle('Add external link').setIcon('external-link').onClick(() => { void addExternalLink(); }));
    menu.addSeparator();
    menu.addItem((item: any) => item.setTitle(searchTitle).setIcon('search').onClick(() => { searchSelection(); }));
    menu.addItem((item: any) => item.setTitle('Extract current selection...').setIcon('scissors').onClick(() => { extractSelection(); }));
    menu.addSeparator();

    // Submenus for Format, Paragraph, Insert
    let formatItem: any;
    menu.addItem((item: any) => {
      item.setTitle('Format').setIcon('type');
      formatItem = item;
    });
    const formatSubmenu = formatItem.setSubmenu();
    formatSubmenu.addItem((subItem: any) => subItem.setTitle('Bold').setIcon('bold').onClick(() => toggleInlineFormat('**')));
    formatSubmenu.addItem((subItem: any) => subItem.setTitle('Italic').setIcon('italic').onClick(() => toggleInlineFormat('*')));
    formatSubmenu.addItem((subItem: any) => subItem.setTitle('Strikethrough').setIcon('strikethrough').onClick(() => toggleInlineFormat('~~')));
    formatSubmenu.addItem((subItem: any) => subItem.setTitle('Code').setIcon('code').onClick(() => toggleInlineFormat('`')));
    formatSubmenu.addItem((subItem: any) => subItem.setTitle('Highlighter').setIcon('pen-tool').onClick(() => toggleInlineFormat('==')));

    let paragraphItem: any;
    menu.addItem((item: any) => {
      item.setTitle('Paragraph').setIcon('align-left');
      paragraphItem = item;
    });
    const paragraphSubmenu = paragraphItem.setSubmenu();
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Heading 1').setIcon('heading').onClick(() => toggleBlockFormat('# ')));
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Heading 2').setIcon('heading').onClick(() => toggleBlockFormat('## ')));
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Heading 3').setIcon('heading').onClick(() => toggleBlockFormat('### ')));
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Heading 4').setIcon('heading').onClick(() => toggleBlockFormat('#### ')));
    paragraphSubmenu.addSeparator();
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Bullet list').setIcon('list').onClick(() => toggleBlockFormat('- ')));
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Numbered list').setIcon('list-ordered').onClick(() => toggleBlockFormat('1. ')));
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Todo list').setIcon('check-square').onClick(() => toggleBlockFormat('- [ ] ')));
    paragraphSubmenu.addSeparator();
    paragraphSubmenu.addItem((subItem: any) => subItem.setTitle('Blockquote').setIcon('quote').onClick(() => toggleBlockFormat('> ')));

    let insertItem: any;
    menu.addItem((item: any) => {
      item.setTitle('Insert').setIcon('plus-circle');
      insertItem = item;
    });
    const insertSubmenu = insertItem.setSubmenu();
    insertSubmenu.addItem((subItem: any) => subItem.setTitle('Callout').setIcon('info').onClick(() => insertContent('> [!NOTE]\n> ', 10)));
    insertSubmenu.addItem((subItem: any) => subItem.setTitle('Code block').setIcon('terminal').onClick(() => insertContent('\n```\n\n```\n', 5)));
    insertSubmenu.addItem((subItem: any) => subItem.setTitle('Table').setIcon('table').onClick(() => insertContent('\n| Header | Header |\n| --- | --- |\n| Cell | Cell |\n', 3)));
    insertSubmenu.addItem((subItem: any) => subItem.setTitle('Math block').setIcon('percent').onClick(() => insertContent('\n$$\n\n$$\n', 4)));
    insertSubmenu.addItem((subItem: any) => subItem.setTitle('Horizontal rule').setIcon('minus').onClick(() => insertContent('\n---\n', 5)));
    insertSubmenu.addItem((subItem: any) => {
      subItem.setTitle('Date / Time').setIcon('clock').onClick(() => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:mm
        insertContent(dateStr, dateStr.length);
      });
    });

    menu.addSeparator();

    menu.addItem((item: any) => item.setTitle('Cut').setIcon('scissors').onClick(() => { document.execCommand('cut'); }));
    menu.addItem((item: any) => item.setTitle('Copy').setIcon('copy').onClick(() => { document.execCommand('copy'); }));
    menu.addItem((item: any) => item.setTitle('Paste').setIcon('clipboard').onClick(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (viewRef.current) {
          const main = viewRef.current.state.selection.main;
          viewRef.current.dispatch({ changes: { from: main.from, to: main.to, insert: text }, selection: { anchor: main.from + text.length } });
        }
      } catch (err) { }
    }));
    menu.addItem((item: any) => item.setTitle('Paste as plain text').setIcon('clipboard-type').onClick(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (viewRef.current) {
          const main = viewRef.current.state.selection.main;
          viewRef.current.dispatch({ changes: { from: main.from, to: main.to, insert: text }, selection: { anchor: main.from + text.length } });
        }
      } catch (err) { }
    }));
    menu.addSeparator();
    menu.addItem((item: any) => item.setTitle('Select all').setIcon('check-square').onClick(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({ selection: { anchor: 0, head: viewRef.current.state.doc.length } });
      }
    }));

    // Sync real editor state to the API mock before triggering event
    const activeLeaf = app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType?.() === 'markdown' && viewRef.current) {
      // Ensure this leaf is considered the active one during the event trigger
      if (activeLeaf.view) {
        const view = activeLeaf.view;
        let editorDescriptor: PropertyDescriptor | undefined;
        for (let target: any = view; target && !editorDescriptor; target = Object.getPrototypeOf(target)) {
          editorDescriptor = Object.getOwnPropertyDescriptor(target, 'editor');
        }
        // Excalidraw subclasses the Markdown-compatible view surface but
        // exposes a getter-only editor property. Its own editor bridge must
        // remain untouched by the host Markdown context-menu bridge.
        if (editorDescriptor && !editorDescriptor.writable && !editorDescriptor.set) {
          menu.showAtMouseEvent(e.nativeEvent);
          return;
        }
        const cmView = viewRef.current;
        const state = cmView.state;

        // Sync the file info
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
          setWritableViewProperty(activeLeaf.view, 'file', new TFile(activeTab.path));
        }

        // Initialize editor mocks if needed
        const editor = view.editor || {};
        view.editor = editor;

        // Update the mock methods with real data from CodeMirror 6
        editor.getValue = () => state.doc.toString();
        editor.getSelection = () => state.sliceDoc(state.selection.main.from, state.selection.main.to);
        editor.somethingSelected = () => !state.selection.main.empty;
        editor.getCursor = () => {
          const pos = state.selection.main.head;
          const line = state.doc.lineAt(pos);
          return { line: line.number - 1, ch: pos - line.from };
        };
        editor.replaceSelection = (text: string) => {
          const main = state.selection.main;
          cmView.dispatch({
            changes: { from: main.from, to: main.to, insert: text },
            selection: { anchor: main.from + text.length }
          });
        };

        // Add more standard Obsidian editor methods for compatibility
        editor.getLine = (n: number) => state.doc.line(n + 1).text;
        editor.lineCount = () => state.doc.lines;
        editor.getDoc = () => editor;
        editor.cm = editor;

        // Ensure sourceMode shim is present as expected by many plugins
        view.sourceMode = view.sourceMode || {};
        view.sourceMode.cmEditor = editor;

        console.log(`[Editor] Triggering editor-menu for ${activeTab?.path}. Selection: "${editor.getSelection()}"`);
        app.workspace.trigger('editor-menu', menu, editor, view);
      }
    }

    menu.showAtMouseEvent(e.nativeEvent);
  }, [activeTabId, tabs]);

  const getClampedToolbarCoords = () => {
    if (!selectionRange) return { top: 0, left: 0 };
    const toolbarHeight = showPromptInput ? 84 : 40;
    const toolbarWidth = 400;

    const y = selectionRange.rect.top < (showPromptInput ? 110 : 70)
      ? selectionRange.rect.bottom + 8
      : selectionRange.rect.top - (showPromptInput ? 92 : 46);

    const minY = 50;
    const maxY = Math.max(minY, window.innerHeight - toolbarHeight - 40);
    const clampedY = Math.max(minY, Math.min(maxY, y));

    const x = selectionRange.rect.left + (selectionRange.rect.width / 2) - (toolbarWidth / 2);
    const minX = 10;
    const maxX = Math.max(minX, window.innerWidth - toolbarWidth - 10);
    const clampedX = Math.max(minX, Math.min(maxX, x));

    return {
      top: clampedY + window.scrollY,
      left: clampedX + window.scrollX
    };
  };

  const getClampedLoadingCoords = () => {
    if (!selectionRange) return { top: 0, left: 0 };
    const toolbarHeight = 40;
    const toolbarWidth = 200;

    const y = selectionRange.rect.top < 70
      ? selectionRange.rect.bottom + 8
      : selectionRange.rect.top - 46;

    const minY = 50;
    const maxY = Math.max(minY, window.innerHeight - toolbarHeight - 40);
    const clampedY = Math.max(minY, Math.min(maxY, y));

    const x = selectionRange.rect.left + (selectionRange.rect.width / 2) - (toolbarWidth / 2);
    const minX = 10;
    const maxX = Math.max(minX, window.innerWidth - toolbarWidth - 10);
    const clampedX = Math.max(minX, Math.min(maxX, x));

    return {
      top: clampedY + window.scrollY,
      left: clampedX + window.scrollX
    };
  };

  return (
    <>
      {pendingInlineEdit && createPortal(
        <div className={inlineAiDecisionFooterClass}>
          <button className={inlineAiDecisionButtonClass} onClick={discardPendingInlineEdit}>
            Deny
          </button>
          <button className={`${inlineAiDecisionButtonClass} ${inlineAiDecisionAcceptClass}`} onClick={applyPendingInlineEdit}>
            Accept
          </button>
        </div>,
        containerRef.current || document.body
      )}

      {selectionRange && !pendingInlineEdit && !isInlineQuerying && !explanation && createPortal(
        <div
          className={inlineAiToolbarClass}
          style={{
            position: "absolute",
            ...getClampedToolbarCoords(),
            zIndex: 5000,
          }}
          onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.classList.contains("inline-ai-prompt-input") ||
              target.closest(".inline-ai-prompt-input") ||
              target.classList.contains("inline-ai-prompt-submit") ||
              target.closest(".inline-ai-prompt-submit")
            ) {
              return;
            }
            e.preventDefault();
          }}
        >
          <div className={`${inlineAiButtonsRowClass}${showPromptInput ? ` ${inlineAiButtonsRowPromptClass}` : ""}`}>
            <button className={inlineAiButtonClass} onClick={() => handleInlineAction("rewrite")}>
              Rewrite
            </button>
            <button className={inlineAiButtonClass} onClick={() => handleInlineAction("expand")}>
              Expand
            </button>
            <button className={inlineAiButtonClass} onClick={() => handleInlineAction("simplify")}>
              Simplify
            </button>
            <button className={inlineAiButtonClass} onClick={() => handleInlineAction("explain")}>
              Explain
            </button>
            <button
              className={`${inlineAiButtonClass}${showPromptInput ? ` ${inlineAiButtonActiveClass}` : ""}`}
              onClick={() => setShowPromptInput(!showPromptInput)}
            >
              Prompt
            </button>
          </div>
          {showPromptInput && (
            <div className={inlineAiPromptRowClass}>
              <input
                type="text"
                className={inlineAiPromptInputClass}
                placeholder="Tell AI exactly what to do..."
                value={customPromptText}
                onChange={(e) => setCustomPromptText(e.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customPromptText.trim()) {
                    handleInlineAction("custom", customPromptText);
                  } else if (e.key === "Escape") {
                    window.getSelection()?.removeAllRanges();
                    setSelectionRange(null);
                    setShowPromptInput(false);
                    setCustomPromptText("");
                  }
                }}
                autoFocus
              />
              <button
                className={inlineAiPromptSubmitClass}
                onClick={() => handleInlineAction("custom", customPromptText)}
                disabled={!customPromptText.trim()}
              >
                Submit
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

      {isInlineQuerying && selectionRange && !explanation && createPortal(
        <div
          className={inlineAiLoadingClass}
          style={{
            position: "absolute",
            ...getClampedLoadingCoords(),
            zIndex: 5000,
          }}
        >
          <div className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-[var(--border-subtle)] border-t-[var(--text-muted)]" />
          <span>Processing selection...</span>
        </div>,
        document.body
      )}

      {explanation && explanationCoords && createPortal(
        <div
          className={inlineAiExplanationClass}
          style={{
            position: "absolute",
            top: explanationCoords.y,
            left: Math.max(10, explanationCoords.x - 150),
            zIndex: 5000,
          }}
        >
          <div className={inlineAiExplanationHeaderClass}>
            <span>Explanation</span>
            <button className={inlineAiExplanationCloseClass} onClick={() => setExplanation(null)}>
              <X size={12} />
            </button>
          </div>
          <div className={inlineAiExplanationBodyClass}>
            {explanation}
          </div>
        </div>,
        document.body
      )}

      {/* Inline annotation content */}
      {isInsightVisible && (
        <div className={editorAnnotationClass}>
          <div className={editorAnnotationHeaderClass}>
            <span className={editorAnnotationTitleClass}>
              <Lightbulb size={14} className="mr-1.5" />
              Note Insight
            </span>
            <div className={editorAnnotationActionsClass}>
              {annotation && !isGeneratingInsight && (
                <button
                  className={editorAnnotationIconBtnClass}
                  onClick={onGenerateInsight}
                  title="Regenerate Insight"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <button className={editorAnnotationIconBtnClass} onClick={() => toggleInsight(false)} title="Close Insight">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className={editorAnnotationTextClass}>
            {isGeneratingInsight ? (
              <span className={editorAnnotationLoadingClass}>
                <RefreshCw size={14} className="animate-spin" /> Generating insight...
              </span>
            ) : annotation ? (
              annotation
            ) : (
              <div className={editorAnnotationEmptyClass}>
                <span className={editorAnnotationEmptyTextClass}>No insight generated yet for this note.</span>
                <button
                  onClick={onGenerateInsight}
                  className={editorAnnotationGenerateClass}
                >
                  <Sparkles size={12} /> Generate Insight
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor & Preview Container */}
      <div
        className={editorContainerClass}
        ref={containerRef}
      >
        {isSpecialTab ? (
          <div
            style={{
              flex: 1,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {specialContent}
          </div>
        ) : (
          <>
            {/* VS Code-style Search/Replace Panel */}
            <SearchReplace
              getView={() => viewRef.current}
              isOpen={isSearchOpen}
              onClose={() => setIsSearchOpen(false)}
            />

            <div
              ref={editorRef}
              onContextMenu={handleContextMenu}
              style={{
                flex: viewMode === "split" ? `0 0 ${editorWidth}%` : 1,
                minWidth: 0,
                height: "100%",
                overflow: "auto",
                display:
                  viewMode === "editor" || viewMode === "split"
                    ? "block"
                    : "none",
                ...(settings?.backgroundImage ? {} : { backgroundColor: "var(--bg-primary)" }),
              }}
            />

            {viewMode === "split" && (
              <div className={resizerClass} onMouseDown={startDrag} />
            )}

            {(viewMode === "preview" || viewMode === "split") && (
              <div
                ref={previewRef}
                onContextMenu={handleContextMenu}
                style={{
                  flex:
                    viewMode === "split"
                      ? `0 0 calc(${100 - editorWidth}% - 4px)`
                      : 1,
                  minWidth: 0,
                  overflow: "auto",
                  height: "100%",
                  ...(settings?.backgroundImage ? {} : { backgroundColor: "var(--bg-primary)" }),
                }}
              >

                <MarkdownPreview
                  content={content}
                  onLinkClick={onLinkClick}
                  onCheckboxToggle={handleCheckboxToggle}
                  onEmbed={onGetNoteContent}
                  onGetLinkPreview={onGetNoteContent}
                  onImageClick={handleOpenImageLightbox}
                  theme={theme}
                  settings={settings}
                  onContentChange={(nextContent) => onContentChange(nextContent, true, activePathRef.current || undefined)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {imageLightbox && (
        <div
          className={editorLightboxBackdropClass}
          onClick={() => {
            setImageLightbox(null);
            setZoomScale(1);
            setPanOffset({ x: 0, y: 0 });
            setIsPanning(false);
          }}
        >
          <div
            ref={lightboxRef}
            className={editorLightboxModalClass}
            onClick={(e) => e.stopPropagation()}
            style={{ overflow: "hidden" }}
          >
            <button
              type="button"
              className={editorLightboxCloseClass}
              style={{ zIndex: 20 }}
              onClick={() => {
                setImageLightbox(null);
                setZoomScale(1);
                setPanOffset({ x: 0, y: 0 });
                setIsPanning(false);
              }}
              aria-label="Close image preview"
            >
              ×
            </button>
            <img
              src={imageLightbox.src}
              alt={imageLightbox.alt || "Image preview"}
              className={editorLightboxImageClass}
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                transition: isPanning ? "none" : "transform 0.15s ease-out",
                cursor: zoomScale > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in",
                userSelect: "none",
                maxHeight: "100%",
                maxWidth: "100%",
              }}
              onMouseDown={(e) => {
                if (zoomScale <= 1) return;
                e.preventDefault();
                setIsPanning(true);
                panStartRef.current = {
                  x: e.clientX - panOffset.x,
                  y: e.clientY - panOffset.y,
                };
              }}
              draggable={false}
            />
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-[var(--border-medium)] bg-[color-mix(in_srgb,var(--bg-elevated)_75%,transparent)] px-3 py-1.5 backdrop-blur-[8px]"
              style={{ boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)" }}
            >
              <button
                type="button"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setZoomScale((s) => Math.max(0.5, s - 0.25));
                }}
                title="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="text-[12px] font-semibold min-w-[36px] text-center text-[var(--text-primary)]">
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                type="button"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setZoomScale((s) => Math.min(5, s + 0.25));
                }}
                title="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <div className="h-4 w-px bg-[var(--border-subtle)] mx-0.5" />
              <button
                type="button"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setZoomScale(1);
                  setPanOffset({ x: 0, y: 0 });
                }}
                title="Reset Zoom"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
