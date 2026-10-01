import type { McpServerSnapshot, McpTool } from "../types/mcp";

export type McpFormFieldType = "string" | "number" | "integer" | "boolean" | "enum" | "array";

export interface McpFormField {
  name: string;
  label: string;
  type: McpFormFieldType;
  required: boolean;
  description?: string;
  enumValues?: Array<string | number | boolean>;
  itemType?: "string" | "number" | "integer" | "boolean";
  defaultValue?: unknown;
  minimum?: number;
  maximum?: number;
  multiline?: boolean;
}

export type McpFormModel =
  | { supported: true; fields: McpFormField[] }
  | { supported: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTitle(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

export function getToolTitle(name: string): string {
  return toTitle(name) || name;
}

export function getConnectionTitle(server: McpServerSnapshot): string {
  if (server.config.id === "local-test") return "Local MCP Test";
  return server.config.name || getToolTitle(server.config.id);
}

export function getConnectionSubtitle(server: McpServerSnapshot): string {
  if (server.config.id === "local-test") return "Development connection";
  if (server.config.transport.transport === "stdio") return "Local connection";
  return "Connected service";
}

export function getConnectionDescription(server: McpServerSnapshot): string {
  const toolTitles = server.tools.slice(0, 3).map((tool) => getToolTitle(tool.name).toLowerCase());
  if (server.config.id === "github" || /github/i.test(server.config.name)) {
    return "Search repositories, issues and pull requests.";
  }
  if (server.config.id.includes("filesystem") || /file(system)?/i.test(server.config.name)) {
    return "Search files in approved folders.";
  }
  if (toolTitles.length) return toolTitles.join(", ");
  return "Provides tools through a connected service.";
}

export function getToolChips(tools: McpTool[], max = 3): string {
  return tools.slice(0, max).map((tool) => getToolTitle(tool.name)).join(" · ");
}

export function buildMcpFormModel(schema: unknown): McpFormModel {
  if (!isRecord(schema)) return { supported: true, fields: [] };
  if (schema.type !== undefined && schema.type !== "object") {
    return { supported: false, reason: "The tool input schema is not an object." };
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((value): value is string => typeof value === "string"))
    : new Set<string>();
  const fields: McpFormField[] = [];

  for (const [name, rawProperty] of Object.entries(properties)) {
    if (!isRecord(rawProperty)) return { supported: false, reason: `${name} uses an unsupported schema.` };
    const description = typeof rawProperty.description === "string" ? rawProperty.description : undefined;
    const base = {
      name,
      label: typeof rawProperty.title === "string" ? rawProperty.title : toTitle(name),
      required: required.has(name),
      description,
      defaultValue: rawProperty.default,
      minimum: typeof rawProperty.minimum === "number" ? rawProperty.minimum : undefined,
      maximum: typeof rawProperty.maximum === "number" ? rawProperty.maximum : undefined,
      multiline: rawProperty.format === "textarea" || name.toLowerCase().includes("body") || name.toLowerCase().includes("description"),
    };

    if (Array.isArray(rawProperty.enum) && rawProperty.enum.every((value) => ["string", "number", "boolean"].includes(typeof value))) {
      fields.push({ ...base, type: "enum", enumValues: rawProperty.enum as Array<string | number | boolean> });
      continue;
    }

    if (rawProperty.type === "string" || rawProperty.type === "number" || rawProperty.type === "integer" || rawProperty.type === "boolean") {
      fields.push({ ...base, type: rawProperty.type });
      continue;
    }

    if (rawProperty.type === "array") {
      const items = rawProperty.items;
      if (!isRecord(items) || !["string", "number", "integer", "boolean"].includes(String(items.type))) {
        return { supported: false, reason: `${name} is an array with unsupported items.` };
      }
      fields.push({ ...base, type: "array", itemType: items.type as McpFormField["itemType"] });
      continue;
    }

    return { supported: false, reason: `${name} uses an unsupported schema type.` };
  }

  for (const name of required) {
    if (!fields.some((field) => field.name === name)) {
      return { supported: false, reason: `${name} is required but not described by the schema.` };
    }
  }

  return { supported: true, fields };
}

export function getInitialFormValues(fields: McpFormField[]): Record<string, string | boolean> {
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "boolean") return [field.name, Boolean(field.defaultValue)];
    if (field.defaultValue === undefined) return [field.name, ""];
    if (Array.isArray(field.defaultValue)) return [field.name, field.defaultValue.join("\n")];
    return [field.name, String(field.defaultValue)];
  }));
}

