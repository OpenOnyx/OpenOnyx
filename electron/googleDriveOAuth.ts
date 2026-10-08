import { encryptBrokerRequest, validBrokerPublicKey } from './googleOAuthTransport.js';
import { createServer, type ServerResponse } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
// Installed-app identity contains only the public client ID.
export interface GoogleOAuthConfig { clientId: string; tokenBrokerUrl?: string }
export function validGoogleTokenBrokerUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    && url.pathname === '/functions/v1/google-drive-auth' && !url.port && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export interface OAuthTokens { accessToken: string; refreshToken: string; expiresAt: number; brokerTicket?: string }
export class GoogleOAuthError extends Error {
  constructor(readonly kind: 'configuration' | 'reconnect' | 'network' | 'cancelled' | 'timeout' | 'failed', message: string) { super(message); }
}

export async function googleTokenRequest(parameters: Record<string, string>, config: GoogleOAuthConfig, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<OAuthTokens> {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) throw new GoogleOAuthError('configuration', 'Google Drive authorization is not configured for this build.');
  if (config.tokenBrokerUrl !== undefined && !validGoogleTokenBrokerUrl(config.tokenBrokerUrl)) throw new GoogleOAuthError('configuration', 'Google authorization client configuration was rejected. Ask the app maintainer to check it.');
  if (config.tokenBrokerUrl && parameters.grant_type === 'refresh_token' && !parameters.broker_ticket) throw new GoogleOAuthError('reconnect', 'Reconnect Google Drive to renew authorization.');
  // Allowlist fields rather than forwarding legacy configuration or arbitrary parameters.
  const body = new URLSearchParams({ client_id: config.clientId });
  for (const key of ['grant_type', 'code', 'code_verifier', 'redirect_uri', 'refresh_token']) {
    if (typeof parameters[key] === 'string') body.set(key, parameters[key]);
  }
  if (config.tokenBrokerUrl && parameters.broker_ticket) body.set('broker_ticket', parameters.broker_ticket);
  let response: Response;
  let decryptResponse: ((value: unknown) => Promise<string>) | undefined;
  try {
    let requestBody: string | URLSearchParams = body;
    if (config.tokenBrokerUrl) {
      const keys = await fetcher(config.tokenBrokerUrl, { method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
      const keyPayload: unknown = await keys.json().catch(() => null);
      const keyData = keyPayload && typeof keyPayload === 'object' ? keyPayload as Record<string, unknown> : {};
      if (!keys.ok || keyData?.version !== 1 || !validBrokerPublicKey(keyData.publicKey)) throw new Error('Broker unavailable');
      const encrypted = await encryptBrokerRequest(keyData.publicKey, body.toString());
      requestBody = JSON.stringify(encrypted.envelope); decryptResponse = encrypted.decryptResponse;
    }
    response = await fetcher(config.tokenBrokerUrl || 'https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { 'Content-Type': config.tokenBrokerUrl ? 'application/json' : 'application/x-www-form-urlencoded' },
      body: requestBody,
    });
  } catch {
    if (signal?.aborted) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
    throw new GoogleOAuthError('network', 'Google Drive is unavailable. Your saved snapshots remain readable.');
  }
  let payload: unknown = await response.json().catch(() => null);
  if (decryptResponse && (response.ok || (payload && typeof payload === 'object' && (payload as { version?: number }).version === 1))) {
    try { payload = JSON.parse(await decryptResponse!(payload)); } catch { throw new GoogleOAuthError('network', 'Google Drive authorization service is unavailable. Your saved snapshots remain readable.'); }
  }
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (!response.ok) {
    if (config.tokenBrokerUrl && (response.status >= 500 || response.status === 429)) throw new GoogleOAuthError('network', 'Google Drive authorization service is unavailable. Try again. Your saved snapshots remain readable.');
    if (data.error === 'invalid_request' && typeof data.error_description === 'string'
      && /client_secret.*missing|missing.*client_secret/i.test(data.error_description)) {
      throw new GoogleOAuthError('configuration', 'Google authorization configuration is incomplete for this build. Ask the app maintainer to check the Desktop client.');
    }
    if (data.error === 'invalid_client' || data.error === 'unauthorized_client') throw new GoogleOAuthError('configuration', 'Google authorization client configuration was rejected. Ask the app maintainer to check it.');
    if (data.error === 'invalid_grant') throw new GoogleOAuthError('reconnect', 'Google authorization expired or was revoked. Start a new connection.');
    throw new GoogleOAuthError('failed', 'Google authorization could not complete the token exchange. Try again.');
  }
  if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 || /[\r\n]/.test(data.access_token)
    || data.token_type !== 'Bearer' || (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 16384))
    || (data.expires_in !== undefined && (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0))) {
    throw new GoogleOAuthError('failed', 'Google did not grant valid access. Try connecting again.');
  }
  if (config.tokenBrokerUrl && (typeof data.broker_ticket !== 'string' || data.broker_ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.broker_ticket))) throw new GoogleOAuthError('failed', 'Google did not grant valid access. Try connecting again.');
  if (typeof data.scope === 'string' && !data.scope.split(' ').includes(DRIVE_SCOPE)) throw new GoogleOAuthError('reconnect', 'Google Drive read access was not granted. Reconnect to continue.');
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '', ...(config.tokenBrokerUrl ? { brokerTicket: data.broker_ticket as string } : {}), expiresAt: Date.now() + Math.min(typeof data.expires_in === 'number' ? data.expires_in : 3600, 3600) * 1000 };
}

