import { Marked } from "marked";
import DOMPurify from "dompurify";

// Isolated parser: editor Markdown extensions cannot introduce active embeds here.
const resourceMarkdown = new Marked({ renderer: { html: () => "" } });
export function safeResourceMarkdown(body: string): string {
  const html = DOMPurify.sanitize(resourceMarkdown.parse(body, { async: false }) as string, {
    ALLOWED_TAGS: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "del", "blockquote", "pre", "code", "a", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("a").forEach((link) => {
    if (!safeResourceLink(link.getAttribute("href") || "")) link.removeAttribute("href");
  });
  return document.body.innerHTML;
}

export function safeResourceLink(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function resourceSummary(body: string): string {
  const document = new DOMParser().parseFromString(safeResourceMarkdown(body), "text/html");
  // Prefer prose over a template heading or a standalone closing reference.
  const paragraphs = [...document.querySelectorAll("p")].map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "");
  const prose = paragraphs.find((text) => text.length >= 30 && !/^(?:closes?|fixes?|resolves?)\s+#\d+\s*$/i.test(text));
  document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((node) => node.remove());
  const text = prose || document.body.textContent?.replace(/\s+/g, " ").trim() || "";
  if (text.length <= 240) return text;
  const sentence = text.slice(0, 240).match(/^([\s\S]*[.!?])(?:\s|$)/)?.[1];
  if (sentence && sentence.length >= 120) return `${sentence}…`;
  const end = text.lastIndexOf(" ", 240);
  return `${text.slice(0, end > 180 ? end : 240).replace(/[\s,;:]+$/, "")}…`;
}
