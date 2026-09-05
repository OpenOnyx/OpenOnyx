/**
 * Graph Renderer using pure Canvas2D
 * No WebGL dependencies - guaranteed compatibility with Electron
 * Matches Obsidian's visual style and interactions
 */

export interface RendererOptions {
  width: number;
  height: number;
  backgroundColor: number;
  isDark: boolean;
}

export interface NodeStyle {
  color: number;
  size: number;
  selectedColor: number;
  hoveredColor: number;
  connectedColor: number;
  dimmedAlpha: number;
}

export interface EdgeStyle {
  color: number;
  width: number;
  highlightColor: number;
  highlightWidth: number;
  alpha: number;
  dimmedAlpha: number;
}

export interface LabelStyle {
  color: string;
  size: number;
  show: boolean;
  threshold: number;
}

interface RenderNode {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  connections: number;
  color?: number;
}

interface RenderEdge {
  source: string;
  target: string;
  directed?: boolean;
  similarity?: number;
  hiddenConnection?: boolean;
}

interface InputNode {
  id: string;
  name: string;
  path: string;
  x?: number;
  y?: number;
  connections?: number;
  color?: number;
}

interface InputEdge {
  source: string;
  target: string;
  directed?: boolean;
  similarity?: number;
  hiddenConnection?: boolean;
}

// Helper to convert hex number to CSS color string
function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}

