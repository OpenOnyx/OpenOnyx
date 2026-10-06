# Public website SEO pass — October 6, 2026

No manual UI/visual testing, application changes, tracking, commits, or pushes.

## Audit before changes

- Vite/React with React Router; existing `usePageMeta` and legal-page prerendering.
- Homepage, Download, Careers, configured role details and 46 manual routes.
  Only legal pages shipped populated HTML and page-specific metadata without JS.
- Canonicals/social URLs followed the visitor's origin and included query strings.
  Initial HTML and runtime social metadata pointed to different images.
- No robots.txt, sitemap, JSON-LD, manifest or explicit slash normalization.
- SPA fallback served unknown addresses as a 200 homepage shell; `/docs` and the
  legacy `/docs/features` alias redirected only after JavaScript execution.
- Download had an H2 but no primary H1. Three homepage section headings used H3
  without their own H2. Existing meaningful screenshot descriptions were adequate;
  the current homepage is primarily HTML and interactive demos, not screenshot text.
- Three public demo-data entries still mentioned OpenObsidian. Development URLs
  in programming examples are legitimate and were not blindly replaced.
- Google Fonts already use preconnect and display=swap. The large embedded editor
  is already lazy-loaded; its bundle-size warnings remain outside this focused pass.

## Changes

- `src/data/seo.ts` centralizes production-origin metadata and derives manual and
  open-role pages from the existing data. No duplicate hardcoded docs/role lists.
- Build-time rendering now reuses the actual React pages for all 53 public URLs.
  Docs use the same DOMPurify sanitizer through build-only jsdom; downloadable
  Markdown remains available. No new browser-side DOM library is introduced.
- Unique titles/descriptions, consistent canonical/OG/Twitter tags, existing
  banner image with its actual 2048×727 dimensions, and safe JSON-LD serialization.
- Organization represents an open-source project, not an incorporated entity;
  WebSite and SoftwareApplication describe only supported facts. Version,
  pricing, ratings, employee counts and awards are deliberately omitted.
- Sitemap and robots are generated with the HTML. A manifest and touch icon reuse
  existing branding. No cookie banner, analytics or new visual identity.
- Vercel cleanUrls/no trailing slash and permanent docs redirects replace the
  SPA catch-all. Unknown addresses can use the generated noindex 404.html rather
  than returning a 200 homepage. Live HTTP status still requires deployment QA.
- Small natural-language hero clarification, semantic heading corrections with
  matching CSS, stable navbar image dimensions and public demo-name corrections.
- Terms description updated as requested; existing legal policies/footer retained.

## Automated checks

```sh
npm run lint
npm --prefix website run build
npm --prefix website run test:seo
npm --prefix website run test:legal
npm test
./node_modules/.bin/tsc --noEmit -p website/tsconfig.json
```

SEO tests check every generated route for unique metadata, one H1, canonical
domain, indexability, structured-data syntax, no obsolete branding, valid internal
links/anchors/image sources, sitemap XML and exact robots content. They also check
hosting clean-URL/redirect configuration, a noindex 404 and manifest icon files.
This does not certify live deployment routing, visual layout, rich-result
eligibility, ranking gains, Lighthouse scores or Core Web Vitals.

Results: production build and root lint passed; 5 SEO and 4 legal tests passed;
315 app tests passed with 4 skipped (including 50 existing website tests).
Strict website typecheck still fails on pre-existing diagnostics; comparison
against unchanged `main` produced identical output and no new diagnostics.

## Manual QA for Varshith

1. Deploy these uncommitted changes through your normal workflow when ready.
2. View homepage source; confirm title “OpenOnyx — Local-First AI Knowledge
   Management”, one description, canonical `https://openonyx.app/`, OG/Twitter
   fields and JSON-LD. Inspect other pages for their own metadata.
3. Open `/privacy` and `/terms`; check content, contact address and footer links
   from the homepage and another public page.
4. Open `/sitemap.xml` and `/robots.txt`; confirm XML/plain text, not a homepage
   shell, and the canonical sitemap address.
5. Check 375px/768px mobile and 1440px desktop appearance, both themes, and keyboard
   navigation. No agent visual checks were performed.
6. Refresh Download, a role, a manual page and both legal URLs directly. Confirm
   `/docs` → `/docs/start`, `/docs/features` → `/docs/reference` and removal of
   trailing slashes. Confirm a made-up URL returns HTTP 404 using DevTools Network
   or `curl -I https://openonyx.app/not-a-real-page`.
7. Check homepage social sharing using LinkedIn Post Inspector and Facebook
   Sharing Debugger, then paste the URL into Discord/Slack. The existing banner
   is reused, not redesigned to a new 1200×630 composition; inspect its crop.
8. Search rendered/source metadata and the interactive demo for OpenObsidian and
   obsolete domains. Historical desktop migration data was not renamed.

## Search Console after deployment

1. Open https://search.google.com/search-console and add a **Domain** property
   for `openonyx.app` (no scheme or path).
2. Copy Google's TXT verification record to the domain's DNS provider, wait for
   propagation, then click Verify. No credentials are needed by this code change.
3. Under Sitemaps submit `https://openonyx.app/sitemap.xml` and check Success.
4. Use URL Inspection → Test live URL → Request indexing for `/`, `/download`,
   `/docs/start`, `/privacy`, `/terms` and other important pages.
5. After indexing, compare User-declared canonical and Google-selected canonical
   in URL Inspection. Google may choose a different canonical; the code cannot
   guarantee its selection.
6. Validate JSON-LD with https://validator.schema.org and use Google's Rich Results
   Test at https://search.google.com/test/rich-results. Software markup without
   ratings/offers does not guarantee a Google software-app rich result.
7. Recheck social previews after caches refresh and monitor Page indexing and
   Core Web Vitals reports. Do not repeatedly request indexing of all 53 pages.

References:

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://vercel.com/docs/project-configuration
