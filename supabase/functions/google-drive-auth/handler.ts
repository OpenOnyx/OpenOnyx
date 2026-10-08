export interface BrokerConfig { clientId: string; clientSecret: string; signingKey: string }
export interface BrokerDependencies {
  config: BrokerConfig;
  fetcher?: typeof fetch;
  /** Persistent, atomic limiter; must fail closed when unavailable. */
  allow: (key: string, limit: number) => Promise<boolean>;
  now?: () => number;
}
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const utf8 = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function digest(value: string): Promise<string> { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))); }
const token = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\x00]/.test(value);
const reply = (status: number, data: unknown) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });

/** No tokens are persisted here or logged. Only Google token endpoint calls are possible. */
export function createGoogleDriveBroker(dependencies: BrokerDependencies): (request: Request) => Promise<Response> {
  const { config, allow } = dependencies;
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const key = () => crypto.subtle.importKey('raw', utf8.encode(config.signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  async function issue(refresh: string): Promise<string> {
    const payload = encode(utf8.encode(JSON.stringify({ v: 2, scope: SCOPE, client: config.clientId, refresh: await digest(refresh), expires: now() + 365 * 86400000 })));
    return payload + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(), utf8.encode(payload))));
  }
  async function validTicket(ticket: unknown, refresh: string): Promise<0 | 1 | 2> {
    if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) return 0;
    try {
      const [payload, signature] = ticket.split('.');
      if (!await crypto.subtle.verify('HMAC', await key(), decode(signature), utf8.encode(payload))) return 0;
      const data = JSON.parse(new TextDecoder().decode(decode(payload)));
      if ((data.v !== 1 && data.v !== 2) || (data.v === 2 && data.scope !== SCOPE) || data.client !== config.clientId || data.refresh !== await digest(refresh)
        || !Number.isFinite(data.expires) || data.expires <= now() || data.expires > now() + 365 * 86400000) return 0;
      return data.v;

    } catch { return 0; }
  }
  return async request => {
    if (request.method !== 'POST') return reply(405, { error: 'invalid_request' });
    // Electron main makes this request. No browser CORS access or cookie authentication.
    if (request.headers.has('origin')) return reply(403, { error: 'invalid_request' });
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId) || !config.clientSecret || config.signingKey.length < 32) return reply(503, { error: 'broker_unavailable' });
    try {
      const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
      if (!(await allow('ip:' + await digest(ip), 30))) return reply(429, { error: 'rate_limited' });
      if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return reply(415, { error: 'invalid_request' });
      // Stream-bound the request rather than trusting Content-Length.
      const reader = request.body?.getReader(); if (!reader) return reply(400, { error: 'invalid_request' });
      const chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 32768) { await reader.cancel(); return reply(413, { error: 'invalid_request' }); } chunks.push(chunk.value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const input = new URLSearchParams(new TextDecoder().decode(bytes));
      const permitted = ['client_id', 'grant_type', 'code', 'code_verifier', 'redirect_uri', 'refresh_token', 'broker_ticket'];
      if ([...input.keys()].some(k => !permitted.includes(k) || input.getAll(k).length !== 1) || input.get('client_id') !== config.clientId) return reply(400, { error: 'invalid_request' });
      const grant = input.get('grant_type');
      const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: grant || '' });
      let refresh = ''; let ticketVersion: 0 | 1 | 2 = 0;
      if (grant === 'authorization_code') {
        const code = input.get('code'), verifier = input.get('code_verifier'), redirect = input.get('redirect_uri');
        if (!token(code) || code.length > 4096 || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !redirect || input.has('refresh_token') || input.has('broker_ticket')) return reply(400, { error: 'invalid_request' });
        const url = new URL(redirect);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024 || url.pathname !== '/oauth/google-drive' || url.search || url.hash || url.username || url.password) return reply(400, { error: 'invalid_request' });
        body.set('code', code); body.set('code_verifier', verifier); body.set('redirect_uri', redirect);
      } else if (grant === 'refresh_token') {
        const value = input.get('refresh_token');
        if (!token(value) || input.has('code') || input.has('code_verifier') || input.has('redirect_uri')) return reply(400, { error: 'invalid_request' });
        ticketVersion = await validTicket(input.get('broker_ticket'), value);
        if (!ticketVersion) return reply(401, { error: 'invalid_grant' });
        if (!await allow('refresh:' + await digest(value), 10)) return reply(429, { error: 'rate_limited' });
        refresh = value; body.set('refresh_token', value);
      } else return reply(400, { error: 'invalid_request' });
      // Unauthenticated exchanges cannot consume the separate refresh budget.
      if (!await allow(grant === 'refresh_token' ? 'refresh-global' : 'exchange-global', grant === 'refresh_token' ? 180 : 120)) return reply(429, { error: 'rate_limited' });
      const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        if (data?.error === 'invalid_grant') return reply(400, { error: 'invalid_grant' });
        if (data?.error === 'invalid_client' || data?.error === 'unauthorized_client' || data?.error === 'invalid_request') return reply(400, { error: 'invalid_client' });
        return reply(502, { error: 'broker_unavailable' });
      }
      if (!data || !token(data.access_token) || data.token_type !== 'Bearer' || (data.refresh_token !== undefined && !token(data.refresh_token))
        || (data.expires_in !== undefined && (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0))
        || (typeof data.scope === 'string' && data.scope.split(/\s+/).filter(Boolean).some(scope => scope !== SCOPE))) return reply(502, { error: 'broker_unavailable' });
      const returnedScopes = typeof data.scope === 'string' ? data.scope.trim().split(/\s+/).filter(Boolean) : [];
      const scopeVerified = returnedScopes.length === 1 && returnedScopes[0] === SCOPE;
      if (!scopeVerified && (grant === 'authorization_code' || ticketVersion !== 2 || data.scope !== undefined)) return reply(400, { error: 'invalid_grant' });
      refresh = typeof data.refresh_token === 'string' ? data.refresh_token : refresh;
      if (!refresh) return reply(400, { error: 'invalid_grant' });
      return reply(200, { access_token: data.access_token, token_type: 'Bearer', expires_in: Math.min(typeof data.expires_in === 'number' ? data.expires_in : 3600, 3600),
        ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}), scope: SCOPE, broker_ticket: await issue(refresh) });
    } catch { return reply(503, { error: 'broker_unavailable' }); }
  };
}
