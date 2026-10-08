import type { DriveFile } from '../../electron/googleDriveTypes';
import type { AppResourceProvider, DriveResource, DriveResourceType } from '../types/appResources';
import { getAPI } from './api';
import { parseExternalResource } from './appResources';

export const DRIVE_TYPE_NAMES: Record<DriveResourceType, string> = {
  document: 'Google Docs', spreadsheet: 'Google Sheets', presentation: 'Google Slides', pdf: 'PDF', folder: 'Folder', file: 'File',
};
export function driveResourceTypeName(resource: Pick<DriveResource, 'mimeType' | 'resourceType'>): string {
  if (resource.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'Word';
  if (resource.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'PowerPoint';
  if (resource.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'Excel';
  return DRIVE_TYPE_NAMES[resource.resourceType];
}

export function driveResourceFromNative(file: DriveFile): DriveResource {
  const resource = parseExternalResource({ version: 1, appId: 'google-drive', serverId: file.accountId, externalId: file.id,
    resourceType: file.kind, title: file.name, url: file.url, mimeType: file.mimeType, body: file.preview,
    owner: file.owner, size: file.size, updatedAt: file.modifiedAt, cachedAt: file.cachedAt });
  if (!resource || resource.appId !== 'google-drive') throw new Error('Google Drive returned an invalid resource.');
  return resource;
}
export function createDriveProvider(accountId: string): AppResourceProvider<DriveResource, DriveResourceType | 'everything'> & { getResource(id: string): Promise<DriveResource> } {
  return {
    appId: 'google-drive', kind: 'oauth',
    search: async (query, kind) => (await getAPI().googleDrive.search(accountId, query, kind)).map(driveResourceFromNative),
    getResource: async (id) => driveResourceFromNative(await getAPI().googleDrive.getResource(accountId, id)),
    refresh: async (resource) => {
      const updated = driveResourceFromNative(await getAPI().googleDrive.getResource(accountId, resource.externalId));
      return { ...updated, body: updated.body ?? resource.body, display: resource.display };
    },
  };
}
export function driveResourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/cancel/i.test(message)) return 'Request cancelled. Your note has not changed.';
  if (/Resource unavailable/i.test(message)) return 'Resource unavailable · showing the last cached version.';
  if (/not configured/i.test(message)) return 'Google Drive sign-in is not configured for this build yet.';
  if (/storage|unlocked/i.test(message)) return 'Secure credential storage is unavailable. Google Drive has not been connected.';
  if (/configuration is (?:missing|incomplete)/i.test(message)) return 'Google sign-in setup is incomplete for this build. The app maintainer needs to check it.';
  if (/client configuration was rejected/i.test(message)) return 'Google rejected this app’s sign-in configuration. The app maintainer needs to check it.';
  if (/authorization expired or was revoked/i.test(message)) return 'Authorization expired or was revoked. Connect Google Drive again.';
  if (/Reconnect|needs attention|authorization/i.test(message)) return 'Reconnect Google Drive to continue. Your saved resources remain readable.';
  return "Couldn't load Google Drive resources. Try again.";
}

export function driveConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/cancel/i.test(message)) return 'Google Drive connection was cancelled.';
  if (/timed out/i.test(message)) return 'Google Drive connection timed out. Try again.';
  if (/not configured|configuration|storage|unlocked/i.test(message)) return driveResourceError(error);
  if (/expired|revoked|read access|Reconnect/i.test(message)) return 'Your Google Drive authorization expired. Reconnect to continue.';
  return "Couldn't connect to Google Drive. Try again.";
}
