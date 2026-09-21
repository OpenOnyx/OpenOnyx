import * as fs from "fs";
import * as path from "path";

/** Safely resolve real physical path resolving symlinks and existing components */
export function getRealPath(targetPath: string, visited: Set<string> = new Set()): string {
  const resolved = path.resolve(targetPath);
  if (visited.has(resolved)) {
    return resolved;
  }
  visited.add(resolved);

  try {
    return fs.realpathSync(resolved);
  } catch {
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(resolved);
        const resolvedTarget = path.resolve(path.dirname(resolved), linkTarget);
        return getRealPath(resolvedTarget, visited);
      }
    } catch {
      // Not a symlink or cannot stat
    }

    let current = resolved;
    const tail: string[] = [];
    while (current && current !== path.dirname(current)) {
      tail.unshift(path.basename(current));
      current = path.dirname(current);
      try {
        if (fs.existsSync(current)) {
          const realParent = fs.realpathSync(current);
          return path.join(realParent, ...tail);
        }
      } catch {
        // continue walking up
      }
    }
  }

  return resolved;
}

/** True when `candidate` is `root` or a file inside it. Performs symlink resolution. */
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;

  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);

  // String prefix check
  const normRoot = path.normalize(resolvedRoot);
  const normCandidate = path.normalize(resolvedCandidate);

  const isStringInside =
    process.platform === "win32"
      ? normCandidate.toLowerCase() === normRoot.toLowerCase() ||
        normCandidate.toLowerCase().startsWith(normRoot.toLowerCase() + path.sep)
      : normCandidate === normRoot || normCandidate.startsWith(normRoot + path.sep);

  if (!isStringInside) {
    return false;
  }

  // Symlink check: resolve real physical paths
  try {
    const realRoot = getRealPath(resolvedRoot);
    const realCandidate = getRealPath(resolvedCandidate);

    const normRealRoot = path.normalize(realRoot);
    const normRealCandidate = path.normalize(realCandidate);

    if (process.platform === "win32") {
      const lowerRoot = normRealRoot.toLowerCase();
      const lowerCandidate = normRealCandidate.toLowerCase();
      return (
        lowerCandidate === lowerRoot ||
        lowerCandidate.startsWith(lowerRoot + path.sep)
      );
    }

    return (
      normRealCandidate === normRealRoot ||
      normRealCandidate.startsWith(normRealRoot + path.sep)
    );
  } catch {
    return false;
  }
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
  if (!vaultPath || typeof relativePath !== "string") return false;
  const cleaned = relativePath.replace(/^\/+/, "");

  const isWinAbs = /^[a-zA-Z]:/.test(cleaned) || path.win32.isAbsolute(relativePath);
  const isPosixAbs = path.posix.isAbsolute(relativePath);

  if (isWinAbs) {
    if (process.platform === "win32") {
      try {
        const resolved = path.win32.resolve(relativePath);
        return isInsideRoot(vaultPath, resolved);
      } catch {
        return false;
      }
    } else {
      // On non-Windows platforms, a drive letter path (e.g. C:/...) is an absolute Windows path
      // that cannot be inside a POSIX vault directory.
      return false;
    }
  }

  if (isPosixAbs) {
    try {
      const resolved = path.posix.resolve(relativePath);
      return isInsideRoot(vaultPath, resolved);
    } catch {
      return false;
    }
  }

  try {
    const resolved = path.resolve(vaultPath, cleaned);
    return isInsideRoot(vaultPath, resolved);
  } catch {
    return false;
  }
}

/** Basename-only attachment name that cannot walk out of the attachments folder. */
export function sanitizeAttachmentFileName(fileName: string): string {
  const base = path.basename(fileName || "").trim();
  if (!base || base === "." || base === "..") {
    throw new Error("Invalid attachment file name");
  }
  const ext = path.extname(base);
  if (ext && !/^\.[A-Za-z0-9]{1,8}$/.test(ext)) {
    throw new Error("Invalid attachment file extension");
  }
  return base;
}
