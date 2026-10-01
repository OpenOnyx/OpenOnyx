import type { McpServerConfig, McpServerSnapshot, McpTool } from "./types";
import { getConnectionTitle, getToolTitle } from "../../../../utils/mcpSchema";

export function emptyConfig(): McpServerConfig {
  return {
    id: "",
    name: "",
    enabled: false,
    trusted: false,
    enabledTools: [],
    favoriteTools: [],
    transport: { transport: "stdio", command: "", args: [], env: {} },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function toolKey(server: McpServerSnapshot, toolName: string): string {
  return `${server.config.id}:${toolName}`;
}

export function isToolEnabled(server: McpServerSnapshot, toolName: string): boolean {
  return server.config.enabledTools.includes(toolName);
}

export function isToolFavorite(server: McpServerSnapshot, toolName: string): boolean {
  return server.config.favoriteTools?.includes(toolName) ?? false;
}

export function enabledToolCount(server: McpServerSnapshot): number {
  return server.config.enabledTools.filter((name) => server.tools.some((tool) => tool.name === name)).length;
}

export function connectionStatus(server: McpServerSnapshot): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
  description?: string;
} {
  if (!server.config.trusted) return { label: "Needs approval", tone: "warning" };
  if (!server.config.enabled) return { label: "Disabled", tone: "muted" };
  if (server.runtime.status === "connected") return { label: "Connected", tone: "success" };
  if (server.runtime.status === "connecting") return { label: "Connecting", tone: "warning" };
  if (server.runtime.status === "error") {
    return {
      label: "Connection failed",
      tone: "danger",
      description: humanizeDiagnostic(server.runtime.lastError?.message),
    };
  }
  return { label: "Disconnected", tone: "muted" };
}

export function humanizeDiagnostic(message?: string): string {
  if (!message) return "The connection is not active.";
  if (/connection closed/i.test(message)) return "The server closed the connection unexpectedly.";
  if (/timed out/i.test(message)) return "The server did not respond in time.";
  if (/trust/i.test(message)) return "OpenOnyx needs approval before connecting.";
  if (/disabled/i.test(message)) return "The connection is disabled.";
  return message;
}

export function transportLabel(server: McpServerSnapshot): string {
  if (server.config.transport.transport === "stdio") return "Local";
  if (server.config.transport.transport === "streamable-http") return "Remote";
  return "Remote";
}

export function formatLastConnected(server: McpServerSnapshot): string {
  const timestamp = server.runtime.lastConnectedAt;
  if (!timestamp) return "Never";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function valuesToText(values: Record<string, { type: "value" | "secret"; value?: string; secretId?: string }>): string {
  return Object.entries(values)
    .map(([key, entry]) => `${key}=${entry.type === "secret" ? `secret:${entry.secretId ?? ""}` : entry.value ?? ""}`)
    .join("\n");
}

export function textToValues(text: string): Record<string, { type: "value"; value: string } | { type: "secret"; secretId: string }> {
  const entries = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return Object.fromEntries(entries.map((line) => {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=");
    if (value.startsWith("secret:")) return [key.trim(), { type: "secret", secretId: value.slice("secret:".length).trim() }];
    return [key.trim(), { type: "value", value }];
  }).filter(([key]) => Boolean(key)));
}

export function getToolSubtitle(tool: McpTool): string {
  return tool.description || "No description provided.";
}

export function connectionAriaLabel(server: McpServerSnapshot): string {
  return `${getConnectionTitle(server)}, ${connectionStatus(server).label}, ${server.tools.length} tools`;
}

export function toolAriaLabel(server: McpServerSnapshot, tool: McpTool): string {
  const state = isToolEnabled(server, tool.name) ? "enabled" : "disabled";
  return `${getToolTitle(tool.name)}, ${state}, ${getConnectionTitle(server)}`;
}
