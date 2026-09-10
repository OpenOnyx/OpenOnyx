/**
 * Obsidian API Compatibility — Utility Functions
 */

export function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return normalized || '/';
}

export function parseYaml(yaml: string): any {
  try {
    const lines = yaml.trim().split('\n');
    const result: Record<string, any> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const key = line.substring(0, colonIdx).trim();
      let value: any = line.substring(colonIdx + 1).trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
      else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        value = value.slice(1, -1);
      if (value === '') value = null;
      if (key) result[key] = value;
    }
    return result;
  } catch { return {}; }
}

export function stringifyYaml(obj: any): string {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj).map(([k, v]) => {
    if (v === null || v === undefined) return `${k}: `;
    if (typeof v === 'string') return `${k}: "${v}"`;
    return `${k}: ${v}`;
  }).join('\n');
}

import { icons } from 'lucide';

// Use a window-global Map to share custom icons across different bundle/module instances
const customIcons: Map<string, string> = (() => {
  const globalWin = window as any;
  if (!globalWin.__oo_custom_icons) {
    globalWin.__oo_custom_icons = new Map<string, string>();
  }
  return globalWin.__oo_custom_icons;
})();

export function addIcon(iconId: string, svgContent: string): void {
  if (typeof iconId !== 'string') iconId = String(iconId || '');
  if (typeof svgContent !== 'string') svgContent = String(svgContent || '');
  customIcons.set(iconId, svgContent);
}

export function removeIcon(iconId: string): void {
  if (typeof iconId !== 'string') iconId = String(iconId || '');
  customIcons.delete(iconId);
}

