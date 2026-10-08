// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalResource } from "../src/types/appResources";
import type { McpServerSnapshot } from "../src/types/mcp";
import { parseExternalResource, recentResources, rememberResource, resourceBlocks, serializeExternalResource } from "../src/utils/appResources";
import { createGithubProvider, resourcesFromMcpResult } from "../src/utils/githubProvider";
import { createResourceCard } from "../src/components/apps/ResourceCard";
import { appResourceExtension, appSlashCompletion } from "../src/editor/appResourceExtension";
import { EditorView } from "@codemirror/view";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";

const execution = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/api", () => ({ getAPI: () => ({ mcp: { requestToolExecution: execution } }) }));

const resource: ExternalResource = {
  version: 1, appId: "github", serverId: "existing-github", resourceType: "issue", externalId: "OpenOnyx/OpenOnyx#281",
  repository: "OpenOnyx/OpenOnyx", number: 281, title: "Windows signing", url: "https://github.com/OpenOnyx/OpenOnyx/issues/281",
  state: "open", body: "Release details", comments: 8,
};
const apiIssue = { html_url: resource.url, title: resource.title, number: 281, body: resource.body, state: "open" };
const server: McpServerSnapshot = {
  config: { id: resource.serverId, name: "GitHub", enabled: true, trusted: true, enabledTools: ["search_issues", "get_issue"], favoriteTools: [], transport: { transport: "stdio", command: "node", args: [], env: {} }, createdAt: 1, updatedAt: 1 },
  runtime: { status: "connected", diagnostics: [] },
  tools: [{ name: "search_issues", inputSchema: { type: "object", required: ["query"] } }, { name: "get_issue", inputSchema: {} }],
};

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("external resource persistence and safety", () => {
  it("survives a Markdown save/reload without serializing extra secrets or code fences", () => {
    const source = serializeExternalResource({ ...resource, body: "```\n<script>alert(1)</script>", token: "private", transport: { env: { GITHUB_TOKEN: "private" } } } as ExternalResource);
    const note = `# Release\n\n${source}\n\nContinue writing.`;
    const loaded = resourceBlocks(note);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].resource.body).toBe("```\n<script>alert(1)</script>");
    expect(source).not.toContain("private");
    expect(source).not.toContain("<script>");
    expect(loaded[0].resource.url).toBe(resource.url);
    expect(EditorState.create({ doc: note, extensions: [appResourceExtension()] }).doc.toString()).toBe(note);
  });

  it("renders a saved resource after closing and reopening the editor from disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openonyx-resource-test-"));
    const file = path.join(directory, "release.md");
    const host = document.createElement("div");
    document.body.append(host);
    let view: EditorView | undefined;
    try {
      const note = `# Release\n\n${serializeExternalResource(resource)}\n\nContinue writing.`;
      view = new EditorView({ parent: host, state: EditorState.create({ doc: note, extensions: [appResourceExtension()] }) });
      expect(host.querySelector(".app-resource-title")?.textContent).toBe("#281 Windows signing");
      await writeFile(file, view.state.doc.toString(), "utf8");
      view.destroy();
      const saved = await readFile(file, "utf8");
      view = new EditorView({ parent: host, state: EditorState.create({ doc: saved, extensions: [appResourceExtension()] }) });
      expect(host.querySelector(".app-resource-title")?.textContent).toBe("#281 Windows signing");
      expect(view.state.doc.toString()).toContain("Continue writing.");
      expect(execution).not.toHaveBeenCalled();
    } finally { view?.destroy(); host.remove(); await rm(directory, { recursive: true, force: true }); }
  });

  it("never treats code examples or malformed resources as live objects", () => {
    expect(resourceBlocks(`\`\`\`\`markdown\n${serializeExternalResource(resource)}\n\`\`\`\``)).toEqual([]);
    expect(resourceBlocks('```openonyx-resource\n{"appId":"github"}\n```')).toEqual([]);
    expect(parseExternalResource({ ...resource, url: "javascript:alert(1)" })).toBeNull();
    expect(parseExternalResource({ ...resource, url: "https://github.com.evil.test/a/b/issues/281" })).toBeNull();
    expect(parseExternalResource({ ...resource, repository: "../secrets" })).toBeNull();
  });

  it("renders hostile provider text as text and opens a view only on selection", () => {
    const open = vi.fn();
    const card = createResourceCard({ ...resource, title: '<img src=x onerror="alert(1)">', body: "<script>bad()</script>" }, open);
    expect(card.querySelector("img, script")).toBeNull();
    expect(card.textContent).not.toContain("bad()");
    expect(open).not.toHaveBeenCalled();
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("stores only recent resource identity, with no issue body or credentials", () => {
    rememberResource({ ...resource, body: "sensitive issue body", token: "secret" } as ExternalResource);
    expect(recentResources(resource.serverId)).toHaveLength(1);
    const stored = localStorage.getItem("openonyx-app-resource-recents-v1")!;
    expect(stored).not.toContain("sensitive issue body");
    expect(stored).not.toContain("secret");
    expect(recentResources("different-server")).toHaveLength(0);
  });
});

