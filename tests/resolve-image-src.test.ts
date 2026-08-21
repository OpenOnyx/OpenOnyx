import { describe, expect, it } from "vitest";
import { resolveVaultImageSrc } from "../src/utils/resolveImageSrc";

describe("resolveVaultImageSrc", () => {
  it("returns empty values unchanged", () => {
    expect(resolveVaultImageSrc("")).toBe("");
  });

  it("keeps remote, data, file, and vault urls", () => {
    expect(resolveVaultImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(resolveVaultImageSrc("file:///tmp/a.png")).toBe("file:///tmp/a.png");
    expect(resolveVaultImageSrc("vault://local/a.png")).toBe("vault://local/a.png");
    expect(resolveVaultImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("repairs missing data: prefixes on base64 strings", () => {
    expect(resolveVaultImageSrc("drata:image/jpeg;base64,qqq")).toBe("data:image/jpeg;base64,qqq");
  });

  it("maps vault-relative paths to vault:// and encodes spaces", () => {
    expect(resolveVaultImageSrc("attachments/my photo.png")).toBe(
      "vault://local/attachments/my%20photo.png",
    );
    expect(resolveVaultImageSrc("/attachments/a.png")).toBe("vault://local/attachments/a.png");
  });
});