interface AuthorizationOptions {
  /** Complete native account identification/storage before telling the browser success. */
  onAuthorized?: (tokens: OAuthTokens, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

/** External browser + temporary loopback, state and S256 PKCE. No tokens cross IPC. */
export async function authorizeGoogle(config: GoogleOAuthConfig, openBrowser: (url: string) => Promise<void>, signal: AbortSignal, fetcher: typeof fetch = fetch, options: AuthorizationOptions = {}): Promise<OAuthTokens> {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) throw new GoogleOAuthError('configuration', 'Google Drive authorization is not configured for this build.');
  if (config.tokenBrokerUrl !== undefined && !validGoogleTokenBrokerUrl(config.tokenBrokerUrl)) throw new GoogleOAuthError('configuration', 'Google Drive authorization is not configured for this build.');
  if (signal.aborted) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const attempt = new AbortController();
  let timedOut = false;
  const abort = () => attempt.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; attempt.abort(); }, options.timeoutMs ?? 120000);
  const server = createServer();
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  let completion: ServerResponse | undefined;
  const respond = (response: ServerResponse, status: number, message: string) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Connection: 'close' });
    response.end(message);
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Listener unavailable');
    const redirect = `http://127.0.0.1:${address.port}/oauth/google-drive`;
    const code = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const cancel = () => finish(new GoogleOAuthError(timedOut ? 'timeout' : 'cancelled', timedOut ? 'Google authorization timed out. Try again.' : 'Google authorization was cancelled.'));
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true; attempt.signal.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(value!);
      };
      attempt.signal.addEventListener('abort', cancel, { once: true });
      if (attempt.signal.aborted) { cancel(); return; }
      server.on('request', (request, response) => {
        const invalid = () => respond(response, 400, 'Invalid authorization response. Return to OpenOnyx.');
        if (settled || request.method !== 'GET' || request.headers.host !== `127.0.0.1:${address.port}` || !request.url?.startsWith('/') || request.url.startsWith('//')) { invalid(); return; }
        let url: URL;
        try { url = new URL(request.url, redirect); } catch { invalid(); return; }
        const received = url.searchParams.get('state') || '';
        if (url.pathname !== '/oauth/google-drive' || url.searchParams.getAll('state').length !== 1
          || !/^[A-Za-z0-9_-]{43}$/.test(received) || !timingSafeEqual(Buffer.from(received), Buffer.from(state))) { invalid(); return; }
        const value = url.searchParams.get('code'), error = url.searchParams.get('error');
        if ((value && error) || url.searchParams.getAll('code').length > 1 || url.searchParams.getAll('error').length > 1) { invalid(); return; }
        completion = response;
        if (error) { finish(new GoogleOAuthError(error === 'access_denied' ? 'cancelled' : 'failed', error === 'access_denied' ? 'Google authorization was cancelled.' : 'Google authorization was not granted. Try again.')); return; }
        if (!value || value.length > 4096 || /[\r\n\x00]/.test(value)) { finish(new GoogleOAuthError('failed', 'Google authorization response was invalid. Try again.')); return; }
        finish(undefined, value);
      });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect, response_type: 'code', scope: DRIVE_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'select_account consent' }).toString();
      void openBrowser(url.toString()).catch(() => finish(new GoogleOAuthError('failed', 'Could not open your browser for Google authorization.')));
    });
    const tokens = await googleTokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }, config, fetcher, attempt.signal);
    await options.onAuthorized?.(tokens, attempt.signal);
    if (attempt.signal.aborted) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
    if (completion) respond(completion, 200, 'OpenOnyx connected successfully. You can close this tab.');
    return tokens;
  } catch (error) {
    if (completion && !completion.writableEnded) respond(completion, 400, 'Google Drive was not connected. Return to OpenOnyx to try again.');
    if (timedOut) throw new GoogleOAuthError('timeout', 'Google authorization timed out. Try again.');
    if (signal.aborted) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
    if (error instanceof GoogleOAuthError) throw error;
    throw new GoogleOAuthError('failed', "Google authorization couldn't complete. Try again.");
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort);
    server.close(); server.closeIdleConnections();
    // Flush the tiny completion response before closing remaining connections.
    if (completion && !completion.writableFinished && !completion.destroyed) {
      const cleanup = setTimeout(() => server.closeAllConnections(), 1000);
      completion.once('finish', () => { clearTimeout(cleanup); server.closeAllConnections(); });
      completion.once('close', () => { clearTimeout(cleanup); server.closeAllConnections(); });
    } else server.closeAllConnections();
  }
}
