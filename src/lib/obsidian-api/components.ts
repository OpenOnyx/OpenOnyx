/**
 * Obsidian API Compatibility — Core Components
 * Events, Component, Modal, Notice, Setting, UI widgets
 */
import { Scope, setIcon } from './utils';

function getCurrentPluginScopeClass(): string | null {
  const win = window as any;
  const pluginId = typeof win.__oo_active_plugin_id === 'string'
    ? win.__oo_active_plugin_id
    : null;
  if (pluginId) return `oo-plugin-scope-${pluginId}`;

  const stack = new Error().stack || '';
  const pluginBlobUrls = win.__oo_plugin_blob_urls as Map<string, string> | undefined;
  if (!pluginBlobUrls) return null;
  for (const [blobUrl, id] of pluginBlobUrls) {
    if (stack.includes(blobUrl)) return `oo-plugin-scope-${id}`;
  }
  return null;
}

// ── EventRef ────────────────────────────────────────
export interface EventRef {
  _eventName: string;
  _callback: (...args: any[]) => any;
  _ctx?: any;
  _events?: Events;
}

// ── Events ──────────────────────────────────────────
export class Events {
  private _eventsMap: Map<string, Array<{ cb: (...args: any[]) => any; ctx?: any }>> = new Map();

  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    if (!this._eventsMap.has(name)) this._eventsMap.set(name, []);
    this._eventsMap.get(name)!.push({ cb: callback, ctx });
    return { _eventName: name, _callback: callback, _ctx: ctx, _events: this };
  }

  off(name: string, callback: (...data: any[]) => any): void {
    const handlers = this._eventsMap.get(name);
    if (!handlers) return;
    const idx = handlers.findIndex(h => h.cb === callback);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  offref(ref: EventRef): void {
    if (!ref) return;
    this.off(ref._eventName, ref._callback);
  }

  trigger(name: string, ...data: any[]): void {
    const handlers = this._eventsMap.get(name);
    if (!handlers) return;
    for (const h of [...handlers]) {
      try { h.cb.apply(h.ctx, data); } catch (e) { console.error(`[Plugin Event Error] ${name}:`, e); }
    }
  }

  tryTrigger(evt: EventRef, args: any[]): void {
    try { evt._callback.apply(evt._ctx, args); } catch { /* silent */ }
  }
}

// ── Component ───────────────────────────────────────
// Function-based constructor for ES5 plugin compatibility.
// Many Obsidian plugins are compiled to ES5, which transpiles
// `class extends Plugin` to `Plugin.call(this)`. ES6 classes
// reject being called without `new`, so we use functions instead.

/** Interface for Component instances (used for TypeScript typing) */
export interface IComponent {
  _loaded: boolean;
  _children: any[];
  _events: EventRef[];
  _domEvents: Array<{ el: EventTarget; type: string; handler: any }>;
  _intervals: number[];
  _registeredCallbacks: Array<() => any>;
  load(): void;
  onload(): void;
  unload(): void;
  onunload(): void;
  addChild(child: any): any;
  removeChild(child: any): any;
  register(cb: () => any): void;
  registerEvent(eventRef: EventRef): void;
  registerDomEvent(el: EventTarget, type: string, callback: (evt: any) => any, options?: boolean | AddEventListenerOptions): void;
  registerInterval(id: number): number;
}

/** Component constructor type for TypeScript class extension */
export interface ComponentConstructor {
  new(...args: any[]): IComponent;
  prototype: IComponent;
}

function _Component(this: any) {
  this._loaded = false;
  this._children = [];
  this._events = [];
  this._domEvents = [];
  this._intervals = [];
  this._registeredCallbacks = [];
}

_Component.prototype.load = function () {
  this._loaded = true;
  return this.onload();
};

_Component.prototype.onload = function () { /* override */ };

_Component.prototype.unload = function () {
  this._loaded = false;
  for (const child of this._children) child.unload();
  this._children = [];
  for (const de of this._domEvents) de.el.removeEventListener(de.type, de.handler);
  this._domEvents = [];
  for (const evt of this._events) {
    if (evt && evt._events) {
      evt._events.offref(evt);
    }
  }
  this._events = [];
  for (const id of this._intervals) window.clearInterval(id);
  this._intervals = [];
  for (const cb of this._registeredCallbacks.splice(0).reverse()) {
    try { cb(); } catch (e) { console.error('[Plugin Cleanup Error]', e); }
  }
  this.onunload();
};

_Component.prototype.onunload = function () { /* override */ };

_Component.prototype.addChild = function (child: any) {
  this._children.push(child);
  if (this._loaded) child.load();
  return child;
};

_Component.prototype.removeChild = function (child: any) {
  const idx = this._children.indexOf(child);
  if (idx >= 0) { this._children.splice(idx, 1); child.unload(); }
  return child;
};

_Component.prototype.register = function (cb: () => any) {
  this._registeredCallbacks.push(cb);
};

_Component.prototype.registerEvent = function (eventRef: EventRef) {
  this._events.push(eventRef);
};

_Component.prototype.registerDomEvent = function (
  el: EventTarget, type: string, callback: (evt: any) => any, options?: boolean | AddEventListenerOptions
) {
  // Plugins frequently probe optional desktop-only controls (such as native
  // ribbon/title-bar buttons). There is no element to register against when a
  // host does not expose that control.
  if (!el?.addEventListener) return;
  el.addEventListener(type, callback, options);
  this._domEvents.push({ el, type, handler: callback });
};

_Component.prototype.registerInterval = function (id: number): number {
  this._intervals.push(id);
  return id;
};

// Cast the function constructor to the class-like type so it works in extends
export const Component = _Component as unknown as ComponentConstructor;

