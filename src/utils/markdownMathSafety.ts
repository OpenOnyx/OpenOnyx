/**
 * Keep arbitrary provider/document text out of KaTeX when it is wrapped in
 * dollar signs. KaTeX has no metrics for replacement characters (and some
 * otherwise valid Unicode symbols), so rendering such text as math produces
 * noisy warnings and invisible glyphs. Escaping only the delimiters preserves
 * the original characters as ordinary Markdown text.
 */
export function protectInvalidMath(markdown: string): string {
  return markdown.replace(/(\${1,2})(?!\$)([\s\S]*?)\1/g, (whole, delimiter: string, body: string) => {
    // KaTeX's metrics cover a deliberately small math alphabet.  Any
    // non-ASCII character in an untrusted document expression can otherwise
    // become a zero-width glyph; plain text is the lossless fallback.
    if (!/[^\x00-\x7F]/u.test(body)) return whole;
    const escaped = delimiter.replace(/\$/g, '\\$');
    return `${escaped}${body}${escaped}`;
  });
}
