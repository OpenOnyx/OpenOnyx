/**
 * Obsidian API Compatibility — Views & Workspace
 */

import { Events, EventRef, Component } from './components';
import { TFile } from './files';
import { setIcon } from './utils';

// ── WorkspaceLeaf ───────────────────────────────────
export class WorkspaceLeaf extends Events {
  app: any;
  parent: any = null;
  view: View;
  id: string;
  pinned: boolean = false;
  hoverPopover: any = null;
  containerEl: HTMLElement;
  tabHeaderEl: HTMLElement;
  tabHeaderInnerIconEl: HTMLElement;
  tabHeaderInnerTitleEl: HTMLElement;
  activeTime: number = 0;
  side: 'left' | 'right' | 'main' = 'main';
  group: string | null = null;

  constructor(id: string) {
    super();
    this.app = (window as any).__oo_app;
    this.id = id;
    this.view = null as any;
    this.activeTime = Date.now();
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf workspace-leaf-content oo-plugin-leaf';
    this.containerEl.setAttribute('data-type', 'empty');
    // Obsidian sets .win and .doc on containerEl so plugins can distinguish windows
    (this.containerEl as any).win = window;
    (this.containerEl as any).doc = document;
    this.tabHeaderEl = document.createElement('div');
    this.tabHeaderEl.className = 'workspace-tab-header';
    this.tabHeaderInnerIconEl = document.createElement('div');
    this.tabHeaderInnerIconEl.className = 'workspace-tab-header-inner-icon';
    this.tabHeaderInnerTitleEl = document.createElement('div');
    this.tabHeaderInnerTitleEl.className = 'workspace-tab-header-inner-title';
    this.tabHeaderEl.append(this.tabHeaderInnerIconEl, this.tabHeaderInnerTitleEl);
  }

  getRoot(): any {
    // Return the workspace rootSplit so that leaf.getRoot() == workspace.rootSplit is true
    const workspace = (window as any).__oo_app?.workspace;
    return workspace?.rootSplit || this.parent || this;
  }

  getContainer(): any {
    const workspace = (window as any).__oo_app?.workspace;
    const root = workspace?.rootSplit;
    return {
      doc: document,
      win: window,
      containerEl: root?.containerEl || document.body,
      getRoot: () => root || this,
      ...(root || {}),
    };
  }

  async openFile(file: TFile, openState?: any): Promise<void> {
    const workspace = (window as any).__oo_app?.workspace;
    const viewType = workspace?.getViewTypeForExtension?.(file.extension) || 'markdown';
    await this.setViewState({
      type: viewType,
      state: { file: file.path },
      active: openState?.active,
    }, openState?.eState);
    if (openState?.active !== false) workspace?.setActiveLeaf(this);
    // For plugin view types (non-markdown), open as a plugin tab in the React UI
    if (viewType !== 'markdown' && viewType !== 'empty' && this.side === 'main') {
      (window as any).__oo_open_file?.(`__plugin__.${viewType}`);
    } else {
      (window as any).__oo_open_file?.(file.path);
    }
  }

  async open(view: View): Promise<void> {
    this.view = view;
  }

  getViewState(): any {
    return {
      type: this.view?.getViewType?.() || '',
      state: this.view?.getState?.() || {},
      pinned: this.pinned,
    };
  }
  async setViewState(viewState: any, eState?: any): Promise<void> {
    if (viewState?.type) {
      const workspace = (window as any).__oo_app?.workspace;
      if (workspace) {
        await workspace._createViewOnLeaf(this, viewState.type, viewState.state, eState);
      }
    }
    if (typeof viewState?.pinned === 'boolean') this.setPinned(viewState.pinned);
    if (viewState?.group) this.setGroup(viewState.group);
    if (viewState?.active) (window as any).__oo_app?.workspace?.setActiveLeaf(this);
  }
  get isDeferred(): boolean { return false; }
  async loadIfDeferred(): Promise<void> { /* compat */ }
  getEphemeralState(): any { return {}; }
  setEphemeralState(state: any): void { /* compat */ }
  togglePinned(): void { this.setPinned(!this.pinned); }
  setPinned(pinned: boolean): void { this.pinned = pinned; this.trigger('pinned-change', pinned); }
  setGroupMember(other: WorkspaceLeaf): void {
    const group = other.group || `group-${Date.now()}`;
    other.setGroup(group);
    this.setGroup(group);
  }
  setGroup(group: string): void { this.group = group || null; }
  detach(): void { (window as any).__oo_app?.workspace?._detachLeaf(this); }
  getIcon(): string { return this.view?.icon || 'file-text'; }
  getDisplayText(): string { return this.view?.getDisplayText?.() || ''; }
  onResize(): void { this.view?.onResize?.(); }
}

// ── View ────────────────────────────────────────────
export interface View {
  app: any;
  icon: string;
  navigation: boolean;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  pluginId?: string;
  scope: any;
  unload(): void;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
  getViewType(): string;
  getState(): Record<string, any>;
  setState(state: unknown, result: any): Promise<void>;
  getEphemeralState(): Record<string, any>;
  setEphemeralState(state: unknown): void;
  getIcon(): string;
  onResize(): void;
  getDisplayText(): string;
  onPaneMenu(menu: any, source: string): void;
}

