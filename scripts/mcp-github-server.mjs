#!/usr/bin/env node
import { readFileSync } from "node:fs";
import readline from "node:readline";

const GITHUB_API = "https://api.github.com";
const tokenFileArgIndex = process.argv.findIndex((arg) => arg === "--token-file");
const tokenFile = tokenFileArgIndex >= 0 ? process.argv[tokenFileArgIndex + 1] : "";
let cachedToken;

const tools = [
  {
    name: "search_repositories",
    description: "Search public GitHub repositories.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "GitHub repository search query." },
        limit: { type: "integer", description: "Maximum repositories to return. Default 5, max 20." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_issues",
    description: "Search GitHub issues and pull requests in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository in owner/name format." },
        query: { type: "string", description: "Issue or pull request search query." },
        state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state filter." },
        limit: { type: "integer", description: "Maximum results to return. Default 10, max 25." },
      },
      required: ["repository", "query"],
    },
  },
  {
    name: "get_issue",
    description: "Get details for a GitHub issue or pull request by number.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository in owner/name format." },
        number: { type: "integer", description: "Issue or pull request number." },
      },
      required: ["repository", "number"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository in owner/name format." },
        state: { type: "string", enum: ["open", "closed", "all"], description: "Pull request state filter." },
        limit: { type: "integer", description: "Maximum pull requests to return. Default 10, max 25." },
      },
      required: ["repository"],
    },
  },
  {
    name: "create_issue",
    description: "Create a GitHub issue. Requires GITHUB_TOKEN, GH_TOKEN, or --token-file in the MCP server environment.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository in owner/name format." },
        title: { type: "string", description: "Issue title." },
        body: { type: "string", description: "Issue body." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to apply.",
        },
      },
      required: ["repository", "title"],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function asText(text) {
  return { content: [{ type: "text", text }] };
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requireRepository(value) {
  const repository = requireString(value, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use owner/name format");
  }
  return repository;
}

function limitValue(value, defaultValue, maxValue) {
  const number = Number(value ?? defaultValue);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.max(1, Math.min(maxValue, Math.trunc(number)));
}

function stateValue(value, fallback = "open") {
  if (value === "open" || value === "closed" || value === "all") return value;
  return fallback;
}

function headers() {
  const activeToken = getToken();
  return {
    "Accept": "application/vnd.github+json",
    "User-Agent": "OpenOnyx-MCP-GitHub",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(activeToken ? { "Authorization": `Bearer ${activeToken}` } : {}),
  };
}

function getToken() {
  if (cachedToken !== undefined) return cachedToken;
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    cachedToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    return cachedToken;
  }
  if (!tokenFile) {
    cachedToken = "";
    return cachedToken;
  }
  try {
    cachedToken = readFileSync(tokenFile, "utf8").trim();
  } catch {
    cachedToken = "";
  }
  return cachedToken;
}

async function githubFetch(path, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...options.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || `GitHub API request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function formatRepository(repository) {
  const description = repository.description ? ` - ${repository.description}` : "";
  return `${repository.full_name}${description}\n${repository.html_url}`;
}

function formatIssue(issue) {
  const kind = issue.pull_request ? "PR" : "Issue";
  return `${kind} #${issue.number} ${issue.title}\nState: ${issue.state}\nURL: ${issue.html_url}`;
}

async function callTool(name, args = {}) {
  if (name === "search_repositories") {
    const query = encodeURIComponent(requireString(args.query, "query"));
    const limit = limitValue(args.limit, 5, 20);
    const data = await githubFetch(`/search/repositories?q=${query}&per_page=${limit}`);
    return asText(data.items.length ? data.items.map(formatRepository).join("\n\n") : "No repositories found.");
  }

  if (name === "search_issues") {
    const repository = requireRepository(args.repository);
    const query = requireString(args.query, "query");
    const state = stateValue(args.state, "open");
    const limit = limitValue(args.limit, 10, 25);
    const search = encodeURIComponent(`repo:${repository} ${query} state:${state}`);
    const data = await githubFetch(`/search/issues?q=${search}&per_page=${limit}`);
    return asText(data.items.length ? data.items.map(formatIssue).join("\n\n") : "No issues or pull requests found.");
  }

  if (name === "get_issue") {
    const repository = requireRepository(args.repository);
    const number = Number(args.number);
    if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
    const issue = await githubFetch(`/repos/${repository}/issues/${number}`);
    const body = issue.body ? `\n\n${issue.body.slice(0, 2000)}` : "";
    return asText(`${formatIssue(issue)}${body}`);
  }

  if (name === "list_pull_requests") {
    const repository = requireRepository(args.repository);
    const state = stateValue(args.state, "open");
    const limit = limitValue(args.limit, 10, 25);
    const pulls = await githubFetch(`/repos/${repository}/pulls?state=${state}&per_page=${limit}`);
    return asText(pulls.length
      ? pulls.map((pull) => `PR #${pull.number} ${pull.title}\nState: ${pull.state}\nURL: ${pull.html_url}`).join("\n\n")
      : "No pull requests found.");
  }

  if (name === "create_issue") {
    if (!getToken()) throw new Error("GITHUB_TOKEN, GH_TOKEN, or --token-file is required to create issues");
    const repository = requireRepository(args.repository);
    const title = requireString(args.title, "title");
    const body = typeof args.body === "string" ? args.body : "";
    const labels = Array.isArray(args.labels) ? args.labels.filter((label) => typeof label === "string") : undefined;
    const issue = await githubFetch(`/repos/${repository}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels }),
    });
    return asText(`Issue #${issue.number} created\n${issue.html_url}`);
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
        serverInfo: { name: "openonyx-github", version: "1.0.0" },
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
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  handleRequest(message).catch((error) => {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  });
});
