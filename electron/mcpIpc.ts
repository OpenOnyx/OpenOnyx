import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from "electron";
import { McpActivityStore } from "./mcpActivityStore.js";
import { McpConnectionManager } from "./mcpManager.js";
import { validateMcpServerConfig } from "./mcpValidation.js";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function humanizeName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase()) || value;
}

function sanitizeActivityText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b([A-Za-z_][A-Za-z0-9_-]*(?:key|token|secret|password)|key|token|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .slice(0, 300);
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return sanitizeActivityText(result);
  if (result && typeof result === "object" && "content" in result && Array.isArray((result as { content: unknown }).content)) {
    const text = (result as { content: unknown[] }).content
      .map((entry) => entry && typeof entry === "object" && "type" in entry && (entry as { type: unknown }).type === "text" && "text" in entry
        ? String((entry as { text: unknown }).text)
        : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return sanitizeActivityText(text);
  }
  try {
    return sanitizeActivityText(JSON.stringify(result));
  } catch {
    return sanitizeActivityText(String(result));
  }
}

function formatArgumentsForConfirmation(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "No arguments";
  return entries.map(([key, value]) => {
    const formatted = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
    return `${humanizeName(key)}\n${formatted}`;
  }).join("\n\n");
}

function formatArgumentsForActivity(args: Record<string, unknown>): string | undefined {
  const entries = Object.entries(args).slice(0, 6);
  if (!entries.length) return undefined;
  return sanitizeActivityText(entries.map(([key, value]) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return `${humanizeName(key)}: ${String(value)}`;
    }
    if (Array.isArray(value)) return `${humanizeName(key)}: ${value.length} values`;
    return `${humanizeName(key)}: object`;
  }).join("\n"));
}

export function registerMcpIpcHandlers(
  ipcMain: IpcMain,
  manager: McpConnectionManager,
  activityStore?: McpActivityStore,
): void {
  ipcMain.handle("mcp:list", () => manager.list());
  ipcMain.handle("mcp:listEnabledTools", () => manager.listEnabledTools());
  ipcMain.handle("mcp:listActivity", () => activityStore?.list() ?? []);
  ipcMain.handle("mcp:clearActivity", () => activityStore?.clear());
  ipcMain.handle("mcp:save", async (_event, config: unknown) => {
    const result = validateMcpServerConfig(config);
    if (!result.success) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
    return manager.upsert(result.value);
  });
  ipcMain.handle("mcp:remove", async (_event, id: unknown) => manager.remove(requireString(id, "id")));
  ipcMain.handle("mcp:setEnabled", async (event, id: unknown, enabled: unknown) => {
    const serverId = requireString(id, "id");
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
    if (enabled) {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const messageOptions: Electron.MessageBoxOptions = {
        type: "warning",
        buttons: ["Cancel", "Connect"],
        defaultId: 0,
        cancelId: 0,
        title: "Trust MCP server?",
        message: "This server may execute commands or access network resources.",
        detail: "Review its command or URL before connecting. Only connect if you trust this server.",
      };
      const result = owner
        ? await dialog.showMessageBox(owner, messageOptions)
        : await dialog.showMessageBox(messageOptions);
      if (result.response !== 1) throw new Error("MCP server trust approval was cancelled");
      return manager.approveAndEnable(serverId);
    }
    return manager.setEnabled(serverId, false);
  });
  ipcMain.handle("mcp:connect", async (_event, id: unknown) => manager.connect(requireString(id, "id")));
  ipcMain.handle("mcp:reconnect", async (_event, id: unknown) => manager.reconnect(requireString(id, "id")));
  ipcMain.handle("mcp:revokeTrust", async (_event, id: unknown) => manager.revokeTrust(requireString(id, "id")));
  ipcMain.handle("mcp:disconnect", async (_event, id: unknown) => manager.disconnect(requireString(id, "id")));
  const runToolHandler = async (event: IpcMainInvokeEvent, id: unknown, name: unknown, args: unknown) => {
    const serverId = requireString(id, "id");
    const toolName = requireString(name, "name");
    const toolArguments = requireRecord(args, "args");
    const serializedArguments = JSON.stringify(toolArguments, null, 2);
    if (serializedArguments.length > 10_000) throw new Error("MCP tool arguments are too large");
    const server = manager.list().find((entry) => entry.config.id === serverId);
    const tool = server?.tools.find((entry) => entry.name === toolName);
    const serverName = server?.config.name || serverId;
    const toolTitle = humanizeName(toolName);
    const inputSummary = formatArgumentsForActivity(toolArguments);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const messageOptions: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["Cancel", "Allow once"],
      defaultId: 0,
      cancelId: 0,
      title: "Run app tool?",
      message: `OpenOnyx wants to use ${serverName}`,
      detail: `TOOL\n${toolTitle}\n\nINPUT\n\n${formatArgumentsForConfirmation(toolArguments)}\n\n${serverName} will receive the information shown above.`,
    };
    const result = owner
      ? await dialog.showMessageBox(owner, messageOptions)
      : await dialog.showMessageBox(messageOptions);
    if (result.response !== 1) {
      await activityStore?.add({
        serverId,
        serverName,
        toolName,
        toolTitle,
        status: "denied",
        inputSummary,
        summary: "Denied by user",
      });
      throw new Error("MCP tool execution was cancelled");
    }
    try {
      const toolResult = await manager.callTool(serverId, toolName, toolArguments);
      await activityStore?.add({
        serverId,
        serverName,
        toolName,
        toolTitle,
        status: "allowed",
        inputSummary,
        summary: summarizeResult(toolResult),
      });
      return toolResult;
    } catch (error) {
      await activityStore?.add({
        serverId,
        serverName,
        toolName,
        toolTitle,
        status: "failed",
        inputSummary,
        error: sanitizeActivityText(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    }
  };
  ipcMain.handle("mcp:runTool", runToolHandler);
  ipcMain.handle("mcp:requestToolExecution", runToolHandler);
}
