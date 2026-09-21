export type ThemeSetting =
  | "dark"
  | "openonyx"
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

const INTER_FONT = {
  id: "inter",
  label: "Inter — Neutral",
  value: "Inter, system-ui, sans-serif",
} as const;

const SPACE_GROTESK_FONT = {
  id: "space-grotesk",
  label: "Space Grotesk — Geometric",
  value: '"Space Grotesk", Inter, system-ui, sans-serif',
} as const;

const ATKINSON_FONT = {
  id: "atkinson",
  label: "Atkinson — Accessible",
  value: '"Atkinson Hyperlegible", Inter, system-ui, sans-serif',
} as const;

const LORA_FONT = {
  id: "lora",
  label: "Lora — Editorial",
  value: 'Lora, Georgia, "Times New Roman", serif',
} as const;

const GEORGIA_FONT = {
  id: "georgia",
  label: "Georgia — Classic",
  value: 'Georgia, "Times New Roman", serif',
} as const;

const JETBRAINS_MONO_FONT = {
  id: "jetbrains-mono",
  label: "JetBrains Mono — Technical",
  value: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
} as const;

export const FONT_FAMILY_PRESETS = [
  INTER_FONT,
  SPACE_GROTESK_FONT,
  ATKINSON_FONT,
  LORA_FONT,
  GEORGIA_FONT,
  JETBRAINS_MONO_FONT,
] as const;

const LEGACY_FONT_FAMILIES: Record<string, string> = {
  "'SF Pro Display', system-ui, sans-serif": INTER_FONT.value,
  "'Segoe UI', system-ui, sans-serif": INTER_FONT.value,
  "Georgia, serif": GEORGIA_FONT.value,
  "'JetBrains Mono', monospace": JETBRAINS_MONO_FONT.value,
};

export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return INTER_FONT.value;
  }

  return LEGACY_FONT_FAMILIES[value] ?? value;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "openonyx",
  accentColor: "#2563eb",
  fontFamily: INTER_FONT.value,
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
