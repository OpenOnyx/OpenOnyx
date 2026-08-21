import { useCallback } from "react";
import { getAPI } from "../utils/api";
import { readData } from "../utils/disk-store";
import { collectAllTabs } from "../components/layout/SplitPaneContainer";
import { PaneNode } from "../types";
import { VaultEntryAction, VaultEntryTransitionPhase } from "../components/settings/WelcomeScreen";

const api = getAPI();

interface VaultSessionOptions {
  vaultPath: string | null;
  setVaultPath: (path: string | null) => void;
  previouslyOpenedVaults: string[];
  setPreviouslyOpenedVaults: (vaults: string[]) => void;
  showVaultManager: boolean;
  setShowVaultManager: (show: boolean) => void;
  vaultEntryTransitionPhase: VaultEntryTransitionPhase;
  setVaultEntryTransitionPhase: (phase: VaultEntryTransitionPhase) => void;
  settings: any;
  setShowSidebar: (show: boolean) => void;
  setFileTree: (tree: any[]) => void;
  runVaultInit: (tree: any[]) => void;
  setPaneTree: (tree: any) => void;
  setTabs: (tabs: any[]) => void;
  setActiveTabId: (id: string | null) => void;
  setFocusedLeafId: (id: string) => void;
  handleOpenNewTab: (groupId?: any) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  promptForInput: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
}

const getParentPath = (targetPath: string): string => {
  const normalized = targetPath.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index > 0 ? normalized.slice(0, index) : normalized;
};

const getPathLeafName = (targetPath: string): string =>
  targetPath.replace(/[\\/]+$/, "").split(/[/\\]/).filter(Boolean).pop() ||
  "Untitled vault";

const joinNativePath = (parentPath: string, name: string): string => {
  const separator = parentPath.includes("\\") ? "\\" : "/";
  return `${parentPath.replace(/[\\/]+$/, "")}${separator}${name}`;
};

