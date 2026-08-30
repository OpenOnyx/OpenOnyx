/**
 * SplitPaneContainer -- Obsidian-style recursive split pane system
 *
 * Supports:
 *  - Recursive horizontal/vertical splits
 *  - Tab drag-and-drop between panes with drop zone indicators
 *  - Resizable dividers (direct DOM mutation, no React re-renders during drag)
 *  - Auto-cleanup of empty panes
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { X, Plus } from "lucide-react";
import type {
  Tab,
  PaneNode,
  PaneLeaf,
  PaneSplit,
  DropZone,
} from "../../types";

/* ─────── Helpers ─────── */

let _paneIdCounter = 0;
function genPaneId(): string {
  return `pane-${Date.now()}-${++_paneIdCounter}`;
}

export function createLeaf(tabs: Tab[], activeTabId?: string | null): PaneLeaf {
  return {
    type: "leaf",
    id: genPaneId(),
    tabs,
    activeTabId: activeTabId ?? (tabs.length > 0 ? tabs[0].id : null),
  };
}

export function createSplit(
  direction: "horizontal" | "vertical",
  first: PaneNode,
  second: PaneNode,
  ratio = 0.5,
): PaneSplit {
  return {
    type: "split",
    id: genPaneId(),
    direction,
    ratio,
    children: [first, second],
  };
}

/** Remove a tab from a pane tree, returning the new tree (or null if the tree is now empty). */
function removeTabFromTree(
  node: PaneNode,
  tabId: string,
): PaneNode | null {
  if (node.type === "leaf") {
    const newTabs = node.tabs.filter((t) => t.id !== tabId);
    if (newTabs.length === node.tabs.length) return node;
    if (newTabs.length === 0) return null;
    const newActive =
      node.activeTabId === tabId
        ? newTabs[0].id
        : node.activeTabId;
    return { ...node, tabs: newTabs, activeTabId: newActive };
  }

  const [left, right] = node.children;
  const newLeft = removeTabFromTree(left, tabId);
  const newRight = removeTabFromTree(right, tabId);

  if (newLeft === left && newRight === right) return node;
  if (!newLeft && !newRight) return null;
  if (!newLeft) return newRight;
  if (!newRight) return newLeft;

  return { ...node, children: [newLeft, newRight] };
}

/** Insert a tab into a specific leaf pane. */
function insertTabIntoLeaf(
  node: PaneNode,
  leafId: string,
  tab: Tab,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;
    // Avoid duplicates
    if (node.tabs.some((t) => t.id === tab.id)) {
      if (node.activeTabId === tab.id) return node;
      return { ...node, activeTabId: tab.id };
    }
    return {
      ...node,
      tabs: [...node.tabs, tab],
      activeTabId: tab.id,
    };
  }
  
  const newLeft = insertTabIntoLeaf(node.children[0], leafId, tab);
  const newRight = insertTabIntoLeaf(node.children[1], leafId, tab);
  if (newLeft === node.children[0] && newRight === node.children[1]) return node;
  
  return {
    ...node,
    children: [newLeft, newRight],
  };
}

/** Split a leaf pane by inserting a new tab at a drop zone edge. */
function splitLeaf(
  node: PaneNode,
  leafId: string,
  tab: Tab,
  zone: DropZone,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;

    if (zone === "center") {
      // Just add the tab to this pane
      if (node.tabs.some((t) => t.id === tab.id)) {
        if (node.activeTabId === tab.id) return node;
        return { ...node, activeTabId: tab.id };
      }
      return {
        ...node,
        tabs: [...node.tabs, tab],
        activeTabId: tab.id,
      };
    }

    const newLeaf = createLeaf([tab], tab.id);
    const direction: "horizontal" | "vertical" =
      zone === "left" || zone === "right" ? "horizontal" : "vertical";
    const first = zone === "left" || zone === "top" ? newLeaf : node;
    const second = zone === "left" || zone === "top" ? node : newLeaf;

    return createSplit(direction, first, second, 0.5);
  }

  const newLeft = splitLeaf(node.children[0], leafId, tab, zone);
  const newRight = splitLeaf(node.children[1], leafId, tab, zone);
  if (newLeft === node.children[0] && newRight === node.children[1]) return node;

  return {
    ...node,
    children: [newLeft, newRight],
  };
}

