const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// Native OAuth configuration only. Never expose these values through Vite.
function loadNativeAppEnv(env, directory) {
  const file = path.join(directory, '.env.local');
  if (!fs.existsSync(file)) return env;
  const local = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const key of ['OPENONYX_GOOGLE_CLIENT_ID', 'OPENONYX_GOOGLE_TOKEN_BROKER_URL', 'VITE_SUPABASE_URL', 'OPENONYX_PASSWORD_STORE']) {
    if (env[key] === undefined && local[key] !== undefined) env[key] = local[key];
  }
  return env;
}

function nativeAppArgs(platform, env) {
  const args = ['.'];
  if (platform === 'linux' && env.OPENONYX_PASSWORD_STORE) {
    const backend = env.OPENONYX_PASSWORD_STORE;
    if (!['gnome-libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend)) {
      throw new Error('OPENONYX_PASSWORD_STORE must select a supported secure system keyring.');
    }
    args.push(`--password-store=${backend}`);
  }
  return args;
}

module.exports = { loadNativeAppEnv, nativeAppArgs };
