import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpConfiguration } from "./mcpTypes.js";
import { validateMcpConfiguration } from "./mcpValidation.js";

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

    const result = validateMcpConfiguration(parsed);
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