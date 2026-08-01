import React, { useEffect, useRef, useState, useCallback } from "react";
import { GraphNode, GraphEdge } from "../../types";
import { getAPI } from "../../utils/api";

const api = getAPI();

interface ClusterViewProps {
  vaultPath: string | null;
  onFileSelect: (path: string) => void;
  isActive: boolean;
}

interface ClusterSettings {
  names: Record<string, string>;
  colors: Record<string, string>;
  positions: Record<string, { x: number; y: number }>;
  expanded: Record<string, boolean>;
  nodeAssignments: Record<string, string>;
}

// Curated modern harmonious palette (Linear / Apple Maps aesthetic)
const PALETTE = [
  "#6366F1", // Indigo
  "#10B981", // Emerald
  "#3B82F6", // Sapphire
  "#F59E0B", // Amber
  "#EC4899", // Rose
  "#06B6D4", // Cyan
  "#8B5CF6", // Violet
  "#14B8A6", // Teal
  "#F97316", // Orange
];

interface RenderCluster {
  id: string;
  name: string;
  color: string;
  cx: number;
  cy: number;
  expanded: boolean;
  members: string[];
  hullPoints: Array<{ x: number; y: number }>;
}

interface RenderNode {
  id: string;
  name: string;
  path: string;
  clusterId: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

// Helper: Convex Hull
function getConvexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Helper: Expand hull for organic blob padding
function expandPolygon(points: Array<{ x: number; y: number }>, distance: number): Array<{ x: number; y: number }> {
  if (points.length < 3) {
    if (points.length === 0) return [];
    const center = points[0];
    const pts: Array<{ x: number; y: number }> = [];
    const num = 12;
    for (let i = 0; i < num; i++) {
      const a = (i / num) * Math.PI * 2;
      pts.push({ x: center.x + Math.cos(a) * distance, y: center.y + Math.sin(a) * distance });
    }
    return pts;
  }
  const expanded: Array<{ x: number; y: number }> = [];
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    expanded.push({
      x: p.x + (dx / len) * distance,
      y: p.y + (dy / len) * distance,
    });
  }
  return expanded;
}

// Helper: Dynamically derive meaningful cluster name from member note titles
function deriveClusterName(memberIds: string[], nodeMap: Map<string, GraphNode>, fallbackIndex: number): string {
  if (memberIds.length === 0) return `Cluster ${fallbackIndex + 1}`;

  const stopWords = new Set(["a", "an", "the", "and", "or", "of", "in", "to", "for", "with", "on", "at", "by", "from", "is", "it", "note", "notes", "concept", "community", "hub", "spec", "md", "details"]);
  const wordCounts = new Map<string, number>();

  memberIds.forEach(id => {
    const node = nodeMap.get(id);
    if (!node) return;
    const words = node.name.replace(/[-_.]/g, " ").split(/\s+/);
    words.forEach(w => {
      const clean = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (clean.length > 2 && !stopWords.has(clean) && !/^\d+$/.test(clean)) {
        const titleCase = clean.charAt(0).toUpperCase() + clean.slice(1);
        wordCounts.set(titleCase, (wordCounts.get(titleCase) || 0) + 1);
      }
    });
  });

  const sortedWords = [...wordCounts.entries()].sort((a, b) => b[1] - a[1]);

  if (sortedWords.length >= 2 && sortedWords[0][1] >= 2) {
    return `${sortedWords[0][0]} & ${sortedWords[1][0]}`;
  } else if (sortedWords.length >= 1 && sortedWords[0][1] >= 2) {
    return `${sortedWords[0][0]} Module`;
  }

  const topNode1 = nodeMap.get(memberIds[0]);
  const topNode2 = memberIds.length > 1 ? nodeMap.get(memberIds[1]) : null;
  if (topNode1 && topNode2) {
    const clean1 = topNode1.name.replace(/[-_]/g, " ");
    const clean2 = topNode2.name.replace(/[-_]/g, " ");
    return `${clean1} & ${clean2}`;
  } else if (topNode1) {
    return `${topNode1.name.replace(/[-_]/g, " ")} Cluster`;
  }
  return `Cluster ${fallbackIndex + 1}`;
}

// Welsh-Powell Graph Coloring Algorithm
function colorClusters(
  clusterIds: string[],
  adjMap: Map<string, Set<string>>,
  userColors: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  clusterIds.forEach(id => {
    if (userColors[id]) result[id] = userColors[id];
  });

  const uncolored = clusterIds.filter(id => !result[id]);
  uncolored.sort((a, b) => (adjMap.get(b)?.size || 0) - (adjMap.get(a)?.size || 0));

  uncolored.forEach(clusterId => {
    const neighbors = adjMap.get(clusterId) || new Set();
    const usedColors = new Set<string>();
    neighbors.forEach(neighborId => {
      if (result[neighborId]) usedColors.add(result[neighborId]);
    });
    const availableColor = PALETTE.find(c => !usedColors.has(c)) || PALETTE[Object.keys(result).length % PALETTE.length];
    result[clusterId] = availableColor;
  });

  return result;
}

