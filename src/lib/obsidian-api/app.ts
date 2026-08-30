/**
 * Obsidian API Compatibility — App
 * The root App object that plugins receive.
 */

import { applyPreferredTrash, OOVault } from './vault';
import { OOWorkspace } from './workspace';
import { OOMetadataCache } from './metadata';
import { normalizePath, parseYaml, Scope, stringifyYaml } from './utils';
import { cssSnippetsApi } from '../cssSnippets';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import moment from 'moment';

export class OOApp {
  // Community plugins use this as a stable key for their IndexedDB-backed
  // caches. An empty value prevents those stores from being initialized.
  appId = 'openonyx';
  vault: OOVault;
  workspace: OOWorkspace;
  metadataCache: OOMetadataCache;
  scope: Scope;
  customCss: any;
  containerEl: HTMLElement = document.body;
  keymap: any = {};
  fileManager: any;
  lastEvent: Event | null = null;
  renderContext: any = {};
  metadataTypeManager: any;
  secretStorage: any = {
    getSecret: async (key: string) => null,
    setSecret: async (key: string, value: string) => {},
    deleteSecret: async (key: string) => {},
  };

  /** Plugin registry — stub for community plugins that query other plugins */
  plugins: any;
  /** Internal (core) plugins — stub for Calendar's daily-notes integration */
  internalPlugins: any;
  /** App setting — stores things like daily note folder */
  setting: any;

