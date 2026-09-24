import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: class {},
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
    trashItem: vi.fn(),
  },
}));

import { FileSystemManager } from "../electron/fileSystem";
import { registerIpcHandlers } from "../electron/ipc";
import { isSafeVaultProtocolPath } from "../electron/pathSafety";

type Handler = (...args: any[]) => any;

function createIpcHandlers(fsManager: FileSystemManager): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
  };

  registerIpcHandlers(
    ipcMain as any,
    fsManager,
    {} as any,
    () => null,
  );
  return handlers;
}

describe("vault security vulnerabilities unit suite", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeVault(): { vaultDir: string; fsManager: FileSystemManager } {
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "oo-sec-vault-"));
    tmpDirs.push(vaultDir);
    const fsManager = new FileSystemManager();
    fsManager.setVaultPath(vaultDir);
    return { vaultDir, fsManager };
  }

  describe("vault:// protocol safety", () => {
    it("approves vault-confined relative paths and rejects traversal", () => {
      const root = process.platform === "win32" ? path.resolve("C:/tmp/vault") : path.resolve("/tmp/vault");
      expect(isSafeVaultProtocolPath(root, "attachments/img.png")).toBe(true);
      expect(isSafeVaultProtocolPath(root, "notes/sub/doc.md")).toBe(true);
      expect(isSafeVaultProtocolPath(root, "../../etc/passwd")).toBe(false);
      expect(isSafeVaultProtocolPath(root, "C:/Windows/System32/calc.exe")).toBe(false);
      if (process.platform === "win32") {
        expect(isSafeVaultProtocolPath(root, "D:/OtherDrive/secret.txt")).toBe(false);
      } else {
        expect(isSafeVaultProtocolPath(root, "/etc/shadow")).toBe(false);
      }
    });
  });

  describe("desktop:openPath IPC safety", () => {
    beforeEach(() => {
      electronMocks.openPath.mockClear();
    });

    it("rejects non-string or empty path inputs", async () => {
      const { fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;

      await expect(openPathHandler({}, null)).rejects.toThrow("Target path must be a non-empty string");
      await expect(openPathHandler({}, "")).rejects.toThrow("Target path must be a non-empty string");
      expect(electronMocks.openPath).not.toHaveBeenCalled();
    });

    it("rejects paths outside the active vault", async () => {
      const { fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;

      const secretFile = path.join(os.tmpdir(), `secret-${Date.now()}.txt`);
      fs.writeFileSync(secretFile, "confidential");
      tmpDirs.push(secretFile);

      await expect(openPathHandler({}, secretFile)).rejects.toThrow("Path is outside the active vault");
      await expect(openPathHandler({}, "../../etc/passwd")).rejects.toThrow("Path traversal detected");
      expect(electronMocks.openPath).not.toHaveBeenCalled();
    });

    it("rejects non-existent files inside the vault", async () => {
      const { fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;

      await expect(openPathHandler({}, "nonexistent.md")).rejects.toThrow("Target file does not exist");
      expect(electronMocks.openPath).not.toHaveBeenCalled();
    });

    it("rejects opening symlinks that point outside the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;

      const secretFile = path.join(os.tmpdir(), `secret-sym-${Date.now()}.txt`);
      fs.writeFileSync(secretFile, "confidential");
      tmpDirs.push(secretFile);

      const symlinkPath = path.join(vaultDir, "stolen-open.txt");
      try {
        fs.symlinkSync(secretFile, symlinkPath);
      } catch {
        // Skip on Windows if permissions insufficient
        return;
      }

      await expect(openPathHandler({}, "stolen-open.txt")).rejects.toThrow("Path is outside the active vault");
      expect(electronMocks.openPath).not.toHaveBeenCalled();
    });

    it("opens existing file inside the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;

      const notePath = path.join(vaultDir, "note.md");
      fs.writeFileSync(notePath, "# Hello");

      await openPathHandler({}, "note.md");
      expect(electronMocks.openPath).toHaveBeenCalledWith(path.resolve(notePath));
    });
  });

  describe("network:request IPC SSRF & local service protection", () => {
    it("blocks requests targeting localhost, 127.0.0.1, and private IPs", async () => {
      const { fsManager } = makeVault();
      const handlers = createIpcHandlers(fsManager);
      const networkHandler = handlers.get("network:request")!;

      await expect(networkHandler({}, { url: "http://localhost:8080/api" })).rejects.toThrow(
        "Outbound URL host is not allowed."
      );
      await expect(networkHandler({}, { url: "http://127.0.0.1:3000/keys" })).rejects.toThrow(
        "Outbound URL host is not allowed."
      );
      await expect(networkHandler({}, { url: "http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(
        "Outbound URL host is not allowed."
      );
    });
  });

  describe("readBinary & data file confinement", () => {
    it("refuses to read binary data from outside the vault", async () => {
      const { fsManager } = makeVault();
      const outsideFile = path.join(os.tmpdir(), `oo-bin-${Date.now()}.bin`);
      fs.writeFileSync(outsideFile, Buffer.from([1, 2, 3, 4]));
      tmpDirs.push(outsideFile);

      await expect(fsManager.readBinary(outsideFile)).rejects.toThrow("Path traversal detected");
    });

    it("keeps .openonyx data storage confined to the vault data folder and handles listData/listDataDir safely", async () => {
      const { vaultDir, fsManager } = makeVault();
      await fsManager.writeDataFile("settings.json", '{"theme":"dark"}');
      await fsManager.writeDataFile("cache/embeddings.json", '{"key":"value"}');

      const readBack = await fsManager.readDataFile("settings.json");
      expect(readBack).toBe('{"theme":"dark"}');

      // Test listData and listDataDir with default empty string and subdirectories
      const rootDataFiles = await fsManager.listData();
      expect(rootDataFiles).toContain("settings.json");

      const cacheFiles = await fsManager.listData("cache");
      expect(cacheFiles).toContain("embeddings.json");

      const cacheFilesDir = await fsManager.listDataDir("cache");
      expect(cacheFilesDir).toContain("embeddings.json");

      // Listing nonexistent directory returns empty array without creating it
      const nonexistentListing = await fsManager.listData("nonexistent/subfolder");
      expect(nonexistentListing).toEqual([]);
      expect(fs.existsSync(path.join(vaultDir, ".openonyx", "nonexistent"))).toBe(false);

      // Traversal attempts in subDir should return empty array safely without creating folders outside
      const traversalList = await fsManager.listData("../../");
      expect(traversalList).toEqual([]);

      const traversalList2 = await fsManager.listData("../..");
      expect(traversalList2).toEqual([]);

      await expect(fsManager.writeDataFile("../outside.json", "data")).rejects.toThrow("Path traversal detected");
      const outsideAttempt = await fsManager.readDataFile("../outside.json");
      expect(outsideAttempt).toBeNull();
    });
  });

  describe("symlink protection", () => {
    it("blocks access to files symlinked to paths outside the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const secretFile = path.join(os.tmpdir(), `oo-sym-secret-${Date.now()}.txt`);
      fs.writeFileSync(secretFile, "sensitive system data");
      tmpDirs.push(secretFile);

      // Create a symlink inside the vault pointing to the secret file outside
      const symlinkPath = path.join(vaultDir, "stolen-link.txt");
      try {
        fs.symlinkSync(secretFile, symlinkPath);
      } catch (err) {
        // On Windows without admin permissions, symlink creation might require privilege; skip if OS forbids
        return;
      }

      await expect(fsManager.readFile("stolen-link.txt")).rejects.toThrow("Path traversal detected");
      await expect(fsManager.readBinary("stolen-link.txt")).rejects.toThrow("Path traversal detected");
      await expect(fsManager.writeFile("stolen-link.txt", "overwrite")).rejects.toThrow("Path traversal detected");
    });

    it("blocks access to directory symlinks pointing outside the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const outsideDir = path.join(os.tmpdir(), `oo-sym-dir-${Date.now()}`);
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(outsideDir, "secret.txt"), "outside data");
      tmpDirs.push(outsideDir);

      const symlinkDir = path.join(vaultDir, "stolen-folder");
      try {
        fs.symlinkSync(outsideDir, symlinkDir, "dir");
      } catch {
        return;
      }

      await expect(fsManager.readFile("stolen-folder/secret.txt")).rejects.toThrow("Path traversal detected");

      const files = await fsManager.listFiles();
      const names = files.map((f) => f.name);
      expect(names).not.toContain("stolen-folder");
    });
  });
});
