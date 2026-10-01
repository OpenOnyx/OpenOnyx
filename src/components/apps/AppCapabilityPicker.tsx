import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServerSnapshot, McpTool } from "../../types/mcp";
import { getAPI } from "../../utils/api";
import { buildMcpFormModel, getInitialFormValues, getToolTitle } from "../../utils/mcpSchema";
import { getAppPresentation, toAppDescriptor } from "../../utils/appRegistry";
import { AppIcon } from "../settings/components/connections/AppIcon";
import { ToolRunner } from "../settings/components/connections/ToolRunner";
import type { ToolRunState } from "../settings/components/connections/types";
import { isToolEnabled, toolKey } from "../settings/components/connections/ui";

interface AppCapabilityPickerProps {
  onClose: () => void;
}

function getRunState(tool: McpTool): ToolRunState {
  const model = buildMcpFormModel(tool.inputSchema);
  return {
    input: "{}",
    formValues: model.supported ? getInitialFormValues(model.fields) : {},
  };
}

export function AppCapabilityPicker({ onClose }: AppCapabilityPickerProps) {
  const [servers, setServers] = useState<McpServerSnapshot[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ server: McpServerSnapshot; tool: McpTool } | null>(null);
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRunState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setServers(await getAPI().mcp.list());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load app capabilities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabledGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return servers
      .map((server) => ({
        descriptor: toAppDescriptor(server),
        server,
        tools: server.tools.filter((tool) => {
          if (!isToolEnabled(server, tool.name)) return false;
          const searchable = `${getToolTitle(tool.name)} ${tool.name} ${tool.description ?? ""} ${getAppPresentation(server).displayName}`.toLowerCase();
          return !normalizedQuery || searchable.includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.tools.length > 0);
  }, [query, servers]);

  const updateToolRun = useCallback((key: string, update: Partial<ToolRunState>) => {
    setToolRuns((current) => {
      const existing = current[key] ?? (selected ? getRunState(selected.tool) : { input: "{}", formValues: {} });
      return { ...current, [key]: { ...existing, ...update } };
    });
  }, [selected]);

  const runTool = useCallback(async (server: McpServerSnapshot, tool: McpTool, args: Record<string, unknown>) => {
    const key = toolKey(server, tool.name);
    updateToolRun(key, { running: true, error: undefined, result: undefined });
    try {
      const api = getAPI().mcp;
      const runner = api.requestToolExecution ?? api.runTool;
      if (typeof runner !== "function") throw new Error("Restart OpenOnyx to load the updated app runner");
      const result = await runner(server.config.id, tool.name, args);
      updateToolRun(key, { running: false, result });
      await refresh();
    } catch (runError) {
      updateToolRun(key, {
        running: false,
        error: runError instanceof Error ? runError.message : "Could not run capability",
      });
    }
  }, [refresh, updateToolRun]);

  return (
    <div className="motion-dialog-backdrop fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Use app"
        aria-modal="true"
        className="motion-dialog max-h-[78vh] w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Use app</h2>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">Choose an enabled capability. You review inputs before anything runs.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Esc</button>
        </div>

        {selected ? (
          <div className="max-h-[68vh] overflow-y-auto px-4 py-4">
            <button type="button" onClick={() => setSelected(null)} className="mb-4 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Actions</button>
            <ToolRunner
              server={selected.server}
              tool={selected.tool}
              runState={toolRuns[toolKey(selected.server, selected.tool.name)]}
              onUpdateRun={updateToolRun}
              onRun={runTool}
            />
          </div>
        ) : (
          <>
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search actions..."
                className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/25"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
              {loading && <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">Loading app capabilities…</p>}
              {error && <p role="alert" className="py-4 text-[12px] text-red-500">{error}</p>}
              {!loading && !error && enabledGroups.length === 0 && (
                <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">No enabled app capabilities found. Enable capabilities in Settings → Apps.</p>
              )}
              <div className="flex flex-col gap-4">
                {enabledGroups.map(({ descriptor, server, tools }) => (
                  <section key={server.config.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <AppIcon icon={descriptor.metadata.icon} className="h-7 w-7" />
                      <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{descriptor.metadata.displayName}</h3>
                    </div>
                    <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                      {tools.map((tool) => (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => {
                            setSelected({ server, tool });
                            setToolRuns((current) => {
                              const key = toolKey(server, tool.name);
                              return current[key] ? current : { ...current, [key]: getRunState(tool) };
                            });
                          }}
                          className="flex w-full items-center justify-between gap-3 py-3 text-left outline-none hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{getToolTitle(tool.name)}</span>
                            <span className="mt-1 block truncate text-[12px] text-[var(--text-muted)]">{tool.description || "No description provided."}</span>
                          </span>
                          <span className="shrink-0 text-[12px] font-semibold text-[var(--text-secondary)]">Open →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
