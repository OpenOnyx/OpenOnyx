import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  Maximize,
  Minimize,
  Network,
  RefreshCw,
  Settings,
  Target,
  X,
} from "lucide-react";
import { Theme } from "../../types";
import { GraphRenderer } from "./GraphRenderer";
import { getDefaultSettings as getManualDefaultSettings } from "./GraphView";
import {
  loadStoreAsync,
  loadSuggestionHistory,
  loadTransitionMap,
} from "../../utils/embeddings";
import { getAPI } from "../../utils/api";
import { askAI, isAIConfigured } from "../../utils/ai-core";

const api = getAPI();

interface CachedGraph {
  vaultPath: string;
  graphData: any;
}
let cachedGraph: CachedGraph | null = null;

const AI_GRAPH_SIMILARITY_THRESHOLD = 0.45;
const AI_GRAPH_CLUSTER_THRESHOLD = 0.58;
const AI_GRAPH_MAX_EDGES_PER_NODE = 4;
const AI_GRAPH_DEFAULT_MAX_NODES = 180;
const AI_GRAPH_MIN_NODES = 100;
const AI_GRAPH_MAX_NODES = 1000;
const AI_GRAPH_LAYOUT_EDGES_PER_NODE = 2;
const AI_GRAPH_LAYOUT_MAX_AVERAGE_DEGREE = 2.2;

const CLUSTER_COLORS = [
  "#6ee7b7",
  "#60a5fa",
  "#f59e0b",
  "#f87171",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#22d3ee",
  "#cbd5e1",
];

function getVaultHash(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const chr = path.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function noteNameFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") || path;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

interface AIKnowledgeGraphProps {
  onNodeClick: (noteName: string, heading?: string, notePath?: string) => void;
  onClose: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  theme?: Theme;
  vaultPath?: string | null;
  fileTree?: unknown;
  localNodePath?: string;
  onCreateGroupFromPaths?: (name: string, color: string, paths: string[]) => void;
  onOpenPathsAsGroup?: (paths: string[]) => void;
}

interface SimilarityPair {
  source: string;
  target: string;
  similarity: number;
}

interface AIGraphNode {
  id: string;
  name: string;
  path: string;
  clusterId: number;
  connections: number;
  updatedAt: number;
  x?: number;
  y?: number;
}

interface AIGraphEdge {
  source: string;
  target: string;
  similarity: number;
  hiddenConnection: boolean;
}

interface DirectionalFlowInsight {
  source: string;
  target: string;
  count: number;
  confidence: number;
}

interface BridgeNoteInsight {
  path: string;
  name: string;
  bridgeClusters: number;
  clusterIds: number[];
  relatedPaths: string[];
}

interface IdeaIslandInsight {
  clusterId: number;
  size: number;
  internalStrength: number;
  memberPaths: string[];
}

interface AIGraphData {
  nodes: AIGraphNode[];
  edges: AIGraphEdge[];
  directionalFlows: DirectionalFlowInsight[];
  clusterCount: number;
  hiddenConnectionCount: number;
  bridgeNotes: BridgeNoteInsight[];
  ideaIslands: IdeaIslandInsight[];
}

interface AIGraphSettings {
  threshold: number;
  clusterThreshold: number;
  maxEdgesPerNode: number;
  maxNodes: number;
  showHiddenOnly: boolean;
  focusMode: boolean;
  showDirectionalFlow: boolean;
  searchTerm: string;
}

type DisplayGraphEdge = AIGraphEdge & {
  directed?: boolean;
};

function getDefaultSettings(theme: Theme): AIGraphSettings {
  return {
    threshold: AI_GRAPH_SIMILARITY_THRESHOLD,
    clusterThreshold: AI_GRAPH_CLUSTER_THRESHOLD,
    maxEdgesPerNode: AI_GRAPH_MAX_EDGES_PER_NODE,
    maxNodes: AI_GRAPH_DEFAULT_MAX_NODES,
    showHiddenOnly: false,
    focusMode: true,
    showDirectionalFlow: true,
    searchTerm: "",
  };
}

function getManualGraphSettingsKey(theme: Theme, vaultHash: string): string {
  return `openonyx-graph-settings-v8-${theme}-${vaultHash}`;
}

function getManualGraphSettings(
  theme: Theme,
  vaultHash: string,
): ReturnType<typeof getManualDefaultSettings> {
  const defaults = getManualDefaultSettings(theme);
  let manualSettings = defaults;

  try {
    const saved = localStorage.getItem(getManualGraphSettingsKey(theme, vaultHash));
    if (saved) manualSettings = { ...manualSettings, ...JSON.parse(saved) };
  } catch {
    // Ignore invalid or inaccessible persisted graph settings.
  }

  if (theme === "custom") {
    return {
      ...manualSettings,
      backgroundColor: defaults.backgroundColor,
    };
  }

  return manualSettings;
}

function buildStrongAdjacency(
  nodes: AIGraphNode[],
  edges: AIGraphEdge[],
  clusterThreshold: number,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());

  for (const edge of edges) {
    if (edge.similarity < clusterThreshold) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  return adjacency;
}

function tokenizeGraphConcept(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 8);
}

function connectedComponents(
  nodes: AIGraphNode[],
  adjacency: Map<string, Set<string>>,
): Map<string, number> {
  const clusterByNode = new Map<string, number>();
  let clusterId = 0;

  for (const node of nodes) {
    if (clusterByNode.has(node.id)) continue;

    const queue = [node.id];
    clusterByNode.set(node.id, clusterId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (clusterByNode.has(neighbor)) continue;
        clusterByNode.set(neighbor, clusterId);
        queue.push(neighbor);
      }
    }

    clusterId += 1;
  }

  return clusterByNode;
}

function buildManualEdgeSet(data: {
  nodes: Array<{ id: string; path: string }>;
  edges: Array<{ source: string | { id: string }; target: string | { id: string } }>;
} | null): Set<string> {
  if (!data) return new Set();

  const idToPath = new Map<string, string>();
  for (const node of data.nodes || []) {
    idToPath.set(node.id, node.path || node.id);
  }

  const manual = new Set<string>();
  for (const edge of data.edges || []) {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    const sourcePath = idToPath.get(sourceId) || sourceId;
    const targetPath = idToPath.get(targetId) || targetId;
    manual.add(pairKey(sourcePath, targetPath));
  }

  return manual;
}

function buildLayoutEdges(nodes: AIGraphNode[], edges: DisplayGraphEdge[]): DisplayGraphEdge[] {
  if (nodes.length === 0 || edges.length === 0) return [];

  const nodeIds = new Set(nodes.map((node) => node.id));
  const selected: DisplayGraphEdge[] = [];
  const selectedKeys = new Set<string>();
  const degree = new Map<string, number>();
  const maxEdges = Math.max(
    nodes.length - 1,
    Math.min(edges.length, Math.ceil(nodes.length * AI_GRAPH_LAYOUT_MAX_AVERAGE_DEGREE)),
  );
  const maxDegree = Math.max(3, Math.ceil(Math.log2(nodes.length + 1)));

  for (const node of nodes) degree.set(node.id, 0);

  const addEdge = (edge: DisplayGraphEdge, ignoreDegreeCap = false) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    const key = pairKey(edge.source, edge.target);
    if (selectedKeys.has(key)) return false;
    if (!ignoreDegreeCap) {
      if ((degree.get(edge.source) || 0) >= maxDegree) return false;
      if ((degree.get(edge.target) || 0) >= maxDegree) return false;
    }
    if (selected.length >= maxEdges) return false;

    selectedKeys.add(key);
    selected.push(edge);
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    return true;
  };

  const rankedEdges = [...edges].sort((a, b) => {
    const manualDelta = Number(!b.hiddenConnection) - Number(!a.hiddenConnection);
    if (manualDelta !== 0) return manualDelta;
    const directionalDelta = Number(Boolean(b.directed)) - Number(Boolean(a.directed));
    if (directionalDelta !== 0) return directionalDelta;
    return b.similarity - a.similarity;
  });

  for (const edge of rankedEdges) {
    if (!edge.hiddenConnection) addEdge(edge, true);
  }

  const perNodeHiddenEdges = new Map<string, DisplayGraphEdge[]>();
  for (const edge of rankedEdges) {
    if (!edge.hiddenConnection) continue;

    const sourceEdges = perNodeHiddenEdges.get(edge.source) || [];
    sourceEdges.push(edge);
    perNodeHiddenEdges.set(edge.source, sourceEdges);

    const targetEdges = perNodeHiddenEdges.get(edge.target) || [];
    targetEdges.push(edge);
    perNodeHiddenEdges.set(edge.target, targetEdges);
  }

  for (const node of nodes) {
    const candidates = perNodeHiddenEdges.get(node.id) || [];
    for (const edge of candidates.slice(0, AI_GRAPH_LAYOUT_EDGES_PER_NODE)) {
      addEdge(edge);
    }
  }

  for (const edge of rankedEdges) {
    if (selected.length >= maxEdges) break;
    addEdge(edge);
  }

  return selected;
}

