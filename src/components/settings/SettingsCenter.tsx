import React, { useState, useLayoutEffect, useRef } from "react";
import type { AppSettings } from "./SettingsPage";
import type { PluginRegistration, PluginSettingTabRegistration } from "../../types/plugin";
import type { Command as AppCommand } from "../../types";
import { SettingsHome } from "./components/SettingsHome";
import { LiveTypographyStudio } from "./components/LiveTypographyStudio";
import { LiveThemeStudio } from "./components/LiveThemeStudio";
import { AIIntelligenceDashboard } from "./components/AIIntelligenceDashboard";
import { DatabaseInfrastructureView } from "./components/DatabaseInfrastructureView";
import { PluginLibraryHub } from "./components/PluginLibraryHub";
import { PreferenceCard, SegmentedControl, CustomToggle } from "./components/PreferenceCard";
import { CollaborationPanel } from "../spaces/CollaborationPanel";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import { authManager } from "../../lib/auth";
import { AuthModal } from "../modals/AuthModal";
import { version as APP_VERSION } from "../../../package.json";
import { DEFAULT_SETTINGS } from "../../types/settings";

export type StudioTab =
  | "home"
  | "workspace"
  | "editor"
  | "appearance"
  | "ai"
  | "sync"
  | "extensions"
  | "system"
  | "hotkeys"
  | "collaboration";

interface SettingsCenterProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
  commands?: AppCommand[];
  plugins?: PluginRegistration[];
  pluginSettingTabs?: PluginSettingTabRegistration[];
  onEnablePlugin?: (pluginId: string) => Promise<void>;
  onDisablePlugin?: (pluginId: string) => Promise<void>;
  onRefreshPlugins?: () => Promise<void>;
  onReloadPlugin?: (pluginId: string) => Promise<void>;
  onUninstallPlugin?: (pluginId: string) => Promise<boolean>;
  onInstallPlugin?: (repo: string, pluginId: string, version?: string) => Promise<boolean>;
  vaultPath?: string;
  onVaultReconstructed?: (path: string) => void;
  initialTab?: StudioTab;
}

const STUDIOS = [
  { id: "home" as const, label: "Settings Home", desc: "Quick tweaks, favorites & search" },
  { id: "workspace" as const, label: "Workspace", desc: "Default folders, views & file rules" },
  { id: "editor" as const, label: "Editor", desc: "Typography, [[Wikilinks]] & line width" },
  { id: "appearance" as const, label: "Appearance", desc: "Themes, font scale & zoom" },
  { id: "ai" as const, label: "AI", desc: "Providers, models & note indexer" },
  { id: "sync" as const, label: "Sync", desc: "Cloud database & storage connection" },
  { id: "extensions" as const, label: "Extensions", desc: "Community plugins & core suite" },
  { id: "system" as const, label: "System", desc: "Updates, accounts & factory reset" },
];

