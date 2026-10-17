/** Shared native contract; changing preload alone cannot add a main handler. */
export const FILE_METADATA_CHANNEL = 'fs:fileMetadata';

export interface VaultFileMetadata {
  modifiedAt: number;
  size: number;
}