function getAIGraphForces(
  manualSettings: ReturnType<typeof getManualDefaultSettings>,
  nodeCount: number,
) {
  const sizeBoost = Math.max(1, Math.min(2.5, Math.sqrt(Math.max(nodeCount, 1) / 180)));

  return {
    centerStrength: Math.max(0.008, (manualSettings.centerForce / 100) * 0.32),
    repelStrength: manualSettings.repelForce * 18 * sizeBoost,
    linkStrength: (manualSettings.linkForce / 50) * 0.22,
    linkDistance: manualSettings.linkDistance * 4.8,
    collisionRadius: 90,
  };
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="graph-section">
      <button type="button" className="graph-section-header" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="graph-section-arrow">{open ? "▼" : "▶"}</span>
      </button>
      {open && <div className="graph-section-content">{children}</div>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="graph-toggle-row" onClick={() => onChange(!checked)}>
      <span className="graph-toggle-label">{label}</span>
      <div className={`graph-toggle-switch ${checked ? "active" : ""}`}>
        <div className="graph-toggle-thumb" />
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="graph-slider-row">
      <label className="graph-slider-label">{label}</label>
      <div className="graph-slider-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="graph-slider"
        />
        <span className="graph-slider-value">{value}</span>
      </div>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
  presets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="graph-color-row">
      <label className="graph-color-label">{label}</label>
      <div className="graph-color-control">
        <div style={{ position: "relative" }} ref={popoverRef}>
          <button
            className="graph-color-input"
            style={{ backgroundColor: value }}
            onClick={() => setIsOpen((v) => !v)}
            type="button"
          />
          {isOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "8px",
                zIndex: 1000,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-medium)",
                borderRadius: "var(--radius-md)",
                boxShadow: "none",
                padding: "8px",
              }}
            >
              <HexColorPicker color={value} onChange={onChange} />
            </div>
          )}
        </div>
        {presets && (
          <div className="graph-color-presets">
            {presets.map((c) => (
              <button
                key={c}
                className="graph-color-preset"
                style={{ backgroundColor: c }}
                onClick={() => onChange(c)}
                type="button"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AIKnowledgeGraph({
  onNodeClick,
  onClose,
  isFullScreen = false,
  onToggleFullScreen,
  theme = "dark",
  vaultPath,
  onCreateGroupFromPaths,
  onOpenPathsAsGroup,
}: AIKnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const similarityCacheRef = useRef<Map<string, SimilarityPair[]>>(new Map());
  const hasRenderedGraphRef = useRef(false);

  const isDark =
    theme === "dark" ||
    theme === "oceanic" ||
    theme === "dark-plus" ||
    theme === "blue-night" ||
    theme === "ember-night" ||
    theme === "aurora-grove";
  const vaultHash = useMemo(() => getVaultHash(vaultPath || "default"), [vaultPath]);

  const [manualSettingsTick, setManualSettingsTick] = useState(0);

  useEffect(() => {
    const handleManualSettingsChange = () => {
      setManualSettingsTick((tick) => tick + 1);
    };
    window.addEventListener("manual-graph-settings-changed", handleManualSettingsChange);
    window.addEventListener("oo:theme-settings-changed", handleManualSettingsChange);
    return () => {
      window.removeEventListener("manual-graph-settings-changed", handleManualSettingsChange);
      window.removeEventListener("oo:theme-settings-changed", handleManualSettingsChange);
    };
  }, []);

  let settingsKey = `openonyx-ai-graph-settings-v3-${vaultHash}-dark`;
  if (theme === "light") settingsKey = `openonyx-ai-graph-settings-v3-${vaultHash}-light`;
  if (theme === "oceanic") settingsKey = `openonyx-ai-graph-settings-v3-${vaultHash}-oceanic`;
  
  const positionsKey = `openonyx-ai-graph-positions-v4-${vaultHash}`;

  const [settings, setSettings] = useState<AIGraphSettings>(() => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) return { ...getDefaultSettings(theme), ...JSON.parse(saved) };
    } catch {
      // Ignore parse errors.
    }
    return getDefaultSettings(theme);
  });

  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<AIGraphData | null>(() => {
    if (cachedGraph && cachedGraph.vaultPath === vaultPath) {
      return cachedGraph.graphData;
    }
    return null;
  });
  const [loading, setLoading] = useState(() => {
    if (cachedGraph && cachedGraph.vaultPath === vaultPath) {
      return false;
    }
    return true;
  });
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [simulating, setSimulating] = useState(false);
  // alphaRef is written imperatively from the worker tick handler (no re-render).
  // displayAlpha is read by the progress indicator at ~10fps via a throttled interval.
  const alphaRef = useRef(0);
  const [displayAlpha, setDisplayAlpha] = useState(0);
  const [layoutResetTick, setLayoutResetTick] = useState(0);
  const [rendererInitRetry, setRendererInitRetry] = useState(0);
  const [rendererReadyTick, setRendererReadyTick] = useState(0);
  const [insightFocusNodeIds, setInsightFocusNodeIds] = useState<Set<string> | null>(null);
  const [activeInsight, setActiveInsight] = useState<{
    title: string;
    detail: string;
    relatedPaths: string[];
  } | null>(null);
  const [semanticConfig, setSemanticConfig] = useState({
    threshold: AI_GRAPH_SIMILARITY_THRESHOLD,
    clusterThreshold: AI_GRAPH_CLUSTER_THRESHOLD,
    maxEdgesPerNode: AI_GRAPH_MAX_EDGES_PER_NODE,
    maxNodes: AI_GRAPH_DEFAULT_MAX_NODES,
  });

  // ── Actionable UX States ────────────────────────────
  const [selectedEdge, setSelectedEdge] = useState<AIGraphEdge | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [aiExplainText, setAiExplainText] = useState<string | null>(null);
  const [aiExplainLoading, setAiExplainLoading] = useState<boolean>(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`openonyx-ai-dismissed-links-${vaultHash}`);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });

  const [viewMode, setViewMode] = useState<"semantic" | "timeline">("semantic");
  const [timelineValue, setTimelineValue] = useState<number>(Date.now());

  // Pathfinding states
  const [pathfindingStart, setPathfindingStart] = useState<string | null>(null);
  const [pathfindingEnd, setPathfindingEnd] = useState<string | null>(null);
  const [computedPath, setComputedPath] = useState<string[] | null>(null);
  const [pathNavigationIndex, setPathNavigationIndex] = useState<number>(0);

  // Writing engine states
  const [writingEngineOpen, setWritingEngineOpen] = useState<boolean>(false);
  const [writingOption, setWritingOption] = useState<"summary" | "article" | "study_guide" | "checklist" | null>(null);
  const [writingGeneratedText, setWritingGeneratedText] = useState<string | null>(null);
  const [writingLoading, setWritingLoading] = useState<boolean>(false);
  const [isNamingNote, setIsNamingNote] = useState<boolean>(false);
  const [noteNameInput, setNoteNameInput] = useState<string>("");

  useEffect(() => {
    if (!writingEngineOpen) {
      setIsNamingNote(false);
      setNoteNameInput("");
    }
  }, [writingEngineOpen]);

  const timestamps = useMemo(() => {
    return (graphData?.nodes || []).map((n) => n.updatedAt || 0).filter(Boolean);
  }, [graphData]);

  const { minTime, maxTime } = useMemo(() => {
    if (timestamps.length === 0) return { minTime: 0, maxTime: Date.now() };
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    return { minTime: min === max ? min - 86400000 : min, maxTime: max };
  }, [timestamps]);

  const [hasSetTimelineInitial, setHasSetTimelineInitial] = useState(false);
  useEffect(() => {
    if (maxTime && !hasSetTimelineInitial && graphData) {
      setTimelineValue(maxTime);
      setHasSetTimelineInitial(true);
    }
  }, [maxTime, graphData, hasSetTimelineInitial]);

  const keyConcepts = useMemo(() => {
    return [...(graphData?.nodes || [])]
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 5);
  }, [graphData]);

  const suggestedLinks = useMemo(() => {
    return (graphData?.edges || [])
      .filter((e) => e.hiddenConnection && !dismissedSuggestions.has(pairKey(e.source, e.target)))
      .slice(0, 5);
  }, [graphData, dismissedSuggestions]);

  useEffect(() => {
    try {
      localStorage.setItem(`openonyx-ai-dismissed-links-${vaultHash}`, JSON.stringify(Array.from(dismissedSuggestions)));
    } catch {}
  }, [dismissedSuggestions, vaultHash]);

  // Drive the simulation progress indicator at ~10fps by polling alphaRef from a throttled interval.
  // The worker writes alphaRef on every tick (60fps) but we only need UI updates at 10fps.
  useEffect(() => {
    if (!simulating) return;
    const id = window.setInterval(() => {
      setDisplayAlpha(alphaRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [simulating]);

  useEffect(() => {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // Ignore persistence failures.
    }
  }, [settings, settingsKey]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        setSettings({ ...getDefaultSettings(theme), ...JSON.parse(saved) });
      } else {
        setSettings(getDefaultSettings(theme));
      }
    } catch {
      setSettings(getDefaultSettings(theme));
    }
  }, [settingsKey, theme]);

  // Keep semantic graph rebuild responsive while dragging sliders.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSemanticConfig({
        threshold: settings.threshold,
        clusterThreshold: settings.clusterThreshold,
        maxEdgesPerNode: settings.maxEdgesPerNode,
        maxNodes: settings.maxNodes,
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    settings.threshold,
    settings.clusterThreshold,
    settings.maxEdgesPerNode,
    settings.maxNodes,
  ]);

  useEffect(() => {
    if (!vaultPath) {
      hasRenderedGraphRef.current = false;
      setGraphData({
        nodes: [],
        edges: [],
        directionalFlows: [],
        clusterCount: 0,
        hiddenConnectionCount: 0,
        bridgeNotes: [],
        ideaIslands: [],
      });
      setLoading(false);
      return;
    }

    let cancelled = false;

    const buildGraph = async () => {
      if (!hasRenderedGraphRef.current) {
        setLoading(true);
      }
      setError(null);

      try {
        const store = await loadStoreAsync();
        const allEntries = [...store.entries.values()]
          .filter((entry) => entry.path.toLowerCase().endsWith(".md"))
          .filter((entry) => entry.vector.length > 0)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, semanticConfig.maxNodes);

        if (allEntries.length === 0) {
          if (!cancelled) {
            setGraphData({
              nodes: [],
              edges: [],
              directionalFlows: [],
              clusterCount: 0,
              hiddenConnectionCount: 0,
              bridgeNotes: [],
              ideaIslands: [],
            });
          }
          return;
        }

        const cacheKey = allEntries
          .map((entry) => `${entry.path}:${entry.hash}`)
          .join("|");

        let pairwiseSimilarities = similarityCacheRef.current.get(cacheKey);
        if (!pairwiseSimilarities) {
          const pairs: SimilarityPair[] = [];
          for (let i = 0; i < allEntries.length; i++) {
            for (let j = i + 1; j < allEntries.length; j++) {
              const sim = cosineSimilarity(allEntries[i].vector, allEntries[j].vector);
              pairs.push({
                source: allEntries[i].path,
                target: allEntries[j].path,
                similarity: sim,
              });
            }
          }
          pairs.sort((a, b) => b.similarity - a.similarity);
          pairwiseSimilarities = pairs;
          similarityCacheRef.current.set(cacheKey, pairs);
        }

        const rawManualGraph = await api.getGraphData();
        const manualEdgeSet = buildManualEdgeSet(rawManualGraph || null);

        const nodeMap = new Map<string, AIGraphNode>();
        for (const entry of allEntries) {
          nodeMap.set(entry.path, {
            id: entry.path,
            name: noteNameFromPath(entry.path),
            path: entry.path,
            clusterId: 0,
            connections: 0,
            updatedAt: entry.updatedAt || 0,
          });
        }

        const degreeMap = new Map<string, number>();
        const aiEdges: AIGraphEdge[] = [];

        for (const pair of pairwiseSimilarities) {
          if (pair.similarity < semanticConfig.threshold) break;
          if (!nodeMap.has(pair.source) || !nodeMap.has(pair.target)) continue;

          const sourceDegree = degreeMap.get(pair.source) || 0;
          const targetDegree = degreeMap.get(pair.target) || 0;
          if (
            sourceDegree >= semanticConfig.maxEdgesPerNode ||
            targetDegree >= semanticConfig.maxEdgesPerNode
          ) {
            continue;
          }

          aiEdges.push({
            source: pair.source,
            target: pair.target,
            similarity: pair.similarity,
            hiddenConnection: !manualEdgeSet.has(pairKey(pair.source, pair.target)),
          });

          degreeMap.set(pair.source, sourceDegree + 1);
          degreeMap.set(pair.target, targetDegree + 1);
        }

        const nodes = [...nodeMap.values()].map((node) => ({
          ...node,
          connections: degreeMap.get(node.id) || 0,
        }));

        const strongAdjacency = buildStrongAdjacency(
          nodes,
          aiEdges,
          semanticConfig.clusterThreshold,
        );
        const clusterByNode = connectedComponents(nodes, strongAdjacency);

        const clusterNodes = new Map<number, string[]>();
        for (const node of nodes) {
          const clusterId = clusterByNode.get(node.id) || 0;
          node.clusterId = clusterId;
          const list = clusterNodes.get(clusterId) || [];
          list.push(node.id);
          clusterNodes.set(clusterId, list);
        }

        const hiddenConnectionCount = aiEdges.filter((edge) => edge.hiddenConnection).length;

        const acceptedHistory = loadSuggestionHistory().filter(
          (record) =>
            record.action === "accepted" &&
            nodeMap.has(record.sourcePath) &&
            nodeMap.has(record.targetPath),
        );
        const transitionMap = loadTransitionMap();
        const acceptedCountByDirection = new Map<string, number>();
        for (const record of acceptedHistory) {
          const key = `${record.sourcePath}->${record.targetPath}`;
          acceptedCountByDirection.set(key, (acceptedCountByDirection.get(key) || 0) + 1);
        }

        const directionalFlows: DirectionalFlowInsight[] = aiEdges
          .map((edge) => {
            const forwardAccepted =
              acceptedCountByDirection.get(`${edge.source}->${edge.target}`) || 0;
            const backwardAccepted =
              acceptedCountByDirection.get(`${edge.target}->${edge.source}`) || 0;

            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            const sourceTokens = tokenizeGraphConcept(sourceNode?.name || edge.source);
            const targetTokens = tokenizeGraphConcept(targetNode?.name || edge.target);

            let conceptForward = 0;
            for (const fromToken of sourceTokens) {
              const transitions = transitionMap[fromToken];
              if (!transitions) continue;
              for (const toToken of targetTokens) {
                conceptForward += transitions[toToken] || 0;
              }
            }

            let conceptBackward = 0;
            for (const fromToken of targetTokens) {
              const transitions = transitionMap[fromToken];
              if (!transitions) continue;
              for (const toToken of sourceTokens) {
                conceptBackward += transitions[toToken] || 0;
              }
            }

            const forwardScore = forwardAccepted + conceptForward * 0.3;
            const backwardScore = backwardAccepted + conceptBackward * 0.3;
            const totalSignal = forwardScore + backwardScore;
            if (totalSignal < 1.4 || Math.abs(forwardScore - backwardScore) < 0.35) {
              return null;
            }

            if (forwardScore >= backwardScore) {
              return {
                source: edge.source,
                target: edge.target,
                count: Math.round(forwardScore * 10) / 10,
                confidence: Math.abs(forwardScore - backwardScore) / totalSignal,
              };
            }

            return {
              source: edge.target,
              target: edge.source,
              count: Math.round(backwardScore * 10) / 10,
              confidence: Math.abs(forwardScore - backwardScore) / totalSignal,
            };
          })
          .filter((item): item is DirectionalFlowInsight => Boolean(item))
          .sort((a, b) => b.count - a.count)
          .slice(0, 60);

        const bridgeNotes: BridgeNoteInsight[] = nodes
          .map((node) => {
            const neighborClusterMap = new Map<number, string[]>();
            for (const edge of aiEdges) {
              let neighborId: string | null = null;
              if (edge.source === node.id) neighborId = edge.target;
              if (edge.target === node.id) neighborId = edge.source;
              if (!neighborId) continue;
              const neighborCluster = clusterByNode.get(neighborId);
              if (
                typeof neighborCluster === "number" &&
                neighborCluster !== node.clusterId
              ) {
                const list = neighborClusterMap.get(neighborCluster) || [];
                list.push(neighborId);
                neighborClusterMap.set(neighborCluster, list);
              }
            }
            const rankedClusters = [...neighborClusterMap.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([clusterId]) => clusterId);
            const relatedPaths = [...neighborClusterMap.values()]
              .flat()
              .filter((path, index, source) => source.indexOf(path) === index)
              .slice(0, 6);
            return {
              path: node.path,
              name: node.name,
              bridgeClusters: neighborClusterMap.size,
              clusterIds: rankedClusters,
              relatedPaths,
            };
          })
          .filter((item) => item.bridgeClusters >= 2)
          .sort((a, b) => b.bridgeClusters - a.bridgeClusters)
          .slice(0, 6);

        const ideaIslands: IdeaIslandInsight[] = [...clusterNodes.entries()]
          .map(([clusterId, clusterPaths]) => {
            const pathSet = new Set(clusterPaths);
            const internal = aiEdges.filter(
              (edge) => pathSet.has(edge.source) && pathSet.has(edge.target),
            );
            const external = aiEdges.filter(
              (edge) =>
                (pathSet.has(edge.source) && !pathSet.has(edge.target)) ||
                (!pathSet.has(edge.source) && pathSet.has(edge.target)),
            );
            const internalStrength =
              internal.length > 0
                ? internal.reduce((sum, edge) => sum + edge.similarity, 0) / internal.length
                : 0;
            return {
              clusterId,
              size: clusterPaths.length,
              internalStrength,
              externalCount: external.length,
              memberPaths: clusterPaths,
            };
          })
          .filter(
            (cluster) =>
              cluster.size >= 3 &&
              cluster.internalStrength >= 0.62 &&
              cluster.externalCount <= Math.max(1, Math.floor(cluster.size / 3)),
          )
          .sort((a, b) => b.internalStrength - a.internalStrength)
          .slice(0, 6)
          .map(({ externalCount: _externalCount, ...rest }) => rest);

        if (!cancelled) {
          hasRenderedGraphRef.current = true;
          const nextData = {
            nodes,
            edges: aiEdges,
            directionalFlows,
            clusterCount: clusterNodes.size,
            hiddenConnectionCount,
            bridgeNotes,
            ideaIslands,
          };
          if (vaultPath) {
            cachedGraph = { vaultPath, graphData: nextData };
          }
          setGraphData(nextData);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to build AI graph from embeddings.");
          console.error("[AI Graph] Build failed:", err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void buildGraph();

    return () => {
      cancelled = true;
    };
  }, [
    vaultPath,
    semanticConfig.threshold,
    semanticConfig.clusterThreshold,
    semanticConfig.maxEdgesPerNode,
    semanticConfig.maxNodes,
    reloadTick,
  ]);

  const adjacencyByNode = useMemo(() => {
    const adjacency = new Map<string, Array<{ id: string; similarity: number }>>();
    for (const node of graphData?.nodes || []) adjacency.set(node.id, []);
    for (const edge of graphData?.edges || []) {
      adjacency.get(edge.source)?.push({ id: edge.target, similarity: edge.similarity });
      adjacency.get(edge.target)?.push({ id: edge.source, similarity: edge.similarity });
    }
    adjacency.forEach((neighbors) => neighbors.sort((a, b) => b.similarity - a.similarity));
    return adjacency;
  }, [graphData]);

  const directionalByPair = useMemo(() => {
    const map = new Map<string, { source: string; target: string; confidence: number }>();
    for (const flow of graphData?.directionalFlows || []) {
      map.set(pairKey(flow.source, flow.target), {
        source: flow.source,
        target: flow.target,
        confidence: flow.confidence,
      });
    }
    return map;
  }, [graphData]);

  const clusterLabelById = useMemo(() => {
    const map = new Map<number, string>();
    const grouped = new Map<number, AIGraphNode[]>();
    for (const node of graphData?.nodes || []) {
      const list = grouped.get(node.clusterId) || [];
      list.push(node);
      grouped.set(node.clusterId, list);
    }
    grouped.forEach((members, clusterId) => {
      const lead = [...members].sort((a, b) => b.connections - a.connections)[0];
      map.set(clusterId, lead ? `Cluster ${clusterId + 1}: ${lead.name}` : `Cluster ${clusterId + 1}`);
    });
    return map;
  }, [graphData]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphData?.nodes.find((node) => node.id === selectedNodeId) || null;
  }, [graphData, selectedNodeId]);

  const focusSet = useMemo(() => {
    if (!selectedNodeId || !settings.focusMode) return null;
    const neighbors = adjacencyByNode.get(selectedNodeId) || [];
    return new Set<string>([
      selectedNodeId,
      ...neighbors.slice(0, 12).map((item) => item.id),
    ]);
  }, [adjacencyByNode, selectedNodeId, settings.focusMode]);

  const activeFocusSet = useMemo(() => {
    if (insightFocusNodeIds && insightFocusNodeIds.size > 0) return insightFocusNodeIds;
    return focusSet;
  }, [focusSet, insightFocusNodeIds]);

  const filteredData = useMemo(() => {
    const baseNodes = graphData?.nodes || [];
    const baseEdges = graphData?.edges || [];

    let nodes = [...baseNodes];

    const term = settings.searchTerm.trim().toLowerCase();
    if (term) nodes = nodes.filter((n) => n.name.toLowerCase().includes(term));

    if (activeFocusSet) nodes = nodes.filter((n) => activeFocusSet.has(n.id));

    if (viewMode === "timeline") {
      nodes = nodes.filter((n) => (n.updatedAt || 0) <= timelineValue);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = baseEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .filter((e) => !settings.showHiddenOnly || e.hiddenConnection)
      .filter((e) => !dismissedSuggestions.has(pairKey(e.source, e.target)))
      .map((e) => {
        const directional = directionalByPair.get(pairKey(e.source, e.target));
        if (settings.showDirectionalFlow && directional) {
          return {
            source: directional.source,
            target: directional.target,
            directed: true,
            similarity: e.similarity,
            hiddenConnection: e.hiddenConnection,
          };
        }
        return {
          source: e.source,
          target: e.target,
          directed: false,
          similarity: e.similarity,
          hiddenConnection: e.hiddenConnection,
        };
      });

    const signature = `${nodes.map((n) => n.id).join("|")}::${edges
      .map((e) => `${e.source}->${e.target}${e.directed ? ":d" : ""}`)
      .join("|")}`;

    return { nodes, edges: edges as DisplayGraphEdge[], signature };
  }, [
    activeFocusSet,
    directionalByPair,
    graphData,
    settings.searchTerm,
    settings.showDirectionalFlow,
    settings.showHiddenOnly,
    viewMode,
    timelineValue,
    dismissedSuggestions,
  ]);

  const layoutEdges = useMemo(
    () => buildLayoutEdges(filteredData.nodes, filteredData.edges),
    [filteredData.nodes, filteredData.edges],
  );

  useEffect(() => {
    if (!filteredData.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredData.nodes, selectedNodeId]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || loading) return;
    if (rendererRef.current && workerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      const resizeObserver = new ResizeObserver((entries) => {
        const nextRect =
          entries[0]?.contentRect || container.getBoundingClientRect();
        if (nextRect.width >= 10 && nextRect.height >= 10) {
          setRendererInitRetry((count) => count + 1);
        }
      });
      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }

    const manualSettings = getManualGraphSettings(theme, vaultHash);

    const renderer = new GraphRenderer(canvas, {
      width: rect.width,
      height: rect.height,
      backgroundColor: hexToNumber(manualSettings.backgroundColor),
      isDark,
    });
    rendererRef.current = renderer;

    const worker = new Worker(new URL("./graphWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, ids, positions, alpha: workerAlpha } = e.data;
      if (type === "tick" && renderer.isInitialized()) {
        renderer.updatePositionsFromArray(ids, new Float32Array(positions));
        // Write to ref only — no React setState, no re-render at 60fps.
        alphaRef.current = workerAlpha;
      } else if (type === "end") {
        setSimulating(false);
        alphaRef.current = 0;
        setDisplayAlpha(0);
        try {
          const allPositions = renderer.getAllPositions();
          const posObj: Record<string, { x: number; y: number }> = {};
          allPositions.forEach((pos, id) => {
            posObj[id] = pos;
          });
          localStorage.setItem(positionsKey, JSON.stringify(posObj));
        } catch {
          // Ignore position persistence errors.
        }
        renderer.centerView();
      }
    };

    let disposed = false;

    renderer
      .init()
      .then(() => {
        if (disposed || rendererRef.current !== renderer) return;

        renderer.setCallbacks({
          onNodeClick: (nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedEdge(null);
            setSelectedClusterId(null);
            setAiExplainText(null);
            renderer.selectNode(nodeId);
          },
          onEdgeClick: (sourceId, targetId) => {
            if (!sourceId || !targetId) {
              setSelectedEdge(null);
              return;
            }
            // Find edge in active graph edges list
            const edge = graphData?.edges.find(
              (e) =>
                (e.source === sourceId && e.target === targetId) ||
                (e.source === targetId && e.target === sourceId)
            );
            if (edge) {
              setSelectedEdge(edge);
              setSelectedNodeId(null);
              setSelectedClusterId(null);
              setAiExplainText(null);
            }
          },
          onNodeDrag: (nodeId, x, y, active) => {
            worker.postMessage({
              type: "drag",
              data: { id: nodeId, x, y, active },
            });
          },
        });

        const selectedClusterColor = selectedNodeId
          ? CLUSTER_COLORS[
              (graphData?.nodes.find((n) => n.id === selectedNodeId)?.clusterId || 0) %
                CLUSTER_COLORS.length
            ]
          : manualSettings.connectedColor;

        renderer.setNodeStyle({
          color: hexToNumber(manualSettings.nodeColor),
          size: manualSettings.nodeSize,
          selectedColor: hexToNumber(selectedClusterColor),
          hoveredColor: hexToNumber(selectedClusterColor),
          connectedColor: hexToNumber(selectedClusterColor),
        });
        renderer.setEdgeStyle({
          color: hexToNumber(manualSettings.edgeColor),
          width: manualSettings.linkWidth,
          highlightColor: hexToNumber(selectedClusterColor),
        });
        renderer.setLabelStyle({
          color: manualSettings.textColor,
          size: manualSettings.textSize,
          show: true,
          threshold: manualSettings.labelThreshold,
        });

        setRendererReadyTick((tick) => tick + 1);
      })
      .catch((err) => {
        console.error("[AI Graph] Renderer init failed", err);
      });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const updatedRect = container.getBoundingClientRect();
        if (updatedRect.width > 10 && updatedRect.height > 10) {
          renderer.resize(updatedRect.width, updatedRect.height);
        }
      }, 16);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, [
    loading,
    isDark,
    positionsKey,
    theme,
    vaultHash,
    manualSettingsTick,
    rendererInitRetry,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const worker = workerRef.current;
    if (!renderer || !worker || !renderer.isInitialized() || loading) return;

    if (filteredData.nodes.length === 0) {
      renderer.setData([], []);
      return;
    }

    const shouldResetLayout = layoutResetTick > 0;
    let savedPositions: Record<string, { x: number; y: number }> | null = null;
    if (!shouldResetLayout) {
      try {
        const saved = localStorage.getItem(positionsKey);
        if (saved) savedPositions = JSON.parse(saved);
      } catch {
        // Ignore invalid saved positions.
      }
    }

    const livePositions = shouldResetLayout
      ? new Map<string, { x: number; y: number }>()
      : renderer.getAllPositions();
    const nodesWithPositions = filteredData.nodes.map((n) => {
      const live = livePositions.get(n.id);
      const clusterColorHex = CLUSTER_COLORS[n.clusterId % CLUSTER_COLORS.length];
      const baseNode = {
        ...n,
        color: hexToNumber(clusterColorHex),
      };
      if (live) return { ...baseNode, ...live };
      if (savedPositions && savedPositions[n.id]) return { ...baseNode, ...savedPositions[n.id] };
      const angle = Math.random() * Math.PI * 2;
      const radius = 100 + Math.random() * 900;
      return {
        ...baseNode,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });

    renderer.setData(nodesWithPositions, filteredData.edges);

    const manualSettings = getManualGraphSettings(theme, vaultHash);
    const forces = getAIGraphForces(manualSettings, nodesWithPositions.length);

    worker.postMessage({
      type: "init",
      data: {
        nodes: nodesWithPositions.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          connections: n.connections || 0,
        })),
        edges: layoutEdges,
        forces,
      },
    });

    const hasLivePositions = livePositions.size > 0;
    const hasSavedPositions = !!savedPositions && Object.keys(savedPositions).length > 0;

    const hasUnplacedNodes = filteredData.nodes.some(
      (n) => (hasLivePositions ? !livePositions.has(n.id) : (!savedPositions || !savedPositions[n.id]))
    );

    if (shouldResetLayout || (!hasLivePositions && !hasSavedPositions) || hasUnplacedNodes) {
      setSimulating(true);
      worker.postMessage({ type: "start" });
    } else if (hasSavedPositions && !hasLivePositions) {
      setTimeout(() => {
        renderer.centerView();
      }, 100);
    }
  }, [
    filteredData.signature,
    filteredData.nodes,
    filteredData.edges,
    layoutEdges,
    loading,
    rendererReadyTick,
    positionsKey,
    theme,
    vaultHash,
    manualSettingsTick,
    layoutResetTick,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.isInitialized()) return;

    const manualSettings = getManualGraphSettings(theme, vaultHash);

    const selectedClusterColor = selectedNode
      ? CLUSTER_COLORS[selectedNode.clusterId % CLUSTER_COLORS.length]
      : manualSettings.connectedColor;

    renderer.setBackgroundColor(hexToNumber(manualSettings.backgroundColor));
    renderer.setNodeStyle({
      color: hexToNumber(manualSettings.nodeColor),
      size: manualSettings.nodeSize,
      selectedColor: hexToNumber(selectedClusterColor),
      hoveredColor: hexToNumber(selectedClusterColor),
      connectedColor: hexToNumber(selectedClusterColor),
    });
    renderer.setEdgeStyle({
      color: hexToNumber(manualSettings.edgeColor),
      width: manualSettings.linkWidth,
      highlightColor: hexToNumber(selectedClusterColor),
    });
    renderer.setLabelStyle({
      color: manualSettings.textColor,
      size: manualSettings.textSize,
      show: true,
      threshold: manualSettings.labelThreshold,
    });
  }, [theme, vaultHash, selectedNode, manualSettingsTick]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const manualSettings = getManualGraphSettings(theme, vaultHash);
    const forces = getAIGraphForces(manualSettings, filteredData.nodes.length);

    setSimulating(true);
    worker.postMessage({
      type: "forces",
      data: forces,
    });
    worker.postMessage({ type: "reheat" });
  }, [theme, vaultHash, manualSettingsTick, filteredData.nodes.length]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.isInitialized()) return;
    renderer.selectNode(selectedNodeId);
  }, [selectedNodeId]);

  const centerView = useCallback(() => {
    rendererRef.current?.centerView();
  }, []);

  const recalculateLayout = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    setSimulating(true);
    worker.postMessage({ type: "reheat" });
  }, []);

  const resetSettings = useCallback(() => {
    const defaults = getDefaultSettings(theme);

    try {
      localStorage.removeItem(settingsKey);
      localStorage.removeItem(positionsKey);
    } catch {
      // Ignore localStorage failures.
    }

    setSettings(defaults);
    setSemanticConfig({
      threshold: defaults.threshold,
      clusterThreshold: defaults.clusterThreshold,
      maxEdgesPerNode: defaults.maxEdgesPerNode,
      maxNodes: defaults.maxNodes,
    });
    setSelectedNodeId(null);
    setInsightFocusNodeIds(null);
    setActiveInsight(null);
    setLayoutResetTick((v) => v + 1);
    setSimulating(true);
    alphaRef.current = 1;
    setDisplayAlpha(1);
  }, [isDark, positionsKey, settingsKey]);

  const clearInsightFocus = useCallback(() => {
    setInsightFocusNodeIds(null);
    setActiveInsight(null);
  }, []);

  const handleBridgeActivate = useCallback(
    (bridge: BridgeNoteInsight) => {
      if (!graphData) return;
      const bridgeNode = graphData.nodes.find((node) => node.path === bridge.path);
      if (!bridgeNode) return;

      const focusClusters = new Set<number>([
        bridgeNode.clusterId,
        ...bridge.clusterIds.slice(0, 2),
      ]);

      const focusedNodes = graphData.nodes
        .filter(
          (node) =>
            focusClusters.has(node.clusterId) ||
            node.path === bridge.path ||
            bridge.relatedPaths.includes(node.path),
        )
        .map((node) => node.id);

      setSelectedNodeId(bridge.path);
      setInsightFocusNodeIds(new Set(focusedNodes));

      const firstClusterLabel =
        clusterLabelById.get(bridge.clusterIds[0] ?? bridgeNode.clusterId) ||
        `Cluster ${(bridge.clusterIds[0] ?? bridgeNode.clusterId) + 1}`;
      const secondClusterLabel =
        clusterLabelById.get(bridge.clusterIds[1] ?? bridgeNode.clusterId) ||
        `Cluster ${(bridge.clusterIds[1] ?? bridgeNode.clusterId) + 1}`;

      setActiveInsight({
        title: `${bridge.name} bridges ${firstClusterLabel} <-> ${secondClusterLabel}`,
        detail: "Focused on cross-cluster bridge pathways.",
        relatedPaths: [bridge.path, ...bridge.relatedPaths].slice(0, 6),
      });
      setSettings((current) => ({ ...current, showHiddenOnly: false }));
    },
    [clusterLabelById, graphData],
  );

  const handleIslandExplore = useCallback(
    (island: IdeaIslandInsight) => {
      if (!graphData) return;
      const focusedNodes = graphData.nodes
        .filter((node) => node.clusterId === island.clusterId)
        .map((node) => node.id);

      setInsightFocusNodeIds(new Set(focusedNodes));
      setSelectedNodeId(island.memberPaths[0] || null);
      setActiveInsight({
        title: `${clusterLabelById.get(island.clusterId) || `Cluster ${island.clusterId + 1}`} is isolated`,
        detail: "Exploring related concepts within this island.",
        relatedPaths: island.memberPaths.slice(0, 6),
      });
      setSettings((current) => ({ ...current, showHiddenOnly: false }));
    },
    [clusterLabelById, graphData],
  );

  const handleIslandMissingLinks = useCallback(
    (island: IdeaIslandInsight) => {
      if (!graphData) return;
      const focusedNodes = graphData.nodes
        .filter((node) => node.clusterId === island.clusterId)
        .map((node) => node.id);

      setInsightFocusNodeIds(new Set(focusedNodes));
      setSelectedNodeId(island.memberPaths[0] || null);
      setActiveInsight({
        title: `${clusterLabelById.get(island.clusterId) || `Cluster ${island.clusterId + 1}`} missing links`,
        detail: "Showing hidden semantic links inside this idea island.",
        relatedPaths: island.memberPaths.slice(0, 6),
      });
      setSettings((current) => ({ ...current, showHiddenOnly: true }));
    },
    [clusterLabelById, graphData],
  );

  // ── Actionable UX fallbacks (Offline Mode) ──────────
  const fallbackSummary = (nodes: string[]) => {
    return `# Conceptual Summary

This workspace aggregates key notes, including: ${nodes.map(noteNameFromPath).join(", ")}. These notes form a clustered network representing a central theme in your knowledge base.

## Key Connections
- Direct semantic connections are formed between these ideas to capture focus, workflow, and system dynamics.

*Offline fallback mode. Configure an API key in Settings to generate a deep, synthesis-driven, context-aware AI summary across these topics.*`;
  };

  const fallbackArticle = (nodes: string[]) => {
    return `# Synthesized Exploration: ${nodes.map(noteNameFromPath).slice(0, 2).join(" and ")}

## Introduction
The relationship between these concepts represents a fundamental pillar in this knowledge cluster.

## Conceptual Deep-Dive
1. **${noteNameFromPath(nodes[0] || "")}**: Acts as a foundation or critical node.
2. **${noteNameFromPath(nodes[1] || "")}**: Extends the theme, adding direct workflow value.

## Key Takeaways
- Interconnecting these concepts leads to refined thinking models and cohesive execution systems.

*Offline fallback mode. Set an API key in Settings to synthesize a comprehensive, professionally written deep-dive article across these notes.*`;
  };

  const fallbackStudyGuide = (nodes: string[]) => {
    return `# Study Guide: Knowledge Cluster

## Core Vocabulary & Concepts
${nodes.map(n => `- **${noteNameFromPath(n)}**: A key concept within the semantic network.`).join("\n")}

## Critical Thinking Questions
1. How does the relationship between these notes influence the overall structure of your thinking system?
2. In what ways can these concepts be integrated into daily focus sessions or systems?

*Offline fallback mode. Set an API key in Settings to generate a complete, custom study guide with learning objectives and detailed answers.*`;
  };

  const fallbackChecklist = (nodes: string[]) => {
    return `# Actionable Checklist: System Implementation

- [ ] Review the core principles of **${noteNameFromPath(nodes[0] || "first concept")}**.
- [ ] Identify direct links and intersections with **${noteNameFromPath(nodes[1] || "second concept")}**.
- [ ] Create manual backlinks in notes to formalize these relationships.
- [ ] Evolve the cluster by writing an overview or synthesis note.

*Offline fallback mode. Configure an API key in Settings to generate a custom, highly specific, actionable step-by-step checklist based on your note contents.*`;
  };

  // ── Actionable AI Thinking Engine Handlers ───────────
  const handleQueryAIExplanation = async (systemPrompt: string, userPrompt: string, fallbackText: string) => {
    setAiExplainLoading(true);
    setAiExplainText(null);
    try {
      if (isAIConfigured()) {
        const result = await askAI(systemPrompt, userPrompt, 500, 0.25);
        setAiExplainText(result);
      } else {
        setAiExplainText(fallbackText);
      }
    } catch (err: any) {
      console.error("[AI Graph] Explanation query failed:", err);
      setAiExplainText(`Query failed: ${err.message || err}. Falling back to local profile:\n\n${fallbackText}`);
    } finally {
      setAiExplainLoading(false);
    }
  };

  const handleExplainNode = (node: AIGraphNode) => {
    const neighbors = adjacencyByNode.get(node.id) || [];
    const neighborNames = neighbors.slice(0, 8).map(item => noteNameFromPath(item.id)).join(", ");
    const fallback = `Node: ${node.name}\nThis note is an active conceptual pillar in your graph with ${node.connections} semantic connections. It exhibits strong similarity relationships with concepts like: ${neighborNames}. It forms a solid bridge of knowledge in Cluster ${node.clusterId + 1}.`;
    
    const systemPrompt = `You are a subtle knowledge assistant analyzing a semantic note graph.
Explain the importance of this specific note within the user's note-taking system.
Analyze its placement, its connection count (${node.connections}), and its relation to neighbors: ${neighborNames}.
Keep your response concise (3-4 sentences), highly conceptual, professional, and do NOT use any emojis.`;
    
    const userPrompt = `Note Title: ${node.name}
Path: ${node.path}
Cluster: Cluster ${node.clusterId + 1}
Connections: ${node.connections} direct semantic neighbors.`;

    void handleQueryAIExplanation(systemPrompt, userPrompt, fallback);
  };

  const handleExplainEdge = (edge: AIGraphEdge) => {
    const fallback = `Semantic Connection: ${noteNameFromPath(edge.source)} ↔ ${noteNameFromPath(edge.target)}\nThese notes exhibit a strong cosine similarity score of ${Math.round(edge.similarity * 100)}%. Their connection suggests strong semantic overlap.`;

    const systemPrompt = `You are a subtle knowledge assistant analyzing a connection between two notes in a knowledge graph.
Explain why these two notes are conceptually connected, sharing a cosine similarity of ${Math.round(edge.similarity * 100)}%.
Focus on conceptual alignment, shared relevance, and why a user interested in one would discover value in the other.
Keep your response concise (3-4 sentences), highly conceptual, professional, and do NOT use any emojis.`;

    const userPrompt = `Note A: ${noteNameFromPath(edge.source)}
Note B: ${noteNameFromPath(edge.target)}
Similarity: ${Math.round(edge.similarity * 100)}%
Link Type: ${edge.hiddenConnection ? "Hidden semantic connection" : "Manual link connection"}`;

    void handleQueryAIExplanation(systemPrompt, userPrompt, fallback);
  };

  const handleExplainCluster = (clusterId: number) => {
    const clusterNotes = (graphData?.nodes || []).filter(n => n.clusterId === clusterId);
    const leadNode = [...clusterNotes].sort((a, b) => b.connections - a.connections)[0];
    const memberNames = clusterNotes.slice(0, 10).map(n => n.name).join(", ");
    
    const fallback = `Cluster ${clusterId + 1} (${clusterNotes.length} notes)\nThis conceptual cluster aggregates notes that exhibit close semantic proximity. Led by the highly central concept of "${leadNode ? leadNode.name : "Unknown"}", the cluster focuses on shared contexts. Key members include: ${memberNames}.`;

    const systemPrompt = `You are a subtle knowledge assistant synthesizing a semantic cluster of notes in a knowledge graph.
Review the list of notes belonging to this cluster: ${memberNames}.
Analyze the overarching theme that ties these ideas together.
Explain the shared subject matter, central concepts, and how it forms a cohesive topic area.
Keep your response concise (3-4 sentences), professional, synthesis-focused, and do NOT use any emojis.`;

    const userPrompt = `Cluster ID: Cluster ${clusterId + 1}
Size: ${clusterNotes.length} notes
Primary Note: ${leadNode ? leadNode.name : "None"}
Member Notes: ${memberNames}`;

    void handleQueryAIExplanation(systemPrompt, userPrompt, fallback);
  };

  const handleCreateManualLink = async (pathA: string, pathB: string) => {
    try {
      let content = await api.readFile(pathA);
      const nameB = noteNameFromPath(pathB);
      const linkText = `\n\n## Related Connections\n- [[${nameB}]]`;
      
      if (content.includes("## Related Connections")) {
        content = content.replace("## Related Connections", `## Related Connections\n- [[${nameB}]]`);
      } else {
        content = content.trimEnd() + linkText;
      }
      
      await api.writeFile(pathA, content);
      
      window.dispatchEvent(new CustomEvent("toast:show", {
        detail: { message: `Linked ${noteNameFromPath(pathA)} ↔ ${nameB}`, type: "success" }
      }));
      
      setReloadTick(v => v + 1);
      setSelectedEdge(null);
    } catch (err: any) {
      console.error("[AI Graph] Link creation failed:", err);
      alert("Failed to create link: " + err.message);
    }
  };

  const handleMergeNotesPreview = async (pathA: string, pathB: string) => {
    setWritingLoading(true);
    setWritingOption(null);
    setWritingEngineOpen(true);
    setWritingGeneratedText(null);
    try {
      const contentA = await api.readFile(pathA);
      const contentB = await api.readFile(pathB);
      const nameA = noteNameFromPath(pathA);
      const nameB = noteNameFromPath(pathB);

      const mergedTitle = `${nameA} and ${nameB}`;
      const systemPrompt = `You are a synthesis engine merging two related notes into a single cohesive document.
Create a combined, structured markdown note that merges the key ideas from both notes.
Ensure clear headings, clean transition paragraphs, and logical sections.
Integrate their structures seamlessly. Do NOT lose vital context.
Do NOT use any emojis, and keep the output in valid, readable markdown.`;

      const userPrompt = `Note A Title: ${nameA}\nNote A Content:\n${contentA.substring(0, 2000)}\n\nNote B Title: ${nameB}\nNote B Content:\n${contentB.substring(0, 2000)}`;

      if (isAIConfigured()) {
        const merged = await askAI(systemPrompt, userPrompt, 1200, 0.3);
        setWritingGeneratedText(`# Merged: ${mergedTitle}\n\n${merged}`);
      } else {
        const localMerged = `# Merged: ${mergedTitle}\n\n## Section 1: ${nameA}\n${contentA}\n\n## Section 2: ${nameB}\n${contentB}\n\n*Merged locally. Set API key in Settings for AI synthesis.*`;
        setWritingGeneratedText(localMerged);
      }
    } catch (err: any) {
      console.error("[AI Graph] Merge preview failed:", err);
      setWritingGeneratedText(`Failed to generate merge preview: ${err.message || err}`);
    } finally {
      setWritingLoading(false);
    }
  };

  const handleWritingGeneration = async (option: "summary" | "article" | "study_guide" | "checklist", nodePaths: string[]) => {
    setWritingLoading(true);
    setWritingOption(option);
    setWritingEngineOpen(true);
    setWritingGeneratedText(null);
    try {
      const notes = await Promise.all(nodePaths.map(async (p) => {
        try {
          const content = await api.readFile(p);
          return { title: noteNameFromPath(p), content };
        } catch {
          return { title: noteNameFromPath(p), content: "" };
        }
      }));

      const activeNotes = notes.filter(n => n.content.length > 0);
      if (activeNotes.length === 0) {
        setWritingGeneratedText("No note contents available for generation.");
        return;
      }

      const notesBlock = activeNotes.map(n => `--- ${n.title} ---\n${n.content.substring(0, 1200)}`).join("\n\n");

      let systemPrompt = "";
      let userPrompt = `Source Note Contents:\n${notesBlock}`;
      let fallback = "";

      if (option === "summary") {
        systemPrompt = `Generate a structured, 2-paragraph high-level summary synthesizing the key connections across these notes. No emojis.`;
        fallback = fallbackSummary(nodePaths);
      } else if (option === "article") {
        systemPrompt = `Synthesize a professionally written, deep-dive article or blog post exploring the relationships and shared themes of these notes. Include headings, analysis, and logical transitions. No emojis.`;
        fallback = fallbackArticle(nodePaths);
      } else if (option === "study_guide") {
        systemPrompt = `Generate a structured study guide with learning objectives, concept definitions, and 3 review/reflection questions based on these notes. No emojis.`;
        fallback = fallbackStudyGuide(nodePaths);
      } else if (option === "checklist") {
        systemPrompt = `Generate an actionable, practical, step-by-step checklist with checkboxes (- [ ]) mapping the concepts in these notes into real-world tasks. No emojis.`;
        fallback = fallbackChecklist(nodePaths);
      }

      if (isAIConfigured()) {
        const text = await askAI(systemPrompt, userPrompt, 1000, 0.35);
        setWritingGeneratedText(text);
      } else {
        setWritingGeneratedText(fallback);
      }
    } catch (err: any) {
      console.error("[AI Graph] Writing generation failed:", err);
      setWritingGeneratedText(`Failed to generate content: ${err.message || err}`);
    } finally {
      setWritingLoading(false);
    }
  };

  const handleSaveGeneratedNote = async (title: string, content: string) => {
    if (!vaultPath) return;
    try {
      const sanitizedTitle = title.replace(/[^a-zA-Z0-9\s-_]/g, "").trim() || "Generated Note";
      const filePath = `${sanitizedTitle}.md`;
      await api.createFile(filePath, content);
      
      window.dispatchEvent(new CustomEvent("toast:show", {
        detail: { message: `Created note: ${sanitizedTitle}`, type: "success" }
      }));

      setWritingEngineOpen(false);
      setReloadTick(v => v + 1);
      onNodeClick(sanitizedTitle, undefined, filePath);
    } catch (err: any) {
      console.error("[AI Graph] Save generated failed:", err);
      alert("Failed to save note: " + err.message);
    }
  };

  // ── BFS Shortest Path Routing ────────────────────────
  const handleFindPath = useCallback((startId: string, endId: string) => {
    if (startId === endId) {
      setComputedPath([startId]);
      setPathNavigationIndex(0);
      return;
    }
    
    const queue: string[][] = [[startId]];
    const visited = new Set<string>([startId]);
    
    const activeAdj = new Map<string, string[]>();
    for (const node of filteredData.nodes) {
      activeAdj.set(node.id, []);
    }
    for (const edge of filteredData.edges) {
      if (activeAdj.has(edge.source) && activeAdj.has(edge.target)) {
        activeAdj.get(edge.source)!.push(edge.target);
        activeAdj.get(edge.target)!.push(edge.source);
      }
    }

    let foundPath: string[] | null = null;
    while (queue.length > 0) {
      const path = queue.shift()!;
      const node = path[path.length - 1];
      
      const neighbors = activeAdj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          const newPath = [...path, neighbor];
          if (neighbor === endId) {
            foundPath = newPath;
            break;
          }
          queue.push(newPath);
        }
      }
      if (foundPath) break;
    }

    if (foundPath) {
      setComputedPath(foundPath);
      setPathNavigationIndex(0);
      setSelectedNodeId(foundPath[0]);
      rendererRef.current?.selectNode(foundPath[0]);
      rendererRef.current?.centerNode(foundPath[0]);
    } else {
      window.dispatchEvent(new CustomEvent("toast:show", {
        detail: { message: "No semantic connection path found between notes", type: "info" }
      }));
    }
  }, [filteredData]);

  const handleNavigatePathStep = (index: number) => {
    if (!computedPath) return;
    setPathNavigationIndex(index);
    const nodeId = computedPath[index];
    setSelectedNodeId(nodeId);
    rendererRef.current?.selectNode(nodeId);
    rendererRef.current?.centerNode(nodeId);
  };

  const handleClearPathfinding = () => {
    setComputedPath(null);
    setPathfindingStart(null);
    setPathfindingEnd(null);
    setPathNavigationIndex(0);
    if (rendererRef.current) {
      rendererRef.current.highlightedPathNodeIds = null;
      rendererRef.current.highlightedPathEdges = null;
      rendererRef.current.render();
    }
  };

  // ── Cluster overview note generation ─────────────────
  const handleGenerateClusterOverviewNote = async (clusterId: number) => {
    if (!vaultPath) return;
    const clusterNotes = (graphData?.nodes || []).filter(n => n.clusterId === clusterId);
    if (clusterNotes.length === 0) return;

    const leadNode = [...clusterNotes].sort((a, b) => b.connections - a.connections)[0];
    const name = `Overview - Cluster ${clusterId + 1}`;
    
    let content = `# Overview: Cluster ${clusterId + 1}\n\n`;
    content += `This conceptual cluster consists of ${clusterNotes.length} notes, centered around the highly central note **[[${leadNode ? leadNode.name : "Unknown"}]]**.\n\n`;
    content += `## Cluster Member Thoughts\n`;
    clusterNotes.forEach(node => {
      content += `- [[${node.name}]]\n`;
    });

    if (isAIConfigured()) {
      try {
        const systemPrompt = `You are a synthesis engine summarizing a cluster of concepts.
Create a comprehensive 2-paragraph introduction for this index overview note based on these conceptual elements: ${clusterNotes.map(n => n.name).join(", ")}.
Summarize the theme and key intersections. No emojis.`;
        const summary = await askAI(systemPrompt, `Cluster Size: ${clusterNotes.length} notes. Primary Concept: ${leadNode ? leadNode.name : "None"}.`, 500, 0.3);
        content = `# Overview: Cluster ${clusterId + 1}\n\n${summary}\n\n## Cluster Member Thoughts\n` + clusterNotes.map(node => `- [[${node.name}]]`).join("\n") + "\n";
      } catch {}
    }

    try {
      const filePath = `${name}.md`;
      await api.createFile(filePath, content);
      window.dispatchEvent(new CustomEvent("toast:show", {
        detail: { message: `Created Overview note for Cluster ${clusterId + 1}`, type: "success" }
      }));
      setReloadTick(v => v + 1);
      onNodeClick(name, undefined, filePath);
    } catch (err: any) {
      alert("Failed to create overview note: " + err.message);
    }
  };

  const handleOpenSelected = useCallback(() => {
    if (!selectedNode) return;
    onNodeClick(selectedNode.name, undefined, selectedNode.path);
  }, [onNodeClick, selectedNode]);

  const directionalFocusSummary = useMemo(() => {
    if (!selectedNodeId || !settings.showDirectionalFlow) return null;
    const outgoing = (graphData?.directionalFlows || [])
      .filter((flow) => flow.source === selectedNodeId)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const incoming = (graphData?.directionalFlows || [])
      .filter((flow) => flow.target === selectedNodeId)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { outgoing, incoming };
  }, [graphData, selectedNodeId, settings.showDirectionalFlow]);

  const visibleNodeCount = filteredData.nodes.length;

  if (loading && !graphData) {
    return (
      <div className="graph-view-container">
        <div className="graph-loading">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-medium)] border-t-[var(--accent-primary)]" />
          <span>Building semantic graph...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`graph-view-container ${isFullScreen ? "fullscreen" : ""}`}>
      <div className="graph-main">
        <div ref={containerRef} className="graph-canvas-container ai-graph-canvas-container">
          <canvas ref={canvasRef} />

          {!loading && !!error && (
            <div className="graph-empty">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && graphData && graphData.nodes.length === 0 && (
            <div className="graph-empty">
              <span>No embeddings found yet. Open and save a few notes to build the AI graph.</span>
            </div>
          )}

          <div className="graph-node-counter">
            {visibleNodeCount} nodes • {graphData?.hiddenConnectionCount || 0} hidden links • {graphData?.directionalFlows.length || 0} directional flows
          </div>

          {computedPath && (
            <div className="ai-graph-path-bar" style={{
              position: "absolute",
              top: "12px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 100,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-medium)",
              borderRadius: "8px",
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              boxShadow: "none"
            }}>
              <span style={{ fontSize: "12.5px", color: "var(--text-secondary)" }}>
                Pathfinding: <strong>{noteNameFromPath(computedPath[0])}</strong> &rarr; <strong>{noteNameFromPath(computedPath[computedPath.length - 1])}</strong> ({computedPath.length} steps)
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  className="graph-btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "11.5px" }}
                  disabled={pathNavigationIndex === 0}
                  onClick={() => handleNavigatePathStep(pathNavigationIndex - 1)}
                >
                  Prev
                </button>
                <span style={{ fontSize: "11.5px", color: "var(--text-primary)" }}>
                  {pathNavigationIndex + 1} / {computedPath.length}
                </span>
                <button
                  type="button"
                  className="graph-btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "11.5px" }}
                  disabled={pathNavigationIndex === computedPath.length - 1}
                  onClick={() => handleNavigatePathStep(pathNavigationIndex + 1)}
                >
                  Next
                </button>
                {onOpenPathsAsGroup && onCreateGroupFromPaths && (
                  <>
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      style={{ padding: "3px 8px", fontSize: "11.5px" }}
                      onClick={() => onOpenPathsAsGroup(computedPath)}
                    >
                      Open Path as Group
                    </button>
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      style={{ padding: "3px 8px", fontSize: "11.5px" }}
                      onClick={() => {
                        const name = `Path: ${noteNameFromPath(computedPath[0])} to ${noteNameFromPath(computedPath[computedPath.length - 1])}`;
                        onCreateGroupFromPaths(name, "#E8A84A", computedPath);
                      }}
                    >
                      Save Path as Group
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="graph-btn-secondary"
                  style={{ padding: "3px 8px", fontSize: "11.5px", color: "#f87171" }}
                  onClick={handleClearPathfinding}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {(!!selectedNode || !!selectedEdge || selectedClusterId !== null || !!activeInsight) && (
            <div style={{ display: "contents" }}>
              {selectedNode && (
                <div className="ai-graph-focus-card" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="graph-btn"
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      padding: "4px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onClick={() => {
                      setSelectedNodeId(null);
                      setSelectedEdge(null);
                      setSelectedClusterId(null);
                      setAiExplainText(null);
                      rendererRef.current?.selectNode(null);
                    }}
                    title="Deselect node (back to full graph)"
                  >
                    <X size={14} />
                  </button>
                  <div className="ai-graph-focus-title">{selectedNode.name}</div>
                  <div className="ai-graph-focus-meta">
                    {adjacencyByNode.get(selectedNode.id)?.length || 0} semantic connections &bull; Cluster {selectedNode.clusterId + 1}
                  </div>
                  
                  {/* Pathfinder starts selection */}
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      style={{ flex: 1, padding: "4px", fontSize: "10.5px" }}
                      onClick={() => {
                        setPathfindingStart(selectedNode.id);
                        if (pathfindingEnd) handleFindPath(selectedNode.id, pathfindingEnd);
                      }}
                    >
                      Start Path {pathfindingStart === selectedNode.id ? "✓" : ""}
                    </button>
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      style={{ flex: 1, padding: "4px", fontSize: "10.5px" }}
                      onClick={() => {
                        setPathfindingEnd(selectedNode.id);
                        if (pathfindingStart) handleFindPath(pathfindingStart, selectedNode.id);
                      }}
                    >
                      End Path {pathfindingEnd === selectedNode.id ? "✓" : ""}
                    </button>
                  </div>

                  {/* AI Explain Area */}
                  {aiExplainLoading ? (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 0" }}>
                      Analyzing semantic context...
                    </div>
                  ) : aiExplainText ? (
                    <div style={{
                      fontSize: "11.5px",
                      color: "var(--text-primary)",
                      background: "var(--bg-active)",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      marginTop: "4px",
                      maxHeight: "100px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap"
                    }}>
                      {aiExplainText}
                    </div>
                  ) : null}

                  <div className="ai-graph-insights-list" style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button type="button" className="graph-btn-primary" style={{ flex: 1, padding: "5px 8px" }} onClick={handleOpenSelected}>
                        Open Note
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "5px 8px" }}
                        onClick={() => handleExplainNode(selectedNode)}
                      >
                        Explain Node
                      </button>
                    </div>
                    
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => {
                          const neighbors = adjacencyByNode.get(selectedNode.id) || [];
                          setInsightFocusNodeIds(new Set([selectedNode.id, ...neighbors.map(n => n.id)]));
                        }}
                      >
                        Find Related
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => {
                          const clusterNotes = (graphData?.nodes || []).filter(n => n.clusterId === selectedNode.clusterId);
                          setInsightFocusNodeIds(new Set(clusterNotes.map(n => n.id)));
                          setSelectedClusterId(selectedNode.clusterId);
                          setSelectedNodeId(null);
                          setSelectedEdge(null);
                        }}
                      >
                        Expand Cluster
                      </button>
                    </div>

                    {onOpenPathsAsGroup && onCreateGroupFromPaths && (
                      <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                        <button
                          type="button"
                          className="graph-btn-secondary"
                          style={{ flex: 1, padding: "5px 8px" }}
                          onClick={() => {
                            const clusterPaths = (graphData?.nodes || []).filter(n => n.clusterId === selectedNode.clusterId).map(n => n.path);
                            onOpenPathsAsGroup(clusterPaths);
                          }}
                        >
                          Open Cluster as Group
                        </button>
                        <button
                          type="button"
                          className="graph-btn-secondary"
                          style={{ flex: 1, padding: "5px 8px" }}
                          onClick={() => {
                            const clusterPaths = (graphData?.nodes || []).filter(n => n.clusterId === selectedNode.clusterId).map(n => n.path);
                            const name = clusterLabelById.get(selectedNode.clusterId) || `Cluster ${selectedNode.clusterId + 1}`;
                            onCreateGroupFromPaths(name, CLUSTER_COLORS[selectedNode.clusterId % CLUSTER_COLORS.length], clusterPaths);
                          }}
                        >
                          Save Cluster as Group
                        </button>
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--border-medium)", marginTop: "4px", paddingTop: "4px" }} />
                    <span style={{ fontSize: "10.5px", color: "var(--text-muted)", fontWeight: 500 }}>Generate Content:</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleWritingGeneration("summary", [selectedNode.id])}
                      >
                        Summary
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleWritingGeneration("article", [selectedNode.id])}
                      >
                        Article
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleWritingGeneration("study_guide", [selectedNode.id])}
                      >
                        Study Guide
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleWritingGeneration("checklist", [selectedNode.id])}
                      >
                        Checklist
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedEdge && (
                <div className="ai-graph-focus-card" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="graph-btn"
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      padding: "4px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onClick={() => {
                      setSelectedNodeId(null);
                      setSelectedEdge(null);
                      setSelectedClusterId(null);
                      setAiExplainText(null);
                    }}
                    title="Deselect edge"
                  >
                    <X size={14} />
                  </button>
                  <div className="ai-graph-focus-title">
                    {noteNameFromPath(selectedEdge.source)} &harr; {noteNameFromPath(selectedEdge.target)}
                  </div>
                  <div className="ai-graph-focus-meta">
                    Similarity Strength: <strong>{Math.round(selectedEdge.similarity * 100)}%</strong> &bull; {selectedEdge.hiddenConnection ? "Hidden Link" : "Manual Link"}
                  </div>

                  {/* AI Explain Area */}
                  {aiExplainLoading ? (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 0" }}>
                      Analyzing semantic overlap...
                    </div>
                  ) : aiExplainText ? (
                    <div style={{
                      fontSize: "11.5px",
                      color: "var(--text-primary)",
                      background: "var(--bg-active)",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      marginTop: "4px",
                      maxHeight: "100px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap"
                    }}>
                      {aiExplainText}
                    </div>
                  ) : null}

                  <div className="ai-graph-insights-list" style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="graph-btn-primary"
                        style={{ flex: 1, padding: "5px 8px" }}
                        onClick={() => handleExplainEdge(selectedEdge)}
                      >
                        Explain Edge
                      </button>
                      {selectedEdge.hiddenConnection && (
                        <button
                          type="button"
                          className="graph-btn-secondary"
                          style={{ flex: 1, padding: "5px 8px", color: "var(--oo-accent, #E8A84A)" }}
                          onClick={() => handleCreateManualLink(selectedEdge.source, selectedEdge.target)}
                        >
                          Create Link
                        </button>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleMergeNotesPreview(selectedEdge.source, selectedEdge.target)}
                      >
                        Merge Notes
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "3px 6px", fontSize: "10.5px" }}
                        onClick={() => handleWritingGeneration("summary", [selectedEdge.source, selectedEdge.target])}
                      >
                        Summary
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "3px 6px", fontSize: "10.5px", color: "#f87171" }}
                        onClick={() => {
                          setDismissedSuggestions((prev) => {
                            const next = new Set(prev);
                            next.add(pairKey(selectedEdge.source, selectedEdge.target));
                            return next;
                          });
                          setSelectedEdge(null);
                        }}
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedClusterId !== null && !selectedNode && !selectedEdge && (
                <div className="ai-graph-focus-card" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="graph-btn"
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      padding: "4px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onClick={() => {
                      setSelectedNodeId(null);
                      setSelectedEdge(null);
                      setSelectedClusterId(null);
                      setAiExplainText(null);
                    }}
                    title="Deselect cluster"
                  >
                    <X size={14} />
                  </button>
                  <div className="ai-graph-focus-title">
                    {clusterLabelById.get(selectedClusterId) || `Cluster ${selectedClusterId + 1}`}
                  </div>
                  <div className="ai-graph-focus-meta">
                    Contains {(graphData?.nodes || []).filter(n => n.clusterId === selectedClusterId).length} semantic note thoughts
                  </div>

                  {/* AI Explain Area */}
                  {aiExplainLoading ? (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 0" }}>
                      Synthesizing cluster themes...
                    </div>
                  ) : aiExplainText ? (
                    <div style={{
                      fontSize: "11.5px",
                      color: "var(--text-primary)",
                      background: "var(--bg-active)",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      marginTop: "4px",
                      maxHeight: "100px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap"
                    }}>
                      {aiExplainText}
                    </div>
                  ) : null}

                  <div className="ai-graph-insights-list" style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="graph-btn-primary"
                        style={{ flex: 1, padding: "5px 8px" }}
                        onClick={() => handleExplainCluster(selectedClusterId)}
                      >
                        Explain Cluster
                      </button>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ flex: 1, padding: "5px 8px" }}
                        onClick={() => handleGenerateClusterOverviewNote(selectedClusterId)}
                      >
                        Overview Note
                      </button>
                    </div>

                    {onOpenPathsAsGroup && onCreateGroupFromPaths && (
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          type="button"
                          className="graph-btn-secondary"
                          style={{ flex: 1, padding: "5px 8px" }}
                          onClick={() => {
                            const clusterPaths = (graphData?.nodes || []).filter(n => n.clusterId === selectedClusterId).map(n => n.path);
                            onOpenPathsAsGroup(clusterPaths);
                          }}
                        >
                          Open as Group
                        </button>
                        <button
                          type="button"
                          className="graph-btn-secondary"
                          style={{ flex: 1, padding: "5px 8px" }}
                          onClick={() => {
                            const clusterPaths = (graphData?.nodes || []).filter(n => n.clusterId === selectedClusterId).map(n => n.path);
                            const name = clusterLabelById.get(selectedClusterId) || `Cluster ${selectedClusterId + 1}`;
                            onCreateGroupFromPaths(name, CLUSTER_COLORS[selectedClusterId % CLUSTER_COLORS.length], clusterPaths);
                          }}
                        >
                          Save as Group
                        </button>
                      </div>
                    )}
                    
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                      onClick={() => {
                        setSelectedClusterId(null);
                        setInsightFocusNodeIds(null);
                      }}
                    >
                      Clear Focus
                    </button>
                  </div>
                </div>
              )}

              {activeInsight && !selectedNode && !selectedEdge && selectedClusterId === null && (
                <div className="ai-graph-focus-card" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="graph-btn"
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      padding: "4px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    onClick={() => {
                      setSelectedNodeId(null);
                      setSelectedEdge(null);
                      setSelectedClusterId(null);
                      setActiveInsight(null);
                      setAiExplainText(null);
                    }}
                    title="Deselect insight"
                  >
                    <X size={14} />
                  </button>
                  <div className="ai-graph-focus-title">{activeInsight.title}</div>
                  <div className="ai-graph-focus-meta">{activeInsight.detail}</div>
                  <div className="ai-graph-insights-list" style={{ gap: 4 }}>
                    {activeInsight.relatedPaths.slice(0, 4).map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="graph-btn-secondary"
                        style={{ textAlign: "left", padding: "4px 8px" }}
                        onClick={() => onNodeClick(noteNameFromPath(path), undefined, path)}
                      >
                        {noteNameFromPath(path)}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                    {onOpenPathsAsGroup && (
                      <button
                        type="button"
                        className="graph-btn-primary"
                        style={{ flex: 1, padding: "4px 8px" }}
                        onClick={() => onOpenPathsAsGroup(activeInsight.relatedPaths)}
                      >
                        Open as Group
                      </button>
                    )}
                    <button type="button" className="graph-btn-secondary" style={{ flex: 1, padding: "4px 8px" }} onClick={clearInsightFocus}>
                      Clear Insight Focus
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {showSettingsPanel && (
          <div className="graph-settings-panel ai-graph-settings-panel">
            <Section title="Filters">
              {/* Semantic View vs Timeline View toggle */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "12px", borderBottom: "1px solid var(--border-medium)", paddingBottom: "10px" }}>
                <button
                  type="button"
                  className={`graph-btn-secondary ${viewMode === "semantic" ? "active" : ""}`}
                  style={{ flex: 1, padding: "5px", fontSize: "11.5px", background: viewMode === "semantic" ? "var(--bg-active)" : "" }}
                  onClick={() => setViewMode("semantic")}
                >
                  Semantic View
                </button>
                <button
                  type="button"
                  className={`graph-btn-secondary ${viewMode === "timeline" ? "active" : ""}`}
                  style={{ flex: 1, padding: "5px", fontSize: "11.5px", background: viewMode === "timeline" ? "var(--bg-active)" : "" }}
                  onClick={() => setViewMode("timeline")}
                >
                  Timeline View
                </button>
              </div>

              {/* Timeline scrubber slider */}
              {viewMode === "timeline" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
                  <label style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
                    Historical Scrubber:
                  </label>
                  <input
                    type="range"
                    min={minTime}
                    max={maxTime}
                    step={3600000 /* 1 hour */}
                    value={timelineValue}
                    onChange={(e) => setTimelineValue(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--accent-primary)" }}
                  />
                  <div style={{ fontSize: "10.5px", color: "var(--text-primary)", textAlign: "right", fontWeight: 500 }}>
                    {new Date(timelineValue).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              )}

              <input
                type="text"
                className="graph-search-input"
                placeholder="Search semantic nodes..."
                value={settings.searchTerm}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    searchTerm: event.target.value,
                  }))
                }
              />
              <Toggle
                label="Hidden connections only"
                checked={settings.showHiddenOnly}
                onChange={(v) =>
                  setSettings((current) => ({
                    ...current,
                    showHiddenOnly: v,
                  }))
                }
              />
              <Toggle
                label="Focus mode on selection"
                checked={settings.focusMode}
                onChange={(v) =>
                  setSettings((current) => ({
                    ...current,
                    focusMode: v,
                  }))
                }
              />
              <Toggle
                label="Show directional flow"
                checked={settings.showDirectionalFlow}
                onChange={(v) =>
                  setSettings((current) => ({
                    ...current,
                    showDirectionalFlow: v,
                  }))
                }
              />
            </Section>

            <Section title="Semantic" defaultOpen={false}>
              <Slider
                label="Similarity"
                value={Math.round(settings.threshold * 100)}
                onChange={(v) => setSettings((current) => ({ ...current, threshold: v / 100 }))}
                min={35}
                max={75}
              />
              <Slider
                label="Cluster"
                value={Math.round(settings.clusterThreshold * 100)}
                onChange={(v) =>
                  setSettings((current) => ({ ...current, clusterThreshold: v / 100 }))
                }
                min={45}
                max={85}
              />
              <div className="graph-settings-actions" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="graph-btn-secondary"
                  onClick={() => setSettings((current) => ({ ...current, clusterThreshold: 0.72 }))}
                >
                  Tight
                </button>
                <button
                  type="button"
                  className="graph-btn-secondary"
                  onClick={() => setSettings((current) => ({ ...current, clusterThreshold: 0.62 }))}
                >
                  Medium
                </button>
                <button
                  type="button"
                  className="graph-btn-secondary"
                  onClick={() => setSettings((current) => ({ ...current, clusterThreshold: 0.52 }))}
                >
                  Broad
                </button>
              </div>
              <Slider
                label="Edges / node"
                value={settings.maxEdgesPerNode}
                onChange={(v) => setSettings((current) => ({ ...current, maxEdgesPerNode: v }))}
                min={3}
                max={15}
              />
              <Slider
                label="Node limit"
                value={settings.maxNodes}
                onChange={(v) => setSettings((current) => ({ ...current, maxNodes: v }))}
                min={AI_GRAPH_MIN_NODES}
                max={AI_GRAPH_MAX_NODES}
                step={10}
              />
            </Section>

            <Section title="Insights" defaultOpen={false}>
              <div className="graph-section-content ai-graph-insights-list" style={{ padding: 0, borderBottom: "1px solid var(--border-medium)", paddingBottom: "10px", marginBottom: "10px" }}>
                <div className="ai-graph-insight-item">
                  <strong>{graphData?.clusterCount || 0}</strong>
                  <span>clusters</span>
                </div>
                <div className="ai-graph-insight-item">
                  <strong>{graphData?.bridgeNotes.length || 0}</strong>
                  <span>bridge notes</span>
                </div>
                <div className="ai-graph-insight-item">
                  <strong>{graphData?.ideaIslands.length || 0}</strong>
                  <span>idea islands</span>
                </div>
                <div className="ai-graph-insight-item">
                  <strong>{suggestedLinks.length || 0}</strong>
                  <span>suggested links</span>
                </div>
              </div>

              {/* Key Concepts List */}
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Key Concepts (Highest Centrality):</span>
                <div className="ai-graph-insights-list" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                  {keyConcepts.map((node) => (
                    <div key={node.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }}>
                        {node.name}
                      </span>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        style={{ padding: "2px 6px", fontSize: "10px" }}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          setSelectedEdge(null);
                          setSelectedClusterId(null);
                          setAiExplainText(null);
                          if (rendererRef.current) {
                            rendererRef.current.selectNode(node.id);
                            rendererRef.current.centerNode(node.id);
                          }
                        }}
                      >
                        Focus Concept
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggested Links List */}
              {suggestedLinks.length > 0 && (
                <div style={{ marginBottom: "12px", borderTop: "1px solid var(--border-medium)", paddingTop: "8px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Suggested Connections:</span>
                  <div className="ai-graph-insights-list" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                    {suggestedLinks.map((edge) => (
                      <div key={pairKey(edge.source, edge.target)} style={{ display: "block", background: "var(--bg-active)", padding: "6px", borderRadius: "6px" }}>
                        <div style={{ fontSize: "11px", color: "var(--text-primary)", marginBottom: "4px" }}>
                          {noteNameFromPath(edge.source)} &harr; {noteNameFromPath(edge.target)}
                        </div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            type="button"
                            className="graph-btn-secondary"
                            style={{ flex: 1, padding: "2px", fontSize: "9.5px" }}
                            onClick={() => {
                              setSelectedEdge(edge);
                              setSelectedNodeId(null);
                              setSelectedClusterId(null);
                              setAiExplainText(null);
                              // Highlight edge visually
                              if (rendererRef.current) {
                                rendererRef.current.selectedEdge = { source: edge.source, target: edge.target };
                                rendererRef.current.centerNode(edge.source);
                              }
                            }}
                          >
                            Focus Link
                          </button>
                          <button
                            type="button"
                            className="graph-btn-secondary"
                            style={{ flex: 1, padding: "2px", fontSize: "9.5px", color: "var(--oo-accent, #E8A84A)" }}
                            onClick={() => handleCreateManualLink(edge.source, edge.target)}
                          >
                            Accept Link
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bridge Notes List */}
              {(graphData?.bridgeNotes || []).length > 0 && (
                <div style={{ marginBottom: "12px", borderTop: "1px solid var(--border-medium)", paddingTop: "8px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Bridge Note Insights:</span>
                  <div className="ai-graph-insights-list" style={{ marginTop: 4 }}>
                    {(graphData?.bridgeNotes || []).map((bridge) => {
                      const firstCluster = bridge.clusterIds[0];
                      const secondCluster = bridge.clusterIds[1];
                      return (
                        <div key={bridge.path} className="ai-graph-insight-item" style={{ display: "block", marginBottom: 6 }}>
                          <div style={{ color: "var(--text-primary)", marginBottom: 4, fontSize: "10.5px" }}>
                            {bridge.name} connects {clusterLabelById.get(firstCluster) || `Cluster ${(firstCluster ?? 0) + 1}`} <span>{"<->"}</span> {clusterLabelById.get(secondCluster) || `Cluster ${(secondCluster ?? 0) + 1}`}
                          </div>
                          <button
                            type="button"
                            className="graph-btn-secondary"
                            style={{ padding: "2px 6px", fontSize: "10px" }}
                            onClick={() => handleBridgeActivate(bridge)}
                          >
                            Focus Bridge
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Idea Islands List */}
              {(graphData?.ideaIslands || []).length > 0 && (
                <div style={{ borderTop: "1px solid var(--border-medium)", paddingTop: "8px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>Idea Islands (Isolated Clusters):</span>
                  <div className="ai-graph-insights-list" style={{ marginTop: 4 }}>
                    {(graphData?.ideaIslands || []).map((island) => (
                      <div key={island.clusterId} className="ai-graph-insight-item" style={{ display: "block", marginBottom: 6 }}>
                        <div style={{ color: "var(--text-primary)", marginBottom: 4, fontSize: "10.5px" }}>
                          {clusterLabelById.get(island.clusterId) || `Cluster ${island.clusterId + 1}`}: isolated idea cluster
                        </div>
                        <div className="graph-settings-actions" style={{ margin: 0 }}>
                          <button
                            type="button"
                            className="graph-btn-secondary"
                            style={{ padding: "2px 6px", fontSize: "10px" }}
                            onClick={() => handleIslandExplore(island)}
                          >
                            Explore Concepts
                          </button>
                          <button
                            type="button"
                            className="graph-btn-secondary"
                            style={{ padding: "2px 6px", fontSize: "10px" }}
                            onClick={() => handleIslandMissingLinks(island)}
                          >
                            Find Missing Links
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <div className="graph-settings-actions">
              <button type="button" className="graph-btn-secondary" onClick={resetSettings}>
                Reset All
              </button>
              <button type="button" className="graph-btn-primary" onClick={recalculateLayout}>
                Recalculate
              </button>
            </div>
          </div>
        )}

        <div className="graph-tools-rail">
          {simulating && (
            <div className="graph-tools-sim-indicator">
              <div className="graph-sim-spinner" />
              <span>{Math.round(displayAlpha * 100)}%</span>
            </div>
          )}

          <div className="graph-tools-group">
            <button type="button" className="graph-btn" onClick={centerView} title="Center view">
              <Target size={14} />
            </button>
            <button type="button" className="graph-btn" onClick={recalculateLayout} title="Recalculate layout">
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className={`graph-btn ${showSettingsPanel ? "active" : ""}`}
              onClick={() => setShowSettingsPanel((v) => !v)}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              className="graph-btn"
              onClick={() => setReloadTick((v) => v + 1)}
              title="Rebuild semantic graph"
            >
              <Network size={14} />
            </button>
            {onToggleFullScreen && (
              <button
                type="button"
                className="graph-btn"
                onClick={onToggleFullScreen}
                title={isFullScreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullScreen ? <Minimize size={14} /> : <Maximize size={14} />}
              </button>
            )}
            <button type="button" className="graph-btn" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {writingEngineOpen && (
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-medium)",
            borderRadius: "12px",
            width: "90%",
            maxWidth: "600px",
            height: "80%",
            display: "flex",
            flexDirection: "column",
            boxShadow: "none",
            padding: "20px",
            gap: "16px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text-primary)", textTransform: "capitalize" }}>
                AI Generation: {writingOption || "Merge Notes"}
              </h3>
              <button
                type="button"
                style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
                onClick={() => setWritingEngineOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-main)", border: "1px solid var(--border-medium)", borderRadius: "8px", padding: "12px" }}>
              {writingLoading ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "8px" }}>
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-medium)] border-t-[var(--accent-primary)]" />
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Synthesizing note contents...</span>
                </div>
              ) : writingGeneratedText ? (
                <pre style={{
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                  margin: 0
                }}>
                  {writingGeneratedText}
                </pre>
              ) : (
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Empty generation response.</span>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", width: "100%" }}>
              {isNamingNote ? (
                <div style={{ 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "10px", 
                  width: "100%", 
                  background: "var(--bg-secondary)", 
                  padding: "12px", 
                  borderRadius: "6px", 
                  border: "1px solid var(--border-medium)" 
                }}>
                  <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500, textAlign: "left" }}>
                    Enter Note Title
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={noteNameInput}
                      onChange={(e) => setNoteNameInput(e.target.value)}
                      placeholder="Enter note title..."
                      autoFocus
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: "4px",
                        border: "1px solid var(--border-medium)",
                        background: "var(--bg-main)",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        outline: "none"
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && noteNameInput.trim()) {
                          e.preventDefault();
                          void handleSaveGeneratedNote(noteNameInput.trim(), writingGeneratedText!);
                        } else if (e.key === "Escape") {
                          setIsNamingNote(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="graph-btn-primary"
                      disabled={!noteNameInput.trim()}
                      onClick={() => {
                        if (noteNameInput.trim()) {
                          void handleSaveGeneratedNote(noteNameInput.trim(), writingGeneratedText!);
                        }
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="graph-btn-secondary"
                      onClick={() => setIsNamingNote(false)}
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="graph-btn-secondary"
                    onClick={() => setWritingEngineOpen(false)}
                  >
                    Cancel
                  </button>
                  {writingGeneratedText && !writingLoading && (
                    <>
                      <button
                        type="button"
                        className="graph-btn-secondary"
                        onClick={async () => {
                          await api.writeClipboardText(writingGeneratedText);
                          window.dispatchEvent(new CustomEvent("toast:show", {
                            detail: { message: "Copied to clipboard", type: "success" }
                          }));
                        }}
                      >
                        Copy Content
                      </button>
                      <button
                        type="button"
                        className="graph-btn-primary"
                        onClick={() => {
                          const fallbackTitle = writingOption 
                            ? `Generated_${writingOption.replace("_", " ")}` 
                            : "Merged_Note";
                          setNoteNameInput(fallbackTitle);
                          setIsNamingNote(true);
                        }}
                      >
                        Save as Note in Vault
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
