import { CircleDot, GitPullRequest, BookMarked } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import type { GithubResource, GithubResourceType } from "../../types/appResources";
import type { McpServerSnapshot } from "../../types/mcp";
import { getAPI } from "../../utils/api";
import { identifyAppId } from "../../utils/appRegistry";
import { canBrowseGithub, createGithubProvider } from "../../utils/githubProvider";
import { recentResources, rememberResource } from "../../utils/appResources";
import { ResourceDialog } from "./ResourceDialog";
import { ExternalResourcePicker, type ResourceBrowser } from "./ExternalResourcePicker";

export function githubBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|denied by user/i.test(message)) return "Search wasn't approved. You can try again when you're ready.";
  if (/Choose a repository/i.test(message)) return "Choose a repository using Filter, or paste a GitHub issue or pull request link.";
  if (/permission|not enabled/i.test(message)) return "Allow GitHub read access in Apps → GitHub → Manage permissions.";
  if (/rate limit/i.test(message)) return "GitHub's request limit has been reached. Try again later.";
  if (/not found|404/i.test(message)) return "That GitHub resource isn't available. Check the link or repository filter.";
  return "Couldn't load GitHub resources. Try again or reconnect in Apps.";
}

export function githubBrowser(server: McpServerSnapshot): ResourceBrowser<GithubResource> {
  const provider = createGithubProvider(server);
  const filters = [{ id: "everything", label: "Everything" }];
  if (server.config.enabledTools.includes("search_issues")) filters.push({ id: "issue", label: "Issues" }, { id: "pull-request", label: "Pull requests" });
  if (server.config.enabledTools.includes("search_repositories")) filters.push({ id: "repository", label: "Repositories" });
  return {
    name: "GitHub", searchPlaceholder: "Search repositories, issues and pull requests…", searchHint: "Enter a name, issue number or link, then press Enter to search.", filters, recent: recentResources(server.config.id).filter((resource): resource is GithubResource => resource.appId === "github"),
    search: async (query, kind, repository) => {
      const results = await provider.search(query, kind as GithubResourceType | "everything", repository);
      const recent = recentResources(server.config.id).filter((resource): resource is GithubResource => resource.appId === "github");
      const used = new Set(recent.map((resource) => resource.repository.toLowerCase()));
      const owners = new Set(recent.map((resource) => resource.repository.split("/")[0].toLowerCase()));
      const term = query.trim().toLowerCase();
      const score = (resource: GithubResource) => resource.repository.toLowerCase() === term || resource.repository.split("/")[1].toLowerCase() === term ? 3 : used.has(resource.repository.toLowerCase()) ? 2 : owners.has(resource.repository.split("/")[0].toLowerCase()) ? 1 : 0;
      return results.map((resource, index) => ({ resource, index })).sort((a, b) => score(b.resource) - score(a.resource) || a.index - b.index).map(({ resource }) => resource);
    },
    matchesFilter: (resource, filter) => filter === "everything" || resource.resourceType === filter,
    row: (resource) => ({
      title: resource.resourceType === "repository" ? resource.repository.split("/")[1] : resource.title,
      subtitle: [resource.number ? `#${resource.number}` : "", resource.repository, resource.resourceType === "repository" ? "Repository" : resource.resourceType === "pull-request" ? "Pull request" : "Issue", resource.state ? resource.state[0].toUpperCase() + resource.state.slice(1) : ""].filter(Boolean).join(" · "),
      icon: resource.resourceType === "repository" ? <BookMarked size={17} /> : resource.resourceType === "pull-request" ? <GitPullRequest size={17} /> : <CircleDot size={17} />,
    }),
    scope: { label: "Repository", searchFilter: filters.some((filter) => filter.id === "repository") ? "repository" : undefined, value: (resource) => resource.repository, emptyHint: "Search using an issue or pull request link. Its repository will be available here." },
    error: githubBrowserError,
  };
}

/** GitHub supplies presentation and search; the browser itself is provider-neutral. */
export function GithubResourcePicker({ onClose, onSelect, initialKind = "everything", initialServerId }: {
  onClose: () => void; onSelect: (resource: GithubResource) => void; initialKind?: GithubResourceType | "everything"; initialServerId?: string;
}) {
  const [servers, setServers] = useState<McpServerSnapshot[]>([]);
  const [serverId, setServerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getAPI().mcp.list().then((all) => {
      if (!alive) return;
      const connected = all.filter((server) => identifyAppId(server) === "github" && canBrowseGithub(server));
      setServers(connected);
      setServerId(connected.find((server) => server.config.id === initialServerId)?.config.id || connected[0]?.config.id || "");
    }).catch((failure) => { if (alive) setError(githubBrowserError(failure)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [initialServerId]);
  const server = servers.find((item) => item.config.id === serverId);
  const browser = useMemo(() => server ? githubBrowser(server) : null, [server]);
  if (!browser) return <ResourceDialog title="GitHub" onClose={onClose}>
    <p role={error ? "alert" : "status"} className="text-sm text-[var(--text-muted)]">{error || (loading ? "Loading GitHub…" : "Connect GitHub and allow read access in Apps to browse resources.")}</p>
  </ResourceDialog>;
  const connectionControl = servers.length > 1 ? <label className="resource-browser-connection"><span className="sr-only">GitHub connection</span><select value={serverId} onChange={(event) => setServerId(event.target.value)}>{servers.map((item) => <option key={item.config.id} value={item.config.id}>{item.config.name}</option>)}</select></label> : <p className="resource-browser-connection">Public GitHub</p>;
  return <ExternalResourcePicker key={serverId} browser={browser} connectionControl={connectionControl} initialFilter={browser.filters.some((filter) => filter.id === initialKind) ? initialKind : "everything"}
    onClose={onClose} onSelect={(resource) => { rememberResource(resource); onSelect(resource); }} />;
}
