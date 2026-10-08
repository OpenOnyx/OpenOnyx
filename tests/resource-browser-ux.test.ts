// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalResourcePicker, type ResourceBrowser } from "../src/components/apps/ExternalResourcePicker";
import { githubBrowserError } from "../src/components/apps/GithubResourcePicker";
import { createResourceCard } from "../src/components/apps/ResourceCard";
import { resourceBlocks, serializeExternalResource } from "../src/utils/appResources";
import type { ExternalResource } from "../src/types/appResources";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const issue: ExternalResource = { version: 1, appId: "github", serverId: "github", externalId: "OpenOnyx/OpenOnyx#20", resourceType: "issue", repository: "OpenOnyx/OpenOnyx", number: 20, title: "Writing context", url: "https://github.com/OpenOnyx/OpenOnyx/issues/20", state: "open" };
const repository: ExternalResource = { ...issue, externalId: "OpenOnyx/OpenOnyx", resourceType: "repository", number: undefined, title: "OpenOnyx/OpenOnyx", url: "https://github.com/OpenOnyx/OpenOnyx" };
const makeBrowser = (): ResourceBrowser<ExternalResource> => ({ name: "GitHub", filters: [{ id: "everything", label: "Everything" }, { id: "issue", label: "Issues" }, { id: "repository", label: "Repositories" }], recent: [issue, repository], search: vi.fn(async () => [issue, repository]), matchesFilter: (resource, filter) => filter === "everything" || resource.resourceType === filter, row: (resource) => ({ title: resource.title, subtitle: resource.repository, icon: "◉" }), scope: { label: "Repository", searchFilter: "repository", value: (resource) => resource.repository }, error: githubBrowserError });
async function mount(browser = makeBrowser()) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const select = vi.fn(), close = vi.fn();
  await act(async () => { root.render(React.createElement(ExternalResourcePicker<ExternalResource>, { browser, onClose: close, onSelect: select })); });
  return { host: document.body, browser, select, close, input: document.body.querySelector<HTMLInputElement>('[role="combobox"]')! };
}
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); });

it("focuses search and browses recent resources with arrows, Enter and Escape without requests", async () => {
  const { host, input, select, close, browser } = await mount();
  expect(document.activeElement).toBe(input);
  expect(host.textContent).not.toContain("Browse");
  expect(host.querySelector('input[placeholder="owner/repository"]')).toBeNull();
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain(issue.title);
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(select).toHaveBeenCalledWith(issue);
  expect(browser.search).not.toHaveBeenCalled();
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(close).toHaveBeenCalledOnce();
});

it("uses resource types and repositories as optional filters", async () => {
  const { host, browser } = await mount();
  const issues = [...host.querySelectorAll("button")].find((button) => button.textContent === "Issues")!;
  await act(async () => { issues.click(); });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  const filter = [...host.querySelectorAll("button")].find((button) => button.textContent === "Filters")!;
  await act(async () => { filter.click(); });
  const scope = [...host.querySelectorAll("button")].find((button) => button.textContent === "OpenOnyx/OpenOnyx")!;
  await act(async () => { scope.click(); });
  expect(host.querySelector('[aria-label="Remove repository filter"]')).not.toBeNull();
  expect(browser.search).not.toHaveBeenCalled();
});

it("works with a future provider without knowing GitHub fields", async () => {
  const browser = { name: "Documents", filters: [{ id: "everything", label: "Everything" }], recent: [{ appId: "test-documents", resourceType: "document", externalId: "doc1", title: "Roadmap" }], search: vi.fn(async () => []), matchesFilter: () => true, row: (resource: { title: string }) => ({ title: resource.title, subtitle: "Document", icon: "◇" }), error: () => "Couldn't reach documents." };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push(root);
  await act(async () => root.render(React.createElement(ExternalResourcePicker, { browser, onSelect: vi.fn(), onClose: vi.fn() })));
  expect(document.body.textContent).toContain("Roadmap");
  expect(browser.search).not.toHaveBeenCalled();
});

