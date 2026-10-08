import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { GoogleDriveCredentialStore } from '../electron/googleDriveStore';
import { GoogleDriveProvider, normalizeDriveFile, driveSearchQuery } from '../electron/googleDriveProvider';
import { createEncryptedBroker } from '../supabase/functions/google-drive-auth/transport';
import { authorizeGoogle, googleTokenRequest, DRIVE_SCOPE } from '../electron/googleDriveOAuth';

const account = { id: 'drive-' + 'a'.repeat(24), email: 'person@example.test', name: 'Person', refreshToken: 'test-refresh-secret', clientId: 'test.apps.googleusercontent.com' };
const file = { id: 'abc_123', name: 'Project proposal', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T10:00:00Z', owners: [{ displayName: 'Person' }] };
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-drive-test-')); directories.push(directory);
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptString: (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'); },
  };
  const store = new GoogleDriveCredentialStore(directory, encryption); await store.save([account]);
  return { store, directory, encryption };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

it('stores credentials encrypted and refuses Linux plaintext fallback', async () => {
  const { store: credentials, directory, encryption } = await store();
  const bytes = await readFile(join(directory, 'google-drive-credentials.enc'));
  expect(bytes.toString()).not.toContain(account.refreshToken);
  expect(await credentials.load()).toEqual([account]);
  const insecure = new GoogleDriveCredentialStore(directory, { ...encryption, getSelectedStorageBackend: () => 'basic_text' });
  expect(insecure.available()).toBe(false);
  await expect(insecure.save([account])).rejects.toThrow('Secure system');
});

it('normalizes real API shapes and rejects unsafe identities without trusting webViewLink', () => {
  expect(normalizeDriveFile({ ...file, webViewLink: 'javascript:alert(1)', access_token: 'secret' }, account.id)).toMatchObject({ kind: 'document', url: 'https://docs.google.com/document/d/abc_123/edit' });
  expect(JSON.stringify(normalizeDriveFile(file, account.id))).not.toContain('refreshToken');
  expect(normalizeDriveFile({ ...file, id: '../secret' }, account.id)).toBeNull();
  expect(normalizeDriveFile({ ...file, trashed: true }, account.id)).toBeNull();
  expect(driveSearchQuery("a' or trashed=true", 'pdf')).toBe("trashed = false and name contains 'a\\' or trashed=true' and mimeType = 'application/pdf'");
});

it('searches and exports a bounded Doc preview through native tokens, never returning credentials', async () => {
  const { store: credentials } = await store();
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const endpoint = String(url);
    if (endpoint.endsWith('/token')) return json({ access_token: 'test-access-secret', expires_in: 3600, token_type: 'Bearer', scope: DRIVE_SCOPE });
    expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer test-access-secret');
    if (endpoint.includes('/export?')) return new Response('Plain document content '.repeat(1000));
    if (endpoint.includes('/files?')) return json({ files: [file] });
    return json(file);
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  expect(JSON.stringify(provider.status())).not.toContain('secret');
  expect((await provider.search(account.id, 'project', 'document'))[0].kind).toBe('document');
  const resource = await provider.getResource(account.id, file.id);
  expect(resource.preview).toContain('Plain document content');
  expect(resource.preview!.length).toBeLessThanOrEqual(4000);
  expect(JSON.stringify(resource)).not.toContain('test-access-secret');
  expect(vi.mocked(fetcher).mock.calls.every(([url]) => !String(url).includes('secret'))).toBe(true);
});

it('preserves local credentials and uses safe errors for offline and access loss', async () => {
  const { store: credentials } = await store();
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/token') ? json({ access_token: 'test-access', token_type: 'Bearer' }) : json({ error: { message: 'secret raw provider error' } }, 403)) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  await expect(provider.getResource(account.id, file.id)).rejects.toThrow('Resource unavailable');
  expect(provider.status().accounts).toHaveLength(1);
  vi.mocked(fetcher).mockRejectedValue(new Error('raw-secret'));
  await expect(provider.getResource(account.id, file.id)).rejects.toThrow('saved snapshots remain readable');
  expect(await credentials.load()).toHaveLength(1);
});

it('disconnects locally when revocation is offline and rejects further reads', async () => {
  const { store: credentials } = await store();
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
  await provider.load(); await provider.disconnect(account.id);
  expect(provider.status().accounts).toEqual([]); expect(await credentials.load()).toEqual([]);
  await expect(provider.search(account.id, 'test', 'everything')).rejects.toThrow('Reconnect');
});

it('validates PKCE and state over an actual loopback callback without exposing tokens in URLs', async () => {
  let authUrl = '';
  const tokenExchange = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const parameters = options!.body as URLSearchParams;
    const expected = createHash('sha256').update(parameters.get('code_verifier')!).digest('base64url');
    expect(new URL(authUrl).searchParams.get('code_challenge')).toBe(expected);
    expect(parameters.get('grant_type')).toBe('authorization_code');
    expect(parameters.has('client_secret')).toBe(false);
    expect(new URL(authUrl).searchParams.get('code_challenge_method')).toBe('S256');
    return json({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', scope: DRIVE_SCOPE });
  }) as unknown as typeof fetch;
  const result = await authorizeGoogle({ clientId: account.clientId }, async url => {
    authUrl = url; const authorization = new URL(url);
    expect(authorization.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'test-code'); callback.searchParams.set('state', 'é'.repeat(43));
    expect((await fetch(callback)).status).toBe(400);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    expect((await fetch(callback)).status).toBe(200);
  }, new AbortController().signal, tokenExchange);
  expect(result.refreshToken).toBe('test-refresh');
  expect(authUrl).not.toContain('test-access'); expect(authUrl).not.toContain('test-refresh');
});

it('does not open a browser when OAuth is unconfigured and cleans up cancelled authorization', async () => {
  const open = vi.fn();
  await expect(authorizeGoogle({ clientId: '' }, open, new AbortController().signal)).rejects.toThrow('not configured');
  expect(open).not.toHaveBeenCalled();
  const controller = new AbortController(); let callback = '';
  await expect(authorizeGoogle({ clientId: account.clientId }, async url => { callback = new URL(url).searchParams.get('redirect_uri')!; controller.abort(); }, controller.signal)).rejects.toThrow('cancelled');
  await expect(fetch(callback)).rejects.toThrow();
});

it('identifies missing desktop client configuration without leaking raw OAuth errors', async () => {
  const request = { grant_type: 'authorization_code', code: 'private-code' };
  const config = { clientId: account.clientId };
  const failure = (data: unknown) => vi.fn(async () => json(data, 400)) as unknown as typeof fetch;
  await expect(googleTokenRequest(request, config, failure({ error: 'invalid_request', error_description: 'client_secret is missing.' }))).rejects.toThrow('configuration is incomplete');
  await expect(googleTokenRequest(request, config, failure({ error: 'invalid_client', error_description: 'private-code and private-secret' }))).rejects.toThrow('client configuration was rejected');
  await expect(googleTokenRequest(request, config, failure({ error: 'invalid_grant', error_description: 'private-code' }))).rejects.toThrow('expired or was revoked');
  await expect(googleTokenRequest(request, config, failure({ error: 'unknown', error_description: 'private-code' }))).rejects.toThrow('could not complete the token exchange');
});

it('exchanges codes and refreshes without a secret, even with legacy or injected fields', async () => {
  const bodies: URLSearchParams[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const body = options!.body as URLSearchParams;
    bodies.push(body);
    expect(body.get('client_id')).toBe(account.clientId);
    expect(body.has('client_secret')).toBe(false);
    expect(body.toString()).not.toContain('legacy-secret');
    return json({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', scope: DRIVE_SCOPE });
  }) as unknown as typeof fetch;
  const legacy = { clientId: account.clientId, clientSecret: 'legacy-secret' };
  await googleTokenRequest({ grant_type: 'authorization_code', code: 'test-code', code_verifier: 'test-verifier', redirect_uri: 'http://127.0.0.1:12345/oauth/google-drive', client_secret: 'injected-secret' }, legacy, fetcher);
  expect(Object.fromEntries(bodies[0])).toEqual({ client_id: account.clientId, grant_type: 'authorization_code', code: 'test-code', code_verifier: 'test-verifier', redirect_uri: 'http://127.0.0.1:12345/oauth/google-drive' });
  await googleTokenRequest({ grant_type: 'refresh_token', refresh_token: 'test-refresh', client_secret: 'injected-secret' }, legacy, fetcher);
  expect(Object.fromEntries(bodies[1])).toEqual({ client_id: account.clientId, grant_type: 'refresh_token', refresh_token: 'test-refresh' });
});

it('rejects a missing public client ID before sending token requests', async () => {
  const fetcher = vi.fn();
  await expect(googleTokenRequest({ grant_type: 'refresh_token', refresh_token: 'test-refresh' }, { clientId: '' }, fetcher)).rejects.toThrow('not configured');
  expect(fetcher).not.toHaveBeenCalled();
});

it('downloads PDF bytes with native authorization and respects download restrictions', async () => {
  const { store: credentials } = await store();
  let allowed = true;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/token')) return json({ access_token: 'test-access', token_type: 'Bearer' });
    expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer test-access');
    if (String(url).includes('alt=media')) return new Response('%PDF-1.4\nPDF bytes');
    return json({ id: 'pdf_file', mimeType: 'application/pdf', capabilities: { canDownload: allowed } });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher);
  await provider.load();
  expect(new TextDecoder().decode(await provider.getPdf(account.id, 'pdf_file'))).toContain('%PDF-');
  const calls = vi.mocked(fetcher).mock.calls.length; allowed = false;
  await expect(provider.getPdf(account.id, 'pdf_file')).rejects.toThrow('cannot preview');
  expect(vi.mocked(fetcher).mock.calls.length).toBe(calls + 1);
});

it('exports Google-native Docs, Sheets, and Slides to the shared Office preview formats', async () => {
  const { store: credentials } = await store();
  const nativeFiles = [
    { id: 'doc_native', mimeType: 'application/vnd.google-apps.document', exportMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { id: 'sheet_native', mimeType: 'application/vnd.google-apps.spreadsheet', exportMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { id: 'slides_native', mimeType: 'application/vnd.google-apps.presentation', exportMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const endpoint = String(url);
    if (endpoint.endsWith('/token')) return json({ access_token: 'test-access', token_type: 'Bearer' });
    const native = nativeFiles.find(value => endpoint.includes(value.id));
    if (endpoint.includes('/export?')) return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    return json({ id: native?.id, mimeType: native?.mimeType, capabilities: { canDownload: true } });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher);
  await provider.load();
  for (const native of nativeFiles) {
    const result = await provider.getPreviewFile(account.id, native.id);
    expect(result.mimeType).toBe(native.exportMime);
    expect(result.bytes).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const exportUrl = vi.mocked(fetcher).mock.calls.map(([url]) => String(url)).find(value => value.includes(`${native.id}/export`));
    expect(new URL(exportUrl!).searchParams.get('mimeType')).toBe(native.exportMime);
  }
});

it('finds uploaded Office files with native peers and keeps their original Drive URLs', () => {
  const types = [
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
  ];
  for (const [mimeType, kind] of types) {
    expect(normalizeDriveFile({ ...file, mimeType }, account.id)).toMatchObject({ kind, url: 'https://drive.google.com/file/d/abc_123/view' });
    expect(driveSearchQuery('', kind)).toContain(`mimeType = '${mimeType}'`);
    expect(driveSearchQuery('', kind)).toContain(' or ');
  }
});

it('downloads uploaded Office files directly rather than requesting Google-native conversion', async () => {
  const { store: credentials } = await store();
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const endpoint = String(url);
    if (endpoint.endsWith('/token')) return json({ access_token: 'test-access', token_type: 'Bearer' });
    expect(endpoint).not.toContain('/export');
    if (endpoint.includes('alt=media')) return new Response(new Uint8Array([80, 75, 3, 4]));
    return json({ id: 'slides_uploaded', mimeType, capabilities: { canDownload: true } });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher);
  await provider.load();
  expect(await provider.getPreviewFile(account.id, 'slides_uploaded')).toMatchObject({ mimeType, bytes: new Uint8Array([80, 75, 3, 4]) });
});

it('deduplicates refresh requests and persists rotated refresh credentials', async () => {
  const { store: credentials } = await store();
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/token')) {
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ access_token: 'new-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    return json({ files: [file] });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  await Promise.all(Array.from({ length: 5 }, () => provider.search(account.id, 'project', 'everything')));
  expect(vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  expect((await credentials.load())[0].refreshToken).toBe('rotated-refresh');
  await provider.search(account.id, 'project', 'everything');
  expect(vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
});

it('refreshes once after a 401 and retries the original Drive operation', async () => {
  const { store: credentials } = await store();
  let refreshes = 0, reads = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/token')) return json({ access_token: `access-${++refreshes}`, token_type: 'Bearer', expires_in: 3600 });
    reads++;
    if (reads === 1) return json({}, 401);
    expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
    return json({ files: [file] });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  expect(await provider.search(account.id, 'project', 'everything')).toHaveLength(1);
  expect(refreshes).toBe(2); expect(reads).toBe(2);
  expect(provider.status().connectionState).toBe('connected');
});

it('marks rejected refresh credentials for reconnection across restart without retry loops', async () => {
  const { store: credentials } = await store();
  const fetcher = vi.fn(async () => json({ error: 'invalid_grant', error_description: account.refreshToken }, 400)) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  const changes = vi.fn(); provider.subscribeStatus(changes);
  await expect(provider.search(account.id, 'project', 'everything')).rejects.toThrow('expired or was revoked');
  expect(provider.status()).toMatchObject({ connectionState: 'needs-reconnection', accounts: [{ id: account.id, needsReconnect: true }] });
  expect(JSON.stringify(changes.mock.calls)).not.toContain(account.refreshToken);
  expect((await credentials.load())[0].refreshToken).toBe('');
  const reopened = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await reopened.load();
  await expect(reopened.search(account.id, 'project', 'everything')).rejects.toThrow('Reconnect');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('stops after a second 401 and does not mistake a network failure for revocation', async () => {
  const { store: credentials } = await store();
  let offline = true, calls = 0;
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (offline) throw new Error('private-network-detail');
    calls++;
    return String(url).endsWith('/token') ? json({ access_token: 'access', token_type: 'Bearer' }) : json({}, 401);
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  await expect(provider.search(account.id, 'project', 'everything')).rejects.toThrow('saved snapshots remain readable');
  expect(provider.status().connectionState).toBe('connected');
  offline = false;
  await expect(provider.search(account.id, 'project', 'everything')).rejects.toThrow('Reconnect');
  expect(calls).toBe(4); expect(provider.status().connectionState).toBe('needs-reconnection');
});

it('does not restore tokens when a refresh completes after disconnect', async () => {
  const { store: credentials } = await store();
  let release!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/token') ? new Promise<Response>(resolve => { release = resolve; }) : json({})) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  const search = provider.search(account.id, 'project', 'everything');
  const failure = expect(search).rejects.toThrow('disconnected');
  await provider.disconnect(account.id);
  release(json({ access_token: 'late-access', token_type: 'Bearer' }));
  await failure;
  expect(provider.status().accounts).toEqual([]); expect(await credentials.load()).toEqual([]);
  expect(vi.mocked(fetcher).mock.calls.some(([url]) => String(url).includes('/drive/v3/'))).toBe(false);
});

it('completes the browser response only after native account storage and permits missing cosmetic email', async () => {
  const { store: credentials } = await store();
  let browserResult = '', callback = '';
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/token')
    ? json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', scope: DRIVE_SCOPE })
    : json({ user: { permissionId: 'another-user', displayName: 'Another person' } })) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, async url => {
    const auth = new URL(url); expect(auth.searchParams.get('prompt')).toBe('select_account consent');
    const target = new URL(auth.searchParams.get('redirect_uri')!); callback = target.origin;
    target.searchParams.set('state', auth.searchParams.get('state')!); target.searchParams.set('code', 'test-code');
    const response = await fetch(target); browserResult = await response.text();
  }, fetcher);
  await provider.load();
  const connected = await provider.connect();
  expect(connected.email).toBe(''); expect(JSON.stringify(connected)).not.toContain('refresh');
  await vi.waitFor(() => expect(browserResult).toContain('OpenOnyx connected successfully'));
  expect(await credentials.load()).toHaveLength(2);
  await expect(fetch(callback)).rejects.toThrow();
});

it('closes loopback listeners on denial, browser failure and timeout', async () => {
  const config = { clientId: account.clientId };
  let callback = '';
  const tokens = vi.fn() as unknown as typeof fetch;
  await expect(authorizeGoogle(config, async url => {
    const auth = new URL(url), target = new URL(auth.searchParams.get('redirect_uri')!); callback = target.origin;
    target.searchParams.set('state', auth.searchParams.get('state')!); target.searchParams.set('error', 'access_denied');
    const response = await fetch(target); expect(await response.text()).not.toContain('successfully');
  }, new AbortController().signal, tokens)).rejects.toThrow('cancelled');
  await expect(fetch(callback)).rejects.toThrow(); expect(tokens).not.toHaveBeenCalled();
  await expect(authorizeGoogle(config, async () => { throw new Error('private-browser-detail'); }, new AbortController().signal, tokens)).rejects.toThrow('Could not open your browser');
  await expect(authorizeGoogle(config, async url => { callback = new URL(url).searchParams.get('redirect_uri')!; }, new AbortController().signal, tokens, { timeoutMs: 30 })).rejects.toThrow('timed out');
  await expect(fetch(callback)).rejects.toThrow();
});

it('rejects duplicate callback fields and token failures without a false success page', async () => {
  const fetcher = vi.fn(async () => json({ error: 'invalid_grant', error_description: 'private-code' }, 400)) as unknown as typeof fetch;
  let browserResult = '';
  await expect(authorizeGoogle({ clientId: account.clientId }, async url => {
    const auth = new URL(url), target = new URL(auth.searchParams.get('redirect_uri')!);
    target.searchParams.set('state', auth.searchParams.get('state')!); target.searchParams.set('code', 'private-code');
    target.searchParams.append('state', auth.searchParams.get('state')!);
    expect((await fetch(target)).status).toBe(400);
    target.searchParams.delete('state'); target.searchParams.set('state', auth.searchParams.get('state')!);
    const response = await fetch(target); browserResult = await response.text();
  }, new AbortController().signal, fetcher)).rejects.toThrow('expired or was revoked');
  await vi.waitFor(() => expect(browserResult).toContain('was not connected'));
  expect(browserResult).not.toContain('private-code');
});

it('refuses malformed token responses and corrupted persisted authentication state', async () => {
  for (const extra of [{ expires_in: -1 }, { expires_in: '3600' }, { access_token: '' }, { refresh_token: 42 }]) {
    await expect(googleTokenRequest({ grant_type: 'refresh_token', refresh_token: 'refresh' }, { clientId: account.clientId }, vi.fn(async () => json({ access_token: 'access', token_type: 'Bearer', ...extra })) as unknown as typeof fetch)).rejects.toThrow('valid access');
  }
  const { store: credentials, directory, encryption } = await store();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(directory, 'google-drive-credentials.enc'), encryption.encryptString(JSON.stringify([{ ...account, refreshToken: '' }])));
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn());
  await expect(provider.load()).rejects.toThrow('could not be unlocked');
  expect(provider.status().connectionState).toBe('needs-reconnection');
});

it('rolls back credentials when authorization is cancelled during the storage write', async () => {
  const { store: credentials } = await store();
  let provider: GoogleDriveProvider;
  const save = credentials.save.bind(credentials);
  vi.spyOn(credentials, 'save').mockImplementation(async values => {
    await save(values);
    if (values.length > 1) provider.cancelConnection();
  });
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/token')
    ? json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer' })
    : json({ user: { permissionId: 'cancelled-user' } })) as unknown as typeof fetch;
  provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, async url => {
    const auth = new URL(url), target = new URL(auth.searchParams.get('redirect_uri')!);
    target.searchParams.set('state', auth.searchParams.get('state')!); target.searchParams.set('code', 'test-code');
    await fetch(target);
  }, fetcher);
  await provider.load();
  await expect(provider.connect()).rejects.toThrow('cancelled');
  expect(await credentials.load()).toEqual([account]);
  expect(provider.status().accounts).toEqual([{ id: account.id, email: account.email, name: account.name }]);
});

it('disconnects immediately but waits for pending revocation before issuing a new grant', async () => {
  const { store: credentials } = await store();
  let finishRevoke!: (response: Response) => void;
  const fetcher = vi.fn(async () => new Promise<Response>(resolve => { finishRevoke = resolve; })) as unknown as typeof fetch;
  const open = vi.fn(async () => { throw new Error('stop test before any authorization'); });
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, open, fetcher); await provider.load();
  await provider.disconnect(account.id);
  expect(provider.status().accounts).toEqual([]);
  const connection = provider.connect();
  const failure = expect(connection).rejects.toThrow('Could not open your browser');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(open).not.toHaveBeenCalled();
  finishRevoke(json({})); await failure;
  expect(open).toHaveBeenCalledOnce();
});

