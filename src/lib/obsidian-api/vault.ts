/**
 * Obsidian API Compatibility — Vault
 * Wraps OpenOnyx's file system operations to match Obsidian's Vault API.
 */

import { Events, EventRef } from './components';
import { TAbstractFile, TFile, TFolder } from './files';
import { normalizePath } from './utils';

const api = () => (window as any).electronAPI;

function slashPath(value: string): string {
  return (value || '').replace(/\\/g, '/');
}

/** Map an adapter.fs path (often absolute) back to a vault-relative path. */
export function toVaultRelative(path: string, basePath: string): string {
  const normalized = slashPath(path || '').replace(/\/+$/, '');
  const base = slashPath(basePath || '').replace(/\/+$/, '');
  if (base && (normalized === base || normalized.startsWith(`${base}/`))) {
    return normalized.slice(base.length).replace(/^\/+/, '');
  }
  if (normalized === '/' || normalized === '') return '';
  return normalizePath(normalized);
}

export type DeletedFilesMode = 'system-trash' | 'app-trash' | 'permanent';

export function readDeletedFilesMode(): DeletedFilesMode {
  try {
    const saved = JSON.parse(localStorage.getItem('openonyx-settings') || '{}');
    if (saved.deletedFilesMode === 'system-trash' || saved.deletedFilesMode === 'permanent') {
      return saved.deletedFilesMode;
    }
  } catch {
    /* use local trash */
  }
  return 'app-trash';
}

export async function applyPreferredTrash(vault: OOVault, file: TAbstractFile): Promise<void> {
  const mode = readDeletedFilesMode();
  if (mode === 'permanent') {
    await vault.delete(file);
    return;
  }
  await vault.trash(file, mode === 'system-trash');
}

function localTrashPath(filePath: string): string {
  return `.trash/${normalizePath(filePath)}`;
}

