export type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  links?: Array<{ label: string; href: string }>;
};

export type LegalPolicy = {
  path: "/privacy" | "/terms";
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
};

const CONTACT: LegalSection = {
  id: "contact",
  title: "Contact",
  paragraphs: ["For questions about this policy or these terms, contact OpenOnyx."],
  links: [
    { label: "team@openonyx.app", href: "mailto:team@openonyx.app" },
    { label: "OpenOnyx — openonyx.app", href: "https://openonyx.app" },
  ],
};

export const PRIVACY_POLICY: LegalPolicy = {
  path: "/privacy",
  title: "Privacy Policy",
  description: "Learn how OpenOnyx handles local data, optional integrations, Google Drive access, and privacy.",
  updated: "2026-10-06",
  sections: [
    {
      id: "introduction", title: "Introduction",
      paragraphs: [
        "OpenOnyx is an open-source, local-first knowledge management application. This policy explains how information is handled by the desktop application, the OpenOnyx website, and optional online features and integrations. Available features depend on the version and configuration you use.",
        "Local-first does not mean that every feature is offline. Connecting an integration, enabling external AI, using cloud collaboration, opening remote content, or downloading software can involve requests to third-party services.",
      ],
    },
    {
      id: "local-data", title: "Local-first data",
      paragraphs: [
        "Your notes normally remain ordinary Markdown files in the vault folder you choose on your disk. Attachments and other workspace files also reside in local folders. Core local use does not require an OpenOnyx account or uploading your vault to an OpenOnyx server.",
        "OpenOnyx also stores working data locally: settings, indexes, embeddings, AI results, and workspace state may be written into the vault’s .openonyx folder, the application’s user-data directory, browser storage, or local databases. These supporting stores are separate from your Markdown files.",
        "A folder you place in a third-party sync service, share with another person, or back up externally remains subject to those services and your own sharing choices.",
      ],
    },
    {
      id: "information", title: "Information the application may process",
      paragraphs: ["Depending on the features you use, OpenOnyx may process:"],
      items: [
        "Notes, document content, attachments, filenames, paths, links, and search queries needed to display, edit, index, or retrieve your knowledge.",
        "Preferences, vault history, workspace state, local indexes, embedding vectors, and cached AI responses.",
        "Integration configuration, account identifiers, display names, email addresses, resource identifiers, file metadata, and authentication credentials.",
        "Selected external-resource descriptions, text excerpts, embedded snapshots, and downloaded preview files.",
        "Account and session information for configured cloud features, shared content, collaborator information, and synchronization state.",
        "Operational errors and diagnostic logs, and information you choose to send when requesting support.",
      ],
    },
    {
      id: "google-drive", title: "Google Drive integration",
      paragraphs: [
        "Connecting Google Drive is optional and available only in builds that include and configure the integration. OpenOnyx requests Google Drive read-only access using the scope https://www.googleapis.com/auth/drive.readonly. This permission can read files accessible to your Google account; it is broader than access to only one selected file.",
        "OpenOnyx uses this access to search your Drive, retrieve metadata and content for resources you access through OpenOnyx, and display or embed selected resources in your knowledge workspace. The connector reads account information such as a Google account identifier, email address, and display name, and file information such as IDs, names, types, owners, modification times, sizes, and descriptions. It may retrieve a Google Docs text excerpt, export a Google document for a preview, or download a supported file such as a PDF.",
        "Search terms and authenticated requests are sent directly from the application to Google. Google receives the request and ordinary connection information, such as your IP address. This integration does not use its read-only permission to modify or delete files in Google Drive.",
        "Authorization opens your external browser and uses a Desktop OAuth client with Authorization Code and PKCE. The implementation includes a public client ID, not a bundled Google client secret. Access tokens are held in Electron’s main-process memory. Refresh credentials and connected-account details are saved locally using Electron’s OS-backed encrypted storage when an acceptable secure backend is available. The connector refuses the insecure Linux basic_text fallback and does not connect when secure credential storage is unavailable. This does not mean that all application data or preview files are encrypted.",
        "Disconnecting removes that account’s locally saved refresh credentials and in-memory access tokens and stops further authenticated access through that connection. OpenOnyx also attempts to revoke the grant at Google. Revocation is a best-effort network request and may not succeed while offline or if Google is unavailable. You can independently revoke access in your Google Account settings.",
        "Disconnecting does not delete the original Drive files, saved resource blocks in your notes, recent-resource metadata, or local PDF and document preview caches. Existing snapshots may remain readable until you remove them. See Data retention and Your choices below.",
        "The Drive connector itself does not relay your OAuth credentials to an AI provider or an OpenOnyx cloud server. However, an excerpt saved inside a note becomes part of that note: enabling AI processing or sharing or syncing the note can transfer that excerpt to the configured provider or recipients. Connecting Drive by itself does not enable those features.",
      ],
      links: [
        { label: "Manage or revoke third-party access in your Google Account", href: "https://myaccount.google.com/connections" },
        { label: "Google’s guidance on managing third-party connections", href: "https://support.google.com/accounts/answer/13533235" },
      ],
    },
    {
      id: "google-api-policy", title: "Google API Services User Data Policy",
      paragraphs: [
        "OpenOnyx’s use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including its Limited Use requirements, to the extent applicable. Google data is used for the user-facing workspace features described here. The Drive connector does not use that data for advertising, sale to data brokers, or training a general-purpose AI model.",
        "Any transfer of Google-derived content through an optional AI, sharing, or cloud feature must remain consistent with the applicable Google policy and the user’s authorization. This statement is not a claim that Google has verified, certified, or endorsed OpenOnyx. Review the data you include before sending a note to an external service; an external provider’s retention and processing practices are separate from the local connector.",
      ],
      links: [{ label: "Google API Services User Data Policy, including Limited Use", href: "https://developers.google.com/terms/api-services-user-data-policy" }],
    },
    {
      id: "ai", title: "Optional AI features and external APIs",
      paragraphs: [
        "External AI features use the provider, model, endpoint, and API credentials configured in the application. Supported configurations include OpenAI, OpenRouter, and custom compatible endpoints. A local endpoint and a hosted provider have different data-handling implications.",
        "AI requests can contain your question, selected text, note titles, excerpts, and retrieved context from your vault or a Space. This can include external-resource text already saved in a note. Summaries, synthesis, writing assistance, and answers are not guaranteed to remain on your device. After you configure AI, some supported workflows can generate annotations automatically, rather than requiring a separate confirmation for every request.",
        "Providers process requests under their own terms and privacy policies; a routing service such as OpenRouter may forward a request to the selected model provider. OpenOnyx cannot guarantee their retention periods, model-training choices, or deletion behavior. Review those settings before enabling AI for confidential or Google-derived material.",
        "Local embedding and indexing features process note content on the device, but may download model files or runtime assets from external hosts, including Hugging Face or jsDelivr. Generated results and settings may be cached locally. AI API keys can be stored in local vault settings; the Google credential protection described above is not a promise that these settings or keys have equivalent encryption.",
      ],
    },
    {
      id: "accounts-cloud", title: "Optional accounts, sharing, and cloud storage",
      paragraphs: [
        "Local editing does not require a login. Builds configured for Supabase-backed cloud features can support accounts, publishing, collaboration, and synchronization. These features may process email addresses, profile and session information, collaborator identifiers, presence, and shared content through the configured service.",
        "Creating or syncing a cloud Space can upload note content, titles, paths, and related workspace data, including multiple files from the selected vault. Published or shared content may be accessible to others according to the chosen Space and service configuration. Do not assume that enabling a cloud feature preserves purely local storage, or that every shared Space is encrypted.",
        "Signing out or disconnecting locally does not by itself erase copies already stored by a cloud service, collaborators, or backups. Cloud retention and deletion depend on the service and deployment you use; contact its operator about account or server-side deletion.",
      ],
    },
    {
      id: "third-parties", title: "Other third-party services",
      paragraphs: [
        "The website and downloads use GitHub for repository metadata, releases, source code, issues, and discussions. Visiting these services or downloading a release sends ordinary request information to GitHub and its delivery infrastructure. The website loads typography from Google Fonts.",
        "Optional plugins, remote images, embedded content, API integrations, and MCP servers can contact their own services or process the content and tool arguments you provide. Their permissions and data handling depend on the component you enable. Review a component before trusting it with your files or credentials.",
        "Hosting, email, integration, and AI providers may process connection or support information under their own policies. OpenOnyx’s core local file storage does not automatically upload your vault to all of these services.",
      ],
    },
    {
      id: "website-diagnostics", title: "Website storage, telemetry, and diagnostics",
      paragraphs: [
        "The checked-in application and website do not include a dedicated product-analytics or automatic remote crash-reporting integration. This is not a promise of zero network activity or zero logging. Hosting and external services may keep access or operational logs, and their production configuration is separate from the application source.",
        "The website uses localStorage for appearance preferences and browser-based demo data, and sessionStorage for cached GitHub star counts. The interactive application demo can use local browser storage for settings and workspace data. These stores are not necessarily cleared when a tab closes. Browser settings can remove them. The checked-in website does not set an advertising or analytics cookie; third-party sites, embeds, or configured account services may use their own storage or cookies.",
        "Application console and integration activity logs may include filenames, paths, tool or resource information, status messages, and errors. Do not assume that every log has been stripped of sensitive information. If you send a bug report, screenshot, or log to maintainers, review it first; a public GitHub issue is visible to other people.",
      ],
    },
    {
      id: "security", title: "Data storage and security",
      paragraphs: [
        "Local notes and ordinary caches are readable files or local application stores; OpenOnyx does not automatically encrypt all vault files, settings, backups, or Drive previews. Their protection also depends on your device, operating system, filesystem permissions, disk encryption, and any backup or sync service you use.",
        "Google OAuth credentials are handled as described in the Google Drive section. Secure-storage availability varies by operating system and environment. Other integrations and configurable services may use different credential stores. No software or storage mechanism can guarantee absolute security.",
      ],
    },
    {
      id: "retention", title: "Data retention and deletion",
      paragraphs: [
        "Your notes remain in the folders you choose until you remove them. App settings, local databases, browser storage, and derived data can remain after closing or uninstalling the application. Removing a file in the app can move it to the operating system’s trash, where supported, rather than securely erase every copy. Backups and external sync services can retain additional copies.",
        "Drive resource metadata and excerpts saved in notes remain part of those notes. Recent-resource information is retained locally. Downloaded PDF previews and other supported document previews are cached in the application’s user-data directory. General document previews have size-based eviction; the reviewed PDF cache has no automatic age-based expiry or disconnect purge. Removing an embed does not necessarily remove a separate downloaded preview cache.",
        "To remove local Drive copies, remove the saved resource content from the relevant notes, clear associated browser or app storage and recent-resource data, and remove the drive-pdf-cache and drive-preview-cache directories in the application’s user-data location with the app closed. Disconnect first, and back up content you want to retain. Deleting local copies does not delete the source files at Google.",
        "Copies intentionally sent to AI providers, cloud services, collaborators, or support channels have retention rules outside the local application. Requests to remove those copies should be directed to the relevant service or, for information you sent to OpenOnyx, the contact below.",
      ],
    },
    {
      id: "choices", title: "Your choices and controls",
      paragraphs: ["You can:"],
      items: [
        "Use local vault workflows without connecting Google Drive, configuring external AI, or signing in to cloud features.",
        "Disconnect a Drive account in the app and independently revoke OpenOnyx access in Google Account third-party connection settings.",
        "Remove AI credentials or change the configured endpoint to control subsequent external AI requests. Already-sent requests are not recalled.",
        "Review note content, including embedded resource excerpts, before using AI, publishing, sharing, or synchronizing it.",
        "Delete local notes and supporting application data, and clear website browser storage. Closing or uninstalling the app alone may not remove every store.",
        "Contact OpenOnyx about information you provided directly to maintainers. OpenOnyx cannot remotely erase your local vault or a third party’s independent copies.",
      ],
    },
    {
      id: "children", title: "Children’s privacy",
      paragraphs: ["OpenOnyx’s website and online integrations are not directed at children under 13. If you believe a child has supplied personal information directly to OpenOnyx without appropriate permission, contact us so we can review and address it. Third-party account and integration services may impose their own age requirements."],
    },
    {
      id: "changes", title: "Changes to this policy",
      paragraphs: ["We may update this policy as features and practices change. The date above identifies the latest revision. Material changes to the use of Google data should be disclosed before that data is used for a new purpose, with additional authorization where required. Review this page when enabling a new online feature."],
    },
    CONTACT,
  ],
};