export function useVaultSession({
  vaultPath,
  setVaultPath,
  previouslyOpenedVaults,
  setPreviouslyOpenedVaults,
  showVaultManager,
  setShowVaultManager,
  vaultEntryTransitionPhase,
  setVaultEntryTransitionPhase,
  settings,
  setShowSidebar,
  setFileTree,
  runVaultInit,
  setPaneTree,
  setTabs,
  setActiveTabId,
  setFocusedLeafId,
  handleOpenNewTab,
  showToast,
  promptForInput,
}: VaultSessionOptions) {

  const loadVaultData = useCallback(async (path: string) => {
    await api.setVaultPath(path);
    setVaultPath(path);
    (window as any).__oo_vault_path = path;
    setShowSidebar(true);
    const tree = await api.getFileTree();
    setFileTree(tree);
    // Trigger background vault initialization for new vault
    runVaultInit(tree);
    
    try {
      const workspaceData = await readData<{ paneTree: PaneNode; activeTabId: string | null; focusedLeafId: string }>("workspace.json");
      if (settings.defaultFileToOpen !== "new-tab" && workspaceData && workspaceData.paneTree) {
        setPaneTree(workspaceData.paneTree);
        setTabs(collectAllTabs(workspaceData.paneTree));
        if (workspaceData.activeTabId) setActiveTabId(workspaceData.activeTabId);
        if (workspaceData.focusedLeafId) setFocusedLeafId(workspaceData.focusedLeafId);
      } else {
        handleOpenNewTab();
      }
    } catch (err) {
      handleOpenNewTab();
    }

    try {
      const previous = await api.getPreviouslyOpenedVaults();
      setPreviouslyOpenedVaults(previous || []);
    } catch (prevErr) {
      console.warn("Failed to load previously opened vaults:", prevErr);
    }
  }, [
    settings.defaultFileToOpen,
    setShowSidebar,
    setFileTree,
    runVaultInit,
    setPaneTree,
    setTabs,
    setActiveTabId,
    setFocusedLeafId,
    handleOpenNewTab,
    setVaultPath,
    setPreviouslyOpenedVaults,
  ]);

  const refreshPreviouslyOpenedVaults = useCallback(async () => {
    try {
      const previous = await api.getPreviouslyOpenedVaults();
      setPreviouslyOpenedVaults(previous || []);
    } catch (prevErr) {
      console.warn("Failed to load previously opened vaults:", prevErr);
    }
  }, [setPreviouslyOpenedVaults]);

  const handleShowVaultManager = useCallback(async () => {
    await refreshPreviouslyOpenedVaults();
    setShowVaultManager(true);
  }, [refreshPreviouslyOpenedVaults, setShowVaultManager]);

  const handleOpenVault = useCallback(async (): Promise<boolean> => {
    try {
      const path = await api.openVaultDialog();
      if (path) {
        await loadVaultData(path);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to open vault:", e);
      alert("Failed to open vault. It may be too large or inaccessible.");
      return false;
    }
  }, [loadVaultData]);

  const handleCreateVault = useCallback(async (): Promise<boolean> => {
    try {
      let defaultPath: string | undefined;
      try {
        const documentsPath = await api.getSystemPath("documents");
        defaultPath = documentsPath
          ? `${documentsPath}/Untitled vault`
          : undefined;
      } catch {
        defaultPath = undefined;
      }

      const result = await api.showSaveDialog({
        title: "Create new vault",
        buttonLabel: "Create",
        defaultPath,
        properties: ["createDirectory"],
      } as any);

      if (result.canceled || !result.filePath) {
        return false;
      }

      await loadVaultData(result.filePath);
      return true;
    } catch (e) {
      console.error("Failed to create vault:", e);
      alert("Failed to create vault. Please choose a writable location.");
      return false;
    }
  }, [loadVaultData]);

  const handleSwitchVault = useCallback(async (path: string): Promise<boolean> => {
    try {
      await loadVaultData(path);
      return true;
    } catch (e) {
      console.error("Failed to switch vault:", e);
      alert("Failed to switch vault. It may be too large or inaccessible.");
      return false;
    }
  }, [loadVaultData]);

  const handleWelcomeVaultAction = useCallback(
    async (action: VaultEntryAction) => {
      if (vaultEntryTransitionPhase !== "idle") return;

      setVaultEntryTransitionPhase("transitioning");
      const opened =
        action === "create" ? await handleCreateVault() : await handleOpenVault();
      if (!opened) {
        setVaultEntryTransitionPhase("idle");
      }
    },
    [vaultEntryTransitionPhase, handleCreateVault, handleOpenVault, setVaultEntryTransitionPhase],
  );

  const handleCopyVaultId = useCallback((targetPath: string) => {
    void api.writeClipboardText(targetPath);
    showToast("Copied vault ID", "success");
  }, [showToast]);

  const handleRenameVault = useCallback(
    async (targetPath: string) => {
      const currentName = getPathLeafName(targetPath);
      const nextName = await promptForInput(
        "Rename vault",
        "Enter a new vault folder name:",
        currentName,
      );
      if (!nextName || nextName === currentName) return;
      if (/[\\/]/.test(nextName)) {
        showToast("Vault name cannot contain path separators.", "error");
        return;
      }

      const nextPath = joinNativePath(getParentPath(targetPath), nextName);
      try {
        await api.renamePath(targetPath, nextPath);
        if (targetPath === vaultPath) {
          await loadVaultData(nextPath);
        } else {
          await refreshPreviouslyOpenedVaults();
        }
        showToast("Vault renamed", "success");
      } catch (error) {
        console.error("Failed to rename vault:", error);
        showToast("Failed to rename vault.", "error");
      }
    },
    [promptForInput, vaultPath, loadVaultData, refreshPreviouslyOpenedVaults, showToast],
  );

  const handleMoveVault = useCallback(
    async (targetPath: string) => {
      try {
        const result = await api.showOpenDialog({
          title: "Move vault to folder",
          buttonLabel: "Move here",
          properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return;

        const nextPath = joinNativePath(result.filePaths[0], getPathLeafName(targetPath));
        if (nextPath === targetPath) return;

        await api.renamePath(targetPath, nextPath);
        if (targetPath === vaultPath) {
          await loadVaultData(nextPath);
        } else {
          await refreshPreviouslyOpenedVaults();
        }
        showToast("Vault moved", "success");
      } catch (error) {
        console.error("Failed to move vault:", error);
        showToast("Failed to move vault.", "error");
      }
    },
    [vaultPath, loadVaultData, refreshPreviouslyOpenedVaults, showToast],
  );

  const handleRemoveVaultFromList = useCallback(
    async (targetPath: string) => {
      try {
        const next = await api.removePreviouslyOpenedVault(targetPath);
        const updatedNext = next || [];
        setPreviouslyOpenedVaults(updatedNext);
        
        let isCurrentRemoved = false;
        if (targetPath === vaultPath) {
          setVaultPath(null);
          await api.setVaultPath("");
          isCurrentRemoved = true;
        }
        
        showToast("Vault removed from list", "success");

        const remainingCount = updatedNext.length;
        if (remainingCount === 0 || (isCurrentRemoved && remainingCount === 0)) {
          setShowVaultManager(false);
        }
      } catch (error) {
        console.error("Failed to remove vault from list:", error);
        showToast("Failed to remove vault from list.", "error");
      }
    },
    [vaultPath, showToast, setVaultPath, setPreviouslyOpenedVaults, setShowVaultManager],
  );

  return {
    loadVaultData,
    refreshPreviouslyOpenedVaults,
    handleShowVaultManager,
    handleOpenVault,
    handleCreateVault,
    handleSwitchVault,
    handleWelcomeVaultAction,
    handleCopyVaultId,
    handleRenameVault,
    handleMoveVault,
    handleRemoveVaultFromList,
  };
}
