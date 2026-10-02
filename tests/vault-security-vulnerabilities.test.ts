import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => { }),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    requestSingleInstanceLock: vi.fn(() => true),
    commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => "") },
    whenReady: vi.fn(() => new Promise(() => {})),
    on: vi.fn(),
    exit: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: class {
    once = vi.fn();
    on = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    webContents = {
      once: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      getURL: vi.fn(() => ""),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    };
  },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: {
    defaultSession: {
      getUserAgent: vi.fn(() => "mock-agent"),
      setUserAgent: vi.fn(),
      webRequest: {
        onBeforeSendHeaders: vi.fn(),
        onCompleted: vi.fn(),
        onErrorOccurred: vi.fn(),
        onHeadersReceived: vi.fn(),
      },
    },
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  globalShortcut: { unregisterAll: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  net: { fetch: vi.fn() },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
    trashItem: vi.fn(),
  },
}));

import { FileSystemManager } from "../electron/fileSystem";
import { registerIpcHandlers } from "../electron/ipc";
import { findFileInVault } from "../electron/main";
import { isInsideRoot, isSafeVaultProtocolPath } from "../electron/pathSafety";

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

    it("blocks saveImage from overwriting symlinked files pointing outside vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const outsideFile = path.join(os.tmpdir(), `oo-sym-target-${Date.now()}.png`);
      fs.writeFileSync(outsideFile, "original critical data");
      tmpDirs.push(outsideFile);

      const attachmentsDir = path.join(vaultDir, "attachments");
      fs.mkdirSync(attachmentsDir, { recursive: true });

      const symlinkFile = path.join(attachmentsDir, "fake.png");
      try {
        fs.symlinkSync(outsideFile, symlinkFile);
      } catch {
        return;
      }

      const sampleBase64 = "data:image/png;base64,aGVsbG8=";
      await expect(fsManager.saveImage("fake.png", sampleBase64)).rejects.toThrow("Path traversal detected");
      expect(fs.readFileSync(outsideFile, "utf-8")).toBe("original critical data");
    });

    it("blocks writeFile, writeBinary, createFile, and writeDataFile from writing through dangling symlinks pointing outside the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const outsideFile = path.join(os.tmpdir(), `oo-dangling-outside-${Date.now()}.txt`);
      const outsideBinary = path.join(os.tmpdir(), `oo-dangling-bin-${Date.now()}.bin`);
      const outsideCreated = path.join(os.tmpdir(), `oo-dangling-created-${Date.now()}.txt`);
      const outsideData = path.join(os.tmpdir(), `oo-dangling-data-${Date.now()}.json`);
      tmpDirs.push(outsideFile, outsideBinary, outsideCreated, outsideData);

      const symlinkWrite = path.join(vaultDir, "dangling-write.txt");
      const symlinkBin = path.join(vaultDir, "dangling-bin.bin");
      const symlinkCreate = path.join(vaultDir, "dangling-create.txt");

      const dataDir = path.join(vaultDir, ".openonyx");
      fs.mkdirSync(dataDir, { recursive: true });
      const symlinkData = path.join(dataDir, "dangling-data.json");

      try {
        fs.symlinkSync(outsideFile, symlinkWrite);
        fs.symlinkSync(outsideBinary, symlinkBin);
        fs.symlinkSync(outsideCreated, symlinkCreate);
        fs.symlinkSync(outsideData, symlinkData);
      } catch {
        // Skip on environments without symlink privileges
        return;
      }

      // Verify symlink is indeed dangling before test
      expect(fs.existsSync(symlinkWrite)).toBe(false);
      expect(fs.existsSync(symlinkBin)).toBe(false);
      expect(fs.existsSync(symlinkCreate)).toBe(false);
      expect(fs.existsSync(symlinkData)).toBe(false);

      await expect(fsManager.writeFile("dangling-write.txt", "payload")).rejects.toThrow("Path traversal detected");
      await expect(fsManager.writeBinary("dangling-bin.bin", new Uint8Array([1, 2, 3]))).rejects.toThrow("Path traversal detected");
      await expect(fsManager.createFile("dangling-create.txt", "payload")).rejects.toThrow("Path traversal detected");
      await expect(fsManager.writeDataFile("dangling-data.json", '{"key":"value"}')).rejects.toThrow("Path traversal detected");

      // Verify the outside target was never created
      expect(fs.existsSync(outsideFile)).toBe(false);
      expect(fs.existsSync(outsideBinary)).toBe(false);
      expect(fs.existsSync(outsideCreated)).toBe(false);
      expect(fs.existsSync(outsideData)).toBe(false);
    });

    it("allows operations on symlinked vault root and handles macOS /var canonicalization", () => {
      const realVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "oo-real-vault-"));
      const symlinkVaultDir = path.join(os.tmpdir(), `oo-sym-vault-${Date.now()}`);
      tmpDirs.push(realVaultDir, symlinkVaultDir);

      try {
        fs.symlinkSync(realVaultDir, symlinkVaultDir, "dir");
      } catch {
        return;
      }

      const fileInReal = path.join(realVaultDir, "note.md");
      fs.writeFileSync(fileInReal, "# Real note");

      // isInsideRoot should accept candidate inside real vault even when root is the symlink
      expect(isInsideRoot(symlinkVaultDir, fileInReal)).toBe(true);
      expect(isInsideRoot(realVaultDir, path.join(symlinkVaultDir, "note.md"))).toBe(true);

      const fsManager = new FileSystemManager();
      expect(fsManager.setVaultPath(symlinkVaultDir)).toBe(true);
      // fsManager should resolve vault path to real path
      expect(fsManager.getVaultPath()).toBe(fs.realpathSync(realVaultDir));
    });

    it("prevents infinite loops in getFileTree when directory symlinks form a cycle", async () => {
      const { vaultDir, fsManager } = makeVault();
      const subDir = path.join(vaultDir, "sub");
      fs.mkdirSync(subDir, { recursive: true });

      const cycleLink = path.join(subDir, "loop");
      try {
        fs.symlinkSync(vaultDir, cycleLink, "dir");
      } catch {
        return;
      }

      const tree = await fsManager.getFileTree();
      expect(tree).toBeDefined();
      expect(Array.isArray(tree)).toBe(true);
    });

    it("prevents infinite recursion in findFileInVault when directory symlinks form a cycle", () => {
      const { vaultDir } = makeVault();
      const subDir = path.join(vaultDir, "sub");
      fs.mkdirSync(subDir, { recursive: true });

      const cycleLink = path.join(subDir, "loop");
      try {
        fs.symlinkSync(vaultDir, cycleLink, "dir");
      } catch {
        return;
      }

      // Should return null without infinite recursion when searching for nonexistent file
      const notFound = findFileInVault(vaultDir, "nonexistent-file.png", vaultDir);
      expect(notFound).toBeNull();

      // Should find existing file in nested directory despite cycle
      const targetFile = path.join(subDir, "actual-image.png");
      fs.writeFileSync(targetFile, "image content");

      const found = findFileInVault(vaultDir, "actual-image.png", vaultDir);
      expect(found).toBe(targetFile);
    });

    it("findFileInVault refuses to search directory symlinks pointing outside the vault", () => {
      const { vaultDir } = makeVault();
      const outsideDir = path.join(os.tmpdir(), `oo-outside-search-${Date.now()}`);
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideSecret = path.join(outsideDir, "secret-image.png");
      fs.writeFileSync(outsideSecret, "secret");
      tmpDirs.push(outsideDir);

      const symlinkFolder = path.join(vaultDir, "outside-folder");
      try {
        fs.symlinkSync(outsideDir, symlinkFolder, "dir");
      } catch {
        return;
      }

      const found = findFileInVault(vaultDir, "secret-image.png", vaultDir);
      expect(found).toBeNull();
    });

    it("rejects paths that lexically escape the vault even when they symlink back into the vault", async () => {
      const { vaultDir, fsManager } = makeVault();
      const parentDir = path.dirname(vaultDir);
      const targetNote = path.join(vaultDir, "note.md");
      fs.writeFileSync(targetNote, "# In Vault");

      const outsideLink = path.join(parentDir, `oo-outside-link-${Date.now()}.md`);
      try {
        fs.symlinkSync(targetNote, outsideLink);
        tmpDirs.push(outsideLink);
      } catch {
        // Skip on platforms where symlink creation is restricted without privilege
        return;
      }

      // Lexical check must reject outside link
      expect(isInsideRoot(vaultDir, outsideLink)).toBe(false);

      const relativeTraversal = `../${path.basename(outsideLink)}`;
      await expect(fsManager.readFile(relativeTraversal)).rejects.toThrow("Path traversal detected");
      await expect(fsManager.writeFile(relativeTraversal, "hacked")).rejects.toThrow("Path traversal detected");
      await expect(fsManager.deleteFile(relativeTraversal)).rejects.toThrow("Path traversal detected");

      // Verify the outside symlink was never modified or unlinked
      expect(fs.existsSync(outsideLink)).toBe(true);

      // IPC openPath must also reject
      const handlers = createIpcHandlers(fsManager);
      const openPathHandler = handlers.get("desktop:openPath")!;
      await expect(openPathHandler({}, relativeTraversal)).rejects.toThrow("Path is outside the active vault");
    });
  });
});
