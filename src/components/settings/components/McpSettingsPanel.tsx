import React, { useEffect, useState } from "react";
import type { McpServerConfig, McpServerSnapshot, McpTransport } from "../../../types/mcp";
import { getAPI } from "../../../utils/api";

const emptyConfig = (): McpServerConfig => ({
  id: "",
  name: "",
  enabled: false,
  trusted: false,
  enabledTools: [],
  transport: { transport: "stdio", command: "", args: [], env: {} },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function McpSettingsPanel() {
  const [servers, setServers] = useState<McpServerSnapshot[]>([]);
  const [draft, setDraft] = useState<McpServerConfig>(emptyConfig);
  const [argsText, setArgsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setServers(await getAPI().mcp.list());
  useEffect(() => { void refresh(); }, []);

  const selectTransport = (transport: McpTransport) => {
    setDraft((current) => ({
      ...current,
      transport: transport === "stdio"
        ? { transport, command: "", args: [], env: {} }
        : { transport, url: "", headers: {} },
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = {
        ...draft,
        id: draft.id.trim().toLowerCase(),
        name: draft.name.trim(),
        updatedAt: Date.now(),
        transport: draft.transport.transport === "stdio"
          ? { ...draft.transport, command: draft.transport.command.trim(), args: argsText.split("\n").map((arg) => arg.trim()).filter(Boolean) }
          : { ...draft.transport, url: draft.transport.url.trim() },
      } as McpServerConfig;
      await getAPI().mcp.save(config);
      await refresh();
      setDraft(emptyConfig());
      setArgsText("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save MCP server");
    } finally { setBusy(false); }
  };

  const connect = async (server: McpServerSnapshot) => {
    if (!window.confirm(`Connect to MCP server "${server.config.name}"? It may execute commands or access network resources.`)) return;
    setBusy(true);
    setError(null);
    try {
      await getAPI().mcp.setEnabled(server.config.id, true, true);
      await refresh();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect to MCP server");
      await refresh();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this MCP server configuration?")) return;
    await getAPI().mcp.remove(id);
    await refresh();
  };

  const toggleTool = async (server: McpServerSnapshot, toolName: string, enabled: boolean) => {
    await getAPI().mcp.save({
      ...server.config,
      enabledTools: enabled
        ? [...server.config.enabledTools, toolName]
        : server.config.enabledTools.filter((name) => name !== toolName),
      updatedAt: Date.now(),
    });
    await refresh();
  };

  const stdioTransport = draft.transport.transport === "stdio" ? draft.transport : null;
  const httpTransport = draft.transport.transport !== "stdio" ? draft.transport : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h2 className="text-base font-bold text-[var(--text-primary)]">MCP Servers</h2>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">Add trusted Model Context Protocol servers and choose which tools OpenOnyx may use.</p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-[11px] text-[var(--text-secondary)]">
        MCP servers are third-party programs or network services. Review the command or URL before connecting. Secrets are not supported in this first form and should never be pasted into ordinary configuration fields.
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Add Server</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="server-id" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]" />
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Display name" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]" />
          <select value={draft.transport.transport} onChange={(event) => selectTransport(event.target.value as McpTransport)} className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]">
            <option value="stdio">Local command (stdio)</option>
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">SSE</option>
          </select>
          {draft.transport.transport === "stdio" ? (
            <>
              <input value={stdioTransport?.command || ""} onChange={(event) => setDraft({ ...draft, transport: { transport: "stdio", command: event.target.value, args: stdioTransport?.args || [], env: stdioTransport?.env || {} } })} placeholder="Command, e.g. npx" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]" />
              <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder="One argument per line" className="min-h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] md:col-span-2" />
            </>
          ) : (
            <input value={httpTransport?.url || ""} onChange={(event) => setDraft({ ...draft, transport: { transport: httpTransport?.transport || "streamable-http", url: event.target.value, headers: httpTransport?.headers || {} } })} placeholder="https://example.com/mcp" className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)] md:col-span-2" />
          )}
        </div>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className="mt-4 h-8 rounded-md bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)] disabled:opacity-50">Save Server</button>
      </div>

      <div className="flex flex-col gap-3">
        {servers.length === 0 ? <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 text-center text-xs text-[var(--text-muted)]">No MCP servers configured.</div> : servers.map((server) => (
          <div key={server.config.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-bold text-[var(--text-primary)]">{server.config.name}</h3><p className="mt-1 text-[11px] font-mono text-[var(--text-muted)]">{server.config.id} · {server.config.transport.transport}</p></div>
              <span className="rounded bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--text-muted)]">{server.runtime.status}</span>
            </div>
            <p className="mt-3 break-all text-[11px] text-[var(--text-secondary)]">{server.config.transport.transport === "stdio" ? `${server.config.transport.command} ${server.config.transport.args.join(" ")}` : server.config.transport.url}</p>
            {server.runtime.lastError && <p className="mt-2 text-[11px] text-red-500">{server.runtime.lastError.message}</p>}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
              <button type="button" disabled={busy} onClick={() => void connect(server)} className="h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] font-semibold text-[var(--text-primary)]">{server.runtime.status === "connected" ? "Reconnect" : "Connect"}</button>
              <button type="button" onClick={() => void getAPI().mcp.setEnabled(server.config.id, false).then(refresh)} className="h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] text-[var(--text-muted)]">Disable</button>
              <button type="button" onClick={() => void remove(server.config.id)} className="h-7 rounded border border-red-500/30 px-3 text-[11px] text-red-500">Remove</button>
            </div>
            {server.tools.length > 0 && <div className="mt-4 border-t border-[var(--border-subtle)] pt-3"><h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Allowed tools</h4>{server.tools.map((tool) => <label key={tool.name} className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]"><input type="checkbox" checked={server.config.enabledTools.includes(tool.name)} onChange={(event) => void toggleTool(server, tool.name, event.target.checked)} />{tool.name}</label>)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}