export interface ViewActionInfo {
  id: string;
  icon: string;
  title: string;
  el: HTMLElement;
  callback: (evt: MouseEvent) => any;
}

export function View(this: any, leaf: WorkspaceLeaf) {
  Component.call(this);
  this.app = (window as any).__oo_app;
  this.icon = 'file-text';
  this.navigation = true;
  this.leaf = leaf;
  // ItemView CSS in community plugins targets the real workspace leaf. A
  // nested generic `.view-content` breaks selectors such as
  // `.workspace-leaf-content[data-type=kanban] > .view-header`, which puts
  // Kanban actions in the wrong place and invalidates its layout assumptions.
  this._containerEl = leaf.containerEl;
  this._containerEl.classList.add('oo-plugin-view');
  (this._containerEl as any).win = window;
  this.scope = null;

  Object.defineProperty(this, 'containerEl', {
    get: function() { return this._containerEl; },
    set: function(el) { this._containerEl = el; },
    configurable: true
  });
}
View.prototype = Object.create(Component.prototype);
View.prototype.constructor = View;

View.prototype.onOpen = async function() {};
View.prototype.onClose = async function() {};
View.prototype.getViewType = function() { return ''; };
View.prototype.getState = function() { return {}; };
View.prototype.setState = async function(state: unknown, result: any) {};
View.prototype.getEphemeralState = function() { return {}; };
View.prototype.setEphemeralState = function(state: unknown) {};
View.prototype.getIcon = function() { return this.icon; };
View.prototype.onResize = function() {};
View.prototype.getDisplayText = function() { return ''; };
View.prototype.onPaneMenu = function(menu: any, source: string) {};

// ── ItemView ────────────────────────────────────────
export interface ItemView extends View {
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  iconEl: HTMLElement;
  titleEl: HTMLElement;
  actionListEl: HTMLElement;
  _actions?: ViewActionInfo[];
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
}
export function ItemView(this: any, leaf: WorkspaceLeaf) {
  View.call(this, leaf);
  
  this.headerEl = document.createElement('div');
  this.headerEl.className = 'view-header';
  
  this.iconEl = document.createElement('div');
  this.iconEl.className = 'view-header-icon';
  
  const titleContainer = document.createElement('div');
  titleContainer.className = 'view-header-title-container';
  
  this.titleEl = document.createElement('div');
  this.titleEl.className = 'view-header-title';
  titleContainer.appendChild(this.titleEl);
  
  this.actionListEl = document.createElement('div');
  this.actionListEl.className = 'view-actions';
  this._actions = [];
  
  this.headerEl.appendChild(this.iconEl);
  this.headerEl.appendChild(titleContainer);
  this.headerEl.appendChild(this.actionListEl);

  this.contentEl = document.createElement('div');
  this.contentEl.className = 'view-content';
  
  this.containerEl.appendChild(this.headerEl);
  this.containerEl.appendChild(this.contentEl);
}
ItemView.prototype = Object.create(View.prototype);
ItemView.prototype.constructor = ItemView;

ItemView.prototype.addAction = function(icon: string, title: string, callback: (evt: MouseEvent) => any) {
  const btn = document.createElement('div');
  btn.className = 'view-action clickable-icon';
  btn.dataset.tooltip = title;
  btn.removeAttribute('title');
  setIcon(btn, icon);
  btn.addEventListener('click', callback);
  const action = {
    id: `${this.getViewType?.() || 'view'}:${title}:${this._actions?.length || 0}`,
    icon,
    title,
    el: btn,
    callback,
  };
  if (!Array.isArray(this._actions)) this._actions = [];
  this._actions.push(action);
  if (this.actionListEl) {
    this.actionListEl.appendChild(btn);
  }
  this.app?.workspace?.trigger?.('plugin-views-changed');
  return btn;
};

// ── FileView ────────────────────────────────────────
export interface FileView extends ItemView {
  file: TFile | null;
  allowNoFile: boolean;
  canAcceptExtension(extension: string): boolean;
  onLoadFile(file: TFile): Promise<void>;
  onUnloadFile(file: TFile): Promise<void>;
}
export function FileView(this: any, leaf: WorkspaceLeaf) {
  ItemView.call(this, leaf);
  this.file = null;
  this.allowNoFile = false;
}
FileView.prototype = Object.create(ItemView.prototype);
FileView.prototype.constructor = FileView;
FileView.prototype.getDisplayText = function() { return this.file?.basename || ''; };
FileView.prototype.canAcceptExtension = function(extension: string) { return false; };
FileView.prototype.getState = function() {
  return this.file ? { file: this.file.path } : {};
};
FileView.prototype.onLoadFile = async function(_file: TFile) {};
FileView.prototype.onUnloadFile = async function(_file: TFile) {};
FileView.prototype.setState = async function(state: any, _result: any) {
  const path = state?.file;
  if (!path) return;
  const file = this.app?.vault?.getFileByPath?.(path);
  if (!file || file === this.file) return;
  const previous = this.file;
  if (previous) await this.onUnloadFile(previous);
  this.file = file;
  await this.onLoadFile(file);
};

