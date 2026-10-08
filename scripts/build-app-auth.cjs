const fs = require('node:fs');
const path = require('node:path');
const { loadNativeAppEnv } = require('./dev/native-app-env.cjs');

function buildAppsAuth(directory, environment, required = false) {
  const env = loadNativeAppEnv({ ...environment }, directory);
  const clientId = env.OPENONYX_GOOGLE_CLIENT_ID || '';
  if (clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Invalid developer Google Desktop client configuration.');
  if (required && !clientId) throw new Error('Distribution requires the OpenOnyx Google Desktop app identity. See docs/google-drive.md (developer setup).');
  const projectUrl = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const tokenBrokerUrl = env.OPENONYX_GOOGLE_TOKEN_BROKER_URL || (projectUrl ? `${projectUrl}/functions/v1/google-drive-auth` : undefined);
  if (tokenBrokerUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/google-drive-auth$/.test(tokenBrokerUrl)) throw new Error('Invalid public Google authentication service URL.');
  // Only the public application identity may be distributed.
  const config = { version: 1, googleDrive: { clientId, ...(tokenBrokerUrl ? { tokenBrokerUrl } : {}) } };
  const output = path.join(directory, 'dist-electron', 'apps-auth.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(config), { mode: 0o600 });
  return output;
}

module.exports = { buildAppsAuth };
if (require.main === module) {
  try { buildAppsAuth(process.cwd(), process.env, process.argv.includes('--require-google')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
