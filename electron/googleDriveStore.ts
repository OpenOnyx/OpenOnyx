import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DriveAccount } from './googleDriveTypes.js';

export interface DriveCredential extends DriveAccount { refreshToken: string; clientId: string; brokerTicket?: string }
export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** OAuth credentials never cross IPC. Refuse Electron's insecure Linux fallback. */
export class GoogleDriveCredentialStore {
  private readonly file: string;
  constructor(directory: string, private readonly encryption: CredentialEncryption) {
    this.file = path.join(directory, 'google-drive-credentials.enc');
  }
  available(): boolean {
    return this.encryption.isEncryptionAvailable() && this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }
  async load(): Promise<DriveCredential[]> {
    if (!this.available()) return [];
    try {
      const values: unknown = JSON.parse(this.encryption.decryptString(await fs.readFile(this.file)));
      if (!Array.isArray(values)) throw new Error('Invalid credential store');
      if (!values.every(value => value && typeof value === 'object'
        && ['id', 'email', 'name', 'refreshToken', 'clientId'].every(key => typeof value[key] === 'string')
        && /^drive-[a-f0-9]{24}$/.test(value.id) && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.clientId)
        && (value.refreshToken.length > 0 || value.needsReconnect === true)
        && (value.brokerTicket === undefined || (typeof value.brokerTicket === 'string' && value.brokerTicket.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.brokerTicket)))
        && (value.needsReconnect === undefined || typeof value.needsReconnect === 'boolean'))) throw new Error('Invalid credential store');
      return values as DriveCredential[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Google Drive credentials could not be unlocked. Reconnect your account.');
    }
  }
  async save(values: DriveCredential[]): Promise<void> {
    if (!values.length) { await fs.rm(this.file, { force: true }); return; }
    if (!this.available()) throw new Error('Secure system credential storage is unavailable.');
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, this.encryption.encryptString(JSON.stringify(values)), { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
}
