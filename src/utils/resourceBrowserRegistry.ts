import type { McpServerSnapshot } from "../types/mcp";
import { getAPI } from "./api";
import { identifyAppId } from "./appRegistry";
import { canBrowseGithub } from "./githubProvider";

/** Trusted local registrations only. Servers cannot register editor UI or commands. */
export interface ConnectedResourceApp { id: string; name: string; serverId: string; canCreateIssues?: boolean }
export const RESOURCE_BROWSER_APPS = [{ id: "github", name: "GitHub", available: canBrowseGithub }];

export async function connectedResourceApps(): Promise<ConnectedResourceApp[]> {
  const servers: McpServerSnapshot[] = await getAPI().mcp.list().catch(() => []);
  const github = servers.flatMap((server) => {
    const registration = RESOURCE_BROWSER_APPS.find((app) => app.id === identifyAppId(server));
    if (!registration || !registration.available(server)) return [];
    return [{ id: registration.id, name: registration.name, serverId: server.config.id, canCreateIssues: server.config.enabledTools.includes("create_issue") }];
  });
  const status = await getAPI().googleDrive?.status().catch(() => null);
  // Drive has an honest connection surface even before authorization is configured.
  return [...github, { id: "google-drive", name: "Google Drive", serverId: status?.accounts[0]?.id || "" }];
}
