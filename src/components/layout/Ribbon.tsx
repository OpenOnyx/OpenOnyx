import React, { useEffect, useRef } from "react";
import {
  Network,
  Calendar,
  Sparkles,
  Layout,
  Settings,
} from "lucide-react";
import type { PluginRibbonAction } from '../../types/plugin';
import { setIcon } from '../../lib/obsidian-api/utils';
import { SpacesIcon } from "../spaces/SpacesIcon";

// Keep class "ribbon" for plugin leftRibbon mounts; oo-activity-rail is host chrome.
const ribbonRootClass =
  "ribbon oo-activity-rail flex flex-col justify-between items-center w-[var(--oo-rail-width,var(--ribbon-width))] bg-[var(--oo-surface-1,var(--bg-secondary))] border-r border-[var(--oo-border-subtle,var(--divider-color))] border-t border-t-[var(--oo-border-subtle,var(--divider-color))] px-1.5 pt-2.5 pb-3 shrink-0";
const ribbonGroupClass = "flex flex-col items-center gap-1.5";
const ribbonBtnClass =
  "oo-activity-rail-btn flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[var(--oo-text-secondary,var(--text-secondary))] transition-colors duration-150 hover:bg-[var(--oo-accent-muted,var(--bg-hover))] hover:text-[var(--oo-text-primary,var(--text-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oo-accent,var(--color-accent))]";
const pluginRibbonIconClass =
  "flex h-5 w-5 items-center justify-center text-current [&_.svg-icon]:block [&_.svg-icon]:h-5 [&_.svg-icon]:w-5 [&_.svg-icon]:shrink-0 [&_.svg-icon]:text-current [&_.svg-icon]:[stroke-width:1.5]";

interface RibbonProps {
  onToggleExplorer?: () => void;
  onGraph: () => void;
  onSettings: () => void;
  onDailyNote?: () => void;
  onToggleTags?: () => void;
  onThoughtModel?: () => void;
  onSpaces?: () => void;
  onCanvas?: () => void;
  pluginRibbonActions?: PluginRibbonAction[];
  showSettingsButton?: boolean;
}

export function Ribbon({
  onGraph,
  onToggleExplorer,
  onSettings,
  onDailyNote,
  onToggleTags,
  onThoughtModel,
  onSpaces,
  onCanvas,
  pluginRibbonActions = [],
  showSettingsButton = false,
}: RibbonProps) {
  const ribbonRootRef = useRef<HTMLDivElement | null>(null);
  const ribbonItemsRef = useRef<HTMLDivElement | null>(null);

  const renderPluginIcon = (el: HTMLSpanElement | null, action: PluginRibbonAction) => {
    if (!el) return;
    setIcon(el, action.icon);
    const svg = el.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "20");
      svg.setAttribute("height", "20");
      svg.style.width = "20px";
      svg.style.height = "20px";
      svg.style.strokeWidth = "1.5";
      svg.style.color = "currentColor";
    }
    const item = (window as any).__oo_app?.workspace?.leftRibbon?.items?.find(
      (entry: any) => entry.id === (action as any).id,
    );
    if (item) item.buttonEl = el;
  };

  useEffect(() => {
    const ribbon = (window as any).__oo_app?.workspace?.leftRibbon;
    if (!ribbon) return;
    ribbon.containerEl = ribbonRootRef.current;
    ribbon.ribbonItemsEl = ribbonItemsRef.current;
    return () => {
      if (ribbon.containerEl === ribbonRootRef.current) ribbon.containerEl = document.createElement('div');
      if (ribbon.ribbonItemsEl === ribbonItemsRef.current) ribbon.ribbonItemsEl = ribbon.containerEl;
    };
  }, []);

  return (
    <div 
      className={ribbonRootClass}
      ref={ribbonRootRef}
    >
      <div className={ribbonGroupClass} ref={ribbonItemsRef}>
        {onDailyNote && (
          <button
            className={ribbonBtnClass}
            onClick={onDailyNote}
            data-tooltip="Daily Note"
          >
            <Calendar size={20} strokeWidth={1.5} />
          </button>
        )}
        <button
          className={ribbonBtnClass}
          onClick={onGraph}
          data-tooltip="Graph View (Ctrl+G)"
        >
          <Network size={20} strokeWidth={1.5} />
        </button>
        {onThoughtModel && (
          <button
            className={ribbonBtnClass}
            onClick={onThoughtModel}
            data-tooltip="AI Assistant"
          >
            <Sparkles size={20} strokeWidth={1.5} />
          </button>
        )}
        {onSpaces && (
          <button
            className={ribbonBtnClass}
            onClick={onSpaces}
            data-tooltip="Spaces"
          >
            <SpacesIcon size={20} />
          </button>
        )}
        {onCanvas && (
          <button
            className={ribbonBtnClass}
            onClick={onCanvas}
            data-tooltip="Canvas (Ctrl+Shift+C)"
          >
            <Layout size={20} strokeWidth={1.5} />
          </button>
        )}
        {/* Plugin ribbon actions */}
        {pluginRibbonActions.map((action, i) => (
          <button
            key={`plugin-ribbon-${action.pluginId}-${i}`}
            className={`${ribbonBtnClass} oo-plugin-ribbon-btn`}
            onClick={(e) => action.callback(e.nativeEvent)}
            data-tooltip={action.title}
          >
            <span
              className={pluginRibbonIconClass}
              ref={(el) => renderPluginIcon(el, action)}
            />
          </button>
        ))}
      </div>
      {showSettingsButton && (
        <div className={ribbonGroupClass}>
          <button
            className={ribbonBtnClass}
            onClick={onSettings}
            data-tooltip="Preferences"
            aria-label="Preferences"
          >
            <Settings size={20} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
