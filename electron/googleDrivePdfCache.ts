import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_DRIVE_PDF_BYTES = 20 * 1024 * 1024;
export function validPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes.length <= MAX_DRIVE_PDF_BYTES && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
}
export async function readPdfResponse(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > MAX_DRIVE_PDF_BYTES) throw new Error('Google Drive PDF is too large for an inline preview (20 MB maximum).');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Google Drive could not load this PDF.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DRIVE_PDF_BYTES) throw new Error('Google Drive PDF is too large for an inline preview (20 MB maximum).');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (!validPdf(bytes)) throw new Error('Google Drive did not return a valid PDF.');
  return new Uint8Array(bytes);
}
export class GoogleDrivePdfCache {
  constructor(private readonly directory: string) {}
  private filename(accountId: string, fileId: string): string {
    if (!/^drive-[a-f0-9]{24}$/.test(accountId) || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new Error('Invalid Google Drive request.');
    return path.join(this.directory, createHash('sha256').update(`${accountId}:${fileId}`).digest('hex') + '.pdf');
  }
  async read(accountId: string, fileId: string): Promise<Uint8Array | null> {
    const file = this.filename(accountId, fileId);
    try {
      if ((await fs.stat(file)).size > MAX_DRIVE_PDF_BYTES) return null;
      const bytes = await fs.readFile(file);
      return validPdf(bytes) ? new Uint8Array(bytes) : null;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Google Drive PDF cache is unavailable.'); }
  }
  async write(accountId: string, fileId: string, bytes: Uint8Array): Promise<void> {
    const file = this.filename(accountId, fileId);
    if (!validPdf(bytes)) throw new Error('Google Drive did not return a valid PDF.');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 12)}.tmp`;
    try { await fs.writeFile(temporary, bytes, { mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
}