// ── EditableFileView ────────────────────────────────
export interface EditableFileView extends FileView {}
export function EditableFileView(this: any, leaf: WorkspaceLeaf) {
  FileView.call(this, leaf);
}
EditableFileView.prototype = Object.create(FileView.prototype);
EditableFileView.prototype.constructor = EditableFileView;

// ── TextFileView ────────────────────────────────────
export interface TextFileView extends EditableFileView {
  data: string;
  requestSave: () => void;
  getViewData(): string;
  setViewData(data: string, clear: boolean): void;
  clear(): void;
}
export function TextFileView(this: any, leaf: WorkspaceLeaf) {
  EditableFileView.call(this, leaf);
  this.data = '';
  // Debounced save — Excalidraw & Kanban call requestSave() on every edit
  let _saveTimer: ReturnType<typeof setTimeout> | null = null;
  const self = this;
  this.requestSave = function() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      self.save?.();
    }, 2000);
  };
}
TextFileView.prototype = Object.create(EditableFileView.prototype);
TextFileView.prototype.constructor = TextFileView;
TextFileView.prototype.getViewData = function() { return ''; };
TextFileView.prototype.setViewData = function(data: string, clear: boolean) { this.data = data; };
TextFileView.prototype.clear = function() { this.data = ''; };
TextFileView.prototype.onLoadFile = async function(file: TFile) {
  const data = await this.app?.vault?.read?.(file) || '';
  this.data = data;
  await this.setViewData(data, true);
};
TextFileView.prototype.onUnloadFile = async function(_file: TFile) {};
TextFileView.prototype.save = async function(_clear?: boolean) {
  if (!this.file) return;
  const data = this.getViewData();
  this.data = data;
  await this.app?.vault?.modify?.(this.file, data);
};

// ── MarkdownView (stub) ─────────────────────────────
function _MarkdownView(this: any, leaf: WorkspaceLeaf) {
  TextFileView.call(this, leaf);
  const app = (window as any).__oo_app;
  
  // Provide a safe inline mock for editor to avoid circular dependencies
  this._fallbackEditor = {
    cm: null,
    getDoc: function() { return this; },
    getValue: function() { return ''; },
    setValue: function() {},
    getLine: function() { return ''; },
    setLine: function() {},
    lineCount: function() { return 0; },
    lastLine: function() { return 0; },
    getSelection: function() { return ''; },
    replaceSelection: function() {},
    replaceRange: function() {},
    setCursor: function() {},
    somethingSelected: function() { return false; },
    getRange: function() { return ''; },
    getCursor: function() { return { line: 0, ch: 0 }; },
    focus: function() {},
    blur: function() {},
    hasFocus: function() { return false; },
    getScrollInfo: function() { return { top: 0, left: 0, clientHeight: 0, clientWidth: 0, height: 0, width: 0 }; },
    scrollTo: function() {},
  };
  this._fallbackEditor.cm = this._fallbackEditor;
  this._editor = null;
  this._file = null;

  this._containerEl = document.createElement('div');
  this._containerEl.className = 'markdown-view';

  // Plugins such as Iconic observe Obsidian's Properties editor even when the
  // current note has no frontmatter. Keep a stable native element for that
  // contract; React owns the visible editor surface.
  const propertyListEl = document.createElement('div');
  propertyListEl.className = 'metadata-container';
  this.metadataEditor = {
    containerEl: propertyListEl,
    propertyListEl,
    render: () => {},
  };
  this._containerEl.appendChild(propertyListEl);
}
_MarkdownView.prototype = Object.create(TextFileView.prototype);
_MarkdownView.prototype.constructor = _MarkdownView;
_MarkdownView.prototype.getViewType = function() { return 'markdown'; };
_MarkdownView.prototype.getIcon = function() { return 'file-text'; };
_MarkdownView.prototype.getMode = function() { return 'source'; };
_MarkdownView.prototype.getViewData = function() {
  return this.editor?.getValue?.() || this.data || '';
};
_MarkdownView.prototype.setViewData = function(data: string, clear: boolean) {
  this.data = data;
  if (this.editor?.setValue) {
    this.editor.setValue(data);
  }
};
_MarkdownView.prototype.clear = function() {
  this.data = '';
  if (this.editor?.setValue) {
    this.editor.setValue('');
  }
};

Object.defineProperty(_MarkdownView.prototype, 'editor', {
  get: function() {
    if (this._editor && this._editor.cm) return this._editor;
    const app = (window as any).__oo_app;
    if (app?.workspace?.activeEditor?.editor) {
      return app.workspace.activeEditor.editor;
    }
    return this._editor || this._fallbackEditor;
  },
  set: function(ed) {
    this._editor = ed;
  },
  configurable: true,
});

