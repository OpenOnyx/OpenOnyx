import type { DriveResource } from '../../types/appResources';
import { getAPI } from '../../utils/api';
import { createPdfViewer } from '../documents/PdfViewer';

export function createDrivePdfPreview(resource: DriveResource): HTMLElement {
  return createPdfViewer({
    title: resource.title,
    async load(refresh) {
      const api = getAPI().googleDrive;
      const cached = refresh ? null : await api.cachedPdf(resource.serverId, resource.externalId);
      return cached ?? await api.previewPdf(resource.serverId, resource.externalId);
    },
  });
}
