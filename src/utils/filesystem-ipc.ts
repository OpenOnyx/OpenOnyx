import { FILE_METADATA_CHANNEL, type VaultFileMetadata } from '../../electron/filesystemContract';

export class MissingIpcCapabilityError extends Error {
  readonly code = 'IPC_CAPABILITY_UNAVAILABLE';
  constructor(readonly capability: string, readonly cause?: unknown) {
    super(`OpenOnyx native API ${capability} is unavailable. Fully restart Electron after rebuilding; renderer reload alone cannot update IPC handlers.`);
    this.name = 'MissingIpcCapabilityError';
  }
}

interface MetadataProvider {
  fileMetadata?: (path: string, expectedVault?: string) => Promise<VaultFileMetadata | null>;
}

/** A preload function's presence does not prove its main-process handler exists. */
export async function requestFileMetadata(api: MetadataProvider | undefined, path: string, expectedVault?: string): Promise<VaultFileMetadata | null> {
  if (typeof api?.fileMetadata !== 'function') throw new MissingIpcCapabilityError(FILE_METADATA_CHANNEL);
  try {
    const metadata = await api.fileMetadata(path, expectedVault);
    if (metadata !== null && (!metadata || !Number.isFinite(metadata.modifiedAt) || !Number.isSafeInteger(metadata.size) || metadata.size < 0)) {
      throw new MissingIpcCapabilityError(FILE_METADATA_CHANNEL, new Error('Incompatible file metadata response'));
    }
    return metadata;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No handler registered') && message.includes(FILE_METADATA_CHANNEL)) {
      throw new MissingIpcCapabilityError(FILE_METADATA_CHANNEL, error);
    }
    throw error;
  }
}
