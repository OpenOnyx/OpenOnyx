import type { ExternalResource } from "../types/appResources";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const RESOURCE_LANGUAGE = "openonyx-resource";

export function parseExternalResource(value: unknown): ExternalResource | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.appId === "google-drive") return parseDriveResource(item);
  if (item.version !== 1 || item.appId !== "github" || typeof item.serverId !== "string" || !item.serverId || item.serverId.length > 100) return null;
  if (!["repository", "issue", "pull-request"].includes(String(item.resourceType))) return null;
  if (typeof item.repository !== "string" || (!REPOSITORY.test(item.repository) || item.repository.split("/").some((part) => /^\.+$/.test(part)))) return null;
  if (typeof item.title !== "string" || !item.title || typeof item.url !== "string") return null;
  const number = item.resourceType === "repository" ? undefined : Number(item.number);
  if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) return null;
  // Canonical URLs prevent a result from turning into an arbitrary protocol or host.
  const url = `https://github.com/${item.repository}${number ? `/${item.resourceType === "pull-request" ? "pull" : "issues"}/${number}` : ""}`;
  if (item.url !== url) return null;
  return {
    display: item.display === "reference" ? "reference" : item.display === "embed" ? "embed" : undefined,
    version: 1, appId: "github", serverId: item.serverId,
    resourceType: item.resourceType as import("../types/appResources").GithubResourceType,
    externalId: `${item.repository}${number ? `#${number}` : ""}`,
    repository: item.repository, number, title: item.title.slice(0, 500), url,
    state: typeof item.state === "string" ? item.state.slice(0, 30) : undefined,
    body: typeof item.body === "string" ? item.body.slice(0, 12000) : undefined,
    labels: Array.isArray(item.labels) ? item.labels.filter((label): label is string => typeof label === "string").slice(0, 20).map((label) => label.slice(0, 80)) : undefined,
    comments: typeof item.comments === "number" && Number.isSafeInteger(item.comments) && item.comments >= 0 ? item.comments : undefined,
    discussion: Array.isArray(item.discussion) ? item.discussion.slice(0, 10).flatMap((comment) => {
      if (!comment || typeof comment !== "object" || typeof comment.author !== "string" || typeof comment.body !== "string") return [];
      return [{ author: comment.author.slice(0, 80), body: comment.body.slice(0, 2000) }];
    }) : undefined,
    updatedAt: typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt.slice(0, 40) : undefined,
  };
}

export function serializeExternalResource(resource: ExternalResource): string {
  const safe = parseExternalResource(resource);
  if (!safe) throw new Error("Invalid external resource");
  // Escaping backticks prevents untrusted bodies from closing the code fence.
  const json = JSON.stringify(safe).replace(/`/g, "\\u0060").replace(/</g, "\\u003c");
  return `\`\`\`${RESOURCE_LANGUAGE}\n${json}\n\`\`\``;
}

export function parseResourceJson(json: string): ExternalResource | null {
  if (json.length > 80000) return null;
  try { return parseExternalResource(JSON.parse(json)); } catch { return null; }
}

export function resourceBlocks(markdown: string): Array<{ from: number; to: number; resource: ExternalResource }> {
  const blocks: Array<{ from: number; to: number; resource: ExternalResource }> = [];
  // Walk all fences so examples nested inside ordinary code never become resources.
  const lines = markdown.split("\n");
  let offset = 0;
  let fence: { marker: string; size: number; from: number; resource: boolean; body: string[] } | null = null;
  for (const line of lines) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && open) {
      fence = { marker: open[1][0], size: open[1].length, from: offset, resource: open[2].trim() === RESOURCE_LANGUAGE, body: [] };
    } else if (fence) {
      if (new RegExp(`^ {0,3}${fence.marker}{${fence.size},}\\s*$`).test(line)) {
        if (fence.resource) {
          const resource = parseResourceJson(fence.body.join("\n"));
          if (resource) blocks.push({ from: fence.from, to: offset + line.length, resource });
        }
        fence = null;
      } else fence.body.push(line);
    }
    offset += line.length + 1;
  }
  return blocks;
}

const RECENT_KEY = "openonyx-app-resource-recents-v1";
export function recentResources(serverId?: string): ExternalResource[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(values)) return [];
    return values.map(parseExternalResource).filter((item): item is ExternalResource => Boolean(item && (!serverId || item.serverId === serverId))).slice(0, 20);
  } catch { return []; }
}

export function rememberResource(resource: ExternalResource): void {
  const safe = parseExternalResource(resource);
  if (!safe) return;
  // Recent history contains identity and title only; no body, arguments, or auth.
  const { body: _body, ...withoutBody } = safe;
  const identity = withoutBody.appId === "github" ? { ...withoutBody, labels: undefined, discussion: undefined } : withoutBody;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([identity, ...recentResources().filter((entry) => entry.url !== safe.url || entry.serverId !== safe.serverId)].slice(0, 20)));
  } catch { /* A full/disabled local store must not prevent insertion. */ }
}

const DRIVE_KINDS: Record<string, string> = {
  "application/vnd.google-apps.document": "document", "application/vnd.google-apps.spreadsheet": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.google-apps.presentation": "presentation", "application/vnd.google-apps.folder": "folder", "application/pdf": "pdf",
};
function parseDriveResource(item: Record<string, unknown>): ExternalResource | null {
  if (item.version !== 1 || typeof item.serverId !== "string" || !/^drive-[a-f0-9]{24}$/.test(item.serverId)
    || typeof item.externalId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(item.externalId)
    || typeof item.title !== "string" || !item.title || typeof item.mimeType !== "string" || item.mimeType.length > 200) return null;
  const mimeKind = DRIVE_KINDS[item.mimeType] || "file";
  const uploadedOffice = item.mimeType.startsWith("application/vnd.openxmlformats-officedocument.") && mimeKind !== "file";
  // Existing notes classified uploaded Office files as generic files. Keep those references valid.
  const kind = uploadedOffice && item.resourceType === "file" ? "file" : mimeKind;
  if (item.resourceType !== kind) return null;
  const nativeKind = item.mimeType.startsWith("application/vnd.google-apps.") ? kind : "file";
  const base = nativeKind === "document" ? "https://docs.google.com/document/d/" : nativeKind === "spreadsheet" ? "https://docs.google.com/spreadsheets/d/" : nativeKind === "presentation" ? "https://docs.google.com/presentation/d/" : nativeKind === "folder" ? "https://drive.google.com/drive/folders/" : "https://drive.google.com/file/d/";
  const url = base + item.externalId + (["document", "spreadsheet", "presentation"].includes(nativeKind) ? "/edit" : nativeKind === "folder" ? "" : "/view");
  if (item.url !== url || typeof item.cachedAt !== "string" || !Number.isFinite(Date.parse(item.cachedAt))) return null;
  return { version: 1, appId: "google-drive", serverId: item.serverId, externalId: item.externalId,
    resourceType: kind as import("../types/appResources").DriveResourceType, title: item.title.slice(0, 500), url,
    mimeType: item.mimeType, owner: typeof item.owner === "string" ? item.owner.slice(0, 240) : undefined,
    size: typeof item.size === "number" && Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : undefined,
    body: typeof item.body === "string" ? item.body.slice(0, 4000) : undefined,
    updatedAt: typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt.slice(0, 40) : undefined,
    cachedAt: item.cachedAt.slice(0, 40), display: item.display === "compact" || item.display === "link" ? item.display : item.display === "reference" ? "reference" : item.display === "embed" ? "embed" : undefined };
}
