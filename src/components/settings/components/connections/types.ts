import type { McpServerConfig, McpServerSnapshot, McpTool, McpToolActivity, McpTransport } from "../../../../types/mcp";

export type ConnectionsTab = "apps" | "activity" | "advanced";
export type ToolFilter = "all" | "enabled" | "disabled";

export interface ToolRef {
  server: McpServerSnapshot;
  tool: McpTool;
}

export interface ToolRunState {
  input: string;
  formValues: Record<string, string | boolean>;
  running?: boolean;
  result?: unknown;
  error?: string;
  showRaw?: boolean;
  showSchema?: boolean;
  showAdvancedInput?: boolean;
}

export interface ConnectionsActions {
  refresh: () => Promise<void>;
  connect: (server: McpServerSnapshot) => Promise<void>;
  reconnect: (server: McpServerSnapshot) => Promise<void>;
  remove: (id: string) => Promise<void>;
  revokeTrust: (id: string) => Promise<void>;
  saveServer: (config: McpServerConfig) => Promise<void>;
  toggleTool: (server: McpServerSnapshot, toolName: string, enabled: boolean) => Promise<void>;
  toggleFavorite: (server: McpServerSnapshot, toolName: string, favorite: boolean) => Promise<void>;
  runTool: (server: McpServerSnapshot, tool: McpTool, args: Record<string, unknown>) => Promise<void>;
  clearActivity: () => Promise<void>;
}

export interface ConnectionsData {
  servers: McpServerSnapshot[];
  tools: ToolRef[];
  activity: McpToolActivity[];
  toolRuns: Record<string, ToolRunState>;
  busy: boolean;
  error: string | null;
}

export interface AdvancedDraft {
  config: McpServerConfig;
  argsText: string;
  valuesText: string;
}

export type NewConnectionKind = "github" | "filesystem" | "custom";

export type { McpServerConfig, McpServerSnapshot, McpTool, McpToolActivity, McpTransport };
