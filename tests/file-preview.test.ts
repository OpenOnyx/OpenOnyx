// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, afterEach, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { createFilePreview } from '../src/components/documents/FilePreview';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function preview(title: string, mimeType: string, bytes: Uint8Array): Promise<HTMLElement> {
  const element = createFilePreview({ title, mimeType, load: async () => ({ bytes, mimeType }) });
  document.body.append(element);
  await waitForRender(element);
  return element;
}

async function waitForRender(element: HTMLElement): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let attempt = 0; attempt < 100 && element.querySelector('.file-preview-status')?.textContent === 'Loading preview...'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('renders a real DOCX fixture as sanitized read-only document content', async () => {
  const bytes = new Uint8Array(readFileSync('node_modules/mammoth/test/test-data/tables.docx'));
  const element = await preview('table.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes);
  const document = element.querySelector('.file-preview-document')!.shadowRoot!;
  expect(document.querySelector('section.document-page table')).not.toBeNull();
  expect(document.querySelector('.resource-page-controls')?.hasAttribute('hidden')).toBe(true);
  expect(document.querySelector('script, iframe, object')).toBeNull();
  expect(element.querySelector('script, iframe, object')).toBeNull();
});

async function presentationBytes(autofit = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>');
  for (let index = 1; index <= 2; index++) zip.file(`ppt/slides/slide${index}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6000000" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr>${autofit ? '<a:normAutofit/>' : ''}</a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>Slide ${index}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  return bytes;
}

it('renders positioned presentation shapes and navigates without extracting a text feed', async () => {
  const bytes = await presentationBytes();
  const element = await preview('pitch.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes);
  const content = element.querySelector('.file-preview-presentation')!.shadowRoot!;
  expect(content.textContent).toContain('Slide 1');
  expect(content.querySelector('.presentation-stage > div')?.getAttribute('style')).toContain('rgb(18, 52, 86)');
  content.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(content.textContent).toContain('Slide 2');
  expect(content.querySelector('.resource-page-controls')?.textContent).toContain('2 / 2');
});

it('lets presentation tables grow beyond source row minima instead of clipping wrapped text', async () => {
  const zip = await JSZip.loadAsync(await presentationBytes());
  const source = await zip.file('ppt/slides/slide1.xml')!.async('text');
  const cell = '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"/><a:t>Long table heading that wraps across multiple lines</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>';
  zip.file('ppt/slides/slide1.xml', source.replace('</p:spTree>', `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="2000000"/><a:ext cx="3000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1000000"/></a:tblGrid><a:tr h="200025">${cell}</a:tr><a:tr h="200025">${cell}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree>`));
  const { renderPresentation } = await import('../src/components/documents/PresentationRenderer');
  const result = await renderPresentation(await zip.generateAsync({ type: 'uint8array' }));
  try {
    const table = result.element.shadowRoot!.querySelector('table')!;
    expect(table.textContent).toContain('Long table heading');
    expect(table.style.height).toBe('auto');
    expect(parseFloat(table.style.minHeight)).toBeCloseTo(42);
    expect(table.parentElement!.style.height).toBe('auto');
    expect(table.parentElement!.style.overflow).toBe('visible');
    expect(parseFloat(table.querySelector('tr')!.style.height)).toBeCloseTo(21);
  } finally { result.destroy(); }
});

it('keeps embedded presentation image URLs after sanitizing and releases them on disposal', async () => {
  const createUrl = vi.fn(() => 'blob:http://localhost/embedded-image');
  const revokeUrl = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
  const zip = await JSZip.loadAsync(await presentationBytes());
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('text');
  zip.file('ppt/slides/slide1.xml', slide.replace('</p:spTree>', '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>'));
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image.png"/></Relationships>');
  zip.file('ppt/media/image.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4gAAAABJRU5ErkJggg==', { base64: true });
  const { renderPresentation } = await import('../src/components/documents/PresentationRenderer');
  try {
    const result = await renderPresentation(await zip.generateAsync({ type: 'uint8array' }));
    document.body.append(result.element);
    expect(createUrl).toHaveBeenCalled();
    expect(result.element.shadowRoot!.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/embedded-image');
    result.element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(revokeUrl).not.toHaveBeenCalled();
    result.destroy();
    expect(revokeUrl).toHaveBeenCalledWith('blob:http://localhost/embedded-image');
  } finally { vi.unstubAllGlobals(); }
});

it('retains DOCX scrolling focus when its parent resource card also handles clicks', async () => {
  const note = document.createElement('div'); note.style.overflowY = 'auto';
  Object.defineProperties(note, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
  note.scrollBy = vi.fn();
  const card = document.createElement('div'); card.tabIndex = 0;
  card.addEventListener('click', () => card.focus());
  note.append(card); document.body.append(note);
  const bytes = new Uint8Array(readFileSync('node_modules/mammoth/test/test-data/tables.docx'));
  const element = createFilePreview({ title: 'table.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', load: async () => ({ bytes, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) });
  card.append(element); await waitForRender(element);
  const viewport = element.querySelector<HTMLElement>('.file-preview-host')!;
  const page = element.querySelector('.file-preview-document')!.shadowRoot!.querySelector('section.document-page')!;
  page.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  expect(document.activeElement).toBe(viewport);
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  viewport.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(note.scrollBy).not.toHaveBeenCalled();
});

it('renders worksheet values without exposing formulas and switches sheets', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Category', 'October'], ['Hosting', 42]]), 'Q4');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Notes'], ['Second sheet']]), 'Notes');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const element = await preview('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  expect(element.querySelector('.file-preview-sheet-scroll')?.textContent).toContain('Hosting');
  element.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(element.querySelector('.file-preview-sheet-scroll')?.textContent).toContain('Second sheet');
});

it('renders text and sanitized Markdown, with a useful external fallback for unknown files', async () => {
  const text = await preview('readme.txt', 'text/plain', new TextEncoder().encode('<script>safe as text</script>'));
  expect(text.querySelector('.file-preview-text')?.textContent).toContain('<script>');
  const markdown = await preview('readme.md', 'text/markdown', new TextEncoder().encode('[unsafe](javascript:alert(1))\n\n**Readable**'));
  expect(markdown.querySelector('script')).toBeNull();
  expect(markdown.querySelector('a')?.getAttribute('href') || '').not.toContain('javascript:');
  expect(markdown.querySelector('strong')?.textContent).toBe('Readable');
  const fallback = await preview('drawing.drawio', 'application/octet-stream', new Uint8Array());
  expect(fallback.querySelector('.file-preview-fallback')?.textContent).toContain('Preview unavailable');
});

it('forces the provider refresh path when the preview Refresh control is used', async () => {
  const refreshValues: boolean[] = [];
  const element = createFilePreview({
    title: 'readme.txt',
    mimeType: 'text/plain',
    load: async (refresh) => {
      refreshValues.push(refresh);
      return { bytes: new TextEncoder().encode('fresh'), mimeType: 'text/plain' };
    },
  });
  document.body.append(element);
  await waitForRender(element);
  element.dispatchEvent(new Event('file-preview:refresh'));
  await waitForRender(element);
  expect(refreshValues).toEqual([false, true]);
});

it('keeps the loaded document when collapsed and preserves it if refresh fails', async () => {
  const load = vi.fn(async (refresh: boolean) => {
    if (refresh) throw new Error('offline');
    return { bytes: new TextEncoder().encode('Saved document'), mimeType: 'text/plain' };
  });
  const element = createFilePreview({ title: 'saved.txt', mimeType: 'text/plain', load });
  document.body.append(element);
  await waitForRender(element);
  const content = element.querySelector('.file-preview-text');
  expect(element.querySelector('.file-preview-controls')).toBeNull();
  element.dispatchEvent(new Event('file-preview:collapse'));
  expect(element.classList.contains('file-preview-collapsed')).toBe(true);
  element.dispatchEvent(new Event('file-preview:show'));
  expect(element.querySelector('.file-preview-text')).toBe(content);
  expect(load).toHaveBeenCalledTimes(1);
  element.dispatchEvent(new Event('file-preview:refresh'));
  await waitForRender(element);
  expect(element.querySelector('.file-preview-text')).toBe(content);
  expect(content?.textContent).toBe('Saved document');
  expect(element.querySelector('[role="status"]')?.textContent).toContain('showing the cached document');
  expect(element.querySelector<HTMLButtonElement>('[aria-label="Retry"]')?.hidden).toBe(false);
});


it('respects explicit DOCX page breaks without manufacturing page counts', async () => {
  const zip = await JSZip.loadAsync(readFileSync('node_modules/mammoth/test/test-data/tables.docx'));
  const source = await zip.file('word/document.xml')!.async('text');
  zip.file('word/document.xml', source.replace('<w:sectPr', '<w:p><w:r><w:br w:type="page"/><w:t>Second page</w:t></w:r></w:p><w:sectPr'));
  const element = await preview('pages.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await zip.generateAsync({ type: 'uint8array' }));
  const root = element.querySelector('.file-preview-document')!.shadowRoot!;
  const pages = root.querySelectorAll<HTMLElement>('section.document-page');
  expect(pages).toHaveLength(2);
  root.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
  expect(pages[0].hidden).toBe(true); expect(pages[1].hidden).toBe(false);
  expect(root.querySelector('.resource-page-controls')?.textContent).toContain('2 / 2');
});

it('renders spreadsheet coordinates, merged cells, number formatting and bottom worksheet tabs', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Project Budget', null], ['Hosting', 1200]]);
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  sheet.B2.z = '"₹"#,##0';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Summary');
  const element = await preview('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  expect(element.querySelector('thead')?.textContent).toBe('AB');
  expect(element.querySelector('td[colspan="2"]')?.textContent).toBe('Project Budget');
  expect(element.querySelector('table')?.textContent).toContain('₹1,200');
  expect(element.querySelector('[role="tab"]')?.textContent).toBe('Summary');
  expect(element.querySelector('script, iframe')).toBeNull();
});

it('routes an unfocused inline document wheel to the note and allows explicit document focus', async () => {
  const note = document.createElement('div'); note.style.overflowY = 'auto';
  Object.defineProperties(note, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
  const scroll = vi.fn(); note.scrollBy = scroll;
  document.body.append(note);
  const element = createFilePreview({ title: 'read.txt', mimeType: 'text/plain', load: async () => ({ bytes: new TextEncoder().encode('Saved'), mimeType: 'text/plain' }) });
  note.append(element); await waitForRender(element);
  const viewport = element.querySelector<HTMLElement>('.file-preview-host')!;
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  viewport.dispatchEvent(wheel);
  expect(scroll).toHaveBeenCalledWith({ top: 100 }); expect(wheel.defaultPrevented).toBe(true);
  viewport.focus(); scroll.mockClear();
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  expect(scroll).not.toHaveBeenCalled();
});


it('preserves slide state across inline/expanded renderers and supports quick jumps', async () => {
  const { renderPresentation } = await import('../src/components/documents/PresentationRenderer');
  const state = {};
  const bytes = await presentationBytes();
  const inline = await renderPresentation(bytes, state); document.body.append(inline.element);
  inline.element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const expanded = await renderPresentation(bytes, state); document.body.append(expanded.element);
  const root = expanded.element.shadowRoot!;
  const jump = root.querySelector<HTMLSelectElement>('[aria-label="Go to slide"]')!;
  expect(jump.value).toBe('1');
  jump.value = '0'; jump.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(inline.element.shadowRoot!.querySelector<HTMLSelectElement>('select')!.value).toBe('0');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(jump.value).toBe('0');
  expanded.element.focus(); expanded.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30)); expect(jump.value).toBe('1');
  const stage = root.querySelector<HTMLElement>('.presentation-stage')!;
  expect(parseFloat(stage.style.width) / parseFloat(stage.style.height)).toBeCloseTo(16 / 9);
  expanded.destroy(); expect(inline.element.shadowRoot!.querySelector<HTMLSelectElement>('select')!.value).toBe('1'); inline.destroy();
});

it('selects read-only cells, exposes cached formula values safely and searches the current sheet', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Cost', 42], ['Total', 42], ['<script>untrusted</script>', 'long value']]);
  sheet.B2.f = 'SUM(B1:B1)';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Budget');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Archive']]), 'Archive');
  const element = await preview('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  const cell = element.querySelector<HTMLTableCellElement>('[data-address="B2"]')!; cell.click();
  expect(cell.classList.contains('file-preview-cell-selected')).toBe(true);
  expect(element.querySelector('.file-preview-cell-details')?.textContent).toContain('Full value: 42');
  expect(element.querySelector('.file-preview-cell-details')?.textContent).toContain('Formula: =SUM(B1:B1)');
  expect(element.querySelector('script, [contenteditable]')).toBeNull();
  const input = element.querySelector<HTMLInputElement>('[aria-label="Search current sheet"]')!;
  input.value = '42'; input.dispatchEvent(new Event('input'));
  expect(element.querySelector('.file-preview-sheet-search')?.textContent).toContain('2 matches');
  element.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!.click();
  expect(element.querySelector('.file-preview-cell-details')?.textContent).toContain('B1');
  const table = element.querySelector('table');
  element.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(element.querySelector('table')?.textContent).toContain('Archive');
  element.querySelector<HTMLButtonElement>('[role="tab"]:first-child')!.click();
  await new Promise(resolve => setTimeout(resolve, 30)); expect(element.querySelector('table')).toBe(table);
});

it('restores selected sheet, cell and scroll position within the session without changing workbook data', async () => {
  const { renderSpreadsheet } = await import('../src/components/documents/SpreadsheetRenderer');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['First']]), 'One');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second', 'Value']]), 'Two');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const state = {};
  const inline = await renderSpreadsheet(bytes, state); document.body.append(inline.element);
  inline.element.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  inline.element.querySelector<HTMLTableCellElement>('[data-address="B1"]')!.click();
  const scroller = inline.element.querySelector<HTMLElement>('.file-preview-sheet-scroll')!;
  scroller.scrollTop = 70; scroller.scrollLeft = 50; scroller.dispatchEvent(new Event('scroll'));
  inline.destroy();
  const restored = await renderSpreadsheet(bytes, state); document.body.append(restored.element);
  expect(restored.element.querySelector('[aria-selected="true"]')?.textContent).toBe('Two');
  expect(restored.element.querySelector('.file-preview-cell-selected')?.getAttribute('data-address')).toBe('B1');
  expect(restored.element.querySelector<HTMLElement>('.file-preview-sheet-scroll')?.scrollLeft).toBe(50);
  expect(restored.element.querySelector('.file-preview-cell-details')?.textContent).toContain('Value');
  restored.destroy();
});


it('keeps text shapes connected through deferred text-fit callbacks before consumer mounting', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 5));
  const { renderPresentation } = await import('../src/components/documents/PresentationRenderer');
  const result = await renderPresentation(await presentationBytes(true));
  // Simulate a slow resource shell / font-ready layout while the result has not
  // yet been inserted by its consumer. The renderer's text must stay in-slide.
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(result.element.shadowRoot!.querySelector('.presentation-stage')?.textContent).toContain('Slide 1');
  expect(result.element.isConnected).toBe(true);
  const staging = result.element.parentElement!;
  document.body.append(result.element);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(staging.isConnected).toBe(false);
  expect(result.element.shadowRoot!.querySelector('.presentation-stage')?.textContent).toContain('Slide 1');
  result.destroy();
});
