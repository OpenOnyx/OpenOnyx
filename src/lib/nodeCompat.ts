/**
 * Node.js and Electron runtime compatibility shims for Obsidian plugins.
 * Exposes standard Node.js built-ins and Electron remote APIs required by community plugins.
 */

import { Buffer } from 'buffer';
import EventEmitter from 'events';
// @ts-expect-error path-browserify has no type declarations
import path from 'path-browserify';
import util from 'util';
import { StringDecoder } from 'string_decoder';

// Ensure global Buffer and process versions exist for sandboxed renderer / bundler checks
try {
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (!win.Buffer) win.Buffer = Buffer;
    if (!win.process) {
      win.process = { versions: { electron: '32.0.0', node: '22.0.0' }, platform: 'linux', env: {} };
    } else {
      try {
        if (!win.process.versions) {
          win.process.versions = { electron: '32.0.0', node: '22.0.0' };
        } else if (!win.process.versions.electron) {
          Object.defineProperty(win.process.versions, 'electron', {
            value: '32.0.0',
            writable: true,
            configurable: true,
          });
        }
      } catch {
        // Versions object is read-only in Node/Vitest
      }
      try {
        if (!win.process.platform) win.process.platform = 'linux';
        if (!win.process.env) win.process.env = {};
        if (!win.process.nextTick) win.process.nextTick = (fn: (...args: any[]) => void, ...args: any[]) => setTimeout(() => fn(...args), 0);
      } catch {
        // Read-only in Node/Vitest
      }
    }
  }
} catch {
  // Ignore
}

// ── @electron/remote mock ──────────────────────────────────────────
const mockWindow = {
  isDestroyed: () => false,
  webContents: {
    executeJavaScript: async (code: string) => {
      try {
        return window.eval(code);
      } catch {
        return null;
      }
    },
    send: () => {},
    on: () => {},
    once: () => {},
    removeListener: () => {},
  },
  title: typeof document !== 'undefined' ? document.title : 'OpenOnyx',
  setBounds: () => {},
  getBounds: () => ({
    x: 0,
    y: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 1000,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }),
  focus: () => {
    if (typeof window !== 'undefined') window.focus();
  },
  close: () => {},
  hide: () => {},
  show: () => {},
  setAlwaysOnTop: () => {},
  setOpacity: () => {},
  setTitle: (t: string) => {
    if (typeof document !== 'undefined') document.title = t;
  },
  getTitle: () => (typeof document !== 'undefined' ? document.title : 'OpenOnyx'),
  minimize: () => {},
  maximize: () => {},
  unmaximize: () => {},
  isMaximized: () => false,
  setResizable: () => {},
  setSize: () => {},
  setPosition: () => {},
  setSkipTaskbar: () => {},
  setIgnoreMouseEvents: () => {},
};

export const electronRemote = {
  BrowserWindow: {
    getAllWindows: () => [mockWindow],
    getFocusedWindow: () => mockWindow,
    fromWebContents: () => mockWindow,
    fromId: () => mockWindow,
  },
  getCurrentWindow: () => mockWindow,
  getCurrentWebContents: () => mockWindow.webContents,
  app: {
    getPath: (name: string) => {
      const api = (window as any).electronAPI;
      return api?.getSystemPath?.(name) || '';
    },
    getName: () => 'OpenOnyx',
    getVersion: () => '1.0.4',
    getAppPath: () => '',
  },
  dialog: {
    showOpenDialog: (opts: any) => (window as any).electronAPI?.showOpenDialog?.(opts),
    showSaveDialog: (opts: any) => (window as any).electronAPI?.showSaveDialog?.(opts),
  },
  shell: {
    openPath: (p: string) => (window as any).electronAPI?.openPath?.(p),
    openExternal: (u: string) => (window as any).electronAPI?.openExternal?.(u),
    showItemInFolder: (p: string) => (window as any).electronAPI?.showItemInFolder?.(p),
  },
  Menu: class Menu {
    items: any[] = [];
    append(item: any) {
      this.items.push(item);
    }
    popup() {}
  },
  MenuItem: class MenuItem {
    constructor(public opts: any) {}
  },
};
(electronRemote as any).default = electronRemote;

// ── OS ─────────────────────────────────────────────────────────────
const os = {
  homedir: () => (window as any).electronAPI?.getSystemPath?.('home') || '',
  platform: () => 'linux',
  type: () => 'Linux',
  release: () => '6.0.0',
  tmpdir: () => '/tmp',
  EOL: '\n',
  cpus: () => [{ model: 'Virtual CPU', speed: 2000 }],
  totalmem: () => 16 * 1024 * 1024 * 1024,
  freemem: () => 8 * 1024 * 1024 * 1024,
  hostname: () => 'localhost',
  uptime: () => 3600,
  arch: () => 'x64',
  endianness: () => 'LE',
};
(os as any).default = os;

