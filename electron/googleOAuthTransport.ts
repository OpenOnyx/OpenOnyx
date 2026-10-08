/** Hybrid encryption keeps OAuth payloads opaque to gateway invocation-body logs.
 * HTTPS and trust in the function/its secret administrators are still required.
 */
const encoder = new TextEncoder();
const REQUEST_AAD = encoder.encode('OpenOnyx Google Drive broker v1 request');
const RESPONSE_AAD = encoder.encode('OpenOnyx Google Drive broker v1 response');
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
export interface BrokerPublicKey { kty: 'RSA'; n: string; e: string }
export interface BrokerEnvelope { version: 1; key?: string; iv: string; ciphertext: string }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (text: unknown, maximum: number): Uint8Array<ArrayBuffer> => {
  if (typeof text !== 'string' || text.length > maximum * 2 || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encrypted payload');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  if (binary.length > maximum) throw new Error('Invalid encrypted payload');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (encode(bytes) !== text) throw new Error('Invalid encrypted payload');
  return bytes;
};
export function validBrokerPublicKey(value: unknown): value is BrokerPublicKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  try { return key.kty === 'RSA' && typeof key.e === 'string' && decode(key.e, 8).length > 0 && decode(key.n, 512).length >= 384
    && Object.keys(key).every(field => ['kty', 'n', 'e'].includes(field)); } catch { return false; }
}
async function seal(key: Key, plaintext: string, aad: Uint8Array<ArrayBuffer>): Promise<BrokerEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, encoder.encode(plaintext)));
  return { version: 1, iv: encode(iv), ciphertext: encode(ciphertext) };
}
async function open(key: Key, value: unknown, aad: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!value || typeof value !== 'object') throw new Error('Invalid encrypted payload');
  const envelope = value as BrokerEnvelope;
  if (envelope.version !== 1) throw new Error('Invalid encrypted payload');
  const iv = decode(envelope.iv, 12); if (iv.length !== 12) throw new Error('Invalid encrypted payload');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, decode(envelope.ciphertext, 65536));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function encryptBrokerRequest(publicKey: BrokerPublicKey, plaintext: string): Promise<{ envelope: BrokerEnvelope; decryptResponse: (value: unknown) => Promise<string> }> {
  if (!validBrokerPublicKey(publicKey) || encoder.encode(plaintext).length > 32768) throw new Error('Invalid encrypted payload');
  const rsa = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aesBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', aesBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP', rsa, aesBytes));
  const envelope = { ...await seal(key, JSON.stringify({ issuedAt: Date.now(), payload: plaintext }), REQUEST_AAD), key: encode(encrypted) };
  return { envelope, decryptResponse: value => open(key, value, RESPONSE_AAD) };
}
export async function decryptBrokerRequest(privateKey: Key, value: unknown): Promise<{ plaintext: string; encryptResponse: (text: string) => Promise<BrokerEnvelope> }> {
  if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['version', 'key', 'iv', 'ciphertext'].includes(k))) throw new Error('Invalid encrypted payload');
  const envelope = value as BrokerEnvelope;
  const bytes = await crypto.subtle.decrypt('RSA-OAEP', privateKey, decode(envelope.key, 512));
  if (bytes.byteLength !== 32) throw new Error('Invalid encrypted payload');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const decoded = JSON.parse(await open(key, envelope, REQUEST_AAD));
  if (!decoded || typeof decoded.payload !== 'string' || !Number.isFinite(decoded.issuedAt) || Math.abs(Date.now() - decoded.issuedAt) > 120000) throw new Error('Expired encrypted payload');
  const plaintext = decoded.payload;
  if (encoder.encode(plaintext).length > 32768) throw new Error('Invalid encrypted payload');
  return { plaintext, encryptResponse: text => seal(key, text, RESPONSE_AAD) };
}
