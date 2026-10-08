import type { ResourceViewState } from './ResourceViewState';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createPageControls } from './PageControls';
import { renderPresentation } from './PresentationRenderer';
import { renderSpreadsheet } from './SpreadsheetRenderer';
import '../../styles/filePreview.css';
import { createPdfViewer } from './PdfViewer';

export interface FilePreviewPayload {
  bytes: Uint8Array;
  mimeType: string;
  cachedAt?: string;
}

export interface FilePreviewOptions {
  title: string;
  mimeType: string;
  viewState?: ResourceViewState;
  pdfMode?: 'inline' | 'full';
  size?: number;
  providerLabel?: string;
  cachedText?: string;
  load: (refresh: boolean) => Promise<FilePreviewPayload>;
  openExternal?: () => void;
}

type PreviewKind = 'pdf' | 'document' | 'presentation' | 'spreadsheet' | 'markdown' | 'text' | 'image' | 'fallback';
type RenderContext = FilePreviewOptions & FilePreviewPayload;
type RenderResult = { element: HTMLElement; destroy?: () => void };
type FileRenderer = {
  kind: PreviewKind;
  render(context: RenderContext): Promise<RenderResult> | RenderResult;
};

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PRESENTATION_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

export function createFilePreview(options: FilePreviewOptions): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'file-preview';
  shell.setAttribute('aria-label', `File preview: ${options.title}`);

  const status = document.createElement('p');
  status.className = 'file-preview-status';
  status.setAttribute('role', 'status');

  const viewport = document.createElement('div');
  viewport.className = 'file-preview-host';
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', 'Document preview; focus to scroll inside');
  viewport.addEventListener('click', event => {
    if (viewport.querySelector('.file-preview-document')) {
      event.stopPropagation(); viewport.focus({ preventScroll: true });
    }
  });
  viewport.addEventListener('pointerdown', () => viewport.focus({ preventScroll: true }));
  viewport.addEventListener('wheel', event => {
    if (viewport.querySelector('.pdf-viewer-inline')) return;
    if (shell.closest('.drive-document-dialog') || viewport.matches(':focus-within') || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    let parent = shell.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
        event.preventDefault(); parent.scrollBy({ top: event.deltaY }); return;
      }
      parent = parent.parentElement;
    }
  }, { passive: false });
  const savedText = () => {
    if (!options.cachedText) return;
    const text = document.createElement('article'); text.className = 'file-preview-cached-text';
    text.textContent = options.cachedText; viewport.replaceChildren(text);
  };
  if (typeof navigator !== 'undefined' && !navigator.onLine) savedText();

  // Commands are supplied by the resource header/menu, not a permanent mode bar.
  shell.append(status, viewport);
  const retry = button('Retry'); retry.hidden = true; shell.append(retry);
  shell.addEventListener('file-preview:collapse', () => setMode('collapsed'));
  shell.addEventListener('file-preview:show', () => setMode('preview'));
  shell.addEventListener('file-preview:refresh', () => void render(true));

  let mode: 'collapsed' | 'preview' | 'expanded' = 'preview';
  let loaded = false;
  let busy = false;
  let current: RenderResult | null = null;
  let disposed = false;

  const setMode = (next: typeof mode) => {
    mode = next;
    shell.classList.toggle('file-preview-collapsed', next === 'collapsed');
    shell.classList.toggle('file-preview-expanded', next === 'expanded');
  };

  const clear = () => {
    current?.destroy?.();
    current = null;
    viewport.replaceChildren();
  };

  const render = async (refresh: boolean) => {
    if (busy || disposed) return;
    busy = true;
    const initialRenderer = rendererFor(options.title, options.mimeType);
    if (initialRenderer.kind === 'fallback') {
      current = initialRenderer.render({ ...options, bytes: new Uint8Array(), mimeType: options.mimeType }) as RenderResult;
      viewport.append(current.element);
      loaded = true;
      busy = false;
      return;
    }
    status.textContent = 'Loading preview...';
    shell.classList.add('file-preview-loading'); retry.hidden = true;
    try {
      const payload = await options.load(refresh);
      if (disposed) return;
      const renderer = rendererFor(options.title, payload.mimeType || options.mimeType);
      const result = await renderer.render({ ...options, ...payload, pdfMode: shell.closest('.drive-document-dialog') ? 'full' : 'inline' });
      if (disposed) { result.destroy?.(); return; }
      clear();
      current = result;
      viewport.append(result.element);
      status.textContent = '';
      if (renderer.kind === 'presentation' || renderer.kind === 'spreadsheet') shell.dispatchEvent(new Event('resource-preview:metadata', { bubbles: true }));
      loaded = true;
      if (shell.closest('.drive-document-dialog')) (result.element.tabIndex === 0 ? result.element : viewport).focus({ preventScroll: true });
    } catch {
      if (!disposed) {
        if (!current) savedText();
        status.textContent = current ? "Couldn't refresh · showing the cached document." : 'Preview unavailable';
        retry.hidden = false;
        loaded = true;
      }
    } finally {
      busy = false;
      shell.classList.remove('file-preview-loading');
    }
  };

  retry.onclick = () => void render(true);
  setMode('preview');

  let wasConnected = shell.isConnected;
  const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      intersection?.disconnect();
      void render(false);
    }
  }, { rootMargin: '280px' });
  const mutation = new MutationObserver(() => {
    if (shell.isConnected) {
      wasConnected = true;
      if (!loaded) {
        if (intersection) intersection.observe(shell);
        else void render(false);
      }
    } else if (wasConnected) {
      disposed = true;
      intersection?.disconnect();
      mutation.disconnect();
      clear();
    }
  });
  mutation.observe(document.body, { childList: true, subtree: true });
  if (shell.isConnected) {
    if (intersection) intersection.observe(shell);
    else void render(false);
  }
  return shell;
}