// ── Notice ──────────────────────────────────────────
export interface Notice {
  noticeEl: HTMLElement;
  setMessage(message: string | DocumentFragment): this;
  hide(): void;
}
export function Notice(this: any, message: string | DocumentFragment, duration?: number) {
  // Keep plugin notifications informative without allowing a repeated failure
  // to leave an opaque card over the application indefinitely.
  const ms = duration && duration > 0 ? Math.min(duration, 10_000) : 5000;
  const messageText = typeof message === 'string' ? message : message.textContent || '';

  let container = document.querySelector('.oo-notice-container') as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.className = 'oo-notice-container';
    document.body.appendChild(container);
  }

  // Plugins can report the same exception repeatedly while recovering. Keep
  // the original timer for an identical notice instead of covering the UI
  // with a new card on every error.
  const duplicate = Array.from(container.children).find(
    (child) => (child as HTMLElement).dataset.ooNoticeMessage === messageText,
  ) as HTMLElement | undefined;
  if (duplicate) {
    this.noticeEl = duplicate;
    return;
  }

  this.noticeEl = document.createElement('div');
  this.noticeEl.className = 'oo-notice';
  this.noticeEl.dataset.ooNoticeMessage = messageText;
  if (typeof message === 'string') {
    this.noticeEl.textContent = message;
  } else {
    this.noticeEl.appendChild(message);
  }
  container.appendChild(this.noticeEl);

  while (container.children.length > 3) {
    container.firstElementChild?.remove();
  }

  if (ms > 0) {
    this._timeout = window.setTimeout(() => this.hide(), ms);
  }
}

Notice.prototype.setMessage = function(message: string | DocumentFragment) {
  this.noticeEl.textContent = '';
  if (typeof message === 'string') this.noticeEl.textContent = message;
  else this.noticeEl.appendChild(message);
  return this;
};

Notice.prototype.hide = function() {
  if (this._timeout) window.clearTimeout(this._timeout);
  this.noticeEl.remove();
};

// ── Modal ───────────────────────────────────────────
export interface Modal {
  app: any;
  scope: any;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  closeButtonEl: HTMLButtonElement;
  open(): void;
  close(): void;
  onOpen(): void;
  onClose(): void;
  setTitle(title: string): this;
  setContent(content: string | DocumentFragment): this;
  setCloseCallback(callback: () => void): this;
}
export function Modal(this: any, app: any) {
  this.app = app || (window as any).__oo_app;
  this.scope = new Scope();
  this.dimBackground = true;
  this.containerEl = document.createElement('div');
  this.containerEl.className = 'modal-container oo-plugin-modal-container oo-plugin-view';
  const scopeClass = getCurrentPluginScopeClass();
  if (scopeClass) this.containerEl.classList.add(scopeClass);
  this.modalEl = document.createElement('div');
  this.modalEl.className = 'modal oo-plugin-modal';
  this.titleEl = document.createElement('div');
  this.titleEl.className = 'modal-title';
  this.contentEl = document.createElement('div');
  this.contentEl.className = 'modal-content';
  this.closeButtonEl = document.createElement('button');
  this.closeButtonEl.className = 'modal-close-button';
  this.closeButtonEl.type = 'button';
  this.closeButtonEl.setAttribute('aria-label', 'Close');
  this.closeButtonEl.textContent = '×';
  this.closeButtonEl.addEventListener('click', () => this.close());
  this.modalEl.appendChild(this.closeButtonEl);
  this.modalEl.appendChild(this.titleEl);
  this.modalEl.appendChild(this.contentEl);

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.addEventListener('click', () => this.close());
  this.containerEl.appendChild(bg);
  this.containerEl.appendChild(this.modalEl);

  // Prevent clicks inside modal from closing it
  this.modalEl.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

  // Popper-based plugin suggesters close themselves on input blur. Keep the
  // input focused while a suggestion is clicked so the item handler can run.
  this.containerEl.addEventListener('mousedown', (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.suggestion-container')) {
      event.preventDefault();
    }
  }, true);

  this._onGlobalKeyDown = (e: KeyboardEvent) => {
    // Dispatch through the modal's scope first (plugins register hotkeys here)
    if (this.scope && this.scope.handleKey) {
      if (this.scope.handleKey(e)) return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };
}

Modal.prototype.open = function() {
  const scopeClass = getCurrentPluginScopeClass();
  if (scopeClass) this.containerEl.classList.add(scopeClass);
  document.body.appendChild(this.containerEl);
  window.addEventListener('keydown', this._onGlobalKeyDown);
  this.onOpen();
};

Modal.prototype.close = function() {
  window.removeEventListener('keydown', this._onGlobalKeyDown);
  this.onClose();
  this.containerEl.remove();
};

Modal.prototype.onOpen = function() {};
Modal.prototype.onClose = function() {};
Modal.prototype.setTitle = function(title: string) {
  this.titleEl.textContent = title;
  return this;
};
Modal.prototype.setContent = function(content: string | DocumentFragment) {
  this.contentEl.empty();
  if (typeof content === 'string') this.contentEl.textContent = content;
  else this.contentEl.appendChild(content);
  return this;
};
Modal.prototype.setCloseCallback = function(callback: () => void) {
  const previous = this.onClose.bind(this);
  this.onClose = () => {
    previous();
    callback();
  };
  return this;
};

// ── Setting ─────────────────────────────────────────
export interface Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  errorEl: HTMLElement | null;
  components: any[];
  setErrorMessage(message: string | null): this;
  addDisplayValue(cb: (component: any) => any): this;
  setName(name: string | DocumentFragment): this;
  setDesc(desc: string | DocumentFragment): this;
  setClass(cls: string): this;
  setHeading(): this;
  setDisabled(disabled: boolean): this;
  setVisibility(visible: boolean): this;
  setTooltip(tooltip: string): this;
  addText(cb: (component: TextComponent) => any): this;
  addTextArea(cb: (component: TextAreaComponent) => any): this;
  addToggle(cb: (component: ToggleComponent) => any): this;
  addButton(cb: (component: ButtonComponent) => any): this;
  addDropdown(cb: (component: DropdownComponent) => any): this;
  addSlider(cb: (component: SliderComponent) => any): this;
  addExtraButton(cb: (component: ExtraButtonComponent) => any): this;
  addColorPicker(cb: (component: ColorComponent) => any): this;
  addSearch(cb: (component: SearchComponent) => any): this;
  addProgressBar(cb: (component: any) => any): this;
  addMomentFormat(cb: (component: any) => any): this;
  addComponent<T>(cb: (el: HTMLElement) => T): this;
  then(cb: (setting: this) => any): this;
  clear(): this;
}
export function Setting(this: any, containerEl: HTMLElement) {
  this.settingEl = document.createElement('div');
  this.settingEl.className = 'setting-item oo-plugin-setting';
  this.infoEl = document.createElement('div');
  this.infoEl.className = 'setting-item-info';
  this.nameEl = document.createElement('div');
  this.nameEl.className = 'setting-item-name';
  this.descEl = document.createElement('div');
  this.descEl.className = 'setting-item-description';
  this.controlEl = document.createElement('div');
  this.controlEl.className = 'setting-item-control';
  this.infoEl.appendChild(this.nameEl);
  this.infoEl.appendChild(this.descEl);
  this.settingEl.appendChild(this.infoEl);
  this.settingEl.appendChild(this.controlEl);
  this.components = [];
  this.errorEl = null;
  containerEl.appendChild(this.settingEl);
}

