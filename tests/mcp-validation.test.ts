import { describe, expect, it } from "vitest";
import {
  validateMcpConfiguration,
  validateMcpServerConfig,
} from "../src/utils/mcp-validation";

const baseServer = {
  id: "filesystem-local",
  name: "Local filesystem",
  enabled: false,
  trusted: false,
  enabledTools: [],
  transport: {
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", "@example/mcp-server"],
    env: {
      API_KEY: { type: "secret" as const, secretId: "example-key" },
    },
  },
  createdAt: 1,
  updatedAt: 1,
};

describe("MCP configuration validation", () => {
  it("accepts a valid stdio server with a secret reference", () => {
    const result = validateMcpServerConfig(baseServer);

    expect(result).toEqual({ success: true, value: baseServer });
  });

  it("accepts streamable HTTP and SSE server configurations", () => {
    for (const transport of ["streamable-http", "sse"] as const) {
      const result = validateMcpServerConfig({
        ...baseServer,
        transport: {
          transport,
          url: "https://mcp.example.test/server",
          headers: {
            Authorization: { type: "secret", secretId: "token" },
          },
        },
      });

      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid IDs, duplicate tools, and malformed timestamps", () => {
    const result = validateMcpServerConfig({
      ...baseServer,
      id: "Unsafe Server",
      enabledTools: ["search", "search"],
      createdAt: -1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toEqual([
        "server.id",
        "server.enabledTools",
        "server.createdAt",
      ]);
    }
  });

  it("rejects invalid transport-specific values", () => {
    const result = validateMcpServerConfig({
      ...baseServer,
      transport: {
        transport: "streamable-http",
        url: "file:///tmp/server",
        headers: {
          "Invalid Header": { type: "value", value: "x" },
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toEqual([
        "server.transport.url",
        "server.transport.headers.Invalid Header",
      ]);
    }
  });

  it("requires configuration keys to match server IDs", () => {
    const result = validateMcpConfiguration({
      servers: {
        renamed: baseServer,
      },
    });

    expect(result).toEqual({
      success: false,
      issues: [{ path: "servers.renamed.id", message: "must match its configuration key" }],
    });
  });
});