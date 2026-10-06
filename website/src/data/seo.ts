import { CAREER_ROLES } from "./careers";
import { DOC_PAGES } from "./docs";
import { PRODUCT } from "./facts";
import { LEGAL_POLICIES } from "./legal";

export const SITE_ORIGIN = "https://openonyx.app";
export const SITE_TITLE = "OpenOnyx — Local-First AI Knowledge Management";
export const SITE_DESCRIPTION = "OpenOnyx is an open-source, local-first knowledge management app. Connect Markdown notes, explore knowledge graphs, and ask your own files with optional AI tools.";
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/images/banner.webp`;

export type SeoPage = { path: string; title: string; description: string };
const plainText = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`#_]/g, "").replace(/\s+/g, " ").trim();

// Docs and role URLs come from the same data that renders those public routes.
export const PUBLIC_PAGES: SeoPage[] = [
  { path: "/", title: SITE_TITLE, description: SITE_DESCRIPTION },
  { path: "/download", title: "Download OpenOnyx — macOS, Windows & Linux", description: "Download the open-source OpenOnyx desktop app for macOS, Windows, and Linux. Keep Markdown notes on your disk and explore connected knowledge with optional AI." },
  { path: "/careers", title: "Careers — OpenOnyx", description: "Build open-source, local-first software for knowledge work with OpenOnyx. Explore roles and ways to contribute to the project." },
  ...LEGAL_POLICIES.map(policy => ({ path: policy.path, title: `${policy.title} | OpenOnyx`, description: policy.description })),
  ...DOC_PAGES.map(page => ({ path: `/docs/${page.slug}`, title: `${page.title} — OpenOnyx Manual`, description: `${page.title}: ${plainText(page.summary) || "Learn how to use this part of OpenOnyx."}`.slice(0, 200) })),
  ...CAREER_ROLES.filter(role => role.isOpen).map(role => ({ path: `/careers/${role.slug}`, title: `${role.title} — OpenOnyx Careers`, description: role.description })),
];

export function normalizePublicPath(path: string) {
  return path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

export function pageSeo(path: string) {
  return PUBLIC_PAGES.find(page => page.path === normalizePublicPath(path));
}

export function canonicalUrl(path: string) {
  return `${SITE_ORIGIN}${normalizePublicPath(path)}`;
}

export function structuredData(path: string) {
  const project = {
    "@type": "Organization", "@id": `${SITE_ORIGIN}/#project`, name: "OpenOnyx",
    description: "The OpenOnyx open-source software project.", url: `${SITE_ORIGIN}/`,
    logo: `${SITE_ORIGIN}/logos/logo-dark.png`, sameAs: [PRODUCT.repo],
  };
  const graph: Record<string, unknown>[] = [project, {
    "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: "OpenOnyx",
    url: `${SITE_ORIGIN}/`, publisher: { "@id": project["@id"] },
  }];
  if (normalizePublicPath(path) === "/") graph.push({
    "@type": "SoftwareApplication", "@id": `${SITE_ORIGIN}/#software`,
    name: "OpenOnyx", applicationCategory: "ProductivityApplication",
    operatingSystem: "macOS, Windows, Linux", description: SITE_DESCRIPTION,
    url: `${SITE_ORIGIN}/`, downloadUrl: `${SITE_ORIGIN}/download`,
    license: `${PRODUCT.repo}/blob/main/LICENSE`,
    isBasedOn: { "@type": "SoftwareSourceCode", codeRepository: PRODUCT.repo, license: `${PRODUCT.repo}/blob/main/LICENSE` },
  });
  return { "@context": "https://schema.org", "@graph": graph };
}
