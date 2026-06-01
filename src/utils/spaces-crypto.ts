/**
 * Spaces Cryptography & Zero-Knowledge E2EE Helper
 * 
 * Provides AES-256-GCM encryption/decryption, PBKDF2 key derivation,
 * and in-memory storage of decrypted space keys.
 */

// Helper to convert ArrayBuffer/Uint8Array to base64
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert base64 to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// In-memory store for unlocked space keys (never saved to disk)
const unlockedKeys = new Map<string, CryptoKey>();

export function isSpaceUnlocked(spaceId: string): boolean {
  return unlockedKeys.has(spaceId);
}

export function getSpaceKey(spaceId: string): CryptoKey | null {
  return unlockedKeys.get(spaceId) || null;
}

export function unlockSpace(spaceId: string, spaceKey: CryptoKey): void {
  unlockedKeys.set(spaceId, spaceKey);
  
  // Propagate to main process if electron is active
  if (window.electronAPI && (window.electronAPI as any).setCryptoKey) {
    // Export raw key bytes to base64 to send to Node.js main process
    window.crypto.subtle.exportKey("raw", spaceKey).then((rawKey) => {
      const base64Key = arrayBufferToBase64(rawKey);
      (window.electronAPI as any).setCryptoKey(spaceId, base64Key);
    }).catch(err => {
      console.error("[SpacesCrypto] Failed to sync key to main process:", err);
    });
  }
  
  resetInactivityTimeout();
}

export function lockSpace(spaceId: string): void {
  unlockedKeys.delete(spaceId);
  if (window.electronAPI && (window.electronAPI as any).setCryptoKey) {
    (window.electronAPI as any).setCryptoKey(spaceId, null);
  }
}

export function lockAllSpaces(): void {
  unlockedKeys.clear();
  if (window.electronAPI && (window.electronAPI as any).setCryptoKey) {
    // We don't have all IDs, but we can clear them in the main process
    (window.electronAPI as any).setCryptoKey("*", null);
  }
}

// ── Inactivity Auto-Lock ──
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutes

export function resetInactivityTimeout() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  
  if (unlockedKeys.size > 0) {
    inactivityTimer = setTimeout(() => {
      console.log("[SpacesCrypto] Locking all spaces due to inactivity.");
      lockAllSpaces();
      window.dispatchEvent(new CustomEvent("spaces-crypto:auto-locked"));
    }, INACTIVITY_LIMIT);
  }
}

// Setup activity listeners
if (typeof window !== "undefined") {
  const resetEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
  resetEvents.forEach((event) => {
    window.addEventListener(event, resetInactivityTimeout, { passive: true });
  });
  
  // Auto-lock on app visibility change or exit
  window.addEventListener("beforeunload", () => {
    lockAllSpaces();
  });
}

// ── Crypto Operations ──

/**
 * Derive a 256-bit AES key from a password and salt using PBKDF2
 */
export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Generate a random 256-bit space key
 */
export async function generateSpaceKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt note content using a Space Key
 */
export async function encryptText(text: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encoder.encode(text)
  );

  const encryptedArray = new Uint8Array(encryptedBuffer);
  // Web Crypto GCM appends the 16-byte auth tag to the end of the ciphertext
  const authTagBytes = encryptedArray.slice(-16);
  const ciphertextBytes = encryptedArray.slice(0, -16);

  return {
    ciphertext: arrayBufferToBase64(ciphertextBytes),
    iv: arrayBufferToBase64(iv),
    authTag: arrayBufferToBase64(authTagBytes),
  };
}

/**
 * Decrypt note content using a Space Key
 */
export async function decryptText(
  ciphertext: string,
  ivStr: string,
  authTagStr: string,
  key: CryptoKey
): Promise<string> {
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(ciphertext));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(authTagStr));
  const iv = new Uint8Array(base64ToArrayBuffer(ivStr));

  // Re-combine ciphertext and auth tag for Web Crypto API
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    combined
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Encrypt the raw space key with a password-derived master key
 */
export async function encryptSpaceKey(
  spaceKey: CryptoKey,
  masterKey: CryptoKey
): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const exported = await window.crypto.subtle.exportKey("raw", spaceKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    masterKey,
    exported
  );

  const encryptedArray = new Uint8Array(encryptedBuffer);
  const authTagBytes = encryptedArray.slice(-16);
  const ciphertextBytes = encryptedArray.slice(0, -16);

  return {
    ciphertext: arrayBufferToBase64(ciphertextBytes),
    iv: arrayBufferToBase64(iv),
    authTag: arrayBufferToBase64(authTagBytes),
  };
}

/**
 * Decrypt the space key using a master key
 */
export async function decryptSpaceKey(
  encrypted: { ciphertext: string; iv: string; authTag: string },
  masterKey: CryptoKey
): Promise<CryptoKey> {
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(encrypted.ciphertext));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(encrypted.authTag));
  const iv = new Uint8Array(base64ToArrayBuffer(encrypted.iv));

  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    masterKey,
    combined
  );

  return window.crypto.subtle.importKey(
    "raw",
    decryptedBuffer,
    { name: "AES-GCM", length: 256 },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}