/** Update ratio of a specific split node. */
function updateSplitRatio(
  node: PaneNode,
  splitId: string,
  ratio: number,
): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    if (node.ratio === ratio) return node;
    return { ...node, ratio };
  }
  const newLeft = updateSplitRatio(node.children[0], splitId, ratio);
  const newRight = updateSplitRatio(node.children[1], splitId, ratio);
  if (newLeft === node.children[0] && newRight === node.children[1]) return node;
  return {
    ...node,
    children: [newLeft, newRight],
  };
}

/** Apply flat-tab add/remove onto the pane tree without dropping a replacement. */
function applyTabDeltaToTree(
  tree: PaneNode,
  addedTabs: Tab[],
  removedIds: string[],
  focusedLeafId: string | null,
): { tree: PaneNode; focusedLeafId: string } {
  let next = tree;
  const stillToAdd = [...addedTabs];
  let nextFocus = focusedLeafId || findFirstLeaf(tree).id;

  for (const id of removedIds) {
    const result = removeTabFromTree(next, id);
    if (!result) {
      next = createLeaf([...stillToAdd], stillToAdd[0]?.id ?? null);
      stillToAdd.length = 0;
      nextFocus = next.id;
    } else {
      next = result;
    }
  }

  for (const tab of stillToAdd) {
    if (!findLeafWithTab(next, tab.id)) {
      const targetLeaf = findLeafById(next, nextFocus) || findFirstLeaf(next);
      next = insertTabIntoLeaf(next, targetLeaf.id, tab);
    }
  }

  return { tree: next, focusedLeafId: nextFocus };
}

/** Replace a tab's identity in-place so a New tab can become a real file. */
function updateTabInTree(node: PaneNode, tabId: string, next: Tab): PaneNode {
  if (node.type === "leaf") {
    const idx = node.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return node;
    const nextTabs = node.tabs.slice();
    nextTabs[idx] = { ...nextTabs[idx], ...next, id: tabId };
    return { ...node, tabs: nextTabs, activeTabId: tabId };
  }
  const left = updateTabInTree(node.children[0], tabId, next);
  const right = updateTabInTree(node.children[1], tabId, next);
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

/** Set active tab in a specific leaf. */
function setActiveTabInLeaf(
  node: PaneNode,
  leafId: string,
  tabId: string,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;
    if (node.activeTabId === tabId) return node;
    return { ...node, activeTabId: tabId };
  }
  const newLeft = setActiveTabInLeaf(node.children[0], leafId, tabId);
  const newRight = setActiveTabInLeaf(node.children[1], leafId, tabId);
  if (newLeft === node.children[0] && newRight === node.children[1]) return node;
  return {
    ...node,
    children: [newLeft, newRight],
  };
}

/** Find the leaf that contains a given tab. */
function findLeafWithTab(node: PaneNode, tabId: string): PaneLeaf | null {
  if (node.type === "leaf") {
    return node.tabs.some((t) => t.id === tabId) ? node : null;
  }
  return (
    findLeafWithTab(node.children[0], tabId) ??
    findLeafWithTab(node.children[1], tabId)
  );
}

/** Find the first leaf (leftmost/topmost). */
function findFirstLeaf(node: PaneNode): PaneLeaf {
  if (node.type === "leaf") return node;
  return findFirstLeaf(node.children[0]);
}

/** Collect all tabs from the entire tree. */
export function collectAllTabs(node: PaneNode): Tab[] {
  if (node.type === "leaf") return node.tabs;
  return [
    ...collectAllTabs(node.children[0]),
    ...collectAllTabs(node.children[1]),
  ];
}