// Convert kebab-case to PascalCase (e.g. arrow-up-right -> ArrowUpRight)
function toPascalCase(str: string): string {
  return str.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function getLucideIconHtml(iconId: string): string | null {
  if (typeof iconId !== 'string') return null;
  // Obsidian accepts both canonical icon IDs and the lucide-* aliases.
  if (iconId.startsWith('lucide-')) iconId = iconId.slice('lucide-'.length);

  // Comprehensive map of Obsidian icon names -> Lucide icon names.
  // Covers: Obsidian-specific glyph names, community plugin conventions,
  // and Lucide renames across versions.
  const aliases: Record<string, string> = {
    // Obsidian built-in glyph names
    'gear': 'settings',
    'vault': 'vault',
    'open-vault': 'folder-open',
    'document': 'file',
    'documents': 'files',
    'create-new': 'file-plus',
    'tasks': 'list-todo',
    'any-key': 'keyboard',
    'image-file': 'file-image',
    'note-glyph': 'file-text',
    'bullet-list': 'list',
    'bullet-list-glyph': 'list',
    'number-list': 'list-ordered',
    'three-horizontal-bars': 'menu',
    'magnifying-glass': 'search',
    'go-to-file': 'file-search',
    'cross-in-box': 'x-square',
    'filled-pin': 'pin',
    'crossed-star': 'star-off',
    'dot-network': 'network',
    'up-and-down-arrows': 'arrow-up-down',
    'right-arrow-with-tail': 'move-right',
    'left-arrow-with-tail': 'move-left',
    'broken-link': 'link-2-off',
    'stacked-levels': 'layers',
    'paper-plane': 'send',
    'uppercase-lowercase-a': 'a-large-small',
    'install': 'download',
    'uninstall': 'trash-2',
    'wrench-screwdriver-glyph': 'wrench',
    'right-triangle': 'play',
    'open-elsewhere': 'external-link',
    'popup-open': 'maximize-2',
    'pane-layout': 'layout',
    'sweep': 'eraser',
    'hashtag': 'hash',
    'percent-sign-glyph': 'percent',

    // Common third-party / brand aliases
    'github': 'code-2',
    'reset': 'rotate-ccw',
    'trello': 'columns-3',
    'twitter': 'message-circle',
    'youtube': 'play',

    // Obsidian calendar plugin conventions
    'calendar-with-checkmark': 'calendar-check',

    // Lucide icon renames / alternate names used by plugins
    'pencil': 'pencil',
    'trash': 'trash-2',
    'save': 'save',
    'comment': 'message-square',
  };
  iconId = aliases[iconId] || iconId;

  let pascalName = toPascalCase(iconId);
  let iconNodes = (icons as any)[pascalName];
  
  if (!iconNodes) {
    // Try fuzzy matching on common keywords as a last resort
    const lowerId = iconId.toLowerCase();
    let fallbackId = '';
    if (lowerId.includes('calendar')) fallbackId = 'calendar';
    else if (lowerId.includes('kanban') || lowerId.includes('board')) fallbackId = 'kanban';
    else if (lowerId.includes('chart') || lowerId.includes('bar-chart')) fallbackId = 'bar-chart-3';
    else if (lowerId.includes('folder')) fallbackId = 'folder';
    else if (lowerId.includes('tag')) fallbackId = 'tag';
    else if (lowerId.includes('search') || lowerId.includes('magnif')) fallbackId = 'search';
    else if (lowerId.includes('settings') || lowerId.includes('gear') || lowerId.includes('config')) fallbackId = 'settings';
    else if (lowerId.includes('check') || lowerId.includes('todo') || lowerId.includes('task')) fallbackId = 'check-square';
    else if (lowerId.includes('link')) fallbackId = 'link';
    else if (lowerId.includes('document') || lowerId.includes('file') || lowerId.includes('note')) fallbackId = 'file-text';
    else if (lowerId.includes('list') || lowerId.includes('outline')) fallbackId = 'list';
    else if (lowerId.includes('info')) fallbackId = 'info';
    else if (lowerId.includes('help') || lowerId.includes('question')) fallbackId = 'help-circle';
    else if (lowerId.includes('star') || lowerId.includes('favorite') || lowerId.includes('bookmark')) fallbackId = 'star';
    else if (lowerId.includes('clock') || lowerId.includes('time') || lowerId.includes('history')) fallbackId = 'clock';
    else if (lowerId.includes('trash') || lowerId.includes('delete') || lowerId.includes('remove')) fallbackId = 'trash-2';
    else if (lowerId.includes('graph') || lowerId.includes('network')) fallbackId = 'git-fork';
    else if (lowerId.includes('pin')) fallbackId = 'pin';
    else if (lowerId.includes('key') || lowerId.includes('keyboard')) fallbackId = 'keyboard';
    else if (lowerId.includes('image') || lowerId.includes('photo') || lowerId.includes('picture')) fallbackId = 'image';
    else if (lowerId.includes('audio') || lowerId.includes('music') || lowerId.includes('headphone')) fallbackId = 'headphones';
    else if (lowerId.includes('video') || lowerId.includes('play')) fallbackId = 'play';
    else if (lowerId.includes('download') || lowerId.includes('install')) fallbackId = 'download';
    else if (lowerId.includes('upload') || lowerId.includes('export')) fallbackId = 'upload';
    else if (lowerId.includes('edit') || lowerId.includes('pencil') || lowerId.includes('write')) fallbackId = 'pencil';
    else if (lowerId.includes('refresh') || lowerId.includes('reload') || lowerId.includes('sync')) fallbackId = 'refresh-cw';
    else if (lowerId.includes('arrow') || lowerId.includes('move')) fallbackId = 'arrow-right';
    else if (lowerId.includes('plus') || lowerId.includes('add') || lowerId.includes('new') || lowerId.includes('create')) fallbackId = 'plus';
    else if (lowerId.includes('minus')) fallbackId = 'minus';
    else if (lowerId.includes('close') || lowerId.includes('cancel')) fallbackId = 'x';
    else if (lowerId.includes('menu') || lowerId.includes('bar') || lowerId.includes('hamburger')) fallbackId = 'menu';
    else if (lowerId.includes('layout') || lowerId.includes('pane') || lowerId.includes('panel')) fallbackId = 'layout';
    else if (lowerId.includes('copy') || lowerId.includes('duplicate') || lowerId.includes('clipboard')) fallbackId = 'copy';
    else if (lowerId.includes('share') || lowerId.includes('send')) fallbackId = 'share-2';
    else if (lowerId.includes('hash') || lowerId.includes('hashtag')) fallbackId = 'hash';
    else if (lowerId.includes('globe') || lowerId.includes('world') || lowerId.includes('web')) fallbackId = 'globe';
    else if (lowerId.includes('eye') || lowerId.includes('view') || lowerId.includes('visible')) fallbackId = 'eye';
    else if (lowerId.includes('lock') || lowerId.includes('secure')) fallbackId = 'lock';
    else if (lowerId.includes('user') || lowerId.includes('person') || lowerId.includes('profile')) fallbackId = 'user';
    else if (lowerId.includes('home') || lowerId.includes('house')) fallbackId = 'home';
    else if (lowerId.includes('mail') || lowerId.includes('email') || lowerId.includes('envelope')) fallbackId = 'mail';
    else if (lowerId.includes('rss') || lowerId.includes('feed')) fallbackId = 'rss';
    else if (lowerId.includes('alert') || lowerId.includes('warning') || lowerId.includes('danger')) fallbackId = 'alert-triangle';
    else if (lowerId.includes('sort')) fallbackId = 'arrow-up-down';
    else if (lowerId.includes('filter')) fallbackId = 'filter';
    else if (lowerId.includes('palette') || lowerId.includes('color') || lowerId.includes('paint')) fallbackId = 'palette';
    else if (lowerId.includes('code') || lowerId.includes('script') || lowerId.includes('terminal')) fallbackId = 'code';
    else if (lowerId.includes('table') || lowerId.includes('grid') || lowerId.includes('spreadsheet')) fallbackId = 'table';
    else if (lowerId.includes('database') || lowerId.includes('server')) fallbackId = 'database';
    else if (lowerId.includes('map') || lowerId.includes('compass')) fallbackId = 'compass';

    if (fallbackId) {
      pascalName = toPascalCase(fallbackId);
      iconNodes = (icons as any)[pascalName];
    }
  }

  if (!iconNodes) return null;

  let innerHtml = '';
  for (const node of iconNodes) {
    const [tag, attrs] = node;
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    innerHtml += `<${tag} ${attrStr}></${tag}>`;
  }
  return innerHtml;
}

export function setIcon(parent: HTMLElement, iconId: string): void {
  if (typeof iconId !== 'string') {
    if (iconId && typeof iconId === 'object') {
      if (typeof (iconId as any).id === 'string') {
        iconId = (iconId as any).id;
      } else if (typeof (iconId as any).icon === 'string') {
        iconId = (iconId as any).icon;
      } else {
        iconId = String(iconId || '');
      }
    } else {
      iconId = String(iconId || '');
    }
  }

  parent.setAttribute('data-icon', iconId);

  const custom = customIcons.get(iconId);
  if (custom) {
    const trimmed = custom.trim();
    if (trimmed.startsWith('<svg')) {
      // Full SVG element — inject directly but ensure it has proper sizing class
      parent.innerHTML = trimmed.replace(
        /^<svg/,
        '<svg class="svg-icon" style="width:16px;height:16px"'
      );
    } else {
      // Raw SVG inner content (paths, circles, etc.) — wrap in SVG container.
      // Custom registered icons in Obsidian typically use a 100x100 viewport and fill="currentColor".
      parent.innerHTML = `<svg class="svg-icon" data-icon-name="${iconId}" width="16" height="16" viewBox="0 0 100 100" fill="currentColor">${trimmed}</svg>`;
    }
    return;
  }

  let innerHtml = getLucideIconHtml(iconId);
  if (!innerHtml) {
    console.log("[setIcon] Missing icon requested by plugin:", iconId);
  }
  const svgContent = innerHtml || '<circle cx="12" cy="12" r="10"/>';
  parent.innerHTML = `<svg class="svg-icon" data-icon-name="${iconId}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>`;
}

export function setTooltip(el: HTMLElement, tooltip: string, options?: any): void {
  el.dataset.tooltip = tooltip;
  el.removeAttribute("title");
}

export const Platform = {
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: navigator.platform?.includes('Mac') || false,
  isWin: navigator.platform?.includes('Win') || false,
  isLinux: navigator.platform?.includes('Linux') || false,
  isSafari: false,
  isIosApp: false,
  isAndroidApp: false,
};

export async function requestUrl(request: any): Promise<any> {
  const params = typeof request === 'string' ? { url: request } : request;

  if ((window as any).electronAPI?.networkRequest) {
    try {
      const result = await (window as any).electronAPI.networkRequest(params);
      return result;
    } catch (e) {
      console.error("[requestUrl] IPC networkRequest failed, falling back to fetch:", e);
    }
  }

  // Fallback to standard fetch if IPC fails or is missing
  return fetch(params.url, {
    method: params.method || 'GET',
    headers: params.headers || {},
    body: params.body,
  }).then(async (response) => {
    const arrayBuffer = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const text = new TextDecoder().decode(arrayBuffer);
    let json: any;
    try { json = JSON.parse(text); } catch { json = null; }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
      json,
      arrayBuffer,
    };
  });
}

