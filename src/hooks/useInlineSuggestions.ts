import { useState, useEffect, useCallback, useRef } from "react";
import { Tab, PaneNode } from "../types";
import { type LinkType } from "../components/ai/SuggestionBanner";
import { type EnrichedSuggestion } from "../utils/suggestion-enrichment";
import { getAPI } from "../utils/api";
import {
  loadStore,
  findSimilar,
  applyHistoryWeighting,
  loadSuggestionHistory,
  loadTransitionMap,
  recordSuggestion,
  recordIgnoredSuggestions,
  getTransitionBoost,
  recordTransition,
} from "../utils/embeddings";
import {
  enrichSuggestions,
} from "../utils/suggestion-enrichment";
import {
  getCachedAnnotation,
  getAnnotation,
} from "../utils/ai-core";
import {
  deriveCurrentConcept,
  extractConceptTokens,
  getTransitionLikelihood,
} from "../utils/firstThought";

const api = getAPI();
const GRAPH_TAB_PATH = "__graph__.view";
const SPACES_TAB_PATH = "__spaces__.view";
const isCanvasFile = (path: string) => path.toLowerCase().endsWith(".canvas");
const isHostEditableMarkdownPath = (path: string | null | undefined): path is string => {
  if (!path) return false;
  if (path === "__new_tab__" || path === GRAPH_TAB_PATH || path === SPACES_TAB_PATH) return false;
  if (path.startsWith("__")) return false;
  if (isCanvasFile(path)) return false;
  return path.toLowerCase().endsWith(".md");
};

interface InlineSuggestionsOptions {
  vaultPath: string | null;
  tabs: Tab[];
  activeTabId: string | null;
  paneTree: PaneNode;
  setCurrentContent: (content: string) => void;
  loadBacklinks: (path: string) => void;
  currentContentRef: React.MutableRefObject<string>;
  collectAllActiveTabPaths: (node: PaneNode) => string[];
}

