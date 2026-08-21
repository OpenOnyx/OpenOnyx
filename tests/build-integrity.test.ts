import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');

describe('Build and Packaging Integrity Checks', () => {
  it('should verify package.json structure and build configuration', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Verify metadata
    expect(pkg.name).toBe('openonyx');
    expect(pkg.main).toBe('dist-electron/main.js');

    // Verify electron-builder configurations
    expect(pkg.build).toBeDefined();
    expect(pkg.build.appId).toBe('com.openonyx.app');
    expect(pkg.build.productName).toBe('OpenOnyx');
    expect(pkg.build.directories?.output).toBe('release');

    // Verify files array has required directories
    expect(pkg.build.files).toContain('dist/**/*');
    expect(pkg.build.files).toContain('dist-electron/**/*');
    expect(pkg.build.files).toContain('package.json');
  });

  it('should verify release assets and files exist in the build/ directory', () => {
    const buildDir = path.join(rootDir, 'build');
    expect(fs.existsSync(buildDir)).toBe(true);

    // Required packaging icons
    expect(fs.existsSync(path.join(buildDir, 'icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'icon.ico'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'icon.icns'))).toBe(true);

    // macOS entitlements
    expect(fs.existsSync(path.join(buildDir, 'entitlements.mac.plist'))).toBe(true);
  });

  it('should verify Linux post-packaging script dependencies and configuration', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Check custom scripts
    const linuxScriptPath = path.join(rootDir, 'scripts/linux/package-linux.cjs');
    expect(fs.existsSync(linuxScriptPath)).toBe(true);

    // Check that deb package dependencies and arch package dependencies match builder configuration
    expect(pkg.build.deb?.depends).toBeDefined();
    expect(pkg.build.pacman?.depends).toBeDefined();

    // Verify after-install script exists if declared
    if (pkg.build.deb?.afterInstall) {
      const afterInstallPath = path.join(rootDir, pkg.build.deb.afterInstall);
      expect(fs.existsSync(afterInstallPath)).toBe(true);
    }
  });

  it('should verify typescript electron compilation configuration exists', () => {
    const tsconfigElectron = path.join(rootDir, 'tsconfig.electron.json');
    expect(fs.existsSync(tsconfigElectron)).toBe(true);

    const tsconfigContent = JSON.parse(fs.readFileSync(tsconfigElectron, 'utf8'));
    expect(tsconfigContent.compilerOptions?.outDir).toContain('dist-electron');
  });
});
