import { DriveAppPage } from "../../../apps/DriveAppPage";
import type { DriveStatus } from "../../../../../electron/googleDriveTypes";
import { GithubAppPage } from "../../../apps/GithubAppPage";
import { githubPermissionTools } from "../../../../utils/githubProvider";
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ConnectionsActions, ConnectionsData, McpServerConfig, McpServerSnapshot, McpTool, ToolRunState } from "./types";
import {
  connectionAriaLabel,
  connectionStatus,
  emptyConfig,
  enabledToolCount,
  formatLastConnected,
  getToolSubtitle,
  isToolEnabled,
  isToolFavorite,
  textToValues,
  toolAriaLabel,
  toolKey,
  transportLabel,
  valuesToText,
} from "./ui";
import { getToolTitle } from "../../../../utils/mcpSchema";
import { getAPI } from "../../../../utils/api";
import {
  activityForApp,
  APP_CATALOG,
  catalogSearchText,
  CATEGORY_LABELS,
  createAppServerTemplate,
  describeAppCapabilities,
  getAppPresentation,
  toAppDescriptor,
  type AppCatalogEntry,
  type AppCategory,
  type DiscoverableApp,
} from "../../../../utils/appRegistry";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ToolRunner } from "./ToolRunner";
import { AppIcon } from "./AppIcon";
import type { McpTransport } from "../../../../types/mcp";

interface PageProps {
  data: ConnectionsData;
  actions: ConnectionsActions;
  onOpenConnection: (id: string) => void;
  onOpenTool: (key: string | null) => void;
  onAddConnection: () => void;
  onViewApps: () => void;
  onViewAdvanced: (serverId?: string | null) => void;
  onConfigureApp: (appId: DiscoverableApp["id"]) => void;
  onInstallApp: (appId: DiscoverableApp["id"], options?: { filesystemRoot?: string; githubPermissions?: string[] }) => Promise<void>;
  selectedToolKey?: string | null;
  advancedTemplate?: McpServerConfig | null;
  advancedServerId?: string | null;
  onAdvancedTemplateLoaded?: () => void;
  updateToolRun: (key: string, update: Partial<ToolRunState>) => void;
}

const CATEGORY_FILTERS: Array<{ id: "all" | "installed" | AppCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "installed", label: "Installed" },
];

const CATALOG_SECTION_ORDER: AppCategory[] = ["popular", "productivity", "communication", "development", "files-data", "developer"];

