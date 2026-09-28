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
});