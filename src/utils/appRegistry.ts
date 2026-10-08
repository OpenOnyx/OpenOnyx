import type { McpServerConfig, McpServerSnapshot, McpTool, McpToolActivity } from "../types/mcp";
import { getToolTitle } from "./mcpSchema";

export const BUNDLED_MCP_COMMAND = "__openonyx_bundled_mcp__";

export type AppCategory = "popular" | "development" | "communication" | "productivity" | "files-data" | "developer" | "custom";
export type AppAvailability = "available" | "installed" | "coming-soon";
export type AppSetupType = "bundled" | "local" | "remote" | "custom";
export type AppIconKey =
  | "github"
  | "google-drive"
  | "google-calendar"
  | "discord"
  | "telegram"
  | "notion"
  | "gmail"
  | "slack"
  | "linear"
  | "folder"
  | "plug"
  | "database";
export type AppId =
  | "github"
  | "filesystem"
  | "google-drive"
  | "google-calendar"
  | "discord"
  | "telegram"
  | "notion"
  | "gmail"
  | "slack"
  | "linear"
  | "database"
  | "local-test"
  | "custom"
  | string;

export interface AppPresentationMetadata {
  id: AppId;
  displayName: string;
  description: string;
  icon: AppIconKey;
  category: AppCategory;
}

export interface AppCatalogEntry extends AppPresentationMetadata {
  name: string;
  tags: string[];
  provider: "openonyx" | "mcp" | "roadmap";
  availability: AppAvailability;
  setupType: AppSetupType;
  popular?: boolean;
  capabilities: string[];
}

export interface ToolDescriptor {
  appId: AppId;
  serverId: string;
  toolName: string;
  displayName: string;
  description?: string;
  inputSchema: unknown;
  enabled: boolean;
  favorite: boolean;
  executionPolicy: "always-confirm";
}

export interface AppDescriptor {
  appId: AppId;
  server: McpServerSnapshot;
  metadata: AppPresentationMetadata;
  tools: ToolDescriptor[];
}

export interface DiscoverableApp extends AppCatalogEntry {
  id: "github" | "filesystem" | "custom" | "google-drive";
  actionLabel: "Add" | "Configure";
  availability: "available";
}

export interface ExternalResourceIdentity {
  appId: AppId;
  resourceType: string;
  externalId: string;
  title: string;
  url?: string;
  metadata?: Record<string, string | number | boolean>;
}

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  popular: "Popular",
  productivity: "Productivity",
  development: "Development",
  communication: "Communication",
  "files-data": "Files & knowledge",
  developer: "Advanced",
  custom: "Custom",
};

