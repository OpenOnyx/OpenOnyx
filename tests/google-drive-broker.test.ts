import { describe, expect, it, vi } from 'vitest';
import { createGoogleDriveBroker } from '../supabase/functions/google-drive-auth/handler';
import { createEncryptedBroker } from '../supabase/functions/google-drive-auth/transport';
import { encryptBrokerRequest } from '../electron/googleOAuthTransport';
import { googleTokenRequest } from '../electron/googleDriveOAuth';

const transportKeys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', transportKeys.privateKey));
const clientId = 'test.apps.googleusercontent.com';
const config = { clientId, clientSecret: 'server-only-test-secret', signingKey: 'test-signing-key-with-at-least-32-characters' };
const url = 'https://project.supabase.co/functions/v1/google-drive-auth';
const code = { client_id: clientId, grant_type: 'authorization_code', code: 'test-code', code_verifier: 'v'.repeat(43), redirect_uri: 'http://127.0.0.1:12345/oauth/google-drive' };
const request = (body: Record<string, string>, headers: Record<string, string> = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
const response = (data: unknown, status = 200) => Response.json(data, { status });
function setup() {
  const fetcher = vi.fn(async () => response({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.readonly' }));
  const allow = vi.fn(async (_key: string, _limit: number) => true);
  const handler = createGoogleDriveBroker({ config, fetcher: fetcher as typeof fetch, allow });
  return { fetcher, allow, handler };
}

describe('Google Drive Edge token broker', () => {
  it('adds the server secret only upstream and returns an allowlisted, non-cacheable response', async () => {
    const { handler, fetcher } = setup();
    const result = await handler(request(code)); const data = await result.json();
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(data).sort()).toEqual(['access_token', 'broker_ticket', 'expires_in', 'refresh_token', 'scope', 'token_type'].sort());
    expect(JSON.stringify(data)).not.toContain(config.clientSecret);
    const args = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(args[0]).toBe('https://oauth2.googleapis.com/token');
    expect((args[1].body as URLSearchParams).get('client_secret')).toBe(config.clientSecret);
    expect((args[1].body as URLSearchParams).get('code_verifier')).toBe(code.code_verifier);
  });

  it('requires a signed ticket bound to the refresh token and issues a new ticket on rotation', async () => {
    const { handler, fetcher } = setup();
    const first = await (await handler(request(code))).json();
    fetcher.mockResolvedValue(response({ access_token: 'next-access', refresh_token: 'rotated-refresh', token_type: 'Bearer' }));
    const form = { client_id: clientId, grant_type: 'refresh_token', refresh_token: 'test-refresh', broker_ticket: first.broker_ticket };
    const next = await (await handler(request(form))).json();
    expect(next.refresh_token).toBe('rotated-refresh'); expect(next.broker_ticket).not.toBe(first.broker_ticket);
    expect((await handler(request({ ...form, refresh_token: 'other-refresh' }))).status).toBe(401);
    expect((await handler(request({ ...form, broker_ticket: first.broker_ticket + 'x' }))).status).toBe(401);
    expect((await handler(request({ ...form, broker_ticket: '' }))).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects expired tickets without calling Google', async () => {
    const { fetcher, allow } = setup();
    const start = 100000;
    const firstHandler = createGoogleDriveBroker({ config, allow, fetcher: fetcher as typeof fetch, now: () => start });
    const first = await (await firstHandler(request(code))).json();
    const expired = createGoogleDriveBroker({ config, allow, fetcher: fetcher as typeof fetch, now: () => start + 366 * 86400000 });
    expect((await expired(request({ client_id: clientId, grant_type: 'refresh_token', refresh_token: 'test-refresh', broker_ticket: first.broker_ticket }))).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...code, client_id: 'other.apps.googleusercontent.com' },
    { ...code, client_secret: 'injected' },
    { ...code, code_verifier: 'short' },
    { ...code, redirect_uri: 'https://attacker.example/callback' },
    { ...code, redirect_uri: 'http://127.0.0.1:12345/oauth/google-drive?next=evil' },
    { ...code, refresh_token: 'mixed-grants' },
    { ...code, grant_type: 'client_credentials' },
  ])('rejects unsafe token parameters %#', async form => {
    const { handler, fetcher } = setup(); expect((await handler(request(form))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects browser origins, duplicate fields, oversized bodies and non-POST requests', async () => {
    const { handler, fetcher } = setup();
    expect((await handler(request(code, { Origin: 'https://attacker.example' }))).status).toBe(403);
    const duplicate = new URLSearchParams(code); duplicate.append('code', 'second');
    expect((await handler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: duplicate }))).status).toBe(400);
    expect((await handler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(32769) }))).status).toBe(413);
    expect((await handler(new Request(url))).status).toBe(405); expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed on rate limits, unavailable limiting storage and missing server configuration', async () => {
    const { handler, allow, fetcher } = setup();
    allow.mockResolvedValue(false); expect((await handler(request(code))).status).toBe(429);
    allow.mockRejectedValue(new Error('private-database-detail')); expect((await handler(request(code))).status).toBe(503);
    const unconfigured = createGoogleDriveBroker({ config: { ...config, clientSecret: '' }, allow, fetcher: fetcher as typeof fetch });
    expect((await unconfigured(request(code))).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes provider failures and never relays arbitrary fields or error descriptions', async () => {
    const { handler, fetcher } = setup();
    fetcher.mockResolvedValue(response({ error: 'invalid_grant', error_description: 'private-code-secret-details' }, 400));
    expect(await (await handler(request(code))).json()).toEqual({ error: 'invalid_grant' });
    fetcher.mockResolvedValue(response({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', client_secret: config.clientSecret, id_token: 'not-requested' }));
    expect(await (await handler(request(code))).text()).not.toContain('not-requested');
    fetcher.mockResolvedValue(response({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', scope: 'unrelated-scope' }));
    expect((await handler(request(code))).status).toBe(502);
    fetcher.mockResolvedValue(response({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive' }));
    expect((await handler(request(code))).status).toBe(502);
  });

  it('routes encrypted native exchange/refresh without logging plaintext tokens', async () => {
    const { handler, allow } = setup();
    const protectedHandler = createEncryptedBroker(handler, privateJwk, allow);
    const requests: string[] = [], responses: string[] = [];
    const transport = vi.fn(async (endpoint: string | URL | Request, options?: RequestInit) => {
      expect(endpoint).toBe(url);
      requests.push(String(options?.body || ''));
      const result = await protectedHandler(new Request(String(endpoint), options));
      responses.push(await result.clone().text());
      return result;
    }) as unknown as typeof fetch;
    const native = { clientId, tokenBrokerUrl: url };
    const first = await googleTokenRequest(code, native, transport);
    expect(first.brokerTicket).toBeTruthy();
    await googleTokenRequest({ grant_type: 'refresh_token', refresh_token: first.refreshToken, broker_ticket: first.brokerTicket! }, native, transport);
    await expect(googleTokenRequest({ grant_type: 'refresh_token', refresh_token: first.refreshToken }, native, transport)).rejects.toThrow('Reconnect');
    expect(transport).toHaveBeenCalledTimes(4);
    for (const logged of [...requests, ...responses]) {
      for (const secret of ['test-code', 'test-refresh', 'test-access', code.code_verifier, first.brokerTicket!, config.clientSecret]) expect(logged).not.toContain(secret);
    }
  });

  it('fails closed when a code exchange does not prove the requested scope', async () => {
    const { handler, fetcher } = setup();
    fetcher.mockResolvedValue(response({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer' }));
    const result = await handler(request(code));
    expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: 'invalid_grant' });
  });

  it('validates signed client/scope claims and safely migrates legacy tickets', async () => {
    const { handler, fetcher } = setup();
    const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
    const refreshHash = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-refresh'))));
    const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sign = async (fields: Record<string, unknown>) => {
      const payload = encode(new TextEncoder().encode(JSON.stringify(fields)));
      return payload + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(payload))));
    };
    const fields = { v: 2, client: clientId, scope: 'https://www.googleapis.com/auth/drive.readonly', refresh: refreshHash, expires: Date.now() + 60000 };
    const form = { client_id: clientId, grant_type: 'refresh_token', refresh_token: 'test-refresh' };
    for (const changes of [{ client: 'other.apps.googleusercontent.com' }, { scope: 'https://www.googleapis.com/auth/drive' }, { v: 3 }]) {
      expect((await handler(request({ ...form, broker_ticket: await sign({ ...fields, ...changes }) }))).status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const legacy = await sign({ v: 1, client: clientId, refresh: refreshHash, expires: fields.expires });
    fetcher.mockResolvedValue(response({ access_token: 'test-access', token_type: 'Bearer' }));
    expect((await handler(request({ ...form, broker_ticket: legacy }))).status).toBe(400);
    fetcher.mockResolvedValue(response({ access_token: 'test-access', token_type: 'Bearer', scope: fields.scope }));
    const result = await (await handler(request({ ...form, broker_ticket: legacy }))).json();
    const upgraded = JSON.parse(Buffer.from(result.broker_ticket.split('.')[0], 'base64url').toString());
    expect(upgraded).toMatchObject({ v: 2, scope: fields.scope });
  });

  it('does not let invalid refresh tickets consume valid refresh/exchange budgets', async () => {
    const { handler, allow, fetcher } = setup();
    const result = await handler(request({ client_id: clientId, grant_type: 'refresh_token', refresh_token: 'test-refresh', broker_ticket: 'forged.signature' }));
    expect(result.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    expect(allow.mock.calls.map(call => call[0])).not.toContain('refresh-global');
    expect(allow.mock.calls.map(call => call[0])).not.toContain('exchange-global');
  });

  it('rejects malformed ciphertext, reflected messages, and raw legacy token requests', async () => {
    const { handler, allow, fetcher } = setup(); const protectedHandler = createEncryptedBroker(handler, privateJwk, allow);
    expect((await protectedHandler(request(code))).status).toBe(415);
    const keyReply = await (await protectedHandler(new Request(url))).json();
    const sealed = await encryptBrokerRequest(keyReply.publicKey, new URLSearchParams(code).toString());
    await expect(sealed.decryptResponse(sealed.envelope)).rejects.toThrow();
    const tampered = { ...sealed.envelope, ciphertext: sealed.envelope.ciphertext.slice(0, -2) + 'xx' };
    expect((await protectedHandler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tampered) }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects ciphertext replays even when its JSON layout changes', async () => {
    const { handler, allow, fetcher } = setup(); const replay = new Set<string>();
    allow.mockImplementation(async (...args: unknown[]) => { const name = String(args[0]); if (!name.startsWith('replay:')) return true; if (replay.has(name)) return false; replay.add(name); return true; });
    const protectedHandler = createEncryptedBroker(handler, privateJwk, allow);
    const keyReply = await (await protectedHandler(new Request(url))).json();
    const sealed = await encryptBrokerRequest(keyReply.publicKey, new URLSearchParams(code).toString());
    const post = (body: string) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect((await protectedHandler(post(JSON.stringify(sealed.envelope)))).status).toBe(200);
    expect((await protectedHandler(post(JSON.stringify({ ciphertext: sealed.envelope.ciphertext, iv: sealed.envelope.iv, key: sealed.envelope.key, version: 1 }, null, 2)))).status).toBe(409);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    try { expect((await protectedHandler(post(JSON.stringify(sealed.envelope)))).status).toBe(409); } finally { clock.mockRestore(); }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects stale encrypted requests and missing transport keys', async () => {
    const { handler, allow, fetcher } = setup(); const protectedHandler = createEncryptedBroker(handler, privateJwk, allow);
    const keyReply = await (await protectedHandler(new Request(url))).json();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const sealed = await encryptBrokerRequest(keyReply.publicKey, new URLSearchParams(code).toString()); clock.mockRestore();
    expect((await protectedHandler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sealed.envelope) }))).status).toBe(400);
    expect((await createEncryptedBroker(handler, '', allow)(new Request(url))).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats broker outages as transient and does not report revoked credentials', async () => {
    const transport = vi.fn(async () => response({ error: 'broker_unavailable' }, 503)) as unknown as typeof fetch;
    await expect(googleTokenRequest(code, { clientId, tokenBrokerUrl: url }, transport)).rejects.toMatchObject({ kind: 'network' });
  });

  it('rejects unsafe broker URLs before sending user credentials', async () => {
    const transport = vi.fn();
    for (const tokenBrokerUrl of ['http://project.supabase.co/functions/v1/google-drive-auth', 'https://attacker.example/token', url + '?redirect=evil', 'https://user:password@project.supabase.co/functions/v1/google-drive-auth']) {
      await expect(googleTokenRequest(code, { clientId, tokenBrokerUrl }, transport)).rejects.toThrow('configuration');
    }
    expect(transport).not.toHaveBeenCalled();
  });
});