export function SettingsCenter({
  settings,
  onSettingsChange,
  onClose,
  commands = [],
  plugins = [],
  pluginSettingTabs = [],
  onEnablePlugin,
  onDisablePlugin,
  onRefreshPlugins,
  onReloadPlugin,
  onUninstallPlugin,
  onInstallPlugin,
  vaultPath,
  onVaultReconstructed,
  initialTab = "home",
}: SettingsCenterProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [isBrowsingPlugins, setIsBrowsingPlugins] = useState(false);
  const [currentUser] = useState(authManager.getUser());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"login" | "signup">("login");

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [activeTabRect, setActiveTabRect] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const activeElement = sidebarRef.current?.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement;
    if (activeElement) {
      setActiveTabRect({
        top: activeElement.offsetTop,
        height: activeElement.offsetHeight,
      });
    } else {
      setActiveTabRect(null);
    }
  }, [activeTab]);

  const updateSetting = <K extends keyof AppSettings>(
    keyOrUpdates: K | Partial<AppSettings>,
    value?: AppSettings[K],
  ) => {
    if (typeof keyOrUpdates === "object" && keyOrUpdates !== null) {
      onSettingsChange({ ...settings, ...keyOrUpdates });
    } else {
      onSettingsChange({ ...settings, [keyOrUpdates as K]: value });
    }
  };

  // Natural Language Search Router
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    const q = query.toLowerCase().trim();
    if (!q) return;

    if (q.includes("font") || q.includes("size") || q.includes("wikilink") || q.includes("line") || q.includes("vim") || q.includes("editor") || q.includes("text")) {
      setActiveTab("editor");
    } else if (q.includes("theme") || q.includes("color") || q.includes("dark") || q.includes("light") || q.includes("zoom") || q.includes("ribbon") || q.includes("wallpaper") || q.includes("background")) {
      setActiveTab("appearance");
    } else if (q.includes("ai") || q.includes("model") || q.includes("openai") || q.includes("openrouter") || q.includes("claude") || q.includes("key")) {
      setActiveTab("ai");
    } else if (q.includes("database") || q.includes("supabase") || q.includes("sql") || q.includes("sync")) {
      setActiveTab("sync");
    } else if (q.includes("plugin") || q.includes("extension") || q.includes("canvas")) {
      setActiveTab("extensions");
    } else if (q.includes("hotkey") || q.includes("shortcut") || q.includes("keyboard")) {
      setActiveTab("hotkeys");
    } else if (q.includes("update") || q.includes("reset") || q.includes("about") || q.includes("account")) {
      setActiveTab("system");
    }
  };

  const currentStudio = STUDIOS.find((s) => s.id === activeTab) || STUDIOS[0];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      {/* Compact, Flat, Simple Settings Modal (900px wide x 640px high) */}
      <div className="relative flex h-[min(95vh,920px)] w-[min(98vw,1360px)] overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xl">
        
        {/* Plugin Marketplace Overlay Mode */}
        {isBrowsingPlugins ? (
          <PluginMarketplace
            onClose={() => setIsBrowsingPlugins(false)}
            onInstall={onInstallPlugin || (async () => false)}
            installedPluginIds={plugins.map((p) => p.manifest.id)}
          />
        ) : (
          <>
            {/* Left Sidebar Navigation */}
            <aside className="w-[240px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex flex-col">
              {/* Sidebar Search & Title */}
              <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                  Preferences
                </div>
                
                {/* Search Preferences Input */}
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search settings..."
                    className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-medium)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Sidebar Menu Scroll Area */}
              <div ref={sidebarRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5 relative">
                {/* Sliding Background Highlight */}
                {activeTabRect && (
                  <div
                    className="absolute left-3 right-3 rounded-md bg-[var(--bg-elevated)] transition-all duration-200 ease-out pointer-events-none z-0"
                    style={{
                      top: `${activeTabRect.top}px`,
                      height: `${activeTabRect.height}px`,
                    }}
                  />
                )}

                <div className="px-2 pb-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] z-10">
                  Categories
                </div>
                {STUDIOS.map((studio) => {
                  const isActive = activeTab === studio.id;
                  return (
                    <button
                      key={studio.id}
                      data-tab-id={studio.id}
                      type="button"
                      onClick={() => setActiveTab(studio.id)}
                      className={`relative z-10 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors duration-200 ${
                        isActive
                          ? "text-[var(--text-primary)] font-semibold"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="text-[12px]">{studio.label}</span>
                    </button>
                  );
                })}

                <div className="my-2 border-t border-[var(--border-subtle)] z-10" />

                <div className="px-2 pb-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] z-10">
                  Tooling
                </div>
                <button
                  type="button"
                  data-tab-id="hotkeys"
                  onClick={() => setActiveTab("hotkeys")}
                  className={`relative z-10 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors duration-200 ${
                    activeTab === "hotkeys"
                      ? "text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="text-[12px]">Shortcuts Registry</span>
                </button>

                <button
                  type="button"
                  data-tab-id="collaboration"
                  onClick={() => setActiveTab("collaboration")}
                  className={`relative z-10 flex items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors duration-200 ${
                    activeTab === "collaboration"
                      ? "text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span className="text-[12px]">Cloud Workspaces</span>
                </button>
              </div>

              {/* Sidebar Footer */}
              <div className="p-3 border-t border-[var(--border-subtle)] text-[10px] font-mono text-[var(--text-muted)] text-center">
                OpenOnyx v{APP_VERSION}
              </div>
            </aside>

            {/* Right Pane */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
              {/* Content Header Bar */}
              <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <div className="text-[12px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  {currentStudio?.label || (activeTab === "hotkeys" ? "Shortcuts Registry" : "Cloud Workspaces")}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  Done
                </button>
              </div>

              {/* Scrollable Content Body */}
              <main className="flex-1 overflow-y-auto p-6 bg-[var(--bg-primary)]">
                <div className="mx-auto max-w-[1020px]">
                  
                  {/* 0. Settings Home */}
                  {activeTab === "home" && (
                    <SettingsHome
                      settings={settings}
                      onUpdateSetting={updateSetting}
                      onNavigate={(cat) => setActiveTab(cat as StudioTab)}
                    />
                  )}

                  {/* 1. Workspace */}
                  {activeTab === "workspace" && (
                    <div className="flex flex-col gap-6">
                      <div className="border-b border-[var(--border-subtle)] pb-4">
                        <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                          Workspace
                        </h2>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                          Configure default note placement, launch behavior, tabs, and file trash rules.
                        </p>
                      </div>

                      <div className="flex flex-col">
                        <PreferenceCard
                          title="Startup Document Location"
                          description="File behavior when launching OpenOnyx."
                        >
                          <SegmentedControl
                            value={settings.defaultFileToOpen}
                            onChange={(v) => updateSetting("defaultFileToOpen", v as AppSettings["defaultFileToOpen"])}
                            options={[
                              { value: "last-opened", label: "Last Opened" },
                              { value: "new-tab", label: "New Tab" },
                            ]}
                          />
                        </PreferenceCard>

                        <PreferenceCard
                          title="Default New Note Path"
                          description="Target folder for freshly generated notes."
                        >
                          <SegmentedControl
                            value={settings.defaultNoteLocation}
                            onChange={(v) => updateSetting("defaultNoteLocation", v as AppSettings["defaultNoteLocation"])}
                            options={[
                              { value: "vault", label: "Vault Root" },
                              { value: "same-folder", label: "Active Folder" },
                            ]}
                          />
                        </PreferenceCard>

                        <PreferenceCard
                          title="Auto-Focus New Tabs"
                          description="Automatically switch to newly created tab links."
                        >
                          <CustomToggle
                            checked={settings.alwaysFocusNewTabs}
                            onChange={(v) => updateSetting("alwaysFocusNewTabs", v)}
                          />
                        </PreferenceCard>

                        <PreferenceCard
                          title="Auto-Update Internal Links"
                          description="Dynamically adjust links when files are renamed."
                        >
                          <CustomToggle
                            checked={settings.autoUpdateInternalLinks}
                            onChange={(v) => updateSetting("autoUpdateInternalLinks", v)}
                          />
                        </PreferenceCard>

                        <PreferenceCard
                          title="File Trash Disposal"
                          description="Target behavior when deleting notes or media."
                        >
                          <SegmentedControl
                            value={settings.deletedFilesMode}
                            onChange={(v) => updateSetting("deletedFilesMode", v as AppSettings["deletedFilesMode"])}
                            options={[
                              { value: "system-trash", label: "System Trash" },
                              { value: "app-trash", label: "App Trash" },
                              { value: "permanent", label: "Permanent" },
                            ]}
                          />
                        </PreferenceCard>

                        <PreferenceCard
                          title="Delete File Confirmation"
                          description="Show prompt before permanently removing files."
                        >
                          <CustomToggle
                            checked={settings.confirmBeforeDelete}
                            onChange={(v) => updateSetting("confirmBeforeDelete", v)}
                          />
                        </PreferenceCard>
                      </div>
                    </div>
                  )}

                  {/* 2. Editor */}
                  {activeTab === "editor" && (
                    <LiveTypographyStudio settings={settings} onUpdateSetting={updateSetting} />
                  )}

                  {/* 3. Appearance */}
                  {activeTab === "appearance" && (
                    <LiveThemeStudio settings={settings} onUpdateSetting={updateSetting} />
                  )}

                  {/* 4. AI */}
                  {activeTab === "ai" && <AIIntelligenceDashboard />}

                  {/* 5. Sync */}
                  {activeTab === "sync" && <DatabaseInfrastructureView />}

                  {/* 6. Extensions */}
                  {activeTab === "extensions" && (
                    <PluginLibraryHub
                      settings={settings}
                      plugins={plugins}
                      pluginSettingTabs={pluginSettingTabs}
                      onUpdateSetting={updateSetting}
                      onEnablePlugin={onEnablePlugin}
                      onDisablePlugin={onDisablePlugin}
                      onRefreshPlugins={onRefreshPlugins}
                      onReloadPlugin={onReloadPlugin}
                      onUninstallPlugin={onUninstallPlugin}
                      onInstallPlugin={onInstallPlugin}
                      onBrowsePlugins={() => setIsBrowsingPlugins(true)}
                    />
                  )}

                  {/* 7. System */}
                  {activeTab === "system" && (
                    <div className="flex flex-col gap-6">
                      <div className="border-b border-[var(--border-subtle)] pb-4">
                        <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                          System
                        </h2>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                          Version details, account authentication, update checker, and factory reset.
                        </p>
                      </div>

                      {/* App Version Info (Flat) */}
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 text-center flex flex-col items-center justify-center gap-3">
                        <h3 className="text-base font-bold text-[var(--text-primary)]">OpenOnyx</h3>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            v{APP_VERSION}
                          </span>
                          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            Local-First
                          </span>
                        </div>
                        <p className="max-w-md text-[11px] text-[var(--text-muted)]">
                          An open-source knowledge workspace for local-first notes, infinite canvas boards, neural RAG indexing, and spatial graph networks.
                        </p>
                      </div>

                      {/* Account Controls */}
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 flex flex-col gap-3">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                          User Account & Sync Identity
                        </h4>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {currentUser
                            ? `Authenticated as ${currentUser.email}.`
                            : "Authenticate to enable cloud space sync and multi-user collaboration."}
                        </p>
                        {currentUser ? (
                          <button
                            type="button"
                            onClick={() => void authManager.signOut()}
                            className="h-8 rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] self-start"
                          >
                            Sign Out
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => { setAuthModalMode("login"); setShowAuthModal(true); }}
                              className="h-8 rounded bg-[var(--text-primary)] px-3 text-[11px] font-bold text-[var(--bg-primary)] hover:opacity-90"
                            >
                              Log In
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAuthModalMode("signup"); setShowAuthModal(true); }}
                              className="h-8 rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            >
                              Sign Up
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Factory Reset */}
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 flex items-center justify-between gap-4">
                        <div>
                          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">Reset Preferences</h4>
                          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                            Restores all visual styles and editor options to default values.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSettingsChange(DEFAULT_SETTINGS)}
                          className="h-8 rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-[11px] font-bold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                          Reset Defaults
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 8. Shortcuts Registry */}
                  {activeTab === "hotkeys" && (
                    <div className="flex flex-col gap-6">
                      <div className="border-b border-[var(--border-subtle)] pb-4">
                        <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                          Shortcuts Registry
                        </h2>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                          View global shortcuts and command palette keybindings.
                        </p>
                      </div>

                      <div className="flex flex-col">
                        {commands.length > 0
                          ? commands.map((cmd) => (
                              <PreferenceCard key={cmd.id} title={cmd.label}>
                                <kbd className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                                  {cmd.shortcut || "Unbound"}
                                </kbd>
                              </PreferenceCard>
                            ))
                          : [
                              { label: "Create new note", shortcut: "Ctrl+N" },
                              { label: "Save active note", shortcut: "Ctrl+S" },
                              { label: "Find in active note", shortcut: "Ctrl+F" },
                              { label: "Search vault notes", shortcut: "Ctrl+Shift+F" },
                              { label: "Open Command Palette", shortcut: "Ctrl+P" },
                              { label: "Open Quick Switcher", shortcut: "Ctrl+O" },
                            ].map((cmd, idx) => (
                              <PreferenceCard key={idx} title={cmd.label}>
                                <kbd className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                                  {cmd.shortcut}
                                </kbd>
                              </PreferenceCard>
                            ))}
                      </div>
                    </div>
                  )}

                  {/* 9. Collaboration */}
                  {activeTab === "collaboration" && (
                    <CollaborationPanel
                      vaultPath={vaultPath || null}
                      isSettingsMode={true}
                      onVaultReconstructed={onVaultReconstructed}
                      onGoToAccount={() => setActiveTab("system")}
                    />
                  )}
                </div>
              </main>
            </div>
          </>
        )}
      </div>

      {showAuthModal && (
        <AuthModal
          initialMode={authModalMode}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
