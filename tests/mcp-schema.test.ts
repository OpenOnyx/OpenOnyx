import { describe, expect, it } from "vitest";
import {
  buildArgumentsFromForm,
  buildMcpFormModel,
  formatMcpResultRows,
  getToolTitle,
  summarizeMcpResult,
} from "../src/utils/mcpSchema";
import { createAppServerTemplate, toAppDescriptor } from "../src/utils/appRegistry";

describe("MCP schema helpers", () => {
  it("converts simple object schemas into form fields", () => {
    const model = buildMcpFormModel({
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo" },
        count: { type: "integer" },
        dryRun: { type: "boolean" },
        labels: { type: "array", items: { type: "string" } },
        status: { enum: ["open", "closed"] },
      },
      required: ["message", "count"],
    });

    expect(model).toMatchObject({
      supported: true,
      fields: [
        { name: "message", label: "Message", type: "string", required: true },
        { name: "count", label: "Count", type: "integer", required: true },
        { name: "dryRun", label: "Dry Run", type: "boolean", required: false },
        { name: "labels", label: "Labels", type: "array", itemType: "string" },
        { name: "status", label: "Status", type: "enum", enumValues: ["open", "closed"] },
      ],
    });
  });

  it("builds JSON arguments from schema form values", () => {
    const model = buildMcpFormModel({
      type: "object",
      properties: {
        repository: { type: "string" },
        issueNumber: { type: "integer" },
        labels: { type: "array", items: { type: "string" } },
        includeClosed: { type: "boolean" },
      },
      required: ["repository"],
    });

    if (!model.supported) throw new Error("expected supported model");
    expect(buildArgumentsFromForm(model.fields, {
      repository: "OpenOnyx/OpenOnyx",
      issueNumber: "182",
      labels: "bug\nwindows",
      includeClosed: true,
    })).toEqual({
      repository: "OpenOnyx/OpenOnyx",
      issueNumber: 182,
      labels: ["bug", "windows"],
      includeClosed: true,
    });
  });

  it("falls back for nested schemas that cannot be represented safely", () => {
    expect(buildMcpFormModel({
      type: "object",
      properties: {
        payload: { type: "object", properties: { title: { type: "string" } } },
      },
    })).toMatchObject({ supported: false });
  });

  it("formats tool names and results for product views", () => {
    expect(getToolTitle("search_files")).toBe("Search files");
    expect(summarizeMcpResult({ content: [{ type: "text", text: "Echo: Hello" }] })).toBe("Echo: Hello");
    expect(formatMcpResultRows({ status: "Open", issue: 182 })).toEqual([
      ["Status", "Open"],
      ["Issue", "182"],
    ]);
  });

  it("builds app presentation without changing MCP persistence shape", () => {
    const config = createAppServerTemplate("github");
    expect(config).toMatchObject({
      id: "github",
      name: "GitHub",
      enabled: false,
      trusted: false,
      enabledTools: [],
      favoriteTools: [],
    });

    const app = toAppDescriptor({
      config: { ...config, enabledTools: ["search_issues"], favoriteTools: ["search_issues"] },
      runtime: { status: "connected", diagnostics: [] },
      tools: [{ name: "search_issues", description: "Search issues.", inputSchema: {} }],
    });

    expect(app.metadata.displayName).toBe("GitHub");
    expect(app.tools[0]).toMatchObject({
      appId: "github",
      serverId: "github",
      toolName: "search_issues",
      displayName: "Search issues",
      enabled: true,
      favorite: true,
      executionPolicy: "always-confirm",
    });
  });
});
