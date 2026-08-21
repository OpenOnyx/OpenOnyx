/**
 * Deterministic note IDs used when upserting cloud space notes.
 * Kept in its own module so tests can cover collisions without loading the store.
 */
export function generateDeterministicId(spaceId: string, notePath: string): string {
  const input = `${spaceId}:${notePath}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const h1 = Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
  const h2 = Math.abs(hash * 31).toString(16).padStart(8, "0").slice(0, 8);
  const h3 = Math.abs(hash * 37).toString(16).padStart(8, "0").slice(0, 8);
  const h4 = Math.abs(hash * 41).toString(16).padStart(8, "0").slice(0, 8);
  return `${h1}-${h2.slice(0, 4)}-4${h2.slice(5, 8)}-${h3.slice(0, 4)}-${h4}${h1.slice(0, 4)}`;
}

export function looksLikeUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
