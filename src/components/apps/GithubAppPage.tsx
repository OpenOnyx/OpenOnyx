import React, { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppIcon } from "../settings/components/connections/AppIcon";
import type { McpServerSnapshot } from "../../types/mcp";
import type { GithubResource, GithubResourceType } from "../../types/appResources";
import { GITHUB_PERMISSIONS, githubPermissionTools } from "../../utils/githubProvider";
import { recentResources } from "../../utils/appResources";
import { GithubResourcePicker } from "./GithubResourcePicker";
import { openResource } from "./ResourceCard";

interface GithubAppPageProps {
  server?: McpServerSnapshot;
  busy: boolean;
  onBack: () => void;
  onAdvanced: () => void;
  onConnect?: (permissionIds: string[]) => Promise<void>;
  onSave?: (server: McpServerSnapshot, permissionId: string, enabled: boolean) => Promise<void>;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

export function GithubAppPage({ server, busy, onBack, onAdvanced, onConnect, onSave, onDisconnect, onReconnect }: GithubAppPageProps) {
  const [manage, setManage] = useState(false);
  const [permissionIds, setPermissionIds] = useState(["repositories", "issues"]);
  const [picker, setPicker] = useState<GithubResourceType | null>(null);
  const [recents, setRecents] = useState(() => recentResources(server?.config.id).filter((resource): resource is GithubResource => resource.appId === "github"));
  const status = server?.runtime.status === "connected" ? "Connected" : server?.runtime.status === "error" ? "Needs attention" : "Disconnected";
  const select = (resource: GithubResource) => { setPicker(null); setRecents(recentResources(server?.config.id).filter((resource): resource is GithubResource => resource.appId === "github")); openResource(resource); };
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 pb-8">
    <button type="button" onClick={onBack} className="inline-flex self-start items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" /> Apps</button>
    <header className="flex flex-wrap items-center justify-between gap-6">
      <div className="flex min-w-0 items-center gap-4"><AppIcon icon="github" className="h-16 w-16 border-0 bg-transparent [&_svg]:h-12 [&_svg]:w-12" /><div><h1 className="text-2xl font-semibold text-[var(--text-primary)]">GitHub</h1><p className="mt-1 text-sm text-[var(--text-muted)]">{server ? status : "Repositories, issues and pull requests"}</p></div></div>
      {server ? <button type="button" onClick={() => setManage(!manage)} aria-expanded={manage} className="app-resource-secondary">Manage</button> : <button type="button" disabled={busy} onClick={() => setManage(true)} className="app-resource-primary">+ Connect</button>}
    </header>
    <p className="max-w-xl text-base leading-relaxed text-[var(--text-secondary)]">Bring repositories, issues and pull requests into your OpenOnyx knowledge. Search GitHub from a note and keep a resource alongside your writing.</p>

    {manage && <section className="border-y border-[var(--border-subtle)] py-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{server ? "GitHub permissions" : "Connect GitHub"}</h2>
      {!server && <p className="mb-4 text-sm text-[var(--text-muted)]">Connect to public GitHub resources. Account sign-in is not available yet. Choose the access you want to allow.</p>}
      <div className="flex flex-col gap-4">{GITHUB_PERMISSIONS.map((permission) => {
        const tools = server ? githubPermissionTools(server, permission.id) : [];
        const enabled = server ? tools.length > 0 && tools.every((name) => server.config.enabledTools.includes(name)) : permissionIds.includes(permission.id);
        const partial = Boolean(server && !enabled && tools.some((name) => server.config.enabledTools.includes(name)));
        return <label key={permission.id} className="flex items-center justify-between gap-4 text-sm text-[var(--text-secondary)]">
          <span>{permission.label}{partial ? " · Limited access" : ""}{server && !tools.length ? " · Not supported by this connection" : ""}</span>
          <input type="checkbox" checked={enabled} disabled={busy || Boolean(server && !tools.length)} onChange={(event) => {
            if (server) void onSave?.(server, permission.id, event.target.checked);
            else setPermissionIds((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id));
          }} />
        </label>;
      })}</div>
      {!server && <p className="mt-4 text-xs text-[var(--text-muted)]">Public browsing works without an account. Creating issues requires an authenticated connection; enabling permission alone does not sign you in.</p>}
      <p className="mt-4 text-xs text-[var(--text-muted)]">Requests are reviewed in a native confirmation before information is sent to GitHub.</p>
      <div className="mt-5 flex flex-wrap gap-3">{server ? <><button type="button" disabled={busy} onClick={onReconnect} className="app-resource-secondary">Reconnect</button><button type="button" disabled={busy} onClick={onDisconnect} className="app-resource-secondary">Disconnect</button></> : <button type="button" disabled={busy} onClick={() => void onConnect?.(permissionIds)} className="app-resource-primary">{busy ? "Connecting…" : "Connect GitHub"}</button>}</div>
    </section>}

    {server ? <>
      {status !== "Connected" && <p className="text-sm text-[var(--text-muted)]">GitHub needs attention. Use Manage to reconnect or Advanced for diagnostics.</p>}
      <section><Heading>Quick access</Heading><div className="flex flex-wrap gap-3">{([['repository', 'Repositories'], ['issue', 'Issues'], ['pull-request', 'Pull requests']] as const).map(([kind, label]) => <button key={kind} type="button" disabled={status !== "Connected"} onClick={() => setPicker(kind)} className="app-resource-secondary">{label}</button>)}</div></section>
      <section><Heading>Recent</Heading>{recents.length ? recents.map((resource) => <button key={resource.url} type="button" className="app-resource-row" onClick={() => openResource(resource)}><span className="block text-sm text-[var(--text-primary)]">{resource.number ? `#${resource.number} ` : ""}{resource.title}</span><span className="mt-1 block text-xs text-[var(--text-muted)]">{resource.repository} · {resource.resourceType.replace('-', ' ')}{resource.state ? ` · ${resource.state}` : ""}</span></button>) : <p className="text-sm text-[var(--text-muted)]">Resources you browse or insert will appear here.</p>}</section>
      <section><Heading>Works in OpenOnyx</Heading><p className="text-sm font-medium text-[var(--text-primary)]">Markdown editor</p><p className="mt-1 text-sm text-[var(--text-muted)]">Type / and choose GitHub to insert a resource. Select text and choose GitHub → Create issue from the context menu.</p></section>
      <section><Heading>Permissions</Heading><div className="flex flex-col gap-2">{GITHUB_PERMISSIONS.map((permission) => { const tools = githubPermissionTools(server, permission.id); const any = tools.some((name) => server.config.enabledTools.includes(name)); return <p key={permission.id} className="text-sm text-[var(--text-secondary)]">{any ? "✓" : "—"} {permission.label}</p>; })}</div><button type="button" onClick={() => setManage(true)} className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)]">Manage permissions <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" /></button></section>
    </> : <>
      <section aria-label="Static product preview" className="rounded-lg bg-[var(--bg-secondary)] p-6"><p className="mb-5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Product preview · illustration</p><h3 className="text-lg font-semibold text-[var(--text-primary)]">Release planning</h3><p className="mt-3 text-sm text-[var(--text-muted)]">Keep the GitHub issue you're working on alongside your release notes.</p><div className="mt-5 border-l-2 border-[var(--border-medium)] pl-4"><p className="text-xs text-[var(--text-muted)]">GitHub · Repository / Project</p><p className="mt-2 text-sm font-medium text-[var(--text-primary)]">An issue referenced in your note</p><p className="mt-1 text-xs text-[var(--text-muted)]">Saved resource · Open original · Refresh</p></div></section>
      <section><Heading>What you can do</Heading><div className="grid gap-6 sm:grid-cols-2">{[["Issues", "Search and reference issues in your notes."], ["Pull requests", "Bring pull requests into project notes."], ["Repositories", "Reference repositories throughout your vault."], ["Create issues", "Turn selected note content into an issue with an authenticated connection."]].map(([title, description]) => <div key={title}><h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3><p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p></div>)}</div></section>
    </>}
    <button type="button" onClick={onAdvanced} className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-5 text-left"><span><span className="block text-sm font-medium text-[var(--text-primary)]">Advanced</span><span className="mt-1 block text-xs text-[var(--text-muted)]">Connection details, diagnostics and provider information</span></span><ArrowRight size={18} strokeWidth={2.5} className="text-[var(--text-muted)]" aria-hidden="true" /></button>
    {picker && <GithubResourcePicker initialServerId={server?.config.id} initialKind={picker} onClose={() => setPicker(null)} onSelect={select} />}
  </div>;
}

function Heading({ children }: { children: React.ReactNode }) { return <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{children}</h2>; }
