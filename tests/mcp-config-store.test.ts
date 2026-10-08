import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  McpConfigurationStore,
  McpConfigurationValidationError,
  getMcpConfigurationPath,
} from "../electron/mcpConfigStore";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<McpConfigurationStore> {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
  temporaryDirectories.push(userDataPath);
  return new McpConfigurationStore(userDataPath);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("MCP configuration store", () => {
  it("returns an empty configuration when no file exists", async () => {
    const store = await createStore();

    await expect(store.load()).resolves.toEqual({ servers: {} });
  });

  it("round-trips validated configurations", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(userDataPath);
    const store = new McpConfigurationStore(userDataPath);
    const configuration = {
      servers: {
        local: {
          id: "local",
          name: "Local server",
          enabled: false,
          trusted: false,
          enabledTools: [],
          favoriteTools: [],
          transport: {
            transport: "stdio" as const,
            command: "node",
            args: ["server.js"],
            env: {},
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    };

    await store.save(configuration);

    await expect(store.load()).resolves.toEqual(configuration);
    await expect(fs.readFile(getMcpConfigurationPath(userDataPath), "utf8")).resolves.toContain('"local"');
  });

  it("preserves absolute custom provider paths even when they share a bundled filename", async () => {
    const store = await createStore();
    const config = { id: "github", name: "GitHub", enabled: true, trusted: true, enabledTools: ["search_issues"], favoriteTools: [], transport: { transport: "stdio" as const, command: "node", args: ["/custom/mcp-github-server.mjs"], env: {} }, createdAt: 1, updatedAt: 1 };
    await store.save({ servers: { github: config } });
    expect((await store.load()).servers.github).toEqual(config);
  });

  it("validates malformed persisted transports before attempting migration", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(getMcpConfigurationPath(directory), JSON.stringify({ servers: { broken: { id: "broken", name: "Broken" } } }));
    await expect(new McpConfigurationStore(directory).load()).rejects.toBeInstanceOf(McpConfigurationValidationError);
  });

  it("writes configuration atomically and creates the user data directory", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(userDataPath);
    const store = new McpConfigurationStore(path.join(userDataPath, "nested"));

    await store.save({ servers: {} });

    await expect(fs.readFile(path.join(userDataPath, "nested", "mcp-servers.json"), "utf8")).resolves.toBe(
      '{\n  "servers": {}\n}\n',
    );
    await expect(fs.access(path.join(userDataPath, "nested", "mcp-servers.json.tmp"))).rejects.toThrow();
  });

  it("rejects invalid configurations before writing", async () => {
    const store = await createStore();

    await expect(store.save({ servers: { invalid: {} } } as never)).rejects.toBeInstanceOf(
      McpConfigurationValidationError,
    );
  });

  it("reports malformed persisted JSON", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(userDataPath);
    await fs.writeFile(getMcpConfigurationPath(userDataPath), "{not-json", "utf8");

    await expect(new McpConfigurationStore(userDataPath).load()).rejects.toThrow("Invalid JSON");
  });

  it("migrates persisted server configurations without silently granting permissions", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(userDataPath);
    await fs.writeFile(getMcpConfigurationPath(userDataPath), JSON.stringify({
      servers: {
        legacy: {
          id: "legacy",
          name: "Legacy server",
          transport: {
            transport: "stdio",
            command: "node",
            args: [],
            env: {},
          },
        },
      },
    }), "utf8");

    await expect(new McpConfigurationStore(userDataPath).load()).resolves.toMatchObject({
      servers: {
        legacy: {
          enabled: false,
          trusted: false,
          enabledTools: [],
          favoriteTools: [],
        },
      },
    });
  });

  it("migrates legacy bundled GitHub script paths away from vault-relative launches", async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-"));
    temporaryDirectories.push(userDataPath);
    await fs.writeFile(getMcpConfigurationPath(userDataPath), JSON.stringify({
      servers: {
        github: {
          id: "github",
          name: "GitHub",
          enabled: true,
          trusted: true,
          enabledTools: ["search_issues"],
          favoriteTools: [],
          transport: {
            transport: "stdio",
            command: "node",
            args: ["scripts/mcp-github-server.mjs"],
            env: {},
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    }), "utf8");

    await expect(new McpConfigurationStore(userDataPath).load()).resolves.toMatchObject({
      servers: {
        github: {
          enabled: true,
          trusted: true,
          enabledTools: ["search_issues"],
          transport: {
            transport: "stdio",
            command: "__openonyx_bundled_mcp__",
            args: ["github"],
          },
        },
      },
    });
  });

});
