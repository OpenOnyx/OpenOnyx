// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ dataWrite: vi.fn(async () => {}), dataRead: vi.fn(), dataDelete: vi.fn(), dataList: vi.fn() }));
vi.mock('../src/utils/api', () => ({ getAPI: () => api }));
import { createDebouncedWriter } from '../src/utils/disk-store';

describe('vault-scoped persistence lifecycle', () => {
  it('coalesces writes, captures their vault, flushes, and cancels obsolete paths', async () => {
    const writer = createDebouncedWriter(10000);
    (window as any).__oo_vault_path = 'vault-a';
    writer('note.json', { version: 1 }); writer('note.json', { version: 2 });
    writer('removed.json', { removed: false }); writer.cancel('removed.json');
    (window as any).__oo_vault_path = 'vault-b';
    await writer.flush();
    expect(api.dataWrite).toHaveBeenCalledExactlyOnceWith('note.json', '{"version":2}', 'vault-a');
    writer('old.json', {}); writer.cancel(); await writer.flush();
    expect(api.dataWrite).toHaveBeenCalledTimes(1);
  });
});
