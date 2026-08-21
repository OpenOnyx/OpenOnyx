import React from "react";
import type { AppSettings } from "../SettingsPage";
import { PreferenceCard, SegmentedControl, SliderControl, CustomToggle } from "./PreferenceCard";

interface LiveTypographyStudioProps {
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(
    keyOrUpdates: K | Partial<AppSettings>,
    value?: AppSettings[K],
  ) => void;
}

export function LiveTypographyStudio({ settings, onUpdateSetting }: LiveTypographyStudioProps) {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Editor & Typography
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Configure typography, line spacing, editor mechanics, and live Markdown rendering rules.
        </p>
      </div>

      {/* Interactive Live Editor Canvas Preview */}
      <div className="rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-6 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Live Editor Preview
          </span>
          <span className="rounded-md bg-[var(--bg-tertiary)] px-2.5 py-1 font-mono text-xs font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
            {settings.fontFamily.split(",")[0]} • {settings.fontSize}px • {settings.readingViewWidth}px
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-6 transition-all duration-150">
          <div
            className="mx-auto transition-all duration-150"
            style={{
              maxWidth: settings.readableLineLength ? `${settings.readingViewWidth}px` : "100%",
              fontFamily: settings.fontFamily,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
            }}
          >
            <h1 className="mb-3 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Quantum Knowledge Synthesizer
            </h1>
            <p className="mb-4 text-[var(--text-primary)]">
              OpenOnyx provides a local-first knowledge graph designed for high-density note networks. You can cross-reference thoughts seamlessly using{" "}
              {settings.useWikiLinks ? (
                <span className="cursor-pointer rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[var(--text-primary)] underline decoration-1 underline-offset-2">
                  [[Neural Mapping]]
                </span>
              ) : (
                <span className="cursor-pointer text-[var(--text-primary)] underline">
                  [Neural Mapping](neural-mapping.md)
                </span>
              )}
              .
            </p>

            <div className="my-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 font-mono text-xs text-[var(--text-secondary)]">
              <code>
                {`const graph = new KnowledgeNetwork({ localFirst: true });`}
                <br />
                {`await graph.connectEmbeddings();`}
              </code>
            </div>

            <ul className="list-disc space-y-1.5 pl-5 text-[var(--text-secondary)]">
              <li>Automatic background vector indexer</li>
              <li>Encrypted vault synchronization</li>
              <li>Dynamic line-height constraint: {settings.lineHeight}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Control Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Font Family Selection */}
        <PreferenceCard
          title="Primary Font"
          description="Base font applied to writing views and reading panes."
        >
          <select
            value={settings.fontFamily}
            onChange={(e) => onUpdateSetting("fontFamily", e.target.value)}
            className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] outline-none"
          >
            <option value="Inter, system-ui, sans-serif">Inter (Sans)</option>
            <option value="'SF Pro Display', system-ui, sans-serif">SF Pro (System)</option>
            <option value="'Segoe UI', system-ui, sans-serif">Segoe UI</option>
            <option value="Georgia, serif">Georgia (Serif)</option>
            <option value="'JetBrains Mono', monospace">JetBrains Mono (Code)</option>
          </select>
        </PreferenceCard>

        {/* Font Size Slider */}
        <PreferenceCard
          title="Font Scale"
          description="Base text size in pixels across editor and reading views."
        >
          <SliderControl
            value={settings.fontSize}
            min={12}
            max={24}
            unit="px"
            onChange={(val) => {
              onUpdateSetting({
                fontSize: val,
                editorFontSize: val,
                previewFontSize: val,
              });
            }}
          />
        </PreferenceCard>

        {/* Readable Line Length Constraint */}
        <PreferenceCard
          title="Constrain Line Width"
          description="Limits maximal paragraph width to optimize reading distance."
        >
          <CustomToggle
            checked={settings.readableLineLength}
            onChange={(v) => onUpdateSetting("readableLineLength", v)}
          />
        </PreferenceCard>

        {/* Line Width Slider */}
        <PreferenceCard
          title="Line Width Limit"
          description="Maximum pixel width when line length constraint is enabled."
        >
          <SliderControl
            value={settings.readingViewWidth}
            min={640}
            max={1180}
            step={20}
            unit="px"
            onChange={(val) => onUpdateSetting("readingViewWidth", val)}
          />
        </PreferenceCard>

        {/* Wikilinks Toggle */}
        <PreferenceCard
          title="[[Wikilinks]] Format"
          description="Auto-generate [[Wikilinks]] instead of standard Markdown links."
        >
          <CustomToggle
            checked={settings.useWikiLinks}
            onChange={(v) => onUpdateSetting("useWikiLinks", v)}
          />
        </PreferenceCard>

        {/* Default View Mode */}
        <PreferenceCard
          title="Default View"
          description="Initial mode assigned when opening new Markdown documents."
        >
          <SegmentedControl
            value={settings.defaultView}
            onChange={(v) => onUpdateSetting("defaultView", v as AppSettings["defaultView"])}
            options={[
              { value: "editor", label: "Editor" },
              { value: "preview", label: "Reading" },
              { value: "split", label: "Split" },
            ]}
          />
        </PreferenceCard>

        {/* Live Preview vs Source */}
        <PreferenceCard
          title="Default Editing Mode"
          description="Choose between Live Preview or raw Source mode."
        >
          <SegmentedControl
            value={settings.defaultEditingMode}
            onChange={(v) => onUpdateSetting("defaultEditingMode", v as AppSettings["defaultEditingMode"])}
            options={[
              { value: "live-preview", label: "Live Preview" },
              { value: "source", label: "Source" },
            ]}
          />
        </PreferenceCard>

        {/* Properties View */}
        <PreferenceCard
          title="YAML Properties"
          description="How YAML property headers appear at top of notes."
        >
          <SegmentedControl
            value={settings.propertiesInDocument}
            onChange={(v) => onUpdateSetting("propertiesInDocument", v as AppSettings["propertiesInDocument"])}
            options={[
              { value: "visible", label: "Visible" },
              { value: "hidden", label: "Hidden" },
              { value: "source", label: "Source" },
            ]}
          />
        </PreferenceCard>

        {/* Indent Guides */}
        <PreferenceCard
          title="Indentation Relationship Guides"
          description="Vertical lines between nested bullet list items."
        >
          <CustomToggle
            checked={settings.indentationGuides}
            onChange={(v) => onUpdateSetting("indentationGuides", v)}
          />
        </PreferenceCard>

        {/* Line Numbers */}
        <PreferenceCard
          title="Line Numbers"
          description="Displays line numbers along the left gutter."
        >
          <CustomToggle
            checked={settings.showLineNumbers}
            onChange={(v) => onUpdateSetting("showLineNumbers", v)}
          />
        </PreferenceCard>

        {/* Strict Line Breaks */}
        <PreferenceCard
          title="Strict Line Breaks"
          description="Require double spaces for single line breaks in reading view."
        >
          <CustomToggle
            checked={settings.strictLineBreaks}
            onChange={(v) => onUpdateSetting("strictLineBreaks", v)}
          />
        </PreferenceCard>

        {/* Vim Mode */}
        <PreferenceCard
          title="Vim Key Bindings"
          description="Enables modal Vim navigation and editing shortcuts."
        >
          <CustomToggle
            checked={settings.vimMode}
            onChange={(v) => onUpdateSetting("vimMode", v)}
          />
        </PreferenceCard>
      </div>
    </div>
  );
}
