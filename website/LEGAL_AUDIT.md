# Legal-page source audit

Reviewed October 5–6, 2026. This is an implementation audit, not legal advice or
a certification of production operations. Public text lives in `src/data/legal.ts`;
both React pages and build-time HTML use that single source.

## Scope and provenance

The website changes are based on `main` at `5b6a8a5`. Google Drive implementation
was inspected read-only in the existing `mcp-server-backend` working tree,
including its uncommitted integration files. It is not present on this main
checkout. No Drive, OAuth, MCP, or desktop application changes are included.
The policies qualify integration availability by build/configuration. Confirm
the version being shipped still matches this audit before OAuth submission.

## Evidence and disclosures

| Area | Source evidence | Policy implication |
| --- | --- | --- |
| Vault storage | `electron/ipc.ts`, filesystem handlers, `src/utils/disk-store.ts` | Markdown files remain in selected local folders; `.openonyx`, app user-data, IndexedDB, and browser stores contain supporting data. |
| File deletion | `fs:deleteFile` in `electron/ipc.ts` | Uses OS trash where supported, not secure erasure of every copy. |
| Telemetry and crashes | Source/dependency searches, `electron/main.ts` | No dedicated product analytics or automatic remote crash reporter found. Console diagnostics exist; hosting logs are not established by source. |
| Google OAuth | `electron/googleDriveOAuth.ts` | Public Desktop client, authorization code, PKCE S256, loopback callback/state; only `drive.readonly`; no bundled client secret. |
| Drive data and purpose | `electron/googleDriveProvider.ts`, `electron/googleDriveIpc.ts` | Account details, search queries/results, metadata, text excerpts, exports, and file previews for workspace use. No Drive modification/deletion request found. Scope is not limited to one selected file. |
| Credentials | `electron/googleDriveStore.ts`, provider token maps | Access tokens in main-process memory. Refresh credentials/account details are encrypted using Electron safeStorage; unavailable encryption and Linux `basic_text` are rejected. No plaintext fallback. |
| Disconnect | `GoogleDriveProvider.disconnect` | Removes local connection credentials and in-memory tokens; best-effort remote revocation. Does not purge notes, recent metadata, or preview caches. |
| Cached resources | `electron/googleDriveFileCache.ts`, `electron/googleDrivePdfCache.ts`, `src/utils/appResources.ts` | `drive-preview-cache` has size-based eviction; PDF cache has no age-based expiry/disconnect purge. Cache files are not equivalent to encrypted credentials. Markdown embeds can contain retained text. |
| AI requests | `src/utils/ai-core.ts`, `src/utils/ai-settings.ts`, `src/App.tsx` | OpenAI, OpenRouter, and custom compatible endpoints receive prompts/excerpts/context. Configured annotation workflows can run automatically. Embedded Google text is not excluded from generic AI note processing. |
| AI key storage | AI settings and disk-store utilities | API keys can be saved in ordinary local vault configuration; do not extend Google's credential-protection guarantee to these keys. |
| Local models | `src/utils/embeddings.ts`, Transformers.js | Local inference can still download Hugging Face model files and jsDelivr runtime assets. |
| Accounts/cloud | `src/lib/auth.ts`, `src/lib/supabase.ts`, `src/lib/collaborationEngine.ts` | Optional Supabase-configured accounts, sharing and sync can transfer note content, paths, session/profile data and collaboration state. Sign-out is not server-side deletion. No blanket cloud-encryption claim. |
| Website storage | `website/src/theme.tsx`, `SiteHeader.tsx`, demo utilities | Appearance/demo localStorage and GitHub-star sessionStorage. No advertising/analytics cookie set by reviewed source; third parties can have their own storage. |
| Logs | Electron startup, integration logging, console statements | Errors, filenames, paths and operational/tool information can appear. No guarantee every log is redacted. Public bug reports can expose submitted content. |
| Updates/downloads | Website release data, GitHub API calls, install script | GitHub infrastructure supplies releases and repository metadata; downloading/updating involves external requests. |
| Other services | Website HTML/hosting config and optional providers | Google Fonts, GitHub, configured hosting, AI/cloud providers, enabled plugins and MCP servers; no speculative provider list. |
| License | Root `LICENSE` | Apache License 2.0; Terms preserve open-source permissions and user-content ownership. |