// ── FS ─────────────────────────────────────────────────────────────
const fsPromises = {
  readFile: async (filePath: string, enc?: string) => {
    const api = (window as any).electronAPI;
    if (enc === 'utf8' || enc === 'utf-8' || !enc) {
      return await api.readFile(filePath);
    }
    const bin = await api.readBinary(filePath);
    return Buffer.from(bin);
  },
  writeFile: async (filePath: string, data: any) => {
    const api = (window as any).electronAPI;
    return await api.writeFile(filePath, typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
  },
  exists: async (filePath: string) => {
    try {
      await (window as any).electronAPI.readFile(filePath);
      return true;
    } catch {
      return false;
    }
  },
  stat: async (_filePath: string) => ({
    isFile: () => true,
    isDirectory: () => false,
    size: 1000,
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
  }),
  readdir: async (dirPath: string) => {
    return await (window as any).electronAPI.listFiles(dirPath);
  },
  mkdir: async () => {},
  unlink: async () => {},
  rmdir: async () => {},
};

const fs = {
  promises: fsPromises,
  readFileSync: (_filePath: string) => '',
  writeFileSync: () => {},
  existsSync: () => false,
  statSync: () => ({
    isFile: () => true,
    isDirectory: () => false,
    size: 1000,
    mtime: new Date(),
  }),
  lstatSync: () => ({
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: 1000,
  }),
  readdirSync: () => [],
  mkdirSync: () => {},
  createReadStream: () => new EventEmitter(),
  createWriteStream: () => new EventEmitter(),
  watch: () => ({ close: () => {} }),
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  },
};
(fs as any).default = fs;

// ── Net & TLS & DNS ─────────────────────────────────────────────────
class Socket extends EventEmitter {
  connecting = false;
  destroyed = false;
  writable = true;
  readable = true;
  connect(..._args: any[]) {
    setTimeout(() => this.emit('connect'), 10);
    return this;
  }
  write(_data: any, cb?: any) {
    if (cb) cb();
    return true;
  }
  end(cb?: any) {
    if (cb) cb();
    this.emit('end');
    return this;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }
}

const net = {
  Socket,
  createConnection: () => new Socket(),
  connect: () => new Socket(),
  isIP: () => 0,
  isIPv4: () => false,
  isIPv6: () => false,
};
(net as any).default = net;

class TLSSocket extends Socket {
  authorized = true;
}
const tls = {
  TLSSocket,
  connect: () => new TLSSocket(),
  checkServerIdentity: () => undefined,
};
(tls as any).default = tls;

const dns = {
  lookup: (_domain: string, _opts: any, cb: any) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, '127.0.0.1', 4);
  },
  resolve: (_domain: string, cb: any) => {
    if (cb) cb(null, ['127.0.0.1']);
  },
  promises: {
    lookup: async () => ({ address: '127.0.0.1', family: 4 }),
    resolve: async () => ['127.0.0.1'],
  },
};
(dns as any).default = dns;

// ── Child Process ──────────────────────────────────────────────────
const child_process = {
  exec: (_cmd: string, _opts: any, cb: any) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error('child_process.exec not supported in renderer'), '', '');
  },
  spawn: () => {
    const cp = new EventEmitter();
    (cp as any).stdout = new EventEmitter();
    (cp as any).stderr = new EventEmitter();
    (cp as any).stdin = new EventEmitter();
    return cp;
  },
  fork: () => {
    const cp = new EventEmitter();
    return cp;
  },
  execSync: () => '',
};
(child_process as any).default = child_process;

// ── Stream ─────────────────────────────────────────────────────────
class Stream extends EventEmitter {
  pipe(dest: any) { return dest; }
}
class Readable extends Stream {
  read() { return null; }
}
class Writable extends Stream {
  write(_chunk: any, cb?: any) { if (cb) cb(); return true; }
  end(cb?: any) { if (cb) cb(); return this; }
}
class Transform extends Stream {
  _transform(chunk: any, _enc: any, cb: any) { cb(null, chunk); }
}
class PassThrough extends Transform {}
const stream = {
  Stream,
  Readable,
  Writable,
  Transform,
  PassThrough,
  pipeline: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null);
  },
};
(stream as any).default = stream;

// ── Crypto ─────────────────────────────────────────────────────────
const cryptoModule = {
  getRandomValues: <T extends ArrayBufferView | null>(arr: T): T => {
    return window.crypto.getRandomValues(arr as any);
  },
  randomBytes: (size: number): Buffer => {
    const b = Buffer.alloc(size);
    window.crypto.getRandomValues(b);
    return b;
  },
  randomUUID: () => (window.crypto.randomUUID ? window.crypto.randomUUID() : '00000000-0000-0000-0000-000000000000'),
  createHash: () => {
    let data = '';
    return {
      update: (d: any) => {
        data += typeof d === 'string' ? d : Buffer.from(d).toString('utf8');
        return this;
      },
      digest: (encoding = 'hex') => {
        return Buffer.from(data).toString(encoding as any);
      },
    };
  },
  subtle: window.crypto.subtle,
};
(cryptoModule as any).default = cryptoModule;

// Wrap buffer, util, path, string_decoder, events with both named and default exports for CJS interoperability
const bufferModule = { Buffer, default: { Buffer } };
(Buffer as any).default = Buffer;

const stringDecoderModule = { StringDecoder, default: { StringDecoder } };
(StringDecoder as any).default = StringDecoder;

const pathModule = { ...path, default: path };
const utilModule = { ...util, default: util };
const eventsModule = { EventEmitter, default: EventEmitter };

export const nodeCompatModules: Record<string, any> = {
  buffer: bufferModule,
  'node:buffer': bufferModule,
  string_decoder: stringDecoderModule,
  'node:string_decoder': stringDecoderModule,
  path: pathModule,
  'node:path': pathModule,
  'path-browserify': pathModule,
  util: utilModule,
  'node:util': utilModule,
  events: eventsModule,
  'node:events': eventsModule,
  os,
  'node:os': os,
  fs,
  'node:fs': fs,
  net,
  'node:net': net,
  tls,
  'node:tls': tls,
  dns,
  'node:dns': dns,
  child_process,
  'node:child_process': child_process,
  stream,
  'node:stream': stream,
  crypto: cryptoModule,
  'node:crypto': cryptoModule,
  '@electron/remote': electronRemote,
  '@electron/remote/main': electronRemote,
};