Object.defineProperty(_MarkdownView.prototype, 'file', {
  get: function() {
    if (this._file) return this._file;
    const app = (window as any).__oo_app;
    if (app?.workspace?.activeEditor?.file) {
      return app.workspace.activeEditor.file;
    }
    const activePath = (window as any).__oo_active_file;
    if (activePath) {
      return app?.vault?.getFileByPath?.(activePath) || null;
    }
    return null;
  },
  set: function(f) {
    this._file = f;
  },
  configurable: true,
});

Object.defineProperty(_MarkdownView.prototype, 'sourceMode', {
  get: function() {
    const self = this;
    return {
      get cmEditor() { return self.editor; },
      get editor() { return self.editor; },
      sourceMode: true,
      type: 'source',
      get: () => self.editor?.getValue?.() || '',
      set: (data: string) => self.editor?.setValue?.(data),
      getScroll: () => 0,
      applyScroll: () => {},
    };
  },
  set: function(sm) {
    if (sm?.cmEditor) this._editor = sm.cmEditor;
  },
  configurable: true,
});

Object.defineProperty(_MarkdownView.prototype, 'currentMode', {
  get: function() {
    return this.sourceMode;
  },
  configurable: true,
});

Object.defineProperty(_MarkdownView.prototype, 'previewMode', {
  get: function() {
    return {
      get: () => this.data || this.editor?.getValue?.() || '',
      set: (data: string) => { this.data = data; },
      getScroll: () => 0,
      applyScroll: () => {},
      rerender: () => {},
    };
  },
  configurable: true,
});

Object.defineProperty(_MarkdownView.prototype, 'containerEl', {
  get: function() { 
    return document.querySelector('.leaf-editor-host') as HTMLElement || this._containerEl; 
  },
  set: function(el) { 
    this._containerEl = el; 
  },
  configurable: true
});

export const MarkdownView = _MarkdownView as any;

// ── OOWorkspace ─────────────────────────────────────
export class OOWorkspace extends Events {
  private _activeLeaf: WorkspaceLeaf | null = null;
  private _activeMainLeaf: WorkspaceLeaf | null = null;
  get activeLeaf(): WorkspaceLeaf {
    if (!this._activeLeaf) {
      this._activeLeaf = this.getMainLeaf();
    }
    return this._activeLeaf;
  }
  set activeLeaf(leaf: WorkspaceLeaf | null) {
    if (this._activeLeaf !== leaf) {
      this._activeLeaf = leaf;
      if (leaf) {
        if (leaf.side === 'main') {
          this._activeMainLeaf = leaf;
        }
        this.trigger('active-leaf-change', leaf);
      }
    }
  }

  getMainLeaf(): WorkspaceLeaf {
    if (this._activeMainLeaf && this._leaves.has(this._activeMainLeaf.id)) {
      return this._activeMainLeaf;
    }
    const existing = Array.from(this._leaves.values()).find(
      (l) => l.side === 'main' && l.view?.getViewType?.() === 'markdown',
    );
    if (existing) {
      this._activeMainLeaf = existing;
      return existing;
    }
    const defaultLeaf = new WorkspaceLeaf('default-main');
    defaultLeaf.side = 'main';
    defaultLeaf.view = new MarkdownView(defaultLeaf);
    this._leaves.set(defaultLeaf.id, defaultLeaf);
    this._activeMainLeaf = defaultLeaf;
    return defaultLeaf;
  }

  activeEditor: any = null;
  containerEl: HTMLElement;
  layoutReady = false;
  leftSplit: any;
  rightSplit: any;
  leftRibbon: any = this._createRibbon();
  rightRibbon: any = this._createRibbon();
  rootSplit: any = {
    _isRootSplit: true,
    children: [],
    win: window,
    doc: document,
    getRoot() { return this; },
    getContainer() { return this; },
  };
  floatingSplit: any = { children: [], win: window, doc: document };
  editorExtensions: any[] = [];
  editorSuggest: { suggests: any[]; add: (suggest: any) => void; remove: (suggest: any) => void };
  requestSaveLayout: any = () => {};

  private _leaves: Map<string, WorkspaceLeaf> = new Map();
  private _viewCreators: Map<string, (leaf: WorkspaceLeaf) => View> = new Map();
  private _extensionViews: Map<string, string> = new Map();
  private _layoutReadyCallbacks: Array<() => any> = [];
  private _leafCounter = 0;
  private _hoverLinkSources = new Map<string, any>();
  /** Active plugin views (viewType → leaf) — exposed for the React UI to render */
  private _activePluginViews: Map<string, WorkspaceLeaf> = new Map();
  /** The plugin leaf currently revealed in each workspace sidebar. */
  private _visibleSideLeaves: Record<'left' | 'right', WorkspaceLeaf | null> = {
    left: null,
    right: null,
  };

