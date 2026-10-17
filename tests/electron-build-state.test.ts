import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const { staleElectronSources, ensureElectronBuildFresh } = createRequire(import.meta.url)('../scripts/dev/electron-build-state.cjs');

describe('development native build freshness', () => {
  it('rebuilds stale IPC and missing contract output before a launcher can proceed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openonyx-native-build-'));
    try {
      await mkdir(join(root, 'electron')); await mkdir(join(root, 'dist-electron'));
      await writeFile(join(root, 'tsconfig.electron.json'), '{}');
      await writeFile(join(root, 'electron/ipc.ts'), 'export {}');
      await writeFile(join(root, 'electron/filesystemContract.ts'), 'export {}');
      await writeFile(join(root, 'dist-electron/ipc.js'), 'export {}');
      await utimes(join(root, 'dist-electron/ipc.js'), 1, 1);
      expect(staleElectronSources(root)).toHaveLength(2);
      const compile = vi.fn(() => {
        const fs = createRequire(import.meta.url)('node:fs');
        for (const file of ['ipc', 'filesystemContract']) fs.writeFileSync(join(root, `dist-electron/${file}.js`), 'export {}');
        return { status: 0 };
      });
      ensureElectronBuildFresh(root, compile);
      expect(compile).toHaveBeenCalledTimes(1); expect(staleElectronSources(root)).toHaveLength(0);
      ensureElectronBuildFresh(root, compile); expect(compile).toHaveBeenCalledTimes(1);
      await writeFile(join(root, 'electron/preload.ts'), 'export {}');
      expect(() => ensureElectronBuildFresh(root, () => ({ status: 1 }))).toThrow('not started');
      expect(() => ensureElectronBuildFresh(root, () => ({ status: 0 }))).toThrow('remains stale');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