export function useInlineSuggestions({
  vaultPath,
  tabs,
  activeTabId,
  paneTree,
  setCurrentContent,
  loadBacklinks,
  currentContentRef,
  collectAllActiveTabPaths,
}: InlineSuggestionsOptions) {
  const [inlineSuggestions, setInlineSuggestions] = useState<EnrichedSuggestion[]>([]);
  const [nextStepSuggestions, setNextStepSuggestions] = useState<EnrichedSuggestion[]>([]);
  const [inlineSuggestionsByPath, setInlineSuggestionsByPath] = useState<Record<string, EnrichedSuggestion[]>>({});
  const [nextStepSuggestionsByPath, setNextStepSuggestionsByPath] = useState<Record<string, EnrichedSuggestion[]>>({});
  const [inlineAnnotationByPath, setInlineAnnotationByPath] = useState<Record<string, string | null>>({});
  const [generatingInsightPaths, setGeneratingInsightPaths] = useState<Set<string>>(new Set());
  const [showInlineInsightByTab, setShowInlineInsightByTab] = useState<Record<string, boolean>>({});

  const refreshInlineSuggestions = useCallback(async (notePath: string) => {
    try {
      const store = loadStore();
      if (store.entries.size === 0) {
        setInlineSuggestions([]);
        setNextStepSuggestions([]);
        return;
      }
      // Generation stage: filter out low-similarity candidates
      const raw = findSimilar(store, notePath, 0.35, 30);
      const weighted = applyHistoryWeighting(notePath, raw);
      const basic = weighted.map((s: any) => ({
        ...s,
        title: s.path.split("/").pop()?.replace(/\.md$/, "") || s.path,
      }));

      // Load target note contents for enrichment
      let sourceContent = "";
      try { sourceContent = await api.readFile(notePath); } catch { /* empty */ }

      const noteContents = new Map<string, string>();
      for (const s of basic) {
        try {
          const content = await api.readFile(s.path);
          noteContents.set(s.path, content);
        } catch { /* skip */ }
      }

      const history = loadSuggestionHistory();
      const accepted = history
        .filter(
          (record: any) =>
            record.sourcePath === notePath &&
            record.action === "accepted",
        )
        .sort((a: any, b: any) => b.timestamp - a.timestamp)
        .slice(0, 16);

      const acceptedConceptWeights = new Map<string, number>();
      if (accepted.length > 0) {
        const now = Date.now();
        for (const record of accepted) {
          const ageDays = Math.max(0, (now - record.timestamp) / (24 * 60 * 60 * 1000));
          const recencyWeight = Math.max(0.35, 1 - ageDays / 21);
          const targetName = record.targetPath
            .split("/")
            .pop()
            ?.replace(/\.md$/, "")
            .toLowerCase() || "";
          const tokens = targetName
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((token: string) => token.length > 2);
          for (const token of tokens) {
            acceptedConceptWeights.set(
              token,
              (acceptedConceptWeights.get(token) || 0) + recencyWeight,
            );
          }
        }
      }

      const sourceConcept = deriveCurrentConcept(sourceContent);
      const transitionMap = loadTransitionMap();

      // Candidate generation with strict quality filter.
      const enriched = enrichSuggestions(sourceContent, basic, noteContents)
        .map((suggestion: any) => {
          const candidateTokens = `${suggestion.title} ${suggestion.sharedConcepts.join(" ")}`
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((token: string) => token.length > 2);

          let trajectoryBoost = 0;
          if (acceptedConceptWeights.size > 0) {
            const tokenSet = new Set(candidateTokens);
            let overlapScore = 0;
            tokenSet.forEach((token) => {
              overlapScore += acceptedConceptWeights.get(token) || 0;
            });
            trajectoryBoost = Math.min(0.12, overlapScore * 0.028);
          }

          const transitionBoost = sourceConcept
            ? getTransitionBoost(sourceConcept, candidateTokens)
            : 0;
          const totalBoost = trajectoryBoost + transitionBoost;
          if (totalBoost <= 0) return suggestion;

          return {
            ...suggestion,
            similarity: Math.max(0, Math.min(1, suggestion.similarity + totalBoost)),
          };
        })
        .filter((suggestion: any) => suggestion.similarity >= 0.38 && (suggestion.sharedConcepts.length > 0 || suggestion.similarity >= 0.5))
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .slice(0, 24);

      const sessionIntentTokens = [...acceptedConceptWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([token]) => token);

      const clusterContextTokens = new Set<string>();
      enriched
        .filter((item: any) => item.group === "strong")
        .slice(0, 6)
        .forEach((item: any) => {
          item.sharedConcepts.forEach((concept: string) => {
            extractConceptTokens(concept, 4).forEach((token) => {
              clusterContextTokens.add(token);
            });
          });
        });

      const nextSteps = enriched
        .map((suggestion: any) => {
          // Strict relevance check: candidate MUST be genuinely connected to the current note
          const isRelevantToCurrentNote =
            suggestion.sharedConcepts.length > 0 || suggestion.similarity >= 0.42;
          if (!isRelevantToCurrentNote) return null;

          const candidateTokens = extractConceptTokens(
            `${suggestion.title} ${suggestion.sharedConcepts.join(" ")}`,
            10,
          );
          if (candidateTokens.length === 0) return null;

          const intentOverlap = candidateTokens.reduce(
            (sum, token) => sum + (acceptedConceptWeights.get(token) || 0),
            0,
          );

          const transitionLikelihood = sourceConcept
            ? getTransitionLikelihood(transitionMap, sourceConcept, candidateTokens)
            : 0;

          const clusterOverlap =
            candidateTokens.filter((token) => clusterContextTokens.has(token)).length /
            Math.max(1, candidateTokens.length);

          const sessionIntentOverlap =
            sessionIntentTokens.length > 0
              ? candidateTokens.filter((token) => sessionIntentTokens.includes(token)).length /
                sessionIntentTokens.length
              : 0;

          const guidanceScore =
            suggestion.similarity * 0.34 +
            Math.min(0.28, intentOverlap * 0.06) +
            Math.min(0.24, transitionLikelihood * 0.8) +
            clusterOverlap * 0.12 +
            sessionIntentOverlap * 0.1;

          const primaryHint = suggestion.sharedConcepts[0] || suggestion.title;
          const guidanceReason =
            transitionLikelihood > 0.02
              ? `Likely next direction based on recent flow toward ${primaryHint}`
              : `Builds your current trajectory around ${primaryHint}`;

          return {
            ...suggestion,
            similarity: Math.min(1, Math.max(suggestion.similarity, guidanceScore)),
            reason: guidanceReason,
          };
        })
        .filter((item: any): item is EnrichedSuggestion => Boolean(item))
        .sort((a: any, b: any) => b.similarity - a.similarity)
        .filter(
          (candidate: any, index: number, list: any[]) =>
            list.findIndex(
              (item: any) =>
                item.path === candidate.path ||
                item.title.toLowerCase().trim() === candidate.title.toLowerCase().trim(),
            ) === index,
        )
        .slice(0, 4);

      setInlineSuggestions(enriched);
      setNextStepSuggestions(nextSteps);
      setInlineSuggestionsByPath((prev) => ({ ...prev, [notePath]: enriched }));
      setNextStepSuggestionsByPath((prev) => ({ ...prev, [notePath]: nextSteps }));
    } catch { /* silent */ }
  }, [collectAllActiveTabPaths]);

  const refreshInlineAnnotation = useCallback((notePath: string) => {
    const cached = getCachedAnnotation(notePath);
    setInlineAnnotationByPath(prev => ({ ...prev, [notePath]: cached }));
  }, []);

  // Track previous note for decay recording
  const prevActiveTabRef = useRef<string | null>(null);

  // Refresh suggestions when active tab changes
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const currentPath = tab?.path.endsWith(".md") ? tab.path : null;

    // Record ignored suggestions for the note we're leaving
    if (prevActiveTabRef.current && prevActiveTabRef.current !== currentPath) {
      const prevPath = prevActiveTabRef.current;
      if (inlineSuggestions.length > 0) {
        recordIgnoredSuggestions(prevPath, inlineSuggestions.map((s) => s.path));
      }
    }
    prevActiveTabRef.current = currentPath;

    if (currentPath) {
      refreshInlineSuggestions(currentPath);
      refreshInlineAnnotation(currentPath);
    } else {
      setInlineSuggestions([]);
      setNextStepSuggestions([]);
    }
  }, [activeTabId, tabs, refreshInlineSuggestions, refreshInlineAnnotation]);

  // Pre-load suggestions for all active tabs in all split panes
  useEffect(() => {
    const activePaths = collectAllActiveTabPaths(paneTree);
    for (const path of activePaths) {
      if (path && !inlineSuggestionsByPath[path]) {
        refreshInlineSuggestions(path);
      }
    }
  }, [paneTree, tabs, refreshInlineSuggestions, inlineSuggestionsByPath, collectAllActiveTabPaths]);

  useEffect(() => {
    const onEmbeddingUpdated = (event: Event) => {
      const updatedPath = (event as CustomEvent<{ path?: string }>).detail?.path;
      const pathsToRefresh = new Set(
        collectAllActiveTabPaths(paneTree).filter((path) =>
          isHostEditableMarkdownPath(path),
        ),
      );

      const activePath = tabs.find((tab) => tab.id === activeTabId)?.path;
      if (activePath && isHostEditableMarkdownPath(activePath)) {
        pathsToRefresh.add(activePath);
      }
      if (updatedPath && isHostEditableMarkdownPath(updatedPath)) {
        pathsToRefresh.add(updatedPath);
      }

      pathsToRefresh.forEach((path: string) => {
        void refreshInlineSuggestions(path);
      });
    };

    window.addEventListener("openonyx:embedding-updated", onEmbeddingUpdated as EventListener);
    return () => {
      window.removeEventListener("openonyx:embedding-updated", onEmbeddingUpdated as EventListener);
    };
  }, [activeTabId, paneTree, refreshInlineSuggestions, tabs, collectAllActiveTabPaths]);

  const handleInlineAccept = useCallback(
    async (targetPath: string, linkType: LinkType) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      try {
        const content = (await api.readFile(tab.path)) || "";
        const targetName = targetPath.split("/").pop()?.replace(/\.md$/, "") || targetPath;
        const sourceConcept = deriveCurrentConcept(content);
        const acceptedSuggestion = inlineSuggestions.find((item) => item.path === targetPath);
        const targetConcept =
          extractConceptTokens(
            acceptedSuggestion
              ? `${acceptedSuggestion.title} ${acceptedSuggestion.sharedConcepts.join(" ")}`
              : targetName,
            1,
          )[0] || null;

        if (sourceConcept && targetConcept) {
          recordTransition(sourceConcept, targetConcept);
        }

        const linkText =
          linkType === "related"
            ? `[[${targetName}]]`
            : `[[${targetName}]] %%${linkType}%%`;
        const separator = content.endsWith("\n") ? "\n" : "\n\n";
        await api.writeFile(tab.path, content + separator + linkText + "\n");
        recordSuggestion({
          sourcePath: tab.path,
          targetPath,
          action: "accepted",
          timestamp: Date.now(),
        });

        setInlineSuggestions((prev) => prev.filter((s) => s.path !== targetPath));
        // Reload editor content
        const updated = (await api.readFile(tab.path)) || "";
        setCurrentContent(updated);
      } catch (err) {
        console.error("Failed to create link:", err);
      }
    },
    [activeTabId, inlineSuggestions, tabs, setCurrentContent],
  );

  const handleInlineReject = useCallback(
    (targetPath: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      recordSuggestion({
        sourcePath: tab.path,
        targetPath,
        action: "rejected",
        timestamp: Date.now(),
      });

      setInlineSuggestions((prev) => prev.filter((s) => s.path !== targetPath));
    },
    [activeTabId, tabs],
  );

  const handleGenerateInsight = useCallback(async (path: string, tabId: string) => {
    if (!path || isCanvasFile(path)) return;

    setGeneratingInsightPaths((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });

    try {
      let content = "";
      if (activeTabId === tabId) {
        content = currentContentRef.current;
      } else {
        content = await api.readFile(path);
      }

      const ann = await getAnnotation(path, content);
      if (ann) {
        setInlineAnnotationByPath((prev) => ({
          ...prev,
          [path]: ann,
        }));
      }
    } catch (err) {
      console.warn("[Insight] Generation failed:", err);
    } finally {
      setGeneratingInsightPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [activeTabId, currentContentRef]);

  return {
    inlineSuggestions,
    setInlineSuggestions,
    nextStepSuggestions,
    setNextStepSuggestions,
    inlineSuggestionsByPath,
    setInlineSuggestionsByPath,
    nextStepSuggestionsByPath,
    setNextStepSuggestionsByPath,
    inlineAnnotationByPath,
    setInlineAnnotationByPath,
    generatingInsightPaths,
    setGeneratingInsightPaths,
    showInlineInsightByTab,
    setShowInlineInsightByTab,
    refreshInlineSuggestions,
    refreshInlineAnnotation,
    handleInlineAccept,
    handleInlineReject,
    handleGenerateInsight,
  };
}
