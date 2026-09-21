/**
 * Obsidian DOM Extensions
 *
 * Obsidian patches HTMLElement.prototype with helper methods like
 * .empty(), .createEl(), .createDiv(), .setText(), etc.
 * Virtually every community plugin depends on these.
 *
 * This file must be imported early (before any plugins load)
 * to ensure the prototypes are patched.
 */
import CodeMirror from 'codemirror';

(window as any).CodeMirror = (window as any).CodeMirror || CodeMirror;

// Avoid double-patching
if (!(HTMLElement.prototype as any).__oo_dom_patched) {
  (window as any).activeDocument = document;
  (window as any).activeWindow = window;

  // ── empty() — Remove all children ───────────────────
  (HTMLElement.prototype as any).empty = function () {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
  };

  // ── setText() — Set text content ────────────────────
  (HTMLElement.prototype as any).setText = function (text: string) {
    this.textContent = text;
  };

  // ── getText() — Get text content ────────────────────
  (HTMLElement.prototype as any).getText = function (): string {
    return this.textContent || '';
  };

  // ── createEl() — Create and append a child element ──
  (HTMLElement.prototype as any).createEl = function (
    tag: string,
    o?: string | { text?: string; cls?: string | string[]; attr?: Record<string, string>; type?: string; href?: string; placeholder?: string; value?: string; prepend?: boolean; title?: string; },
    callback?: (el: HTMLElement) => void
  ): HTMLElement {
    const el = document.createElement(tag);

    if (typeof o === 'string') {
      el.textContent = o;
    } else if (o) {
      if (o.text) el.textContent = o.text;
      if (o.cls) {
        if (Array.isArray(o.cls)) {
          el.className = o.cls.join(' ');
        } else {
          el.className = o.cls;
        }
      }
      if (o.attr) {
        for (const [k, v] of Object.entries(o.attr)) {
          el.setAttribute(k, v);
        }
      }
      if (o.type) el.setAttribute('type', o.type);
      if (o.href) el.setAttribute('href', o.href);
      if (o.placeholder) el.setAttribute('placeholder', o.placeholder);
      if (o.value) (el as HTMLInputElement).value = o.value;
      if (o.title) {
        el.dataset.tooltip = o.title;
        el.removeAttribute('title');
      }
      if (o.prepend && this.firstChild) {
        this.insertBefore(el, this.firstChild);
      } else {
        this.appendChild(el);
      }
    } else {
      this.appendChild(el);
    }

    // If not prepended above, ensure it's appended
    if (!el.parentNode) {
      this.appendChild(el);
    }

    if (callback) callback(el);
    return el;
  };

  // ── createDiv() — Shorthand for createEl('div') ─────
  (HTMLElement.prototype as any).createDiv = function (
    o?: string | { text?: string; cls?: string | string[]; attr?: Record<string, string>; },
    callback?: (el: HTMLDivElement) => void
  ): HTMLDivElement {
    // Obsidian's createDiv('class-name') overload uses the string as a class,
    // unlike createEl('div', 'text'). Community plugins rely on this heavily.
    const options = typeof o === 'string' ? { cls: o } : o;
    return (this as any).createEl('div', options, callback) as HTMLDivElement;
  };

  // ── createSpan() — Shorthand for createEl('span') ───
  (HTMLElement.prototype as any).createSpan = function (
    o?: string | { text?: string; cls?: string | string[]; attr?: Record<string, string>; },
    callback?: (el: HTMLSpanElement) => void
  ): HTMLSpanElement {
    const options = typeof o === 'string' ? { cls: o } : o;
    return (this as any).createEl('span', options, callback) as HTMLSpanElement;
  };

  // ── addClass() — Add CSS class(es) ─────────────────
  (HTMLElement.prototype as any).addClass = function (...classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.add(...cls.split(' ').filter(Boolean));
    }
  };

  // ── removeClass() — Remove CSS class(es) ────────────
  (HTMLElement.prototype as any).removeClass = function (...classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.remove(...cls.split(' ').filter(Boolean));
    }
  };

  // ── toggleClass() — Toggle CSS class ────────────────
  (HTMLElement.prototype as any).toggleClass = function (cls: string, value?: boolean) {
    if (value === undefined) {
      this.classList.toggle(cls);
    } else {
      if (value) {
        this.classList.add(cls);
      } else {
        this.classList.remove(cls);
      }
    }
  };

  // ── hasClass() — Check CSS class ────────────────────
  (HTMLElement.prototype as any).hasClass = function (cls: string): boolean {
    return this.classList.contains(cls);
  };

  // ── onClickEvent() — Obsidian specific click helper ─
  (HTMLElement.prototype as any).onClickEvent = function (callback: (e: MouseEvent) => any, options?: boolean | AddEventListenerOptions) {
    this.addEventListener("click", callback, options);
    return this;
  };

  // Obsidian notifies views when their DOM moves to another application
  // window. Single-window hosts do not migrate elements, but plugins such as
  // Kanban still register this lifecycle hook and expect a cleanup callback.
  (HTMLElement.prototype as any).onWindowMigrated = function (_callback: (window: Window) => any) {
    return () => {};
  };

  // ── detach() — Remove from DOM ──────────────────────
  (HTMLElement.prototype as any).detach = function () {
    this.remove();
  };

  // ── find() / findAll() — Obsidian aliases for querySelector ──
  (HTMLElement.prototype as any).find = function (selector: string): HTMLElement | null {
    return this.querySelector(selector);
  };
  (HTMLElement.prototype as any).findAll = function (selector: string): NodeListOf<HTMLElement> {
    return this.querySelectorAll(selector);
  };

  // ── show() / hide() — Display control ───────────────
  (HTMLElement.prototype as any).show = function () {
    this.style.display = '';
  };

  (HTMLElement.prototype as any).hide = function () {
    this.style.display = 'none';
  };

  // ── isShown() — Check visibility ────────────────────
  (HTMLElement.prototype as any).isShown = function (): boolean {
    return this.style.display !== 'none' && this.offsetParent !== null;
  };

  // ── setCssProps() — Set multiple CSS properties ─────
  (HTMLElement.prototype as any).setCssProps = function (props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };

  // ── setAttr / setAttrs — Attribute manipulation ─────
  (HTMLElement.prototype as any).setAttr = function (key: string, value: string | number | boolean | null) {
    if (value === null) {
      this.removeAttribute(key);
    } else {
      this.setAttribute(key, String(value));
    }
  };

  (HTMLElement.prototype as any).setAttrs = function (attrs: Record<string, string | number | boolean | null>) {
    for (const [key, value] of Object.entries(attrs)) {
      (this as any).setAttr(key, value);
    }
  };

  // ── getCssPropertyValue() ───────────────────────────
  (HTMLElement.prototype as any).getCssPropertyValue = function (prop: string): string {
    return getComputedStyle(this).getPropertyValue(prop);
  };

  // ── matchParent() — Find closest ancestor matching selector
  (HTMLElement.prototype as any).matchParent = function (selector: string, lastParent?: Element): HTMLElement | null {
    return this.closest(selector);
  };

  // ── win / doc helpers ───────────────────────────────
  (HTMLElement.prototype as any).win = window;
  (HTMLElement.prototype as any).doc = document;

  // ── Also patch DocumentFragment for createEl ────────
  (DocumentFragment.prototype as any).createEl = function (
    tag: string,
    o?: string | { text?: string; cls?: string | string[]; attr?: Record<string, string>; },
    callback?: (el: HTMLElement) => void
  ): HTMLElement {
    const el = document.createElement(tag);
    if (typeof o === 'string') {
      el.textContent = o;
    } else if (o) {
      if (o.text) el.textContent = o.text;
      if (o.cls) {
        if (Array.isArray(o.cls)) el.className = o.cls.join(' ');
        else el.className = o.cls;
      }
      if (o.attr) {
        for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
      }
    }
    this.appendChild(el);
    if (callback) callback(el);
    return el;
  };

  (DocumentFragment.prototype as any).createDiv = function (
    o?: string | { text?: string; cls?: string | string[]; },
    callback?: (el: HTMLDivElement) => void
  ): HTMLDivElement {
    const options = typeof o === 'string' ? { cls: o } : o;
    return (this as any).createEl('div', options, callback);
  };

  (DocumentFragment.prototype as any).createSpan = function (
    o?: string | { text?: string; cls?: string | string[]; },
    callback?: (el: HTMLSpanElement) => void
  ): HTMLSpanElement {
    const options = typeof o === 'string' ? { cls: o } : o;
    return (this as any).createEl('span', options, callback);
  };

  // Also add createEl/createDiv to document.body as a global helper
  // Some plugins use `createEl` as a standalone function
  (window as any).createEl = (tag: string, o?: any, callback?: any) => {
    return (document.body as any).createEl(tag, o, callback);
  };
  (window as any).createDiv = (o?: any, callback?: any) => {
    return (document.body as any).createDiv(o, callback);
  };
  (window as any).createSpan = (o?: any, callback?: any) => {
    return (document.body as any).createSpan(o, callback);
  };
  (window as any).createFragment = (callback?: (frag: DocumentFragment) => void): DocumentFragment => {
    const frag = document.createDocumentFragment();
    if (callback) callback(frag);
    return frag;
  };

  // ── toggle() — show/hide based on boolean ───────────
  (HTMLElement.prototype as any).toggle = function(show: boolean) {
    this.style.display = show ? '' : 'none';
  };

  // ── toggleVisibility() — visibility control ─────────
  (HTMLElement.prototype as any).toggleVisibility = function(visible: boolean) {
    this.style.visibility = visible ? '' : 'hidden';
  };

  // ── setCssStyles() — set inline CSS styles ──────────
  (HTMLElement.prototype as any).setCssStyles = function(styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };

  // ── addClasses() — add multiple classes from array ──
  (HTMLElement.prototype as any).addClasses = function(classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.add(...cls.split(' ').filter(Boolean));
    }
  };

  // ── removeClasses() — remove multiple classes ───────
  (HTMLElement.prototype as any).removeClasses = function(classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.remove(...cls.split(' ').filter(Boolean));
    }
  };

  // ── findAllSelf() — querySelectorAll including self ─
  (HTMLElement.prototype as any).findAllSelf = function(selector: string): HTMLElement[] {
    const results = Array.from(this.querySelectorAll(selector)) as HTMLElement[];
    if (this.matches(selector)) results.unshift(this);
    return results;
  };

  // ── isActiveElement() ───────────────────────────────
  (HTMLElement.prototype as any).isActiveElement = function(): boolean {
    return document.activeElement === this;
  };

  // ── getAttr() ───────────────────────────────────────
  if (!(HTMLElement.prototype as any).getAttr) {
    (HTMLElement.prototype as any).getAttr = function(key: string): string | null {
      return this.getAttribute(key);
    };
  }

  // ── Delegated on/off events ─────────────────────────
  (HTMLElement.prototype as any).on = function(
    type: string, selector: string,
    listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => any,
    options?: boolean | AddEventListenerOptions
  ) {
    const handler = (evt: Event) => {
      const target = (evt.target as HTMLElement)?.closest?.(selector) as HTMLElement | null;
      if (target && this.contains(target)) {
        listener.call(this, evt, target);
      }
    };
    if (!this._EVENTS) this._EVENTS = {};
    if (!this._EVENTS[type]) this._EVENTS[type] = [];
    this._EVENTS[type].push({ selector, listener, options, callback: handler });
    this.addEventListener(type, handler, options);
  };

  (HTMLElement.prototype as any).off = function(
    type: string, selector: string,
    listener: Function,
    options?: boolean | AddEventListenerOptions
  ) {
    const entries = this._EVENTS?.[type];
    if (!entries) return;
    const idx = entries.findIndex((e: any) => e.selector === selector && e.listener === listener);
    if (idx >= 0) {
      this.removeEventListener(type, entries[idx].callback, options);
      entries.splice(idx, 1);
    }
  };

  // ── trigger() — dispatch custom event ───────────────
  (HTMLElement.prototype as any).trigger = function(eventType: string) {
    this.dispatchEvent(new Event(eventType, { bubbles: true }));
  };

  // ── onNodeInserted() ────────────────────────────────
  (HTMLElement.prototype as any).onNodeInserted = function(
    listener: () => any, once?: boolean
  ): () => void {
    if (this.isConnected) { listener(); if (once) return () => {}; }
    const obs = new MutationObserver(() => {
      if (this.isConnected) { listener(); if (once) { obs.disconnect(); } }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  };

  // ── onWindowMigrated() — stub ───────────────────────
  (HTMLElement.prototype as any).onWindowMigrated = function(listener: (win: Window) => any): () => void {
    return () => {};
  };

  // ── innerWidth / innerHeight (without padding) ──────
  try {
    Object.defineProperty(HTMLElement.prototype, 'innerWidth', {
      get() {
        const s = getComputedStyle(this);
        return this.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      },
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'innerHeight', {
      get() {
        const s = getComputedStyle(this);
        return this.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
      },
      configurable: true,
    });
  } catch { /* already defined */ }

  // Mark as patched
  (HTMLElement.prototype as any).__oo_dom_patched = true;
  console.log('[OpenOnyx] DOM extensions patched');
}

// ── Node-level patches ──────────────────────────────
if (!(Node.prototype as any).detach) {
  (Node.prototype as any).detach = function() { this.parentNode?.removeChild(this); };
}
if (!(Node.prototype as any).empty) {
  (Node.prototype as any).empty = function() { while (this.firstChild) this.removeChild(this.firstChild); };
}
if (!(Node.prototype as any).insertAfter) {
  (Node.prototype as any).insertAfter = function<T extends Node>(node: T, child: Node | null): T {
    if (!child) { this.appendChild(node); return node; }
    if (child.nextSibling) { this.insertBefore(node, child.nextSibling); }
    else { this.appendChild(node); }
    return node;
  };
}
if (!(Node.prototype as any).indexOf) {
  (Node.prototype as any).indexOf = function(other: Node): number {
    return Array.from(this.childNodes).indexOf(other);
  };
}
if (!(Node.prototype as any).setChildrenInPlace) {
  (Node.prototype as any).setChildrenInPlace = function(children: Node[]) {
    (this as any).empty();
    for (const c of children) this.appendChild(c);
  };
}
if (!(Node.prototype as any).appendText) {
  (Node.prototype as any).appendText = function(val: string) {
    this.appendChild(document.createTextNode(val));
  };
}
if (!(Node.prototype as any).instanceOf) {
  (Node.prototype as any).instanceOf = function<T>(type: { new(): T }): boolean {
    return this instanceof type;
  };
}
// Node.doc / Node.win
try {
  if (!Object.getOwnPropertyDescriptor(Node.prototype, 'doc')) {
    Object.defineProperty(Node.prototype, 'doc', {
      get() { return this.ownerDocument || document; },
      configurable: true,
    });
  }
  if (!Object.getOwnPropertyDescriptor(Node.prototype, 'win')) {
    Object.defineProperty(Node.prototype, 'win', {
      get() { return (this.ownerDocument || document).defaultView || window; },
      configurable: true,
    });
  }
  if (!Object.getOwnPropertyDescriptor(Node.prototype, 'constructorWin')) {
    Object.defineProperty(Node.prototype, 'constructorWin', {
      get() { return window; },
      configurable: true,
    });
  }
} catch { /* skip if already defined */ }

// Obsidian also exposes the event's owning document and window. Editors and
// plugins use `event.win` for deferred focus work instead of global window.
try {
  if (!Object.getOwnPropertyDescriptor(Event.prototype, 'doc')) {
    Object.defineProperty(Event.prototype, 'doc', {
      get() {
        return (this.currentTarget as Node | null)?.ownerDocument
          || (this.target as Node | null)?.ownerDocument
          || document;
      },
      configurable: true,
    });
  }
  if (!Object.getOwnPropertyDescriptor(Event.prototype, 'win')) {
    Object.defineProperty(Event.prototype, 'win', {
      get() {
        return (this as any).doc.defaultView || window;
      },
      configurable: true,
    });
  }
} catch { /* skip if Event is unavailable */ }

// ── Node.createEl/createDiv/createSpan (official API puts these on Node, not just HTMLElement) ──
if (!(Node.prototype as any).createEl) {
  (Node.prototype as any).createEl = (HTMLElement.prototype as any).createEl;
}
if (!(Node.prototype as any).createDiv) {
  (Node.prototype as any).createDiv = (HTMLElement.prototype as any).createDiv;
}
if (!(Node.prototype as any).createSpan) {
  (Node.prototype as any).createSpan = (HTMLElement.prototype as any).createSpan;
}

// ── SVG patches ─────────────────────────────────────
if (!(SVGElement.prototype as any).setCssStyles) {
  (SVGElement.prototype as any).setCssStyles = function(styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };
}
if (!(SVGElement.prototype as any).setCssProps) {
  (SVGElement.prototype as any).setCssProps = function(props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
  };
}

// ── Document delegated events ───────────────────────
if (!(Document.prototype as any).on) {
  (Document.prototype as any).on = function(
    type: string, selector: string,
    listener: (this: Document, ev: Event, delegateTarget: HTMLElement) => any,
    options?: boolean | AddEventListenerOptions
  ) {
    const handler = (evt: Event) => {
      const target = (evt.target as HTMLElement)?.closest?.(selector) as HTMLElement | null;
      if (target) listener.call(this, evt, target);
    };
    if (!this._EVENTS) this._EVENTS = {};
    if (!this._EVENTS[type]) this._EVENTS[type] = [];
    this._EVENTS[type].push({ selector, listener, options, callback: handler });
    this.addEventListener(type, handler, options);
  };
}
if (!(Document.prototype as any).off) {
  (Document.prototype as any).off = function(
    type: string, selector: string,
    listener: Function,
    options?: boolean | AddEventListenerOptions
  ) {
    const entries = this._EVENTS?.[type];
    if (!entries) return;
    const idx = entries.findIndex((e: any) => e.selector === selector && e.listener === listener);
    if (idx >= 0) {
      this.removeEventListener(type, entries[idx].callback, options);
      entries.splice(idx, 1);
    }
  };
}

// ── UIEvent patches ─────────────────────────────────
try {
  if (!Object.getOwnPropertyDescriptor(UIEvent.prototype, 'targetNode')) {
    Object.defineProperty(UIEvent.prototype, 'targetNode', {
      get() { return this.target instanceof Node ? this.target : null; },
      configurable: true,
    });
  }
} catch { /* skip */ }

// ── JS Primitive Extensions ─────────────────────────

// String — use defineProperty to avoid polluting for...in loops
if (!(String.prototype as any).contains) {
  Object.defineProperty(String.prototype, 'contains', {
    value: String.prototype.includes,
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(String.prototype as any).format) {
  Object.defineProperty(String.prototype, 'format', {
    value: function(...args: string[]) {
      return this.replace(/{(\d+)}/g, (m: string, i: string) => args[parseInt(i)] ?? m);
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(String as any).isString) {
  (String as any).isString = (obj: any): obj is string => typeof obj === 'string';
}

// Number
if (!(Number as any).isNumber) {
  (Number as any).isNumber = (obj: any): obj is number => typeof obj === 'number' && !isNaN(obj);
}

// Array — use defineProperty so that for...in on arrays does NOT iterate over these methods.
// Many plugins (e.g. obsidian-icons-plugin) use `for (var i in iconSet)` on arrays.
if (!(Array.prototype as any).contains) {
  Object.defineProperty(Array.prototype, 'contains', {
    value: Array.prototype.includes,
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array.prototype as any).remove) {
  Object.defineProperty(Array.prototype, 'remove', {
    value: function<T>(this: T[], item: T): void {
      const idx = this.indexOf(item); if (idx >= 0) this.splice(idx, 1);
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array.prototype as any).first) {
  Object.defineProperty(Array.prototype, 'first', {
    value: function() { return this[0]; },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array.prototype as any).last) {
  Object.defineProperty(Array.prototype, 'last', {
    value: function() { return this[this.length - 1]; },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array.prototype as any).shuffle) {
  Object.defineProperty(Array.prototype, 'shuffle', {
    value: function() {
      for (let i = this.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this[i], this[j]] = [this[j], this[i]];
      }
      return this;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array.prototype as any).unique) {
  Object.defineProperty(Array.prototype, 'unique', {
    value: function() { return [...new Set(this)]; },
    writable: true, configurable: true, enumerable: false,
  });
}
if (!(Array as any).combine) {
  (Array as any).combine = <T>(arrays: T[][]): T[] => ([] as T[]).concat(...arrays);
}

// Math
if (!(Math as any).clamp) {
  (Math as any).clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
}
if (!(Math as any).square) {
  (Math as any).square = (value: number) => value * value;
}

// Object
if (!(Object as any).isEmpty) {
  (Object as any).isEmpty = (obj: Record<string, any>): boolean => {
    for (const _ in obj) return false;
    return true;
  };
}
if (!(Object as any).each) {
  (Object as any).each = <T>(obj: { [key: string]: T }, cb: (value: T, key?: string) => boolean | void, ctx?: any): boolean => {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (cb.call(ctx, obj[key], key) === false) return false;
      }
    }
    return true;
  };
}

// Global functions
if (typeof (window as any).isBoolean !== 'function') {
  (window as any).isBoolean = (obj: any): obj is boolean => typeof obj === 'boolean';
}
if (typeof (window as any).fish !== 'function') {
  (window as any).fish = (selector: string): HTMLElement | null => document.querySelector(selector);
}
if (typeof (window as any).fishAll !== 'function') {
  (window as any).fishAll = (selector: string): HTMLElement[] => Array.from(document.querySelectorAll(selector));
}
if (typeof (window as any).sleep !== 'function') {
  (window as any).sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
}
if (typeof (window as any).nextFrame !== 'function') {
  (window as any).nextFrame = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()));
}
if (typeof (window as any).ready !== 'function') {
  (window as any).ready = (fn: () => any) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };
}
if (typeof (window as any).ajax !== 'function') {
  (window as any).ajax = (options: any) => {
    const xhr = options.req || new XMLHttpRequest();
    xhr.open(options.method || 'GET', options.url);
    if (options.headers) for (const [k, v] of Object.entries(options.headers)) xhr.setRequestHeader(k, v as string);
    if (options.withCredentials) xhr.withCredentials = true;
    xhr.onload = () => options.success?.(xhr.response, xhr);
    xhr.onerror = () => options.error?.(xhr.statusText, xhr);
    xhr.send(options.data ?? null);
  };
}
if (typeof (window as any).ajaxPromise !== 'function') {
  (window as any).ajaxPromise = (options: any): Promise<any> =>
    new Promise((resolve, reject) => {
      (window as any).ajax({ ...options, success: resolve, error: reject });
    });
}

// Set window.moment early
import momentLib from 'moment';
if (!(window as any).moment) { (window as any).moment = momentLib; }

// Node.js environment shims
if (!(window as any).global) { (window as any).global = window; }
if (!(window as any).process) {
  (window as any).process = {
    env: { NODE_ENV: 'production' },
    platform: navigator.platform?.includes('Win') ? 'win32' : navigator.platform?.includes('Mac') ? 'darwin' : 'linux',
    type: 'renderer',
    versions: { electron: '20.0.0' },
    release: { name: 'browser' },
  };
}

// App container shim — add standard Obsidian body classes
if (!document.body.classList.contains('app-container')) {
  document.body.classList.add('app-container');
}
// Platform modifier (plugins check for mod-windows, mod-macos, mod-linux)
const platform = navigator.platform.toLowerCase();
if (platform.includes('mac')) document.body.classList.add('mod-macos');
else if (platform.includes('win')) document.body.classList.add('mod-windows');
else document.body.classList.add('mod-linux');

// Theme mode class (plugins check body.theme-dark / body.theme-light)
if (!document.body.classList.contains('theme-dark') && !document.body.classList.contains('theme-light')) {
  document.body.classList.add('theme-dark');
}

// Obsidian's class helpers also work on SVG nodes. Plugins commonly query an
// icon's <svg> and call addClass/removeClass directly on that Element.
const elementPrototype = Element.prototype as any;
if (!elementPrototype.addClass) {
  elementPrototype.addClass = function (...classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.add(...cls.split(' ').filter(Boolean));
    }
  };
}
if (!elementPrototype.removeClass) {
  elementPrototype.removeClass = function (...classes: string[]) {
    for (const cls of classes) {
      if (cls) this.classList.remove(...cls.split(' ').filter(Boolean));
    }
  };
}
if (!elementPrototype.toggleClass) {
  elementPrototype.toggleClass = function (cls: string, value?: boolean) {
    this.classList.toggle(cls, value);
  };
}
if (!elementPrototype.hasClass) {
  elementPrototype.hasClass = function (cls: string) {
    return this.classList.contains(cls);
  };
}

// is-focused — toggle on window focus/blur
document.body.classList.add('is-focused');
window.addEventListener('focus', () => document.body.classList.add('is-focused'));
window.addEventListener('blur', () => document.body.classList.remove('is-focused'));

// activeWindow / activeDocument
if (!(window as any).activeWindow) { (window as any).activeWindow = window; }
if (!(window as any).activeDocument) { (window as any).activeDocument = document; }

// DocumentFragment patches (guard duplicates from the block above)
if (!(DocumentFragment.prototype as any).find) {
  (DocumentFragment.prototype as any).find = function(s: string) { return this.querySelector(s); };
}
if (!(DocumentFragment.prototype as any).findAll) {
  (DocumentFragment.prototype as any).findAll = function(s: string) { return Array.from(this.querySelectorAll(s)); };
}

export {};
