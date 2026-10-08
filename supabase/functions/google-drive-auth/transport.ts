import { decryptBrokerRequest, validBrokerPublicKey, type BrokerPublicKey } from '../../../electron/googleOAuthTransport.ts';

/** The gateway sees only public keys/ciphertext, never OAuth request/response values. */
export function createEncryptedBroker(handler: (request: Request) => Promise<Response>, privateJwk: string,
  allow: (key: string, limit: number) => Promise<boolean>): (request: Request) => Promise<Response> {
  const json = (data: unknown, status: number) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  let publicKey: BrokerPublicKey | undefined;
  let privateKey: Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> | undefined;
  try {
    const jwk = JSON.parse(privateJwk);
    const candidate = { kty: jwk.kty, n: jwk.n, e: jwk.e };
    if (!validBrokerPublicKey(candidate) || typeof jwk.d !== 'string') throw new Error('Missing key');
    publicKey = candidate;
    privateKey = crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    // Avoid an unhandled rejection containing provider details.
    void privateKey.catch(() => {});
  } catch { /* fail closed, without logging configuration */ }
  return async request => {
    if (request.headers.has('origin')) return json({ error: 'invalid_request' }, 403);
    if (!publicKey || !privateKey) return json({ error: 'broker_unavailable' }, 503);
    if (request.method === 'GET') return json({ version: 1, publicKey }, 200);
    if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
    try {
      // Separate encrypted-ingress budget bounds decrypt/database cost. It does
      // not spend valid exchange/refresh quotas on malformed ciphertext.
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'invalid_request' }, 415);
      const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
      const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!await allow('ingress', 300) || !await allow('transport-ip:' + ipHash, 30)) return json({ error: 'rate_limited' }, 429);
      const reader = request.body?.getReader(); if (!reader) return json({ error: 'invalid_request' }, 400);
      const chunks: Uint8Array[] = []; let size = 0;
      const deadline = setTimeout(() => { void reader.cancel().catch(() => {}); }, 5000);
      try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length;
        if (size > 65536) { await reader.cancel(); return json({ error: 'invalid_request' }, 413); } chunks.push(item.value); } }
      finally { clearTimeout(deadline); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const item of chunks) { bytes.set(item, offset); offset += item.length; }
      let opened; let envelope;
      try { envelope = JSON.parse(new TextDecoder().decode(bytes)); opened = await decryptBrokerRequest(await privateKey, envelope); }
      catch { return json({ error: 'invalid_request' }, 400); }
      const replayHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([envelope.version, envelope.key, envelope.iv, envelope.ciphertext]))))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (!await allow('replay:' + replayHash, 1)) return json(await opened.encryptResponse(JSON.stringify({ error: 'invalid_request' })), 409);
      const headers = new Headers(request.headers); headers.set('Content-Type', 'application/x-www-form-urlencoded'); headers.delete('content-length');
      const result = await handler(new Request(request.url, { method: 'POST', headers, body: opened.plaintext, signal: request.signal }));
      const responseEnvelope = await opened.encryptResponse(await result.text());
      return new Response(JSON.stringify(responseEnvelope), { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(result.headers.has('Retry-After') ? { 'Retry-After': result.headers.get('Retry-After')! } : {}) } });
    } catch { return json({ error: 'broker_unavailable' }, 503); }
  };
}
