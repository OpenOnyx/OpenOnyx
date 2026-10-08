import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpConfiguration, McpServerConfig } from "./mcpTypes.js";
import { validateMcpConfiguration } from "./mcpValidation.js";

export const MCP_CONFIGURATION_FILE = "mcp-servers.json";
const BUNDLED_MCP_COMMAND = "__openonyx_bundled_mcp__";
const BUNDLED_PROVIDER_BY_SCRIPT = new Map([
  ["mcp-github-server.mjs", "github"],
  ["mcp-dev-filesystem-server.mjs", "filesystem"],
  ["mcp-dev-echo-server.mjs", "local-test"],
]);

export function getMcpConfigurationPath(userDataPath: string): string {
  return path.join(userDataPath, MCP_CONFIGURATION_FILE);
}

export class McpConfigurationValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super("Invalid MCP configuration");
    this.name = "McpConfigurationValidationError";
  }
}

export class McpConfigurationStore {
  private readonly configurationPath: string;

  constructor(userDataPath: string) {
    this.configurationPath = getMcpConfigurationPath(userDataPath);
  }

  async load(): Promise<McpConfiguration> {
    let raw: string;
    try {
      raw = await fs.readFile(this.configurationPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { servers: {} };
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in ${this.configurationPath}`);
    }

    const result = validateMcpConfiguration(migrateConfiguration(parsed));
    if (!result.success) throw new McpConfigurationValidationError(result.issues);
    return result.value;
  }

  async save(configuration: McpConfiguration): Promise<void> {
    const result = validateMcpConfiguration(configuration);
    if (!result.success) throw new McpConfigurationValidationError(result.issues);
    const serialized = `${JSON.stringify(result.value, null, 2)}\n`;
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.configurationPath), { recursive: true });
      const temporaryPath = `${this.configurationPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, serialized, "utf8");
      await fs.rename(temporaryPath, this.configurationPath);
    });
    await this.saveQueue;
  }

  private saveQueue: Promise<void> = Promise.resolve();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateConfiguration(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.servers)) return input;
  const servers: Record<string, McpServerConfig> = {};
  for (const [serverId, rawServer] of Object.entries(input.servers)) {
    if (!isRecord(rawServer)) {
      servers[serverId] = rawServer as McpServerConfig;
      continue;
    }
    const now = Date.now();
    const migratedServer = {
      ...rawServer,
      id: typeof rawServer.id === "string" ? rawServer.id : serverId,
      enabled: typeof rawServer.enabled === "boolean" ? rawServer.enabled : false,
      trusted: typeof rawServer.trusted === "boolean" ? rawServer.trusted : false,
      enabledTools: Array.isArray(rawServer.enabledTools)
        ? rawServer.enabledTools.filter((value): value is string => typeof value === "string")
        : [],
      favoriteTools: Array.isArray(rawServer.favoriteTools)
        ? rawServer.favoriteTools.filter((value): value is string => typeof value === "string")
        : [],
      createdAt: typeof rawServer.createdAt === "number" ? rawServer.createdAt : now,
      updatedAt: typeof rawServer.updatedAt === "number" ? rawServer.updatedAt : now,
    } as McpServerConfig;
    servers[serverId] = migrateBundledTransport(migratedServer);
  }
  return { ...input, servers };
}

function migrateBundledTransport(server: McpServerConfig): McpServerConfig {
  if (!isRecord(server.transport) || server.transport.transport !== "stdio") return server;
  if (server.transport.command === BUNDLED_MCP_COMMAND) return server;
  if (typeof server.transport.command !== "string" || !Array.isArray(server.transport.args)) return server;
  const executable = server.transport.command.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  if (executable !== "node" && executable !== "node.exe") return server;
  const [scriptArg, ...args] = server.transport.args;
  if (typeof scriptArg !== "string") return server;
  const normalizedScript = scriptArg.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/^scripts\/[^/]+$/.test(normalizedScript)) return server;
  const scriptName = normalizedScript.split("/").pop();
  const provider = scriptName ? BUNDLED_PROVIDER_BY_SCRIPT.get(scriptName) : undefined;
  if (!provider) return server;
  return {
    ...server,
    transport: {
      transport: "stdio",
      command: BUNDLED_MCP_COMMAND,
      args: [provider, ...args],
      env: server.transport.env,
    },
  };
}
