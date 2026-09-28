import { useEffect, useRef } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { GraphRenderer } from "../../../src/components/graph/GraphRenderer";

type VaultNode = SimulationNodeDatum & {
  id: string;
  name: string;
  path: string;
  connections: number;
  x: number;
  y: number;
};

type VaultEdge = { source: string | VaultNode; target: string | VaultNode };

const SEED_NODES = [
  "OpenOnyx",
  "Attention as infrastructure",
  "Tools that recede",
  "Designing for focus",
  "Interface principles",
  "Local-first systems",
  "Knowledge graphs",
  "Plain Markdown",
  "Collaboration",
  "Vault Intelligence",
  "Obsidian compatibility",
  "Self-hosting",
].map((name) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name }));

const SEED_EDGES: Array<[number, number]> = [
  [0, 1], [0, 5], [0, 7], [0, 9], [1, 2], [1, 3], [1, 4], [2, 3],
  [3, 4], [4, 6], [5, 6], [5, 8], [5, 10], [6, 7], [6, 9], [7, 10],
  [8, 10], [9, 11], [10, 11],
];

function initialPosition(index: number) {
  if (index === 0) return { x: 0, y: 0 };
  const angle = ((index - 1) / (SEED_NODES.length - 1)) * Math.PI * 2;
  return { x: Math.cos(angle) * 110, y: Math.sin(angle) * 90 };
}

export function LiveVaultGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const rect = stage.getBoundingClientRect();
    const renderer = new GraphRenderer(canvas, {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      backgroundColor: 0x1c1d20,
      isDark: false,
      wheelZoomWithoutModifier: true,
    });

    const nodes: VaultNode[] = SEED_NODES.map(({ id, name }, index) => ({
      id,
      name,
      path: `${name}.md`,
      connections: 0,
      ...initialPosition(index),
    }));
    const edges: VaultEdge[] = SEED_EDGES.map(([source, target]) => ({
      source: nodes[source].id,
      target: nodes[target].id,
    }));
    const simulationEdges = edges.map((edge) => ({ ...edge }));

    const degree = new Map<string, number>();
    edges.forEach(({ source, target }) => {
      degree.set(String(source), (degree.get(String(source)) ?? 0) + 1);
      degree.set(String(target), (degree.get(String(target)) ?? 0) + 1);
    });
    nodes.forEach((node) => { node.connections = degree.get(node.id) ?? 0; });

    let disposed = false;
    let simulation: ReturnType<typeof forceSimulation<VaultNode>> | null = null;
    let graphReady = false;
    let stageWidth = rect.width;
    let stageHeight = rect.height;

    renderer.init().then(() => {
      if (disposed) return;
      renderer.setNodeStyle({
        color: 0xd5d1d1,
        size: 6,
        selectedColor: 0x1f2937,
        hoveredColor: 0xc0c0c0,
        connectedColor: 0xc0c0c0,
      });
      renderer.setEdgeStyle({
        color: 0x5d5d5d,
        width: 1,
        highlightColor: 0xc0c0c0,
        highlightWidth: 2,
        alpha: 0.8,
      });
      renderer.setLabelStyle({ color: "#e5e5e5", size: 11, show: true, threshold: 0.2 });
      renderer.setCallbacks({
        onNodeClick: (id) => {
          const node = nodes.find((item) => item.id === id);
          if (node) {
            renderer.selectNode(id);
          }
        },
        onNodeDrag: (id, x, y, active) => {
          const node = nodes.find((item) => item.id === id);
          if (!node || !simulation) return;
          node.fx = active ? x : null;
          node.fy = active ? y : null;
          simulation.alphaTarget(active ? 0.3 : 0).restart();
        },
      });

      simulation = forceSimulation(nodes)
        .alphaDecay(1 - Math.pow(0.001, 1 / 180))
        .velocityDecay(0.6)
        .force("x", forceX<VaultNode>(0).strength(0.12))
        .force("y", forceY<VaultNode>(0).strength(0.12))
        .force("charge", forceManyBody<VaultNode>().strength(-360).distanceMin(25))
        .force("link", forceLink<VaultNode, VaultEdge>(simulationEdges).id((node) => node.id).distance(130))
        .force("collision", forceCollide<VaultNode>().radius(32).strength(0.7))
        .on("tick", () => {
          if (!disposed) renderer.updatePositionsFromArray(nodes.map((node) => node.id), Float32Array.from(nodes.flatMap((node) => [node.x, node.y])));
        });
      simulation.stop().tick(180);
      renderer.setData(nodes, edges);
      renderer.centerView(true, 12);
      renderer.setCurrentScaleAsMinimum();
      graphReady = true;
    });

    const observer = new ResizeObserver(() => {
      const next = stage.getBoundingClientRect();
      renderer.resize(Math.max(1, next.width), Math.max(1, next.height));
      const sizeChanged = Math.abs(next.width - stageWidth) > 1 || Math.abs(next.height - stageHeight) > 1;
      stageWidth = next.width;
      stageHeight = next.height;
      if (graphReady && sizeChanged) {
        renderer.centerView(true, 12);
        renderer.setCurrentScaleAsMinimum();
      }
    });
    observer.observe(stage);

    return () => {
      disposed = true;
      observer.disconnect();
      simulation?.stop();
      renderer.destroy();
    };
  }, []);

  return (
    <figure className="mk-live-graph" aria-label="Interactive OpenOnyx vault graph">
      <div className="mk-live-graph-stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-label="Interactive OpenOnyx vault graph. Drag nodes, zoom, and click a note." />
      </div>
    </figure>
  );
}
