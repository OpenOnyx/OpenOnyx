import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpActivityStore } from "../electron/mcpActivityStore";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<McpActivityStore> {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "openonyx-mcp-activity-"));
  temporaryDirectories.push(userDataPath);
  return new McpActivityStore(userDataPath);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("MCP activity store", () => {
  it("stores local activity metadata and clears history", async () => {
    const store = await createStore();

    await store.add({
      timestamp: 10,
      serverId: "local",
      serverName: "Local MCP Test",
      toolName: "echo",
      toolTitle: "Echo",
      status: "allowed",
      summary: "token=secret Echo: Hello",
    });
    await store.add({
      timestamp: 11,
      serverId: "local",
      serverName: "Local MCP Test",
      toolName: "echo",
      toolTitle: "Echo",
      status: "denied",
      inputSummary: "Token: secret-token",
      summary: "Denied by user",
    });

    await expect(store.list()).resolves.toMatchObject([
      {
        serverId: "local",
        toolName: "echo",
        status: "denied",
        inputSummary: "Token: [redacted]",
      },
      {
        serverId: "local",
        toolName: "echo",
        status: "allowed",
        summary: "token=[redacted] Echo: Hello",
      },
    ]);

    await store.clear();
    await expect(store.list()).resolves.toEqual([]);
  });
});
