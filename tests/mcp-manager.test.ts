import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpConfigurationStore } from "../electron/mcpConfigStore";
import { McpConnectionManager } from "../electron/mcpManager";
import type { McpServerConfig } from "../electron/mcpTypes";

const temporaryDirectories: string[] = [];

const serverConfig = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "local",
  name: "Local server",
  enabled: false,
  trusted: false,
  enabledTools: [],
  favoriteTools: [],
  transport: {
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: {},
  },
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

async function createStore(configuration?: McpServerConfig): Promise<McpConfigurationStore> {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-manager-"));
  temporaryDirectories.push(userDataPath);
  const store = new McpConfigurationStore(userDataPath);
  if (configuration) await store.save({ servers: { [configuration.id]: configuration } });
  return store;
}

function createTransport() {
  return {
    onerror: undefined,
    onclose: undefined,
    start: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("MCP connection manager", () => {
  it("ignores renderer-controlled trust, enablement, and timestamps for new servers", async () => {
    const store = await createStore();
    const manager = new McpConnectionManager(store);
    await manager.load();

    const saved = await manager.upsert(serverConfig({
      enabled: true,
      trusted: true,
      createdAt: 123,
      updatedAt: 456,
    }));

    expect(saved.config.enabled).toBe(false);
    expect(saved.config.trusted).toBe(false);
    expect(saved.config.createdAt).not.toBe(123);
    expect(saved.config.updatedAt).not.toBe(456);
  });

  it("preserves main-owned trust for metadata edits and revokes it for transport edits", async () => {
    const initial = serverConfig({ enabled: true, trusted: true, createdAt: 50 });
    const store = await createStore(initial);
    const manager = new McpConnectionManager(store);
    await manager.load();

    const renamed = await manager.upsert({ ...initial, name: "Renamed", enabled: false, trusted: false });
    expect(renamed.config).toMatchObject({ enabled: true, trusted: true, createdAt: 50 });

    const changed = await manager.upsert({
      ...renamed.config,
      transport: { ...initial.transport, command: "different-command" },
    });
    expect(changed.config).toMatchObject({ enabled: false, trusted: false, createdAt: 50 });
  });

  it("closes and discards an in-flight connection when its server is removed", async () => {
    let finishConnect: (() => void) | undefined;
    const connectOperation = new Promise<void>((resolve) => { finishConnect = resolve; });
    const client = {
      connect: vi.fn(() => connectOperation),
      listTools: vi.fn(async () => ({ tools: [{ name: "late-tool", inputSchema: {} }] })),
      callTool: vi.fn(async () => ({})),
      close: vi.fn(async () => { finishConnect?.(); }),
    };
    const transport = createTransport();
    const store = await createStore(serverConfig({ enabled: true, trusted: true }));
    const manager = new McpConnectionManager(store, undefined, {
      createClient: () => client as never,
      createTransport: () => transport as never,
      shutdownTimeoutMs: 50,
    });
    await manager.load();

    const connection = manager.connect("local");
    const cancelled = expect(connection).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledOnce());
    await manager.remove("local");

    await cancelled;
    expect(client.close).toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("reconnects an already connected server with a fresh client", async () => {
    const firstClient = {
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool: vi.fn(async () => ({})),
      close: vi.fn(async () => {}),
    };
    const secondClient = {
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool: vi.fn(async () => ({})),
      close: vi.fn(async () => {}),
    };
    const clients = [firstClient, secondClient];
    const store = await createStore(serverConfig({ enabled: true, trusted: true }));
    const manager = new McpConnectionManager(store, undefined, {
      createClient: () => clients.shift() as never,
      createTransport: () => createTransport() as never,
    });
    await manager.load();

    await manager.connect("local");
    await manager.reconnect("local");

    expect(firstClient.connect).toHaveBeenCalledOnce();
    expect(firstClient.close).toHaveBeenCalledOnce();
    expect(secondClient.connect).toHaveBeenCalledOnce();
    expect(manager.list()[0].runtime.status).toBe("connected");
  });

  it("lists enabled tools without enabling newly discovered tools automatically", async () => {
    const client = {
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({
        tools: [
          { name: "echo", description: "Echo a message", inputSchema: {} },
          { name: "new_tool", description: "New capability", inputSchema: {} },
        ],
      })),
      callTool: vi.fn(async () => ({})),
      close: vi.fn(async () => {}),
    };
    const store = await createStore(serverConfig({ enabled: true, trusted: true, enabledTools: ["echo"] }));
    const manager = new McpConnectionManager(store, undefined, {
      createClient: () => client as never,
      createTransport: () => createTransport() as never,
    });
    await manager.load();

    await manager.connect("local");

    expect(manager.list()[0].config.enabledTools).toEqual(["echo"]);
    expect(manager.listEnabledTools()).toEqual([expect.objectContaining({
      serverId: "local",
      name: "echo",
      enabled: true,
      requiresConfirmation: true,
    })]);
  });

  it("times out tool execution and records a diagnostic", async () => {
    const never = new Promise(() => {});
    const client = {
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({ tools: [{ name: "echo", inputSchema: {} }] })),
      callTool: vi.fn(() => never),
      close: vi.fn(async () => {}),
    };
    const store = await createStore(serverConfig({ enabled: true, trusted: true, enabledTools: ["echo"] }));
    const manager = new McpConnectionManager(store, undefined, {
      createClient: () => client as never,
      createTransport: () => createTransport() as never,
      operationTimeoutMs: 5,
    });
    await manager.load();
    await manager.connect("local");

    await expect(manager.callTool("local", "echo", {})).rejects.toThrow("Timed out while running MCP tool");
    expect(manager.list()[0].runtime.lastError).toMatchObject({ operation: "tool" });
  });

  it("rejects disabled tool execution on a disconnected server", async () => {
    const store = await createStore(serverConfig({ enabled: true, trusted: true, enabledTools: [] }));
    const manager = new McpConnectionManager(store);
    await manager.load();

    await expect(manager.callTool("local", "echo", {})).rejects.toThrow("MCP tool is not enabled: echo");
  });

  it("does not block shutdown on a hung connection or close operation", async () => {
    const never = new Promise<void>(() => {});
    const client = {
      connect: vi.fn(() => never),
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool: vi.fn(async () => ({})),
      close: vi.fn(() => never),
    };
    const transport = { ...createTransport(), close: vi.fn(() => never) };
    const store = await createStore(serverConfig({ enabled: true, trusted: true }));
    const manager = new McpConnectionManager(store, undefined, {
      createClient: () => client as never,
      createTransport: () => transport as never,
      operationTimeoutMs: Number.POSITIVE_INFINITY,
      shutdownTimeoutMs: 5,
    });
    await manager.load();

    void manager.connect("local");
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledOnce());
    const startedAt = Date.now();

    await manager.shutdown();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("connects legacy bundled GitHub configs through the bundled provider resolver", async () => {
    const store = await createStore(serverConfig({
      id: "github",
      name: "GitHub",
      enabled: true,
      trusted: true,
      transport: {
        transport: "stdio",
        command: "node",
        args: ["scripts/mcp-github-server.mjs"],
        env: {},
      },
    }));
    const manager = new McpConnectionManager(store, undefined, {
      operationTimeoutMs: 5_000,
    });
    await manager.load();

    const snapshot = await manager.connect("github");

    expect(snapshot.runtime.status).toBe("connected");
    expect(snapshot.tools.map((tool) => tool.name)).toContain("search_repositories");
    await manager.shutdown();
  });

});
