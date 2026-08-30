import React from "react";
import type { PluginRegistration, PluginSettingTabRegistration } from "../../types/plugin";
import type { Command as AppCommand } from "../../types";
import type { SnippetManager } from "../../lib/snippetManager";
import type { LocalVaultCollaborator, LocalVaultInvite } from "../../lib/localdb";
import { SettingsCenter, type StudioTab } from "./SettingsCenter";

type ThemeSetting =
  | "dark"
  | "light"
  | "oceanic"
  | "dark-plus"
  | "blue-night"
  | "ember-night"
  | "aurora-grove"
  | "paper-sage"
  | "rose-quartz"
  | "system"
  | "custom";

export interface AppSettings {
  theme: ThemeSetting;
  customThemeType: "dark" | "light";
  accentColor: string;
  fontFamily: string;
  customBgPrimary: string;
  customTextPrimary: string;

  fontSize: number;
  editorFontSize: number;
  previewFontSize: number;
  readingViewWidth: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  spellcheck: boolean;
  vimMode: boolean;
  useWikiLinks: boolean;

  autoUpdates: boolean;
  language: "English";
  alwaysFocusNewTabs: boolean;
  defaultView: "editor" | "preview" | "split";
  defaultEditingMode: "live-preview" | "source";
  showEditingModeStatusBar: boolean;
  readableLineLength: boolean;
  strictLineBreaks: boolean;
  propertiesInDocument: "visible" | "hidden" | "source";
  foldHeading: boolean;
  foldIndent: boolean;
  indentationGuides: boolean;
  rightToLeft: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  smartLists: boolean;
  indentUsingTabs: boolean;
  convertPastedHtml: boolean;

  defaultFileToOpen: "last-opened" | "new-tab";
  defaultNoteLocation: "vault" | "same-folder";
  defaultAttachmentLocation: "vault" | "same-folder";
  newLinkFormat: "shortest" | "relative" | "absolute";
  autoUpdateInternalLinks: boolean;
  showAllFileTypes: boolean;
  confirmBeforeDelete: boolean;
  deleteAttachmentsMode: "ask" | "always" | "never";
  deletedFilesMode: "system-trash" | "app-trash" | "permanent";
  excludedFiles: string;
  overrideConfigFolder: string;
  allowUrlCallbacks: boolean;

  inlineTitle: boolean;
  showTabTitleBar: boolean;
  showRibbon: boolean;
  quickFontSizeAdjustment: boolean;
  zoomLevel: number;
  nativeMenus: boolean;
  windowFrameStyle: "hidden" | "native";
  hardwareAcceleration: boolean;

  backgroundImage: string;
  backgroundBlur: number;
  backgroundOpacity: number;

  coreBacklinks: boolean;
  coreCanvas: boolean;
  coreCommandPalette: boolean;
  coreDailyNotes: boolean;
  corePagePreview: boolean;
  coreQuickSwitcher: boolean;
  coreTemplates: boolean;
  backlinksOpenByDefault: boolean;
  backlinksShowUnlinked: boolean;
  canvasDefaultLocation: "vault" | "same-folder";
  canvasMouseWheelBehavior: "pan" | "zoom";
  canvasCtrlDragBehavior: "menu" | "pan";
  canvasShowCardNames: "always" | "hover" | "never";
  canvasSnapToGrid: boolean;
  canvasSnapToObjects: boolean;
  canvasZoomThreshold: number;
  dailyNoteDateFormat: string;
  dailyNoteLocation: string;
  dailyNoteTemplate: string;
  pagePreviewRequireCtrl: boolean;
  pagePreviewSearchLinks: boolean;
  pagePreviewReading: boolean;
  pagePreviewEditing: boolean;
  pagePreviewTabHeader: boolean;
  pagePreviewFiles: boolean;
  pagePreviewProperties: boolean;
  pagePreviewBookmarks: boolean;
  pagePreviewOutline: boolean;
  pagePreviewGraph: boolean;
  templatesFolder: string;
  templateDateFormat: string;
  templateTimeFormat: string;
  pluginAutoUpdates: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accentColor: "#2563eb",
  fontFamily: "Inter, system-ui, sans-serif",
  customBgPrimary: "#151515",
  customTextPrimary: "#e6e6e6",
  customThemeType: "dark",

  fontSize: 17,
  editorFontSize: 17,
  previewFontSize: 17,
  readingViewWidth: 800,
  lineHeight: 1.5,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellcheck: false,
  vimMode: false,
  useWikiLinks: true,

  autoUpdates: true,
  language: "English",
  alwaysFocusNewTabs: true,
  defaultView: "editor",
  defaultEditingMode: "live-preview",
  showEditingModeStatusBar: true,
  readableLineLength: true,
  strictLineBreaks: false,
  propertiesInDocument: "visible",
  foldHeading: true,
  foldIndent: true,
  indentationGuides: true,
  rightToLeft: false,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  smartLists: true,
  indentUsingTabs: true,
  convertPastedHtml: true,

  defaultFileToOpen: "last-opened",
  defaultNoteLocation: "vault",
  defaultAttachmentLocation: "vault",
  newLinkFormat: "shortest",
  autoUpdateInternalLinks: false,
  showAllFileTypes: false,
  confirmBeforeDelete: true,
  deleteAttachmentsMode: "ask",
  deletedFilesMode: "system-trash",
  excludedFiles: "",
  overrideConfigFolder: ".openonyx",
  allowUrlCallbacks: false,

  inlineTitle: true,
  showTabTitleBar: true,
  showRibbon: true,
  quickFontSizeAdjustment: false,
  zoomLevel: 100,
  nativeMenus: false,
  windowFrameStyle: "hidden",
  hardwareAcceleration: true,

  backgroundImage: "",
  backgroundBlur: 0,
  backgroundOpacity: 40,

  coreBacklinks: true,
  coreCanvas: true,
  coreCommandPalette: true,
  coreDailyNotes: true,
  corePagePreview: true,
  coreQuickSwitcher: true,
  coreTemplates: true,
  backlinksOpenByDefault: false,
  backlinksShowUnlinked: true,
  canvasDefaultLocation: "vault",
  canvasMouseWheelBehavior: "pan",
  canvasCtrlDragBehavior: "menu",
  canvasShowCardNames: "always",
  canvasSnapToGrid: true,
  canvasSnapToObjects: true,
  canvasZoomThreshold: 60,
  dailyNoteDateFormat: "YYYY-MM-DD",
  dailyNoteLocation: "",
  dailyNoteTemplate: "",
  pagePreviewRequireCtrl: false,
  pagePreviewSearchLinks: true,
  pagePreviewReading: false,
  pagePreviewEditing: true,
  pagePreviewTabHeader: true,
  pagePreviewFiles: true,
  pagePreviewProperties: true,
  pagePreviewBookmarks: true,
  pagePreviewOutline: true,
  pagePreviewGraph: true,
  templatesFolder: "templates",
  templateDateFormat: "YYYY-MM-DD",
  templateTimeFormat: "HH:mm",
  pluginAutoUpdates: false,
};

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
  | "about"
  | "css-snippets";

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
  vaultPath?: string;
  onVaultReconstructed?: (path: string) => void;
  initialSection?: SettingsSection;
  snippetManager?: SnippetManager;
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
    case "css-snippets":
      return "css-snippets";
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
  snippetManager,
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
      vaultPath={vaultPath}
      onVaultReconstructed={onVaultReconstructed}
      initialTab={initialTab}
      snippetManager={snippetManager}
    />
  );
}
