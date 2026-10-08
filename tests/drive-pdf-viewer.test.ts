// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PdfDocumentView } from '../src/components/documents/PdfDocumentView';
import type { DriveResource } from '../src/types/appResources';
const mocks = vi.hoisted(() => ({ binary: vi.fn(), cached: vi.fn(), download: vi.fn(), document: vi.fn(), render: vi.fn(), destroy: vi.fn(), worker: { workerSrc: '' } }));
vi.mock('../src/utils/api', () => ({ getAPI: () => ({ readBinary: mocks.binary, googleDrive: { cachedPdf: mocks.cached, previewPdf: mocks.download } }) }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mocks.document, GlobalWorkerOptions: mocks.worker }));
import { createDrivePdfPreview } from '../src/components/apps/DrivePdfPreview';
import { createFilePreview } from '../src/components/documents/FilePreview';
const resource: DriveResource = { version: 1, appId: 'google-drive', serverId: 'drive-' + 'a'.repeat(24), resourceType: 'pdf', externalId: 'pdf_file', mimeType: 'application/pdf', title: 'Research.pdf', url: 'https://drive.google.com/file/d/pdf_file/view', cachedAt: '2026-10-02T08:00:00Z' };
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
function setup(cached: boolean) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.cached.mockResolvedValue(cached ? new Uint8Array([1, 2, 3]) : null);
  mocks.download.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
  mocks.document.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: vi.fn(async () => ({ getViewport: () => ({ width: 600, height: 800 }), render: mocks.render })) }), destroy: mocks.destroy.mockResolvedValue(undefined) });
  const view = createDrivePdfPreview(resource); document.body.append(view); return view;
}
afterEach(async () => { document.body.replaceChildren(); await flush(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('renders saved PDF pages without a remote call, supports page navigation and destroys the worker on removal', async () => {
  const view = setup(true); await flush();
  expect(view.textContent).toContain('1 / 2'); expect(view.querySelector('canvas')).not.toBeNull();
  expect(view.querySelector('iframe, script, embed')).toBeNull(); expect(mocks.download).not.toHaveBeenCalled();
  view.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click(); await flush();
  expect(view.textContent).toContain('2 / 2');
  view.remove(); await flush(); expect(mocks.destroy).toHaveBeenCalled();
});
it('automatically downloads and displays an uncached PDF', async () => {
  const view = setup(false); await flush();
  expect(mocks.download).toHaveBeenCalledWith(resource.serverId, resource.externalId);
  expect(view.textContent).toContain('1 / 2');
});

it('starts a PDF created asynchronously by the file shell after it is mounted', async () => {
  const prior = setup(true); await flush(); prior.remove(); await flush(); mocks.document.mockClear();
  const shell = createFilePreview({ title: 'Research.pdf', mimeType: 'application/pdf', load: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' }) });
  document.body.append(shell); await flush(); await flush();
  expect(mocks.document).toHaveBeenCalledOnce();
  expect(shell.querySelector<HTMLElement>('.pdf-viewer-viewport')!.hidden).toBe(false);
  expect(shell.textContent).toContain('1 / 2');
  expect(shell.querySelector('.file-preview-controls')).toBeNull();
});
it('retains the displayed document when refresh fails', async () => {
  const view = setup(true); await flush(); mocks.download.mockRejectedValue(new Error('access_token=private'));
  view.querySelector<HTMLButtonElement>('[aria-label="Refresh document"]')!.click(); await flush();
  expect(view.textContent).toContain('showing the saved document');
  expect(view.textContent).not.toContain('private'); expect(view.querySelector<HTMLElement>('.pdf-viewer-viewport')!.hidden).toBe(false);
});

it('opens local vault PDFs through the same reader without a Drive request', async () => {
  const drive = setup(true); await flush(); drive.remove(); await flush();
  mocks.cached.mockClear(); mocks.download.mockClear();
  mocks.binary.mockResolvedValue(new Uint8Array([1, 2, 3]));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  root.render(React.createElement(PdfDocumentView, { path: 'attachments/Research.PDF', title: 'Research.PDF' }));
  await flush(); await flush();
  expect(mocks.binary).toHaveBeenCalledWith('attachments/Research.PDF');
  expect(host.textContent).toContain('1 / 2');
  expect(host.querySelector('canvas')).not.toBeNull();
  expect(host.querySelector('[data-pdf-mode="full"]')).not.toBeNull();
  expect(host.querySelectorAll('.pdf-viewer-page')).toHaveLength(2);
  expect(host.querySelector('.pdf-document-host')).not.toBeNull();
  expect(mocks.cached).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  root.unmount(); await flush();
});

it('uses PDF.js font assets and embedded font rendering for glyph fidelity', async () => {
  setup(true); await flush();
  expect(mocks.document).toHaveBeenCalledWith(expect.objectContaining({
    cMapPacked: true,
    cMapUrl: expect.stringContaining('pdfjs/cmaps/'),
    standardFontDataUrl: expect.stringContaining('pdfjs/standard_fonts/'),
    disableFontFace: false,
    useSystemFonts: true,
  }));
});

it('fits a complete inline page proportionally and lets the wheel bubble to the note', async () => {
  const view = setup(true); await flush();
  expect(view.dataset.pdfMode).toBe('inline');
  const canvas = view.querySelector('canvas')!;
  expect(parseFloat(canvas.style.height)).toBeLessThanOrEqual(380);
  expect(parseFloat(canvas.style.width) / parseFloat(canvas.style.height)).toBeCloseTo(600 / 800, 2);
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
  view.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});

it('expanded PDFs use continuous page placeholders and do not redirect wheel events', async () => {
  const prior = setup(true); await flush(); prior.remove(); await flush();
  const dialog = document.createElement('div'); dialog.className = 'drive-document-dialog';
  const shell = createFilePreview({ title: 'Research.pdf', mimeType: 'application/pdf', load: async () => ({ bytes: new Uint8Array([1]), mimeType: 'application/pdf' }) });
  dialog.append(shell); document.body.append(dialog); await flush(); await flush();
  expect(shell.querySelector('[data-pdf-mode="full"]')).not.toBeNull();
  expect(shell.querySelectorAll('.pdf-viewer-page')).toHaveLength(2);
  expect(shell.querySelector('.resource-page-controls')).toBeNull();
  const viewport = shell.querySelector<HTMLElement>('.pdf-viewer-viewport')!;
  viewport.scrollTop = 350;
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
  viewport.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  expect(viewport.scrollTop).toBe(350);
});

it('only rasterizes nearby full-view pages and releases distant canvases', async () => {
  const prior = setup(true); await flush(); prior.remove(); await flush(); mocks.render.mockClear();
  let notify: IntersectionObserverCallback = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {} disconnect() {}
  });
  const { createPdfViewer } = await import('../src/components/documents/PdfViewer');
  const view = createPdfViewer({ title: 'Research.pdf', mode: 'full', load: async () => new Uint8Array([1]) });
  document.body.append(view); await flush();
  const pages = view.querySelectorAll('.pdf-viewer-page');
  expect(pages).toHaveLength(2); expect(mocks.render).not.toHaveBeenCalled();
  notify([{ target: pages[1], isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await flush(); expect(pages[1].querySelector('canvas')).not.toBeNull();
  notify([{ target: pages[1], isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(pages[1].querySelector('canvas')).toBeNull();
  expect(pages[1].getAttribute('style')).toContain('height:');
});
