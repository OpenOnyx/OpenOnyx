import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl, fetchPublicHttp } from "../electron/outboundUrl";

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

  describe("fetchPublicHttp", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("rejects private hosts before calling fetch", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchPublicHttp("http://127.0.0.1/secret")).rejects.toThrow(
        "Outbound URL host is not allowed.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not allow redirects to hop to loopback or private hosts", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: "http://127.0.0.1/secret" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchPublicHttp("https://example.com/redirect")).rejects.toThrow(
        "Outbound URL host is not allowed.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("follows redirects to allowed public URLs", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({ location: "https://cdn.example.com/file.js" }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Headers(),
        });
      vi.stubGlobal("fetch", fetchMock);

      const res = await fetchPublicHttp("https://example.com/file.js");
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/file.js");
      expect(fetchMock.mock.calls[1][0]).toBe("https://cdn.example.com/file.js");
    });

    it("respects explicit redirect: error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await fetchPublicHttp("https://example.com/test", { redirect: "error" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.redirect).toBe("error");
    });

    it("limits maximum redirects to prevent infinite loops", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: "https://example.com/loop" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchPublicHttp("https://example.com/loop")).rejects.toThrow(
        "Maximum redirect limit reached.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(11);
    });
  });
});
