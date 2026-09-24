import type {
  McpConfiguration,
  McpEnvironmentValue,
  McpHttpTransport,
  McpServerConfig,
  McpStdioTransport,
  McpTransportConfig,
} from "../types/mcp.js";

export interface McpValidationIssue {
  path: string;
  message: string;
}

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

function addIssue(issues: McpValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: McpValidationIssue[],
  requireUnique = false,
): value is string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "must be an array");
    return false;
  }

  const valid = value.every((entry, index) => {
    if (typeof entry === "string") return true;
    addIssue(issues, `${path}[${index}]`, "must be a string");
    return false;
  });

  if (requireUnique && new Set(value).size !== value.length) {
    addIssue(issues, path, "must not contain duplicate values");
  }

  return valid;
}

function validateEnvironmentValues(
  value: unknown,
  path: string,
  keyPattern: RegExp,
  issues: McpValidationIssue[],
): value is Record<string, McpEnvironmentValue> {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return false;
  }

  let valid = true;
  for (const [key, entry] of Object.entries(value)) {
    if (!keyPattern.test(key)) {
      addIssue(issues, `${path}.${key}`, "has an invalid name");
      valid = false;
    }

    if (!isRecord(entry) || (entry.type !== "value" && entry.type !== "secret")) {
      addIssue(issues, `${path}.${key}`, "must be a value or secret reference");
      valid = false;
      continue;
    }

    if (entry.type === "value") {
      if (typeof entry.value !== "string") {
        addIssue(issues, `${path}.${key}.value`, "must be a string");
        valid = false;
      }
    } else if (!isNonEmptyString(entry.secretId)) {
      addIssue(issues, `${path}.${key}.secretId`, "must be a non-empty string");
      valid = false;
    }
  }

  return valid;
}

function validateTransport(
  value: unknown,
  path: string,
  issues: McpValidationIssue[],
): value is McpTransportConfig {
  if (!isRecord(value) || typeof value.transport !== "string") {
    addIssue(issues, path, "must specify a transport");
    return false;
  }

  if (value.transport === "stdio") {
    const transport = value as Partial<McpStdioTransport>;
    if (!isNonEmptyString(transport.command)) {
      addIssue(issues, `${path}.command`, "must be a non-empty string");
    }
    validateStringArray(transport.args, `${path}.args`, issues);
    validateEnvironmentValues(transport.env, `${path}.env`, ENVIRONMENT_KEY_PATTERN, issues);
    return true;
  }

  if (value.transport === "streamable-http" || value.transport === "sse") {
    const transport = value as Partial<McpHttpTransport>;
    if (!isNonEmptyString(transport.url)) {
      addIssue(issues, `${path}.url`, "must be a non-empty string");
    } else {
      try {
        const url = new URL(transport.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          addIssue(issues, `${path}.url`, "must use http or https");
        }
      } catch {
        addIssue(issues, `${path}.url`, "must be a valid URL");
      }
    }
    validateEnvironmentValues(transport.headers, `${path}.headers`, HEADER_NAME_PATTERN, issues);
    return true;
  }

  addIssue(issues, `${path}.transport`, "is not supported");
  return false;
}

export function validateMcpServerConfig(input: unknown): McpValidationResult<McpServerConfig> {
  const issues: McpValidationIssue[] = [];
  if (!isRecord(input)) {
    return { success: false, issues: [{ path: "server", message: "must be an object" }] };
  }

  if (!isNonEmptyString(input.id) || !SERVER_ID_PATTERN.test(input.id)) {
    addIssue(issues, "server.id", "must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  if (!isNonEmptyString(input.name) || input.name.length > 100) {
    addIssue(issues, "server.name", "must be a non-empty string of at most 100 characters");
  }
  if (typeof input.enabled !== "boolean") addIssue(issues, "server.enabled", "must be a boolean");
  if (typeof input.trusted !== "boolean") addIssue(issues, "server.trusted", "must be a boolean");
  validateStringArray(input.enabledTools, "server.enabledTools", issues, true);
  validateTransport(input.transport, "server.transport", issues);

  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof input[field] !== "number" || !Number.isSafeInteger(input[field]) || input[field] < 0) {
      addIssue(issues, `server.${field}`, "must be a non-negative integer");
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: input as unknown as McpServerConfig };
}

export function validateMcpConfiguration(input: unknown): McpValidationResult<McpConfiguration> {
  if (!isRecord(input) || !isRecord(input.servers)) {
    return { success: false, issues: [{ path: "servers", message: "must be an object" }] };
  }

  const issues: McpValidationIssue[] = [];
  for (const [serverId, server] of Object.entries(input.servers)) {
    const result = validateMcpServerConfig(server);
    if (!result.success) {
      issues.push(
        ...result.issues.map((issue) => ({
          ...issue,
          path: `servers.${serverId}.${issue.path.replace(/^server\.?/, "")}`,
        })),
      );
      continue;
    }
    if (result.value.id !== serverId) {
      addIssue(issues, `servers.${serverId}.id`, "must match its configuration key");
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: input as unknown as McpConfiguration };
}