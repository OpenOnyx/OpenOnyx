import { supabase } from './supabase';
import { authManager } from './auth';
import { formatSupabaseError } from './supabaseError';
import { localDB } from './localdb';

export const PRIVATE_ENCRYPTION_VERSION = 1;
export const PRIVATE_KEY_VERSION = 1;

type JsonObject = Record<string, any>;

export interface WrappedSpaceKey {
  encrypted_space_key: string;
  key_salt?: string | null;
  key_iv: string;
  key_auth_tag: string;
  key_version: number;
  encryption_version: number;
  key_wrapping: 'password' | 'rsa-oaep';
  kdf?: 'argon2id' | 'pbkdf2' | null;
  kdf_params?: JsonObject | null;
}

export interface EncryptedBlob {
  encrypted_payload: string;
  iv: string;
  auth_tag: string;
  encryption_version: number;
}

export interface EncryptedNoteFields {
  content: string;
  content_encrypted: string;
  iv: string;
  auth_tag: string;
  encryption_version: number;
}

type SpaceStateListener = (spaceId: string, unlocked: boolean) => void;

const te = new TextEncoder();
const td = new TextDecoder();
const unlockedSpaceKeys = new Map<string, CryptoKey>();
const unlockedRawSpaceKeys = new Map<string, Uint8Array>();
const failSafeNotes = new Set<string>();
const listeners = new Set<SpaceStateListener>();

function getClient() {
  return supabase;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function joinCipherAndTag(ciphertext: string, tag: string): Uint8Array {
  const cipher = base64ToBytes(ciphertext);
  const authTag = base64ToBytes(tag);
  const combined = new Uint8Array(cipher.length + authTag.length);
  combined.set(cipher, 0);
  combined.set(authTag, cipher.length);
  return combined;
}

function splitCipherAndTag(encrypted: ArrayBuffer): { ciphertext: Uint8Array; tag: Uint8Array } {
  const bytes = new Uint8Array(encrypted);
  return {
    ciphertext: bytes.slice(0, Math.max(0, bytes.length - 16)),
    tag: bytes.slice(Math.max(0, bytes.length - 16)),
  };
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function exportRawAesKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

async function deriveMasterKey(password: string, salt: Uint8Array, params?: JsonObject | null): Promise<{ key: CryptoKey; kdf: 'argon2id' | 'pbkdf2'; params: JsonObject }> {
  const argon2 = typeof window !== 'undefined' ? (window as any).argon2 : undefined;
  if (argon2?.hash) {
    const argonParams = {
      type: argon2.ArgonType?.Argon2id ?? 2,
      mem: params?.mem ?? 65536,
      time: params?.time ?? 3,
      parallelism: params?.parallelism ?? 1,
      hashLen: 32,
      salt: toArrayBuffer(salt),
    };
    const result = await argon2.hash({ pass: password, ...argonParams });
    const hash = result.hash instanceof Uint8Array ? result.hash : base64ToBytes(result.hash);
    return {
      key: await importAesKey(hash.slice(0, 32)),
      kdf: 'argon2id',
      params: { mem: argonParams.mem, time: argonParams.time, parallelism: argonParams.parallelism },
    };
  }

  const iterations = params?.iterations ?? 310000;
  const imported = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    imported,
    256,
  );
  return {
    key: await importAesKey(new Uint8Array(bits)),
    kdf: 'pbkdf2',
    params: { iterations, hash: 'SHA-256' },
  };
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array, aad?: string): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: aad ? toArrayBuffer(te.encode(aad)) : undefined,
      tagLength: 128,
    },
    key,
    toArrayBuffer(bytes),
  );
  const { ciphertext, tag } = splitCipherAndTag(encrypted);
  return {
    encrypted_payload: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    auth_tag: bytesToBase64(tag),
    encryption_version: PRIVATE_ENCRYPTION_VERSION,
  };
}

