import React, { useEffect, useRef, useState } from "react";
import { DriveResourceView } from "./DriveResourceView";
import type { ExternalResource, GithubResource } from "../../types/appResources";
import { parseExternalResource, rememberResource } from "../../utils/appResources";
import { createGithubProvider } from "../../utils/githubProvider";
import { getAPI } from "../../utils/api";
import { safeResourceLink, safeResourceMarkdown } from "./resourceContent";
import { resourceFreshness } from "./ResourceCard";
import { ResourceDialog } from "./ResourceDialog";

function GithubResourceView({ resource: initial, onClose, onUpdate, refreshRequested = false }: { resource: GithubResource; onClose: () => void; onUpdate?: (resource: ExternalResource) => void; refreshRequested?: boolean }) {
  const [resource, setResource] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const started = useRef(false);
  const refresh = async () => {
    setBusy(true); setError("");
    try {
      const server = (await getAPI().mcp.list()).find((item) => item.config.id === resource.serverId);
      if (!server) throw new Error("Reconnect this GitHub app before refreshing.");
      const updated = { ...await createGithubProvider(server).refresh(resource), display: resource.display };
      if (!alive.current) return;
      setResource(updated); rememberResource(updated); onUpdate?.(updated);
    } catch (error) { if (alive.current) setError("Couldn't refresh · showing cached version"); }
    finally { if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    if (refreshRequested && !started.current) { started.current = true; void refresh(); }
    return () => { alive.current = false; };
  }, [refreshRequested]);
  return <ResourceDialog title={`GitHub / ${resource.repository}`} onClose={onClose}>
    {resource.number && <p className="text-sm text-[var(--text-muted)]">#{resource.number}</p>}
    <h1 className="mt-2 break-words text-2xl font-semibold">{resource.title}</h1>
    <p className="mt-3 text-xs text-[var(--text-muted)]">{[resource.resourceType === "pull-request" ? "Pull request" : resource.resourceType === "issue" ? "Issue" : "Repository", resource.state ? resource.state[0].toUpperCase() + resource.state.slice(1) : "", ...(resource.labels || [])].filter(Boolean).join(" · ")}</p>
    <section className="my-6"><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--text-muted)]">Description</h2>
      <div className="resource-description" onClick={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        event.preventDefault();
        const url = link.getAttribute("href") || "";
        if (safeResourceLink(url)) void getAPI().openExternal(url);
      }} dangerouslySetInnerHTML={{ __html: safeResourceMarkdown(resource.body || "No description in this saved snapshot.") }} />
    </section>
    {resource.discussion && resource.discussion.length > 0 && <section className="mb-6 border-t border-[var(--border-subtle)] pt-5"><h2 className="mb-4 text-xs uppercase tracking-wider text-[var(--text-muted)]">Comments</h2>{resource.discussion.map((comment, index) => <div key={index} className="mb-4"><p className="text-sm font-semibold">{comment.author}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{comment.body}</p></div>)}<p className="text-xs text-[var(--text-muted)]">Showing up to 10 comments from the saved snapshot.</p></section>}
    <p className="text-xs text-[var(--text-muted)]">{resource.comments !== undefined ? `${resource.comments} comments · ` : ""}{resourceFreshness(resource.updatedAt)}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
      <button type="button" disabled={busy} onClick={() => void refresh()} className="app-resource-secondary">{busy ? "Refreshing…" : "Refresh"}</button>
      <button type="button" className="app-resource-secondary" onClick={() => { void getAPI().openExternal(resource.url); }}>Open on GitHub ↗</button>
    </footer>
  </ResourceDialog>;
}

export function AppResourceView(props: { resource: ExternalResource; onClose: () => void; onUpdate?: (resource: ExternalResource) => void; refreshRequested?: boolean }) {
  return props.resource.appId === "google-drive" ? <DriveResourceView {...props} resource={props.resource} /> : <GithubResourceView {...props} resource={props.resource} />;
}

/** Passive host: events open a review/view surface, never execute a provider call. */
export function AppResourceSurface() {
  const [opened, setOpened] = useState<{ resource: ExternalResource; onUpdate?: (resource: ExternalResource) => void; refreshRequested?: boolean } | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const resource = parseExternalResource(detail?.resource);
      if (resource) setOpened({ resource, refreshRequested: detail.refreshRequested === true, onUpdate: typeof detail.onUpdate === "function" ? detail.onUpdate : undefined });
    };
    window.addEventListener("openonyx:resource-open", open);
    return () => window.removeEventListener("openonyx:resource-open", open);
  }, []);
  return opened ? <AppResourceView key={`${opened.resource.serverId}:${opened.resource.url}`} {...opened} onClose={() => setOpened(null)} /> : null;
}
