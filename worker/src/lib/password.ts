/**
 * WebCrypto PBKDF2-SHA256 password hashing tailored for Cloudflare Workers.
 * Uses native `crypto.subtle` (no CPU-heavy JS scrypt bottlenecks) with per-user
 * random 16-byte salts and constant-time digest comparison.
 */

const PBKDF2_PREFIX = 'pbkdf2_sha256';
const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(derived);
}

export async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  return `${PBKDF2_PREFIX}$${DEFAULT_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPasswordPbkdf2(data: { hash: string; password: string }): Promise<boolean> {
  const parts = data.hash.split('$');
  if (parts.length !== 4 || parts[0] !== PBKDF2_PREFIX) {
    return false;
  }
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 500_000) {
    return false;
  }
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  if (!salt || !expected) return false;

  const actual = await deriveKey(data.password, salt, iterations);
  return constantTimeEqual(actual, expected);
}