## Unverified operational facts

- Production hosting settings, log retention, administrator access, deployment
  regions, and analytics or services enabled outside the checked-in source.
- Third-party AI/cloud retention, training, deletion, and subprocessors.
- Currently deployed/shipped integration versions and Google verification status.
- Organizational fulfillment of Google's Limited Use requirements. The public
  policy expresses a commitment, not a compliance certification. Review transfers
  of Google-derived note text through configured AI/cloud providers before
  enabling them in a verified app.
- Deliverability and monitoring of `team@openonyx.app`; the address was supplied
  by the project owner, not verified by sending email during this task.

Official references:

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google connection-management guidance](https://support.google.com/accounts/answer/13533235)
- [Google Account connections](https://myaccount.google.com/connections)

## Automated checks

From the repository root:

```sh
npm run lint
npm --prefix website run build
npm --prefix website run test:legal
./node_modules/.bin/vitest run tests/website-manual.test.ts
npm test
./node_modules/.bin/tsc --noEmit -p website/tsconfig.json
```

The existing website TypeScript configuration also follows imported desktop
components. On unchanged `main` and this change it produced identical diagnostics
(248 output lines); no new diagnostics were introduced. Root `npm run lint`
passes. Do not mistake the baseline website errors for a clean strict typecheck.

Legal tests inspect generated static HTML, semantic section anchors, dates,
metadata, indexability, footer links, external-link safety, public React routes,
and Vercel clean-route/redirect configuration. No manual visual/UI testing was performed.
Build-time rendering starts no HTTP listener or application.

Verified results on this change:

- Production website build: passed (existing bundle-size/chunk warnings remain).
- Root TypeScript lint: passed.
- Legal route/metadata/link/disclosure tests: 4 passed.
- Existing website tests: 50 passed.
- Default application suite: 315 passed, 4 skipped (includes the website tests).
- Strict website typecheck: existing failure; baseline comparison identical,
  with no new diagnostics.
- Existing MCP checkout branch, HEAD and tracked/untracked status: unchanged.

## Manual QA for Varshith after deployment

1. Open `https://openonyx.app/privacy`; check title, date, contents links and all
   policy sections.
2. Open `https://openonyx.app/terms`; check title, date, all 17 sections and license.
3. From the homepage and another non-docs page, click footer Privacy and Terms.
4. At 375px and 768px browser widths, check text wrapping, contents, tappable
   links and absence of horizontal overflow.
5. At 1440px width, check readable prose width, contents/header/footer alignment;
   tab through links to verify visible focus.
6. In browser DevTools on this origin, run
   `localStorage.setItem('openonyx-theme', 'light'); location.reload()`;
   repeat with `'dark'`, then restore your preference. Check both pages. They
   inherit the existing theme; no new theme switch was added.
7. Open the Google policy/account-management links and confirm official Google
   destinations and new-tab behavior. Check the license link too.
8. Paste each legal URL into a new tab and refresh. Also disable JavaScript and
   confirm the policy text remains readable.
9. Proofread Drive disclosures against the shipped version: read-only scope,
   accessed data/purpose, PKCE, refresh-storage conditions, disconnect, retained
   caches and possible AI/cloud transfers of embedded excerpts.
10. Confirm `team@openonyx.app` appears on both pages, mailto works, and the inbox
    is monitored. Arrange policy/legal review before OAuth submission.

Google Auth Platform URLs after deployment:

- Privacy policy: `https://openonyx.app/privacy`
- Terms of service: `https://openonyx.app/terms`
- Application home page: `https://openonyx.app`
