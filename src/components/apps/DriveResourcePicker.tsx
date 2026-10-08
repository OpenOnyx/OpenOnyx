import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, File, Sheet, Presentation, Folder } from 'lucide-react';
import type { DriveStatus } from '../../../electron/googleDriveTypes';
import type { DriveResource, DriveResourceType } from '../../types/appResources';
import { getAPI } from '../../utils/api';
import { recentResources, rememberResource } from '../../utils/appResources';
import { createDriveProvider, DRIVE_TYPE_NAMES, driveResourceTypeName, driveResourceError, driveConnectionError } from '../../utils/googleDriveProvider';
import { ExternalResourcePicker, type ResourceBrowser } from './ExternalResourcePicker';
import { ResourceDialog } from './ResourceDialog';

export function DriveResourcePicker({ onClose, onSelect, initialServerId }: { onClose: () => void; onSelect: (resource: DriveResource) => void; initialServerId?: string }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [accountId, setAccountId] = useState(initialServerId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const connecting = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = getAPI().googleDrive.onStatusChanged?.(value => { if (alive.current) setStatus(value); });
    getAPI().googleDrive.status().then(value => { if (alive.current) { setStatus(value); setAccountId(value.accounts.find(account => account.id === initialServerId)?.id || value.accounts[0]?.id || ''); } }).catch(() => { if (alive.current) setError('Could not check Google Drive. Try again in Apps.'); });
    return () => { alive.current = false; unsubscribe?.(); if (connecting.current) void getAPI().googleDrive.cancelConnect(); };
  }, [initialServerId]);
  const provider = useMemo(() => accountId ? createDriveProvider(accountId) : null, [accountId]);
  const account = status?.accounts.find(account => account.id === accountId);
  const connect = async () => {
    setBusy(true); setError(''); connecting.current = true;
    try {
      const result = await getAPI().googleDrive.connect();
      if (!alive.current) return;
      setStatus(await getAPI().googleDrive.status()); setAccountId(result.id);
      window.dispatchEvent(new Event('openonyx:apps-changed'));
    } catch (failure) { if (alive.current) setError(driveConnectionError(failure)); }
    finally { connecting.current = false; if (alive.current) setBusy(false); }
  };
  const browser: ResourceBrowser<DriveResource> | null = useMemo(() => provider ? {
    name: 'Google Drive', searchPlaceholder: 'Search Drive…', searchHint: 'Find a file by name, then press Enter to search your Drive.',
    filters: [{ id: 'everything', label: 'Everything' }, { id: 'document', label: 'Docs' }, { id: 'pdf', label: 'PDFs' }, { id: 'spreadsheet', label: 'Sheets' }, { id: 'presentation', label: 'Slides' }],
    recent: recentResources(accountId).filter((resource): resource is DriveResource => resource.appId === 'google-drive'),
    search: (query, kind) => provider.search(query, kind as DriveResourceType | 'everything'),
    matchesFilter: (resource, kind) => kind === 'everything' || kind === resource.resourceType,
    row: resource => ({ title: resource.title, subtitle: [driveResourceTypeName(resource), resource.updatedAt ? `Modified ${new Date(resource.updatedAt).toLocaleDateString()}` : '', resource.size !== undefined ? `${(resource.size / 1048576).toFixed(1)} MB` : '', resource.owner || ''].filter(Boolean).join(' · '), icon: resource.resourceType === 'document' ? <FileText size={17} /> : resource.resourceType === 'spreadsheet' ? <Sheet size={17} /> : resource.resourceType === 'presentation' ? <Presentation size={17} /> : resource.resourceType === 'folder' ? <Folder size={17} /> : <File size={17} /> }),
    error: driveResourceError,
  } : null, [provider, accountId]);
  const choose = async (resource: DriveResource) => {
    if (!provider || busy) return;
    setBusy(true); setError('');
    try {
      const full = await provider.getResource(resource.externalId);
      if (alive.current) { rememberResource(full); onSelect(full); }
    } catch (failure) { if (alive.current) setError(driveResourceError(failure)); }
    finally { if (alive.current) setBusy(false); }
  };
  if (!account || account.needsReconnect || !browser || busy || error) return <ResourceDialog title='Google Drive' onClose={onClose}>
    <p className='text-sm text-[var(--text-secondary)]'>{busy ? connecting.current ? 'Finish connecting in your browser…' : 'Preparing your document…' : 'Access files from your Google Drive and bring them into your notes.'}</p>
    {!status && !error && <p role='status' className='mt-3 text-sm text-[var(--text-muted)]'>Checking connection…</p>}
    {busy && connecting.current && <button type='button' className='app-resource-secondary mt-3' onClick={() => void getAPI().googleDrive.cancelConnect()}>Cancel connection</button>}
    {status && (!account || account.needsReconnect) && <>
      {account?.needsReconnect && <p role='status' className='mt-4 text-sm text-[var(--text-muted)]'>Your Google Drive authorization expired. Reconnect to continue.</p>}
      {!status.configured && <p role='status' className='mt-4 text-sm text-[var(--text-muted)]'>Google sign-in is not configured for this build yet. The app maintainer needs to configure Google authorization.</p>}
      {status.configured && !status.secureStorage && <p role='status' className='mt-4 text-sm text-[var(--text-muted)]'>Secure system credential storage is unavailable. Connect after it is enabled on this computer.</p>}
      <button type='button' className='app-resource-primary mt-5' disabled={busy || !status.configured || !status.secureStorage} onClick={() => void connect()}>{account?.needsReconnect ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
      <p className='mt-3 text-xs text-[var(--text-muted)]'>Read-only access. OpenOnyx cannot edit your Drive files.</p>
    </>}
    {error && <div role='alert' className='mt-4 text-sm text-[var(--text-secondary)]'>{error}{account && <button type='button' className='mt-4 block' onClick={() => setError('')}>Back to files</button>}</div>}
  </ResourceDialog>;
  const connection = status!.accounts.length > 1 ? <label className='resource-browser-connection'><span className='sr-only'>Google account</span><select value={accountId} onChange={event => setAccountId(event.target.value)}>{status!.accounts.map(value => <option key={value.id} value={value.id}>{value.email}</option>)}</select></label> : <p className='resource-browser-connection'>{account.email}</p>;
  return <ExternalResourcePicker key={accountId} browser={browser} connectionControl={connection} onClose={onClose} onSelect={resource => void choose(resource)} />;
}
