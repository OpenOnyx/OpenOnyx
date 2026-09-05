/**
 * SpacesPage — Main entry for the Spaces feature
 *
 * A Space is a queryable knowledge layer over the user's entire vault.
 * Stored locally (or synced with Supabase), fully indexed using AI embeddings.
 *
 * Redesigned UI/UX:
 *  1. Marketplace — Minimal workspace surface with search, filters, stats.
 *  2. Dual-Column Workspace — Sidebar (details & indexed notes explorer) + AI Chat.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, X, Trash2, ArrowLeft, ArrowUp, Loader2,
  Copy, FileText, Globe, RefreshCw, Sparkles,
  Zap, Layers, Brain, Check, GitBranch, MessageSquare, Edit2, Square,
} from "lucide-react";
import {
  listSpaces, getSpace, createSpace, deleteSpace, forkSpace,
  loadSpaceChat, saveSpaceChat,
  loadSpaceConversations, saveSpaceConversations,
  loadSpaceConversationMessages, saveSpaceConversationMessages,
  deleteSpaceConversationMessages
} from "../../utils/spaces-store";
import { buildVectorIndex, type VaultNote } from "../../utils/spaces-processing";
import { querySpaceStreaming, parseActionPayload, stripJSONBlock, type RAGResult, type SpaceMetadata } from "../../utils/spaces-rag";
import { isLexicalFallbackActive } from "../../utils/embeddings";
import { isAIConfigured } from "../../utils/ai-core";
import { getAPI } from "../../utils/api";
import type { Space, SpaceIndexEntry, SpaceChatMessage, SpaceVisibility, SpaceConversation } from "../../types/spaces";
import type { FileEntry } from "../../types/index";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import { authManager, AuthRequiredError } from "../../lib/auth";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { AuthModal } from "../modals/AuthModal";
import { collaborationEngine } from "../../lib/collaborationEngine";
import { syncEngine } from "../../lib/syncEngine";
import { generateDiffMarkdown } from "../../utils/diff";
import { privateCrypto } from "../../lib/privateCrypto";
import {
  AI_PROVIDER_PRESETS,
  getModelsForProvider,
  loadSettings,
  saveSettings,
  type AIModel,
  type AISettings,
} from "../../utils/ai-settings";

// ── Props ────────────────────────────────────────────────────────────────────

interface SpacesPageProps {
  onClose: () => void;
  fileTree: FileEntry[];
  onOpenNote?: (path: string) => void;
  vaultPath?: string;
}

// ── Suggested Queries ────────────────────────────────────────────────────────

const SPACE_PROMPT_CHIPS = [
  { label: "Summarize", prompt: "Summarize the key ideas in this space.", Icon: Brain },
  { label: "Find gaps", prompt: "Find gaps, contradictions, and missing definitions in this space.", Icon: Sparkles },
  { label: "Make plan", prompt: "Turn the notes in this space into a clear action plan.", Icon: Layers },
  { label: "Connect ideas", prompt: "Show the most useful connections between notes in this space.", Icon: GitBranch },
  { label: "Draft note", prompt: "Draft a new note from the most relevant context in this space.", Icon: FileText },
];

const DISPLAY_SOURCE_LIMIT = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type DisplaySource = {
  noteTitle: string;
  notePath?: string;
  chunkText: string;
};

function getSourceTitle(source: any): string {
  if (typeof source === "string") return source;
  if (!source || typeof source !== "object") return "";
  return String(source.note || source.noteTitle || source.title || "").trim();
}

function getSourcePath(source: any): string {
  if (!source || typeof source !== "object") return "";
  return String(source.notePath || source.path || source.filePath || "").trim();
}

function getSourceChunk(source: any): string {
  if (!source || typeof source !== "object") return "";
  return String(source.chunk || source.chunkText || "").trim();
}

function normalizeSourcePath(path: string): string {
  const normalized = String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();

  if (!normalized) return "";
  if (normalized.split("/").some((part) => part === ".." || part === ".")) return "";
  return normalized;
}

function getDisplaySources(sources: any[]): {
  visibleSources: DisplaySource[];
  hiddenCount: number;
} {
  const seen = new Set<string>();
  const visibleSources: DisplaySource[] = [];
  let totalUnique = 0;

  for (const source of sources) {
    const noteTitle = getSourceTitle(source);
    if (!noteTitle) continue;
    const key = (normalizeSourcePath(getSourcePath(source)) || noteTitle).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    totalUnique++;
    if (visibleSources.length < DISPLAY_SOURCE_LIMIT) {
      visibleSources.push({
        noteTitle,
        notePath: normalizeSourcePath(getSourcePath(source)),
        chunkText: getSourceChunk(source),
      });
    }
  }

  return {
    visibleSources,
    hiddenCount: Math.max(0, totalUnique - visibleSources.length),
  };
}

const spaceBtnClass =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-all duration-150 hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";
const spaceBtnPrimaryClass =
  `${spaceBtnClass} border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:border-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]`;
const spaceBtnSecondaryClass =
  `${spaceBtnClass} border-[var(--border-medium)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`;
const spaceBtnGhostClass =
  `${spaceBtnClass} border-[var(--border-subtle)] bg-transparent hover:bg-[var(--bg-active)]`;
const spaceBtnDangerClass =
  `${spaceBtnClass} border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[var(--danger)] hover:border-[rgba(239,68,68,0.55)] hover:bg-[rgba(239,68,68,0.18)]`;
const spaceBtnSmClass = "px-2.5 py-1 text-[11px]";
const spaceSidebarNewBtnClass = `${spaceBtnPrimaryClass} ${spaceBtnSmClass} h-8 px-3`;
const spaceActionBtnClass = `${spaceBtnPrimaryClass} self-start px-3.5 py-1.5 text-[11px]`;
const spaceReviewBtnClass = `${spaceBtnSecondaryClass} px-1.5 py-0.5 text-[11px]`;
const spacesPageClass =
  "relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)] font-[var(--font-sans)] text-[var(--text-primary)] transition-colors duration-150";
const marketplaceContainerClass = "flex min-h-0 flex-1 overflow-hidden";
const marketplaceSidebarClass = "flex w-[280px] shrink-0 flex-col gap-4 border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4";
const spacesBrandClass = "space-y-1 border-b border-[var(--border-subtle)] pb-4";
const spacesBrandTitleClass = "m-0 text-[15px] font-semibold text-[var(--text-primary)]";
const spacesBrandSubtitleClass = "m-0 text-[12px] leading-normal text-[var(--text-muted)]";
const spacesMenuListClass = "flex flex-col gap-1";
const spacesMenuItemClass =
  "flex h-8 cursor-pointer items-center rounded-[var(--radius-sm)] border-0 bg-transparent px-3 text-left text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const spacesMenuItemActiveClass = "bg-[var(--bg-active)] text-[var(--text-primary)]";
const spacesUserSectionClass = "mt-auto space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3";
const spacesUserStatusClass = "text-[11px] leading-normal text-[var(--text-muted)]";
const marketplaceContentClass = "flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]";
const marketplaceHeaderClass = "flex min-h-[58px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5";
const spacesSearchWrapperClass = "min-w-0 flex-1";
const spacesSearchInputClass = "h-8 w-full max-w-[420px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)]";
const marketplaceHeaderRightClass = "flex shrink-0 items-center gap-3";
const marketplaceStatsClass = "text-[12px] text-[var(--text-muted)]";
const spacesCloseBtnClass = "cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const spacesBodyClass = "min-h-0 flex-1 overflow-y-auto p-5";
const spacesGridClass = "space-y-2";
const spacesEmptyClass = "flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 text-center";
const spacesEmptyTextClass = "m-0 max-w-[440px] text-[13px] leading-normal text-[var(--text-muted)]";
const spacesTableHeadClass = "grid grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.4fr)_110px_90px_140px] gap-3 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]";
const spaceCardClass = "grid cursor-pointer grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.4fr)_110px_90px_140px] items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 transition-colors duration-150 hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)]";
const spaceCardMainClass = "min-w-0 space-y-1";
const spaceCardTitleClass = "m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-[var(--text-primary)]";
const spaceCardDescriptionClass = "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--text-muted)]";
const spaceCardTagsClass = "flex flex-wrap gap-1";
const spaceTagClass = "rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]";
const spaceCardMetaClass = "text-[12px] text-[var(--text-secondary)]";
const spaceCardMetaLeftClass = "whitespace-nowrap";
const spaceCardActionsClass = "flex justify-end gap-1";
const spaceCardActionBtnClass = "cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]";
const visibilityBadgeBaseClass = "inline-flex w-fit items-center rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em]";
const visibilityBadgeClasses: Record<SpaceVisibility, string> = {
  local: `${visibilityBadgeBaseClass} border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-muted)]`,
  private: `${visibilityBadgeBaseClass} border-[rgba(80,140,220,0.25)] bg-[rgba(80,140,220,0.1)] text-[rgb(110,165,235)]`,
  public: `${visibilityBadgeBaseClass} border-[rgba(80,180,120,0.25)] bg-[rgba(80,180,120,0.1)] text-[rgb(95,190,130)]`,
};
const modalOverlayClass =
  "fixed inset-0 z-[9999] flex items-center justify-center bg-black/50";
const modalContentClass =
  "w-full max-w-[440px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg-primary)]";
const modalHeaderClass =
  "flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-4";
const modalTitleClass = "m-0 text-[13px] font-semibold";
const modalCloseClass =
  "flex cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent p-1 text-[var(--text-muted)] transition-all duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const spaceCreateFormClass = "flex flex-col gap-3.5 p-5";
const spaceFormFieldClass = "flex flex-col gap-1";
const spaceFormLabelClass =
  "text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]";
const spaceFormInputClass =
  "rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]";
const spaceFormTextareaClass = `${spaceFormInputClass} min-h-[70px] resize-y font-[inherit]`;
const spaceFormTagsInputClass =
  "flex min-h-9 flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-[var(--border-strong)]";
const spaceFormTagClass =
  "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-active)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)]";
const spaceFormTagRemoveClass =
  "flex cursor-pointer border-0 bg-transparent p-0 text-[var(--text-muted)]";
const spaceFormTagInputClass =
  "min-w-20 flex-1 border-0 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]";
const spaceVisibilityOptionsClass = "flex gap-1";
const spaceVisibilityOptionClass =
  "flex-1 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-[11px] font-semibold text-[var(--text-muted)] transition-all duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40";
const spaceVisibilityOptionActiveClass =
  "border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text-primary)]";
const spaceFormHintClass = "text-[11px] leading-[1.4] text-[var(--text-muted)]";
const spaceFormWarningClass = "text-[#c58a2a]";
const spaceFormErrorClass =
  "rounded-[var(--radius-sm)] border border-red-500/10 bg-red-500/5 px-2.5 py-2 text-xs text-red-500";
const spaceFormActionsClass =
  "mt-2 flex justify-end gap-1.5 border-t border-[var(--border-subtle)] pt-3";
const spaceWorkspaceClass = "flex min-h-0 flex-1 gap-0 overflow-hidden bg-[var(--bg-primary)]";
const spaceViewSidebarClass = "flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3";
const spaceSidebarActionsClass = "flex shrink-0 gap-1";
const spaceSidebarBtnClass = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";
const spaceSidebarBtnPrimaryClass = "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--accent-secondary)]";
const spaceSidebarSectionClass = "space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3";
const spaceSidebarFillSectionClass = `${spaceSidebarSectionClass} flex-1 overflow-hidden`;
const spaceSidebarSectionHeaderClass = "flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]";
const spaceSidebarBadgeClass = "ml-auto rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]";
const spaceProjectCardClass = "space-y-2";
const spaceProjectHeaderClass = "flex min-w-0 items-center gap-2";
const spaceProjectTitleClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-[var(--text-primary)]";
const spaceProjectDescriptionClass = "m-0 text-[12px] leading-normal text-[var(--text-muted)]";
const spaceProjectTagsClass = "flex flex-wrap gap-1";
const spaceProjectTagClass = "rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]";
const spaceProjectMetaClass = "text-[11px] text-[var(--text-muted)]";
const spaceProjectActionsClass = "flex flex-wrap gap-1";
const spaceProjectBtnClass = "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-2 text-[11px] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";
const spaceSidebarEmptyClass = "rounded border border-dashed border-[var(--border-subtle)] p-3 text-center text-[12px] text-[var(--text-muted)]";
const spaceConversationsListClass = "flex max-h-full min-h-0 flex-col gap-1 overflow-y-auto";
const spaceConversationItemClass = "group flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-transparent px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]";
const spaceConversationActiveClass = "border-[var(--border-subtle)] bg-[var(--bg-active)]";
const spaceConversationIconClass = "shrink-0 text-[var(--text-muted)]";
const spaceConversationTitleClass = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]";
const spaceConversationRenameClass = "min-w-0 flex-1 rounded border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[12px] text-[var(--text-primary)] outline-none";
const spaceConversationActionsClass = "ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100";
const spaceConversationActionClass = "flex h-6 w-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]";
const spaceConversationDeleteClass = "hover:text-[var(--danger)]";
const spaceChatContainerClass = "flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]";
const spaceIndexingIndicatorClass = "mx-5 mt-3 flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-muted)]";
const spaceMessagesScrollClass = "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5";
const spaceChatWelcomeClass = "flex min-h-full items-center justify-center px-6 py-12";
const spaceChatWelcomeContentClass = "flex w-full max-w-[720px] flex-col items-center text-center";
const spaceChatWelcomeTitleClass =
  "mb-9 flex items-center justify-center gap-2 text-[38px] font-medium leading-none tracking-[-0.03em] text-[var(--text-primary)] [font-family:Georgia,serif]";
const spaceChatWelcomeLogoClass = "h-11 w-11 shrink-0 object-contain";
const spaceChatCentralInputClass = "w-full max-w-[674px]";
const spaceChatCentralInputWrapperClass =
  "relative flex min-h-[126px] w-full flex-col justify-between rounded-[22px] border border-[var(--border-medium)] bg-[color-mix(in_srgb,var(--bg-secondary)_82%,transparent)] px-5 py-4 text-left transition-colors duration-150 focus-within:border-[var(--border-strong)]";
const spaceChatCentralTextareaClass =
  "min-h-[52px] w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]";
const spaceChatCentralToolbarClass = "mt-5 flex items-center justify-between gap-3";
const spaceChatCentralLeftActionsClass = "flex items-center gap-2";
const spaceChatCentralRightActionsClass = "flex items-center gap-3 text-[13px] text-[var(--text-secondary)]";
const spaceChatCentralIconBtnClass =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const spaceChatModelSelectorClass =
  "relative flex min-w-0 items-center gap-1.5";
const spaceChatModelProviderClass = "text-[11px] font-medium text-[var(--text-muted)]";
const spaceChatModelTriggerClass =
  "inline-flex max-w-[250px] cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const spaceChatModelTriggerLabelClass = "min-w-0 truncate";
const spaceChatModelMenuClass =
  "absolute bottom-[calc(100%+8px)] right-0 z-[10020] flex w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] shadow-none";
const spaceChatModelMenuSectionClass =
  "border-b border-[var(--border-subtle)] p-2 last:border-b-0";
const spaceChatModelMenuLabelClass =
  "px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]";
const spaceChatProviderGridClass = "grid grid-cols-2 gap-1";
const spaceChatProviderOptionClass =
  "cursor-pointer rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1.5 text-left text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const spaceChatProviderOptionActiveClass =
  "border-[var(--border-subtle)] bg-[var(--bg-active)] text-[var(--text-primary)]";
const spaceChatModelListClass = "max-h-[260px] overflow-y-auto";
const spaceChatModelOptionClass =
  "flex w-full cursor-pointer flex-col rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]";
const spaceChatModelOptionActiveClass =
  "border-[var(--border-subtle)] bg-[var(--bg-active)]";
const spaceChatModelOptionTitleClass = "text-[12px] font-semibold text-[var(--text-primary)]";
const spaceChatModelOptionDescClass = "mt-0.5 text-[11px] leading-normal text-[var(--text-muted)]";
const spaceChatCustomModelRowClass = "flex gap-1.5 px-2 pb-2";
const spaceChatCustomModelInputClass =
  "min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)]";
const spaceChatCustomModelButtonClass =
  "shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";
const spaceChatWelcomeSuggestionsClass = "mt-4 flex w-full max-w-[560px] flex-wrap items-center justify-center gap-2";
const spaceChatSuggestionClass =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-[14px] font-medium text-[var(--text-primary)] transition-colors duration-150 hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)] [&_svg]:text-[var(--text-muted)]";
const spaceChatMessageClass =
  "mx-auto flex w-full max-w-[820px] flex-col";
const spaceChatUserMessageClass = "items-end";
const spaceChatAssistantMessageClass = "items-start";
const spaceChatUserBubbleClass =
  "max-w-[70%] break-words rounded-[20px] bg-[var(--bg-active)] px-5 py-3 text-[14px] leading-normal text-[var(--text-primary)] font-medium";
const spaceChatAssistantContentClass =
  "w-full border-0 bg-transparent p-0 text-sm leading-[1.6] text-[var(--text-primary)] [&_.markdown-preview]:min-h-0 [&_.markdown-preview]:max-w-none [&_.markdown-preview]:p-0 [&_.markdown-preview_p]:mb-3 [&_.markdown-preview_p]:mt-0 [&_.markdown-preview_p:last-child]:mb-0 [&_.markdown-preview_ul]:mb-3 [&_.markdown-preview_ul]:mt-0 [&_.markdown-preview_ul]:pl-5 [&_.markdown-preview_ol]:mb-3 [&_.markdown-preview_ol]:mt-0 [&_.markdown-preview_ol]:pl-5 [&_.markdown-preview_li]:mb-1 [&_.markdown-preview_h1]:mb-2 [&_.markdown-preview_h1]:mt-[18px] [&_.markdown-preview_h1]:text-base [&_.markdown-preview_h1]:font-semibold [&_.markdown-preview_h1]:leading-[1.3] [&_.markdown-preview_h2]:mb-2 [&_.markdown-preview_h2]:mt-[18px] [&_.markdown-preview_h2]:text-sm [&_.markdown-preview_h2]:font-semibold [&_.markdown-preview_h2]:leading-[1.3] [&_.markdown-preview_h3]:mb-2 [&_.markdown-preview_h3]:mt-[18px] [&_.markdown-preview_h3]:text-xs [&_.markdown-preview_h3]:font-semibold [&_.markdown-preview_h3]:leading-[1.3] [&_.markdown-preview_pre]:my-3 [&_.markdown-preview_pre]:overflow-x-auto [&_.markdown-preview_pre]:rounded-[var(--radius-md)] [&_.markdown-preview_pre]:border [&_.markdown-preview_pre]:border-[var(--border-subtle)] [&_.markdown-preview_pre]:bg-[var(--bg-secondary)] [&_.markdown-preview_pre]:p-3 [&_.markdown-preview_pre]:font-[var(--font-mono)] [&_.markdown-preview_pre]:text-xs [&_.markdown-preview_code]:rounded-[var(--radius-sm)] [&_.markdown-preview_code]:bg-[var(--bg-secondary)] [&_.markdown-preview_code]:px-1.5 [&_.markdown-preview_code]:py-0.5 [&_.markdown-preview_code]:font-[var(--font-mono)] [&_.markdown-preview_code]:text-xs [&_.markdown-preview_code]:text-[var(--text-primary)] [&_.markdown-preview_pre_code]:bg-transparent [&_.markdown-preview_pre_code]:p-0";
const spaceChatSourcesClass =
  "mt-3.5 flex w-full flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-2.5";
const spaceChatSourcesLabelClass =
  "text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]";
const spaceChatSourcesListClass = "flex flex-wrap gap-1.5";
const spaceChatSourcePillClass =
  "cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-all duration-150 hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]";
const spaceChatSourceMorePillClass =
  "cursor-default rounded-xl border border-[var(--border-subtle)] bg-transparent px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]";
const spaceChatLoadingClass =
  "mx-auto flex w-full max-w-[820px] items-center gap-2 self-start rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-muted)]";
const spaceChatLoadingSpinnerClass =
  "h-3 w-3 animate-spin rounded-full border-[1.5px] border-[var(--border-subtle)] border-t-[var(--text-muted)]";
const spaceChatInputPanelClass = "shrink-0 bg-[var(--bg-primary)] px-6 pt-4 pb-3";
const spaceChatInputWrapperClass = "relative mx-auto flex w-full max-w-[760px] items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] pl-3 pr-2 py-1.5 focus-within:border-[var(--border-medium)]";
const spaceChatInputClass = "flex-1 min-h-[36px] max-h-[120px] resize-none border-0 bg-transparent px-2 py-1.5 text-[13px] leading-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]";
const spaceChatInputActionsClass = "flex items-center gap-1 shrink-0";
const spaceChatTokenCounterClass = "text-[10px] text-[var(--text-muted)] opacity-80 mr-1";
const spaceChatSendClass =
  "flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--text-primary)] text-[var(--bg-primary)] transition-all duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--bg-active)] disabled:text-[var(--text-muted)] disabled:opacity-40";
const spaceChatAbortClass =
  "bg-red-500 text-white hover:bg-red-600 disabled:opacity-50";
const spaceChatNoAiClass =
  "mt-1.5 text-center text-[9px] text-[var(--text-muted)]";
const spaceChatFooterClass =
  "mt-1.5 text-center text-[9px] text-[var(--text-muted)] opacity-70";
const spaceChatMemoryClass =
  "absolute -top-[18px] right-4 text-[9px] font-medium tracking-[0.02em] text-[var(--text-muted)] opacity-80";
const spaceToastBaseClass =
  "fixed bottom-6 left-1/2 z-[9999] max-w-[400px] -translate-x-1/2 cursor-pointer rounded-[var(--radius-sm)] bg-[var(--bg-secondary)] px-4 py-2 text-center text-xs font-semibold";
const spaceToastSuccessClass =
  "border border-[var(--border-medium)] text-[var(--text-primary)]";
const spaceToastErrorClass =
  "border border-red-500/20 text-red-400";
const spaceOperationsGridClass = "flex flex-col gap-1";
const spaceOperationsBtnClass = "flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-2 text-left text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:text-[var(--accent-primary)]";
const spaceActionCardClass =
  "mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-secondary)]";
const spaceActionCardAppliedClass =
  "border-[rgba(72,199,142,0.3)] bg-[rgba(72,199,142,0.03)]";
const spaceActionCardRejectedClass =
  "border-[rgba(255,82,82,0.3)] bg-[rgba(255,82,82,0.03)]";
const spaceActionCardHeaderClass =
  "flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)] px-3.5 py-2.5 text-xs font-semibold text-[var(--text-primary)] [&_svg]:text-[var(--accent-primary)]";
const actionAppliedBadgeClass =
  "ml-auto rounded border border-[rgba(72,199,142,0.2)] bg-[rgba(72,199,142,0.1)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#48c78e]";
const actionRejectedBadgeClass =
  "ml-auto rounded border border-[rgba(255,82,82,0.2)] bg-[rgba(255,82,82,0.1)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#ff5252]";
const spaceActionCardBodyClass = "flex flex-col gap-2.5 p-3.5";
const spaceActionDetailsClass =
  "mb-3 flex flex-col gap-1 text-xs leading-normal text-[var(--text-secondary)]";
const spaceActionButtonsClass = "mt-3 flex flex-wrap gap-2";
const spaceMultiActionListClass =
  "mb-3 flex max-h-[180px] flex-col gap-1.5 overflow-y-auto pr-1";
const multiActionItemClass =
  "flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs";
const actionNumberClass = "font-bold text-[var(--text-muted)]";
const actionDescriptionClass =
  "flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
const actionMiniAppliedClass =
  "rounded bg-[rgba(72,199,142,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[#48c78e]";
const spaceActionStructureListClass = "flex flex-col gap-2";
const structureChangeItemClass =
  "flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-2 text-[11px]";
const changeTypeBadgeClass =
  "rounded-[var(--radius-sm)] bg-[var(--bg-active)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--text-secondary)]";
const changeDetailsClass =
  "flex-1 text-[var(--text-secondary)] [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--bg-hover)] [&_code]:px-[3px] [&_code]:py-px";
const spaceActionTableClass =
  "w-full border-collapse text-left text-[11px] [&_td]:border [&_td]:border-[var(--border-subtle)] [&_td]:px-2 [&_td]:py-1.5 [&_td_code]:rounded-[var(--radius-sm)] [&_td_code]:bg-[var(--bg-primary)] [&_td_code]:px-[3px] [&_td_code]:py-px [&_th]:border [&_th]:border-[var(--border-subtle)] [&_th]:bg-[var(--bg-hover)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold [&_th]:text-[var(--text-primary)]";
const spaceActionInsightsClass = "flex flex-col gap-2.5";
const insightItemClass =
  "flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2.5 text-[11px]";
const insightTypeClass = "text-[11px] text-[var(--text-primary)]";
const insightDescriptionClass = "leading-[1.4] text-[var(--text-secondary)]";
const insightNotesClass = "italic text-[var(--text-muted)]";
const mentionDropdownClass =
  "absolute bottom-[calc(100%+8px)] left-0 z-[10000] max-h-[220px] w-full max-w-[360px] overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--color-base-25)] p-1";
const mentionItemClass =
  "flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const mentionItemActiveClass =
  "bg-[var(--bg-hover)] text-[var(--text-primary)]";
const mentionItemIconClass = "shrink-0 text-[var(--text-muted)]";
const mentionItemTitleClass =
  "overflow-hidden text-ellipsis whitespace-nowrap";
const activeActionStatusClass =
  "mt-2 inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium [&_.status-icon]:shrink-0";
const activeActionProcessingClass =
  "border-[rgba(198,198,198,0.15)] bg-[rgba(198,198,198,0.08)] text-[var(--text-secondary)]";
const activeActionCompletedClass =
  "border-[rgba(72,199,142,0.15)] bg-[rgba(72,199,142,0.08)] text-[#48c78e]";
const spaceRightSidebarClass =
  "flex h-full w-[440px] shrink-0 flex-col gap-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5";
const spaceRightSidebarHeaderClass =
  "flex shrink-0 flex-col items-stretch gap-2.5 border-b border-[var(--border-subtle)] pb-2.5";
const spaceRightSidebarHeaderRowClass =
  "flex items-center justify-between";
const spaceRightSidebarTitleClass =
  "overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]";
const spaceRightSidebarCloseClass =
  "flex cursor-pointer items-center justify-center rounded border-0 bg-transparent p-1 text-[var(--text-muted)] transition-all duration-150 hover:bg-white/5 hover:text-[var(--text-primary)]";
const spaceRightSidebarTabsClass = "mt-2 flex shrink-0 gap-3";
const spaceRightSidebarTabClass =
  "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-all duration-150 hover:text-[var(--text-secondary)]";
const spaceRightSidebarTabActiveClass =
  "border-b-[#48c78e] text-[var(--text-primary)]";
const spaceRightSidebarBodyClass =
  "flex flex-1 flex-col gap-3 overflow-y-auto";
const spaceRightSidebarPreviewClass =
  "flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-5 [&_.markdown-preview]:min-h-0 [&_.markdown-preview]:max-w-none [&_.markdown-preview]:p-0";
const spaceRightSidebarEditClass =
  "flex h-full flex-col gap-2.5";
const spaceRightSidebarEditHintClass =
  "text-[11px] text-[var(--text-muted)]";
const spaceRightSidebarTextareaClass =
  "h-full min-h-[200px] w-full flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 font-[var(--font-monospace,monospace)] text-xs leading-normal text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--interactive-accent)] focus:shadow-[0_0_0_2px_rgba(122,162,247,0.18)]";
const spaceRightSidebarReviewListClass = "flex flex-col";
const spaceRightSidebarReviewItemsClass =
  "mt-3 flex flex-col gap-2.5";
const spaceRightSidebarReviewItemClass =
  "flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2.5";
const spaceRightSidebarReviewInfoClass = "flex flex-col gap-0.5";
const spaceRightSidebarReviewTypeClass = "text-xs font-medium";
const spaceRightSidebarReviewPathClass =
  "text-[11px] text-[var(--text-muted)]";
const spaceRightSidebarFooterClass =
  "mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4";
const spaceRightSidebarBackBtnClass = "mr-auto";

/** Count .md files in a file tree */
function countNotes(entries: FileEntry[] = []): number {
  if (!entries) return 0;
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory && e.children) count += countNotes(e.children);
    else if (e.name.endsWith(".md") || e.name.endsWith(".canvas")) count++;
  }
  return count;
}

