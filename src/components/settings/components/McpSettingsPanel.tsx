import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServerConfig, McpServerSnapshot, McpTool } from "../../../types/mcp";
import { getAPI } from "../../../utils/api";
import { getInitialFormValues, buildMcpFormModel } from "../../../utils/mcpSchema";
import { createAppServerTemplate, type DiscoverableApp } from "../../../utils/appRegistry";
import {
  AdvancedMcpPage,
  AppDetails,
  AppsHome,
  AppSetupPage,
} from "./connections/ConnectionsPages";
import type { ConnectionsActions, ConnectionsData, ToolRunState } from "./connections/types";
import { isToolEnabled, toolKey } from "./connections/ui";

type AppsView =
  | { kind: "home" }
  | { kind: "setup"; appId: DiscoverableApp["id"] }
  | { kind: "details"; serverId: string }
  | { kind: "advanced"; serverId?: string | null };

function normalizeConfig(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    id: config.id.trim().toLowerCase(),
    name: config.name.trim(),
    enabledTools: config.enabledTools ?? [],
    favoriteTools: config.favoriteTools ?? [],
    updatedAt: Date.now(),
  };
}

function getRunState(tool: McpTool): ToolRunState {
  const model = buildMcpFormModel(tool.inputSchema);
  return {
    input: "{}",
    formValues: model.supported ? getInitialFormValues(model.fields) : {},
  };
}