/** Get the active leaf (leaf whose tab is currently focused). */
function findLeafById(node: PaneNode, leafId: string): PaneLeaf | null {
  if (node.type === "leaf") return node.id === leafId ? node : null;
  return (
    findLeafById(node.children[0], leafId) ??
    findLeafById(node.children[1], leafId)
  );
}


import { DragCtx, DragContextData } from "../../context/DragContext";

const splitClasses = {
  root: "flex flex-1 w-full h-full overflow-hidden",
  container: "flex flex-1 w-full h-full overflow-hidden",
  child: "flex flex-col overflow-hidden min-w-0 min-h-0",
  leafPane: "flex flex-col flex-1 overflow-hidden min-w-0 min-h-0 relative",
  leafContent: "flex flex-col flex-1 overflow-hidden relative",
  dividerBase: "shrink-0 bg-(--divider-color) z-10 relative hover:bg-(--accent-primary) after:content-[''] after:absolute after:z-[11]",
  dividerHorizontal: "w-px cursor-col-resize after:top-0 after:bottom-0 after:-left-[3px] after:-right-[3px]",
  dividerVertical: "h-px cursor-row-resize after:left-0 after:right-0 after:-top-[3px] after:-bottom-[3px]",
  dropOverlay: "absolute inset-0 z-50 pointer-events-none",
  dropZoneBase: "absolute pointer-events-auto",
  dropZones: {
    left: "left-0 top-0 w-1/4 h-full",
    right: "right-0 top-0 w-1/4 h-full",
    top: "left-1/4 top-0 w-1/2 h-1/4",
    bottom: "left-1/4 bottom-0 w-1/2 h-1/4",
    center: "left-1/4 top-1/4 w-1/2 h-1/2",
  } satisfies Record<DropZone, string>,
  dropIndicatorBase: "absolute bg-(--accent-color) opacity-[0.18] rounded border-2 border-(--accent-color) pointer-events-none transition-all duration-75",
  dropIndicators: {
    left: "left-1 top-1 w-[calc(50%_-_8px)] h-[calc(100%_-_8px)]",
    right: "right-1 top-1 w-[calc(50%_-_8px)] h-[calc(100%_-_8px)]",
    top: "left-1 top-1 w-[calc(100%_-_8px)] h-[calc(50%_-_8px)]",
    bottom: "left-1 bottom-1 w-[calc(100%_-_8px)] h-[calc(50%_-_8px)]",
    center: "left-1 top-1 w-[calc(100%_-_8px)] h-[calc(100%_-_8px)]",
  } satisfies Record<DropZone, string>,
};

/* ─────── Drop Zone Overlay ─────── */

function DropZoneOverlay({
  onDrop,
  leafId,
}: {
  onDrop: (leafId: string, zone: DropZone) => void;
  leafId: string;
}) {
  const { dragCtx } = React.useContext(DragCtx);
  const [activeZone, setActiveZone] = useState<DropZone | null>(null);

  if (!dragCtx) return null;

  const handleDragOver = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setActiveZone(zone);
  };

  const handleDragLeave = () => {
    setActiveZone(null);
  };

  const handleDrop = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault();
    setActiveZone(null);
    onDrop(leafId, zone);
  };

  return (
    <div className={splitClasses.dropOverlay}>
      {(["left", "right", "top", "bottom", "center"] as DropZone[]).map(
        (zone) => (
          <div
            key={zone}
            className={`${splitClasses.dropZoneBase} ${splitClasses.dropZones[zone]}`}
            onDragOver={(e) => handleDragOver(e, zone)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, zone)}
          />
        ),
      )}
      {activeZone && (
        <div className={`${splitClasses.dropIndicatorBase} ${splitClasses.dropIndicators[activeZone]}`} />
      )}
    </div>
  );
}


/* ─────── Leaf Pane Tab Bar ─────── */




/* ─────── Split Divider ─────── */

