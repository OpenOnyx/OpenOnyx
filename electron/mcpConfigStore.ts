import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpConfiguration } from "./mcpTypes.js";

export const MCP_CONFIGURATION_FILE = "mcp-servers.json";

export function getMcpConfigurationPath(userDataPath: string): string {
  return path.join(userDataPath, MCP_CONFIGURATION_FILE);
}

export class McpConfigurationValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super("Invalid MCP configuration");
    this.name = "McpConfigurationValidationError";
  }
}

function validateConfigurationShape(input: unknown): input is McpConfiguration {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const servers = (input as { servers?: unknown }).servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return false;
  return Object.entries(servers).every(([id, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const server = value as Record<string, unknown>;
    if (server.id !== id || typeof server.name !== "string" || typeof server.enabled !== "boolean" || typeof server.trusted !== "boolean") return false;
    if (!Array.isArray(server.enabledTools) || !server.enabledTools.every((tool) => typeof tool === "string")) return false;
    if (!server.transport || typeof server.transport !== "object") return false;
    const transport = server.transport as Record<string, unknown>;
    if (transport.transport === "stdio") return typeof transport.command === "string" && Array.isArray(transport.args) && !!transport.env && typeof transport.env === "object";
    return (transport.transport === "sse" || transport.transport === "streamable-http") && typeof transport.url === "string" && !!transport.headers && typeof transport.headers === "object";
  });
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

    if (!validateConfigurationShape(parsed)) {
      throw new McpConfigurationValidationError([{ path: "configuration", message: "has an invalid shape" }]);
    }
    return parsed;
  }

  async save(configuration: McpConfiguration): Promise<void> {
    if (!validateConfigurationShape(configuration)) {
      throw new McpConfigurationValidationError([{ path: "configuration", message: "has an invalid shape" }]);
    }

    await fs.mkdir(path.dirname(this.configurationPath), { recursive: true });
    const temporaryPath = `${this.configurationPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.configurationPath);
  }
}