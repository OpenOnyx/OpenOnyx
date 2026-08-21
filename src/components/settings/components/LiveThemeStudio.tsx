import React, { useRef, useCallback } from "react";
import type { AppSettings } from "../SettingsPage";
import { PreferenceCard, SliderControl, CustomToggle, SegmentedControl } from "./PreferenceCard";

interface LiveThemeStudioProps {
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(
    keyOrUpdates: K | Partial<AppSettings>,
    value?: AppSettings[K],
  ) => void;
}

const THEME_PRESETS = [
  { id: "dark", label: "Dark", bg: "#121212", text: "#f3f4f6" },
  { id: "light", label: "Light", bg: "#ffffff", text: "#111827" },
  { id: "system", label: "System", bg: "#1e1e2e", text: "#93c5fd" },
  { id: "dark-plus", label: "Dark+", bg: "#1e1e1e", text: "#60a5fa" },
  { id: "blue-night", label: "Blue Night", bg: "#0f172a", text: "#38bdf8" },
  { id: "oceanic", label: "Oceanic", bg: "#0f2027", text: "#2dd4bf" },
  { id: "ember-night", label: "Ember Night", bg: "#1c1917", text: "#fb923c" },
  { id: "aurora-grove", label: "Aurora Grove", bg: "#064e3b", text: "#34d399" },
  { id: "paper-sage", label: "Paper Sage", bg: "#f4f7f4", text: "#059669" },
  { id: "rose-quartz", label: "Rose Quartz", bg: "#fdf2f8", text: "#f472b6" },
  { id: "custom", label: "Custom", bg: "#18181b", text: "#ffffff" },
];

const MAX_WALLPAPER_WIDTH = 1920;
const MAX_WALLPAPER_HEIGHT = 1080;
const WALLPAPER_QUALITY = 0.8;

/**
 * Compress an image file to a JPEG data URL, capped at 1920x1080.
 * This keeps localStorage usage reasonable (~200-500KB per wallpaper).
 */