function SplitDivider({
  splitId,
  direction,
  onRatioChange,
}: {
  splitId: string;
  direction: "horizontal" | "vertical";
  onRatioChange: (splitId: string, ratio: number) => void;
}) {
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const parentEl = dividerRef.current?.parentElement;
      if (!parentEl) return;

      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.classList.add("is-dragging");

      const onMove = (ev: MouseEvent) => {
        const rect = parentEl.getBoundingClientRect();
        let ratio: number;
        if (direction === "horizontal") {
          ratio = (ev.clientX - rect.left) / rect.width;
        } else {
          ratio = (ev.clientY - rect.top) / rect.height;
        }
        ratio = Math.max(0.15, Math.min(0.85, ratio));

        // Direct DOM mutation for performance
        const firstChild = parentEl.children[0] as HTMLElement;
        const lastChild = parentEl.children[2] as HTMLElement;
        if (firstChild && lastChild) {
          if (direction === "horizontal") {
            firstChild.style.width = `${ratio * 100}%`;
            lastChild.style.width = `${(1 - ratio) * 100}%`;
          } else {
            firstChild.style.height = `${ratio * 100}%`;
            lastChild.style.height = `${(1 - ratio) * 100}%`;
          }
        }
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "default";
        document.body.classList.remove("is-dragging");

        // Commit final ratio to React state
        const rect = parentEl.getBoundingClientRect();
        let ratio: number;
        if (direction === "horizontal") {
          ratio = (ev.clientX - rect.left) / rect.width;
        } else {
          ratio = (ev.clientY - rect.top) / rect.height;
        }
        ratio = Math.max(0.15, Math.min(0.85, ratio));
        onRatioChange(splitId, ratio);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [splitId, direction, onRatioChange],
  );

  return (
    <div
      ref={dividerRef}
      className={`${splitClasses.dividerBase} ${direction === "horizontal" ? splitClasses.dividerHorizontal : splitClasses.dividerVertical}`}
      onMouseDown={handleMouseDown}
    />
  );
}


/* ─────── Pane Renderer ─────── */

interface PaneRendererProps {
  node: PaneNode;
  renderContent: (leaf: PaneLeaf) => React.ReactNode;
  onDrop: (leafId: string, zone: DropZone) => void;
  onRatioChange: (splitId: string, ratio: number) => void;
  focusedLeafId: string | null;
  onFocusLeaf: (leafId: string) => void;
}

function PaneRenderer({
  node,
  renderContent,
  onDrop,
  onRatioChange,
  focusedLeafId,
  onFocusLeaf,
}: PaneRendererProps) {
  if (node.type === "leaf") {
    const isFocused = node.id === focusedLeafId;
    return (
      <div
        className={splitClasses.leafPane}
        onClick={() => onFocusLeaf(node.id)}
      >
        <div className={splitClasses.leafContent}>
          {renderContent(node)}
          <DropZoneOverlay onDrop={onDrop} leafId={node.id} />
        </div>
      </div>
    );
  }

  // Split node
  const isHorizontal = node.direction === "horizontal";

  return (
    <div
      className={splitClasses.container}
      style={{
        flexDirection: isHorizontal ? "row" : "column",
      }}
    >
      <div
        className={splitClasses.child}
        style={
          isHorizontal
            ? { width: `${node.ratio * 100}%` }
            : { height: `${node.ratio * 100}%` }
        }
      >
        <PaneRenderer
          node={node.children[0]}
          renderContent={renderContent}
          onDrop={onDrop}
          onRatioChange={onRatioChange}
          focusedLeafId={focusedLeafId}
          onFocusLeaf={onFocusLeaf}
        />
      </div>
      <SplitDivider
        splitId={node.id}
        direction={node.direction}
        onRatioChange={onRatioChange}
      />
      <div
        className={splitClasses.child}
        style={
          isHorizontal
            ? { width: `${(1 - node.ratio) * 100}%` }
            : { height: `${(1 - node.ratio) * 100}%` }
        }
      >
        <PaneRenderer
          node={node.children[1]}
          renderContent={renderContent}
          onDrop={onDrop}
          onRatioChange={onRatioChange}
          focusedLeafId={focusedLeafId}
          onFocusLeaf={onFocusLeaf}
        />
      </div>
    </div>
  );
}