function button(text: string, label = text): HTMLButtonElement {
  const value = document.createElement('button');
  value.type = 'button';
  value.textContent = text;
  value.setAttribute('aria-label', label);
  return value;
}

function rendererFor(title: string, mimeType: string): FileRenderer {
  const name = title.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return pdfRenderer;
  if (mime === WORD_MIME || mime === GOOGLE_DOC_MIME || name.endsWith('.docx')) return documentRenderer;
  if (mime === PRESENTATION_MIME || mime === GOOGLE_SLIDES_MIME || name.endsWith('.pptx')) return presentationRenderer;
  if (mime === SHEET_MIME || mime === GOOGLE_SHEET_MIME || name.endsWith('.xlsx')) return spreadsheetRenderer;
  if (/^image\/(png|jpeg|webp|gif)$/.test(mime) || /\.(png|jpe?g|webp|gif)$/i.test(name)) return imageRenderer;
  if (mime === 'text/markdown' || name.endsWith('.md')) return markdownRenderer;
  if (mime.startsWith('text/') || name.endsWith('.txt')) return textRenderer;
  return fallbackRenderer;
}

const pdfRenderer: FileRenderer = {
  kind: 'pdf',
  render(context) {
    const element = createPdfViewer({ title: context.title, mode: context.pdfMode || 'inline', load: async () => context.bytes });
    return { element, destroy: () => element.dispatchEvent(new Event('pdf-viewer:dispose')) };
  },
};

