#!/usr/bin/env node
import readline from "node:readline";

const tool = {
  name: "echo",
  description: "Returns the supplied message for local MCP testing.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "openonyx-dev-echo", version: "1.0.0" },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [tool] } });
    return;
  }

  if (message.method === "tools/call") {
    if (message.params?.name !== "echo") throw new Error(`Unknown tool: ${message.params?.name}`);
    const text = `Echo: ${String(message.params?.arguments?.message ?? "")}`;
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } });
  }
}

const lines = readline.createInterface({ input: process.stdin });
process.stdin.resume();
setInterval(() => {}, 1 << 30);
lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  handleRequest(message).catch((error) => {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  });
});