/** Catalog all markdown notes recursively in the vault */
function getAllVaultNotes(entries: FileEntry[] = []): { path: string; title: string }[] {
  if (!entries) return [];
  const notes: { path: string; title: string }[] = [];

  function walk(items: FileEntry[]) {
    if (!items) return;
    for (const e of items) {
      if (e.isDirectory && e.children) {
        walk(e.children);
      } else if (e.name.endsWith(".md")) {
        notes.push({ path: e.path, title: e.name.replace(/\.md$/, "") });
      }
    }
  }

  walk(entries);
  return notes;
}

/** Get all preview notes from the file tree */
function getPreviewNotes(entries: FileEntry[] = [], max = 15): { path: string; title: string }[] {
  if (!entries) return [];
  const notes: { path: string; title: string; modified: number }[] = [];

  function walk(items: FileEntry[]) {
    if (!items) return;
    for (const e of items) {
      if (e.isDirectory && e.children) walk(e.children);
      else if (e.name.endsWith(".md")) {
        notes.push({ path: e.path, title: e.name.replace(/\.md$/, ""), modified: e.modifiedAt });
      }
    }
  }

  walk(entries);
  notes.sort((a, b) => b.modified - a.modified);
  return notes.slice(0, max);
}

function getVisibilityLabel(visibility: SpaceVisibility): string {
  switch (visibility) {
    case "local":
      return "Local";
    case "private":
      return "Private";
    case "public":
      return "Public";
    default:
      return "Local";
  }
}

/**
 * Detects the action type from a potentially incomplete action block during streaming,
 * falling back to proactive detection from the user query if the stream hasn't started/reached the JSON block yet.
 */
function detectActionType(text: string, query?: string): string | null {
  // 1. Try to detect from stream content first (highest accuracy)
  if (text) {
    const lower = text.toLowerCase();
    if (lower.includes('"intent": "multi_action"') || lower.includes('"intent":"multi_action"') || lower.includes('"action": "multi_action"') || lower.includes('"action":"multi_action"')) {
      return "create_note";
    }
    if (lower.includes('"action": "create_note"') || lower.includes('"action":"create_note"') || lower.includes("'action': 'create_note'") || lower.includes("'action':'create_note'") || lower.includes('"intent": "create_note"') || lower.includes('"intent":"create_note"')) {
      return "create_note";
    }
    if (lower.includes('"action": "update_note"') || lower.includes('"action":"update_note"') || lower.includes("'action': 'update_note'") || lower.includes("'action':'update_note'") || lower.includes('"intent": "update_note"') || lower.includes('"intent":"update_note"')) {
      return "update_note";
    }
    if (lower.includes('"action": "suggest_structure"') || lower.includes('"action":"suggest_structure"') || lower.includes("'action': 'suggest_structure'") || lower.includes("'action':'suggest_structure'")) {
      return "suggest_structure";
    }
    if (lower.includes('"action": "suggest_links"') || lower.includes('"action":"suggest_links"') || lower.includes("'action': 'suggest_links'") || lower.includes("'action':'suggest_links'")) {
      return "suggest_links";
    }
    if (lower.includes('"action": "insight_report"') || lower.includes('"action":"insight_report"') || lower.includes("'action': 'insight_report'") || lower.includes("'action':'insight_report'")) {
      return "insight_report";
    }
    if (lower.includes("```") || lower.includes('"action"') || lower.includes("'action'") || lower.includes('"actions"')) {
      return "create_note";
    }
  }

  // 2. Fall back to proactive pre-detection from the user's query
  if (query) {
    const qLower = query.toLowerCase();
    if (qLower.includes("insight")) {
      return "insight_report";
    }
    if (qLower.includes("organize") || qLower.includes("structure") || qLower.includes("hierarchy") || qLower.includes("folder")) {
      return "suggest_structure";
    }
    if (qLower.includes("link")) {
      return "suggest_links";
    }
    if (qLower.includes("summary") || qLower.includes("summarize") || qLower.includes("create") || qLower.includes("generate") || qLower.includes("batch") || qLower.includes("notes") || qLower.includes("journal") || qLower.includes("story") || qLower.includes("diary")) {
      return "create_note";
    }
    if (qLower.includes("rewrite") || qLower.includes("simplify") || qLower.includes("expand") || qLower.includes("edit") || qLower.includes("update") || qLower.includes("[[")) {
      return "update_note";
    }
  }

  return null;
}

function getPayloadActions(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.actions)) return payload.actions;
  const type = payload.intent || payload.action || payload.type;
  if (type === "create_note") {
    return [{ ...payload, type: "create_note" }];
  }
  if (type === "update_note") {
    return [{ ...payload, type: "update_note" }];
  }
  return [];
}

function payloadRequiresSourceMutation(payload: any): boolean {
  if (!payload) return false;
  const intent = payload.intent || payload.action || payload.type;
  if (intent === "update_note" || intent === "suggest_structure" || intent === "suggest_links") return true;
  return getPayloadActions(payload).some((action) => action?.type === "update_note");
}

function payloadCreatesOnlyLocalNotes(payload: any): boolean {
  if (!payload) return false;
  const intent = payload.intent || payload.action || payload.type;
  if (intent === "insight_report") return true;
  const actions = getPayloadActions(payload);
  return actions.length > 0 && actions.every((action) => action?.type === "create_note");
}

function isLocalExportRequest(query: string): boolean {
  return /\b(save|export|create|make|new)\b[\s\S]{0,40}\b(note|file|document|markdown|md)\b/i.test(query) ||
    /\b(save as|save it as|save this as|summarize.*save|summary.*note|local note)\b/i.test(query);
}

function isDirectSourceEditRequest(query: string): boolean {
  if (isLocalExportRequest(query)) return false;
  return /\b(edit|update|rewrite|modify|change|fix|improve|add|remove|rename|move|delete|organize|restructure|merge|insert|link)\b[\s\S]{0,80}\b(file|note|source|space|folder|document|md)\b/i.test(query) ||
    /\b(edit|update|rewrite|modify|change|fix|improve)\b/i.test(query);
}

function inferEditTarget(query: string): string | null {
  const match = query.match(/\b(?:edit|update|rewrite|modify|change|fix|improve)\s+(?:the\s+)?(.+?)(?:\s+(?:file|note|document|md))?(?:[?.!]|$)/i);
  if (!match?.[1]) return null;
  const target = match[1]
    .replace(/^this\s+/i, "")
    .replace(/^that\s+/i, "")
    .replace(/^public\s+/i, "")
    .trim();
  return target.length > 0 && target.length < 80 ? target : null;
}

function buildReadOnlyEditResponse(query: string, sourceTitles: string[] = []): string {
  const target = inferEditTarget(query);
  const targetText = target ? `the **${target}** file` : "that source file";
  const uniqueSources = [...new Set(sourceTitles.filter(Boolean))].slice(0, 4);
  const sourceLine = uniqueSources.length > 0
    ? `\n\nI found relevant context from: ${uniqueSources.map((s) => `\`${s}\``).join(", ")}.`
    : "";

  return `I can't directly edit ${targetText} in a public/read-only space. Public space notes are protected here, even when you own the space.${sourceLine}

What I can do instead:
- Draft the exact changes you should make to ${targetText}.
- Explain what should be updated and why.
- Create a new local note in your current vault based on this public-space context.
- Remix this space so the notes become editable.

