import { BrowserWindow, dialog, type IpcMain } from "electron";
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

export function registerMcpIpcHandlers(ipcMain: IpcMain, manager: McpConnectionManager): void {
  ipcMain.handle("mcp:list", () => manager.list());
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
  ipcMain.handle("mcp:disconnect", async (_event, id: unknown) => manager.disconnect(requireString(id, "id")));
  ipcMain.handle("mcp:callTool", async (_event, id: unknown, name: unknown, args: unknown) =>
    manager.callTool(requireString(id, "id"), requireString(name, "name"), requireRecord(args, "args")),
  );
}