# Google Drive: application identity and user authentication

Google Drive uses OpenOnyx's existing Apps, ExternalResource, picker, native provider, cache and persistence boundaries. This document is **for maintainers/distributors**. End users do not configure OAuth, edit environment files, register a Google Cloud project, or paste credentials.

## End-user flow

Settings → Apps → Google Drive → **Connect**, or `/` → Google Drive → **Connect Google Drive**. The normal system browser opens, the user chooses their own Google account and approves read access. OpenOnyx stores the account securely, the browser reports completion, and the application attempts to regain focus. Users can cancel from OpenOnyx. Disconnect removes local authorization without deleting notes or cached previews.

No credential form, raw scopes, redirect URI or token is exposed in Settings. Unconfigured builds report that the app maintainer must configure authorization; they do not pretend to connect.

## Developer / distribution setup

1. Enable the **Google Drive API** in the OpenOnyx Google Cloud project.
2. Configure the Google Auth Platform consent screen with OpenOnyx branding, support contact, privacy policy and the appropriate audience. During testing, explicitly add approved testers. For general distribution, complete Google's applicable verification and publishing requirements. Testing mode can impose short refresh-token lifetimes; publishing a binary does not lift Google's restrictions.
3. Create an OAuth client with application type **Desktop app**. Do not use a confidential Web client. The existing desktop flow uses a temporary IPv4 loopback listener, not a Vite URL or a custom deep link.
4. Provide **only** the public Desktop client ID as `OPENONYX_GOOGLE_CLIENT_ID` in the maintainer build environment. No client secret is loaded or packaged by Electron. When a public token broker URL is configured, exchange and refresh use the Supabase service, which adds the secret server-side. See [Supabase deployment](google-drive-supabase.md). Google's current [installed-app documentation](https://developers.google.com/identity/protocols/oauth2/native-app) marks `client_secret` optional for both authorization-code exchange and refresh; S256 PKCE remains mandatory in OpenOnyx. Existing local secret settings are ignored, and local environment files are left untouched. A real client that rejects secretless exchange must be investigated by the maintainer: verify it is a Desktop client. If that client genuinely requires a secret, configure the implemented Supabase exchange service; do not restore a secret to Electron.
5. Run `npm run build` or the appropriate `npm run package:*` command. The build generates `dist-electron/apps-auth.json`, containing only public configuration: `{ "version": 1, "googleDrive": { "clientId": "example.apps.googleusercontent.com", "tokenBrokerUrl": "https://example.supabase.co/functions/v1/google-drive-auth" } }`. Electron builder's existing `dist-electron/**/*` rule includes it in distributions on Windows, Linux and macOS. All package commands require a configured client ID and fail clearly if it is missing. No end-user shell configuration is required.

The broker protocol uses RSA-OAEP/SHA-256 to wrap a fresh AES-256-GCM key for each request. OAuth request/response bodies are encrypted before crossing the hosted invocation boundary. Only the public RSA key is returned by the function; its private key is a Supabase secret. HTTPS remains required. See the [focused security review](google-drive-security-review.md).

For **maintainer development only**, the existing ignored `.env.local` can contain `OPENONYX_GOOGLE_CLIENT_ID`. Explicit build/shell values take precedence. The development launcher and build helper allowlist native settings; Vite's renderer receives none of them. `OPENONYX_PASSWORD_STORE` remains a development-only selector for an already installed secure Linux keyring. The build artifact never includes it, arbitrary environment variables, or user tokens. Packaged apps ignore runtime OAuth environment overrides and use their distributor's identity. Generated output and `.env.local` must stay out of source commits.

Changing the distributor client ID requires a new authorization. Existing account IDs and saved note resource identities are unchanged when reconnecting the same Google account.

## OAuth and callback

Authorization Code + S256 PKCE, a fresh 32-byte verifier and state, and Google's system-browser authorization endpoint are used for each attempt. The callback binds `127.0.0.1` on an available port only during authorization:

`http://127.0.0.1:<temporary-port>/oauth/google-drive`

The listener validates the HTTP method, Host, exact path, single state field and constant-time state comparison. Duplicate or ambiguous callback fields are rejected. Invalid unsolicited requests do not cancel a valid attempt. Electron main submits codes over HTTPS with the public client ID, verifier and matching redirect URI, without a client secret. With the configured Supabase broker, the server performs the Google exchange. Token requests allowlist protocol fields, ignoring obsolete secret fields even if supplied by legacy callers. Electron refresh requests also omit secrets and include an encrypted-store broker ticket when configured. Codes, tokens, raw responses and callback URLs do not reach the renderer or logs.

