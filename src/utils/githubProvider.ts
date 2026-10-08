import type { GithubResourceProvider, GithubResource } from "../types/appResources";
import type { McpServerSnapshot } from "../types/mcp";
import { getAPI } from "./api";
import { identifyAppId } from "./appRegistry";
import { parseExternalResource } from "./appResources";

export const GITHUB_PERMISSIONS = [
  { id: "repositories", label: "Read repositories", tools: ["search_repositories"] },
  { id: "issues", label: "Read issues and pull requests", tools: ["search_issues", "get_issue", "list_pull_requests"] },
  { id: "create", label: "Create issues", tools: ["create_issue"] },
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function githubResourceFromApi(value: unknown, serverId: string): GithubResource | null {
  const item = record(value);
  if (typeof item.html_url !== "string") return null;
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/(issues|pull)\/(\d+))?$/.exec(item.html_url);
  if (!match) return null;
  const resource = parseExternalResource({
    version: 1, appId: "github", serverId,
    resourceType: match[2] === "pull" ? "pull-request" : match[2] === "issues" ? "issue" : "repository",
    repository: match[1], number: match[3] ? Number(match[3]) : undefined,
    title: item.title || item.full_name, url: item.html_url,
    body: item.body || item.description, state: item.state,
    labels: Array.isArray(item.labels) ? item.labels.map((label) => typeof label === "string" ? label : record(label).name) : [],
    discussion: item.discussion, comments: item.comments, updatedAt: item.updated_at,
  });
  return resource?.appId === "github" ? resource : null;
}