it('reports reconnection if authorization is lost during a document export', async () => {
  const { store: credentials } = await store();
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/token')) return json({ access_token: 'access', token_type: 'Bearer' });
    if (String(url).includes('/export?')) return json({}, 401);
    return json(file);
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId }, vi.fn(), fetcher); await provider.load();
  await expect(provider.getResource(account.id, file.id)).rejects.toThrow('Reconnect');
  expect(provider.status().connectionState).toBe('needs-reconnection');
});


it('persists broker tickets only in encrypted native credentials and refreshes after reload', async () => {
  const { store: credentials, directory } = await store();
  await credentials.save([{ ...account, brokerTicket: 'old.signature' }]);
  const endpoint = 'https://project.supabase.co/functions/v1/google-drive-auth';
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const protectedHandler = createEncryptedBroker(async request => {
    const body = new URLSearchParams(await request.text());
    expect(body.get('broker_ticket')).toBe('old.signature'); expect(body.has('client_secret')).toBe(false);
    return json({ access_token: 'test-access', token_type: 'Bearer', broker_ticket: 'new.signature' });
  }, JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)), async () => true);
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) === endpoint) {
      return protectedHandler(new Request(String(url), options));
    }
    return json({ files: [file] });
  }) as unknown as typeof fetch;
  const provider = new GoogleDriveProvider(credentials, { clientId: account.clientId, tokenBrokerUrl: endpoint }, vi.fn(), fetcher);
  await provider.load(); await provider.search(account.id, 'proposal', 'everything');
  expect(await credentials.load()).toEqual([{ ...account, brokerTicket: 'new.signature' }]);
  expect(JSON.stringify(provider.status())).not.toContain('signature');
  expect((await readFile(join(directory, 'google-drive-credentials.enc'))).toString()).not.toContain('new.signature');
});
