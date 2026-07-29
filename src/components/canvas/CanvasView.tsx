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
  useLayoutEffect,
  useMemo,
} from "react";
import { HexColorPicker } from "react-colorful";
import { createPortal } from "react-dom";
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
  SlidersHorizontal,
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
import { generateId, isDarkTheme } from "../../utils/helpers";
import { getSmartEmbed, getDisplayDomain, cleanEmbedUrl } from "../../utils/urlHelper";
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
const ZOOM_LERP = 0.28;
const PAN_LERP = 0.28;
const PAN_VELOCITY_BLEND = 0.22;
const PAN_VELOCITY_MAX_SAMPLE_MS = 80;
const PAN_INERTIA_DECAY = 0.9;
const PAN_INERTIA_MIN_SPEED = 0.02;
const HISTORY_LIMIT = 60;
const CULLING_PADDING = 320;
const MIN_MD_EMBED_PREVIEW_ZOOM = 1.05;
const FULL_MD_EMBED_PREVIEW_ZOOM = 1.4;
const MAX_SELECTED_MD_PREVIEWS = 2;
const MAX_MD_EMBED_PREVIEWS = 8;
const MIN_MD_PREVIEW_SCREEN_WIDTH = 240;
const MIN_MD_PREVIEW_SCREEN_HEIGHT = 140;
const MD_PREVIEW_RESUME_DELAY_MS = 160;
const MD_PREVIEW_REFRESH_INTERVAL_MS = 1200;
const CANVAS_SCRIBBLES_KEY = "openonyxScribblesV1";
const CANVAS_CUSTOMIZATION_KEY = "openonyxCanvasCustomizationV1";
const CANVAS_VIEWPORT_KEY = "openonyxCanvasViewportV1";
const DEFAULT_SCRIBBLE_WIDTH = 2.4;
const MIN_SCRIBBLE_WIDTH = 0.8;
const MAX_SCRIBBLE_WIDTH = 48;
const DEFAULT_DOT_OPACITY_MULTIPLIER = 1;
const MIN_SCRIBBLE_POINT_DIST = 0.8;
const MIN_LASSO_POINT_DIST = 1.2;
const ERASER_RADIUS_PX = 14;
const EDGE_MIN_WIDTH = 1;
const EDGE_MAX_WIDTH = 14;
const EDGE_DEFAULT_WIDTH = 2;
const EDGE_MIN_STRETCH = 0.1;
const EDGE_MAX_STRETCH = 5;
const EDGE_DEFAULT_STRETCH = 1;

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

interface CanvasCustomizationSettings {
  backgroundColor?: string;
  dotColor?: string;
  dotOpacityMultiplier?: number;
  defaultNodeColor?: string;
  defaultEdgeColor?: string;
  defaultScribbleColor?: string;
  defaultScribbleWidth?: number;
}

interface Props {
  onClose: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  theme: string;
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

function clampEdgeWidth(value?: number) {
  const width =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : EDGE_DEFAULT_WIDTH;
  return Math.max(EDGE_MIN_WIDTH, Math.min(EDGE_MAX_WIDTH, width));
}

function clampEdgeStretch(value?: number) {
  const stretch =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : EDGE_DEFAULT_STRETCH;
  return Math.max(EDGE_MIN_STRETCH, Math.min(EDGE_MAX_STRETCH, stretch));
}

type EdgeStretchHandle = "from" | "to";

interface EdgeGeometry {
  p1: CanvasScribblePoint;
  p2: CanvasScribblePoint;
  cp1: CanvasScribblePoint;
  cp2: CanvasScribblePoint;
  baseDist: number;
  fromStretch: number;
  toStretch: number;
}

function edgeSideStretch(edge: CanvasEdge, side: EdgeStretchHandle) {
  if (side === "from") {
    return clampEdgeStretch(edge.fromStretch ?? edge.stretch);
  }
  return clampEdgeStretch(edge.toStretch ?? edge.stretch);
}

function edgeGeometry(
  edge: CanvasEdge,
  nodeMap: Map<string, CanvasNode>,
): EdgeGeometry | null {
  const a = nodeMap.get(edge.fromNode);
  const b = nodeMap.get(edge.toNode);
  if (!a || !b) return null;

  const [fs0, ts0] = bestSides(a, b);
  const fs = edge.fromSide || fs0;
  const ts = edge.toSide || ts0;
  const p1 = portXY(a, fs);
  const p2 = portXY(b, ts);
  const baseDist = Math.max(80, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.45);
  const defaultFromStretch = edgeSideStretch(edge, "from");
  const defaultToStretch = edgeSideStretch(edge, "to");
  const c1 = cpOffset(fs, baseDist * defaultFromStretch);
  const c2 = cpOffset(ts, baseDist * defaultToStretch);
  const fromDx =
    typeof edge.fromControlDx === "number" && Number.isFinite(edge.fromControlDx)
      ? edge.fromControlDx
      : c1.dx;
  const fromDy =
    typeof edge.fromControlDy === "number" && Number.isFinite(edge.fromControlDy)
      ? edge.fromControlDy
      : c1.dy;
  const toDx =
    typeof edge.toControlDx === "number" && Number.isFinite(edge.toControlDx)
      ? edge.toControlDx
      : c2.dx;
  const toDy =
    typeof edge.toControlDy === "number" && Number.isFinite(edge.toControlDy)
      ? edge.toControlDy
      : c2.dy;
  const cp1 = { x: p1.x + fromDx, y: p1.y + fromDy };
  const cp2 = { x: p2.x + toDx, y: p2.y + toDy };

  return {
    p1,
    p2,
    cp1,
    cp2,
    baseDist,
    fromStretch: Math.hypot(fromDx, fromDy) / baseDist,
    toStretch: Math.hypot(toDx, toDy) / baseDist,
  };
}

function pickStretchHandle(
  point: CanvasScribblePoint,
  geometry: EdgeGeometry,
): EdgeStretchHandle {
  const fromDist = Math.hypot(point.x - geometry.cp1.x, point.y - geometry.cp1.y);
  const toDist = Math.hypot(point.x - geometry.cp2.x, point.y - geometry.cp2.y);
  return fromDist <= toDist ? "from" : "to";
}

function cubicBezierPoint(
  p0: CanvasScribblePoint,
  p1: CanvasScribblePoint,
  p2: CanvasScribblePoint,
  p3: CanvasScribblePoint,
  t: number,
) {
  const it = 1 - t;
  const it2 = it * it;
  const t2 = t * t;
  return {
    x: it2 * it * p0.x + 3 * it2 * t * p1.x + 3 * it * t2 * p2.x + t2 * t * p3.x,
    y: it2 * it * p0.y + 3 * it2 * t * p1.y + 3 * it * t2 * p2.y + t2 * t * p3.y,
  };
}

function edgeMidpoint(
  edge: CanvasEdge,
  nodeMap: Map<string, CanvasNode>,
): { x: number; y: number } | null {
  const geometry = edgeGeometry(edge, nodeMap);
  if (!geometry) return null;

  return cubicBezierPoint(
    geometry.p1,
    geometry.cp1,
    geometry.cp2,
    geometry.p2,
    0.5,
  );
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
        ? Math.max(MIN_SCRIBBLE_WIDTH, Math.min(MAX_SCRIBBLE_WIDTH, widthRaw))
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

function sanitizeColorValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function clampScribbleWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCRIBBLE_WIDTH;
  return Math.max(MIN_SCRIBBLE_WIDTH, Math.min(MAX_SCRIBBLE_WIDTH, value));
}

function clampDotOpacityMultiplier(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOT_OPACITY_MULTIPLIER;
  return Math.max(0, Math.min(1, value));
}

function sanitizeCanvasCustomization(
  value: unknown,
): CanvasCustomizationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const dotOpacityMultiplierRaw = record.dotOpacityMultiplier;
  const defaultScribbleWidthRaw = record.defaultScribbleWidth;

  return {
    backgroundColor: sanitizeColorValue(record.backgroundColor),
    dotColor: sanitizeColorValue(record.dotColor),
    dotOpacityMultiplier:
      typeof dotOpacityMultiplierRaw === "number"
        ? clampDotOpacityMultiplier(dotOpacityMultiplierRaw)
        : DEFAULT_DOT_OPACITY_MULTIPLIER,
    defaultNodeColor: sanitizeColorValue(record.defaultNodeColor),
    defaultEdgeColor: sanitizeColorValue(record.defaultEdgeColor),
    defaultScribbleColor: sanitizeColorValue(record.defaultScribbleColor),
    defaultScribbleWidth:
      typeof defaultScribbleWidthRaw === "number"
        ? clampScribbleWidth(defaultScribbleWidthRaw)
        : DEFAULT_SCRIBBLE_WIDTH,
  };
}

function sanitizeCanvasViewport(value: unknown): CanvasViewport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const xRaw = record.x;
  const yRaw = record.y;
  const zoomRaw = record.zoom;
  if (
    typeof xRaw !== "number" ||
    !Number.isFinite(xRaw) ||
    typeof yRaw !== "number" ||
    !Number.isFinite(yRaw)
  ) {
    return null;
  }
  const zoom =
    typeof zoomRaw === "number" && Number.isFinite(zoomRaw)
      ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRaw))
      : 1;
  return { x: xRaw, y: yRaw, zoom };
}