export function buildArgumentsFromForm(fields: McpFormField[], values: Record<string, string | boolean>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "boolean") {
      if (raw === true || field.required) args[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text && !field.required) continue;
    if (!text && field.required) throw new Error(`${field.label} is required`);
    if (field.type === "number" || field.type === "integer") {
      const value = Number(text);
      if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
        throw new Error(`${field.label} must be a ${field.type}`);
      }
      if (field.minimum !== undefined && value < field.minimum) throw new Error(`${field.label} must be at least ${field.minimum}`);
      if (field.maximum !== undefined && value > field.maximum) throw new Error(`${field.label} must be at most ${field.maximum}`);
      args[field.name] = value;
    } else if (field.type === "enum") {
      const match = field.enumValues?.find((value) => String(value) === text);
      args[field.name] = match ?? text;
    } else if (field.type === "array") {
      args[field.name] = text
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          if (field.itemType === "number" || field.itemType === "integer") {
            const value = Number(item);
            if (!Number.isFinite(value) || (field.itemType === "integer" && !Number.isInteger(value))) {
              throw new Error(`${field.label} contains an invalid ${field.itemType}`);
            }
            return value;
          }
          if (field.itemType === "boolean") return item === "true";
          return item;
        });
    } else {
      args[field.name] = text;
    }
  }
  return args;
}

export function summarizeMcpResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 300);
  if (isRecord(result) && Array.isArray(result.content)) {
    const text = result.content
      .map((entry) => isRecord(entry) && entry.type === "text" && typeof entry.text === "string" ? entry.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text.slice(0, 300);
  }
  try {
    return JSON.stringify(result).slice(0, 300);
  } catch {
    return String(result).slice(0, 300);
  }
}

export interface McpRenderedResult {
  kind: "text" | "list" | "table" | "json";
  title?: string;
  text?: string;
  items?: Array<{ title: string; description?: string; url?: string; meta?: string }>;
  rows?: Array<[string, string]>;
}

export function renderMcpResult(result: unknown): McpRenderedResult {
  const text = extractMcpText(result);
  if (text) {
    const items = parseTextList(text);
    if (items.length > 1) return { kind: "list", title: `${items.length} results`, items };
    return { kind: "text", text };
  }
  const rows = formatMcpResultRows(result);
  if (rows) return { kind: "table", rows };
  return { kind: "json", text: summarizeMcpResult(result) };
}

function extractMcpText(result: unknown): string {
  if (typeof result === "string") return result;
  if (isRecord(result) && Array.isArray(result.content)) {
    return result.content
      .map((entry) => {
        if (isRecord(entry) && entry.type === "text" && typeof entry.text === "string") return entry.text;
        if (isRecord(entry) && entry.type === "resource" && typeof entry.resource === "object") return JSON.stringify(entry.resource);
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseTextList(text: string): Array<{ title: string; description?: string; url?: string; meta?: string }> {
  const chunks = text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length <= 1) return [];
  return chunks.map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    const urlLine = lines.find((line) => /^https?:\/\//.test(line));
    const metaLine = lines.find((line) => /^(State|URL|Stars?|PR|Issue):/i.test(line));
    return {
      title: lines[0] ?? chunk,
      description: lines.find((line, index) => index > 0 && line !== urlLine && line !== metaLine),
      url: urlLine,
      meta: metaLine && metaLine !== urlLine ? metaLine : undefined,
    };
  });
}

export function formatMcpResultRows(result: unknown): Array<[string, string]> | null {
  if (!isRecord(result) || Array.isArray(result)) return null;
  if ("content" in result) return null;
  const rows = Object.entries(result)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 12)
    .map(([key, value]) => [toTitle(key), String(value)] as [string, string]);
  return rows.length ? rows : null;
}
