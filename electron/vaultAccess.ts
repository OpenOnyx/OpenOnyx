import * as path from "path";

const approvedVaultPaths = new Set<string>();

export function normalizeApprovedPath(targetPath: string): string {
  return path.resolve(targetPath);
}

export function approveVaultPath(targetPath: string | null | undefined): void {
  if (!targetPath) return;
  approvedVaultPaths.add(normalizeApprovedPath(targetPath));
}

export function seedApprovedVaultPaths(paths: Array<string | null | undefined>): void {
  approvedVaultPaths.clear();
  for (const entry of paths) {
    approveVaultPath(entry);
  }
}

export function isApprovedVaultPath(targetPath: string): boolean {
  if (!targetPath) return true;
  return approvedVaultPaths.has(normalizeApprovedPath(targetPath));
}