  constructor() {
    super();
    this.containerEl = document.body;
    this.leftSplit = this._createSideDock('left');
    this.rightSplit = this._createSideDock('right');
    this.editorSuggest = {
      suggests: [],
      add: (suggest: any) => {
        if (!this.editorSuggest.suggests.includes(suggest)) this.editorSuggest.suggests.push(suggest);
      },
      remove: (suggest: any) => {
        this.editorSuggest.suggests = this.editorSuggest.suggests.filter((entry) => entry !== suggest);
      },
    };
    // Mark layout as ready after a tick
    setTimeout(() => {
      this.layoutReady = true;
      for (const cb of this._layoutReadyCallbacks) {
        try { cb(); } catch (e) { console.error('[Plugin] layoutReady callback error:', e); }
      }
      this._layoutReadyCallbacks = [];
      this.trigger('layout-ready');
    }, 100);
  }

  private _createRibbon(): any {
    const ribbonItemsEl = document.createElement('div');
    return {
      items: [],
      containerEl: ribbonItemsEl,
      ribbonItemsEl,
    };
  }

  /**
   * Small but stateful equivalent of Obsidian's workspace sidedocks. Plugins
   * commonly use `workspace.leftSplit.collapsed`, `collapse()`, and `expand()`
   * to manage their own views. The renderer listens for this event and changes
   * the actual application sidebar visibility.
   */
  private _createSideDock(side: 'left' | 'right'): any {
    const dock: any = {
      children: [],
      parent: this.rootSplit,
      win: window,
      doc: document,
      getRoot: () => this.rootSplit,
      getContainer: () => this.rootSplit,
      collapsed: false,
      collapse: () => this._setSideDockCollapsed(side, true),
      expand: () => this._setSideDockCollapsed(side, false),
      toggle: () => this._setSideDockCollapsed(side, !dock.collapsed),
    };
    return dock;
  }

  private _setSideDockCollapsed(side: 'left' | 'right', collapsed: boolean): void {
    const dock = side === 'left' ? this.leftSplit : this.rightSplit;
    const changed = dock.collapsed !== collapsed;
    dock.collapsed = collapsed;
    // Always notify the renderer. The compatibility dock and React shell can
    // initialize in different ticks, so equal dock state does not guarantee
    // that the physical sidebar already has the matching width.
    this.trigger('sidebar-change', { side, collapsed });
    if (changed) this.trigger('layout-change');
  }

  private _revealSideLeaf(leaf: WorkspaceLeaf): void {
    if (leaf.side !== 'left' && leaf.side !== 'right') return;
    this._visibleSideLeaves[leaf.side] = leaf;
    this._setSideDockCollapsed(leaf.side, false);
    this.trigger('plugin-views-changed');
  }

  revealDefaultView(side: 'left' | 'right'): void {
    this._visibleSideLeaves[side] = null;
    this._setSideDockCollapsed(side, false);
    this.trigger('plugin-views-changed');
    this.trigger('layout-change');
  }

  registerViewCreator(type: string, creator: (leaf: WorkspaceLeaf) => View): void {
    this._viewCreators.set(type, creator);
  }

  unregisterViewCreator(type: string): void {
    this._viewCreators.delete(type);
  }

  registerExtensions(extensions: string[], viewType: string): void {
    for (const extension of extensions) {
      this._extensionViews.set(extension.replace(/^\./, '').toLowerCase(), viewType);
    }
  }

  unregisterExtensions(extensions: string[], viewType: string): void {
    for (const extension of extensions) {
      const normalized = extension.replace(/^\./, '').toLowerCase();
      if (this._extensionViews.get(normalized) === viewType) this._extensionViews.delete(normalized);
    }
  }

  getViewTypeForExtension(extension: string): string | null {
    return this._extensionViews.get(extension.replace(/^\./, '').toLowerCase()) || null;
  }

  registerHoverLinkSource(id: string, info: any): void {
    this._hoverLinkSources.set(id, info);
  }

  unregisterHoverLinkSource(id: string): void {
    this._hoverLinkSources.delete(id);
  }

  registerEditorExtension(extension: any): void {
    this.editorExtensions.push(extension);
    (window as any).__oo_register_editor_ext?.('workspace', extension);
  }

  unregisterEditorExtension(extension: any): void {
    this.editorExtensions = this.editorExtensions.filter((entry) => entry !== extension);
    (window as any).__oo_unregister_editor_ext?.('workspace', extension);
  }

  onLayoutReady(callback: () => any): void {
    if (this.layoutReady) { callback(); return; }
    this._layoutReadyCallbacks.push(callback);
  }

  getUnpinnedLeaf(viewType?: string): WorkspaceLeaf {
    if (this.activeLeaf && !this.activeLeaf.pinned) return this.activeLeaf;
    return this.getLeaf(true);
  }

  getLeaf(newLeaf?: any, direction?: any): WorkspaceLeaf {
    if (!newLeaf && this.activeLeaf && this.activeLeaf.side === 'main') return this.activeLeaf;
    const leaf = new WorkspaceLeaf(`leaf-${++this._leafCounter}`);
    leaf.side = 'main';
    leaf.parent = this.rootSplit;
    this._leaves.set(leaf.id, leaf);
    this.trigger('layout-change');
    return leaf;
  }

