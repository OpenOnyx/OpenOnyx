/**
 * OpenOnyx - Electron Main Process
 * 
 * Handles window creation, IPC communication, and lifecycle management.
 * All filesystem operations are delegated to the fileSystem module and
 * exposed to the renderer via secure IPC channels.
 */

import { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut, shell, session, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { FileSystemManager } from './fileSystem.js';
import { SearchEngine } from './search.js';
import { registerIpcHandlers } from './ipc.js';
import { isInsideRoot } from './pathSafety.js';
import { approveVaultPath } from './vaultAccess.js';

// Register vault:// protocol as privileged before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let fsManager: FileSystemManager | null = null;
let searchEngine: SearchEngine | null = null;

const isDevMode = !app.isPackaged;
const MAX_RECENT_VAULTS = 20;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.exit(0);
}

type VaultHistoryState = {
  currentVaultPath: string | null;
  previousVaultPaths: string[];
};

function getVaultHistoryFilePath(): string {
  return path.join(app.getPath('userData'), 'vault-history.json');
}

function normalizeVaultPath(vaultPath: string): string {
  return path.resolve(vaultPath);
}

function readVaultHistoryState(): VaultHistoryState {
  try {
    const raw = fs.readFileSync(getVaultHistoryFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultHistoryState>;
    return {
      currentVaultPath: typeof parsed.currentVaultPath === 'string'
        ? normalizeVaultPath(parsed.currentVaultPath)
        : null,
      previousVaultPaths: Array.isArray(parsed.previousVaultPaths)
        ? parsed.previousVaultPaths
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
            .map(normalizeVaultPath)
        : [],
    };
  } catch {
    return { currentVaultPath: null, previousVaultPaths: [] };
  }
}

function writeVaultHistoryState(state: VaultHistoryState): void {
  const uniquePaths = Array.from(new Set(state.previousVaultPaths.map(normalizeVaultPath)));
  const normalizedState: VaultHistoryState = {
    currentVaultPath: state.currentVaultPath ? normalizeVaultPath(state.currentVaultPath) : null,
    previousVaultPaths: uniquePaths.slice(0, MAX_RECENT_VAULTS),
  };

  const filePath = getVaultHistoryFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizedState, null, 2), 'utf8');
}

function rememberVaultPath(vaultPath: string): void {
  const normalizedPath = normalizeVaultPath(vaultPath);
  const state = readVaultHistoryState();
  writeVaultHistoryState({
    currentVaultPath: normalizedPath,
    previousVaultPaths: [
      normalizedPath,
      ...state.previousVaultPaths.filter((entry) => entry !== normalizedPath),
    ],
  });
}

function getPreviousVaultPaths(): string[] {
  return readVaultHistoryState().previousVaultPaths;
}

function removePreviousVaultPath(vaultPath: string): string[] {
  const normalizedPath = normalizeVaultPath(vaultPath);
  const state = readVaultHistoryState();
  const previousVaultPaths = state.previousVaultPaths.filter((entry) => entry !== normalizedPath);
  writeVaultHistoryState({
    currentVaultPath: state.currentVaultPath === normalizedPath ? null : state.currentVaultPath,
    previousVaultPaths,
  });
  return previousVaultPaths;
}

function restoreLastVault(fsManager: FileSystemManager): void {
  const state = readVaultHistoryState();
  const lastVaultPath = state.currentVaultPath;
  if (!lastVaultPath) return;

  try {
    if (!fs.existsSync(lastVaultPath) || !fs.statSync(lastVaultPath).isDirectory()) return;
    if (!fsManager.setVaultPath(lastVaultPath)) return;
    try {
      process.chdir(lastVaultPath);
      console.log(`[Startup] Restored vault CWD to: ${lastVaultPath}`);
    } catch (err) {
      console.warn(`[Startup] Failed to change CWD to ${lastVaultPath}:`, err);
    }
  } catch (err) {
    console.warn(`[Startup] Failed to restore last vault ${lastVaultPath}:`, err);
  }
}

function addDisableFeatures(features: string[]): void {
  const existing = app.commandLine.getSwitchValue('disable-features');
  const merged = new Set([
    ...existing.split(',').map((item) => item.trim()).filter(Boolean),
    ...features,
  ]);
  app.commandLine.appendSwitch('disable-features', [...merged].join(','));
}

