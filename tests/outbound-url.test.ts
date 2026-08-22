import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "../electron/outboundUrl";

describe("outbound URL policy", () => {
  it("allows public http and https URLs", () => {
    expect(assertPublicHttpUrl("https://raw.githubusercontent.com/org/repo/main/README.md")).toContain(
      "https://raw.githubusercontent.com/",
    );
    expect(assertPublicHttpUrl("http://example.com/api")).toBe("http://example.com/api");
  });

  it.each([
    "file:///etc/passwd",
    "http://localhost:8765/build",
    "http://127.0.0.1/",
    "http://192.168.1.1/",
    "http://10.0.0.5/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "ftp://example.com/a",
  ])("rejects %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow();
  });
});
