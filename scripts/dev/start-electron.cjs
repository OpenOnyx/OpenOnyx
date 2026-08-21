const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

env.NODE_ENV = env.NODE_ENV || 'development';

env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const electronMainPath = path.join(process.cwd(), 'dist-electron', 'main.js');
const electronMainMjsPath = path.join(process.cwd(), 'dist-electron', 'main.mjs');
if (!fs.existsSync(electronMainPath)) {
  if (fs.existsSync(electronMainMjsPath)) {
    fs.copyFileSync(electronMainMjsPath, electronMainPath);
  } else {
    console.error(`Electron entry file not found: ${electronMainPath}`);
    console.error(`Electron entry file not found: ${electronMainMjsPath}`);
    console.error('Run "npm run build:electron" or "bun run build:electron" and try again.');
    process.exit(1);
  }
}

function findElectronInstallScript() {
  try {
    return require.resolve('electron/install.js');
  } catch {
    return null;
  }
}

function findElectronPackageDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return null;
  }
}

function getElectronPlatformPath() {
  const platform = process.env.npm_config_platform || process.platform;

  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      return null;
  }
}

function getElectronInstallState() {
  const packageDir = findElectronPackageDir();
  if (!packageDir) {
    return {
      ok: false,
      reason: 'electron package is not installed',
    };
  }

  const platformPath = getElectronPlatformPath();
  if (!platformPath) {
    return {
      ok: false,
      reason: `unsupported Electron platform: ${process.env.npm_config_platform || process.platform}`,
    };
  }

  const pathFile = path.join(packageDir, 'path.txt');
  if (!fs.existsSync(pathFile)) {
    return {
      ok: false,
      reason: `missing ${pathFile}`,
    };
  }

  const executablePath = fs.readFileSync(pathFile, 'utf8').trim();
  if (!executablePath) {
    return {
      ok: false,
      reason: `${pathFile} is empty`,
    };
  }

  const expectedBinary = process.env.ELECTRON_OVERRIDE_DIST_PATH
    ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath)
    : path.join(packageDir, 'dist', executablePath);

  if (!fs.existsSync(expectedBinary)) {
    return {
      ok: false,
      reason: `missing Electron binary at ${expectedBinary}`,
    };
  }

  return {
    ok: true,
    binary: expectedBinary,
  };
}

function isBrokenElectronInstall(error) {
  return error instanceof Error && /Electron failed to install correctly/i.test(error.message);
}

function runElectronInstaller(reason) {
  const installScript = findElectronInstallScript();
  if (!installScript) {
    console.error('Electron is not installed. Run "npm install" or "bun install" and try again.');
    process.exit(1);
  }

  console.warn(`[dev] Electron binary is missing or incomplete (${reason}).`);
  console.warn('[dev] Running Electron installer once before launching...');

  const installEnv = { ...process.env };
  delete installEnv.ELECTRON_SKIP_BINARY_DOWNLOAD;

  const result = spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
    env: installEnv,
  });

  if (result.error) {
    console.error('[dev] Failed to run Electron installer:', result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error('[dev] Electron installer failed.');
    console.error('[dev] Check your network/proxy settings, then run "npm install" or "bun install" again.');
    process.exit(result.status ?? 1);
  }

  const installedState = getElectronInstallState();
  if (!installedState.ok) {
    console.error(`[dev] Electron installer completed, but the install is still incomplete: ${installedState.reason}`);
    console.error('[dev] Delete node_modules/electron and run "npm install" or "bun install" again.');
    process.exit(1);
  }
}

function loadElectronBinary() {
  const installState = getElectronInstallState();
  if (!installState.ok) {
    runElectronInstaller(installState.reason);
  }

  try {
    return require('electron');
  } catch (error) {
    if (!isBrokenElectronInstall(error)) {
      throw error;
    }

    runElectronInstaller(error.message);
    return require('electron');
  }
}

function resolveElectronBinary() {
  let electronBinary = loadElectronBinary();
  if (!fs.existsSync(electronBinary)) {
    runElectronInstaller(`expected binary not found at ${electronBinary}`);
    electronBinary = loadElectronBinary();
  }

  if (!fs.existsSync(electronBinary)) {
    console.error(`Electron binary still not found at: ${electronBinary}`);
    console.error('Run "npm install" again, or remove node_modules/electron and reinstall dependencies.');
    process.exit(1);
  }

  return electronBinary;
}

const electronBinary = resolveElectronBinary();
const electronProcess = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env,
});

electronProcess.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});

electronProcess.on('exit', (code) => {
  process.exit(code ?? 0);
});
