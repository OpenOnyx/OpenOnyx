// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDriveResourceCard } from '../src/components/apps/DriveResourceCard';
import { parseExternalResource, serializeExternalResource } from '../src/utils/appResources';
import type { DriveResource } from '../src/types/appResources';
const load = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/api', () => ({ getAPI: () => ({ googleDrive: { cachedPreviewFile: load }, openExternal: vi.fn() }) }));
afterEach(() => { document.body.replaceChildren(); load.mockClear(); });
const resource: DriveResource = { version: 1, appId: 'google-drive', serverId: 'drive-' + 'a'.repeat(24), resourceType: 'presentation', externalId: 'slides_file', mimeType: 'application/vnd.google-apps.presentation', title: 'Pitch', url: 'https://docs.google.com/presentation/d/slides_file/edit', cachedAt: '2026-10-04T08:00:00Z' };
it.each(['compact', 'link'] as const)('%s cards stay cheap and preserve identity across note serialization', async display => {
  const value = { ...resource, display };
  const card = createDriveResourceCard(value, vi.fn(), { update: vi.fn() }); document.body.append(card);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(card.querySelector('.file-preview')).toBeNull(); expect(load).not.toHaveBeenCalled();
  const json = serializeExternalResource(value).match(/\{.*\}/s)![0];
  const restored = parseExternalResource(JSON.parse(json));
  expect(restored?.externalId).toBe(resource.externalId); expect(restored?.display).toBe(display);
});
it('uses display choices in the existing overflow menu without a mode toolbar', () => {
  const update = vi.fn(); const card = createDriveResourceCard({ ...resource, display: 'compact' }, vi.fn(), { update });
  const options = card.querySelector('.app-resource-menu-options')!;
  const preview = [...options.querySelectorAll('button')].find(button => button.textContent === 'Preview')!;
  preview.click(); expect(update).toHaveBeenCalledWith(expect.objectContaining({ display: 'embed', externalId: resource.externalId }));
  expect(card.querySelector('.file-preview-controls')).toBeNull();
});
