import { useEffect } from "react";
import { PRODUCT } from "../data/facts";

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
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function pageImage() {
  return `${window.location.origin}/images/banner.webp`;
}

export function usePageMeta(title: string, description: string = PRODUCT.description) {
  useEffect(() => {
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

    document.title = title;
    setContent('meta[name="description"]', description);
    setContent('meta[property="og:title"]', title);
    setContent('meta[property="og:description"]', description);
    ensureMeta('meta[property="og:url"]', { property: "og:url" }).setAttribute("content", url);
    setContent('meta[property="og:image"]', image);
    setContent('meta[name="twitter:title"]', title);
    setContent('meta[name="twitter:description"]', description);
    setContent('meta[name="twitter:image"]', image);
    ensureLink("canonical").setAttribute("href", url);

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
