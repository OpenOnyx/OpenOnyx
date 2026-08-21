import { useCallback } from "react";
import { Tab, PaneNode, PaneLeaf } from "../types";
import { LocalGroup, localDB } from "../lib/localdb";
import { getAPI } from "../utils/api";
import { generateId, getNoteName } from "../utils/helpers";
import {
  collectAllTabs,
  findLeafById,
  findFirstLeaf,
  insertTabIntoLeaf,
  findLeafWithTab,
  setActiveTabInLeaf,
  removeTabFromTree,
} from "../components/layout/SplitPaneContainer";
import {
  getUngroupedTabsToPreserve,
} from "../utils/tabGroups";

const api = getAPI();
const GRAPH_TAB_PATH = "__graph__";
const SPACES_TAB_PATH = "__spaces__";
const isCanvasFile = (path: string) => path.toLowerCase().endsWith(".canvas");

interface LayoutGroupsOptions {
  vaultPath: string | null;
  groups: LocalGroup[];
  setGroups: React.Dispatch<React.SetStateAction<LocalGroup[]>>;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  paneTree: PaneNode;
  setPaneTree: React.Dispatch<React.SetStateAction<PaneNode>>;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  focusedLeafId: string;
  setFocusedLeafId: (id: string) => void;
  tabs: Tab[];
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  collapsedGroupIds: Set<string>;
  setCollapsedGroupIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (unsaved: boolean) => void;
  setCanvasFilePath: (path: string | null) => void;
  setCurrentContent: (content: string) => void;
  setBacklinks: (backlinks: any[]) => void;
  setGroupModalData: (data: any) => void;
  groupModalData: any;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  scrollCursorCacheRef: React.MutableRefObject<any>;
  skipTabSyncRef: React.MutableRefObject<boolean>;
}

