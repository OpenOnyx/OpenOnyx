# Apps and external resources

The GitHub slice supports public repositories, issues and pull requests using the existing bundled MCP provider. Account sign-in is not implemented; this UI never implies that a public connection is an authenticated account. Other catalog entries remain marked Coming soon unless a real provider is available.

## Product surfaces

- Settings → Apps is the local app directory.
- GitHub explains the integration, manages grouped permissions, and shows recently selected resources.
- In a Markdown note, type `/` and select GitHub. Search is submitted explicitly and uses real provider data after native approval.
- Selecting a resource inserts a saved snapshot into the document. Click once to focus, or press Enter / double-click to open the resource view. The resource menu offers Refresh, Copy link, reference/embed display and removal. Refresh requests current data after native approval. Open on GitHub uses the existing native external-link boundary.
- The command palette's Use app command opens the same resource picker.
- Selected editor text has a contextual Create issue action when issue-creation permission is enabled on a connected provider. Creating an issue requires an authenticated provider. The user reviews the dedicated issue form and the native confirmation. Public browsing alone does not authenticate writes.

## Implementation boundaries

`AppResourceProvider` describes resource search and retrieval. `GithubResourceProvider` adds the issue action. `githubProvider.ts` adapts these product operations to known discovered MCP tools and sends every request through `requestToolExecution`. It neither receives an MCP client nor bypasses the native confirmation.

Existing MCP transport configurations, enabled tools, trust and activity keep their persistence keys and security rules. Human permission groups grant only the currently discovered known tools that the user selects. Unknown/new tools remain disabled. Raw runner, per-tool permissions, schemas, configuration, diagnostics and execution activity are accessible in Advanced → Developer details.

A snapshot is serialized as an `openonyx-resource` fenced Markdown block with a versioned, validated GitHub or Google Drive resource identity and selected display fields. Unknown properties are dropped; credentials, transport configuration and arguments are never serialized by the resource model. Snapshot contents may include the external issue body and comments the user chose to save. They therefore travel with the note if the user shares or syncs it.

The provider-neutral `ExternalResourcePicker` delegates filters, row presentation, search and errors to a local adapter. Repository filters are selected from real recent/results data. Typing and filter changes never request data; explicit search preserves native approval per request. Everything search may require two approvals, one for issues/pull requests and one for repositories. Connected app registrations supply the slash menu without putting provider API details in the editor.

Embed/reference presentation is an optional field in the same versioned block. Switching display preserves resource identity and replaces the existing snapshot rather than inserting another object.

Resource cards use text nodes, and URLs must match canonical provider resource URLs. Opening or rendering a saved note performs no provider calls. Refresh cannot update a different note after the user switches documents. Recent history is local metadata only; it excludes bodies, comments and credentials.

Polished previews use sanitized Markdown to select a short prose summary; resource details render a restricted set of Markdown tags, omit provider HTML/images, and route safe links through the native external-link API. UI-only ranking prioritizes exact repository names, recent repositories and recent owners without hiding global results.

Google Drive now extends the supported resource types, validator and presentation dispatcher while reusing the same picker, serialization, editor extension and update guards. Its native read-only provider owns browser OAuth and encrypted credential storage. Google authorization is not configured in this checkout; Connect stays disabled instead of simulating an account. See [Google Drive setup and verification](google-drive.md).

Graph nodes and autonomous AI actions remain outside this slice. Live Drive account verification requires Google Cloud configuration and user authorization. The resource identity/provider interfaces are extension points, not claims that these integrations exist.

## Verification

Automated coverage includes save-to-disk/reopen rendering, serialization, hostile text and URLs, slash completion, grouped permissions, legacy configurations, existing MCP security regressions and a real SDK stdio session with controlled GitHub API responses. A live public GitHub search also verifies the bundled provider's resource response against GitHub.

For desktop QA, connect GitHub or keep the existing connection, allow read permissions, open a note, type `/`, choose GitHub and search `signpath` (optionally scope to `OpenOnyx/OpenOnyx`). Approve the native request, insert a result, save, close and reopen the note. Open its resource view, Refresh with approval, and Open on GitHub. Check both themes, narrow windows and keyboard focus. Isolated Electron QA used a disposable profile and vault: real public search, PR insertion, save/reopen, process restart, and light/dark rendering were exercised. The picker portal fix was checked at narrow width. Automated tests cover node undo/redo, display changes, removal, safe Markdown, offline snapshots and the native gateway. A complete manual pass for all three resource types, native Refresh approval and external-browser opening remains pending.