export function McpSettingsPanel() {
  const [view, setView] = useState<AppsView>({ kind: "home" });
  const [servers, setServers] = useState<McpServerSnapshot[]>([]);
  const [activity, setActivity] = useState<ConnectionsData["activity"]>([]);
  const [toolRuns, setToolRuns] = useState<Record<string, ToolRunState>>({});
  const [selectedToolKey, setSelectedToolKey] = useState<string | null>(null);
  const [advancedTemplate, setAdvancedTemplate] = useState<McpServerConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getAPI().mcp;
    const [nextServers, nextActivity] = await Promise.all([
      api.list(),
      typeof api.listActivity === "function" ? api.listActivity() : Promise.resolve([]),
    ]);
    setServers(nextServers);
    setActivity(nextActivity);
  }, []);

  useEffect(() => {
    void refresh().catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load apps");
    });
  }, [refresh]);

  const tools = useMemo(() => servers.flatMap((server) => (
    server.tools.map((tool) => ({ server, tool }))
  )), [servers]);

  const data: ConnectionsData = useMemo(() => ({
    servers,
    tools,
    activity,
    toolRuns,
    busy,
    error,
  }), [activity, busy, error, servers, toolRuns, tools]);

  const runAction = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : fallback);
    } finally {
      setBusy(false);
    }
  }, []);

  const updateToolRun = useCallback((key: string, update: Partial<ToolRunState>) => {
    setToolRuns((current) => {
      const toolRef = tools.find(({ server, tool }) => toolKey(server, tool.name) === key);
      const existing = current[key] ?? (toolRef ? getRunState(toolRef.tool) : { input: "{}", formValues: {} });
      return { ...current, [key]: { ...existing, ...update } };
    });
  }, [tools]);

  const openTool = useCallback((key: string | null) => {
    setSelectedToolKey(key);
    if (!key) return;
    const toolRef = tools.find(({ server, tool }) => toolKey(server, tool.name) === key);
    if (toolRef) {
      setView({ kind: "details", serverId: toolRef.server.config.id });
      setToolRuns((current) => current[key] ? current : { ...current, [key]: getRunState(toolRef.tool) });
    }
  }, [tools]);

  const actions: ConnectionsActions = useMemo(() => ({
    refresh,
    connect: async (server) => {
      await runAction(async () => {
        await getAPI().mcp.setEnabled(server.config.id, true);
        await refresh();
      }, "Could not enable app");
    },
    reconnect: async (server) => {
      await runAction(async () => {
        if (server.runtime.status === "connected") {
          await getAPI().mcp.reconnect(server.config.id);
        } else if (server.config.enabled && server.config.trusted) {
          await getAPI().mcp.connect(server.config.id);
        } else {
          await getAPI().mcp.setEnabled(server.config.id, true);
        }
        await refresh();
      }, "Could not reconnect app");
    },
    remove: async (id) => {
      if (!window.confirm("Disconnect this app?")) return;
      await runAction(async () => {
        await getAPI().mcp.remove(id);
        setView((current) => current.kind === "details" && current.serverId === id ? { kind: "home" } : current);
        setSelectedToolKey((current) => current?.startsWith(`${id}:`) ? null : current);
        await refresh();
      }, "Could not disconnect app");
    },
    revokeTrust: async (id) => {
      await runAction(async () => {
        const api = getAPI().mcp;
        if (typeof api.revokeTrust === "function") {
          await api.revokeTrust(id);
        } else {
          const server = servers.find((item) => item.config.id === id);
          if (!server) throw new Error(`Unknown app: ${id}`);
          await api.save({ ...server.config, enabled: false, trusted: false, updatedAt: Date.now() });
        }
        await refresh();
      }, "Could not revoke trust");
    },
    saveServer: async (config) => {
      await runAction(async () => {
        await getAPI().mcp.save(normalizeConfig(config));
        await refresh();
      }, "Could not save app configuration");
    },
    toggleTool: async (server, toolName, enabled) => {
      await runAction(async () => {
        const enabledTools = enabled
          ? [...new Set([...server.config.enabledTools, toolName])]
          : server.config.enabledTools.filter((name) => name !== toolName);
        const favoriteTools = enabled
          ? server.config.favoriteTools ?? []
          : (server.config.favoriteTools ?? []).filter((name) => name !== toolName);
        await getAPI().mcp.save({ ...server.config, enabledTools, favoriteTools, updatedAt: Date.now() });
        await refresh();
      }, "Could not update capability permission");
    },
    toggleFavorite: async (server, toolName, favorite) => {
      if (!isToolEnabled(server, toolName)) return;
      await runAction(async () => {
        const favoriteTools = favorite
          ? [...new Set([...(server.config.favoriteTools ?? []), toolName])]
          : (server.config.favoriteTools ?? []).filter((name) => name !== toolName);
        await getAPI().mcp.save({ ...server.config, favoriteTools, updatedAt: Date.now() });
        await refresh();
      }, "Could not update favorite capability");
    },
    runTool: async (server, tool, args) => {
      const key = toolKey(server, tool.name);
      updateToolRun(key, { running: true, error: undefined, result: undefined });
      try {
        const mcpApi = getAPI().mcp;
        const runner = mcpApi.requestToolExecution ?? mcpApi.runTool;
        if (typeof runner !== "function") {
          throw new Error("Restart OpenOnyx to load the updated app runner");
        }
        const result = await runner(server.config.id, tool.name, args);
        updateToolRun(key, { running: false, result });
      } catch (runError) {
        updateToolRun(key, {
          running: false,
          error: runError instanceof Error ? runError.message : "Could not run capability",
        });
      } finally {
        await refresh();
      }
    },
    clearActivity: async () => {
      await runAction(async () => {
        await getAPI().mcp.clearActivity();
        await refresh();
      }, "Could not clear activity");
    },
  }), [refresh, runAction, servers, updateToolRun]);

  const installApp = useCallback(async (appId: DiscoverableApp["id"], options?: { filesystemRoot?: string }) => {
    if (appId === "custom") {
      setAdvancedTemplate(createAppServerTemplate(appId));
      setView({ kind: "advanced", serverId: null });
      return;
    }
    await runAction(async () => {
      const config = normalizeConfig(createAppServerTemplate(appId, options));
      await getAPI().mcp.save(config);
      await getAPI().mcp.setEnabled(config.id, true);
      await refresh();
      setView({ kind: "details", serverId: config.id });
    }, `Could not connect ${appId}`);
  }, [refresh, runAction]);

  const openHome = () => {
    setView({ kind: "home" });
    setSelectedToolKey(null);
  };

  const openSetup = (appId: DiscoverableApp["id"]) => {
    setSelectedToolKey(null);
    if (appId === "custom") {
      setAdvancedTemplate(createAppServerTemplate(appId));
      setView({ kind: "advanced", serverId: null });
      return;
    }
    setView({ kind: "setup", appId });
  };

  const openAdvanced = (serverId?: string | null) => {
    setSelectedToolKey(null);
    if (!serverId) setAdvancedTemplate(createAppServerTemplate("custom"));
    setView({ kind: "advanced", serverId: serverId ?? null });
  };

  const selectedApp = view.kind === "details"
    ? servers.find((server) => server.config.id === view.serverId) ?? null
    : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-2 py-1">
      {error && (
        <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      {view.kind === "setup" ? (
        <AppSetupPage
          data={data}
          actions={actions}
          appId={view.appId}
          onBack={openHome}
          onOpenConnection={(id) => setView({ kind: "details", serverId: id })}
          onOpenTool={openTool}
          onAddConnection={() => openAdvanced(null)}
          onViewApps={openHome}
          onViewAdvanced={openAdvanced}
          onConfigureApp={openSetup}
          onInstallApp={installApp}
          updateToolRun={updateToolRun}
        />
      ) : selectedApp ? (
        <AppDetails
          data={data}
          actions={actions}
          server={selectedApp}
          selectedToolKey={selectedToolKey}
          onBack={openHome}
          onOpenConnection={(id) => setView({ kind: "details", serverId: id })}
          onOpenTool={openTool}
          onAddConnection={() => openAdvanced(null)}
          onViewApps={openHome}
          onViewAdvanced={openAdvanced}
          onConfigureApp={openSetup}
          onInstallApp={installApp}
          updateToolRun={updateToolRun}
        />
      ) : view.kind === "advanced" ? (
        <AdvancedMcpPage
          data={data}
          actions={actions}
          advancedTemplate={advancedTemplate}
          advancedServerId={view.serverId}
          onAdvancedTemplateLoaded={() => setAdvancedTemplate(null)}
          onOpenConnection={(id) => setView({ kind: "details", serverId: id })}
          onOpenTool={openTool}
          onAddConnection={() => openAdvanced(null)}
          onViewApps={openHome}
          onViewAdvanced={openAdvanced}
          onConfigureApp={openSetup}
          onInstallApp={installApp}
          updateToolRun={updateToolRun}
        />
      ) : (
        <AppsHome
          data={data}
          actions={actions}
          onOpenConnection={(id) => setView({ kind: "details", serverId: id })}
          onOpenTool={openTool}
          onAddConnection={() => openAdvanced(null)}
          onViewApps={openHome}
          onViewAdvanced={openAdvanced}
          onConfigureApp={openSetup}
          onInstallApp={installApp}
          updateToolRun={updateToolRun}
        />
      )}
    </div>
  );
}
