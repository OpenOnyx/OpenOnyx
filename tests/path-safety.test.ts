import path from "path";
import { describe, expect, it } from "vitest";
import {
  isInsideRoot,
  isSafeVaultProtocolPath,
  isWindowsDrivePath,
  resolveInsideRoot,
  sanitizeAttachmentFileName,
} from "../electron/pathSafety";

describe("path safety", () => {
  const root = path.resolve("/tmp/openonyx-vault");

  it("accepts the vault root and files inside it", () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, path.join(root, "notes", "a.md"))).toBe(true);
  });

  it("rejects sibling folders that only share a prefix", () => {
    expect(isInsideRoot(root, `${root}-secrets/pass.txt`)).toBe(false);
    expect(isInsideRoot(root, path.resolve(root, "..", "outside.md"))).toBe(false);
  });

  it("throws on relative traversal", () => {
    expect(() => resolveInsideRoot(root, "../../etc/passwd")).toThrow("Path traversal detected");
    expect(resolveInsideRoot(root, "attachments/pic.png")).toBe(
      path.join(root, "attachments", "pic.png"),
    );
  });

  it("blocks vault:// paths that walk out of the vault", () => {
    expect(isSafeVaultProtocolPath(root, "attachments/a.png")).toBe(true);
    expect(isSafeVaultProtocolPath(root, "../../etc/passwd")).toBe(false);
    expect(isSafeVaultProtocolPath(root, "C:note.md")).toBe(true);
  });

  it("identifies Windows drive paths only when followed by a slash or backslash", () => {
    expect(isWindowsDrivePath("C:/Windows")).toBe(true);
    expect(isWindowsDrivePath("D:\\folder\\file.txt")).toBe(true);
    expect(isWindowsDrivePath("C:note.md")).toBe(false);
    expect(isWindowsDrivePath("regular-file.txt")).toBe(false);
  });

  it("keeps attachment names inside the attachments folder", () => {
    expect(sanitizeAttachmentFileName("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeAttachmentFileName("photo.jpg")).toBe("photo.jpg");
    expect(() => sanitizeAttachmentFileName("..")).toThrow("Invalid attachment file name");
    expect(() => sanitizeAttachmentFileName("note.toolongext")).toThrow("Invalid attachment file extension");
  });
});
