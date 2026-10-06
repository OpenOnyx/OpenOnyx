import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const pages = JSON.parse(await read("dist/seo-pages.json"));
const origin = "https://openonyx.app";
const aliases = { "/docs": "/docs/start", "/docs/features": "/docs/reference" };
const routeFile = path => `dist${path === "/" ? "/index" : path}.html`;

test("all public pages have unique static metadata, one H1, and canonical production URLs", async () => {
  assert.equal(new Set(pages.map(page => page.path)).size, pages.length);
  assert.equal(new Set(pages.map(page => page.title)).size, pages.length);
  for (const page of pages) {
    const html = await read(routeFile(page.path));
    const dom = new JSDOM(html);
    const document = dom.window.document;
    assert.equal(document.querySelectorAll("title").length, 1, page.path);
    assert.equal(document.title, page.title, page.path);
    assert.equal(document.querySelectorAll("h1").length, 1, page.path);
    assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1);
    assert.equal(document.querySelector('link[rel="canonical"]').href, `${origin}${page.path}`);
    for (const [attribute, key, expected] of [
      ["name", "description", page.description], ["property", "og:title", page.title],
      ["property", "og:description", page.description], ["property", "og:url", `${origin}${page.path}`],
      ["property", "og:image", `${origin}/images/banner.webp`], ["property", "og:type", "website"],
      ["property", "og:site_name", "OpenOnyx"], ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", page.title], ["name", "twitter:description", page.description],
      ["name", "twitter:image", `${origin}/images/banner.webp`], ["name", "robots", "index, follow"],
    ]) {
      const metas = document.querySelectorAll(`meta[${attribute}="${key}"]`);
      assert.equal(metas.length, 1, `${page.path}: duplicate/missing ${key}`);
      assert.equal(metas[0].content, expected, `${page.path}: ${key}`);
    }
    assert.ok(!html.includes("OpenObsidian"), page.path);
    assert.ok(!html.includes("open-onyx.vercel.app"), page.path);
    dom.window.close();
  }
});

test("sitemap is valid XML with every canonical public page, and robots allows crawling", async () => {
  const xml = await read("dist/sitemap.xml");
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  assert.equal(dom.window.document.documentElement.namespaceURI, "http://www.sitemaps.org/schemas/sitemap/0.9");
  const urls = [...dom.window.document.querySelectorAll("loc")].map(node => node.textContent);
  assert.deepEqual(urls, pages.map(page => `${origin}${page.path}`));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(!xml.includes("localhost") && !xml.includes("/404"));
  assert.equal(await read("dist/robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: https://openonyx.app/sitemap.xml\n");
  dom.window.close();
});

test("JSON-LD parses, accurately describes the project and app, and fabricates no ratings or pricing", async () => {
  for (const page of pages) {
    const dom = new JSDOM(await read(routeFile(page.path)));
    const nodes = dom.window.document.querySelectorAll('script[type="application/ld+json"]');
    assert.equal(nodes.length, 1);
    const schema = JSON.parse(nodes[0].textContent);
    assert.equal(schema["@context"], "https://schema.org");
    assert.ok(schema["@graph"].some(item => item["@type"] === "WebSite"));
    if (page.path === "/") {
      const app = schema["@graph"].find(item => item["@type"] === "SoftwareApplication");
      assert.equal(app.operatingSystem, "macOS, Windows, Linux");
      assert.equal(app.downloadUrl, `${origin}/download`);
      assert.equal(app.isBasedOn.codeRepository, "https://github.com/OpenOnyx/OpenOnyx");
    }
    for (const property of ["aggregateRating", "reviewCount", "price", "award", "foundingDate", "numberOfEmployees"]) assert.ok(!nodes[0].textContent.includes(`"${property}"`));
    dom.window.close();
  }
});

test("internal HTML links and image sources resolve, and primary content is readable without JS", async () => {
  const paths = new Set(pages.map(page => page.path));
  for (const page of pages) {
    const dom = new JSDOM(await read(routeFile(page.path)), { url: `${origin}${page.path}` });
    const document = dom.window.document;
    assert.ok(document.querySelector("main")?.textContent.trim().length > 200, page.path);
    for (const node of document.querySelectorAll("a[href], img[src]")) {
      const href = node.getAttribute(node.tagName === "IMG" ? "src" : "href");
      const url = new URL(href, `${origin}${page.path}`);
      if (url.origin !== origin) continue;
      const path = decodeURIComponent(url.pathname);
      if (paths.has(path) || aliases[path]) {
        if (url.hash && path === page.path) assert.ok(document.getElementById(decodeURIComponent(url.hash.slice(1))), `${page.path}: missing ${href}`);
      } else {
        await access(new URL(`dist${path}`, root));
      }
      if (node.tagName === "IMG") assert.ok(node.hasAttribute("alt"));
    }
    dom.window.close();
  }
});

test("static hosting handles clean routes, redirects, slash normalization and noindex 404s", async () => {
  const config = JSON.parse(await read("vercel.json"));
  assert.equal(config.cleanUrls, true);
  assert.equal(config.trailingSlash, false);
  assert.equal(config.rewrites, undefined, "Do not turn unknown URLs into a 200 homepage");
  for (const [source, destination] of Object.entries(aliases)) assert.ok(config.redirects.some(rule => rule.source === source && rule.destination === destination && rule.permanent));
  const html = await read("dist/404.html");
  assert.ok(html.includes('name="robots" content="noindex, follow"'));
  const manifest = JSON.parse(await read("dist/site.webmanifest"));
  assert.equal(manifest.name, "OpenOnyx");
  for (const icon of manifest.icons) await access(new URL(`dist${icon.src}`, root));
});
