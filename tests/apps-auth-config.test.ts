import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readAppsAuthConfig } from '../electron/appsAuthConfig';

const { buildAppsAuth } = createRequire(import.meta.url)('../scripts/build-app-auth.cjs');
const clientId = 'distribution.apps.googleusercontent.com';

it('builds native distributor identity without bundling tokens or unrelated environment settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-app-auth-'));
  try {
    await writeFile(join(directory, '.env.local'), `OPENONYX_GOOGLE_CLIENT_ID=${clientId}\nOPENONYX_GOOGLE_CLIENT_SECRET=desktop-public-compatibility\nOPENONYX_PASSWORD_STORE=gnome-libsecret\nACCESS_TOKEN=private-access\nREFRESH_TOKEN=private-refresh\nUNRELATED_SECRET=private\n`);
    const file = buildAppsAuth(directory, {}, true);
    const config = JSON.parse(await readFile(file, 'utf8'));
    expect(config).toEqual({ version: 1, googleDrive: { clientId } });
    const serialized = await readFile(file, 'utf8');
    expect(serialized).not.toContain('clientSecret');
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('desktop-public-compatibility');
    // Installed builds use their distributor's identity, never a user's shell.
    expect(readAppsAuthConfig(file, true, { OPENONYX_GOOGLE_CLIENT_ID: 'user.apps.googleusercontent.com', OPENONYX_GOOGLE_CLIENT_SECRET: 'user-setting' })).toEqual({ clientId });
    expect(readAppsAuthConfig(file, false, { OPENONYX_GOOGLE_CLIENT_ID: 'development.apps.googleusercontent.com' })).toEqual({ clientId: 'development.apps.googleusercontent.com' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('fails distribution builds missing app identity and allows honest unconfigured development builds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-app-auth-'));
  try {
    expect(() => buildAppsAuth(directory, {}, true)).toThrow('Distribution requires');
    const file = buildAppsAuth(directory, {});
    expect(readAppsAuthConfig(file, true, {})).toEqual({ clientId: '' });
    await writeFile(file, JSON.stringify({ version: 1, googleDrive: { clientType: 'desktop', clientId, clientSecret: 'legacy-secret' } }));
    expect(readAppsAuthConfig(file, true, {})).toEqual({ clientId });
    await writeFile(file, '{broken');
    expect(readAppsAuthConfig(file, true, {})).toEqual({ clientId: '' });
    await writeFile(file, JSON.stringify({ version: 1, googleDrive: { clientType: 'web', clientId } }));
    expect(readAppsAuthConfig(file, true, {})).toEqual({ clientId: '' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});


it('packages only the public broker URL and rejects unsafe endpoint configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-app-auth-'));
  try {
    const tokenBrokerUrl = 'https://project.supabase.co/functions/v1/google-drive-auth';
    const file = buildAppsAuth(directory, { OPENONYX_GOOGLE_CLIENT_ID: clientId, VITE_SUPABASE_URL: 'https://project.supabase.co/' }, true);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, googleDrive: { clientId, tokenBrokerUrl } });
    expect(readAppsAuthConfig(file, true, { OPENONYX_GOOGLE_TOKEN_BROKER_URL: 'https://evil.example/token' })).toEqual({ clientId, tokenBrokerUrl });
    expect(() => buildAppsAuth(directory, { OPENONYX_GOOGLE_CLIENT_ID: clientId, OPENONYX_GOOGLE_TOKEN_BROKER_URL: 'https://evil.example/token' })).toThrow('service URL');
    await writeFile(file, JSON.stringify({ version: 1, googleDrive: { clientId, tokenBrokerUrl: 'https://evil.example/token' } }));
    expect(readAppsAuthConfig(file, true, {})).toEqual({ clientId, tokenBrokerUrl: '' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
