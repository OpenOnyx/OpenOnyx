/**
 * Core type definitions for OpenOnyx
 */

export interface FileEntry {
  name: string;
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  extension: string;
  children?: FileEntry[];
  modifiedAt: number;
  size: number;
}

export interface BookmarkEntry {
  id: string;
  path: string;
  title: string;
  group: string;
  createdAt: number;
}

export interface SearchResult {
  path: string;
  name: string;
  matches: Array<{
    key: string;
    indices: readonly [number, number][];
    value: string;
  }>;
  score: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  name: string;
  path: string;
  connections: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface Tab {
  id: string;
  path: string;
  name: string;
  isModified: boolean;
  groupId?: string | null;
}

// ── Split Pane Types ─────────────────────────────────

export interface PaneLeaf {
  type: 'leaf';
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PaneSplit {
  type: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number; // 0.0 - 1.0
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  category?: string;
}

export type ViewMode = "editor" | "preview" | "split";
export type Theme =
  | "dark"
  | "openonyx"
  | "light"
  | "oceanic"
  | "dark-plus"
  | "blue-night"
  | "ember-night"
  | "aurora-grove"
  | "paper-sage"
  | "rose-quartz"
  | "custom";

// ── Thought Model Types ──────────────────────────────

export type ThoughtModelStatus = "idle" | "indexing" | "done" | "failed";

export interface ThoughtModelBuildRequest {
  vaultPath: string;
  numClusters?: number; // default 12
}

export interface ThoughtModelBuildResponse {
  jobId: string;
  status: ThoughtModelStatus;
}

export interface ThoughtModelStatusResponse {
  jobId: string;
  status: ThoughtModelStatus;
  progress?: number; // 0-100
  message?: string;
  error?: string;
  total_notes?: number;
  total_chunks?: number;
}

export interface ThoughtModelChunk {
  chunkId: string;
  noteId: string;
  notePath: string;
  noteTitle: string;
  chunkText: string;
}

export interface ThoughtModelTheme {
  clusterId: number;
  keywords: string[];
  representativeChunks: ThoughtModelChunk[];
  noteCount: number;
}

export interface ThoughtModelThemesResponse {
  themes: ThoughtModelTheme[];
  totalNotes: number;
  totalChunks: number;
}

export interface ThoughtModelQueryRequest {
  jobId: string;
  query: string;
  topK?: number; // default 10
}

export interface ThoughtModelQueryResult {
  score: number;
  noteTitle: string;
  notePath: string;
  chunkText: string;
  clusterId: number;
}

export interface ThoughtModelQueryResponse {
  query: string;
  results: ThoughtModelQueryResult[];
}

// Re-export Spaces types
export type {
  Space,
  SpaceChunk,
  SpaceVectorIndex,
  SpaceIndexEntry,
  SpaceChatMessage,
  SpaceForkRequest,
} from "./spaces";
