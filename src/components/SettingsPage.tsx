/**
 * Settings Page - Application Configuration
 *
 * Comprehensive settings interface for customizing:
 * - Appearance (theme, fonts, colors)
 * - Editor (font size, line height, etc.)
 * - Files & Links (default locations, link format)
 * - Hotkeys (keyboard shortcuts)
 */

import React, { useState, useEffect } from "react";
import {
  X,
  Palette,
  Type,
  FileText,
  Keyboard,
  Info,
  FolderOpen,
  RotateCcw,
} from "lucide-react";

export interface AppSettings {
  // Appearance
  theme: "dark" | "light" | "system" | "custom";
  accentColor: string;
  fontFamily: string;

  // Custom Colors (used when theme === 'custom')
  customBgPrimary: string;
  customTextPrimary: string;

  // Editor
  fontSize: number;
  editorFontSize: number;
  previewFontSize: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  spellcheck: boolean;

  // Files & Links
  defaultNoteLocation: string;
  attachmentLocation: string;
  linkFormat: "shortest" | "relative" | "absolute";
  useWikiLinks: boolean;
  autoCreateNotes: boolean;

  // Daily Notes
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  dailyNoteTemplate: string;

  // Graph
  nodeSize: number;
  nodeSpacing: number;
  showOrphans: boolean;

  // Canvas
  autoHideDrawingControls: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accentColor: "#7c3aed",
  fontFamily: "Inter, system-ui, sans-serif",

  customBgPrimary: "#151515",
  customTextPrimary: "#e6e6e6",

  fontSize: 15,
  editorFontSize: 15,
  previewFontSize: 15,
  lineHeight: 1.6,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellcheck: false,

  defaultNoteLocation: "",
  attachmentLocation: "attachments",
  linkFormat: "shortest",
  useWikiLinks: true,
  autoCreateNotes: true,

  dailyNoteFolder: "Daily Notes",
  dailyNoteFormat: "YYYY-MM-DD",
  dailyNoteTemplate: "",

  nodeSize: 5,
  nodeSpacing: 100,
  showOrphans: true,

  autoHideDrawingControls: true,
};

interface SettingsPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

type SettingsSection = "appearance" | "editor" | "files" | "hotkeys" | "about";

