import { readFileSync } from 'node:fs';
import { validGoogleTokenBrokerUrl, type GoogleOAuthConfig } from './googleDriveOAuth.js';

/** Distributor-owned native app identity. This is not user authentication. */
export function readAppsAuthConfig(file: string, packaged: boolean, env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig {
  let google: Record<string, unknown> = {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value?.version === 1 && value.googleDrive && (value.googleDrive.clientType === undefined || value.googleDrive.clientType === 'desktop')) google = value.googleDrive;
  } catch { /* An unconfigured build has an explicit, honest unavailable state. */ }
  // Packaged apps never depend on the user's shell or .env files.
  const clientId = !packaged && env.OPENONYX_GOOGLE_CLIENT_ID !== undefined ? env.OPENONYX_GOOGLE_CLIENT_ID : google.clientId;
  const tokenBrokerUrl = !packaged && env.OPENONYX_GOOGLE_TOKEN_BROKER_URL !== undefined ? env.OPENONYX_GOOGLE_TOKEN_BROKER_URL : google.tokenBrokerUrl;
  return {
    clientId: typeof clientId === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) ? clientId : '',
    ...(tokenBrokerUrl !== undefined ? { tokenBrokerUrl: validGoogleTokenBrokerUrl(tokenBrokerUrl) ? tokenBrokerUrl : '' } : {}),
  };
}
