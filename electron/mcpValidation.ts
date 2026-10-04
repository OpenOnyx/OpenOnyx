import type {
  McpConfiguration,
  McpEnvironmentValue,
  McpHttpTransport,
  McpServerConfig,
  McpStdioTransport,
  McpTransportConfig,
} from "./mcpTypes.js";

export interface McpValidationIssue { path: string; message: string; }
export type McpValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: McpValidationIssue[] };

const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(issues: McpValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateStrings(value: unknown, path: string, issues: McpValidationIssue[], unique = false): boolean {
  if (!Array.isArray(value)) { issue(issues, path, "must be an array"); return false; }
  let valid = value.every((entry, index) => {
    if (typeof entry === "string") return true;
    issue(issues, `${path}[${index}]`, "must be a string");
    return false;
  });
  if (unique && new Set(value).size !== value.length) { issue(issues, path, "must not contain duplicate values"); valid = false; }
  return valid;
}

function validateValues(value: unknown, path: string, pattern: RegExp, issues: McpValidationIssue[]): boolean {
  if (!isRecord(value)) { issue(issues, path, "must be an object"); return false; }
  let valid = true;
  for (const [key, entry] of Object.entries(value)) {
    if (!pattern.test(key)) { issue(issues, `${path}.${key}`, "has an invalid name"); valid = false; }
    if (!isRecord(entry) || (entry.type !== "value" && entry.type !== "secret")) {
      issue(issues, `${path}.${key}`, "must be a value or secret reference"); valid = false; continue;
    }
    if (entry.type === "value" && typeof entry.value !== "string") {
      issue(issues, `${path}.${key}.value`, "must be a string"); valid = false;
    }
    if (entry.type === "secret" && !isNonEmptyString(entry.secretId)) {
      issue(issues, `${path}.${key}.secretId`, "must be a non-empty string"); valid = false;
    }
  }
  return valid;
}

function validateTransport(value: unknown, path: string, issues: McpValidationIssue[]): value is McpTransportConfig {
  if (!isRecord(value) || typeof value.transport !== "string") { issue(issues, path, "must specify a transport"); return false; }
  if (value.transport === "stdio") {
    const transport = value as Partial<McpStdioTransport>;
    if (!isNonEmptyString(transport.command)) issue(issues, `${path}.command`, "must be a non-empty string");
    validateStrings(transport.args, `${path}.args`, issues);
    validateValues(transport.env, `${path}.env`, ENVIRONMENT_KEY_PATTERN, issues);
    return true;
  }
  if (value.transport === "streamable-http" || value.transport === "sse") {
    const transport = value as Partial<McpHttpTransport>;
    if (!isNonEmptyString(transport.url)) issue(issues, `${path}.url`, "must be a non-empty string");
    else {
      try {
        const protocol = new URL(transport.url).protocol;
        if (protocol !== "http:" && protocol !== "https:") issue(issues, `${path}.url`, "must use http or https");
      } catch { issue(issues, `${path}.url`, "must be a valid URL"); }
    }
    validateValues(transport.headers, `${path}.headers`, HEADER_NAME_PATTERN, issues);
    return true;
  }
  issue(issues, `${path}.transport`, "is not supported");
  return false;
}

export function validateMcpServerConfig(input: unknown): McpValidationResult<McpServerConfig> {
  const issues: McpValidationIssue[] = [];
  if (!isRecord(input)) return { success: false, issues: [{ path: "server", message: "must be an object" }] };
  if (!isNonEmptyString(input.id) || !SERVER_ID_PATTERN.test(input.id)) issue(issues, "server.id", "must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens");
  if (!isNonEmptyString(input.name) || input.name.length > 100) issue(issues, "server.name", "must be a non-empty string of at most 100 characters");
  if (typeof input.enabled !== "boolean") issue(issues, "server.enabled", "must be a boolean");
  if (typeof input.trusted !== "boolean") issue(issues, "server.trusted", "must be a boolean");
  validateStrings(input.enabledTools, "server.enabledTools", issues, true);
  validateTransport(input.transport, "server.transport", issues);
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof input[field] !== "number" || !Number.isSafeInteger(input[field]) || input[field] < 0) issue(issues, `server.${field}`, "must be a non-negative integer");
  }
  return issues.length ? { success: false, issues } : { success: true, value: input as unknown as McpServerConfig };
}

export function validateMcpConfiguration(input: unknown): McpValidationResult<McpConfiguration> {
  if (!isRecord(input) || !isRecord(input.servers)) return { success: false, issues: [{ path: "servers", message: "must be an object" }] };
  const issues: McpValidationIssue[] = [];
  for (const [serverId, server] of Object.entries(input.servers)) {
    const result = validateMcpServerConfig(server);
    if (!result.success) issues.push(...result.issues.map((entry) => ({ ...entry, path: `servers.${serverId}.${entry.path.replace(/^server\.?/, "")}` })));
    else if (result.value.id !== serverId) issue(issues, `servers.${serverId}.id`, "must match its configuration key");
  }
  return issues.length ? { success: false, issues } : { success: true, value: input as unknown as McpConfiguration };
}