You can ask me to:
- "Draft the changes for ${target || "that file"}."
- "Summarize ${target || "that file"} and save it as a note."
- "Create a local note from ${target || "this source"}."
- "Remix this space so I can edit it directly."`;
}

/**
 * Strips JSON action blocks (complete or incomplete) from assistant messages.
 */


interface ActiveActionStatusProps {
  actionType: string;
  isApplied: boolean;
}

function ActiveActionStatus({ actionType, isApplied }: ActiveActionStatusProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isApplied) return;
    const interval = setInterval(() => {
      setStep((prev) => (prev < 2 ? prev + 1 : 0));
    }, 2500);
    return () => clearInterval(interval);
  }, [isApplied]);

  if (isApplied) {
    return (
      <div className={cx(activeActionStatusClass, activeActionCompletedClass)}>
        <Check size={13} className="status-icon" />
        <span>Changes successfully saved and integrated</span>
      </div>
    );
  }

  let steps = ["Preparing changes...", "Editing note...", "Linking your notes..."];
  if (actionType === "suggest_structure") {
    steps = ["Analyzing note hierarchy...", "Structuring folders...", "Linking your notes..."];
  } else if (actionType === "suggest_links") {
    steps = ["Scanning references...", "Analyzing connections...", "Linking your notes..."];
  } else if (actionType === "insight_report") {
    steps = ["Reviewing space contents...", "Correlating insights...", "Structuring findings..."];
  }

  return (
    <div className={cx(activeActionStatusClass, activeActionProcessingClass)}>
      <Loader2 size={13} className="status-icon animate-spin" />
      <span>{steps[step]}</span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function SpacesPage({ onClose, fileTree, onOpenNote, vaultPath }: SpacesPageProps) {
  // Navigation
  const [view, setView] = useState<"marketplace" | "space">("marketplace");
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const activeSpaceIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Marketplace states
  const [spaces, setSpaces] = useState<SpaceIndexEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [marketFilter, setMarketFilter] = useState<"all" | "local" | "private" | "public">("all");
  const [marketSearch, setMarketSearch] = useState("");

  // Space view state
  const [activeSpace, setActiveSpace] = useState<Space | null>(null);
  const currentUserId = authManager.getUserId();
  const isReadOnlySourceSpace = !!activeSpace && (
    activeSpace.visibility !== "local" && activeSpace.ownerId !== currentUserId
  );
  const canMutateSpaceSource = !!activeSpace && !isReadOnlySourceSpace;
  const canCreateLocalNotesFromSpace = !!activeSpace;

  // Create form states
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createTagInput, setCreateTagInput] = useState("");
  const [createVisibility, setCreateVisibility] = useState<SpaceVisibility>("local");
  const [createEncryptionPassword, setCreateEncryptionPassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Auth/cloud state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authEmail, setAuthEmail] = useState<string | null>(authManager.getUser()?.email ?? null);
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadSettings());

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<SpaceChatMessage[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [saveNoteMessage, setSaveNoteMessage] = useState<SpaceChatMessage | null>(null);
  const [saveNoteTitle, setSaveNoteTitle] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [customOpenRouterModel, setCustomOpenRouterModel] = useState("");
  const modelPickerRef = useRef<HTMLDivElement>(null);

  // Conversation session states
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Unlock Private Space states
  const [unlockSpaceId, setUnlockSpaceId] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const inputTokens = useMemo(() => Math.ceil((chatInput || "").length / 4), [chatInput]);
  const availableChatModels = useMemo<AIModel[]>(() => {
    const models = getModelsForProvider(aiSettings.provider);
    if (!aiSettings.modelId || models.some((model) => model.id === aiSettings.modelId)) {
      return models;
    }
    return [
      ...models,
      {
        id: aiSettings.modelId,
        label: aiSettings.modelId,
        shortLabel: aiSettings.modelId.split("/").pop() || aiSettings.modelId,
        description: "Custom model from AI settings",
        supportsGrounding: false,
      },
    ];
  }, [aiSettings.modelId, aiSettings.provider]);
  const selectedChatModel =
    availableChatModels.find((model) => model.id === aiSettings.modelId) || availableChatModels[0];
  const selectedProviderLabel =
    AI_PROVIDER_PRESETS.find((preset) => preset.id === aiSettings.provider)?.label || aiSettings.provider;

  const estimatedHistoryTokens = useMemo(() => {
    let total = 0;
    const recent = chatMessages.slice(-10);
    for (const msg of recent) {
      total += Math.ceil((msg.content || "").length / 4);
    }
    return total;
  }, [chatMessages]);

  // Mentions State
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

  // Indexing
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [isIndexed, setIsIndexed] = useState(false);

  // Remix progress
  const [isRemixing, setIsRemixing] = useState(false);
  const [remixProgress, setRemixProgress] = useState<{ done: number; total: number } | null>(null);

  // Right Sidebar for AI Actions (Preview, Diff, Edit)
  const [rightSidebarMode, setRightSidebarMode] = useState<"preview" | "diff" | "edit" | "review_list" | null>(null);
  const [rightSidebarData, setRightSidebarData] = useState<{
    actionType: "create_note" | "update_note";
    title?: string;
    path: string;
    content?: string;
    before?: string;
    after?: string;
    msgId: string;
    actionIndex?: number;
    actions?: any[];
  } | null>(null);
  const [rejectedActions, setRejectedActions] = useState<Record<string, boolean>>({});
  const [sidebarEditText, setSidebarEditText] = useState("");

  // Remote notes (for cloud spaces)
  const [remoteNotes, setRemoteNotes] = useState<{ path: string; title: string }[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const centralInputRef = useRef<HTMLTextAreaElement>(null);
  const bottomInputRef = useRef<HTMLTextAreaElement>(null);

  const vaultNoteCount = countNotes(fileTree);
  const allVaultNotes = useMemo(() => getAllVaultNotes(fileTree), [fileTree]);

  const notesList = activeSpace 
    ? (activeSpace.visibility === "local" ? allVaultNotes : remoteNotes)
    : [];

  const filteredNotes = useMemo(() => {
    if (!showMentionDropdown) return [];
    if (!mentionQuery) return notesList.slice(0, 10);
    const q = mentionQuery.toLowerCase();
    
    // 1. Filter matching notes
    const matches = notesList.filter(note => {
      const title = (note.title || "").toLowerCase();
      const path = (note.path || "").toLowerCase();
      return title.includes(q) || path.includes(q);
    });

    // 2. Sort by relevance
    matches.sort((a, b) => {
      const aTitle = (a.title || "").toLowerCase();
      const bTitle = (b.title || "").toLowerCase();
      const aPath = (a.path || "").toLowerCase();
      const bPath = (b.path || "").toLowerCase();

      // Priority 1: Exact title match
      const aExact = aTitle === q ? 1 : 0;
      const bExact = bTitle === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      // Priority 2: Title starts with query
      const aStartsWith = aTitle.startsWith(q) ? 1 : 0;
      const bStartsWith = bTitle.startsWith(q) ? 1 : 0;
      if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;

      // Priority 3: Title contains query
      const aTitleContains = aTitle.includes(q) ? 1 : 0;
      const bTitleContains = bTitle.includes(q) ? 1 : 0;
      if (aTitleContains !== bTitleContains) return bTitleContains - aTitleContains;

      // Priority 4: Filename contains query (excluding directory paths)
      const aFilename = aPath.split("/").pop() || "";
      const bFilename = bPath.split("/").pop() || "";
      const aFileContains = aFilename.includes(q) ? 1 : 0;
      const bFileContains = bFilename.includes(q) ? 1 : 0;
      if (aFileContains !== bFileContains) return bFileContains - aFileContains;

      // Default: Preserve alphabetical/original order
      return 0;
    });

    return matches.slice(0, 10);
  }, [notesList, mentionQuery, showMentionDropdown]);

  const selectNote = (note: any) => {
    const textBefore = chatInput.substring(0, mentionStartIndex);
    const activeTextarea = document.activeElement as HTMLTextAreaElement;
    let cursorPos = mentionStartIndex;
    
    if (activeTextarea && activeTextarea.tagName === "TEXTAREA") {
      cursorPos = activeTextarea.selectionStart;
    }
    
    const textAfter = chatInput.substring(cursorPos);
    const insertedLink = `[[${note.title}]] `;
    const newValue = textBefore + insertedLink + textAfter;
    setChatInput(newValue);
    setShowMentionDropdown(false);
    setMentionQuery("");
    setMentionStartIndex(-1);

    setTimeout(() => {
      if (activeTextarea && activeTextarea.tagName === "TEXTAREA") {
        activeTextarea.focus();
        const newCursorPos = textBefore.length + insertedLink.length;
        activeTextarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 50);
  };

  const checkForMention = (text: string, selectionStart: number) => {
    const lastAtIndex = text.lastIndexOf('@', selectionStart - 1);
    if (lastAtIndex !== -1) {
      const textBetween = text.substring(lastAtIndex + 1, selectionStart);
      const hasSpace = /\s/.test(textBetween);
      if (!hasSpace) {
        setShowMentionDropdown(true);
        setMentionQuery(textBetween);
        setMentionStartIndex(lastAtIndex);
        setMentionActiveIndex(0);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionQuery("");
    setMentionStartIndex(-1);
  };

  useEffect(() => {
    return authManager.subscribe((state) => {
      setAuthEmail(state.user?.email ?? null);
    });
  }, []);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setAiSettings(loadSettings());
    };
    window.addEventListener("ai-settings-changed", handleSettingsChanged);
    return () => window.removeEventListener("ai-settings-changed", handleSettingsChanged);
  }, []);

  useEffect(() => {
    if (!modelPickerOpen) return;
    if (aiSettings.provider === "openrouter") {
      setCustomOpenRouterModel(aiSettings.customModelId || aiSettings.modelId || "");
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (modelPickerRef.current?.contains(event.target as Node)) return;
      setModelPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelPickerOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [aiSettings.customModelId, aiSettings.modelId, aiSettings.provider, modelPickerOpen]);

  const handleChatModelChange = useCallback((modelId: string) => {
    setAiSettings((current) => {
      const next = { ...current, modelId, customModelId: modelId };
      saveSettings(next);
      return next;
    });
    window.dispatchEvent(new Event("ai-settings-changed"));
    setModelPickerOpen(false);
  }, []);

  const handleChatProviderChange = useCallback((provider: AISettings["provider"]) => {
    setAiSettings((current) => {
      const nextModels = getModelsForProvider(provider);
      const next = {
        ...current,
        provider,
        apiKey: current.providerKeys?.[provider] || "",
        modelId: nextModels[0]?.id || current.modelId,
        providerKeys: { ...current.providerKeys, [current.provider]: current.apiKey },
      };
      saveSettings(next);
      return next;
    });
    window.dispatchEvent(new Event("ai-settings-changed"));
  }, []);

  const handleApplyCustomOpenRouterModel = useCallback(() => {
    const modelId = customOpenRouterModel.trim();
    if (!modelId) return;
    setAiSettings((current) => {
      const next = {
        ...current,
        provider: "openrouter" as const,
        apiKey: current.provider === "openrouter" ? current.apiKey : current.providerKeys?.openrouter || "",
        modelId,
        customModelId: modelId,
        providerKeys: { ...current.providerKeys, [current.provider]: current.apiKey },
      };
      saveSettings(next);
      return next;
    });
    window.dispatchEvent(new Event("ai-settings-changed"));
    setModelPickerOpen(false);
  }, [customOpenRouterModel]);

  const renderChatModelPicker = () => (
    <div className={spaceChatModelSelectorClass} ref={modelPickerRef}>
      <span className={spaceChatModelProviderClass}>{selectedProviderLabel}</span>
      <button
        type="button"
        className={spaceChatModelTriggerClass}
        onClick={() => setModelPickerOpen((open) => !open)}
        disabled={isQuerying}
        title={selectedChatModel?.description}
        aria-haspopup="menu"
        aria-expanded={modelPickerOpen}
      >
        <span className={spaceChatModelTriggerLabelClass}>
          {selectedChatModel?.label || "Select model"}
        </span>
        <ArrowUp size={12} className={modelPickerOpen ? "" : "rotate-180"} />
      </button>
      {modelPickerOpen && (
        <div className={spaceChatModelMenuClass} role="menu">
          <div className={spaceChatModelMenuSectionClass}>
            <div className={spaceChatModelMenuLabelClass}>Provider</div>
            <div className={spaceChatProviderGridClass}>
              {AI_PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cx(
                    spaceChatProviderOptionClass,
                    preset.id === aiSettings.provider && spaceChatProviderOptionActiveClass,
                  )}
                  onClick={() => handleChatProviderChange(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className={spaceChatModelMenuSectionClass}>
            <div className={spaceChatModelMenuLabelClass}>Model</div>
            <div className={spaceChatModelListClass}>
              {availableChatModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={cx(
                    spaceChatModelOptionClass,
                    model.id === selectedChatModel?.id && spaceChatModelOptionActiveClass,
                  )}
                  onClick={() => handleChatModelChange(model.id)}
                  title={model.id}
                >
                  <span className={spaceChatModelOptionTitleClass}>{model.label}</span>
                  <span className={spaceChatModelOptionDescClass}>{model.description}</span>
                </button>
              ))}
            </div>
            {aiSettings.provider === "openrouter" && (
              <>
                <div className={spaceChatModelMenuLabelClass}>Custom OpenRouter model</div>
                <div className={spaceChatCustomModelRowClass}>
                  <input
                    className={spaceChatCustomModelInputClass}
                    value={customOpenRouterModel}
                    onChange={(event) => setCustomOpenRouterModel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleApplyCustomOpenRouterModel();
                      }
                    }}
                    placeholder="e.g. openai/gpt-4o-mini"
                    aria-label="Custom OpenRouter model ID"
                  />
                  <button
                    type="button"
                    className={spaceChatCustomModelButtonClass}
                    onClick={handleApplyCustomOpenRouterModel}
                    disabled={!customOpenRouterModel.trim()}
                  >
                    Use
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ── Load spaces ──────────────────────────────────────
  const refreshSpaces = useCallback(async () => {
    try {
      const list = await listSpaces();
      setSpaces(list);
    } catch (err) {
      console.error("[Spaces] Failed to load spaces:", err);
      setSpaces([]);
    }
  }, []);

  // Reset view and active space state when the vault is changed
  useEffect(() => {
    setView("marketplace");
    setActiveSpace(null);
    setActiveSpaceId(null);
    activeSpaceIdRef.current = null;
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setConversations([]);
    setChatMessages([]);
    setIsIndexed(false);
  }, [vaultPath]);

  // Refresh spaces list when vault or login status changes
  useEffect(() => {
    refreshSpaces();
  }, [vaultPath, authEmail, refreshSpaces]);

  // ── Open a space ─────────────────────────────────────
  const openSpace = useCallback(async (id: string) => {
    console.log("[SpacesPage] openSpace triggered for space ID:", id);
    try {
      activeSpaceIdRef.current = id;
      
      console.log("[SpacesPage] Current spaces in state:", spaces.map(s => ({ id: s.id, title: s.title, visibility: s.visibility })));
      const listSpace = spaces.find(s => s.id === id);
      console.log("[SpacesPage] Found listSpace:", listSpace);
      
      const isUnlocked = privateCrypto.isUnlocked(id);
      console.log("[SpacesPage] Is space unlocked in crypto engine:", isUnlocked);

      if (listSpace && listSpace.visibility === "private" && !isUnlocked) {
        console.log("[SpacesPage] Space is private and locked. Opening password prompt modal.");
        setUnlockSpaceId(id);
        setUnlockPassword("");
        setUnlockError(null);
        return;
      }

      console.log("[SpacesPage] Fetching full space metadata...");
      let space = await getSpace(id);
      console.log("[SpacesPage] Loaded space metadata from store/db:", space);

      if (!space && listSpace) {
        console.log("[SpacesPage] getSpace returned null, using listSpace fallback.");
        space = {
          id: listSpace.id,
          title: listSpace.title,
          description: listSpace.description || "",
          helpsWith: listSpace.helpsWith || [],
          visibility: listSpace.visibility,
          ownerId: listSpace.ownerId,
          noteCount: listSpace.noteCount,
          createdAt: listSpace.createdAt,
          updatedAt: listSpace.updatedAt,
        };
      }

      if (activeSpaceIdRef.current !== id) {
        console.log("[SpacesPage] activeSpaceIdRef changed, ignoring this open event.");
        return;
      }

      if (space) {
        // Secondary check just in case listSpace was missing
        if (space.visibility === "private" && !privateCrypto.isUnlocked(id)) {
          console.log("[SpacesPage] Secondary check: space is locked. Opening password prompt modal.");
          setUnlockSpaceId(id);
          setUnlockPassword("");
          setUnlockError(null);
          return;
        }

        console.log("[SpacesPage] Unlocked and ready. Opening space view.");
        setActiveSpace(space);
        setActiveSpaceId(id);
        setView("space");
        setStreamingText("");
        setChatInput("");
        const currentUserId = authManager.getUserId();
        const isRemoteSpace = space.visibility !== "local" && space.ownerId !== currentUserId;
        
        setIsIndexed(space.noteCount > 0 || isRemoteSpace);

        // Load conversations from disk
        console.log("[SpacesPage] Loading conversations list...");
        const convList = await loadSpaceConversations(id);
      if (activeSpaceIdRef.current !== id) return;

      if (convList.length === 0) {
        // Attempt migration of legacy single chat
        const legacyHistory = await loadSpaceChat(id);
        if (activeSpaceIdRef.current !== id) return;

        if (legacyHistory && legacyHistory.length > 0) {
          const migratedConv: SpaceConversation = {
            id: "migrated",
            title: "Previous Chat",
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await saveSpaceConversationMessages(id, "migrated", legacyHistory);
          await saveSpaceConversations(id, [migratedConv]);
          if (activeSpaceIdRef.current === id) {
            setConversations([migratedConv]);
            setActiveConversationId("migrated");
            activeConversationIdRef.current = "migrated";
            setChatMessages(legacyHistory);
          }
        } else {
          // Create default conversation
          const defaultConv: SpaceConversation = {
            id: `conv-${Date.now()}`,
            title: "New Chat",
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await saveSpaceConversationMessages(id, defaultConv.id, []);
          await saveSpaceConversations(id, [defaultConv]);
          if (activeSpaceIdRef.current === id) {
            setConversations([defaultConv]);
            setActiveConversationId(defaultConv.id);
            activeConversationIdRef.current = defaultConv.id;
            setChatMessages([]);
          }
        }
      } else {
        // Sort conversations by updatedAt descending
        const sorted = [...convList].sort((a, b) => b.updatedAt - a.updatedAt);
        const firstConv = sorted[0];
        const msgs = await loadSpaceConversationMessages(id, firstConv.id);
        if (activeSpaceIdRef.current === id) {
          setConversations(sorted);
          setActiveConversationId(firstConv.id);
          activeConversationIdRef.current = firstConv.id;
          setChatMessages(msgs);
        }
      }
    }
  } catch (err) {
    console.error("[SpacesPage] Error in openSpace:", err);
  }
}, [spaces]);

  const handleUnlockSpace = useCallback(async () => {
    if (!unlockSpaceId || !unlockPassword) return;
    setUnlockError(null);
    setUnlocking(true);
    try {
      await collaborationEngine.unlockPrivateSpace(unlockSpaceId, unlockPassword);
      const spaceId = unlockSpaceId;
      setUnlockSpaceId(null);
      setUnlockPassword("");
      // Refresh the spaces/index so it's marked as unlocked
      await refreshSpaces();
      // Open the space
      await openSpace(spaceId);
    } catch (err: any) {
      setUnlockError(err.message || "Incorrect password or decryption failed.");
    } finally {
      setUnlocking(false);
    }
  }, [unlockSpaceId, unlockPassword, refreshSpaces, openSpace]);

  // ── Conversation actions ─────────────────────────────
  const selectConversation = useCallback(async (convId: string) => {
    if (!activeSpaceId) return;
    setStreamingText("");
    setChatInput("");
    setActiveConversationId(convId);
    activeConversationIdRef.current = convId;
    
    const msgs = await loadSpaceConversationMessages(activeSpaceId, convId);
    if (activeConversationIdRef.current === convId) {
      setChatMessages(msgs);
    }
  }, [activeSpaceId]);

  const handleNewConversation = useCallback(async () => {
    if (!activeSpaceId) return;
    const newConv: SpaceConversation = {
      id: `conv-${Date.now()}`,
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    setChatMessages([]);
    setStreamingText("");
    setChatInput("");
    
    await saveSpaceConversationMessages(activeSpaceId, newConv.id, []);
    await saveSpaceConversations(activeSpaceId, updated);
  }, [activeSpaceId, conversations]);

  const handleDeleteConversation = useCallback(async (convId: string) => {
    if (!activeSpaceId) return;
    const remaining = conversations.filter(c => c.id !== convId);
    setConversations(remaining);
    await deleteSpaceConversationMessages(activeSpaceId, convId);
    await saveSpaceConversations(activeSpaceId, remaining);

    if (activeConversationId === convId) {
      if (remaining.length > 0) {
        selectConversation(remaining[0].id);
      } else {
        const defaultConv: SpaceConversation = {
          id: `conv-${Date.now()}`,
          title: "New Chat",
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        setConversations([defaultConv]);
        setActiveConversationId(defaultConv.id);
        activeConversationIdRef.current = defaultConv.id;
        setChatMessages([]);
        await saveSpaceConversationMessages(activeSpaceId, defaultConv.id, []);
        await saveSpaceConversations(activeSpaceId, [defaultConv]);
      }
    }
  }, [activeSpaceId, conversations, activeConversationId, selectConversation]);

  const startRename = useCallback((convId: string, currentTitle: string) => {
    setEditingConvId(convId);
    setRenameValue(currentTitle);
  }, []);

  const finishRename = useCallback(async (convId: string) => {
    if (!activeSpaceId || !renameValue.trim()) {
      setEditingConvId(null);
      return;
    }
    const updated = conversations.map(c =>
      c.id === convId ? { ...c, title: renameValue.trim(), updatedAt: Date.now() } : c
    );
    setConversations(updated);
    setEditingConvId(null);
    await saveSpaceConversations(activeSpaceId, updated);
  }, [activeSpaceId, conversations, renameValue]);

  const cancelRename = useCallback(() => {
    setEditingConvId(null);
  }, []);

  const handleAbortChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // ── Create space ─────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!createTitle.trim()) return;
    setCreateError(null);
    try {
      const space = await createSpace({
        title: createTitle.trim(),
        description: createDesc.trim(),
        helpsWith: createTags,
        noteCount: vaultNoteCount,
        visibility: isSupabaseConfigured ? createVisibility : "local",
        encryptionPassword: createVisibility === "private" ? createEncryptionPassword : undefined,
      });
      setCreateTitle("");
      setCreateDesc("");
      setCreateTags([]);
      setCreateTagInput("");
      setCreateVisibility("local");
      setCreateEncryptionPassword("");
      setShowCreateModal(false);
      await refreshSpaces();
      openSpace(space.id);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to create private/public cloud spaces.");
        setShowAuthModal(true);
        return;
      }
      console.error("[SpacesPage] Failed to create space:", err);
      setCreateError(err instanceof Error ? err.message : "Failed to create space.");
    }
  }, [createTitle, createDesc, createTags, vaultNoteCount, createVisibility, createEncryptionPassword, refreshSpaces, openSpace]);

  // ── Delete space ─────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSpace(id);
      setDeleteConfirmId(null);
      if (activeSpaceId === id) {
        setView("marketplace");
        setActiveSpace(null);
        setActiveSpaceId(null);
        activeSpaceIdRef.current = null;
        setActiveConversationId(null);
        activeConversationIdRef.current = null;
        setConversations([]);
        setChatMessages([]);
      }
      await refreshSpaces();
      showToast("Space deleted.");
    } catch (err) {
      setDeleteConfirmId(null);
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to delete cloud spaces.");
        setShowAuthModal(true);
      } else {
        showToast(err instanceof Error ? err.message : "Failed to delete space.", "error");
      }
    }
  }, [activeSpaceId, refreshSpaces, showToast]);

  // ── Fork space ───────────────────────────────────────
  const handleFork = useCallback(async (id: string) => {
    try {
      setIsRemixing(true);
      setRemixProgress({ done: 0, total: 100 });
      const forked = await forkSpace(id, undefined, (done, total) => {
        setRemixProgress({ done, total });
      });
      if (forked) {
        await refreshSpaces();
        showToast(`\u201c${forked.title}\u201d saved to your vault.`);
        openSpace(forked.id);
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to fork cloud spaces.");
        setShowAuthModal(true);
      } else {
        showToast(err instanceof Error ? err.message : "Remix failed.", "error");
      }
    } finally {
      setIsRemixing(false);
      setRemixProgress(null);
    }
  }, [refreshSpaces, openSpace, showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await authManager.signOut();
      await refreshSpaces();
    } catch (err) {
      console.error("[Spaces] Sign out failed:", err);
    }
  }, [refreshSpaces]);

  // ── Build index (auto-indexes entire vault) ──────────
  const handleBuildIndex = useCallback(async () => {
    if (!activeSpaceId) return;
    if (isReadOnlySourceSpace) {
      setIsIndexed(true);
      showToast("Public/read-only spaces use their published index. Remix to build an editable local index.", "error");
      return;
    }
    setIsIndexing(true);
    
    try {
      let customNotes: VaultNote[] | undefined = undefined;
      
      const currentUserId = authManager.getUserId();
      const isRemoteSpace = !!activeSpace && (
        activeSpace.visibility !== "local" && activeSpace.ownerId !== currentUserId
      );
      if (activeSpace?.visibility === "private" && !privateCrypto.isUnlocked(activeSpaceId)) {
        showToast("Unlock this private space to use AI features.", "error");
        setIsIndexing(false);
        return;
      }
      
      if (activeSpace && activeSpace.visibility !== "local" && isRemoteSpace && isSupabaseConfigured) {
        // Cloud space (Remote): Fetch notes directly from Supabase to index them on the cloud
        const { data: cloudNotes, error: fetchErr } = await supabase
          .from("notes")
          .select("id, path, title, content, content_encrypted, iv, auth_tag, encryption_version, version, is_canvas")
          .eq("space_id", activeSpaceId)
          .eq("deleted", false);
          
        if (fetchErr) throw fetchErr;
        
        if (cloudNotes) {
          customNotes = await Promise.all(cloudNotes.map(async (n: any) => ({
            path: n.path,
            title: n.title,
            content: activeSpace.visibility === "private"
              ? await privateCrypto.decryptNoteContent(activeSpaceId, n)
              : n.content || "",
            isCanvas: n.is_canvas || false,
          })));
        }
      }

      // Fetch a FRESH file tree from the API to avoid stale props
      const api = getAPI();
      const freshTree = await api.getFileTree();
      
      await buildVectorIndex(activeSpaceId, freshTree, (done, total) => {
        setIndexProgress({ done, total });
      }, customNotes);
      
      setIsIndexed(true);
      // Refresh space to get updated noteCount
      const updated = await getSpace(activeSpaceId);
      if (updated) setActiveSpace(updated);
      await refreshSpaces();
    } catch (err) {
      console.error("[Spaces] Index build failed:", err);
      showToast("Indexing failed. Check logs for details.", "error");
    }
    setIsIndexing(false);
  }, [activeSpaceId, activeSpace, isReadOnlySourceSpace, refreshSpaces, showToast]);

  useEffect(() => {
    if (activeSpaceId && fileTree.length > 0 && view === "space" && !isIndexed && !isIndexing && canMutateSpaceSource) {
      handleBuildIndex();
    }
  }, [activeSpaceId, activeSpace, canMutateSpaceSource, isIndexed, isIndexing, view, fileTree.length, handleBuildIndex]);

  // Fetch remote notes for preview when entering a cloud space
  useEffect(() => {
    if (activeSpaceId && activeSpace && activeSpace.visibility !== "local" && view === "space") {
      const fetchRemote = async () => {
        setIsLoadingRemote(true);
        try {
          const { data } = await supabase
            .from("notes")
            .select("id, title")
            .eq("space_id", activeSpaceId)
            .eq("deleted", false)
            .limit(15);
          
          if (data) {
            setRemoteNotes(data.map(n => ({ path: n.id, title: n.title })));
          }
        } catch (err) {
          console.error("[Spaces] Failed to fetch remote notes:", err);
        }
        setIsLoadingRemote(false);
      };
      fetchRemote();
    } else {
      setRemoteNotes([]);
    }
  }, [activeSpaceId, activeSpace, view]);

  // ── Chat query ───────────────────────────────────────
  const handleChat = useCallback(async (query?: string) => {
    const q = (query || chatInput).trim();
    if (!q || !activeSpaceId || !activeSpace || isQuerying || !activeConversationId) return;
    if (activeSpace.visibility === "private" && !privateCrypto.isUnlocked(activeSpaceId)) {
      const lockedMsg: SpaceChatMessage = {
        id: `msg-${Date.now()}-locked`,
        role: "assistant",
        content: "Unlock this private space to use AI features.",
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, lockedMsg]);
      return;
    }

    // Handle auto-rename and updatedAt timestamp updates
    let updatedConversations = conversations;
    const activeConv = conversations.find(c => c.id === activeConversationId);
    if (activeConv) {
      const isNewChat = activeConv.title === "New Chat";
      let title = activeConv.title;
      if (isNewChat) {
        title = q.substring(0, 30).trim();
        if (q.length > 30) {
          title += "...";
        }
        title = title.replace(/^["']|["']$/g, "");
      }
      updatedConversations = conversations.map(c =>
        c.id === activeConversationId
          ? { ...c, title, updatedAt: Date.now() }
          : c
      ).sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(updatedConversations);
      saveSpaceConversations(activeSpaceId, updatedConversations);
    }

    const userMsg: SpaceChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => {
      const next = [...prev, userMsg];
      saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
      return next;
    });
    setChatInput("");
    setIsQuerying(true);
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let accumulatedAnswer = "";

    try {
      // Parse query for mentioned files [[Note Title]]
      const matches = [...q.matchAll(/\[\[([^\]]+)\]\]/g)];
      const explicitNotes: { path: string; title: string; content: string }[] = [];

      if (matches.length > 0) {
        const allVaultNotes = getAllVaultNotes(fileTree);
        for (const match of matches) {
          const title = match[1].trim();
          const found = allVaultNotes.find(
            (n) => n.title.toLowerCase() === title.toLowerCase()
          );
          if (found) {
            try {
              const content = await (window as any).electronAPI.readFile(found.path);
              explicitNotes.push({ path: found.path, title: found.title, content });
            } catch (err) {
              console.warn(`[SpacesPage] Failed to read mentioned note: ${found.path}`, err);
            }
          }
        }
      }

      // ── Detect Complex/Vault-Wide Tasks ───────────────────
      // Only run for writable source spaces. Public spaces are read-only even for their owner.
      let finalQuery = q;

      if (canMutateSpaceSource) {
      const historyText = (chatMessages || []).slice(-3).map(m => m.content).join(" ");
      const combinedText = (q + " " + historyText).toLowerCase();

      const isOrphanQuery = /orphan/i.test(combinedText) || /unlinked/i.test(combinedText);
      const isVaultWideLinking = /connect all|link all|link those/i.test(combinedText) ||
                                 (/continue|next|proceed|go on/i.test(q) && (/orphan|link|connect/i.test(combinedText)));
      const isStructureQuery = /structure|organize|restructure|hierarchy|folders/i.test(combinedText);
      const isDuplicateQuery = /duplicate|merge|redundant/i.test(combinedText);

      if (isOrphanQuery || isVaultWideLinking || isStructureQuery || isDuplicateQuery) {
        // 1. Load graph data to find relationships and orphans
        let graph: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
        try {
          if ((window as any).electronAPI.getGraphData) {
            graph = await (window as any).electronAPI.getGraphData();
          }
        } catch (err) {
          console.warn("[SpacesPage] Failed to retrieve graph data:", err);
        }

        // 2. Identify orphan notes (notes with 0 connections)
        const hasConnections = new Set<string>();
        for (const edge of graph.edges || []) {
          if (edge.source) hasConnections.add(edge.source.toLowerCase());
          if (edge.target) hasConnections.add(edge.target.toLowerCase());
        }

        const allNotesList = getAllVaultNotes(fileTree);
        const orphanNodes: any[] = (graph.nodes || []).filter(
          (node: any) => node.id && !hasConnections.has(node.id.toLowerCase()) && node.path
        );

        // 3. Load contents of orphans if they are queried
        if ((isOrphanQuery || isVaultWideLinking) && orphanNodes.length > 0) {
          const orphansToLoad = orphanNodes
            .filter(o => !explicitNotes.some(n => n.path === o.path));
          
          await Promise.all(
            orphansToLoad.map(async (orphan) => {
              try {
                const content = await (window as any).electronAPI.readFile(orphan.path);
                explicitNotes.push({ path: orphan.path, title: orphan.name, content });
              } catch (err) {
                console.warn(`[SpacesPage] Failed to read orphan file: ${orphan.path}`, err);
              }
            })
          );
        }

        // 4. Inject a comprehensive vault list summary into the query context
        const notesSummary = allNotesList
          .map(n => {
            const nodeKey = n.title.toLowerCase();
            const isOrphan = orphanNodes.some((o: any) => o.id && o.id.toLowerCase() === nodeKey);
            const status = isOrphan ? " [ORPHAN - No links]" : "";
            return `- Note: "${n.title}" (Path: "${n.path}")${status}`;
          })
          .join("\n");

        finalQuery += `\n\n--- VAULT STRUCTURE SUMMARY ---\nHere is the current directory structure and connectivity of the vault:\n${notesSummary}\n\n`;
        finalQuery += `IMPORTANT UPDATING INSTRUCTIONS:\n`;
        finalQuery += `1. There are ${orphanNodes.length} orphan notes in total. The full content of all ${orphanNodes.length} notes has been loaded for your direct edit access.\n`;
        finalQuery += `2. You should update ALL orphan notes in a single go by using Option B (search-and-replace patches) under 'changes'. Simply search for a specific line (e.g. the main heading or the end of the note) and replace it with that line plus the new [[Wiki Link]]. This allows you to process all files in a single response quickly. Only use Option A (full file updates) if you are editing 1-2 notes maximum.\n`;
        finalQuery += `3. Do not use emojis in the responses, titles, paths, or contents.`;
      }
      } // end canMutateSpaceSource guard

      if (isReadOnlySourceSpace && isDirectSourceEditRequest(q)) {
        finalQuery += `\n\nREAD-ONLY EDIT REQUEST HANDLING:\nThe user is asking to edit an existing source note in a public/read-only space. Do not output an action block. Reply in visible markdown. Say that direct edits are blocked, then offer useful follow-ups: draft changes, summarize/save as a new local note, or Remix to edit directly.`;
      }

      const spaceMeta: SpaceMetadata = {
        title: activeSpace.title,
        description: activeSpace.description,
        helpsWith: activeSpace.helpsWith || [],
        explicitNotes: explicitNotes.length > 0 ? explicitNotes : undefined,
        allowLocalNoteCreation: canCreateLocalNotesFromSpace,
        readOnly: isReadOnlySourceSpace,
      };
      const result = await querySpaceStreaming(activeSpaceId, finalQuery, spaceMeta, chatMessages, (chunk) => {
        accumulatedAnswer += chunk;
        setStreamingText(accumulatedAnswer);
      }, controller.signal);
      const resultPayload = parseActionPayload(result.answer);
      const visibleAnswer = stripJSONBlock(result.answer).trim();
      const answerWasBlockedSourceMutation = isReadOnlySourceSpace && !!resultPayload && payloadRequiresSourceMutation(resultPayload);
      const shouldUseReadOnlyFallback = isReadOnlySourceSpace && (
        answerWasBlockedSourceMutation ||
        (!visibleAnswer && isDirectSourceEditRequest(q))
      );
      const finalAnswer = shouldUseReadOnlyFallback
        ? buildReadOnlyEditResponse(q, result.sources.map((s) => s.noteTitle))
        : result.answer;

      const assistantMsg: SpaceChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: finalAnswer,
        sources: result.sources.map((s) => s.noteTitle),
        timestamp: Date.now(),
      };
      setChatMessages((prev) => {
        const next = [...prev, assistantMsg];
        saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
        return next;
      });
      setStreamingText("");
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        if (accumulatedAnswer.trim()) {
          const abortedMsg: SpaceChatMessage = {
            id: `msg-${Date.now()}-resp`,
            role: "assistant",
            content: accumulatedAnswer.trim() + " [Generation Stopped]",
            sources: [],
            timestamp: Date.now(),
          };
          setChatMessages((prev) => {
            const next = [...prev, abortedMsg];
            saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
            return next;
          });
        }
      } else {
        const errMsg: SpaceChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Query failed"}`,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => {
          const next = [...prev, errMsg];
          saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
          return next;
        });
      }
      setStreamingText("");
    } finally {
      abortControllerRef.current = null;
      setIsQuerying(false);
    }
  }, [chatInput, activeSpaceId, activeSpace, isQuerying, fileTree, chatMessages, activeConversationId, conversations]);

  // ── Applied Actions state ─────────────────────────────
  const [appliedActions, setAppliedActions] = useState<Record<string, boolean>>({});

  // ── Dashboard Operations Click Handlers ────────────────
  const handleGenerateSummary = useCallback(async () => {
    if (!activeSpace) return;
    const instruction = isReadOnlySourceSpace
      ? "Create a new local vault note that summarizes this public/read-only space. Do not edit the source space. Return this only as a create_note action block with a clear title and complete markdown content."
      : "Generate a comprehensive, highly structured space_summary.md file for the entire active space, synthesizing all key concepts, notes, and topics in the structured multi-note synthesis format: # Topic, ## Key Ideas, ## Insights, ## Gaps, ## Suggested Actions. Return this only as a create_note action block.";
    await handleChat(instruction);
  }, [handleChat, activeSpace, isReadOnlySourceSpace]);

  const handleFindInsights = useCallback(async () => {
    if (!activeSpace) return;
    const instruction = isReadOnlySourceSpace
      ? "Analyze all notes in this public/read-only space. Find repeated ideas, direct contradictions, missing definitions, and knowledge gaps. Create a new local vault note containing the insight report. Do not edit the source space. Return this only as a create_note action block."
      : "Analyze all notes in this space. Find repeated ideas, direct contradictions, and missing definitions or knowledge gaps. Generate an insight report detailing these findings. Return this as an insight_report action block.";
    await handleChat(instruction);
  }, [handleChat, activeSpace, isReadOnlySourceSpace]);

  const handleOrganizeSpace = useCallback(async () => {
    if (!activeSpace) return;
    if (!canMutateSpaceSource) {
      showToast("Public/read-only spaces cannot be organized directly. Remix the space to edit it.", "error");
      return;
    }
    await handleChat("Examine the titles, folders, and contents of the notes in this space. Suggest note mergers for duplicate topics, title improvements, and folder restructuring changes to improve coherence and indexing. Return this as a suggest_structure action block.");
  }, [handleChat, activeSpace, canMutateSpaceSource, showToast]);

  const executeSaveAsNote = async () => {
    if (!saveNoteMessage) return;
    try {
      const content = stripJSONBlock(saveNoteMessage.content);
      if (!content) {
        showToast("No content to save", "error");
        return;
      }

      const trimmedTitle = saveNoteTitle.trim();
      if (!trimmedTitle) {
        showToast("Note title cannot be empty", "error");
        return;
      }

      let notePath = trimmedTitle;
      if (!notePath.toLowerCase().endsWith(".md")) {
        notePath += ".md";
      }

      const exists = await (window as any).electronAPI.fileExists(notePath);
      if (exists) {
        const overwrite = window.confirm(`Note "${notePath}" already exists. Overwrite?`);
        if (!overwrite) return;
      }

      await (window as any).electronAPI.writeFile(notePath, content);
      showToast(`Saved to note "${notePath}"!`, "success");
      setSaveNoteMessage(null);
      if (canMutateSpaceSource) handleBuildIndex();
    } catch (err) {
      showToast("Failed to save note: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleSaveAsNote = (msg: SpaceChatMessage) => {
    const content = stripJSONBlock(msg.content);
    if (!content) {
      showToast("No content to save", "error");
      return;
    }

    // Generate a default title from preceding user query
    let defaultTitle = "";
    const msgIndex = chatMessages.findIndex(m => m.id === msg.id);
    if (msgIndex !== -1) {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (chatMessages[i].role === "user") {
          defaultTitle = chatMessages[i].content
            .replace(/[#*`[\]]/g, "") // strip markdown
            .replace(/[\/\\]/g, " ")  // strip path separators
            .trim()
            .substring(0, 40)
            .trim();
          break;
        }
      }
    }

    if (!defaultTitle) {
      defaultTitle = "AI Response";
    }

    setSaveNoteTitle(defaultTitle);
    setSaveNoteMessage(msg);
  };

  // ── Filesystem Action Executors ───────────────────────
  const handleCreateNoteAction = async (title: string, path: string, content: string, msgId: string) => {
    try {
      let notePath = path || `${title}.md`;
      if (!notePath.endsWith(".md")) notePath += ".md";

      const exists = await (window as any).electronAPI.fileExists(notePath);
      if (exists) {
        const overwrite = window.confirm(`Note "${notePath}" already exists. Overwrite?`);
        if (!overwrite) return;
      }

      await (window as any).electronAPI.writeFile(notePath, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Note "${notePath}" created successfully!`);
      if (canMutateSpaceSource) handleBuildIndex();
    } catch (err) {
      showToast("Failed to create note: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleUpdateNoteAction = async (path: string, content: string, msgId: string) => {
    if (!canMutateSpaceSource) {
      showToast("This space is read-only. Direct source-note edits are blocked; save a new local note or Remix to edit.", "error");
      return;
    }
    try {
      const exists = await (window as any).electronAPI.fileExists(path);
      if (!exists) {
        showToast(`Note "${path}" does not exist to update. Creating it instead.`, "success");
      }
      await (window as any).electronAPI.writeFile(path, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Note "${path}" updated successfully!`);
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to update note: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleInsertLinksAction = async (links: Array<{ from: string, to: string, reason: string }>, msgId: string) => {
    if (!canMutateSpaceSource) {
      showToast("This space is read-only. Link insertion would edit source notes, so it was blocked.", "error");
      return;
    }
    try {
      for (const link of links) {
        let fromPath = link.from;
        if (!fromPath.endsWith(".md")) fromPath += ".md";
        let toTitle = link.to.replace(/\.md$/, "");

        const exists = await (window as any).electronAPI.fileExists(fromPath);
        if (exists) {
          const originalContent = await (window as any).electronAPI.readFile(fromPath);
          const linkText = `\n\n%% AI Suggestion: ${link.reason} %%\n[[${toTitle}]]\n`;
          await (window as any).electronAPI.writeFile(fromPath, originalContent + linkText);
        }
      }
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast("Wiki-links inserted successfully!");
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to insert links: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleApplyStructureAction = async (changes: any[], msgId: string) => {
    if (!canMutateSpaceSource) {
      showToast("This space is read-only. Restructuring source notes is blocked; Remix to edit.", "error");
      return;
    }
    try {
      for (const change of changes) {
        if (change.type === "rename" || change.type === "move") {
          let oldPath = change.note;
          let newPath = change.target;
          if (!oldPath.endsWith(".md")) oldPath += ".md";
          if (!newPath.endsWith(".md")) newPath += ".md";

          const exists = await (window as any).electronAPI.fileExists(oldPath);
          if (exists) {
            await (window as any).electronAPI.renameFile(oldPath, newPath);
          }
        } else if (change.type === "merge") {
          const targetTitle = change.target;
          let targetPath = `${targetTitle}.md`;
          const mergedContent = change.content;

          await (window as any).electronAPI.writeFile(targetPath, mergedContent);

          for (const srcNote of change.notes) {
            let srcPath = srcNote;
            if (!srcPath.endsWith(".md")) srcPath += ".md";
            const srcExists = await (window as any).electronAPI.fileExists(srcPath);
            if (srcExists) {
              await (window as any).electronAPI.deleteFile(srcPath);
            }
          }
        }
      }
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast("Restructuring applied successfully!");
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to apply restructuring: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleSaveInsightsAction = async (insights: any[], msgId: string) => {
    try {
      if (!activeSpace) return;
      const timestamp = new Date().toLocaleDateString();
      const path = `Insights - ${activeSpace.title}.md`;
      let content = `# Space Insight Report: ${activeSpace.title}\n*Generated by AI Operator on ${timestamp}*\n\n`;

      insights.forEach((insight, idx) => {
        content += `### ${idx + 1}. [${insight.type.toUpperCase()}] ${insight.description}\n`;
        if (insight.notes && insight.notes.length > 0) {
          content += `*Related Notes:* ${insight.notes.map((n: string) => `[[${n.replace(/\.md$/, "")}]]`).join(", ")}\n`;
        }
        content += `\n`;
      });

      await (window as any).electronAPI.writeFile(path, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Insight report created as "${path}"!`);
      if (canMutateSpaceSource) handleBuildIndex();
    } catch (err) {
      showToast("Failed to save report: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const ensureCloudSourceNoteAvailable = useCallback(async (notePath: string): Promise<boolean> => {
    const api = getAPI();
    const localExists = await api.fileExists(notePath).catch(() => false);
    if (localExists) return true;

    if (!activeSpace || activeSpace.visibility === "local" || !activeSpaceId || !isSupabaseConfigured) {
      return false;
    }

    const { data, error } = await supabase
      .from("notes" as any)
      .select("id, path, title, content, content_encrypted, iv, auth_tag, encryption_version, version, is_canvas")
      .eq("space_id", activeSpaceId)
      .eq("path", notePath)
      .eq("deleted", false)
      .limit(1);

    if (error) throw error;

    const notes = data as any[] | null;
    const note = Array.isArray(notes) ? notes[0] : null;
    if (!note) return false;

    const content = activeSpace.visibility === "private"
      ? await privateCrypto.decryptNoteContent(activeSpaceId, note)
      : note.content || "";

    const parentPath = notePath.split("/").slice(0, -1).join("/");
    if (parentPath) {
      let currentPath = "";
      for (const part of parentPath.split("/").filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        await api.createDirectory(currentPath).catch(() => undefined);
      }
    }

    await api.writeFile(notePath, content);
    showToast(`Downloaded "${note.title || notePath}" from this Space.`);
    return true;
  }, [activeSpace, activeSpaceId, showToast]);

  const handleOpenSource = useCallback(async (noteTitle: string, chunkText: string, notePathOverride?: string) => {
    let notePath = normalizeSourcePath(notePathOverride || "");
    const searchTree = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.isFolder || node.isDirectory) {
          searchTree(node.children || []);
        } else if (node.name.replace(/\.md$/, "") === noteTitle.replace(/\.md$/, "")) {
          notePath = node.path;
          break;
        }
      }
    };

    if (!notePath) {
      searchTree(fileTree || []);
    }

    if (!notePath) {
      notePath = normalizeSourcePath(`${noteTitle}.md`);
    }

    try {
      const sourceAvailable = await ensureCloudSourceNoteAvailable(notePath);
      if (
        activeSpace &&
        activeSpace.visibility !== "local" &&
        isSupabaseConfigured &&
        !sourceAvailable
      ) {
        showToast(`Could not find "${noteTitle}" in this Space.`, "error");
        return;
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to download source note.", "error");
      return;
    }

    onOpenNote?.(notePath);

    if (chunkText) {
      setTimeout(() => {
        const event = new CustomEvent("editor:highlight-text", {
          detail: { path: notePath, text: chunkText }
        });
        document.dispatchEvent(event);
      }, 300);
    }
  }, [activeSpace, ensureCloudSourceNoteAvailable, fileTree, onOpenNote, showToast]);

  const resolveActionContent = async (action: any): Promise<{ before: string, after: string }> => {
    let filePath = action.file_path || action.path || "";
    if (filePath.startsWith("/")) filePath = filePath.substring(1);

    let before = action.changes?.before || "";
    let after = action.changes?.after || action.content || "";

    if (action.changes?.search !== undefined && action.changes?.replace !== undefined) {
      try {
        before = await getAPI().readFile(filePath) || "";
        after = before.replace(action.changes.search, action.changes.replace);
      } catch (err) {
        console.warn(`[SpacesPage] Failed to read file for patch: ${filePath}`, err);
      }
    } else if (!before && filePath) {
      try {
        before = await getAPI().readFile(filePath) || "";
      } catch (err) {
        // Fallback
      }
    }
    return { before, after };
  };

  const handleApplySingleAction = async (action: any, msgId: string, actionIndex?: number) => {
    const isMulti = actionIndex !== undefined;
    const key = isMulti ? `${msgId}-${actionIndex}` : msgId;
    
    try {
      if (action.type === "create_note") {
        let notePath = action.path || `${action.title}.md`;
        if (notePath.endsWith("/")) {
          notePath = notePath + (action.title || "Untitled");
        }
        if (!notePath.endsWith(".md")) notePath += ".md";

        if (notePath.startsWith("/")) {
          notePath = notePath.substring(1);
        }

        const exists = await getAPI().fileExists(notePath);
        if (exists) {
          const overwrite = window.confirm(`Note "${notePath}" already exists. Overwrite?`);
          if (!overwrite) return false;
        }

        await getAPI().writeFile(notePath, action.content);
        
        if (canMutateSpaceSource && collaborationEngine.activeSpaceId) {
          await collaborationEngine.persistNoteEdit(notePath, action.content);
          syncEngine.triggerPush();
        }

        setAppliedActions(prev => ({ ...prev, [key]: true }));
        showToast(`Note "${notePath}" created successfully!`);
      } else if (action.type === "update_note") {
        if (!canMutateSpaceSource) {
          showToast("This space is read-only. Direct source-note edits are blocked; save a new local note or Remix to edit.", "error");
          return false;
        }
        let notePath = action.file_path || action.path;
        if (notePath.startsWith("/")) {
          notePath = notePath.substring(1);
        }

        const { after: afterContent } = await resolveActionContent(action);
        await getAPI().writeFile(notePath, afterContent);
        
        if (canMutateSpaceSource && collaborationEngine.activeSpaceId) {
          await collaborationEngine.persistNoteEdit(notePath, afterContent);
          syncEngine.triggerPush();
        }

        setAppliedActions(prev => ({ ...prev, [key]: true }));
        showToast(`Note "${notePath}" updated successfully!`);
      }
      
      if (canMutateSpaceSource) handleBuildIndex();
      return true;
    } catch (err) {
      showToast("Failed to execute action: " + (err instanceof Error ? err.message : "Unknown error"), "error");
      return false;
    }
  };

  const handleApplyAllActions = async (actions: any[], msgId: string) => {
    let successCount = 0;
    for (let i = 0; i < actions.length; i++) {
      const success = await handleApplySingleAction(actions[i], msgId, i);
      if (success) successCount++;
    }
    if (successCount === actions.length) {
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
    }
    showToast(`Applied ${successCount} of ${actions.length} actions.`);
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionDropdown && filteredNotes.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev + 1) % filteredNotes.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev - 1 + filteredNotes.length) % filteredNotes.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectNote(filteredNotes[mentionActiveIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionDropdown(false);
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChat();
      }
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatMessages.length > 0 || streamingText) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chatMessages, streamingText]);

  // Dynamically adjust textarea height based on content
  useEffect(() => {
    const adjustHeight = (textarea: HTMLTextAreaElement | null) => {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    adjustHeight(centralInputRef.current);
    adjustHeight(bottomInputRef.current);
  }, [chatInput]);

  // ── Tag input ────────────────────────────────────────
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && createTagInput.trim()) {
      e.preventDefault();
      const tag = createTagInput.trim().replace(/,/g, "");
      if (tag && !createTags.includes(tag)) {
        setCreateTags((prev) => [...prev, tag]);
      }
      setCreateTagInput("");
    }
    if (e.key === "Backspace" && !createTagInput && createTags.length > 0) {
      setCreateTags((prev) => prev.slice(0, -1));
    }
  };

  // ── Filtering and Search inside Marketplace ─────────
  const filteredSpaces = spaces.filter((s) => {
    const matchesSearch =
      s.title.toLowerCase().includes(marketSearch.toLowerCase()) ||
      (s.description || "").toLowerCase().includes(marketSearch.toLowerCase()) ||
      (s.helpsWith || []).some(t => t.toLowerCase().includes(marketSearch.toLowerCase()));

    if (marketFilter === "local") {
      return matchesSearch && s.visibility === "local";
    }
    if (marketFilter === "private") {
      return matchesSearch && s.visibility === "private";
    }
    if (marketFilter === "public") {
      return matchesSearch && s.visibility === "public";
    }
    return matchesSearch;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Marketplace View
  // ═══════════════════════════════════════════════════════════════════════════

  if (view === "marketplace") {
    return (
      <div className={spacesPageClass}>
        {/* Toast Notification */}
        {toastMessage && (
          <div
            className={cx(spaceToastBaseClass, toastType === "success" ? spaceToastSuccessClass : spaceToastErrorClass)}
            onClick={() => setToastMessage(null)}
          >
            {toastMessage}
          </div>
        )}

        <div className={marketplaceContainerClass}>
          {/* Left Sidebar Panel */}
          <div className={marketplaceSidebarClass}>
            <div className={spacesBrandClass}>
              <h1 className={spacesBrandTitleClass}>Spaces</h1>
              <p className={spacesBrandSubtitleClass}>Private knowledge layers across your vault.</p>
            </div>

            <div className={spacesMenuListClass}>
              <button
                className={spaceSidebarNewBtnClass}
                onClick={() => setShowCreateModal(true)}
              >
                New Space
              </button>
              <button
                className={cx(spacesMenuItemClass, marketFilter === "all" && spacesMenuItemActiveClass)}
                onClick={() => setMarketFilter("all")}
              >
                All Spaces
              </button>
              <button
                className={cx(spacesMenuItemClass, marketFilter === "local" && spacesMenuItemActiveClass)}
                onClick={() => setMarketFilter("local")}
              >
                Local Spaces
              </button>
              <button
                className={cx(spacesMenuItemClass, marketFilter === "private" && spacesMenuItemActiveClass)}
                onClick={() => setMarketFilter("private")}
              >
                Private Spaces
              </button>
              <button
                className={cx(spacesMenuItemClass, marketFilter === "public" && spacesMenuItemActiveClass)}
                onClick={() => setMarketFilter("public")}
              >
                Public Spaces
              </button>
            </div>

            {/* Cloud User Profile status in Sidebar */}
            <div className={spacesUserSectionClass}>
              <div className={spacesUserStatusClass}>
                {isSupabaseConfigured
                  ? authEmail
                    ? `Cloud connected: ${authEmail}`
                    : "Cloud database online. Sign in for sync."
                  : "Cloud offline (Local Mode)"}
              </div>
              <div>
                {authEmail ? (
                  <button className={cx(spaceBtnGhostClass, spaceBtnSmClass, "w-full px-3 py-1.5 text-[11px]")} onClick={handleSignOut}>
                    Sign out
                  </button>
                ) : (
                  <button
                    className={cx(spaceBtnGhostClass, spaceBtnSmClass, "w-full px-3 py-1.5 text-[11px]")}
                    onClick={() => {
                      setAuthMessage("Sign in to sync your knowledge layers with the cloud.");
                      setShowAuthModal(true);
                    }}
                    disabled={!isSupabaseConfigured}
                    title={!isSupabaseConfigured ? "Configure Supabase in Settings > Database to enable cloud database" : undefined}
                  >
                    Sign in
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className={marketplaceContentClass}>
            <div className={marketplaceHeaderClass}>
              <div className={spacesSearchWrapperClass}>
                <input
                  type="text"
                  placeholder="Search spaces"
                  className={spacesSearchInputClass}
                  value={marketSearch}
                  onChange={(e) => setMarketSearch(e.target.value)}
                />
              </div>

              <div className={marketplaceHeaderRightClass}>
                <div className={marketplaceStatsClass}>
                  Vault Notes: {vaultNoteCount} | Custom Layers: {spaces.length}
                </div>
                <button className={spacesCloseBtnClass} onClick={onClose}>
                  Close
                </button>
              </div>
            </div>

            {/* Main Body */}
            <div className={spacesBodyClass}>
              {filteredSpaces.length === 0 ? (
                <div className={spacesEmptyClass}>
                  <p className={spacesEmptyTextClass}>
                    {marketSearch
                      ? `No spaces matched the query "${marketSearch}".`
                      : `Build your first queryable AI knowledge layer over your ${vaultNoteCount} notes.`}
                  </p>
                  {!marketSearch && (
                    <button className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)} onClick={() => setShowCreateModal(true)}>
                      Create a Space
                    </button>
                  )}
                </div>
              ) : (
                <div className={spacesGridClass}>
                  <div className={spacesTableHeadClass} aria-hidden="true">
                    <span>Space</span>
                    <span>Description</span>
                    <span>Access</span>
                    <span>Notes</span>
                    <span>Actions</span>
                  </div>
                  {filteredSpaces.map((s) => (
                    <div key={s.id} className={spaceCardClass} onClick={() => openSpace(s.id)}>
                      <div className={spaceCardMainClass}>
                        <h3 className={spaceCardTitleClass}>{s.title}</h3>

                        {(s.helpsWith || []).length > 0 && (
                          <div className={spaceCardTagsClass}>
                            {(s.helpsWith || []).map((tag) => (
                              <span key={tag} className={spaceTagClass}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      <p className={spaceCardDescriptionClass}>
                        {s.description || "No description added."}
                      </p>

                      <span className={visibilityBadgeClasses[s.visibility]}>
                        {getVisibilityLabel(s.visibility)}
                      </span>

                      <div className={spaceCardMetaClass}>
                        <div className={spaceCardMetaLeftClass}>
                          <span>{s.noteCount} note{s.noteCount !== 1 ? "s" : ""}</span>
                        </div>
                      </div>

                      <div className={spaceCardActionsClass} onClick={(e) => e.stopPropagation()}>
                        <button className={spaceCardActionBtnClass} onClick={() => handleFork(s.id)} title="Remix/Save Space">
                          Remix
                        </button>
                        <button className={spaceCardActionBtnClass} onClick={() => setDeleteConfirmId(s.id)} title="Delete Space">
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Create Space Dialog Modal */}
        {showCreateModal && (
          <div className={modalOverlayClass} onClick={() => setShowCreateModal(false)}>
            <div className={modalContentClass} onClick={(e) => e.stopPropagation()}>
              <div className={modalHeaderClass}>
                <h3 className={modalTitleClass}>New Knowledge Space</h3>
                <button className={modalCloseClass} onClick={() => setShowCreateModal(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className={spaceCreateFormClass}>
                <div className={spaceFormHintClass}>
                  Creates an AI-queryable vector directory indexing all {vaultNoteCount} notes in your active vault.
                </div>

                <div className={spaceFormFieldClass}>
                  <label className={spaceFormLabelClass}>Title</label>
                  <input
                    className={spaceFormInputClass}
                    placeholder="e.g. Research Hub, React Dev"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className={spaceFormFieldClass}>
                  <label className={spaceFormLabelClass}>Description</label>
                  <textarea
                    className={spaceFormTextareaClass}
                    placeholder="Describe the knowledge covered by this space..."
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                  />
                </div>

                <div className={spaceFormFieldClass}>
                  <label className={spaceFormLabelClass}>Focus Tags (Press Enter / Comma)</label>
                  <div className={spaceFormTagsInputClass}>
                    {createTags.map((tag) => (
                      <span key={tag} className={spaceFormTagClass}>
                        {tag}
                        <button className={spaceFormTagRemoveClass} onClick={() => setCreateTags((prev) => prev.filter((t) => t !== tag))}>
                          <X size={8} />
                        </button>
                      </span>
                    ))}
                    <input
                      className={spaceFormTagInputClass}
                      placeholder={createTags.length === 0 ? "e.g. backend, hooks, styling" : ""}
                      value={createTagInput}
                      onChange={(e) => setCreateTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                    />
                  </div>
                </div>

                <div className={spaceFormFieldClass}>
                  <label className={spaceFormLabelClass}>Vault Visibility</label>
                  <div className={spaceVisibilityOptionsClass}>
                    <button
                      type="button"
                      className={cx(spaceVisibilityOptionClass, createVisibility === "local" && spaceVisibilityOptionActiveClass)}
                      onClick={() => setCreateVisibility("local")}
                    >
                      Local-Only
                    </button>
                    <button
                      type="button"
                      className={cx(spaceVisibilityOptionClass, createVisibility === "private" && spaceVisibilityOptionActiveClass)}
                      onClick={() => setCreateVisibility("private")}
                      disabled={!isSupabaseConfigured}
                    >
                      Private Cloud
                    </button>
                    <button
                      type="button"
                      className={cx(spaceVisibilityOptionClass, createVisibility === "public" && spaceVisibilityOptionActiveClass)}
                      onClick={() => setCreateVisibility("public")}
                      disabled={!isSupabaseConfigured}
                    >
                      Public Cloud
                    </button>
                  </div>
                  <div className={spaceFormHintClass}>
                    {createVisibility === "local"
                      ? "Securely cached on this local device only."
                      : createVisibility === "private"
                        ? "Encrypted & synced. Access restricted to your logged account."
                        : "Published dynamically. Discoverable and remixable by others."}
                  </div>
                  {!isSupabaseConfigured && (
                    <div className={cx(spaceFormHintClass, spaceFormWarningClass)}>
                      Configure Supabase in Settings &gt; Database to toggle remote features.
                    </div>
                  )}
                </div>

                {createVisibility === "private" && (
                  <div className={spaceFormFieldClass}>
                    <label className={spaceFormLabelClass}>Encryption Password</label>
                    <input
                      className={spaceFormInputClass}
                      type="password"
                      placeholder="Required to unlock this private space"
                      value={createEncryptionPassword}
                      onChange={(e) => setCreateEncryptionPassword(e.target.value)}
                    />
                    <div className={cx(spaceFormHintClass, spaceFormWarningClass)}>
                      Recovery warning: this password cannot be recovered. Changing it only re-encrypts the space key.
                    </div>
                  </div>
                )}

                {createError && <div className={spaceFormErrorClass}>{createError}</div>}

                <div className={spaceFormActionsClass}>
                  <button className={cx(spaceBtnGhostClass, spaceBtnSmClass)} onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button
                    className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                    onClick={handleCreate}
                    disabled={!createTitle.trim() || (createVisibility === "private" && createEncryptionPassword.length < 8)}
                  >
                    Create Space
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {deleteConfirmId && (() => {
          const spaceToDelete = spaces.find(s => s.id === deleteConfirmId);
          const isCloud = spaceToDelete && spaceToDelete.visibility !== "local";
          const currentUserId = authManager.getUserId();
          const isOwner = spaceToDelete && currentUserId && spaceToDelete.ownerId === currentUserId;
          const canDelete = !isCloud || (authManager.isLoggedIn() && isOwner);

          return (
            <div className={modalOverlayClass} onClick={() => setDeleteConfirmId(null)}>
              <div className={`${modalContentClass} max-w-[380px]`} onClick={(e) => e.stopPropagation()}>
                <div className={modalHeaderClass}>
                  <h3 className={modalTitleClass}>Delete Space</h3>
                  <button className={modalCloseClass} onClick={() => setDeleteConfirmId(null)}>
                    <X size={15} />
                  </button>
                </div>
                <div className="flex flex-col gap-3.5 p-6">
                  <p className="m-0 text-[13px] leading-normal text-[var(--text-secondary)]">
                    Are you sure you want to delete <strong>{spaceToDelete?.title || "this layer"}</strong>?
                    {" "}
                    {spaceToDelete?.visibility === "local"
                      ? "This action clears all local index tables."
                      : isOwner
                        ? "This will permanently remove the indices from cloud registers."
                        : ""}
                  </p>

                  {isCloud && !authManager.isLoggedIn() && (
                    <p className="m-0 text-[11px] text-[var(--text-muted)]">
                      Account authentication is required to modify cloud states.
                    </p>
                  )}

                  {isCloud && authManager.isLoggedIn() && !isOwner && (
                    <p className="m-0 text-[11px] text-[#e8a838]">
                      Only space authors can delete this layer from cloud directory.
                    </p>
                  )}

                  <div className={spaceFormActionsClass}>
                    <button className={cx(spaceBtnGhostClass, spaceBtnSmClass)} onClick={() => setDeleteConfirmId(null)}>
                      Cancel
                    </button>
                    <button
                      className={cx(spaceBtnPrimaryClass, spaceBtnDangerClass, spaceBtnSmClass)}
                      onClick={() => handleDelete(deleteConfirmId)}
                      disabled={!canDelete}
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={() => {
              setShowAuthModal(false);
              refreshSpaces();
            }}
            message={authMessage}
          />
        )}

        {/* Unlock Private Space Modal */}
        {unlockSpaceId && (() => {
          const spaceToUnlock = spaces.find(s => s.id === unlockSpaceId);
          return (
            <div className={modalOverlayClass} onClick={() => {
              setUnlockSpaceId(null);
              setUnlockPassword("");
              setUnlockError(null);
            }}>
              <div className={`${modalContentClass} max-w-[380px]`} onClick={(e) => e.stopPropagation()}>
                <div className={modalHeaderClass}>
                  <h3 className={modalTitleClass}>Unlock Private Space</h3>
                  <button className={modalCloseClass} onClick={() => {
                    setUnlockSpaceId(null);
                    setUnlockPassword("");
                    setUnlockError(null);
                  }}>
                    <X size={15} />
                  </button>
                </div>
                <div className="flex flex-col gap-3.5 p-5">
                  <p className="m-0 text-[13px] leading-normal text-[var(--text-secondary)]">
                    Enter the password to unlock the private space <strong>{spaceToUnlock?.title || "this space"}</strong>.
                  </p>
                  
                  <div className={spaceFormFieldClass}>
                    <label className={spaceFormLabelClass}>Encryption Password</label>
                    <input
                      className={spaceFormInputClass}
                      type="password"
                      placeholder="Password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && unlockPassword.trim()) {
                          e.preventDefault();
                          handleUnlockSpace();
                        }
                      }}
                      autoFocus
                    />
                  </div>

                  {unlockError && <div className={spaceFormErrorClass}>{unlockError}</div>}

                  <div className={spaceFormActionsClass}>
                    <button className={cx(spaceBtnGhostClass, spaceBtnSmClass)} onClick={() => {
                      setUnlockSpaceId(null);
                      setUnlockPassword("");
                      setUnlockError(null);
                    }}>
                      Cancel
                    </button>
                    <button
                      className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                      onClick={handleUnlockSpace}
                      disabled={unlocking || !unlockPassword.trim()}
                    >
                      {unlocking ? "Unlocking..." : "Unlock"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {isRemixing && remixProgress && (
          <div className="fixed inset-0 z-55 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-sm p-6 rounded-2xl bg-[#0f0f10] border border-neutral-800 text-neutral-200 shadow-2xl flex flex-col items-center">
              <h3 className="text-base font-semibold text-neutral-100 mb-2">Remixing Space</h3>
              <p className="text-xs text-neutral-400 mb-5 text-center leading-relaxed">
                Downloading and saving note resources locally...
              </p>
              
              <div className="w-full bg-[#18181b] h-2 rounded-full overflow-hidden mb-3.5 border border-neutral-800/80">
                <div 
                  className="bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.round((remixProgress.done / remixProgress.total) * 100)}%` }}
                />
              </div>
              
              <div className="text-sm font-semibold text-neutral-200">
                {Math.round((remixProgress.done / remixProgress.total) * 100)}%
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">
                ({remixProgress.done} of {remixProgress.total} notes)
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Space View (Dual-Column Overhaul)
  // ═══════════════════════════════════════════════════════════════════════════

  if (!activeSpace) return null;
  const welcomeGreeting = `Explore ${activeSpace.title}`;

  return (
    <div className={spacesPageClass}>
      {/* Dual Column Workspace Container */}
      <div className={spaceWorkspaceClass}>
        
        {/* LEFT COLUMN: Sidebar (ChatGPT-Inspired Details & Notes Explorer) */}
        <div className={spaceViewSidebarClass}>
          {/* ChatGPT-style Sidebar Header Actions */}
          <div className={spaceSidebarActionsClass}>
            <button
              className={cx(spaceSidebarBtnClass, spaceSidebarBtnPrimaryClass)}
              onClick={handleNewConversation}
              title="Start a new AI conversation session"
            >
              <Plus size={14} />
              <span>New chat</span>
            </button>

            <button
              className={spaceSidebarBtnClass}
              onClick={() => {
                setView("marketplace");
                setActiveSpace(null);
                setActiveSpaceId(null);
                activeSpaceIdRef.current = null;
                setActiveConversationId(null);
                activeConversationIdRef.current = null;
                setConversations([]);
                setChatMessages([]);
                setIsIndexed(false);
              }}
              title="Return to the spaces marketplace directory"
            >
              <ArrowLeft size={14} />
              <span>Back to Spaces</span>
            </button>
          </div>

          {/* Space Information Details block */}
          <div className={spaceSidebarSectionClass}>
            <div className={spaceSidebarSectionHeaderClass}>Space Layer</div>
            <div className={spaceProjectCardClass}>
              <div className={spaceProjectHeaderClass}>
                <span className={visibilityBadgeClasses[activeSpace.visibility]}>
                  {getVisibilityLabel(activeSpace.visibility)}
                </span>
                <span className={spaceProjectTitleClass}>{activeSpace.title}</span>
              </div>
              
              {activeSpace.description && (
                <p className={spaceProjectDescriptionClass}>{activeSpace.description}</p>
              )}

              {(activeSpace.helpsWith || []).length > 0 && (
                <div className={spaceProjectTagsClass}>
                  {(activeSpace.helpsWith || []).map((tag) => (
                    <span key={tag} className={spaceProjectTagClass}>{tag}</span>
                  ))}
                </div>
              )}

              <div className={spaceProjectMetaClass}>
                {activeSpace.visibility === "local" 
                  ? `${activeSpace.noteCount || vaultNoteCount} notes indexed` 
                  : `${activeSpace.noteCount ?? 0} notes indexed`}
              </div>

              <div className={spaceProjectActionsClass}>
                {canMutateSpaceSource && (
                  <button
                    className={spaceProjectBtnClass}
                    onClick={handleBuildIndex}
                    disabled={isIndexing}
                    title="Recompute vector indexes over note database"
                  >
                    <RefreshCw size={11} className={isIndexing ? "animate-spin" : ""} />
                    <span>Re-index</span>
                  </button>
                )}
                <button className={spaceProjectBtnClass} onClick={() => handleFork(activeSpace.id)}>
                  <Copy size={11} />
                  <span>Remix</span>
                </button>
              </div>
            </div>
          </div>

          {/* Space Operations Dashboard */}
          <div className={spaceSidebarSectionClass}>
            <div className={spaceSidebarSectionHeaderClass}>
              {isReadOnlySourceSpace ? "Read-only Space" : "Space Operations"}
            </div>
            {isReadOnlySourceSpace && (
              <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] leading-normal text-[var(--text-secondary)]">
                Public spaces are source read-only. You can ask questions and create new notes in your current vault, but direct edits require Remix.
              </div>
            )}
            <div className={spaceOperationsGridClass}>
              <button
                className={spaceOperationsBtnClass}
                onClick={handleGenerateSummary}
                disabled={isQuerying || isIndexing}
                title={isReadOnlySourceSpace ? "Create a new local summary note from this read-only space" : "Synthesize topics across the space into a structured summary note"}
              >
                <Brain size={13} />
                <span>{isReadOnlySourceSpace ? "Save Summary Note" : "Generate Summary"}</span>
              </button>
              <button
                className={spaceOperationsBtnClass}
                onClick={handleFindInsights}
                disabled={isQuerying || isIndexing}
                title={isReadOnlySourceSpace ? "Create a local insight report from this read-only space" : "Look for repeated ideas, gaps, and contradictions in space"}
              >
                <Sparkles size={13} />
                <span>{isReadOnlySourceSpace ? "Save Insight Report" : "Find Insights"}</span>
              </button>
              {canMutateSpaceSource ? (
                <button
                  className={spaceOperationsBtnClass}
                  onClick={handleOrganizeSpace}
                  disabled={isQuerying || isIndexing}
                  title="Suggest renames, mergers, and folder restructuring changes"
                >
                  <Layers size={13} />
                  <span>Organize Space</span>
                </button>
              ) : (
                <button
                  className={spaceOperationsBtnClass}
                  onClick={() => handleFork(activeSpace.id)}
                  disabled={isQuerying || isIndexing}
                  title="Create an editable local copy of this space"
                >
                  <Copy size={13} />
                  <span>Remix to Edit</span>
                </button>
              )}
            </div>
          </div>

          {/* Conversations Explorer Session List */}
          <div className={spaceSidebarFillSectionClass}>
            <div className={spaceSidebarSectionHeaderClass}>
              <span>Conversations</span>
              <span className={spaceSidebarBadgeClass}>{conversations.length}</span>
            </div>

            {conversations.length === 0 ? (
              <div className={spaceSidebarEmptyClass}>
                No chat sessions.
              </div>
            ) : (
              <div className={spaceConversationsListClass}>
                {conversations.map((conv) => {
                  const isActive = activeConversationId === conv.id;
                  return (
                    <div
                      key={conv.id}
                      className={cx(spaceConversationItemClass, isActive && `active ${spaceConversationActiveClass}`)}
                      onClick={() => selectConversation(conv.id)}
                    >
                      <MessageSquare size={13} className={spaceConversationIconClass} />
                      {editingConvId === conv.id ? (
                        <input
                          type="text"
                          className={spaceConversationRenameClass}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => finishRename(conv.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishRename(conv.id);
                            if (e.key === "Escape") cancelRename();
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className={spaceConversationTitleClass} title={conv.title}>{conv.title}</span>
                      )}
                      <div className={spaceConversationActionsClass}>
                        {editingConvId !== conv.id && (
                          <>
                            <button
                              className={spaceConversationActionClass}
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(conv.id, conv.title);
                              }}
                              title="Rename conversation"
                            >
                              <Edit2 size={11} />
                            </button>
                            <button
                              className={cx(spaceConversationActionClass, spaceConversationDeleteClass)}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteConversation(conv.id);
                              }}
                              title="Delete conversation"
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive AI Conversation Interface */}
        <div className={spaceChatContainerClass}>
          {isIndexing && (
            <div className={spaceIndexingIndicatorClass}>
              <Loader2 size={12} className="animate-spin" />
              <span>AI Indexing Vault... ({indexProgress.done}/{indexProgress.total})</span>
            </div>
          )}
          {isLexicalFallbackActive() && (
            <div className="mx-4 my-2 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-secondary)_95%,var(--text-muted)_5%)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <Zap size={14} className="shrink-0 text-[var(--text-muted)]" />
              <span>Using keyword search — semantic model not loaded (offline mode)</span>
            </div>
          )}
          
          <div className={spaceMessagesScrollClass}>
            {chatMessages.length > 0 && <div style={{ marginTop: "auto" }} />}
            {chatMessages.length === 0 && (
              <div className={spaceChatWelcomeClass}>
                <div className={spaceChatWelcomeContentClass}>
                  <h2 className={spaceChatWelcomeTitleClass}>
                    <div className="mr-3 flex items-center justify-center p-2 rounded-xl bg-[#18181b] border border-neutral-800 h-14 w-14 shadow-sm">
                      <img
                        src="logos/logo-dark.png"
                        alt="OpenOnyx"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <span>{welcomeGreeting}</span>
                  </h2>
                  
                  {/* CENTRAL INPUT */}
                  <div className={spaceChatCentralInputClass}>
                    <div className={spaceChatCentralInputWrapperClass}>
                      {showMentionDropdown && filteredNotes.length > 0 && (
                        <div className={mentionDropdownClass}>
                          {filteredNotes.map((note: any, index: number) => (
                            <div
                              key={note.path}
                              className={cx(mentionItemClass, index === mentionActiveIndex && mentionItemActiveClass)}
                              onClick={() => selectNote(note)}
                            >
                              <FileText size={12} className={mentionItemIconClass} />
                              <span className={mentionItemTitleClass}>{note.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        ref={centralInputRef}
                        className={spaceChatCentralTextareaClass}
                        placeholder="How can I help you today?"
                        value={chatInput}
                        onChange={(e) => {
                          setChatInput(e.target.value);
                          checkForMention(e.target.value, e.target.selectionStart);
                        }}
                        onSelect={(e: any) => {
                          checkForMention(e.target.value, e.target.selectionStart);
                        }}
                        onKeyDown={handleChatKeyDown}
                        rows={1}
                        disabled={isQuerying}
                      />
                      <div className={spaceChatCentralToolbarClass}>
                        <div className={spaceChatCentralLeftActionsClass}>
                          <button
                            type="button"
                            className={spaceChatCentralIconBtnClass}
                            onClick={() => {
                              if (centralInputRef.current) {
                                centralInputRef.current.focus();
                                setChatInput(prev => prev + "[[");
                                checkForMention(chatInput + "[[", chatInput.length + 2);
                              }
                            }}
                            title="Mention note (Type [[)"
                          >
                            <Plus size={17} />
                          </button>
                        </div>
                        <div className={spaceChatCentralRightActionsClass}>
                          {inputTokens > 0 && (
                            <span className={spaceChatTokenCounterClass}>
                              {inputTokens} tokens
                            </span>
                          )}
                          {renderChatModelPicker()}
                          {(chatInput.trim() || isQuerying) && (
                            <button
                              className={cx(spaceChatSendClass, isQuerying && spaceChatAbortClass)}
                              onClick={() => {
                                if (isQuerying) {
                                  handleAbortChat();
                                } else {
                                  handleChat();
                                }
                              }}
                              disabled={!isQuerying && !chatInput.trim()}
                              title={isQuerying ? "Stop generating" : "Send message"}
                            >
                              {isQuerying ? <Square size={10} fill="currentColor" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {!isAIConfigured() && (
                      <div className={spaceChatNoAiClass}>
                        Configure an API key in AI Settings to enable chat queries over vector layers.
                      </div>
                    )}
                  </div>

                  <div className={spaceChatWelcomeSuggestionsClass}>
                    {SPACE_PROMPT_CHIPS.map(({ label, prompt, Icon }) => (
                      <button
                        key={label}
                        className={spaceChatSuggestionClass}
                        onClick={() => {
                          void handleChat(prompt);
                        }}
                        disabled={isQuerying}
                        title={prompt}
                      >
                        <Icon size={15} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Conversation Flow */}
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={cx(
                  spaceChatMessageClass,
                  msg.role === "user" ? spaceChatUserMessageClass : spaceChatAssistantMessageClass,
                )}
              >
                {msg.role === "user" ? (
                  <div className={spaceChatUserBubbleClass}>
                    <div>{msg.content}</div>
                  </div>
                ) : (
                  <>
                    {stripJSONBlock(msg.content) && (
                      <>
                        <div className={spaceChatAssistantContentClass}>
                          <MarkdownPreview
                            content={stripJSONBlock(msg.content)}
                            onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                            constrainWidth={false}
                          />
                        </div>
                        <div className="mt-2 flex items-center">
                          <button
                            onClick={() => handleSaveAsNote(msg)}
                            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] cursor-pointer"
                            title="Save this response as a new note in your vault"
                          >
                            <FileText size={13} className="text-[var(--accent-primary)]" />
                            <span>Save as a note</span>
                          </button>
                        </div>
                      </>
                    )}

                    {/* Render Interactive Action Cards. Read-only spaces allow local-note creation only. */}
                    {(() => {
                      const payload = parseActionPayload(msg.content);
                      if (!payload) return null;
                      const mutatesSource = payloadRequiresSourceMutation(payload);
                      const createsLocalNote = payloadCreatesOnlyLocalNotes(payload);

                      if (isReadOnlySourceSpace && mutatesSource) {
                        return (
                          <div className={spaceActionCardClass}>
                            <div className={spaceActionCardHeaderClass}>
                              <Globe size={14} />
                              <span>Public space is read-only</span>
                            </div>
                            <div className={spaceActionCardBodyClass}>
                              <div className={spaceActionDetailsClass}>
                                This action would edit source notes in a public/read-only space, so it was blocked. You can still save a new note in your current vault, ask for a patch suggestion, or Remix this space to make an editable copy.
                              </div>
                              <div className={spaceActionButtonsClass}>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => handleFork(activeSpace.id)}
                                >
                                  Remix to Edit
                                </button>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => handleSaveAsNote(msg)}
                                >
                                  Save Response as Note
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (isReadOnlySourceSpace && !createsLocalNote) return null;
                      
                      const isApplied = appliedActions[msg.id];
                      const isRejected = rejectedActions[msg.id];
                      
                      const intent = payload.intent || payload.action || payload.type;
                      const summary = payload.summary || "AI proposed changes";
                      
                      if (isApplied) {
                        return (
                          <div className={cx(spaceActionCardClass, spaceActionCardAppliedClass)}>
                            <div className={spaceActionCardHeaderClass}>
                              <Check size={14} style={{ color: "var(--success)" }} />
                              <span>{summary}</span>
                              <span className={actionAppliedBadgeClass}>Applied</span>
                            </div>
                          </div>
                        );
                      }
                      
                      if (isRejected) {
                        return (
                          <div className={cx(spaceActionCardClass, spaceActionCardRejectedClass)}>
                            <div className={spaceActionCardHeaderClass}>
                              <X size={14} style={{ color: "var(--error)" }} />
                              <span>{summary}</span>
                              <span className={actionRejectedBadgeClass}>Rejected</span>
                            </div>
                          </div>
                        );
                      }

                      // Create Note flow
                      if (intent === "create_note" || (payload.actions && payload.actions.length === 1 && payload.actions[0].type === "create_note")) {
                        const action = payload.actions?.[0] || payload;
                        let displayPath = action.path || "";
                        if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                        const displayTitle = action.title || "Untitled";
                        const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                        
                        return (
                          <div className={spaceActionCardClass}>
                            <div className={spaceActionCardHeaderClass}>
                              <FileText size={14} />
                              <span>AI Plan: Create Note</span>
                            </div>
                            <div className={spaceActionCardBodyClass}>
                              <div className={spaceActionDetailsClass}>
                                <div><strong>Create:</strong> {displayTitle}.md</div>
                                <div><strong>Location:</strong> {displayPath || "/"}</div>
                              </div>
                              <div className={spaceActionButtonsClass}>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setSidebarEditText(action.content || "");
                                    setRightSidebarMode("preview");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      title: displayTitle,
                                      path: notePath,
                                      content: action.content,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Preview
                                </button>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setSidebarEditText(action.content || "");
                                    setRightSidebarMode("edit");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      title: displayTitle,
                                      path: notePath,
                                      content: action.content,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                                  onClick={async () => {
                                    const ok = await handleApplySingleAction(action, msg.id);
                                    if (ok) setAppliedActions(prev => ({ ...prev, [msg.id]: true }));
                                  }}
                                >
                                  Confirm
                                </button>
                                <button
                                  className={cx(spaceBtnDangerClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setRejectedActions(prev => ({ ...prev, [msg.id]: true }));
                                    showToast("Action rejected.");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Update Note flow
                      if (intent === "update_note" || (payload.actions && payload.actions.length === 1 && payload.actions[0].type === "update_note")) {
                        const action = payload.actions?.[0] || payload;
                        let filePath = action.file_path || action.path || "";
                        if (filePath.startsWith("/")) filePath = filePath.substring(1);
                        
                        const beforeContent = action.changes?.before || "";
                        const afterContent = action.changes?.after || action.content || "";
                        
                        return (
                          <div className={spaceActionCardClass}>
                            <div className={spaceActionCardHeaderClass}>
                              <RefreshCw size={14} />
                              <span>AI Plan: Update Note</span>
                            </div>
                            <div className={spaceActionCardBodyClass}>
                              <div className={spaceActionDetailsClass}>
                                <div><strong>Update:</strong> {filePath}</div>
                              </div>
                              <div className={spaceActionButtonsClass}>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={async () => {
                                    const { before, after } = await resolveActionContent(action);
                                    setSidebarEditText(after);
                                    setRightSidebarMode("diff");
                                    setRightSidebarData({
                                      actionType: "update_note",
                                      path: filePath,
                                      before: before,
                                      after: after,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Preview Changes
                                </button>
                                <button
                                  className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                                  onClick={async () => {
                                    const ok = await handleApplySingleAction(action, msg.id);
                                    if (ok) setAppliedActions(prev => ({ ...prev, [msg.id]: true }));
                                  }}
                                >
                                  Apply Changes
                                </button>
                                <button
                                  className={cx(spaceBtnDangerClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setRejectedActions(prev => ({ ...prev, [msg.id]: true }));
                                    showToast("Changes rejected.");
                                  }}
                                >
                                  Reject
                                </button>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setSidebarEditText(afterContent);
                                    setRightSidebarMode("edit");
                                    setRightSidebarData({
                                      actionType: "update_note",
                                      path: filePath,
                                      before: beforeContent,
                                      after: afterContent,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Edit Before Apply
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Multi Action flow
                      if (intent === "multi_action" || (payload.actions && payload.actions.length > 1)) {
                        const actions = payload.actions || [];
                        
                        return (
                          <div className={spaceActionCardClass}>
                            <div className={spaceActionCardHeaderClass}>
                              <Layers size={14} />
                              <span>{actions.length} Actions Found</span>
                            </div>
                            <div className={spaceActionCardBodyClass}>
                              <div className={spaceMultiActionListClass}>
                                {actions.map((act: any, idx: number) => {
                                  const isActApplied = appliedActions[`${msg.id}-${idx}`];
                                  const title = act.title || act.file_path || act.path || "Action";
                                  const displayTitle = title.startsWith("/") ? title.substring(1) : title;
                                  
                                  return (
                                    <div key={idx} className={multiActionItemClass}>
                                      <span className={actionNumberClass}>{idx + 1}.</span>
                                      <span className={actionDescriptionClass}>
                                        {act.type === "create_note" ? "Create" : "Update"} <code>{displayTitle}</code>
                                      </span>
                                      {isActApplied ? (
                                        <span className={actionMiniAppliedClass}>Applied</span>
                                      ) : (
                                        <button
                                          className={spaceReviewBtnClass}
                                          onClick={async () => {
                                            if (act.type === "create_note") {
                                              let displayPath = act.path || "";
                                              if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                                              const displayTitle = act.title || "Untitled";
                                              const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                                              setRightSidebarMode("preview");
                                              setRightSidebarData({
                                                actionType: "create_note",
                                                title: displayTitle,
                                                path: notePath,
                                                content: act.content,
                                                msgId: msg.id,
                                                actionIndex: idx
                                              });
                                            } else {
                                              let filePath = act.file_path || act.path || "";
                                              if (filePath.startsWith("/")) filePath = filePath.substring(1);
                                              const { before, after } = await resolveActionContent(act);
                                              setSidebarEditText(after);
                                              setRightSidebarMode("diff");
                                              setRightSidebarData({
                                                actionType: "update_note",
                                                path: filePath,
                                                before: before,
                                                after: after,
                                                msgId: msg.id,
                                                actionIndex: idx
                                              });
                                            }
                                          }}
                                        >
                                          Review
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className={spaceActionButtonsClass}>
                                <button
                                  className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                                  onClick={() => handleApplyAllActions(actions, msg.id)}
                                >
                                  Apply All
                                </button>
                                <button
                                  className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                                  onClick={() => {
                                    setRightSidebarMode("review_list");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      path: "",
                                      msgId: msg.id,
                                      actions: actions
                                    });
                                  }}
                                >
                                  Review Individually
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Fallback support for old restructuring, links, or insight report
                      switch (payload.action) {
                        case "suggest_structure":
                          return (
                            <div className={spaceActionCardClass}>
                              <div className={spaceActionCardHeaderClass}>
                                <Layers size={14} />
                                <span>Suggested Structure Restructuring</span>
                              </div>
                              <div className={spaceActionCardBodyClass}>
                                <div className={spaceActionStructureListClass}>
                                  {payload.changes?.map((change: any, index: number) => (
                                    <div key={index} className={structureChangeItemClass}>
                                      <div className={changeTypeBadgeClass}>{change.type.toUpperCase()}</div>
                                      {change.type === "merge" && (
                                        <div className={changeDetailsClass}>
                                          Merge <code>{change.notes.join(", ")}</code> into <strong>{change.target}</strong>
                                        </div>
                                      )}
                                      {change.type === "rename" && (
                                        <div className={changeDetailsClass}>
                                          Rename <code>{change.note}</code> to <code>{change.target}</code>
                                        </div>
                                      )}
                                      {change.type === "move" && (
                                        <div className={changeDetailsClass}>
                                          Move <code>{change.note}</code> to <code>{change.target}</code>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className={spaceActionBtnClass}
                                  onClick={() => handleApplyStructureAction(payload.changes, msg.id)}
                                >
                                  Apply Restructuring
                                </button>
                              </div>
                            </div>
                          );
                        case "suggest_links":
                          return (
                            <div className={spaceActionCardClass}>
                              <div className={spaceActionCardHeaderClass}>
                                <GitBranch size={14} />
                                <span>Suggested Wiki-Links</span>
                              </div>
                              <div className={spaceActionCardBodyClass}>
                                <table className={spaceActionTableClass}>
                                  <thead>
                                    <tr>
                                      <th>From</th>
                                      <th>To</th>
                                      <th>Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {payload.links?.map((link: any, index: number) => (
                                      <tr key={index}>
                                        <td><code>{link.from}</code></td>
                                        <td><code>{link.to}</code></td>
                                        <td>{link.reason}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <button
                                  className={spaceActionBtnClass}
                                  onClick={() => handleInsertLinksAction(payload.links, msg.id)}
                                >
                                  Insert Links
                                </button>
                              </div>
                            </div>
                          );
                        case "insight_report":
                          return (
                            <div className={spaceActionCardClass}>
                              <div className={spaceActionCardHeaderClass}>
                                <Sparkles size={14} />
                                <span>Insight Report</span>
                              </div>
                              <div className={spaceActionCardBodyClass}>
                                <div className={spaceActionInsightsClass}>
                                  {payload.insights?.map((insight: any, index: number) => (
                                    <div key={index} className={insightItemClass}>
                                      <div className={insightTypeClass}>Type: <strong>{insight.type}</strong></div>
                                      <div className={insightDescriptionClass}>{insight.description}</div>
                                      {insight.notes && (
                                        <div className={insightNotesClass}>Notes: {insight.notes.join(", ")}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className={spaceActionBtnClass}
                                  onClick={() => handleSaveInsightsAction(payload.insights, msg.id)}
                                >
                                  Save Insight Report to Vault
                                </button>
                              </div>
                            </div>
                          );
                        default:
                          return null;
                      }
                    })()}
                    
                    {(() => {
                      const payload = parseActionPayload(msg.content);
                      const sources = payload?.sources || msg.sources || [];
                      const { visibleSources, hiddenCount } = getDisplaySources(sources);
                      if (visibleSources.length === 0) return null;
                      
                      return (
                        <div className={spaceChatSourcesClass}>
                          <span className={spaceChatSourcesLabelClass}>Sources Used</span>
                          <div className={spaceChatSourcesListClass}>
                            {visibleSources.map((source, i) => (
                              <span
                                key={`${source.noteTitle}-${i}`}
                                className={spaceChatSourcePillClass}
                                onClick={() => handleOpenSource(source.noteTitle, source.chunkText, source.notePath)}
                                title={source.chunkText ? `Excerpt: ${source.chunkText.substring(0, 100)}...` : `Open ${source.noteTitle}`}
                              >
                                {source.noteTitle}
                              </span>
                            ))}
                            {hiddenCount > 0 && (
                              <span className={spaceChatSourceMorePillClass} title={`${hiddenCount} additional retrieved sources were used as context.`}>
                                +{hiddenCount} more relevant sources
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            ))}

            {/* Streaming Indicator */}
            {isQuerying && streamingText && (() => {
              const cleanedText = stripJSONBlock(streamingText);
              const lastUserMsg = [...chatMessages].reverse().find((m) => m.role === "user");
              const activeQuery = lastUserMsg?.content || "";
              const actionType = detectActionType(streamingText, activeQuery);
              
              return (
                <div className={cx(spaceChatMessageClass, spaceChatAssistantMessageClass)}>
                  {cleanedText && (
                    <div className={spaceChatAssistantContentClass}>
                      <MarkdownPreview
                        content={cleanedText}
                        onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                        constrainWidth={false}
                      />
                    </div>
                  )}
                  {actionType && (!isReadOnlySourceSpace || actionType === "create_note" || actionType === "insight_report") && (
                    <ActiveActionStatus
                      actionType={actionType}
                      isApplied={false}
                    />
                  )}
                </div>
              );
            })()}

            {/* AI thinking state loader */}
            {isQuerying && !streamingText && (
              <div className={spaceChatLoadingClass}>
                <div className={spaceChatLoadingSpinnerClass} />
                <span>Synthesizing response...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Sticky Anchored Query Drawer Input */}
          {chatMessages.length > 0 && (
            <div className={spaceChatInputPanelClass}>
              <div className={spaceChatInputWrapperClass}>
                {showMentionDropdown && filteredNotes.length > 0 && (
                  <div className={mentionDropdownClass}>
                    {filteredNotes.map((note: any, index: number) => (
                      <div
                        key={note.path}
                        className={cx(mentionItemClass, index === mentionActiveIndex && mentionItemActiveClass)}
                        onClick={() => selectNote(note)}
                      >
                        <FileText size={12} className={mentionItemIconClass} />
                        <span className={mentionItemTitleClass}>{note.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] border-0 bg-transparent"
                  onClick={() => {
                    if (bottomInputRef.current) {
                      bottomInputRef.current.focus();
                      setChatInput(prev => prev + "[[");
                      checkForMention(chatInput + "[[", chatInput.length + 2);
                    }
                  }}
                  title="Mention note (Type [[)"
                >
                  <Plus size={16} />
                </button>
                <textarea
                  ref={bottomInputRef}
                  className={spaceChatInputClass}
                  placeholder="Ask anything..."
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    checkForMention(e.target.value, e.target.selectionStart);
                  }}
                  onSelect={(e: any) => {
                    checkForMention(e.target.value, e.target.selectionStart);
                  }}
                  onKeyDown={handleChatKeyDown}
                  rows={1}
                  disabled={isQuerying}
                />
                <div className={spaceChatInputActionsClass}>
                  {inputTokens > 0 && (
                    <span className={spaceChatTokenCounterClass}>
                      {inputTokens} tokens
                    </span>
                  )}
                  {renderChatModelPicker()}
                  <button
                    className={cx(spaceChatSendClass, isQuerying && spaceChatAbortClass)}
                    onClick={() => {
                      if (isQuerying) {
                        handleAbortChat();
                      } else {
                        handleChat();
                      }
                    }}
                    disabled={!isQuerying && !chatInput.trim()}
                    title={isQuerying ? "Stop generating" : "Send message"}
                  >
                    {isQuerying ? <Square size={10} fill="currentColor" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                  </button>
                </div>
              </div>

              {!isAIConfigured() && (
                <div className={spaceChatNoAiClass}>
                  Configure an API key in AI Settings to enable chat queries over vector layers.
                </div>
              )}
            </div>
          )}
        </div>

        {rightSidebarMode && rightSidebarData && (
          <div className={spaceRightSidebarClass}>
            <div className={spaceRightSidebarHeaderClass}>
              <div className={spaceRightSidebarHeaderRowClass}>
                <div className={spaceRightSidebarTitleClass}>
                  {rightSidebarMode === "review_list" ? "Review Actions" : `Review: ${rightSidebarData.title || rightSidebarData.path || "Note"}`}
                </div>
                <button className={spaceRightSidebarCloseClass} onClick={() => setRightSidebarMode(null)}>
                  <X size={16} />
                </button>
              </div>

              {rightSidebarMode !== "review_list" && (
                <div className={spaceRightSidebarTabsClass}>
                  <button
                    className={cx(spaceRightSidebarTabClass, rightSidebarMode === "preview" && spaceRightSidebarTabActiveClass)}
                    onClick={() => setRightSidebarMode("preview")}
                  >
                    Preview
                  </button>
                  {rightSidebarData.actionType !== "create_note" && (
                    <button
                      className={cx(spaceRightSidebarTabClass, rightSidebarMode === "diff" && spaceRightSidebarTabActiveClass)}
                      onClick={() => setRightSidebarMode("diff")}
                    >
                      Diff Changes
                    </button>
                  )}
                  <button
                    className={cx(spaceRightSidebarTabClass, rightSidebarMode === "edit" && spaceRightSidebarTabActiveClass)}
                    onClick={() => setRightSidebarMode("edit")}
                  >
                    Edit Content
                  </button>
                </div>
              )}
            </div>

            <div className={spaceRightSidebarBodyClass}>
              {rightSidebarMode === "preview" && (
                <div className={spaceRightSidebarPreviewClass}>
                  <MarkdownPreview
                    content={sidebarEditText || ""}
                    onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                    constrainWidth={false}
                  />
                </div>
              )}

              {rightSidebarMode === "diff" && (
                <div className={spaceRightSidebarPreviewClass}>
                  <MarkdownPreview
                    content={generateDiffMarkdown(rightSidebarData.before || "", sidebarEditText || "")}
                    onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                    constrainWidth={false}
                  />
                </div>
              )}

              {rightSidebarMode === "edit" && (
                <div className={spaceRightSidebarEditClass}>
                  <div className={spaceRightSidebarEditHintClass}>
                    Editing proposed content before committing to the vault. No emojis allowed.
                  </div>
                  <textarea
                    className={spaceRightSidebarTextareaClass}
                    value={sidebarEditText}
                    onChange={(e) => setSidebarEditText(e.target.value)}
                  />
                </div>
              )}

              {rightSidebarMode === "review_list" && rightSidebarData.actions && (
                <div className={spaceRightSidebarReviewListClass}>
                  <div className={spaceSidebarSectionHeaderClass}>Pending Changes ({rightSidebarData.actions.filter((_, idx) => !appliedActions[`${rightSidebarData.msgId}-${idx}`]).length})</div>
                  <div className={spaceRightSidebarReviewItemsClass}>
                    {rightSidebarData.actions.map((act: any, idx: number) => {
                      const isActApplied = appliedActions[`${rightSidebarData.msgId}-${idx}`];
                      const title = act.title || act.file_path || act.path || "Action";
                      const displayTitle = title.startsWith("/") ? title.substring(1) : title;
                      
                      return (
                        <div key={idx} className={spaceRightSidebarReviewItemClass}>
                          <div className={spaceRightSidebarReviewInfoClass}>
                            <span className={spaceRightSidebarReviewTypeClass}>
                              {act.type === "create_note" ? "Create Note" : "Update Note"}
                            </span>
                            <span className={spaceRightSidebarReviewPathClass}>
                              {displayTitle}
                            </span>
                          </div>
                          {isActApplied ? (
                            <span className={actionAppliedBadgeClass}>Applied</span>
                          ) : (
                            <button
                              className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)}
                              onClick={() => {
                                if (act.type === "create_note") {
                                  let displayPath = act.path || "";
                                  if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                                  const displayTitle = act.title || "Untitled";
                                  const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                                  setRightSidebarMode("preview");
                                  setRightSidebarData(prev => ({
                                    ...prev!,
                                    actionType: "create_note",
                                    title: displayTitle,
                                    path: notePath,
                                    content: act.content,
                                    actionIndex: idx
                                  }));
                                  setSidebarEditText(act.content || "");
                                } else {
                                  let filePath = act.file_path || act.path || "";
                                  if (filePath.startsWith("/")) filePath = filePath.substring(1);
                                  setRightSidebarMode("diff");
                                  setRightSidebarData(prev => ({
                                    ...prev!,
                                    actionType: "update_note",
                                    path: filePath,
                                    before: act.changes?.before || "",
                                    after: act.changes?.after || act.content || "",
                                    actionIndex: idx
                                  }));
                                  setSidebarEditText(act.changes?.after || act.content || "");
                                }
                              }}
                            >
                              Review
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className={spaceRightSidebarFooterClass}>
              {rightSidebarMode === "review_list" ? (
                <>
                  <button
                    className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                    onClick={async () => {
                      await handleApplyAllActions(rightSidebarData.actions || [], rightSidebarData.msgId);
                      setRightSidebarMode(null);
                    }}
                  >
                    Apply All
                  </button>
                  <button className={cx(spaceBtnSecondaryClass, spaceBtnSmClass)} onClick={() => setRightSidebarMode(null)}>
                    Close
                  </button>
                </>
              ) : (
                <>
                  {rightSidebarData.actionIndex !== undefined && (
                    <button 
                      className={cx(spaceBtnSecondaryClass, spaceBtnSmClass, spaceRightSidebarBackBtnClass)} 
                      onClick={() => {
                        setRightSidebarMode("review_list");
                        setRightSidebarData(prev => ({
                          ...prev!,
                          actionType: "create_note",
                          path: "",
                        }));
                      }}
                    >
                      Back to List
                    </button>
                  )}
                  
                  <button
                    className={cx(spaceBtnDangerClass, spaceBtnSmClass)}
                    onClick={() => {
                      if (rightSidebarData.actionIndex !== undefined) {
                        setRightSidebarMode("review_list");
                        setRightSidebarData(prev => ({
                          ...prev!,
                          actionType: "create_note",
                          path: "",
                        }));
                      } else {
                        setRightSidebarMode(null);
                      }
                      showToast("Changes cancelled.");
                    }}
                  >
                    Cancel
                  </button>
                  
                  <button
                    className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                    onClick={async () => {
                      const action = rightSidebarData.actionIndex !== undefined
                        ? rightSidebarData.actions?.[rightSidebarData.actionIndex]
                        : { 
                            type: rightSidebarData.actionType, 
                            title: rightSidebarData.title, 
                            path: rightSidebarData.path, 
                            content: rightSidebarData.content,
                            changes: { before: rightSidebarData.before, after: rightSidebarData.after }
                          };
                      
                      const actualAction = { 
                        ...action, 
                        content: sidebarEditText,
                        changes: { 
                          before: rightSidebarData.before || "", 
                          after: sidebarEditText 
                        } 
                      };
                      
                      const ok = await handleApplySingleAction(actualAction, rightSidebarData.msgId, rightSidebarData.actionIndex);
                      if (ok) {
                        if (rightSidebarData.actionIndex === undefined) {
                          setAppliedActions(prev => ({ ...prev, [rightSidebarData.msgId]: true }));
                          setRightSidebarMode(null);
                        } else {
                          const key = `${rightSidebarData.msgId}-${rightSidebarData.actionIndex}`;
                          setAppliedActions(prev => {
                            const updated = { ...prev, [key]: true };
                            const actions = rightSidebarData.actions || [];
                            const allApplied = actions.every((_, idx) => 
                              idx === rightSidebarData.actionIndex || updated[`${rightSidebarData.msgId}-${idx}`]
                            );
                            if (allApplied) {
                              updated[rightSidebarData.msgId] = true;
                            }
                            return updated;
                          });
                          
                          setRightSidebarMode("review_list");
                          setRightSidebarData(prev => ({
                            ...prev!,
                            actionType: "create_note",
                            path: "",
                          }));
                        }
                      }
                    }}
                  >
                    {rightSidebarData.actionType === "create_note" ? "Confirm & Create" : "Apply Changes"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {saveNoteMessage && (
        <div className={modalOverlayClass} onClick={() => setSaveNoteMessage(null)}>
          <div className={modalContentClass} onClick={(e) => e.stopPropagation()}>
            <div className={modalHeaderClass}>
              <h3 className={modalTitleClass}>Save Response as Note</h3>
              <button className={modalCloseClass} onClick={() => setSaveNoteMessage(null)}>
                <X size={14} />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await executeSaveAsNote();
              }}
              className={spaceCreateFormClass}
            >
              <div className={spaceFormFieldClass}>
                <label className={spaceFormLabelClass}>Note Title</label>
                <input
                  type="text"
                  value={saveNoteTitle}
                  onChange={(e) => setSaveNoteTitle(e.target.value)}
                  className={spaceFormInputClass}
                  placeholder="Enter note title..."
                  autoFocus
                />
              </div>
              <div className={spaceFormActionsClass}>
                <button
                  type="button"
                  className={cx(spaceSidebarBtnClass)}
                  onClick={() => setSaveNoteMessage(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={cx(spaceSidebarBtnClass, spaceSidebarBtnPrimaryClass)}
                  disabled={!saveNoteTitle.trim()}
                >
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            refreshSpaces();
          }}
          message={authMessage}
        />
      )}

      {/* Unlock Private Space Modal */}
      {unlockSpaceId && (() => {
        const spaceToUnlock = spaces.find(s => s.id === unlockSpaceId);
        return (
          <div className={modalOverlayClass} onClick={() => {
            setUnlockSpaceId(null);
            setUnlockPassword("");
            setUnlockError(null);
          }}>
            <div className={`${modalContentClass} max-w-[380px]`} onClick={(e) => e.stopPropagation()}>
              <div className={modalHeaderClass}>
                <h3 className={modalTitleClass}>Unlock Private Space</h3>
                <button className={modalCloseClass} onClick={() => {
                  setUnlockSpaceId(null);
                  setUnlockPassword("");
                  setUnlockError(null);
                }}>
                  <X size={15} />
                </button>
              </div>
              <div className="flex flex-col gap-3.5 p-5">
                <p className="m-0 text-[13px] leading-normal text-[var(--text-secondary)]">
                  Enter the password to unlock the private space <strong>{spaceToUnlock?.title || "this space"}</strong>.
                </p>
                
                <div className={spaceFormFieldClass}>
                  <label className={spaceFormLabelClass}>Encryption Password</label>
                  <input
                    className={spaceFormInputClass}
                    type="password"
                    placeholder="Password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && unlockPassword.trim()) {
                        e.preventDefault();
                        handleUnlockSpace();
                      }
                    }}
                    autoFocus
                  />
                </div>

                {unlockError && <div className={spaceFormErrorClass}>{unlockError}</div>}

                <div className={spaceFormActionsClass}>
                  <button className={cx(spaceBtnGhostClass, spaceBtnSmClass)} onClick={() => {
                    setUnlockSpaceId(null);
                    setUnlockPassword("");
                    setUnlockError(null);
                  }}>
                    Cancel
                  </button>
                  <button
                    className={cx(spaceBtnPrimaryClass, spaceBtnSmClass)}
                    onClick={handleUnlockSpace}
                    disabled={unlocking || !unlockPassword.trim()}
                  >
                    {unlocking ? "Unlocking..." : "Unlock"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
        })()}

        {isRemixing && remixProgress && (
          <div className="fixed inset-0 z-55 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-sm p-6 rounded-2xl bg-[#0f0f10] border border-neutral-800 text-neutral-200 shadow-2xl flex flex-col items-center">
              <h3 className="text-base font-semibold text-neutral-100 mb-2">Remixing Space</h3>
              <p className="text-xs text-neutral-400 mb-5 text-center leading-relaxed">
                Downloading and saving note resources locally...
              </p>
              
              <div className="w-full bg-[#18181b] h-2 rounded-full overflow-hidden mb-3.5 border border-neutral-800/80">
                <div 
                  className="bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.round((remixProgress.done / remixProgress.total) * 100)}%` }}
                />
              </div>
              
              <div className="text-sm font-semibold text-neutral-200">
                {Math.round((remixProgress.done / remixProgress.total) * 100)}%
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">
                ({remixProgress.done} of {remixProgress.total} notes)
              </div>
            </div>
          </div>
        )}
      </div>
    );
}

export default SpacesPage;
