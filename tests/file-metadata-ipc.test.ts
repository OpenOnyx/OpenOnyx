// @vitest-environment jsdom
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), api: null as any,
  invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
    const handler = transport.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    return handler({}, ...args);
  }),
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn() }, BrowserWindow: class {}, clipboard: {}, dialog: {}, shell: {},
  ipcRenderer: { invoke: transport.invoke, on: vi.fn(), removeListener: vi.fn() },
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => { if (name === 'electronAPI') transport.api = api; } },
}));
import { registerIpcHandlers } from '../electron/ipc';
import { FileSystemManager } from '../electron/fileSystem';
import { FILE_METADATA_CHANNEL } from '../electron/filesystemContract';
import { getAPI } from '../src/utils/api';
import { MissingIpcCapabilityError } from '../src/utils/filesystem-ipc';

describe('native metadata contract through real preload and registration', () => {
  let root: string; let vault: string; let outside: string;
  let manager: FileSystemManager;
  let registrations: string[];
  const contextDescriptor = Object.getOwnPropertyDescriptor(process, 'contextIsolated');
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openonyx-metadata-'));
    vault = path.join(root, 'vault'); outside = path.join(root, 'outside.md');
    await fs.mkdir(vault); await fs.writeFile(path.join(vault, 'note.md'), 'Unicode café 🍀');
    await fs.writeFile(outside, 'private');
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
    await import('../electron/preload');
  });
  afterAll(async () => {
    if (contextDescriptor) Object.defineProperty(process, 'contextIsolated', contextDescriptor);
    else delete (process as any).contextIsolated;
    delete (window as any).electronAPI;
    await fs.rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    transport.handlers.clear(); transport.invoke.mockClear(); registrations = [];
    manager = new FileSystemManager(); manager.setVaultPath(vault);
    registerIpcHandlers({
      handle: (channel: string, handler: (...args: any[]) => any) => { registrations.push(channel); transport.handlers.set(channel, handler); }, on: vi.fn(),
    } as any, manager, {} as any, () => null);
    (window as any).electronAPI = transport.api;
  });

  it('registers the exact preload channel once, without requiring a renderer window', async () => {
    expect(registrations.filter((channel) => channel === FILE_METADATA_CHANNEL)).toHaveLength(1);
    const stat = await fs.stat(path.join(vault, 'note.md'));
    expect(await getAPI().fileMetadata('note.md', vault)).toEqual({ modifiedAt: stat.mtimeMs, size: Buffer.byteLength('Unicode café 🍀') });
    expect(transport.invoke).toHaveBeenCalledWith(FILE_METADATA_CHANNEL, 'note.md', vault);
  });

  it('registers filesystem handlers before main creates the initial window', async () => {
    const main = await fs.readFile(path.resolve('electron/main.ts'), 'utf8');
    const startup = main.slice(main.indexOf('app.whenReady()'));
    expect(startup.indexOf('registerIpcHandlers(')).toBeGreaterThanOrEqual(0);
    expect(startup.indexOf('registerIpcHandlers(')).toBeLessThan(startup.indexOf('createWindow();'));
  });

  it('returns null for deleted files, nonexistent parents, and directories', async () => {
    expect(await getAPI().fileMetadata('missing.md', vault)).toBeNull();
    expect(await getAPI().fileMetadata('absent/child.md', vault)).toBeNull();
    expect(await getAPI().fileMetadata('.', vault)).toBeNull();
  });

  it('rejects invalid input, traversal, outside absolute paths, and unauthorized vault identities', async () => {
    for (const input of ['', '\0', 12, null]) await expect(transport.api.fileMetadata(input, vault)).rejects.toThrow('Invalid file path');
    await expect(getAPI().fileMetadata('../outside.md', vault)).rejects.toThrow('Path traversal');
    await expect(getAPI().fileMetadata(outside, vault)).rejects.toThrow('Path traversal');
    await expect(getAPI().fileMetadata('note.md', root)).rejects.toThrow('Vault changed');
    await expect(transport.api.fileMetadata('note.md', 12)).rejects.toThrow('Invalid expected vault');
  });

  it('rejects symbolic links escaping the vault', async () => {
    const link = path.join(vault, 'outside-link.md');
    await fs.symlink(outside, link);
    try { await expect(getAPI().fileMetadata('outside-link.md', vault)).rejects.toThrow('Path traversal'); }
    finally { await fs.unlink(link); }
  });

  it('distinguishes absent main handlers and old preloads from per-file failures', async () => {
    transport.handlers.delete(FILE_METADATA_CHANNEL);
    await expect(getAPI().fileMetadata('note.md', vault)).rejects.toBeInstanceOf(MissingIpcCapabilityError);
    (window as any).electronAPI = { ...transport.api, fileMetadata: undefined };
    await expect(getAPI().fileMetadata('note.md', vault)).rejects.toBeInstanceOf(MissingIpcCapabilityError);
  });

  it('rejects incompatible response shapes as an infrastructure error', async () => {
    for (const response of [undefined, { mtime: 123 }, { modifiedAt: NaN, size: 2 }, { modifiedAt: 1, size: -2 }]) {
      transport.handlers.set(FILE_METADATA_CHANNEL, async () => response);
      await expect(getAPI().fileMetadata('note.md', vault)).rejects.toBeInstanceOf(MissingIpcCapabilityError);
    }
  });
});