export async function request(req: any): Promise<string> {
  const result = await requestUrl(req);
  return result.text;
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T, wait: number, immediate?: boolean
): T & { cancel: () => void } {
  let timeout: number | null = null;
  const debounced = function (this: any, ...args: any[]) {
    const later = () => { timeout = null; if (!immediate) fn.apply(this, args); };
    const callNow = immediate && !timeout;
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow) fn.apply(this, args);
  } as any;
  debounced.cancel = () => { if (timeout) window.clearTimeout(timeout); timeout = null; };
  return debounced;
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function prepareFuzzySearch(query: string): (text: string) => any | null {
  const q = query.toLowerCase();
  return (text: string) => {
    const t = text.toLowerCase();
    if (t.includes(q)) return { score: -t.indexOf(q), matches: [[t.indexOf(q), t.indexOf(q) + q.length]] };
    return null;
  };
}

export function prepareSimpleSearch(query: string): (text: string) => any | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (text: string) => {
    const t = text.toLowerCase();
    const matches: [number, number][] = [];
    for (const w of words) {
      const idx = t.indexOf(w);
      if (idx < 0) return null;
      matches.push([idx, idx + w.length]);
    }
    return { score: -matches[0]?.[0] || 0, matches };
  };
}

export function renderMatches(el: HTMLElement, text: string, matches: any, offset?: number): void {
  el.textContent = text;
}

