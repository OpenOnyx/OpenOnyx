import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: { showMessageBox: mocks.confirm } }));
import { registerGoogleDriveIpc } from '../electron/googleDriveIpc';
import type { GoogleDriveProvider } from '../electron/googleDriveProvider';
function setup() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const frame = {}, sender = { mainFrame: frame };
  const event = { sender, senderFrame: frame };
  const provider = { status: vi.fn(() => ({ configured: true, secureStorage: true, accounts: [] })), connect: vi.fn(), cancelConnection: vi.fn(), disconnect: vi.fn(), search: vi.fn(async () => []), getResource: vi.fn(), getPdf: vi.fn(async () => new Uint8Array()) };
  registerGoogleDriveIpc({ handle: (name: string, fn: any) => handlers.set(name, fn) } as any, provider as unknown as GoogleDriveProvider, () => ({ webContents: sender, isDestroyed: () => false, isMinimized: () => false, focus: vi.fn() }) as any);
  mocks.confirm.mockReset(); mocks.confirm.mockResolvedValue({ response: 1 });
  return { handlers, event, provider };
}
it('starts browser connection directly while preserving search/read/disconnect confirmations', async () => {
  const { handlers, event, provider } = setup();
  await handlers.get('drive:connect')!(event);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(provider.connect).toHaveBeenCalledOnce();
  await handlers.get('drive:search')!(event, 'account', 'proposal', 'document');
  await handlers.get('drive:getResource')!(event, 'account', 'file_id');
  await handlers.get('drive:disconnect')!(event, 'account');
  expect(mocks.confirm).toHaveBeenCalledTimes(3);
  expect(provider.search).toHaveBeenCalledWith('account', 'proposal', 'document');
  expect(provider.getResource).toHaveBeenCalledWith('account', 'file_id');
});

it('automatically downloads PDFs but refuses untrusted frames and file identities', async () => {
  const { handlers, event, provider } = setup();
  const account = 'drive-' + 'a'.repeat(24);
  await expect(handlers.get('drive:previewPdf')!({ ...event, senderFrame: {} }, account, 'file')).rejects.toThrow('must originate');
  await expect(handlers.get('drive:previewPdf')!(event, account, '../private')).rejects.toThrow('Invalid');
  expect(provider.getPdf).not.toHaveBeenCalled();
  await handlers.get('drive:previewPdf')!(event, account, 'file');
  expect(provider.getPdf).toHaveBeenCalledWith(account, 'file');
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it('rejects foreign renderers/subframes, unsafe requests and cancellations before provider access', async () => {
  const { handlers, event, provider } = setup();
  await expect(handlers.get('drive:search')!({ ...event, senderFrame: {} }, 'account', 'proposal', 'document')).rejects.toThrow('must originate');
  await expect(handlers.get('drive:search')!({ ...event, sender: { mainFrame: event.senderFrame } }, 'account', 'proposal', 'document')).rejects.toThrow('must originate');
  await expect(handlers.get('drive:getResource')!(event, 'account', '../tokens')).rejects.toThrow('Invalid');
  mocks.confirm.mockResolvedValue({ response: 0 });
  await expect(handlers.get('drive:search')!(event, 'account', 'proposal', 'document')).rejects.toThrow('cancelled');
  expect(provider.search).not.toHaveBeenCalled(); expect(provider.getResource).not.toHaveBeenCalled();
});
it('never fabricates authorization when configuration or secure storage is missing', async () => {
  const { handlers, event, provider } = setup();
  provider.status.mockReturnValue({ configured: false, secureStorage: true, accounts: [] });
  await expect(handlers.get('drive:connect')!(event)).rejects.toThrow('not configured');
  provider.status.mockReturnValue({ configured: true, secureStorage: false, accounts: [] });
  await expect(handlers.get('drive:connect')!(event)).rejects.toThrow('Secure');
  expect(provider.connect).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it('does not return raw remote errors or token data to the renderer', async () => {
  const { handlers, event, provider } = setup();
  provider.search.mockRejectedValue(new Error('access_token=PRIVATE_PROVIDER_RESPONSE'));
  await expect(handlers.get('drive:search')!(event, 'account', 'proposal', 'document')).rejects.toThrow('could not complete');
});
