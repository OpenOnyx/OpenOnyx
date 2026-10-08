import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import type { GoogleDriveProvider } from './googleDriveProvider.js';
import type { DriveKind } from './googleDriveTypes.js';
import type { GoogleDrivePdfCache } from './googleDrivePdfCache.js';
import type { GoogleDriveFileCache } from './googleDriveFileCache.js';

function string(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('Invalid Google Drive request.');
  return value;
}
function safeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  return new Error(/^(Google (?:Drive|authorization)|Resource unavailable|Reconnect Google Drive|Secure system|Could not (?:load Google Drive|open your browser|identify the connected Google|start Google)|Google did not|Invalid Google Drive)/.test(message) && message.length < 200 ? message : 'Google Drive could not complete this request. Try again.');
}
export function registerGoogleDriveIpc(ipc: IpcMain, provider: GoogleDriveProvider, mainWindow: () => BrowserWindow | null, pdfCache?: GoogleDrivePdfCache, fileCache?: GoogleDriveFileCache): void {
  provider.subscribeStatus?.(status => {
    const window = mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('drive:statusChanged', status);
  });
  const owner = (event: IpcMainInvokeEvent) => {
    const window = mainWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Google Drive requests must originate in OpenOnyx.');
    return window;
  };
  const confirm = async (event: IpcMainInvokeEvent, message: string, detail: string) => {
    const result = await dialog.showMessageBox(owner(event), { type: 'question', title: 'Use Google Drive?', message, detail, buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) throw new Error('Google Drive request was cancelled.');
  };
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown) => {
    ipc.handle(channel, async (event, ...args: unknown[]) => { try { owner(event); return await fn(event, ...args); } catch (error) { throw safeError(error); } });
  };
  handle('drive:status', () => provider.status());
  handle('drive:cachedPdf', async (_event, accountId, fileId) => {
    return pdfCache ? pdfCache.read(string(accountId), string(fileId)) : null;
  });
  handle('drive:previewPdf', async (_event, accountId, fileId) => {
    const account = string(accountId), file = string(fileId);
    if (!/^drive-[a-f0-9]{24}$/.test(account) || !/^[A-Za-z0-9_-]{1,200}$/.test(file)) throw new Error('Invalid Google Drive request.');
    const bytes = await provider.getPdf(account, file);
    if (pdfCache) await pdfCache.write(account, file, bytes);
    return bytes;
  });
  handle('drive:cachedPreviewFile', async (_event, accountId, fileId) => {
    return fileCache ? fileCache.read(string(accountId), string(fileId)) : null;
  });
  handle('drive:previewFile', async (_event, accountId, fileId) => {
    const account = string(accountId), file = string(fileId);
    if (!/^drive-[a-f0-9]{24}$/.test(account) || !/^[A-Za-z0-9_-]{1,200}$/.test(file)) throw new Error('Invalid Google Drive request.');
    const preview = await provider.getPreviewFile(account, file);
    if (fileCache) await fileCache.write(account, file, preview);
    return preview;
  });
  handle('drive:connect', async (event) => {
    const status = provider.status();
    if (!status.configured) throw new Error('Google Drive authorization is not configured for this build.');
    if (!status.secureStorage) throw new Error('Secure system credential storage is unavailable.');
    const account = await provider.connect();
    const window = mainWindow();
    if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus(); }
    return account;
  });
  handle('drive:cancelConnect', () => provider.cancelConnection());
  handle('drive:disconnect', async (event, accountId) => {
    const id = string(accountId);
    await confirm(event, 'Disconnect Google Drive?', 'Saved resources in your local notes remain available.');
    await provider.disconnect(id);
  });
  handle('drive:search', async (event, accountId, query, kind) => {
    const id = string(accountId), term = string(query, 500), filter = string(kind, 30);
    if (!['everything', 'document', 'spreadsheet', 'presentation', 'pdf', 'folder', 'file'].includes(filter)) throw new Error('Invalid Google Drive request.');
    await confirm(event, 'Search your Google Drive?', `Google Drive will receive this search:\n\n${term}\n\nFilter: ${filter === 'everything' ? 'Everything' : filter}`);
    return provider.search(id, term, filter as DriveKind | 'everything');
  });
  handle('drive:getResource', async (event, accountId, fileId) => {
    const id = string(accountId), file = string(fileId);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(file)) throw new Error('Invalid Google Drive request.');
    await confirm(event, 'Read a Google Drive resource?', `OpenOnyx will retrieve this file's metadata and, for Google Docs, a limited text preview.\n\nFile ID: ${file}\n\nThe selected preview may be saved in your local note.`);
    return provider.getResource(id, file);
  });
}