export const TERMS_OF_SERVICE: LegalPolicy = {
  path: "/terms",
  title: "Terms of Service",
  description: "Terms governing the use of OpenOnyx and its optional integrations and services.",
  updated: "2026-10-06",
  sections: [
    {
      id: "acceptance", title: "Acceptance of terms",
      paragraphs: ["These terms describe the conditions for using the OpenOnyx website and optional integrations and services. By using them, you agree to these terms to the extent permitted by applicable law. If you do not agree, discontinue those services. Rights to use, modify, and distribute the open-source software are governed by its applicable license, as explained below."],
    },
    {
      id: "description", title: "Description of OpenOnyx",
      paragraphs: ["OpenOnyx is an open-source, local-first knowledge management application built around user-owned files, Markdown notes, connected knowledge, graphs, and optional AI and integrations. Features and availability vary by version, operating system, and configuration. Local use does not require an OpenOnyx account; optional cloud or third-party features may require separate accounts and connectivity."],
    },
    {
      id: "open-source", title: "Open-source software",
      paragraphs: ["The OpenOnyx repository is distributed under the Apache License, Version 2.0. Third-party components may have separate licenses and notices. The applicable open-source licenses govern your rights to use, reproduce, modify, and distribute that code. These website and service terms do not remove or override permissions granted by those licenses. If these terms conflict with a license concerning the licensed software, the license controls."],
      links: [{ label: "OpenOnyx repository license — Apache-2.0", href: "https://github.com/OpenOnyx/OpenOnyx/blob/main/LICENSE" }],
    },
    {
      id: "responsibilities", title: "User responsibilities",
      paragraphs: ["You are responsible for your device, backups, credentials, provider accounts, and the content you store or share. Use only files and accounts you are authorized to access. Review permissions and configuration before enabling plugins, MCP servers, AI, cloud synchronization, or other integrations. Keep independent backups; neither synchronization nor a preview cache is a substitute for one."],
    },
    {
      id: "integrations", title: "Third-party integrations",
      paragraphs: ["Integrations are optional. Connecting a service authorizes the application to perform the supported actions you request or enable under the permissions granted. Provider restrictions, account eligibility, outages, quotas, and changes may affect availability. You are responsible for any provider charges and for complying with that provider’s terms. A plugin or tool may have capabilities and risks beyond the core local editor."],
    },
    {
      id: "google-drive", title: "Google Drive integration",
      paragraphs: [
        "Where available, OpenOnyx’s Google Drive connector requests the read-only scope https://www.googleapis.com/auth/drive.readonly to search Drive and retrieve and display resources in your workspace. This connector does not use that permission to modify or delete Google Drive files. Google accounts, files, and APIs remain governed by Google’s applicable terms and policies.",
        "You may disconnect in OpenOnyx or revoke access in your Google Account. Disconnecting removes local connection credentials and attempts remote revocation; it does not delete files at Google or automatically erase snapshots, recent-resource metadata, or preview caches already stored locally. The Privacy Policy explains those stores and the effect of sharing or processing a note that contains a Drive excerpt.",
        "The presence of this page does not imply Google verification, endorsement, or authorization for uses outside the applicable Google API policies.",
      ],
      links: [{ label: "Manage Google Account third-party connections", href: "https://myaccount.google.com/connections" }],
    },
    {
      id: "ai", title: "AI features and third-party AI providers",
      paragraphs: [
        "AI features are optional and may use configured external providers or local compatible endpoints. Prompts, note excerpts, selected text, and retrieved context may be transmitted to the configured service. Some workflows can run automatically after AI is configured. Review provider terms, privacy settings, costs, and the content being processed before enabling these features.",
        "AI output can be incomplete, inaccurate, or misleading. You are responsible for checking it before relying on it, publishing it, or applying changes to your files. An answer grounded in notes is not a guarantee of correctness or professional advice. OpenOnyx does not control a third-party provider’s availability, retention, or model behavior.",
      ],
    },
    {
      id: "content", title: "User content and ownership",
      paragraphs: [
        "You retain ownership of your notes, files, and other original content. OpenOnyx does not claim ownership of your vault. Rights in third-party materials, including Drive resources, remain with their respective owners.",
        "Using a feature permits the processing necessary to provide that feature, such as locally indexing a note, sending context to your configured AI provider, or transferring content to the cloud service or collaborators you choose. This is not a transfer of ownership. Share only content you have permission to share, and account for the rights of collaborators and third-party resource owners.",
      ],
    },
    {
      id: "intellectual-property", title: "Intellectual property",
      paragraphs: ["OpenOnyx code and contributions are subject to their applicable licenses. The OpenOnyx name, branding, website materials, and third-party marks remain subject to their respective intellectual-property rights. An open-source license does not automatically grant rights to use a project’s trademarks or imply endorsement. Nothing here restricts lawful use or rights expressly granted by a license."],
    },
    {
      id: "prohibited-use", title: "Prohibited use",
      paragraphs: ["Do not use the website or integrations to:"],
      items: [
        "Access accounts, files, systems, or data without authorization, or bypass access controls.",
        "Distribute malware, abuse a service, interfere with other users, or knowingly overload third-party infrastructure.",
        "Infringe intellectual-property or privacy rights, misuse confidential content, or violate applicable law.",
        "Misrepresent identity, impersonate OpenOnyx or another person, or use Google API data in ways prohibited by Google’s policies.",
      ],
    },
    {
      id: "availability", title: "Software availability and changes",
      paragraphs: ["Software, documentation, and optional services may change, contain errors, or be unavailable. Releases can add, change, or discontinue features. Provider APIs or operating-system changes can break an integration. OpenOnyx does not promise uninterrupted availability, a particular support response, or indefinite maintenance of any version. Keeping local files does not guarantee compatibility with every future feature."],
    },
    {
      id: "third-party-services", title: "Third-party services",
      paragraphs: ["Google, GitHub, configured AI providers, cloud deployments, plugins, and other linked services operate under their own terms and policies. OpenOnyx does not control their content, outages, billing, data retention, or actions. A link or integration is not an endorsement. When sharing or publishing through a cloud feature, access is determined by that feature’s configuration and the service’s rules."],
    },
    {
      id: "warranties", title: "Disclaimer of warranties",
      paragraphs: ["To the extent permitted by applicable law, the website, software, and optional services are provided “as is” and “as available,” without warranties, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. OpenOnyx does not warrant that output is accurate, that every integration will work, or that data cannot be lost. The software’s applicable license also sets out warranty terms. This disclaimer does not exclude rights or warranties that cannot legally be excluded."],
    },
    {
      id: "liability", title: "Limitation of liability",
      paragraphs: ["To the extent permitted by applicable law, OpenOnyx and its contributors are not liable for indirect, incidental, special, consequential, or punitive damages, or loss of data, profits, or business arising from use of the website, software, or optional services. The applicable software license may also contain liability limitations. Nothing here excludes or limits liability that cannot legally be excluded or limited, or overrides mandatory consumer rights."],
    },
    {
      id: "termination", title: "Termination and discontinuation",
      paragraphs: [
        "You can stop using the website, disconnect integrations, or uninstall OpenOnyx. We may discontinue optional services or restrict access to services we operate when required by law, security, abuse prevention, or these terms. External providers may separately restrict their services.",
        "Discontinuing an online service does not revoke rights already granted under an open-source license. Your locally stored notes remain your files. Uninstalling or disconnecting does not necessarily remove local application data or copies held by external services. Back up desired content and follow the Privacy Policy’s deletion guidance.",
      ],
    },
    {
      id: "changes", title: "Changes to these terms",
      paragraphs: ["We may revise these terms and update the revision date. Changes apply to the website and optional services as permitted by law; they do not retroactively remove open-source license permissions. Review the current terms when enabling new online features. If you do not accept revised service terms, stop using the affected service."],
    },
    CONTACT,
  ],
};

export const LEGAL_POLICIES = [PRIVACY_POLICY, TERMS_OF_SERVICE] as const;
