// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { getAPI } from '../src/utils/api';
import { getEmbeddingGeneration } from '../src/utils/embeddings';

describe('indexing API event ownership', () => {
  it('invalidates inference before the native vault root changes', async () => {
    const previous = getEmbeddingGeneration();
    (window as any).electronAPI = {
      setVaultPath: vi.fn(async () => {
        expect(getEmbeddingGeneration()).toBeGreaterThan(previous);
        return true;
      }),
    };
    expect(await getAPI().setVaultPath('fixture-vault')).toBe(true);
    expect((window as any).__oo_vault_path).toBe('fixture-vault');
  });
  it('emits one authoritative file-written event for each save', async () => {
    (window as any).electronAPI = { fileExists: async () => true, writeFile: async () => {} };
    const listener = vi.fn(); window.addEventListener('openonyx:file-written', listener);
    try {
      await getAPI().writeFile('fixture.md', 'content');
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'fixture.md', content: 'content', created: false });
    } finally { window.removeEventListener('openonyx:file-written', listener); }
  });
});
