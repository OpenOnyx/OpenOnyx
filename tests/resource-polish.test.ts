// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { resourceSummary, safeResourceMarkdown, safeResourceLink } from "../src/components/apps/resourceContent";
import { createResourceCard, resourceFreshness } from "../src/components/apps/ResourceCard";
import { appResourceExtension } from "../src/editor/appResourceExtension";
import { resourceBlocks, serializeExternalResource } from "../src/utils/appResources";
import type { ExternalResource } from "../src/types/appResources";
const execution = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/api", () => ({ getAPI: () => ({ mcp: { requestToolExecution: execution }, openExternal: vi.fn() }) }));
const resource: ExternalResource = { version: 1, appId: "github", serverId: "github", resourceType: "pull-request", externalId: "OpenOnyx/OpenOnyx#134", repository: "OpenOnyx/OpenOnyx", number: 134, title: "Harden vault paths", url: "https://github.com/OpenOnyx/OpenOnyx/pull/134", state: "open" };
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it("summarizes prose instead of Markdown headings and PR template references", () => {
  const summary = resourceSummary('### Summary\n\nCloses #65\n\nThis PR **hardens** vault paths against traversal and `symlink` escapes.\n\n### Changes\n\n- Validate paths');
  expect(summary).toBe("This PR hardens vault paths against traversal and symlink escapes.");
  expect(resourceSummary("A useful sentence. ".repeat(40))).toMatch(/sentence\.…$/);
});

it("sanitizes detail Markdown without scripts, images, active HTML or unsafe links", () => {
  const html = safeResourceMarkdown('## Details\n\n**Safe** [GitHub](https://github.com/OpenOnyx/OpenOnyx)\n\n![tracker](https://evil.test/pixel)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n<iframe src="https://evil.test"></iframe>');
  const host = document.createElement("div"); host.innerHTML = html;
  expect(host.querySelector("h2")?.textContent).toBe("Details");
  expect(host.querySelector("strong")?.textContent).toBe("Safe");
  expect(host.querySelector("img,script,iframe,svg,style")).toBeNull();
  expect(host.querySelector('a[href^="javascript"]')).toBeNull();
  expect(safeResourceLink("file:///etc/passwd")).toBe(false);
  expect(safeResourceLink("https://token:secret@github.com")).toBe(false);
});

it("uses local type icons and keeps developer actions out of the resource menu", () => {
  const card = createResourceCard(resource, vi.fn(), { update: vi.fn(), remove: vi.fn() });
  expect(card.querySelector("svg")).not.toBeNull();
  expect([...card.querySelectorAll(".app-resource-menu button")].map(button => button.textContent)).toEqual(["Refresh", "Open on GitHub", "Copy link", "Display as reference", "Remove from note"]);
});

it("shows cached freshness offline without pretending to know the snapshot's cache age", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(resourceFreshness(new Date(Date.now() - 86400000).toISOString())).toBe("Offline · cached snapshot · Updated 1d ago");
  expect(createResourceCard(resource, vi.fn()).textContent).toContain("Offline · cached snapshot");
  expect(execution).not.toHaveBeenCalled();
});

it("keeps node insertion, typing below, copy round-trip, undo, redo, display switching and removal coherent", () => {
  const host = document.createElement("div"); document.body.append(host);
  const before = "# Plan\n\n", snapshot = serializeExternalResource(resource) + "\n\n";
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: before, extensions: [history(), appResourceExtension()] }) });
  try {
    view.dispatch({ changes: { from: before.length, insert: snapshot }, selection: { anchor: before.length + snapshot.length } });
    expect(host.querySelectorAll(".app-resource-card")).toHaveLength(1);
    expect(undo(view)).toBe(true); expect(resourceBlocks(view.state.doc.toString())).toHaveLength(0);
    expect(redo(view)).toBe(true); expect(resourceBlocks(view.state.doc.toString())).toHaveLength(1);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "Continue writing.\n" } });
    expect(view.state.doc.toString()).toContain("Continue writing.");
    expect(resourceBlocks(view.state.sliceDoc())[0].resource.externalId).toBe(resource.externalId);
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Display as reference")!.click();
    expect(resourceBlocks(view.state.doc.toString())).toHaveLength(1);
    expect(resourceBlocks(view.state.doc.toString())[0].resource.display).toBe("reference");
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Remove from note")!.click();
    expect(resourceBlocks(view.state.doc.toString())).toHaveLength(0);
    expect(view.state.doc.toString()).toContain("Continue writing.");
  } finally { view.destroy(); }
});

it("ranks exact and recent repositories ahead of other results without hiding global matches", async () => {
  const { githubBrowser } = await import("../src/components/apps/GithubResourcePicker");
  const { rememberResource } = await import("../src/utils/appResources");
  const server = { config: { id: "github", name: "GitHub", enabled: true, trusted: true, enabledTools: ["search_repositories"], favoriteTools: [], transport: { transport: "stdio" as const, command: "node", args: [], env: {} }, createdAt: 1, updatedAt: 1 }, runtime: { status: "connected" as const, diagnostics: [] }, tools: [{ name: "search_repositories", inputSchema: {} }] };
  rememberResource({ ...resource, repository: "known/library", externalId: "known/library#134", url: "https://github.com/known/library/pull/134" });
  execution.mockResolvedValue({ structuredContent: { items: [
    { html_url: "https://github.com/other/project", full_name: "other/project" },
    { html_url: "https://github.com/known/library", full_name: "known/library" },
    { html_url: "https://github.com/OpenOnyx/OpenOnyx", full_name: "OpenOnyx/OpenOnyx" },
  ] } });
  try {
    const results = await githubBrowser(server).search("OpenOnyx", "repository");
    expect(results.map(result => result.repository)).toEqual(["OpenOnyx/OpenOnyx", "known/library", "other/project"]);
    expect(execution).toHaveBeenCalledWith("github", "search_repositories", { query: "OpenOnyx", limit: 10 });
  } finally { localStorage.clear(); execution.mockReset(); }
});
