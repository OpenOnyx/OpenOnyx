import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveVaultPath,
  isApprovedVaultPath,
  seedApprovedVaultPaths,
} from "../electron/vaultAccess";

describe("approved vault paths", () => {
  beforeEach(() => {
    seedApprovedVaultPaths([]);
  });

  it("rejects unknown renderer-supplied paths", () => {
    expect(isApprovedVaultPath("")).toBe(true);
    expect(isApprovedVaultPath("/tmp/not-a-known-vault")).toBe(false);
  });

  it("accepts dialog-approved and previously opened vaults", () => {
    const vault = path.resolve("/tmp/openonyx-approved-vault");
    approveVaultPath(vault);
    expect(isApprovedVaultPath(vault)).toBe(true);
    expect(isApprovedVaultPath("/Users/me")).toBe(false);
  });
});
