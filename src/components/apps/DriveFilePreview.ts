import { resourceViewState } from '../documents/ResourceViewState';
import type { DriveResource } from '../../types/appResources';
import { getAPI } from '../../utils/api';
import { createFilePreview, type FilePreviewPayload } from '../documents/FilePreview';

export function createDriveFilePreview(resource: DriveResource): HTMLElement {
  return createFilePreview({
    title: resource.title,
    viewState: resourceViewState(`${resource.appId}:${resource.serverId}:${resource.externalId}`),
    mimeType: resource.mimeType,
    size: resource.size,
    providerLabel: 'Google Drive',
    cachedText: resource.body,
    openExternal: () => { void getAPI().openExternal(resource.url); },
    async load(refresh): Promise<FilePreviewPayload> {
      if (resource.resourceType === 'pdf') {
        const cached = refresh ? null : await getAPI().googleDrive.cachedPdf(resource.serverId, resource.externalId);
        const bytes = cached ?? await getAPI().googleDrive.previewPdf(resource.serverId, resource.externalId);
        return { bytes, mimeType: 'application/pdf', cachedAt: resource.cachedAt };
      }
      const cached = refresh ? null : await getAPI().googleDrive.cachedPreviewFile(resource.serverId, resource.externalId);
      return cached ?? await getAPI().googleDrive.previewFile(resource.serverId, resource.externalId);
    },
  });
}
