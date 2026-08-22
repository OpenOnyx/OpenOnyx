import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemManager } from "../electron/fileSystem";

describe("filesystem jail", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeVault(): { vault: string; manager: FileSystemManager } {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "oo-vault-"));
    dirs.push(vault);
    const manager = new FileSystemManager();
    manager.setVaultPath(vault);
    return { vault, manager };
  }

  it("refuses to read absolute paths outside the vault", async () => {
    const { vault, manager } = makeVault();
    const outside = path.join(os.tmpdir(), `oo-secret-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    dirs.push(outside);
    await expect(manager.readBinary(outside)).rejects.toThrow("Path traversal detected");
  });

  it("refuses attachment names that escape the attachments folder", async () => {
    const { vault, manager } = makeVault();
    const relative = await manager.saveImage("photo.png", "aaaa");
    expect(relative).toBe("attachments/photo.png");
    expect(fs.existsSync(path.join(vault, "attachments", "photo.png"))).toBe(true);
    await expect(manager.saveImage("../escape.png", "aaaa")).resolves.toBe("attachments/escape.png");
    expect(fs.existsSync(path.join(vault, "escape.png"))).toBe(false);
  });
});