function hexToColor(hex: number, alpha = 1): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class GraphRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;

  private nodes = new Map<string, RenderNode>();
  private edges: RenderEdge[] = [];
  private adjacencyMap = new Map<string, Set<string>>();

  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  public selectedEdge: RenderEdge | null = null;
  public highlightedPathNodeIds: Set<string> | null = null;
  public highlightedPathEdges: Set<string> | null = null;

  private onNodeClick?: (nodeId: string) => void;
  private onEdgeClick?: (sourceId: string, targetId: string) => void;

  private width: number;
  private height: number;
  private dpr = 1;
  private scale = 1;
  private targetScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private targetOffsetX = 0;
  private targetOffsetY = 0;
  private backgroundColor: number;
  private isDark: boolean;

  private initialized = false;
  private isDragging = false;
  private isPanning = false;
  private dragNode: RenderNode | null = null;
  private lastPointerPos = { x: 0, y: 0 };
  private pointerDownPos = { x: 0, y: 0 };
  private animationFrame: number | null = null;
  private needsRender = false;
  private cachedRect: DOMRect | null = null;
  private cachedNodeRadii = new Map<string, number>();

  // Obsidian-style colors
  private nodeStyle: NodeStyle = {
    color: 0x7f7f7f, // Gray (Obsidian default)
    size: 5,
    selectedColor: 0x7f7f7f,
    hoveredColor: 0x7f7f7f,
    connectedColor: 0x7f7f7f,
    dimmedAlpha: 0.15,
  };

  private edgeStyle: EdgeStyle = {
    color: 0x7f7f7f,
    width: 1,
    highlightColor: 0x7f7f7f,
    highlightWidth: 2,
    alpha: 1.0,      // Base alpha (fQ=0.2 dimming handled in drawEdges)
    dimmedAlpha: 0.2, // Match Obsidian's fQ constant
  };

  private labelStyle: LabelStyle = {
    color: "#7f7f7f",
    size: 11,
    show: true,
    threshold: 0.4,
  };

  private onNodeDrag?: (
    nodeId: string,
    x: number,
    y: number,
    active: boolean,
  ) => void;
  private onViewportChange?: (x: number, y: number, scale: number) => void;

  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private pointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((e: PointerEvent) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options: Partial<RendererOptions> = {},
  ) {
    this.canvas = canvas;
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.isDark = options.isDark ?? true;
    this.backgroundColor =
      options.backgroundColor ?? (this.isDark ? 0x101010 : 0xf0f0f6);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const minDimension = 100;
    const safeWidth = Math.max(this.width, minDimension);
    const safeHeight = Math.max(this.height, minDimension);

    this.width = safeWidth;
    this.height = safeHeight;
    
    // Use native DPR for performance (no artificial upscaling)
    const baseDpr = window.devicePixelRatio || 1;
    this.dpr = baseDpr;

    // Setup canvas with proper HiDPI scaling
    this.canvas.width = Math.floor(safeWidth * this.dpr);
    this.canvas.height = Math.floor(safeHeight * this.dpr);
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;

    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) {
      throw new Error("Failed to get 2D context");
    }

    // Center the viewport
    this.offsetX = this.width / 2;
    this.offsetY = this.height / 2;
    this.targetOffsetX = this.offsetX;
    this.targetOffsetY = this.offsetY;

    this.setupInteraction();
    this.startAnimationLoop();

    this.initialized = true;
  }

  private setupInteraction(): void {
    this.wheelHandler = this.handleWheel.bind(this);
    this.canvas.addEventListener("wheel", this.wheelHandler, {
      passive: false,
    });

    this.pointerDownHandler = this.handlePointerDown.bind(this);
    this.pointerMoveHandler = this.handlePointerMove.bind(this);
    this.pointerUpHandler = this.handlePointerUp.bind(this);

    this.canvas.addEventListener("pointerdown", this.pointerDownHandler);
    this.canvas.addEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.addEventListener("pointerup", this.pointerUpHandler);
    this.canvas.addEventListener(
      "pointerleave",
      this.handlePointerLeave.bind(this),
    );
  }

  private startAnimationLoop(): void {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);

      // Keep zoom eased, but responsive enough that wheel input does not trail
      // behind the cursor on large graphs.
      const zoomLerp = 0.35;
      const panLerp = 0.35;

      const scaleDiff = Math.abs(this.targetScale - this.scale);
      const offsetXDiff = Math.abs(this.targetOffsetX - this.offsetX);
      const offsetYDiff = Math.abs(this.targetOffsetY - this.offsetY);

      if (scaleDiff > 0.001 || offsetXDiff > 0.5 || offsetYDiff > 0.5) {
        this.scale = scaleDiff < 0.003
          ? this.targetScale
          : this.scale + (this.targetScale - this.scale) * zoomLerp;
        this.offsetX = offsetXDiff < 0.75
          ? this.targetOffsetX
          : this.offsetX + (this.targetOffsetX - this.offsetX) * panLerp;
        this.offsetY = offsetYDiff < 0.75
          ? this.targetOffsetY
          : this.offsetY + (this.targetOffsetY - this.offsetY) * panLerp;
        this.needsRender = true;
      }

      // Batched rendering: only draw once per frame regardless of how many
      // times render() was called (simulation ticks, hover, drag, zoom)
      if (this.needsRender) {
        this.needsRender = false;
        this.actualRender();
      }
    };

    animate();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.getRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Smooth zoom factor (Obsidian style)
      const zoomFactor = Math.pow(1.5, -e.deltaY / 120);
      const newScale = Math.max(1 / 128, Math.min(8, this.targetScale * zoomFactor));

      // Zoom towards the point currently under the cursor. Using the visible
      // transform avoids the "rubber band" feel when wheel events arrive faster
      // than the eased target catches up.
      const worldX = (mouseX - this.offsetX) / this.scale;
      const worldY = (mouseY - this.offsetY) / this.scale;

      this.targetScale = newScale;
      this.targetOffsetX = mouseX - worldX * newScale;
      this.targetOffsetY = mouseY - worldY * newScale;

      const immediateLerp = 0.45;
      this.scale += (this.targetScale - this.scale) * immediateLerp;
      this.offsetX += (this.targetOffsetX - this.offsetX) * immediateLerp;
      this.offsetY += (this.targetOffsetY - this.offsetY) * immediateLerp;
      this.needsRender = true;

      this.onViewportChange?.(
        this.targetOffsetX,
        this.targetOffsetY,
        this.targetScale,
      );
    } else {
      // Pan
      const dx = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaX * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaX * window.innerWidth
          : e.deltaX;

      const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaY * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaY * window.innerHeight
          : e.deltaY;

      this.targetOffsetX -= dx;
      this.targetOffsetY -= dy;
      this.offsetX = this.targetOffsetX;
      this.offsetY = this.targetOffsetY;
      this.needsRender = true;

      this.onViewportChange?.(
        this.targetOffsetX,
        this.targetOffsetY,
        this.targetScale,
      );
    }
  }

  private getRect(): DOMRect {
    if (!this.cachedRect) {
      this.cachedRect = this.canvas.getBoundingClientRect();
    }
    return this.cachedRect;
  }

  private invalidateRect(): void {
    this.cachedRect = null;
  }

  private handlePointerDown(e: PointerEvent): void {
    const rect = this.getRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.lastPointerPos = { x, y };
    this.pointerDownPos = { x, y };

    const node = this.getNodeAtPosition(x, y);
    if (node) {
      this.dragNode = node;
      this.isDragging = true;
      this.onNodeDrag?.(node.id, node.x, node.y, true);
    } else {
      this.isPanning = true;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const rect = this.getRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dx = x - this.lastPointerPos.x;
    const dy = y - this.lastPointerPos.y;
    this.lastPointerPos = { x, y };

    if (this.isDragging && this.dragNode) {
      this.dragNode.x += dx / this.scale;
      this.dragNode.y += dy / this.scale;
      this.needsRender = true;
      this.onNodeDrag?.(
        this.dragNode.id,
        this.dragNode.x,
        this.dragNode.y,
        true,
      );
    } else if (this.isPanning) {
      this.targetOffsetX += dx;
      this.targetOffsetY += dy;
      this.offsetX = this.targetOffsetX;
      this.offsetY = this.targetOffsetY;
      this.needsRender = true;
      this.onViewportChange?.(this.offsetX, this.offsetY, this.scale);
    } else {
      // Hover detection
      const node = this.getNodeAtPosition(x, y);
      const newHoveredId = node?.id || null;
      if (newHoveredId !== this.hoveredNodeId) {
        this.hoveredNodeId = newHoveredId;
        this.needsRender = true;
      }
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    const rect = this.getRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const movedDistance = Math.hypot(
      x - this.pointerDownPos.x,
      y - this.pointerDownPos.y,
    );
    const clickThreshold = 5;

    if (this.isDragging && this.dragNode) {
      this.onNodeDrag?.(
        this.dragNode.id,
        this.dragNode.x,
        this.dragNode.y,
        false,
      );
      if (movedDistance <= clickThreshold) {
        this.selectedNodeId = this.dragNode.id;
        this.render();
        this.onNodeClick?.(this.dragNode.id);
      }
    } else if (
      !this.isPanning ||
      (Math.abs(x - this.lastPointerPos.x) < 5 &&
        Math.abs(y - this.lastPointerPos.y) < 5)
    ) {
      const node = this.getNodeAtPosition(x, y);
      if (node) {
        this.selectedNodeId = node.id;
        this.selectedEdge = null;
        this.render();
        this.onNodeClick?.(node.id);
      } else {
        const edge = this.getEdgeAtPosition(x, y);
        if (edge) {
          this.selectedEdge = edge;
          this.selectedNodeId = null;
          this.render();
          this.onEdgeClick?.(edge.source, edge.target);
        } else if (this.selectedNodeId || this.selectedEdge) {
          this.selectedNodeId = null;
          this.selectedEdge = null;
          this.render();
          this.onEdgeClick?.("", "");
        }
      }
    }

    this.isDragging = false;
    this.isPanning = false;
    this.dragNode = null;
  }

  private handlePointerLeave(): void {
    this.isPanning = false;
    this.isDragging = false;
    this.dragNode = null;
    if (this.hoveredNodeId) {
      this.hoveredNodeId = null;
      this.render();
    }
  }

  private getEdgeAtPosition(
    screenX: number,
    screenY: number,
  ): RenderEdge | null {
    const worldX = (screenX - this.offsetX) / this.scale;
    const worldY = (screenY - this.offsetY) / this.scale;

    const hitThreshold = 8 / this.scale;
    let closest: RenderEdge | null = null;
    let closestDist = hitThreshold;

    const distanceToSegment = (
      x: number, y: number,
      x1: number, y1: number,
      x2: number, y2: number
    ): number => {
      const A = x - x1;
      const B = y - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) {
        param = dot / lenSq;
      }

      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }

      const dx = x - xx;
      const dy = y - yy;
      return Math.sqrt(dx * dx + dy * dy);
    };

    for (const edge of this.edges) {
      const sourceNode = this.nodes.get(edge.source);
      const targetNode = this.nodes.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      const dist = distanceToSegment(worldX, worldY, sourceNode.x, sourceNode.y, targetNode.x, targetNode.y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = edge;
      }
    }

    return closest;
  }

  private getNodeAtPosition(
    screenX: number,
    screenY: number,
  ): RenderNode | null {
    const worldX = (screenX - this.offsetX) / this.scale;
    const worldY = (screenY - this.offsetY) / this.scale;

    const hitRadius = 15 / this.scale;
    let closest: RenderNode | null = null;
    let closestDist = hitRadius;

    for (const node of this.nodes.values()) {
      const dx = node.x - worldX;
      const dy = node.y - worldY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = node;
      }
    }

    return closest;
  }

  /** Mark the renderer as needing a redraw. Actual drawing happens in the animation loop. */
  public render(): void {
    this.needsRender = true;
  }

  /** Actual rendering -- called once per frame by the animation loop. */
  private actualRender(): void {
    if (!this.ctx) return;

    const ctx = this.ctx;

    // Clear and fill background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const hasWallpaper = typeof document !== "undefined" && document.querySelector(".app.has-wallpaper") !== null;
    if (hasWallpaper) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = hexToColor(this.backgroundColor);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Cache node radii for this frame (used by edges, nodes, and labels)
    this.updateNodeRadiiCache();

    // Apply DPR and viewport transform
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(Math.round(this.offsetX), Math.round(this.offsetY));
    ctx.scale(this.scale, this.scale);

    // Draw edges
    this.drawEdges(ctx);

    // Draw nodes
    this.drawNodes(ctx);

    // Draw labels (in screen space)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels(ctx);
  }

  /** Pre-compute node radii once per frame instead of per-edge. */
  private updateNodeRadiiCache(): void {
    const nodeScale = Math.sqrt(1 / this.scale);
    const sizeMult = this.nodeStyle.size / 5;
    this.cachedNodeRadii.clear();
    for (const node of this.nodes.values()) {
      const baseRadius = sizeMult * Math.max(8, Math.min(3 * Math.sqrt(node.connections + 1), 30));
      this.cachedNodeRadii.set(node.id, baseRadius * nodeScale);
    }
  }

  private drawEdges(ctx: CanvasRenderingContext2D): void {
    const highlightNode = this.hoveredNodeId || this.selectedNodeId;

    // Viewport bounds in world coordinates with margin
    const padding = 50 / this.scale;
    const viewMinX = -this.offsetX / this.scale - padding;
    const viewMaxX = (this.width - this.offsetX) / this.scale + padding;
    const viewMinY = -this.offsetY / this.scale - padding;
    const viewMaxY = (this.height - this.offsetY) / this.scale + padding;

    // Obsidian constants
    const fQ = 0.2;
    const zoomAlphaFactor = Math.max(0, Math.min(1, 2 * (this.scale - 0.3)));
    const lineThickness = this.edgeStyle.width / this.scale;

    ctx.lineCap = "butt";

    for (let pass = 0; pass < 2; pass++) {
      const isHighlightPass = pass === 1;

      for (const edge of this.edges) {
        const sourceNode = this.nodes.get(edge.source);
        const targetNode = this.nodes.get(edge.target);
        if (!sourceNode || !targetNode) continue;

        // Viewport culling: skip if both endpoints are outside the viewport in the same direction
        if (
          (sourceNode.x < viewMinX && targetNode.x < viewMinX) ||
          (sourceNode.x > viewMaxX && targetNode.x > viewMaxX) ||
          (sourceNode.y < viewMinY && targetNode.y < viewMinY) ||
          (sourceNode.y > viewMaxY && targetNode.y > viewMaxY)
        ) {
          continue;
        }

        const isSelectedEdge = this.selectedEdge && (
          (edge.source === this.selectedEdge.source && edge.target === this.selectedEdge.target) ||
          (edge.source === this.selectedEdge.target && edge.target === this.selectedEdge.source)
        );

        const isPathEdgeHighlighted = this.highlightedPathEdges && (
          this.highlightedPathEdges.has(edge.source + "::" + edge.target) ||
          this.highlightedPathEdges.has(edge.target + "::" + edge.source)
        );

        const isHighlighted = this.highlightedPathEdges
          ? Boolean(isPathEdgeHighlighted)
          : Boolean(
              edge.source === highlightNode ||
              edge.target === highlightNode ||
              isSelectedEdge
            );

        // Skip edges not belonging to this pass
        if (isHighlightPass !== isHighlighted && (highlightNode || this.highlightedPathEdges)) continue;

        let baseAlpha = fQ;
        if ((!highlightNode && !this.highlightedPathEdges) || isHighlighted) baseAlpha = 1;

        const color = isHighlighted
          ? this.edgeStyle.highlightColor
          : this.edgeStyle.color;
        const alpha = baseAlpha * this.edgeStyle.alpha;
        if (alpha < 0.001) continue;

        // Use cached radii
        const sourceRadius = this.cachedNodeRadii.get(edge.source) || 0;
        const targetRadius = this.cachedNodeRadii.get(edge.target) || 0;

        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.001) continue;

        const ux = dx / length;
        const uy = dy / length;

        const startX = sourceNode.x + ux * sourceRadius;
        const startY = sourceNode.y + uy * sourceRadius;
        const endX = targetNode.x - ux * targetRadius;
        const endY = targetNode.y - uy * targetRadius;

        if (length - sourceRadius - targetRadius < 0.5) continue;

        ctx.strokeStyle = hexToColor(color, alpha);
        const similarityFactor = edge.similarity ? (edge.similarity * 2.2) : 1.0;
        ctx.lineWidth = lineThickness * similarityFactor;

        if (edge.hiddenConnection) {
          ctx.setLineDash([4 / this.scale, 4 / this.scale]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
    // Clean up dash
    ctx.setLineDash([]);
  }

  private drawNodes(ctx: CanvasRenderingContext2D): void {
    const highlightNode = this.hoveredNodeId || this.selectedNodeId;
    const connectedToHighlight = highlightNode
      ? this.adjacencyMap.get(highlightNode)
      : null;

    // Viewport bounds in world coordinates with margin
    const padding = 50 / this.scale;
    const viewMinX = -this.offsetX / this.scale - padding;
    const viewMaxX = (this.width - this.offsetX) / this.scale + padding;
    const viewMinY = -this.offsetY / this.scale - padding;
    const viewMaxY = (this.height - this.offsetY) / this.scale + padding;

    // Obsidian constants
    const fQ = 0.2;

    for (const node of this.nodes.values()) {
      const isSelected = node.id === this.selectedNodeId;
      const isHovered = node.id === this.hoveredNodeId;
      if (!isSelected && !isHovered) {
        if (node.x < viewMinX || node.x > viewMaxX || node.y < viewMinY || node.y > viewMaxY) {
          continue;
        }
      }
      const isHighlightNode = isSelected || isHovered;
      const isConnected = connectedToHighlight?.has(node.id) ?? false;

      let isDimmed = highlightNode && !isHighlightNode && !isConnected;
      if (this.highlightedPathNodeIds) {
        isDimmed = !this.highlightedPathNodeIds.has(node.id);
      }

      let color = node.color ?? this.nodeStyle.color;
      if (isSelected) color = this.nodeStyle.selectedColor;
      else if (isHovered) color = this.nodeStyle.hoveredColor;
      else if (isConnected) color = this.nodeStyle.connectedColor;

      // Use pre-cached radius
      const size = this.cachedNodeRadii.get(node.id) || 8;

      // Obsidian-style alpha: dimmed nodes use fQ (0.2), highlighted/normal use 1
      const alpha = isDimmed ? fQ : 1;

      // Draw node circle
      ctx.fillStyle = hexToColor(color, alpha);
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
      ctx.fill();

      // Obsidian draws a highlight ring around the hovered/selected node
      if (isHighlightNode || (this.highlightedPathNodeIds && this.highlightedPathNodeIds.has(node.id) && !isDimmed)) {
        const ringWidth = Math.max(1, Math.sqrt(this.scale) / this.scale);
        ctx.strokeStyle = hexToColor(isHighlightNode ? this.edgeStyle.highlightColor : color, 0.8);
        ctx.lineWidth = ringWidth;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + ringWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D): void {
    if (!this.labelStyle.show) return;

    // Obsidian-parity text fade: textAlpha = clamp(log2(scale) + 1 - fTextShowMult, 0, 1)
    const n = Math.log(this.scale) / Math.log(2);
    const textAlpha = Math.max(0, Math.min(1, n + 1 - (1 - this.labelStyle.threshold)));
    
    // Draw labels if textAlpha is positive or if a node is currently hovered
    if (textAlpha <= 0 && !this.hoveredNodeId) return;

    // Obsidian's font stack for graph labels
    ctx.font = `${this.labelStyle.size}px ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const highlightNode = this.hoveredNodeId || this.selectedNodeId;
    const connectedToHighlight = highlightNode
      ? this.adjacencyMap.get(highlightNode)
      : null;

    // Parse label color once outside loop
    let r = 127, g = 127, b = 127;
    if (this.labelStyle.color.startsWith("#")) {
      r = parseInt(this.labelStyle.color.slice(1, 3), 16);
      g = parseInt(this.labelStyle.color.slice(3, 5), 16);
      b = parseInt(this.labelStyle.color.slice(5, 7), 16);
    }

    // Obsidian fQ constant for dimming
    const fQ = 0.2;

    const fontStack = `ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", sans-serif`;
    const defaultFont = `${this.labelStyle.size}px ${fontStack}`;
    ctx.font = defaultFont;

    for (const node of this.nodes.values()) {
      const screenX = this.offsetX + node.x * this.scale;
      const screenY = this.offsetY + node.y * this.scale;

      if (
        screenX < -100 ||
        screenX > this.width + 100 ||
        screenY < -100 ||
        screenY > this.height + 100
      ) {
        continue;
      }

      const isHovered = node.id === this.hoveredNodeId;
      
      // When zoomed out past threshold, only render the hovered node's label
      if (textAlpha <= 0 && !isHovered) {
        continue;
      }

      let alpha = textAlpha;
      if (isHovered) {
        alpha = 1.0;
      } else {
        // Dim labels for unrelated nodes (matching edge/node dimming logic)
        const isSelected = node.id === this.selectedNodeId;
        const isHighlightNode = isHovered || isSelected;
        const isConnected = connectedToHighlight?.has(node.id) ?? false;

        if (this.highlightedPathNodeIds) {
          if (!this.highlightedPathNodeIds.has(node.id)) {
            alpha *= fQ;
          }
        } else if (highlightNode && !isHighlightNode && !isConnected) {
          alpha *= fQ;
        }
      }

      if (alpha <= 0) continue;

      if (isHovered) {
        const hoveredFontSize = Math.max(18, Math.round(this.labelStyle.size * 1.5));
        ctx.font = `bold ${hoveredFontSize}px ${fontStack}`;
      } else {
        ctx.font = defaultFont;
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

      // Use pre-cached radius for label placement
      const size = this.cachedNodeRadii.get(node.id) || 8;
      const labelY = screenY + size * this.scale + 4;

      ctx.fillText(node.name, Math.round(screenX), Math.round(labelY));
    }
  }

  setCallbacks(callbacks: {
    onNodeClick?: (nodeId: string) => void;
    onEdgeClick?: (sourceId: string, targetId: string) => void;
    onNodeDrag?: (
      nodeId: string,
      x: number,
      y: number,
      active: boolean,
    ) => void;
    onViewportChange?: (x: number, y: number, scale: number) => void;
  }): void {
    this.onNodeClick = callbacks.onNodeClick;
    this.onEdgeClick = callbacks.onEdgeClick;
    this.onNodeDrag = callbacks.onNodeDrag;
    this.onViewportChange = callbacks.onViewportChange;
  }

  setData(nodes: InputNode[], edges: InputEdge[]): void {
    if (!this.initialized) return;

    this.nodes.clear();
    this.edges = [];
    this.adjacencyMap.clear();

    // Build adjacency map
    for (const edge of edges) {
      if (!this.adjacencyMap.has(edge.source))
        this.adjacencyMap.set(edge.source, new Set());
      if (!this.adjacencyMap.has(edge.target))
        this.adjacencyMap.set(edge.target, new Set());
      this.adjacencyMap.get(edge.source)!.add(edge.target);
      this.adjacencyMap.get(edge.target)!.add(edge.source);
    }

    // Create nodes
    for (const node of nodes) {
      const connections = this.adjacencyMap.get(node.id)?.size || 0;
      
      // Radius is now calculated dynamically during render based on zoom

      this.nodes.set(node.id, {
        id: node.id,
        name: node.name,
        path: node.path,
        x: node.x || 0,
        y: node.y || 0,
        connections,
        color: node.color,
      });
    }

    this.edges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      directed: Boolean(e.directed),
      similarity: e.similarity,
      hiddenConnection: e.hiddenConnection,
    }));
    this.render();
  }

  updatePositionsFromArray(ids: string[], positions: Float32Array): void {
    for (let i = 0; i < ids.length; i++) {
      const node = this.nodes.get(ids[i]);
      if (node) {
        node.x = positions[i * 2];
        node.y = positions[i * 2 + 1];
      }
    }
    this.render();
  }

  setNodeStyle(style: Partial<NodeStyle>): void {
    Object.assign(this.nodeStyle, style);
    this.render();
  }

  setEdgeStyle(style: Partial<EdgeStyle>): void {
    Object.assign(this.edgeStyle, style);
    this.render();
  }

  setLabelStyle(style: Partial<LabelStyle>): void {
    Object.assign(this.labelStyle, style);
    this.render();
  }

  setBackgroundColor(color: number): void {
    this.backgroundColor = color;
    this.render();
  }

  selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.render();
  }

  centerView(): void {
    if (this.nodes.size === 0) return;

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const node of this.nodes.values()) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const padding = 100;
    const scaleX = (this.width - padding) / Math.max(graphWidth, 1);
    const scaleY = (this.height - padding) / Math.max(graphHeight, 1);
    this.targetScale = Math.min(scaleX, scaleY, 1.5);

    this.targetOffsetX = this.width / 2 - centerX * this.targetScale;
    this.targetOffsetY = this.height / 2 - centerY * this.targetScale;

    this.onViewportChange?.(
      this.targetOffsetX,
      this.targetOffsetY,
      this.targetScale,
    );
  }

  centerNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.targetScale = Math.max(this.scale, 0.85); // Zoom to a readable scale
    this.targetOffsetX = this.width / 2 - node.x * this.targetScale;
    this.targetOffsetY = this.height / 2 - node.y * this.targetScale;

    this.onViewportChange?.(
      this.targetOffsetX,
      this.targetOffsetY,
      this.targetScale,
    );
    this.render();
  }

  resize(width: number, height: number): void {
    const minDimension = 100;
    const safeWidth = Math.max(width, minDimension);
    const safeHeight = Math.max(height, minDimension);

    this.width = safeWidth;
    this.height = safeHeight;

    const baseDpr = window.devicePixelRatio || 1;
    this.dpr = baseDpr;
    this.invalidateRect();

    this.canvas.width = Math.floor(safeWidth * this.dpr);
    this.canvas.height = Math.floor(safeHeight * this.dpr);
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;

    this.render();
  }

  getAllPositions(): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, node] of this.nodes) {
      positions.set(id, { x: node.x, y: node.y });
    }
    return positions;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  destroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    if (this.wheelHandler) {
      this.canvas.removeEventListener("wheel", this.wheelHandler);
    }
    if (this.pointerDownHandler) {
      this.canvas.removeEventListener("pointerdown", this.pointerDownHandler);
    }
    if (this.pointerMoveHandler) {
      this.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    }
    if (this.pointerUpHandler) {
      this.canvas.removeEventListener("pointerup", this.pointerUpHandler);
    }

    this.nodes.clear();
    this.edges = [];
    this.adjacencyMap.clear();
    this.initialized = false;
  }
}
