import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DriveStatus } from '../../../electron/googleDriveTypes';
import { getAPI } from '../../utils/api';
import { driveResourceError, driveConnectionError } from '../../utils/googleDriveProvider';
import { AppIcon } from '../settings/components/connections/AppIcon';

export function DriveAppPage({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), connecting = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = getAPI().googleDrive.onStatusChanged?.(value => {
      if (alive.current) setStatus(value);
      window.dispatchEvent(new Event('openonyx:apps-changed'));
    });
    getAPI().googleDrive.status().then(value => { if (alive.current) setStatus(value); }).catch(() => { if (alive.current) setError('Could not check Google Drive.'); });
    return () => { alive.current = false; unsubscribe?.(); if (connecting.current) void getAPI().googleDrive.cancelConnect(); };
  }, []);
  const action = async (disconnectId?: string) => {
    setBusy(true); setError(''); connecting.current = !disconnectId;
    try {
      if (disconnectId) await getAPI().googleDrive.disconnect(disconnectId); else await getAPI().googleDrive.connect();
      const updated = await getAPI().googleDrive.status();
      if (alive.current) setStatus(updated);
      window.dispatchEvent(new Event('openonyx:apps-changed'));
    } catch (failure) { if (alive.current) setError(disconnectId ? driveResourceError(failure) : driveConnectionError(failure)); }
    finally { connecting.current = false; if (alive.current) setBusy(false); }
  };
  return <div className='mx-auto flex w-full max-w-3xl flex-col gap-7 pb-8'>
    <button type='button' className='inline-flex self-start items-center gap-1.5 text-sm text-[var(--text-muted)]' onClick={onBack}><ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" /> Apps</button>
    <header className='flex items-center gap-4'><AppIcon icon='google-drive' className='h-12 w-12' /><div><h1 className='text-xl font-semibold'>Google Drive</h1><p className='mt-1 text-sm text-[var(--text-muted)]'>Bring documents and files into your local notes.</p></div></header>
    {status?.accounts.length ? status.accounts.map(account => <div key={account.id} className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3'><span className='text-sm'>{account.email || account.name}<small className='ml-3 text-[var(--text-muted)]'>{account.needsReconnect ? 'Needs reconnection' : '✓ Connected'}</small></span><div className='flex gap-3'>{account.needsReconnect && <button type='button' disabled={busy} className='app-resource-primary' onClick={() => void action()}>Reconnect</button>}<button type='button' disabled={busy} className='app-resource-secondary' onClick={() => void action(account.id)}>Disconnect</button></div></div>) : <section>
      {!status && <p role='status' className='text-sm text-[var(--text-muted)]'>Checking connection…</p>}
      {status && !status.configured && <p className='mb-4 text-sm text-[var(--text-muted)]'>Google sign-in is not configured for this build yet. The app maintainer needs to configure Google authorization.</p>}
      {status?.configured && !status.secureStorage && <p className='mb-4 text-sm text-[var(--text-muted)]'>Secure system credential storage is unavailable on this computer.</p>}
      {status?.connectionState === 'needs-reconnection' && <p className='mb-4 text-sm text-[var(--text-muted)]'>Reconnect Google Drive to continue. Your saved resources remain readable.</p>}
      <button type='button' className='app-resource-primary' disabled={busy || !status?.configured || !status.secureStorage} onClick={() => void action()}>{busy ? 'Connecting…' : 'Connect'}</button>
    </section>}
    {busy && connecting.current && <p role='status' className='text-sm text-[var(--text-muted)]'>Continue in your browser. <button type='button' className='app-resource-secondary ml-3' onClick={() => void getAPI().googleDrive.cancelConnect()}>Cancel</button></p>}
    {error && <p role='alert' className='text-sm text-[var(--text-secondary)]'>{error}</p>}
    <section><h2 className='mb-3 text-xs uppercase tracking-wider text-[var(--text-muted)]'>Works in OpenOnyx</h2><p className='text-sm'>Type / in a note and choose Google Drive to search and insert a file.</p><p className='mt-2 text-sm text-[var(--text-muted)]'>Read-only previews are available for PDFs, Docs, Sheets, Slides, text, Markdown and common images. Other files keep their details and a link to the original.</p></section>
    <section><h2 className='mb-3 text-xs uppercase tracking-wider text-[var(--text-muted)]'>Permissions</h2><p className='text-sm'>Read files and document previews. No write access.</p><p className='mt-2 text-sm text-[var(--text-muted)]'>OpenOnyx asks before requesting Drive data. Selected snapshots are stored with your local note and remain readable after disconnecting.</p></section>
  </div>;
}
