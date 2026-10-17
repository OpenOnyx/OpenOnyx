import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileSystemManager } from '../electron/fileSystem';

describe('embedding data atomic storage', () => {
  it('serializes updates and pins in-progress writes to their original vault', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'embedding-atomic-'));
    const first = path.join(root, 'first'); const second = path.join(root, 'second');
    await fs.mkdir(first); await fs.mkdir(second);
    const manager = new FileSystemManager(); manager.setVaultPath(first);
    try {
      const one = manager.writeDataFile('embeddings/v3/note.json', '{"revision":1}');
      const two = manager.writeDataFile('embeddings/v3/note.json', '{"revision":2}');
      manager.setVaultPath(second);
      await Promise.all([one, two]);
      expect(JSON.parse(await fs.readFile(path.join(first, '.openonyx/embeddings/v3/note.json'), 'utf8'))).toEqual({ revision: 2 });
      expect(await fs.readdir(path.join(first, '.openonyx/embeddings/v3'))).toEqual(['note.json']);
      expect(await manager.readDataFile('embeddings/v3/note.json')).toBeNull();
      const pending = manager.writeDataFile('embeddings/v3/deleted.json', '{}');
      const deletion = manager.deleteDataFile('embeddings/v3/deleted.json');
      await Promise.all([pending, deletion]);
      expect(await manager.readDataFile('embeddings/v3/deleted.json')).toBeNull();
      await expect(manager.writeDataFile('../outside.json', '{}')).rejects.toThrow('Path traversal');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
