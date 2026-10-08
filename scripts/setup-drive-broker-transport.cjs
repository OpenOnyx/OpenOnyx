// Maintainer-only setup. Writes only to Supabase secrets; never prints key material.
const { execFileSync } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
async function setup(project) {
  if (!/^[a-z]{20}$/.test(project || '')) throw new Error('Provide the Supabase project reference.');
  const args = ['--yes', 'supabase@2.120.0'];
  const data = JSON.parse(execFileSync('npx', [...args, 'secrets', 'list', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const names = (Array.isArray(data) ? data : data.secrets || []).map(item => item.name || item.NAME || item.Name);
  if (names.includes('GOOGLE_DRIVE_BROKER_TRANSPORT_KEY')) { console.log('Transport key already configured; preserved existing key.'); return; }
  const keys = await webcrypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', keys.privateKey);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openonyx-broker-key-')); fs.chmodSync(directory, 0o700);
  try {
    const file = path.join(directory, 'server.env'); fs.writeFileSync(file, `GOOGLE_DRIVE_BROKER_TRANSPORT_KEY=${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });
    execFileSync('npx', [...args, 'secrets', 'set', '--project-ref', project, '--env-file', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('Transport key configured in Supabase. No key values printed.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) setup(process.argv[2]).catch(() => { console.error('Transport-key setup failed. Check CLI login and project access; no secrets printed.'); process.exitCode = 1; });
module.exports = { setup };
