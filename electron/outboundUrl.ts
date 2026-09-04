/** Validate a URL before the main process fetches it on behalf of the renderer. */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isBlockedIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (host === "metadata.google.internal") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("::ffff:")) return isBlockedHost(host.slice(7));
  return isBlockedIpv4(host);
}

/** Return a normalized public http(s) URL or throw. */
export function assertPublicHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A URL is required.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Outbound URL protocol is not allowed: ${url.protocol}`);
  }

  if (isBlockedHost(url.hostname)) {
    throw new Error("Outbound URL host is not allowed.");
  }

  return url.href;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

/**
 * Fetch a renderer-supplied URL safely.
 * Follows redirects while ensuring each redirect target is validated against
 * the public outbound URL policy (preventing SSRF hops to localhost, RFC1918, metadata, etc.).
 */
export async function fetchPublicHttp(url: unknown, init: RequestInit = {}): Promise<Response> {
  const redirectMode = init.redirect ?? "follow";

  if (redirectMode === "error") {
    return fetch(assertPublicHttpUrl(url), { ...init, redirect: "error" });
  }

  let currentUrl = assertPublicHttpUrl(url);
  let currentMethod = (init.method || "GET").toUpperCase();
  let currentHeaders = new Headers(init.headers);
  let currentBody = init.body;
  let redirectCount = 0;

  while (true) {
    const fetchInit: RequestInit = {
      ...init,
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      redirect: "manual",
    };

    const res = await fetch(currentUrl, fetchInit);

    if (redirectMode === "manual" || !REDIRECT_STATUS_CODES.has(res.status)) {
      return res;
    }

    redirectCount++;
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error("Maximum redirect limit reached.");
    }

    const location = res.headers.get("location");
    if (!location) {
      return res;
    }

    const nextUrl = assertPublicHttpUrl(new URL(location, currentUrl).href);

    const currentOrigin = new URL(currentUrl).origin;
    const nextOrigin = new URL(nextUrl).origin;
    if (currentOrigin !== nextOrigin) {
      currentHeaders.delete("authorization");
      currentHeaders.delete("cookie");
    }

    if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = undefined;
      currentHeaders.delete("content-type");
      currentHeaders.delete("content-length");
    }

    currentUrl = nextUrl;
  }
}
