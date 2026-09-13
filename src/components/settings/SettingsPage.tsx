import React from "react";
import type { PluginRegistration, PluginSettingTabRegistration } from "../../types/plugin";
import type { Command as AppCommand } from "../../types";
import type { LocalVaultCollaborator, LocalVaultInvite } from "../../lib/localdb";
import { SettingsCenter, type StudioTab } from "./SettingsCenter";

export type { ThemeSetting, AppSettings } from "../../types/settings";
export { DEFAULT_SETTINGS } from "../../types/settings";
import type { AppSettings } from "../../types/settings";

export type SettingsSection =
  | "home"
  | "general"
  | "editor"
  | "files"
  | "appearance"
  | "hotkeys"
  | "keychain"
  | "core-plugins"
  | "plugins"
  | "ai"
  | "database"
  | "backlinks"
  | "canvas"
  | "command-palette"
  | "daily-notes"
  | "page-preview"
  | "quick-switcher"
  | "templates"
  | "collaboration"
  | "about";

export interface SettingsPageProps {
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
  collaborators?: LocalVaultCollaborator[];
  invitesSent?: LocalVaultInvite[];
  invitesReceived?: LocalVaultInvite[];
  onInviteUser?: (email: string) => void;
  onRemoveCollaborator?: (id: string) => void;
  onAcceptInvite?: (id: string) => void;
  onRejectInvite?: (id: string) => void;
  currentUserEmail?: string;
  vaultPath?: string | null;
  onManageVaults?: () => void;
  previouslyOpenedVaults?: string[];
  onSwitchVault?: (path: string) => void;
  onVaultReconstructed?: (path: string) => void;
  initialSection?: SettingsSection;
}

function mapSectionToStudioTab(section?: SettingsSection): StudioTab {
  switch (section) {
    case "home":
      return "home";
    case "general":
      return "system";
    case "editor":
      return "editor";
    case "files":
      return "workspace";
    case "appearance":
      return "appearance";
    case "hotkeys":
      return "hotkeys";
    case "keychain":
    case "ai":
      return "ai";
    case "database":
      return "sync";
    case "core-plugins":
    case "plugins":
    case "backlinks":
    case "canvas":
      return "extensions";
    case "collaboration":
      return "collaboration";
    case "about":
      return "system";
    default:
      return "home";
  }
}

export function SettingsPage({
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
  initialSection,
}: SettingsPageProps) {
  const initialTab = mapSectionToStudioTab(initialSection);

  return (
    <SettingsCenter
      settings={settings}
      onSettingsChange={onSettingsChange}
      onClose={onClose}
      commands={commands}
      plugins={plugins}
      pluginSettingTabs={pluginSettingTabs}
      onEnablePlugin={onEnablePlugin}
      onDisablePlugin={onDisablePlugin}
      onRefreshPlugins={onRefreshPlugins}
      onReloadPlugin={onReloadPlugin}
      onUninstallPlugin={onUninstallPlugin}
      onInstallPlugin={onInstallPlugin}
      vaultPath={vaultPath || undefined}
      onVaultReconstructed={onVaultReconstructed}
      initialTab={initialTab}
    />
  );
}
