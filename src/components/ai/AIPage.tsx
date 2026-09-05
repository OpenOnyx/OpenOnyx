/**
 * AIPage — Semantic Intelligence Panel
 *
 * Tabs:
 *  1. Suggest — auto-suggestions for active note
 *  2. Insights — clusters, missing links, unwritten insights, synthesis
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getAPI } from "../../utils/api";
import { FileEntry, Theme } from "../../types";
import {
  Sparkles,
  Loader2,
  X,
  Maximize,
  Minimize,
  FileText,
  Check,
  Link,
  Lightbulb,
  Layers,
  GitBranch,
  CircleDot,
  Save,
  Eye,
  Zap,
  Network,
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
  type EmbeddingStore,
} from "../../utils/embeddings";
import {
  detectClusters,
  detectMissingLinks,
  detectUnwrittenInsights,
  generateSynthesis,
  type NoteCluster,
  type MissingLinkSuggestion,
  type UnwrittenInsight,
  type SynthesisResult,
} from "../../utils/synthesis";
import {
  loadSettings,
  type AISettings,
} from "../../utils/ai-settings";
import { LINK_TYPES, type LinkType } from "./SuggestionBanner";
import { enrichSuggestions, type EnrichedSuggestion } from "../../utils/suggestion-enrichment";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNoteName(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") || path;
}

const tm = {
  header: "flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-(--border-subtle) bg-(--bg-secondary) px-4 py-3",
  title: "m-0 text-[15px] font-semibold leading-tight tracking-normal text-(--text-primary)",
  titleBlock: "flex min-w-0 items-center gap-2.5",
  subtitle: "mt-1 text-[11px] leading-tight text-(--text-muted)",
  controls: "flex shrink-0 items-center gap-2",
  stats: "inline-flex h-7 items-center gap-1.5 rounded-md border border-(--border-subtle) bg-(--bg-primary) px-2 text-[11px] font-medium text-(--text-secondary)",
  iconBtn: "inline-flex h-8 w-8 items-center justify-center rounded-md border border-(--border-subtle) bg-transparent text-(--text-muted) transition-colors duration-150 hover:border-(--border-medium) hover:bg-(--bg-active) hover:text-(--text-primary)",
  content: "flex min-h-0 flex-1 flex-col bg-(--bg-primary)",
  tabs: "flex shrink-0 gap-1 border-b border-(--border-subtle) bg-(--bg-primary) px-3 pt-2",
  tab: "inline-flex h-9 items-center gap-1.5 rounded-t-md border border-transparent border-b-0 px-3 text-[12px] font-medium text-(--text-muted) transition-colors duration-150 hover:bg-(--bg-active) hover:text-(--text-primary)",
  tabActive: "border-(--border-subtle) bg-(--bg-secondary) text-(--text-primary)",
  spinner: "animate-spin text-(--text-muted)",
};

const tmTabClass = (active: boolean) => `${tm.tab} ${active ? tm.tabActive : ""}`;
const panelBtnBaseClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-(--border-subtle) px-2.5 text-[11px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";
const panelBtnGhostClass =
  `${panelBtnBaseClass} bg-transparent text-(--text-secondary) hover:border-(--border-medium) hover:bg-(--bg-active) hover:text-(--text-primary)`;

const ai = {
  modelStatus: "mx-3 mt-3 flex items-center gap-2 rounded-md border border-(--border-subtle) bg-(--bg-secondary) px-3 py-2 text-[12px] text-(--text-secondary)",
  modelProgress: "h-1 flex-1 overflow-hidden rounded-full bg-(--border-subtle)",
  modelProgressBar: "h-full rounded-full bg-(--text-secondary)",
  empty: "m-3 flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-(--border-subtle) bg-(--bg-secondary) p-6 text-center text-[13px] leading-relaxed text-(--text-muted)",
  tabPanel: "min-h-0 flex-1 overflow-y-auto p-3",
  tabPanelScroll: "min-h-0 flex-1 space-y-3 overflow-y-auto p-3",
  suggestionsList: "space-y-3",
  suggestionsListFlush: "space-y-2",
  suggestionsHeader: "text-[10px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)",
  suggestionHero: "flex items-center justify-between gap-3 rounded-lg border border-(--border-subtle) bg-(--bg-secondary) px-3 py-2.5",
  suggestionHeroTitle: "truncate text-[13px] font-semibold text-(--text-primary)",
  suggestionHeroMeta: "mt-0.5 text-[11px] text-(--text-muted)",
  suggestionHeroCount: "flex h-8 min-w-8 items-center justify-center rounded-md border border-(--border-subtle) bg-(--bg-primary) px-2 text-[13px] font-semibold tabular-nums text-(--text-primary)",
  suggestionItem: "grid cursor-default grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-(--border-subtle) bg-(--bg-secondary) p-3 transition-colors duration-150 hover:border-(--border-medium)",
  suggestionContent: "min-w-0 space-y-2",
  suggestionTopRow: "flex min-w-0 items-center gap-2",
  suggestionInfo: "min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left",
  suggestionTitle: "block truncate text-[13px] font-medium text-(--text-primary)",
  suggestionScore: "shrink-0 rounded border border-(--border-subtle) bg-(--bg-primary) px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-(--text-muted)",
  suggestionActions: "flex shrink-0 items-start gap-1.5",
  suggestionAccept: "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-(--border-medium) bg-(--bg-active) px-2 text-[11px] font-medium text-(--text-primary) transition-colors duration-150 hover:border-(--border-strong) hover:bg-(--bg-hover)",
  suggestionReject: "inline-flex h-7 w-7 items-center justify-center rounded-md border border-(--border-subtle) bg-transparent text-(--text-muted) transition-colors duration-150 hover:border-(--color-red) hover:bg-[rgba(220,80,80,0.08)] hover:text-(--color-red)",
  suggestionGroup: "space-y-2",
  suggestionGroupLabel: "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)",
  suggestionReason: "flex items-start gap-1.5 text-[11px] leading-relaxed text-(--text-secondary)",
  suggestionNotLinked: "shrink-0 text-[12px] text-(--text-faint)",
  typeBadgeBase: "inline-flex items-center gap-0.5 px-[5px] py-px rounded-[3px] text-[9px] font-semibold uppercase tracking-[0.3px] shrink-0 leading-[1.3]",
  dot: "w-1.5 h-1.5 rounded-full shrink-0",
  dotStrong: "bg-(--text-primary)",
  dotBroader: "bg-(--text-muted)",
  linkTypeSelector: "flex items-center gap-0.5",
  linkTypeBtn: "flex items-center gap-[3px] px-1.5 py-0.5 border border-(--border-subtle) rounded bg-transparent text-(--text-muted) text-[10px] cursor-pointer transition-colors duration-150 whitespace-nowrap hover:bg-(--bg-active) hover:text-(--text-primary) hover:border-(--border-medium)",
  linkCancel: "flex items-center p-0.5 border-none bg-transparent text-(--text-muted) cursor-pointer rounded",
  sectionHeader: "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--text-secondary)",
  sectionBadge: "ml-auto rounded border border-(--border-subtle) bg-(--bg-primary) px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-(--text-muted)",
  sectionHint: "m-0 text-[12px] leading-relaxed text-(--text-muted)",
  section: "space-y-2.5 rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-3",
  result: "rounded-md border border-(--border-subtle) bg-(--bg-primary) p-3 text-[13px] leading-relaxed text-(--text-secondary)",
  clusterList: "space-y-2",
  clusterItem: "overflow-hidden rounded-lg border border-(--border-subtle) bg-(--bg-primary)",
  clusterItemActive: "border-(--border-medium) bg-(--bg-active)",
  clusterHeaderBtn: "flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left text-(--text-secondary) transition-colors duration-150 hover:bg-(--bg-active) hover:text-(--text-primary)",
  clusterName: "min-w-0 flex-1 truncate text-[12px] font-medium",
  clusterMembers: "space-y-1.5 border-t border-(--border-subtle) px-3 py-2.5",
  clusterMember: "inline-flex max-w-full items-center gap-1.5 rounded-md border border-(--border-subtle) bg-(--bg-secondary) px-2 py-1 text-[11px] text-(--text-secondary) transition-colors duration-150 hover:border-(--border-medium) hover:bg-(--bg-active) hover:text-(--text-primary) [&_span]:truncate",
  missingLinkInfo: "flex min-w-0 flex-1 flex-wrap items-center gap-1.5",
  missingLinkArrow: "text-[12px] text-(--text-faint)",
  confidenceBadge: "shrink-0 rounded border border-(--border-subtle) bg-(--bg-primary) px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-(--text-muted)",
  unwrittenList: "space-y-2",
  unwrittenItem: "relative space-y-2 rounded-lg border border-(--border-subtle) bg-(--bg-primary) p-3",
  unwrittenDescription: "flex gap-2 text-[12px] leading-relaxed text-(--text-secondary)",
  unwrittenNotes: "flex flex-wrap gap-1.5",
  unwrittenActions: "flex flex-wrap gap-1.5",
  compactBtn: "h-7 px-2 text-[10px]",
  thresholdControl: "rounded-lg border border-(--border-subtle) bg-(--bg-secondary) p-3",
  thresholdLabel: "flex justify-between items-center text-[11px] text-(--text-muted) mb-1",
  thresholdValue: "font-semibold tabular-nums",
  thresholdSlider: "w-full h-1 appearance-none bg-(--border-subtle) rounded-sm outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--text-secondary) [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-150 hover:[&::-webkit-slider-thumb]:bg-(--text-primary)",
  thresholdLabels: "flex justify-between text-[10px] text-(--text-muted) mt-0.5 opacity-60",
};

const aiTypeBadgeClass = (type: EnrichedSuggestion["type"]) => {
  const tone =
    type === "expands" ? "bg-[rgba(80,140,220,0.12)] text-[rgb(100,160,240)]" :
    type === "contradicts" ? "bg-[rgba(220,160,60,0.12)] text-[rgb(220,170,80)]" :
    type === "example" ? "bg-[rgba(80,180,120,0.12)] text-[rgb(80,180,120)]" :
    "bg-[rgba(128,128,128,0.12)] text-(--text-secondary)";
  return `${ai.typeBadgeBase} ${tone}`;
};

const aiConfidenceClass = (similarity: number) =>
  similarity >= 0.7 ? "bg-[color-mix(in_srgb,var(--bg-secondary)_94%,var(--text-primary)_6%)]" :
  similarity >= 0.5 ? "" :
  "opacity-75";

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

type AITab = "suggestions" | "insights";

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
  const [activeTab, setActiveTab] = useState<AITab>("suggestions");

  // ── AI Settings ────────────────────────────────────
  const [aiSettings, setAiSettings] = useState<AISettings>(loadSettings);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setAiSettings(loadSettings());
    };
    window.addEventListener("ai-settings-changed", handleSettingsChanged);
    return () => {
      window.removeEventListener("ai-settings-changed", handleSettingsChanged);
    };
  }, []);

  const hasApiKey = !!aiSettings.apiKey;

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

  // Update store state on activeNotePath change
  useEffect(() => {
    setStore(loadStore());
  }, [activeNotePath]);

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
  }, [activeNotePath, indexedCount, suggestionThreshold, api]);

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
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isCalculatingInsights, setIsCalculatingInsights] = useState(false);
  const [selectedClusterIdx, setSelectedClusterIdx] = useState<number | null>(null);

  // Insight dismissal cooldown (prevent noise)
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("openonyx-dismissed-insights");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set<string>(); }
  });

  const dismissInsight = useCallback((idx: number) => {
    const insight = unwrittenInsights[idx];
    if (!insight) return;
    const key = insight.relatedNotes.sort().join("|");
    setDismissedInsights((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem("openonyx-dismissed-insights", JSON.stringify([...next]));
      return next;
    });
    setUnwrittenInsights((prev) => prev.filter((_, i) => i !== idx));
  }, [unwrittenInsights]);

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
        const c = detectClusters(currentStore, 0.4, 3, 40);
        if (!isSubscribed) return;
        setClusters(c);

        const candidatePaths = Array.from(currentStore.entries.keys()).slice(0, 15);
        const contents = new Map<string, string>();
        await Promise.all(
          candidatePaths.map(async (path) => {
            try {
              const content = await api.readFile(path);
              contents.set(path, content);
            } catch { /* skip */ }
          }),
        );
        if (!isSubscribed) return;
        const ml = detectMissingLinks(currentStore, contents, 0.4, 8);
        setMissingLinks(ml);
        const rawInsights = detectUnwrittenInsights(currentStore, contents, 0.35);
        const filtered = rawInsights
          .filter((ui) => ui.confidence >= 0.4)
          .filter((ui) => {
            const key = ui.relatedNotes.sort().join("|");
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
  }, [activeTab, indexedCount, api, dismissedInsights]);

  const handleSynthesizeCluster = useCallback(
    async (clusterMembers: string[]) => {
      setIsSynthesizing(true);
      setSynthesisResult(null);
      try {
        const notes = await Promise.all(
          clusterMembers.slice(0, 5).map(async (path) => {
            const content = await api.readFile(path);
            return { title: getNoteName(path), content };
          }),
        );
        const result = await generateSynthesis(notes);
        if (result) {
          setSynthesisResult(result);
        } else {
          setSynthesisResult({ insight: "Could not generate synthesis. Ensure API key is configured.", confidence: 0 });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Synthesis failed";
        setSynthesisResult({ insight: `⚠️ ${msg}`, confidence: 0 });
      } finally {
        setIsSynthesizing(false);
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

  // ── Enriched suggestion renderer ──────────────────────────────────────────

  const renderEnrichedSuggestion = (
    s: EnrichedSuggestion,
    activeLinkSel: string | null,
    setActiveLinkSel: (v: string | null) => void,
    onAccept: (path: string, linkType: LinkType) => void,
    onReject: (path: string) => void,
    onOpen: (path: string) => void,
  ) => {
    return (
      <div key={s.path} className={`${ai.suggestionItem} ${aiConfidenceClass(s.similarity)} ${s.isLinked ? "opacity-50" : ""}`}>
        <div className={ai.suggestionContent}>
          <div className={ai.suggestionTopRow}>
            <span className={aiTypeBadgeClass(s.type)}>
              {s.typeSymbol} {s.typeLabel}
            </span>
            <button className={ai.suggestionInfo} onClick={() => onOpen(s.path)}>
              <span className={ai.suggestionTitle}>{s.title}</span>
            </button>
            <span className={ai.suggestionScore}>{Math.round(s.similarity * 100)}%</span>
            {!s.isLinked && (
              <span className={ai.suggestionNotLinked} title="Not yet linked">⊘</span>
            )}
          </div>
          <div className={ai.suggestionReason}>
            <Sparkles size={10} />
            <span>{s.reason}</span>
          </div>
        </div>
        <div className={ai.suggestionActions}>
          {activeLinkSel === s.path ? (
            <div className={ai.linkTypeSelector}>
              {LINK_TYPES.map((lt) => (
                <button key={lt.id} className={ai.linkTypeBtn} onClick={() => { onAccept(s.path, lt.id); setActiveLinkSel(null); }}>
                  <span>{lt.symbol}</span><span>{lt.label}</span>
                </button>
              ))}
              <button className={ai.linkCancel} onClick={() => setActiveLinkSel(null)}><X size={10} /></button>
            </div>
          ) : (
            <>
              <button className={ai.suggestionAccept} onClick={() => setActiveLinkSel(s.path)} title="Create link">
                <Check size={12} /> Link
              </button>
              <button className={ai.suggestionReject} onClick={() => onReject(s.path)} title="Dismiss"><X size={12} /></button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <>
      {/* Header */}
      <div className={tm.header}>
        <div className={tm.titleBlock}>
          <div>
            <h2 className={tm.title}>Semantic Intelligence</h2>
            <div className={tm.subtitle}>
              {indexedCount > 0 ? `${indexedCount} indexed notes` : "Index pending"}
              <span aria-hidden="true"> / </span>
              {hasApiKey ? "AI ready" : "Local analysis"}
            </div>
          </div>
        </div>
        <div className={tm.controls}>
          {indexedCount > 0 && (
            <div className={tm.stats}>
              <Sparkles size={12} />
              <span>{suggestions.length + missingLinks.length + unwrittenInsights.length} signals</span>
            </div>
          )}
          <button
            className={tm.iconBtn}
            onClick={() => window.dispatchEvent(new CustomEvent("oo:open-ai-graph"))}
            title="Open AI Knowledge Graph (Center View)"
            aria-label="Open AI Knowledge Graph"
          >
            <Network size={16} />
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
            <span>{isLexicalFallbackActive() ? "Using keyword search (semantic model not loaded)" : modelStatus}</span>
            {!isLexicalFallbackActive() && modelProgress > 0 && modelProgress < 100 && (
              <div className={ai.modelProgress}>
                <div className={ai.modelProgressBar} style={{ width: `${modelProgress}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className={tm.tabs}>
          <button className={tmTabClass(activeTab === "suggestions")} onClick={() => setActiveTab("suggestions")}>
            <Link size={14} /> Suggest
          </button>
          <button className={tmTabClass(activeTab === "insights")} onClick={() => setActiveTab("insights")}>
            <Lightbulb size={14} /> Insights
          </button>
        </div>

        {/* ══ Suggestions Tab ═════════════════════════════ */}
        {activeTab === "suggestions" && (
          <div className={ai.tabPanel}>
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
                  <div className={ai.suggestionHeroCount}>{suggestions.length}</div>
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
                              Strong Matches
                            </div>
                            {strong.map((s) => renderEnrichedSuggestion(s, linkTypeSelector, setLinkTypeSelector, handleAcceptSuggestion, handleRejectSuggestion, onOpenNote))}
                          </div>
                        )}
                        {broader.length > 0 && (
                          <div className={ai.suggestionGroup}>
                            <div className={ai.suggestionGroupLabel}>
                              <span className={`${ai.dot} ${ai.dotBroader}`} />
                              Broader Connections
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

        {/* ══ Insights Tab ════════════════════════════════ */}
        {activeTab === "insights" && (
          <div className={ai.tabPanelScroll}>
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
                  <div className={ai.section}>
                    <div className={ai.sectionHeader}>
                      <Zap size={12} style={{ opacity: 0.5 }} />
                      <span>Unwritten Insights</span>
                      <span className={ai.sectionBadge}>{unwrittenInsights.length}</span>
                    </div>
                    <div className={ai.unwrittenList}>
                      {unwrittenInsights.map((insight, idx) => (
                        <div key={idx} className={ai.unwrittenItem}>
                          <div className={ai.unwrittenDescription}>
                            <Eye size={11} style={{ opacity: 0.4, flexShrink: 0, marginTop: 2 }} />
                            <span>{insight.description}</span>
                          </div>
                          <div className={ai.unwrittenNotes}>
                            {insight.relatedNotes.slice(0, 4).map((path) => (
                              <button key={path} className={ai.clusterMember} onClick={() => onOpenNote(path)}>
                                <FileText size={10} />
                                <span>{getNoteName(path)}</span>
                              </button>
                            ))}
                          </div>
                          <div className={ai.unwrittenActions}>
                            <button
                              className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                              onClick={() => handleAcceptMissingLink(insight.relatedNotes[0], insight.relatedNotes[1])}
                            >
                              <Link size={10} /> Connect
                            </button>
                            {hasApiKey && insight.relatedNotes.length >= 2 && (
                              <button
                                className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                                onClick={() => handleSynthesizeCluster(insight.relatedNotes)}
                                disabled={isSynthesizing}
                              >
                                <Sparkles size={10} /> Synthesize
                              </button>
                            )}
                            <button
                              className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                              onClick={() => dismissInsight(idx)}
                            >
                              <X size={10} />
                            </button>
                          </div>
                          <span className={ai.confidenceBadge}>{Math.round(insight.confidence * 100)}% confidence</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clusters */}
                <div className={ai.section}>
                  <div className={ai.sectionHeader}>
                    <CircleDot size={12} style={{ opacity: 0.5 }} />
                    <span>Note Clusters</span>
                    <span className={ai.sectionBadge}>{clusters.length}</span>
                    <button
                      type="button"
                      className={`${panelBtnGhostClass} ${ai.compactBtn} ml-auto`}
                      onClick={() => window.dispatchEvent(new CustomEvent("oo:open-ai-graph"))}
                      title="Open AI Knowledge Graph in Center View"
                    >
                      <Network size={10} /> AI Graph
                    </button>
                  </div>
                  {clusters.length === 0 ? (
                    <p className={ai.sectionHint}>No strong clusters detected yet.</p>
                  ) : (
                    <div className={ai.clusterList}>
                      {clusters.map((cluster, idx) => (
                        <div key={idx} className={`${ai.clusterItem} ${selectedClusterIdx === idx ? ai.clusterItemActive : ""}`}>
                          <button className={ai.clusterHeaderBtn} onClick={() => setSelectedClusterIdx(selectedClusterIdx === idx ? null : idx)}>
                            <GitBranch size={12} />
                            <span className={ai.clusterName}>{getNoteName(cluster.center)} + {cluster.members.length - 1} notes</span>
                            <span className={ai.confidenceBadge}>{Math.round(cluster.confidence * 100)}%</span>
                          </button>
                          {selectedClusterIdx === idx && (
                            <div className={ai.clusterMembers}>
                              {cluster.members.map((path) => (
                                <button key={path} className={ai.clusterMember} onClick={() => onOpenNote(path)}>
                                  <FileText size={10} />
                                  <span>{getNoteName(path)}</span>
                                </button>
                              ))}
                              {hasApiKey && cluster.confidence >= 0.3 && (
                                <button
                                  className={`${panelBtnGhostClass} ${ai.compactBtn}`}
                                  onClick={() => handleSynthesizeCluster(cluster.members)}
                                  disabled={isSynthesizing}
                                  style={{ marginTop: 4 }}
                                >
                                  {isSynthesizing ? (
                                    <><Loader2 size={10} className={tm.spinner} /> Synthesizing...</>
                                  ) : (
                                    <><Sparkles size={10} /> Synthesize cluster</>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Synthesis result */}
                {synthesisResult && (
                  <div className={ai.section}>
                    <div className={ai.sectionHeader}>
                      <Sparkles size={12} style={{ opacity: 0.5 }} />
                      <span>Synthesis</span>
                      <span className={ai.confidenceBadge}>{Math.round(synthesisResult.confidence * 100)}% confidence</span>
                    </div>
                    <div className={ai.result}>
                      <p>{synthesisResult.insight}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className={`${panelBtnGhostClass} ${ai.compactBtn}`} onClick={handleSaveSynthesis}>
                        <Save size={10} /> Save as note
                      </button>
                      <button className={`${panelBtnGhostClass} ${ai.compactBtn}`} onClick={() => setSynthesisResult(null)}>
                        <X size={10} /> Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Missing Links */}
                <div className={ai.section}>
                  <div className={ai.sectionHeader}>
                    <Link size={12} style={{ opacity: 0.5 }} />
                    <span>Missing Links</span>
                    <span className={ai.sectionBadge}>{missingLinks.length}</span>
                  </div>
                  {missingLinks.length === 0 ? (
                    <p className={ai.sectionHint}>All strongly related notes are already linked.</p>
                  ) : (
                    <div className={ai.suggestionsListFlush}>
                      {missingLinks.map((ml, idx) => (
                        <div key={idx} className={ai.suggestionItem}>
                          <div className={ai.missingLinkInfo}>
                            <button className={ai.clusterMember} onClick={() => onOpenNote(ml.from)}>
                              <FileText size={10} /><span>{getNoteName(ml.from)}</span>
                            </button>
                            <span className={ai.missingLinkArrow}>→</span>
                            <button className={ai.clusterMember} onClick={() => onOpenNote(ml.to)}>
                              <FileText size={10} /><span>{getNoteName(ml.to)}</span>
                            </button>
                            <span className={ai.suggestionScore}>{ml.reason}</span>
                          </div>
                          <div className={ai.suggestionActions}>
                            <button className={ai.suggestionAccept} onClick={() => handleAcceptMissingLink(ml.from, ml.to)}>
                              <Check size={10} /> Link
                            </button>
                            <button className={ai.suggestionReject} onClick={() => setMissingLinks((prev) => prev.filter((_, i) => i !== idx))}>
                              <X size={10} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