export function renderResults(el: HTMLElement, text: string, result: any, offset?: number): void {
  el.textContent = text;
}

export function sortSearchResults(results: any[]): void {
  results.sort((a: any, b: any) => (a.match?.score || 0) - (b.match?.score || 0));
}

export function requireApiVersion(version: string): boolean {
  return true; // We support all API versions
}

export function getLinkpath(linkText: string): string {
  return linkText.split('#')[0].split('|')[0];
}

export function stripHeading(heading: string): string {
  return heading.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim();
}

export function stripHeadingForLink(heading: string): string {
  return heading.replace(/[[\]|#^]/g, '').trim();
}

// Scope -- hotkey scoping
export class Scope {
  parent: Scope | null;
  keys: any[] = [];

  constructor(parent?: Scope) {
    this.parent = parent || null;
  }

  register(modifiers: string[] | null, key: string | null, func: (evt: KeyboardEvent) => any): any {
    const handler = { modifiers: modifiers || [], key, func };
    this.keys.push(handler);
    return handler;
  }

  unregister(handler: any): void {
    const index = this.keys.indexOf(handler);
    if (index >= 0) this.keys.splice(index, 1);
  }

  /** Dispatch a keyboard event through registered handlers. Returns true if handled. */
  handleKey(evt: KeyboardEvent): boolean {
    for (const handler of this.keys) {
      // Match key
      if (handler.key && handler.key !== evt.key && handler.key !== evt.code) continue;

      // Match modifiers
      const mods = handler.modifiers || [];
      const requireCtrl = mods.some((m: string) => m === 'Ctrl' || m === 'Mod');
      const requireShift = mods.some((m: string) => m === 'Shift');
      const requireAlt = mods.some((m: string) => m === 'Alt');
      const requireMeta = mods.some((m: string) => m === 'Meta');

      if (requireCtrl && !evt.ctrlKey && !evt.metaKey) continue;
      if (requireShift && !evt.shiftKey) continue;
      if (requireAlt && !evt.altKey) continue;
      if (requireMeta && !evt.metaKey) continue;

      try {
        const result = handler.func(evt);
        if (result !== false) return true;
      } catch (e) {
        console.error('[Scope] Handler error:', e);
      }
    }

    // Delegate to parent scope
    if (this.parent) return this.parent.handleKey(evt);
    return false;
  }
}