function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Scale down if exceeds max dimensions
        if (width > MAX_WALLPAPER_WIDTH || height > MAX_WALLPAPER_HEIGHT) {
          const ratio = Math.min(MAX_WALLPAPER_WIDTH / width, MAX_WALLPAPER_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", WALLPAPER_QUALITY);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function LiveThemeStudio({ settings, onUpdateSetting }: LiveThemeStudioProps) {
  const activePreset = THEME_PRESETS.find((p) => p.id === settings.theme) || THEME_PRESETS[0];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentBg = settings.theme === "custom" ? settings.customBgPrimary : activePreset.bg;
  const currentText = settings.theme === "custom" ? settings.customTextPrimary : activePreset.text;

  const handleWallpaperSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      onUpdateSetting("backgroundImage", dataUrl);
    } catch (err) {
      console.warn("[Wallpaper] Failed to process image:", err);
    }
    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onUpdateSetting]);

  const handleRemoveWallpaper = useCallback(() => {
    onUpdateSetting("backgroundImage", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onUpdateSetting]);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Appearance & Theme
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Tailor the color palette, zoom scale, ribbon layout, and workspace interface styling.
        </p>
      </div>

      {/* Interactive Workspace Miniature Preview */}
      <div className="rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-6 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Workspace Preview Stage
          </span>
          <span className="rounded-md bg-[var(--bg-tertiary)] px-2.5 py-1 text-xs font-mono font-semibold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
            Preset: {activePreset.label}
          </span>
        </div>

        {/* Workspace Mockup Card */}
        <div
          className="relative flex h-48 w-full overflow-hidden rounded-xl border border-black/10 transition-all duration-150"
          style={{ backgroundColor: currentBg, color: currentText }}
        >
          {/* Mock Ribbon */}
          {settings.showRibbon && (
            <div
              className="flex w-10 flex-col items-center gap-3 border-r py-3 transition-colors"
              style={{
                borderColor: `${currentText}15`,
                backgroundColor: `${currentText}08`,
              }}
            >
              <div
                className="h-4 w-4 rounded"
                style={{ backgroundColor: currentText }}
              />
              <div
                className="h-4 w-4 rounded opacity-40"
                style={{ backgroundColor: currentText }}
              />
            </div>
          )}

          {/* Mock File Explorer */}
          <div
            className="w-44 border-r p-3 text-xs transition-colors"
            style={{
              borderColor: `${currentText}15`,
              backgroundColor: `${currentText}04`,
            }}
          >
            <div className="mb-2 font-bold opacity-60 uppercase text-[9px] tracking-wider">Vault Notes</div>
            <div
              className="mb-1.5 rounded px-2 py-1 font-semibold"
              style={{ backgroundColor: `${currentText}15`, color: currentText }}
            >
              Quantum Physics.md
            </div>
            <div className="mb-1 px-2 py-1 opacity-70">
              Project Roadmap.md
            </div>
            <div className="px-2 py-1 opacity-70">
              AI Architecture.md
            </div>
          </div>

          {/* Mock Main Workspace Editor */}
          <div className="flex flex-1 flex-col">
            {/* Tab Bar */}
            <div
              className="flex items-center border-b px-3 pt-2 text-xs font-medium"
              style={{ borderColor: `${currentText}15` }}
            >
              <div
                className="flex items-center rounded-t-md border-t-2 px-3 py-1.5 font-bold"
                style={{
                  borderTopColor: currentText,
                  backgroundColor: currentBg,
                  color: currentText,
                }}
              >
                Quantum Physics.md
              </div>
            </div>

            {/* Note Content */}
            <div className="flex-1 p-5 text-xs">
              <h3 className="mb-2 text-sm font-bold" style={{ color: currentText }}>
                Quantum Physics & Knowledge Networks
              </h3>
              <p className="leading-relaxed opacity-80 text-[11px]">
                Local-first systems retain maximum privacy while enabling instant neural mapping...
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Theme Presets Grid */}
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Color Presets
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {THEME_PRESETS.map((preset) => {
            const isSelected = settings.theme === preset.id;
            const dotBg = preset.id === "custom" ? settings.customBgPrimary : preset.bg;
            const dotText = preset.id === "custom" ? settings.customTextPrimary : preset.text;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onUpdateSetting("theme", preset.id as AppSettings["theme"])}
                className={`relative flex items-center justify-between rounded-xl border p-3.5 text-left transition-all duration-150 ${
                  isSelected
                    ? "border-[var(--text-primary)] bg-[var(--bg-elevated)] font-bold shadow-xs"
                    : "border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <span className="text-xs text-[var(--text-primary)]">{preset.label}</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-[var(--border-medium)] shadow-xs"
                    style={{ backgroundColor: dotBg }}
                    title="Background Color"
                  />
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-[var(--border-medium)] shadow-xs"
                    style={{ backgroundColor: dotText }}
                    title="Text / Accent Color"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Theme Colors Panel */}
      {settings.theme === "custom" && (
        <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-5">
          <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Custom Colors
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                Workspace Background Color
              </label>
              <input
                type="color"
                value={settings.customBgPrimary}
                onChange={(e) => onUpdateSetting("customBgPrimary", e.target.value)}
                className="h-9 w-full cursor-pointer rounded-lg border border-[var(--border-medium)] bg-transparent p-1"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                Primary Text Color
              </label>
              <input
                type="color"
                value={settings.customTextPrimary}
                onChange={(e) => onUpdateSetting("customTextPrimary", e.target.value)}
                className="h-9 w-full cursor-pointer rounded-lg border border-[var(--border-medium)] bg-transparent p-1"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">
                Accent Color
              </label>
              <input
                type="color"
                value={settings.accentColor || "#3b82f6"}
                onChange={(e) => onUpdateSetting("accentColor", e.target.value)}
                className="h-9 w-full cursor-pointer rounded-lg border border-[var(--border-medium)] bg-transparent p-1"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Background Wallpaper Section ────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Background Wallpaper
        </h3>
        <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-secondary)] p-5">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleWallpaperSelect}
            className="hidden"
            id="wallpaper-file-input"
          />

          {/* Preview + Actions */}
          <div className="flex items-start gap-5">
            {/* Thumbnail / Placeholder */}
            <div
              className="relative flex h-28 w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-subtle)]"
              style={
                settings.backgroundImage
                  ? {
                      backgroundImage: `url(${settings.backgroundImage})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { backgroundColor: "var(--bg-tertiary)" }
              }
            >
              {!settings.backgroundImage && (
                <span className="text-[11px] font-medium text-[var(--text-muted)] text-center px-3">
                  No wallpaper set
                </span>
              )}
            </div>

            {/* Actions + Info */}
            <div className="flex flex-1 flex-col gap-3">
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                Set an image as your workspace background. The wallpaper renders behind all panels with adjustable blur and opacity.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                >
                  Choose Image
                </button>
                {settings.backgroundImage && (
                  <button
                    type="button"
                    onClick={handleRemoveWallpaper}
                    className="h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Blur & Opacity sliders (only shown when a wallpaper is set) */}
          {settings.backgroundImage && (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PreferenceCard
                title="Blur Amount"
                description="Apply a gaussian blur to the background image."
              >
                <SliderControl
                  value={settings.backgroundBlur ?? 0}
                  min={0}
                  max={40}
                  step={1}
                  unit="px"
                  onChange={(val) => onUpdateSetting("backgroundBlur", val)}
                />
              </PreferenceCard>

              <PreferenceCard
                title="Wallpaper Opacity"
                description="Controls the visibility of the background wallpaper."
              >
                <SliderControl
                  value={settings.backgroundOpacity ?? 40}
                  min={5}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={(val) => onUpdateSetting("backgroundOpacity", val)}
                />
              </PreferenceCard>
            </div>
          )}
        </div>
      </div>

      {/* Interface Layout Controls */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PreferenceCard
          title="Display Vertical Ribbon"
          description="Renders the vertical activity launcher on the left workspace edge."
        >
          <CustomToggle
            checked={settings.showRibbon}
            onChange={(v) => onUpdateSetting("showRibbon", v)}
          />
        </PreferenceCard>

        <PreferenceCard
          title="Application Zoom Scale"
          description="Adjusts total desktop window viewport rendering percentage."
        >
          <SliderControl
            value={settings.zoomLevel}
            min={80}
            max={140}
            step={5}
            unit="%"
            onChange={(val) => onUpdateSetting("zoomLevel", val)}
          />
        </PreferenceCard>

        <PreferenceCard
          title="Quick Scroll Font Adjust"
          description="Hold Ctrl + Scroll wheel or pinch trackpad to adjust font size."
        >
          <CustomToggle
            checked={settings.quickFontSizeAdjustment}
            onChange={(v) => onUpdateSetting("quickFontSizeAdjustment", v)}
          />
        </PreferenceCard>

        <PreferenceCard
          title="Window Frame Style"
          description="Toggle native OS window border controls versus frameless title bar."
        >
          <SegmentedControl
            value={settings.windowFrameStyle}
            onChange={(v) => onUpdateSetting("windowFrameStyle", v as AppSettings["windowFrameStyle"])}
            options={[
              { value: "hidden", label: "Frameless" },
              { value: "native", label: "Native Window" },
            ]}
          />
        </PreferenceCard>
      </div>
    </div>
  );
}
