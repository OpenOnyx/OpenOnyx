import { useEffect, useMemo, useRef, useState } from "react";
import graph from "../data/vault-graph.json";

type Node = { id: string; title: string; folder: string; x: number; y: number; vx: number; vy: number };
type Tip = { x: number; y: number; title: string; folder: string };

const FOLDER_TINT: Record<string, string> = {
  "00 - Inbox": "#f0d9a6",
  "01 - Projects": "#d8dde8",
  "03 - Resources": "#c8d4c4",
  "04 - Archive": "#b8b3ae",
  "05 - Daily Notes": "#c9c2d8",
};

export function VaultGraph({
  className = "",
  onSelect,
  focusId = null,
  light = false,
}: {
  className?: string;
  onSelect?: (id: string, title: string) => void;
  focusId?: string | null;
  light?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const pointerRef = useRef<{ x: number; y: number; inside: boolean }>({ x: 0.5, y: 0.5, inside: false });
  const focusRef = useRef<string | null>(null);
  const reduceMotion = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const lightRef = useRef(light);
  lightRef.current = light || (typeof document !== "undefined" && document.documentElement.dataset.theme === "light");
  const [tip, setTip] = useState<Tip | null>(null);
  const [focus, setFocus] = useState<string | null>(focusId);

  const links = useMemo(
    () => graph.links.filter((l) => graph.notes.some((n) => n.id === l.from) && graph.notes.some((n) => n.id === l.to)),
    [],
  );

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    if (focusId) setFocus(focusId);
  }, [focusId]);

  useEffect(() => {
    const notes = graph.notes;
    const n = notes.length;
    nodesRef.current = notes.map((note, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = 0.3 + (i % 7) * 0.055;
      return {
        ...note,
        x: 0.5 + Math.cos(a) * r,
        y: 0.5 + Math.sin(a) * r * 0.9,
        vx: 0,
        vy: 0,
      };
    });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const nodeById = () => {
      const map = new Map<string, Node>();
      for (const node of nodesRef.current) map.set(node.id, node);
      return map;
    };

    const step = () => {
      t += reduceMotion.current ? 0 : 0.01;
      const { width, height } = canvas.getBoundingClientRect();
      const nodes = nodesRef.current;
      const pointer = pointerRef.current;
      const currentFocus = focusRef.current;

      if (!reduceMotion.current) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy + 0.0005;
            const f = 0.00016 / d2;
            a.vx += dx * f;
            a.vy += dy * f;
            b.vx -= dx * f;
            b.vy -= dy * f;
          }
          a.vx += (0.5 - a.x) * 0.0024;
          a.vy += (0.5 - a.y) * 0.0024;
          if (pointer.inside) {
            const pdx = pointer.x - a.x;
            const pdy = pointer.y - a.y;
            const pd2 = pdx * pdx + pdy * pdy;
            if (pd2 < 0.09) {
              const pull = 0.0018 * (1 - pd2 / 0.09);
              a.vx += pdx * pull;
              a.vy += pdy * pull;
            }
          }
        }
        for (const l of links) {
          const a = nodes.find((n) => n.id === l.from);
          const b = nodes.find((n) => n.id === l.to);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          a.vx += dx * 0.011;
          a.vy += dy * 0.011;
          b.vx -= dx * 0.011;
          b.vy -= dy * 0.011;
        }
        for (const node of nodes) {
          node.vx *= 0.88;
          node.vy *= 0.88;
          node.x += node.vx;
          node.y += node.vy;
        }
      }

      lightRef.current = document.documentElement.dataset.theme === "light";
      ctx.clearRect(0, 0, width, height);
      const lookup = nodeById();
      ctx.lineWidth = 1;
      for (const l of links) {
        const a = lookup.get(l.from);
        const b = lookup.get(l.to);
        if (!a || !b) continue;
        const hot = currentFocus && (l.from === currentFocus || l.to === currentFocus);
        ctx.strokeStyle = lightRef.current
          ? hot
            ? "rgba(31,35,40,0.42)"
            : "rgba(31,35,40,0.12)"
          : hot
            ? "rgba(236,236,240,0.42)"
            : "rgba(230,230,235,0.12)";
        ctx.beginPath();
        ctx.moveTo(a.x * width, a.y * height);
        ctx.lineTo(b.x * width, b.y * height);
        ctx.stroke();
      }
      nodes.forEach((node, i) => {
        const px = node.x * width + (reduceMotion.current ? 0 : Math.sin(t + i) * 1.1);
        const py = node.y * height + (reduceMotion.current ? 0 : Math.cos(t * 0.9 + i) * 1.1);
        const related =
          currentFocus === node.id ||
          links.some(
            (l) =>
              currentFocus &&
              (l.from === currentFocus || l.to === currentFocus) &&
              (l.from === node.id || l.to === node.id),
          );
        const r = related ? 4.6 : 2.8;
        if (related) {
          ctx.beginPath();
          ctx.fillStyle = lightRef.current ? "rgba(31,35,40,0.08)" : "rgba(236,236,240,0.12)";
          ctx.arc(px, py, r + 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = FOLDER_TINT[node.folder] || "#e8e8ee";
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      });

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      pointerRef.current = { x, y, inside: true };
      let best: Node | null = null;
      let bestD = 0.02;
      for (const node of nodesRef.current) {
        const d = (node.x - x) ** 2 + (node.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = node;
        }
      }
      if (best) {
        setFocus(best.id);
        setTip({
          x: Math.min(e.clientX - rect.left + 14, rect.width - 160),
          y: Math.max(8, e.clientY - rect.top - 12),
          title: best.title,
          folder: best.folder,
        });
      } else {
        setFocus(null);
        setTip(null);
      }
    };
    const onLeave = () => {
      pointerRef.current.inside = false;
      setFocus(null);
      setTip(null);
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      const id = focusRef.current;
      if (!id) return;
      const node = nodesRef.current.find((n) => n.id === id);
      if (node) onSelectRef.current?.(node.id, node.title);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, [links]);

  return (
    <div className={`graph-stage ${className}`.trim()} aria-label="Interactive graph of notes from the OpenOnyx test vault">
      <canvas ref={canvasRef} />
      <div className="graph-label">
        <span className="live-dot" aria-hidden />
        live vault · {graph.notes.length} notes · {graph.links.length} links
        {focus ? ` · ${graph.notes.find((n) => n.id === focus)?.title}` : " · OO-Test-Vault"}
      </div>
      {tip && (
        <div className="graph-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.title}
          <div className="graph-tip-meta">{tip.folder}</div>
        </div>
      )}
    </div>
  );
}
