import { createElement, CircleDot, GitPullRequest, BookMarked } from "lucide";
import { resourceSummary } from "./resourceContent";
import { getAPI } from "../../utils/api";
import { createDriveResourceCard } from "./DriveResourceCard";
import type { ExternalResource, GithubResource } from "../../types/appResources";

export interface ResourceCardActions {
  update?: (resource: ExternalResource) => void;
  remove?: () => void;
}

export function resourceFreshness(updatedAt?: string): string {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!updatedAt) return offline ? "Offline · cached snapshot" : "";
  const elapsed = Math.max(0, Date.now() - Date.parse(updatedAt));
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60000);
  const value = minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return `${offline ? "Offline · cached snapshot · " : ""}Updated ${value}`;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag); node.className = className;
  if (text) node.textContent = text;
  return node;
}

function resourceIcon(resource: GithubResource): SVGElement {
  return createElement(resource.resourceType === "repository" ? BookMarked : resource.resourceType === "pull-request" ? GitPullRequest : CircleDot, { width: 14, height: 14, "aria-hidden": "true", class: "app-resource-type-icon" });
}

function header(resource: GithubResource, repository: boolean): HTMLElement {
  const row = element("div", "app-resource-header");
  const identity = element("span", "app-resource-identity", `GitHub${repository ? "" : ` · ${resource.repository}`}`);
  identity.prepend(resourceIcon(resource)); row.append(identity);
  const open = element("button", "app-resource-open-original", "Open ↗") as HTMLButtonElement;
  open.type = "button"; open.setAttribute("aria-label", "Open on GitHub");
  open.addEventListener("click", (event) => { event.stopPropagation(); void getAPI().openExternal(resource.url); });
  row.append(open); return row;
}

function excerpt(resource: GithubResource, card: HTMLElement): void {
  if (!resource.body) return;
  const preview = resourceSummary(resource.body);
  if (preview) card.append(element("p", "app-resource-excerpt", preview));
}

function footer(resource: GithubResource, card: HTMLElement, comments = false): void {
  const row = element("div", "app-resource-footer");
  if (comments && resource.comments !== undefined) row.append(element("span", "", `${resource.comments} comments`));
  const freshness = resourceFreshness(resource.updatedAt);
  if (freshness) row.append(element("span", "app-resource-freshness", freshness));
  if (row.childNodes.length) card.append(row);
}

/** Each type has its own layout; only controls and safe text helpers are shared. */
function repositoryEmbed(resource: GithubResource, card: HTMLElement): void {
  card.append(header(resource, true), element("div", "app-resource-title", resource.repository.replace("/", " / ")), element("div", "app-resource-meta", "Repository"));
  excerpt(resource, card); footer(resource, card);
}
function issueEmbed(resource: GithubResource, card: HTMLElement): void {
  card.append(header(resource, false), element("div", "app-resource-title", `#${resource.number} ${resource.title}`));
  const state = resource.state ? resource.state[0].toUpperCase() + resource.state.slice(1) : "";
  if (state || resource.labels?.length) card.append(element("div", "app-resource-meta", [state ? `● ${state}` : "", ...(resource.labels || []).slice(0, 3)].filter(Boolean).join(" · ")));
  excerpt(resource, card); footer(resource, card, true);
}
function pullRequestEmbed(resource: GithubResource, card: HTMLElement): void {
  card.append(header(resource, false), element("div", "app-resource-title", `#${resource.number} ${resource.title}`));
  if (resource.state) card.append(element("div", "app-resource-meta", `Pull request · ${resource.state[0].toUpperCase()}${resource.state.slice(1)}`));
  excerpt(resource, card); footer(resource, card);
}

/** DOM-only renderer: external text never passes through innerHTML. */
export function createResourceCard(resource: ExternalResource, open: () => void, actions: ResourceCardActions = {}): HTMLElement {
  if (resource.appId === "google-drive") return createDriveResourceCard(resource, open, actions);
  const card = element("div", `app-resource-card app-resource-${resource.resourceType}${resource.display === "reference" ? " app-resource-reference" : ""}`);
  card.tabIndex = 0; card.setAttribute("role", "group"); card.setAttribute("aria-label", `GitHub ${resource.resourceType}: ${resource.title}`);
  if (resource.display === "reference") {
    const identity = element("div", "app-resource-identity", `GitHub · ${resource.repository}${resource.number ? ` #${resource.number}` : ""}`);
    identity.prepend(resourceIcon(resource));
    const content = element("div", "app-resource-reference-content");
    content.append(identity, element("div", "app-resource-title", resource.title)); card.append(content);
  } else if (resource.resourceType === "repository") repositoryEmbed(resource, card);
  else if (resource.resourceType === "pull-request") pullRequestEmbed(resource, card);
  else issueEmbed(resource, card);
  attachResourceActions(card, resource, open, actions, "Open on GitHub");
  return card;
}

/** Shared note controls; provider renderers supply only their presentation. */
export function attachResourceActions(card: HTMLElement, resource: ExternalResource, open: () => void, actions: ResourceCardActions, openLabel: string, previewActions?: { refresh: () => void; collapse: () => void }): void {
  card.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button, summary")) card.focus(); });
  card.addEventListener("dblclick", (event) => { if (!(event.target as HTMLElement).closest("button, summary")) open(); });
  card.addEventListener("keydown", (event) => { if (event.target === card && event.key === "Enter") { event.preventDefault(); open(); } });
  const menu = element("details", "app-resource-menu") as HTMLDetailsElement;
  const trigger = element("summary", "", "⋯"); trigger.setAttribute("aria-label", "Resource actions"); menu.append(trigger);
  const options = element("div", "app-resource-menu-options");
  const action = (label: string, callback: () => void) => {
    const button = element("button", "", label) as HTMLButtonElement; button.type = "button";
    button.addEventListener("click", (event) => { event.stopPropagation(); menu.open = false; callback(); }); options.append(button);
  };
  action("Refresh", () => previewActions ? previewActions.refresh() : openResource(resource, actions.update, true));
  if (previewActions) action("Collapse preview", previewActions.collapse);
  action(openLabel, () => { void getAPI().openExternal(resource.url); });
  action("Copy link", () => { void navigator.clipboard?.writeText(resource.url).catch(() => {}); });
  if (actions.update) action(resource.display === "reference" ? "Display as embed" : "Display as reference", () => actions.update!({ ...resource, display: resource.display === "reference" ? "embed" : "reference" }));
  if (actions.remove) action("Remove from note", actions.remove);
  menu.append(options); card.append(menu);
  card.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); menu.open = true; options.querySelector<HTMLButtonElement>("button")?.focus(); });
  menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); menu.open = false; card.focus(); } });
}

export function openResource(resource: ExternalResource, onUpdate?: (resource: ExternalResource) => void, refreshRequested = false): void {
  window.dispatchEvent(new CustomEvent("openonyx:resource-open", { detail: { resource, onUpdate, refreshRequested } }));
}
