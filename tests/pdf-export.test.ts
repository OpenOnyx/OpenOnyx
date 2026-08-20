// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildMarkdownPdfHtml } from '../src/utils/pdfExport';

describe('PDF export markdown preprocessing', () => {
  it('renders wiki image embeds as printable file images', () => {
    const html = buildMarkdownPdfHtml({
      markdown: [
        '![[attachments/demo.png]]',
        '![regular](regular.png)',
        '![[Missing Note]]',
      ].join('\n\n'),
      title: 'Image Export',
      notePath: 'Image Export.md',
      vaultPath: '/Users/example/My Vault',
    });

    expect(html).toContain('src="vault://local/attachments/demo.png"');
    expect(html).toContain('alt="attachments/demo.png"');
    expect(html).toContain('src="file:///Users/example/My%20Vault/regular.png"');
    expect(html).toContain('<div class="embed-missing">Missing Note</div>');
  });
});