it("keeps provider errors readable and hides technical error details", () => {
  expect(githubBrowserError(new Error("MCP error -32000: connection closed /private/program.mjs"))).toBe("Couldn't load GitHub resources. Try again or reconnect in Apps.");
  expect(githubBrowserError(new Error("Native approval cancelled"))).toContain("wasn't approved");
});

it("switches display mode without changing identity or duplicating the saved object", () => {
  const update = vi.fn();
  const card = createResourceCard(issue, vi.fn(), { update });
  [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Display as reference")!.click();
  const reference = update.mock.calls[0][0];
  expect(reference.externalId).toBe(issue.externalId);
  expect(reference.display).toBe("reference");
  const blocks = resourceBlocks(serializeExternalResource(reference));
  expect(blocks).toHaveLength(1);
  expect(blocks[0].resource.display).toBe("reference");
  expect(createResourceCard(reference, vi.fn()).classList.contains("app-resource-reference")).toBe(true);
});

it("gives repositories and PRs distinct layouts without invented metadata", () => {
  const repo = createResourceCard(repository, vi.fn());
  expect(repo.classList.contains("app-resource-repository")).toBe(true);
  expect(repo.textContent).toContain("OpenOnyx / OpenOnyx");
  expect(repo.textContent).not.toContain("Saved snapshot");
  expect(repo.textContent).not.toContain("stars");
  const pull = createResourceCard({ ...issue, resourceType: "pull-request", url: "https://github.com/OpenOnyx/OpenOnyx/pull/20" }, vi.fn());
  expect(pull.textContent).toContain("Pull request");
  expect(pull.textContent).not.toContain("commits");
});

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows loading, readable failure, retry and empty guidance without automatic requests", async () => {
  let reject!: (failure: Error) => void;
  const browser = makeBrowser();
  browser.search = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  const { host, input } = await mount(browser);
  await type(input, "Ctrl+B");
  expect(browser.search).not.toHaveBeenCalled();
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Searching GitHub");
  await act(async () => reject(new Error("MCP error -32000: secret path")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load GitHub resources");
  expect(host.textContent).not.toContain("secret path");
  vi.mocked(browser.search).mockResolvedValueOnce([]);
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(); });
  expect(host.textContent).toContain('No GitHub results for “Ctrl+B”');
  expect(host.textContent).toContain("Try another search");
});

it("retains a direct lookup's actual PR kind even under the Issues filter", async () => {
  const pull = { ...issue, resourceType: "pull-request" as const, url: "https://github.com/OpenOnyx/OpenOnyx/pull/20" };
  const browser = makeBrowser(); browser.search = vi.fn(async () => [pull]);
  const { host, input, select } = await mount(browser);
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Issues")!.click(); });
  await type(input, pull.url);
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(select).toHaveBeenCalledWith(pull);
});

it("focuses rather than opens on click and requests refresh only from the explicit menu", () => {
  const open = vi.fn(), remove = vi.fn(), update = vi.fn(), request = vi.fn();
  const card = createResourceCard(issue, open, { remove, update }); document.body.append(card);
  card.click(); expect(document.activeElement).toBe(card); expect(open).not.toHaveBeenCalled();
  window.addEventListener("openonyx:resource-open", request);
  try {
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Refresh")!.click();
    expect(request.mock.calls[0][0].detail.refreshRequested).toBe(true);
    expect(request.mock.calls[0][0].detail.onUpdate).toBe(update);
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove from note")!.click();
    expect(remove).toHaveBeenCalledOnce();
  } finally { window.removeEventListener("openonyx:resource-open", request); }
});

it("portals the picker outside transformed editor panes and traps keyboard focus", async () => {
  const { input } = await mount();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  close.focus();
  await act(async () => { close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
  expect(document.activeElement).not.toBe(close);
  expect(dialog.contains(document.activeElement)).toBe(true);
  input.focus();
});

it("filters fetched results locally without discarding them or requesting again", async () => {
  const { host, input, browser } = await mount();
  await type(input, "OpenOnyx");
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Issues")!.click(); });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(host.textContent).toContain("Results");
  expect(browser.search).toHaveBeenCalledOnce();
});