export function ClusterView({ vaultPath, onFileSelect, isActive }: ClusterViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [clusterSettings, setClusterSettings] = useState<ClusterSettings>({
    names: {},
    colors: {},
    positions: {},
    expanded: {},
    nodeAssignments: {},
  });

  const [editingCluster, setEditingCluster] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [selectedNode, setSelectedNode] = useState<{ id: string; name: string } | null>(null);

  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const draggingTargetRef = useRef<{ type: "cluster" | "node"; id: string; offsetX: number; offsetY: number } | null>(null);

  const clustersRef = useRef<RenderCluster[]>([]);
  const nodesRef = useRef<Map<string, RenderNode>>(new Map());

  // Load Graph Data
  useEffect(() => {
    if (!isActive) return;
    const loadGraph = async () => {
      try {
        let data = await api.getGraphData();
        if (!data || !data.nodes || data.nodes.length === 0) {
          data = {
            nodes: [
              { id: "welcome", name: "Welcome", path: "Welcome.md", connections: 5 },
              { id: "getting-started", name: "Getting Started", path: "Getting Started.md", connections: 4 },
              { id: "knowledge", name: "Knowledge Base", path: "Knowledge.md", connections: 6 },
              { id: "projects", name: "Project Ideas", path: "Projects.md", connections: 3 },
              { id: "architecture", name: "System Architecture", path: "Architecture.md", connections: 5 },
              { id: "ui-specs", name: "UI Components", path: "UI Components.md", connections: 4 },
              { id: "guide", name: "Markdown Guide", path: "Guide.md", connections: 2 },
              { id: "links", name: "Wiki Links", path: "Links.md", connections: 3 },
            ],
            edges: [
              { source: "welcome", target: "getting-started" },
              { source: "getting-started", target: "knowledge" },
              { source: "knowledge", target: "projects" },
              { source: "welcome", target: "architecture" },
              { source: "architecture", target: "ui-specs" },
              { source: "knowledge", target: "guide" },
              { source: "getting-started", target: "links" },
            ],
          };
        }
        setGraphData(data);
      } catch (err) {
        console.error("Failed to load graph data for cluster view:", err);
      }
    };
    loadGraph();
  }, [vaultPath, isActive]);

  // Load Settings
  useEffect(() => {
    if (!vaultPath) return;
    const key = `cluster_settings_${vaultPath}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setClusterSettings({
          names: parsed.names || {},
          colors: parsed.colors || {},
          positions: parsed.positions || {},
          expanded: parsed.expanded || {},
          nodeAssignments: parsed.nodeAssignments || {},
        });
      } catch (e) {
        // ignore
      }
    }
  }, [vaultPath]);

  // Save Settings
  useEffect(() => {
    if (!vaultPath) return;
    const key = `cluster_settings_${vaultPath}`;
    localStorage.setItem(key, JSON.stringify(clusterSettings));
  }, [clusterSettings, vaultPath]);

  // Screen <-> World transforms
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    const container = containerRef.current;
    const width = container?.clientWidth || window.innerWidth;
    const height = container?.clientHeight || window.innerHeight;
    return {
      x: (sx - width / 2) / cam.zoom + cam.x,
      y: (sy - height / 2) / cam.zoom + cam.y,
    };
  }, []);

  // Partition nodes into thematic islands + Outliers cluster
  useEffect(() => {
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) return;

    const nodeDegrees = new Map<string, number>();
    graphData.nodes.forEach(n => nodeDegrees.set(n.id, 0));

    graphData.edges.forEach(edge => {
      if (!edge || !edge.source || !edge.target) return;
      const srcId = typeof edge.source === "string" ? edge.source : (edge.source?.id || "");
      const tgtId = typeof edge.target === "string" ? edge.target : (edge.target?.id || "");
      if (srcId && tgtId) {
        nodeDegrees.set(srcId, (nodeDegrees.get(srcId) || 0) + 1);
        nodeDegrees.set(tgtId, (nodeDegrees.get(tgtId) || 0) + 1);
      }
    });

    // Separate connected nodes from outliers (0 or 1 connection)
    const connectedNodes: GraphNode[] = [];
    const autoOutlierNodes: GraphNode[] = [];

    graphData.nodes.forEach(node => {
      const deg = nodeDegrees.get(node.id) || 0;
      if (deg > 1) {
        connectedNodes.push(node);
      } else {
        autoOutlierNodes.push(node);
      }
    });

    // Determine cluster count dynamically scaling up to 16 for large 600+ note vaults
    const numConnectedClusters = Math.min(16, Math.max(3, Math.ceil(connectedNodes.length / 15)));

    const sortedConnected = [...connectedNodes].sort((a, b) => (nodeDegrees.get(b.id) || 0) - (nodeDegrees.get(a.id) || 0));

    const rawClusterMembers: Record<string, string[]> = {};
    for (let i = 0; i < numConnectedClusters; i++) {
      rawClusterMembers[`cluster_${i}`] = [];
    }

    sortedConnected.forEach((node, idx) => {
      const cId = `cluster_${idx % numConnectedClusters}`;
      rawClusterMembers[cId].push(node.id);
    });

    const autoClusterMap = new Map<string, string>();
    Object.entries(rawClusterMembers).forEach(([cId, members]) => {
      members.forEach(m => autoClusterMap.set(m, cId));
    });

    autoOutlierNodes.forEach(node => {
      autoClusterMap.set(node.id, "cluster_outliers");
    });

    // Build final member lists respecting manual user nodeAssignments
    const finalMembersMap: Record<string, string[]> = {
      cluster_outliers: [],
    };
    for (let i = 0; i < numConnectedClusters; i++) {
      finalMembersMap[`cluster_${i}`] = [];
    }

    graphData.nodes.forEach(node => {
      const userAssigned = clusterSettings.nodeAssignments[node.id];
      const targetCluster = userAssigned && (finalMembersMap[userAssigned] || userAssigned === "cluster_outliers")
        ? userAssigned
        : autoClusterMap.get(node.id) || "cluster_outliers";

      if (!finalMembersMap[targetCluster]) finalMembersMap[targetCluster] = [];
      finalMembersMap[targetCluster].push(node.id);
    });

    // Total active clusters list (including Outliers if it has members)
    const activeClusterIds: string[] = [];
    for (let i = 0; i < numConnectedClusters; i++) {
      activeClusterIds.push(`cluster_${i}`);
    }
    if (finalMembersMap["cluster_outliers"] && finalMembersMap["cluster_outliers"].length > 0) {
      activeClusterIds.push("cluster_outliers");
    }

    // Welsh-Powell Graph Coloring
    const clusterAdjMap = new Map<string, Set<string>>();
    activeClusterIds.forEach(id => clusterAdjMap.set(id, new Set()));

    graphData.edges.forEach(edge => {
      if (!edge || !edge.source || !edge.target) return;
      const srcId = typeof edge.source === "string" ? edge.source : (edge.source?.id || "");
      const tgtId = typeof edge.target === "string" ? edge.target : (edge.target?.id || "");
      const cSrc = clusterSettings.nodeAssignments[srcId] || autoClusterMap.get(srcId);
      const cTgt = clusterSettings.nodeAssignments[tgtId] || autoClusterMap.get(tgtId);
      if (cSrc && cTgt && cSrc !== cTgt && clusterAdjMap.has(cSrc) && clusterAdjMap.has(cTgt)) {
        clusterAdjMap.get(cSrc)?.add(cTgt);
        clusterAdjMap.get(cTgt)?.add(cSrc);
      }
    });

    const coloredMap = colorClusters(activeClusterIds.filter(id => id !== "cluster_outliers"), clusterAdjMap, clusterSettings.colors);
    coloredMap["cluster_outliers"] = clusterSettings.colors["cluster_outliers"] || "#64748B";

    const totalClustersCount = activeClusterIds.length;
    const newClusters: RenderCluster[] = [];
    const newNodes = new Map<string, RenderNode>();

    // Build O(1) lookup map for graph nodes
    const nodeMap = new Map<string, GraphNode>();
    graphData.nodes.forEach(n => nodeMap.set(n.id, n));

    // Seeded pseudo-random generator for stable organic inner node placement
    const pseudoRandom = (seedStr: string) => {
      let h = 0;
      for (let k = 0; k < seedStr.length; k++) h = (Math.imul(31, h) + seedStr.charCodeAt(k)) | 0;
      return (h >>> 0) / 4294967296;
    };

    // Calculate cluster radius proportional to member count
    const getClusterRadius = (id: string, memberCount: number) => {
      if (id === "cluster_outliers") return 0;
      // Grid-aware sizing: cols * spacing gives natural width
      const cols = Math.ceil(Math.sqrt(memberCount));
      const rows = Math.ceil(memberCount / cols);
      const spacing = 22;
      const gridWidth = (cols - 1) * spacing;
      const gridHeight = (rows - 1) * spacing;
      const diag = Math.sqrt(gridWidth * gridWidth + gridHeight * gridHeight) / 2;
      return Math.max(60, diag + 28);
    };

    // Initialize tight cluster graph layout
    const clusterPositions: Record<string, { x: number; y: number }> = {};
    activeClusterIds.forEach((id, idx) => {
      if (clusterSettings.positions[id]) {
        clusterPositions[id] = { ...clusterSettings.positions[id] };
      } else if (id === "cluster_outliers") {
        clusterPositions[id] = { x: 750, y: -300 };
      } else {
        // Tight spiral seed — clusters start close together
        const phi = idx * 2.4;
        const dist = idx === 0 ? 0 : 120 + Math.sqrt(idx) * 110;
        clusterPositions[id] = {
          x: Math.cos(phi) * dist,
          y: Math.sin(phi) * dist,
        };
      }
    });

    // Relaxation: push apart just enough to not overlap, keep tight
    const nonOutlierIds = activeClusterIds.filter(id => id !== "cluster_outliers");
    for (let step = 0; step < 25; step++) {
      for (let i = 0; i < nonOutlierIds.length; i++) {
        for (let j = i + 1; j < nonOutlierIds.length; j++) {
          const idA = nonOutlierIds[i];
          const idB = nonOutlierIds[j];
          if (clusterSettings.positions[idA] && clusterSettings.positions[idB]) continue;

          const pA = clusterPositions[idA];
          const pB = clusterPositions[idB];
          const rA = getClusterRadius(idA, (finalMembersMap[idA] || []).length);
          const rB = getClusterRadius(idB, (finalMembersMap[idB] || []).length);

          const dx = pB.x - pA.x || 1;
          const dy = pB.y - pA.y || 1;
          const d = Math.sqrt(dx * dx + dy * dy);
          const minDist = rA + rB + 30; // tight gap

          if (d < minDist) {
            const overlap = (minDist - d) / 2;
            const nx = (dx / d) * overlap;
            const ny = (dy / d) * overlap;
            if (!clusterSettings.positions[idA]) { pA.x -= nx; pA.y -= ny; }
            if (!clusterSettings.positions[idB]) { pB.x += nx; pB.y += ny; }
          }
        }
      }
    }

    for (let i = 0; i < totalClustersCount; i++) {
      const id = activeClusterIds[i];
      const members = finalMembersMap[id] || [];
      const { x: cx, y: cy } = clusterPositions[id];
      const clusterRadius = getClusterRadius(id, members.length);
      const color = coloredMap[id] || PALETTE[i % PALETTE.length];
      
      let name = clusterSettings.names[id];
      if (!name) {
        if (id === "cluster_outliers") {
          name = "Outliers";
        } else {
          name = deriveClusterName(members, nodeMap, i);
        }
      }

      const expanded = clusterSettings.expanded[id] !== false;
      const memberPositions: Array<{ x: number; y: number }> = [];

      // Grid layout inside circle — rows and columns like the concept sketch
      const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
      const rows = Math.ceil(members.length / cols);
      const spacing = 22;
      const gridW = (cols - 1) * spacing;
      const gridH = (rows - 1) * spacing;
      const startX = cx - gridW / 2;
      const startY = cy - gridH / 2;

      members.forEach((nodeId, idx) => {
        const node = nodeMap.get(nodeId);
        if (!node) return;

        let nx: number;
        let ny: number;

        if (id === "cluster_outliers") {
          const outlierAngle = idx * ((Math.sqrt(5) - 1) / 2) * Math.PI * 2;
          const outlierDist = 40 + Math.sqrt(idx) * 25;
          nx = cx + Math.cos(outlierAngle) * outlierDist;
          ny = cy + Math.sin(outlierAngle) * outlierDist;
        } else {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          nx = startX + col * spacing;
          ny = startY + row * spacing;
        }

        memberPositions.push({ x: nx, y: ny });

        newNodes.set(nodeId, {
          id: nodeId,
          name: node.name,
          path: node.path,
          clusterId: id,
          x: nx,
          y: ny,
          radius: Math.max(4, Math.min(10, (node.connections || 3) * 1.2)),
          color,
        });
      });

      const rawHull = getConvexHull(memberPositions.length > 0 ? memberPositions : [{ x: cx, y: cy }]);
      const organicHull = expandPolygon(rawHull, 40);

      newClusters.push({
        id,
        name,
        color,
        cx,
        cy,
        expanded,
        members,
        hullPoints: organicHull,
      });
    }

    clustersRef.current = newClusters;
    nodesRef.current = newNodes;
  }, [graphData, clusterSettings]);

  // Hover state refs
  const hoveredClusterRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const [cursorStyle, setCursorStyle] = useState<string>("grab");

  // Main Canvas Render Loop
  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const width = canvas.parentElement?.clientWidth || window.innerWidth;
      const height = canvas.parentElement?.clientHeight || window.innerHeight;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Dark background
      ctx.fillStyle = "#17181C";
      ctx.fillRect(0, 0, width, height);

      const cam = cameraRef.current;

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const hoveredClusterId = hoveredClusterRef.current;
      const hoveredNodeId = hoveredNodeRef.current;

      // ── 1. Calculate Inter-Cluster Connection Strengths ──
      const clusterPairWeights = new Map<string, number>();
      const topNeighborsMap = new Map<string, Array<{ targetId: string; weight: number }>>();

      if (graphData && graphData.edges) {
        graphData.edges.forEach(edge => {
          if (!edge || !edge.source || !edge.target) return;
          const srcId = typeof edge.source === "string" ? edge.source : (edge.source?.id || "");
          const tgtId = typeof edge.target === "string" ? edge.target : (edge.target?.id || "");
          if (!srcId || !tgtId) return;

          const srcNode = nodesRef.current.get(srcId);
          const tgtNode = nodesRef.current.get(tgtId);

          if (srcNode && tgtNode && srcNode.clusterId !== tgtNode.clusterId && srcNode.clusterId !== "cluster_outliers" && tgtNode.clusterId !== "cluster_outliers") {
            const pairKey = [srcNode.clusterId, tgtNode.clusterId].sort().join("<->");
            clusterPairWeights.set(pairKey, (clusterPairWeights.get(pairKey) || 0) + 1);
          }
        });
      }

      // Collect top 2 strongest neighbor connections for each cluster to keep graph clean
      clusterPairWeights.forEach((weight, key) => {
        const [c1, c2] = key.split("<->");
        if (!topNeighborsMap.has(c1)) topNeighborsMap.set(c1, []);
        if (!topNeighborsMap.has(c2)) topNeighborsMap.set(c2, []);
        topNeighborsMap.get(c1)?.push({ targetId: c2, weight });
        topNeighborsMap.get(c2)?.push({ targetId: c1, weight });
      });

      const activeBridgeKeys = new Set<string>();
      topNeighborsMap.forEach((list, cId) => {
        list.sort((a, b) => b.weight - a.weight);
        // Pick top 2 strongest connected neighbors for cluster cId
        list.slice(0, 2).forEach(item => {
          const key = [cId, item.targetId].sort().join("<->");
          activeBridgeKeys.add(key);
        });
      });

      // ── 2. Draw Cluster Bubble Spheres & Background Glows ──
      clustersRef.current.forEach(c => {
        if (c.id === "cluster_outliers") return;

        const isHovered = hoveredClusterId === c.id;
        // Grid-aware sphere radius matching layout
        const _cols = Math.ceil(Math.sqrt(c.members.length));
        const _rows = Math.ceil(c.members.length / _cols);
        const _gw = (_cols - 1) * 22;
        const _gh = (_rows - 1) * 22;
        const sphereRadius = Math.max(60, Math.sqrt(_gw * _gw + _gh * _gh) / 2 + 28);

        ctx.save();
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, sphereRadius, 0, Math.PI * 2);

        // Glassmorphic Radial Gradient Fill
        const grad = ctx.createRadialGradient(c.cx, c.cy, 5, c.cx, c.cy, sphereRadius);
        grad.addColorStop(0, `${c.color}${isHovered ? "28" : "18"}`);
        grad.addColorStop(0.85, `${c.color}${isHovered ? "14" : "08"}`);
        grad.addColorStop(1, `${c.color}03`);

        ctx.fillStyle = grad;
        ctx.fill();

        // Cluster Sphere Boundary Line (Exact sketch look with modern glow)
        ctx.lineWidth = isHovered ? 3.2 : 2.0;
        ctx.strokeStyle = isHovered ? c.color : `${c.color}99`;
        if (isHovered) {
          ctx.shadowColor = c.color;
          ctx.shadowBlur = 20;
        }
        ctx.stroke();
        ctx.restore();
      });

      // ── 3. Draw Single Clean Bridge Lines Between Connected Cluster Spheres ──
      const clustersList = clustersRef.current.filter(c => c.id !== "cluster_outliers");
      for (let i = 0; i < clustersList.length; i++) {
        for (let j = i + 1; j < clustersList.length; j++) {
          const cA = clustersList[i];
          const cB = clustersList[j];
          const pairKey = [cA.id, cB.id].sort().join("<->");

          if (activeBridgeKeys.has(pairKey)) {
            const count = clusterPairWeights.get(pairKey) || 1;
            const isHoveredArc = hoveredClusterId === cA.id || hoveredClusterId === cB.id;

            // Grid-aware radii for bridge line boundary points
            const _cA = Math.ceil(Math.sqrt(cA.members.length));
            const _rA_rows = Math.ceil(cA.members.length / _cA);
            const _gwA = (_cA - 1) * 22;
            const _ghA = (_rA_rows - 1) * 22;
            const rA = Math.max(60, Math.sqrt(_gwA * _gwA + _ghA * _ghA) / 2 + 28);

            const _cB = Math.ceil(Math.sqrt(cB.members.length));
            const _rB_rows = Math.ceil(cB.members.length / _cB);
            const _gwB = (_cB - 1) * 22;
            const _ghB = (_rB_rows - 1) * 22;
            const rB = Math.max(60, Math.sqrt(_gwB * _gwB + _ghB * _ghB) / 2 + 28);

            const angle = Math.atan2(cB.cy - cA.cy, cB.cx - cA.cx);

            // Boundary edge start and end points
            const startX = cA.cx + Math.cos(angle) * rA;
            const startY = cA.cy + Math.sin(angle) * rA;
            const endX = cB.cx - Math.cos(angle) * rB;
            const endY = cB.cy - Math.sin(angle) * rB;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);

            ctx.lineWidth = isHoveredArc ? 3.5 : 2.0;
            ctx.strokeStyle = isHoveredArc ? `${cA.color}ff` : `${cA.color}bb`;

            if (isHoveredArc) {
              ctx.shadowColor = cA.color;
              ctx.shadowBlur = 16;
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // ── 4. Draw Intra-Cluster Node Links (Inside Cluster Spheres) ──
      if (graphData && graphData.edges) {
        graphData.edges.forEach(edge => {
          if (!edge || !edge.source || !edge.target) return;
          const srcId = typeof edge.source === "string" ? edge.source : (edge.source?.id || "");
          const tgtId = typeof edge.target === "string" ? edge.target : (edge.target?.id || "");
          if (!srcId || !tgtId) return;

          const srcNode = nodesRef.current.get(srcId);
          const tgtNode = nodesRef.current.get(tgtId);

          // Draw links inside the SAME cluster sphere
          if (srcNode && tgtNode && srcNode.clusterId === tgtNode.clusterId) {
            const isHoveredEdge = hoveredNodeId === srcId || hoveredNodeId === tgtId || hoveredClusterId === srcNode.clusterId;

            ctx.beginPath();
            ctx.moveTo(srcNode.x, srcNode.y);
            ctx.lineTo(tgtNode.x, tgtNode.y);
            ctx.lineWidth = isHoveredEdge ? 2.0 : 1.0;
            ctx.strokeStyle = isHoveredEdge ? `${srcNode.color}aa` : `${srcNode.color}40`;
            ctx.stroke();
          }
        });
      }

      // ── 5. Draw Cluster Member Nodes & Outliers ──
      nodesRef.current.forEach(node => {
        const cluster = clustersRef.current.find(c => c.id === node.clusterId);
        const isClusterExpanded = cluster ? cluster.expanded : true;
        const isNodeHovered = hoveredNodeId === node.id;
        const isOutlier = node.clusterId === "cluster_outliers";

        ctx.beginPath();
        ctx.arc(node.x, node.y, isNodeHovered ? node.radius + 3 : node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isOutlier ? "#64748B" : node.color;
        if (isNodeHovered) {
          ctx.shadowColor = isOutlier ? "#94a3b8" : node.color;
          ctx.shadowBlur = 18;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.lineWidth = isNodeHovered ? 2.5 : 1.5;
        ctx.strokeStyle = isOutlier ? "#94a3b8" : "#ffffffdd";
        ctx.stroke();

        // Smart text label rendering
        const shouldShowLabel = isNodeHovered || isOutlier || (isClusterExpanded && cam.zoom >= 0.95) || hoveredClusterId === node.clusterId;

        if (shouldShowLabel) {
          ctx.font = isNodeHovered ? "600 13px Inter, sans-serif" : "500 11px Inter, sans-serif";
          ctx.fillStyle = isNodeHovered ? "#ffffff" : isOutlier ? "#94a3b8" : "#cbd5e1";
          ctx.textAlign = "center";
          ctx.fillText(node.name, node.x, node.y + node.radius + 14);
        }
      });

      // ── 6. Draw High-Contrast Cluster Title Badges ──
      clustersRef.current.forEach(c => {
        if (c.id === "cluster_outliers") return;

        const isHovered = hoveredClusterId === c.id;
        const sphereRadius = Math.max(120, 60 + Math.sqrt(c.members.length) * 26);
        const labelY = c.cy - sphereRadius - 16;

        ctx.save();
        const fontSize = Math.max(13, Math.min(18, Math.round(14 / Math.sqrt(cam.zoom))));
        ctx.font = `700 ${fontSize}px Inter, sans-serif`;

        const titleText = `${c.name} (${c.members.length} notes)`;
        const textWidth = ctx.measureText(titleText).width;

        const boxWidth = textWidth + 36;
        const boxHeight = fontSize + 16;
        const boxX = c.cx - boxWidth / 2;
        const boxY = labelY - boxHeight / 2;

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 14);
        ctx.fillStyle = isHovered ? "rgba(15, 17, 23, 0.96)" : "rgba(23, 24, 28, 0.92)";
        ctx.fill();

        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.strokeStyle = isHovered ? c.color : `${c.color}cc`;
        if (isHovered) {
          ctx.shadowColor = c.color;
          ctx.shadowBlur = 18;
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(boxX + 14, labelY, 4, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(titleText, boxX + 24, labelY);
        ctx.restore();

        // Hover action hint
        if (isHovered) {
          ctx.save();
          ctx.font = "500 11px Inter, sans-serif";
          const hintText = "Drag cluster sphere • Double-click to rename";
          const hintWidth = ctx.measureText(hintText).width;

          const hintX = c.cx - (hintWidth + 24) / 2;
          const hintY = labelY + 28;

          ctx.beginPath();
          ctx.roundRect(hintX, hintY, hintWidth + 24, 22, 11);
          ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.stroke();

          ctx.fillStyle = "#94a3b8";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(hintText, c.cx, hintY + 11);
          ctx.restore();
        }
      });

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [graphData]);

  // Pointer Controls (Zoom, Pan, Dragging)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    cameraRef.current.zoom = Math.max(0.2, Math.min(3, cameraRef.current.zoom * zoomFactor));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);

    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    let hitNode: RenderNode | null = null;
    nodesRef.current.forEach(node => {
      const dx = worldPos.x - node.x;
      const dy = worldPos.y - node.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 8) {
        hitNode = node;
      }
    });

    if (hitNode) {
      draggingTargetRef.current = {
        type: "node",
        id: (hitNode as RenderNode).id,
        offsetX: worldPos.x - (hitNode as RenderNode).x,
        offsetY: worldPos.y - (hitNode as RenderNode).y,
      };
      return;
    }

    let hitCluster: RenderCluster | null = null;
    clustersRef.current.forEach(c => {
      const labelY = c.cy - 75;
      const distCenter = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - c.cy) ** 2);
      const distBadge = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - labelY) ** 2);
      
      const dynamicRadius = Math.max(130, 50 + Math.sqrt(c.members.length) * 30);
      if (distCenter <= dynamicRadius || distBadge <= 75) {
        hitCluster = c;
      }
    });

    if (hitCluster) {
      draggingTargetRef.current = {
        type: "cluster",
        id: (hitCluster as RenderCluster).id,
        offsetX: worldPos.x - (hitCluster as RenderCluster).cx,
        offsetY: worldPos.y - (hitCluster as RenderCluster).cy,
      };
      return;
    }

    isPanningRef.current = true;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (isPanningRef.current) {
      cameraRef.current.x -= dx / cameraRef.current.zoom;
      cameraRef.current.y -= dy / cameraRef.current.zoom;
      return;
    }

    if (draggingTargetRef.current) {
      const target = draggingTargetRef.current;
      if (target.type === "cluster") {
        const nx = worldPos.x - target.offsetX;
        const ny = worldPos.y - target.offsetY;
        setClusterSettings(prev => ({
          ...prev,
          positions: { ...prev.positions, [target.id]: { x: nx, y: ny } },
        }));
      } else if (target.type === "node") {
        const nx = worldPos.x - target.offsetX;
        const ny = worldPos.y - target.offsetY;
        const node = nodesRef.current.get(target.id);
        if (node) {
          node.x = nx;
          node.y = ny;
        }
      }
      return;
    }

    // Hover Detection
    let foundNode: string | null = null;
    nodesRef.current.forEach(node => {
      const d = Math.sqrt((worldPos.x - node.x) ** 2 + (worldPos.y - node.y) ** 2);
      if (d <= node.radius + 8) {
        foundNode = node.id;
      }
    });

    let foundCluster: string | null = null;
    clustersRef.current.forEach(c => {
      const labelY = c.cy - 75;
      const distCenter = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - c.cy) ** 2);
      const distBadge = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - labelY) ** 2);
      const dynamicRadius = Math.max(130, 50 + Math.sqrt(c.members.length) * 30);
      if (distCenter <= dynamicRadius || distBadge <= 75) {
        foundCluster = c.id;
      }
    });

    hoveredNodeRef.current = foundNode;
    hoveredClusterRef.current = foundCluster;

    if (foundNode || foundCluster) {
      setCursorStyle("pointer");
    } else {
      setCursorStyle(isPanningRef.current ? "grabbing" : "grab");
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const target = draggingTargetRef.current;
    isPanningRef.current = false;
    draggingTargetRef.current = null;

    const rect = canvasRef.current?.getBoundingClientRect();

    if (target && target.type === "node" && rect) {
      const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      let closestClusterId: string | null = null;
      let minDistance = Infinity;

      clustersRef.current.forEach(c => {
        const dist = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - c.cy) ** 2);
        if (dist < minDistance) {
          minDistance = dist;
          closestClusterId = c.id;
        }
      });

      if (closestClusterId) {
        setClusterSettings(prev => ({
          ...prev,
          nodeAssignments: { ...prev.nodeAssignments, [target.id]: closestClusterId! },
        }));
      }
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // 1. Check if node clicked
    let clickedNode: RenderNode | null = null;
    nodesRef.current.forEach(node => {
      const dist = Math.sqrt((worldPos.x - node.x) ** 2 + (worldPos.y - node.y) ** 2);
      if (dist <= node.radius + 8) {
        clickedNode = node;
      }
    });

    if (clickedNode) {
      setSelectedNode({ id: (clickedNode as RenderNode).id, name: (clickedNode as RenderNode).name });
      return;
    }

    // 2. Check if cluster clicked -> toggle open/collapse island
    let clickedCluster: RenderCluster | null = null;
    clustersRef.current.forEach(c => {
      const labelY = c.cy - 75;
      const distCenter = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - c.cy) ** 2);
      const distBadge = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - labelY) ** 2);
      const dynamicRadius = Math.max(130, 50 + Math.sqrt(c.members.length) * 30);
      if (distCenter <= dynamicRadius || distBadge <= 75) {
        clickedCluster = c;
      }
    });

    if (clickedCluster) {
      const cId = (clickedCluster as RenderCluster).id;
      setClusterSettings(prev => ({
        ...prev,
        expanded: {
          ...prev.expanded,
          [cId]: prev.expanded[cId] === false ? true : false,
        },
      }));
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    clustersRef.current.forEach(c => {
      const labelY = c.cy - 75;
      const distCenter = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - c.cy) ** 2);
      const distBadge = Math.sqrt((worldPos.x - c.cx) ** 2 + (worldPos.y - labelY) ** 2);
      if (distCenter <= 90 || distBadge <= 75) {
        setEditingCluster(c.id);
        setEditName(c.name);
        setEditColor(c.color);
      }
    });
  };

  const activeClusterOptions = clustersRef.current.map(c => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div
      className="cluster-view-container"
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative", background: "#17181C", overflow: "hidden", userSelect: "none" }}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
        style={{ width: "100%", height: "100%", display: "block", cursor: cursorStyle }}
      />

      {/* Control Tips Bar */}
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(23, 24, 28, 0.85)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "8px 18px",
          borderRadius: "20px",
          color: "#94a3b8",
          fontSize: "12px",
          display: "flex",
          gap: "16px",
          pointerEvents: "none",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <span>🔍 Scroll to Zoom</span>
        <span>🖱️ Drag Background to Pan</span>
        <span>🏝️ Drag Islands / Nodes</span>
        <span>✏️ Double-Click Badge to Edit</span>
      </div>

      {/* Glassmorphic Edit Cluster Modal */}
      {editingCluster && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(25, 26, 32, 0.92)",
            backdropFilter: "blur(20px)",
            padding: "24px",
            borderRadius: "18px",
            color: "white",
            zIndex: 100,
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            width: "280px",
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600", color: "#f8fafc" }}>Edit Cluster Island</h3>

          <label style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>Island Name</label>
          <input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            style={{
              display: "block",
              marginBottom: "16px",
              width: "100%",
              padding: "9px 12px",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "white",
              borderRadius: "8px",
              outline: "none",
              fontSize: "14px",
            }}
          />

          <label style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>Island Theme Color</label>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "20px" }}>
            <input
              type="color"
              value={editColor}
              onChange={e => setEditColor(e.target.value)}
              style={{ width: "32px", height: "32px", padding: 0, border: "none", borderRadius: "6px", background: "none", cursor: "pointer" }}
            />
            <span style={{ fontSize: "13px", color: "#cbd5e1", fontFamily: "monospace" }}>{editColor}</span>
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button
              onClick={() => setEditingCluster(null)}
              style={{ background: "transparent", color: "#94a3b8", border: "none", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setClusterSettings(prev => ({
                  ...prev,
                  names: { ...prev.names, [editingCluster]: editName },
                  colors: { ...prev.colors, [editingCluster]: editColor },
                }));
                setEditingCluster(null);
              }}
              style={{ background: "#3b82f6", color: "white", border: "none", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Glassmorphic Node Options Modal */}
      {selectedNode && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(25, 26, 32, 0.92)",
            backdropFilter: "blur(20px)",
            padding: "22px",
            borderRadius: "18px",
            color: "white",
            zIndex: 100,
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            width: "300px",
          }}
        >
          <h3 style={{ margin: "0 0 4px 0", fontSize: "15px", fontWeight: "600", color: "#f8fafc" }}>{selectedNode.name}</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#94a3b8" }}>Re-assign cluster or open note</p>

          <label style={{ display: "block", fontSize: "12px", color: "#cbd5e1", marginBottom: "6px" }}>Assigned Cluster Island</label>
          <select
            value={clusterSettings.nodeAssignments[selectedNode.id] || ""}
            onChange={e => {
              const newClusterId = e.target.value;
              setClusterSettings(prev => {
                const nextAssignments = { ...prev.nodeAssignments };
                if (newClusterId) {
                  nextAssignments[selectedNode.id] = newClusterId;
                } else {
                  delete nextAssignments[selectedNode.id];
                }
                return { ...prev, nodeAssignments: nextAssignments };
              });
            }}
            style={{
              width: "100%",
              padding: "9px 12px",
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "white",
              borderRadius: "8px",
              marginBottom: "20px",
              fontSize: "13px",
              outline: "none",
            }}
          >
            <option value="">(Auto Assigned Cluster)</option>
            {activeClusterOptions.map(opt => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button
              onClick={() => setSelectedNode(null)}
              style={{ background: "transparent", color: "#94a3b8", border: "none", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
            >
              Close
            </button>
            <button
              onClick={() => {
                onFileSelect(selectedNode.id);
                setSelectedNode(null);
              }}
              style={{ background: "#3b82f6", color: "white", border: "none", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
            >
              Open Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