  getActiveViewOfType<T>(type: any): T | null {
    const isMatch = (view: any): boolean => {
      if (!view) return false;
      if (view instanceof type) return true;
      if (type?.name && (view.constructor?.name === type.name || view.constructor?.name === `_${type.name}`)) return true;
      try {
        const expectedType = type.prototype?.getViewType?.call?.({ icon: '', navigation: true });
        if (expectedType && view.getViewType?.() === expectedType) return true;
      } catch { /* getViewType may need proper `this` — ignore */ }
      try {
        if (type.name && view.constructor?.name === type.name) return true;
      } catch { /* ignore */ }
      return false;
    };

    // 1. Try activeLeaf.view
    if (isMatch(this.activeLeaf?.view)) return this.activeLeaf.view as T;

    // 2. Try getMostRecentLeaf().view (the active main split markdown view)
    const mostRecent = this.getMostRecentLeaf();
    if (isMatch(mostRecent?.view)) return mostRecent?.view as T;

    // 3. Fallback: search all leaves
    for (const leaf of this._leaves.values()) {
      if (isMatch(leaf.view)) return leaf.view as T;
    }
    return null;
  }

  getActiveFileView(): FileView | null {
    const view = this.activeLeaf?.view;
    if (view instanceof FileView) return view as unknown as FileView;
    const recentView = this.getMostRecentLeaf()?.view;
    if (recentView instanceof FileView) return recentView as unknown as FileView;
    return null;
  }

  getActiveFile(): TFile | null {
    const path = (window as any).__oo_active_file;
    if (!path) return null;
    const app = (window as any).__oo_app;
    return app?.vault?.getFileByPath(path) || null;
  }

  getLeavesOfType(viewType: string): WorkspaceLeaf[] {
    return Array.from(this._leaves.values()).filter(l => l.view?.getViewType?.() === viewType);
  }

  detachLeavesOfType(viewType: string): void {
    for (const leaf of this.getLeavesOfType(viewType)) {
      if (leaf.view) {
        try { leaf.view.onClose?.(); } catch { /* */ }
      }
      this._leaves.delete(leaf.id);
      this._activePluginViews.delete(viewType);
    }
    this.trigger('plugin-views-changed');
    this.trigger('layout-change');
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    for (const leaf of this._leaves.values()) {
      if (leaf.view) callback(leaf);
    }
  }

  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void {
    this.iterateAllLeaves(callback);
  }

