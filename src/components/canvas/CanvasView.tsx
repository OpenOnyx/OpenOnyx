/**
 * CanvasView — A premium infinite canvas workspace
 *
 * Architecture mirrors Obsidian's approach:
 *  • DOM nodes (not <canvas>) for cards, absolutely positioned inside a CSS-transform wrapper.
 *  • SVG overlay for edges with separate display + interaction paths.
 *  • --zoom-multiplier CSS var so controls scale inversely with zoom.
 *  • Vertical control strip on the right; card-menu above selected node.
 *  • Dot-pattern background via SVG inside the wrapper.
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Plus,
  Minus,
  Maximize,
  Grid3X3,
  ArrowUpRight,
  RotateCcw,
  RotateCw,
  Type,
  FileText,
  Globe,
  SquareDashed,
  Trash2,
  Palette,
  Copy,
  X,
  PenLine,
  Eraser,
  Lasso,
  Lock,
  Unlock,
} from "lucide-react";
import {
  CanvasNode,
  CanvasEdge,
  CanvasData,
  CanvasViewport,
  CanvasToolMode,
  EdgeSide,
  DragState,
  CanvasTextNode,
  CanvasFileNode,
  CanvasLinkNode,
  CanvasGroupNode,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_GROUP_WIDTH,
  DEFAULT_GROUP_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  GRID_SIZE,
  CANVAS_PRESET_COLORS,
  resolveCanvasColor,
} from "../../types/canvas";
import { generateId } from "../../utils/helpers";
import { getAPI } from "../../utils/api";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import {
  parseCanvasDocument,
  serializeCanvasDocument,
  type CanvasDiagnostics,
} from "./canvasDocument";

/* ─────── Constants ─────── */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const ZOOM_STEP_INTENSITY = 0.1;
const ZOOM_LERP = 0.2;
const PAN_LERP = 0.2;
const PAN_VELOCITY_BLEND = 0.22;
const PAN_VELOCITY_MAX_SAMPLE_MS = 80;
const PAN_INERTIA_DECAY = 0.9;
const PAN_INERTIA_MIN_SPEED = 0.02;
const HISTORY_LIMIT = 60;
const CULLING_PADDING = 320;
const RECOVERY_SUFFIX = ".recovery.canvas";
const MIN_MD_EMBED_PREVIEW_ZOOM = 1.05;
const FULL_MD_EMBED_PREVIEW_ZOOM = 1.4;
const MAX_SELECTED_MD_PREVIEWS = 2;
const MAX_MD_EMBED_PREVIEWS = 8;
const MIN_MD_PREVIEW_SCREEN_WIDTH = 240;
const MIN_MD_PREVIEW_SCREEN_HEIGHT = 140;
const MD_PREVIEW_RESUME_DELAY_MS = 160;
const MD_PREVIEW_REFRESH_INTERVAL_MS = 1200;
const CANVAS_SCRIBBLES_KEY = "noteworkScribblesV1";
const DEFAULT_SCRIBBLE_WIDTH = 2.4;
const MIN_SCRIBBLE_POINT_DIST = 0.8;
const MIN_LASSO_POINT_DIST = 1.2;
const ERASER_RADIUS_PX = 14;

const embeddedMarkdownCache = new Map<string, string>();

interface CanvasScribblePoint {
  x: number;
  y: number;
}

interface CanvasScribbleStroke {
  id: string;
  points: CanvasScribblePoint[];
  width: number;
  color?: string;
}

interface Props {
  onClose: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  theme: string;
  autoHideDrawingControls?: boolean;
  vaultPath: string;
  fileTree: any[];
  canvasFilePath: string | null;
  onOpenFile?: (p: string) => void;
  onNewCanvas?: () => void;
  onDuplicateCanvas?: () => void;
  onSaveCanvasAs?: () => void;
  recentCanvasFiles?: string[];
  onOpenRecentCanvas?: (p: string) => void;
}

/* ─────── History entry ─────── */
interface Snap {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  scribbles: CanvasScribbleStroke[];
}
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

type SaveState = "saved" | "unsaved" | "saving" | "error";

function rectIntersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/* ─────── Edge helpers ─────── */
function bestSides(a: CanvasNode, b: CanvasNode): [EdgeSide, EdgeSide] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy))
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function portXY(n: CanvasNode, s: EdgeSide) {
  switch (s) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    case "right":
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

function cpOffset(s: EdgeSide, dist: number) {
  switch (s) {
    case "top":
      return { dx: 0, dy: -dist };
    case "bottom":
      return { dx: 0, dy: dist };
    case "left":
      return { dx: -dist, dy: 0 };
    case "right":
      return { dx: dist, dy: 0 };
  }
}

function colorWithAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3)
      h = h
        .split("")
        .map((ch) => ch + ch)
        .join("");
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((s) => s.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
    }
  }
  return color;
}

function sanitizeCanvasScribbles(value: unknown): CanvasScribbleStroke[] {
  if (!Array.isArray(value)) return [];
  const out: CanvasScribbleStroke[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.points)) return;

    const points = record.points
      .map((p) => {
        if (!p || typeof p !== "object") return null;
        const pt = p as Record<string, unknown>;
        const x =
          typeof pt.x === "number" && Number.isFinite(pt.x) ? pt.x : null;
        const y =
          typeof pt.y === "number" && Number.isFinite(pt.y) ? pt.y : null;
        return x === null || y === null ? null : { x, y };
      })
      .filter((p): p is CanvasScribblePoint => p !== null);

    if (points.length < 2) return;

    const widthRaw = record.width;
    const width =
      typeof widthRaw === "number" && Number.isFinite(widthRaw)
        ? Math.max(0.8, Math.min(12, widthRaw))
        : DEFAULT_SCRIBBLE_WIDTH;

    out.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id
          : `scribble-${index}-${generateId()}`,
      points,
      width,
      color: typeof record.color === "string" ? record.color : undefined,
    });
  });

  return out;
}

