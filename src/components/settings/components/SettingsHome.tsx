import React from "react";
import type { AppSettings } from "../SettingsPage";
import { SliderControl, SegmentedControl } from "./PreferenceCard";

interface SettingsHomeProps {
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(
    keyOrUpdates: K | Partial<AppSettings>,
    value?: AppSettings[K],
  ) => void;
  onNavigate: (category: string) => void;
}

export function SettingsHome({ settings, onUpdateSetting, onNavigate }: SettingsHomeProps) {
  return (
    <div className="flex flex-col gap-10">
      {/* Welcoming Header */}
      <div className="border-b border-[var(--border-subtle)] pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">
          What would you like to customize today?
        </p>
      </div>

      {/* Quick Tweaks Shelf */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Quick Tweaks
          </h2>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">Instant response</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Theme Selector */}
          <div className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Theme</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">{settings.theme}</span>
            </div>
            <SegmentedControl
              value={settings.theme}
              onChange={(v) => onUpdateSetting("theme", v as AppSettings["theme"])}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </div>

          {/* Font Size Scale */}
          <div className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Font Size</span>
              <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                {settings.fontSize}px
              </span>
            </div>
            <SliderControl
              value={settings.fontSize}
              min={12}
              max={24}
              unit="px"
              showValue={false}
              onChange={(val) => {
                onUpdateSetting({
                  fontSize: val,
                  editorFontSize: val,
                  previewFontSize: val,
                });
              }}
            />
          </div>
        </div>
      </div>

      {/* Categories Navigation Grid */}
      <div>
        <div className="mb-4 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Explore Settings
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {[
            { id: "workspace", title: "Workspace", desc: "Default folders, tabs & files" },
            { id: "editor", title: "Editor", desc: "Typography, Wikilinks & line width" },
            { id: "appearance", title: "Appearance", desc: "Themes, font scale & zoom level" },
            { id: "css-snippets", title: "CSS Snippets", desc: "Custom stylesheets on top of the theme" },
            { id: "ai", title: "AI", desc: "Providers, models & note indexer" },
            { id: "sync", title: "Sync", desc: "Cloud database & storage connection" },
            { id: "extensions", title: "Extensions", desc: "Community plugins & core suite" },
            { id: "system", title: "System", desc: "Updates, accounts & factory reset" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onNavigate(cat.id)}
              className="group relative flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 text-left transition-all duration-150 hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[var(--text-primary)]">{cat.title}</span>
                  <span className="text-xs font-mono text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                    →
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{cat.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Suggested Search Chips */}
      <div>
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Suggested Customizations
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Larger text", cat: "editor" },
            { label: "Dark mode", cat: "appearance" },
            { label: "Configure AI models", cat: "ai" },
            { label: "Use Vim keybindings", cat: "editor" },
            { label: "Cloud sync settings", cat: "sync" },
            { label: "Community plugins", cat: "extensions" },
          ].map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate(chip.cat)}
              className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
