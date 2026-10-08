import { createElement, ChevronLeft, ChevronRight } from 'lucide';

// Included locally so the same controls work inside isolated document shadow roots.
export const PAGE_CONTROLS_CSS = `.resource-page-controls{position:sticky;z-index:10;bottom:12px;display:flex;align-items:center;gap:4px;width:max-content;margin:-42px auto 12px;padding:4px;border-radius:999px;background:#282828e8;color:#fff;box-shadow:0 2px 8px #0003;font:12px system-ui;backdrop-filter:blur(8px)}.resource-page-controls[hidden]{display:none}.resource-page-controls button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer}.resource-page-controls button:disabled{opacity:.35}.resource-page-controls button:focus-visible{outline:2px solid currentColor}.resource-page-controls span{min-width:42px;text-align:center;font-variant-numeric:tabular-nums}`;

export function createPageControls(onPrevious: () => void, onNext: () => void) {
  const element = document.createElement('div'); element.className = 'resource-page-controls';
  const style = document.createElement('style'); style.textContent = PAGE_CONTROLS_CSS;
  const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', 'Previous page'); next.setAttribute('aria-label', 'Next page');
  previous.append(createElement(ChevronLeft, { width: 18, height: 18, 'stroke-width': 3 }));
  next.append(createElement(ChevronRight, { width: 18, height: 18, 'stroke-width': 3 }));
  previous.onclick = onPrevious; next.onclick = onNext; count.setAttribute('aria-live', 'polite');
  element.append(style, previous, count, next);
  return { element, previous, next, update(page: number, total: number, busy = false) {
    element.hidden = total <= 1;
    count.textContent = `${page} / ${total}`;
    previous.disabled = busy || page <= 1; next.disabled = busy || page >= total;
  } };
}