  iterateLeaves(callback: (leaf: WorkspaceLeaf) => any): void { this.iterateAllLeaves(callback); }
  iterateTabs(callback: (leaf: WorkspaceLeaf) => any): void { this.iterateAllLeaves(callback); }
  isAttached(leaf: WorkspaceLeaf): boolean { return this._leaves.has(leaf.id); }
  isInSidebar(leaf: WorkspaceLeaf): boolean { return leaf.side === 'left' || leaf.side === 'right'; }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    // If the leaf already has a view, just make it active
    if (leaf.view) {
      this._activePluginViews.set(leaf.view.getViewType(), leaf);
      this._revealSideLeaf(leaf);
      this.trigger('plugin-views-changed');
      return;
    }
  }

  setActiveLeaf(leaf: WorkspaceLeaf, params?: any): void {
    if (leaf) {
      leaf.activeTime = Date.now();
      if (leaf.side === 'main') {
        this._activeMainLeaf = leaf;
      }
    }
    this.activeLeaf = leaf;
    this._revealSideLeaf(leaf);
  }

  getLeafById(id: string): WorkspaceLeaf | null {
    return this._leaves.get(id) || null;
  }

  getGroupLeaves(group: string): WorkspaceLeaf[] {
    return Array.from(this._leaves.values()).filter((leaf) => leaf.group === group);
  }
  getMostRecentLeaf(root?: any): WorkspaceLeaf | null {
    if (this._activeLeaf && this._activeLeaf.side === 'main') {
      return this._activeLeaf;
    }
    return this.getMainLeaf();
  }
  getActiveLeafOfViewType(viewType: string): WorkspaceLeaf | null {
    return this.activeLeaf?.view?.getViewType?.() === viewType
      ? this.activeLeaf
      : this.getLeavesOfType(viewType)[0] || null;
  }
  
  getLeftLeaf(split: boolean): WorkspaceLeaf | null {
    return this._getSideLeaf('left', split);
  }
  
  getRightLeaf(split: boolean): WorkspaceLeaf | null {
    return this._getSideLeaf('right', split);
  }

  async ensureSideLeaf(type: string, side: string, options?: any): Promise<WorkspaceLeaf> {
    // Check if we already have a leaf with this view type
    const existing = this.getLeavesOfType(type);
    if (existing.length > 0) return existing[0];
    
    // Create leaf + view, setting the correct side
    const leaf = side === 'left' || side === 'right'
      ? this._getSideLeaf(side, false)
      : this._createSideLeaf();
    await this._createViewOnLeaf(leaf, type);
    return leaf;
  }

  /** Create a leaf and view, and make it active in the sidebar */
  private _createSideLeaf(): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(`leaf-${++this._leafCounter}`);
    this._leaves.set(leaf.id, leaf);
    return leaf;
  }

  private _getSideLeaf(side: 'left' | 'right', split: boolean): WorkspaceLeaf {
    if (!split) {
      const emptyLeaf = Array.from(this._leaves.values()).find(
        (leaf) => leaf.side === side && !leaf.view,
      );
      if (emptyLeaf) return emptyLeaf;
    }
    const leaf = this._createSideLeaf();
    leaf.side = side;
    const dock = side === 'left' ? this.leftSplit : this.rightSplit;
    leaf.parent = dock;
    dock.children.push(leaf);
    return leaf;
  }

  _detachLeaf(leaf: WorkspaceLeaf): void {
    if (leaf.view) {
      try { void leaf.view.onClose?.(); } catch { /* plugin cleanup is isolated elsewhere */ }
      this._activePluginViews.delete(leaf.view.getViewType?.());
    }
    this._leaves.delete(leaf.id);
    if (leaf.side === 'left' || leaf.side === 'right') {
      const dock = leaf.side === 'left' ? this.leftSplit : this.rightSplit;
      dock.children = dock.children.filter((child: WorkspaceLeaf) => child !== leaf);
    }
    if (leaf.side === 'left' || leaf.side === 'right') {
      if (this._visibleSideLeaves[leaf.side] === leaf) {
        this._visibleSideLeaves[leaf.side] = Array.from(this._leaves.values()).find(
          (candidate) => candidate.side === leaf.side && Boolean(candidate.view),
        ) || null;
      }
    }
    if (this._activeLeaf === leaf) this._activeLeaf = null;
    leaf.containerEl.remove();
    this.trigger('plugin-views-changed');
    this.trigger('layout-change');
  }

  /** Instantiate a view on a leaf using a registered creator */
  async _createViewOnLeaf(
    leaf: WorkspaceLeaf,
    viewType: string,
    state: Record<string, any> = {},
    eState?: any,
  ): Promise<boolean> {
    const pluginCreator = this._viewCreators.get(viewType);
    let creator = pluginCreator;
    if (!creator && viewType === 'markdown') {
      creator = (targetLeaf) => new MarkdownView(targetLeaf);
    }
    if (!creator && viewType === 'empty') {
      creator = (targetLeaf) => new (View as any)(targetLeaf);
    }
    if (!creator) {
      console.warn(`[Workspace] No view creator for type: ${viewType}`);
      return false;
    }
    
    try {
      const previousViewType = leaf.view?.getViewType?.();
      if (leaf.view?.getViewType?.() !== viewType) {
        try {
          await leaf.view?.onClose?.();
        } catch (cleanupError) {
          console.warn(`[Workspace] Previous view onClose failed before switching to ${viewType}:`, cleanupError);
        }
        try {
          leaf.view?.unload?.();
        } catch (cleanupError) {
          console.warn(`[Workspace] Previous view unload failed before switching to ${viewType}:`, cleanupError);
        }
        if (previousViewType && this._activePluginViews.get(previousViewType) === leaf) {
          this._activePluginViews.delete(previousViewType);
        }
      }
      // A leaf hosts one view. Rebuild its native ItemView structure for the
      // new type before the plugin constructs header and content elements.
      leaf.containerEl.replaceChildren();
      leaf.containerEl.setAttribute('data-type', viewType);
      const view = creator(leaf);
      view.pluginId = (creator as any).__pluginId;
      leaf.view = view;
      await (view as any).load?.();
      // For file-backed views (FileView/TextFileView subclasses), setState
      // triggers onLoadFile which reads the file from disk. We must call
      // setState even when onLoadFile exists — the base FileView.setState
      // handles the file lookup and loading chain.
      await view.setState?.(state || {}, eState);
      await view.onOpen?.();
      // Track the file on the global active-file if this is a file-backed view
      const viewFile = (view as any).file;
      if (viewFile?.path && leaf.side === 'main') {
        (window as any).__oo_active_file = viewFile.path;
      }
      if (pluginCreator) this._activePluginViews.set(viewType, leaf);
      this._revealSideLeaf(leaf);
      this.trigger('plugin-views-changed');
      console.log(`[Workspace] Created view: ${viewType} → ${view.getDisplayText()} (plugin: ${view.pluginId})`);
      return true;
    } catch (e) {
      console.error(`[Workspace] Failed to create view ${viewType}:`, e, e instanceof Error ? e.stack : undefined);
      return false;
    }
  }

  /** Get all active plugin views — used by React UI to render the sidebar */
  getActivePluginViews(): Array<{ viewType: string; leaf: WorkspaceLeaf; displayText: string; icon: string; containerEl: HTMLElement; pluginId?: string; side: 'left' | 'right' | 'main'; visible?: boolean; actions?: ViewActionInfo[] }> {
    const views: Array<{ viewType: string; leaf: WorkspaceLeaf; displayText: string; icon: string; containerEl: HTMLElement; pluginId?: string; side: 'left' | 'right' | 'main'; visible?: boolean; actions?: ViewActionInfo[] }> = [];
    for (const [viewType, leaf] of this._activePluginViews) {
      if (leaf.view) {
        const visible = leaf.side === 'main' || this._visibleSideLeaves[leaf.side] === leaf;
        const viewAny = leaf.view as any;
        const mountEl = leaf.side !== 'main' && viewAny.contentEl instanceof HTMLElement
          ? viewAny.contentEl
          : leaf.view.containerEl;
        if (mountEl instanceof HTMLElement) {
          const dataType = leaf.containerEl.getAttribute('data-type') || viewType;
          mountEl.setAttribute('data-type', dataType);
          mountEl.classList.add('workspace-leaf-content', 'oo-plugin-leaf');
        }
        views.push({
          viewType,
          leaf,
          displayText: leaf.view.getDisplayText?.() || viewType,
          icon: leaf.view.getIcon?.() || 'file-text',
          containerEl: mountEl,
          pluginId: leaf.view.pluginId,
          side: leaf.side,
          visible,
          actions: Array.isArray(viewAny._actions) ? [...viewAny._actions] : [],
        });
      }
    }
    // A revealed sidebar leaf should be rendered first, which lets the React
    // host select the same view that a plugin selected through revealLeaf().
    return views.sort((a, b) => {
      const aVisible = a.side !== 'main' && this._visibleSideLeaves[a.side] === a.leaf;
      const bVisible = b.side !== 'main' && this._visibleSideLeaves[b.side] === b.leaf;
      return Number(bVisible) - Number(aVisible);
    });
  }

  /** Initialize all registered views that should auto-open */
  async initializeViews(): Promise<void> {
    // Some plugins (like Calendar) call ensureSideLeaf/revealLeaf during load.
    // Those views are already tracked. This method is called after all plugins load
    // to trigger the UI update.
    this.trigger('plugin-views-changed');
  }

  async openLinkText(linktext: string, sourcePath: string, newLeaf?: any): Promise<void> {
    const target = (window as any).__oo_app?.metadataCache
      ?.getFirstLinkpathDest?.(linktext.split('#')[0], sourcePath);
    (window as any).__oo_open_file?.(target?.path || linktext);
  }
  createLeafBySplit(leaf: WorkspaceLeaf): WorkspaceLeaf { return this.getLeaf(true); }
  createLeafInParent(parent: any, index: number): WorkspaceLeaf { return this.getLeaf(true); }
  splitActiveLeaf(direction?: 'vertical' | 'horizontal'): WorkspaceLeaf {
    return this.createLeafBySplit(this.activeLeaf);
  }
  duplicateLeaf(leaf: WorkspaceLeaf, direction?: any): WorkspaceLeaf {
    const duplicate = this.getLeaf(true, direction);
    void duplicate.setViewState(leaf.getViewState());
    return duplicate;
  }
  moveLeafToPopout(leaf: WorkspaceLeaf, data?: any): WorkspaceLeaf {
    leaf.containerEl.classList.add('workspace-leaf', 'mod-active');
    return leaf;
  }
  openPopoutLeaf(data?: any): WorkspaceLeaf {
    const leaf = this.getLeaf(true);
    leaf.containerEl.classList.add('workspace-leaf', 'mod-active');
    const appContainer = document.querySelector('.app-container') || document.body;
    if (!leaf.containerEl.parentElement) {
      appContainer.appendChild(leaf.containerEl);
    }
    return leaf;
  }
  getLastOpenFiles(): string[] { return []; }
  updateOptions(): void { /* compat */ }
  handleLinkContextMenu(menu: any, linktext: string, sourcePath: string): boolean { return false; }
  handleExternalLinkContextMenu(menu: any, url: string): boolean { return false; }
  focusLeaf(leaf: WorkspaceLeaf): void { this.setActiveLeaf(leaf); leaf.containerEl.focus?.(); }
  getFocusedContainer(): HTMLElement { return this.activeLeaf?.containerEl || this.containerEl; }
  async clearLayout(): Promise<void> {
    for (const leaf of [...this._leaves.values()]) this._detachLeaf(leaf);
  }
  async loadLayout(layout: any): Promise<void> { await this.changeLayout(layout); }
  async saveLayout(): Promise<void> { this.requestSaveLayout?.(); }
  updateLayout(): void { this.trigger('layout-change'); }
  updateTitle(): void { this.trigger('layout-change'); }
  async changeLayout(workspace: any): Promise<void> { /* compat */ }
  getLayout(): Record<string, any> {
    return {
      main: {
        type: 'split',
        children: Array.from(this._leaves.values())
          .filter((leaf) => leaf.side === 'main')
          .map((leaf) => ({ type: 'leaf', state: leaf.getViewState() })),
      },
      left: { type: 'split', children: [] },
      right: { type: 'split', children: [] },
      active: this.activeLeaf?.id || null,
    };
  }
}