const CATALOG_BASE: AppCatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    displayName: "GitHub",
    description: "Repositories, issues and pull requests.",
    icon: "github",
    category: "development",
    tags: ["code", "repositories", "issues", "pull requests", "development"],
    provider: "openonyx",
    availability: "available",
    setupType: "bundled",
    popular: true,
    capabilities: ["Search repositories", "Search issues", "Read pull requests", "Create issues"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    displayName: "Filesystem",
    description: "Approved local files and directories.",
    icon: "folder",
    category: "files-data",
    tags: ["files", "folders", "local", "documents", "search"],
    provider: "openonyx",
    availability: "available",
    setupType: "local",
    popular: true,
    capabilities: ["Search files", "List directories", "Read approved files"],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    displayName: "Google Drive",
    description: "Search and work with files.",
    icon: "google-drive",
    category: "files-data",
    tags: ["drive", "files", "docs", "cloud", "google"],
    provider: "openonyx",
    availability: "available",
    setupType: "remote",
    popular: true,
    capabilities: ["Search files", "Open documents"],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    displayName: "Google Calendar",
    description: "Events and schedules.",
    icon: "google-calendar",
    category: "productivity",
    tags: ["calendar", "events", "schedule", "google"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    popular: true,
    capabilities: ["Find events", "View schedules"],
  },
  {
    id: "discord",
    name: "Discord",
    displayName: "Discord",
    description: "Messages and channels.",
    icon: "discord",
    category: "communication",
    tags: ["chat", "messages", "channels", "community"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    popular: true,
    capabilities: ["Search messages", "Read channels"],
  },
  {
    id: "telegram",
    name: "Telegram",
    displayName: "Telegram",
    description: "Chats and messages.",
    icon: "telegram",
    category: "communication",
    tags: ["chat", "messages", "telegram"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Search chats", "Read messages"],
  },
  {
    id: "notion",
    name: "Notion",
    displayName: "Notion",
    description: "Pages and databases.",
    icon: "notion",
    category: "productivity",
    tags: ["docs", "pages", "databases", "workspace"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Search pages", "Query databases"],
  },
  {
    id: "gmail",
    name: "Gmail",
    displayName: "Gmail",
    description: "Email and threads.",
    icon: "gmail",
    category: "communication",
    tags: ["email", "mail", "threads", "google"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Search email", "Read threads"],
  },
  {
    id: "slack",
    name: "Slack",
    displayName: "Slack",
    description: "Messages and workspaces.",
    icon: "slack",
    category: "communication",
    tags: ["chat", "messages", "workspaces", "channels"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Search messages", "Read channels"],
  },
  {
    id: "linear",
    name: "Linear",
    displayName: "Linear",
    description: "Issues and projects.",
    icon: "linear",
    category: "productivity",
    tags: ["issues", "projects", "tasks", "product"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Search issues", "Read projects"],
  },
  {
    id: "database",
    name: "Databases",
    displayName: "Databases",
    description: "Query approved data sources.",
    icon: "database",
    category: "files-data",
    tags: ["database", "sql", "data", "query"],
    provider: "roadmap",
    availability: "coming-soon",
    setupType: "remote",
    capabilities: ["Query data", "Inspect tables"],
  },
  {
    id: "custom",
    name: "Custom MCP",
    displayName: "Custom MCP",
    description: "Connect any compatible MCP server.",
    icon: "plug",
    category: "developer",
    tags: ["mcp", "server", "custom", "stdio", "http", "sse"],
    provider: "mcp",
    availability: "available",
    setupType: "custom",
    capabilities: ["Use discovered MCP capabilities"],
  },
];

const PRESENTATION: Record<string, AppPresentationMetadata> = Object.fromEntries(
  CATALOG_BASE.map((entry) => [entry.id, {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    icon: entry.icon,
    category: entry.category,
  }]),
);

PRESENTATION["local-test"] = {
  id: "local-test",
  displayName: "Local MCP Test",
  description: "Development connection for MCP regression testing.",
  icon: "plug",
  category: "developer",
};

export const APP_CATALOG: AppCatalogEntry[] = CATALOG_BASE;

export const DISCOVERABLE_APPS: DiscoverableApp[] = APP_CATALOG.filter((entry): entry is DiscoverableApp => (
  entry.availability === "available" && (entry.id === "github" || entry.id === "filesystem" || entry.id === "custom" || entry.id === "google-drive")
)).map((entry) => ({
  ...entry,
  actionLabel: entry.id === "custom" ? "Configure" : "Add",
}));

function now(): number {
  return Date.now();
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase()) || value;
}

export function getCatalogEntry(appId: AppId): AppCatalogEntry | undefined {
  return APP_CATALOG.find((entry) => entry.id === appId);
}

export function catalogSearchText(entry: AppCatalogEntry): string {
  return `${entry.name} ${entry.displayName} ${entry.description} ${CATEGORY_LABELS[entry.category]} ${entry.tags.join(" ")}`.toLowerCase();
}

export function identifyAppId(server: McpServerSnapshot | McpServerConfig): AppId {
  const config = "config" in server ? server.config : server;
  const search = `${config.id} ${config.name}`.toLowerCase();
  if (config.id === "local-test") return "local-test";
  if (search.includes("github")) return "github";
  if (search.includes("filesystem") || search.includes("file-system") || search.includes("files")) return "filesystem";
  if (search.includes("calendar")) return "google-calendar";
  if (search.includes("drive")) return "google-drive";
  if (search.includes("discord")) return "discord";
  if (search.includes("telegram")) return "telegram";
  if (search.includes("notion")) return "notion";
  if (search.includes("gmail") || search.includes("email")) return "gmail";
  if (search.includes("slack")) return "slack";
  if (search.includes("linear")) return "linear";
  if (search.includes("database") || search.includes("sql")) return "database";
  return config.id || "custom";
}

export function getAppPresentation(server: McpServerSnapshot | McpServerConfig): AppPresentationMetadata {
  const config = "config" in server ? server.config : server;
  const appId = identifyAppId(server);
  const known = PRESENTATION[String(appId)];
  if (known) return known;
  return {
    id: appId,
    displayName: config.name || humanize(config.id) || "Custom App",
    description: "Connected through a custom MCP server.",
    icon: "plug",
    category: "custom",
  };
}

export function describeAppCapabilities(server: McpServerSnapshot): string {
  const metadata = getAppPresentation(server);
  if (server.tools.length === 0) return metadata.description;
  if (metadata.id === "custom" || metadata.id === server.config.id) {
    return server.tools.slice(0, 3).map((tool) => getToolTitle(tool.name).toLowerCase()).join(", ");
  }
  return metadata.description;
}

export function toToolDescriptor(server: McpServerSnapshot, tool: McpTool): ToolDescriptor {
  return {
    appId: identifyAppId(server),
    serverId: server.config.id,
    toolName: tool.name,
    displayName: getToolTitle(tool.name),
    description: tool.description,
    inputSchema: tool.inputSchema,
    enabled: server.config.enabledTools.includes(tool.name),
    favorite: server.config.favoriteTools?.includes(tool.name) ?? false,
    executionPolicy: "always-confirm",
  };
}

export function toAppDescriptor(server: McpServerSnapshot): AppDescriptor {
  return {
    appId: identifyAppId(server),
    server,
    metadata: getAppPresentation(server),
    tools: server.tools.map((tool) => toToolDescriptor(server, tool)),
  };
}

export function buildToolRegistry(servers: McpServerSnapshot[]): ToolDescriptor[] {
  return servers.flatMap((server) => server.tools.map((tool) => toToolDescriptor(server, tool)));
}

export function activityForApp(activity: McpToolActivity[], serverId: string, limit?: number): McpToolActivity[] {
  const entries = activity.filter((entry) => entry.serverId === serverId);
  return typeof limit === "number" ? entries.slice(0, limit) : entries;
}

export function createAppServerTemplate(appId: DiscoverableApp["id"], options: { filesystemRoot?: string } = {}): McpServerConfig {
  if (appId === "google-drive") throw new Error("Google Drive uses native account authorization, not an MCP server template.");
  const timestamp = now();
  const presentation = PRESENTATION[appId];
  const base = {
    id: appId,
    name: presentation.displayName,
    enabled: false,
    trusted: false,
    enabledTools: [],
    favoriteTools: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (appId === "github") {
    return {
      ...base,
      transport: {
        transport: "stdio",
        command: BUNDLED_MCP_COMMAND,
        args: ["github"],
        env: {},
      },
    };
  }

  if (appId === "filesystem") {
    return {
      ...base,
      transport: {
        transport: "stdio",
        command: BUNDLED_MCP_COMMAND,
        args: ["filesystem", "--root", options.filesystemRoot || "OO-Test-Vault"],
        env: {},
      },
    };
  }

  return {
    ...base,
    id: "",
    name: "",
    transport: { transport: "stdio", command: "", args: [], env: {} },
  };
}
