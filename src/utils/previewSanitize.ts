import DOMPurify from "dompurify";

/** Attributes preview HTML may keep. Event handlers are intentionally absent. */
export const PREVIEW_ADD_ATTR = [
  "data-link",
  "data-tag",
  "data-line",
  "data-heading",
  "data-embed",
  "data-callout",
  "data-foldable",
  "data-collapsed",
  "data-theme",
  "data-video-id",
  "data-url",
  "data-active-player",
  "checked",
  "type",
  "style",
  "frameborder",
  "allow",
  "allowfullscreen",
  "scrolling",
  "width",
  "height",
  "sandbox",
  "src",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "cx",
  "cy",
  "r",
  "x",
  "y",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "d",
];

export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|vault):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: PREVIEW_ADD_ATTR,
    ADD_TAGS: [
      "span",
      "input",
      "math",
      "semantics",
      "mrow",
      "mi",
      "mo",
      "mn",
      "msup",
      "mspace",
      "msqrt",
      "mfrac",
      "table",
      "tbody",
      "tr",
      "mtd",
      "mtr",
      "annotation",
      "iframe",
      "blockquote",
      "div",
      "svg",
      "path",
      "circle",
      "line",
      "rect",
      "polyline",
    ],
    ADD_DATA_URI_TAGS: ["img"],
  });
}

/** Hide broken preview favicons without keeping onerror in sanitized HTML. */
export function bindPreviewMediaFallbacks(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>("img.url-preview-favicon").forEach((img) => {
    img.addEventListener("error", () => {
      img.style.display = "none";
    });
  });
}
