// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOC_IMAGES, DOC_PAGES, neighbors } from '../website/src/data/docs';
import { renderManual } from '../website/src/lib/manual';

describe('OpenOnyx website manual', () => {
  it('includes the shared app theme sources in the website stylesheet build', () => {
    const styles = readFileSync(resolve('website/src/styles/app-embed.css'), 'utf8');
    expect(styles).toContain('@source "../../../src/styles/documentTailwindClasses.ts"');
    expect(styles).toContain('@source "../../../src/styles/themeClasses.ts"');
    const docs = readFileSync(resolve('website/src/styles/docs.css'), 'utf8');
    expect(docs).toContain('--docs-shell-bg: var(--bg-primary)');
    expect(docs).toContain('--docs-shell-ink: var(--text-primary)');
  });
  it('publishes every Markdown file without a second copy of the content', () => {
    const files = readdirSync(resolve('docs/manual')).filter(file => file.endsWith('.md'));
    expect(DOC_PAGES.map(page => page.filename).sort()).toEqual(files.sort());
    for (const page of DOC_PAGES) {
      expect(page.markdown).toBe(readFileSync(resolve('docs/manual', page.filename), 'utf8'));
      expect(page.sourceUrl).toBeTruthy();
    }
  });

  it.each(DOC_PAGES)('renders $filename with working navigation and real image assets', page => {
    const { html, headings } = renderManual(page.markdown);
    expect(headings.filter(heading => heading.level === 1)).toHaveLength(1);
    expect(new Set(headings.map(heading => heading.id)).size).toBe(headings.length);
    const article = document.createElement('article');
    article.innerHTML = DOMPurify.sanitize(html);
    for (const heading of headings) expect(article.querySelector(`[id="${heading.id}"]`)).not.toBeNull();
    for (const pre of article.querySelectorAll('pre')) expect(pre.querySelector('button.manual-copy')).not.toBeNull();
    expect(html).not.toMatch(/href="[^"]*\.md(?:#|\")/);
    expect(html).not.toContain('src="../images/');
    for (const [, slug] of html.matchAll(/href="\/docs\/([^"#]+)/g)) {
      expect(DOC_PAGES.some(target => target.slug === slug)).toBe(true);
    }
    for (const [, image] of html.matchAll(/src="([^"]+)"/g)) {
      expect(Object.values(DOC_IMAGES)).toContain(image);
    }
  });

  it('preserves Markdown examples and repeated heading anchors', () => {
    const result = renderManual('# Title\n\n## Example\n\n## Example\n\n```md\n# Not a heading\n```');
    expect(result.headings.map(heading => heading.id)).toEqual(['manual-title', 'manual-example', 'manual-example-1']);
    expect(result.html).toContain('<code class="language-md"># Not a heading');
  });

  it('connects adjacent pages without looping at the ends', () => {
    expect(neighbors(DOC_PAGES[0].slug).prev).toBeNull();
    expect(neighbors(DOC_PAGES.at(-1)!.slug).next).toBeNull();
    expect(neighbors('graph').next?.slug).toBe('canvas');
  });
});