export function AppsHome({ data, onOpenConnection, onConfigureApp }: PageProps) {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void getAPI().googleDrive?.status().then(value => { if (alive) setDrive(value); }).catch(() => {}); };
    refresh(); window.addEventListener("openonyx:apps-changed", refresh);
    const unsubscribe = getAPI().googleDrive?.onStatusChanged?.(value => { if (alive) setDrive(value); });
    return () => { alive = false; unsubscribe?.(); window.removeEventListener("openonyx:apps-changed", refresh); };
  }, []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "installed" | AppCategory>("all");
  const appDescriptors = useMemo(() => data.servers.map(toAppDescriptor), [data.servers]);
  const installedByAppId = useMemo(() => new Map(appDescriptors.map((app) => [String(app.appId), app.server])), [appDescriptors]);
  const normalizedQuery = query.trim().toLowerCase();
  const showDrive = !!drive?.accounts.length && ["all", "installed", "files-data"].includes(category) && (!normalizedQuery || "google drive docs sheets slides files data".includes(normalizedQuery));

  const filteredInstalledApps = appDescriptors.filter(({ metadata, server }) => {
    const searchable = `${metadata.displayName} ${metadata.description} ${metadata.category} ${server.config.name} ${server.config.id}`.toLowerCase();
    const matchesCategory = category === "all" || category === "installed" || metadata.category === category;
    return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
  });

  const catalogEntries = APP_CATALOG.filter((entry) => {
    if (category === "installed") return false;
    const effectiveCategory = entry.popular && category === "popular" ? "popular" : entry.category;
    const matchesCategory = category === "all" || entry.category === category || effectiveCategory === category;
    return matchesCategory && (!normalizedQuery || catalogSearchText(entry).includes(normalizedQuery));
  });

  const sections = groupCatalogEntries(catalogEntries);
  const jumpToCatalog = () => {
    setQuery("");
    setCategory("all");
    window.requestAnimationFrame(() => {
      document.getElementById("openonyx-app-catalog")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-3">
      <header className="flex flex-col items-center gap-5 text-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Apps</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Connect OpenOnyx to the tools you already use.</p>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-muted)]">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/25"
            />
          </label>

        </div>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="list" aria-label="App categories">
          {CATEGORY_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              className={`h-8 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold outline-none transition-colors focus:ring-2 focus:ring-[var(--accent-primary)]/25 ${category === item.id ? "border-[var(--border-medium)] bg-[var(--bg-active)] text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"}`}
              aria-pressed={category === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {(filteredInstalledApps.length > 0 || showDrive) && <section><SectionHeading>Your apps</SectionHeading><div className="grid grid-cols-1 gap-x-10 gap-y-1 sm:grid-cols-2">{showDrive && <button type="button" className="flex items-center gap-3 px-3 py-3 text-left hover:bg-[var(--bg-hover)]" onClick={() => onConfigureApp("google-drive")}><AppIcon icon="google-drive" /><span><span className="block text-sm font-semibold">Google Drive</span><span className="block text-xs text-[var(--text-muted)]">{drive?.accounts[0].email || drive?.accounts[0].name} · {drive?.accounts[0].needsReconnect ? "Needs reconnection" : "Connected"}</span></span></button>}{filteredInstalledApps.map((app) => <InstalledAppRow key={app.server.config.id} server={app.server} onOpen={() => onOpenConnection(app.server.config.id)} />)}</div></section>}

      {category === "installed" && filteredInstalledApps.length === 0 && !showDrive && <p className="py-4 text-center text-sm text-[var(--text-muted)]">{normalizedQuery ? "No installed apps match your search." : "No apps installed yet."}</p>}

      <section id="openonyx-app-catalog" className="flex scroll-mt-4 flex-col gap-6">
        {sections.length === 0 && category !== "installed" ? (
          <p className="border-y border-[var(--border-subtle)] py-5 text-center text-[12px] text-[var(--text-muted)]">No apps match your search.</p>
        ) : sections.map(({ category: sectionCategory, entries }) => (
          <div key={sectionCategory}>
            <SectionHeading>{CATEGORY_LABELS[sectionCategory]}</SectionHeading>
            <div className="grid grid-cols-1 gap-x-10 gap-y-1 sm:grid-cols-2">
              {entries.map((entry) => (
                <CatalogAppRow
                  key={`${sectionCategory}-${entry.id}`}
                  entry={entry}
                  nativeConnected={entry.id === "google-drive" && !!drive?.accounts.some(account => !account.needsReconnect)}
                  nativeNeedsReconnect={entry.id === "google-drive" && drive?.connectionState === "needs-reconnection"}
                  installedServer={installedByAppId.get(entry.id)}
                  onOpenInstalled={(id) => onOpenConnection(id)}
                  onConfigure={(id) => onConfigureApp(id)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export function AppSetupPage({ appId, data, onBack, onInstallApp, onViewAdvanced }: PageProps & { appId: DiscoverableApp["id"]; onBack: () => void }) {
  const entry = APP_CATALOG.find((item) => item.id === appId) as DiscoverableApp | undefined;
  const [filesystemRoot, setFilesystemRoot] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!entry) return null;
  if (appId === "google-drive") return <DriveAppPage onBack={onBack} />;

  const chooseFolder = async () => {
    setLocalError(null);
    try {
      const result = await getAPI().showOpenDialog({ properties: ["openDirectory"] });
      if (!result.canceled && result.filePaths[0]) setFilesystemRoot(result.filePaths[0]);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not choose a folder");
    }
  };

  if (appId === "github") return <GithubAppPage busy={data.busy} onBack={onBack} onAdvanced={() => onViewAdvanced(null)} onConnect={async (permissionIds) => {
    await onInstallApp("github", { githubPermissions: permissionIds });
  }} />;

  const connect = async () => {
    if (entry.id === "custom") {
      onViewAdvanced(null);
      return;
    }
    if (entry.id === "filesystem" && !filesystemRoot) {
      setLocalError("Choose a folder before connecting Filesystem.");
      return;
    }
    await onInstallApp(entry.id, entry.id === "filesystem" ? { filesystemRoot } : undefined);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-1">
      <BackButton onClick={onBack}>Apps</BackButton>
      <header className="flex gap-3 border-b border-[var(--border-subtle)] pb-5">
        <AppIcon icon={entry.icon} className="h-12 w-12" />
        <div>
          <h1 className="text-lg font-bold text-[var(--text-primary)]">Connect {entry.displayName}</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">{entry.description}</p>
        </div>
      </header>

      <Section title="What you can do">
        <div className="grid gap-2">
          {entry.capabilities.map((capability) => (
            <div key={capability} className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <span className="text-emerald-500">✓</span>
              {capability}
            </div>
          ))}
        </div>
      </Section>

      {entry.id === "filesystem" && (
        <Section title="Access">
          <p className="mb-3 text-[13px] text-[var(--text-secondary)]">Choose the folder OpenOnyx may access through this app. The provider is restricted to this approved root.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => void chooseFolder()} className="h-9 rounded border border-[var(--border-medium)] px-3 text-[12px] font-semibold text-[var(--text-primary)]">Choose folder</button>
            <span className="min-w-0 truncate font-mono text-[12px] text-[var(--text-muted)]">{filesystemRoot || "No folder selected"}</span>
          </div>
        </Section>
      )}

      {entry.id === "custom" && (
        <Section title="Custom MCP">
          <p className="text-[13px] text-[var(--text-secondary)]">Custom MCP is for technical users who want to configure a compatible local or remote MCP server directly.</p>
        </Section>
      )}

      {localError && <p role="alert" className="text-xs text-red-500">{localError}</p>}
      <div className="flex gap-2 border-t border-[var(--border-subtle)] pt-4">
        <button type="button" onClick={() => void connect()} className="h-9 rounded-md bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)]">
          {entry.id === "custom" ? "Configure Custom MCP" : `Connect ${entry.displayName}`}
        </button>
        <button type="button" onClick={onBack} className="h-9 rounded-md border border-[var(--border-medium)] px-4 text-xs font-semibold text-[var(--text-primary)]">Cancel</button>
      </div>
    </div>
  );
}

export function AppDetails({ server, data, actions, onBack, onViewAdvanced }: PageProps & { server: McpServerSnapshot; onBack: () => void }) {
  const metadata = getAppPresentation(server);
  if (metadata.id === "github") return <GithubAppPage
    key={server.config.id} server={server} busy={data.busy} onBack={onBack}
    onAdvanced={() => onViewAdvanced(server.config.id)}
    onDisconnect={() => void actions.remove(server.config.id)}
    onReconnect={() => void actions.reconnect(server)}
    onSave={async (snapshot, permissionId, enabled) => {
      const names = githubPermissionTools(snapshot, permissionId);
      const enabledTools = enabled ? [...new Set([...snapshot.config.enabledTools, ...names])] : snapshot.config.enabledTools.filter((name) => !names.includes(name));
      await actions.saveServer({ ...snapshot.config, enabledTools, favoriteTools: snapshot.config.favoriteTools.filter((name) => enabledTools.includes(name)) });
    }}
  />;
  const connected = server.runtime.status === "connected";
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
    <BackButton onClick={onBack}>Apps</BackButton>
    <div className="flex items-center gap-4"><AppIcon icon={metadata.icon} className="h-14 w-14" /><div><h1 className="text-xl font-semibold text-[var(--text-primary)]">{metadata.displayName}</h1><p className="mt-1 text-sm text-[var(--text-muted)]">{connected ? "Connected" : server.runtime.status === "error" ? "Needs attention" : "Disconnected"}</p></div></div>
    <p className="text-sm text-[var(--text-secondary)]">{metadata.description}</p>
    <p className="text-sm text-[var(--text-muted)]">Manage this connection and its developer controls in Advanced.</p>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={() => onViewAdvanced(server.config.id)} className="inline-flex items-center gap-1 app-resource-secondary">Advanced <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" /></button><button type="button" disabled={data.busy} onClick={() => void actions.reconnect(server)} className="app-resource-secondary">Reconnect</button><button type="button" disabled={data.busy} onClick={() => void actions.remove(server.config.id)} className="app-resource-secondary">Disconnect</button></div>
  </div>;
}

export function ActivityPage({ data, actions }: PageProps) {
  const groups = groupActivity(data.activity);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Activity"
        description="Recent app capability requests that went through user approval."
        action={<button type="button" disabled={data.activity.length === 0} onClick={() => void actions.clearActivity()} className="h-8 rounded border border-[var(--border-medium)] px-3 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50">Clear activity</button>}
      />
      {data.activity.length === 0 ? (
        <EmptyState title="No app activity yet." description="Executions you approve or deny will appear here." />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{group.label}</p>
              <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                {group.items.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdvancedMcpPage({ data, actions, advancedTemplate, advancedServerId, onAdvancedTemplateLoaded, onViewApps, updateToolRun }: PageProps) {
  const focusedServer = advancedServerId ? data.servers.find((server) => server.config.id === advancedServerId) ?? null : null;
  const [draft, setDraft] = useState(() => toDraft(focusedServer?.config ?? emptyConfig()));
  const stdioTransport = draft.config.transport.transport === "stdio" ? draft.config.transport : null;
  const httpTransport = draft.config.transport.transport !== "stdio" ? draft.config.transport : null;

  useEffect(() => {
    if (advancedTemplate) {
      setDraft(toDraft(advancedTemplate));
      onAdvancedTemplateLoaded?.();
      return;
    }
    if (focusedServer) setDraft(toDraft(focusedServer.config));
  }, [advancedTemplate, focusedServer, onAdvancedTemplateLoaded]);

  const visibleServers = focusedServer ? [focusedServer] : data.servers;
  const loadServer = (server: McpServerSnapshot) => setDraft(toDraft(server.config));
  const updateConfig = (config: McpServerConfig) => setDraft((current) => ({ ...current, config }));
  const selectTransport = (transport: McpTransport) => {
    setDraft((current) => toDraft({
      ...current.config,
      transport: transport === "stdio"
        ? { transport, command: "", args: [], env: {} }
        : { transport, url: "", headers: {} },
    }));
  };
  const save = async () => {
    const config = draft.config.transport.transport === "stdio"
      ? {
          ...draft.config,
          id: draft.config.id.trim().toLowerCase(),
          name: draft.config.name.trim(),
          transport: {
            ...draft.config.transport,
            command: draft.config.transport.command.trim(),
            args: draft.argsText.split("\n").map((arg) => arg.trim()).filter(Boolean),
            env: textToValues(draft.valuesText),
          },
        }
      : {
          ...draft.config,
          id: draft.config.id.trim().toLowerCase(),
          name: draft.config.name.trim(),
          transport: {
            ...draft.config.transport,
            url: draft.config.transport.url.trim(),
            headers: textToValues(draft.valuesText),
          },
        };
    await actions.saveServer(config as McpServerConfig);
    if (!focusedServer) setDraft(toDraft(emptyConfig()));
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 py-1">
      <BackButton onClick={onViewApps}>Apps</BackButton>
      <PageHeader title={focusedServer ? `${getAppPresentation(focusedServer).displayName} advanced` : "Custom MCP"} description="Technical MCP configuration and diagnostics." />
      <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-3 text-[11px] text-[var(--text-secondary)]">
        MCP servers are external programs or network services. Only connect servers you trust.
      </div>
      <Section title={draft.config.id ? "MCP configuration" : "Custom MCP server"}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Name
            <input value={draft.config.name} onChange={(event) => updateConfig({ ...draft.config, name: event.target.value })} placeholder="Display name" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Server ID
            <input value={draft.config.id} onChange={(event) => updateConfig({ ...draft.config, id: event.target.value })} placeholder="server-id" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-xs text-[var(--text-primary)]" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Transport
            <select value={draft.config.transport.transport} onChange={(event) => selectTransport(event.target.value as McpTransport)} className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]">
              <option value="stdio">Local command</option>
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          {draft.config.transport.transport === "stdio" ? (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                Command
                <input value={stdioTransport?.command || ""} onChange={(event) => updateConfig({ ...draft.config, transport: { transport: "stdio", command: event.target.value, args: stdioTransport?.args || [], env: stdioTransport?.env || {} } })} placeholder="Command, e.g. /usr/bin/node" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-xs text-[var(--text-primary)]" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)] md:col-span-2">
                Arguments
                <textarea value={draft.argsText} onChange={(event) => setDraft({ ...draft, argsText: event.target.value })} placeholder="One argument per line" className="min-h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 font-mono text-xs text-[var(--text-primary)]" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)] md:col-span-2">
                Environment
                <textarea value={draft.valuesText} onChange={(event) => setDraft({ ...draft, valuesText: event.target.value })} placeholder="One KEY=value per line. Use secret:secret-id for secret references." className="min-h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 font-mono text-xs text-[var(--text-primary)]" />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)] md:col-span-2">
                URL
                <input value={httpTransport?.url || ""} onChange={(event) => updateConfig({ ...draft.config, transport: { transport: httpTransport?.transport || "streamable-http", url: event.target.value, headers: httpTransport?.headers || {} } })} placeholder="https://example.com/mcp" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-xs text-[var(--text-primary)]" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)] md:col-span-2">
                Headers
                <textarea value={draft.valuesText} onChange={(event) => setDraft({ ...draft, valuesText: event.target.value })} placeholder="One Header=value per line. Use secret:secret-id for secret references." className="min-h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 font-mono text-xs text-[var(--text-primary)]" />
              </label>
            </>
          )}
        </div>
        <button type="button" disabled={data.busy} onClick={() => void save()} className="mt-4 h-8 rounded-md bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)] disabled:opacity-50">Save changes</button>
      </Section>
      <Section title="Activity">
        <AppActivity activity={focusedServer ? activityForApp(data.activity, focusedServer.config.id) : data.activity} empty="No activity yet." />
        <button type="button" disabled={data.activity.length === 0} onClick={() => void actions.clearActivity()} className="mt-3 text-xs text-[var(--text-secondary)]">Clear all app activity</button>
      </Section>
      <Section title={focusedServer ? "Diagnostics and schemas" : "Installed MCP-backed apps"}>
        {visibleServers.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted)]">No MCP-backed apps configured.</p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {visibleServers.map((server) => {
              const metadata = getAppPresentation(server);
              return (
                <div key={server.config.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <AppIcon icon={metadata.icon} className="h-8 w-8" />
                        <div className="min-w-0">
                          <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{metadata.displayName}</h3>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">{server.config.id} · {server.config.transport.transport}</p>
                        </div>
                      </div>
                      <p className="mt-2 truncate font-mono text-[11px] text-[var(--text-muted)]">{server.config.transport.transport === "stdio" ? `${server.config.transport.command} ${server.config.transport.args.join(" ")}` : server.config.transport.url}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">Trust: {server.config.trusted ? "Approved" : "Not approved"} · Connection: {connectionStatus(server).label}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => loadServer(server)} className="h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] text-[var(--text-primary)]">Edit</button>
                      <button type="button" onClick={() => void actions.reconnect(server)} className="h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] text-[var(--text-primary)]">Reconnect</button>
                      <button type="button" onClick={() => void actions.revokeTrust(server.config.id)} disabled={!server.config.trusted} className="h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] text-[var(--text-primary)] disabled:opacity-50">Revoke trust</button>
                    </div>
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">Developer details</summary>
                    {server.tools.map((tool) => <div key={tool.name} className="mt-4">
                      <ToolPermissionRow server={server} tool={tool} onToggle={(enabled) => void actions.toggleTool(server, tool.name, enabled)} onOpen={() => document.getElementById(`raw-${server.config.id}-${tool.name}`)?.scrollIntoView({ block: "nearest" })} />
                      <details id={`raw-${server.config.id}-${tool.name}`}><summary className="cursor-pointer text-xs text-[var(--text-muted)]">Raw runner · {tool.name}</summary><ToolRunner server={server} tool={tool} runState={data.toolRuns[toolKey(server, tool.name)]} onUpdateRun={updateToolRun} onRun={actions.runTool} /></details>
                    </div>)}
                  </details>
                  {server.tools.length > 0 && (
                    <details className="mt-3 text-[12px] text-[var(--text-muted)]">
                      <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">Raw tool schemas</summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-[var(--bg-primary)] p-3 font-mono text-[10px] text-[var(--text-primary)]">{JSON.stringify(server.tools, null, 2)}</pre>
                    </details>
                  )}
                  {server.runtime.lastError && <DiagnosticsPanel server={server} onRetry={() => void actions.reconnect(server)} />}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function InstalledAppRow({ server, onOpen }: { server: McpServerSnapshot; onOpen: () => void }) {
  const metadata = getAppPresentation(server);
  const status = { ...connectionStatus(server), label: server.runtime.status === "connected" ? "Connected" : server.runtime.status === "error" ? "Needs attention" : "Disconnected" };
  return (
    <button
      type="button"
      aria-label={`Open ${connectionAriaLabel(server)}`}
      onClick={onOpen}
      className="group flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:ring-2 focus:ring-[var(--accent-primary)]/30 md:px-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <AppIcon icon={metadata.icon} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-[var(--text-primary)]">{metadata.displayName}</span>
          <span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">{metadata.description}</span>
          <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{server.runtime.status === "connected" ? "Connected" : "Installed"}</span>
        </span>
      </span>
      <StatusText tone={status.tone}>{status.label}</StatusText>
    </button>
  );
}

function CatalogAppRow({ entry, installedServer, nativeConnected = false, nativeNeedsReconnect = false, onOpenInstalled, onConfigure }: { entry: AppCatalogEntry; nativeConnected?: boolean; nativeNeedsReconnect?: boolean; installedServer?: McpServerSnapshot; onOpenInstalled: (id: string) => void; onConfigure: (id: DiscoverableApp["id"]) => void }) {
  const installed = Boolean(installedServer) || nativeConnected || nativeNeedsReconnect;
  const available = entry.availability === "available" && (entry.id === "github" || entry.id === "filesystem" || entry.id === "custom" || entry.id === "google-drive");
  const action = nativeNeedsReconnect ? "Reconnect" : installed ? (installedServer?.runtime.status === "connected" || nativeConnected ? "Connected" : "Installed") : available ? (entry.id === "custom" ? "Configure" : "+") : "Coming soon";
  return (
    <button
      type="button"
      disabled={!installed && !available}
      onClick={() => {
        if (installedServer) onOpenInstalled(installedServer.config.id);
        else if (available) onConfigure(entry.id as DiscoverableApp["id"]);
      }}
      className="group flex min-w-0 items-center justify-between gap-3 px-1 py-3 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:ring-2 focus:ring-[var(--accent-primary)]/30 disabled:cursor-default disabled:hover:bg-transparent md:px-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <AppIcon icon={entry.icon} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{entry.displayName}</span>
          <span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">{entry.description}</span>
        </span>
      </span>
      <span className={`shrink-0 text-[12px] font-semibold ${installed ? "text-emerald-500" : available ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>{action}</span>
    </button>
  );
}

function ToolPermissionRow({ server, tool, onToggle, onOpen }: { server: McpServerSnapshot; tool: McpTool; onToggle: (enabled: boolean) => void; onOpen: () => void }) {
  const enabled = isToolEnabled(server, tool.name);
  const favorite = isToolFavorite(server, tool.name);
  return (
    <div className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <button type="button" onClick={onOpen} className="min-w-0 text-left outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30">
        <span className="block text-[13px] font-semibold text-[var(--text-primary)]">{getToolTitle(tool.name)}</span>
        <span className="mt-1 block text-[12px] text-[var(--text-muted)]">{getToolSubtitle(tool)}</span>
        <span className="mt-1 block text-[10px] text-[var(--text-muted)]">Always asks before running{favorite ? " · Favorite" : ""}</span>
      </button>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} aria-label={`${enabled ? "Disable" : "Enable"} ${toolAriaLabel(server, tool)}`} className="h-4 w-4" />
          {enabled ? "ON" : "OFF"}
        </label>
        <button type="button" onClick={onOpen} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-medium)] px-3 text-[11px] font-semibold text-[var(--text-primary)]">Run <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

function AppActivity({ activity, empty }: { activity: ConnectionsData["activity"]; empty: string }) {
  if (activity.length === 0) return <p className="text-[12px] text-[var(--text-muted)]">{empty}</p>;
  return (
    <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
      {activity.map((entry) => <ActivityRow key={entry.id} entry={entry} compact />)}
    </div>
  );
}

function ActivityRow({ entry, compact = false }: { entry: ConnectionsData["activity"][number]; compact?: boolean }) {
  return (
    <div className={`grid ${compact ? "grid-cols-[1fr_auto]" : "grid-cols-[52px_1fr]"} gap-3 py-3 text-[12px]`}>
      {!compact && <span className="text-[var(--text-muted)]">{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      <span>
        <span className="block font-semibold text-[var(--text-primary)]">{compact ? entry.toolTitle : entry.serverName}</span>
        {!compact && <span className="block text-[var(--text-secondary)]">{entry.toolTitle}</span>}
        {entry.inputSummary && <span className="mt-1 block whitespace-pre-wrap text-[11px] text-[var(--text-muted)]">{entry.inputSummary}</span>}
        <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{activityStatus(entry.status)}{entry.summary ? ` · ${entry.summary}` : entry.error ? ` · ${entry.error}` : ""}</span>
      </span>
      {compact && <span className="text-[11px] text-[var(--text-muted)]">{formatRelativeTime(entry.timestamp)}</span>}
    </div>
  );
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="border-y border-[var(--border-subtle)] py-6 text-center">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-[12px] text-[var(--text-muted)]">{description}</p>
      {actionLabel && onAction && <button type="button" onClick={onAction} className="mt-4 h-8 rounded-md bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)]">{actionLabel}</button>}
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex w-fit items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={14} strokeWidth={2.5} aria-hidden="true" /> {children}</button>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--border-subtle)] pt-4">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{children}</h3>;
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1 text-[12px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function StatusText({ tone, children }: { tone: "success" | "warning" | "danger" | "muted"; children: React.ReactNode }) {
  const color = tone === "success" ? "text-emerald-500" : tone === "danger" ? "text-red-500" : tone === "warning" ? "text-amber-500" : "text-[var(--text-muted)]";
  return <span className={`whitespace-nowrap text-[11px] font-semibold ${color}`}>● {children}</span>;
}

function groupActivity(items: ConnectionsData["activity"]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const groups = new Map<string, ConnectionsData["activity"]>();
  for (const item of items) {
    const date = new Date(item.timestamp).toDateString();
    const label = date === today ? "Today" : date === yesterday ? "Yesterday" : new Date(item.timestamp).toLocaleDateString();
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  return [...groups.entries()].map(([label, groupItems]) => ({ label, items: groupItems }));
}

function groupCatalogEntries(entries: AppCatalogEntry[]) {
  const groups = new Map<AppCategory, AppCatalogEntry[]>();
  const popular = entries.filter((entry) => entry.popular);
  if (popular.length > 0) groups.set("popular", popular);
  for (const entry of entries) {
    if (entry.category === "developer") continue;
    groups.set(entry.category, [...(groups.get(entry.category) || []), entry]);
  }
  const developer = entries.filter((entry) => entry.category === "developer");
  if (developer.length > 0) groups.set("developer", developer);
  return CATALOG_SECTION_ORDER.map((section) => ({ category: section, entries: groups.get(section) || [] })).filter((section) => section.entries.length > 0);
}

function activityStatus(status: ConnectionsData["activity"][number]["status"]): string {
  if (status === "allowed") return "Allowed";
  if (status === "denied") return "Denied by user";
  return "Failed";
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function toDraft(config: McpServerConfig) {
  return {
    config,
    argsText: config.transport.transport === "stdio" ? config.transport.args.join("\n") : "",
    valuesText: config.transport.transport === "stdio" ? valuesToText(config.transport.env) : valuesToText(config.transport.headers),
  };
}

export { createAppServerTemplate };
