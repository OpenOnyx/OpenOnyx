import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.NODE_ENV = "production";
// A module compiler only: no HTTP listener, browser, or application is started.
const server = await createServer({
  root,
  mode: "production",
  server: { middlewareMode: true },
  appType: "custom",
  ssr: {
    noExternal: ["react-router", "react-router-dom"],
    // Compile router ESM exports rather than its Node CommonJS wrapper.
    resolve: { conditions: ["module", "import"] },
  },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
try {
  const { PUBLIC_PAGES, DOC_PAGES, renderPublic, structuredData, closeRenderer } = await server.ssrLoadModule("/scripts/render-public.tsx");
  const template = await readFile(resolve(root, "dist/index.html"), "utf8");
  const pages = [...PUBLIC_PAGES, { path: "/404", title: "Page not found — OpenOnyx", description: "This page is not part of the OpenOnyx website." }];
  for (const policy of pages) {
    const title = policy.title;
    let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`);
    for (const [attribute, key, value] of [
      ["name", "description", policy.description],
      ["property", "og:title", title], ["property", "og:description", policy.description],
      ["name", "twitter:title", title], ["name", "twitter:description", policy.description],
    ]) {
      html = html.replace(new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`), `<meta ${attribute}="${key}" content="${escape(value)}" />`);
    }
    const url = `https://openonyx.app${policy.path}`;
    html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
    html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}" />`);
    if (policy.path === "/404") html = html.replace('name="robots" content="index, follow"', 'name="robots" content="noindex, follow"');
    const schema = JSON.stringify(structuredData(policy.path)).replaceAll("<", "\\u003c");
    html = html.replace("</head>", `<script type="application/ld+json" data-site-schema>${schema}</script></head>`);
    html = html.replace('<div id="root"></div>', `<div id="root">${renderPublic(policy.path)}</div>`);
    const target = resolve(root, policy.path === "/" ? "dist/index.html" : `dist${policy.path}.html`);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, html);
  }
  await mkdir(resolve(root, "dist/manual"), { recursive: true });
  for (const page of DOC_PAGES) await writeFile(resolve(root, "dist/manual", page.filename), page.markdown);
  const locations = PUBLIC_PAGES.map(page => `  <url><loc>https://openonyx.app${page.path}</loc></url>`).join("\n");
  await writeFile(resolve(root, "dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`);
  await writeFile(resolve(root, "dist/robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: https://openonyx.app/sitemap.xml\n");
  await writeFile(resolve(root, "dist/seo-pages.json"), JSON.stringify(PUBLIC_PAGES));
  closeRenderer();
  console.log(`[seo] Generated ${PUBLIC_PAGES.length} public pages, sitemap, robots.txt, and a noindex 404 page`);
} finally {
  await server.close();
}