Setting.prototype.setErrorMessage = function(message: string | null) {
  if (!message) {
    this.errorEl?.remove();
    this.errorEl = null;
    return this;
  }
  if (!this.errorEl) {
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'setting-item-error';
    this.infoEl.appendChild(this.errorEl);
  }
  this.errorEl.textContent = message;
  return this;
};

Setting.prototype.addDisplayValue = function(cb: (component: any) => any) {
  const valueEl = document.createElement('span');
  valueEl.className = 'setting-item-display-value';
  this.controlEl.appendChild(valueEl);
  const component = {
    valueEl,
    setValue(value: any) {
      valueEl.textContent = value?.toString?.() ?? String(value ?? '');
      return this;
    },
    then(callback: (value: any) => any) {
      callback(this);
      return this;
    },
  };
  this.components.push(component);
  cb(component);
  return this;
};

Setting.prototype.setName = function(name: string | DocumentFragment) {
  this.nameEl.textContent = '';
  if (typeof name === 'string') this.nameEl.textContent = name;
  else this.nameEl.appendChild(name);
  return this;
};

Setting.prototype.setDesc = function(desc: string | DocumentFragment) {
  this.descEl.textContent = '';
  if (typeof desc === 'string') this.descEl.textContent = desc;
  else this.descEl.appendChild(desc);
  return this;
};

Setting.prototype.setClass = function(cls: string) { this.settingEl.classList.add(cls); return this; };
Setting.prototype.setHeading = function() { this.settingEl.classList.add('setting-item-heading'); return this; };
Setting.prototype.setDisabled = function(disabled: boolean) { this.settingEl.classList.toggle('is-disabled', disabled); return this; };
Setting.prototype.setVisibility = function(visible: boolean) {
  this.settingEl.classList.toggle('is-hidden', !visible);
  this.settingEl.toggleAttribute('hidden', !visible);
  return this;
};
Setting.prototype.setTooltip = function(tooltip: string) { this.settingEl.dataset.tooltip = tooltip; this.settingEl.removeAttribute("title"); return this; };

