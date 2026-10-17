// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: 0, peak: 0, generation: 0, calls: 0, saved: vi.fn(), cached: null as any, delay: null as null | (() => Promise<void>) }));
vi.mock('../src/utils/embeddings', () => ({
  simpleHash: (text: string) => text,
  getEmbeddingGeneration: () => state.generation,
  getEmbeddingVectorType: () => "semantic-test",
  embedText: async (_text: string, priority: number) => {
    expect(priority).toBe(2); state.active++; state.peak = Math.max(state.peak, state.active); state.calls++;
    if (state.delay) await state.delay();
    await new Promise((resolve) => setTimeout(resolve, 1)); state.active--;
    return [1, 0];
  },
}));
vi.mock('../src/utils/api', () => ({ getAPI: () => ({ readFile: async () => '' }) }));
vi.mock('../src/lib/auth', () => ({ authManager: { getUserId: () => null } }));
vi.mock('../src/utils/spaces-store', () => ({
  loadVectorIndex: async () => state.cached, saveVectorIndex: state.saved,
  updateSpace: async () => {}, pushSpaceNotes: async () => {}, pushSpaceChunks: async () => {},
  getSpace: async () => ({ visibility: 'local' }),
}));
import { buildVectorIndex } from '../src/utils/spaces-processing';
beforeEach(() => { state.active = 0; state.peak = 0; state.calls = 0; state.cached = null; state.delay = null; state.saved.mockClear(); });
describe('Spaces inference backpressure', () => {
  it('bounds concurrent requests across notes and chunks and reuses cached notes', async () => {
    const notes = Array.from({ length: 16 }, (_, i) => ({ path: `${i}.md`, title: `${i}`, content: `Topic ${i} background paragraphs. `.repeat(200), isCanvas: false }));
    const index = await buildVectorIndex('space', [], undefined, notes);
    expect(state.peak).toBe(1); expect(state.calls).toBeGreaterThan(16);
    state.cached = index; const calls = state.calls;
    await buildVectorIndex('space', [], undefined, notes);
    expect(state.calls).toBe(calls);
  });

  it('does not write an old-vault index after a vault switch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    state.delay = () => gate;
    const promise = buildVectorIndex('space', [], undefined, [{ path: 'a.md', title: 'a', content: 'Example topic content. '.repeat(200), isCanvas: false }]);
    await vi.waitFor(() => expect(state.calls).toBeGreaterThan(0));
    state.generation++; release();
    await expect(promise).rejects.toThrow('vault switch');
    expect(state.saved).not.toHaveBeenCalled();
  });
});