function pointsToStrokePath(points: CanvasScribblePoint[]): string {
  if (!points.length) return "";
  if (points.length < 3) {
    if (points.length === 1) {
      const p = points[0];
      return `M${p.x},${p.y} l0.01,0`;
    }
    const [a, b] = points;
    return `M${a.x},${a.y} L${b.x},${b.y}`;
  }

  const first = points[0];
  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const n = points[i + 1];
    const mx = (p.x + n.x) / 2;
    const my = (p.y + n.y) / 2;
    d += ` Q${p.x},${p.y} ${mx},${my}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

function pointInPolygon(
  point: CanvasScribblePoint,
  polygon: CanvasScribblePoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(
  p: CanvasScribblePoint,
  a: CanvasScribblePoint,
  b: CanvasScribblePoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function isPointNearStroke(
  point: CanvasScribblePoint,
  stroke: CanvasScribbleStroke,
  radius: number,
): boolean {
  const allowance = radius + stroke.width * 0.7;
  const pts = stroke.points;
  if (!pts.length) return false;
  if (pts.length === 1)
    return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= allowance;
  for (let i = 1; i < pts.length; i += 1) {
    if (pointToSegmentDistance(point, pts[i - 1], pts[i]) <= allowance)
      return true;
  }
  return false;
}

function strokeIntersectsLasso(
  stroke: CanvasScribbleStroke,
  polygon: CanvasScribblePoint[],
): boolean {
  if (polygon.length < 3) return false;
  return stroke.points.some((point) => pointInPolygon(point, polygon));
}

function firstStrokeIdNearPoint(
  strokes: CanvasScribbleStroke[],
  point: CanvasScribblePoint,
  radius: number,
  onlyIds?: Set<string>,
): string | null {
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i];
    if (onlyIds && !onlyIds.has(stroke.id)) continue;
    if (isPointNearStroke(point, stroke, radius)) return stroke.id;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export function CanvasView({
  onClose,
  isFullScreen,
  onToggleFullScreen,
  theme,
  autoHideDrawingControls = true,
  vaultPath,
  fileTree,
  canvasFilePath,
  onOpenFile,
  onNewCanvas,
  onDuplicateCanvas,
  onSaveCanvasAs,
  recentCanvasFiles,
  onOpenRecentCanvas,
}: Props) {
  /* ── state ── */
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [vp, setVp] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<CanvasToolMode>("select");
  const [selNodes, setSelNodes] = useState<Set<string>>(new Set());
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState>({
    type: "none",
    startX: 0,
    startY: 0,
  });
  const [tempEdge, setTempEdge] = useState<{
    fx: number;
    fy: number;
    tx: number;
    ty: number;
  } | null>(null);
  const [selBox, setSelBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [grid, setGrid] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [fileModal, setFileModal] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [alignLines, setAlignLines] = useState<{ x: number[]; y: number[] }>({
    x: [],
    y: [],
  });
  const [docMeta, setDocMeta] = useState<Record<string, unknown>>({});
  const [diagnostics, setDiagnostics] = useState<CanvasDiagnostics | null>(
    null,
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [showRecentCanvasMenu, setShowRecentCanvasMenu] = useState(false);
  const [areaSize, setAreaSize] = useState({ width: 1, height: 1 });
  const [scribbles, setScribbles] = useState<CanvasScribbleStroke[]>([]);
  const [activeScribble, setActiveScribble] =
    useState<CanvasScribbleStroke | null>(null);
  const [selectedScribbleIds, setSelectedScribbleIds] = useState<Set<string>>(
    new Set(),
  );
  const [lassoPoints, setLassoPoints] = useState<CanvasScribblePoint[]>([]);
  const [scribbleColor, setScribbleColor] = useState<string>("");
  const [scribbleWidth, setScribbleWidth] = useState<number>(
    DEFAULT_SCRIBBLE_WIDTH,
  );
  const [drawPanelCollapsed, setDrawPanelCollapsed] = useState(false);
  const [drawPanelPinnedOpen, setDrawPanelPinnedOpen] = useState(false);
  const [drawPanelHoverOpen, setDrawPanelHoverOpen] = useState(false);

  /* refs */
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const drawPanelRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes); // always-latest snapshot for move handler
  const scribblesRef = useRef(scribbles);
  const activeScribbleRef = useRef<CanvasScribbleStroke | null>(null);
  const selectedScribbleIdsRef = useRef<Set<string>>(new Set());
  const lassoPointsRef = useRef<CanvasScribblePoint[]>([]);
  const scribbleMoveOriginRef = useRef<Record<string, CanvasScribblePoint[]>>(
    {},
  );
  const scribbleMoveChangedRef = useRef(false);
  const eraseChangedRef = useRef(false);
  const vpRef = useRef<CanvasViewport>(vp);
  const holdDrawModeRef = useRef(false);
  const holdPrevToolRef = useRef<CanvasToolMode>("select");
  const targetVpRef = useRef<CanvasViewport>(vp);
  const zoomAnimFrameRef = useRef<number | null>(null);
  const panInertiaFrameRef = useRef<number | null>(null);
  const panVelocityRef = useRef({ x: 0, y: 0 });
  const panSampleRef = useRef<{ x: number; y: number; at: number } | null>(
    null,
  );
  const previewResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const loadingCanvasRef = useRef(false);
  const lastSavedPayloadRef = useRef("");
  const [suspendMarkdownPreviews, setSuspendMarkdownPreviews] = useState(false);
  nodesRef.current = nodes;
  scribblesRef.current = scribbles;
  activeScribbleRef.current = activeScribble;
  selectedScribbleIdsRef.current = selectedScribbleIds;
  lassoPointsRef.current = lassoPoints;
  vpRef.current = vp;

  /* ── history ── */
  const [hist, setHist] = useState<Snap[]>([
    { nodes: [], edges: [], scribbles: [] },
  ]);
  const [histIdx, setHistIdx] = useState(0);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setAreaSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showRecentCanvasMenu) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (recentMenuRef.current?.contains(target)) return;
      setShowRecentCanvasMenu(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [showRecentCanvasMenu]);

  const isDrawFamilyTool =
    tool === "draw" || tool === "erase" || tool === "lasso";
  const shouldRenderDrawControls =
    isDrawFamilyTool || selectedScribbleIds.size > 0;
  const drawPanelExpanded =
    !autoHideDrawingControls ||
    !drawPanelCollapsed ||
    drawPanelPinnedOpen ||
    drawPanelHoverOpen;

  const revealDrawControls = useCallback(() => {
    setDrawPanelCollapsed(false);
    setDrawPanelPinnedOpen(true);
  }, []);

  const collapseDrawControls = useCallback(() => {
    if (!autoHideDrawingControls) return;
    setDrawPanelCollapsed(true);
    setDrawPanelPinnedOpen(false);
    setDrawPanelHoverOpen(false);
  }, [autoHideDrawingControls]);

  useEffect(() => {
    if (!isDrawFamilyTool) {
      setDrawPanelCollapsed(false);
      setDrawPanelPinnedOpen(false);
      setDrawPanelHoverOpen(false);
      return;
    }
    if (!autoHideDrawingControls) {
      setDrawPanelCollapsed(false);
    }
  }, [isDrawFamilyTool, autoHideDrawingControls]);

  useEffect(() => {
    if (!autoHideDrawingControls) return;
    if (!shouldRenderDrawControls) return;

    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (drawPanelRef.current?.contains(target)) return;
      collapseDrawControls();
    };

    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [autoHideDrawingControls, shouldRenderDrawControls, collapseDrawControls]);

  const push = useCallback(
    (
      n: CanvasNode[],
      e: CanvasEdge[],
      s: CanvasScribbleStroke[] = scribblesRef.current,
    ) => {
      setHist((prev) =>
        [
          ...prev.slice(0, histIdx + 1),
          { nodes: clone(n), edges: clone(e), scribbles: clone(s) },
        ].slice(-HISTORY_LIMIT),
      );
      setHistIdx((i) => Math.min(i + 1, HISTORY_LIMIT - 1));
    },
    [histIdx],
  );

  const undo = useCallback(() => {
    if (histIdx <= 0) return;
    const s = hist[histIdx - 1];
    setNodes(clone(s.nodes));
    setEdges(clone(s.edges));
    setScribbles(clone(s.scribbles));
    setHistIdx(histIdx - 1);
  }, [hist, histIdx]);

  const redo = useCallback(() => {
    if (histIdx >= hist.length - 1) return;
    const s = hist[histIdx + 1];
    setNodes(clone(s.nodes));
    setEdges(clone(s.edges));
    setScribbles(clone(s.scribbles));
    setHistIdx(histIdx + 1);
  }, [hist, histIdx]);

  const stopSmoothZoom = useCallback(() => {
    if (zoomAnimFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimFrameRef.current);
      zoomAnimFrameRef.current = null;
    }
  }, []);

  const stopPanInertia = useCallback(() => {
    if (panInertiaFrameRef.current !== null) {
      cancelAnimationFrame(panInertiaFrameRef.current);
      panInertiaFrameRef.current = null;
    }
    panVelocityRef.current = { x: 0, y: 0 };
    panSampleRef.current = null;
  }, []);

  const setViewportImmediate = useCallback(
    (nextVp: React.SetStateAction<CanvasViewport>) => {
      stopSmoothZoom();
      stopPanInertia();
      setVp((prev) => {
        const next =
          typeof nextVp === "function"
            ? (nextVp as (current: CanvasViewport) => CanvasViewport)(prev)
            : nextVp;
        vpRef.current = next;
        targetVpRef.current = next;
        return next;
      });
    },
    [stopSmoothZoom, stopPanInertia],
  );

  const startSmoothZoom = useCallback(() => {
    if (zoomAnimFrameRef.current !== null) return;

    const animate = () => {
      let finished = false;
      setVp((prev) => {
        const target = targetVpRef.current;
        const zoomDiff = Math.abs(target.zoom - prev.zoom);
        const xDiff = Math.abs(target.x - prev.x);
        const yDiff = Math.abs(target.y - prev.y);

        if (zoomDiff <= 0.001 && xDiff <= 0.5 && yDiff <= 0.5) {
          const snapped = { ...target };
          vpRef.current = snapped;
          finished = true;
          return snapped;
        }

        const next = {
          x: prev.x + (target.x - prev.x) * PAN_LERP,
          y: prev.y + (target.y - prev.y) * PAN_LERP,
          zoom: prev.zoom + (target.zoom - prev.zoom) * ZOOM_LERP,
        };
        vpRef.current = next;
        return next;
      });

      if (finished) {
        zoomAnimFrameRef.current = null;
        return;
      }
      zoomAnimFrameRef.current = requestAnimationFrame(animate);
    };

    zoomAnimFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const startPanInertia = useCallback(() => {
    if (panInertiaFrameRef.current !== null) return;

    const speed = Math.hypot(
      panVelocityRef.current.x,
      panVelocityRef.current.y,
    );
    if (speed < PAN_INERTIA_MIN_SPEED) {
      panVelocityRef.current = { x: 0, y: 0 };
      panSampleRef.current = null;
      return;
    }

    stopSmoothZoom();
    let lastAt = performance.now();

    const step = (now: number) => {
      const dt = Math.max(1, Math.min(34, now - lastAt));
      lastAt = now;

      const decay = Math.pow(PAN_INERTIA_DECAY, dt / 16.6667);
      const v = panVelocityRef.current;
      const nextV = { x: v.x * decay, y: v.y * decay };
      panVelocityRef.current = nextV;

      const nextSpeed = Math.hypot(nextV.x, nextV.y);
      if (nextSpeed < PAN_INERTIA_MIN_SPEED) {
        panInertiaFrameRef.current = null;
        panVelocityRef.current = { x: 0, y: 0 };
        panSampleRef.current = null;
        return;
      }

      setVp((prev) => {
        const next = {
          ...prev,
          x: prev.x + nextV.x * dt,
          y: prev.y + nextV.y * dt,
        };
        vpRef.current = next;
        targetVpRef.current = next;
        return next;
      });

      panInertiaFrameRef.current = requestAnimationFrame(step);
    };

    panInertiaFrameRef.current = requestAnimationFrame(step);
  }, [stopSmoothZoom]);

  useEffect(
    () => () => {
      stopSmoothZoom();
      stopPanInertia();
    },
    [stopSmoothZoom, stopPanInertia],
  );

  const delayMarkdownPreviews = useCallback(() => {
    setSuspendMarkdownPreviews(true);
    if (previewResumeTimerRef.current !== null) {
      clearTimeout(previewResumeTimerRef.current);
    }
    previewResumeTimerRef.current = setTimeout(() => {
      setSuspendMarkdownPreviews(false);
      previewResumeTimerRef.current = null;
    }, MD_PREVIEW_RESUME_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (previewResumeTimerRef.current !== null) {
        clearTimeout(previewResumeTimerRef.current);
        previewResumeTimerRef.current = null;
      }
    },
    [],
  );

  /* ── canvas file load/save ── */
  useEffect(() => {
    let cancelled = false;

    const loadCanvas = async () => {
      if (!canvasFilePath) {
        setNodes([]);
        setEdges([]);
        setScribbles([]);
        setActiveScribble(null);
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        setDocMeta({});
        setDiagnostics(null);
        setShowDiagnostics(false);
        setRecoveryUsed(false);
        setSaveState("saved");
        setLastSavedAt(null);
        lastSavedPayloadRef.current = "";
        setSelNodes(new Set());
        setSelEdges(new Set());
        setHist([{ nodes: [], edges: [], scribbles: [] }]);
        setHistIdx(0);
        return;
      }

      loadingCanvasRef.current = true;
      try {
        const raw = await getAPI().readFile(canvasFilePath);
        let parsed = parseCanvasDocument(raw || "");
        let usedRecovery = false;

        if (
          parsed.diagnostics.parseError ||
          parsed.diagnostics.errors.length > 0
        ) {
          try {
            const recoveryRaw = await getAPI().readFile(
              `${canvasFilePath}${RECOVERY_SUFFIX}`,
            );
            const recovered = parseCanvasDocument(recoveryRaw || "");
            const hasUsableData =
              (recovered.data.nodes?.length || 0) +
                (recovered.data.edges?.length || 0) >
              0;
            if (!recovered.diagnostics.parseError && hasUsableData) {
              parsed = recovered;
              usedRecovery = true;
            }
          } catch {
            // Recovery file may not exist yet.
          }
        }

        const nextNodes = Array.isArray(parsed.data.nodes)
          ? (parsed.data.nodes as CanvasNode[])
          : [];
        const nextEdges = Array.isArray(parsed.data.edges)
          ? (parsed.data.edges as CanvasEdge[])
          : [];
        const metadata = { ...parsed.metadata };
        const nextScribbles = sanitizeCanvasScribbles(
          metadata[CANVAS_SCRIBBLES_KEY],
        );
        delete metadata[CANVAS_SCRIBBLES_KEY];
        const normalizedPayload = serializeCanvasDocument(
          { nodes: nextNodes, edges: nextEdges },
          { ...metadata, [CANVAS_SCRIBBLES_KEY]: nextScribbles },
        );

        if (cancelled) return;
        setNodes(nextNodes);
        setEdges(nextEdges);
        setScribbles(nextScribbles);
        setActiveScribble(null);
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        setDocMeta(metadata);
        setDiagnostics(parsed.diagnostics.repaired ? parsed.diagnostics : null);
        setShowDiagnostics(parsed.diagnostics.repaired);
        setRecoveryUsed(usedRecovery);
        setSaveState("saved");
        setLastSavedAt(Date.now());
        lastSavedPayloadRef.current = normalizedPayload;
        setSelNodes(new Set());
        setSelEdges(new Set());
        setHist([
          {
            nodes: clone(nextNodes),
            edges: clone(nextEdges),
            scribbles: clone(nextScribbles),
          },
        ]);
        setHistIdx(0);
      } catch (error) {
        console.error("Failed to load canvas file:", canvasFilePath, error);
        if (cancelled) return;
        setNodes([]);
        setEdges([]);
        setScribbles([]);
        setActiveScribble(null);
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        setDocMeta({});
        setDiagnostics({
          warnings: [],
          errors: ["Failed to load canvas file."],
          droppedNodes: 0,
          droppedEdges: 0,
          repaired: true,
          parseError:
            error instanceof Error ? error.message : "Unknown file read error.",
        });
        setShowDiagnostics(true);
        setRecoveryUsed(false);
        setSaveState("error");
        setLastSavedAt(null);
        lastSavedPayloadRef.current = "";
        setSelNodes(new Set());
        setSelEdges(new Set());
        setHist([{ nodes: [], edges: [], scribbles: [] }]);
        setHistIdx(0);
      } finally {
        if (!cancelled) loadingCanvasRef.current = false;
      }
    };

    void loadCanvas();
    return () => {
      cancelled = true;
    };
  }, [canvasFilePath]);

  useEffect(() => {
    if (!canvasFilePath || loadingCanvasRef.current) return;

    const payload = serializeCanvasDocument(
      { nodes, edges },
      { ...docMeta, [CANVAS_SCRIBBLES_KEY]: scribbles },
    );
    if (payload === lastSavedPayloadRef.current) {
      setSaveState((prev) =>
        prev === "saving" || prev === "error" ? prev : "saved",
      );
      return;
    }

    setSaveState((prev) => (prev === "saving" ? prev : "unsaved"));

    const timer = setTimeout(() => {
      setSaveState("saving");
      getAPI()
        .writeFile(canvasFilePath, payload)
        .then(async () => {
          lastSavedPayloadRef.current = payload;
          setSaveState("saved");
          setLastSavedAt(Date.now());

          try {
            await getAPI().writeFile(
              `${canvasFilePath}${RECOVERY_SUFFIX}`,
              payload,
            );
          } catch (snapshotError) {
            console.warn(
              "Failed to update canvas recovery snapshot:",
              snapshotError,
            );
          }
        })
        .catch((error) => {
          console.error("Failed to save canvas file:", canvasFilePath, error);
          setSaveState("error");
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [canvasFilePath, nodes, edges, docMeta, scribbles]);

  /* ── coordinate helpers ── */
  const s2c = useCallback(
    (sx: number, sy: number) => {
      const r = areaRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return {
        x: (sx - r.left - vp.x) / vp.zoom,
        y: (sy - r.top - vp.y) / vp.zoom,
      };
    },
    [vp],
  );

  const snap = useCallback(
    (v: number) => (grid ? Math.round(v / GRID_SIZE) * GRID_SIZE : v),
    [grid],
  );

  /* ── center of viewport in canvas coords ── */
  const viewCenter = useCallback(() => {
    const r = areaRef.current?.getBoundingClientRect();
    const w = r?.width || 800,
      h = r?.height || 600;
    return { x: (-vp.x + w / 2) / vp.zoom, y: (-vp.y + h / 2) / vp.zoom };
  }, [vp]);

  /* ═══ NODE OPS ═══ */
  const addNode = useCallback(
    (type: CanvasNode["type"], extra?: Record<string, any>) => {
      const c = viewCenter();
      const w = type === "group" ? DEFAULT_GROUP_WIDTH : DEFAULT_NODE_WIDTH;
      const h =
        type === "group"
          ? DEFAULT_GROUP_HEIGHT
          : type === "file"
            ? 80
            : type === "link"
              ? 100
              : DEFAULT_NODE_HEIGHT;
      const base = {
        id: generateId(),
        x: snap(c.x - w / 2),
        y: snap(c.y - h / 2),
        width: w,
        height: h,
      };
      let n: CanvasNode;
      switch (type) {
        case "text":
          n = { ...base, type: "text", text: "", ...extra } as CanvasTextNode;
          break;
        case "file":
          n = { ...base, type: "file", file: "", ...extra } as CanvasFileNode;
          break;
        case "link":
          n = { ...base, type: "link", url: "", ...extra } as CanvasLinkNode;
          break;
        case "group":
          n = {
            ...base,
            type: "group",
            label: "Group",
            ...extra,
          } as CanvasGroupNode;
          break;
        default:
          return;
      }
      // groups at back, rest at front
      const sorted = type === "group" ? [n, ...nodes] : [...nodes, n];
      setNodes(sorted);
      setSelNodes(new Set([n.id]));
      setSelEdges(new Set());
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      push(sorted, edges);
      return n;
    },
    [nodes, edges, viewCenter, snap, push],
  );

  const updateNode = useCallback(
    (id: string, u: Record<string, any>) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.id === id ? (clone({ ...n, ...u }) as CanvasNode) : n,
        );
        push(next, edges);
        return next;
      });
    },
    [edges, push],
  );

  const deleteSelected = useCallback(() => {
    const nn = nodes.filter((n) => !selNodes.has(n.id));
    const ee = edges.filter(
      (e) =>
        !selEdges.has(e.id) &&
        !selNodes.has(e.fromNode) &&
        !selNodes.has(e.toNode),
    );
    const ss = scribbles.filter((s) => !selectedScribbleIds.has(s.id));
    setNodes(nn);
    setEdges(ee);
    setScribbles(ss);
    scribblesRef.current = ss;
    setSelNodes(new Set());
    setSelEdges(new Set());
    setSelectedScribbleIds(new Set());
    setLassoPoints([]);
    push(nn, ee, ss);
  }, [nodes, edges, scribbles, selNodes, selEdges, selectedScribbleIds, push]);

  const duplicateNode = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      const dup = clone({
        ...n,
        id: generateId(),
        x: n.x + 30,
        y: n.y + 30,
      }) as CanvasNode;
      const nn = [...nodes, dup];
      setNodes(nn);
      setSelNodes(new Set([dup.id]));
      setSelEdges(new Set());
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      push(nn, edges);
    },
    [nodes, edges, push],
  );

  const toggleLockSelected = useCallback(() => {
    const targets = nodes.filter((n) => selNodes.has(n.id));
    if (!targets.length) return;
    const lockAll = !targets.every((n) => n.locked);
    const next = nodes.map((n) =>
      selNodes.has(n.id) ? { ...n, locked: lockAll } : n,
    );
    setNodes(next);
    push(next, edges);
  }, [nodes, selNodes, edges, push]);

  const bringToFront = useCallback(() => {
    if (!selNodes.size) return;
    const selected = nodes.filter((n) => selNodes.has(n.id));
    const others = nodes.filter((n) => !selNodes.has(n.id));
    const next = [...others, ...selected];
    setNodes(next);
    push(next, edges);
  }, [nodes, selNodes, edges, push]);

  const sendToBack = useCallback(() => {
    if (!selNodes.size) return;
    const selected = nodes.filter((n) => selNodes.has(n.id));
    const others = nodes.filter((n) => !selNodes.has(n.id));
    const next = [...selected, ...others];
    setNodes(next);
    push(next, edges);
  }, [nodes, selNodes, edges, push]);

  const alignSelected = useCallback(
    (mode: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter") => {
      const selected = nodes.filter((n) => selNodes.has(n.id) && !n.locked);
      if (selected.length < 2) return;

      const bounds = {
        left: Math.min(...selected.map((n) => n.x)),
        right: Math.max(...selected.map((n) => n.x + n.width)),
        top: Math.min(...selected.map((n) => n.y)),
        bottom: Math.max(...selected.map((n) => n.y + n.height)),
      };
      const centerX = (bounds.left + bounds.right) / 2;
      const centerY = (bounds.top + bounds.bottom) / 2;

      const next = nodes.map((n) => {
        if (!selNodes.has(n.id) || n.locked) return n;
        if (mode === "left") return { ...n, x: bounds.left };
        if (mode === "right") return { ...n, x: bounds.right - n.width };
        if (mode === "top") return { ...n, y: bounds.top };
        if (mode === "bottom") return { ...n, y: bounds.bottom - n.height };
        if (mode === "hcenter") return { ...n, x: centerX - n.width / 2 };
        return { ...n, y: centerY - n.height / 2 };
      });

      setNodes(next);
      push(next, edges);
    },
    [nodes, selNodes, edges, push],
  );

  const distributeSelected = useCallback(
    (axis: "x" | "y") => {
      const selected = nodes.filter((n) => selNodes.has(n.id) && !n.locked);
      if (selected.length < 3) return;

      const sorted = [...selected].sort((a, b) =>
        axis === "x" ? a.x - b.x : a.y - b.y,
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      if (axis === "x") {
        const start = first.x + first.width / 2;
        const end = last.x + last.width / 2;
        const step = (end - start) / (sorted.length - 1);
        const nextById: Record<string, number> = {};
        sorted.forEach((node, idx) => {
          const targetCenter = start + step * idx;
          nextById[node.id] = targetCenter - node.width / 2;
        });
        const next = nodes.map((n) =>
          nextById[n.id] !== undefined ? { ...n, x: nextById[n.id] } : n,
        );
        setNodes(next);
        push(next, edges);
        return;
      }

      const start = first.y + first.height / 2;
      const end = last.y + last.height / 2;
      const step = (end - start) / (sorted.length - 1);
      const nextById: Record<string, number> = {};
      sorted.forEach((node, idx) => {
        const targetCenter = start + step * idx;
        nextById[node.id] = targetCenter - node.height / 2;
      });
      const next = nodes.map((n) =>
        nextById[n.id] !== undefined ? { ...n, y: nextById[n.id] } : n,
      );
      setNodes(next);
      push(next, edges);
    },
    [nodes, selNodes, edges, push],
  );

  const repairAndSave = useCallback(async () => {
    if (!canvasFilePath) return;
    const payload = serializeCanvasDocument(
      { nodes, edges },
      { ...docMeta, [CANVAS_SCRIBBLES_KEY]: scribbles },
    );
    setSaveState("saving");
    try {
      await getAPI().writeFile(canvasFilePath, payload);
      await getAPI().writeFile(`${canvasFilePath}${RECOVERY_SUFFIX}`, payload);
      lastSavedPayloadRef.current = payload;
      setSaveState("saved");
      setLastSavedAt(Date.now());
      setShowDiagnostics(false);
      setDiagnostics(null);
    } catch (error) {
      console.error("Repair save failed:", error);
      setSaveState("error");
    }
  }, [canvasFilePath, nodes, edges, docMeta, scribbles]);

  const restoreFromRecovery = useCallback(async () => {
    if (!canvasFilePath) return;
    try {
      const recoveryRaw = await getAPI().readFile(
        `${canvasFilePath}${RECOVERY_SUFFIX}`,
      );
      const parsed = parseCanvasDocument(recoveryRaw || "");
      const nextNodes = Array.isArray(parsed.data.nodes)
        ? (parsed.data.nodes as CanvasNode[])
        : [];
      const nextEdges = Array.isArray(parsed.data.edges)
        ? (parsed.data.edges as CanvasEdge[])
        : [];
      const metadata = { ...parsed.metadata };
      const nextScribbles = sanitizeCanvasScribbles(
        metadata[CANVAS_SCRIBBLES_KEY],
      );
      delete metadata[CANVAS_SCRIBBLES_KEY];
      setNodes(nextNodes);
      setEdges(nextEdges);
      setScribbles(nextScribbles);
      setActiveScribble(null);
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      setDocMeta(metadata);
      setDiagnostics(parsed.diagnostics.repaired ? parsed.diagnostics : null);
      setShowDiagnostics(parsed.diagnostics.repaired);
      setRecoveryUsed(true);
      push(nextNodes, nextEdges, nextScribbles);
    } catch (error) {
      console.error("Failed to restore recovery snapshot:", error);
      setSaveState("error");
    }
  }, [canvasFilePath, push]);

  /* ═══ MOUSE: DOWN ═══ */
  const onAreaDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0 && tool === "draw") {
        revealDrawControls();
        const p = s2c(e.clientX, e.clientY);
        const stroke: CanvasScribbleStroke = {
          id: generateId(),
          points: [p],
          width: scribbleWidth,
          color: scribbleColor || undefined,
        };
        setActiveScribble(stroke);
        setSelNodes(new Set());
        setSelEdges(new Set());
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        lassoPointsRef.current = [];
        setColorPickerFor(null);
        setDrag({ type: "draw", startX: e.clientX, startY: e.clientY });
        e.preventDefault();
        return;
      }

      if (e.button === 0 && tool === "erase") {
        revealDrawControls();
        const p = s2c(e.clientX, e.clientY);
        eraseChangedRef.current = false;
        setSelNodes(new Set());
        setSelEdges(new Set());
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        lassoPointsRef.current = [];
        setColorPickerFor(null);

        const radius = ERASER_RADIUS_PX / Math.max(vpRef.current.zoom, 0.25);
        setScribbles((prev) => {
          const next = prev.filter(
            (stroke) => !isPointNearStroke(p, stroke, radius),
          );
          if (next.length !== prev.length) eraseChangedRef.current = true;
          scribblesRef.current = next;
          return next;
        });

        setDrag({ type: "erase", startX: e.clientX, startY: e.clientY });
        e.preventDefault();
        return;
      }

      if (e.button === 0 && tool === "lasso") {
        revealDrawControls();
        const p = s2c(e.clientX, e.clientY);
        const selected = selectedScribbleIdsRef.current;
        const moveHitId = selected.size
          ? firstStrokeIdNearPoint(
              scribblesRef.current,
              p,
              10 / Math.max(vpRef.current.zoom, 0.25),
              selected,
            )
          : null;

        if (moveHitId) {
          const origin: Record<string, CanvasScribblePoint[]> = {};
          scribblesRef.current.forEach((stroke) => {
            if (!selected.has(stroke.id)) return;
            origin[stroke.id] = stroke.points.map((pt) => ({
              x: pt.x,
              y: pt.y,
            }));
          });
          scribbleMoveOriginRef.current = origin;
          scribbleMoveChangedRef.current = false;
          setDrag({
            type: "scribble-move",
            startX: e.clientX,
            startY: e.clientY,
          });
          e.preventDefault();
          return;
        }

        setLassoPoints([p]);
        lassoPointsRef.current = [p];
        setSelNodes(new Set());
        setSelEdges(new Set());
        setSelectedScribbleIds(new Set());
        setColorPickerFor(null);
        setDrag({ type: "lasso", startX: e.clientX, startY: e.clientY });
        e.preventDefault();
        return;
      }

      if (
        e.button === 1 ||
        (e.button === 0 && (tool === "pan" || e.shiftKey))
      ) {
        stopSmoothZoom();
        stopPanInertia();
        panVelocityRef.current = { x: 0, y: 0 };
        panSampleRef.current = {
          x: vpRef.current.x,
          y: vpRef.current.y,
          at: performance.now(),
        };
        setDrag({
          type: "pan",
          startX: e.clientX - vpRef.current.x,
          startY: e.clientY - vpRef.current.y,
        });
        e.preventDefault();
        return;
      }
      if (e.button === 0 && tool === "select") {
        const p = s2c(e.clientX, e.clientY);
        setDrag({ type: "select", startX: p.x, startY: p.y });
        setSelNodes(new Set());
        setSelEdges(new Set());
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        setColorPickerFor(null);
      }
    },
    [
      tool,
      s2c,
      stopPanInertia,
      stopSmoothZoom,
      scribbleWidth,
      scribbleColor,
      revealDrawControls,
    ],
  );

  const onNodeDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (tool === "draw" || tool === "erase" || tool === "lasso") {
        return;
      }
      stopPanInertia();
      e.stopPropagation();
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      lassoPointsRef.current = [];
      const target = e.target as HTMLElement | null;
      const inNoDragArea = !!target?.closest('[data-cv-no-drag="true"]');
      const isInteractiveTarget = !!target?.closest(
        'a,button,input,textarea,select,label,[role="button"],.task-list-item-checkbox,.external-link,.internal-link,.wiki-link,.tag',
      );
      if (inNoDragArea && isInteractiveTarget) {
        const multi = e.ctrlKey || e.metaKey;
        if (multi) {
          setSelNodes((prev) => {
            const s = new Set(prev);
            s.has(id) ? s.delete(id) : s.add(id);
            return s;
          });
        } else if (!selNodes.has(id)) {
          setSelNodes(new Set([id]));
          setSelEdges(new Set());
        }
        setColorPickerFor(null);
        return;
      }
      if (editingId === id) return; // already editing
      if (tool === "edge") {
        const n = nodes.find((x) => x.id === id)!;
        const p = s2c(e.clientX, e.clientY);
        const cx = n.x + n.width / 2,
          cy = n.y + n.height / 2,
          dx = p.x - cx,
          dy = p.y - cy;
        const side: EdgeSide =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "right"
              : "left"
            : dy > 0
              ? "bottom"
              : "top";
        setDrag({
          type: "edge",
          startX: e.clientX,
          startY: e.clientY,
          edgeFromNode: id,
          edgeFromSide: side,
        });
        return;
      }
      const multi = e.ctrlKey || e.metaKey;
      if (multi) {
        setSelNodes((prev) => {
          const s = new Set(prev);
          s.has(id) ? s.delete(id) : s.add(id);
          return s;
        });
      } else if (!selNodes.has(id)) {
        setSelNodes(new Set([id]));
        setSelEdges(new Set());
      }
      setColorPickerFor(null);
      const n = nodes.find((x) => x.id === id)!;
      if (n.locked) {
        return;
      }
      const p = s2c(e.clientX, e.clientY);

      const movingIds = new Set<string>();
      const getMoving = (nodeId: string) => {
        if (movingIds.has(nodeId)) return;
        const node = nodes.find((x) => x.id === nodeId);
        if (!node || node.locked) return;
        movingIds.add(nodeId);
        if (node && node.type === "group") {
          nodes.forEach((child) => {
            if (child.id === node.id) return;
            if (child.locked) return;
            if (
              child.x >= node.x &&
              child.y >= node.y &&
              child.x + child.width <= node.x + node.width &&
              child.y + child.height <= node.y + node.height
            ) {
              getMoving(child.id);
            }
          });
        }
      };
      getMoving(id);
      selNodes.forEach((sid) => getMoving(sid));

      const originById: Record<string, { x: number; y: number }> = {};
      nodes.forEach((node) => {
        if (movingIds.has(node.id)) {
          originById[node.id] = { x: node.x, y: node.y };
        }
      });

      setDrag({
        type: "node",
        nodeId: id,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: p.x - n.x,
        offsetY: p.y - n.y,
        movingIds,
        originById,
      });
    },
    [editingId, tool, nodes, selNodes, s2c, stopPanInertia],
  );

  const onPortDown = useCallback(
    (e: React.MouseEvent, id: string, side: EdgeSide) => {
      stopPanInertia();
      e.stopPropagation();
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      lassoPointsRef.current = [];
      setDrag({
        type: "edge",
        startX: e.clientX,
        startY: e.clientY,
        edgeFromNode: id,
        edgeFromSide: side,
      });
    },
    [stopPanInertia],
  );

  const onResizeDown = useCallback(
    (e: React.MouseEvent, id: string, handle: string) => {
      stopPanInertia();
      e.stopPropagation();
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      lassoPointsRef.current = [];
      const n = nodes.find((x) => x.id === id);
      if (!n || n.locked) return;
      setDrag({
        type: "resize",
        nodeId: id,
        startX: e.clientX,
        startY: e.clientY,
        resizeHandle: handle,
        resizeOrigin: { x: n.x, y: n.y, width: n.width, height: n.height },
      });
    },
    [nodes, stopPanInertia],
  );

  const onSelectionResizeDown = useCallback(
    (e: React.MouseEvent, handle: string) => {
      stopPanInertia();
      e.stopPropagation();
      const selected = nodes.filter((n) => selNodes.has(n.id) && !n.locked);
      if (selected.length < 2) return;

      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const selectionOriginById: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};

      selected.forEach((n) => {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.width);
        y1 = Math.max(y1, n.y + n.height);
        selectionOriginById[n.id] = {
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
        };
      });

      setDrag({
        type: "resize",
        startX: e.clientX,
        startY: e.clientY,
        resizeHandle: handle,
        selectionBounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        selectionOriginById,
      });
    },
    [nodes, selNodes, stopPanInertia],
  );

  /* ═══ MOUSE: MOVE ═══ */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag.type === "none") return;
      switch (drag.type) {
        case "pan": {
          const nextX = e.clientX - drag.startX;
          const nextY = e.clientY - drag.startY;
          const now = performance.now();
          const prev = panSampleRef.current;

          if (prev) {
            const dt = now - prev.at;
            if (dt > 0 && dt <= PAN_VELOCITY_MAX_SAMPLE_MS) {
              const rawVX = (nextX - prev.x) / dt;
              const rawVY = (nextY - prev.y) / dt;
              panVelocityRef.current = {
                x:
                  panVelocityRef.current.x * (1 - PAN_VELOCITY_BLEND) +
                  rawVX * PAN_VELOCITY_BLEND,
                y:
                  panVelocityRef.current.y * (1 - PAN_VELOCITY_BLEND) +
                  rawVY * PAN_VELOCITY_BLEND,
              };
            }
          }

          panSampleRef.current = { x: nextX, y: nextY, at: now };
          setVp((prevVp) => {
            const next = { ...prevVp, x: nextX, y: nextY };
            vpRef.current = next;
            targetVpRef.current = next;
            return next;
          });
          break;
        }
        case "node": {
          const dx = (e.clientX - drag.startX) / vp.zoom;
          const dy = (e.clientY - drag.startY) / vp.zoom;
          const snap0 = nodesRef.current;
          const originById = drag.originById || {};
          let ax: number[] = [];
          let ay: number[] = [];

          let bestDx = dx;
          let bestDy = dy;

          if (drag.nodeId) {
            const origMain =
              originById[drag.nodeId] ||
              snap0.find((o) => o.id === drag.nodeId);
            if (!origMain) break;
            const dragStep = grid ? Math.max(4, Math.round(GRID_SIZE / 2)) : 1;
            const nx = grid
              ? Math.round((origMain.x + dx) / dragStep) * dragStep
              : origMain.x + dx;
            const ny = grid
              ? Math.round((origMain.y + dy) / dragStep) * dragStep
              : origMain.y + dy;

            bestDx = nx - origMain.x;
            bestDy = ny - origMain.y;

            if (!e.shiftKey) {
              const THRESHOLD = 8 / vp.zoom;
              let minXDist = THRESHOLD;
              let minYDist = THRESHOLD;

              snap0.forEach((other) => {
                if (drag.movingIds?.has(other.id)) return;

                const checkAlign = (
                  targetArr: number[],
                  mainArr: number[],
                  isX: boolean,
                ) => {
                  targetArr.forEach((t) =>
                    mainArr.forEach((m, i) => {
                      const dist = Math.abs(t - m);
                      if (isX && dist < minXDist) {
                        minXDist = dist;
                        bestDx =
                          t -
                          (i === 1
                            ? (draggedNode?.width || 0) / 2
                            : i === 2
                              ? draggedNode?.width || 0
                              : 0) -
                          origMain.x;
                        ax = [t];
                      } else if (!isX && dist < minYDist) {
                        minYDist = dist;
                        bestDy =
                          t -
                          (i === 1
                            ? (draggedNode?.height || 0) / 2
                            : i === 2
                              ? draggedNode?.height || 0
                              : 0) -
                          origMain.y;
                        ay = [t];
                      } else if (
                        isX &&
                        dist === minXDist &&
                        dist < THRESHOLD &&
                        !ax.includes(t)
                      )
                        ax.push(t);
                      else if (
                        !isX &&
                        dist === minYDist &&
                        dist < THRESHOLD &&
                        !ay.includes(t)
                      )
                        ay.push(t);
                    }),
                  );
                };

                const draggedNode = snap0.find((n) => n.id === drag.nodeId);
                const dw = draggedNode?.width || 0;
                const dh = draggedNode?.height || 0;
                checkAlign(
                  [other.x, other.x + other.width / 2, other.x + other.width],
                  [nx, nx + dw / 2, nx + dw],
                  true,
                );
                checkAlign(
                  [other.y, other.y + other.height / 2, other.y + other.height],
                  [ny, ny + dh / 2, ny + dh],
                  false,
                );
              });
            }
          }
          setAlignLines({ x: ax, y: ay });

          setNodes((prev) =>
            prev.map((n) => {
              if (!drag.movingIds?.has(n.id)) return n;
              const orig = originById[n.id] || { x: n.x, y: n.y };
              return { ...n, x: orig.x + bestDx, y: orig.y + bestDy };
            }),
          );
          break;
        }
        case "edge": {
          const from = nodesRef.current.find((n) => n.id === drag.edgeFromNode);
          if (!from) break;
          const side = drag.edgeFromSide || "right";
          const fp = portXY(from, side);
          const cp = s2c(e.clientX, e.clientY);
          setTempEdge({ fx: fp.x, fy: fp.y, tx: cp.x, ty: cp.y });
          break;
        }
        case "select": {
          const cp = s2c(e.clientX, e.clientY);
          const x = Math.min(drag.startX, cp.x),
            y = Math.min(drag.startY, cp.y);
          const w = Math.abs(cp.x - drag.startX),
            h = Math.abs(cp.y - drag.startY);
          setSelBox({ x, y, w, h });
          const sel = new Set<string>();
          nodesRef.current.forEach((n) => {
            if (
              n.x + n.width > x &&
              n.x < x + w &&
              n.y + n.height > y &&
              n.y < y + h
            )
              sel.add(n.id);
          });
          setSelNodes(sel);
          break;
        }
        case "resize": {
          if (drag.selectionBounds && drag.selectionOriginById) {
            const base = drag.selectionBounds;
            const dx = (e.clientX - drag.startX) / vp.zoom;
            const dy = (e.clientY - drag.startY) / vp.zoom;
            const h = drag.resizeHandle || "se";
            let nx = base.x;
            let ny = base.y;
            let nw = base.width;
            let nh = base.height;

            if (h.includes("e"))
              nw = Math.max(MIN_NODE_WIDTH * 1.5, base.width + dx);
            if (h.includes("w")) {
              nw = Math.max(MIN_NODE_WIDTH * 1.5, base.width - dx);
              nx = base.x + (base.width - nw);
            }
            if (h.includes("s"))
              nh = Math.max(MIN_NODE_HEIGHT * 1.5, base.height + dy);
            if (h.includes("n")) {
              nh = Math.max(MIN_NODE_HEIGHT * 1.5, base.height - dy);
              ny = base.y + (base.height - nh);
            }

            const sx = base.width > 0 ? nw / base.width : 1;
            const sy = base.height > 0 ? nh / base.height : 1;

            setNodes((prev) =>
              prev.map((node) => {
                const origin = drag.selectionOriginById?.[node.id];
                if (!origin || node.locked) return node;
                return {
                  ...node,
                  x: nx + (origin.x - base.x) * sx,
                  y: ny + (origin.y - base.y) * sy,
                  width: Math.max(MIN_NODE_WIDTH, origin.width * sx),
                  height: Math.max(MIN_NODE_HEIGHT, origin.height * sy),
                };
              }),
            );
            break;
          }

          const n = nodesRef.current.find((x) => x.id === drag.nodeId);
          if (!n || n.locked) break;
          const base = drag.resizeOrigin || {
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
          };
          const dx = (e.clientX - drag.startX) / vp.zoom;
          const dy = (e.clientY - drag.startY) / vp.zoom;
          const h = drag.resizeHandle || "se";
          let nx = base.x,
            ny = base.y,
            nw = base.width,
            nh = base.height;

          if (h.includes("e")) {
            nw = Math.max(MIN_NODE_WIDTH, base.width + dx);
          }
          if (h.includes("w")) {
            nw = Math.max(MIN_NODE_WIDTH, base.width - dx);
            nx = base.x + (base.width - nw);
          }
          if (h.includes("s")) {
            nh = Math.max(MIN_NODE_HEIGHT, base.height + dy);
          }
          if (h.includes("n")) {
            nh = Math.max(MIN_NODE_HEIGHT, base.height - dy);
            ny = base.y + (base.height - nh);
          }

          setNodes((prev) =>
            prev.map((nd) =>
              nd.id === drag.nodeId
                ? { ...nd, x: nx, y: ny, width: nw, height: nh }
                : nd,
            ),
          );
          break;
        }
        case "draw": {
          const active = activeScribbleRef.current;
          if (!active) break;
          const point = s2c(e.clientX, e.clientY);
          const last = active.points[active.points.length - 1];
          const minDist = MIN_SCRIBBLE_POINT_DIST / Math.max(vp.zoom, 0.25);
          if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDist)
            break;
          const nextStroke = { ...active, points: [...active.points, point] };
          activeScribbleRef.current = nextStroke;
          setActiveScribble(nextStroke);
          break;
        }
        case "erase": {
          const point = s2c(e.clientX, e.clientY);
          const radius = ERASER_RADIUS_PX / Math.max(vpRef.current.zoom, 0.25);
          setScribbles((prev) => {
            const next = prev.filter(
              (stroke) => !isPointNearStroke(point, stroke, radius),
            );
            if (next.length !== prev.length) eraseChangedRef.current = true;
            scribblesRef.current = next;
            return next;
          });
          break;
        }
        case "lasso": {
          const point = s2c(e.clientX, e.clientY);
          setLassoPoints((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              Math.hypot(point.x - last.x, point.y - last.y) <
                MIN_LASSO_POINT_DIST / Math.max(vp.zoom, 0.25)
            ) {
              return prev;
            }
            const next = [...prev, point];
            lassoPointsRef.current = next;
            return next;
          });
          break;
        }
        case "scribble-move": {
          const origin = scribbleMoveOriginRef.current;
          const ids = selectedScribbleIdsRef.current;
          if (!Object.keys(origin).length || !ids.size) break;
          const dx = (e.clientX - drag.startX) / Math.max(vp.zoom, 0.25);
          const dy = (e.clientY - drag.startY) / Math.max(vp.zoom, 0.25);
          if (
            !scribbleMoveChangedRef.current &&
            (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02)
          ) {
            scribbleMoveChangedRef.current = true;
          }
          setScribbles((prev) => {
            const next = prev.map((stroke) => {
              if (!ids.has(stroke.id)) return stroke;
              const base = origin[stroke.id] || stroke.points;
              return {
                ...stroke,
                points: base.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              };
            });
            scribblesRef.current = next;
            return next;
          });
          break;
        }
      }
    };
    const onUp = (e: MouseEvent) => {
      if (drag.type === "pan") {
        const endX = e.clientX - drag.startX;
        const endY = e.clientY - drag.startY;
        const now = performance.now();
        const prev = panSampleRef.current;

        if (prev) {
          const dt = now - prev.at;
          if (dt > 0 && dt <= PAN_VELOCITY_MAX_SAMPLE_MS) {
            const rawVX = (endX - prev.x) / dt;
            const rawVY = (endY - prev.y) / dt;
            panVelocityRef.current = {
              x:
                panVelocityRef.current.x * (1 - PAN_VELOCITY_BLEND) +
                rawVX * PAN_VELOCITY_BLEND,
              y:
                panVelocityRef.current.y * (1 - PAN_VELOCITY_BLEND) +
                rawVY * PAN_VELOCITY_BLEND,
            };
          }
        }

        setVp((prevVp) => {
          const next = { ...prevVp, x: endX, y: endY };
          vpRef.current = next;
          targetVpRef.current = next;
          return next;
        });

        startPanInertia();
      }

      if (drag.type === "edge") {
        const cp = s2c(e.clientX, e.clientY);
        for (const n of [...nodesRef.current].reverse()) {
          if (n.id === drag.edgeFromNode) continue;
          if (
            cp.x >= n.x &&
            cp.x <= n.x + n.width &&
            cp.y >= n.y &&
            cp.y <= n.y + n.height
          ) {
            const cx = n.x + n.width / 2,
              cy = n.y + n.height / 2;
            const dx = cp.x - cx,
              dy = cp.y - cy;
            const toSide: EdgeSide =
              Math.abs(dx) > Math.abs(dy)
                ? dx > 0
                  ? "right"
                  : "left"
                : dy > 0
                  ? "bottom"
                  : "top";
            const dup = edges.some(
              (ed) =>
                (ed.fromNode === drag.edgeFromNode && ed.toNode === n.id) ||
                (ed.fromNode === n.id && ed.toNode === drag.edgeFromNode),
            );
            if (!dup && drag.edgeFromNode) {
              const ne: CanvasEdge = {
                id: generateId(),
                fromNode: drag.edgeFromNode,
                fromSide: drag.edgeFromSide,
                toNode: n.id,
                toSide: toSide,
                toEnd: "arrow",
              };
              const newEdges = [...edges, ne];
              setEdges(newEdges);
              push(nodesRef.current, newEdges);
            }
            break;
          }
        }
        setTempEdge(null);
      }

      if (drag.type === "draw") {
        const finalized = activeScribbleRef.current;
        if (finalized && finalized.points.length > 1) {
          const nextScribbles = [...scribblesRef.current, finalized];
          setScribbles(nextScribbles);
          scribblesRef.current = nextScribbles;
          push(nodesRef.current, edges, nextScribbles);
        }
        setActiveScribble(null);
        activeScribbleRef.current = null;
        collapseDrawControls();
      }

      if (drag.type === "erase") {
        if (eraseChangedRef.current) {
          push(nodesRef.current, edges, scribblesRef.current);
        }
        eraseChangedRef.current = false;
        collapseDrawControls();
      }

      if (drag.type === "lasso") {
        const polygon = lassoPointsRef.current;
        if (polygon.length >= 3) {
          const selected = new Set(
            scribblesRef.current
              .filter((stroke) => strokeIntersectsLasso(stroke, polygon))
              .map((stroke) => stroke.id),
          );
          setSelectedScribbleIds(selected);
          setSelNodes(new Set());
          setSelEdges(new Set());
        }
        setLassoPoints([]);
        lassoPointsRef.current = [];
        collapseDrawControls();
      }

      if (drag.type === "scribble-move") {
        if (scribbleMoveChangedRef.current) {
          push(nodesRef.current, edges, scribblesRef.current);
        }
        scribbleMoveChangedRef.current = false;
      }

      if (drag.type === "node" || drag.type === "resize")
        push(nodesRef.current, edges);
      setDrag({ type: "none", startX: 0, startY: 0 });
      setAlignLines({ x: [], y: [] });
      setSelBox(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [
    drag,
    vp,
    selNodes,
    edges,
    s2c,
    snap,
    push,
    startPanInertia,
    collapseDrawControls,
  ]);

  /* ═══ WHEEL / ZOOM ═══ */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const scrollHost = target?.closest(".cv-node-body") as HTMLElement | null;
      const inEmbeddedNoteBody = !!target?.closest(".cv-embedded-md");
      const canScrollNodeBody =
        !!scrollHost &&
        (scrollHost.scrollHeight > scrollHost.clientHeight ||
          scrollHost.scrollWidth > scrollHost.clientWidth);

      if (!e.ctrlKey && !e.metaKey && canScrollNodeBody) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && inEmbeddedNoteBody) {
        return;
      }

      e.preventDefault();
      stopPanInertia();
      const r = el.getBoundingClientRect();
      const base = targetVpRef.current;
      const normalizedDelta =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? e.deltaY * 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? e.deltaY * window.innerHeight
            : e.deltaY;
      const zoomFactor = Math.exp(-normalizedDelta * WHEEL_ZOOM_SENSITIVITY);
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.zoom * zoomFactor));
      if (Math.abs(nz - base.zoom) < 0.0001) return;
      const mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const worldX = (mx - base.x) / base.zoom;
      const worldY = (my - base.y) / base.zoom;
      targetVpRef.current = {
        x: mx - worldX * nz,
        y: my - worldY * nz,
        zoom: nz,
      };
      delayMarkdownPreviews();
      startSmoothZoom();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [delayMarkdownPreviews, startSmoothZoom, stopPanInertia]);

  const zoomBy = useCallback(
    (d: number) => {
      const r = areaRef.current?.getBoundingClientRect();
      if (!r) return;
      stopPanInertia();
      const cx = r.width / 2,
        cy = r.height / 2;
      const base = targetVpRef.current;
      const zoomFactor =
        d > 0 ? 1 + ZOOM_STEP_INTENSITY : 1 - ZOOM_STEP_INTENSITY;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.zoom * zoomFactor));
      const worldX = (cx - base.x) / base.zoom;
      const worldY = (cy - base.y) / base.zoom;
      targetVpRef.current = {
        x: cx - worldX * nz,
        y: cy - worldY * nz,
        zoom: nz,
      };
      delayMarkdownPreviews();
      startSmoothZoom();
    },
    [delayMarkdownPreviews, startSmoothZoom, stopPanInertia],
  );

  const zoomFit = useCallback(() => {
    if (!nodes.length) {
      setViewportImmediate({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const r = areaRef.current?.getBoundingClientRect();
    if (!r) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    nodes.forEach((n) => {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    const pad = 80,
      cw = x1 - x0 + pad * 2,
      ch = y1 - y0 + pad * 2;
    const z = Math.min(1, r.width / cw, r.height / ch);
    setViewportImmediate({
      x: (r.width - cw * z) / 2 - (x0 - pad) * z,
      y: (r.height - ch * z) / 2 - (y0 - pad) * z,
      zoom: z,
    });
  }, [nodes, setViewportImmediate]);

  /* ═══ KEYBOARD ═══ */
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (!ctrl && key === "p") {
        if (!holdDrawModeRef.current && !e.repeat) {
          holdPrevToolRef.current = tool;
          holdDrawModeRef.current = true;
          setTool("draw");
          revealDrawControls();
        }
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (selNodes.size || selEdges.size || selectedScribbleIds.size)
      ) {
        deleteSelected();
        return;
      }
      if (ctrl && e.key === "a") {
        e.preventDefault();
        setSelNodes(new Set(nodes.map((n) => n.id)));
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if (e.key === "v" && !ctrl) setTool("select");
      if (e.key === "h" && !ctrl) setTool("pan");
      if (e.key === "c" && !ctrl) setTool("edge");
      if (e.key === "d" && !ctrl) {
        setTool("draw");
        revealDrawControls();
      }
      if (e.key === "e" && !ctrl) {
        setTool("erase");
        revealDrawControls();
      }
      if (e.key === "l" && !ctrl) {
        setTool("lasso");
        revealDrawControls();
      }
      if (e.key === "Escape") {
        setSelNodes(new Set());
        setSelEdges(new Set());
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        lassoPointsRef.current = [];
        setTool("select");
        setEditingId(null);
        setColorPickerFor(null);
        setActiveScribble(null);
        activeScribbleRef.current = null;
        setDrag({ type: "none", startX: 0, startY: 0 });
        holdDrawModeRef.current = false;
        collapseDrawControls();
      }
    };

    const handleUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "p") return;
      if (!holdDrawModeRef.current) return;
      holdDrawModeRef.current = false;
      setTool(holdPrevToolRef.current || "select");
      collapseDrawControls();
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, [
    selNodes,
    selEdges,
    selectedScribbleIds,
    nodes,
    deleteSelected,
    undo,
    redo,
    tool,
    revealDrawControls,
    collapseDrawControls,
  ]);

  /* ═══ EDITING ═══ */
  const startEdit = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      if (n.locked && (n.type === "text" || n.type === "group")) return;
      if (n.type === "text") {
        setEditText((n as CanvasTextNode).text);
        setEditingId(id);
      }
      if (n.type === "group") {
        setEditText((n as CanvasGroupNode).label || "");
        setEditingId(id);
      }
      if (n.type === "link") window.open((n as CanvasLinkNode).url, "_blank");
      if (n.type === "file" && onOpenFile)
        onOpenFile((n as CanvasFileNode).file);
    },
    [nodes, onOpenFile],
  );

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const n = nodes.find((x) => x.id === editingId);
    if (n?.type === "text") updateNode(editingId, { text: editText });
    if (n?.type === "group") updateNode(editingId, { label: editText });
    setEditingId(null);
  }, [editingId, editText, nodes, updateNode]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  /* ── flat file list for selector ── */
  const flatFiles = useMemo(() => {
    const go = (es: any[]): { name: string; path: string }[] => {
      const r: { name: string; path: string }[] = [];
      for (const e of es) {
        if (!e.isDirectory && e.extension === ".md")
          r.push({ name: e.name, path: e.path });
        if (e.children) r.push(...go(e.children));
      }
      return r;
    };
    return go(fileTree);
  }, [fileTree]);

  /* ═══ CURSOR ═══ */
  const cursor =
    drag.type === "pan"
      ? "grabbing"
      : drag.type === "node" || drag.type === "scribble-move"
        ? "grabbing"
        : drag.type === "draw" ||
            drag.type === "erase" ||
            drag.type === "lasso" ||
            tool === "draw" ||
            tool === "erase" ||
            tool === "lasso" ||
            tool === "edge"
          ? "crosshair"
          : tool === "pan"
            ? "grab"
            : "default";
  const uiZoomMult = Math.min(1.35, Math.max(0.85, 1 / vp.zoom));
  const renderVp = useMemo(() => {
    const dpr =
      typeof window !== "undefined"
        ? Math.max(1, window.devicePixelRatio || 1)
        : 1;
    const snapToPixel = (value: number) => Math.round(value * dpr) / dpr;
    return {
      x: snapToPixel(vp.x),
      y: snapToPixel(vp.y),
      zoom: vp.zoom,
    };
  }, [vp]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const visibleWorldRect = useMemo(() => {
    const x = -vp.x / vp.zoom - CULLING_PADDING;
    const y = -vp.y / vp.zoom - CULLING_PADDING;
    const width = areaSize.width / vp.zoom + CULLING_PADDING * 2;
    const height = areaSize.height / vp.zoom + CULLING_PADDING * 2;
    return { x, y, width, height };
  }, [vp, areaSize]);

  const visibleNodes = useMemo(
    () =>
      nodes.filter((n) =>
        rectIntersects(
          { x: n.x, y: n.y, width: n.width, height: n.height },
          visibleWorldRect,
        ),
      ),
    [nodes, visibleWorldRect],
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (e) => visibleNodeIds.has(e.fromNode) || visibleNodeIds.has(e.toNode),
      ),
    [edges, visibleNodeIds],
  );

  const markdownPreviewNodeIds = useMemo(() => {
    const selectedIds: string[] = [];
    const selectedSet = new Set<string>();
    const viewportCenterX = visibleWorldRect.x + visibleWorldRect.width / 2;
    const viewportCenterY = visibleWorldRect.y + visibleWorldRect.height / 2;

    visibleNodes.forEach((node) => {
      if (node.type !== "file" || !selNodes.has(node.id)) return;
      const filePath = (node as CanvasFileNode).file || "";
      if (!filePath.toLowerCase().endsWith(".md")) return;
      if (selectedIds.length >= MAX_SELECTED_MD_PREVIEWS) return;
      selectedSet.add(node.id);
      selectedIds.push(node.id);
    });

    if (suspendMarkdownPreviews || vp.zoom < MIN_MD_EMBED_PREVIEW_ZOOM) {
      return selectedSet;
    }

    if (vp.zoom >= FULL_MD_EMBED_PREVIEW_ZOOM) {
      visibleNodes.forEach((node) => {
        if (node.type !== "file") return;
        const filePath = (node as CanvasFileNode).file || "";
        if (!filePath.toLowerCase().endsWith(".md")) return;
        selectedSet.add(node.id);
      });
      return selectedSet;
    }

    const ids = [...selectedIds];
    const candidates = visibleNodes
      .filter((node) => {
        if (node.type !== "file") return false;
        if (selectedSet.has(node.id)) return false;
        const filePath = (node as CanvasFileNode).file || "";
        if (!filePath.toLowerCase().endsWith(".md")) return false;
        const screenWidth = node.width * vp.zoom;
        const screenHeight = node.height * vp.zoom;
        return (
          screenWidth >= MIN_MD_PREVIEW_SCREEN_WIDTH &&
          screenHeight >= MIN_MD_PREVIEW_SCREEN_HEIGHT
        );
      })
      .sort((a, b) => {
        const acx = a.x + a.width / 2;
        const acy = a.y + a.height / 2;
        const bcx = b.x + b.width / 2;
        const bcy = b.y + b.height / 2;
        const ad =
          Math.abs(acx - viewportCenterX) + Math.abs(acy - viewportCenterY);
        const bd =
          Math.abs(bcx - viewportCenterX) + Math.abs(bcy - viewportCenterY);
        return ad - bd;
      });

    candidates.forEach((node) => {
      if (ids.length >= MAX_MD_EMBED_PREVIEWS) return;
      ids.push(node.id);
      selectedSet.add(node.id);
    });

    return selectedSet;
  }, [
    visibleNodes,
    selNodes,
    vp.zoom,
    visibleWorldRect,
    suspendMarkdownPreviews,
  ]);

  const selectedNodesArray = useMemo(
    () => nodes.filter((n) => selNodes.has(n.id)),
    [nodes, selNodes],
  );
  const selectionBounds = useMemo(() => {
    if (selectedNodesArray.length < 2) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    selectedNodesArray.forEach((n) => {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [selectedNodesArray]);

  const minimapWorldBounds = useMemo(() => {
    if (!nodes.length) return { x: -400, y: -300, width: 800, height: 600 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    nodes.forEach((n) => {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    const pad = 200;
    return {
      x: x0 - pad,
      y: y0 - pad,
      width: Math.max(1, x1 - x0 + pad * 2),
      height: Math.max(1, y1 - y0 + pad * 2),
    };
  }, [nodes]);

  /* ── first selected node (for card-menu position) ── */
  const firstSel =
    selNodes.size === 1 ? nodes.find((n) => selNodes.has(n.id)) : null;
  const menuAnchor = firstSel
    ? { x: firstSel.x + firstSel.width / 2, y: firstSel.y }
    : selectionBounds
      ? {
          x: selectionBounds.x + selectionBounds.width / 2,
          y: selectionBounds.y,
        }
      : null;

  /* ═══ RENDER ═══ */
  return (
    <div
      className="cv"
      ref={wrapRef}
      data-dragging={drag.type !== "none"}
      style={{ cursor, "--zoom-mult": uiZoomMult } as any}
    >
      {/* ── Canvas area ── */}
      <div
        ref={areaRef}
        className="cv-area"
        onMouseDown={onAreaDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Dot-pattern background (SVG stays in viewport space) */}
        {grid && (
          <DotGrid zoom={renderVp.zoom} offX={renderVp.x} offY={renderVp.y} />
        )}

        {/* Transform group */}
        <div
          className="cv-transform"
          style={{
            transform: `translate(${renderVp.x}px,${renderVp.y}px) scale(${renderVp.zoom})`,
          }}
        >
          {/* SVG edges */}
          <svg className="cv-edges">
            {visibleEdges.map((ed) => (
              <EdgePath
                key={ed.id}
                edge={ed}
                nodeMap={nodeMap}
                selected={selEdges.has(ed.id)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelNodes(new Set());
                  setSelEdges(new Set([ed.id]));
                  setSelectedScribbleIds(new Set());
                  setLassoPoints([]);
                  lassoPointsRef.current = [];
                }}
              />
            ))}
            {tempEdge && <TempEdgePath from={tempEdge} />}
            {drag.type === "node" &&
              alignLines.x.map((x, i) => (
                <line
                  key={`ax-${i}`}
                  x1={x}
                  y1={-100000}
                  x2={x}
                  y2={100000}
                  stroke="var(--accent-color)"
                  strokeWidth={1 / vp.zoom}
                  strokeDasharray="4 4"
                  opacity={0.6}
                />
              ))}
            {drag.type === "node" &&
              alignLines.y.map((y, i) => (
                <line
                  key={`ay-${i}`}
                  x1={-100000}
                  y1={y}
                  x2={100000}
                  y2={y}
                  stroke="var(--accent-color)"
                  strokeWidth={1 / vp.zoom}
                  strokeDasharray="4 4"
                  opacity={0.6}
                />
              ))}
          </svg>

          <svg className="cv-scribbles">
            {scribbles.map((stroke) => {
              const d = pointsToStrokePath(stroke.points);
              if (!d) return null;
              const selected = selectedScribbleIds.has(stroke.id);
              return (
                <path
                  key={stroke.id}
                  d={d}
                  fill="none"
                  stroke={
                    selected
                      ? "var(--cv-sel)"
                      : stroke.color || "var(--cv-scribble)"
                  }
                  strokeWidth={stroke.width + (selected ? 1.15 : 0)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={selected ? 1 : 0.92}
                />
              );
            })}
            {activeScribble ? (
              <path
                d={pointsToStrokePath(activeScribble.points)}
                fill="none"
                stroke={activeScribble.color || "var(--cv-scribble)"}
                strokeWidth={activeScribble.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.92}
              />
            ) : null}
          </svg>

          {lassoPoints.length > 1 ? (
            <svg className="cv-lasso-overlay">
              {lassoPoints.length > 2 ? (
                <polygon
                  points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="color-mix(in srgb, var(--cv-sel) 10%, transparent)"
                  stroke="var(--cv-sel)"
                  strokeWidth={1.2}
                  strokeDasharray="6 4"
                  opacity={0.95}
                />
              ) : null}
              <polyline
                points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--cv-sel)"
                strokeWidth={1.2}
                strokeDasharray="6 4"
                opacity={0.95}
              />
            </svg>
          ) : null}

          {/* Selection rect */}
          {selBox && (
            <div
              className="cv-sel-box"
              style={{
                left: selBox.x,
                top: selBox.y,
                width: selBox.w,
                height: selBox.h,
              }}
            />
          )}

          {/* Multi-selection transform box */}
          {selectionBounds && (
            <div
              className="cv-multi-box"
              style={{
                left: selectionBounds.x,
                top: selectionBounds.y,
                width: selectionBounds.width,
                height: selectionBounds.height,
              }}
            >
              {["nw", "ne", "sw", "se"].map((handle) => (
                <div
                  key={handle}
                  className={`cv-resize cv-resize-${handle}`}
                  onMouseDown={(e) => onSelectionResizeDown(e, handle)}
                  style={{ "--zm": uiZoomMult } as any}
                />
              ))}
            </div>
          )}

          {/* Nodes */}
          {visibleNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              selected={selNodes.has(n.id)}
              editing={editingId === n.id}
              editText={editText}
              zoomMult={uiZoomMult}
              enableMarkdownPreview={markdownPreviewNodeIds.has(n.id)}
              vaultPath={vaultPath}
              onMouseDown={(e) => onNodeDown(e, n.id)}
              onDoubleClick={() => startEdit(n.id)}
              onPortDown={(side, e) => onPortDown(e, n.id, side)}
              onResizeDown={(handle, e) => onResizeDown(e, n.id, handle)}
              onEditChange={setEditText}
              onEditBlur={commitEdit}
              onEditKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setEditingId(null);
                }
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") commitEdit();
              }}
            />
          ))}
        </div>
      </div>

      {/* Save state */}
      {canvasFilePath && (
        <div className={`cv-save-pill cv-save-${saveState}`}>
          {saveState === "saving"
            ? "Saving..."
            : saveState === "unsaved"
              ? "Unsaved"
              : saveState === "error"
                ? "Save failed"
                : "Saved"}
          {lastSavedAt && saveState === "saved" ? (
            <span> {new Date(lastSavedAt).toLocaleTimeString()}</span>
          ) : null}
        </div>
      )}

      {/* Diagnostics panel */}
      {showDiagnostics && diagnostics && (
        <div className="cv-diagnostics">
          <div className="cv-diagnostics-title">
            Canvas import diagnostics
            {recoveryUsed ? (
              <span className="cv-diagnostics-badge">
                Recovered from snapshot
              </span>
            ) : null}
          </div>
          {diagnostics.parseError ? (
            <div className="cv-diagnostics-line">
              Parse error: {diagnostics.parseError}
            </div>
          ) : null}
          {diagnostics.errors.slice(0, 3).map((msg, index) => (
            <div key={`err-${index}`} className="cv-diagnostics-line">
              {msg}
            </div>
          ))}
          {diagnostics.warnings.slice(0, 3).map((msg, index) => (
            <div key={`warn-${index}`} className="cv-diagnostics-line">
              {msg}
            </div>
          ))}
          <div className="cv-diagnostics-actions">
            <button
              className="cv-link-go"
              onClick={() => {
                void repairAndSave();
              }}
            >
              Repair & Save
            </button>
            {canvasFilePath ? (
              <button
                className="cv-file-row"
                onClick={() => {
                  void restoreFromRecovery();
                }}
              >
                Restore Snapshot
              </button>
            ) : null}
            <button
              className="cv-file-row"
              onClick={() => setShowDiagnostics(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ══ Card-menu (above selected node) ══ */}
      {menuAnchor && !editingId && (
        <div
          className="cv-card-menu"
          style={{
            left: renderVp.x + menuAnchor.x * renderVp.zoom,
            top: renderVp.y + menuAnchor.y * renderVp.zoom - 8,
          }}
        >
          {firstSel && (
            <button
              className="cv-card-btn"
              title="Color"
              onClick={() =>
                setColorPickerFor(
                  colorPickerFor === firstSel.id ? null : firstSel.id,
                )
              }
            >
              <Palette size={14} />
            </button>
          )}
          {firstSel && (
            <button
              className="cv-card-btn"
              title="Duplicate"
              onClick={() => duplicateNode(firstSel.id)}
            >
              <Copy size={14} />
            </button>
          )}
          <button
            className="cv-card-btn"
            title="Lock or unlock"
            onClick={toggleLockSelected}
          >
            {selectedNodesArray.length > 0 &&
            selectedNodesArray.every((n) => n.locked) ? (
              <Unlock size={14} />
            ) : (
              <Lock size={14} />
            )}
          </button>
          <button
            className="cv-card-btn"
            title="Bring to front"
            onClick={bringToFront}
          >
            <span className="cv-card-short">F</span>
          </button>
          <button
            className="cv-card-btn"
            title="Send to back"
            onClick={sendToBack}
          >
            <span className="cv-card-short">B</span>
          </button>

          {selNodes.size > 1 && (
            <>
              <div className="cv-card-menu-div" />
              <button
                className="cv-card-btn"
                title="Align left"
                onClick={() => alignSelected("left")}
              >
                <span className="cv-card-short">L</span>
              </button>
              <button
                className="cv-card-btn"
                title="Align top"
                onClick={() => alignSelected("top")}
              >
                <span className="cv-card-short">T</span>
              </button>
              <button
                className="cv-card-btn"
                title="Center horizontally"
                onClick={() => alignSelected("hcenter")}
              >
                <span className="cv-card-short">CH</span>
              </button>
              <button
                className="cv-card-btn"
                title="Center vertically"
                onClick={() => alignSelected("vcenter")}
              >
                <span className="cv-card-short">CV</span>
              </button>
              <button
                className="cv-card-btn"
                title="Distribute horizontal"
                onClick={() => distributeSelected("x")}
              >
                <span className="cv-card-short">DX</span>
              </button>
              <button
                className="cv-card-btn"
                title="Distribute vertical"
                onClick={() => distributeSelected("y")}
              >
                <span className="cv-card-short">DY</span>
              </button>
            </>
          )}

          <div className="cv-card-menu-div" />
          <button
            className="cv-card-btn cv-card-btn-del"
            title="Delete"
            onClick={deleteSelected}
          >
            <Trash2 size={14} />
          </button>
          {firstSel && colorPickerFor === firstSel.id && (
            <div className="cv-color-row">
              <button
                className="cv-swatch cv-swatch-none"
                onClick={() => {
                  updateNode(firstSel.id, { color: undefined });
                  setColorPickerFor(null);
                }}
              />
              {Object.entries(CANVAS_PRESET_COLORS).map(([k, hex]) => (
                <button
                  key={k}
                  className={`cv-swatch${firstSel.color === k ? " on" : ""}`}
                  style={{ background: hex }}
                  onClick={() => {
                    updateNode(firstSel.id, { color: k });
                    setColorPickerFor(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Right-side controls (Obsidian-style) ══ */}
      <div className="cv-controls">
        {(onNewCanvas ||
          onDuplicateCanvas ||
          onSaveCanvasAs ||
          (recentCanvasFiles && recentCanvasFiles.length > 0)) && (
          <div className="cv-ctrl-group cv-canvas-actions" ref={recentMenuRef}>
            {onNewCanvas && (
              <button
                className="cv-ctrl"
                title="New canvas file"
                onClick={onNewCanvas}
              >
                <Plus size={15} />
              </button>
            )}
            {onDuplicateCanvas && (
              <button
                className="cv-ctrl"
                title="Duplicate this canvas"
                onClick={onDuplicateCanvas}
              >
                <Copy size={15} />
              </button>
            )}
            {onSaveCanvasAs && (
              <button
                className="cv-ctrl"
                title="Save canvas as"
                onClick={onSaveCanvasAs}
              >
                <ArrowUpRight size={15} />
              </button>
            )}
            {onOpenRecentCanvas && (
              <button
                className="cv-ctrl"
                title="Open recent canvas"
                onClick={() => setShowRecentCanvasMenu((v) => !v)}
                disabled={!recentCanvasFiles?.length}
              >
                <FileText size={15} />
              </button>
            )}

            {showRecentCanvasMenu && !!recentCanvasFiles?.length && (
              <div className="cv-recent-menu">
                <div className="cv-recent-title">Recent canvases</div>
                {recentCanvasFiles.slice(0, 8).map((path) => (
                  <button
                    key={path}
                    className="cv-recent-item"
                    onClick={() => {
                      onOpenRecentCanvas?.(path);
                      setShowRecentCanvasMenu(false);
                    }}
                    title={path}
                  >
                    {path.split("/").pop() || path}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="cv-ctrl-group">
          <button
            className="cv-ctrl"
            title="Add text card"
            onClick={() => addNode("text")}
          >
            <Type size={16} />
          </button>
        </div>
        <div className="cv-ctrl-group">
          <button
            className={`cv-ctrl${tool === "draw" ? " on" : ""}`}
            title="Draw scribble (D)"
            onClick={() => {
              setTool((prev) => (prev === "draw" ? "select" : "draw"));
              revealDrawControls();
            }}
          >
            <PenLine size={15} />
          </button>
          <button
            className={`cv-ctrl${tool === "erase" ? " on" : ""}`}
            title="Eraser (E)"
            onClick={() => {
              setTool((prev) => (prev === "erase" ? "select" : "erase"));
              revealDrawControls();
            }}
          >
            <Eraser size={15} />
          </button>
          <button
            className={`cv-ctrl${tool === "lasso" ? " on" : ""}`}
            title="Lasso select + move scribbles (L)"
            onClick={() => {
              setTool((prev) => (prev === "lasso" ? "select" : "lasso"));
              revealDrawControls();
            }}
          >
            <Lasso size={15} />
          </button>
        </div>
        {shouldRenderDrawControls && (
          <div
            ref={drawPanelRef}
            className={`cv-ctrl-group cv-draw-panel-wrap${drawPanelExpanded ? "" : " collapsed"}`}
            onMouseEnter={() => {
              if (drawPanelCollapsed) setDrawPanelHoverOpen(true);
            }}
            onMouseLeave={() => setDrawPanelHoverOpen(false)}
          >
            <button
              className={`cv-ctrl cv-draw-mini${drawPanelExpanded ? " on" : ""}`}
              title={drawPanelExpanded ? "Collapse drawing controls" : "Drawing controls"}
              onClick={() => {
                if (!autoHideDrawingControls) return;
                if (drawPanelExpanded) {
                  setDrawPanelPinnedOpen(false);
                  setDrawPanelCollapsed(true);
                  setDrawPanelHoverOpen(false);
                } else {
                  setDrawPanelCollapsed(false);
                  setDrawPanelPinnedOpen(true);
                }
              }}
            >
              <PenLine size={14} />
            </button>

            <div className={`cv-ctrl-group cv-draw-panel${drawPanelExpanded ? " open" : ""}`}>
              <div className="cv-draw-swatches">
                {[
                  "",
                  "#f9fafb",
                  "#f97316",
                  "#38bdf8",
                  "#22c55e",
                  "#f43f5e",
                  "#a78bfa",
                ].map((color) => (
                  <button
                    key={color || "default"}
                    className={`cv-swatch cv-draw-swatch${(scribbleColor || "") === color ? " on" : ""}${!color ? " cv-swatch-none" : ""}`}
                    style={color ? { background: color } : undefined}
                    title={color ? `Stroke ${color}` : "Default stroke color"}
                    onClick={() => setScribbleColor(color)}
                  />
                ))}
              </div>
              <label className="cv-draw-size">
                <span>{scribbleWidth.toFixed(1)}px</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.2}
                  value={scribbleWidth}
                  onChange={(e) => setScribbleWidth(Number(e.target.value))}
                />
              </label>
              {selectedScribbleIds.size > 0 ? (
                <button
                  className="cv-file-row cv-draw-delete"
                  onClick={deleteSelected}
                >
                  Delete selected strokes
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div className="cv-ctrl-group">
          <button className="cv-ctrl" title="Zoom in" onClick={() => zoomBy(1)}>
            <Plus size={16} />
          </button>
          <button
            className="cv-ctrl cv-ctrl-label"
            title="Reset zoom"
            onClick={() => setViewportImmediate((p) => ({ ...p, zoom: 1 }))}
          >
            {Math.round(vp.zoom * 100)}%
          </button>
          <button
            className="cv-ctrl"
            title="Zoom out"
            onClick={() => zoomBy(-1)}
          >
            <Minus size={16} />
          </button>
          <button className="cv-ctrl" title="Zoom to fit" onClick={zoomFit}>
            <Maximize size={15} />
          </button>
        </div>
        <div className="cv-ctrl-group">
          <button
            className={`cv-ctrl${grid ? " on" : ""}`}
            title="Toggle grid"
            onClick={() => setGrid(!grid)}
          >
            <Grid3X3 size={15} />
          </button>
        </div>
        <div className="cv-ctrl-group">
          <button
            className="cv-ctrl cv-history-btn"
            title="Undo"
            onClick={undo}
            disabled={histIdx <= 0}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="cv-ctrl cv-history-btn"
            title="Redo"
            onClick={redo}
            disabled={histIdx >= hist.length - 1}
          >
            <RotateCw size={15} />
          </button>
        </div>
      </div>

      <CanvasMiniMap
        nodes={nodes}
        world={minimapWorldBounds}
        viewport={visibleWorldRect}
        onNavigate={(x, y) => {
          setViewportImmediate((prev) => ({
            ...prev,
            x: areaSize.width / 2 - x * prev.zoom,
            y: areaSize.height / 2 - y * prev.zoom,
          }));
        }}
      />

      {/* ══ Bottom toolbar (add row) ══ */}
      <div className="cv-add-bar">
        <button
          className="cv-add-btn"
          onClick={() => addNode("text")}
          title="New text card"
        >
          <FileText size={18} />
        </button>
        <button
          className="cv-add-btn"
          onClick={() => setFileModal(true)}
          title="Embed note"
        >
          <FileText size={18} />
          <span className="cv-add-badge">+</span>
        </button>
        <button
          className="cv-add-btn"
          onClick={() => setLinkModal(true)}
          title="Add web link"
        >
          <Globe size={18} />
        </button>
        <button
          className="cv-add-btn"
          onClick={() => addNode("group")}
          title="Add group"
        >
          <SquareDashed size={18} />
        </button>
      </div>

      {/* ══ Close / fullscreen chip ══ */}
      <button className="cv-close" onClick={onClose} title="Close canvas">
        <X size={16} />
      </button>

      {/* ══ File modal ══ */}
      {fileModal && (
        <div className="cv-overlay" onClick={() => setFileModal(false)}>
          <div className="cv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-head">
              <span>Select a note</span>
              <button onClick={() => setFileModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="cv-modal-body">
              {flatFiles.length === 0 ? (
                <p className="cv-modal-empty">No notes found</p>
              ) : (
                flatFiles.map((f, i) => (
                  <button
                    key={i}
                    className="cv-file-row"
                    onClick={() => {
                      addNode("file", { file: f.path });
                      setFileModal(false);
                    }}
                  >
                    <FileText size={14} />
                    {f.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* ══ Link modal ══ */}
      {linkModal && (
        <div className="cv-overlay" onClick={() => setLinkModal(false)}>
          <div
            className="cv-modal cv-modal-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cv-modal-head">
              <span>Add link</span>
              <button onClick={() => setLinkModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="cv-modal-body">
              <input
                ref={linkRef}
                className="cv-link-input"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    let u = linkUrl.trim();
                    if (u && !u.startsWith("http")) u = "https://" + u;
                    if (u) addNode("link", { url: u });
                    setLinkModal(false);
                    setLinkUrl("");
                  }
                  if (e.key === "Escape") setLinkModal(false);
                }}
                autoFocus
              />
              <button
                className="cv-link-go"
                onClick={() => {
                  let u = linkUrl.trim();
                  if (u && !u.startsWith("http")) u = "https://" + u;
                  if (u) addNode("link", { url: u });
                  setLinkModal(false);
                  setLinkUrl("");
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS (inline for fewer files)
   ═══════════════════════════════════════════════════════════ */

/* ── Dot grid ── */
function DotGrid({
  zoom,
  offX,
  offY,
}: {
  zoom: number;
  offX: number;
  offY: number;
}) {
  const gap = GRID_SIZE * zoom;
  const dotRadius = Math.max(0.1, Math.min(0.5, 0.5 * zoom));
  const dotOpacity = Math.max(0, Math.min(0.72, (gap - 1.8) / 5.8));
  if (dotOpacity <= 0.01) return null;
  const ox = ((offX % gap) + gap) % gap;
  const oy = ((offY % gap) + gap) % gap;
  return (
    <svg className="cv-dots">
      <defs>
        <pattern
          id="cvDot"
          width={gap}
          height={gap}
          patternUnits="userSpaceOnUse"
          x={ox}
          y={oy}
        >
          <circle
            cx={gap / 2}
            cy={gap / 2}
            r={dotRadius}
            fill="var(--cv-dot)"
            opacity={dotOpacity}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cvDot)" />
    </svg>
  );
}

/* ── Edge (bezier) ── */
function EdgePath({
  edge,
  nodeMap,
  selected,
  onClick,
}: {
  edge: CanvasEdge;
  nodeMap: Map<string, CanvasNode>;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const a = nodeMap.get(edge.fromNode);
  const b = nodeMap.get(edge.toNode);
  if (!a || !b) return null;
  const [fs0, ts0] = bestSides(a, b);
  const fs = edge.fromSide || fs0,
    ts = edge.toSide || ts0;
  const p1 = portXY(a, fs),
    p2 = portXY(b, ts);
  const dist = Math.max(80, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.45);
  const c1 = cpOffset(fs, dist),
    c2 = cpOffset(ts, dist);
  const d = `M${p1.x},${p1.y} C${p1.x + c1.dx},${p1.y + c1.dy} ${p2.x + c2.dx},${p2.y + c2.dy} ${p2.x},${p2.y}`;
  const color = resolveCanvasColor(edge.color) || "var(--cv-edge)";
  const endAngle =
    (Math.atan2(p2.y - (p2.y + c2.dy), p2.x - (p2.x + c2.dx)) * 180) / Math.PI;
  return (
    <g className={`cv-edge${selected ? " sel" : ""}`}>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
        onClick={onClick}
      />
      <path
        d={d}
        className="cv-edge-display"
        stroke={color}
        strokeWidth={selected ? 2.5 : 2}
        fill="none"
      />
      {edge.toEnd !== "none" && (
        <polygon
          points="-7,-4.5 0,0 -7,4.5"
          fill={color}
          transform={`translate(${p2.x},${p2.y}) rotate(${endAngle})`}
        />
      )}
      {edge.label && (
        <text
          x={(p1.x + p2.x) / 2}
          y={(p1.y + p2.y) / 2 - 8}
          textAnchor="middle"
          className="cv-edge-label"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

function TempEdgePath({
  from,
}: {
  from: { fx: number; fy: number; tx: number; ty: number };
}) {
  const dx = from.tx - from.fx,
    dy = from.ty - from.fy;
  const off = Math.max(80, Math.hypot(dx, dy) * 0.45);
  const d = `M${from.fx},${from.fy} C${from.fx + (dx > 0 ? off : -off)},${from.fy} ${from.tx + (dx > 0 ? -off : off)},${from.ty} ${from.tx},${from.ty}`;
  return (
    <g className="cv-edge temp">
      <path
        d={d}
        fill="none"
        stroke="var(--accent-color)"
        strokeWidth={2}
        strokeDasharray="6 3"
        opacity={0.7}
      />
      <circle cx={from.tx} cy={from.ty} r={4} fill="var(--accent-color)" />
    </g>
  );
}

function CanvasMiniMap({
  nodes,
  world,
  viewport,
  onNavigate,
}: {
  nodes: CanvasNode[];
  world: { x: number; y: number; width: number; height: number };
  viewport: { x: number; y: number; width: number; height: number };
  onNavigate: (x: number, y: number) => void;
}) {
  const w = 180;
  const h = 130;
  const sx = w / Math.max(1, world.width);
  const sy = h / Math.max(1, world.height);

  const toMini = (x: number, y: number) => ({
    x: (x - world.x) * sx,
    y: (y - world.y) * sy,
  });

  const onMiniDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = world.x + (px / w) * world.width;
    const worldY = world.y + (py / h) * world.height;
    onNavigate(worldX, worldY);
  };

  const viewportMini = {
    x: (viewport.x - world.x) * sx,
    y: (viewport.y - world.y) * sy,
    width: viewport.width * sx,
    height: viewport.height * sy,
  };

  return (
    <div className="cv-minimap-wrap">
      <svg className="cv-minimap" width={w} height={h} onMouseDown={onMiniDown}>
        <rect x={0} y={0} width={w} height={h} className="cv-minimap-bg" />
        {nodes.map((node) => {
          const p = toMini(node.x, node.y);
          return (
            <rect
              key={node.id}
              x={p.x}
              y={p.y}
              width={Math.max(1.5, node.width * sx)}
              height={Math.max(1.5, node.height * sy)}
              className={`cv-minimap-node${node.locked ? " locked" : ""}`}
            />
          );
        })}
        <rect
          x={viewportMini.x}
          y={viewportMini.y}
          width={Math.max(8, viewportMini.width)}
          height={Math.max(8, viewportMini.height)}
          className="cv-minimap-viewport"
        />
      </svg>
    </div>
  );
}

function EmbeddedFileNode({
  node,
  vaultPath,
  enableMarkdownPreview,
}: {
  node: CanvasFileNode;
  vaultPath: string;
  enableMarkdownPreview: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(node.file);
  const isMarkdown = node.file.toLowerCase().endsWith(".md");

  useEffect(() => {
    let mounted = true;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    if (!isMarkdown || !enableMarkdownPreview) {
      return () => {
        mounted = false;
      };
    }

    const cached = embeddedMarkdownCache.get(node.file);
    if (typeof cached === "string") {
      setContent(cached);
    }

    const refreshContent = () => {
      getAPI()
        .readFile(node.file)
        .then((c) => {
          if (!mounted) return;
          embeddedMarkdownCache.set(node.file, c);
          setContent((prev) => (prev === c ? prev : c));
        })
        .catch((e) => console.error("Failed to load embedded note:", e));
    };

    const onLiveNoteChange = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; content?: string }>)
        .detail;
      if (
        !detail ||
        detail.path !== node.file ||
        typeof detail.content !== "string"
      )
        return;
      const nextContent = detail.content;
      embeddedMarkdownCache.set(node.file, nextContent);
      setContent((prev) => (prev === nextContent ? prev : nextContent));
    };

    window.addEventListener(
      "notework:note-content-changed",
      onLiveNoteChange as EventListener,
    );

    refreshContent();
    refreshTimer = setInterval(refreshContent, MD_PREVIEW_REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
      }
      window.removeEventListener(
        "notework:note-content-changed",
        onLiveNoteChange as EventListener,
      );
    };
  }, [node.file, isMarkdown, enableMarkdownPreview]);

  if (isImage) {
    const imgSrc = `file://${vaultPath}/${node.file}`;
    return (
      <div
        className="cv-node-body cv-embedded-image"
        style={{
          padding: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={imgSrc}
          alt={node.file}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      </div>
    );
  }

  if (isMarkdown && enableMarkdownPreview && content !== null) {
    return (
      <div
        className="cv-node-body cv-embedded-md"
        data-cv-no-drag="true"
        style={{ overflowY: "auto" }}
      >
        <MarkdownPreview content={content} onLinkClick={() => {}} />
      </div>
    );
  }

  if (isMarkdown && !enableMarkdownPreview) {
    return (
      <div className="cv-node-body cv-file-body" data-cv-no-drag="true">
        <span className="cv-file-name">
          {node.file.split("/").pop()?.replace(/\.md$/, "")}
        </span>
      </div>
    );
  }

  return (
    <div className="cv-node-body cv-file-body">
      <span className="cv-file-name">
        {node.file.split("/").pop()?.replace(/\.md$/, "")}
      </span>
    </div>
  );
}

/* ── Node card ── */
interface NodeCardProps {
  node: CanvasNode;
  selected: boolean;
  editing: boolean;
  editText: string;
  zoomMult: number;
  vaultPath: string;
  enableMarkdownPreview: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onPortDown: (side: EdgeSide, e: React.MouseEvent) => void;
  onResizeDown: (handle: string, e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onEditBlur: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
}

function NodeCard({
  node,
  selected,
  editing,
  editText,
  zoomMult,
  vaultPath,
  enableMarkdownPreview,
  onMouseDown,
  onDoubleClick,
  onPortDown,
  onResizeDown,
  onEditChange,
  onEditBlur,
  onEditKeyDown,
}: NodeCardProps) {
  const isGroup = node.type === "group";
  const borderColor = resolveCanvasColor(node.color);

  const style: React.CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(borderColor && !isGroup
      ? ({
          "--node-color": borderColor,
          boxShadow: `0 0 0 1px ${borderColor}, 0 2px 6px rgba(0,0,0,0.1)`,
          border: "none",
          background: "var(--cv-node-bg)",
        } as any)
      : {}),
    ...(borderColor && isGroup
      ? ({
          "--node-color": borderColor,
          "--node-color-subtle": colorWithAlpha(borderColor, 0.1),
          borderColor: colorWithAlpha(borderColor, 0.4),
          background: colorWithAlpha(borderColor, 0.05),
          boxShadow: `0 4px 12px rgba(0,0,0,0.05)`,
        } as any)
      : {}),
  };

  return (
    <div
      className={`cv-node cv-node-${node.type}${selected ? " sel" : ""}${editing ? " editing" : ""}${node.locked ? " locked" : ""}`}
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      data-id={node.id}
    >
      {/* Connection ports (only non-group) */}
      {!isGroup &&
        selected &&
        !node.locked &&
        (["top", "right", "bottom", "left"] as EdgeSide[]).map((s) => (
          <div
            key={s}
            className={`cv-port cv-port-${s}`}
            onMouseDown={(e) => onPortDown(s, e)}
            style={{ "--zm": zoomMult } as any}
          />
        ))}

      {/* Resize handles */}
      {selected &&
        !node.locked &&
        ["nw", "ne", "sw", "se"].map((h) => (
          <div
            key={h}
            className={`cv-resize cv-resize-${h}`}
            onMouseDown={(e) => onResizeDown(h, e)}
            style={{ "--zm": zoomMult } as any}
          />
        ))}

      {node.locked && <div className="cv-lock-badge">Locked</div>}

      {/* Group label */}
      {isGroup &&
        (editing ? (
          <input
            className="cv-group-input"
            autoFocus
            value={editText}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={(e) => {
              onEditKeyDown(e);
              if (e.key === "Enter") onEditBlur();
            }}
            style={{ "--zm": zoomMult } as any}
          />
        ) : (
          <div className="cv-group-label" style={{ "--zm": zoomMult } as any}>
            {(() => {
              const label = (node as CanvasGroupNode).label || "";
              const parts = label.split("\n").filter((p) => p.trim());
              if (!parts.length) return null;
              const title = parts[0].replace(/^#+\s/, "");
              const subtitle = parts.slice(1).join(" ").replace(/^#+\s/g, "");
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{title}</span>
                  {subtitle && (
                    <span
                      style={{
                        fontSize: "0.85em",
                        opacity: 0.8,
                        fontWeight: 400,
                      }}
                    >
                      {subtitle}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        ))}

      {/* Content */}
      {node.type === "text" &&
        (editing ? (
          <textarea
            className="cv-text-edit"
            value={editText}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            autoFocus
          />
        ) : (
          <div className="cv-node-body">
            {(node as CanvasTextNode).text || (
              <span className="cv-placeholder">Double-click to edit…</span>
            )}
          </div>
        ))}

      {node.type === "file" && (
        <EmbeddedFileNode
          node={node as CanvasFileNode}
          vaultPath={vaultPath}
          enableMarkdownPreview={enableMarkdownPreview}
        />
      )}

      {node.type === "link" && (
        <div className="cv-node-body cv-link-body">
          <span className="cv-link-host">
            {(() => {
              try {
                return new URL((node as CanvasLinkNode).url).hostname;
              } catch {
                return (node as CanvasLinkNode).url;
              }
            })()}
          </span>
        </div>
      )}
    </div>
  );
}
