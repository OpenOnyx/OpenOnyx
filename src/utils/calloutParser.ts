import { marked } from "marked";

/**
 * Transforms Obsidian / GitHub-style callouts into docs-note HTML blocks.
 *
 * Supports:
 * - > [!NOTE], > [!WARNING], > [!CAUTION], > [!TIP], etc.
 * - Optional leading whitespace: ` > [!NOTE]`, `   > [!NOTE]`
 * - Optional trailing whitespace on header line
 * - Optional fold indicators: `[!NOTE]+` or `[!NOTE]-`
 * - Optional custom title: `> [!NOTE] Custom Title`
 * - Clean multi-line quotes and indented quotes: `    > Content`
 * - Case-insensitive callout types: `[!warning]`, `[!Warning]`, `[!WARNING]`
 */
export function parseMarkdownCallouts(md: string): string {
  const lines = md.split(/\r?\n/);
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const headerMatch = line.match(/^[ \t]*>+[ \t]*\[!(\w+)\]([+-]?)(?:[ \t]+(.*?))?[ \t]*$/i);

    if (headerMatch) {
      const calloutType = headerMatch[1].toLowerCase();
      const foldChar = headerMatch[2];
      const customTitle = headerMatch[3]?.trim();
      const displayTitle = customTitle || calloutType.toUpperCase();
      const isFoldable = foldChar === "+" || foldChar === "-";
      const isCollapsed = foldChar === "-";
      const isCaution = calloutType === "caution" || calloutType === "warning";

      const bodyLines: string[] = [];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        const quoteLineMatch = nextLine.match(/^[ \t]*>+[ \t]?(.*)$/);
        if (quoteLineMatch) {
          if (/^[ \t]*>+[ \t]*\[!\w+\]/i.test(nextLine)) {
            break;
          }
          bodyLines.push(quoteLineMatch[1]);
          i++;
        } else {
          break;
        }
      }

      const bodyMarkdown = bodyLines.join("\n").trim();
      let bodyHtml = "";
      if (bodyMarkdown) {
        try {
          bodyHtml = marked.parse(bodyMarkdown, { async: false, breaks: true }) as string;
        } catch {
          bodyHtml = `<p>${bodyMarkdown}</p>`;
        }
      }

      const foldSvg = '<span class="callout-fold" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>';
      const foldHtml = isFoldable ? foldSvg : "";
      const calloutHtml = `<div class="docs-note ${isCaution ? "is-caution" : ""} callout callout-${calloutType}" data-callout="${calloutType}" data-foldable="${isFoldable}" data-collapsed="${isCollapsed}">\n` +
        `  <strong class="callout-title"><span class="callout-title-text">${displayTitle}</span>${foldHtml}</strong>\n` +
        `  <div class="callout-content">\n${bodyHtml}  </div>\n` +
        `</div>`;

      result.push(calloutHtml);
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}
