import { createPageControls } from './PageControls';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
// Keep the API and worker on the compatibility build for Electron runtimes.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import '../../styles/pdfViewer.css';

export interface PdfViewerOptions {
  title: string;
  mode?: 'inline' | 'full';
  load: (refresh: boolean) => Promise<Uint8Array>;
}

const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL || './'}pdfjs/`;
const MAX_RENDER_PIXELS = 12000000;
const MAX_DEVICE_PIXEL_RATIO = 3;

/** Canvas-only PDF rendering. No PDF scripts, forms, annotations or remote iframe. */
export function createPdfViewer(options: PdfViewerOptions): HTMLElement {
  const full = options.mode === 'full';
  const host = document.createElement('section'); host.className = `pdf-viewer-preview pdf-viewer-${full ? 'document' : 'inline'}`;
  host.dataset.pdfMode = full ? 'full' : 'inline';
  host.tabIndex = 0;
  host.setAttribute('aria-label', `Document preview: ${options.title}`);
  const toolbar = document.createElement('div'); toolbar.className = 'pdf-viewer-toolbar';
  const navigation = createPageControls(() => { if (page > 1) { page--; void render(); } }, () => { if (pdf && page < pdf.numPages) { page++; void render(); } });
  const refresh = button('Refresh document'); refresh.textContent = 'Refresh document';
  const counter = document.createElement('span');
  const pager = navigation.element; toolbar.append(counter, refresh); toolbar.hidden = true;
  const status = document.createElement('p'); status.className = 'pdf-viewer-status'; status.setAttribute('role', 'status');
  const show = button('Retry document'); show.textContent = 'Retry'; show.className = 'pdf-viewer-retry'; show.hidden = true;
  const viewport = document.createElement('div'); viewport.className = 'pdf-viewer-viewport';
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Page of ${options.title}`); if (!full) viewport.append(canvas, pager); viewport.hidden = true; viewport.tabIndex = 0;
  host.append(toolbar, status, show, viewport);
  host.addEventListener('dblclick', event => event.stopPropagation());
  let pdf: PDFDocumentProxy | null = null, task: RenderTask | null = null;
  let loading: { destroy(): Promise<void> } | null = null;
  let pending: { destroy(): Promise<void> } | null = null;
  let page = 1, disposed = false, busy = false, renderId = 0;
  let mounted = false;
  const observer = new MutationObserver(() => {
    if (host.isConnected && !mounted) { mounted = true; size.observe(host); void load(false); }
    else if (mounted && !host.isConnected) dispose();
  });
  const size = new ResizeObserver(() => { if (pdf && !busy) { if (full) void layoutPages(); else void render(); } });
  type PageSlot = { element: HTMLElement; canvas: HTMLCanvasElement | null; task: RenderTask | null; visible: boolean };
  let slots: PageSlot[] = [], pagesObserver: IntersectionObserver | null = null;
  let layoutId = 0;
  const clearPages = () => { layoutId++; pagesObserver?.disconnect(); slots.forEach(slot => { slot.task?.cancel(); if (slot.canvas) { slot.canvas.width = 0; slot.canvas.height = 0; } }); slots = []; };
  const renderSlot = async (slot: PageSlot, index: number) => {
    if (!pdf || disposed || slot.canvas || !slot.visible) return;
    const document = pdf;
    const current = await document.getPage(index + 1);
    if (disposed || pdf !== document || !slot.visible || slot.canvas) return;
    const base = current.getViewport({ scale: 1 });
    const width = parseFloat(slot.element.style.width);
    const scale = Math.min(width / base.width * Math.min(devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO), Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height)));
    const view = current.getViewport({ scale });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
    canvas.setAttribute('aria-label', `${options.title}, page ${index + 1} of ${document.numPages}`);
    slot.canvas = canvas; slot.element.replaceChildren(canvas);
    slot.task = current.render({ canvas, viewport: view });
    try { await slot.task.promise; } catch (error) { if ((error as Error).name !== 'RenderingCancelledException' && !disposed) slot.element.setAttribute('aria-label', 'Could not render this page'); }
  };
  const layoutPages = async () => {
    if (!pdf || disposed) return;
    const width = Math.max(160, Math.min(viewport.clientWidth - 24 || 640, 1200));
    if (slots.length && Math.abs(parseFloat(slots[0].element.style.width) - width) < 1) return;
    const oldTop = viewport.scrollTop, oldHeight = viewport.scrollHeight;
    clearPages(); const revision = layoutId, document = pdf;
    viewport.replaceChildren();
    for (let index = 0; index < document.numPages; index++) {
      const current = await document.getPage(index + 1);
      if (disposed || revision !== layoutId) return;
      const base = current.getViewport({ scale: 1 });
      const element = window.document.createElement('div'); element.className = 'pdf-viewer-page';
      element.style.width = `${width}px`; element.style.height = `${width * base.height / base.width}px`;
      element.dataset.page = String(index + 1); viewport.append(element);
      slots.push({ element, canvas: null, task: null, visible: false });
    }
    viewport.scrollTop = oldHeight ? oldTop / oldHeight * viewport.scrollHeight : oldTop;
    pagesObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.page) - 1, slot = slots[index];
        if (!slot) continue; slot.visible = entry.isIntersecting;
        if (slot.visible) void renderSlot(slot, index).catch(() => { slot.element.setAttribute('aria-label', 'Preview unavailable'); });
        else { slot.task?.cancel(); slot.task = null; if (slot.canvas) { slot.canvas.width = 0; slot.canvas.height = 0; slot.canvas.remove(); slot.canvas = null; } }
      }
    }, { root: viewport, rootMargin: '600px 0px' });
    slots.forEach((slot, index) => { if (pagesObserver) pagesObserver.observe(slot.element); else if (index < 3) { slot.visible = true; void renderSlot(slot, index); } });
  };
  viewport.addEventListener('scroll', () => {
    if (!full || !pdf) return;
    const top = viewport.getBoundingClientRect().top;
    const current = slots.findIndex(slot => slot.element.getBoundingClientRect().bottom > top + 20);
    page = Math.max(1, current + 1); counter.textContent = `${page} / ${pdf.numPages}`;
  });
  host.addEventListener('pointerdown', event => { if (full && !(event.target as HTMLElement).closest('button')) viewport.focus({ preventScroll: true }); });
  host.addEventListener('keydown', event => {
    if (full && ['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home' || event.key === 'End') viewport.scrollTop = event.key === 'Home' ? 0 : viewport.scrollHeight;
      else viewport.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * viewport.clientHeight * .9 });
    }
    if (!full && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && pdf) { event.preventDefault(); page = Math.max(1, Math.min(pdf.numPages, page + (event.key === 'ArrowRight' ? 1 : -1))); void render(); }
  });
  const dispose = () => {
    disposed = true; clearPages(); renderId++; observer.disconnect(); size.disconnect(); task?.cancel();
    void loading?.destroy().catch(() => {}); void pending?.destroy().catch(() => {}); loading = null; pending = null; pdf = null;
  };
  const controls = (disabled: boolean) => { navigation.update(page, pdf?.numPages || 1, disabled); refresh.disabled = disabled; show.disabled = disabled; };
  const render = async () => {
    if (!pdf || disposed) return;
    const attempt = ++renderId; const previousTask = task; previousTask?.cancel(); controls(true);
    try {
      await previousTask?.promise.catch(() => {});
      if (disposed || attempt !== renderId) return;
      const current = await pdf.getPage(page);
      if (disposed || attempt !== renderId) return;
      const base = current.getViewport({ scale: 1 });
      const cssWidth = Math.max(160, Math.min(viewport.clientWidth || (host.clientWidth ? host.clientWidth - 18 : 640), 1200));
      const cssScale = Math.min(cssWidth / base.width, 380 / base.height);
      const pixelRatio = Math.max(1, Math.min(devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
      const maxPixelScale = Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height));
      const renderScale = Math.min(cssScale * pixelRatio, maxPixelScale);
      const view = current.getViewport({ scale: renderScale });
      canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
      canvas.style.width = `${Math.round(base.width * cssScale)}px`;
      canvas.style.height = `${Math.round(base.height * cssScale)}px`;
      canvas.setAttribute('aria-label', `${options.title}, page ${page} of ${pdf.numPages}`);
      task = current.render({ canvas, viewport: view }); await task.promise;
      if (disposed || attempt !== renderId) return;
      navigation.update(page, pdf.numPages); status.textContent = ''; viewport.hidden = false; toolbar.hidden = false;
    } catch (error) { if (!disposed && attempt === renderId && (error as Error).name !== 'RenderingCancelledException') status.textContent = 'Could not render this page. Try another page or reopen the document.'; }
    finally { if (!disposed && attempt === renderId) controls(false); }
  };
  const load = async (refreshDocument: boolean) => {
    if (busy || disposed) return;
    busy = true; renderId++; task?.cancel(); controls(true); show.hidden = true; status.textContent = 'Loading document…';
    try {
      const bytes = await options.load(refreshDocument);
      if (disposed) return;
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (disposed) return;
      GlobalWorkerOptions.workerSrc = workerUrl;
      const candidate = getDocument({
        data: new Uint8Array(bytes),
        cMapPacked: true,
        cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
        standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
        // Let PDF.js install the embedded fonts in the document.  The path
        // renderer is a useful fallback for very old PDFs, but it drops or
        // spaces glyphs from subsetted TrueType fonts (especially documents
        // exported by LibreOffice).  Font faces are created locally by
        // PDF.js; no document HTML or script is executed.
        disableFontFace: false,
        useSystemFonts: true,
      });
      pending = candidate;
      const document = await candidate.promise;
      if (disposed) { await candidate.destroy(); return; }
      task?.cancel(); await loading?.destroy();
      loading = candidate; pending = null; pdf = document;
      page = 1;
      if (full) { clearPages(); viewport.hidden = false; toolbar.hidden = false; status.textContent = ''; counter.textContent = `1 / ${pdf.numPages}`; await layoutPages(); }
      else await render();
    } catch {
      void pending?.destroy().catch(() => {}); pending = null;
      if (!disposed) { status.textContent = pdf ? "Couldn't refresh · showing the saved document." : "Couldn't load the document. Try again or open the original."; show.hidden = !!pdf; }
    } finally { busy = false; if (!disposed) controls(false); }
  };
  show.onclick = () => void load(true); refresh.onclick = () => void load(true);
  host.addEventListener('pdf-viewer:dispose', dispose);
  observer.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(() => { if (host.isConnected && !mounted) { mounted = true; size.observe(host); void load(false); } });
  return host;
}
function button(label: string): HTMLButtonElement { const value = document.createElement('button'); value.type = 'button'; value.setAttribute('aria-label', label); return value; }