Setting.prototype.addText = function(cb: (component: TextComponent) => any) {
  const comp = new TextComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addTextArea = function(cb: (component: TextAreaComponent) => any) {
  const comp = new TextAreaComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addToggle = function(cb: (component: ToggleComponent) => any) {
  const comp = new ToggleComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addButton = function(cb: (component: ButtonComponent) => any) {
  const comp = new ButtonComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addDropdown = function(cb: (component: DropdownComponent) => any) {
  const comp = new DropdownComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addSlider = function(cb: (component: SliderComponent) => any) {
  const comp = new SliderComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addExtraButton = function(cb: (component: ExtraButtonComponent) => any) {
  const comp = new ExtraButtonComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addColorPicker = function(cb: (component: ColorComponent) => any) {
  const comp = new ColorComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addSearch = function(cb: (component: SearchComponent) => any) {
  const comp = new SearchComponent(this.controlEl);
  this.components.push(comp);
  cb(comp);
  return this;
};

Setting.prototype.addProgressBar = function(cb: (component: any) => any) { return this; };
Setting.prototype.addMomentFormat = function(cb: (component: any) => any) { return this; };
Setting.prototype.addComponent = function<T>(cb: (el: HTMLElement) => T) { cb(this.controlEl); return this; };

Setting.prototype.then = function(cb: (setting: any) => any) { cb(this); return this; };

Setting.prototype.clear = function() {
  this.controlEl.innerHTML = '';
  this.nameEl.textContent = '';
  this.descEl.textContent = '';
  this.components = [];
  return this;
};

// ── SettingTab ───────────────────────────────────────
export interface ISettingTab {
  app: any;
  containerEl: HTMLElement;
  icon: string;
  display(): void;
  hide(): void;
}

export interface SettingTabConstructor {
  new(app?: any): ISettingTab;
  prototype: ISettingTab;
}

function _SettingTab(this: any, app?: any) {
  this.app = app;
  this.containerEl = document.createElement('div');
  this.containerEl.className = 'oo-plugin-setting-tab';
  this.icon = '';
}
_SettingTab.prototype.display = function() {};
_SettingTab.prototype.hide = function() {
  if (this.containerEl) this.containerEl.innerHTML = '';
};

export type SettingTab = ISettingTab;
export const SettingTab = _SettingTab as unknown as SettingTabConstructor;

export interface IPluginSettingTab extends ISettingTab {
  plugin: any;
}

export interface PluginSettingTabConstructor {
  new(app: any, plugin: any): IPluginSettingTab;
  prototype: IPluginSettingTab;
}

function _PluginSettingTab(this: any, app: any, plugin: any) {
  _SettingTab.call(this, app);
  this.plugin = plugin;
}
_PluginSettingTab.prototype = Object.create(_SettingTab.prototype);
_PluginSettingTab.prototype.constructor = _PluginSettingTab;

export type PluginSettingTab = IPluginSettingTab;
export const PluginSettingTab = _PluginSettingTab as unknown as PluginSettingTabConstructor;

// ── Menu ────────────────────────────────────────────
export class Menu {
  dom: HTMLElement;
  items: MenuItem[] = [];
  activeSubmenu: Menu | null = null;
  private _onHideCallbacks: Array<() => void> = [];
  private _parentEl: HTMLElement | null = null;
  private _useNativeMenu = false;
  private _component = new (Component as any)();

  constructor() {
    this.dom = document.createElement('div');
    this.dom.className = 'menu oo-plugin-menu';
  }

  load(): void { this._component.load(); }
  onload(): void {}
  unload(): void { this.close(); this._component.unload(); }
  onunload(): void {}
  addChild(child: any): any { return this._component.addChild(child); }
  removeChild(child: any): any { return this._component.removeChild(child); }
  register(callback: () => any): void { this._component.register(callback); }
  registerEvent(eventRef: EventRef): void { this._component.registerEvent(eventRef); }
  registerDomEvent(
    el: EventTarget,
    type: string,
    callback: (evt: any) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this._component.registerDomEvent(el, type, callback, options);
  }
  registerInterval(id: number): number { return this._component.registerInterval(id); }

  addItem(cb: (item: MenuItem) => any): this {
    const item = new MenuItem();
    item.parentMenu = this;
    cb(item);
    this.items.push(item);
    this.dom.appendChild(item.dom);
    return this;
  }

  addSeparator(): this {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    this.dom.appendChild(sep);
    return this;
  }

  setNoIcon(): this {
    this.dom.classList.add('menu-no-icons');
    return this;
  }

  setUseNativeMenu(useNativeMenu: boolean): this {
    this._useNativeMenu = useNativeMenu;
    return this;
  }

  setParentElement(el: HTMLElement): this {
    this._parentEl = el;
    return this;
  }

  onHide(callback: () => void): this {
    this._onHideCallbacks.push(callback);
    return this;
  }

  forEvent(evt: MouseEvent): this {
    return this.showAtMouseEvent(evt);
  }

  hideActiveSubmenu() {
    if (this.activeSubmenu) {
      this.activeSubmenu.close();
      this.activeSubmenu = null;
    }
  }

  private _closeHandler: ((e: any) => void) | null = null;
  private _keyHandler: ((e: any) => void) | null = null;

  showAtMouseEvent(evt: MouseEvent): this {
    // Dismiss any existing menus first
    document.querySelectorAll('.oo-plugin-menu').forEach(el => el.remove());

    const clientX = typeof evt?.clientX === 'number' && !isNaN(evt.clientX) ? evt.clientX : 100;
    const clientY = typeof evt?.clientY === 'number' && !isNaN(evt.clientY) ? evt.clientY : 100;

    this.dom.style.position = 'fixed';
    this.dom.style.left = `${Math.max(10, clientX)}px`;
    this.dom.style.top = `${Math.max(10, clientY)}px`;
    this.dom.style.zIndex = '99999';
    this.dom.style.visibility = 'visible';
    this.dom.style.display = 'block';
    (this._parentEl || document.body).appendChild(this.dom);

    // Adjust position so it fits within screen bounds
    requestAnimationFrame(() => {
      const rect = this.dom.getBoundingClientRect();
      let left = clientX;
      let top = clientY;

      if (left + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width - 10;
      }
      if (top + rect.height > window.innerHeight) {
        top = window.innerHeight - rect.height - 10;
      }

      this.dom.style.left = `${Math.max(10, left)}px`;
      this.dom.style.top = `${Math.max(10, top)}px`;
    });

    const isTargetInMenuOrSubmenus = (menu: Menu, target: Node): boolean => {
      if (menu.dom.contains(target)) return true;
      if (menu.activeSubmenu && isTargetInMenuOrSubmenus(menu.activeSubmenu, target)) return true;
      return false;
    };

    const close = (e: MouseEvent) => {
      if (!isTargetInMenuOrSubmenus(this, e.target as Node)) {
        this.close();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };

    this._closeHandler = close;
    this._keyHandler = handleKey;

    setTimeout(() => {
      if (this._closeHandler === close) {
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('mousedown', close, true);
        document.addEventListener('keydown', handleKey, true);
      }
    }, 100);
    return this;
  }

  showAtPosition(pos: { x: number; y: number }): this {
    return this.showAtMouseEvent({ clientX: pos.x, clientY: pos.y } as MouseEvent);
  }

  hide(): this { this.close(); return this; }
  close(): void {
    this.hideActiveSubmenu();
    this.dom.remove();
    if (this._closeHandler) {
      document.removeEventListener('pointerdown', this._closeHandler, true);
      document.removeEventListener('mousedown', this._closeHandler, true);
      this._closeHandler = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    for (const callback of this._onHideCallbacks.splice(0)) callback();
  }
}

export class MenuItem {
  dom: HTMLElement;
  parentMenu?: Menu;
  submenu?: Menu;
  private _callback?: (evt: MouseEvent | KeyboardEvent) => any;

  constructor() {
    this.dom = document.createElement('div');
    this.dom.className = 'menu-item';
    const titleEl = document.createElement('div');
    titleEl.className = 'menu-item-title';
    this.dom.appendChild(titleEl);

    this.dom.addEventListener('click', (e) => {
      if (this.submenu) {
        e.stopPropagation();
        return;
      }
      this._callback?.(e);
      if (this.parentMenu) {
        this.parentMenu.close();
      }
      // Dismiss all open menus
      document.querySelectorAll('.oo-plugin-menu').forEach(el => el.remove());
    });

    this.dom.addEventListener('mouseenter', () => {
      if (this.parentMenu) {
        this.parentMenu.hideActiveSubmenu();
      }
      if (this.submenu) {
        const rect = this.dom.getBoundingClientRect();
        let left = rect.right;
        let top = rect.top;

        this.submenu.dom.style.position = 'fixed';
        this.submenu.dom.style.visibility = 'hidden';
        document.body.appendChild(this.submenu.dom);

        requestAnimationFrame(() => {
          const subRect = this.submenu!.dom.getBoundingClientRect();
          if (left + subRect.width > window.innerWidth) {
            left = rect.left - subRect.width;
          }
          if (top + subRect.height > window.innerHeight) {
            top = window.innerHeight - subRect.height - 10;
          }
          this.submenu!.dom.style.left = `${Math.max(10, left)}px`;
          this.submenu!.dom.style.top = `${Math.max(10, top)}px`;
          this.submenu!.dom.style.visibility = 'visible';
        });

        if (this.parentMenu) {
          this.parentMenu.activeSubmenu = this.submenu;
        }
      }
    });
  }

  setTitle(title: string | DocumentFragment): this {
    const titleEl = this.dom.querySelector('.menu-item-title') as HTMLElement;
    if (typeof title === 'string') titleEl.textContent = title;
    else { titleEl.textContent = ''; titleEl.appendChild(title); }
    return this;
  }

  setIcon(icon: string): this {
    this.dom.setAttribute('data-icon', icon);
    
    // Add an icon container
    let iconEl = this.dom.querySelector('.menu-item-icon') as HTMLElement;
    if (!iconEl) {
      iconEl = document.createElement('div');
      iconEl.className = 'menu-item-icon';
      this.dom.prepend(iconEl);
    }
    
    // Use the official setIcon to populate the SVG
    setIcon(iconEl, icon);
    
    return this;
  }

  setSubmenu(): Menu {
    const submenu = new Menu();
    this.submenu = submenu;
    this.dom.classList.add('has-submenu');

    let indicator = this.dom.querySelector('.menu-item-submenu-indicator') as HTMLElement;
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'menu-item-submenu-indicator';
      indicator.textContent = '▶';
      this.dom.appendChild(indicator);
    }

    return submenu;
  }

  setChecked(checked: boolean): this { this.dom.classList.toggle('is-checked', checked); return this; }
  setDisabled(disabled: boolean): this { this.dom.classList.toggle('is-disabled', disabled); return this; }
  setWarning(isWarning: boolean): this { this.dom.classList.toggle('mod-warning', isWarning); return this; }
  setIsLabel(isLabel: boolean): this { this.dom.classList.toggle('is-label', isLabel); return this; }
  setSection(section: string): this { return this; }

  onClick(callback: (evt: MouseEvent | KeyboardEvent) => any): this {
    this._callback = callback;
    return this;
  }
}

// ── UI Widget Components ────────────────────────────

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
    this.buttonEl.className = 'oo-plugin-btn';
    containerEl.appendChild(this.buttonEl);
  }
  setButtonText(name: string): this { this.buttonEl.textContent = name; return this; }
  setCta(): this { this.buttonEl.classList.add('mod-cta'); return this; }
  setWarning(): this { this.buttonEl.classList.add('mod-warning'); return this; }
  setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
  setLoading(loading: boolean): this {
    this.buttonEl.classList.toggle('is-loading', loading);
    this.buttonEl.setAttribute('aria-busy', String(loading));
    return this;
  }
  setIcon(icon: string): this {
    setIcon(this.buttonEl, icon);
    this.buttonEl.classList.add('has-icon');
    return this;
  }
  setTooltip(tooltip: string): this { this.buttonEl.dataset.tooltip = tooltip; this.buttonEl.removeAttribute("title"); return this; }
  removeCta(): this { this.buttonEl.classList.remove('mod-cta'); return this; }
  setDestructive(): this { this.buttonEl.classList.add('mod-destructive'); return this; }
  removeDestructive(): this { this.buttonEl.classList.remove('mod-destructive'); return this; }
  onClick(callback: (evt: MouseEvent) => any): this {
    this.buttonEl.addEventListener('click', (e) => {
      e.preventDefault();
      callback(e);
    });
    return this;
  }
  setClass(cls: string): this { this.buttonEl.classList.add(cls); return this; }
  then(cb: (component: this) => any): this { cb(this); return this; }
}

export class TextComponent {
  inputEl: HTMLInputElement;
  private _onChange?: (value: string) => any;
  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'oo-plugin-text-input';
    containerEl.appendChild(this.inputEl);
    this.inputEl.addEventListener('input', () => this._onChange?.(this.inputEl.value));
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // Many plugins assume Enter submits if there's only one input
        this.inputEl.blur();
      }
    });
  }
  getValue(): string { return this.inputEl.value; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
  setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; return this; }
  onChange(callback: (value: string) => any): this { this._onChange = callback; return this; }
  onChanged(): this { this._onChange?.(this.inputEl.value); return this; }
  then(cb: (component: this) => any): this { cb(this); return this; }
  setClass(cls: string): this { this.inputEl.classList.add(cls); return this; }
}

export class TextAreaComponent {
  inputEl: HTMLTextAreaElement;
  private _onChange?: (value: string) => any;
  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('textarea');
    this.inputEl.className = 'oo-plugin-textarea';
    containerEl.appendChild(this.inputEl);
    this.inputEl.addEventListener('input', () => this._onChange?.(this.inputEl.value));
  }
  getValue(): string { return this.inputEl.value; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
  setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; return this; }
  onChange(callback: (value: string) => any): this { this._onChange = callback; return this; }
}

export class ToggleComponent {
  toggleEl: HTMLElement;
  private _value = false;
  private _onChange?: (value: boolean) => any;
  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement('div');
    this.toggleEl.className = 'checkbox-container oo-plugin-toggle';
    this.toggleEl.addEventListener('click', () => { this.setValue(!this._value); this._onChange?.(this._value); });
    containerEl.appendChild(this.toggleEl);
  }
  getValue(): boolean { return this._value; }
  setValue(on: boolean): this {
    this._value = on;
    this.toggleEl.classList.toggle('is-enabled', on);
    return this;
  }
  setDisabled(disabled: boolean): this { this.toggleEl.classList.toggle('is-disabled', disabled); return this; }
  setTooltip(tooltip: string): this { this.toggleEl.dataset.tooltip = tooltip; this.toggleEl.removeAttribute("title"); return this; }
  onClick(): void { /* compat */ }
  onChange(callback: (value: boolean) => any): this { this._onChange = callback; return this; }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  private _onChange?: (value: string) => any;
  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement('select');
    this.selectEl.className = 'dropdown oo-plugin-dropdown';
    containerEl.appendChild(this.selectEl);
    this.selectEl.addEventListener('change', () => this._onChange?.(this.selectEl.value));
  }
  getValue(): string { return this.selectEl.value; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  addOption(value: string, display: string): this {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = display;
    this.selectEl.appendChild(opt);
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [k, v] of Object.entries(options)) this.addOption(k, v);
    return this;
  }
  setDisabled(disabled: boolean): this { this.selectEl.disabled = disabled; return this; }
  onChange(callback: (value: string) => any): this { this._onChange = callback; return this; }
}

