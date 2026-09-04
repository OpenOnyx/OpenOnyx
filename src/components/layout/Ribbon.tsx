import React, { useEffect, useRef } from "react";
import {
  Network,
  Calendar,
  Sparkles,
  Layout,
  Settings,
  PanelLeft,
  Search,
  Bookmark,
  Shield,
  Home,
} from "lucide-react";
import type { PluginRibbonAction } from '../../types/plugin';
import { setIcon } from '../../lib/obsidian-api/utils';
import { SpacesIcon } from "../spaces/SpacesIcon";

/** Onyx-style three-leaf logo mark */
function OnyxMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M24 6c-1.2 6.5-5.2 11.2-12 13.5 4.8 1.4 9.2 5.2 11.2 11.5C25.2 24.7 29.6 20.9 34.4 19.5 27.6 17.2 25.2 12.5 24 6z"
        fill="#f59e0b"
      />
      <path
        d="M24 18c-1.4 7.2-6.2 12.4-14 14.8 5.6 1.6 10.6 5.8 12.8 12.7 2.2-6.9 7.2-11.1 12.8-12.7C30.2 30.4 25.4 25.2 24 18z"
        fill="#22c55e"
        opacity="0.95"
      />
      <path
        d="M24 26c-1.1 5.6-4.8 9.6-10.8 11.6 4.4 1.2 8.3 4.5 10 10 1.7-5.5 5.6-8.8 10-10C28.8 35.6 25.1 31.6 24 26z"
        fill="#ef4444"
        opacity="0.95"
      />
    </svg>
  );
}

const ribbonRootClass =
  "ribbon onyx-launcher flex flex-col justify-between items-center w-[var(--ribbon-width)] bg-[var(--bg-launcher,var(--bg-secondary))] border-r border-[var(--divider-color)] shrink-0 pt-2.5 pb-3";
const ribbonGroupClass = "flex flex-col items-center gap-0.5";
const ribbonBtnClass =
  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const ribbonBtnActiveClass =
  "bg-[var(--bg-active)] text-[var(--text-primary)]";
const ribbonLogoClass =
  "mb-2 flex h-10 w-10 cursor-default items-center justify-center";
const pluginRibbonIconClass =
  "flex h-5 w-5 items-center justify-center text-current [&_.svg-icon]:block [&_.svg-icon]:h-5 [&_.svg-icon]:w-5 [&_.svg-icon]:shrink-0 [&_.svg-icon]:text-current [&_.svg-icon]:[stroke-width:1.5]";

interface RibbonProps {
  onToggleExplorer?: () => void;
  onHome?: () => void;
  onGraph: () => void;
  onSettings: () => void;
  onDailyNote?: () => void;
  onThoughtModel?: () => void;
  onSpaces?: () => void;
  onCanvas?: () => void;
  onSearch?: () => void;
  onBookmarks?: () => void;
  pluginRibbonActions?: PluginRibbonAction[];
  showSettingsButton?: boolean;
  hasWallpaper?: boolean;
  activeLeftPluginView?: { pluginId?: string; viewType?: string } | null;
  leftPluginViews?: Array<{ viewType: string; displayText: string; icon: string; pluginId?: string }>;
  onSelectLeftPluginView?: (viewType: string) => void;
}