function configureLinuxFontConfig(): void {
  if (process.platform !== 'linux') return;
  if (process.env.FONTCONFIG_PATH && process.env.FONTCONFIG_FILE) return;

  const candidates = [
    { path: '/etc/fonts', file: '/etc/fonts/fonts.conf' },
    { path: '/usr/share/defaults/fonts', file: '/usr/share/defaults/fonts/fonts.conf' },
    { path: '/usr/local/etc/fonts', file: '/usr/local/etc/fonts/fonts.conf' },
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.file)) continue;
    if (!process.env.FONTCONFIG_PATH) process.env.FONTCONFIG_PATH = candidate.path;
    if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = candidate.file;
    break;
  }
}

function registerWidevineCDM(): void {
  if (process.platform !== 'linux') return;

  const candidateDirs = [
    '/opt/google/chrome/WidevineCdm',
    '/opt/microsoft/msedge/WidevineCdm',
  ];

  try {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'varshith');
    const chromeUserCdmDir = path.join(homeDir, '.config/google-chrome/WidevineCdm');
    if (fs.existsSync(chromeUserCdmDir)) {
      const subdirs = fs.readdirSync(chromeUserCdmDir);
      for (const subdir of subdirs) {
        candidateDirs.push(path.join(chromeUserCdmDir, subdir));
      }
    }
  } catch (err) {
    // Ignore errors reading user home
  }

  for (const cdmDir of candidateDirs) {
    const cdmPath = path.join(cdmDir, '_platform_specific/linux_x64/libwidevinecdm.so');
    const manifestPath = path.join(cdmDir, 'manifest.json');

    if (fs.existsSync(cdmPath) && fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const version = manifest.version;
        if (typeof version === 'string') {
          app.commandLine.appendSwitch('widevine-cdm-path', cdmPath);
          app.commandLine.appendSwitch('widevine-cdm-version', version);
          console.log(`[DRM] Successfully registered Widevine CDM version ${version} from ${cdmPath}`);
          return;
        }
      } catch (err) {
        console.warn(`[DRM] Failed to read manifest at ${manifestPath}:`, err);
      }
    }
  }

  console.warn('[DRM] No Widevine CDM library could be located on this Linux system.');
}

function configureChromiumRuntime(): void {
  configureLinuxFontConfig();
  registerWidevineCDM();

  const debugPort = process.env.OPENONYX_DEBUG_PORT;
  if (debugPort && /^\d+$/.test(debugPort)) {
    app.commandLine.appendSwitch('remote-debugging-port', debugPort);
  }

  // Enable smooth scrolling on all platforms (especially important on Linux
  // where Electron/Chromium ships with smooth scrolling disabled by default).
  app.commandLine.appendSwitch('enable-smooth-scrolling');
  app.commandLine.appendSwitch('enable-features', 'ScrollUnification');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('canvas-oop-rasterization');

  if (!isDevMode) return;
  if (process.env.OPENONYX_VERBOSE_CHROMIUM_LOGS === '1') return;

  // Suppress noisy Chromium diagnostics that are non-actionable in local dev.
  app.commandLine.appendSwitch('disable-logging');
  app.commandLine.appendSwitch('log-level', '3');
  app.commandLine.appendSwitch('no-first-run');
  app.commandLine.appendSwitch('no-default-browser-check');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-client-side-phishing-detection');
  app.commandLine.appendSwitch('metrics-recording-only');

  addDisableFeatures([
    'MediaRouter',
    'OptimizationHints',
    'AutofillServerCommunication',
    'SegmentationPlatform',
  ]);
}

function findFileInVault(dir: string, fileName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileInVault(fullPath, fileName);
        if (found) return found;
      } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
        return fullPath;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAppRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Check if it's a redirect back to our app with auth tokens
    return (
      (parsed.hostname === 'localhost' && parsed.port === '5173') ||
      (parsed.hostname === '127.0.0.1' && parsed.port === '5173')
    );
  } catch {
    return false;
  }
}

function shouldForwardRendererLog(message: string): boolean {
  const suppressedMessages = [
    '[vite] server connection lost. Polling for restart...',
  ];
  return !suppressedMessages.some((entry) => message.includes(entry));
}