export class SliderComponent {
  sliderEl: HTMLInputElement;
  private _onChange?: (value: number) => any;
  constructor(containerEl: HTMLElement) {
    this.sliderEl = document.createElement('input');
    this.sliderEl.type = 'range';
    this.sliderEl.className = 'slider oo-plugin-slider';
    containerEl.appendChild(this.sliderEl);
    this.sliderEl.addEventListener('input', () => this._onChange?.(this.getValue()));
  }
  getValue(): number { return parseFloat(this.sliderEl.value); }
  setValue(value: number): this { this.sliderEl.value = String(value); return this; }
  setLimits(min: number, max: number, step: number | 'any'): this {
    this.sliderEl.min = String(min); this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  getValuePretty(): string { return this.sliderEl.value; }
  setDynamicTooltip(): this { return this; }
  showTooltip(): void { /* compat */ }
  setDisabled(disabled: boolean): this { this.sliderEl.disabled = disabled; return this; }
  setInstant(instant: boolean): this { return this; }
  onChange(callback: (value: number) => any): this { this._onChange = callback; return this; }
}

export class SearchComponent {
  inputEl: HTMLInputElement;
  clearButtonEl: HTMLElement;
  private _onChange?: (value: string) => any;
  constructor(containerEl: HTMLElement) {
    const wrapper = document.createElement('div');
    wrapper.className = 'search-input-container';
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'search';
    this.inputEl.className = 'oo-plugin-search-input';
    this.clearButtonEl = document.createElement('div');
    this.clearButtonEl.className = 'search-input-clear-button';
    this.clearButtonEl.addEventListener('click', () => { this.inputEl.value = ''; this._onChange?.(''); });
    wrapper.appendChild(this.inputEl);
    wrapper.appendChild(this.clearButtonEl);
    containerEl.appendChild(wrapper);
    this.inputEl.addEventListener('input', () => this._onChange?.(this.inputEl.value));
  }
  getValue(): string { return this.inputEl.value; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
  onChange(callback: (value: string) => any): this { this._onChange = callback; return this; }
  onChanged(): void { /* compat */ }
}

export class ExtraButtonComponent {
  extraSettingsEl: HTMLElement;
  private _onClick?: (evt: MouseEvent) => any;
  constructor(containerEl: HTMLElement) {
    this.extraSettingsEl = document.createElement('div');
    this.extraSettingsEl.className = 'extra-setting-button oo-plugin-extra-btn';
    containerEl.appendChild(this.extraSettingsEl);
    this.extraSettingsEl.addEventListener('click', (e) => this._onClick?.(e));
  }
  setIcon(icon: string): this { setIcon(this.extraSettingsEl, icon); return this; }
  setTooltip(tooltip: string): this { this.extraSettingsEl.dataset.tooltip = tooltip; this.extraSettingsEl.removeAttribute("title"); return this; }
  setDisabled(disabled: boolean): this { this.extraSettingsEl.classList.toggle('is-disabled', disabled); return this; }
  onClick(callback: (evt: MouseEvent) => any): this { this._onClick = callback; return this; }
}

export class ColorComponent {
  colorPickerEl: HTMLInputElement;
  private _onChange?: (value: string) => any;
  constructor(containerEl: HTMLElement) {
    this.colorPickerEl = document.createElement('input');
    this.colorPickerEl.type = 'color';
    this.colorPickerEl.className = 'oo-plugin-color';
    containerEl.appendChild(this.colorPickerEl);
    this.colorPickerEl.addEventListener('input', () => this._onChange?.(this.colorPickerEl.value));
  }
  getValue(): string { return this.colorPickerEl.value; }
  setValue(value: string): this { this.colorPickerEl.value = value; return this; }
  onChange(callback: (value: string) => any): this { this._onChange = callback; return this; }
}

// ── SuggestModal ────────────────────────────────────
export interface SuggestModal<T> extends Modal {
  limit: number;
  emptyStateText: string;
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  setPlaceholder(placeholder: string): void;
  setInstructions(instructions: Array<{ command: string; purpose: string }>): void;
  onNoSuggestion(): void;
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
  selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void;
  updateSuggestions(): Promise<void>;
  getSuggestions(query: string): T[] | Promise<T[]>;
  renderSuggestion(value: T, el: HTMLElement): void;
  onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}
export function SuggestModal(this: any, app: any) {
  Modal.call(this, app);
  // SuggestModal uses a compact "prompt" layout (no title bar, just input + results)
  this.modalEl.classList.add('prompt');
  this.titleEl.style.display = 'none';
  this.limit = 100;
  this.emptyStateText = 'No results found.';
  this._suggestions = [];
  this._selectedIndex = 0;
  this._suggestionEls = [];

  // Wrap input in prompt-input-container (plugins look for this class)
  const inputContainer = document.createElement('div');
  inputContainer.className = 'prompt-input-container';
  this.inputEl = document.createElement('input');
  this.inputEl.type = 'text';
  this.inputEl.className = 'prompt-input';
  inputContainer.appendChild(this.inputEl);
  this.contentEl.insertBefore(inputContainer, this.contentEl.firstChild);

  this.resultContainerEl = document.createElement('div');
  this.resultContainerEl.className = 'suggestion-container';
  this.contentEl.appendChild(this.resultContainerEl);

  // Chooser API — many plugins access this.chooser directly
  const self = this;
  this.chooser = {
    selectedItem: 0,
    setSelectedItem: function(index: number) {
      const len = self._suggestions.length;
      if (len === 0) { this.selectedItem = 0; return; }
      this.selectedItem = ((index % len) + len) % len;
      self._selectedIndex = this.selectedItem;
      self._updateSelection();
    },
    moveDown: function() { this.setSelectedItem(this.selectedItem + 1); },
    moveUp: function() { this.setSelectedItem(this.selectedItem - 1); },
  };

  this.inputEl.addEventListener('input', () => this.updateSuggestions());
  this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => this._onKeyDown(e));
}

SuggestModal.prototype = Object.create(Modal.prototype);
SuggestModal.prototype.constructor = SuggestModal;

SuggestModal.prototype.setPlaceholder = function(placeholder: string) { this.inputEl.placeholder = placeholder; };
SuggestModal.prototype.setInstructions = function(instructions: Array<{ command: string; purpose: string }>) { /* compat */ };
SuggestModal.prototype.onNoSuggestion = function() { /* compat */ };

SuggestModal.prototype.selectSuggestion = function(value: any, evt: MouseEvent | KeyboardEvent) {
  this.onChooseSuggestion(value, evt);
  this.close();
};

SuggestModal.prototype.selectActiveSuggestion = function(evt: MouseEvent | KeyboardEvent) {
  if (this._suggestions[this._selectedIndex]) {
    this.selectSuggestion(this._suggestions[this._selectedIndex], evt);
  }
};

SuggestModal.prototype.updateSuggestions = async function() {
  const query = this.inputEl.value;
  try {
    const suggestions = await this.getSuggestions(query);
    this._suggestions = (suggestions || []).slice(0, this.limit);
    this._selectedIndex = 0;
    if (this.chooser) this.chooser.selectedItem = 0;
    this._renderSuggestions();
  } catch (e) {
    console.error('[SuggestModal] Failed to get suggestions:', e);
  }
};

SuggestModal.prototype._renderSuggestions = function() {
  this.resultContainerEl.empty();
  this._suggestionEls = [];

  if (this._suggestions.length === 0) {
    const empty = this.resultContainerEl.createDiv('suggestion-empty');
    empty.textContent = this.emptyStateText;
    return;
  }

  this._suggestions.forEach((value: any, index: number) => {
    const el = this.resultContainerEl.createDiv('suggestion-item');
    if (index === this._selectedIndex) el.classList.add('is-selected');

    this.renderSuggestion(value, el);

    el.addEventListener('click', (e: MouseEvent) => this.selectSuggestion(value, e));
    this._suggestionEls.push(el);
  });
};

SuggestModal.prototype._onKeyDown = function(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    this._selectedIndex = (this._selectedIndex + 1) % this._suggestions.length;
    this._updateSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    this._selectedIndex = (this._selectedIndex - 1 + this._suggestions.length) % this._suggestions.length;
    this._updateSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (this._suggestions[this._selectedIndex]) {
      this.selectSuggestion(this._suggestions[this._selectedIndex], e);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    this.close();
  }
};

SuggestModal.prototype._updateSelection = function() {
  this._suggestionEls.forEach((el: HTMLElement, index: number) => {
    el.classList.toggle('is-selected', index === this._selectedIndex);
    if (index === this._selectedIndex) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
};

SuggestModal.prototype.onOpen = function() {
  Modal.prototype.onOpen.call(this);
  setTimeout(() => {
    this.inputEl.focus();
    this.updateSuggestions();
  }, 0);
};

SuggestModal.prototype.getSuggestions = function(query: string) { return []; };
SuggestModal.prototype.renderSuggestion = function(value: any, el: HTMLElement) {};
SuggestModal.prototype.onChooseSuggestion = function(item: any, evt: MouseEvent | KeyboardEvent) {};

export interface FuzzySuggestModal<T> extends SuggestModal<any> {
  getItems(): T[];
  getItemText(item: T): string;
  onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
}
export function FuzzySuggestModal(this: any, app: any) {
  SuggestModal.call(this, app);
}

FuzzySuggestModal.prototype = Object.create(SuggestModal.prototype);
FuzzySuggestModal.prototype.constructor = FuzzySuggestModal;

FuzzySuggestModal.prototype.getItems = function() { return this.items || []; };
FuzzySuggestModal.prototype.getItemText = function(item: any) { return ''; };
FuzzySuggestModal.prototype.onChooseItem = function(item: any, evt: MouseEvent | KeyboardEvent) {};

FuzzySuggestModal.prototype.getSuggestions = function(query: string) {
  const normalizedQuery = query.toLowerCase();
  return this.getItems()
    .map((item: any) => {
      const text = this.getItemText(item);
      const index = text.toLowerCase().indexOf(normalizedQuery);
      if (index < 0) return null;
      return {
        item,
        match: { matches: normalizedQuery ? [[index, index + query.length]] : [] },
      };
    })
    .filter(Boolean);
};
FuzzySuggestModal.prototype.renderSuggestion = function(value: any, el: HTMLElement) {
  el.textContent = this.getItemText(value?.item ?? value);
};
FuzzySuggestModal.prototype.onChooseSuggestion = function(item: any, evt: MouseEvent | KeyboardEvent) {
  this.onChooseItem(item?.item ?? item, evt);
};

// ── AbstractInputSuggest (ES5 — extended by plugins) ──
// Unlike SuggestModal (a full-screen modal), AbstractInputSuggest attaches
// a suggestion dropdown to an existing <input> element within a setting/view.

export interface IAbstractInputSuggest {
  app: any;
  inputEl: HTMLInputElement;
  containerEl: HTMLElement;
  suggestEl: HTMLElement;
  limit: number;
  close(): void;
  open(): void;
  getSuggestions(query: string): any[] | Promise<any[]>;
  renderSuggestion(value: any, el: HTMLElement): void;
  selectSuggestion(value: any, evt: MouseEvent | KeyboardEvent): void;
  onSelect(callback: (value: any, evt: MouseEvent | KeyboardEvent) => void): void;
  setValue(value: string): void;
}

export interface AbstractInputSuggestConstructor {
  new(app: any, inputEl: HTMLInputElement): IAbstractInputSuggest;
  prototype: IAbstractInputSuggest;
}

function _AbstractInputSuggest(this: any, app: any, inputEl: HTMLInputElement) {
  this.app = app || (window as any).__oo_app;
  this.inputEl = inputEl;
  this.limit = 100;
  this._selectedIndex = -1;
  this._suggestions = [] as any[];
  this._selectCallbacks = [] as any[];

  // Create the suggestion dropdown container
  this.suggestEl = document.createElement('div');
  this.suggestEl.className = 'suggestion-container oo-input-suggest';
  this.suggestEl.style.cssText = 'display:none;position:absolute;z-index:9999;max-height:300px;overflow-y:auto;';
  const modalContentEl = inputEl.closest('.modal-content, .modal, .excalidraw-modal') as HTMLElement | null;
  if (modalContentEl) {
    this.suggestEl.classList.add('oo-modal-input-suggest');
    const anchor = inputEl.closest('.setting-item, .prompt-input-container') || inputEl.parentElement || inputEl;
    if (anchor === modalContentEl) {
      modalContentEl.appendChild(this.suggestEl);
    } else {
      anchor.insertAdjacentElement('afterend', this.suggestEl);
    }
  } else {
    document.body.appendChild(this.suggestEl);
  }

  // Create a wrapper for the whole thing
  this.containerEl = document.createElement('div');
  this.containerEl.className = 'suggestion-input-container';

  // Wire up input events
  const self = this;
  const onInput = async () => {
    const query = self.inputEl.value;
    try {
      const suggestions = await Promise.resolve(self.getSuggestions(query));
      self.showSuggestions(suggestions || []);
    } catch (e) {
      console.error('[AbstractInputSuggest] getSuggestions error:', e);
    }
  };

  const onFocus = () => onInput();
  const onBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => self.close(), 200);
  };
  const onKeydown = (evt: KeyboardEvent) => {
    if (!self.suggestEl || self.suggestEl.style.display === 'none') return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      self._selectedIndex = Math.min(self._selectedIndex + 1, self._suggestions.length - 1);
      self._highlightSelected();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      self._selectedIndex = Math.max(self._selectedIndex - 1, 0);
      self._highlightSelected();
    } else if (evt.key === 'Enter' && self._selectedIndex >= 0) {
      evt.preventDefault();
      const item = self._suggestions[self._selectedIndex];
      if (item !== undefined) self.selectSuggestion(item, evt);
    } else if (evt.key === 'Escape') {
      self.close();
    }
  };

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('focus', onFocus);
  inputEl.addEventListener('blur', onBlur);
  inputEl.addEventListener('keydown', onKeydown);