/* ─────── Main Export ─────── */

interface SplitPaneContainerProps {
  paneTree: PaneNode;
  onPaneTreeChange: (tree: PaneNode) => void;
  renderContent: (leaf: PaneLeaf) => React.ReactNode;
  onNewTab: () => void;
  onTabClose: (tabId: string) => void;
  onTabSelect: (leafId: string, tabId: string) => void;
  focusedLeafId: string | null;
  onFocusLeaf: (leafId: string) => void;
}

export function SplitPaneContainer({
  paneTree,
  onPaneTreeChange,
  renderContent,
  onNewTab,
  onTabClose,
  onTabSelect,
  focusedLeafId,
  onFocusLeaf,
}: SplitPaneContainerProps) {
  const { dragCtx, setDragCtx } = React.useContext(DragCtx);

  const handleDrop = useCallback(
    (leafId: string, zone: DropZone) => {
      if (!dragCtx) return;

      let tree = paneTree;
      let finalTab: Tab;

      if (dragCtx.type === 'tab' && dragCtx.tab) {
        finalTab = dragCtx.tab;
        // Remove tab from source
        const newTree = removeTabFromTree(paneTree, finalTab.id);
        if (!newTree) {
          // Tree became empty -- recreate with just this tab
          tree = createLeaf([finalTab], finalTab.id);
          onPaneTreeChange(tree);
          setDragCtx(null);
          return;
        }
        tree = newTree;
      } else if (dragCtx.type === 'plugin' && dragCtx.pluginView) {
        // Create a synthetic tab for the plugin
        finalTab = {
          id: `plugin-${dragCtx.pluginView.viewType}`,
          path: `__plugin__.${dragCtx.pluginView.viewType}`,
          name: dragCtx.pluginView.displayText,
          isModified: false,
        };
      } else {
        return;
      }

      // Check if target leaf still exists after removal
      const targetLeaf = findLeafById(tree, leafId);
      if (!targetLeaf) {
        // Target leaf was removed (was the source leaf and it's now empty)
        // Insert into first available leaf
        const firstLeaf = findFirstLeaf(tree);
        tree = insertTabIntoLeaf(tree, firstLeaf.id, finalTab);
      } else {
        // Split or insert at the target
        tree = splitLeaf(tree, leafId, finalTab, zone);
      }

      onPaneTreeChange(tree);
      setDragCtx(null);
    },
    [dragCtx, paneTree, onPaneTreeChange, setDragCtx],
  );

  const handleRatioChange = useCallback(
    (splitId: string, ratio: number) => {
      onPaneTreeChange(updateSplitRatio(paneTree, splitId, ratio));
    },
    [paneTree, onPaneTreeChange],
  );

  const handleTabReorder = useCallback(
    (draggedId: string, targetId: string, insertBefore: boolean, dragCtxData: DragContextData | null) => {
      let tree = paneTree;
      let tabToMove: Tab | null = null;
      
      if (dragCtxData?.type === 'plugin' && dragCtxData.pluginView) {
        tabToMove = {
          id: `plugin-${dragCtxData.pluginView.viewType}`,
          path: `__plugin__.${dragCtxData.pluginView.viewType}`,
          name: dragCtxData.pluginView.displayText,
          isModified: false,
        };
      }

      if (tabToMove) {
        const insertNewTab = (n: PaneNode): PaneNode => {
          if (n.type === "leaf") {
            const targetIndex = n.tabs.findIndex(t => t.id === targetId);
            if (targetIndex !== -1) {
              const newTabs = [...n.tabs];
              newTabs.splice(insertBefore ? targetIndex : targetIndex + 1, 0, tabToMove!);
              return { ...n, tabs: newTabs, activeTabId: tabToMove!.id };
            }
            return n;
          }
          const newLeft = insertNewTab(n.children[0]);
          if (newLeft !== n.children[0]) return { ...n, children: [newLeft, n.children[1]] };
          const newRight = insertNewTab(n.children[1]);
          if (newRight !== n.children[1]) return { ...n, children: [n.children[0], newRight] };
          return n;
        };
        tree = insertNewTab(tree);
      } else {
        tree = moveTabInTree(tree, draggedId, targetId, insertBefore);
      }
      onPaneTreeChange(tree);
      setDragCtx(null);
    },
    [paneTree, onPaneTreeChange, setDragCtx]
  );

  const handleTabSelect = useCallback(
    (leafId: string, tabId: string) => {
      onPaneTreeChange(setActiveTabInLeaf(paneTree, leafId, tabId));
      onTabSelect(leafId, tabId);
    },
    [paneTree, onPaneTreeChange, onTabSelect],
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      const newTree = removeTabFromTree(paneTree, tabId);
      if (!newTree) {
        // All tabs closed -- create empty leaf
        onPaneTreeChange(createLeaf([]));
      } else {
        onPaneTreeChange(newTree);
      }
      onTabClose(tabId);
    },
    [paneTree, onPaneTreeChange, onTabClose],
  );

  return (
    <div
      className={splitClasses.root}
      onDragOver={(e) => e.preventDefault()}
    >
      <PaneRenderer
        node={paneTree}
        renderContent={renderContent}
        onDrop={handleDrop}
        onRatioChange={handleRatioChange}
        focusedLeafId={focusedLeafId}
        onFocusLeaf={onFocusLeaf}
      />
    </div>
  );
}

