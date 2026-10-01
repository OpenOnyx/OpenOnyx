import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  showMessageBox: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  dialog: { showMessageBox: electronMocks.showMessageBox },
}));

import { registerMcpIpcHandlers } from "../electron/mcpIpc";
import type { McpConnectionManager } from "../electron/mcpManager";

function register(manager: Partial<McpConnectionManager> = {}) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
  registerMcpIpcHandlers(ipcMain as never, manager as McpConnectionManager);
  return handlers;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("MCP IPC", () => {
  it("exposes only confirmation-gated tool execution to the renderer", () => {
    const handlers = register();

    expect(handlers.has("mcp:callTool")).toBe(false);
    expect(handlers.has("mcp:runTool")).toBe(true);
    expect(handlers.has("mcp:requestToolExecution")).toBe(true);
    expect(handlers.has("mcp:reconnect")).toBe(true);
  });

  it("runs an enabled tool after explicit native confirmation", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "Echo: Hello" }] }));
    const list = vi.fn(() => [{
      config: { id: "local-test", name: "Local MCP Test" },
      tools: [{ name: "echo" }],
    }]);
    const add = vi.fn();
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 });
    const handler = register({ callTool, list } as never).get("mcp:requestToolExecution")!;

    await expect(handler(
      { sender: {} },
      "local-test",
      "echo",
      { message: "Hello" },
    )).resolves.toEqual({ content: [{ type: "text", text: "Echo: Hello" }] });

    expect(electronMocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: "Run app tool?",
      message: "OpenOnyx wants to use Local MCP Test",
      defaultId: 0,
      cancelId: 0,
    }));
    expect(callTool).toHaveBeenCalledWith("local-test", "echo", { message: "Hello" });
    expect(add).not.toHaveBeenCalled();
  });

  it("records sanitized activity without persisting tool arguments", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "token=abc123 done" }] }));
    const list = vi.fn(() => [{
      config: { id: "github", name: "GitHub" },
      tools: [{ name: "create_issue" }],
    }]);
    const add = vi.fn();
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 });
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
    registerMcpIpcHandlers(ipcMain as never, { callTool, list } as never, { add } as never);

    await handlers.get("mcp:requestToolExecution")!({ sender: {} }, "github", "create_issue", {
      title: "Fix updater",
      token: "secret-token",
    });

    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      serverId: "github",
      serverName: "GitHub",
      toolName: "create_issue",
      status: "allowed",
      summary: "token=[redacted] done",
    }));
    expect(JSON.stringify(add.mock.calls[0][0])).not.toContain("secret-token");
    expect(add.mock.calls[0][0].inputSummary).toContain("Token: [redacted]");
  });

  it("does not invoke a tool when native confirmation is cancelled", async () => {
    const callTool = vi.fn();
    const list = vi.fn(() => []);
    electronMocks.showMessageBox.mockResolvedValue({ response: 0 });
    const handler = register({ callTool, list } as never).get("mcp:runTool")!;

    await expect(handler({ sender: {} }, "local-test", "echo", {})).rejects.toThrow("cancelled");
    expect(callTool).not.toHaveBeenCalled();
  });
});
