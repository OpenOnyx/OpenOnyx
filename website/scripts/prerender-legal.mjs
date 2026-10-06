import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
// A module compiler only: no HTTP listener, browser, or application is started.
const server = await createServer({
  root,
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
  const { LEGAL_POLICIES, renderLegal } = await server.ssrLoadModule("/scripts/render-legal.tsx");
  const template = await readFile(resolve(root, "dist/index.html"), "utf8");
  for (const policy of LEGAL_POLICIES) {
    const title = `${policy.title} | OpenOnyx`;
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
    html = html.replace("</head>", `<meta property="og:url" content="${url}" /></head>`);
    html = html.replace('<div id="root"></div>', `<div id="root">${renderLegal(policy)}</div>`);
    const directory = resolve(root, `dist${policy.path}`);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "index.html"), html);
    console.log(`[legal] Generated ${policy.path} with policy content and metadata`);
  }
} finally {
  await server.close();
}