  this._cleanup = () => {
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('focus', onFocus);
    inputEl.removeEventListener('blur', onBlur);
    inputEl.removeEventListener('keydown', onKeydown);
    self.suggestEl?.remove();
  };
}

_AbstractInputSuggest.prototype._renderSuggestions = function() {
  this.suggestEl.innerHTML = '';
  const limit = Math.min(this._suggestions.length, this.limit);
  for (let i = 0; i < limit; i++) {
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    this.renderSuggestion(this._suggestions[i], el);
    const idx = i;
    el.addEventListener('mousedown', (evt: MouseEvent) => {
      evt.preventDefault();
      this.selectSuggestion(this._suggestions[idx], evt);
    });
    el.addEventListener('mouseenter', () => {
      this._selectedIndex = idx;
      this._highlightSelected();
    });
    this.suggestEl.appendChild(el);
  }
  this._selectedIndex = -1;
};

_AbstractInputSuggest.prototype.showSuggestions = function(suggestions: any[] = []) {
  this._suggestions = Array.isArray(suggestions) ? suggestions : [];
  this._renderSuggestions();
  if (this._suggestions.length > 0) this.open();
  else this.close();
};

_AbstractInputSuggest.prototype._highlightSelected = function() {
  const items = this.suggestEl.querySelectorAll('.suggestion-item');
  items.forEach((el: HTMLElement, i: number) => {
    el.classList.toggle('is-selected', i === this._selectedIndex);
  });
};

