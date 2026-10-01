import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpToolActivity } from "./mcpTypes.js";

export const MCP_ACTIVITY_FILE = "mcp-activity.json";
const MAX_ACTIVITY_ITEMS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b([A-Za-z_][A-Za-z0-9_-]*(?:key|token|secret|password)|key|token|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeActivity(value: unknown): McpToolActivity | undefined {
  if (!isRecord(value)) return undefined;
  const timestamp = typeof value.timestamp === "number" && Number.isSafeInteger(value.timestamp)
    ? value.timestamp
    : undefined;
  const status = value.status === "allowed" || value.status === "denied" || value.status === "failed" ? value.status : undefined;
  const serverId = sanitizeString(value.serverId, 100);
  const serverName = sanitizeString(value.serverName, 100);
  const toolName = sanitizeString(value.toolName, 100);
  const toolTitle = sanitizeString(value.toolTitle, 100);
  if (!timestamp || !status || !serverId || !serverName || !toolName || !toolTitle) return undefined;
  return {
    id: sanitizeString(value.id, 120) ?? `${timestamp}-${serverId}-${toolName}`,
    timestamp,
    serverId,
    serverName,
    toolName,
    toolTitle,
    status,
    inputSummary: sanitizeString(value.inputSummary, 300),
    summary: sanitizeString(value.summary, 300),
    error: sanitizeString(value.error, 300),
  };
}

export class McpActivityStore {
  private readonly activityPath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.activityPath = path.join(userDataPath, MCP_ACTIVITY_FILE);
  }

  async list(): Promise<McpToolActivity[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.activityPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeActivity)
      .filter((entry): entry is McpToolActivity => Boolean(entry))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ACTIVITY_ITEMS);
  }

  async add(entry: Omit<McpToolActivity, "id" | "timestamp"> & { timestamp?: number }): Promise<McpToolActivity> {
    const timestamp = entry.timestamp ?? Date.now();
    const activity: McpToolActivity = {
      id: `${timestamp}-${entry.serverId}-${entry.toolName}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      serverId: entry.serverId,
      serverName: entry.serverName,
      toolName: entry.toolName,
      toolTitle: entry.toolTitle,
      status: entry.status,
      inputSummary: sanitizeString(entry.inputSummary, 300),
      summary: sanitizeString(entry.summary, 300),
      error: sanitizeString(entry.error, 300),
    };
    const next = [activity, ...(await this.list())].slice(0, MAX_ACTIVITY_ITEMS);
    await this.write(next);
    return activity;
  }

  async clear(): Promise<void> {
    await this.write([]);
  }

  private async write(entries: McpToolActivity[]): Promise<void> {
    const serialized = `${JSON.stringify(entries, null, 2)}\n`;
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.activityPath), { recursive: true });
      const temporaryPath = `${this.activityPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, serialized, "utf8");
      await fs.rename(temporaryPath, this.activityPath);
    });
    await this.saveQueue;
  }
}