describe("GitHub resource provider", () => {
  it("maps real provider structures and legacy text to resources", () => {
    expect(resourcesFromMcpResult({ structuredContent: { items: [apiIssue] } }, server.config.id)[0].externalId).toBe(resource.externalId);
    expect(resourcesFromMcpResult({ content: [{ type: "text", text: `Issue #281 Windows signing\nState: open\nURL: ${resource.url}` }] }, server.config.id)[0].title).toBe(resource.title);
    expect(() => resourcesFromMcpResult({ isError: true, content: [{ type: "text", text: "Denied" }] }, "github")).toThrow("Denied");
  });

  it("does nothing until a search is submitted and uses the existing confirmation gateway", async () => {
    const provider = createGithubProvider(server);
    expect(execution).not.toHaveBeenCalled();
    execution.mockResolvedValue({ structuredContent: { items: [apiIssue] } });
    const results = await provider.search("signpath", "issue");
    expect(results).toHaveLength(1);
    expect(execution).toHaveBeenCalledWith(server.config.id, "search_issues", { query: "signpath is:issue", state: "all", limit: 20 });
  });

  it("looks up 20 and #20 directly instead of searching for text", async () => {
    const issue = { ...apiIssue, number: 20, html_url: "https://github.com/OpenOnyx/OpenOnyx/issues/20" };
    execution.mockResolvedValue({ structuredContent: { items: [issue] } });
    for (const query of ["20", "#20", "https://github.com/OpenOnyx/OpenOnyx/issues/20"]) {
      const found = await createGithubProvider(server).search(query, "issue", query.startsWith("https:") ? undefined : "OpenOnyx/OpenOnyx");
      expect(found[0].number).toBe(20);
      expect(execution).toHaveBeenLastCalledWith(server.config.id, "get_issue", { repository: "OpenOnyx/OpenOnyx", number: 20 });
    }
  });

  it("shows the actual resource type for a numbered PR even when browsing issues", async () => {
    execution.mockResolvedValue({ structuredContent: { items: [{ ...apiIssue, number: 20, html_url: "https://github.com/OpenOnyx/OpenOnyx/pull/20" }] } });
    expect((await createGithubProvider(server).search("20", "issue", "OpenOnyx/OpenOnyx"))[0].resourceType).toBe("pull-request");
  });

  it("requires a repository for a number and rejects non-GitHub links", async () => {
    await expect(createGithubProvider(server).search("20", "issue")).rejects.toThrow("Choose a repository");
    await expect(createGithubProvider(server).search("https://example.com/a/b/issues/20", "issue")).rejects.toThrow("GitHub issue");
    expect(execution).not.toHaveBeenCalled();
  });

  it("honors disabled tools, disconnected servers and native denial", async () => {
    await expect(createGithubProvider({ ...server, config: { ...server.config, enabledTools: [] } }).search("test", "issue")).rejects.toThrow("permission");
    await expect(createGithubProvider({ ...server, runtime: { ...server.runtime, status: "disconnected" } }).refresh(resource)).rejects.toThrow("Reconnect");
    expect(execution).not.toHaveBeenCalled();
    execution.mockRejectedValue(new Error("Native approval cancelled"));
    await expect(createGithubProvider(server).search("test", "issue")).rejects.toThrow("cancelled");
  });

  it("keeps credential setup instructions out of contextual action errors", async () => {
    const authenticatedAction = { ...server, config: { ...server.config, enabledTools: ["create_issue"] }, tools: [{ name: "create_issue", inputSchema: {} }] };
    execution.mockRejectedValue(new Error("GITHUB_TOKEN or --token-file is required"));
    await expect(createGithubProvider(authenticatedAction).createIssue({ repository: "OpenOnyx/OpenOnyx", title: "Test", body: "", labels: [] })).rejects.toThrow("authenticated GitHub connection");
  });

  it("supports older providers requiring a repository without changing their config", async () => {
    const old = { ...server, tools: [{ name: "search_issues", inputSchema: { required: ["query", "repository"] } }] };
    await expect(createGithubProvider(old).search("test", "issue")).rejects.toThrow("Choose a repository");
    expect(execution).not.toHaveBeenCalled();
  });
});

describe("editor slash menu", () => {
  it("offers GitHub for a connected app and never executes when selecting it", async () => {
    const open = vi.fn();
    const state = EditorState.create({ doc: "/", extensions: [markdown()] });
    const source = appSlashCompletion(open, () => true);
    const result = await source(new CompletionContext(state, 1, false));
    expect(result?.options[0].label).toBe("GitHub");
    expect(execution).not.toHaveBeenCalled();
    expect(appSlashCompletion(open, () => false)(new CompletionContext(state, 1, false))).toBeNull();
  });

  it("does not offer app insertion in code fences or ordinary URLs", () => {
    for (const doc of ["```\n/", "https://github.com/"]) {
      const state = EditorState.create({ doc, extensions: [markdown()] });
      expect(appSlashCompletion(vi.fn(), () => true)(new CompletionContext(state, doc.length, false))).toBeNull();
    }
  });
});
