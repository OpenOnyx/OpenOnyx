import * as path from "path";

/** True when `candidate` is `root` or a file inside it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root) return false;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

/** Resolve `relativePath` against `root` and throw if it escapes the root. */
export function resolveInsideRoot(root: string, relativePath: string): string {
  if (!root) throw new Error("No vault path set");
  const resolved = path.resolve(root, relativePath);
  if (!isInsideRoot(root, resolved)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/** True when a vault:// relative path stays inside the vault. */
export function isSafeVaultProtocolPath(vaultPath: string, relativePath: string): boolean {
  const cleaned = relativePath.replace(/^\/+/, "");
  const resolved = path.resolve(vaultPath, cleaned);
  return isInsideRoot(vaultPath, resolved);
}
