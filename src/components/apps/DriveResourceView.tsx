import React, { useEffect, useRef, useState } from 'react';
import type { DriveResource, ExternalResource } from '../../types/appResources';
import { createDriveProvider, DRIVE_TYPE_NAMES, driveResourceTypeName, driveResourceError } from '../../utils/googleDriveProvider';
import { getAPI } from '../../utils/api';
import { rememberResource } from '../../utils/appResources';
import { ResourceDialog } from './ResourceDialog';
import { createDriveFilePreview } from './DriveFilePreview';

export function DriveResourceView({ resource: initial, onClose, onUpdate, refreshRequested = false }: { resource: DriveResource; onClose: () => void; onUpdate?: (resource: ExternalResource) => void; refreshRequested?: boolean }) {
  const [resource, setResource] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [error, setError] = useState('');
  const alive = useRef(true), started = useRef(false);
  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const updated = await createDriveProvider(resource.serverId).refresh(resource);
      if (alive.current) { setResource(updated); setPreviewVersion(version => version + 1); rememberResource(updated); onUpdate?.(updated); }
    } catch (failure) { if (alive.current) setError(`${driveResourceError(failure)} Showing the saved snapshot.`); }
    finally { if (alive.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; if (refreshRequested && !started.current) { started.current = true; void refresh(); } return () => { alive.current = false; }; }, [refreshRequested]);
  return <ResourceDialog title={resource.title} onClose={onClose} className="drive-document-dialog" headerActions={<>
    <button type='button' className='text-xs' onClick={() => { void getAPI().openExternal(resource.url); }}>Open ↗</button>
    <details className='drive-focused-menu'><summary aria-label='Document actions'>⋯</summary><div><button type='button' disabled={busy} onClick={() => void refresh()}>Refresh</button><button type='button' onClick={() => void navigator.clipboard.writeText(resource.url)}>Copy link</button></div></details>
  </>}>
    <section className='drive-focused-preview'>
      {resource.resourceType === 'folder' ? <div className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-secondary)]'>{resource.body || 'Open this folder in Google Drive to view its contents.'}</div> : <DrivePreviewMount resource={resource} refreshVersion={previewVersion} />}
    </section>
    <details className='drive-document-details'><summary>Document details</summary><dl className='grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm'>
      <dt>Type</dt><dd>{driveResourceTypeName(resource)}</dd>
      {resource.owner && <><dt>Owner</dt><dd className='break-words'>{resource.owner}</dd></>}
      {resource.updatedAt && <><dt>Modified</dt><dd>{new Date(resource.updatedAt).toLocaleString()}</dd></>}
      {resource.size !== undefined && <><dt>Size</dt><dd>{(resource.size / 1048576).toFixed(1)} MB</dd></>}
      <dt>Last cached</dt><dd>{new Date(resource.cachedAt).toLocaleString()}</dd>
    </dl></details>
    {error && <p role='alert' className='mt-4 text-sm text-[var(--text-secondary)]'>{error}</p>}
  </ResourceDialog>;
}

function DrivePreviewMount({ resource, refreshVersion }: { resource: DriveResource; refreshVersion: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const preview = createDriveFilePreview(resource);
    target.replaceChildren(preview);
    if (refreshVersion > 0) preview.dispatchEvent(new Event('file-preview:refresh'));
    return () => target.replaceChildren();
  }, [resource, refreshVersion]);
  return <div ref={host} />;
}
