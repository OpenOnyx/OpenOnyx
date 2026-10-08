# Google Drive token broker on Supabase

This is maintainer/distributor setup. End users only click Connect and sign into Google; no Supabase account or credential configuration is required.

## Architecture

Electron main retains the existing system-browser authorization, random state, S256 PKCE and temporary loopback callback. Code exchange and refresh POST to `https://<project-ref>.supabase.co/functions/v1/google-drive-auth`. The function adds the Google client secret server-side and calls only Google's token endpoint. Metadata/file requests still go directly from Electron to Google. The Drive scope remains `drive.readonly`.

Google access tokens stay in main-process memory. Refresh tokens and the broker's signed refresh ticket stay in the existing OS-encrypted credential store outside vaults. The backend does not intentionally persist Google tokens or document content. Tokens necessarily transit the function over HTTPS during exchange/refresh; platform administrators remain part of the trust boundary. Supabase documents invocation views containing request/response bodies. The hardened protocol therefore encrypts OAuth payloads at the application layer using a fresh AES-256-GCM key wrapped with RSA-OAEP/SHA-256; captured gateway bodies contain ciphertext. Replay checks and a two-minute request-age bound are applied before forwarding to Google. The desktop clock must be reasonably accurate. Never log decrypted request/response bodies, and audit log drains and any outgoing-HTTP instrumentation.

Version-2 signed tickets bind a refresh credential to this client and the verified readonly scope, is renewed on successful refresh, and expires after one year without a refresh. Missing/tampered/expired tickets require reconnection. Existing pre-broker accounts require one reconnect; saved resource/account IDs remain compatible. Changing the signing key invalidates tickets and requires reconnecting. Version-1 tickets are upgraded only when Google explicitly confirms the readonly scope on refresh; missing scope requires reconnection. Fresh code exchanges fail closed without explicit scope confirmation.

## Deploy

1. Rotate any Google secret shared in chat or previously distributed. Never put the replacement in repository files or chat.
2. In Supabase Dashboard → Edge Functions → Secrets, set:
   - `GOOGLE_DRIVE_CLIENT_ID`: the existing Desktop client ID.
   - `GOOGLE_DRIVE_CLIENT_SECRET`: the replacement Google secret.
   - `GOOGLE_DRIVE_BROKER_SIGNING_KEY`: a separately generated random value with at least 32 characters (use a password manager to generate a long random value).
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function. Those stay server-side too.
3. Configure the server-only RSA transport key once with `node scripts/setup-drive-broker-transport.cjs <project-ref>` after authenticating with `npx supabase login`. It preserves existing keys, generates a 3072-bit RSA private JWK, uploads it as `GOOGLE_DRIVE_BROKER_TRANSPORT_KEY` through a temporary owner-only file, and removes that file. It never prints key material. The desktop retrieves only the public RSA key over HTTPS; there is no new end-user setting.
4. Review and run the two broker-only migrations, in order: `supabase/migrations/202610070001_google_drive_broker.sql`, then `supabase/migrations/202610080001_google_drive_broker_replay.sql` in this project's Dashboard SQL Editor. It creates an RLS-protected counter table and a service-role-only limiter RPC. It does not modify notes or existing authentication tables. Do not run the entire legacy schema or unrelated migrations as part of this deployment.
5. Authenticate the CLI in your own terminal: `npx supabase login`. Do not share its access token in chat.
6. Deploy: `npx supabase functions deploy google-drive-auth --project-ref <project-ref> --no-verify-jwt`.
   `supabase/config.toml` also specifies JWT verification disabled **only for this function**. This is intentional: it validates Google PKCE requests and signed refresh tickets rather than requiring a Supabase user JWT. Other functions keep their existing authentication.
7. Build OpenOnyx normally. Its existing maintainer `VITE_SUPABASE_URL` selects the public function URL automatically. Alternatively set the public `OPENONYX_GOOGLE_TOKEN_BROKER_URL` build override. These values are not end-user settings. Supabase credentials and the Google secret are never bundled.

The existing OpenOnyx project reference is `lnesemdbowelyzzxeayl`. The function URL for that project is `https://lnesemdbowelyzzxeayl.supabase.co/functions/v1/google-drive-auth`.

## Security and operating limits

The endpoint rejects browser Origins, unexpected/duplicate fields, unsupported grants, other client IDs, non-loopback redirects and oversized bodies. It sends only allowlisted token fields to Google; PKCE verification is performed by Google. OAuth state remains validated by the native callback. No secret or arbitrary Google error is returned. There is no generic HTTP proxy.

Rate limiting is persistent and atomic in Postgres: 300 encrypted ingress requests/minute, separate 120 exchange and 180 refresh requests/minute, 30 per IP identifier, and 10 per refresh credential. Refresh capabilities are validated before spending the refresh budget. Ciphertext replay identifiers are one-use within the accepted two-minute request window. Only hashes and counters are stored, with lazy cleanup of stale windows. Forwarded-IP headers are advisory unless the deployed gateway provenance is verified. An unauthenticated attacker can still exhaust ingress/exchange quotas, and public-key GETs/denied invocations can incur hosting costs: these are residual availability risks, not solved by signed tickets. A missing migration or unavailable database fails closed. These initial limits need deliberate adjustment as legitimate usage grows; distributed abuse/billing protection still needs operational monitoring. Browser Origin rejection is defense in depth, not proof that a request came from OpenOnyx.

The function requires no Drive write scope. Its HTTPS dependency means new connections/refresh require a reachable function; cached previews remain readable. Rate limits, Google revocation and provider outages can require retry/reconnection as appropriate. Hosting a token broker does not remove Google's restricted-scope verification requirements; review its data-handling implications honestly.

## Validation and manual checks

Automated tests mock Google calls and use temporary encrypted native stores. They do not authorize a real Google account. Check function type validation, desktop typecheck, auth tests, full tests, production build and artifact secret scan.

After deployment and secret setup, Varshith must test: Connect → account selection → consent → Connected → Drive search → resource insert → app restart → resource Refresh → Disconnect → cached embed retained → reconnect. Also test cancellation, offline/backend outage and a revoked grant. Send only sanitized errors/status codes; never tokens, secrets or callback query strings. The Drive demonstration video can be recorded once this real flow succeeds.

## Coordinated upgrade

The hardened endpoint accepts encrypted JSON only. Old desktop builds sending plaintext form payloads will receive 415. Configure the transport key and deploy the new function together with the updated desktop build; do not claim the earlier successful OAuth run verified this new protocol. This branch change alone does not update a deployed function. Test Connect, refresh after restart, cancellation, revoked credentials, and offline cached resources before general release.