_AbstractInputSuggest.prototype.open = function() {
  if (!this.inputEl) return;
  if (this.suggestEl.classList.contains('oo-modal-input-suggest')) {
    this.suggestEl.style.display = 'block';
    this.suggestEl.style.position = 'static';
    this.suggestEl.style.top = '';
    this.suggestEl.style.left = '';
    this.suggestEl.style.width = '100%';
    this.suggestEl.style.maxHeight = 'min(42vh, 360px)';
    return;
  }

  const rect = this.inputEl.getBoundingClientRect();
  this.suggestEl.style.display = 'block';
  this.suggestEl.style.top = `${rect.bottom + 2}px`;
  this.suggestEl.style.left = `${rect.left}px`;
  this.suggestEl.style.width = `${rect.width}px`;
};

_AbstractInputSuggest.prototype.close = function() {
  if (this.suggestEl) this.suggestEl.style.display = 'none';
  this._selectedIndex = -1;
};

_AbstractInputSuggest.prototype.getSuggestions = function(_query: string): any[] { return []; };
_AbstractInputSuggest.prototype.renderSuggestion = function(_value: any, _el: HTMLElement) {};
_AbstractInputSuggest.prototype.selectSuggestion = function(value: any, evt: MouseEvent | KeyboardEvent) {
  for (const cb of this._selectCallbacks) {
    try { cb(value, evt); } catch { /* */ }
  }
  this.close();
};

_AbstractInputSuggest.prototype.onSelect = function(callback: (value: any, evt: MouseEvent | KeyboardEvent) => void) {
  this._selectCallbacks.push(callback);
};

_AbstractInputSuggest.prototype.setValue = function(value: string) {
  if (this.inputEl) this.inputEl.value = value;
};

export type AbstractInputSuggest = IAbstractInputSuggest;
export const AbstractInputSuggest = _AbstractInputSuggest as unknown as AbstractInputSuggestConstructor;
