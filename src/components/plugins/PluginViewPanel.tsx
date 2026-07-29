/**
 * Plugin View Panel — Right Sidebar Host
 *
 * Renders plugin views (like Calendar, Kanban, etc.) in a right sidebar panel.
 * Each plugin view's `containerEl` is mounted into the DOM via a ref.
 */

import React, { useEffect, useRef, useState, useContext } from 'react';
import { getPluginScopeClass } from '../../lib/pluginStyles';
import { DragCtx } from '../../context/DragContext';

interface PluginViewInfo {
  viewType: string;
  displayText: string;
  icon: string;
  containerEl: HTMLElement;
  pluginId?: string;
}

interface PluginViewPanelProps {
  views: PluginViewInfo[];
  onClose: (viewType: string) => void;
  isMainView?: boolean;
  fill?: boolean;
  width?: number;
}

const pluginTabsClass = "flex min-h-9 shrink-0 items-stretch overflow-hidden border-b border-(--divider-color) bg-(--bg-primary)";
const pluginTabClass = "group relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 border-0 border-r border-(--divider-color) bg-transparent px-3 text-[11px] font-medium text-(--text-muted) transition-all duration-150 last:border-r-0 hover:bg-(--bg-hover) hover:text-(--text-secondary)";
const pluginTabActiveClass = "bg-(--bg-secondary) text-(--text-primary) after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-[var(--accent-color,var(--oo-accent,#E8A84A))] after:content-['']";
const pluginTabTextClass = "overflow-hidden text-ellipsis whitespace-nowrap";
const pluginTabCloseClass = "ml-0.5 text-sm leading-none opacity-30 transition-opacity duration-150 group-hover:opacity-80 hover:text-(--danger) hover:opacity-100";

export function PluginViewPanel({ views, onClose, isMainView, fill, width = 300 }: PluginViewPanelProps) {
  const [activeViewType, setActiveViewType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { setDragCtx } = useContext(DragCtx);

  // Auto-select first view if none active
  useEffect(() => {
    if (views.length > 0 && (!activeViewType || !views.find(v => v.viewType === activeViewType))) {
      setActiveViewType(views[0].viewType);
    }
  }, [views, activeViewType]);

  const activeView = views.find(v => v.viewType === activeViewType);

  // Mount the plugin's containerEl into our React container
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeView) return;

    // Clear previous content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Apply plugin CSS scope class
    if (activeView.pluginId) {
      const scopeClass = getPluginScopeClass(activeView.pluginId);
      activeView.containerEl.classList.add(scopeClass);
    }

    // Mount the plugin's DOM element
    container.appendChild(activeView.containerEl);

    // Notify the view that it has been resized — Excalidraw uses this to
    // initialize its canvas dimensions. Without it, the canvas is 0x0.
    const notifyResize = () => {
      // Access the leaf's view via the workspace to call onResize
      const workspace = (window as any).__oo_app?.workspace;
      if (workspace) {
        const leaves = workspace.getLeavesOfType(activeView.viewType);
        for (const leaf of leaves) {
          leaf.view?.onResize?.();
        }
      }
    };
    // Delay slightly to ensure DOM layout has settled
    const resizeTimer = setTimeout(notifyResize, 50);

    // Also watch for container size changes
    let resizeObserver: ResizeObserver | null = null;
    try {
      resizeObserver = new ResizeObserver(() => notifyResize());
      resizeObserver.observe(container);
    } catch { /* ResizeObserver may not be available in all environments */ }

    return () => {
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      // Don't destroy the element on unmount — just detach it
      if (activeView.containerEl.parentNode === container) {
        container.removeChild(activeView.containerEl);
      }
    };
  }, [activeView]);

  if (views.length === 0) return null;
  const showTabBar = !isMainView && !(fill && views.length === 1) && views.length > 0;

  return (
    <div
      className={`plugin-view-panel ${isMainView ? 'is-main-view' : ''}`}
      style={isMainView || fill ? {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
      } : {
        width: 'var(--right-sidebar-width, 300px)',
        minWidth: '200px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary, #1a1a2e)',
        overflow: 'hidden',
        flexShrink: 0,
        paddingTop: '0',
      }}
    >
      {/* Tab bar for multiple views (hidden in main view) */}
      {showTabBar && (
        <div className={pluginTabsClass}>
          {views.map((view) => (
            <button
              key={view.viewType}
              className={`${pluginTabClass} ${view.viewType === activeViewType ? pluginTabActiveClass : ''}`}
              onClick={() => setActiveViewType(view.viewType)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragCtx({
                  type: 'plugin',
                  pluginView: {
                    viewType: view.viewType,
                    displayText: view.displayText
                  }
                });
              }}
              onDragEnd={() => setDragCtx(null)}
            >
              <span className={pluginTabTextClass}>{view.displayText}</span>
              <span
                className={pluginTabCloseClass}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(view.viewType);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      {/* View content — plugin's DOM is mounted here */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}
