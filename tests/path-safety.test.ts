import path from "path";
import { describe, expect, it } from "vitest";
import {
  isInsideRoot,
  isSafeVaultProtocolPath,
  resolveInsideRoot,
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
  });
});