/** Create the main application window */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'OpenOnyx',
    backgroundColor: '#0f0f14',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : false,
    icon: process.platform === 'win32'
      ? path.join(__dirname, '../build/icon.ico')
      : path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // In development, load from Vite dev server
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Strip OAuth tokens from URL hash after load
  mainWindow.webContents.on('did-finish-load', () => {
    const current = mainWindow?.webContents.getURL() || '';
    if (current.includes('#access_token=')) {
      const clean = current.split('#')[0];
      void mainWindow?.webContents.loadURL(clean);
    }
  });

  // Debugging: Forward renderer console logs to main process console
  mainWindow.webContents.on('console-message', (details) => {
    const { message, sourceId, lineNumber } = details;
    if (!shouldForwardRendererLog(message)) return;
    console.log(`[RENDERER] ${message} (at ${sourceId}:${lineNumber})`);
  });

  // OAuth redirect handling: if redirect goes back to our app with auth tokens, handle it
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!mainWindow) return;

    // If redirect is back to our app, let it happen (it contains auth tokens)
    if (isAppRedirectUrl(navigationUrl)) {
      return;
    }

    if (!isExternalHttpUrl(navigationUrl)) return;

    let isSameOrigin = false;
    try {
      const currentUrl = mainWindow.webContents.getURL();
      isSameOrigin = new URL(navigationUrl).origin === new URL(currentUrl).origin;
    } catch {
      isSameOrigin = false;
    }

    if (isSameOrigin) return;
    event.preventDefault();
    void shell.openExternal(navigationUrl);
  });

  // // Open DevTools by default for debugging
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Build the application menu */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Vault',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-vault'),
        },
        { type: 'separator' },
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-note'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Graph View',
          accelerator: 'CmdOrCtrl+G',
          click: () => mainWindow?.webContents.send('menu:toggle-graph'),
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:command-palette'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Register custom protocol handler for vault:// local asset loading
  protocol.handle('vault', async (request) => {
    try {
      const url = new URL(request.url);
      let relativePath = decodeURIComponent(url.pathname);
      if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);

      const vaultPath = fsManager?.getVaultPath();
      if (!vaultPath) {
        return new Response('Vault path not set', { status: 404 });
      }

      let targetPath = path.resolve(vaultPath, relativePath);
      if (!isInsideRoot(vaultPath, targetPath)) {
        return new Response('Path traversal detected', { status: 403 });
      }
      if (!fs.existsSync(targetPath)) {
        // Fallback: search for file by basename in vault
        const fileName = path.basename(relativePath);
        const found = findFileInVault(vaultPath, fileName);
        if (found && fs.existsSync(found)) {
          targetPath = found;
        } else {
          return new Response('File not found', { status: 404 });
        }
      }

      return net.fetch(pathToFileURL(targetPath).toString());
    } catch (err) {
      console.error('[Vault Protocol Error]', err);
      return new Response('Internal error', { status: 500 });
    }
  });

  // Set a clean User Agent for the session to bypass login blocks on services like Apple and Spotify
  const originalUserAgent = session.defaultSession.getUserAgent();
  const cleanUserAgent = originalUserAgent
    .replace(/Electron\/[0-9.]+\s?/g, '')
    .replace(/OpenOnyx\/[0-9.]+\s?/g, '');
  session.defaultSession.setUserAgent(cleanUserAgent);

  const requestInfo = new Map<number, { origin?: string; requestHeadersList?: string }>();

  // Track request Origin and Request Headers to accurately mock CORS response headers later
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    const origin = requestHeaders['Origin'] || requestHeaders['origin'] || requestHeaders['Referer'] || requestHeaders['referer'];
    const requestHeadersList = requestHeaders['Access-Control-Request-Headers'] || requestHeaders['access-control-request-headers'];
    if (origin || requestHeadersList) {
      requestInfo.set(details.id, { origin, requestHeadersList });
    }
    callback({ requestHeaders });
  });

  const cleanUpRequest = (details: { id: number }) => {
    requestInfo.delete(details.id);
  };
  session.defaultSession.webRequest.onCompleted(cleanUpRequest);
  session.defaultSession.webRequest.onErrorOccurred(cleanUpRequest);

  // Intercept response headers to bypass CSP (Content Security Policy), X-Frame-Options, and CORS
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    const isIframe = details.resourceType === 'subFrame';

    // Remove X-Frame-Options to allow framing
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === 'x-frame-options') {
        delete responseHeaders[key];
      }
    }

    // Strip CSP for iframe documents
    if (isIframe) {
      for (const key of Object.keys(responseHeaders)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'content-security-policy' || lowerKey === 'content-security-policy-report-only') {
          delete responseHeaders[key];
        }
      }
    } else {
      // For other resource types (e.g. main frame, scripts), keep CSP but strip frame-ancestors
      for (const key of Object.keys(responseHeaders)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'content-security-policy' || lowerKey === 'content-security-policy-report-only') {
          const values = responseHeaders[key];
          if (Array.isArray(values)) {
            responseHeaders[key] = values.map((policy) => {
              return policy
                .split(';')
                .map((directive) => {
                  const trimmed = directive.trim();
                  if (trimmed.toLowerCase().startsWith('frame-ancestors')) {
                    return '';
                  }
                  return directive;
                })
                .filter(Boolean)
                .join('; ');
            });
          }
        }
      }
    }

    // Fix CORS for target domains (Apple and Spotify)
    const url = details.url.toLowerCase();
    const isTargetDomain = url.includes('.apple.com') || url.includes('.spotify.com') || url.includes('.spotify.net');
    if (isTargetDomain) {
      const info = requestInfo.get(details.id);
      if (info) {
        requestInfo.delete(details.id);
      }

      // Remove existing CORS headers
      for (const key of Object.keys(responseHeaders)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey === 'access-control-allow-origin' ||
          lowerKey === 'access-control-allow-credentials' ||
          lowerKey === 'access-control-allow-methods' ||
          lowerKey === 'access-control-allow-headers'
        ) {
          delete responseHeaders[key];
        }
      }

      // Inject permissive CORS headers reflecting the actual request origin
      const origin = info?.origin;
      if (origin) {
        const cleanOrigin = origin.replace(/\/$/, '');
        responseHeaders['access-control-allow-origin'] = [cleanOrigin];
        responseHeaders['access-control-allow-credentials'] = ['true'];
      } else {
        responseHeaders['access-control-allow-origin'] = ['*'];
      }

      responseHeaders['access-control-allow-methods'] = ['GET, POST, OPTIONS, PUT, DELETE, PATCH'];
      
      const requestedHeaders = info?.requestHeadersList;
      if (requestedHeaders) {
        responseHeaders['access-control-allow-headers'] = [requestedHeaders];
      } else {
        responseHeaders['access-control-allow-headers'] = ['Authorization, Content-Type, Accept, Origin, User-Agent, DNT, Cache-Control, X-Requested-With, Keep-Alive, If-Modified-Since, X-Apple-Store-Front, X-Apple-Music-Device-Id'];
      }
    } else {
      // Fix CORS for fonts and static assets in other cross-origin frames
      try {
        const pathname = new URL(details.url).pathname.toLowerCase();
        const isFontOrAsset = pathname.endsWith('.woff') || 
                              pathname.endsWith('.woff2') || 
                              pathname.endsWith('.ttf') || 
                              pathname.endsWith('.otf') || 
                              pathname.endsWith('.eot') ||
                              pathname.endsWith('.svg');
        if (isFontOrAsset) {
          for (const key of Object.keys(responseHeaders)) {
            if (key.toLowerCase() === 'access-control-allow-origin') {
              delete responseHeaders[key];
            }
          }
          responseHeaders['access-control-allow-origin'] = ['*'];
        }
      } catch {
        // Ignore URL parsing errors
      }
    }

    callback({ cancel: false, responseHeaders });
  });

  fsManager = new FileSystemManager();
  searchEngine = new SearchEngine();
  restoreLastVault(fsManager);

  // Register all IPC handlers for renderer communication
  registerIpcHandlers(
    ipcMain,
    fsManager,
    searchEngine,
    () => mainWindow,
    rememberVaultPath,
    getPreviousVaultPaths,
    removePreviousVaultPath,
  );

  // Handle vault directory selection dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
          title: 'Select Vault Directory',
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select Vault Directory',
        });
    if (result.canceled || !result.filePaths[0]) return null;
    approveVaultPath(result.filePaths[0]);
    return result.filePaths[0];
  });

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on exit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
