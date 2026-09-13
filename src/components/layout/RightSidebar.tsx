import React from "react";
import { BacklinksPanel } from "../panels/BacklinksPanel";
import { OutgoingLinksPanel } from "../panels/OutgoingLinksPanel";
import { OutlinePane } from "../panels/OutlinePane";
import { UnlinkedMentionsPanel } from "../panels/UnlinkedMentionsPanel";
import { getPluginScopeClass } from "../../lib/pluginStyles";
import type { Theme, FileEntry } from "../../types";

const AIPage = React.lazy(() => import("../ai/AIPage").then(m => ({ default: m.AIPage })));

export type RightSidebarTabType = "backlinks" | "outgoing" | "outline" | "ai" | string;

interface PluginViewHostProps {
  view: { containerEl: HTMLElement; pluginId?: string };
}

function PluginViewHost({ view }: PluginViewHostProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !view) return;

    // Clear previous content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Apply plugin CSS scope class
    if (view.pluginId) {
      const scopeClass = getPluginScopeClass(view.pluginId);
      view.containerEl.classList.add(scopeClass);
    }

    // Mount the plugin's DOM element
    container.appendChild(view.containerEl);

    // Notify the view of resize so canvas-based plugins initialize properly
    const notifyResize = () => {
      (view as any).onResize?.();
    };
    const resizeTimer = setTimeout(notifyResize, 50);

    return () => {
      clearTimeout(resizeTimer);
      // Don't destroy the element on unmount — just detach it
      if (view.containerEl.parentNode === container) {
        container.removeChild(view.containerEl);
      }
    };
  }, [view]);

  return <div ref={containerRef} className="h-full w-full overflow-auto" />;
}

interface RightSidebarProps {
  activeTab: RightSidebarTabType;
  currentContent: string;
  allNoteNames: { name: string; path: string }[];
  handleLinkClick: (name: string, heading?: string) => void;
  backlinks: string[];
  openFile: (path: string, mode?: any) => void | Promise<void>;
  activeFilePath: string | null;
  activeFileName: string;
  showUnlinkedMentions?: boolean;
  width: number;
  vaultPath?: string | null;
  theme?: Theme;
  fileTree?: FileEntry[];
  onClose?: () => void;
  rightPluginViews?: Array<{
    viewType: string;
    displayText: string;
    icon: string;
    containerEl: HTMLElement;
    side: "left" | "right" | "main";
    pluginId?: string;
  }>;
  onClosePluginView?: (viewType: string) => void;
}

export function RightSidebar({
  activeTab,
  currentContent,
  allNoteNames,
  handleLinkClick,
  backlinks,
  openFile,
  activeFilePath,
  activeFileName,
  showUnlinkedMentions = true,
  width,
  vaultPath,
  theme,
  fileTree = [],
  onClose,
  rightPluginViews = [],
  onClosePluginView,
}: RightSidebarProps) {
  const activePluginView = rightPluginViews.find((v) => v.viewType === activeTab);

  return (
    <div
      className="right-sidebar-panel flex flex-col h-full bg-[var(--bg-tree,var(--bg-secondary))] select-none overflow-hidden"
      style={{ width: `${width}px` }}
    >
      {/* Active Tab Panel Body */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === "outline" && (
          <OutlinePane
            content={currentContent}
            onHeadingClick={(line) => {
              document.dispatchEvent(
                new CustomEvent("editor:goto-line", { detail: line })
              );
            }}
            visible={true}
          />
        )}

        {activeTab === "outgoing" && (
          <OutgoingLinksPanel
            content={currentContent}
            allNoteNames={allNoteNames}
            activeFileName={activeFileName}
            onLinkClick={handleLinkClick}
            visible={true}
          />
        )}

        {activeTab === "backlinks" && (
          <div className="flex flex-col h-full overflow-y-auto">
            {/* Linked Mentions */}
            <div className="shrink-0">
              <BacklinksPanel
                backlinks={backlinks}
                currentNoteName={activeFileName}
                onBacklinkClick={async (path, line) => {
                  await openFile(path);
                  if (line) {
                    setTimeout(() => {
                      document.dispatchEvent(
                        new CustomEvent("editor:goto-line", { detail: line })
                      );
                    }, 150);
                  }
                }}
              />
            </div>
            {showUnlinkedMentions && (
              <div className="flex-1 border-t border-(--border-subtle)">
                <UnlinkedMentionsPanel
                  currentNotePath={activeFilePath}
                  currentNoteName={activeFileName}
                  visible={true}
                  onNavigate={async (path, line) => {
                    await openFile(path);
                    if (line) {
                      setTimeout(() => {
                        document.dispatchEvent(
                          new CustomEvent("editor:goto-line", { detail: line })
                        );
                      }, 150);
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "ai" && vaultPath && (
          <div className="flex flex-col h-full overflow-hidden">
            <React.Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">Loading AI...</div>}>
              <AIPage
                vaultPath={vaultPath}
                theme={theme || "dark"}
                fileTree={fileTree}
                activeNotePath={activeFilePath}
                onOpenNote={(path) => {
                  void openFile(path);
                }}
                onClose={() => onClose?.()}
                isFullScreen={false}
                onToggleFullScreen={() => {}}
              />
            </React.Suspense>
          </div>
        )}

        {activePluginView && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <PluginViewHost view={activePluginView} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
