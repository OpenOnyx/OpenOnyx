/**
 * Resolves a local image path to an absolute file:// URI or vault:// protocol URL
 * relative to the current vault path.
 */
export function resolveVaultImageSrc(src: string): string {
  if (!src) return src;

  let trimmed = src.trim();

  // Strip wrapping angle brackets if present e.g. <data:image/...>
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Handle potential typos or missing prefixes in base64 strings (e.g. "drata:image/..." or raw base64)
  if (trimmed.includes(';base64,')) {
    if (!trimmed.startsWith('data:')) {
      const base64Idx = trimmed.indexOf(';base64,');
      const mimePart = trimmed.slice(0, base64Idx);
      const colonIdx = mimePart.lastIndexOf(':');
      const mimeType = colonIdx !== -1 ? mimePart.slice(colonIdx + 1) : 'image/png';
      return `data:${mimeType};base64,${trimmed.slice(base64Idx + 8)}`;
    }
    return trimmed;
  }

  // Return early if it's already an absolute URL, blob, data URI, file://, or vault://
  if (
    /^(https?|data|file|blob|vault):/i.test(trimmed) ||
    trimmed.startsWith('data:') ||
    trimmed.includes(':image/') ||
    trimmed.length > 500
  ) {
    return trimmed;
  }

  // Use the custom vault:// protocol which handles
  // both exact paths and filename searching across the vault
  let urlPath = trimmed;
  if (urlPath.startsWith('/')) {
    urlPath = urlPath.slice(1);
  }

  // URL encode the path segments to handle spaces properly
  // but keep slashes intact so paths work
  const segments = urlPath.split('/').map(encodeURIComponent);
  // Prepend 'local/' as the host part because custom protocols with standard: true
  // lowercase the host part. This ensures the case-sensitive filename is preserved in the path.
  return `vault://local/${segments.join('/')}`;
}
