import React, { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  FolderInput,
  FolderOpen,
  HelpCircle,
  MoreVertical,
  Pencil,
  X,
} from "lucide-react";
import { Theme } from "../../types";
import { isDarkTheme, vaultName  } from "../../utils/helpers";
import type { AppSettings } from "./SettingsPage";

interface VaultManagerProps {
  currentVaultPath: string | null;
  previouslyOpenedVaults: string[];
  theme: Theme;
  settings?: AppSettings;
  onCreateVault: () => Promise<boolean>;
  onOpenVault: () => Promise<boolean>;
  onSwitchVault: (path: string) => Promise<boolean>;
  onCloseVault?: () => Promise<void>;
  onRevealVault?: (path: string) => void;
  onCopyVaultId?: (path: string) => void;
  onRenameVault?: (path: string) => Promise<void>;
  onMoveVault?: (path: string) => Promise<void>;
  onRemoveVaultFromList?: (path: string) => Promise<void>;
  onClose: () => void;
}

function uniqueVaults(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

export function VaultManager({
  currentVaultPath,
  previouslyOpenedVaults,
  theme,
  settings,
  onCreateVault,
  onOpenVault,
  onSwitchVault,
  onCloseVault,
  onRevealVault,
  onCopyVaultId,
  onRenameVault,
  onMoveVault,
  onRemoveVaultFromList,
  onClose,
}: VaultManagerProps) {
  const [busyAction, setBusyAction] = useState<"create" | "open" | string | null>(
    null,
  );
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const isDark = isDarkTheme(theme, settings);
  const vaults = useMemo(
    () => uniqueVaults([currentVaultPath, ...previouslyOpenedVaults]),
    [currentVaultPath, previouslyOpenedVaults],
  );

  const runAction = async (
    actionKey: "create" | "open" | string,
    action: () => Promise<boolean>,
  ) => {
    if (busyAction) return;
    setBusyAction(actionKey);
    try {
      const changed = await action();
      if (changed) onClose();
    } finally {
      setBusyAction(null);
    }
  };

  const runMenuAction = async (
    path: string,
    action: ((path: string) => void | Promise<void>) | undefined,
  ) => {
    if (!action) return;
    setMenuPath(null);
    await action(path);
  };

  const menuItemClass =
    "flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
  const menuDangerClass =
    "text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:text-[var(--danger)]";

  return (
    <div
      className="motion-dialog-backdrop fixed inset-0 z-[4200] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Vault manager"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="motion-dialog flex h-[656px] max-h-[calc(100vh-48px)] w-[806px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-none">
        <aside className="flex w-[280px] min-h-0 shrink-0 flex-col border-r border-[var(--border-medium)] bg-[var(--bg-secondary)] px-5 py-10">
          <div className="-mr-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pr-3">
            {vaults.length === 0 ? (
              <div className="rounded-md border border-[var(--border-subtle)] px-3 py-3 text-sm text-[var(--text-muted)]">
                No recent vaults yet.
              </div>
            ) : (
              vaults.map((path) => {
                const isCurrent = path === currentVaultPath;
                return (
                  <div
                    key={path}
                    className={`group relative rounded-md transition-colors hover:bg-[var(--bg-hover)] ${
                      isCurrent ? "bg-[var(--bg-hover)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-start gap-2 rounded-md border-0 bg-transparent py-2.5 pl-3 pr-10 text-left text-[15px] text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60"
                      disabled={busyAction === path}
                      onClick={() => {
                        if (isCurrent) {
                          onClose();
                          return;
                        }
                        void runAction(path, () => onSwitchVault(path));
                      }}
                      title={path}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                          {vaultName(path)}
                        </span>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[var(--text-muted)]">
                          {path}
                        </span>
                      </span>
                      {isCurrent ? (
                        <span className="mt-1 flex shrink-0 items-center gap-2">
                          <Check size={15} className="text-[var(--accent-primary)]" />
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="absolute right-2 top-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[var(--text-muted)] opacity-70 transition-colors hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuPath((current) => (current === path ? null : path));
                      }}
                      aria-label={`Vault options for ${vaultName(path)}`}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuPath === path ? (
                      <div className="absolute left-2 top-10 z-20 w-[244px] overflow-hidden rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-none">
                        <button
                          type="button"
                          className={menuItemClass}
                          onClick={() => void runMenuAction(path, onCopyVaultId)}
                        >
                          <Copy size={16} />
                          <span>Copy vault ID</span>
                        </button>
                        <div className="my-1 h-px bg-[var(--border-subtle)]" />
                        <button
                          type="button"
                          className={menuItemClass}
                          onClick={() => void runMenuAction(path, onRenameVault)}
                        >
                          <Pencil size={16} />
                          <span>Rename vault...</span>
                        </button>
                        <button
                          type="button"
                          className={menuItemClass}
                          onClick={() => void runMenuAction(path, onMoveVault)}
                        >
                          <FolderInput size={16} />
                          <span>Move vault...</span>
                        </button>
                        <div className="my-1 h-px bg-[var(--border-subtle)]" />
                        <button
                          type="button"
                          className={menuItemClass}
                          onClick={() => void runMenuAction(path, onRevealVault)}
                        >
                          <FolderOpen size={16} />
                          <span>Reveal vault in system explorer</span>
                        </button>
                        <div className="my-1 h-px bg-[var(--border-subtle)]" />
                        <button
                          type="button"
                          className={`${menuItemClass} ${menuDangerClass}`}
                          onClick={() =>
                            void runMenuAction(path, onRemoveVaultFromList)
                          }
                        >
                          <X size={16} />
                          <span>Remove from list</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          {currentVaultPath && onCloseVault ? (
              <button
                type="button"
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!!busyAction}
                onClick={() => void runAction("close-vault", async () => {
                  await onCloseVault();
                  return true;
                })}
              >
                {busyAction === "close-vault" ? "Closing..." : "Close current vault"}
              </button>
            ) : null}
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col bg-[var(--bg-primary)]">
          <div className="absolute right-0 top-0 flex h-8 items-center bg-[var(--bg-elevated)]/80">
            <button
              type="button"
              className="flex h-8 w-11 cursor-default items-center justify-center border-0 bg-transparent text-[var(--text-muted)]"
              aria-hidden="true"
              tabIndex={-1}
            >
              -
            </button>
            <button
              type="button"
              className="flex h-8 w-11 cursor-default items-center justify-center border-0 bg-transparent text-[var(--text-muted)]"
              aria-hidden="true"
              tabIndex={-1}
            >
              □
            </button>
            <button
              type="button"
              className="flex h-8 w-11 cursor-pointer items-center justify-center border-0 bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={onClose}
              aria-label="Close vault manager"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center px-9 pb-12 pt-16">
            <div className={`mb-5 flex items-center justify-center p-4 rounded-2xl shadow-sm border ${isDark ? "bg-[#18181b] border-neutral-800/80" : "bg-white border-neutral-200/60"} h-24 w-24`}>
              <img
                src={isDark ? "logos/logo-dark.png" : "logos/logo-light.png"}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
            <div className="mb-1 text-[30px] font-bold leading-none tracking-normal text-[var(--text-primary)]">
              OpenOnyx
            </div>
            <div className="mb-8 text-sm text-[var(--text-muted)]">
              Vault Manager
            </div>

            <div className="w-full max-w-[448px] overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-4 shadow-none">
              <div className="flex items-center justify-between gap-5 border-b border-[var(--border-subtle)] pb-4">
                <div className="min-w-0">
                  <div className="text-[15px] text-[var(--text-primary)]">
                    Create new vault
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--text-muted)]">
                    Create a new vault under a folder.
                  </div>
                </div>
                <button
                  type="button"
                  className="h-[30px] min-w-[100px] cursor-pointer rounded-[5px] border border-[var(--accent-primary)] bg-[var(--accent-primary)] px-4 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!!busyAction}
                  onClick={() => void runAction("create", onCreateVault)}
                >
                  {busyAction === "create" ? "Creating..." : "Create"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-5 border-b border-[var(--border-subtle)] py-4">
                <div className="min-w-0">
                  <div className="text-[15px] text-[var(--text-primary)]">
                    Open folder as vault
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--text-muted)]">
                    Choose an existing folder of Markdown files.
                  </div>
                </div>
                <button
                  type="button"
                  className="h-[30px] min-w-[100px] cursor-pointer rounded-[5px] border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!!busyAction}
                  onClick={() => void runAction("open", onOpenVault)}
                >
                  {busyAction === "open" ? "Opening..." : "Open"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-5 border-b border-[var(--border-subtle)] py-4 opacity-70">
                <div className="min-w-0">
                  <div className="text-[15px] text-[var(--text-primary)]">
                    Open vault from sync
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--text-muted)]">
                    Set up a synced vault with existing remote vault.
                  </div>
                </div>
                <button
                  type="button"
                  className="h-[30px] min-w-[100px] cursor-not-allowed rounded-[5px] border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-4 text-sm font-medium text-[var(--text-secondary)]"
                  disabled
                >
                  Sign in
                </button>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <HelpCircle size={17} className="shrink-0 text-[var(--text-muted)]" />
                <button
                  type="button"
                  className="flex h-[31px] flex-1 cursor-default items-center justify-between rounded-[5px] border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-left text-sm text-[var(--text-secondary)]"
                  aria-label="Language"
                >
                  English
                  <ChevronDown size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
