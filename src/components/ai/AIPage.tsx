/**
 * AIPage — Semantic Intelligence Panel
 *
 * Tabs:
 *  1. Suggest — auto-suggestions for active note
 *  2. Insights — clusters, missing links, unwritten insights, synthesis
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getAPI } from "../../utils/api";
import { FileEntry, Theme } from "../../types";
import {
  Loader2,
  X,
  Maximize,
  Minimize,
  Link,
  Layers,
  Zap,
  ChevronRight,
} from "lucide-react";
import {
  loadStore,
  findSimilar,
  applyHistoryWeighting,
  recordSuggestion,
  isModelLoaded,
  isLexicalFallbackActive,
  getLoadProgress,
  setProgressCallback,
  loadStoreAsync,
  searchByQuery,
  EMBEDDING_UPDATED_EVENT,
  type EmbeddingStore,
} from "../../utils/embeddings";
import {
  detectClusters,
  detectMissingLinks,
  detectUnwrittenInsights,
  getInsightAnalysisLimit,
  generateSynthesis,
  selectInsightAnalysisPaths,
  type NoteCluster,
  type MissingLinkSuggestion,
  type UnwrittenInsight,
  type SynthesisResult,
} from "../../utils/synthesis";
import {
  loadSettings,
  loadSettingsAsync,
  getModelsForProvider,
  AI_SETTINGS_CHANGED_EVENT,
  type AISettings,
} from "../../utils/ai-settings";
import { LINK_TYPES, type LinkType } from "./SuggestionBanner";
import { enrichSuggestions, type EnrichedSuggestion } from "../../utils/suggestion-enrichment";
import {
  answerVaultQuestion,
  collectMarkdownPaths,
  getVaultRetrievalPlan,
  rankVaultPassages,
  samplePathsEvenly,
  type VaultAnswer,
  type VaultCitation,
} from "../../utils/vault-rag";
import { CitedMarkdownAnswer, MarkdownReadingView } from "./CitedMarkdownAnswer";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNoteName(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") || path;
}

function getReadableNoteName(path: string): string {
  return getNoteName(path).replace(/[_-]+/g, " ");
}

function isBroadSummaryQuestion(question: string): boolean {
  return /\b(summar(y|ize)|overview|main ideas|key ideas|entire vault|all notes)\b/i.test(question);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function confidenceMeta(value: number): { label: string; className: string } {
  if (value >= 0.7) return { label: "High confidence", className: "text-(--text-primary)" };
  if (value >= 0.5) return { label: "Medium confidence", className: "text-(--text-secondary)" };
  return { label: "Possible match", className: "text-(--text-muted)" };
}

function insightObservation(insight: UnwrittenInsight, primaryNote?: string): string {
  return insight.type === "bridge_gap"
    ? `${getReadableNoteName(primaryNote || "This note")} could connect two areas of your vault.`
    : "These topics appear related but are not connected.";
}

function clusterObservation(cluster: NoteCluster): string {
  if (cluster.avgSimilarity >= 0.68) return "These notes form a focused topic worth consolidating.";
  if (cluster.avgSimilarity >= 0.58) return "These notes share a coherent theme worth reviewing.";
  return "These notes have a possible shared theme.";
}

const tm = {
  header: "flex min-h-[66px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--border-subtle) bg-(--bg-primary) px-4 py-3",
  title: "m-0 text-[15px] font-semibold leading-tight tracking-[-0.015em] text-(--text-primary)",
  titleBlock: "flex min-w-[150px] flex-1 items-center gap-2.5",
  subtitle: "mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-tight text-(--text-muted)",
  controls: "ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5",
  iconBtn: "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[5px] border border-transparent bg-transparent text-(--text-muted) transition-[background-color,color,border-color] duration-[160ms] hover:border-(--border-subtle) hover:bg-(--bg-active) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  content: "relative flex min-h-0 flex-1 flex-col bg-(--bg-primary) [container-type:inline-size]",
  tabs: "grid h-10 shrink-0 grid-cols-3 border-b border-(--border-subtle) bg-(--bg-primary) px-[clamp(8px,3cqw,14px)]",
  tab: "relative my-1 inline-flex min-w-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent px-2 text-[12px] font-medium text-(--text-muted) transition-[background-color,color] duration-[160ms] after:absolute after:inset-x-3 after:-bottom-1 after:h-px after:origin-center after:scale-x-0 after:bg-(--text-primary) after:transition-transform after:duration-[160ms] hover:bg-(--bg-active) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--interactive-accent)",
  tabActive: "bg-(--bg-active) text-(--text-primary) after:scale-x-100",
  tabDescription: "ai-tab-description m-0 shrink-0 px-4 pb-2 pt-2 text-[11px] leading-4 text-(--text-muted)",
  spinner: "animate-spin text-(--text-muted)",
};

const tmTabClass = (active: boolean) => `${tm.tab} ${active ? tm.tabActive : ""}`;
const panelBtnBaseClass =
  "inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] border border-(--border-subtle) px-2.5 text-[11px] font-medium transition-[background-color,color,border-color] duration-[160ms] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-(--interactive-accent)";
const panelBtnGhostClass =
  `${panelBtnBaseClass} bg-transparent text-(--text-secondary) hover:border-(--border-medium) hover:bg-(--bg-active) hover:text-(--text-primary)`;

const ai = {
  modelStatus: "mx-4 mt-3 flex items-center gap-2 border-b border-(--border-subtle) px-0 pb-2.5 text-[11px] text-(--text-secondary)",
  modelProgress: "h-1 flex-1 overflow-hidden rounded-full bg-(--border-subtle)",
  modelProgressBar: "h-full rounded-full bg-(--text-secondary)",
  empty: "m-3 flex min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center text-[12px] leading-relaxed text-(--text-muted)",
  tabPanel: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-3",
  tabPanelScroll: "min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-4 py-4",
  suggestionsList: "min-w-0 space-y-4",
  suggestionsListFlush: "space-y-2",
  suggestionsHeader: "text-[11px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)",
  suggestionHero: "flex min-w-0 items-center justify-between gap-3 border-b border-(--border-subtle) px-0 pb-3 [&>div:first-child]:min-w-0",
  suggestionHeroTitle: "truncate text-[13px] font-semibold tracking-[-0.01em] text-(--text-primary)",
  suggestionHeroMeta: "mt-0.5 text-[12px] text-(--text-muted)",
  suggestionHeroCount: "text-[12px] font-medium tabular-nums text-(--text-muted)",
  suggestionItem: "ai-panel-item group flex flex-col gap-3 rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-3 transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-active)",
  suggestionContent: "min-w-0 space-y-2",
  suggestionTopRow: "flex min-w-0 items-start gap-2",
  suggestionMetaRow: "flex min-w-0 flex-wrap items-center gap-1.5",
  suggestionInfo: "min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  suggestionTitle: "block truncate text-[13px] font-semibold text-(--text-primary)",
  suggestionScore: "shrink-0 text-[10px] font-medium tabular-nums text-(--text-muted)",
  suggestionActions: "flex max-w-full flex-wrap items-center gap-1.5",
  suggestionAccept: "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] border border-(--border-medium) bg-(--bg-active) px-2.5 text-[11px] font-semibold text-(--text-primary) transition-[background-color,border-color,opacity] duration-[160ms] hover:border-(--border-strong) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  suggestionReject: "inline-flex h-7 cursor-pointer items-center justify-center rounded-[5px] border border-transparent bg-transparent px-2 text-[11px] text-(--text-muted) transition-[background-color,color] duration-[160ms] hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  suggestionGroup: "space-y-2",
  suggestionGroupLabel: "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)",
  suggestionReason: "text-[12px] leading-[1.55] text-(--text-secondary)",
  conceptList: "flex min-w-0 flex-wrap gap-1",
  conceptChip: "max-w-full truncate rounded-[5px] border border-(--border-subtle) bg-(--bg-primary) px-2 py-1 text-[10px] font-medium text-(--text-secondary)",
  suggestionNotLinked: "shrink-0 text-[12px] text-(--text-faint)",
  typeBadgeBase: "inline-flex shrink-0 items-center rounded-[5px] border px-2 py-1 text-[10px] font-semibold leading-none tracking-[0.01em]",
  dot: "w-1.5 h-1.5 rounded-full shrink-0",
  dotStrong: "bg-(--text-primary)",
  dotBroader: "bg-(--text-muted)",
  linkTypeSelector: "flex max-w-full flex-wrap items-center justify-end gap-0.5",
  linkTypeBtn: "flex cursor-pointer items-center gap-[3px] whitespace-nowrap rounded border border-(--border-subtle) bg-transparent px-1.5 py-0.5 text-[10px] text-(--text-muted) transition-colors duration-150 hover:border-(--border-medium) hover:bg-(--bg-active) hover:text-(--text-primary)",
  linkCancel: "flex items-center p-0.5 border-none bg-transparent text-(--text-muted) cursor-pointer rounded",
  sectionHeader: "flex flex-wrap items-center gap-1.5 text-[12px] font-semibold tracking-[-0.01em] text-(--text-primary)",
  sectionToggle: "group inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[4px] border-0 bg-transparent p-0 text-left text-[12px] font-semibold tracking-[-0.01em] text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  sectionChevron: "shrink-0 text-(--text-muted) transition-transform duration-[160ms] ease-out",
  sectionBadge: "rounded border border-(--border-subtle) bg-(--bg-primary) px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-(--text-muted)",
  sourceCount: "rounded border border-(--border-subtle) bg-(--bg-primary) px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-(--text-muted)",
  sectionHint: "m-0 text-[12px] leading-relaxed text-(--text-muted)",
  section: "min-w-0 space-y-2.5",
  insightSection: "min-w-0 space-y-2.5",
  result: "border-l-2 border-(--border-medium) pl-3 text-[12px] leading-relaxed text-(--text-secondary)",
  synthesisInline: "ai-panel-item mt-1 space-y-2.5 border-t border-(--border-subtle) px-3 py-3",
  synthesisActions: "flex flex-wrap items-center gap-1.5",
  clusterList: "space-y-2",
  clusterItem: "ai-panel-item overflow-hidden rounded-lg border border-(--border-subtle) bg-(--bg-secondary) transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-active)",
  clusterItemActive: "bg-(--bg-active)",
  clusterHeader: "flex items-start gap-3 px-3 py-3",
  clusterHeaderBtn: "flex min-w-0 flex-1 cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-(--text-secondary) transition-colors duration-[160ms] hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  clusterHeaderActions: "flex shrink-0 flex-col items-end gap-2",
  clusterSummary: "min-w-0 flex-1",
  clusterName: "block truncate text-[13px] font-semibold text-(--text-primary)",
  clusterDescription: "mt-1 block text-[11px] leading-relaxed text-(--text-muted)",
  clusterMembers: "ai-panel-item flex flex-wrap gap-1.5 border-t border-(--border-subtle) px-3 py-2.5",
  clusterMember: "inline-flex max-w-full cursor-pointer items-center overflow-hidden rounded-[5px] border border-(--border-subtle) bg-(--bg-primary) px-2 py-1.5 text-[11px] font-medium text-(--text-primary) transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-hover) focus-visible:outline-2 focus-visible:outline-(--interactive-accent) [&_span]:truncate",
  missingLinkInfo: "flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden",
  missingLinkArrow: "inline-flex h-7 w-5 shrink-0 items-center justify-center text-[17px] font-semibold text-(--text-secondary)",
  confidenceBadge: "shrink-0 text-[10px] font-medium tabular-nums text-(--text-muted)",
  unwrittenList: "min-w-0 space-y-2",
  unwrittenItem: "ai-panel-item relative min-w-0 space-y-3 overflow-hidden rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-3 transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-active)",
  insightTitle: "text-[13px] font-semibold leading-snug text-(--text-primary)",
  unwrittenDescription: "min-w-0 text-[12px] leading-relaxed text-(--text-secondary) [overflow-wrap:anywhere]",
  unwrittenNotes: "flex flex-wrap gap-1.5",
  unwrittenFooter: "flex flex-wrap items-center justify-between gap-2 pt-0.5",
  unwrittenActions: "flex flex-wrap gap-1.5",
  compactBtn: "h-7 px-2 text-[10px]",
  thresholdControl: "border-b border-(--border-subtle) pb-3",
  thresholdLabel: "flex justify-between items-center text-[11px] text-(--text-muted) mb-1",
  thresholdValue: "font-semibold tabular-nums",
  thresholdSlider: "w-full h-1 appearance-none bg-(--border-subtle) rounded-sm outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--text-secondary) [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-150 hover:[&::-webkit-slider-thumb]:bg-(--text-primary)",
  thresholdLabels: "flex justify-between text-[10px] text-(--text-muted) mt-0.5 opacity-60",
  askPanel: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-[clamp(12px,3cqw,18px)]",
  askLayout: "flex min-h-full flex-col gap-4",
  askForm: "flex shrink-0 flex-col gap-2 rounded-lg border border-(--border-medium) bg-(--bg-secondary) p-2.5 transition-[border-color,background-color] duration-[160ms] focus-within:border-(--border-strong)",
  askInput: "min-h-[34px] w-full resize-none overflow-hidden border-0 bg-transparent px-1.5 py-1 text-[13px] leading-[1.55] text-(--text-primary) outline-none placeholder:text-(--text-faint)",
  askFooter: "flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-(--border-subtle) pt-2",
  askHint: "min-w-0 flex-1 text-[10px] leading-4 text-(--text-faint)",
  askSubmit: "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-(--text-primary) bg-(--text-primary) px-3 text-[11px] font-semibold text-(--bg-primary) transition-opacity duration-[160ms] hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  askProgress: "flex min-h-8 items-center gap-2 border-b border-(--border-subtle) px-1 pb-2 text-[11px] text-(--text-secondary)",
  askProgressDot: "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-(--interactive-accent)",
  askEmpty: "flex min-h-[250px] flex-1 flex-col items-center justify-center px-[clamp(16px,5cqw,30px)] py-7 text-center",
  askEmptyTitle: "text-[16px] font-semibold tracking-[-0.01em] text-(--text-primary)",
  askEmptyCopy: "mt-2 max-w-[420px] text-[13px] leading-5 text-(--text-muted)",
  promptGrid: "mt-6 grid w-full max-w-[580px] grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2",
  promptChip: "group flex min-h-[66px] min-w-0 cursor-pointer flex-col items-start justify-center gap-1 rounded-lg border border-(--border-subtle) bg-(--bg-secondary) px-4 py-3 text-left transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-active) focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--interactive-accent)",
  promptTitle: "text-[12px] font-semibold leading-4 text-(--text-primary)",
  promptDescription: "text-[10px] font-normal leading-[1.45] text-(--text-muted)",
  answer: "vault-ai-answer ai-panel-item select-text rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-[clamp(16px,4cqw,22px)] text-(--text-primary)",
  citationMarker: "ai-citation-marker mx-0.5 inline-flex h-5 max-w-[min(180px,58cqw)] cursor-pointer items-center align-baseline rounded-md border border-(--border-medium) bg-(--bg-tertiary) px-2 text-[10px] font-medium leading-none text-(--text-secondary) shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-[background-color,color,border-color,box-shadow,transform] duration-[160ms] hover:-translate-y-px hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary) hover:shadow-[0_2px_6px_rgba(0,0,0,0.18)] focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  sourcesButton: "inline-flex h-7 w-fit cursor-pointer items-center gap-1.5 rounded-[5px] border border-transparent px-2 text-[10px] font-medium text-(--text-muted) transition-[background-color,color] duration-[160ms] hover:bg-(--bg-active) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  sourcesBackdrop: "absolute inset-0 z-30 cursor-pointer bg-black/25",
  sourcesDrawer: "absolute inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-(--border-medium) bg-(--bg-primary) shadow-2xl",
  sourcesDrawerHeader: "flex h-12 shrink-0 items-center gap-2 border-b border-(--border-subtle) px-4",
  sourcesDrawerBody: "min-h-0 flex-1 space-y-2 overflow-y-auto p-3",
  sourceList: "space-y-2",
  sourceCard: "ai-panel-item w-full cursor-pointer rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-3 text-left transition-[background-color,border-color] duration-[160ms] hover:border-(--border-medium) hover:bg-(--bg-active) focus-visible:outline-2 focus-visible:outline-(--interactive-accent)",
  sourceHeader: "flex min-w-0 items-center gap-2 text-[12px] font-semibold text-(--text-primary)",
  sourceLocation: "ml-auto shrink-0 font-mono text-[10px] font-normal text-(--text-muted)",
  sourceExcerpt: "vault-ai-source mt-2 max-h-32 overflow-y-auto text-(--text-secondary)",
  askError: "rounded-md border border-[rgba(220,80,80,0.3)] bg-[rgba(220,80,80,0.08)] px-3 py-2 text-[11px] leading-relaxed text-(--color-red)",
};

const ASK_STARTERS = [
  {
    title: "Summarize this vault",
    description: "Generate a concise overview of your main themes.",
    prompt: "Summarize the main ideas in this vault.",
  },
  {
    title: "Find important connections",
    description: "Reveal meaningful links between your notes.",
    prompt: "What important connections exist between my notes?",
  },
  {
    title: "Spot missing context",
    description: "Find topics that need more detail or support.",
    prompt: "Which topics are incomplete or missing context?",
  },
  {
    title: "Choose what to review",
    description: "Surface useful notes and connections to revisit.",
    prompt: "What should I review or connect next?",
  },
] as const;

const TAB_DESCRIPTIONS: Record<AITab, string> = {
  ask: "Ask questions grounded in your vault.",
  suggestions: "Review AI-recommended note connections.",
  insights: "Discover vault-wide relationships and opportunities.",
};

const aiTypeBadgeClass = (type: EnrichedSuggestion["type"]) => {
  const tone =
    type === "contradicts" ? "border-(--border-strong) border-dashed bg-transparent text-(--text-primary)" :
    type === "expands" ? "border-(--border-medium) bg-(--bg-active) text-(--text-primary)" :
    type === "example" ? "border-(--border-subtle) bg-(--bg-secondary) text-(--text-secondary)" :
    "border-(--border-subtle) bg-transparent text-(--text-secondary)";
  return `${ai.typeBadgeBase} ${tone}`;
};

// ── Props ────────────────────────────────────────────────────────────────────

interface AIPageProps {
  vaultPath: string | null;
  theme: Theme;
  fileTree: FileEntry[];
  activeNotePath?: string | null;
  onOpenNote: (path: string) => void;
  onClose: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

type AITab = "ask" | "suggestions" | "insights";
const AI_TABS: AITab[] = ["ask", "suggestions", "insights"];

export function AIPage({
  vaultPath,
  theme,
  fileTree,
  activeNotePath,
  onOpenNote,
  onClose,
  isFullScreen,
  onToggleFullScreen,
}: AIPageProps) {
  const api = useMemo(() => getAPI(), []);

  // ── Tab ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AITab>("ask");
  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = AI_TABS.indexOf(activeTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % AI_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + AI_TABS.length) % AI_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = AI_TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = AI_TABS[nextIndex];
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`ai-tab-${nextTab}`)?.focus());
  }, [activeTab]);

  // ── AI Settings ────────────────────────────────────
  const [aiSettings, setAiSettings] = useState<AISettings>(loadSettings);

  useEffect(() => {
    let isSubscribed = true;
    const handleSettingsChanged = () => {
      setAiSettings(loadSettings());
    };
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    void loadSettingsAsync().then((settings) => {
      if (isSubscribed) setAiSettings(settings);
    });
    return () => {
      isSubscribed = false;
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    };
  }, []);

  const hasApiKey = !!aiSettings.apiKey;
  const modelLabel = useMemo(() => {
    const modelId = aiSettings.modelId;
    return getModelsForProvider(aiSettings.provider).find((model) => model.id === modelId)?.shortLabel
      || modelId.split("/").pop()
      || "AI";
  }, [aiSettings]);

  // ── Ask vault with exact citations ─────────────────
  const [askQuery, setAskQuery] = useState("");
  const askInputRef = useRef<HTMLTextAreaElement>(null);
  const [askResult, setAskResult] = useState<VaultAnswer | null>(null);
  const [retrievedPassages, setRetrievedPassages] = useState<VaultCitation[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const liveContentRef = useRef<Map<string, string>>(new Map());

  // Keep unsaved editor content available to Ask while the panel stays open.
  // This avoids requiring a close/reopen cycle before a newly typed phrase can
  // be retrieved.
  useEffect(() => {
    const onContentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; content?: string }>).detail;
      if (detail?.path && typeof detail.content === "string") {
        liveContentRef.current.set(detail.path, detail.content);
      }
    };
    window.addEventListener("openonyx:note-content-changed", onContentChanged as EventListener);
    return () => window.removeEventListener("openonyx:note-content-changed", onContentChanged as EventListener);
  }, []);

  useEffect(() => {
    const input = askInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [askQuery]);

  useEffect(() => {
    if (!isSourcesOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSourcesOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSourcesOpen]);

  // ── Model status ───────────────────────────────────
  const [modelStatus, setModelStatus] = useState<string>(
    isModelLoaded() ? "ready" : "not loaded"
  );
  const [modelProgress, setModelProgress] = useState(isModelLoaded() ? 100 : 0);

  useEffect(() => {
    setProgressCallback((progress, status) => {
      setModelProgress(progress);
      setModelStatus(status);
    });
    return () => setProgressCallback(null);
  }, []);

  // ── Embedding store ────────────────────────────────
  const [store, setStore] = useState<EmbeddingStore>(loadStore);
  const indexedCount = store.entries.size;

  const refreshEmbeddingStore = useCallback(() => {
    const currentStore = loadStore();
    setStore({ entries: new Map(currentStore.entries) });
  }, []);

  // Disk loading and background indexing mutate the shared store outside
  // React. Mirror each completed update so counts and intelligence refresh.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshEmbeddingStore, 120);
    };

    void loadStoreAsync().then(refreshEmbeddingStore);
    window.addEventListener(EMBEDDING_UPDATED_EVENT, scheduleRefresh);
    window.addEventListener("oo:embeddings-updated", scheduleRefresh);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener(EMBEDDING_UPDATED_EVENT, scheduleRefresh);
      window.removeEventListener("oo:embeddings-updated", scheduleRefresh);
    };
  }, [refreshEmbeddingStore]);

  // Refresh immediately when navigation changes as an extra consistency check.
  useEffect(() => {
    refreshEmbeddingStore();
  }, [activeNotePath, refreshEmbeddingStore]);

  // ── Suggestion threshold (user-controlled) ────────
  const [suggestionThreshold, setSuggestionThreshold] = useState(() => {
    try {
      const saved = localStorage.getItem("openonyx-suggestion-threshold");
      return saved ? parseFloat(saved) : 0.35;
    } catch { return 0.35; }
  });

  const updateThreshold = useCallback((value: number) => {
    setSuggestionThreshold(value);
    localStorage.setItem("openonyx-suggestion-threshold", value.toString());
  }, []);

  // ── Auto-suggestions for active note ───────────────
  const [suggestions, setSuggestions] = useState<EnrichedSuggestion[]>([]);
  const [linkTypeSelector, setLinkTypeSelector] = useState<string | null>(null);

  useEffect(() => {
    if (!activeNotePath || indexedCount === 0) {
      setSuggestions([]);
      return;
    }

    (async () => {
      try {
        const currentStore = loadStore();
        const raw = findSimilar(currentStore, activeNotePath, Math.max(0.35, suggestionThreshold), 25);
        const weighted = applyHistoryWeighting(activeNotePath, raw);
        const basic = weighted.map((s) => ({ ...s, title: getNoteName(s.path) }));

        // Load source + target contents for enrichment
        let sourceContent = "";
        try { sourceContent = await api.readFile(activeNotePath); } catch { /* empty */ }

        const noteContents = new Map<string, string>();
        await Promise.all(
          basic.map(async (s) => {
            try {
              const content = await api.readFile(s.path);
              noteContents.set(s.path, content);
            } catch { /* skip */ }
          }),
        );

        const enriched = enrichSuggestions(sourceContent, basic, noteContents);
        // Filter threshold and deduplicate titles
        const uniqueSuggestions = enriched
          .filter((s) => s.similarity >= suggestionThreshold)
          .filter(
            (candidate, index, list) =>
              list.findIndex(
                (item) =>
                  item.path === candidate.path ||
                  item.title.toLowerCase().trim() === candidate.title.toLowerCase().trim(),
              ) === index,
          )
          .slice(0, 20);

        setSuggestions(uniqueSuggestions);
      } catch { /* silent */ }
    })();
  }, [activeNotePath, indexedCount, suggestionThreshold, api, store]);

  const handleAcceptSuggestion = useCallback(
    async (targetPath: string, linkType: LinkType) => {
      if (!activeNotePath) return;
      try {
        const content = await api.readFile(activeNotePath);
        const targetName = getNoteName(targetPath);
        const linkText = linkType === "related"
          ? `[[${targetName}]]`
          : `[[${targetName}]] %%${linkType}%%`;
        const separator = content.endsWith("\n") ? "\n" : "\n\n";
        await api.writeFile(activeNotePath, content + separator + linkText + "\n");
        recordSuggestion({ sourcePath: activeNotePath, targetPath, action: "accepted", timestamp: Date.now() });
        setSuggestions((prev) => prev.filter((s) => s.path !== targetPath));
        setLinkTypeSelector(null);
      } catch (err) {
        console.error("Failed to create link:", err);
      }
    },
    [activeNotePath, api],
  );

  const handleRejectSuggestion = useCallback(
    (targetPath: string) => {
      if (!activeNotePath) return;
      recordSuggestion({ sourcePath: activeNotePath, targetPath, action: "rejected", timestamp: Date.now() });
      setSuggestions((prev) => prev.filter((s) => s.path !== targetPath));
      setLinkTypeSelector(null);
    },
    [activeNotePath],
  );

  // ── Insights: Clusters + Missing Links + Unwritten Insights + Synthesis ──
  const [clusters, setClusters] = useState<NoteCluster[]>([]);
  const [missingLinks, setMissingLinks] = useState<MissingLinkSuggestion[]>([]);
  const [unwrittenInsights, setUnwrittenInsights] = useState<UnwrittenInsight[]>([]);
  const [synthesisResult, setSynthesisResult] = useState<SynthesisResult | null>(null);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [synthesisTargetKey, setSynthesisTargetKey] = useState<string | null>(null);
  const [synthesizingTargetKey, setSynthesizingTargetKey] = useState<string | null>(null);
  const [isCalculatingInsights, setIsCalculatingInsights] = useState(false);
  const [selectedClusterIdx, setSelectedClusterIdx] = useState<number | null>(null);
  const [collapsedInsightSections, setCollapsedInsightSections] = useState<Record<"unwritten" | "clusters" | "missingLinks", boolean>>({
    unwritten: false,
    clusters: false,
    missingLinks: false,
  });

  useEffect(() => {
    setSynthesisResult(null);
    setSynthesisError(null);
    setSynthesisTargetKey(null);
  }, [aiSettings.modelId, aiSettings.provider, aiSettings.customBaseUrl]);

  const toggleInsightSection = useCallback((section: keyof typeof collapsedInsightSections) => {
    setCollapsedInsightSections((current) => ({ ...current, [section]: !current[section] }));
  }, []);

  // Insight dismissal cooldown (prevent noise)
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("openonyx-dismissed-insights");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set<string>(); }
  });

  const dismissInsight = useCallback((insight: UnwrittenInsight) => {
    const key = [...insight.relatedNotes].sort().join("|");
    setDismissedInsights((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem("openonyx-dismissed-insights", JSON.stringify([...next]));
      return next;
    });
    setUnwrittenInsights((prev) => prev.filter(
      (item) => [...item.relatedNotes].sort().join("|") !== key,
    ));
  }, []);

  // Compute clusters and insights lazily & asynchronously ONLY when on the Insights tab
  useEffect(() => {
    if (activeTab !== "insights" || indexedCount < 3) {
      return;
    }

    let isSubscribed = true;
    setIsCalculatingInsights(true);

    const timer = setTimeout(async () => {
      try {
        const currentStore = loadStore();
        const analysisLimit = getInsightAnalysisLimit(currentStore.entries.size);
        const c = detectClusters(currentStore, 0.55, 3, analysisLimit);
        if (!isSubscribed) return;
        setClusters(c);

        const candidatePaths = [...new Set([
          ...selectInsightAnalysisPaths(currentStore, analysisLimit),
          ...c.flatMap((cluster) => cluster.members),
        ])];
        const contents = new Map<string, string>();
        await mapWithConcurrency(
          candidatePaths,
          24,
          async (path) => {
            try {
              const content = await api.readFile(path);
              contents.set(path, content);
            } catch { /* skip */ }
          },
        );
        if (!isSubscribed) return;
        const signalLimit = Math.min(16, Math.max(8, Math.ceil(Math.log2(indexedCount + 1))));
        const ml = detectMissingLinks(currentStore, contents, 0.4, signalLimit, analysisLimit);
        setMissingLinks(ml);
        const rawInsights = detectUnwrittenInsights(
          currentStore,
          contents,
          0.48,
          analysisLimit,
          signalLimit,
        );
        const filtered = rawInsights
          .filter((ui) => ui.confidence >= 0.4)
          .filter((ui) => {
            const key = [...ui.relatedNotes].sort().join("|");
            return !dismissedInsights.has(key);
          })
          .slice(0, 3);
        if (!isSubscribed) return;
        setUnwrittenInsights(filtered);
      } catch { /* silent */ } finally {
        if (isSubscribed) setIsCalculatingInsights(false);
      }
    }, 50);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [activeTab, indexedCount, api, dismissedInsights, store]);

  const handleSynthesizeCluster = useCallback(
    async (clusterMembers: string[], targetKey: string) => {
      setSynthesizingTargetKey(targetKey);
      setSynthesisTargetKey(targetKey);
      setSynthesisResult(null);
      setSynthesisError(null);
      try {
        const notes = await Promise.all(
          clusterMembers.slice(0, 8).map(async (path) => {
            const content = await api.readFile(path);
            return { title: getNoteName(path), content };
          }),
        );
        const result = await generateSynthesis(notes);
        if (result) {
          setSynthesisResult(result);
        } else {
          setSynthesisError("Select at least two notes before generating a synthesis.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Synthesis failed";
        setSynthesisError(msg);
      } finally {
        setSynthesizingTargetKey(null);
      }
    },
    [api],
  );

  const handleSaveSynthesis = useCallback(async () => {
    if (!synthesisResult || !vaultPath) return;
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `Synthesis ${timestamp}.md`;
      const content = `---\ntype: synthesis\ndate: ${timestamp}\nconfidence: ${synthesisResult.confidence.toFixed(2)}\n---\n\n# Synthesis\n\n${synthesisResult.insight}\n`;
      await api.createFile(fileName, content);
      onOpenNote(fileName);
    } catch (err) {
      console.error("Failed to save synthesis:", err);
    }
  }, [synthesisResult, vaultPath, api, onOpenNote]);

  const handleAcceptMissingLink = useCallback(
    async (from: string, to: string) => {
      try {
        const content = await api.readFile(from);
        const targetName = getNoteName(to);
        const separator = content.endsWith("\n") ? "\n" : "\n\n";
        await api.writeFile(from, content + separator + `[[${targetName}]]\n`);
        setMissingLinks((prev) => prev.filter((ml) => !(ml.from === from && ml.to === to)));
      } catch (err) {
        console.error("Failed to create link:", err);
      }
    },
    [api],
  );

  const handleAskVault = useCallback(async () => {
    const question = askQuery.trim();
    if (!question || isAsking) return;

    setIsAsking(true);
    setAskError(null);
    setAskResult(null);
    setRetrievedPassages([]);
    setIsSourcesOpen(false);
    setAskStatus("Searching indexed notes…");
    try {
      const currentStore = await loadStoreAsync();
      const allPaths = [...new Set([
        ...collectMarkdownPaths(fileTree),
        ...currentStore.entries.keys(),
      ])].filter((path) => path.toLowerCase().endsWith(".md"));
      const broadSummary = isBroadSummaryQuestion(question);
      const retrievalPlan = getVaultRetrievalPlan(allPaths.length, broadSummary);
      const semanticResults = await searchByQuery(currentStore, question, retrievalPlan.semanticLimit);
      setAskStatus("Selecting the most relevant notes…");
      const semanticScores = new Map(semanticResults.map((result) => [result.path, result.similarity]));
      const queryWords = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
      const titleMatches = allPaths.filter((path) => queryWords.some((word) => path.toLowerCase().includes(word)));
      let fullTextMatches: string[] = [];
      if (allPaths.length > retrievalPlan.candidateLimit) {
        try {
          // Search the full question and meaningful individual terms. This
          // keeps a newly edited note discoverable even when its semantic
          // embedding has not yet bubbled it into the top results.
          const lexicalTerms = [...new Set(queryWords.filter((word) => word.length >= 4))];
          const searches = await Promise.all([
            api.search(question),
            ...lexicalTerms.slice(0, 4).map((term) => api.search(term)),
          ]);
          fullTextMatches = searches.flatMap((results) => results.map((result) => result.path));
        } catch {
          // The live tree and semantic results still provide a useful fallback.
        }
      }
      const semanticPaths = semanticResults.map((result) => result.path);
      const candidatePaths = broadSummary && allPaths.length > retrievalPlan.candidateLimit
        ? (() => {
            const semanticSet = new Set(semanticPaths);
            const remainingSlots = Math.max(0, retrievalPlan.candidateLimit - semanticSet.size);
            return [
              ...semanticSet,
              ...samplePathsEvenly(
                allPaths.filter((path) => !semanticSet.has(path)),
                remainingSlots,
              ),
            ];
          })()
        : allPaths.length <= retrievalPlan.candidateLimit
        ? allPaths
        : [...new Set([
            ...(activeNotePath ? [activeNotePath] : []),
            ...semanticPaths,
            ...fullTextMatches,
            ...titleMatches,
          ])].slice(0, retrievalPlan.candidateLimit);

      setAskStatus(`Reading ${candidatePaths.length} candidate notes…`);
      const documents = (await mapWithConcurrency(candidatePaths, 24, async (path) => {
        try {
          const liveContent = liveContentRef.current.get(path);
          return {
            path,
            content: liveContent ?? await api.readFile(path),
            semanticScore: semanticScores.get(path) || 0,
          };
        } catch {
          return null;
        }
      })).filter((document): document is { path: string; content: string; semanticScore: number } => document !== null);

      setAskStatus("Ranking passages and checking evidence…");
      const passages = rankVaultPassages(
        question,
        documents,
        retrievalPlan.passageLimit,
        broadSummary,
      );
      setRetrievedPassages(passages);
      if (passages.length === 0) {
        setAskResult({ answer: "I couldn't find a relevant passage in this vault.", citations: [] });
        return;
      }
      if (!hasApiKey) {
        setAskError("Relevant passages were found. Configure an AI provider in Settings to generate a cited answer.");
        return;
      }
      setAskStatus("Writing an answer with exact citations…");
      setAskResult(await answerVaultQuestion(question, passages, setAskStatus));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Unable to search the vault.");
    } finally {
      setIsAsking(false);
      setAskStatus(null);
    }
  }, [api, askQuery, fileTree, hasApiKey, isAsking, activeNotePath]);

  const displayedSources = askResult
    ? (askResult.citations.length ? askResult.citations : retrievedPassages)
    : [];

  const renderInlineSynthesis = (targetKey: string) => {
    if (synthesisTargetKey !== targetKey || (!synthesisResult && !synthesisError)) return null;
    if (synthesisError) {
      return (
        <div className={ai.synthesisInline} role="status">
          <div className={ai.insightTitle}>Synthesis unavailable</div>
          <p className={ai.sectionHint}>{synthesisError}</p>
        </div>
      );
    }
    if (!synthesisResult) return null;
    const confidence = confidenceMeta(synthesisResult.confidence);
    return (
      <div className={ai.synthesisInline}>
        <div className={ai.sectionHeader}>
          <span>Synthesis</span>
          <span className={`${ai.confidenceBadge} ${confidence.className}`}>
            {confidence.label} · {Math.round(synthesisResult.confidence * 100)}%
          </span>
        </div>
        <MarkdownReadingView markdown={synthesisResult.insight} className="vault-ai-source text-(--text-secondary)" />
        <div className={ai.synthesisActions}>
          <button type="button" className={`${ai.suggestionAccept} ${ai.compactBtn}`} onClick={handleSaveSynthesis}>
            Save as note
          </button>
          <button
            type="button"
            className={`${panelBtnGhostClass} ${ai.compactBtn}`}
            onClick={() => {
              setSynthesisResult(null);
              setSynthesisTargetKey(null);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  };

  // ── Enriched suggestion renderer ──────────────────────────────────────────

  const renderEnrichedSuggestion = (
    s: EnrichedSuggestion,
    activeLinkSel: string | null,
    setActiveLinkSel: (v: string | null) => void,
    onAccept: (path: string, linkType: LinkType) => void,
    onReject: (path: string) => void,
    onOpen: (path: string) => void,
  ) => {
    const confidence = confidenceMeta(s.similarity);
    return (
      <div key={s.path} className={ai.suggestionItem}>
        <div className={ai.suggestionContent}>
          <div className={ai.suggestionTopRow}>
            <button type="button" className={ai.suggestionInfo} onClick={() => onOpen(s.path)}>
              <span className={ai.suggestionTitle}>{s.title}</span>
            </button>
            {s.isLinked && <span className={ai.suggestionNotLinked}>Linked</span>}
          </div>
          <div className={ai.suggestionMetaRow}>
            <span className={aiTypeBadgeClass(s.type)}>{s.typeLabel}</span>
            <span className={`${ai.suggestionScore} ${confidence.className}`}>
              {confidence.label} · {Math.round(s.similarity * 100)}%
            </span>
          </div>
          <div className={ai.suggestionReason}>{s.reason}</div>
          {s.sharedConcepts.length > 0 && (
            <div className={ai.conceptList} aria-label="Shared concepts">
              {s.sharedConcepts.slice(0, 3).map((concept) => (
                <span key={concept} className={ai.conceptChip}>{concept}</span>
              ))}
            </div>
          )}
        </div>
        <div className={ai.suggestionActions}>
          {activeLinkSel === s.path ? (
            <div className={ai.linkTypeSelector}>
              {LINK_TYPES.map((lt) => (
                <button type="button" key={lt.id} className={ai.linkTypeBtn} onClick={() => { onAccept(s.path, lt.id); setActiveLinkSel(null); }}>
                  <span>{lt.symbol}</span><span>{lt.label}</span>
                </button>
              ))}
              <button type="button" className={ai.linkCancel} onClick={() => setActiveLinkSel(null)} aria-label="Cancel link type selection"><X size={10} /></button>
            </div>
          ) : (
            <>
              <button type="button" className={ai.suggestionAccept} onClick={() => setActiveLinkSel(s.path)}>
                Link note
              </button>
              <button type="button" className={ai.suggestionReject} onClick={() => onReject(s.path)}>Dismiss</button>
            </>
          )}
        </div>
      </div>
    );
  };

  const activeSignalCount = suggestions.length + missingLinks.length + unwrittenInsights.length + clusters.length;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <>
      {/* Header */}
      <div className={tm.header}>
        <div className={tm.titleBlock}>
          <div>
            <h2 className={tm.title}>Vault Intelligence</h2>
            <div className={tm.subtitle}>
              <span>{indexedCount > 0 ? `${indexedCount} notes indexed` : "Preparing your index"}</span>
              <span aria-hidden="true">•</span>
              <span>{activeSignalCount} active {activeSignalCount === 1 ? "signal" : "signals"}</span>
              <span aria-hidden="true">•</span>
              <span title={hasApiKey ? `Using ${modelLabel}` : "Analysis runs on this device"}>
                {hasApiKey ? `${modelLabel} · Vault-grounded` : "Local-first AI"}
              </span>
            </div>
          </div>
        </div>
        <div className={tm.controls}>
          <button
            className={panelBtnGhostClass}
            onClick={() => window.dispatchEvent(new CustomEvent("oo:open-ai-graph"))}
            title="Open AI Knowledge Graph (Center View)"
          >
            Graph
          </button>
          {onToggleFullScreen && (
            <button className={tm.iconBtn} onClick={onToggleFullScreen} aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}>
              {isFullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
          <button className={tm.iconBtn} onClick={onClose} aria-label="Close AI assistant">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className={tm.content}>
        {/* Model loading indicator */}
        {((modelStatus !== "ready" && modelStatus !== "not loaded" && modelStatus !== "Model ready") || isLexicalFallbackActive()) && (
          <div className={ai.modelStatus}>
            {isLexicalFallbackActive() ? (
              <Zap size={12} className="text-(--text-muted)" />
            ) : (
              <Loader2 size={12} className={tm.spinner} />
            )}
            <span>{isLexicalFallbackActive() ? "Keyword search ready while semantic indexing finishes" : modelStatus}</span>
            {!isLexicalFallbackActive() && modelProgress > 0 && modelProgress < 100 && (
              <div className={ai.modelProgress}>
                <div className={ai.modelProgressBar} style={{ width: `${modelProgress}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className={tm.tabs} role="tablist" aria-label="Vault intelligence tools">
          <button id="ai-tab-ask" type="button" role="tab" aria-controls="ai-panel-ask" aria-selected={activeTab === "ask"} tabIndex={activeTab === "ask" ? 0 : -1} className={tmTabClass(activeTab === "ask")} onClick={() => setActiveTab("ask")} onKeyDown={handleTabKeyDown}>
            <span>Ask</span>
          </button>
          <button id="ai-tab-suggestions" type="button" role="tab" aria-controls="ai-panel-suggestions" aria-selected={activeTab === "suggestions"} tabIndex={activeTab === "suggestions" ? 0 : -1} className={tmTabClass(activeTab === "suggestions")} onClick={() => setActiveTab("suggestions")} onKeyDown={handleTabKeyDown}>
            <span>Suggest</span>
          </button>
          <button id="ai-tab-insights" type="button" role="tab" aria-controls="ai-panel-insights" aria-selected={activeTab === "insights"} tabIndex={activeTab === "insights" ? 0 : -1} className={tmTabClass(activeTab === "insights")} onClick={() => setActiveTab("insights")} onKeyDown={handleTabKeyDown}>
            <span>Insights</span>
          </button>
        </div>
        <p
          key={activeTab}
          id={`ai-panel-description-${activeTab}`}
          className={tm.tabDescription}
        >
          {TAB_DESCRIPTIONS[activeTab]}
        </p>

        {/* ══ Ask Tab ═════════════════════════════════════ */}
        {activeTab === "ask" && (
          <div id="ai-panel-ask" className={ai.askPanel} role="tabpanel" aria-labelledby="ai-tab-ask" aria-describedby="ai-panel-description-ask">
            <div className={ai.askLayout}>
              <form
                className={ai.askForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAskVault();
                }}
              >
                <textarea
                  ref={askInputRef}
                  className={ai.askInput}
                  value={askQuery}
                  rows={1}
                  onChange={(event) => setAskQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleAskVault();
                    }
                  }}
                  placeholder="Ask a question about your notes…"
                  aria-label="Ask your vault"
                />
                <div className={ai.askFooter}>
                  <span className={ai.askHint}>Enter to ask · Shift+Enter for a new line</span>
                  <button className={ai.askSubmit} type="submit" disabled={!askQuery.trim() || isAsking}>
                    {isAsking ? "Working…" : "Ask vault"}
                  </button>
                </div>
              </form>

              {isAsking && askStatus && (
                <div className={ai.askProgress} role="status" aria-live="polite">
                  <span className={ai.askProgressDot} aria-hidden="true" />
                  <span>{askStatus}</span>
                </div>
              )}

              {askError && <div className={ai.askError}>{askError}</div>}

              {askResult && (
                <>
                  <CitedMarkdownAnswer
                    answer={askResult.answer}
                    citations={retrievedPassages}
                    className={ai.answer}
                    citationClassName={ai.citationMarker}
                    onOpenNote={onOpenNote}
                  />
                  {displayedSources.length > 0 && (
                    <button type="button" className={ai.sourcesButton} onClick={() => setIsSourcesOpen(true)}>
                      Sources
                      <span className={ai.sourceCount}>{displayedSources.length}</span>
                    </button>
                  )}
                </>
              )}

              {!askResult && !askError && retrievedPassages.length === 0 && !isAsking && (
                <div className={ai.askEmpty}>
                  <div className={ai.askEmptyTitle}>Search your knowledge</div>
                  <p className={ai.askEmptyCopy}>
                    Get answers grounded only in your notes. Every claim links back to its exact source passage.
                  </p>
                  <div className={ai.promptGrid}>
                    {ASK_STARTERS.map((starter) => (
                      <button
                        key={starter.title}
                        type="button"
                        className={ai.promptChip}
                        onClick={() => setAskQuery(starter.prompt)}
                      >
                        <span className={ai.promptTitle}>{starter.title}</span>
                        <span className={ai.promptDescription}>{starter.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ Suggestions Tab ═════════════════════════════ */}
        {activeTab === "suggestions" && (
          <div id="ai-panel-suggestions" className={ai.tabPanel} role="tabpanel" aria-labelledby="ai-tab-suggestions" aria-describedby="ai-panel-description-suggestions">
            {indexedCount === 0 ? (
              <div className={ai.empty}>
                <Layers size={32} style={{ opacity: 0.15 }} />
                <p>Open and save a note to start building the index automatically.</p>
              </div>
            ) : !activeNotePath ? (
              <div className={ai.empty}>
                <Link size={28} style={{ opacity: 0.15 }} />
                <p>Open a note to see similar notes suggested here.</p>
              </div>
            ) : (
              <div className={ai.suggestionsList}>
                <div className={ai.suggestionHero}>
                  <div>
                    <div className={ai.suggestionHeroTitle}>{getNoteName(activeNotePath)}</div>
                    <div className={ai.suggestionHeroMeta}>Suggested note connections</div>
                  </div>
                  <div className={ai.suggestionHeroCount}>{suggestions.length} {suggestions.length === 1 ? "suggestion" : "suggestions"}</div>
                </div>
                {/* Similarity threshold control */}
                <div className={ai.thresholdControl}>
                  <label className={ai.thresholdLabel}>
                    <span>Sensitivity</span>
                    <span className={ai.thresholdValue}>{Math.round(suggestionThreshold * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0.2"
                    max="0.7"
                    step="0.05"
                    value={suggestionThreshold}
                    onChange={(e) => updateThreshold(parseFloat(e.target.value))}
                    className={ai.thresholdSlider}
                    aria-label="Suggestion sensitivity"
                  />
                  <div className={ai.thresholdLabels}>
                    <span>Broad</span>
                    <span>Precise</span>
                  </div>
                </div>

                {suggestions.length > 0 ? (
                  (() => {
                    const strong = suggestions.filter((s) => s.group === "strong");
                    const broader = suggestions.filter((s) => s.group === "broader");
                    return (
                      <>
                        {strong.length > 0 && (
                          <div className={ai.suggestionGroup}>
                            <div className={ai.suggestionGroupLabel}>
                              <span className={`${ai.dot} ${ai.dotStrong}`} />
                              High-confidence connections
                            </div>
                            {strong.map((s) => renderEnrichedSuggestion(s, linkTypeSelector, setLinkTypeSelector, handleAcceptSuggestion, handleRejectSuggestion, onOpenNote))}
                          </div>
                        )}
                        {broader.length > 0 && (
                          <div className={ai.suggestionGroup}>
                            <div className={ai.suggestionGroupLabel}>
                              <span className={`${ai.dot} ${ai.dotBroader}`} />
                              Possible connections
                            </div>
                            {broader.map((s) => renderEnrichedSuggestion(s, linkTypeSelector, setLinkTypeSelector, handleAcceptSuggestion, handleRejectSuggestion, onOpenNote))}
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <div className={ai.empty}>
                    <p>No similar notes found for "{getNoteName(activeNotePath)}".</p>
                    <p className={ai.sectionHint}>Lower sensitivity to see broader matches, or save notes to update.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isSourcesOpen && displayedSources.length > 0 && (
          <>
            <button
              type="button"
              className={ai.sourcesBackdrop}
              onClick={() => setIsSourcesOpen(false)}
              aria-label="Close sources"
            />
            <aside className={ai.sourcesDrawer} aria-label="Answer sources">
              <div className={ai.sourcesDrawerHeader}>
                <span className="text-[13px] font-semibold text-(--text-primary)">Sources</span>
                <span className={ai.sourceCount}>{displayedSources.length}</span>
                <button
                  type="button"
                  className={`${tm.iconBtn} ml-auto`}
                  onClick={() => setIsSourcesOpen(false)}
                  aria-label="Close sources"
                  autoFocus
                >
                  <X size={15} />
                </button>
              </div>
              <div className={ai.sourcesDrawerBody}>
                {displayedSources.map((source) => (
                  <button
                    key={`${source.path}:${source.startLine}`}
                    type="button"
                    className={ai.sourceCard}
                    onClick={() => {
                      setIsSourcesOpen(false);
                      onOpenNote(source.path);
                    }}
                  >
                    <div className={ai.sourceHeader}>
                      <span className="truncate">{source.path.split("/").pop() || source.title}</span>
                      <span className={ai.sourceLocation}>L{source.startLine}–{source.endLine}</span>
                    </div>
                    {source.heading && <div className="mt-1 text-[10px] font-medium text-(--text-muted)">{source.heading}</div>}
                    <MarkdownReadingView markdown={source.excerpt} className={ai.sourceExcerpt} />
                  </button>
                ))}
              </div>
            </aside>
          </>
        )}

        {/* ══ Insights Tab ════════════════════════════════ */}
        {activeTab === "insights" && (
          <div id="ai-panel-insights" className={ai.tabPanelScroll} role="tabpanel" aria-labelledby="ai-tab-insights" aria-describedby="ai-panel-description-insights">
            {isCalculatingInsights ? (
              <div className={ai.empty}>
                <Loader2 size={24} className={tm.spinner} />
                <p>Analyzing graph intelligence...</p>
              </div>
            ) : indexedCount < 3 ? (
              <div className={ai.empty}>
                <Layers size={32} style={{ opacity: 0.15 }} />
                <p>Need at least 3 indexed notes for graph intelligence.</p>
              </div>
            ) : (
              <>
                {/* Unwritten Insights */}
                {unwrittenInsights.length > 0 && (
                  <div className={ai.insightSection}>
                    <div className={ai.sectionHeader}>
                      <button
                        type="button"
                        className={ai.sectionToggle}
                        onClick={() => toggleInsightSection("unwritten")}
                        aria-expanded={!collapsedInsightSections.unwritten}
                        aria-controls="vault-insights-unwritten"
                      >
                        <ChevronRight size={14} className={`${ai.sectionChevron} ${collapsedInsightSections.unwritten ? "" : "rotate-90"}`} />
                        <span>Unwritten Insights</span>
                        <span className={ai.sectionBadge}>{unwrittenInsights.length}</span>
                      </button>
                    </div>
                    {!collapsedInsightSections.unwritten && (
                    <div id="vault-insights-unwritten" className="space-y-2.5">
                      <p className={ai.sectionHint}>Found across your indexed vault; no open note is required.</p>
                      <div className={ai.unwrittenList}>
                      {unwrittenInsights.map((insight) => {
                        const insightKey = [...insight.relatedNotes].sort().join("|");
                        const synthesisKey = `insight:${insightKey}`;
                        const relatedNotes = [...new Set(insight.relatedNotes)];
                        const confidence = confidenceMeta(insight.confidence);
                        return (
                          <div key={insightKey} className={ai.unwrittenItem}>
                            <div className={ai.insightTitle}>{insightObservation(insight, relatedNotes[0])}</div>
                            <div className={ai.suggestionMetaRow}>
                              <span className={aiTypeBadgeClass("related")}>Connection opportunity</span>
                              <span className={`${ai.confidenceBadge} ${confidence.className}`}>
                                {confidence.label} · {Math.round(insight.confidence * 100)}%
                              </span>
                            </div>
                            <div className={ai.unwrittenDescription}>{insight.description}</div>
                            <div className={ai.unwrittenNotes}>
                              {relatedNotes.slice(0, 3).map((path) => (
                                <button type="button" key={path} className={ai.clusterMember} onClick={() => onOpenNote(path)}>
                                  <span>{getNoteName(path)}</span>
                                </button>
                              ))}
                              {relatedNotes.length > 3 && (
                                <span className={ai.confidenceBadge}>
                                  plus {relatedNotes.length - 3} related {relatedNotes.length - 3 === 1 ? "note" : "notes"}
                                </span>
                              )}
                            </div>
                            <div className={ai.unwrittenFooter}>
                              <div className={ai.unwrittenActions}>
                                <button
                                  type="button"
                                  className={`${ai.suggestionAccept} ${ai.compactBtn}`}
                                  onClick={() => handleAcceptMissingLink(relatedNotes[0], relatedNotes[1])}
                                  disabled={relatedNotes.length < 2}
                                >
                                  Connect
                                </button>
                                {relatedNotes.length >= 2 && (
                                  <button
                                    type="button"
                                    className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                                    onClick={() => handleSynthesizeCluster(relatedNotes, synthesisKey)}
                                    disabled={!hasApiKey || synthesizingTargetKey !== null}
                                    title={hasApiKey ? "Synthesize these notes" : "Configure an AI provider in Settings to synthesize notes"}
                                  >
                                    {synthesizingTargetKey === synthesisKey ? "Working…" : "Synthesize"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                                  onClick={() => dismissInsight(insight)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                            {renderInlineSynthesis(synthesisKey)}
                          </div>
                        );
                      })}
                      </div>
                    </div>
                    )}
                  </div>
                )}

                {/* Clusters */}
                <div className={ai.section}>
                  <div className={ai.sectionHeader}>
                    <button
                      type="button"
                      className={ai.sectionToggle}
                      onClick={() => toggleInsightSection("clusters")}
                      aria-expanded={!collapsedInsightSections.clusters}
                      aria-controls="vault-insights-clusters"
                    >
                      <ChevronRight size={14} className={`${ai.sectionChevron} ${collapsedInsightSections.clusters ? "" : "rotate-90"}`} />
                      <span>Note Clusters</span>
                      <span className={ai.sectionBadge}>{clusters.length}</span>
                    </button>
                    <button
                      type="button"
                      className={`${panelBtnGhostClass} ${ai.compactBtn} ml-auto`}
                      onClick={() => window.dispatchEvent(new CustomEvent("oo:open-ai-graph"))}
                      title="Open AI Knowledge Graph in Center View"
                    >
                      AI Graph
                    </button>
                  </div>
                  {!collapsedInsightSections.clusters && (clusters.length === 0 ? (
                    <p className={ai.sectionHint}>No strong clusters detected yet.</p>
                  ) : (
                    <div id="vault-insights-clusters" className={ai.clusterList}>
                      {clusters.map((cluster, idx) => {
                        const confidence = confidenceMeta(cluster.confidence);
                        const clusterKey = `cluster:${[...cluster.members].sort().join("|")}`;
                        return (
                        <div key={`${cluster.center}:${idx}`} className={`${ai.clusterItem} ${selectedClusterIdx === idx ? ai.clusterItemActive : ""}`}>
                          <div className={ai.clusterHeader}>
                            <button
                              type="button"
                              className={ai.clusterHeaderBtn}
                              onClick={() => setSelectedClusterIdx(selectedClusterIdx === idx ? null : idx)}
                              aria-expanded={selectedClusterIdx === idx}
                            >
                              <span className={ai.clusterSummary}>
                                <span className={ai.clusterName}>{getNoteName(cluster.center)} + {cluster.members.length - 1} notes</span>
                                <span className={ai.clusterDescription}>{clusterObservation(cluster)}</span>
                              </span>
                            </button>
                            <div className={ai.clusterHeaderActions}>
                              <span className={`${ai.confidenceBadge} ${confidence.className}`}>
                                {confidence.label} · {Math.round(cluster.confidence * 100)}%
                              </span>
                              {cluster.confidence >= 0.3 && (
                                <button
                                  type="button"
                                  className={`${ai.suggestionAccept} ${ai.compactBtn}`}
                                  onClick={() => handleSynthesizeCluster(cluster.members, clusterKey)}
                                  disabled={!hasApiKey || synthesizingTargetKey !== null}
                                  title={hasApiKey ? "Synthesize this cluster" : "Configure an AI provider in Settings to synthesize clusters"}
                                >
                                  {synthesizingTargetKey === clusterKey ? (
                                    <><Loader2 size={10} className={tm.spinner} /> Working…</>
                                  ) : (
                                    <>Synthesize</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                          {selectedClusterIdx === idx && (
                            <div className={ai.clusterMembers}>
                              {cluster.members.map((path) => (
                                <button type="button" key={path} className={ai.clusterMember} onClick={() => onOpenNote(path)}>
                                  <span>{getNoteName(path)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {renderInlineSynthesis(clusterKey)}
                        </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Missing Links */}
                <div className={ai.section}>
                  <div className={ai.sectionHeader}>
                    <button
                      type="button"
                      className={ai.sectionToggle}
                      onClick={() => toggleInsightSection("missingLinks")}
                      aria-expanded={!collapsedInsightSections.missingLinks}
                      aria-controls="vault-insights-missing-links"
                    >
                      <ChevronRight size={14} className={`${ai.sectionChevron} ${collapsedInsightSections.missingLinks ? "" : "rotate-90"}`} />
                      <span>Missing Links</span>
                      <span className={ai.sectionBadge}>{missingLinks.length}</span>
                    </button>
                  </div>
                  {!collapsedInsightSections.missingLinks && (missingLinks.length === 0 ? (
                    <p className={ai.sectionHint}>All strongly related notes are already linked.</p>
                  ) : (
                    <div id="vault-insights-missing-links" className={ai.suggestionsListFlush}>
                      {missingLinks.map((ml, idx) => {
                        const confidence = confidenceMeta(ml.similarity);
                        return (
                        <div key={idx} className={ai.suggestionItem}>
                          <div className={ai.insightTitle}>These notes appear related but are not linked.</div>
                          <div className={ai.suggestionMetaRow}>
                            <span className={aiTypeBadgeClass("related")}>Related</span>
                            <span className={`${ai.suggestionScore} ${confidence.className}`}>
                              {confidence.label} · {Math.round(ml.similarity * 100)}%
                            </span>
                          </div>
                          <div className={ai.missingLinkInfo}>
                            <button type="button" className={ai.clusterMember} onClick={() => onOpenNote(ml.from)}>
                              <span>{getNoteName(ml.from)}</span>
                            </button>
                            <span className={ai.missingLinkArrow}>→</span>
                            <button type="button" className={ai.clusterMember} onClick={() => onOpenNote(ml.to)}>
                              <span>{getNoteName(ml.to)}</span>
                            </button>
                          </div>
                          <div className={ai.suggestionReason}>{ml.reason}</div>
                          <div className={ai.suggestionActions}>
                            <button type="button" className={ai.suggestionAccept} onClick={() => handleAcceptMissingLink(ml.from, ml.to)}>
                              Link notes
                            </button>
                            <button type="button" className={`${panelBtnGhostClass} ${ai.compactBtn}`} onClick={() => setMissingLinks((prev) => prev.filter((_, i) => i !== idx))}>
                              Dismiss
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default AIPage;