/* Re-export helpers for App.tsx integration */
export {
  removeTabFromTree,
  insertTabIntoLeaf,
  moveTabInTree,
  splitLeaf,
  findLeafWithTab,
  findFirstLeaf,
  findLeafById,
  setActiveTabInLeaf,
  updateTabInTree,
  applyTabDeltaToTree,
};

function moveTabInTree(
  node: PaneNode,
  draggedTabId: string,
  targetTabId: string,
  insertBefore: boolean
): PaneNode {
  // First, find the dragged tab and remove it
  let draggedTab: Tab | null = null;
  
  const extractTab = (n: PaneNode): PaneNode => {
    if (n.type === "leaf") {
      const tab = n.tabs.find(t => t.id === draggedTabId);
      if (tab) {
        draggedTab = tab;
        return { ...n, tabs: n.tabs.filter(t => t.id !== draggedTabId) };
      }
      return n;
    }
    const newLeft = extractTab(n.children[0]);
    const newRight = extractTab(n.children[1]);
    if (newLeft === n.children[0] && newRight === n.children[1]) return n;
    return { ...n, children: [newLeft, newRight] };
  };
  
  let treeWithoutTab = extractTab(node);
  if (!draggedTab) return node; // Tab not found

  // Now insert the dragged tab relative to the target tab
  const insertTab = (n: PaneNode): PaneNode => {
    if (n.type === "leaf") {
      const targetIndex = n.tabs.findIndex(t => t.id === targetTabId);
      if (targetIndex !== -1) {
        const newTabs = [...n.tabs];
        newTabs.splice(insertBefore ? targetIndex : targetIndex + 1, 0, draggedTab!);
        return { ...n, tabs: newTabs, activeTabId: draggedTab!.id };
      }
      return n;
    }
    const newLeft = insertTab(n.children[0]);
    if (newLeft !== n.children[0]) return { ...n, children: [newLeft, n.children[1]] };
    const newRight = insertTab(n.children[1]);
    if (newRight !== n.children[1]) return { ...n, children: [n.children[0], newRight] };
    return n;
  };
  
  return insertTab(treeWithoutTab);
}
