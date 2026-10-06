import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const descriptions = {
  privacy: "Learn how OpenOnyx handles local data, optional integrations, Google Drive access, and privacy.",
  terms: "Read the terms governing the use of OpenOnyx, its open-source software, integrations, and optional services.",
};

for (const [path, title, sections] of [["privacy", "Privacy Policy", 15], ["terms", "Terms of Service", 17]]) {
  test(`/${path} ships readable HTML, metadata, and complete section links without JavaScript`, async () => {
    const html = await file(`dist/${path}.html`);
    assert.ok(html.includes(`<title>${title} | OpenOnyx</title>`));
    assert.ok(html.includes(`<meta name="description" content="${descriptions[path]}"`));
    assert.ok(html.includes(`<meta property="og:title" content="${title} | OpenOnyx"`));
    assert.ok(html.includes(`<meta name="twitter:title" content="${title} | OpenOnyx"`));
    assert.ok(html.includes(`<meta property="og:description" content="${descriptions[path]}"`));
    assert.ok(html.includes(`<meta property="og:url" content="https://openonyx.app/${path}"`));
    assert.ok(html.includes(`rel="canonical" href="https://openonyx.app/${path}"`));
    assert.ok(html.includes('name="robots" content="index, follow"'));
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    assert.equal([...html.matchAll(/<h2\b/g)].length, sections);
    assert.ok(/datetime="2026-10-06"/i.test(html));
    assert.ok(html.includes('href="mailto:team@openonyx.app"'));
    assert.ok(html.includes('href="https://openonyx.app"'));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, "Section IDs must be unique");
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor), `Missing anchor ${anchor}`);
    for (const [tag] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      const rel = tag.match(/rel="([^"]*)"/)?.[1] || "";
      assert.ok(rel.includes("noreferrer"));
      // noreferrer implies noopener; new legal references explicitly set both.
      if (tag.includes("google.com")) assert.ok(rel.includes("noopener"));
    }
    const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0];
    assert.ok(footer?.includes('href="/privacy"'));
    assert.ok(footer?.includes('href="/terms"'));
    assert.ok(html.includes('https://www.googleapis.com/auth/drive.readonly'));
  });
}

test("public routes and homepage footer point to the legal documents", async () => {
  const app = await file("src/App.tsx");
  assert.ok(app.includes('path="privacy" element={<Privacy />}'));
  assert.ok(app.includes('path="terms" element={<Terms />}'));
  const home = await file("src/pages/Home.tsx");
  assert.ok(home.includes('to="/privacy">Privacy</Link>'));
  assert.ok(home.includes('to="/terms">Terms</Link>'));
  const config = JSON.parse(await file("vercel.json"));
  assert.equal(config.cleanUrls, true);
  assert.equal(config.trailingSlash, false);
  assert.equal(config.rewrites, undefined);
});

test("privacy explains scope, retained copies, conditional security, and external processing", async () => {
  const html = await file("dist/privacy.html");
  for (const phrase of ["main-process memory", "PKCE", "basic_text", "best-effort", "does not delete", "drive-pdf-cache", "drive-preview-cache", "automatically", "Supabase", "OpenRouter", "Google Fonts", "not a promise of zero network activity"]) assert.ok(html.includes(phrase), `Missing disclosure: ${phrase}`);
  assert.ok(html.includes("https://developers.google.com/terms/api-services-user-data-policy"));
  assert.ok(html.includes("https://myaccount.google.com/connections"));
  assert.ok(html.includes("Limited Use"));
});