The browser reports **OpenOnyx connected successfully** only after exchange, account identification and encrypted storage succeed. Failed exchange/storage never reports success. Listener/timer cleanup covers success, denial, browser launch failure, cancellation and a two-minute attempt timeout. Closing a browser tab is not observable reliably; users can cancel in OpenOnyx or wait for the timeout. OS focus-stealing policies may prevent the focus request.

Google's [installed-app guide](https://developers.google.com/identity/protocols/oauth2/native-app) and [loopback migration guide](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration) support this desktop callback pattern. No manual user redirect registration or public callback server is introduced.

## Permissions

Only `https://www.googleapis.com/auth/drive.readonly` is requested. No write, delete, profile, email or OpenID scope is added. Whole-Drive filename search and export/download of existing documents need read access; `drive.file` would not support the current search experience. Account metadata comes from Drive's `about.user` under existing permission; email is optional and is not a prerequisite for connecting.

This is a restricted scope. Consult Google's [Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) for verification requirements and whether the app's data handling requires further assessment. The user-facing permission description must honestly describe read access to Drive, rather than claim authorization is limited to selected files.

## Future per-file access (research only; not implemented)

Google now documents a [desktop/mobile Picker flow](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker) in the system browser: authorization includes `prompt=consent` and `trigger_onepick=true`, and returns `picked_file_ids` plus a code through the existing application's redirect mechanism. It permits only `drive.file`, without other scopes. The browser can browse/select additional files; OpenOnyx's own API search would be limited to files already authorized for the app.

`drive.file` is non-sensitive and avoids restricted `drive.readonly` if no restricted scopes remain, which should reduce verification burden. It is **not read-only**: it grants creation/modification capability for authorized files even if OpenOnyx only implements reading. A future `/` picker could offer already authorized resources and “Choose more files” in the browser, preserving the existing provider/rendering separation. This requires deliberate consent and migration work and may require users to select previously embedded files again. No scope, search or Picker changes are made in this follow-up.

## Credential storage and refresh

Access tokens live only in Electron main memory. Refresh credentials and minimal account metadata are encrypted with the existing Electron `safeStorage` abstraction in `google-drive-credentials.enc`, under application user data, outside all vaults. Atomic writes use owner-only permissions. Windows uses OS-protected encryption; macOS uses Keychain; Linux requires a supported secret service/keyring. The `basic_text` fallback is refused. There is no plaintext fallback or renderer storage.

See [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). The repository pins an Electron version with the synchronous API used here; review that API when upgrading Electron. Secure storage must be available/unlocked on the target system.

Tokens refresh before expiry with a one-minute margin. Concurrent requests share an in-flight refresh. Rotated refresh credentials are encrypted and saved. A Drive 401 triggers one forced refresh and one retry; a repeated 401 or rejected/revoked refresh grant marks the account **Needs reconnection**, clears unusable credentials and persists that status. Network/resource-access errors preserve authorization and caches. Corrupted stored authentication produces a reconnection state. Disconnect/reconnect races cannot restore stale tokens or mark a newly connected account revoked.

Only safe account metadata, connection state, resources and bounded preview bytes cross trusted-main-frame IPC. The preload exposes provider operations and a disposable status subscription, never tokens or a generic Google HTTP client. The common Apps connection lifecycle can be reused by future providers; GitHub authorization is not implemented or changed here.

## Disconnect and resource compatibility

Disconnect still uses the existing native confirmation. Local encrypted credentials and in-memory access are removed first. A bounded, best-effort HTTPS POST then revokes Google's refresh credential; remote failure does not restore local connection or delay the UI. Revocation may affect other authorizations using the same Google account/client, so test destructive revocation only on your chosen QA installation/account.

Existing search, read and refresh confirmations are preserved. Connect itself starts the browser directly; Google provides authorization consent. Notes, version-1 resource fences, provider/account/file IDs and cached previews are unchanged. Cached content can remain readable offline/disconnected. New searches and remote refreshes require valid authorization. Sharing Markdown does not automatically share binary preview cache files.

## Validation

Automated tests use temporary encrypted stores, synthetic credentials, mocked Google HTTPS requests and local loopback HTTP callbacks. They cover public-ID-only build identity, ignored legacy secrets, secretless code exchange/refresh, missing-ID rejection, native/public config boundaries, PKCE/state, denial/cancellation/timeout, browser failure, success-after-storage, malformed tokens/store data, refresh/retry bounds, refresh concurrency/rotation, disconnect races, safe status events and UI connection transitions.

The earlier broker completed real browser authorization and Drive search/PDF insertion with Varshith. The encrypted protocol added during security review requires coordinated function redeployment and an updated desktop build, followed by new manual OAuth/refresh checks. Windows/Linux/macOS packaged integration still requires manual QA. Passing mocked tests is not proof of consent verification or live provider behavior.