export function Ribbon({
  onGraph,
  onToggleExplorer,
  onHome,
  onSettings,
  onDailyNote,
  onThoughtModel,
  onSpaces,
  onCanvas,
  onSearch,
  onBookmarks,
  pluginRibbonActions = [],
  showSettingsButton = false,
  hasWallpaper = false,
  activeLeftPluginView = null,
  leftPluginViews = [],
  onSelectLeftPluginView,
}: RibbonProps) {
  const ribbonRootRef = useRef<HTMLDivElement | null>(null);
  const ribbonItemsRef = useRef<HTMLDivElement | null>(null);
  const isMac = typeof window !== "undefined" && navigator.platform.toLowerCase().includes("mac");

  const renderPluginIcon = (el: HTMLSpanElement | null, action: PluginRibbonAction) => {
    if (!el) return;
    setIcon(el, action.icon);
    const svg = el.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.style.width = "18px";
      svg.style.height = "18px";
      svg.style.strokeWidth = "1.6";
      svg.style.color = "currentColor";
      svg.style.display = "block";
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
      style={{
        ...isMac ? { paddingTop: '32px' } : {},
        ...(hasWallpaper ? {} : { backgroundColor: 'var(--bg-launcher, var(--bg-secondary))' })
      }}
    >
      <div className={ribbonGroupClass} ref={ribbonItemsRef}>


        {onToggleExplorer && (
          <button
            className={`${ribbonBtnClass} ${ribbonBtnActiveClass}`}
            onClick={onToggleExplorer}
            data-tooltip="Toggle sidebar"
          >
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
        )}

        {onHome && (
          <button
            className={ribbonBtnClass}
            onClick={onHome}
            data-tooltip="Home"
          >
            <Home size={18} strokeWidth={1.6} />
          </button>
        )}

        {onSearch && (
          <button
            className={ribbonBtnClass}
            onClick={onSearch}
            data-tooltip="Search"
          >
            <Search size={18} strokeWidth={1.6} />
          </button>
        )}

        {onDailyNote && (
          <button
            className={ribbonBtnClass}
            onClick={onDailyNote}
            data-tooltip="Daily Note"
          >
            <Calendar size={18} strokeWidth={1.6} />
          </button>
        )}

        <button
          className={ribbonBtnClass}
          onClick={onGraph}
          data-tooltip="Graph View (Ctrl+G)"
        >
          <Network size={18} strokeWidth={1.6} />
        </button>

        {onThoughtModel && (
          <button
            className={ribbonBtnClass}
            onClick={onThoughtModel}
            data-tooltip="AI Assistant"
          >
            <Sparkles size={18} strokeWidth={1.6} />
          </button>
        )}

        {onSpaces && (
          <button
            className={ribbonBtnClass}
            onClick={onSpaces}
            data-tooltip="Spaces"
          >
            <SpacesIcon size={18} />
          </button>
        )}

        {onCanvas && (
          <button
            className={ribbonBtnClass}
            onClick={onCanvas}
            data-tooltip="Canvas (Ctrl+Shift+C)"
          >
            <Layout size={18} strokeWidth={1.6} />
          </button>
        )}

        {onBookmarks && (
          <button
            className={ribbonBtnClass}
            onClick={onBookmarks}
            data-tooltip="Bookmarks"
          >
            <Bookmark size={18} strokeWidth={1.6} />
          </button>
        )}


        {pluginRibbonActions.map((action, i) => (
          <button
            key={`plugin-ribbon-${action.pluginId}-${i}`}
            className={`${ribbonBtnClass} oo-plugin-ribbon-btn`}
            onClick={(e) => {
              if (action.el) {
                action.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              } else {
                action.callback(e.nativeEvent);
              }
            }}
            onContextMenu={(e) => {
              if (action.el) {
                action.el.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: e.clientX,
                  clientY: e.clientY,
                }));
              }
            }}
            data-tooltip={action.title}
            aria-label={action.title}
          >
            <span
              className={pluginRibbonIconClass}
              ref={(el) => renderPluginIcon(el, action)}
            />
          </button>
        ))}

        {leftPluginViews
          .filter((view) => !pluginRibbonActions.some((a) => a.pluginId === view.pluginId))
          .map((view) => {
            const isActive = activeLeftPluginView?.viewType === view.viewType;
            return (
              <button
                key={`plugin-view-${view.viewType}`}
                className={`${ribbonBtnClass} oo-plugin-ribbon-btn ${isActive ? ribbonBtnActiveClass : ""}`}
                onClick={() => onSelectLeftPluginView?.(view.viewType)}
                data-tooltip={view.displayText}
                aria-label={view.displayText}
              >
                <span
                  className={pluginRibbonIconClass}
                  ref={(el) =>
                    renderPluginIcon(el, {
                      pluginId: view.pluginId,
                      icon: view.icon,
                      title: view.displayText,
                      callback: () => {},
                    } as any)
                  }
                />
              </button>
            );
          })}
      </div>

      <div className={ribbonGroupClass}>
        {(showSettingsButton || true) && (
          <button
            className={ribbonBtnClass}
            onClick={onSettings}
            data-tooltip="Settings"
            aria-label="Settings"
          >
            <Settings size={18} strokeWidth={1.6} />
          </button>
        )}
      </div>
    </div>
  );
}