  // ── Storage API ───────────────────────────────────
  loadLocalStorage(key: string): any {
    try {
      const data = localStorage.getItem(`oo_plugin_${key}`);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  }
  
  saveLocalStorage(key: string, value: any): void {
    try {
      localStorage.setItem(`oo_plugin_${key}`, JSON.stringify(value));
    } catch { /* ignore */ }
  }

  isDarkMode(): boolean {
    return document.body.classList.contains('theme-dark') ||
      window.matchMedia?.('(prefers-color-scheme: dark)')?.matches || false;
  }

  getAccentColor(): string {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent')
      .trim() || '#c6c6c6';
  }

  setAccentColor(color: string): void {
    document.documentElement.style.setProperty('--color-accent', color);
    document.documentElement.style.setProperty('--interactive-accent', color);
  }

  async openWithDefaultApp(path: string): Promise<void> {
    try {
      const electron = (window as any).require?.('electron');
      const basePath = this.vault.adapter.getBasePath();
      await electron?.shell?.openPath?.(this.vault.adapter.getFullPath?.(path) || `${basePath}/${normalizePath(path)}`);
    } catch (error) {
      console.warn('[App] Failed to open path with default application:', error);
    }
  }

  async showInFolder(path: string): Promise<void> {
    try {
      const electron = (window as any).require?.('electron');
      const fullPath = this.vault.adapter.getFullPath?.(path) || `${this.vault.adapter.getBasePath()}/${normalizePath(path)}`;
      await electron?.shell?.showItemInFolder?.(fullPath);
    } catch (error) {
      console.warn('[App] Failed to reveal path in system explorer:', error);
    }
  }

  constructor() {
    this.vault = new OOVault();
    this.workspace = new OOWorkspace();
    this.metadataCache = new OOMetadataCache();
    this.metadataTypeManager = {
      get properties() { return thisApp.metadataCache.getAllProperties(); },
      getAllProperties: () => this.metadataCache.getAllProperties(),
      getAssignedType: (_property: string) => null,
      getWidget: (type: string) => ({ icon: type === 'checkbox' ? 'lucide-check-square' : type === 'number' ? 'lucide-hash' : 'lucide-type' }),
      setType: async (_property: string, _type: string) => {},
    };
    this.scope = new Scope();
    const rootKeyScope = new Scope();
    this.keymap = {
      getRootScope: () => rootKeyScope,
      getRoot: () => rootKeyScope,
      pushScope: (_scope: Scope) => {},
      popScope: (_scope: Scope) => {},
    };
    const thisApp = this;
    this.customCss = cssSnippetsApi;

    this.fileManager = {
      getNewFileParent: (sourcePath: string, newFilePath?: string) => {
        const requested = normalizePath(newFilePath || sourcePath || '');
        const parentPath = requested.includes('/') ? requested.slice(0, requested.lastIndexOf('/')) : '/';
        return this.vault.getFolderByPath(parentPath) || this.vault.getRoot();
      },
      renameFile: async (file: any, newPath: string) => this.vault.rename(file, newPath),
      generateMarkdownLink: (file: any, sourcePath: string, subpath?: string, alias?: string) => {
        const display = alias || file.basename;
        const suffix = subpath ? (subpath.startsWith('#') ? subpath : `#${subpath}`) : '';
        return alias ? `[[${file.path}${suffix}|${display}]]` : `[[${file.path}${suffix}]]`;
      },
      processFrontMatter: async (file: any, fn: (frontmatter: any) => void) => {
        const content = await this.vault.read(file);
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const frontmatter = match ? parseYaml(match[1]) : {};
        fn(frontmatter);
        const serialized = stringifyYaml(frontmatter);
        const next = match
          ? content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${serialized}\n---`)
          : `---\n${serialized}\n---\n${content}`;
        await this.vault.modify(file, next);
      },
      getAvailablePathForAttachment: async (filename: string) => {
        return this.vault.getAvailablePathForAttachments(filename);
      },
      createNewMarkdownFile: async (parent: any, filename: string, content = '') => {
        const folder = parent?.path && parent.path !== '/' ? `${parent.path}/` : '';
        const requested = filename.toLowerCase().endsWith('.md') ? filename : `${filename}.md`;
        return this.vault.create(this.vault.getAvailablePath(`${folder}${requested}`), content);
      },
      createNewMarkdownFileFromLinktext: async (linktext: string, sourcePath: string, content = '') => {
        const requested = linktext.toLowerCase().endsWith('.md') ? linktext : `${linktext}.md`;
        const parent = this.fileManager.getNewFileParent(sourcePath, requested);
        return this.fileManager.createNewMarkdownFile(parent, requested.split('/').pop(), content);
      },
      createNewFile: async (parent: any, filename: string, content = '') => {
        const folder = parent?.path && parent.path !== '/' ? `${parent.path}/` : '';
        return this.vault.create(this.vault.getAvailablePath(`${folder}${filename}`), content);
      },
      createNewFolder: async (parent: any, folderName: string) => {
        const folder = parent?.path && parent.path !== '/' ? `${parent.path}/` : '';
        const path = this.vault.getAvailablePath(`${folder}${folderName}`);
        await this.vault.createFolder(path);
        return this.vault.getFolderByPath(path);
      },
      insertIntoFile: async (file: any, content: string) => {
        await this.vault.append(file, content);
      },
      getAllLinkResolutions: () => ({ ...this.metadataCache.resolvedLinks }),
      promptForDeletion: async (file: any) => {
        if (!confirm(`Are you sure you want to delete ${file.path}?`)) return false;
        await this.vault.delete(file);
        return true;
      },
      trashFile: async (file: any) => applyPreferredTrash(this.vault, file),
      promptForFileDeletion: async (file: any) => {
        if (confirm(`Are you sure you want to delete ${file.path}?`)) {
          return this.vault.delete(file);
        }
      },
      promptForFileRename: async (file: any, newPath?: string) => {
        const requested = newPath || prompt(`Rename ${file.path} to:`, file.path);
        if (!requested || requested === file.path) return false;
        await this.vault.rename(file, requested);
        return true;
      },
      promptForFolderDeletion: async (folder: any) => {
        if (!confirm(`Are you sure you want to delete ${folder.path}?`)) return false;
        await this.vault.delete(folder);
        return true;
      },
      canCreateFileWithExt: (_extension: string) => true,
    };

    // Stub for community plugin registry
    this.plugins = {
      enabledPlugins: new Set<string>(),
      plugins: {} as Record<string, any>,
      manifests: {} as Record<string, any>,
      getPlugin: (id: string) => this.plugins.plugins[id] || null,
      isEnabled: (id: string) => this.plugins.enabledPlugins.has(id),
      getPluginFolder: (manifest: any) => manifest?.dir || `.openonyx/plugins/${manifest?.id || ''}`,
      loadManifest: async (id: string) => this.plugins.manifests[id] || null,
      loadManifests: async () => this.plugins.manifests,
      loadPlugin: async (_id: string) => false,
      unloadPlugin: async (_id: string) => {},
      enablePlugin: async (_id: string) => false,
      enablePluginAndSave: async (_id: string) => false,
      disablePlugin: async (_id: string) => {},
      disablePluginAndSave: async (_id: string) => {},
    };

    // Stub for core/internal plugins (daily-notes, etc.)
    const canvasNodes = new Set<any>();
    const templatesCorePlugin = {
      instance: {
        options: {
          folder: 'templates',
          dateFormat: 'YYYY-MM-DD',
          timeFormat: 'HH:mm',
        },
        async insertTemplate(templateFile: any) {
          if (!templateFile) return;
          let template = await thisApp.vault.read(templateFile);
          const activeFile = thisApp.workspace.getActiveFile?.();
          const title = activeFile?.basename || activeFile?.name?.replace(/\.[^/.]+$/, '') || '';
          template = template
            .replace(/\{\{date(?::([^}]+))?\}\}/gi, (_match: string, format?: string) =>
              moment().format(format?.trim() || this.options.dateFormat || 'YYYY-MM-DD'))
            .replace(/\{\{time(?::([^}]+))?\}\}/gi, (_match: string, format?: string) =>
              moment().format(format?.trim() || this.options.timeFormat || 'HH:mm'))
            .replace(/\{\{title\}\}/gi, title);

          const editor = thisApp.workspace.activeEditor?.editor;
          if (editor?.replaceSelection) {
            editor.replaceSelection(template);
            editor.focus?.();
            return;
          }
          if (editor?.replaceRange && editor?.getCursor) {
            const cursor = editor.getCursor();
            editor.replaceRange(template, cursor);
            editor.focus?.();
            return;
          }
          if (activeFile) {
            await thisApp.vault.modify(activeFile, `${await thisApp.vault.read(activeFile)}${template}`);
          }
        },
      },
      enabled: true,
    };
    const canvasCorePlugin = {
      _loaded: false,
      enabled: true,
      async load() { this._loaded = true; },
      async unload() { this._loaded = false; },
      views: {
        canvas: (_leaf: any) => ({
          canvas: {
            createFileNode: ({ file, subpath }: any) => {
              const containerEl = document.createElement('div');
              containerEl.className = 'canvas-node';
              const editorEl = document.createElement('div');
              containerEl.appendChild(editorEl);
              const node = {
                file,
                subpath,
                containerEl,
                child: {
                  editor: { containerEl: editorEl },
                  showPreview() {},
                },
                isEditing: false,
                isEditable: () => true,
                setFilePath(path: string, nextSubpath?: string) {
                  this.file = thisApp.vault.getFileByPath(path) || this.file;
                  this.subpath = nextSubpath || '';
                },
                render() {},
                startEditing() {},
                detach() { containerEl.remove(); },
              };
              canvasNodes.add(node);
              return node;
            },
            removeNode: (node: any) => {
              canvasNodes.delete(node);
              node?.containerEl?.remove?.();
            },
          },
        }),
      },
    };
    this.internalPlugins = {
      plugins: {
        'daily-notes': { instance: { options: {} }, enabled: true },
        'templates': templatesCorePlugin,
        'command-palette': { instance: { options: {} }, enabled: true },
        canvas: canvasCorePlugin,
      } as Record<string, any>,
      getPluginById: (id: string) => {
        const p = this.internalPlugins.plugins[id];
        if (p) return p;
        return { enabled: false, instance: { options: {} } };
      },
      getEnabledPluginById: (id: string) => {
        const p = this.internalPlugins.plugins[id];
        return p?.enabled ? p : null;
      },
    };

    // App-level settings stub
    this.setting = {
      activeTab: null,
      open: () => {},
      close: () => {},
      openTabById: (id: string) => {},
    };

    const commands: Record<string, any> = {};
    (this as any).commands = {
      commands,
      addCommand: (cmd: any) => {
        if (cmd?.id) commands[cmd.id] = cmd;
        return cmd;
      },
      removeCommand: (id: string) => {
        delete commands[id];
      },
      listCommands: () => Object.values(commands),
      findCommand: (id: string) => commands[id] || null,
      executeCommand: (cmd: any) => {
        if (!cmd) return false;
        const activeEditor = this.workspace.activeEditor;
        if (cmd.editorCheckCallback && activeEditor?.editor) {
          if (!cmd.editorCheckCallback(true, activeEditor.editor, activeEditor)) return false;
          cmd.editorCheckCallback(false, activeEditor.editor, activeEditor);
          return true;
        }
        if (cmd.checkCallback) {
          if (!cmd.checkCallback(true)) return false;
          cmd.checkCallback(false);
          return true;
        }
        if (cmd.editorCallback && activeEditor?.editor) {
          cmd.editorCallback(activeEditor.editor, activeEditor);
          return true;
        }
        if (cmd.callback) {
          cmd.callback();
          return true;
        }
        return false;
      },
      executeCommandById: (id: string) => (this as any).commands.executeCommand(commands[id]),
    };

    // Embed registry stub (used by Kanban plugin to extract MarkdownEditor constructor)
    // Kanban walks the prototype chain of editMode via Object.getPrototypeOf()
    // to find the MarkdownEditor constructor. It expects a 3-level chain:
    //   editMode -> MarkdownEditor.prototype -> Component.prototype -> Object
    // The MarkdownEditor constructor must accept (app, file, editable) params.
    class MockComponent {
      app: any = thisApp;
      load() {}
      unload() {}
      register(_cb: any) {}
    }
    class MockMarkdownEditor extends MockComponent {
      owner: any = null;
      file: any = null;
      editable = false;
      cm: EditorView;
      editor: any;

      constructor(app: any = thisApp, parentEl?: HTMLElement, owner?: any) {
        super();
        this.app = app;
        this.owner = owner || null;
        const extensions = [
          EditorView.updateListener.of((update) => {
            (this as any).onUpdate?.(update, this.editor);
          }),
          ...((this as any).buildLocalExtensions?.() || []),
        ];
        this.cm = new EditorView({
          state: EditorState.create({ extensions }),
          parent: parentEl instanceof HTMLElement ? parentEl : undefined,
        });
        (this.cm.dom as any).__oo_editor_view = this.cm;
        this.editor = {
          cm: this.cm,
          getValue: () => this.get(),
          setValue: (value: string) => this.set(value),
          focus: () => this.cm.focus(),
          newlineAndIndentContinueMarkdownList: () => this.cm.dispatch({
            changes: { from: this.cm.state.selection.main.head, insert: '\n' },
          }),
        };
      }

      buildLocalExtensions() { return []; }
      onUpdate(_update: any, _editor: any) {}
      set(data: string, _clear?: boolean) {
        this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: data } });
      }
      get() { return this.cm.state.doc.toString(); }
      getScroll() { return 0; }
      applyScroll(_scroll: number) {}
      showSearch() {}
      unload() {
        delete (this.cm.dom as any).__oo_editor_view;
        this.cm.destroy();
      }
    }
    class MockEditMode extends MockMarkdownEditor {
      constructor() {
        super(thisApp);
      }
    }

    (this as any).embedRegistry = {
      embedByExtension: {
        md: (ctx: any, file: any, subpath: string) => {
          const mode = new MockEditMode();
          mode.file = file;
          return {
            load: () => {},
            unload: () => {},
            showEditor: () => {},
            editable: false,
            editMode: mode,
          };
        }
      }
    };

    // Make the app globally accessible for plugins
    (window as any).__oo_app = this;
    (window as any).app = this;
  }

  /** Initialize the app — call after vault path is known */
  async initialize(): Promise<void> {
    await this.vault.refreshFiles();
    await this.metadataCache.buildCache(this.vault);
  }
}
