import { useEffect } from "react";
import { PRODUCT } from "../data/facts";
import { canonicalUrl, pageSeo, SOCIAL_IMAGE, structuredData } from "../data/seo";

function setContent(selector: string, value: string) {
  const node = document.querySelector(selector);
  if (node) node.setAttribute("content", value);
}

function ensureMeta(selector: string, attrs: Record<string, string>) {
  let node = document.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    document.head.appendChild(node);
  }
  return node;
}

function ensureLink(rel: string) {
  let node = document.querySelector(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", rel);
    document.head.appendChild(node);
  }
  return node;
}

function pageUrl() {
  return canonicalUrl(window.location.pathname);
}

function pageImage() {
  return SOCIAL_IMAGE;
}

export function usePageMeta(title: string, description: string = PRODUCT.description) {
  useEffect(() => {
    const page = pageSeo(window.location.pathname);
    const resolvedTitle = page?.title ?? title;
    const resolvedDescription = page?.description ?? description;
    const previousTitle = document.title;
    const previousDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    const previousOgTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const previousOgDescription =
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const previousOgUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "";
    const previousOgImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "";
    const previousTwitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? "";
    const previousTwitterDescription =
      document.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? "";
    const previousTwitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ?? "";
    const previousCanonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";

    const url = pageUrl();
    const image = pageImage();

    document.title = resolvedTitle;
    setContent('meta[name="description"]', resolvedDescription);
    setContent('meta[property="og:title"]', resolvedTitle);
    setContent('meta[property="og:description"]', resolvedDescription);
    ensureMeta('meta[property="og:url"]', { property: "og:url" }).setAttribute("content", url);
    setContent('meta[property="og:image"]', image);
    setContent('meta[name="twitter:title"]', resolvedTitle);
    setContent('meta[name="twitter:description"]', resolvedDescription);
    setContent('meta[name="twitter:image"]', image);
    ensureLink("canonical").setAttribute("href", url);
    setContent('meta[name="robots"]', page ? "index, follow" : "noindex, follow");
    let schema = document.querySelector<HTMLScriptElement>('script[data-site-schema]');
    if (!schema) {
      schema = document.createElement("script");
      schema.type = "application/ld+json";
      schema.dataset.siteSchema = "";
      document.head.appendChild(schema);
    }
    schema.textContent = JSON.stringify(structuredData(window.location.pathname));

    return () => {
      document.title = previousTitle;
      setContent('meta[name="description"]', previousDescription);
      setContent('meta[property="og:title"]', previousOgTitle);
      setContent('meta[property="og:description"]', previousOgDescription);
      setContent('meta[property="og:url"]', previousOgUrl);
      setContent('meta[property="og:image"]', previousOgImage);
      setContent('meta[name="twitter:title"]', previousTwitterTitle);
      setContent('meta[name="twitter:description"]', previousTwitterDescription);
      setContent('meta[name="twitter:image"]', previousTwitterImage);
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.setAttribute("href", previousCanonical);
    };
  }, [title, description]);
}
