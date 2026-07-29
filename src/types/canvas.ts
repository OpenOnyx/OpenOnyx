/**
 * Canvas Types - Following JSON Canvas Spec 1.0
 * https://jsoncanvas.org/spec/1.0
 */

// ── Color ────────────────────────────────────────────
export type CanvasColor = "1" | "2" | "3" | "4" | "5" | "6" | string;

export const CANVAS_PRESET_COLORS: Record<string, string> = {
  "1": "#fb464c", // red
  "2": "#e9973f", // orange
  "3": "#e0de71", // yellow
  "4": "#44cf6e", // green
  "5": "#53dfdd", // cyan
  "6": "var(--color-accent, var(--oo-accent, #E8A84A))", // theme accent
};

export function resolveCanvasColor(color?: CanvasColor): string | undefined {
  if (!color) return undefined;
  if (color.startsWith("#")) return color;
  return CANVAS_PRESET_COLORS[color] || undefined;
}

// ── Node Types ───────────────────────────────────────
export type CanvasNodeType = "text" | "file" | "link" | "group";
export type EdgeSide = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
export type GroupBackgroundStyle = "cover" | "ratio" | "repeat";

export interface CanvasNodeBase {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  locked?: boolean;
  opacity?: number;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: GroupBackgroundStyle;
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasFileNode
  | CanvasLinkNode
  | CanvasGroupNode;

// ── Edge Types ───────────────────────────────────────
export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: EdgeSide;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: EdgeSide;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
  width?: number;
  stretch?: number;
  fromStretch?: number;
  toStretch?: number;
  fromControlDx?: number;
  fromControlDy?: number;
  toControlDx?: number;
  toControlDy?: number;
  locked?: boolean;
}

// ── Canvas Document ──────────────────────────────────
export interface CanvasData {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
  [key: string]: unknown;
}

// ── Internal Canvas State ────────────────────────────
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DragState {
  type:
    | "none"
    | "pan"
    | "node"
    | "edge"
    | "select"
    | "resize"
    | "draw"
    | "erase"
    | "lasso"
    | "scribble-move"
    | "edge-stretch";
  nodeId?: string;
  startX: number;
  startY: number;
  movingIds?: Set<string>;
  originById?: Record<string, { x: number; y: number }>;
  resizeOrigin?: { x: number; y: number; width: number; height: number };
  offsetX?: number;
  offsetY?: number;
  edgeFromNode?: string;
  edgeFromSide?: EdgeSide;
  edgeId?: string;
  edgeStretchHandle?: "from" | "to";
  edgeStretchStart?: number;
  edgeStretchOrigin?: { x: number; y: number };
  edgeStretchControlStart?: { x: number; y: number };
  edgeStretchBaseDistance?: number;
  resizeHandle?: string;
  selectionBounds?: { x: number; y: number; width: number; height: number };
  selectionOriginById?: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
}

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasToolMode =
  | "select"
  | "pan"
  | "edge"
  | "draw"
  | "erase"
  | "lasso";

// Default sizes for new nodes
export const DEFAULT_NODE_WIDTH = 260;
export const DEFAULT_NODE_HEIGHT = 160;
export const DEFAULT_GROUP_WIDTH = 400;
export const DEFAULT_GROUP_HEIGHT = 300;
export const MIN_NODE_WIDTH = 120;
export const MIN_NODE_HEIGHT = 60;
export const GRID_SIZE = 20;
