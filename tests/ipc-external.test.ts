import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: class {},
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
    trashItem: vi.fn(),
  },
}));

import { registerIpcHandlers } from "../electron/ipc";

type Handler = (...args: any[]) => any;

function registeredHandlers(
  fsManager: object = {},
  renameVaultPath?: (oldPath: string, newPath: string) => string[],
): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
  };

  registerIpcHandlers(
    ipcMain as any,
    fsManager as any,
    {} as any,
    () => null,
    undefined,
    undefined,
    undefined,
    renameVaultPath,
  );
  return handlers;
}

describe("desktop:openExternal IPC", () => {
  beforeEach(() => {
    electronMocks.openExternal.mockClear();
  });

  it("opens validated web URLs with the external shell", async () => {
    const handler = registeredHandlers().get("desktop:openExternal");

    await handler?.({}, "https://example.com/docs");

    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "https://example.com/docs",
    );
  });

  it("rejects local paths before invoking the external shell", async () => {
    const handler = registeredHandlers().get("desktop:openExternal");

    await expect(handler?.({}, "file:///tmp/private.txt")).rejects.toThrow(
      "protocol is not allowed",
    );
    expect(electronMocks.openExternal).not.toHaveBeenCalled();
  });
});

describe("desktop:renamePath IPC", () => {
  it("registers the handler and renames an approved vault", async () => {
    const parentPath = await mkdtemp(join(tmpdir(), "openonyx-ipc-"));
    const sourcePath = join(parentPath, "source-vault");
    const destinationPath = join(parentPath, "renamed-vault");
    const renamedPaths: string[][] = [];
    const fsManager = {
      getVaultPath: () => sourcePath,
    };

    await mkdir(sourcePath);

    try {
      const handler = registeredHandlers(fsManager, (oldPath, newPath) => {
        renamedPaths.push([oldPath, newPath]);
        return [newPath];
      }).get("desktop:renamePath");

      expect(handler).toBeDefined();
      await expect(handler?.({}, sourcePath, destinationPath)).resolves.toEqual({
        success: true,
      });

      await expect(access(destinationPath)).resolves.toBeUndefined();
      await expect(access(sourcePath)).rejects.toThrow();
      expect(renamedPaths).toEqual([[sourcePath, destinationPath]]);
    } finally {
      await rm(parentPath, { recursive: true, force: true });
    }
  });
});
