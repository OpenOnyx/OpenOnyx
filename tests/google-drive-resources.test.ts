// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseExternalResource, rememberResource, recentResources, resourceBlocks, serializeExternalResource } from '../src/utils/appResources';
import { createResourceCard } from '../src/components/apps/ResourceCard';
import { appResourceExtension } from '../src/editor/appResourceExtension';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { DriveResource } from '../src/types/appResources';
import { createDriveProvider, driveResourceError } from '../src/utils/googleDriveProvider';
import { DriveResourcePicker } from '../src/components/apps/DriveResourcePicker';
import { DriveResourceView } from '../src/components/apps/DriveResourceView';
import { connectedResourceApps } from '../src/utils/resourceBrowserRegistry';
const api = vi.hoisted(() => ({ googleDrive: { status: vi.fn(), connect: vi.fn(), cancelConnect: vi.fn(), search: vi.fn(), getResource: vi.fn() }, mcp: { list: vi.fn() }, openExternal: vi.fn() }));
vi.mock('../src/utils/api', () => ({ getAPI: () => api }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const resource: DriveResource = { version: 1, appId: 'google-drive', serverId: 'drive-' + 'a'.repeat(24), resourceType: 'document', externalId: 'file_123', title: 'Project proposal', url: 'https://docs.google.com/document/d/file_123/edit', mimeType: 'application/vnd.google-apps.document', body: '<script>untrusted()</script>\nUseful plain preview', cachedAt: '2026-10-02T08:00:00Z' };
afterEach(() => { vi.clearAllMocks(); localStorage.clear(); document.body.replaceChildren(); });

it('explains incomplete sign-in setup instead of sending the user through repeated reconnects', () => {
  expect(driveResourceError(new Error('Google authorization configuration is missing the desktop client secret. Ask the app maintainer to configure it.'))).toContain('setup is incomplete');
  expect(driveResourceError(new Error('Google authorization client configuration was rejected.'))).toContain('sign-in configuration');
});

it('uses the existing versioned resource block for Drive and drops token fields', () => {
  const markdown = serializeExternalResource({ ...resource, access_token: 'private', refreshToken: 'private', display: 'reference' } as DriveResource);
  const loaded = resourceBlocks(markdown);
  expect(loaded).toHaveLength(1); expect(loaded[0].resource).toMatchObject({ appId: 'google-drive', externalId: resource.externalId, display: 'reference' });
  expect(markdown).not.toContain('private');
  expect(parseExternalResource({ ...resource, url: 'javascript:alert(1)' })).toBeNull();
  expect(parseExternalResource({ ...resource, externalId: '../secrets' })).toBeNull();
  rememberResource(resource); expect(recentResources(resource.serverId)[0].body).toBeUndefined();
});
it('restores a Drive snapshot from disk in the same editor extension without network access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-drive-note-')); const host = document.createElement('div'); document.body.append(host);
  let view: EditorView | undefined;
  try {
    await writeFile(join(directory, 'note.md'), '# Plan\n\n' + serializeExternalResource(resource) + '\n\nContinue writing.');
    view = new EditorView({ parent: host, state: EditorState.create({ doc: await readFile(join(directory, 'note.md'), 'utf8'), extensions: [appResourceExtension()] }) });
    expect(host.querySelector('.app-resource-title')?.textContent).toBe(resource.title);
    expect(host.querySelector('script')).toBeNull(); expect(view.state.doc.toString()).toContain('Continue writing.');
    expect(api.googleDrive.getResource).not.toHaveBeenCalled();
  } finally { view?.destroy(); await rm(directory, { recursive: true, force: true }); }
});
it('renders embed/reference, retains identity, and opens only through the native link boundary', () => {
  const update = vi.fn(); const card = createResourceCard(resource, vi.fn(), { update });
  expect(card.textContent).toContain('Google Docs'); expect(card.querySelector('script')).toBeNull();
  [...card.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Display as reference')!.click();
  expect(update.mock.calls[0][0]).toMatchObject({ externalId: resource.externalId, display: 'reference' });
  expect(createResourceCard(update.mock.calls[0][0], vi.fn()).className).toContain('app-resource-reference');
  [...card.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'Open in Google Drive')!.click();
  expect(api.openExternal).toHaveBeenCalledWith(resource.url);
});
it('refreshes through the native provider and preserves reference presentation', async () => {
  api.googleDrive.getResource.mockResolvedValue({ id: resource.externalId, accountId: resource.serverId, name: 'Updated proposal', kind: 'document', mimeType: resource.mimeType, preview: 'Updated plain text', cachedAt: resource.cachedAt, url: resource.url });
  const updated = await createDriveProvider(resource.serverId).refresh({ ...resource, display: 'reference' });
  expect(updated).toMatchObject({ title: 'Updated proposal', body: 'Updated plain text', display: 'reference', externalId: resource.externalId });
  expect(api.googleDrive.getResource).toHaveBeenCalledWith(resource.serverId, resource.externalId);
});
it('offers the real connection boundary in slash registration without inventing an account', async () => {
  api.mcp.list.mockResolvedValue([]); api.googleDrive.status.mockResolvedValue({ configured: false, secureStorage: true, accounts: [] });
  expect(await connectedResourceApps()).toContainEqual({ id: 'google-drive', name: 'Google Drive', serverId: '' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(DriveResourcePicker, { onClose: vi.fn(), onSelect: vi.fn() })));
    expect(document.body.textContent).toContain('not configured');
    const connect = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Connect Google Drive')!;
    expect(connect.disabled).toBe(true); expect(api.googleDrive.connect).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
it('keeps the cached preview after access loss without overwriting the note', async () => {
  api.googleDrive.getResource.mockRejectedValue(new Error('Resource unavailable.'));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), update = vi.fn();
  try {
    await act(async () => root.render(React.createElement(DriveResourceView, { resource, onClose: vi.fn(), onUpdate: update, refreshRequested: true })));
    expect(document.body.textContent).toContain('Resource unavailable'); expect(document.body.textContent).toContain('Useful plain preview');
    expect(document.querySelector('script')).toBeNull(); expect(update).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('reuses picker focus, arrow navigation, Enter insertion and Escape dismissal for Drive', async () => {
  api.googleDrive.status.mockResolvedValue({ configured: true, secureStorage: true, accounts: [{ id: resource.serverId, email: 'reader@example.com', name: 'Reader' }] });
  api.googleDrive.getResource.mockResolvedValue({ id: resource.externalId, accountId: resource.serverId, name: resource.title, kind: resource.resourceType, mimeType: resource.mimeType, url: resource.url, cachedAt: resource.cachedAt, preview: 'Document preview' });
  rememberResource(resource);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), select = vi.fn(), close = vi.fn();
  try {
    await act(async () => root.render(React.createElement(DriveResourcePicker, { onClose: close, onSelect: select })));
    const search = document.querySelector<HTMLInputElement>('[role=combobox]')!;
    expect(document.activeElement).toBe(search);
    expect(document.body.textContent).toContain('reader@example.com');
    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.querySelector('[role=option]')?.getAttribute('aria-selected')).toBe('true');
    await act(async () => search.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ externalId: resource.externalId, body: 'Document preview' }));
    expect(api.googleDrive.search).not.toHaveBeenCalled();
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('renders an offline Drive snapshot without requesting credentials or remote content', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  try {
    const card = createResourceCard(resource, vi.fn());
    expect(card.textContent).toContain('Offline');
    expect(card.textContent).toContain('Useful plain preview');
    expect(api.googleDrive.getResource).not.toHaveBeenCalled();
    expect(api.googleDrive.status).not.toHaveBeenCalled();
  } finally { online.mockRestore(); }
});

it('round-trips both legacy and typed uploaded Office resources using canonical Drive URLs', () => {
  const input = { version: 1, appId: 'google-drive', serverId: 'drive-' + 'a'.repeat(24), externalId: 'office_file', title: 'Budget.xlsx', url: 'https://drive.google.com/file/d/office_file/view', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', cachedAt: '2026-10-04T00:00:00.000Z' };
  for (const resourceType of ['file', 'spreadsheet']) {
    const resource = parseExternalResource({ ...input, resourceType });
    expect(resource).not.toBeNull();
    expect(resourceBlocks(serializeExternalResource(resource!))[0].resource).toMatchObject({ externalId: input.externalId, resourceType, url: input.url });
  }
  expect(parseExternalResource({ ...input, resourceType: 'spreadsheet', url: 'javascript:alert(1)' })).toBeNull();
});
