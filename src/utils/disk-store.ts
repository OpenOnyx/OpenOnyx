/**
 * Disk Store — Unified storage abstraction for .openonyx/ data
 *
 * In Electron: reads/writes files to .openonyx/ directory in vault
 * In Browser:  falls back to localStorage with matching API
 *
 * Used by: embeddings, annotations, synthesis, queue
 * All data is stored in JSON format, one file per logical unit.
 */

import { getAPI } from "./api";
import { timeEmbeddingOperation } from "./embedding-performance";

const api = getAPI();

// ── Core Operations ──────────────────────────────────────────────────────────

/**
 * Read a JSON file from .openonyx/<relativePath>
 */
export async function readData<T>(relativePath: string): Promise<T | null> {
  try {
    const raw = await api.dataRead(relativePath);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file to .openonyx/<relativePath>
 */
export async function writeData<T>(relativePath: string, data: T, expectedVault: string | undefined = (window as any).__oo_vault_path): Promise<void> {
  try {
    await timeEmbeddingOperation("cacheWriteMs", () => api.dataWrite(relativePath, JSON.stringify(data), expectedVault));
  } catch (err) {
    console.warn(`[DiskStore] Failed to write ${relativePath}:`, err);
  }
}

/**
 * Delete a file from .openonyx/<relativePath>
 */
export async function deleteData(relativePath: string): Promise<void> {
  try {
    await api.dataDelete(relativePath, (window as any).__oo_vault_path);
  } catch { /* silent */ }
}

/**
 * List files in .openonyx/<subDir>
 */
export async function listData(subDir: string): Promise<string[]> {
  try {
    return await api.dataList(subDir);
  } catch {
    return [];
  }
}

// ── Convenience Wrappers ─────────────────────────────────────────────────────

/**
 * Read a data file with a fallback value if not found.
 */
export async function readDataOr<T>(relativePath: string, fallback: T): Promise<T> {
  const data = await readData<T>(relativePath);
  return data ?? fallback;
}

/**
 * Debounced writer — batches writes to reduce I/O.
 * Returns a function that writes after a delay, coalescing multiple calls.
 */
export interface DebouncedWriter {
  (path: string, data: any): void;
  cancel(path?: string): void;
  flush(): Promise<void>;
}

export function createDebouncedWriter(delayMs = 500): DebouncedWriter {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, { data: any; vault?: string }>();

  const writer = (path: string, data: any) => {
    const existing = timers.get(path);
    if (existing) clearTimeout(existing);

    const vault = (window as any).__oo_vault_path as string | undefined;
    pending.set(path, { data, vault });
    timers.set(
      path,
      setTimeout(() => {
        writeData(path, data, vault);
        pending.delete(path);
        timers.delete(path);
      }, delayMs),
    );
  };
  writer.cancel = (path?: string) => {
    if (path !== undefined) {
      clearTimeout(timers.get(path)); timers.delete(path); pending.delete(path);
    } else {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear(); pending.clear();
    }
  };
  writer.flush = async () => {
    const writes = [...pending];
    writer.cancel();
    for (const [path, value] of writes) await writeData(path, value.data, value.vault);
  };
  return writer;
}
