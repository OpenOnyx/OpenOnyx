/**
 * TabPreviewCard — Rich floating hover preview for titlebar tabs
 *
 * Renders a scaled-down miniature of the actual note content including:
 * - Formatted markdown (headings, bold, italic, lists, code, blockquotes)
 * - Embedded image thumbnails
 * - YouTube embed placeholders
 * - Canvas/document structure
 *
 * Center-aligned below the hovered tab via a React portal.
 */
import React, { useEffect, useState, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { marked } from "marked";
import { getAPI } from "../../utils/api";

/* ── Constants ─────────────────────────────────────── */
const CARD_WIDTH = 240;
const CARD_CONTENT_HEIGHT = 260;
const HOVER_DELAY_MS = 180;
const SCALE_FACTOR = 0.55; // scale-down for miniature effect

/* ── Types ─────────────────────────────────────────── */
interface TabPreviewCardProps {
  tabName: string;
  tabPath: string;
  targetRect: DOMRect | null;
  visible: boolean;
}

/* ── Markdown-to-HTML mini renderer ────────────────── */

function stripFrontmatter(md: string): string {
  return md.replace(/^---[\s\S]*?---\s*/m, "").trim();
}

/** Extract YouTube video ID from common embed/link patterns */
function extractYouTubeId(url: string): string | null {
  const m =
    url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    url.match(/!\[.*?\]\(.*?youtube.*?([a-zA-Z0-9_-]{11}).*?\)/);
  return m ? m[1] : null;
}

/** Convert markdown to rich HTML for preview rendering using marked */
function markdownToPreviewHTML(raw: string): string {
  const md = stripFrontmatter(raw);
  
  // Swap block markdown markers and opening HTML tags (e.g. <span style="...">## Heading</span> -> ## <span style="...">Heading</span>)
  let processed = md.replace(
    /^([ \t]*)(<[a-zA-Z]+[^>]*>)(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/gm,
    "$1$3$2"
  );

  // Convert ==highlight== to <mark>highlight</mark> (multiline and boundary-aware)
  processed = processed.replace(
    /(^|\s|(?<=<[a-zA-Z]+[^>]*>))(==)([^\s=](?:[^\n=]*?[^\s=])?)(==)(?=\s|[.,;:!?\x27\x22]|$)/g,
    "$1<mark>$3</mark>"
  );

  try {
    return marked.parse(processed, { async: false, breaks: true }) as string;
  } catch (e) {
    return escapeHtml(processed);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CANVAS_PRESET_COLOR_MAP: Record<string, string> = {
  "1": "#ef4444",
  "2": "#f97316",
  "3": "#eab308",
  "4": "#22c55e",
  "5": "#06b6d4",
  "6": "#a855f7",
};

function resolveNodeColor(color?: string): string | undefined {
  if (!color) return undefined;
  return CANVAS_PRESET_COLOR_MAP[color] || color;
}

function getCleanFileName(filePath: string): string {
  const name = filePath.split("/").pop() || filePath;
  return name.replace(/\.md$/i, "").replace(/\.canvas$/i, "");
}

function getCanvasScribbles(data: any): any[] {
  if (Array.isArray(data.openonyxScribblesV1)) return data.openonyxScribblesV1;
  if (Array.isArray(data.openobsidianScribblesV1)) return data.openobsidianScribblesV1;
  if (Array.isArray(data.scribbles)) return data.scribbles;
  if (Array.isArray(data.noteworkScribblesV1)) return data.noteworkScribblesV1;
  return [];
}

/** 2D Spatial Canvas mini preview renderer */
function canvasToPreviewHTML(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const nodes: any[] = Array.isArray(data.nodes) ? data.nodes : [];
    const edges: any[] = Array.isArray(data.edges) ? data.edges : [];
    const scribbles: any[] = getCanvasScribbles(data);

    const totalItems = nodes.length + scribbles.length + edges.length;
    if (totalItems === 0) {
      return `<div style="padding:160px 0; text-align:center; font-style:italic; font-size:14px; color:var(--text-muted);">Empty canvas</div>`;
    }

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const n of nodes) {
      const nx = typeof n.x === "number" ? n.x : 0;
      const ny = typeof n.y === "number" ? n.y : 0;
      const nw = typeof n.width === "number" ? Math.max(n.width, 100) : 260;
      const nh = typeof n.height === "number" ? Math.max(n.height, 60) : 160;

      if (nx < minX) minX = nx;
      if (nx + nw > maxX) maxX = nx + nw;
      if (ny < minY) minY = ny;
      if (ny + nh > maxY) maxY = ny + nh;
    }

    for (const s of scribbles) {
      if (Array.isArray(s.points)) {
        for (const pt of s.points) {
          if (typeof pt.x === "number" && typeof pt.y === "number") {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = 0; maxX = 800; minY = 0; maxY = 600;
    }

    // Add padding percentage
    const widthRange = Math.max(maxX - minX, 100);
    const heightRange = Math.max(maxY - minY, 100);
    const padX = Math.max(widthRange * 0.06, 24);
    const padY = Math.max(heightRange * 0.06, 24);

    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;

    const totalW = maxX - minX;
    const totalH = maxY - minY;

    // Map node centers for edge connections
    const nodeCenters: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      if (n.id) {
        const nx = typeof n.x === "number" ? n.x : 0;
        const ny = typeof n.y === "number" ? n.y : 0;
        const nw = typeof n.width === "number" ? Math.max(n.width, 100) : 260;
        const nh = typeof n.height === "number" ? Math.max(n.height, 60) : 160;
        nodeCenters[n.id] = {
          x: (((nx + nw / 2 - minX) / totalW) * 100),
          y: (((ny + nh / 2 - minY) / totalH) * 100),
        };
      }
    }

    // Sort nodes so groups are rendered at the back
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.type === "group" && b.type !== "group") return -1;
      if (a.type !== "group" && b.type === "group") return 1;
      return 0;
    });

    let html = `<div style="position:relative; width:100%; height:470px; background:var(--bg-primary, #121316); border-radius:8px; border:1px solid var(--border-subtle, rgba(255,255,255,0.08)); overflow:hidden; background-image:radial-gradient(rgba(255,255,255,0.14) 1.2px, transparent 1.2px); background-size:16px 16px; box-sizing:border-box;">`;

    // SVG layer for edges and scribbles
    html += `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1;">`;
    
    // Draw edges
    for (const edge of edges) {
      const from = nodeCenters[edge.fromNode];
      const to = nodeCenters[edge.toNode];
      if (from && to) {
        const strokeColor = resolveNodeColor(edge.color) || "rgba(255,255,255,0.45)";
        html += `<line x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" stroke="${strokeColor}" stroke-width="1.2" stroke-dasharray="${edge.style === 'dashed' ? '3,3' : 'none'}" />`;
      }
    }

    // Draw scribbles
    for (const s of scribbles) {
      if (Array.isArray(s.points) && s.points.length > 0) {
        const ptsString = s.points
          .map((pt: any) => {
            const px = (((pt.x - minX) / totalW) * 100).toFixed(2);
            const py = (((pt.y - minY) / totalH) * 100).toFixed(2);
            return `${px},${py}`;
          })
          .join(" ");
        const strokeColor = s.color || "rgba(249,250,251,0.85)";
        const strokeWidth = typeof s.width === "number" ? Math.min(s.width * 0.5, 2) : 1;
        html += `<polyline points="${ptsString}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
      }
    }
    html += `</svg>`;

    // Render nodes spatially
    for (const n of sortedNodes) {
      const nx = typeof n.x === "number" ? n.x : 0;
      const ny = typeof n.y === "number" ? n.y : 0;
      const nw = typeof n.width === "number" ? Math.max(n.width, 100) : 260;
      const nh = typeof n.height === "number" ? Math.max(n.height, 60) : 160;

      const left = (((nx - minX) / totalW) * 100).toFixed(2);
      const top = (((ny - minY) / totalH) * 100).toFixed(2);
      const width = ((nw / totalW) * 100).toFixed(2);
      const height = ((nh / totalH) * 100).toFixed(2);

      const accentColor = resolveNodeColor(n.color);

      if (n.type === "group") {
        const groupTitle = escapeHtml(n.label || "GROUP NAME");
        const borderColor = accentColor || "#ef4444";
        const bg = accentColor ? `${accentColor}18` : "rgba(239, 68, 68, 0.1)";

        html += `<div style="position:absolute; left:${left}%; top:${top}%; width:${width}%; height:${height}%; border:2px dashed ${borderColor}; background:${bg}; border-radius:8px; box-sizing:border-box; z-index:2;">`;
        html += `<div style="position:absolute; top:-12px; left:10px; background:${borderColor}; color:#ffffff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px;">${groupTitle}</div>`;
        html += `</div>`;
      } else {
        const cardBorder = accentColor ? `1.5px solid ${accentColor}` : `1px dashed var(--border-medium, rgba(255,255,255,0.22))`;
        const cardBg = "var(--bg-elevated, rgba(26,28,32,0.95))";

        let bodyHtml = "";
        if (n.type === "file") {
          const cleanName = escapeHtml(getCleanFileName(n.file || ""));
          bodyHtml = `<div style="font-weight:700; font-size:13px; color:var(--text-primary); text-align:center; display:flex; align-items:center; justify-content:center; gap:4px;"><span>📄</span><span>${cleanName}</span></div>`;
        } else if (n.type === "link") {
          bodyHtml = `<div style="font-size:11px; color:var(--color-accent, #3b82f6); text-align:center; text-decoration:underline;">${escapeHtml(n.url || '')}</div>`;
        } else {
          const rawText = n.text || n.label || "";
          bodyHtml = `<div style="font-size:12px; color:var(--text-primary); line-height:1.4; overflow:hidden; word-break:break-word;">${marked.parseInline(rawText.slice(0, 160))}</div>`;
        }

        html += `<div style="position:absolute; left:${left}%; top:${top}%; width:${width}%; height:${height}%; background:${cardBg}; border:${cardBorder}; border-radius:7px; padding:10px 12px; box-sizing:border-box; z-index:3; display:flex; flex-direction:column; justify-content:center; align-items:center; box-shadow:0 4px 14px rgba(0,0,0,0.35); overflow:hidden;">`;
        if (n.locked) {
          html += `<span style="position:absolute; top:4px; right:6px; font-size:9px; color:var(--text-muted); opacity:0.6; font-weight:600;">Locked</span>`;
        }
        html += bodyHtml;
        html += `</div>`;
      }
    }

    html += `</div>`;
    return html;
  } catch {
    return `<div style="padding:160px 0; text-align:center; font-size:14px; color:var(--text-muted);">🎨 Canvas File</div>`;
  }
}

/* ── Component ─────────────────────────────────────── */

export const TabPreviewCard = React.memo(function TabPreviewCard({
  tabName,
  tabPath,
  targetRect,
  visible,
}: TabPreviewCardProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch file content on hover
  useEffect(() => {
    if (!visible || !tabPath) {
      setContent("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    const api = getAPI();
    api
      .readFile(tabPath)
      .then((raw) => {
        if (cancelled) return;
        setContent(raw || "");
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setContent("");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tabPath]);

  // Render markdown or canvas to HTML
  const previewHTML = useMemo(() => {
    if (!content) return "";
    const isCanvas = tabPath.toLowerCase().endsWith(".canvas") || content.trim().startsWith("{");
    if (isCanvas) {
      return canvasToPreviewHTML(content);
    }
    return markdownToPreviewHTML(content);
  }, [content, tabPath]);

  if (!visible || !targetRect) return null;

  // Center-align below the tab
  let left = targetRect.left + targetRect.width / 2 - CARD_WIDTH / 2;
  const top = targetRect.bottom + 42;
  // Clamp to viewport edges
  left = Math.max(8, Math.min(left, window.innerWidth - CARD_WIDTH - 8));

  return ReactDOM.createPortal(
    <div
      className="tab-preview-portal"
      style={{
        position: "fixed",
        left,
        top,
        width: CARD_WIDTH,
        zIndex: 9999,
        pointerEvents: "none",
        animation: "tabPreviewFadeIn 120ms ease-out",
      }}
    >
      {/* ── Content preview card ── */}
      <div className="tab-preview-card">
        {loading ? (
          <div className="tab-preview-loading">
            <div className="tab-preview-skeleton" />
            <div className="tab-preview-skeleton" style={{ width: "72%" }} />
            <div className="tab-preview-skeleton" style={{ width: "55%" }} />
          </div>
        ) : previewHTML ? (
          <div className="tab-preview-content-scaler">
            <div
              ref={contentRef}
              className="tab-preview-content-inner markdown-rendered"
              dangerouslySetInnerHTML={{ __html: previewHTML }}
            />
          </div>
        ) : (
          <div className="tab-preview-empty">Empty note</div>
        )}
      </div>
    </div>,
    document.body
  );
});

export { HOVER_DELAY_MS };
