/**
 * CollaborationPanel -- Full collaboration UI for OpenOnyx.
 *
 * Owner flow: Create cloud space -> upload vault -> invite collaborators
 * Receiver flow: View invites -> accept -> select folder -> bootstrap vault
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud, CloudUpload, Users, UserPlus, Check, X, RefreshCw,
  FolderOpen, Loader, AlertCircle, Send, ChevronDown, ChevronUp,
  Lock, Unlock, KeyRound, Activity,
} from 'lucide-react';
import {
  collaborationEngine,
  type CloudSpace, type SpaceInvite, type SpaceCollaborator,
  type CollabStatus,
} from '../../lib/collaborationEngine';
import { authManager } from '../../lib/auth';
import { syncEngine, type SyncStatus } from '../../lib/syncEngine';
import { getAPI } from '../../utils/api';

interface CollaborationPanelProps {
  vaultPath: string | null;
  onVaultReconstructed?: (path: string) => void;
  isSettingsMode?: boolean;
  onGoToAccount?: () => void;
}

const settingCardClass =
  "setting-card flex items-center justify-between border-b border-[var(--border-subtle)] py-4 last:border-b-0";
const settingCenteredCardClass =
  "setting-card flex justify-center border-none py-10";
const settingInfoClass = "setting-info flex min-w-0 flex-1 flex-col gap-1 pr-6";
const settingTitleClass =
  "setting-title text-sm font-medium text-[var(--text-primary)]";
const settingTitleWithIconClass =
  "setting-title-with-icon flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]";
const settingTitleIconClass = "setting-title-icon shrink-0 text-[var(--text-muted)]";
const settingDescriptionClass =
  "setting-description text-xs leading-[1.4] text-[var(--text-muted)]";
const settingControlClass = "setting-control flex shrink-0 items-center gap-2";
const settingInputClass =
  "setting-input w-full max-w-60 rounded border border-[var(--border-medium)] bg-[var(--bg-input)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--text-faint)] focus:border-[var(--color-accent)]";
const settingSelectClass =
  "setting-select min-w-40 cursor-pointer rounded border border-[var(--border-medium)] bg-[var(--bg-input)] px-3 py-1.5 font-[inherit] text-[13px] text-[var(--text-primary)] outline-none transition-colors duration-150 focus:border-[var(--color-accent)]";
const settingBtnPrimaryClass =
  "setting-btn-primary cursor-pointer rounded border-0 bg-[var(--color-accent)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--text-on-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--color-accent-1)] active:scale-[0.98] active:bg-[var(--color-accent-2)] disabled:cursor-not-allowed disabled:opacity-60";
const settingBtnSecondaryClass =
  "setting-btn-secondary cursor-pointer rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--text-primary)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] active:scale-[0.98] active:bg-[var(--bg-active)] disabled:cursor-not-allowed disabled:opacity-60";
const settingGroupHeaderClass =
  "setting-group-header mb-3 mt-8 select-none border-b border-[var(--border-subtle)] pb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]";
const settingToggleClass = "relative inline-block h-5 w-[38px] shrink-0 cursor-pointer";
const settingToggleInputClass = "peer absolute h-0 w-0 opacity-0";
const toggleSliderClass =
  "absolute inset-0 rounded-full border border-[var(--border-medium)] bg-[var(--bg-tertiary)] transition-colors duration-[250ms] before:absolute before:left-0.5 before:top-1/2 before:h-3.5 before:w-3.5 before:-translate-y-1/2 before:rounded-full before:bg-white before:shadow-[0_1px_3px_rgba(0,0,0,0.15)] before:transition-transform before:duration-[250ms] peer-checked:border-[var(--color-accent-1)] peer-checked:bg-[var(--color-accent)] peer-checked:before:translate-x-[18px] peer-checked:before:bg-[var(--text-on-accent)]";

export function CollaborationPanel({
  vaultPath,
  onVaultReconstructed,
  isSettingsMode = false,
  onGoToAccount,
}: CollaborationPanelProps) {
  const [user, setUser] = useState(authManager.getUser());
  const [authLoading, setAuthLoading] = useState(authManager.getState().isLoading);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>({ state: 'idle' });
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [cloudSpace, setCloudSpace] = useState<CloudSpace | null>(null);
  const [invitesIn, setInvitesIn] = useState<SpaceInvite[]>([]);
  const [invitesOut, setInvitesOut] = useState<SpaceInvite[]>([]);
  const [collaborators, setCollaborators] = useState<SpaceCollaborator[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('invites');
  const [isCollabActive, setIsCollabActive] = useState(!collaborationEngine.collabPaused);

  const [availableSpaces, setAvailableSpaces] = useState<CloudSpace[]>([]);

  // Sync collaboration pause state
  useEffect(() => {
    setIsCollabActive(!collaborationEngine.collabPaused);
  }, [collabStatus]);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  // Auth listener
  useEffect(() => {
    const unsub = authManager.subscribe(s => {
      setUser(s.user);
      setAuthLoading(s.isLoading);
    });
    return unsub;
  }, []);

  // Status listener
  useEffect(() => {
    const unsub = collaborationEngine.onStatusChange(setCollabStatus);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = syncEngine.onStatusChange(setSyncStatus);
    return unsub;
  }, []);

  useEffect(() => {
    if (!cloudSpace) {
      setIsUnlocked(false);
      return;
    }
    setIsUnlocked(collaborationEngine.isPrivateSpaceUnlocked(cloudSpace.id));
  }, [cloudSpace, collabStatus]);

  // Load cloud space for current vault
  const loadSpaceData = useCallback(async (isInitial = false) => {
    if (!vaultPath || !user) {
      setIsInitialLoading(false);
      return;
    }
    if (isInitial) {
      setIsInitialLoading(true);
    }
    try {
      const space = await collaborationEngine.getSpaceForVault(vaultPath);
      setCloudSpace(space);
      if (space) {
        const [collabs, sent] = await Promise.all([
          collaborationEngine.getCollaborators(space.id),
          collaborationEngine.getSentInvites(space.id),
        ]);
        setCollaborators(collabs);
        setInvitesOut(sent);
        setAvailableSpaces([]);
        setSelectedSpaceId('');
      } else {
        setCloudSpace(null);
        setCollaborators([]);
        setInvitesOut([]);

        // Fetch spaces available to link
        const spaces = await collaborationEngine.getAvailableSpacesToLink();
        setAvailableSpaces(spaces);
        if (spaces.length > 0) {
          setSelectedSpaceId(prev => prev || spaces[0].id);
        } else {
          setSelectedSpaceId('');
        }
      }
    } catch { /* ignore */ } finally {
      if (isInitial) {
        setIsInitialLoading(false);
      }
    }

    // Always load incoming invites
    try {
      const incoming = await collaborationEngine.getIncomingInvites();
      setInvitesIn(incoming);
    } catch { /* ignore */ }
  }, [vaultPath, user]);

  // Load data initially on mount or when vault changes
  useEffect(() => {
    loadSpaceData(true);
  }, [vaultPath]);

  // Load data when user changes, without showing full-screen loader
  useEffect(() => {
    loadSpaceData(false);
  }, [user]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(() => loadSpaceData(false), 10000);
    return () => clearInterval(interval);
  }, [loadSpaceData]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleCreateSpace = async () => {
    if (!vaultPath || !spaceName.trim()) return;
    setError(null);
    setIsCreating(true);
    try {
      await collaborationEngine.createCloudSpace(spaceName.trim(), vaultPath, encryptionPassword);
      setEncryptionPassword('');
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create cloud space');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUnlockSpace = async () => {
    if (!cloudSpace || !unlockPassword) return;
    setError(null);
    try {
      await collaborationEngine.unlockPrivateSpace(cloudSpace.id, unlockPassword);
      setUnlockPassword('');
      setIsUnlocked(true);
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Wrong password. Private content was not loaded.');
    }
  };

  const handleLockSpace = () => {
    if (!cloudSpace) return;
    collaborationEngine.lockPrivateSpace(cloudSpace.id);
    setIsUnlocked(false);
  };

  const handleChangePassword = async () => {
    if (!cloudSpace || !oldPassword || !newPassword) return;
    setError(null);
    try {
      await collaborationEngine.changePrivateSpacePassword(cloudSpace.id, oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setIsUnlocked(true);
    } catch (err: any) {
      setError(err.message || 'Failed to change encryption password');
    }
  };

  const handleLinkSpace = async () => {
    if (!vaultPath || !selectedSpaceId) return;
    setError(null);
    setIsLinking(true);
    try {
      await collaborationEngine.linkSpaceToVault(selectedSpaceId, vaultPath);
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to link space');
    } finally {
      setIsLinking(false);
    }
  };

  const handleSendInvite = async () => {
    if (!cloudSpace || !inviteEmail.trim()) return;
    setError(null);
    try {
      await collaborationEngine.sendInvite(cloudSpace.id, inviteEmail.trim());
      setInviteEmail('');
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    }
  };

  const handleAcceptInvite = async (invite: SpaceInvite) => {
    setError(null);
    try {
      const result = await collaborationEngine.acceptInvite(invite.id);

      if (result.alreadyLinked && result.linkedVault) {
        // Already linked -- just open vault
        onVaultReconstructed?.(result.linkedVault.local_vault_path);
        await loadSpaceData(false);
        return;
      }

      // Need to select a folder and reconstruct
      const api = getAPI();
      const folderPath = await api.openVaultDialog();
      if (!folderPath) return;

      // Set main process vault path first!
      await api.setVaultPath(folderPath);

      // Download snapshot
      const snapshot = await collaborationEngine.getSpaceSnapshot(result.spaceId);

      // Reconstruct vault in background (App.tsx global overlay handles progress)
      await collaborationEngine.reconstructVault(result.spaceId, folderPath, snapshot);

      // Switch after reconstruction is fully completed!
      onVaultReconstructed?.(folderPath);

      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to accept invite');
    }
  };

  const handleRejectInvite = async (invite: SpaceInvite) => {
    try {
      await collaborationEngine.rejectInvite(invite.id);
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to reject invite');
    }
  };

  const handleRepairConnection = async () => {
    setError(null);
    try {
      await collaborationEngine.repairActiveConnection();
      await syncEngine.syncLocalFilesystemToDB(true);
      await syncEngine.sync();
      await loadSpaceData(false);
      setIsCollabActive(true);
    } catch (err: any) {
      setError(err.message || 'Failed to repair collaboration connection');
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const collabStateLabel =
    collabStatus.state === 'ready' ? 'Realtime ready' :
    collabStatus.state === 'syncing' ? 'Realtime syncing' :
    collabStatus.state === 'creating' ? 'Creating cloud space' :
    collabStatus.state === 'bootstrapping' ? 'Reconstructing vault' :
    collabStatus.state === 'error' ? 'Realtime error' :
    cloudSpace ? 'Realtime idle' : 'Not linked';

  const syncStateLabel =
    syncStatus?.state === 'syncing' ? 'Syncing changes' :
    syncStatus?.state === 'error' ? 'Sync error' :
    syncStatus?.state === 'idle' && syncStatus.lastSync ? `Last sync ${new Date(syncStatus.lastSync).toLocaleTimeString()}` :
    'Waiting for sync';

  const diagnostics = [
    { label: 'Space', value: cloudSpace ? cloudSpace.title : 'Not linked' },
    { label: 'Realtime', value: collabStateLabel },
    { label: 'Sync', value: syncStateLabel },
    { label: 'Encryption', value: cloudSpace ? (isUnlocked ? 'Unlocked locally' : 'Locked locally') : 'Not active' },
    { label: 'Collaborators', value: String(collaborators.length) },
    { label: 'Invites', value: `${invitesIn.length} incoming / ${invitesOut.filter(inv => inv.status === 'pending').length} pending` },
    { label: 'Vault', value: vaultPath || 'No vault open' },
  ];

  // ── Loading state ────────────────────────────────────────────────────────

  if (authLoading || isInitialLoading) {
    return (
      <div className={settingCenteredCardClass}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader size={24} className="animate-spin shrink-0 text-(--color-accent)" />
          <div className="text-sm font-medium text-(--text-primary)">Initializing collaboration...</div>
          <div className="text-xs text-(--text-muted)">Connecting to secure space service...</div>
        </div>
      </div>
    );
  }

  // ── Not logged in ────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className={settingCenteredCardClass}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Users size={32} strokeWidth={1.5} className="text-(--text-muted)" />
          <div className="text-sm font-medium text-(--text-primary)">Collaborate on Vaults</div>
          <div className="text-[12.5px] text-(--text-muted) max-w-[280px] leading-relaxed">
            Sign in to collaborate on vaults and share pages with other users in real time.
          </div>
          {onGoToAccount && (
            <button
              className={`${settingBtnSecondaryClass} mt-2`}
              onClick={onGoToAccount}
            >
              Go to Account Settings
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Creating space in progress ───────────────────────────────────────────

  if (collabStatus.state === 'creating') {
    const prog = collabStatus.progress;
    const pct = prog.total > 0 ? Math.round((prog.current / prog.total) * 100) : 0;
    return (
      <div className={settingCenteredCardClass}>
        <div className="flex flex-col items-center gap-3 text-center w-full max-w-[320px]">
          <CloudUpload size={24} className="animate-spin shrink-0 text-(--color-accent)" />
          <div className="text-sm font-medium text-(--text-primary)">Creating cloud space...</div>
          <div className="text-xs text-(--text-secondary)">{prog.message}</div>
          {prog.total > 0 && (
            <div className="w-full mt-1">
              <div className="h-1 bg-(--bg-active) rounded-sm overflow-hidden">
                <div className="h-full bg-(--color-accent) rounded-sm transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] text-(--text-muted) mt-1 font-medium">{pct}%</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main Panel ───────────────────────────────────────────────────────────

  return (
    <div className="collaboration-panel-container">
      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-red-500/[0.08] border border-red-500/20 rounded-md text-red-500 text-[12.5px] mb-4">
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="bg-transparent border-none text-inherit cursor-pointer flex p-0.5" aria-label="Dismiss error"><X size={12} /></button>
        </div>
      )}

      {/* Incoming Invites */}
      {invitesIn.length > 0 && (
        <div className="mb-6">
          <h3 className={settingGroupHeaderClass}>Incoming Invites</h3>
          <div className="flex flex-col gap-2 mt-3">
            {invitesIn.map(invite => (
              <div key={invite.id} className="flex items-center justify-between px-4 py-3 bg-(--bg-secondary) border border-(--border-subtle) rounded-md gap-4">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-(--text-primary) truncate">{invite.space_title}</div>
                  <div className="text-[11px] text-(--text-muted)">From: {invite.sender_email}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button className={`${settingBtnPrimaryClass} flex items-center gap-1 px-2.5 py-1 text-[11.5px]`} onClick={() => handleAcceptInvite(invite)}>
                    <Check size={12} /> Accept
                  </button>
                  <button className={`${settingBtnSecondaryClass} flex items-center gap-1 px-2.5 py-1 text-[11.5px]`} onClick={() => handleRejectInvite(invite)}>
                    <X size={12} /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cloud Space Status */}
      {!cloudSpace && vaultPath && (
        <div className="mb-6">
          <h3 className={settingGroupHeaderClass}>Setup Cloud Sharing</h3>
          <div className={settingCardClass}>
            <div className={settingInfoClass}>
              <div className={settingTitleWithIconClass}>
                <Cloud size={16} className={settingTitleIconClass} />
                <span>Create new cloud space</span>
              </div>
              <div className={settingDescriptionClass}>
                Establish a secure private space on the cloud to enable synchronization and invite users.
                Recovery warning: this password cannot be recovered.
              </div>
            </div>
            <div className={`${settingControlClass} gap-2`}>
              <input
                type="text"
                className={`${settingInputClass} w-[180px]`}
                placeholder="Space name..."
                value={spaceName}
                onChange={e => setSpaceName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && encryptionPassword.length >= 8) handleCreateSpace(); }}
              />
              <input
                type="password"
                className={`${settingInputClass} w-[210px]`}
                placeholder="Encryption password"
                value={encryptionPassword}
                onChange={e => setEncryptionPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && encryptionPassword.length >= 8) handleCreateSpace(); }}
              />
              <button
                className={`${settingBtnPrimaryClass} flex items-center gap-1`}
                onClick={handleCreateSpace}
                disabled={isCreating || !spaceName.trim() || encryptionPassword.length < 8}
              >
                {isCreating ? <Loader size={12} className="animate-spin" /> : <CloudUpload size={12} />} Create
              </button>
            </div>
          </div>

          {/* Link to an existing space */}
          {availableSpaces.length > 0 && (
            <div className={settingCardClass}>
              <div className={settingInfoClass}>
                <div className={settingTitleWithIconClass}>
                  <FolderOpen size={16} className={settingTitleIconClass} />
                  <span>Link existing cloud space</span>
                </div>
                <div className={settingDescriptionClass}>
                  Connect this local folder to a cloud space you are already a collaborator in.
                </div>
              </div>
              <div className={`${settingControlClass} gap-2`}>
                <select
                  className={`${settingSelectClass} w-[180px]`}
                  value={selectedSpaceId}
                  onChange={e => setSelectedSpaceId(e.target.value)}
                >
                  {availableSpaces.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.visibility})
                    </option>
                  ))}
                </select>
                <button
                  className={`${settingBtnSecondaryClass} flex items-center gap-1`}
                  onClick={handleLinkSpace}
                  disabled={isLinking || !selectedSpaceId}
                >
                  {isLinking ? <Loader size={12} className="animate-spin" /> : <Check size={12} />} Link
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {cloudSpace && (
        <>
          <h3 className={settingGroupHeaderClass}>Collaboration Diagnostics</h3>
          <div className="mb-6 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Activity size={15} className="shrink-0 text-[var(--color-accent)]" />
                <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">Live system status</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button className={`${settingBtnSecondaryClass} flex items-center gap-1.5`} onClick={() => loadSpaceData(false)} title="Refresh collaboration diagnostics">
                  <RefreshCw size={12} /> Refresh
                </button>
                <button className={`${settingBtnPrimaryClass} flex items-center gap-1.5`} onClick={handleRepairConnection} title="Reconnect realtime and run a full sync repair">
                  <Activity size={12} /> Repair
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-px bg-[var(--border-subtle)] sm:grid-cols-2">
              {diagnostics.map((item) => (
                <div key={item.label} className="min-w-0 bg-[var(--bg-secondary)] px-4 py-3">
                  <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">{item.label}</div>
                  <div className="truncate text-[12.5px] text-[var(--text-primary)]" title={item.value}>{item.value}</div>
                </div>
              ))}
            </div>
            {collabStatus.state === 'error' && (
              <div className="border-t border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[12.5px] text-red-500">
                {collabStatus.message}
              </div>
            )}
            {syncStatus?.state === 'error' && (
              <div className="border-t border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[12.5px] text-red-500">
                {syncStatus.error || 'Sync failed. Try refreshing after checking your connection.'}
              </div>
            )}
          </div>

          <h3 className={settingGroupHeaderClass}>Cloud Space Status</h3>
          <div className={settingCardClass}>
            <div className={settingInfoClass}>
              <div className={settingTitleWithIconClass}>
                {isUnlocked ? <Unlock size={16} className={`${settingTitleIconClass} text-emerald-500`} /> : <Lock size={16} className={`${settingTitleIconClass} text-yellow-500`} />}
                <span>{cloudSpace.title}</span>
              </div>
              <div className={`${settingDescriptionClass} mt-0.5 flex items-center gap-1.5`}>
                <span className={`inline-block w-2 h-2 rounded-full ${cloudSpace.status === 'ready' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : cloudSpace.status === 'processing' ? 'bg-yellow-500 animate-pulse' : 'bg-red-400'}`} />
                <span className="text-(--text-muted) text-[11px]">
                  {cloudSpace.status === 'ready' ? 'Connected and synced' : cloudSpace.status === 'processing' ? 'Uploading snapshot...' : 'Offline / Error'}
                </span>
              </div>
            </div>
            <div className={settingControlClass}>
              <button className={`${settingBtnSecondaryClass} flex items-center gap-1.5`} onClick={() => loadSpaceData(false)} title="Refresh collaboration data">
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>

          <div className={settingCardClass}>
            <div className={settingInfoClass}>
              <div className={settingTitleClass}>Private Space Encryption</div>
              <div className={settingDescriptionClass}>
                {isUnlocked ? 'Unlocked locally. Supabase only receives encrypted notes and encrypted realtime payloads.' : 'Locked. Unlock this private space to sync content, collaborate, search, or use AI.'}
              </div>
            </div>
            <div className={`${settingControlClass} flex-wrap gap-2`}>
              {isUnlocked ? (
                <button className={`${settingBtnSecondaryClass} flex items-center gap-1`} onClick={handleLockSpace}>
                  <Lock size={12} /> Lock Space
                </button>
              ) : (
                <>
                  <input
                    type="password"
                    className={`${settingInputClass} w-[210px]`}
                    placeholder="Encryption password"
                    value={unlockPassword}
                    onChange={e => setUnlockPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleUnlockSpace(); }}
                  />
                  <button className={`${settingBtnPrimaryClass} flex items-center gap-1`} onClick={handleUnlockSpace} disabled={!unlockPassword}>
                    <Unlock size={12} /> Unlock Space
                  </button>
                </>
              )}
            </div>
          </div>

          {isUnlocked && cloudSpace.owner_id === user.id && (
            <div className={settingCardClass}>
              <div className={settingInfoClass}>
                <div className={settingTitleClass}>Change Password</div>
                <div className={settingDescriptionClass}>
                  Re-encrypts the same space key. Existing notes are not re-encrypted.
                </div>
              </div>
              <div className={`${settingControlClass} flex-wrap gap-2`}>
                <input type="password" className={`${settingInputClass} w-[170px]`} placeholder="Old password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
                <input type="password" className={`${settingInputClass} w-[170px]`} placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <button className={`${settingBtnSecondaryClass} flex items-center gap-1`} onClick={handleChangePassword} disabled={!oldPassword || newPassword.length < 8}>
                  <KeyRound size={12} /> Change
                </button>
              </div>
            </div>
          )}

          {/* Local collaboration active toggle card */}
          <div className={settingCardClass}>
            <div className={settingInfoClass}>
              <div className={settingTitleClass}>Enable Collaboration</div>
              <div className={settingDescriptionClass}>
                Temporarily pause or resume real-time collaboration and presence syncing for yourself.
              </div>
            </div>
            <div className={settingControlClass}>
              <label className={settingToggleClass}>
                <input
                  className={settingToggleInputClass}
                  type="checkbox"
                  checked={isCollabActive}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsCollabActive(checked);
                    collaborationEngine.setCollabPaused(!checked);
                  }}
                />
                <span className={toggleSliderClass} />
              </label>
            </div>
          </div>

          {/* Invite & Management */}
          {cloudSpace.status === 'ready' && (
            <div className={settingCardClass}>
              <div className={settingInfoClass}>
                <div className={settingTitleClass}>Invite collaborators</div>
                <div className={settingDescriptionClass}>
                  {cloudSpace.owner_id === user.id ? 'Invite members by entering their email address.' : 'Only the space owner can invite new collaborators.'}
                </div>
              </div>
              <div className={settingControlClass}>
                {cloudSpace.owner_id === user.id ? (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      className={`${settingInputClass} w-[180px]`}
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendInvite(); }}
                    />
                    <button className={settingBtnPrimaryClass} onClick={handleSendInvite} disabled={!inviteEmail.trim()}>
                      Invite
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-(--text-muted) italic">View only</span>
                )}
              </div>
            </div>
          )}

          {/* Sent Invites List */}
          {invitesOut.filter(inv => inv.status === 'pending').length > 0 && (
            <div className="mt-3 p-3 px-4 bg-(--bg-secondary) border border-(--border-subtle) rounded-md">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-(--text-muted) mb-2">Pending Invites</div>
              <div className="flex flex-col gap-1.5">
                {invitesOut.filter(inv => inv.status === 'pending').map(inv => (
                  <div key={inv.id} className="flex items-center justify-between text-[12.5px] py-1">
                    <span className="text-(--text-secondary)">{inv.receiver_email}</span>
                    <span className="text-[10.5px] px-2 py-0.5 rounded-xl font-medium capitalize bg-yellow-500/[0.12] text-yellow-500">
                      {inv.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Collaborators */}
          <div className="mt-6">
            <h3 className={settingGroupHeaderClass}>Collaborators ({collaborators.length})</h3>
            <div className="flex flex-col gap-2 mt-3">
              {collaborators.length === 0 ? (
                <div className="p-4 text-center text-(--text-muted) text-[12.5px] bg-(--bg-secondary) border border-(--border-subtle) rounded-md">No collaborators yet.</div>
              ) : (
                collaborators.map(c => {
                  const isOwner = c.role === 'owner';
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5 bg-(--bg-secondary) border border-(--border-subtle) rounded-md">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border border-(--border-medium) ${isOwner ? 'bg-(--color-accent) text-(--text-on-accent)' : 'bg-(--bg-active) text-(--text-muted)'}`}>
                        {(c.email || c.user_id || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col gap-px min-w-0 flex-1">
                        <span className="text-[13px] text-(--text-primary) truncate">{c.email || c.user_id}</span>
                        <span className="text-[11px] text-(--text-muted) capitalize">{c.role}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
