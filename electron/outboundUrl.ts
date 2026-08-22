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
