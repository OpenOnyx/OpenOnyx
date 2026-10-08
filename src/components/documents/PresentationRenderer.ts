import DOMPurify from 'dompurify';
import { notifyResourceViewState, subscribeResourceViewState, type ResourceViewState } from './ResourceViewState';
import { createPageControls } from './PageControls';

export async function renderPresentation(bytes: Uint8Array, state: ResourceViewState = {}) {
  const { parseZipLazyMedia, buildPresentation, materializeSlideNodes, renderSlide, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
  const files = await parseZipLazyMedia(bytes.slice().buffer, { ...RECOMMENDED_ZIP_LIMITS, maxTotalUncompressedBytes: 80 * 1024 * 1024, maxMediaBytes: 50 * 1024 * 1024 });
  // A document must never fetch external assets or activate provider hyperlinks.
  const stripExternal = (xml: string) => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    document.querySelectorAll('Relationship').forEach(rel => {
      if (rel.getAttribute('TargetMode')?.toLowerCase() === 'external' || /^(?:https?:|file:|javascript:|\/\/)/i.test(rel.getAttribute('Target') || '')) rel.remove();
    });
    return new XMLSerializer().serializeToString(document);
  };
  files.presentationRels = stripExternal(files.presentationRels);
  for (const map of [files.slideRels, files.slideLayoutRels, files.slideMasterRels, files.chartRels]) map?.forEach((xml, key) => map.set(key, stripExternal(xml)));
  const originalResolver = files.mediaResolver;
  if (originalResolver) files.mediaResolver = { async resolve(target) {
    const media = await originalResolver.resolve(target);
    // Raster images are safe blob-backed media; active SVG is intentionally unsupported.
    return media && /\.(png|jpe?g|gif|webp|bmp|emf|wmf)$/i.test(media.mediaPath) ? media : undefined;
  } };
  const presentation = buildPresentation(files, { lazySlides: true });
  if (!presentation.slides.length) throw new Error('No slides');
  const element = document.createElement('section'); element.className = 'file-preview-presentation'; element.tabIndex = 0;
  const root = element.attachShadow({ mode: 'open' });
  // PPTX's font-ready/text-fit callbacks require connected text boxes. Keep the
  // detached result measurable until its consumer moves it into the note.
  const measurement = document.createElement('div');
  measurement.style.cssText = 'position:fixed;left:-100000px;top:0;width:640px;visibility:hidden;pointer-events:none;contain:layout style paint';
  measurement.setAttribute('aria-hidden', 'true'); measurement.inert = true;
  measurement.append(element); document.body.append(measurement);
  const mountObserver = new MutationObserver(() => {
    if (element.parentElement !== measurement) { measurement.remove(); mountObserver.disconnect(); }
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });
  const stage = document.createElement('div'); stage.className = 'presentation-stage';
  const style = document.createElement('style');
  style.textContent = ':host{display:block;position:relative}.presentation-stage{position:relative;margin:0 auto;overflow:hidden;background:white}.presentation-stage>div{transform-origin:top left}.resource-page-controls{position:relative;bottom:auto;margin:10px auto 0;opacity:.28;transition:opacity .15s}:host(:hover) .resource-page-controls,:host(:focus-within) .resource-page-controls{opacity:1}.presentation-jump::picker(select){appearance:base-select;background:#282828;color:#fff;border:1px solid #444;border-radius:10px;padding:4px;max-height:260px;overflow-y:auto;scrollbar-width:none;box-shadow:0 4px 14px #0004}.presentation-jump::picker(select)::-webkit-scrollbar{display:none;width:0}.presentation-jump::picker-icon{content:"";display:block;flex:none;width:18px;height:18px;margin:0 0 0 4px;background:currentColor;mask:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22m6 9 6 6 6-6%22 fill=%22none%22 stroke=%22black%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E") center/contain no-repeat}.presentation-jump option::checkmark{display:none}.presentation-jump option{background:#282828;color:#fff;border-radius:6px;padding:4px 8px}.presentation-jump option:hover,.presentation-jump option:checked{background:#444}.presentation-jump{appearance:base-select;border-radius:6px;background:transparent;color:inherit;border:0;font:inherit;max-width:90px;align-items:center}:host .presentation-stage{max-width:100%}';
  let index = Math.max(0, Math.min(state.slide || 0, presentation.slides.length - 1)), revision = 0, disposed = false;
  let handle: ReturnType<typeof renderSlide> | undefined;
  const mediaUrls = new Map<string, string>();
  const releaseMedia = () => { mediaUrls.forEach(url => URL.revokeObjectURL(url)); mediaUrls.clear(); };
  const navigation = createPageControls(() => { if (index > 0) { index--; void show(); } }, () => { if (index < presentation.slides.length - 1) { index++; void show(); } });
  const jump = document.createElement('select'); jump.className = 'presentation-jump'; jump.setAttribute('aria-label', 'Go to slide');
  presentation.slides.forEach((_, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1} / ${presentation.slides.length}`; jump.append(option); });
  navigation.element.querySelector('span')!.replaceWith(jump);
  jump.onchange = () => { index = Number(jump.value); void show(); };
  root.append(style, stage, navigation.element);
  state.count = presentation.slides.length;
  element.addEventListener('click', event => event.stopPropagation());
  element.addEventListener('pointerdown', event => { event.stopPropagation(); if (!(event.composedPath()[0] as HTMLElement).closest('button, select')) element.focus({ preventScroll: true }); });
  const resize = () => {
    if (!handle) return;
    const width = Math.max(1, element.clientWidth || 640);
    const availableHeight = element.closest('.drive-document-dialog') ? Math.max(100, (element.parentElement?.clientHeight || 640) - 52) : 380;
    const scale = Math.min(width / presentation.width, availableHeight / presentation.height);
    stage.style.width = `${presentation.width * scale}px`; stage.style.height = `${presentation.height * scale}px`;
    handle.element.style.transform = `scale(${scale})`;
  };
  const show = async () => {
    const attempt = ++revision; state.slide = index; notifyResourceViewState(state); jump.value = String(index);
    handle?.dispose(); stage.replaceChildren(); navigation.update(index + 1, presentation.slides.length, true);
    materializeSlideNodes(presentation, presentation.slides[index]);
    const candidate = renderSlide(presentation, presentation.slides[index], { pdfjs: false, mediaUrlCache: mediaUrls });
    // DrawingML row heights are minima. The library uses their sum as a
    // fixed clipping box, which cuts off wrapped cell text. Let tables grow
    // to their intrinsic height while retaining the source row minima.
    candidate.element.querySelectorAll<HTMLTableElement>('table').forEach(table => {
      const frame = table.parentElement;
      if (!frame || frame.style.position !== 'absolute') return;
      const sourceHeight = parseFloat(frame.style.height);
      if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) return;
      table.querySelectorAll<HTMLTableRowElement>('tr').forEach(row => {
        if (row.style.height.endsWith('%')) row.style.height = `${parseFloat(row.style.height) * sourceHeight / 100}px`;
      });
      frame.style.minHeight = frame.style.height; frame.style.height = 'auto'; frame.style.overflow = 'visible';
      table.style.minHeight = `${sourceHeight}px`; table.style.height = 'auto';
    });
    handle = candidate;
    stage.append(candidate.element); resize();
    try { await candidate.ready; } catch { if (attempt === revision && !disposed) { stage.textContent = 'Slide preview unavailable'; navigation.update(index + 1, presentation.slides.length); } return; }
    if (disposed || attempt !== revision) { candidate.dispose(); return; }
    // Only URLs minted by this renderer may survive sanitization. Provider
    // URLs and arbitrary blob URLs remain blocked.
    const generatedUrls = new Set(mediaUrls.values());
    const images = Array.from(candidate.element.querySelectorAll('img, image')).flatMap(image => {
      const attribute = image.tagName.toLowerCase() === 'img' ? 'src' : 'href';
      const url = image.getAttribute(attribute);
      return url && generatedUrls.has(url) ? [{ image, attribute, url }] : [];
    });
    DOMPurify.sanitize(candidate.element, { IN_PLACE: true, ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject', 'video', 'audio'] });
    images.forEach(({ image, attribute, url }) => { if (candidate.element.contains(image)) image.setAttribute(attribute, url); });
    navigation.update(index + 1, presentation.slides.length);
  };
  element.addEventListener('keydown', event => {
    if (event.composedPath()[0] === jump) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); navigation.previous.click(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); navigation.next.click(); }
  });
  const observer = new ResizeObserver(resize); observer.observe(element);
  const unsubscribe = subscribeResourceViewState(state, () => { if (!disposed && state.slide !== index) { index = Math.max(0, Math.min(state.slide || 0, presentation.slides.length - 1)); void show(); } });
  try { await show(); } catch (error) { unsubscribe(); observer.disconnect(); mountObserver.disconnect(); measurement.remove(); handle?.dispose(); releaseMedia(); presentation.media.clear(); throw error; }
  return { element, destroy() { disposed = true; unsubscribe(); mountObserver.disconnect(); measurement.remove(); revision++; observer.disconnect(); handle?.dispose(); releaseMedia(); presentation.media.clear(); } };
}
