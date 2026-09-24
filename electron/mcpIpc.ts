import type { IpcMain } from "electron";
import type { McpServerConfig } from "./mcpTypes.js";
import { McpConnectionManager } from "./mcpManager.js";

export function registerMcpIpcHandlers(ipcMain: IpcMain, manager: McpConnectionManager): void {
  ipcMain.handle("mcp:list", () => manager.list());
  ipcMain.handle("mcp:save", async (_event, config: McpServerConfig) => manager.upsert(config));
  ipcMain.handle("mcp:remove", async (_event, id: string) => manager.remove(id));
  ipcMain.handle("mcp:setEnabled", async (_event, id: string, enabled: boolean, trusted?: boolean) =>
    manager.setEnabled(id, enabled, trusted),
  );
  ipcMain.handle("mcp:connect", async (_event, id: string) => manager.connect(id));
  ipcMain.handle("mcp:disconnect", async (_event, id: string) => manager.disconnect(id));
  ipcMain.handle("mcp:callTool", async (_event, id: string, name: string, args: Record<string, unknown>) =>
    manager.callTool(id, name, args),
  );
}