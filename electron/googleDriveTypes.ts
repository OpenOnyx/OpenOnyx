export type DriveKind = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'folder' | 'file';
import type { AppsConnectionState } from './appsAuthTypes.js';
export interface DriveAccount { id: string; email: string; name: string; needsReconnect?: boolean }
export interface DriveStatus { configured: boolean; secureStorage: boolean; accounts: DriveAccount[]; connectionState?: AppsConnectionState }
export interface DriveFile {
  id: string; accountId: string; name: string; kind: DriveKind; mimeType: string;
  url: string; modifiedAt?: string; size?: number; owner?: string;
  preview?: string; cachedAt: string;
}
export const DRIVE_MIME_TYPES: Record<string, DriveKind> = {
  'application/vnd.google-apps.document': 'document',
  'application/vnd.google-apps.spreadsheet': 'spreadsheet',
  'application/vnd.google-apps.presentation': 'presentation',
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/pdf': 'pdf',
};
