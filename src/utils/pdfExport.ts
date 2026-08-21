import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import { resolveVaultImageSrc } from "./resolveImageSrc";

marked.use(markedKatex({ throwOnError: false }));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function toFileUri(vaultPath: string | undefined, src: string): string {
  if (!src || /^(https?|data|file|blob):/i.test(src)) return src;
  if (!vaultPath) return src;

  const cleanVault = vaultPath.replace(/[\\/]+$/, "");
  const cleanSrc = src.replace(/^[/\\]+/, "");
  const joined = `${cleanVault}/${cleanSrc}`.replace(/\\/g, "/");
  return `file://${joined.split("/").map((part, index) => index === 0 ? part : encodeURIComponent(part)).join("/")}`;
}

function isImageEmbedPath(src: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(src.trim());
}

type VaultFileLike = {
  path?: string;
  name?: string;
  isDirectory?: boolean;
  children?: VaultFileLike[];
};

function normalizeVaultPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function flattenVaultFiles(files: VaultFileLike[] | undefined): VaultFileLike[] | undefined {
  if (!files) return undefined;

  const flattened: VaultFileLike[] = [];
  const visit = (entries: VaultFileLike[]) => {
    for (const entry of entries) {
      flattened.push(entry);
      if (entry.children) visit(entry.children);
    }
  };
  visit(files);
  return flattened;
}

function vaultImageExists(src: string, vaultFiles: VaultFileLike[] | undefined): boolean {
  if (!vaultFiles) return true;

  const normalizedSrc = normalizeVaultPath(src);
  const srcBasename = normalizedSrc.split("/").pop();

  return vaultFiles.some((file) => {
    if (file.isDirectory) return false;

    const filePath = file.path ? normalizeVaultPath(file.path) : "";
    const fileName = file.name || filePath.split("/").pop();

    return filePath === normalizedSrc || (!!srcBasename && fileName === srcBasename);
  });
}

function parseWikiImageDisplay(displayText: string | undefined): { alt: string | null; width: number | null } {
  if (!displayText) return { alt: null, width: null };

  const parts = displayText.split("|").map((part) => part.trim()).filter(Boolean);
  let width: number | null = null;
  const altParts: string[] = [];

  for (const part of parts) {
    if (/^\d+$/.test(part) && width === null) {
      width = Number(part);
    } else {
      altParts.push(part);
    }
  }

  return {
    alt: altParts.length > 0 ? altParts.join(" | ") : null,
    width,
  };
}

function preprocessMarkdown(markdown: string, vaultPath?: string, vaultFiles?: VaultFileLike[]): string {
  let processed = stripFrontmatter(markdown);
  const flattenedVaultFiles = flattenVaultFiles(vaultFiles);

  processed = processed.replace(
    /!\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_match, noteName, heading, displayText) => {
      const src = String(noteName).trim();
      const { alt, width } = parseWikiImageDisplay(displayText);
      const label = alt || src;

      if (isImageEmbedPath(src)) {
        if (!vaultImageExists(src, flattenedVaultFiles)) {
          return `<div class="embed-missing">${escapeHtml(src)}</div>`;
        }

        const resolvedSrc = resolveVaultImageSrc(src);
        const style = width ? ` style="max-width: ${width}px; width: 100%;"` : "";
        return `<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}"${style}>`;
      }

      const labelText = displayText || src;
      return `<div class="embed-missing">${escapeHtml(labelText)}${heading ? ` / ${escapeHtml(heading)}` : ""}</div>`;
    },
  );

  processed = processed.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_match, noteName, heading, alias) => {
      const label = alias || (heading ? `${noteName} > ${heading}` : noteName);
      return `<a class="internal-link">${escapeHtml(label)}</a>`;
    },
  );

  processed = processed.replace(
    /^(\s*[-*+]\s+)\[([ xX])\]/gm,
    (_match, prefix, checked) =>
      `${prefix}<input type="checkbox" ${checked.toLowerCase() === "x" ? "checked" : ""} disabled>`,
  );

  processed = processed.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_match, alt, src, title) => {
      const resolvedSrc = toFileUri(vaultPath, String(src));
      return `![${alt}](${resolvedSrc}${title ? ` "${title}"` : ""})`;
    },
  );

  return processed;
}

export function getPdfDefaultPath(vaultPath: string | null | undefined, notePath: string): string {
  const pdfPath = notePath.replace(/\.[^.\\/]+$/, "") + ".pdf";
  if (!vaultPath) return pdfPath.split(/[\\/]/).pop() || "Untitled.pdf";
  const separator = vaultPath.includes("\\") ? "\\" : "/";
  return `${vaultPath.replace(/[\\/]+$/, "")}${separator}${pdfPath.replace(/[\\/]+/g, separator)}`;
}

export function buildMarkdownPdfHtml({
  markdown,
  title,
  notePath,
  vaultPath,
  vaultFiles,
}: {
  markdown: string;
  title: string;
  notePath: string;
  vaultPath?: string;
  vaultFiles?: VaultFileLike[];
}): string {
  const processed = preprocessMarkdown(markdown, vaultPath, vaultFiles);
  const rendered = marked.parse(processed, { gfm: true, breaks: true }) as string;
  const safeHtml = DOMPurify.sanitize(rendered, {
    ADD_TAGS: ["input", "math", "semantics", "mrow", "mi", "mo", "mn", "msup", "mspace", "msqrt", "mfrac", "annotation"],
    ADD_ATTR: ["checked", "disabled", "type", "style", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
    ADD_DATA_URI_TAGS: ["img"],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|file|data|mailto|vault):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });

  const safeTitle = escapeHtml(title || notePath.replace(/\.md$/i, ""));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>
    @page { size: Letter; margin: 0.7in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #242424;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Arial, sans-serif;
      font-size: 12.5pt;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    main { max-width: 7.2in; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 {
      color: #1f1f1f;
      line-height: 1.25;
      margin: 1.35em 0 0.45em;
      page-break-after: avoid;
    }
    h1 { font-size: 24pt; margin-top: 0; }
    h2 { font-size: 18pt; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.18in; }
    h3 { font-size: 15pt; }
    p { margin: 0.35em 0 0.85em; }
    a, .internal-link { color: #3b63c7; text-decoration: none; }
    ul, ol { margin: 0.35em 0 0.9em 1.35em; padding: 0; }
    li { margin: 0.22em 0; }
    blockquote {
      margin: 1em 0;
      padding: 0.05em 0 0.05em 1em;
      color: #555;
      border-left: 3px solid #d6d6d6;
    }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.9em;
      background: #f2f2f2;
      border-radius: 4px;
      padding: 0.12em 0.32em;
    }
    pre {
      margin: 1em 0;
      padding: 0.85em 1em;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      background: #f6f6f6;
      border: 1px solid #e4e4e4;
      border-radius: 6px;
      page-break-inside: avoid;
    }
    pre code { padding: 0; background: transparent; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #dddddd;
      padding: 0.45em 0.6em;
      vertical-align: top;
    }
    th { background: #f5f5f5; font-weight: 650; }
    img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
    hr { border: 0; border-top: 1px solid #dddddd; margin: 1.4em 0; }
    input[type="checkbox"] { margin-right: 0.4em; transform: translateY(1px); }
    .embed-missing {
      margin: 0.85em 0;
      padding: 0.7em 0.85em;
      color: #666;
      background: #f7f7f7;
      border: 1px solid #e3e3e3;
      border-radius: 6px;
    }
    .katex-display { overflow: hidden; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>${safeHtml}</main>
</body>
</html>`;
}
