import React, { useState } from "react";
import type { AppSettings } from "../SettingsPage";
import type { PluginRegistration, PluginSettingTabRegistration } from "../../../types/plugin";
import { PreferenceCard, CustomToggle } from "./PreferenceCard";

interface PluginLibraryHubProps {
  settings: AppSettings;
  plugins: PluginRegistration[];
  pluginSettingTabs: PluginSettingTabRegistration[];
  onUpdateSetting: <K extends keyof AppSettings>(
    keyOrUpdates: K | Partial<AppSettings>,
    value?: AppSettings[K],
  ) => void;
  onEnablePlugin?: (pluginId: string) => Promise<void>;
  onDisablePlugin?: (pluginId: string) => Promise<void>;
  onRefreshPlugins?: () => Promise<void>;
  onReloadPlugin?: (pluginId: string) => Promise<void>;
  onUninstallPlugin?: (pluginId: string) => Promise<boolean>;
  onInstallPlugin?: (repo: string, pluginId: string, version?: string) => Promise<boolean>;
  onBrowsePlugins: () => void;
}

export function PluginLibraryHub({
  settings,
  plugins,
  pluginSettingTabs,
  onUpdateSetting,
  onEnablePlugin,
  onDisablePlugin,
  onRefreshPlugins,
  onReloadPlugin,
  onUninstallPlugin,
  onBrowsePlugins,
}: PluginLibraryHubProps) {
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activePluginTab = pluginSettingTabs.find((t) => t.pluginId === activeTabId);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Extensions & Plugins
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Manage community extensions, core features, and plugin settings.
          </p>
        </div>
        <button
          type="button"
          onClick={onBrowsePlugins}
          className="h-8 rounded-lg bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
        >
          Browse Library
        </button>
      </div>

      {/* Core Features */}
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Core Features
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { key: "enableBacklinks", title: "Backlinks & Unlinked Mentions", desc: "Track note connections and unlinked mentions." },
            { key: "enableCanvas", title: "Infinite Canvas", desc: "Spatial whiteboard canvas for visual ideas." },
            { key: "enableGraph", title: "Graph View", desc: "Interactive 3D note relationship graph." },
            { key: "enableTags", title: "Tag Explorer", desc: "Hierarchical tag navigator." },
          ].map((item) => (
            <PreferenceCard
              key={item.key}
              title={item.title}
              description={item.desc}
            >
              <CustomToggle
                checked={Boolean(settings[item.key as keyof AppSettings])}
                onChange={(v) => onUpdateSetting(item.key as keyof AppSettings, v as any)}
              />
            </PreferenceCard>
          ))}
        </div>
      </div>

      {/* Installed Community Extensions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Installed Community Extensions ({plugins.length})
          </h3>
          {onRefreshPlugins && (
            <button
              type="button"
              onClick={() => void onRefreshPlugins()}
              className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Refresh
            </button>
          )}
        </div>

        {plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-xs font-semibold text-[var(--text-primary)]">No Community Extensions Installed</p>
            <p className="mt-1 text-xs text-[var(--text-muted)] max-w-sm">
              Extend OpenOnyx with custom themes, hotkeys, and markdown formatters from the plugin library.
            </p>
            <button
              type="button"
              onClick={onBrowsePlugins}
              className="mt-4 h-8 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Explore Plugins
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {plugins.map((plugin) => {
              const tab = pluginSettingTabs.find((t) => t.pluginId === plugin.manifest.id);
              return (
                <div
                  key={plugin.manifest.id}
                  className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--text-primary)]">{plugin.manifest.name}</span>
                      <span className="text-[10px] font-mono text-[var(--text-muted)]">v{plugin.manifest.version}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {plugin.manifest.description}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                    <div className="flex items-center gap-2">
                      {tab && (
                        <button
                          type="button"
                          onClick={() => setActiveTabId(tab.pluginId)}
                          className="text-[11px] font-semibold text-[var(--text-primary)] underline"
                        >
                          Options
                        </button>
                      )}
                      {onReloadPlugin && (
                        <button
                          type="button"
                          onClick={() => void onReloadPlugin(plugin.manifest.id)}
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          Reload
                        </button>
                      )}
                      {onUninstallPlugin && (
                        <button
                          type="button"
                          onClick={() => void onUninstallPlugin(plugin.manifest.id)}
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <CustomToggle
                      checked={plugin.state === "enabled"}
                      onChange={(v) => {
                        if (v && onEnablePlugin) void onEnablePlugin(plugin.manifest.id);
                        if (!v && onDisablePlugin) void onDisablePlugin(plugin.manifest.id);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Plugin Settings Drawer */}
      {activePluginTab && (
        <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-5">
          <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              {activePluginTab.name} Settings
            </h4>
            <button
              type="button"
              onClick={() => setActiveTabId(null)}
              className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
          <div className="text-xs text-[var(--text-muted)] font-mono">
            Plugin settings rendered dynamically.
          </div>
        </div>
      )}
    </div>
  );
}
