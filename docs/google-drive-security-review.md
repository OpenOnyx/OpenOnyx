# Focused Google Drive broker security review

This is a source-level review, not a penetration-test certification or a claim that tests prove security. It covers the native OAuth path, public Supabase endpoint, token storage, build configuration, and publication hygiene.

## Findings and fixes

- **Scope omission:** the earlier broker could issue a ticket when Google's response omitted `scope`. Code exchange now requires exactly `drive.readonly`. Version-2 tickets include that verified scope. A legacy ticket is upgraded only with explicit scope confirmation; otherwise reconnect is required. Any broader scope is rejected.
- **Quota interference:** malformed/invalid tickets no longer consume valid Google refresh quotas. Exchanges and refreshes have separate budgets. Ingress remains globally bounded, with a documented denial-of-service tradeoff.
- **Hosted logs:** absence of `console.log` does not prove platform invocation bodies are private. Supabase explicitly documents request/response body visibility. The hardened transport uses standard RSA-OAEP/SHA-256 key wrapping and AES-256-GCM authenticated encryption, a fresh key/nonce per request, direction-specific authenticated data, bounded payloads, and a two-minute age check. Persisted hashes reject encrypted-request replays independent of JSON ordering, with one-use IDs retained across minute boundaries by the forward SQL migration. Gateway logs see public metadata and ciphertext; function memory and secret administrators remain trusted. Decrypted bodies and outgoing Google request instrumentation must never be logged.
- **Refresh tickets:** HMAC-SHA256 verification checks version, scope, client identity, refresh-token digest and bounded expiry. A ticket alone or a refresh token alone is insufficient. Both are bearer credentials stored with OS-backed encryption. The server never accepts caller-supplied secrets/client identities/URLs.
- **Publication:** application configuration contains public client ID and broker URL only. Credentials, environment files, deployed secrets, vault state, build output and Supabase CLI state are excluded. Test fixtures are deliberately synthetic.

Supabase logging reference: https://supabase.com/docs/guides/functions/logging

## Remaining risks / release checks

- A public native-client endpoint cannot establish that a caller runs an official OpenOnyx binary merely from client ID, Origin checks or PKCE. Google authorization and ticket possession establish the relevant grant; they are not device attestation.
- Valid Google grants can be used by modified clients. Attackers can saturate ingress/exchange limits and hosting billing, or distribute load across accounts/IPs. Per-IP headers are advisory. Deploy gateway/WAF protection, monitoring and spending alerts appropriate to actual traffic; fixed limits are not a DDoS guarantee.
- TLS and the function's private transport key protect payloads from log viewers, not a compromised function or privileged secret administrator. Audit access roles, log drains and instrumentation; no code can erase credentials captured by an older plaintext deployment.
- Signing-key compromise permits forged tickets. Rotate server secrets on compromise and require reconnection. The transport key must remain server-side and is retrieved only as a public key over HTTPS.
- Counter hashes are retained by lazy cleanup; they are not permanent raw IP/token storage. SQL has RLS enabled, no anon/authenticated table permissions, a fixed search path and service-role-only RPC access.
- Broker outage preserves local cached resources but prevents new authorization/refresh. Transport age checks require an accurate desktop clock.
- Function redeployment and the updated desktop build must be coordinated. Automated crypto/protocol tests do not replace real OAuth and refresh verification on Windows/macOS/Linux.

## Evidence required before publishing a binary

Run targeted auth/transport regressions, full tests, renderer/Electron/Edge typechecks and production build. Scan the exact staged Git blobs and generated artifacts against locally known private values and secret signatures, printing only match status/paths. Review packaged config fields. Confirm setup documentation distinguishes maintainers from end users. Keep Supabase Edge source/migrations in Git and all secret values in the secret manager.