const documentRenderer: FileRenderer = {
  kind: 'document',
  async render(context) {
    const { renderAsync } = await import('docx-preview');
    const article = document.createElement('article'); article.className = 'file-preview-document';
    // Source styles stay inside a shadow root, never affecting app chrome.
    const root = article.attachShadow({ mode: 'open' });
    const content = document.createElement('div'), styles = document.createElement('div');
    await renderAsync(asArrayBuffer(context.bytes), content, styles, {
      className: 'document-page', inWrapper: true, breakPages: true,
      ignoreLastRenderedPageBreak: false, useBase64URL: true, renderAltChunks: false,
      ignoreFonts: false, renderHeaders: true, renderFooters: true,
    });
    content.innerHTML = DOMPurify.sanitize(content.innerHTML, { ADD_ATTR: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] });
    content.querySelectorAll<HTMLElement>('[style]').forEach(node => {
      if (/url\s*\(/i.test(node.getAttribute('style') || '')) node.removeAttribute('style');
    });
    content.querySelectorAll('img').forEach(image => { if (!/^data:image\/(png|jpeg|gif|webp|bmp);/i.test(image.src)) image.remove(); });
    styles.querySelectorAll('style').forEach(style => { style.textContent = (style.textContent || '').replace(/@import[^;]*;/gi, '').replace(/url\s*\([^)]*\)/gi, 'none'); });
    const surface = document.createElement('style');
    surface.textContent = '.document-page-wrapper{background:transparent!important;padding:16px!important}section.document-page{background:white;color:#202020;box-shadow:0 1px 6px #0002;margin:0 auto 16px!important;max-width:100%;box-sizing:border-box}a{color:#2458a6}';
    secureLinks(content); root.append(styles, surface, content);
    const pages = Array.from(content.querySelectorAll<HTMLElement>('section.document-page'));
    const navigation = createPageControls(() => { if (pageIndex > 0) { pageIndex--; show(); } }, () => { if (pageIndex < pages.length - 1) { pageIndex++; show(); } });
    root.append(navigation.element);
    let pageIndex = 0;
    const show = () => {
      pages.forEach((page, index) => { page.hidden = index !== pageIndex; page.style.display = index === pageIndex ? '' : 'none'; });
      navigation.update(pageIndex + 1, pages.length);
      article.parentElement?.scrollTo?.({ top: 0 });
    };
    const sizing = new ResizeObserver(() => {
      const page = pages[pageIndex];
      if (page && article.clientWidth) {
        const sourceWidth = parseFloat(page.style.width) * (page.style.width.endsWith('pt') ? 4 / 3 : 1) || 794;
        content.style.zoom = String(Math.min(1, Math.max(.25, (article.clientWidth - 32) / sourceWidth)));
      }
    });
    sizing.observe(article); show();
    return { element: article, destroy: () => sizing.disconnect() };
  },
};

const presentationRenderer: FileRenderer = { kind: 'presentation', render: context => renderPresentation(context.bytes, context.viewState) };
const spreadsheetRenderer: FileRenderer = { kind: 'spreadsheet', render: context => renderSpreadsheet(context.bytes, context.viewState) };

const markdownRenderer: FileRenderer = {
  kind: 'markdown',
  async render(context) {
    const article = document.createElement('article');
    article.className = 'file-preview-markdown resource-description';
    const markdown = new TextDecoder('utf-8', { fatal: false }).decode(context.bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES));
    article.innerHTML = sanitizeHtml(await marked.parse(markdown, { async: true, breaks: false, gfm: true }));
    if (context.bytes.length > MAX_TEXT_PREVIEW_BYTES) article.append(document.createTextNode('\nPreview truncated at 1 MB.'));
    secureLinks(article);
    return { element: article };
  },
};

const textRenderer: FileRenderer = {
  kind: 'text',
  render(context) {
    const pre = document.createElement('pre');
    pre.className = 'file-preview-text';
    pre.textContent = new TextDecoder('utf-8', { fatal: false }).decode(context.bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES));
    if (context.bytes.length > MAX_TEXT_PREVIEW_BYTES) pre.textContent += '\n\nPreview truncated at 1 MB.';
    return { element: pre };
  },
};

const imageRenderer: FileRenderer = {
  kind: 'image',
  render(context) {
    const blob = new Blob([asArrayBuffer(context.bytes)], { type: context.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const image = document.createElement('img');
    image.className = 'file-preview-image';
    image.alt = context.title;
    image.src = url;
    return { element: image, destroy: () => URL.revokeObjectURL(url) };
  },
};

const fallbackRenderer: FileRenderer = {
  kind: 'fallback',
  render(context) {
    const fallback = document.createElement('div');
    fallback.className = 'file-preview-fallback';
    const title = document.createElement('p');
    title.textContent = context.title;
    const detail = document.createElement('small');
    detail.textContent = `${context.size ? `${(context.size / 1048576).toFixed(1)} MB · ` : ''}Preview unavailable`;
    fallback.append(title, detail);
    if (context.openExternal) {
      const open = button('Open externally');
      open.onclick = context.openExternal;
      fallback.append(open);
    }
    return { element: fallback };
  },
};

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button'],
  });
}

function secureLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href]').forEach((link) => {
    const anchor = link as HTMLAnchorElement;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
  });
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
