export type McpEnvironmentValue =
  | { type: "value"; value: string }
  | { type: "secret"; secretId: string };

export interface McpStdioTransport {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, McpEnvironmentValue>;
}

export interface McpHttpTransport {
  transport: "streamable-http" | "sse";
  url: string;
  headers: Record<string, McpEnvironmentValue>;
}

export type McpTransportConfig = McpStdioTransport | McpHttpTransport;

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  trusted: boolean;
  enabledTools: string[];
  transport: McpTransportConfig;
  createdAt: number;
  updatedAt: number;
}

export type McpServerStatus = "disabled" | "disconnected" | "connecting" | "connected" | "error";

export interface McpDiagnostic {
  operation: string;
  message: string;
  timestamp: number;
}

export interface McpServerRuntimeState {
  status: McpServerStatus;
  lastConnectedAt?: number;
  lastError?: McpDiagnostic;
  diagnostics: McpDiagnostic[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpServerSnapshot {
  config: McpServerConfig;
  runtime: McpServerRuntimeState;
  tools: McpTool[];
}

export interface McpConfiguration {
  servers: Record<string, McpServerConfig>;
}