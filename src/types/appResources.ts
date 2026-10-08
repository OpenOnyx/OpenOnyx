import type { ExternalResourceIdentity } from "../utils/appRegistry";

/** Provider data is untrusted. Resources own no local Markdown paths or credentials. */
export type GithubResourceType = "repository" | "issue" | "pull-request";

export interface GithubResource extends ExternalResourceIdentity {
  version: 1;
  appId: "github";
  serverId: string;
  resourceType: GithubResourceType;
  externalId: string;
  repository: string;
  number?: number;
  title: string;
  url: string;
  state?: string;
  body?: string;
  labels?: string[];
  comments?: number;
  discussion?: Array<{ author: string; body: string }>;
  updatedAt?: string;
  display?: "embed" | "reference";
}

/** Alternate REST/OAuth providers must use the same review/approval boundary. */
export interface AppResourceProvider<Resource extends ExternalResourceIdentity = ExternalResourceIdentity, ResourceKind extends string = string> {
  appId: string;
  kind: "mcp" | "oauth" | "rest";
  search(query: string, kind: ResourceKind, scope?: string): Promise<Resource[]>;
  refresh(resource: Resource): Promise<Resource>;
}

export interface GithubResourceProvider extends AppResourceProvider<GithubResource, GithubResourceType | "everything"> {
  createIssue(input: { repository: string; title: string; body: string; labels: string[] }): Promise<GithubResource>;
}

export type DriveResourceType = "document" | "spreadsheet" | "presentation" | "pdf" | "folder" | "file";
export interface DriveResource extends ExternalResourceIdentity {
  version: 1;
  appId: "google-drive";
  serverId: string; // Stable account identity, never a credential.
  resourceType: DriveResourceType;
  externalId: string;
  title: string;
  url: string;
  mimeType: string;
  owner?: string;
  size?: number;
  body?: string;
  updatedAt?: string;
  cachedAt: string;
  display?: "embed" | "reference" | "compact" | "link";
}
export type ExternalResource = GithubResource | DriveResource;