async function uniqueVaultPath(filePath: string): Promise<string> {
  if (!(await api().fileExists?.(filePath))) return filePath;
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const hasExt = lastDot > lastSlash;
  const stem = hasExt ? filePath.slice(0, lastDot) : filePath;
  const ext = hasExt ? filePath.slice(lastDot) : '';
  let index = 1;
  let candidate = `${stem}-${index}${ext}`;
  while (await api().fileExists?.(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${ext}`;
  }
  return candidate;
}

async function pathIsDirectory(filePath: string): Promise<boolean> {
  if (typeof api().listFiles !== 'function') return false;
  try {
    await api().listFiles(filePath);
  } catch {
    return false;
  }
  if (typeof api().fileExists === 'function' && !(await api().fileExists(filePath))) {
    return false;
  }
  const parent = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const name = filePath.split('/').pop();
  if (typeof api().listFiles === 'function' && name) {
    try {
      const siblings = await api().listFiles(parent);
      const entry = (siblings || []).find((item: any) => item.name === name);
      if (entry) return !!entry.isDirectory;
    } catch {
      /* parent unlistable — hidden dirs fall through as folders */
    }
  }
  return true;
}

async function trashPathLocal(filePath: string): Promise<void> {
  const dest = await uniqueVaultPath(localTrashPath(filePath));
  if (api().renameFile) {
    try {
      await api().renameFile(filePath, dest);
      return;
    } catch {
      /* fall through */
    }
  }

  if (await pathIsDirectory(filePath)) {
    if (api().createDirectory) await api().createDirectory(dest);
    const entries = typeof api().listFiles === 'function' ? await api().listFiles(filePath).catch(() => []) : [];
    for (const entry of entries || []) {
      const childPath = entry.path || `${filePath.replace(/\/$/, '')}/${entry.name}`;
      const childDest = `${dest}/${entry.name}`;
      if (api().renameFile) {
        try {
          await api().renameFile(childPath, childDest);
          continue;
        } catch {
          /* copy below */
        }
      }
      if (entry.isDirectory) {
        await trashPathLocal(childPath);
        continue;
      }
      const content = (await api().readFile(childPath)) || '';
      if (api().createFile) await api().createFile(childDest, content);
      else await api().writeFile(childDest, content);
      await api().deleteFile(childPath);
    }
    if (api().deleteDirectory) await api().deleteDirectory(filePath);
    return;
  }

  const content = (await api().readFile(filePath)) || '';
  if (api().createFile) await api().createFile(dest, content);
  else await api().writeFile(dest, content);
  await api().deleteFile(filePath);
}

async function trashPathSystem(filePath: string): Promise<boolean> {
  if (typeof api().trashFile === 'function') {
    await api().trashFile(filePath);
    return true;
  }
  await trashPathLocal(filePath);
  return false;
}

export class OOVault extends Events {
  adapter: any;
  configDir = '.openonyx';
  config: Record<string, any> = {
    useMarkdownLinks: false,
    newLinkFormat: 'shortest',
    showUnsupportedFiles: true,
  };
  private _path: string = '';

  private _files: Map<string, TAbstractFile> = new Map();
  private _root: TFolder = new TFolder('/');
  private _config: Record<string, any> = {};

  constructor() {
    super();
    this._root.vault = this;
    this._files.set('/', this._root);
    
    // Initialize adapter with stubs and real implementations where possible
    const vault = this;
    this.adapter = {
      getBasePath: () => this._path || (window as any).__oo_vault_path || '',
      getName: () => this.getName(),
      fs: {
        exists: (path: string, cb: any) => {
          void vault.adapter.exists(toVaultRelative(path, vault.adapter.getBasePath()))
            .then((exists: boolean) => cb(exists))
            .catch(() => cb(false));
        },
        existsSync: (path: string) => {
          const relative = toVaultRelative(path, vault.adapter.getBasePath());
          return !!vault.getAbstractFileByPath(relative);
        },
        stat: (path: string, cb: any) => {
          void vault.adapter.stat(toVaultRelative(path, vault.adapter.getBasePath()))
            .then((stat: any) => {
              if (!stat) {
                cb(new Error('ENOENT'));
                return;
              }
              cb(null, {
                isDirectory: () => stat.type === 'folder',
                isFile: () => stat.type === 'file',
                mtime: new Date(stat.mtime || Date.now()),
                ctime: new Date(stat.ctime || Date.now()),
                size: stat.size || 0,
              });
            })
            .catch((err: unknown) => cb(err));
        },
        readFile: (path: string, enc: any, cb: any) => {
          const callback = typeof enc === 'function' ? enc : cb;
          void vault.adapter.read(toVaultRelative(path, vault.adapter.getBasePath()))
            .then((data: string) => callback(null, data))
            .catch((err: unknown) => callback(err));
        },
        writeFile: (path: string, data: any, enc: any, cb: any) => {
          const callback = typeof enc === 'function' ? enc : cb;
          void vault.adapter.writeFile(toVaultRelative(path, vault.adapter.getBasePath()), String(data))
            .then(() => callback?.(null))
            .catch((err: unknown) => callback?.(err));
        },
      },
      // Essential DataAdapter methods
      read: async (path: string) => {
        const relative = normalizePath(path);
        const file = this.getAbstractFileByPath(relative);
        if (file instanceof TFile) return await this.read(file);
        const raw = await api().readFile(relative);
        if (raw === null || raw === undefined) throw new Error('Not a file');
        return raw;
      },
      write: async (path: string, data: string) => {
        return await this.adapter.writeFile(path, data);
      },
      exists: async (path: string) => {
        const relative = normalizePath(path);
        if (this.getAbstractFileByPath(relative)) return true;
        if (typeof api().fileExists === 'function') {
          return !!(await api().fileExists(relative));
        }
        return false;
      },
      stat: async (path: string) => {
        const relative = normalizePath(path);
        const file = this.getAbstractFileByPath(relative);
        if (file instanceof TFile) {
          return {
            type: 'file',
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size
          };
        }
        if (file instanceof TFolder) {
          return {
            type: 'folder',
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0
          };
        }
        if (typeof api().fileExists === 'function' && !(await api().fileExists(relative))) {
          return null;
        }
        if (await pathIsDirectory(relative)) {
          return {
            type: 'folder',
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0,
          };
        }
        if (typeof api().fileExists === 'function' && await api().fileExists(relative)) {
          return { type: 'file', ctime: Date.now(), mtime: Date.now(), size: 0 };
        }
        return null;
      },
      getResourcePath: (path: string) => {
        const base = this.adapter.getBasePath();
        return `app://local${base}/${path}`;
      },
      list: async (path: string) => {
        const relative = normalizePath(path);
        const folder = this.getAbstractFileByPath(relative);
        if (folder instanceof TFolder && folder.children.length > 0) {
          return {
            files: folder.children.filter(f => f instanceof TFile).map(f => f.path),
            folders: folder.children.filter(f => f instanceof TFolder).map(f => f.path)
          };
        }
        if (typeof api().listFiles === 'function') {
          try {
            const entries = await api().listFiles(relative === '/' ? '' : relative);
            const prefix = !relative || relative === '/' ? '' : `${relative}/`;
            return {
              files: (entries || []).filter((entry: any) => !entry.isDirectory).map((entry: any) => entry.path || `${prefix}${entry.name}`),
              folders: (entries || []).filter((entry: any) => entry.isDirectory).map((entry: any) => entry.path || `${prefix}${entry.name}`),
            };
          } catch {
            return { files: [], folders: [] };
          }
        }
        return { files: [], folders: [] };
      },
      trashLocal: async (path: string) => {
        await trashPathLocal(normalizePath(path));
      },
      trashSystem: async (path: string) => {
        return trashPathSystem(normalizePath(path));
      },
      mkdir: async (path: string) => {
        await api().createDirectory(path);
        await this.refreshFiles();
      },
      append: async (path: string, data: string) => {
        try {
          const existing = await api().readFile(path);
          if (existing && (existing.endsWith(data) || existing.includes(data.trim()))) return;
          await api().writeFile(path, (existing || '') + data);
        } catch {
          await api().writeFile(path, data);
        }
      },
      readFile: async (path: string, encoding?: string) => {
        return await api().readFile(path) || '';
      },
      readBinary: async (path: string) => {
        const bytes = await api().readBinary(path);
        return new Uint8Array(bytes).buffer;
      },
      writeFile: async (path: string, data: string) => {
        await api().writeFile(path, data);
      },
      writeBinary: async (path: string, data: ArrayBuffer | Uint8Array) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        await api().writeBinary(path, bytes);
      },
      remove: async (path: string) => {
        await api().deleteFile(path);
      },
      rename: async (oldPath: string, newPath: string) => {
        await api().renameFile(oldPath, newPath);
      },
      copy: async (oldPath: string, newPath: string) => {
        const bytes = await api().readBinary(oldPath);
        await api().writeBinary(newPath, new Uint8Array(bytes));
      },
      rmdir: async (path: string, recursive = false) => {
        await api().deleteDirectory(path);
        await this.refreshFiles();
      },
      getFilePath: (path: string) => `${this.adapter.getBasePath()}/${normalizePath(path)}`,
      getFullPath: (path: string) => `${this.adapter.getBasePath()}/${normalizePath(path)}`,
      getRealPath: (path: string) => `${this.adapter.getBasePath()}/${normalizePath(path)}`,
      getFullRealPath: (path: string) => `${this.adapter.getBasePath()}/${normalizePath(path)}`,
    };

    // Try to recover path from global if available immediately
    this._path = (window as any).__oo_vault_path || '';
  }

  getName(): string {
    // Extract vault name from path
    try {
      const vp = this._path || (window as any).__oo_vault_path || '';
      return vp.split('/').pop() || vp.split('\\').pop() || 'Vault';
    } catch { return 'Vault'; }
  }

  getConfig(key: string): any {
    if (key in this._config) return this._config[key];
    if (key in this.config) return this.config[key];
    try {
      const stored = localStorage.getItem(`oo_vault_config_${key}`);
      return stored === null ? undefined : JSON.parse(stored);
    } catch {
      return undefined;
    }
  }

  setConfig(key: string, value: any): void {
    this._config[key] = value;
    this.config[key] = value;
    try { localStorage.setItem(`oo_vault_config_${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  }

  // ── File Tree Management ──────────────────────────

  /** Rebuild internal file tree from the real filesystem */
  async refreshFiles(): Promise<void> {
    const vaultPath = await api().getVaultPath();
    if (vaultPath) {
      this._path = vaultPath;
      (window as any).__oo_vault_path = vaultPath;
    }

    this._files.clear();
    this._root = new TFolder('/');
    this._root.vault = this;
    this._files.set('/', this._root);
    
    if (!this._path) {
      console.warn('[OOVault] Refresh failed: No vault path set');
      return;
    }

    try {
      const tree = await api().getFileTree();
      this._buildTree(tree, this._root);
    } catch (e) {
      console.warn('[OOVault] Failed to refresh files:', e);
    }
  }

  private _buildTree(entries: any[], parent: TFolder): void {
    for (const entry of entries) {
      if (entry.isDirectory) {
        const folder = new TFolder(entry.path);
        folder.vault = this;
        folder.parent = parent;
        parent.children.push(folder);
        this._files.set(entry.path, folder);
        if (entry.children) this._buildTree(entry.children, folder);
      } else {
        const file = new TFile(entry.path, {
          mtime: entry.modifiedAt,
          size: entry.size,
          ctime: entry.modifiedAt,
        });
        file.vault = this;
        file.parent = parent;
        parent.children.push(file);
        this._files.set(entry.path, file);
      }
    }
  }

  // ── File Access ───────────────────────────────────

  getRoot(): TFolder { return this._root; }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this._files.get(normalizePath(path)) || null;
  }

  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    const normalized = normalizePath(path).toLowerCase();
    for (const [candidate, file] of this._files) {
      if (candidate.toLowerCase() === normalized) return file;
    }
    return null;
  }

  getFileByPath(path: string): TFile | null {
    const f = this._files.get(normalizePath(path));
    return f instanceof TFile ? f : null;
  }

  getFolderByPath(path: string): TFolder | null {
    const f = this._files.get(normalizePath(path));
    return f instanceof TFolder ? f : null;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return Array.from(this._files.values());
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter(f => f.extension === 'md');
  }

  getFiles(): TFile[] {
    return Array.from(this._files.values()).filter((f): f is TFile => f instanceof TFile);
  }

  getAllFolders(includeRoot?: boolean): TFolder[] {
    const folders = Array.from(this._files.values()).filter((f): f is TFolder => f instanceof TFolder);
    if (includeRoot) folders.unshift(this._root);
    return folders;
  }

  getAvailablePath(path: string, extension?: string): string {
    const requested = extension
      ? `${normalizePath(path).replace(/\.[^/.]+$/, '')}.${extension.replace(/^\./, '')}`
      : normalizePath(path);
    if (!this.getAbstractFileByPathInsensitive(requested)) return requested;
    const dot = requested.lastIndexOf('.');
    const slash = requested.lastIndexOf('/');
    const hasExtension = dot > slash;
    const base = hasExtension ? requested.slice(0, dot) : requested;
    const suffix = hasExtension ? requested.slice(dot) : '';
    let index = 1;
    while (this.getAbstractFileByPathInsensitive(`${base} ${index}${suffix}`)) index++;
    return `${base} ${index}${suffix}`;
  }

  getAvailablePathForAttachments(filename: string, sourcePath = ''): string {
    const attachmentFolder = this.getConfig('attachmentFolderPath');
    const sourceFolder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
    const folder = attachmentFolder === './'
      ? sourceFolder
      : typeof attachmentFolder === 'string' && attachmentFolder.length > 0
        ? attachmentFolder
        : '';
    return this.getAvailablePath(folder ? `${folder}/${filename}` : filename);
  }

  exists(path: string, sensitive = true): boolean {
    return sensitive
      ? Boolean(this.getAbstractFileByPath(path))
      : Boolean(this.getAbstractFileByPathInsensitive(path));
  }

  iterateFiles(callback: (file: TFile) => any): void {
    for (const file of this.getFiles()) callback(file);
  }

  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => any): void {
    for (const child of root.children) {
      cb(child);
      if (child instanceof TFolder) OOVault.recurseChildren(child, cb);
    }
  }

  // ── File Operations ───────────────────────────────

  async create(path: string, data: string): Promise<TFile> {
    const np = normalizePath(path);
    await api().createFile(np, data);
    const file = new TFile(np);
    file.vault = this;
    this._files.set(np, file);
    await (window as any).__oo_app?.metadataCache?.updateFileCache?.(file);
    this.trigger('create', file);
    return file;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const np = normalizePath(path);
    await api().writeBinary(np, new Uint8Array(data));
    const file = new TFile(np);
    file.vault = this;
    this._files.set(np, file);
    this.trigger('create', file);
    return file;
  }

  async createFolder(path: string): Promise<void> {
    await api().createDirectory(normalizePath(path));
    const folder = new TFolder(normalizePath(path));
    folder.vault = this;
    this._files.set(normalizePath(path), folder);
  }

  async read(file: TFile): Promise<string> {
    return (await api().readFile(file.path)) || '';
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const bytes = await api().readBinary(file.path);
    return new Uint8Array(bytes).buffer;
  }

  getResourcePath(file: TFile): string {
    return `app://local/${file.path}`;
  }

  async modify(file: TFile, data: string): Promise<void> {
    await api().writeFile(file.path, data);
    file.stat.mtime = Date.now();
    await (window as any).__oo_app?.metadataCache?.updateFileCache?.(file);
    this.trigger('modify', file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    await api().writeBinary(file.path, new Uint8Array(data));
    file.stat.mtime = Date.now();
    this.trigger('modify', file);
  }

  async appendBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    const current = new Uint8Array(await this.readBinary(file));
    const addition = new Uint8Array(data);
    const combined = new Uint8Array(current.length + addition.length);
    combined.set(current);
    combined.set(addition, current.length);
    await this.modifyBinary(file, combined.buffer);
  }

  async append(file: TFile, data: string): Promise<void> {
    const content = await this.read(file);
    await this.modify(file, content + data);
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const data = await this.read(file);
    const result = fn(data);
    await this.modify(file, result);
    return result;
  }

  async delete(file: TAbstractFile, force?: boolean): Promise<void> {
    if (file instanceof TFile) {
      await api().deleteFile(file.path);
    } else {
      await api().deleteDirectory(file.path);
    }
    this._files.delete(file.path);
    (window as any).__oo_app?.metadataCache?.deletePath?.(file.path);
    this.trigger('delete', file);
  }

  async trash(file: TAbstractFile, system?: boolean): Promise<void> {
    const useSystem = system === true;
    if (useSystem) {
      await trashPathSystem(file.path);
    } else {
      await trashPathLocal(file.path);
    }

    const removeEntry = (entry: TAbstractFile) => {
      this._files.delete(entry.path);
      (window as any).__oo_app?.metadataCache?.deletePath?.(entry.path);
    };

    if (file instanceof TFolder) {
      const prefix = file.path.endsWith('/') ? file.path : `${file.path}/`;
      for (const entry of Array.from(this._files.values())) {
        if (entry.path === file.path || entry.path.startsWith(prefix)) {
          removeEntry(entry);
        }
      }
    } else {
      removeEntry(file);
    }

    window.dispatchEvent(new CustomEvent('openonyx:file-deleted', {
      detail: { path: file.path, isDirectory: file instanceof TFolder },
    }));
    this.trigger('delete', file);
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const oldPath = file.path;
    const np = normalizePath(newPath);
    await api().renameFile(oldPath, np);
    const metadataCache = (window as any).__oo_app?.metadataCache;

    const updateEntryPath = async (entry: TAbstractFile, nextPath: string) => {
      const previousPath = entry.path;
      this._files.delete(previousPath);
      entry.path = nextPath;
      entry.name = nextPath.split('/').pop() || nextPath;
      if (entry instanceof TFile) {
        const dotIdx = entry.name.lastIndexOf('.');
        entry.basename = dotIdx > 0 ? entry.name.substring(0, dotIdx) : entry.name;
        entry.extension = dotIdx > 0 ? entry.name.substring(dotIdx + 1) : '';
      }
      this._files.set(nextPath, entry);
      metadataCache?.deletePath?.(previousPath);
      if (entry instanceof TFile) await metadataCache?.updateFileCache?.(entry);
    };

    if (file instanceof TFolder) {
      const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
      const newPrefix = np.endsWith('/') ? np : `${np}/`;
      const descendants = Array.from(this._files.values())
        .filter((entry) => entry.path.startsWith(oldPrefix))
        .sort((a, b) => a.path.length - b.path.length);
      await updateEntryPath(file, np);
      for (const entry of descendants) {
        await updateEntryPath(entry, `${newPrefix}${entry.path.slice(oldPrefix.length)}`);
      }
    } else {
      await updateEntryPath(file, np);
    }

    window.dispatchEvent(new CustomEvent('openonyx:file-renamed', {
      detail: { oldPath, newPath: np, isDirectory: file instanceof TFolder },
    }));
    this.trigger('rename', file, oldPath);
  }

  async copy(file: TAbstractFile, newPath: string): Promise<TAbstractFile> {
    if (file instanceof TFile) {
      const data = await this.read(file);
      return this.create(newPath, data);
    }

    if (file instanceof TFolder) {
      const sourcePath = normalizePath(file.path);
      const destinationPath = normalizePath(newPath);
      const prefix = sourcePath ? `${sourcePath}/` : '';
      const descendants = Array.from(this._files.values())
        .filter((entry) => entry.path.startsWith(prefix))
        .sort((a, b) => a.path.length - b.path.length);

      await api().createDirectory(destinationPath);
      for (const entry of descendants) {
        const relativePath = entry.path.slice(prefix.length);
        const targetPath = `${destinationPath}/${relativePath}`;
        if (entry instanceof TFolder) {
          await api().createDirectory(targetPath);
        } else if (entry instanceof TFile) {
          const bytes = await this.readBinary(entry);
          await api().writeBinary(targetPath, new Uint8Array(bytes));
        }
      }

      await this.refreshFiles();
      const copiedFolder = this.getFolderByPath(destinationPath);
      if (!copiedFolder) throw new Error(`Copied folder was not found: ${destinationPath}`);
      this.trigger('create', copiedFolder);
      return copiedFolder;
    }

    throw new Error('Cannot copy an unknown file type');
  }

  getLastOpenFiles(): string[] { return []; }
}
