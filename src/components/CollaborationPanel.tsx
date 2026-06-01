/**
 * CollaborationPanel -- Full collaboration UI for OpenObsidian.
 *
 * Owner flow: Create cloud space -> upload vault -> invite collaborators
 * Receiver flow: View invites -> accept -> select folder -> bootstrap vault
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud, CloudUpload, Users, UserPlus, Check, X, RefreshCw,
  FolderOpen, Loader, AlertCircle, Send, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  collaborationEngine,
  type CloudSpace, type SpaceInvite, type SpaceCollaborator,
  type CollabStatus,
} from '../lib/collaborationEngine';
import { authManager } from '../lib/auth';
import { getAPI } from '../utils/api';

interface CollaborationPanelProps {
  vaultPath: string | null;
  onVaultReconstructed?: (path: string) => void;
  isSettingsMode?: boolean;
  onGoToAccount?: () => void;
}

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
  const [cloudSpace, setCloudSpace] = useState<CloudSpace | null>(null);
  const [invitesIn, setInvitesIn] = useState<SpaceInvite[]>([]);
  const [invitesOut, setInvitesOut] = useState<SpaceInvite[]>([]);
  const [collaborators, setCollaborators] = useState<SpaceCollaborator[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [spaceName, setSpaceName] = useState('');
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

  useEffect(() => { loadSpaceData(true); }, [loadSpaceData]);

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
      await collaborationEngine.createCloudSpace(spaceName.trim(), vaultPath);
      await loadSpaceData(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create cloud space');
    } finally {
      setIsCreating(false);
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

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (authLoading || isInitialLoading) {
    return (
      <div className="setting-card" style={{ justifyContent: 'center', padding: '40px 0', border: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
          <Loader size={24} className="collab-spinner" style={{ animation: 'collab-spin 1s linear infinite', color: 'var(--color-accent)' }} />
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Initializing collaboration...</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Connecting to secure space service...</div>
        </div>
      </div>
    );
  }

  // ── Not logged in ────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="setting-card" style={{ justifyContent: 'center', padding: '40px 0', border: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
          <Users size={32} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Collaborate on Vaults</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.5' }}>
            Sign in to collaborate on vaults and share pages with other users in real time.
          </div>
          {onGoToAccount && (
            <button
              className="setting-btn-secondary"
              onClick={onGoToAccount}
              style={{ marginTop: '8px' }}
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
      <div className="setting-card" style={{ justifyContent: 'center', padding: '40px 0', border: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center', width: '100%', maxWidth: '320px' }}>
          <CloudUpload size={24} className="collab-spinner" style={{ animation: 'collab-spin 1s linear infinite', color: 'var(--color-accent)' }} />
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Creating cloud space...</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{prog.message}</div>
          {prog.total > 0 && (
            <div style={{ width: '100%', marginTop: '4px' }}>
              <div className="collab-progress-bar" style={{ height: '4px', background: 'var(--bg-active)', borderRadius: '2px', overflow: 'hidden' }}>
                <div className="collab-progress-fill" style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)', borderRadius: '2px', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>{pct}%</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main Panel ───────────────────────────────────────────────────────────
 
  if (cloudSpace && cloudSpace.visibility === 'private') {
    return (
      <div className="collaboration-panel-container">
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12.5px', marginBottom: '16px' }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: '2px' }} aria-label="Dismiss error"><X size={12} /></button>
          </div>
        )}
        
        <h3 className="setting-group-header">Cloud Space Status</h3>
        <div className="setting-card">
          <div className="setting-info">
            <div className="setting-title-with-icon">
              <Cloud size={16} className="setting-title-icon" style={{ color: 'var(--color-accent)' }} />
              <span>{cloudSpace.title}</span>
            </div>
            <div className="setting-description" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span className={`collab-status-dot collab-status-ready`} style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px rgba(16, 185, 129, 0.4)' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                Zero-Knowledge Encrypted (E2EE)
              </span>
            </div>
          </div>
          <div className="setting-control">
            <button className="setting-btn-secondary" onClick={() => loadSpaceData(false)} title="Refresh collaboration data" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className="setting-card" style={{ padding: '24px 16px', background: 'rgba(59, 130, 246, 0.04)', border: '1px dashed var(--color-accent)', borderRadius: '6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <Users size={24} style={{ color: 'var(--color-accent)' }} />
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>End-to-End Encrypted Space</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '280px', lineHeight: '1.5' }}>
            Realtime collaboration for encrypted spaces is coming soon. Your notes are safely encrypted locally before being synchronized to the cloud.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="collaboration-panel-container">
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', color: '#ef4444', fontSize: '12.5px', marginBottom: '16px' }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: '2px' }} aria-label="Dismiss error"><X size={12} /></button>
        </div>
      )}

      {/* Incoming Invites */}
      {invitesIn.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 className="setting-group-header">Incoming Invites</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {invitesIn.map(invite => (
              <div key={invite.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{invite.space_title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>From: {invite.sender_email}</div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button className="setting-btn-primary" onClick={() => handleAcceptInvite(invite)} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', padding: '4px 10px' }}>
                    <Check size={12} /> Accept
                  </button>
                  <button className="setting-btn-secondary" onClick={() => handleRejectInvite(invite)} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', padding: '4px 10px' }}>
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
        <div style={{ marginBottom: '24px' }}>
          <h3 className="setting-group-header">Setup Cloud Sharing</h3>
          <div className="setting-card">
            <div className="setting-info">
              <div className="setting-title-with-icon">
                <Cloud size={16} className="setting-title-icon" />
                <span>Create new cloud space</span>
              </div>
              <div className="setting-description">
                Establish a secure private space on the cloud to enable synchronization and invite users.
              </div>
            </div>
            <div className="setting-control" style={{ gap: '8px' }}>
              <input
                type="text"
                className="setting-input"
                style={{ width: '180px' }}
                placeholder="Space name..."
                value={spaceName}
                onChange={e => setSpaceName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateSpace(); }}
              />
              <button
                className="setting-btn-primary"
                onClick={handleCreateSpace}
                disabled={isCreating || !spaceName.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {isCreating ? <Loader size={12} className="collab-spinner" style={{ animation: 'collab-spin 1s linear infinite' }} /> : <CloudUpload size={12} />} Create
              </button>
            </div>
          </div>

          {/* Link to an existing space */}
          {availableSpaces.length > 0 && (
            <div className="setting-card">
              <div className="setting-info">
                <div className="setting-title-with-icon">
                  <FolderOpen size={16} className="setting-title-icon" />
                  <span>Link existing cloud space</span>
                </div>
                <div className="setting-description">
                  Connect this local folder to a cloud space you are already a collaborator in.
                </div>
              </div>
              <div className="setting-control" style={{ gap: '8px' }}>
                <select
                  className="setting-select"
                  value={selectedSpaceId}
                  onChange={e => setSelectedSpaceId(e.target.value)}
                  style={{ width: '180px' }}
                >
                  {availableSpaces.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.visibility})
                    </option>
                  ))}
                </select>
                <button
                  className="setting-btn-secondary"
                  onClick={handleLinkSpace}
                  disabled={isLinking || !selectedSpaceId}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {isLinking ? <Loader size={12} className="collab-spinner" style={{ animation: 'collab-spin 1s linear infinite' }} /> : <Check size={12} />} Link
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {cloudSpace && (
        <>
          <h3 className="setting-group-header">Cloud Space Status</h3>
          <div className="setting-card">
            <div className="setting-info">
              <div className="setting-title-with-icon">
                <Cloud size={16} className="setting-title-icon" style={{ color: cloudSpace.status === 'ready' ? '#10b981' : '#eab308' }} />
                <span>{cloudSpace.title}</span>
              </div>
              <div className="setting-description" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span className={`collab-status-dot collab-status-${cloudSpace.status}`} style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: cloudSpace.status === 'ready' ? '#10b981' : cloudSpace.status === 'processing' ? '#eab308' : '#d76464', boxShadow: cloudSpace.status === 'ready' ? '0 0 6px rgba(16, 185, 129, 0.4)' : 'none' }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  {cloudSpace.status === 'ready' ? 'Connected and synced' : cloudSpace.status === 'processing' ? 'Uploading snapshot...' : 'Offline / Error'}
                </span>
              </div>
            </div>
            <div className="setting-control">
              <button className="setting-btn-secondary" onClick={() => loadSpaceData(false)} title="Refresh collaboration data" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>

          {/* Local collaboration active toggle card */}
          <div className="setting-card">
            <div className="setting-info">
              <div className="setting-title">Enable Collaboration</div>
              <div className="setting-description">
                Temporarily pause or resume real-time collaboration and presence syncing for yourself.
              </div>
            </div>
            <div className="setting-control">
              <label className="setting-toggle">
                <input
                  type="checkbox"
                  checked={isCollabActive}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsCollabActive(checked);
                    collaborationEngine.setCollabPaused(!checked);
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Invite & Management */}
          {cloudSpace.status === 'ready' && (
            <div className="setting-card">
              <div className="setting-info">
                <div className="setting-title">Invite collaborators</div>
                <div className="setting-description">
                  {cloudSpace.owner_id === user.id ? 'Invite members by entering their email address.' : 'Only the space owner can invite new collaborators.'}
                </div>
              </div>
              <div className="setting-control">
                {cloudSpace.owner_id === user.id ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="email"
                      className="setting-input"
                      style={{ width: '180px' }}
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendInvite(); }}
                    />
                    <button className="setting-btn-primary" onClick={handleSendInvite} disabled={!inviteEmail.trim()}>
                      Invite
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>View only</span>
                )}
              </div>
            </div>
          )}

          {/* Sent Invites List */}
          {invitesOut.filter(inv => inv.status === 'pending').length > 0 && (
            <div style={{ marginTop: '12px', padding: '12px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '8px' }}>Pending Invites</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {invitesOut.filter(inv => inv.status === 'pending').map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px', padding: '4px 0' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{inv.receiver_email}</span>
                    <span className={`collab-invite-status collab-invite-${inv.status}`} style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px', fontWeight: 500, textTransform: 'capitalize', background: 'rgba(234, 179, 8, 0.12)', color: '#eab308' }}>
                      {inv.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Collaborators */}
          <div style={{ marginTop: '24px' }}>
            <h3 className="setting-group-header">Collaborators ({collaborators.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              {collaborators.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>No collaborators yet.</div>
              ) : (
                collaborators.map(c => {
                  const isOwner = c.role === 'owner';
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
                      <div className="collab-avatar" style={{ width: '28px', height: '28px', borderRadius: '50%', background: isOwner ? 'var(--color-accent)' : 'var(--bg-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: isOwner ? 'var(--text-on-accent)' : 'var(--text-muted)', border: '1px solid var(--border-medium)' }}>
                        {(c.email || c.user_id || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || c.user_id}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{c.role}</span>
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
