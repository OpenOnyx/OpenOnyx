import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const MAX_DRIVE_PREVIEW_BYTES = 25 * 1024 * 1024;
export const MAX_DRIVE_PREVIEW_CACHE_BYTES = 250 * 1024 * 1024;

export interface CachedDrivePreview {
  bytes: Uint8Array;
  mimeType: string;
  cachedAt: string;
}

export async function readBoundedDriveResponse(response: Response, mimeType: string): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_DRIVE_PREVIEW_BYTES) {
    throw new Error('Google Drive file is too large for an inline preview (25 MB maximum).');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Google Drive could not load this file.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_DRIVE_PREVIEW_BYTES) throw new Error('Google Drive file is too large for an inline preview (25 MB maximum).');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const textMime = mimeType.toLowerCase();
  if (bytes.length > 32 && textMime.includes('html') && Buffer.from(bytes.subarray(0, 256)).toString('utf8').toLowerCase().includes('<html')) {
    throw new Error('Google Drive did not return a previewable file.');
  }
  return bytes;
}

export class GoogleDriveFileCache {
  constructor(private readonly directory: string) {}

  private base(accountId: string, fileId: string): string {
    if (!/^drive-[a-f0-9]{24}$/.test(accountId) || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new Error('Invalid Google Drive request.');
    return path.join(this.directory, createHash('sha256').update(`${accountId}:${fileId}`).digest('hex'));
  }

  async read(accountId: string, fileId: string): Promise<CachedDrivePreview | null> {
    const file = this.base(accountId, fileId);
    try {
      const meta = JSON.parse(await fs.readFile(`${file}.json`, 'utf8')) as Partial<CachedDrivePreview>;
      if (typeof meta.mimeType !== 'string' || typeof meta.cachedAt !== 'string') return null;
      const stat = await fs.stat(`${file}.bin`);
      if (stat.size > MAX_DRIVE_PREVIEW_BYTES) return null;
      await fs.utimes(`${file}.bin`, new Date(), new Date()).catch(() => undefined);
      return { bytes: await fs.readFile(`${file}.bin`), mimeType: meta.mimeType.slice(0, 200), cachedAt: meta.cachedAt.slice(0, 40) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Google Drive preview cache is unavailable.');
    }
  }

  async write(accountId: string, fileId: string, value: CachedDrivePreview): Promise<void> {
    if (value.bytes.length > MAX_DRIVE_PREVIEW_BYTES || typeof value.mimeType !== 'string' || !value.mimeType) {
      throw new Error('Google Drive file is too large for an inline preview (25 MB maximum).');
    }
    const file = this.base(accountId, fileId);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const cached = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.bin')).map(async entry => {
      const filename = path.join(this.directory, entry.name);
      const stat = await fs.stat(filename);
      return { filename, bytes: stat.size, accessedAt: stat.atimeMs };
    }));
    const existing = cached.find(entry => entry.filename === `${file}.bin`);
    let total = cached.reduce((sum, entry) => sum + entry.bytes, 0) - (existing?.bytes ?? 0);
    for (const entry of cached.filter(entry => entry.filename !== `${file}.bin`).sort((a, b) => a.accessedAt - b.accessedAt)) {
      if (total + value.bytes.length <= MAX_DRIVE_PREVIEW_CACHE_BYTES) break;
      await fs.rm(entry.filename, { force: true });
      await fs.rm(entry.filename.replace(/\.bin$/, '.json'), { force: true });
      total -= entry.bytes;
    }
    const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    const temporaryBytes = `${file}.${suffix}.tmp`;
    const temporaryMetadata = `${file}.${suffix}.json.tmp`;
    try {
      await fs.writeFile(temporaryBytes, value.bytes, { mode: 0o600 });
      await fs.writeFile(temporaryMetadata, JSON.stringify({ mimeType: value.mimeType.slice(0, 200), cachedAt: value.cachedAt }), { mode: 0o600 });
      await fs.rename(temporaryBytes, `${file}.bin`);
      await fs.rename(temporaryMetadata, `${file}.json`);
    } finally {
      await fs.rm(temporaryBytes, { force: true });
      await fs.rm(temporaryMetadata, { force: true });
    }
  }
}
