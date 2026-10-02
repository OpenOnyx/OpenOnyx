import * as fs from "fs";
import * as path from "path";

/** Helper to detect Windows drive-letter paths (e.g. C:/ or D:\) across platforms */
export function isWindowsDrivePath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  return /^[a-zA-Z]:[/\\]/.test(p);
}

/** Helper to check if a path is absolute across Windows and POSIX */
export function isCrossPlatformAbsolute(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  return (
    path.win32.isAbsolute(p) ||
    path.posix.isAbsolute(p) ||
    isWindowsDrivePath(p) ||
    /^\\\\[^\\]/.test(p) ||
    /^\/\/[^\/]/.test(p)
  );
}

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

/** Helper to check if candidate path is lexically inside root path (case-insensitive on Windows) */
function isLexicallyInside(base: string, target: string): boolean {
  if (!base || !target) return false;
  const normBase = path.normalize(path.resolve(base));
  const normTarget = path.normalize(path.resolve(target));

  if (process.platform === "win32") {
    const lowerBase = normBase.toLowerCase();
    const lowerTarget = normTarget.toLowerCase();
    return (
      lowerTarget === lowerBase ||
      lowerTarget.startsWith(lowerBase.endsWith(path.sep) ? lowerBase : lowerBase + path.sep)
    );
  }

  return (
    normTarget === normBase ||
    normTarget.startsWith(normBase.endsWith(path.sep) ? normBase : normBase + path.sep)
  );
}

/** True when `candidate` is `root` or a file inside it. Performs symlink and lexical resolution. */
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;

  // On non-Windows platforms, a Windows drive path (e.g. C:/Windows) cannot be inside a POSIX root
  if (process.platform !== "win32") {
    if (isWindowsDrivePath(candidate)) {
      return false;
    }
  } else {
    // On Windows, if root is a drive path but candidate is on another drive
    if (isWindowsDrivePath(root) && isWindowsDrivePath(candidate)) {
      if (root[0].toLowerCase() !== candidate[0].toLowerCase()) {
        return false;
      }
    }
  }

  // Symlink check: resolve real physical paths
  try {
    const realRoot = getRealPath(root);

    // 1. Lexical containment check: Candidate must be lexically inside root/realRoot,
    // or its enclosing directory's realpath must be inside realRoot (for symlinked root directories).
    const isLexicalDirect = isLexicallyInside(root, candidate) || isLexicallyInside(realRoot, candidate);
    if (!isLexicalDirect) {
      const candidateDir = path.dirname(path.resolve(candidate));
      const realCandidateDir = getRealPath(candidateDir);
      if (!isLexicallyInside(realRoot, realCandidateDir) && !isLexicallyInside(root, realCandidateDir)) {
        return false;
      }
    }

    // 2. Physical check: The target itself (resolving any symlinks) must be inside realRoot.
    const realCandidate = getRealPath(candidate);
    return isLexicallyInside(realRoot, realCandidate);
  } catch {
    return false;
  }
}

/** Resolve `relativePath` against `root` and throw if it escapes the root. */
export function resolveInsideRoot(root: string, relativePath: string): string {
  if (!root) throw new Error("No vault path set");
  if (typeof relativePath !== "string") throw new Error("Path traversal detected");

  // On non-Windows platforms, a Windows drive path (e.g. C:/Windows) is not relative to POSIX root
  if (process.platform !== "win32" && isWindowsDrivePath(relativePath)) {
    throw new Error("Path traversal detected");
  }

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

  if (isWindowsDrivePath(cleaned) || path.win32.isAbsolute(relativePath)) {
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

  if (path.posix.isAbsolute(relativePath)) {
    try {
      const resolved = path.posix.resolve(relativePath);
      return isInsideRoot(vaultPath, resolved);
    } catch {
      return false;
    }
  }

  try {
    const resolved = resolveInsideRoot(vaultPath, cleaned);
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
