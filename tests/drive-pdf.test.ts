import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleDrivePdfCache, readPdfResponse, MAX_DRIVE_PDF_BYTES } from '../electron/googleDrivePdfCache';
const account = 'drive-' + 'a'.repeat(24), bytes = new TextEncoder().encode('%PDF-1.4\nlocal document bytes');
it('caches PDF bytes by validated account/file identity across restarts without changing Markdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openonyx-pdf-'));
  try {
    const cache = new GoogleDrivePdfCache(directory);
    await cache.write(account, 'file_1', bytes);
    expect(await new GoogleDrivePdfCache(directory).read(account, 'file_1')).toEqual(bytes);
    expect(await cache.read('drive-' + 'b'.repeat(24), 'file_1')).toBeNull();
    await expect(cache.read(account, '../../credentials')).rejects.toThrow('Invalid');
    await expect(cache.write(account, 'file_1', new TextEncoder().encode('<script>unsafe</script>'))).rejects.toThrow('valid PDF');
    expect(await cache.read(account, 'file_1')).toEqual(bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('bounds PDF downloads by advertised size and streamed bytes and refuses HTML', async () => {
  expect(await readPdfResponse(new Response(bytes))).toEqual(bytes);
  await expect(readPdfResponse(new Response(bytes, { headers: { 'content-length': String(MAX_DRIVE_PDF_BYTES + 1) } }))).rejects.toThrow('too large');
  await expect(readPdfResponse(new Response(new Uint8Array(MAX_DRIVE_PDF_BYTES + 1)))).rejects.toThrow('too large');
  await expect(readPdfResponse(new Response('<html>not a PDF</html>'))).rejects.toThrow('valid PDF');
});