export function useLayoutGroups({
  vaultPath,
  groups,
  setGroups,
  activeGroupId,
  setActiveGroupId,
  paneTree,
  setPaneTree,
  activeTabId,
  setActiveTabId,
  focusedLeafId,
  setFocusedLeafId,
  tabs,
  setTabs,
  collapsedGroupIds,
  setCollapsedGroupIds,
  hasUnsavedChanges,
  setHasUnsavedChanges,
  setCanvasFilePath,
  setCurrentContent,
  setBacklinks,
  setGroupModalData,
  groupModalData,
  showToast,
  scrollCursorCacheRef,
  skipTabSyncRef,
}: LayoutGroupsOptions) {

  const handleOpenCreateGroupModal = useCallback(() => {
    setGroupModalData({
      type: "create",
      title: "Save Current Layout as Group",
      initialName: "",
      initialColor: "#3b82f6",
    });
  }, [setGroupModalData]);

  const handleAddTabToGroup = useCallback(
    async (tabId: string, groupId: string | null) => {
      // Find the tab in tabs
      const tabIndex = tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return;

      const targetTab = tabs[tabIndex];
      const oldGroupId = targetTab.groupId;

      // Update in memory tab state
      const nextTabs = tabs.map((t) =>
        t.id === tabId ? { ...t, groupId: groupId || undefined } : t
      );
      setTabs(nextTabs);

      // Update in memory tree state
      const updateTreeGroupId = (node: PaneNode): PaneNode => {
        if (node.type === "leaf") {
          return {
            ...node,
            tabs: node.tabs.map((t) =>
              t.id === tabId ? { ...t, groupId: groupId || undefined } : t
            ),
          };
        }
        return {
          ...node,
          children: [
            updateTreeGroupId(node.children[0]),
            updateTreeGroupId(node.children[1]),
          ],
        };
      };
      const nextTree = updateTreeGroupId(paneTree);
      setPaneTree(nextTree);

      // Update database and memory for groups
      if (groupId) {
        const group = groups.find((g) => g.id === groupId);
        if (group) {
          // If the group is active, layout tree has the tab, so we just auto-save or update group state
          if (activeGroupId === groupId) {
            const updatedGroup: LocalGroup = {
              ...group,
              updated_at: new Date().toISOString(),
              layout_state: {
                ...group.layout_state,
                paneTree: nextTree,
                activeTabId,
                focusedLeafId,
              },
            };
            try {
              await localDB.putGroup(updatedGroup);
              setGroups((prev) =>
                prev.map((g) => (g.id === groupId ? updatedGroup : g))
              );
            } catch (err) {
              console.error("Failed to add tab to active group:", err);
            }
          } else {
            // Group is not active: add the tab into the group's saved layout paneTree
            let savedPaneTree = group.layout_state.paneTree;
            // Check if tab already exists in saved layout
            const exists = collectAllTabs(savedPaneTree).some((t) => t.id === tabId);
            if (!exists) {
              const fileTab = { ...targetTab, groupId };
              const targetLeaf =
                findLeafById(savedPaneTree, group.layout_state.focusedLeafId) ||
                findFirstLeaf(savedPaneTree);
              if (targetLeaf) {
                savedPaneTree = insertTabIntoLeaf(savedPaneTree, targetLeaf.id, fileTab);
              }
            }
            const updatedGroup: LocalGroup = {
              ...group,
              updated_at: new Date().toISOString(),
              layout_state: {
                ...group.layout_state,
                paneTree: savedPaneTree,
              },
            };
            try {
              await localDB.putGroup(updatedGroup);
              setGroups((prev) =>
                prev.map((g) => (g.id === groupId ? updatedGroup : g))
              );
            } catch (err) {
              console.error("Failed to add tab to group:", err);
            }
          }
        }
      }

      // If removed from a group or switched groups, update the old group's layout_state
      if (oldGroupId && oldGroupId !== groupId) {
        const oldGroup = groups.find((g) => g.id === oldGroupId);
        if (oldGroup) {
          let savedPaneTree = oldGroup.layout_state.paneTree;
          savedPaneTree = removeTabFromTree(savedPaneTree, tabId) || savedPaneTree;

          const updatedGroup: LocalGroup = {
            ...oldGroup,
            updated_at: new Date().toISOString(),
            layout_state: {
              ...oldGroup.layout_state,
              paneTree: savedPaneTree,
            },
          };
          try {
            await localDB.putGroup(updatedGroup);
            setGroups((prev) =>
              prev.map((g) => (g.id === oldGroupId ? updatedGroup : g))
            );
          } catch (err) {
            console.error("Failed to update old group layout:", err);
          }
        }
      }
    },
    [tabs, paneTree, groups, activeGroupId, activeTabId, focusedLeafId, setTabs, setPaneTree, setGroups]
  );

  const handleSaveGroupConfirm = useCallback(
    async (
      name: string,
      color: string,
      tabId?: string,
      filePath?: string,
    ) => {
      if (!vaultPath) return;

      const newGroupId = "group-" + generateId();
      const currentScrolls: Record<string, number> = {};
      const currentCursors: Record<string, number> = {};
      const currentViewModes: Record<string, string> = {};

      const allOpenTabs = collectAllTabs(paneTree);
      for (const tab of allOpenTabs) {
        const cached = scrollCursorCacheRef.current[tab.path];
        if (cached) {
          if (cached.scroll !== undefined) currentScrolls[tab.path] = cached.scroll;
          if (cached.cursor !== undefined) currentCursors[tab.path] = cached.cursor;
          if (cached.viewMode !== undefined) currentViewModes[tab.path] = cached.viewMode;
        }
      }

      let savedPaneTree = paneTree;
      let savedActiveTabId = activeTabId;
      let savedFocusedLeafId = focusedLeafId;

      if (filePath) {
        savedPaneTree = JSON.parse(JSON.stringify(paneTree)) as PaneNode;
        const existingTab = collectAllTabs(savedPaneTree).find((tab) => tab.path === filePath);
        const fileTab = existingTab
          ? { ...existingTab, groupId: newGroupId }
          : {
              id: generateId(),
              path: filePath,
              name: getNoteName(filePath),
              isModified: false,
              groupId: newGroupId,
            };

        if (existingTab) {
          const assignGroup = (node: PaneNode): PaneNode => {
            if (node.type === "leaf") {
              return {
                ...node,
                tabs: node.tabs.map((tab) => tab.id === existingTab.id ? fileTab : tab),
              };
            }
            return {
              ...node,
              children: [assignGroup(node.children[0]), assignGroup(node.children[1])],
            };
          };
          savedPaneTree = assignGroup(savedPaneTree);
        } else {
          const targetLeaf = findLeafById(savedPaneTree, focusedLeafId) || findFirstLeaf(savedPaneTree);
          if (targetLeaf) {
            savedPaneTree = insertTabIntoLeaf(savedPaneTree, targetLeaf.id, fileTab);
          }
        }

        const fileLeaf = findLeafWithTab(savedPaneTree, fileTab.id);
        if (fileLeaf) {
          savedPaneTree = setActiveTabInLeaf(savedPaneTree, fileLeaf.id, fileTab.id);
          savedActiveTabId = fileTab.id;
          savedFocusedLeafId = fileLeaf.id;
        }
      }

      const newGroup: LocalGroup = {
        id: newGroupId,
        vault_path: vaultPath,
        name,
        color,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        auto_save_enabled: true,
        layout_state: {
          paneTree: savedPaneTree,
          activeTabId: savedActiveTabId,
          focusedLeafId: savedFocusedLeafId,
          scrollPositions: currentScrolls,
          cursorPositions: currentCursors,
          viewModes: currentViewModes,
        },
      };

      try {
        await localDB.putGroup(newGroup);
        setGroups((prev) => [...prev, newGroup]);
        setActiveGroupId(newGroupId);
        setHasUnsavedChanges(false);
        if (tabId) {
          handleAddTabToGroup(tabId, newGroupId);
        }
        showToast(`Created group ${name}`, "success");
      } catch (err) {
        console.error("Failed to save layout group:", err);
      }
    },
    [vaultPath, paneTree, activeTabId, focusedLeafId, scrollCursorCacheRef, handleAddTabToGroup, setGroups, setActiveGroupId, setHasUnsavedChanges, showToast]
  );

  const handleRestoreGroup = useCallback(async (groupId: string, groupOverride?: LocalGroup, preferredTabId?: string) => {
    const group = groupOverride || groups.find((g) => g.id === groupId);
    if (!group) return;

    const { layout_state } = group;
    if (!layout_state) return;

    const scrolls = layout_state.scrollPositions || {};
    const cursors = layout_state.cursorPositions || {};
    const viewModes = layout_state.viewModes || {};

    for (const [path, scroll] of Object.entries(scrolls)) {
      if (!scrollCursorCacheRef.current[path]) scrollCursorCacheRef.current[path] = {};
      scrollCursorCacheRef.current[path].scroll = scroll;
    }
    for (const [path, cursor] of Object.entries(cursors)) {
      if (!scrollCursorCacheRef.current[path]) scrollCursorCacheRef.current[path] = {};
      scrollCursorCacheRef.current[path].cursor = cursor;
    }
    for (const [path, viewMode] of Object.entries(viewModes)) {
      if (!scrollCursorCacheRef.current[path]) scrollCursorCacheRef.current[path] = {};
      scrollCursorCacheRef.current[path].viewMode = viewMode;
    }

    let tree = layout_state.paneTree;
    const ungroupedTabsToPreserve = getUngroupedTabsToPreserve(tabs, collectAllTabs(paneTree), groups);

    // Prune tabs in the incoming tree that belong to other groups (safety mechanism)
    const allTabsInTree = collectAllTabs(tree);
    for (const t of allTabsInTree) {
      if (t.groupId !== groupId) {
        const pruned = removeTabFromTree(tree, t.id);
        if (pruned) {
          tree = pruned;
        }
      }
    }

    skipTabSyncRef.current = true;
    setPaneTree(tree);
    const allRestoredTabs = collectAllTabs(tree);
    const restoredIds = new Set(allRestoredTabs.map(t => t.id));
    const filteredUngroupedTabs = ungroupedTabsToPreserve.filter(t => !restoredIds.has(t.id));
    setTabs([...allRestoredTabs, ...filteredUngroupedTabs]);

    // Focus on the first tab of the restored group
    const groupTabs = allRestoredTabs.filter((t) => t.groupId === groupId);
    const preferredTab = preferredTabId
      ? groupTabs.find((tab) => tab.id === preferredTabId)
      : null;
    const savedActiveTab = layout_state.activeTabId
      ? groupTabs.find((tab) => tab.id === layout_state.activeTabId)
      : null;
    const targetTabId = preferredTab?.id || savedActiveTab?.id || groupTabs[0]?.id || null;

    if (targetTabId) {
      setActiveTabId(targetTabId);
      const tabObj = allRestoredTabs.find((t) => t.id === targetTabId);
      if (tabObj) {
        if (tabObj.path !== "__new_tab__" && tabObj.path !== GRAPH_TAB_PATH && tabObj.path !== SPACES_TAB_PATH && !tabObj.path.startsWith('__plugin__.')) {
          if (isCanvasFile(tabObj.path)) {
            setCanvasFilePath(tabObj.path);
            setCurrentContent("");
            setBacklinks([]);
          } else {
            setCurrentContent("");
            setBacklinks([]);
          }
        } else {
          setCurrentContent("");
          setBacklinks([]);
        }
      }
    }

    // Set the focused leaf containing the active tab if possible
    if (targetTabId) {
      const leaf = findLeafWithTab(tree, targetTabId);
      if (leaf) {
        setFocusedLeafId(leaf.id);
      } else if (layout_state.focusedLeafId) {
        setFocusedLeafId(layout_state.focusedLeafId);
      }
    } else if (layout_state.focusedLeafId) {
      setFocusedLeafId(layout_state.focusedLeafId);
    }

    // Expand/uncollapse the group automatically on restore
    setCollapsedGroupIds((prev) => {
      const next = new Set<string>(prev);
      next.delete(groupId);
      return next;
    });

    setActiveGroupId(groupId);
    setHasUnsavedChanges(false);
  }, [groups, tabs, paneTree, scrollCursorCacheRef, skipTabSyncRef, setPaneTree, setTabs, setActiveTabId, setCanvasFilePath, setCurrentContent, setBacklinks, setFocusedLeafId, setCollapsedGroupIds, setActiveGroupId, setHasUnsavedChanges]);

  const handleCreateGroupFromPaths = useCallback(async (name: string, color: string, paths: string[]) => {
    if (!vaultPath) return null;

    const newGroupId = "group-" + generateId();
    
    // Construct tabs list
    const groupTabs: Tab[] = paths.map((path) => ({
      id: "tab-" + generateId(),
      path,
      name: getNoteName(path),
      isModified: false,
      groupId: newGroupId,
    }));

    const leafId = "leaf-" + generateId();
    const groupPaneTree: PaneLeaf = {
      type: "leaf",
      id: leafId,
      tabs: groupTabs,
      activeTabId: groupTabs[0]?.id || null,
    };

    const newGroup: LocalGroup = {
      id: newGroupId,
      vault_path: vaultPath,
      name,
      color,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      auto_save_enabled: true,
      layout_state: {
        paneTree: groupPaneTree,
        activeTabId: groupTabs[0]?.id || null,
        focusedLeafId: leafId,
        scrollPositions: {},
        cursorPositions: {},
        viewModes: {},
      },
    };

    try {
      await localDB.putGroup(newGroup);
      setGroups((prev) => [...prev, newGroup]);
      showToast(`Created group ${name} from cluster`, "success");
      return newGroupId;
    } catch (err) {
      console.error("Failed to create group from paths:", err);
      return null;
    }
  }, [vaultPath, showToast, setGroups]);

  const handleOpenPathsAsGroup = useCallback(async (paths: string[]) => {
    const name = `Group (${paths.length} notes)`;
    const color = "#3b82f6";
    const newGroupId = await handleCreateGroupFromPaths(name, color, paths);
    if (newGroupId) {
      await handleRestoreGroup(newGroupId);
    }
  }, [handleCreateGroupFromPaths, handleRestoreGroup]);

  const handleCreateGroupFromFolder = useCallback(async (folderName: string, paths: string[]) => {
    if (paths.length === 0) {
      showToast("Cannot create group: Folder is empty", "error");
      return;
    }
    const color = "#10b981"; // Emerald green
    const newGroupId = await handleCreateGroupFromPaths(folderName, color, paths);
    if (newGroupId) {
      await handleRestoreGroup(newGroupId);
    }
  }, [handleCreateGroupFromPaths, handleRestoreGroup, showToast]);

  const handleCreateGroupFromFile = useCallback(async (filePath: string) => {
    setGroupModalData({
      type: "create",
      title: "Save Note to New Group",
      initialName: getNoteName(filePath),
      initialColor: "#3b82f6",
      filePath,
    });
  }, [setGroupModalData]);

  const handleCreateGroupFromTab = useCallback(async (tabId: string) => {
    const tabObj = tabs.find((t) => t.id === tabId);
    if (!tabObj) return;

    setGroupModalData({
      type: "create",
      title: "Save Tab to New Group",
      initialName: tabObj.name,
      initialColor: "#3b82f6",
      tabId,
      filePath: tabObj.path,
    });
  }, [tabs, setGroupModalData]);

  const handleUpdateActiveGroup = useCallback(async () => {
    if (!activeGroupId) return;

    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return;

    const currentScrolls: Record<string, number> = {};
    const currentCursors: Record<string, number> = {};
    const currentViewModes: Record<string, string> = {};

    const allOpenTabs = collectAllTabs(paneTree);
    for (const tab of allOpenTabs) {
      const cached = scrollCursorCacheRef.current[tab.path];
      if (cached) {
        if (cached.scroll !== undefined) currentScrolls[tab.path] = cached.scroll;
        if (cached.cursor !== undefined) currentCursors[tab.path] = cached.cursor;
        if (cached.viewMode !== undefined) currentViewModes[tab.path] = cached.viewMode;
      }
    }

    const updatedGroup: LocalGroup = {
      ...group,
      updated_at: new Date().toISOString(),
      layout_state: {
        paneTree,
        activeTabId,
        focusedLeafId,
        scrollPositions: currentScrolls,
        cursorPositions: currentCursors,
        viewModes: currentViewModes,
      },
    };

    try {
      await localDB.putGroup(updatedGroup);
      setGroups((prev) =>
        prev.map((g) => (g.id === activeGroupId ? updatedGroup : g))
      );
      setHasUnsavedChanges(false);
      showToast(`Saved changes to group "${group.name}"`, "success");
    } catch (err) {
      console.error("Failed to update layout group:", err);
      showToast("Failed to save group configuration.", "error");
    }
  }, [activeGroupId, groups, paneTree, activeTabId, focusedLeafId, scrollCursorCacheRef, setGroups, setHasUnsavedChanges, showToast]);

  const handleRenameGroup = useCallback(async (groupId: string, newName: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const updatedGroup = {
      ...group,
      name: newName,
      updated_at: new Date().toISOString(),
    };

    try {
      await localDB.putGroup(updatedGroup);
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? updatedGroup : g))
      );
      showToast("Group renamed", "success");
    } catch (err) {
      console.error("Failed to rename group:", err);
    }
  }, [groups, setGroups, showToast]);

  const handleChangeGroupColor = useCallback(async (groupId: string, newColor: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const updatedGroup = {
      ...group,
      color: newColor,
      updated_at: new Date().toISOString(),
    };

    try {
      await localDB.putGroup(updatedGroup);
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? updatedGroup : g))
      );
    } catch (err) {
      console.error("Failed to change group color:", err);
    }
  }, [groups, setGroups]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    try {
      await localDB.deleteGroup(groupId);

      // Clean up tab group assignments in-memory
      setTabs((prev) =>
        prev.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t))
      );
      setPaneTree((prev) => {
        const cleanNode = (node: PaneNode): PaneNode => {
          if (node.type === "leaf") {
            return {
              ...node,
              tabs: node.tabs.map((t) =>
                t.groupId === groupId ? { ...t, groupId: undefined } : t
              ),
            };
          }
          return {
            ...node,
            children: [cleanNode(node.children[0]), cleanNode(node.children[1])],
          };
        };
        return cleanNode(prev);
      });

      setGroups((prev) => prev.filter((g) => g.id !== groupId));

      if (activeGroupId === groupId) {
        setActiveGroupId(null);
      }
      showToast("Group deleted", "success");
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  }, [activeGroupId, setTabs, setPaneTree, setGroups, setActiveGroupId, showToast]);

  const handleDuplicateGroup = useCallback(async (groupId: string) => {
    const srcGroup = groups.find((g) => g.id === groupId);
    if (!srcGroup) return;

    const newGroupId = "group-" + generateId();
    const newGroupName = `${srcGroup.name} (Copy)`;

    // Deep copy and remap ids of layout_state
    const srcTree = srcGroup.layout_state.paneTree;
    const remapTreeIdsAndGroup = (node: PaneNode): PaneNode => {
      if (node.type === "leaf") {
        return {
          type: "leaf",
          id: "leaf-" + generateId(),
          tabs: node.tabs.map((t) => ({
            ...t,
            id: "tab-" + generateId(),
            groupId: newGroupId,
          })),
          activeTabId: null, // Select will restore activeTab
        };
      }
      return {
        type: "split",
        id: "split-" + generateId(),
        direction: node.direction,
        ratio: 'ratio' in node ? node.ratio : 0.5,
        children: [
          remapTreeIdsAndGroup(node.children[0]),
          remapTreeIdsAndGroup(node.children[1]),
        ],
      };
    };

    const newTree = remapTreeIdsAndGroup(srcTree);
    const newTabs = collectAllTabs(newTree);

    // Pick first tab as active
    const firstLeaf = findFirstLeaf(newTree);
    let newActiveTabId: string | null = null;
    let newFocusedLeafId = firstLeaf?.id || "";

    if (firstLeaf && firstLeaf.tabs.length > 0) {
      newActiveTabId = firstLeaf.tabs[0].id;
      firstLeaf.activeTabId = newActiveTabId;
    }

    const dupGroup: LocalGroup = {
      id: newGroupId,
      vault_path: srcGroup.vault_path,
      name: newGroupName,
      color: srcGroup.color,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      auto_save_enabled: srcGroup.auto_save_enabled,
      layout_state: {
        paneTree: newTree,
        activeTabId: newActiveTabId,
        focusedLeafId: newFocusedLeafId,
        scrollPositions: { ...srcGroup.layout_state.scrollPositions },
        cursorPositions: { ...srcGroup.layout_state.cursorPositions },
        viewModes: { ...srcGroup.layout_state.viewModes },
      },
    };

    try {
      await localDB.putGroup(dupGroup);
      setGroups((prev) => [...prev, dupGroup]);
      showToast(`Duplicated group to "${newGroupName}"`, "success");
    } catch (err) {
      console.error("Failed to duplicate group:", err);
    }
  }, [groups, showToast, setGroups]);

  const handleToggleGroupAutoSave = useCallback(async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const nextVal = !group.auto_save_enabled;
    const updated = {
      ...group,
      auto_save_enabled: nextVal,
      updated_at: new Date().toISOString(),
    };

    try {
      await localDB.putGroup(updated);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? updated : g)));
      showToast(
        nextVal
          ? `Auto-save enabled for "${group.name}"`
          : `Auto-save disabled for "${group.name}"`,
        "info"
      );
    } catch (err) {
      console.error("Failed to toggle auto-save:", err);
    }
  }, [groups, showToast, setGroups]);

  const handleAddFileToGroup = useCallback(async (filePath: string, groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    let savedPaneTree = group.layout_state.paneTree;
    const exists = collectAllTabs(savedPaneTree).some((t) => t.path === filePath);
    if (exists) {
      showToast("Note already exists in this group.", "info");
      return;
    }

    const fileTab: Tab = {
      id: "tab-" + generateId(),
      path: filePath,
      name: getNoteName(filePath),
      isModified: false,
      groupId,
    };

    const targetLeaf =
      findLeafById(savedPaneTree, group.layout_state.focusedLeafId) ||
      findFirstLeaf(savedPaneTree);

    if (targetLeaf) {
      savedPaneTree = insertTabIntoLeaf(savedPaneTree, targetLeaf.id, fileTab);
    }

    const updatedGroup: LocalGroup = {
      ...group,
      updated_at: new Date().toISOString(),
      layout_state: {
        ...group.layout_state,
        paneTree: savedPaneTree,
      },
    };

    try {
      await localDB.putGroup(updatedGroup);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? updatedGroup : g)));

      // If this group is currently active, we sync the active workspaces tab tree
      if (activeGroupId === groupId) {
        setPaneTree(savedPaneTree);
        setTabs((prev) => [...prev, fileTab]);
      }
      showToast(`Added note to "${group.name}"`, "success");
    } catch (err) {
      console.error("Failed to add note to group:", err);
    }
  }, [groups, activeGroupId, showToast, setGroups, setPaneTree, setTabs]);

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, [setCollapsedGroupIds]);

  const handleGroupModalClose = useCallback((result: { name: string; color: string } | null) => {
    const data = groupModalData;
    setGroupModalData(null);
    if (!result || !data) return;
    if (data.type === "create") {
      void handleSaveGroupConfirm(result.name, result.color, data.tabId, data.filePath);
    } else if (data.type === "rename" || data.type === "color") {
      if (!data.groupId) return;
      const group = groups.find((g) => g.id === data.groupId);
      if (!group) return;

      const updatedGroup: LocalGroup = {
        ...group,
        name: result.name,
        color: result.color,
        updated_at: new Date().toISOString(),
      };

      localDB.putGroup(updatedGroup)
        .then(() => {
          setGroups((prev) =>
            prev.map((g) => (g.id === data.groupId ? updatedGroup : g))
          );
          showToast(`Updated group ${result.name}`, "success");
        })
        .catch((err) => console.error("Failed to update group modal action:", err));
    }
  }, [groupModalData, groups, handleSaveGroupConfirm, setGroups, showToast, setGroupModalData]);

  return {
    handleOpenCreateGroupModal,
    handleSaveGroupConfirm,
    handleRestoreGroup,
    handleOpenPathsAsGroup,
    handleCreateGroupFromPaths,
    handleCreateGroupFromFolder,
    handleCreateGroupFromFile,
    handleCreateGroupFromTab,
    handleUpdateActiveGroup,
    handleRenameGroup,
    handleChangeGroupColor,
    handleDeleteGroup,
    handleDuplicateGroup,
    handleToggleGroupAutoSave,
    handleAddFileToGroup,
    handleToggleGroupCollapse,
    handleAddTabToGroup,
    handleGroupModalClose,
  };
}