async function decryptBytes(key: CryptoKey, blob: Pick<EncryptedBlob, 'encrypted_payload' | 'iv' | 'auth_tag'>, aad?: string): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(blob.iv)),
      additionalData: aad ? toArrayBuffer(te.encode(aad)) : undefined,
      tagLength: 128,
    },
    key,
    toArrayBuffer(joinCipherAndTag(blob.encrypted_payload, blob.auth_tag)),
  );
  return new Uint8Array(plaintext);
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
}

function localPrivateKeyName(userId: string) {
  return `oo_private_wrapping_key_${userId}`;
}

function localPublicKeyName(userId: string) {
  return `oo_public_wrapping_key_${userId}`;
}

export function isPrivateCloudSpace(space?: { visibility?: string | null; is_public?: boolean | null } | null): boolean {
  return !!space && space.visibility === 'private' && !space.is_public;
}

export const privateCrypto = {
  onSpaceStateChange(listener: SpaceStateListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isUnlocked(spaceId: string | null | undefined): boolean {
    return !!spaceId && unlockedSpaceKeys.has(spaceId);
  },

  async ensureSpaceUnlocked(spaceId: string | null | undefined): Promise<boolean> {
    if (!spaceId) return false;
    if (unlockedSpaceKeys.has(spaceId)) return true;

    try {
      const b64 = await localDB.getMeta(`unlocked_space_key_${spaceId}`);
      if (b64) {
        const raw = base64ToBytes(b64);
        unlockedRawSpaceKeys.set(spaceId, raw);
        unlockedSpaceKeys.set(spaceId, await importAesKey(raw));
        this.clearFailSafe(spaceId);
        listeners.forEach(fn => fn(spaceId, true));
        return true;
      }
    } catch (err) {
      console.warn('[PrivateCrypto] Auto-restore space key failed:', err);
    }
    return false;
  },

  isFailSafe(spaceId: string, path: string): boolean {
    return failSafeNotes.has(`${spaceId}:${path}`);
  },

  enterFailSafe(spaceId: string, path: string): void {
    failSafeNotes.add(`${spaceId}:${path}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('private-space:failsafe', {
        detail: { spaceId, path, message: 'Realtime paused to prevent data loss.' },
      }));
    }
  },

  clearFailSafe(spaceId: string, path?: string): void {
    if (path) {
      failSafeNotes.delete(`${spaceId}:${path}`);
      return;
    }
    for (const key of [...failSafeNotes]) {
      if (key.startsWith(`${spaceId}:`)) failSafeNotes.delete(key);
    }
  },

  async generateSpaceKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
    const raw = randomBytes(32);
    return { key: await importAesKey(raw), raw };
  },

  async wrapSpaceKeyWithPassword(rawSpaceKey: Uint8Array, password: string): Promise<WrappedSpaceKey> {
    if (!password || password.length < 8) {
      throw new Error('Encryption password must be at least 8 characters.');
    }
    const salt = randomBytes(16);
    const { key, kdf, params } = await deriveMasterKey(password, salt);
    const encrypted = await encryptBytes(key, rawSpaceKey, `space-key:v${PRIVATE_KEY_VERSION}`);
    return {
      encrypted_space_key: encrypted.encrypted_payload,
      key_salt: bytesToBase64(salt),
      key_iv: encrypted.iv,
      key_auth_tag: encrypted.auth_tag,
      key_version: PRIVATE_KEY_VERSION,
      encryption_version: PRIVATE_ENCRYPTION_VERSION,
      key_wrapping: 'password',
      kdf,
      kdf_params: params,
    };
  },

  async unwrapSpaceKeyWithPassword(wrapped: WrappedSpaceKey, password: string): Promise<Uint8Array> {
    if (!wrapped.key_salt) throw new Error('Missing encryption salt for this space.');
    const { key } = await deriveMasterKey(password, base64ToBytes(wrapped.key_salt), wrapped.kdf_params);
    return decryptBytes(key, {
      encrypted_payload: wrapped.encrypted_space_key,
      iv: wrapped.key_iv,
      auth_tag: wrapped.key_auth_tag,
    }, `space-key:v${wrapped.key_version || PRIVATE_KEY_VERSION}`);
  },

  async unlockWithPassword(spaceId: string, wrapped: WrappedSpaceKey, password: string): Promise<void> {
    const raw = await this.unwrapSpaceKeyWithPassword(wrapped, password);
    unlockedRawSpaceKeys.set(spaceId, raw);
    unlockedSpaceKeys.set(spaceId, await importAesKey(raw));
    this.clearFailSafe(spaceId);
    listeners.forEach(fn => fn(spaceId, true));
    try {
      await localDB.setMeta(`unlocked_space_key_${spaceId}`, bytesToBase64(raw));
    } catch { /* best-effort */ }
  },

  async unlockWithRawKey(spaceId: string, raw: Uint8Array): Promise<void> {
    unlockedRawSpaceKeys.set(spaceId, raw);
    unlockedSpaceKeys.set(spaceId, await importAesKey(raw));
    this.clearFailSafe(spaceId);
    listeners.forEach(fn => fn(spaceId, true));
    try {
      await localDB.setMeta(`unlocked_space_key_${spaceId}`, bytesToBase64(raw));
    } catch { /* best-effort */ }
  },

  lock(spaceId: string): void {
    unlockedSpaceKeys.delete(spaceId);
    unlockedRawSpaceKeys.delete(spaceId);
    this.clearFailSafe(spaceId);
    listeners.forEach(fn => fn(spaceId, false));
    try {
      void localDB.setMeta(`unlocked_space_key_${spaceId}`, null);
    } catch { /* best-effort */ }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('private-space:locked', { detail: { spaceId } }));
    }
  },

  getRawSpaceKey(spaceId: string): Uint8Array | null {
    return unlockedRawSpaceKeys.get(spaceId) || null;
  },

  async encryptText(spaceId: string, plaintext: string, aad?: string): Promise<EncryptedBlob> {
    if (!unlockedSpaceKeys.has(spaceId)) {
      await this.ensureSpaceUnlocked(spaceId);
    }
    const key = unlockedSpaceKeys.get(spaceId);
    if (!key) throw new Error('Unlock this private space before syncing encrypted content.');
    return encryptBytes(key, te.encode(plaintext), aad);
  },

  async decryptText(spaceId: string, blob: Pick<EncryptedBlob, 'encrypted_payload' | 'iv' | 'auth_tag'>, aad?: string): Promise<string> {
    if (!unlockedSpaceKeys.has(spaceId)) {
      await this.ensureSpaceUnlocked(spaceId);
    }
    const key = unlockedSpaceKeys.get(spaceId);
    if (!key) throw new Error('Unlock this private space before loading encrypted content.');
    return td.decode(await decryptBytes(key, blob, aad));
  },

  async encryptNoteContent(spaceId: string, note: { id?: string; path?: string; version?: number; content?: string }): Promise<EncryptedNoteFields> {
    const encrypted = await this.encryptText(spaceId, note.content || '', `note:${spaceId}:${note.id || ''}:${note.path || ''}:${note.version ?? 0}`);
    return {
      content: '',
      content_encrypted: encrypted.encrypted_payload,
      iv: encrypted.iv,
      auth_tag: encrypted.auth_tag,
      encryption_version: encrypted.encryption_version,
    };
  },

  async decryptNoteContent(spaceId: string, note: any): Promise<string> {
    if (!note.content_encrypted) {
      if (note.content) return note.content;
      return '';
    }
    if (!unlockedSpaceKeys.has(spaceId)) {
      await this.ensureSpaceUnlocked(spaceId);
    }

    const payload = {
      encrypted_payload: note.content_encrypted,
      iv: note.iv,
      auth_tag: note.auth_tag,
    };

    // 1. Path Variations
    const pathVariations: string[] = [];
    const rawPath = note.path || '';
    pathVariations.push(rawPath);

    // Normalize relative path
    let rel = rawPath.replace(/\\/g, '/');
    const vaultPath = typeof window !== 'undefined' ? (window as any).__oo_vault_path : null;
    if (vaultPath) {
      const normalizedVault = vaultPath.replace(/\\/g, '/');
      if (rel.startsWith(normalizedVault)) {
        rel = rel.slice(normalizedVault.length);
      }
    }
    if (rel.startsWith('/')) {
      rel = rel.slice(1);
    }
    if (rel && rel !== rawPath) {
      pathVariations.push(rel);
    }

    // Stripping leading slash variation
    if (rawPath.startsWith('/')) {
      pathVariations.push(rawPath.slice(1));
    } else {
      pathVariations.push('/' + rawPath);
    }

    const uniquePaths = Array.from(new Set(pathVariations));

    // 2. Version Variations
    const versionVariations: number[] = [note.version ?? 0, 0];
    const uniqueVersions = Array.from(new Set(versionVariations));

    // Try each combination of path and version
    let lastError: any = null;
    for (const p of uniquePaths) {
      for (const v of uniqueVersions) {
        try {
          const aad = `note:${spaceId}:${note.id || ''}:${p}:${v}`;
          return await this.decryptText(spaceId, payload, aad);
        } catch (err) {
          lastError = err;
        }
      }
    }

    throw lastError || new Error('Decryption failed for all path/version AAD variations.');
  },

  /**
   * Encrypt raw bytes (e.g., Yjs binary CRDT updates) using the space's AES-256-GCM key.
   * Returns base64-encoded ciphertext, IV, and auth tag.
   */
  async encryptRawBytes(spaceId: string, data: Uint8Array, aad?: string): Promise<EncryptedBlob> {
    if (!unlockedSpaceKeys.has(spaceId)) {
      await this.ensureSpaceUnlocked(spaceId);
    }
    const key = unlockedSpaceKeys.get(spaceId);
    if (!key) throw new Error('Unlock this private space before encrypting binary data.');
    return encryptBytes(key, data, aad);
  },

  /**
   * Decrypt raw bytes (e.g., Yjs binary CRDT updates) using the space's AES-256-GCM key.
   * Accepts base64-encoded ciphertext, IV, and auth tag. Returns raw Uint8Array.
   */
  async decryptRawBytes(spaceId: string, blob: Pick<EncryptedBlob, 'encrypted_payload' | 'iv' | 'auth_tag'>, aad?: string): Promise<Uint8Array> {
    if (!unlockedSpaceKeys.has(spaceId)) {
      await this.ensureSpaceUnlocked(spaceId);
    }
    const key = unlockedSpaceKeys.get(spaceId);
    if (!key) throw new Error('Unlock this private space before decrypting binary data.');
    return decryptBytes(key, blob, aad);
  },

  async encryptJson(spaceId: string, payload: JsonObject, aad?: string): Promise<EncryptedBlob> {
    return this.encryptText(spaceId, JSON.stringify(payload), aad);
  },

  async decryptJson<T = JsonObject>(spaceId: string, blob: Pick<EncryptedBlob, 'encrypted_payload' | 'iv' | 'auth_tag'>, aad?: string): Promise<T> {
    return JSON.parse(await this.decryptText(spaceId, blob, aad)) as T;
  },

  async ensureUserKeyring(): Promise<JsonWebKey | null> {
    const user = authManager.getUser();
    if (!user) return null;
    if (typeof localStorage === 'undefined') return null;

    const client = getClient();

    // Verify we have an active auth session before making RLS-protected requests
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      console.error('[PrivateCrypto] ensureUserKeyring: No active auth session! auth.uid() will be null, RLS will reject.');
      throw new Error('You must be logged in to set up encryption keys. Please sign in and try again.');
    }

    const cachedPublic = localStorage.getItem(localPublicKeyName(user.id));
    const cachedPrivate = localStorage.getItem(localPrivateKeyName(user.id));
    if (cachedPublic && cachedPrivate) {
      const publicKey = JSON.parse(cachedPublic) as JsonWebKey;
      const { error } = await client.from('user_keyrings' as any).upsert({
        user_id: user.id,
        public_key_jwk: publicKey,
        algorithm: 'RSA-OAEP-256',
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id' });
      if (error) throw new Error(`Failed to save encryption keyring: ${formatSupabaseError(error)}`);
      return publicKey;
    }

    const pair = await crypto.subtle.generateKey(
      ({
        name: 'RSA-OAEP',
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      } as RsaHashedKeyGenParams),
      true,
      ['encrypt', 'decrypt'],
    );
    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
    localStorage.setItem(localPublicKeyName(user.id), JSON.stringify(publicKey));
    localStorage.setItem(localPrivateKeyName(user.id), JSON.stringify(privateKey));
    const { error } = await client.from('user_keyrings' as any).upsert({
      user_id: user.id,
      public_key_jwk: publicKey,
      algorithm: 'RSA-OAEP-256',
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'user_id' });
    if (error) throw new Error(`Failed to save encryption keyring: ${formatSupabaseError(error)}`);
    return publicKey;
  },

  async wrapSpaceKeyForUser(rawSpaceKey: Uint8Array, userId: string): Promise<WrappedSpaceKey> {
    const client = getClient();
    const { data, error } = await client
      .from('user_keyrings' as any)
      .select('public_key_jwk')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    const keyRow = data as any;
    if (!keyRow?.public_key_jwk) {
      throw new Error('Invited user has not initialized encryption keys yet. They must sign in once before they can decrypt this private space.');
    }
    const publicKey = await importPublicKey(keyRow.public_key_jwk as JsonWebKey);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, toArrayBuffer(rawSpaceKey)));
    return {
      encrypted_space_key: bytesToBase64(encrypted),
      key_iv: '',
      key_auth_tag: '',
      key_version: PRIVATE_KEY_VERSION,
      encryption_version: PRIVATE_ENCRYPTION_VERSION,
      key_wrapping: 'rsa-oaep',
      kdf: null,
      kdf_params: null,
    };
  },

  async unwrapSpaceKeyForCurrentUser(wrapped: WrappedSpaceKey): Promise<Uint8Array> {
    const user = authManager.requireAuth();
    if (typeof localStorage === 'undefined') {
      throw new Error('Local key storage is unavailable.');
    }
    const privateJwk = localStorage.getItem(localPrivateKeyName(user.id));
    if (!privateJwk) {
      await this.ensureUserKeyring();
    }
    const finalPrivateJwk = localStorage.getItem(localPrivateKeyName(user.id));
    if (!finalPrivateJwk) throw new Error('No local private key is available for this account.');
    const privateKey = await importPrivateKey(JSON.parse(finalPrivateJwk));
    const raw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      toArrayBuffer(base64ToBytes(wrapped.encrypted_space_key)),
    );
    return new Uint8Array(raw);
  },

  async changePassword(spaceId: string, oldWrapped: WrappedSpaceKey, oldPassword: string, newPassword: string): Promise<WrappedSpaceKey> {
    const raw = await this.unwrapSpaceKeyWithPassword(oldWrapped, oldPassword);
    const next = await this.wrapSpaceKeyWithPassword(raw, newPassword);
    await this.unlockWithRawKey(spaceId, raw);
    return next;
  },
};

// Automatically ensure user keyring is initialized on login or app load
if (typeof window !== 'undefined') {
  authManager.subscribe((state) => {
    if (state.user) {
      privateCrypto.ensureUserKeyring().catch(err => {
        console.warn('[privateCrypto] Auto-keyring initialization failed:', err);
      });
    }
  });
}
