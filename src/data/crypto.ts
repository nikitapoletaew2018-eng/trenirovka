// Шифрование данных цикла PIN-кодом (ТЗ, 6.4 — опционально). WebCrypto, без сторонних библиотек.
// Ключ: PBKDF2-SHA-256 из PIN и случайной соли; шифр: AES-GCM 256 со случайным IV на каждую запись.
// Число итераций — по рекомендации OWASP Password Storage Cheat Sheet для PBKDF2-HMAC-SHA256 (600 000).
// Важно: короткий цифровой PIN защищает от случайного взгляда, но не от перебора, если кто-то получит копию базы.

export const PBKDF2_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

export async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Бросает ошибку при неверном ключе (AES-GCM проверяет целостность). */
export async function decryptJson(key: CryptoKey, iv: string, ct: string): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return JSON.parse(dec.decode(plain)) as unknown;
}