export function SettingsPage({
  settings,
  onSettingsChange,
  onClose,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
    onSettingsChange(updated);
  };

  const resetSettings = () => {
    setLocalSettings(DEFAULT_SETTINGS);
    onSettingsChange(DEFAULT_SETTINGS);
  };

  const sections = [
    { id: "appearance" as const, label: "Appearance", icon: Palette },
    { id: "editor" as const, label: "Editor", icon: Type },
    { id: "files" as const, label: "Files & Links", icon: FileText },
    { id: "hotkeys" as const, label: "Hotkeys", icon: Keyboard },
    { id: "about" as const, label: "About", icon: Info },
  ];

  return (
    <div className="settings-overlay">
      <div className="settings-page">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                className={`settings-nav-item ${activeSection === section.id ? "active" : ""}`}
                onClick={() => setActiveSection(section.id)}
              >
                <section.icon size={16} />
                <span>{section.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeSection === "appearance" && (
              <div className="settings-section">
                <h3>Appearance</h3>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Theme</span>
                    <select
                      value={localSettings.theme}
                      onChange={(e) =>
                        updateSetting(
                          "theme",
                          e.target.value as AppSettings["theme"],
                        )
                      }
                      className="setting-select"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                </div>

                {localSettings.theme === "custom" && (
                  <>
                    <div className="setting-group">
                      <label className="setting-label">
                        <span>Custom Background Color</span>
                        <input
                          type="color"
                          value={localSettings.customBgPrimary}
                          onChange={(e) =>
                            updateSetting("customBgPrimary", e.target.value)
                          }
                          className="setting-color"
                        />
                      </label>
                    </div>
                    <div className="setting-group">
                      <label className="setting-label">
                        <span>Custom Text Color</span>
                        <input
                          type="color"
                          value={localSettings.customTextPrimary}
                          onChange={(e) =>
                            updateSetting("customTextPrimary", e.target.value)
                          }
                          className="setting-color"
                        />
                      </label>
                    </div>
                  </>
                )}

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Accent Color</span>
                    <input
                      type="color"
                      value={localSettings.accentColor}
                      onChange={(e) =>
                        updateSetting("accentColor", e.target.value)
                      }
                      className="setting-color"
                    />
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Font Family</span>
                    <select
                      value={localSettings.fontFamily}
                      onChange={(e) =>
                        updateSetting("fontFamily", e.target.value)
                      }
                      className="setting-select"
                    >
                      <option value="Inter, system-ui, sans-serif">
                        Inter (Default)
                      </option>
                      <option value="'SF Pro Display', system-ui, sans-serif">
                        SF Pro
                      </option>
                      <option value="'Segoe UI', system-ui, sans-serif">
                        Segoe UI
                      </option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="'JetBrains Mono', monospace">
                        JetBrains Mono
                      </option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {activeSection === "editor" && (
              <div className="settings-section">
                <h3>Editor</h3>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Font Size</span>
                    <div className="setting-range">
                      <input
                        type="range"
                        min="12"
                        max="24"
                        value={localSettings.fontSize}
                        onChange={(e) => {
                          const fontSize = parseInt(e.target.value);
                          const updated = {
                            ...localSettings,
                            fontSize,
                            editorFontSize: fontSize,
                            previewFontSize: fontSize,
                          };
                          setLocalSettings(updated);
                          onSettingsChange(updated);
                        }}
                      />
                      <span>{localSettings.fontSize}px</span>
                    </div>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Line Height</span>
                    <div className="setting-range">
                      <input
                        type="range"
                        min="1.2"
                        max="2.0"
                        step="0.1"
                        value={localSettings.lineHeight}
                        onChange={(e) =>
                          updateSetting(
                            "lineHeight",
                            parseFloat(e.target.value),
                          )
                        }
                      />
                      <span>{localSettings.lineHeight}</span>
                    </div>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Tab Size</span>
                    <select
                      value={localSettings.tabSize}
                      onChange={(e) =>
                        updateSetting("tabSize", parseInt(e.target.value))
                      }
                      className="setting-select"
                    >
                      <option value="2">2 spaces</option>
                      <option value="4">4 spaces</option>
                      <option value="8">8 spaces</option>
                    </select>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-toggle">
                    <span>Word Wrap</span>
                    <input
                      type="checkbox"
                      checked={localSettings.wordWrap}
                      onChange={(e) =>
                        updateSetting("wordWrap", e.target.checked)
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-toggle">
                    <span>Spell Check</span>
                    <input
                      type="checkbox"
                      checked={localSettings.spellcheck}
                      onChange={(e) =>
                        updateSetting("spellcheck", e.target.checked)
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-toggle">
                    <span>Auto-hide drawing controls</span>
                    <input
                      type="checkbox"
                      checked={localSettings.autoHideDrawingControls}
                      onChange={(e) =>
                        updateSetting(
                          "autoHideDrawingControls",
                          e.target.checked,
                        )
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <small className="setting-description">
                    Collapse canvas drawing controls after a stroke and reopen
                    when drawing resumes.
                  </small>
                </div>
              </div>
            )}

            {activeSection === "files" && (
              <div className="settings-section">
                <h3>Files & Links</h3>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Default Location for New Notes</span>
                    <div className="setting-input-with-btn">
                      <input
                        type="text"
                        value={localSettings.defaultNoteLocation}
                        onChange={(e) =>
                          updateSetting("defaultNoteLocation", e.target.value)
                        }
                        placeholder="Vault root"
                        className="setting-input"
                      />
                      <button className="setting-browse-btn">
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Attachment Folder</span>
                    <input
                      type="text"
                      value={localSettings.attachmentLocation}
                      onChange={(e) =>
                        updateSetting("attachmentLocation", e.target.value)
                      }
                      placeholder="attachments"
                      className="setting-input"
                    />
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-toggle">
                    <span>Use [[Wiki Links]]</span>
                    <input
                      type="checkbox"
                      checked={localSettings.useWikiLinks}
                      onChange={(e) =>
                        updateSetting("useWikiLinks", e.target.checked)
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <small className="setting-description">
                    When disabled, standard Markdown links will be used instead.
                  </small>
                </div>

                <div className="setting-group">
                  <label className="setting-toggle">
                    <span>Auto-Create Notes</span>
                    <input
                      type="checkbox"
                      checked={localSettings.autoCreateNotes}
                      onChange={(e) =>
                        updateSetting("autoCreateNotes", e.target.checked)
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <small className="setting-description">
                    Automatically create notes when clicking unresolved links.
                  </small>
                </div>

                <h4>Daily Notes</h4>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Daily Notes Folder</span>
                    <input
                      type="text"
                      value={localSettings.dailyNoteFolder}
                      onChange={(e) =>
                        updateSetting("dailyNoteFolder", e.target.value)
                      }
                      placeholder="Daily Notes"
                      className="setting-input"
                    />
                  </label>
                </div>

                <div className="setting-group">
                  <label className="setting-label">
                    <span>Date Format</span>
                    <input
                      type="text"
                      value={localSettings.dailyNoteFormat}
                      onChange={(e) =>
                        updateSetting("dailyNoteFormat", e.target.value)
                      }
                      placeholder="YYYY-MM-DD"
                      className="setting-input"
                    />
                  </label>
                  <small className="setting-description">
                    Format: YYYY (year), MM (month), DD (day)
                  </small>
                </div>
              </div>
            )}

            {activeSection === "hotkeys" && (
              <div className="settings-section">
                <h3>Hotkeys</h3>
                <p className="setting-description">
                  Keyboard shortcuts for common actions.
                </p>

                <div className="hotkey-list">
                  <div className="hotkey-item">
                    <span>New Note</span>
                    <kbd>Ctrl+N</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Save</span>
                    <kbd>Ctrl+S</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Find in Note</span>
                    <kbd>Ctrl+F</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Search Vault</span>
                    <kbd>Ctrl+Shift+F</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Command Palette</span>
                    <kbd>Ctrl+P</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Toggle Graph</span>
                    <kbd>Ctrl+G</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Toggle Sidebar</span>
                    <kbd>Ctrl+B</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Close Tab</span>
                    <kbd>Ctrl+W</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Zoom Editor Text</span>
                    <kbd>Ctrl/Cmd+Scroll</kbd>
                  </div>
                  <div className="hotkey-item">
                    <span>Zoom Current Pane Only</span>
                    <kbd>Ctrl/Cmd+Shift+Scroll</kbd>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "about" && (
              <div className="settings-section">
                <h3>About OpenObsidian</h3>

                <div className="about-info">
                  <div className="about-logo">📝</div>
                  <h4>OpenObsidian</h4>
                  <p className="about-version">Version 1.0.0</p>
                  <p className="about-description">
                    A local-first knowledge management tool for creating,
                    editing, and linking Markdown notes. Built with Electron,
                    React, and TypeScript.
                  </p>

                  <div className="about-links">
                    <a href="#" className="about-link">
                      Documentation
                    </a>
                    <a href="#" className="about-link">
                      Release Notes
                    </a>
                    <a href="#" className="about-link">
                      Report Issue
                    </a>
                  </div>
                </div>

                <div className="setting-group" style={{ marginTop: "2rem" }}>
                  <button className="setting-reset-btn" onClick={resetSettings}>
                    <RotateCcw size={14} />
                    Reset to Default Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
