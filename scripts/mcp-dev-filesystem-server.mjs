#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import readline from "node:readline";

const allowedRootArgIndex = process.argv.findIndex((arg) => arg === "--root");
const allowedRootInput = allowedRootArgIndex >= 0 ? process.argv[allowedRootArgIndex + 1] : process.env.OPENONYX_MCP_ALLOWED_ROOT;

if (!allowedRootInput) {
  console.error("Set OPENONYX_MCP_ALLOWED_ROOT or pass --root to an explicit test directory.");
  process.exit(1);
}

const allowedRoot = path.resolve(allowedRootInput);
const allowedRootReal = await fs.realpath(allowedRoot);

const tools = [
  {
    name: "search_files",
    description: "Search files in the approved development directory.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_directory",
    description: "List entries in the approved development directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to the approved root." },
      },
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isInsideAllowedRoot(resolvedPath) {
  return resolvedPath === allowedRootReal || resolvedPath.startsWith(`${allowedRootReal}${path.sep}`);
}

async function resolveInsideRoot(relativePath = ".") {
  const resolved = path.resolve(allowedRoot, relativePath);
  const realPath = await fs.realpath(resolved);
  if (!isInsideAllowedRoot(realPath)) {
    throw new Error("Path is outside the allowed root");
  }
  return realPath;
}

async function walkFiles(directory, query, root = directory, results = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= 25) break;
    const absolutePath = path.join(directory, entry.name);
    const realPath = await fs.realpath(absolutePath).catch(() => null);
    if (!realPath || !isInsideAllowedRoot(realPath)) continue;
    const relativePath = path.relative(root, absolutePath) || ".";
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, query, root, results);
      continue;
    }
    const nameMatches = entry.name.toLowerCase().includes(query);
    let contentMatches = false;
    let preview = "";
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      const index = content.toLowerCase().indexOf(query);
      contentMatches = index >= 0;
      if (contentMatches) preview = content.slice(Math.max(0, index - 40), index + 120).replace(/\s+/g, " ").trim();
    } catch {
      // Binary or unreadable files are ignored for content matching.
    }
    if (nameMatches || contentMatches) results.push({ path: relativePath, preview });
  }
  return results;
}

async function callTool(name, args = {}) {
  if (name === "search_files") {
    const query = String(args.query ?? "").trim().toLowerCase();
    if (!query) throw new Error("query is required");
    const matches = await walkFiles(allowedRoot, query);
    return {
      content: [{
        type: "text",
        text: matches.length
          ? matches.map((match) => `${match.path}${match.preview ? ` - ${match.preview}` : ""}`).join("\n")
          : "No matches",
      }],
    };
  }

  if (name === "list_directory") {
    const directory = await resolveInsideRoot(String(args.path ?? "."));
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return {
      content: [{
        type: "text",
        text: entries
          .slice(0, 100)
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n") || "Empty directory",
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "openonyx-dev-filesystem", version: "1.0.0" },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }

  if (message.method === "tools/call") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: await callTool(message.params?.name, message.params?.arguments),
    });
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