function compactCanvasCustomization(
  settings: CanvasCustomizationSettings,
): CanvasCustomizationSettings | undefined {
  const compact: CanvasCustomizationSettings = {};

  if (settings.backgroundColor) compact.backgroundColor = settings.backgroundColor;
  if (settings.dotColor) compact.dotColor = settings.dotColor;
  if (
    typeof settings.dotOpacityMultiplier === "number" &&
    Math.abs(settings.dotOpacityMultiplier - DEFAULT_DOT_OPACITY_MULTIPLIER) >
      0.001
  ) {
    compact.dotOpacityMultiplier = clampDotOpacityMultiplier(
      settings.dotOpacityMultiplier,
    );
  }
  if (settings.defaultNodeColor) compact.defaultNodeColor = settings.defaultNodeColor;
  if (settings.defaultEdgeColor) compact.defaultEdgeColor = settings.defaultEdgeColor;
  if (settings.defaultScribbleColor) {
    compact.defaultScribbleColor = settings.defaultScribbleColor;
  }
  if (
    typeof settings.defaultScribbleWidth === "number" &&
    Math.abs(settings.defaultScribbleWidth - DEFAULT_SCRIBBLE_WIDTH) > 0.001
  ) {
    compact.defaultScribbleWidth = clampScribbleWidth(
      settings.defaultScribbleWidth,
    );
  }

  return Object.keys(compact).length ? compact : undefined;
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
    targetPort?: { x: number; y: number; side: EdgeSide } | null;
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
  const [edgeColorPickerFor, setEdgeColorPickerFor] = useState<string | null>(
    null,
  );
  const [edgeWidthPickerFor, setEdgeWidthPickerFor] = useState<string | null>(
    null,
  );
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("");
  const [edgeMenuClickAnchor, setEdgeMenuClickAnchor] = useState<{
    edgeId: string;
    x: number;
    y: number;
    handle: EdgeStretchHandle;
  } | null>(null);
  const [fileModal, setFileModal] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [dropzoneActive, setDropzoneActive] = useState(false);
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
  const [showCustomizationPanel, setShowCustomizationPanel] = useState(false);
  const [canvasBackgroundColor, setCanvasBackgroundColor] =
    useState<string>("");
  const [canvasDotColor, setCanvasDotColor] = useState<string>("");
  const [canvasDotOpacityMultiplier, setCanvasDotOpacityMultiplier] =
    useState<number>(DEFAULT_DOT_OPACITY_MULTIPLIER);
  const [defaultNodeColor, setDefaultNodeColor] = useState<string>("");
  const [defaultEdgeColor, setDefaultEdgeColor] = useState<string>("");

  const canvasCustomizationMeta = useMemo(
    () =>
      compactCanvasCustomization({
        backgroundColor: canvasBackgroundColor || undefined,
        dotColor: canvasDotColor || undefined,
        dotOpacityMultiplier: canvasDotOpacityMultiplier,
        defaultNodeColor: defaultNodeColor || undefined,
        defaultEdgeColor: defaultEdgeColor || undefined,
        defaultScribbleColor: scribbleColor || undefined,
        defaultScribbleWidth: scribbleWidth,
      }),
    [
      canvasBackgroundColor,
      canvasDotColor,
      canvasDotOpacityMultiplier,
      defaultNodeColor,
      defaultEdgeColor,
      scribbleColor,
      scribbleWidth,
    ],
  );

  /* refs */
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes); // always-latest snapshot for move handler
  const edgesRef = useRef(edges);
  const scribblesRef = useRef(scribbles);
  const activeScribbleRef = useRef<CanvasScribbleStroke | null>(null);
  const activeScribblePathRef = useRef<SVGPathElement | null>(null);
  const selectedScribbleIdsRef = useRef<Set<string>>(new Set());
  const lassoPointsRef = useRef<CanvasScribblePoint[]>([]);
  const scribbleMoveOriginRef = useRef<Record<string, CanvasScribblePoint[]>>(
    {},
  );
  const scribbleMoveChangedRef = useRef(false);
  const edgeStretchChangedRef = useRef(false);
  const eraseChangedRef = useRef(false);
  const vpRef = useRef<CanvasViewport>(vp);
  const targetVpRef = useRef<CanvasViewport>(vp);
  const directViewportFrameRef = useRef<number | null>(null);
  const panInertiaFrameRef = useRef<number | null>(null);
  const transformElRef = useRef<HTMLDivElement>(null);
  const vpSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vpSettledSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastCullVpRef = useRef<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const panVelocityRef = useRef({ x: 0, y: 0 });
  const panSampleRef = useRef<{ x: number; y: number; at: number } | null>(
    null,
  );
  const previewResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef<{ path: string; payload: string } | null>(null);
  const loadingCanvasRef = useRef(false);
  const pendingInitialZoomFitRef = useRef(false);
  const lastSavedPayloadRef = useRef("");
  const [suspendMarkdownPreviews, setSuspendMarkdownPreviews] = useState(false);
  const suspendMarkdownPreviewsRef = useRef(false);
  const [canvasLoadTick, setCanvasLoadTick] = useState(0);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  scribblesRef.current = scribbles;
  activeScribbleRef.current = activeScribble;
  selectedScribbleIdsRef.current = selectedScribbleIds;
  lassoPointsRef.current = lassoPoints;
  suspendMarkdownPreviewsRef.current = suspendMarkdownPreviews;

  /* ── history ── */
  const [hist, setHist] = useState<Snap[]>([
    { nodes: [], edges: [], scribbles: [] },
  ]);
  const [histIdx, setHistIdx] = useState(0);
  const [fileExists, setFileExists] = useState<boolean>(true);

  /* ── Theme-aware scribble color migration ── */
  useEffect(() => {
    const isDark = isDarkTheme(theme);
    const isLight = !isDark;

    if (scribbles.length > 0) {
      let changed = false;
      const migrated = scribbles.map((stroke) => {
        if (!stroke.color) return stroke;

        const c = stroke.color.toLowerCase();
        // If we are in light theme, and the scribble is white-ish, make it dark-ish
        if (isLight) {
          if (c === "#ffffff" || c === "#f9fafb" || c === "#fcfbf9" || c === "white") {
            changed = true;
            return { ...stroke, color: "#111827" }; // Dark navy/black
          }
        } else if (isDark) {
          // If we are in dark theme, and the scribble is dark-ish, make it white-ish
          if (c === "#000000" || c === "#111827" || c === "#1a1a1a" || c === "black") {
            changed = true;
            return { ...stroke, color: "#f9fafb" }; // Off-white
          }
        }
        return stroke;
      });

      if (changed) {
        setScribbles(migrated);
        scribblesRef.current = migrated;
      }
    }

    // Also migrate the active tool color if it's an extreme one
    if (scribbleColor) {
      const c = scribbleColor.toLowerCase();
      if (isLight && (c === "#ffffff" || c === "#f9fafb" || c === "#fcfbf9" || c === "white")) {
        setScribbleColor("#111827");
      } else if (isDark && (c === "#000000" || c === "#111827" || c === "#1a1a1a" || c === "black")) {
        setScribbleColor("#f9fafb");
      }
    }
  }, [theme]);

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
    if (directViewportFrameRef.current !== null) {
      cancelAnimationFrame(directViewportFrameRef.current);
      directViewportFrameRef.current = null;
    }
    if (vpSettledSyncTimerRef.current !== null) {
      clearTimeout(vpSettledSyncTimerRef.current);
      vpSettledSyncTimerRef.current = null;
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

  /* ── Direct DOM viewport application (bypasses React for 60fps) ── */
  const applyViewportToDOM = useCallback((viewport: CanvasViewport) => {
    vpRef.current = viewport;
    const z = viewport.zoom;
    const invZ = 1 / z;

    // Set transform on the canvas layer
    const el = transformElRef.current;
    if (el) {
      el.style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${z})`;
      el.style.setProperty('--ctz', String(Math.min(3, Math.max(1, 1 + (invZ - 1) * 0.28))));
    }

    // Set zoom-dependent CSS custom properties on the wrapper
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.style.setProperty('--zoom-mult', String(Math.min(1.35, Math.max(0.85, invZ))));
      wrap.style.setProperty('--group-label-zoom-mult', String(Math.min(14, Math.max(1, invZ))));
    }

    // Update dot grid pattern directly via DOM
    const pattern = document.getElementById("cvDot");
    if (pattern) {
      let mult = 1;
      if (z < 0.15) mult = 8;
      else if (z < 0.35) mult = 4;
      else if (z < 0.7) mult = 2;
      const gap = GRID_SIZE * mult * z;
      const ox = viewport.x - gap / 2;
      const oy = viewport.y - gap / 2;
      pattern.setAttribute("x", String(ox));
      pattern.setAttribute("y", String(oy));
      pattern.setAttribute("width", String(gap));
      pattern.setAttribute("height", String(gap));
      const circle = pattern.firstElementChild;
      if (circle) {
        circle.setAttribute("cx", String(gap / 2));
        circle.setAttribute("cy", String(gap / 2));
        const r = Math.max(0.55, Math.min(0.85, 0.65 * Math.sqrt(z)));
        circle.setAttribute("r", String(r));
        const baseOp = Math.max(0, Math.min(0.12, (gap - 6) / 20));
        circle.setAttribute("opacity", String(baseOp));
      }
    }
  }, []);

  const scheduleVpSync = useCallback(() => {
    if (vpSyncTimerRef.current !== null) return;
    vpSyncTimerRef.current = setTimeout(() => {
      vpSyncTimerRef.current = null;
      const cur = vpRef.current;
      const last = lastCullVpRef.current;
      const dx = Math.abs(cur.x - last.x);
      const dy = Math.abs(cur.y - last.y);
      const dz = Math.abs(cur.zoom - last.zoom);
      if (dx > 40 || dy > 40 || dz > 0.03) {
        lastCullVpRef.current = { ...cur };
        setVp({ ...cur });
      }
    }, 100);
  }, []);

  const flushVpSync = useCallback(() => {
    if (vpSyncTimerRef.current !== null) {
      clearTimeout(vpSyncTimerRef.current);
      vpSyncTimerRef.current = null;
    }
    if (vpSettledSyncTimerRef.current !== null) {
      clearTimeout(vpSettledSyncTimerRef.current);
      vpSettledSyncTimerRef.current = null;
    }
    const cur = vpRef.current;
    lastCullVpRef.current = { ...cur };
    setVp({ ...cur });
  }, []);

  const scheduleSettledVpSync = useCallback(
    (delayMs = 140) => {
      if (vpSettledSyncTimerRef.current !== null) {
        clearTimeout(vpSettledSyncTimerRef.current);
      }
      vpSettledSyncTimerRef.current = setTimeout(() => {
        vpSettledSyncTimerRef.current = null;
        flushVpSync();
      }, delayMs);
    },
    [flushVpSync],
  );

  const applyViewportDirect = useCallback(
    (next: CanvasViewport, syncDelayMs = 140) => {
      targetVpRef.current = next;

      if (directViewportFrameRef.current === null) {
        const animate = () => {
          const current = vpRef.current;
          const target = targetVpRef.current;
          const zoomDiff = Math.abs(target.zoom - current.zoom);
          const xDiff = Math.abs(target.x - current.x);
          const yDiff = Math.abs(target.y - current.y);

          if (zoomDiff <= 0.001 && xDiff <= 0.5 && yDiff <= 0.5) {
            applyViewportToDOM(target);
            directViewportFrameRef.current = null;
            return;
          }

          applyViewportToDOM({
            x: current.x + (target.x - current.x) * PAN_LERP,
            y: current.y + (target.y - current.y) * PAN_LERP,
            zoom: current.zoom + (target.zoom - current.zoom) * ZOOM_LERP,
          });
          directViewportFrameRef.current = requestAnimationFrame(animate);
        };

        directViewportFrameRef.current = requestAnimationFrame(animate);
      }

      scheduleSettledVpSync(syncDelayMs);
    },
    [applyViewportToDOM, scheduleSettledVpSync],
  );

  const setViewportImmediate = useCallback(
    (nextVp: React.SetStateAction<CanvasViewport>) => {
      stopSmoothZoom();
      stopPanInertia();
      const next =
        typeof nextVp === "function"
          ? (nextVp as (current: CanvasViewport) => CanvasViewport)(vpRef.current)
          : nextVp;
      vpRef.current = next;
      targetVpRef.current = next;
      applyViewportToDOM(next);
      lastCullVpRef.current = { ...next };
      setVp({ ...next });
    },
    [stopSmoothZoom, stopPanInertia, applyViewportToDOM],
  );

  const startPanInertia = useCallback(() => {
    if (panInertiaFrameRef.current !== null) return;

    const speed = Math.hypot(
      panVelocityRef.current.x,
      panVelocityRef.current.y,
    );
    if (speed < PAN_INERTIA_MIN_SPEED) {
      panVelocityRef.current = { x: 0, y: 0 };
      panSampleRef.current = null;
      flushVpSync();
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
        flushVpSync();
        return;
      }

      const prev = vpRef.current;
      const next = {
        ...prev,
        x: prev.x + nextV.x * dt,
        y: prev.y + nextV.y * dt,
      };
      targetVpRef.current = next;
      applyViewportToDOM(next);
      scheduleVpSync();

      panInertiaFrameRef.current = requestAnimationFrame(step);
    };

    panInertiaFrameRef.current = requestAnimationFrame(step);
  }, [stopSmoothZoom, applyViewportToDOM, scheduleVpSync, flushVpSync]);

  useEffect(
    () => () => {
      stopSmoothZoom();
      stopPanInertia();
      if (vpSyncTimerRef.current !== null) {
        clearTimeout(vpSyncTimerRef.current);
        vpSyncTimerRef.current = null;
      }
      if (vpSettledSyncTimerRef.current !== null) {
        clearTimeout(vpSettledSyncTimerRef.current);
        vpSettledSyncTimerRef.current = null;
      }
      if (directViewportFrameRef.current !== null) {
        cancelAnimationFrame(directViewportFrameRef.current);
        directViewportFrameRef.current = null;
      }
    },
    [stopSmoothZoom, stopPanInertia],
  );

  const delayMarkdownPreviews = useCallback(() => {
    if (!suspendMarkdownPreviewsRef.current) {
      suspendMarkdownPreviewsRef.current = true;
      setSuspendMarkdownPreviews(true);
    }
    if (previewResumeTimerRef.current !== null) {
      clearTimeout(previewResumeTimerRef.current);
    }
    previewResumeTimerRef.current = setTimeout(() => {
      suspendMarkdownPreviewsRef.current = false;
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

  const buildCanvasMetadata = useCallback(
    (
      baseMeta: Record<string, unknown>,
      nextScribbles: CanvasScribbleStroke[],
      customizationOverride?: CanvasCustomizationSettings,
      viewportOverride?: CanvasViewport,
    ) => {
      const metadata: Record<string, unknown> = {
        ...baseMeta,
        [CANVAS_SCRIBBLES_KEY]: nextScribbles,
      };
      const customization =
        compactCanvasCustomization(
          customizationOverride ?? canvasCustomizationMeta ?? {},
        );
      if (customization) {
        metadata[CANVAS_CUSTOMIZATION_KEY] = customization;
      } else {
        delete metadata[CANVAS_CUSTOMIZATION_KEY];
      }
      const viewport = viewportOverride ?? vpRef.current;
      metadata[CANVAS_VIEWPORT_KEY] = {
        x: Number.isFinite(viewport.x) ? viewport.x : 0,
        y: Number.isFinite(viewport.y) ? viewport.y : 0,
        zoom: Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Number.isFinite(viewport.zoom) ? viewport.zoom : 1),
        ),
      };
      return metadata;
    },
    [canvasCustomizationMeta],
  );

  const flushCanvasSaveQueue = useCallback(
    async (initialRequest: { path: string; payload: string }) => {
      if (saveInFlightRef.current) {
        queuedSaveRef.current = initialRequest;
        return;
      }

      saveInFlightRef.current = true;
      let request: { path: string; payload: string } | null = initialRequest;

      while (request) {
        const current = request;
        request = null;

        if (canvasFilePath === current.path) {
          setSaveState("saving");
        }

        try {
          await getAPI().writeFile(current.path, current.payload);
          lastSavedPayloadRef.current = current.payload;
          if (canvasFilePath === current.path) {
            setSaveState("saved");
            setLastSavedAt(Date.now());
          }
        } catch (error) {
          console.error("Failed to save canvas file:", current.path, error);
          if (canvasFilePath === current.path) {
            setSaveState("error");
          }
        }

        const queued = queuedSaveRef.current;
        queuedSaveRef.current = null;
        if (
          queued &&
          (queued.path !== current.path || queued.payload !== current.payload)
        ) {
          request = queued;
        }
      }

      saveInFlightRef.current = false;
    },
    [canvasFilePath],
  );

  /* ── canvas file load/save ── */
  useEffect(() => {
    let cancelled = false;

    const loadCanvas = async () => {
      if (!canvasFilePath) {
        pendingInitialZoomFitRef.current = false;
        setNodes([]);
        setEdges([]);
        const defaultViewport = { x: 0, y: 0, zoom: 1 };
        setVp(defaultViewport);
        vpRef.current = defaultViewport;
        targetVpRef.current = defaultViewport;
        setScribbles([]);
        setActiveScribble(null);
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        setDocMeta({});
        setDiagnostics(null);
        setShowDiagnostics(false);
        setSaveState("saved");
        setLastSavedAt(null);
        setShowCustomizationPanel(false);
        setCanvasBackgroundColor("");
        setCanvasDotColor("");
        setCanvasDotOpacityMultiplier(DEFAULT_DOT_OPACITY_MULTIPLIER);
        setDefaultNodeColor("");
        setDefaultEdgeColor("");
        setScribbleColor("");
        setScribbleWidth(DEFAULT_SCRIBBLE_WIDTH);
        lastSavedPayloadRef.current = "";
        setSelNodes(new Set());
        setSelEdges(new Set());
        setHist([{ nodes: [], edges: [], scribbles: [] }]);
        setHistIdx(0);
        setFileExists(true);
        if (saveDebounceTimerRef.current) {
          clearTimeout(saveDebounceTimerRef.current);
          saveDebounceTimerRef.current = null;
        }
        queuedSaveRef.current = null;
        return;
      }

      loadingCanvasRef.current = true;
      pendingInitialZoomFitRef.current = false;
      try {
        const exists = await getAPI().fileExists(canvasFilePath);
        if (cancelled) return;
        if (!exists) {
          setFileExists(false);
          loadingCanvasRef.current = false;
          return;
        }
        setFileExists(true);
        const raw = await getAPI().readFile(canvasFilePath);
        const parsed = parseCanvasDocument(raw || "");

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
        const customization = sanitizeCanvasCustomization(
          metadata[CANVAS_CUSTOMIZATION_KEY],
        );
        const savedViewport = sanitizeCanvasViewport(
          metadata[CANVAS_VIEWPORT_KEY],
        );
        delete metadata[CANVAS_SCRIBBLES_KEY];
        delete metadata[CANVAS_CUSTOMIZATION_KEY];
        delete metadata[CANVAS_VIEWPORT_KEY];
        const normalizedMetadata: Record<string, unknown> = {
          ...metadata,
          [CANVAS_SCRIBBLES_KEY]: nextScribbles,
        };
        const compactCustomization = compactCanvasCustomization(customization);
        if (compactCustomization) {
          normalizedMetadata[CANVAS_CUSTOMIZATION_KEY] = compactCustomization;
        }
        if (savedViewport) {
          normalizedMetadata[CANVAS_VIEWPORT_KEY] = savedViewport;
        }
        const normalizedPayload = serializeCanvasDocument(
          { nodes: nextNodes, edges: nextEdges },
          normalizedMetadata,
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
        setSaveState("saved");
        setLastSavedAt(Date.now());
        setCanvasBackgroundColor(customization.backgroundColor || "");
        setCanvasDotColor(customization.dotColor || "");
        setCanvasDotOpacityMultiplier(
          clampDotOpacityMultiplier(
            customization.dotOpacityMultiplier ?? DEFAULT_DOT_OPACITY_MULTIPLIER,
          ),
        );
        setDefaultNodeColor(customization.defaultNodeColor || "");
        setDefaultEdgeColor(customization.defaultEdgeColor || "");
        setScribbleColor(customization.defaultScribbleColor || "");
        setScribbleWidth(
          clampScribbleWidth(
            customization.defaultScribbleWidth ?? DEFAULT_SCRIBBLE_WIDTH,
          ),
        );
        if (savedViewport) {
          setVp(savedViewport);
          vpRef.current = savedViewport;
          targetVpRef.current = savedViewport;
        }
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
        pendingInitialZoomFitRef.current = nextNodes.length > 0 && !savedViewport;
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
        setSaveState("error");
        setLastSavedAt(null);
        const defaultViewport = { x: 0, y: 0, zoom: 1 };
        setVp(defaultViewport);
        vpRef.current = defaultViewport;
        targetVpRef.current = defaultViewport;
        setShowCustomizationPanel(false);
        setCanvasBackgroundColor("");
        setCanvasDotColor("");
        setCanvasDotOpacityMultiplier(DEFAULT_DOT_OPACITY_MULTIPLIER);
        setDefaultNodeColor("");
        setDefaultEdgeColor("");
        setScribbleColor("");
        setScribbleWidth(DEFAULT_SCRIBBLE_WIDTH);
        lastSavedPayloadRef.current = "";
        setSelNodes(new Set());
        setSelEdges(new Set());
        setHist([{ nodes: [], edges: [], scribbles: [] }]);
        setHistIdx(0);
        pendingInitialZoomFitRef.current = false;
      } finally {
        if (!cancelled) {
          loadingCanvasRef.current = false;
          setCanvasLoadTick((tick) => tick + 1);
        }
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
      buildCanvasMetadata(docMeta, scribbles, undefined, vp),
    );
    if (payload === lastSavedPayloadRef.current) {
      setSaveState((prev) =>
        prev === "saving" || prev === "error" ? prev : "saved",
      );
      return;
    }

    setSaveState((prev) => (prev === "saving" ? prev : "unsaved"));

    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }

    saveDebounceTimerRef.current = setTimeout(() => {
      void flushCanvasSaveQueue({ path: canvasFilePath, payload });
    }, 300);

    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
    };
  }, [
    canvasFilePath,
    nodes,
    edges,
    vp,
    docMeta,
    scribbles,
    buildCanvasMetadata,
    flushCanvasSaveQueue,
  ]);

  /* ── coordinate helpers ── */
  const s2c = useCallback(
    (sx: number, sy: number) => {
      const r = areaRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      const currentVp = vpRef.current;
      return {
        x: (sx - r.left - currentVp.x) / currentVp.zoom,
        y: (sy - r.top - currentVp.y) / currentVp.zoom,
      };
    },
    [],
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
        color: defaultNodeColor || undefined,
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
    [nodes, edges, viewCenter, snap, push, defaultNodeColor],
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

  const updateEdge = useCallback(
    (id: string, u: Partial<CanvasEdge>) => {
      setEdges((prev) => {
        const current = prev.find((ed) => ed.id === id);
        if (!current) return prev;

        const hasLockedUpdate = Object.prototype.hasOwnProperty.call(u, "locked");
        if (current.locked && !(hasLockedUpdate && u.locked === false)) {
          return prev;
        }

        const changed = (Object.keys(u) as Array<keyof CanvasEdge>).some(
          (key) => current[key] !== u[key],
        );
        if (!changed) return prev;

        const next = prev.map((ed) =>
          ed.id === id ? (clone({ ...ed, ...u }) as CanvasEdge) : ed,
        );
        push(nodes, next);
        return next;
      });
    },
    [nodes, push],
  );

  const commitPendingEdgeLabel = useCallback(() => {
    if (selEdges.size !== 1) return;
    const edge = edges.find((ed) => selEdges.has(ed.id));
    if (!edge || edge.locked) return;
    const trimmed = edgeLabelDraft.trim();
    const current = edge.label || "";
    if (trimmed === current) return;
    updateEdge(edge.id, { label: trimmed || undefined });
  }, [selEdges, edges, edgeLabelDraft, updateEdge]);

  const deleteSelected = useCallback(() => {
    const nn = nodes.filter((n) => !selNodes.has(n.id));
    const ee = edges.filter(
      (e) =>
        (e.locked || !selEdges.has(e.id)) &&
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

  const setScribbleWidthSafe = useCallback((value: number) => {
    setScribbleWidth(clampScribbleWidth(value));
  }, []);

  const applyDefaultNodeColorToSelection = useCallback(() => {
    if (!selNodes.size) return;
    let changed = false;
    const next = nodes.map((node) => {
      if (!selNodes.has(node.id)) return node;
      const nextColor = defaultNodeColor || undefined;
      if (node.color === nextColor) return node;
      changed = true;
      return { ...node, color: nextColor };
    });
    if (!changed) return;
    setNodes(next);
    push(next, edgesRef.current, scribblesRef.current);
  }, [nodes, selNodes, defaultNodeColor, push]);

  const applyDefaultEdgeColorToSelection = useCallback(() => {
    if (!selEdges.size) return;
    let changed = false;
    const next = edges.map((edge) => {
      if (!selEdges.has(edge.id) || edge.locked) return edge;
      const nextColor = defaultEdgeColor || undefined;
      if (edge.color === nextColor) return edge;
      changed = true;
      return { ...edge, color: nextColor };
    });
    if (!changed) return;
    setEdges(next);
    push(nodesRef.current, next, scribblesRef.current);
  }, [edges, selEdges, defaultEdgeColor, push]);

  const applyScribbleStyleToSelection = useCallback(() => {
    if (!selectedScribbleIds.size) return;
    let changed = false;
    const next = scribbles.map((stroke) => {
      if (!selectedScribbleIds.has(stroke.id)) return stroke;
      const nextColor = scribbleColor || undefined;
      const nextWidth = clampScribbleWidth(scribbleWidth);
      if (stroke.color === nextColor && stroke.width === nextWidth) {
        return stroke;
      }
      changed = true;
      return {
        ...stroke,
        color: nextColor,
        width: nextWidth,
      };
    });
    if (!changed) return;
    setScribbles(next);
    scribblesRef.current = next;
    push(nodesRef.current, edgesRef.current, next);
  }, [selectedScribbleIds, scribbles, scribbleColor, scribbleWidth, push]);

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
      buildCanvasMetadata(docMeta, scribbles, undefined, vpRef.current),
    );
    setSaveState("saving");
    try {
      await getAPI().writeFile(canvasFilePath, payload);
      lastSavedPayloadRef.current = payload;
      setSaveState("saved");
      setLastSavedAt(Date.now());
      setShowDiagnostics(false);
      setDiagnostics(null);
    } catch (error) {
      console.error("Repair save failed:", error);
      setSaveState("error");
    }
  }, [canvasFilePath, nodes, edges, docMeta, scribbles, buildCanvasMetadata]);

  const handleDragEnterZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropzoneActive(true);
  }, []);

  const handleDragLeaveZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropzoneActive(false);
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropzoneActive(false);

      const path = e.dataTransfer.getData("text/plain");

      if (!path) return;

      const isMd = path.endsWith(".md");
      const isCanvas = path.endsWith(".canvas");
      const isUrl =
        path.startsWith("http://") || path.startsWith("https://");

      if (!isMd && !isCanvas && !isUrl) return;

      const isDropZone = (e.currentTarget as HTMLElement).classList.contains("cv-dropzone");
      const p = isDropZone ? viewCenter() : s2c(e.clientX, e.clientY);
      const w = DEFAULT_NODE_WIDTH;
      const h = isMd ? 80 : 100;

      const base = {
        id: generateId(),
        x: snap(p.x - w / 2),
        y: snap(p.y - h / 2),
        width: w,
        height: h,
        color: defaultNodeColor || undefined,
      };

      let n: CanvasNode;
      if (isMd || isCanvas) {
        n = { ...base, type: "file", file: path } as CanvasFileNode;
      } else if (isUrl) {
        n = { ...base, type: "link", url: path } as CanvasLinkNode;
      } else {
        return;
      }

      const sorted = [...nodes, n];
      setNodes(sorted);
      setSelNodes(new Set([n.id]));
      setSelEdges(new Set());
      setSelectedScribbleIds(new Set());
      setLassoPoints([]);
      push(sorted, edges);

      if (isDropZone) {
        setFileModal(false);
        setFileSearchQuery("");
      }
    },
    [s2c, viewCenter, snap, defaultNodeColor, nodes, edges, push],
  );

  /* ═══ MOUSE: DOWN ═══ */
  const onAreaDown = useCallback(
    (e: React.MouseEvent) => {
      commitPendingEdgeLabel();
      if (showCustomizationPanel) {
        setShowCustomizationPanel(false);
      }

      if (e.button === 0 && tool === "draw") {
        const p = s2c(e.clientX, e.clientY);
        const stroke: CanvasScribbleStroke = {
          id: generateId(),
          points: [p],
          width: clampScribbleWidth(scribbleWidth),
          color: scribbleColor || undefined,
        };
        setActiveScribble(stroke);
        setSelNodes(new Set());
        setSelEdges(new Set());
        setEdgeMenuClickAnchor(null);
        setSelectedScribbleIds(new Set());
        setLassoPoints([]);
        lassoPointsRef.current = [];
        setColorPickerFor(null);
        setDrag({ type: "draw", startX: e.clientX, startY: e.clientY });
        e.preventDefault();
        return;
      }

      if (e.button === 0 && tool === "erase") {
        const p = s2c(e.clientX, e.clientY);
        eraseChangedRef.current = false;
        setSelNodes(new Set());
        setSelEdges(new Set());
        setEdgeMenuClickAnchor(null);
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
        const p = s2c(e.clientX, e.clientY);
        const selected = selectedScribbleIdsRef.current;
        const hitScribbleId = firstStrokeIdNearPoint(
          scribblesRef.current,
          p,
          10 / Math.max(vpRef.current.zoom, 0.25)
        );

        if (hitScribbleId) {
          const nextSelected = new Set(selected);
          if (!nextSelected.has(hitScribbleId)) {
            nextSelected.clear();
            nextSelected.add(hitScribbleId);
          }
          setSelectedScribbleIds(nextSelected);
          selectedScribbleIdsRef.current = nextSelected;
          setSelNodes(new Set());
          setSelEdges(new Set());
          setEdgeMenuClickAnchor(null);
          setColorPickerFor(null);

          const origin: Record<string, CanvasScribblePoint[]> = {};
          scribblesRef.current.forEach((stroke) => {
            if (!nextSelected.has(stroke.id)) return;
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
        setEdgeMenuClickAnchor(null);
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
        const hitScribbleId = firstStrokeIdNearPoint(
          scribblesRef.current,
          p,
          10 / Math.max(vpRef.current.zoom, 0.25)
        );

        if (hitScribbleId) {
          const nextSelected = new Set(selectedScribbleIdsRef.current);
          if (e.ctrlKey || e.metaKey) {
            if (nextSelected.has(hitScribbleId)) {
              nextSelected.delete(hitScribbleId);
            } else {
              nextSelected.add(hitScribbleId);
            }
          } else {
            if (!nextSelected.has(hitScribbleId)) {
              nextSelected.clear();
              nextSelected.add(hitScribbleId);
            }
          }
          setSelectedScribbleIds(nextSelected);
          selectedScribbleIdsRef.current = nextSelected;
          setSelNodes(new Set());
          setSelEdges(new Set());
          setEdgeMenuClickAnchor(null);
          setColorPickerFor(null);

          const origin: Record<string, CanvasScribblePoint[]> = {};
          scribblesRef.current.forEach((stroke) => {
            if (!nextSelected.has(stroke.id)) return;
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

        setDrag({ type: "select", startX: p.x, startY: p.y });
        setSelNodes(new Set());
        setSelEdges(new Set());
        setEdgeMenuClickAnchor(null);
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
      showCustomizationPanel,
      commitPendingEdgeLabel,
    ],
  );

  const onNodeDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      commitPendingEdgeLabel();
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
          setEdgeMenuClickAnchor(null);
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
        setEdgeMenuClickAnchor(null);
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

      const scribbleOrigin: Record<string, CanvasScribblePoint[]> = {};
      const draggedGroupIds = Array.from(movingIds).filter((mid) => {
        const nd = nodes.find((x) => x.id === mid);
        return nd && nd.type === "group";
      });

      scribblesRef.current.forEach((stroke) => {
        const insideGroup = draggedGroupIds.some((gid) => {
          const g = nodes.find((x) => x.id === gid);
          if (!g) return false;
          return stroke.points.every(
            (pt) =>
              pt.x >= g.x &&
              pt.y >= g.y &&
              pt.x <= g.x + g.width &&
              pt.y <= g.y + g.height,
          );
        });
        if (insideGroup || selectedScribbleIdsRef.current.has(stroke.id)) {
          scribbleOrigin[stroke.id] = stroke.points.map((pt) => ({
            x: pt.x,
            y: pt.y,
          }));
        }
      });
      scribbleMoveOriginRef.current = scribbleOrigin;
      scribbleMoveChangedRef.current = false;

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
    [editingId, tool, nodes, selNodes, s2c, stopPanInertia, commitPendingEdgeLabel],
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
          const nextPanVp = { ...vpRef.current, x: nextX, y: nextY };
          targetVpRef.current = nextPanVp;
          applyViewportToDOM(nextPanVp);
          scheduleVpSync();
          break;
        }
        case "node": {
          const currentZoom = vpRef.current.zoom;
          const dx = (e.clientX - drag.startX) / currentZoom;
          const dy = (e.clientY - drag.startY) / currentZoom;
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
              const THRESHOLD = 8 / currentZoom;
              let minXDist = THRESHOLD;
              let minYDist = THRESHOLD;
              const draggedNode = snap0.find((n) => n.id === drag.nodeId);
              const dw = draggedNode?.width || 0;
              const dh = draggedNode?.height || 0;

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

          const scribbleOrigin = scribbleMoveOriginRef.current;
          if (Object.keys(scribbleOrigin).length > 0) {
            if (
              !scribbleMoveChangedRef.current &&
              (Math.abs(bestDx) > 0.02 || Math.abs(bestDy) > 0.02)
            ) {
              scribbleMoveChangedRef.current = true;
            }
            setScribbles((prev) => {
              const next = prev.map((stroke) => {
                const base = scribbleOrigin[stroke.id];
                if (!base) return stroke;
                return {
                  ...stroke,
                  points: base.map((p) => ({ x: p.x + bestDx, y: p.y + bestDy })),
                };
              });
              scribblesRef.current = next;
              return next;
            });
          }
          break;
        }
        case "edge": {
          const from = nodesRef.current.find((n) => n.id === drag.edgeFromNode);
          if (!from) break;
          const side = drag.edgeFromSide || "right";
          const fp = portXY(from, side);
          const cp = s2c(e.clientX, e.clientY);
          let targetPort = null;
          const sorted = [...nodesRef.current].sort((a, b) => {
            if (a.type === "group" && b.type !== "group") return 1;
            if (a.type !== "group" && b.type === "group") return -1;
            return nodesRef.current.indexOf(b) - nodesRef.current.indexOf(a);
          });
          for (const n of sorted) {
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
              const tp = portXY(n, toSide);
              targetPort = { x: tp.x, y: tp.y, side: toSide };
              break;
            }
          }
          setTempEdge({ fx: fp.x, fy: fp.y, tx: cp.x, ty: cp.y, targetPort });
          break;
        }
        case "edge-stretch": {
          const edgeId = drag.edgeId;
          const handle = drag.edgeStretchHandle || "from";
          const origin = drag.edgeStretchOrigin;
          const controlStart = drag.edgeStretchControlStart;
          if (!edgeId || !origin || !controlStart) break;

          const cp = s2c(e.clientX, e.clientY);
          const startCp = s2c(drag.startX, drag.startY);
          const dx = cp.x - startCp.x;
          const dy = cp.y - startCp.y;
          let nextCx = controlStart.x + dx;
          let nextCy = controlStart.y + dy;
          const maxRadius = 4200;
          const vecX = nextCx - origin.x;
          const vecY = nextCy - origin.y;
          const vecLen = Math.hypot(vecX, vecY);
          if (vecLen > maxRadius) {
            const scale = maxRadius / vecLen;
            nextCx = origin.x + vecX * scale;
            nextCy = origin.y + vecY * scale;
          }
          const nextDx = nextCx - origin.x;
          const nextDy = nextCy - origin.y;

          setEdges((prev) => {
            const idx = prev.findIndex((ed) => ed.id === edgeId);
            if (idx < 0) return prev;
            const current = prev[idx];
            if (current.locked) return prev;
            const keyDx: "fromControlDx" | "toControlDx" =
              handle === "from" ? "fromControlDx" : "toControlDx";
            const keyDy: "fromControlDy" | "toControlDy" =
              handle === "from" ? "fromControlDy" : "toControlDy";
            if (current[keyDx] === nextDx && current[keyDy] === nextDy) {
              return prev;
            }
            const next = [...prev];
            next[idx] = {
              ...current,
              [keyDx]: nextDx,
              [keyDy]: nextDy,
            };
            setEdgeMenuClickAnchor((anchor) => {
              if (!anchor || anchor.edgeId !== edgeId) return anchor;
              return { ...anchor, x: nextCx, y: nextCy };
            });
            edgeStretchChangedRef.current = true;
            return next;
          });
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

          const selScribbles = new Set<string>();
          scribblesRef.current.forEach((stroke) => {
            if (
              stroke.points.every(
                (pt) =>
                  pt.x >= x &&
                  pt.x <= x + w &&
                  pt.y >= y &&
                  pt.y <= y + h
              )
            ) {
              selScribbles.add(stroke.id);
            }
          });
          setSelectedScribbleIds(selScribbles);
          break;
        }
        case "resize": {
          const currentZoom = vpRef.current.zoom;
          if (drag.selectionBounds && drag.selectionOriginById) {
            const base = drag.selectionBounds;
            const dx = (e.clientX - drag.startX) / currentZoom;
            const dy = (e.clientY - drag.startY) / currentZoom;
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
          const dx = (e.clientX - drag.startX) / currentZoom;
          const dy = (e.clientY - drag.startY) / currentZoom;
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
          const minDist =
            MIN_SCRIBBLE_POINT_DIST / Math.max(vpRef.current.zoom, 0.25);
          if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDist)
            break;
          // Mutate in-place for performance (no React re-render)
          active.points.push(point);
          // Direct SVG DOM update -- bypass React entirely
          const pathEl = activeScribblePathRef.current;
          if (pathEl) {
            pathEl.setAttribute('d', pointsToStrokePath(active.points));
          }
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
                MIN_LASSO_POINT_DIST / Math.max(vpRef.current.zoom, 0.25)
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
          const dx =
            (e.clientX - drag.startX) / Math.max(vpRef.current.zoom, 0.25);
          const dy =
            (e.clientY - drag.startY) / Math.max(vpRef.current.zoom, 0.25);
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

        const finalPanVp = { ...vpRef.current, x: endX, y: endY };
        targetVpRef.current = finalPanVp;
        applyViewportToDOM(finalPanVp);

        startPanInertia();
      }

      if (drag.type === "edge") {
        const cp = s2c(e.clientX, e.clientY);
        const sorted = [...nodesRef.current].sort((a, b) => {
          if (a.type === "group" && b.type !== "group") return 1;
          if (a.type !== "group" && b.type === "group") return -1;
          return nodesRef.current.indexOf(b) - nodesRef.current.indexOf(a);
        });
        for (const n of sorted) {
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
            const currentEdges = edgesRef.current;
            const dup = currentEdges.some(
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
                color: defaultEdgeColor || undefined,
              };
              const newEdges = [...currentEdges, ne];
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
          push(nodesRef.current, edgesRef.current, nextScribbles);
        }
        setActiveScribble(null);
        activeScribbleRef.current = null;
      }

      if (drag.type === "erase") {
        if (eraseChangedRef.current) {
          push(nodesRef.current, edgesRef.current, scribblesRef.current);
        }
        eraseChangedRef.current = false;
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
      }

      if (drag.type === "scribble-move") {
        if (scribbleMoveChangedRef.current) {
          push(nodesRef.current, edgesRef.current, scribblesRef.current);
        }
        scribbleMoveChangedRef.current = false;
      }

      if (drag.type === "edge-stretch") {
        if (edgeStretchChangedRef.current) {
          push(nodesRef.current, edgesRef.current, scribblesRef.current);
        }
        edgeStretchChangedRef.current = false;
      }

      if (drag.type === "node" || drag.type === "resize")
        push(nodesRef.current, edgesRef.current, scribblesRef.current);
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
  }, [drag, grid, s2c, push, startPanInertia, defaultEdgeColor]);

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

      if (e.ctrlKey || e.metaKey) {
        if (inEmbeddedNoteBody) {
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
        applyViewportDirect({
          x: mx - worldX * nz,
          y: my - worldY * nz,
          zoom: nz,
        });
        delayMarkdownPreviews();
      } else {
        if (canScrollNodeBody) {
          return;
        }
        e.preventDefault();
        stopPanInertia();
        const base = targetVpRef.current;
        const dx =
          e.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? e.deltaX * 16
            : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? e.deltaX * window.innerWidth
              : e.deltaX;
        const dy =
          e.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? e.deltaY * 16
            : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? e.deltaY * window.innerHeight
              : e.deltaY;

        const nextPanVp = {
          x: base.x - dx,
          y: base.y - dy,
          zoom: base.zoom,
        };
        targetVpRef.current = nextPanVp;
        applyViewportToDOM(nextPanVp);
        scheduleVpSync();
        delayMarkdownPreviews();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyViewportDirect, applyViewportToDOM, scheduleVpSync, delayMarkdownPreviews, stopPanInertia]);

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
      applyViewportDirect({
        x: cx - worldX * nz,
        y: cy - worldY * nz,
        zoom: nz,
      }, 80);
      delayMarkdownPreviews();
    },
    [applyViewportDirect, delayMarkdownPreviews, stopPanInertia],
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

  useEffect(() => {
    if (!canvasFilePath) return;
    if (loadingCanvasRef.current) return;
    if (!pendingInitialZoomFitRef.current) return;
    if (areaSize.width <= 1 || areaSize.height <= 1) return;
    if (!nodes.length) return;

    pendingInitialZoomFitRef.current = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        zoomFit();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasFilePath, areaSize.width, areaSize.height, canvasLoadTick, nodes.length, zoomFit]);

  /* ═══ KEYBOARD ═══ */
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const isEdgeLabelInput = t.classList.contains("cv-edge-label-input");
      if (
        (t.tagName === "TEXTAREA" || t.tagName === "INPUT") &&
        !isEdgeLabelInput
      )
        return;
      const ctrl = e.ctrlKey || e.metaKey;
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
        commitPendingEdgeLabel();
        redo();
      } else if (ctrl && e.key === "z") {
        e.preventDefault();
        commitPendingEdgeLabel();
        undo();
      }
      if (e.key === "v" && !ctrl) setTool("select");
      if (e.key === "h" && !ctrl) setTool("pan");
      if (e.key === "c" && !ctrl) setTool("edge");
      if (e.key === "d" && !ctrl) setTool("draw");
      if (e.key === "e" && !ctrl) setTool("erase");
      if (e.key === "l" && !ctrl) setTool("lasso");
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
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    selNodes,
    selEdges,
    selectedScribbleIds,
    deleteSelected,
    nodes,
    undo,
    redo,
    commitPendingEdgeLabel,
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
      if (n.type === "link") window.open(cleanEmbedUrl((n as CanvasLinkNode).url), "_blank");
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

  const onNodeDownRef = useRef(onNodeDown);
  const onPortDownRef = useRef(onPortDown);
  const onResizeDownRef = useRef(onResizeDown);
  const startEditRef = useRef(startEdit);
  const commitEditRef = useRef(commitEdit);

  useEffect(() => {
    onNodeDownRef.current = onNodeDown;
  }, [onNodeDown]);

  useEffect(() => {
    onPortDownRef.current = onPortDown;
  }, [onPortDown]);

  useEffect(() => {
    onResizeDownRef.current = onResizeDown;
  }, [onResizeDown]);

  useEffect(() => {
    startEditRef.current = startEdit;
  }, [startEdit]);

  useEffect(() => {
    commitEditRef.current = commitEdit;
  }, [commitEdit]);

  const handleNodeMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      onNodeDownRef.current(e, id);
    },
    [],
  );

  const handleNodeDoubleClick = useCallback((id: string) => {
    startEditRef.current(id);
  }, []);

  const handleNodePortDown = useCallback(
    (id: string, side: EdgeSide, e: React.MouseEvent) => {
      onPortDownRef.current(e, id, side);
    },
    [],
  );

  const handleNodeResizeDown = useCallback(
    (id: string, handle: string, e: React.MouseEvent) => {
      onResizeDownRef.current(e, id, handle);
    },
    [],
  );

  const handleNodeEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        setEditingId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        commitEditRef.current();
      }
    },
    [],
  );

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

  const filteredFlatFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return flatFiles;
    const query = fileSearchQuery.toLowerCase();
    return flatFiles.filter(
      (f) =>
        f.name.toLowerCase().includes(query) ||
        f.path.toLowerCase().includes(query),
    );
  }, [flatFiles, fileSearchQuery]);

  /* ═══ CURSOR ═══ */
  const cursor =
    drag.type === "pan"
      ? "grabbing"
      :
          drag.type === "node" ||
          drag.type === "scribble-move" ||
          drag.type === "edge-stretch"
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
  const groupLabelZoomMult = Math.min(14, Math.max(1, 1 / vp.zoom));
  const invZoom = 1 / vp.zoom;
  const canvasTextZoomMult = Math.min(3, Math.max(1, 1 + (invZoom - 1) * 0.28));

  // Ensure DOM transform + CSS custom properties stay in sync after any React re-render
  // (prevents stale inline styles from overwriting the ref-based transform)
  useLayoutEffect(() => {
    applyViewportToDOM(vpRef.current);
  }, [vp, applyViewportToDOM]);
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
  const groupMenuLiftPx = useMemo(() => {
    if (!firstSel || firstSel.type !== "group") return 0;
    const raw = (firstSel as CanvasGroupNode).label || "";
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const lineCount = Math.max(1, lines.length || 1);
    const fontSize = 14 * groupLabelZoomMult;
    const lineHeight = fontSize * 1.12;
    const labelHeight = lineCount * lineHeight + 10 * groupLabelZoomMult + 2;
    const labelGap = 6 * groupLabelZoomMult;
    return (labelHeight + labelGap + 8) * renderVp.zoom;
  }, [firstSel, groupLabelZoomMult, renderVp.zoom]);

  const firstSelEdge =
    selEdges.size === 1 ? edges.find((ed) => selEdges.has(ed.id)) || null : null;
  const edgeLocked = !!firstSelEdge?.locked;
  const edgeWidthValue = clampEdgeWidth(firstSelEdge?.width);
  const edgeStretchHandle: EdgeStretchHandle =
    edgeMenuClickAnchor &&
    firstSelEdge &&
    edgeMenuClickAnchor.edgeId === firstSelEdge.id
      ? edgeMenuClickAnchor.handle
      : "from";
  const selectedEdgeGeometry =
    firstSelEdge ? edgeGeometry(firstSelEdge, nodeMap) : null;
  const edgeStretchValue = selectedEdgeGeometry
    ? edgeStretchHandle === "from"
      ? selectedEdgeGeometry.fromStretch
      : selectedEdgeGeometry.toStretch
    : EDGE_DEFAULT_STRETCH;
  const edgeMenuAnchor =
    firstSelEdge && !firstSel
      ? edgeMenuClickAnchor?.edgeId === firstSelEdge.id
        ? { x: edgeMenuClickAnchor.x, y: edgeMenuClickAnchor.y }
        : edgeMidpoint(firstSelEdge, nodeMap)
      : null;
  const fallbackCanvasBgColor = theme === "light" ? "#ffffff" : "#0a0a0a";
  const fallbackCanvasDotColor = theme === "light" ? "#000000" : "#ffffff";

  const commitEdgeLabel = useCallback(() => {
    if (!firstSelEdge || firstSelEdge.locked) return;
    const trimmed = edgeLabelDraft.trim();
    const current = firstSelEdge.label || "";
    if (trimmed === current) return;
    updateEdge(firstSelEdge.id, { label: trimmed || undefined });
  }, [firstSelEdge, edgeLabelDraft, updateEdge]);

  useEffect(() => {
    if (!firstSelEdge) {
      setEdgeLabelDraft("");
      setEdgeColorPickerFor(null);
      setEdgeWidthPickerFor(null);
      setEdgeMenuClickAnchor(null);
      return;
    }
    setEdgeLabelDraft(firstSelEdge.label || "");
    setEdgeColorPickerFor((current) =>
      current === firstSelEdge.id ? current : null,
    );
    setEdgeWidthPickerFor((current) =>
      current === firstSelEdge.id ? current : null,
    );
  }, [firstSelEdge]);

  /* ═══ RENDER ═══ */
  if (!fileExists) {
    return (
      <div className="canvas-missing-placeholder" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '24px',
        color: 'var(--text-muted)',
        textAlign: 'center',
        backgroundColor: 'var(--bg-primary, var(--background-primary, #14141f))'
      }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-normal, var(--text-primary, #ffffff))' }}>
          File missing
        </div>
        <div style={{ fontSize: '12px', marginBottom: '16px', maxWidth: '300px' }}>
          The canvas file <code style={{ wordBreak: 'break-all', backgroundColor: 'var(--bg-secondary, var(--background-secondary, #1e1e2e))', padding: '2px 4px', borderRadius: '4px' }}>{canvasFilePath}</code> could not be found. It may have been renamed or deleted.
        </div>
        <button 
          className="cursor-pointer rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] active:scale-[0.98] active:bg-[var(--bg-active)]"
          onClick={onClose}
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          Close tab
        </button>
      </div>
    );
  }

  return (
    <div
      className="cv"
      ref={wrapRef}
      data-theme={theme}
      data-dragging={drag.type !== "none"}
      style={
        {
          cursor,
          "--cv-custom-bg": canvasBackgroundColor || "var(--cv-bg)",
        } as any
      }
    >
      {/* ── Canvas area ── */}
      <div
        ref={areaRef}
        className="cv-area"
        onMouseDown={onAreaDown}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleCanvasDrop}
      >
        {/* Dot-pattern background (SVG stays in viewport space) */}
        {grid && (
          <DotGrid
            zoom={renderVp.zoom}
            offX={renderVp.x}
            offY={renderVp.y}
            color={canvasDotColor || (!isDarkTheme(theme) ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.25)")}
            opacityMultiplier={canvasDotOpacityMultiplier}
          />
        )}

        {/* Transform group */}
        <div
          className="cv-transform"
          ref={transformElRef}
          style={undefined}
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
                  commitPendingEdgeLabel();
                  const clickPoint = s2c(ev.clientX, ev.clientY);
                  const geometry = edgeGeometry(ed, nodeMap);
                  const handle = geometry
                    ? pickStretchHandle(clickPoint, geometry)
                    : "from";
                  setColorPickerFor(null);
                  setEdgeColorPickerFor(null);
                  setEdgeWidthPickerFor(null);
                  setEdgeMenuClickAnchor({
                    edgeId: ed.id,
                    x: clickPoint.x,
                    y: clickPoint.y,
                    handle,
                  });
                  setSelNodes(new Set());
                  setSelEdges(new Set([ed.id]));
                  setSelectedScribbleIds(new Set());
                  setLassoPoints([]);
                  lassoPointsRef.current = [];
                }}
              />
            ))}
            {edgeMenuAnchor && firstSelEdge && !edgeLocked && (
              <g
                className="cv-edge-stretch-handle"
                transform={`translate(${edgeMenuAnchor.x},${edgeMenuAnchor.y})`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  commitPendingEdgeLabel();
                  const geometry = edgeGeometry(firstSelEdge, nodeMap);
                  if (!geometry) return;
                  const handle: EdgeStretchHandle =
                    edgeMenuClickAnchor?.edgeId === firstSelEdge.id
                      ? edgeMenuClickAnchor.handle
                      : "from";
                  const origin = handle === "from" ? geometry.p1 : geometry.p2;
                  const controlStart = {
                    x: edgeMenuAnchor.x,
                    y: edgeMenuAnchor.y,
                  };
                  edgeStretchChangedRef.current = false;
                  setDrag({
                    type: "edge-stretch",
                    startX: e.clientX,
                    startY: e.clientY,
                    edgeId: firstSelEdge.id,
                    edgeStretchHandle: handle,
                    edgeStretchOrigin: origin,
                    edgeStretchControlStart: controlStart,
                  });
                }}
              >
                <title>Drag to stretch edge</title>
                <circle className="cv-edge-stretch-ring" r={8} />
                <circle className="cv-edge-stretch-dot" r={3.2} />
              </g>
            )}
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
                ref={activeScribblePathRef}
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
            <MemoNodeCard
              key={n.id}
              nodeId={n.id}
              node={n}
              selected={selNodes.has(n.id)}
              editing={editingId === n.id}
              editText={editingId === n.id ? editText : ""}
              enableMarkdownPreview={markdownPreviewNodeIds.has(n.id)}
              vaultPath={vaultPath}
              onMouseDown={handleNodeMouseDown}
              onDoubleClick={handleNodeDoubleClick}
              onPortDown={handleNodePortDown}
              onResizeDown={handleNodeResizeDown}
              onEditChange={setEditText}
              onEditBlur={commitEdit}
              onEditKeyDown={handleNodeEditKeyDown}
              onUpdateNode={updateNode}
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
          <div className="cv-diagnostics-title">Canvas import diagnostics</div>
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
            top: renderVp.y + menuAnchor.y * renderVp.zoom - 8 - groupMenuLiftPx,
          }}
        >
          {firstSel && firstSel.type !== "link" && (
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
              <label className="cv-color-custom" title="Custom color">
                <InlineHexColorControl
                  value={resolveCanvasColor(firstSel.color) || "#64748b"}
                  onChange={(value) => updateNode(firstSel.id, { color: value })}
                />
                <span className="cv-color-custom-label">Custom</span>
              </label>
              {firstSel.type === "group" && (() => {
                const currentOpacity = firstSel.opacity !== undefined ? firstSel.opacity : 0.12;
                return (
                  <div className="cv-color-opacity-slider" style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px", borderLeft: "1px solid var(--border-subtle)", paddingLeft: "12px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "bold", opacity: 0.7 }}>Opacity:</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(currentOpacity * 100)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) / 100;
                        updateNode(firstSel.id, { opacity: val });
                      }}
                      style={{
                        width: "80px",
                        height: "4px",
                        borderRadius: "2px",
                        background: "var(--border-medium)",
                        outline: "none",
                        cursor: "pointer",
                      }}
                    />
                    <span style={{ fontSize: "11px", minWidth: "24px", textAlign: "right" }}>
                      {Math.round(currentOpacity * 100)}%
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {edgeMenuAnchor && firstSelEdge && !editingId && (
        <div
          className="cv-card-menu cv-edge-menu"
          style={{
            left: renderVp.x + edgeMenuAnchor.x * renderVp.zoom,
            top: renderVp.y + edgeMenuAnchor.y * renderVp.zoom - 10,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            className="cv-edge-label-input"
            value={edgeLabelDraft}
            placeholder="Edge label"
            disabled={edgeLocked}
            onChange={(e) => setEdgeLabelDraft(e.target.value)}
            onBlur={commitEdgeLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitEdgeLabel();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setEdgeLabelDraft(firstSelEdge.label || "");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <button
            className="cv-card-btn"
            title="Edge color"
            disabled={edgeLocked}
            onClick={() =>
              setEdgeColorPickerFor(
                edgeColorPickerFor === firstSelEdge.id ? null : firstSelEdge.id,
              )
            }
          >
            <Palette size={14} />
          </button>
          <button
            className={`cv-card-btn${edgeWidthPickerFor === firstSelEdge.id ? " on" : ""}`}
            title="Edge width"
            disabled={edgeLocked}
            onClick={() =>
              setEdgeWidthPickerFor(
                edgeWidthPickerFor === firstSelEdge.id ? null : firstSelEdge.id,
              )
            }
          >
            <SlidersHorizontal size={14} />
          </button>
          <button
            className={`cv-card-btn${firstSelEdge.toEnd !== "none" ? " on" : ""}`}
            title="Toggle arrowhead"
            disabled={edgeLocked}
            onClick={() =>
              updateEdge(firstSelEdge.id, {
                toEnd: firstSelEdge.toEnd === "none" ? "arrow" : "none",
              })
            }
          >
            <span className="cv-card-short">-&gt;</span>
          </button>
          <button
            className={`cv-card-btn${edgeLocked ? " on" : ""}`}
            title={edgeLocked ? "Unlock edge" : "Lock edge"}
            onClick={() =>
              updateEdge(firstSelEdge.id, {
                locked: !edgeLocked,
              })
            }
          >
            {edgeLocked ? <Unlock size={14} /> : <Lock size={14} />}
          </button>
          <button
            className="cv-card-btn cv-card-btn-del"
            title="Delete edge"
            disabled={edgeLocked}
            onClick={deleteSelected}
          >
            <Trash2 size={14} />
          </button>
          {!edgeLocked && edgeColorPickerFor === firstSelEdge.id && (
            <div className="cv-color-row cv-edge-color-row">
              <button
                className="cv-swatch cv-swatch-none"
                onClick={() => {
                  updateEdge(firstSelEdge.id, { color: undefined });
                  setEdgeColorPickerFor(null);
                }}
              />
              {Object.entries(CANVAS_PRESET_COLORS).map(([k, hex]) => (
                <button
                  key={k}
                  className={`cv-swatch${firstSelEdge.color === k ? " on" : ""}`}
                  style={{ background: hex }}
                  onClick={() => {
                    updateEdge(firstSelEdge.id, { color: k });
                    setEdgeColorPickerFor(null);
                  }}
                />
              ))}
              <label className="cv-color-custom" title="Custom color">
                <InlineHexColorControl
                  value={resolveCanvasColor(firstSelEdge.color) || "#64748b"}
                  onChange={(value) => updateEdge(firstSelEdge.id, { color: value })}
                />
                <span className="cv-color-custom-label">Custom</span>
              </label>
            </div>
          )}
          {!edgeLocked && edgeWidthPickerFor === firstSelEdge.id && (
            <div className="cv-color-row cv-edge-width-pop">
              <label className="cv-edge-width-slider">
                <span>Width {edgeWidthValue.toFixed(1)}px</span>
                <input
                  type="range"
                  min={EDGE_MIN_WIDTH}
                  max={EDGE_MAX_WIDTH}
                  step={0.2}
                  value={edgeWidthValue}
                  onChange={(e) =>
                    updateEdge(firstSelEdge.id, {
                      width: clampEdgeWidth(Number(e.target.value)),
                    })
                  }
                />
              </label>
            </div>
          )}
          <div className="cv-edge-controls" onPointerDown={commitPendingEdgeLabel}>
            <div className="cv-edge-width-head">
              <span>Stretch Handle</span>
              <span>{edgeStretchHandle === "from" ? "Source" : "Target"}</span>
            </div>
            <div className="cv-edge-stretch-note">
              {edgeLocked
                ? "Unlock edge to stretch"
                : `Drag the ring to stretch the ${edgeStretchHandle === "from" ? "source" : "target"} side (${edgeStretchValue.toFixed(2)}x)`}
            </div>
          </div>
        </div>
      )}

      {/* ══ Right-side canvas controls ══ */}
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
        <div className="cv-draw-tools">
          <div className="cv-ctrl-group">
            <button
              className={`cv-ctrl${tool === "draw" ? " on" : ""}`}
              title="Draw scribble (D)"
              onClick={() =>
                setTool((prev) => (prev === "draw" ? "select" : "draw"))
              }
            >
              <PenLine size={15} />
            </button>
            <button
              className={`cv-ctrl${tool === "erase" ? " on" : ""}`}
              title="Eraser (E)"
              onClick={() =>
                setTool((prev) => (prev === "erase" ? "select" : "erase"))
              }
            >
              <Eraser size={15} />
            </button>
            <button
              className={`cv-ctrl${tool === "lasso" ? " on" : ""}`}
              title="Lasso select + move scribbles (L)"
              onClick={() =>
                setTool((prev) => (prev === "lasso" ? "select" : "lasso"))
              }
            >
              <Lasso size={15} />
            </button>
          </div>
          {(tool === "draw" || selectedScribbleIds.size > 0) && (
            <div className="cv-ctrl-group cv-draw-panel cv-draw-popout">
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
              <label className="cv-color-custom cv-draw-custom-color" title="Custom scribble color">
                <InlineHexColorControl
                  value={scribbleColor || "#e8eeff"}
                  onChange={setScribbleColor}
                  title="Custom scribble color"
                />
                <span className="cv-color-custom-label">Custom stroke</span>
              </label>
              <label className="cv-draw-size">
                <span>{scribbleWidth.toFixed(1)}px</span>
                <input
                  type="range"
                  min={MIN_SCRIBBLE_WIDTH}
                  max={MAX_SCRIBBLE_WIDTH}
                  step={0.2}
                  value={scribbleWidth}
                  onChange={(e) =>
                    setScribbleWidthSafe(Number(e.target.value))
                  }
                />
                <div className="cv-size-input-row">
                  <input
                    type="number"
                    className="cv-size-input"
                    min={MIN_SCRIBBLE_WIDTH}
                    max={MAX_SCRIBBLE_WIDTH}
                    step={0.1}
                    value={Number(scribbleWidth.toFixed(1))}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setScribbleWidthSafe(next);
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
              {selectedScribbleIds.size > 0 ? (
                <button
                  className="cv-file-row"
                  onClick={applyScribbleStyleToSelection}
                >
                  Apply color + size to selected strokes
                </button>
              ) : null}
              {selectedScribbleIds.size > 0 ? (
                <button
                  className="cv-file-row cv-draw-delete"
                  onClick={deleteSelected}
                >
                  Delete selected strokes
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="cv-draw-tools">
          <div className="cv-ctrl-group">
            <button
              className={`cv-ctrl${showCustomizationPanel ? " on" : ""}`}
              title="Canvas customization"
              onClick={() => setShowCustomizationPanel((prev) => !prev)}
            >
              <Palette size={15} />
            </button>
          </div>
          {showCustomizationPanel ? (
            <div
              className="cv-ctrl-group cv-draw-panel cv-draw-popout cv-custom-panel"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cv-custom-head">Canvas background</div>
              <label className="cv-custom-field">
                <span>Background</span>
                <InlineHexColorControl
                  value={canvasBackgroundColor || fallbackCanvasBgColor}
                  onChange={setCanvasBackgroundColor}
                  title="Canvas background color"
                />
              </label>
              <button
                className="cv-file-row cv-custom-clear"
                onClick={() => setCanvasBackgroundColor("")}
                disabled={!canvasBackgroundColor}
              >
                Use theme background
              </button>

              <label className="cv-custom-field">
                <span>Grid dot color</span>
                <InlineHexColorControl
                  value={canvasDotColor || fallbackCanvasDotColor}
                  onChange={setCanvasDotColor}
                  title="Grid dot color"
                />
              </label>
              <label className="cv-draw-size">
                <span>Grid dot visibility {(canvasDotOpacityMultiplier * 100).toFixed(0)}%</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={canvasDotOpacityMultiplier}
                  onChange={(e) =>
                    setCanvasDotOpacityMultiplier(
                      clampDotOpacityMultiplier(Number(e.target.value)),
                    )
                  }
                />
              </label>

              <div className="cv-custom-head cv-custom-head-spaced">Custom colors</div>
              <label className="cv-custom-field">
                <span>Default node color</span>
                <InlineHexColorControl
                  value={defaultNodeColor || "#64748b"}
                  onChange={setDefaultNodeColor}
                  title="Default node color"
                />
              </label>
              <button
                className="cv-file-row"
                onClick={applyDefaultNodeColorToSelection}
                disabled={!selNodes.size}
              >
                Apply to selected nodes ({selNodes.size})
              </button>

              <label className="cv-custom-field">
                <span>Default edge color</span>
                <InlineHexColorControl
                  value={defaultEdgeColor || "#94a3b8"}
                  onChange={setDefaultEdgeColor}
                  title="Default edge color"
                />
              </label>
              <button
                className="cv-file-row"
                onClick={applyDefaultEdgeColorToSelection}
                disabled={!selEdges.size}
              >
                Apply to selected edges ({selEdges.size})
              </button>

              <button
                className="cv-file-row cv-custom-clear"
                onClick={() => {
                  setDefaultNodeColor("");
                  setDefaultEdgeColor("");
                }}
                disabled={!defaultNodeColor && !defaultEdgeColor}
              >
                Reset default node/edge colors
              </button>
            </div>
          ) : null}
        </div>
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
            className="cv-ctrl"
            title="Undo"
            onClick={() => {
              commitPendingEdgeLabel();
              undo();
            }}
            disabled={histIdx <= 0}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="cv-ctrl"
            title="Redo"
            onClick={() => {
              commitPendingEdgeLabel();
              redo();
            }}
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
        <div className="cv-overlay" onClick={() => { setFileModal(false); setFileSearchQuery(""); }}>
          <div className="cv-modal cv-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-head">
              <span>Select a note</span>
              <button onClick={() => { setFileModal(false); setFileSearchQuery(""); }}>
                <X size={14} />
              </button>
            </div>
            <div className="cv-modal-body" style={{ display: "flex", flexDirection: "column", height: "calc(100% - 50px)" }}>
              <div className="cv-modal-split" style={{ display: "flex", gap: "16px", flex: 1, minHeight: 0 }}>
                {/* Left Column: Search & Notes */}
                <div className="cv-modal-col-left" style={{ flex: 1.2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <input
                    type="text"
                    className="cv-search-input"
                    placeholder="Search notes..."
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "var(--bg-secondary, var(--background-secondary, #1e1e2e))",
                      color: "var(--text-primary)",
                      marginBottom: "12px",
                      fontSize: "13px",
                      outline: "none"
                    }}
                  />
                  <div style={{ flex: 1, overflowY: "auto" }}>
                    {filteredFlatFiles.length === 0 ? (
                      <p className="cv-modal-empty">No notes found</p>
                    ) : (
                      filteredFlatFiles.map((f, i) => (
                        <button
                          key={i}
                          className="cv-file-row"
                          onClick={() => {
                            addNode("file", { file: f.path });
                            setFileModal(false);
                            setFileSearchQuery("");
                          }}
                        >
                          <FileText size={14} />
                          {f.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Vertical Divider */}
                <div style={{ width: "1px", backgroundColor: "var(--border-subtle)", alignSelf: "stretch" }} />

                {/* Right Column: Dropzone */}
                <div className="cv-modal-col-right" style={{ flex: 0.8, display: "flex", flexDirection: "column" }}>
                  <div
                    className={`cv-dropzone ${dropzoneActive ? "drag-active" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={handleDragEnterZone}
                    onDragLeave={handleDragLeaveZone}
                    onDrop={handleCanvasDrop}
                  >
                    <div className="cv-dropzone-icon">
                      <FileText size={32} strokeWidth={1.5} />
                    </div>
                    <span className="cv-dropzone-text">
                      Drag note here to add to canvas
                    </span>
                    <span className="cv-dropzone-subtext">
                      Drop from sidebar explorer
                    </span>
                  </div>
                </div>
              </div>
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
                    let u = cleanEmbedUrl(linkUrl.trim());
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
                  let u = cleanEmbedUrl(linkUrl.trim());
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
  color,
  opacityMultiplier,
}: {
  zoom: number;
  offX: number;
  offY: number;
  color?: string;
  opacityMultiplier: number;
}) {
  // Dynamic grid scaling to avoid Moire patterns and dense grid lines when zooming out
  let multiplier = 1;
  if (zoom < 0.15) {
    multiplier = 8;
  } else if (zoom < 0.35) {
    multiplier = 4;
  } else if (zoom < 0.7) {
    multiplier = 2;
  }

  const step = GRID_SIZE * multiplier;
  const gap = step * zoom;

  // Ultra-calm, subtle, crisp dot radius in screen pixels that matches Obsidian's look
  // Larger dots for better visibility, especially on light themes
  const dotRadius = Math.max(0.8, Math.min(1.2, 0.9 * Math.sqrt(zoom)));

  // Calculate dynamic opacity based on screen gap (much lower opacity to look calm and elegant)
  const baseOpacity = Math.max(0, Math.min(0.4, (gap - 4) / 15));
  const finalOpacity = baseOpacity * clampDotOpacityMultiplier(opacityMultiplier);

  if (finalOpacity <= 0.005) return null;

  // Use raw offX/offY directly to completely eliminate modulo-rounding jumpiness during panning/zooming.
  // Center-offsetting by half the gap ensures exact alignment with node grid coordinates (0, 20, 40...)
  const ox = offX - gap / 2;
  const oy = offY - gap / 2;

  return (
    <svg className="cv-dots" style={{ pointerEvents: "none" }}>
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
            fill={color || "var(--cv-theme-dot, var(--cv-dot))"}
            opacity={finalOpacity}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cvDot)" />
    </svg>
  );
}

function InlineHexColorControl({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.left - 8,
      y: rect.top + rect.height / 2,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateAnchor();

    const onViewportChange = () => updateAnchor();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, updateAnchor]);

  return (
    <div
      ref={wrapRef}
      className="cv-inline-color-wrap"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="cv-color-custom-btn"
        title={title || "Custom color"}
        aria-label={title || "Custom color"}
        style={{ backgroundColor: value }}
        onClick={() => setOpen((prev) => !prev)}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="cv-inline-color-popover"
              role="dialog"
              aria-label="Color picker"
              style={{ left: anchor.x, top: anchor.y }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <HexColorPicker color={value} onChange={onChange} />
            </div>,
            document.body,
          )
        : null}
    </div>
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
  const geometry = edgeGeometry(edge, nodeMap);
  if (!geometry) return null;
  const { p1, p2, cp1, cp2 } = geometry;
  const edgeWidth = clampEdgeWidth(edge.width);
  const d = `M${p1.x},${p1.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${p2.x},${p2.y}`;
  const color = resolveCanvasColor(edge.color) || "var(--cv-edge)";
  const labelPoint = cubicBezierPoint(p1, cp1, cp2, p2, 0.5);
  const arrowScale = Math.max(0.75, Math.min(2.25, edgeWidth / EDGE_DEFAULT_WIDTH));
  const endAngle =
    (Math.atan2(p2.y - cp2.y, p2.x - cp2.x) * 180) / Math.PI;
  return (
    <g className={`cv-edge${selected ? " sel" : ""}${edge.locked ? " locked" : ""}`}>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(20, edgeWidth * 6)}
        style={{ cursor: "pointer" }}
        onClick={onClick}
      />
      <path
        d={d}
        className="cv-edge-display"
        stroke={color}
        strokeWidth={selected ? edgeWidth + 1 : edgeWidth}
        fill="none"
      />
      {edge.toEnd !== "none" && (
        <polygon
          points="-7,-4.5 0,0 -7,4.5"
          fill={color}
          transform={`translate(${p2.x},${p2.y}) rotate(${endAngle}) scale(${arrowScale})`}
        />
      )}
      {edge.label && (
        <text
          x={labelPoint.x}
          y={labelPoint.y - (8 + edgeWidth * 0.2)}
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
  from: {
    fx: number;
    fy: number;
    tx: number;
    ty: number;
    targetPort?: { x: number; y: number; side: EdgeSide } | null;
  };
}) {
  const endX = from.targetPort ? from.targetPort.x : from.tx;
  const endY = from.targetPort ? from.targetPort.y : from.ty;
  const dx = endX - from.fx,
    dy = endY - from.fy;
  const off = Math.max(80, Math.hypot(dx, dy) * 0.45);
  const d = `M${from.fx},${from.fy} C${from.fx + (dx > 0 ? off : -off)},${from.fy} ${endX + (dx > 0 ? -off : off)},${endY} ${endX},${endY}`;
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
      {from.targetPort ? (
        <g>
          <circle
            cx={endX}
            cy={endY}
            r={8}
            fill="none"
            stroke="var(--accent-color)"
            strokeWidth={1.5}
            opacity={0.8}
            className="animate-pulse"
          />
          <circle cx={endX} cy={endY} r={5} fill="var(--accent-color)" />
        </g>
      ) : (
        <circle cx={from.tx} cy={from.ty} r={4} fill="var(--accent-color)" />
      )}
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

    const refreshContent = async () => {
      try {
        const api = getAPI();
        if (!(await api.fileExists(node.file))) {
          embeddedMarkdownCache.delete(node.file);
          if (mounted) setContent(null);
          return;
        }
        const c = await api.readFile(node.file);
        if (!mounted) return;
        embeddedMarkdownCache.set(node.file, c);
        setContent((prev) => (prev === c ? prev : c));
      } catch (e) {
        console.error("Failed to load embedded note:", e);
      }
    };

    const onNoteContentChanged = (event: Event) => {
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
      "openonyx:note-content-changed",
      onNoteContentChanged as EventListener,
    );

    refreshContent();
    refreshTimer = setInterval(refreshContent, MD_PREVIEW_REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
      }
      window.removeEventListener(
        "openonyx:note-content-changed",
        onNoteContentChanged as EventListener,
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
        <MarkdownPreview content={content} onLinkClick={() => {}} constrainWidth={false} />
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
  nodeId: string;
  node: CanvasNode;
  selected: boolean;
  editing: boolean;
  editText: string;
  vaultPath: string;
  enableMarkdownPreview: boolean;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onDoubleClick: (id: string) => void;
  onPortDown: (id: string, side: EdgeSide, e: React.MouseEvent) => void;
  onResizeDown: (id: string, handle: string, e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onEditBlur: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onUpdateNode?: (id: string, props: any) => void;
}

function NodeCard({
  nodeId,
  node,
  selected,
  editing,
  editText,
  vaultPath,
  enableMarkdownPreview,
  onMouseDown,
  onDoubleClick,
  onPortDown,
  onResizeDown,
  onEditChange,
  onEditBlur,
  onEditKeyDown,
  onUpdateNode,
}: NodeCardProps) {
  const isGroup = node.type === "group";
  const isLink = node.type === "link";
  const isEmbed = isLink && !((node as CanvasLinkNode).url || "").includes("#no-embed");
  const borderColor = isLink ? undefined : resolveCanvasColor(node.color);

  const style: React.CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(isEmbed
      ? {
          background: "transparent",
          boxShadow: "none",
          border: "none",
        }
      : {}),
    ...(borderColor && !isGroup
      ? ({
          "--node-color": borderColor,
          boxShadow: "none",
          outline: `1px solid ${borderColor}`,
          border: "none",
          background: "var(--cv-node-bg)",
        } as any)
      : {}),
    ...(borderColor && isGroup
      ? ({
          "--node-color": borderColor,
          "--node-color-border": colorWithAlpha(borderColor, 0.72),
          "--node-color-subtle": colorWithAlpha(borderColor, node.opacity !== undefined ? node.opacity : 0.12),
          "--node-color-label-bg": colorWithAlpha(borderColor, 0.34),
          "--node-color-label-border": colorWithAlpha(borderColor, 0.92),
        } as any)
      : {}),
  };

  return (
    <div
      className={`cv-node cv-node-${node.type}${selected ? " sel" : ""}${editing ? " editing" : ""}${node.locked ? " locked" : ""}`}
      style={style}
      onMouseDown={(e) => onMouseDown(nodeId, e)}
      onDoubleClick={() => onDoubleClick(nodeId)}
      data-id={node.id}
    >
      {/* Connection ports */}
      {selected &&
        !node.locked &&
        (["top", "right", "bottom", "left"] as EdgeSide[]).map((s) => (
          <div
            key={s}
            className={`cv-port cv-port-${s}`}
            onMouseDown={(e) => onPortDown(nodeId, s, e)}
            style={isGroup ? { pointerEvents: "auto" } : undefined}
          />
        ))}

      {/* Resize handles */}
      {selected &&
        !node.locked &&
        ["nw", "ne", "sw", "se"].map((h) => (
          <div
            key={h}
            className={`cv-resize cv-resize-${h}`}
            onMouseDown={(e) => onResizeDown(nodeId, h, e)}
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
          />
        ) : (
          <div className="cv-group-label">
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
                        opacity: 0.92,
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
          <div className="cv-node-body cv-text-md-preview" data-cv-no-drag="true" style={{ overflowY: "auto", height: "100%" }}>
            {(node as CanvasTextNode).text ? (
              <MarkdownPreview
                content={(node as CanvasTextNode).text || ""}
                onLinkClick={() => {}}
                constrainWidth={false}
                onContentChange={(newText) => {
                  onUpdateNode?.(node.id, { text: newText });
                }}
              />
            ) : (
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

      {node.type === "link" && (() => {
        const url = (node as CanvasLinkNode).url || "";
        const isNoEmbed = url.includes("#no-embed");
        const cleanUrl = cleanEmbedUrl(url.replace(/#no-embed/g, "").trim());
        const displayDomain = getDisplayDomain(cleanUrl);

        if (isNoEmbed) {
          return (
            <div className="cv-node-body cv-link-body link-only-mode" style={{ height: "100%", display: "flex", flexDirection: "column", padding: "8px 12px" }}>
              <div className="cv-link-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "6px", marginBottom: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", opacity: 0.7 }}>{displayDomain}</span>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} data-cv-no-drag="true">
                <a href={cleanUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color)", textDecoration: "underline", wordBreak: "break-all", fontSize: "12px", textAlign: "center" }}>
                  {cleanUrl}
                </a>
              </div>
            </div>
          );
        }

        const config = getSmartEmbed(cleanUrl);
        const embedSrc = config.src;

        return (
          <div className="cv-node-body cv-link-body iframe-mode" style={{ height: "100%", width: "100%", overflow: "hidden", display: "flex", flexDirection: "column", padding: 0 }}>
            {/* Transparent absolute-positioned handle at the top allows selection/dragging without visual changes */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "16px",
                zIndex: 10,
                cursor: "move",
                background: "transparent",
              }}
            />
            <div style={{ flex: 1, width: "100%", height: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }} data-cv-no-drag="true">
              <iframe
                src={embedSrc}
                allow={config.attrs.allow}
                allowFullScreen={config.attrs.allowFullScreen}
                sandbox={config.attrs.sandbox}
                style={{
                  border: "none",
                  backgroundColor: "var(--bg-primary)",
                  pointerEvents: "auto",
                  ...config.attrs.style,
                  width: "100%",
                  height: "100%",
                  maxWidth: "none",
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Floating Toggle Button outside the frame for Link Nodes */}
      {node.type === "link" && (() => {
        const url = (node as CanvasLinkNode).url || "";
        const isNoEmbed = url.includes("#no-embed");
        const cleanUrl = url.replace(/#no-embed/g, "").trim();

        return (
          <button
            className="url-preview-toggle-floating cv-link-embed-toggle"
            title={isNoEmbed ? "Convert to Iframe Embed" : "Convert to Link only"}
            onClick={(e) => {
              e.stopPropagation();
              if (isNoEmbed) {
                onUpdateNode?.(node.id, { url: cleanUrl });
              } else {
                onUpdateNode?.(node.id, { url: cleanUrl + "#no-embed" });
              }
            }}
            data-cv-no-drag="true"
          >
            {isNoEmbed ? (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            )}
          </button>
        );
      })()}
    </div>
  );
}

function areNodeCardPropsEqual(prev: NodeCardProps, next: NodeCardProps) {
  return (
    prev.nodeId === next.nodeId &&
    prev.node === next.node &&
    prev.selected === next.selected &&
    prev.editing === next.editing &&
    prev.editText === next.editText &&
    prev.vaultPath === next.vaultPath &&
    prev.enableMarkdownPreview === next.enableMarkdownPreview &&
    prev.onUpdateNode === next.onUpdateNode
  );
}

const MemoNodeCard = React.memo(NodeCard, areNodeCardPropsEqual);