/** Decode structured responses and the original bundled provider's text format. */
export function resourcesFromMcpResult(result: unknown, serverId: string): GithubResource[] {
  const response = record(result);
  const content = Array.isArray(response.content) ? response.content : [];
  const text = content.map((block) => record(block).type === "text" ? String(record(block).text || "") : "").join("\n");
  if (response.isError) throw new Error(text || "GitHub could not complete this request");
  const structured = record(response.structuredContent);
  let items: unknown[] | undefined;
  if (Array.isArray(structured.items)) items = structured.items;
  else if (structured.resource) items = [structured.resource];
  else if (structured.html_url) items = [structured];
  if (!items) {
    try {
      const parsed: unknown = JSON.parse(text);
      const data = record(parsed);
      items = Array.isArray(parsed) ? parsed : Array.isArray(data.items) ? data.items : data.html_url ? [data] : undefined;
    } catch { /* Legacy text below. */ }
  }
  if (items) return items.map((item) => githubResourceFromApi(item, serverId)).filter((item): item is GithubResource => Boolean(item));
  return text.split(/\n\n/).map((block) => {
    const url = block.match(/https:\/\/github\.com\/[^\s]+/)?.[0];
    if (!url) return null;
    const title = block.split("\n")[0].replace(/^(?:Issue|PR) #\d+\s*/, "");
    return githubResourceFromApi({ html_url: url, title, state: block.match(/State: (\w+)/)?.[1] }, serverId);
  }).filter((item): item is GithubResource => Boolean(item));
}

export function createGithubProvider(server: McpServerSnapshot): GithubResourceProvider {
  if (identifyAppId(server) !== "github") throw new Error("This resource belongs to a GitHub connection.");
  const request = async (name: string, args: Record<string, unknown>) => {
    if (server.runtime.status !== "connected" || !server.config.enabled || !server.config.trusted) throw new Error("Reconnect GitHub in Settings → Apps.");
    if (!server.tools.some((tool) => tool.name === name)) throw new Error("This GitHub provider does not support this resource. See Advanced for provider information.");
    if (!server.config.enabledTools.includes(name)) throw new Error("Allow the corresponding GitHub permission in Settings → Apps first.");
    // No raw clients or alternate invocation path: every request asks natively.
    try {
      return resourcesFromMcpResult(await getAPI().mcp.requestToolExecution(server.config.id, name, args), server.config.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub could not complete this request";
      if (/GITHUB_TOKEN|GH_TOKEN|--token-file/.test(message)) throw new Error("Creating issues requires an authenticated GitHub connection. This connection currently supports public browsing.");
      if (/Connection closed/i.test(message)) throw new Error("The GitHub connection needs attention. Reconnect it in Settings → Apps.");
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  };
  return {
    appId: "github", kind: "mcp",
    search: async (query, kind, repository) => {
      if (!query.trim()) throw new Error("Enter a search query.");
      if (kind === "repository") return request("search_repositories", { query: query.trim(), limit: 10 });
      if (kind === "everything" && !server.config.enabledTools.includes("search_issues")) return request("search_repositories", { query: query.trim(), limit: 10 });
      // An explicit resource identifier is a lookup, not a full-text search.
      const numberMatch = /^#?([1-9]\d*)$/.exec(query.trim());
      let targetRepository = repository?.trim();
      let targetNumber = numberMatch ? Number(numberMatch[1]) : undefined;
      if (/^https:\/\//i.test(query.trim())) {
        const url = new URL(query.trim());
        const path = /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/.exec(url.pathname);
        if (url.host !== "github.com" || url.username || url.password || !path) throw new Error("Enter a GitHub issue or pull request link.");
        targetRepository = path[1];
        targetNumber = Number(path[2]);
      }
      if (targetNumber !== undefined) {
        if (!Number.isSafeInteger(targetNumber)) throw new Error("Enter a valid issue or pull request number.");
        if (!targetRepository) throw new Error("Choose a repository to look up an issue or pull request number.");
        const resources = await request("get_issue", { repository: targetRepository, number: targetNumber });
        // Issue and PR numbers share a namespace. Show the actual kind returned.
        return resources.filter((item) => item.repository.toLowerCase() === targetRepository!.toLowerCase() && item.number === targetNumber);
      }
      // Updated bundled provider supports global search; older providers require a repository.
      const tool = server.tools.find((entry) => entry.name === "search_issues");
      const required = record(tool?.inputSchema).required;
      if (!repository && Array.isArray(required) && required.includes("repository")) throw new Error("Choose a repository for this GitHub connection.");
      const results = await request("search_issues", { query: `${query.trim()}${kind === "everything" ? "" : ` is:${kind === "pull-request" ? "pr" : "issue"}`}`, ...(repository ? { repository } : {}), state: "all", limit: 20 });
      if (kind === "everything" && server.config.enabledTools.includes("search_repositories") && server.tools.some((tool) => tool.name === "search_repositories")) {
        const repositories = await request("search_repositories", { query: `${query.trim()}${repository ? ` repo:${repository}` : ""}`, limit: 5 });
        return [...results, ...repositories];
      }
      return results.filter((item) => kind === "everything" || item.resourceType === kind);
    },
    refresh: async (resource) => {
      if (resource.resourceType === "repository") {
        const results = await request("search_repositories", { query: `repo:${resource.repository}`, limit: 1 });
        const match = results.find((item) => item.url === resource.url);
        if (!match) throw new Error("Repository is no longer available.");
        return match;
      }
      const results = await request("get_issue", { repository: resource.repository, number: resource.number });
      const match = results.find((item) => item.url === resource.url);
      if (!match) throw new Error("This resource is no longer available.");
      return match;
    },
    createIssue: async (input) => {
      const results = await request("create_issue", input);
      if (!results[0]) throw new Error("GitHub did not return an issue resource.");
      return results[0];
    },
  };
}

export function canBrowseGithub(server: McpServerSnapshot): boolean {
  return server.config.enabled && server.config.trusted && server.runtime.status === "connected" && server.tools.some((tool) => ["search_repositories", "search_issues"].includes(tool.name) && server.config.enabledTools.includes(tool.name));
}

export function githubPermissionTools(server: McpServerSnapshot, permissionId: string): string[] {
  const permission = GITHUB_PERMISSIONS.find((item) => item.id === permissionId);
  return server.tools.filter((tool) => permission?.tools.some((name) => name === tool.name)).map((tool) => tool.name);
}
