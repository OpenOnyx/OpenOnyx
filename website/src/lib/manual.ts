import { Marked } from 'marked';
import { DOC_PAGES } from '../data/docs';

export type ManualHeading = { id: string; text: string; level: number };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An isolated parser avoids inheriting the embedded editor's global marked extensions. */
export function renderManual(markdown: string) {
  const headings: ManualHeading[] = [];
  const ids = new Map<string, number>();
  const parser = new Marked({ gfm: true, breaks: true });
  parser.use({ renderer: {
    code(token) {
      const language = token.lang?.split(/\s/)[0];
      return `<pre><button type="button" class="manual-copy" aria-label="Copy code example">Copy</button><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(token.text)}\n</code></pre>`;
    },
    heading(token) {
      const text = token.text.replace(/[*`_]/g, '');
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
      const count = ids.get(base) ?? 0;
      ids.set(base, count + 1);
      // Prefix IDs so names such as "plugins" cannot collide with DOM properties
      // and be removed by the HTML sanitizer.
      const id = `manual-${base}${count ? `-${count}` : ''}`;
      if (token.depth <= 3) headings.push({ id, text, level: token.depth });
      return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
    },
    link(token) {
      let href = token.href;
      const [path, hash] = href.split('#');
      const target = DOC_PAGES.find(page => page.filename === decodeURIComponent(path));
      if (target) href = `/docs/${target.slug}${hash ? `#manual-${hash}` : ''}`;
      else if (!path && hash) href = `#manual-${hash}`;
      return `<a href="${escape(href)}"${token.title ? ` title="${escape(token.title)}"` : ''}>${this.parser.parseInline(token.tokens)}</a>`;
    },
    image(token) {
      return token.text ? `<span class="manual-image-placeholder">${escape(token.text)}</span>` : '';
    },
  } });
  return { html: parser.parse(markdown, { async: false }) as string, headings };
}
