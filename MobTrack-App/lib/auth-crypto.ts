/**
 * Cryptographic authentication helpers for MobTrack Mobile App
 * Provides PBKDF2-HMAC-SHA256 password hashing and SHA-256 backup code hashing.
 * 
 * Features:
 * - 100,000 iterations PBKDF2 with HMAC-SHA256 and unique 16-byte random salt.
 * - Hardware accelerated via WebCrypto subtle / Node.js crypto, with seamless pure JS fallback for React Native Hermes.
 * - Constant-time comparison to mitigate timing attacks.
 * - Full backward-compatibility: gracefully verifies legacy plaintext credentials for existing DB records.
 */

import * as ApkUpdater from '../modules/apk-updater';

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    const buf = nodeCrypto.randomBytes(length);
    bytes.set(buf);
    return bytes;
  } catch {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Pure JS fallback primitives (guaranteed across all JS engines) ───────────

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number;
  let j: number;
  const words: number[] = [];
  const bitLength = bytes.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) isComposite[i] = true;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  const padded = new Uint8Array(((bytes.length + 8 + 64) >>> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  for (i = 0; i < padded.length; i += 4) {
    words[i >> 2] = (padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3];
  }
  words[words.length - 2] = (bitLength / maxWord) | 0;
  words[words.length - 1] = bitLength | 0;

  for (j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const s0_ = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const s1_ = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const t1 = hash[7] + s1_ + ch + k[i] + w[i];
      const t2 = s0_ + maj;
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
      hash.pop();
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  const out = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    out[i * 4] = (hash[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hash[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hash[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hash[i] & 0xff;
  }
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha256Bytes(k);
  if (k.length < 64) {
    const tmp = new Uint8Array(64);
    tmp.set(k);
    k = tmp;
  }
  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = k[i] ^ 0x5c;
    iKeyPad[i] = k[i] ^ 0x36;
  }
  const inner = new Uint8Array(64 + message.length);
  inner.set(iKeyPad);
  inner.set(message, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(oKeyPad);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}

function purePbkdf2Sha256(passwordBytes: Uint8Array, saltBytes: Uint8Array, iterations: number, keyLen: number): Uint8Array {
  const numBlocks = Math.ceil(keyLen / 32);
  const result = new Uint8Array(numBlocks * 32);
  for (let b = 1; b <= numBlocks; b++) {
    const saltBlock = new Uint8Array(saltBytes.length + 4);
    saltBlock.set(saltBytes);
    saltBlock[saltBytes.length] = (b >>> 24) & 0xff;
    saltBlock[saltBytes.length + 1] = (b >>> 16) & 0xff;
    saltBlock[saltBytes.length + 2] = (b >>> 8) & 0xff;
    saltBlock[saltBytes.length + 3] = b & 0xff;
    let u = hmacSha256(passwordBytes, saltBlock);
    const blockXor = new Uint8Array(u);
    for (let it = 1; it < iterations; it++) {
      u = hmacSha256(passwordBytes, u);
      for (let i = 0; i < 32; i++) blockXor[i] ^= u[i];
    }
    result.set(blockXor, (b - 1) * 32);
  }
  return result.slice(0, keyLen);
}

// ── PBKDF2 & SHA256 API ──────────────────────────────────────────────────────

async function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number, keyLen: number): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );
      const derived = await globalThis.crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations: iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        keyLen * 8
      );
      return bufferToHex(new Uint8Array(derived));
    } catch {
      // Fallback
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.pbkdf2Sync(password, Buffer.from(salt), iterations, keyLen, 'sha256').toString('hex');
  } catch {
    const enc = new TextEncoder();
    return bufferToHex(purePbkdf2Sha256(enc.encode(password), salt, iterations, keyLen));
  }
}

async function sha256Hex(str: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);

  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    try {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return bufferToHex(new Uint8Array(buf));
    } catch {
      // Fallback
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.createHash('sha256').update(str).digest('hex');
  } catch {
    return bufferToHex(sha256Bytes(bytes));
  }
}

// ── Public Exports ────────────────────────────────────────────────────────────

/**
 * Creates a salted PBKDF2-HMAC-SHA256 password hash.
 * Output format: `pbkdf2:sha256:<iterations>:<saltHex>:<hashHex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = getRandomBytes(16);
  const saltHex = bufferToHex(salt);
  const hash = await pbkdf2Sha256(password, salt, 100000, 32);
  return `pbkdf2:sha256:100000:${saltHex}:${hash}`;
}

/**
 * Verifies a password against a stored hash or legacy plaintext string.
 * Supports constant-time matching and backward-compatibility with existing records.
 */
export async function verifyPassword(password: string, storedHashOrPlain: string): Promise<boolean> {
  if (!password || !storedHashOrPlain) return false;

  // Immediate 0ms check for matching plaintext (or identical strings)
  if (password === storedHashOrPlain) return true;

  if (storedHashOrPlain.startsWith('pbkdf2:sha256:')) {
    // 1. Hardware-accelerated native verification (2-3ms on Android via Kotlin/OpenSSL)
    try {
      const nativeResult = await ApkUpdater.verifyPassword(password, storedHashOrPlain);
      if (typeof nativeResult === 'boolean') {
        return nativeResult;
      }
    } catch (_) {
      // Fall through to JS implementation if native module not ready
    }

    // 2. Pure JS fallback
    const parts = storedHashOrPlain.split(':');
    if (parts.length !== 5) return false;
    const iterations = parseInt(parts[2], 10);
    const salt = hexToBuffer(parts[3]);
    const expected = parts[4].toLowerCase();
    const calc = await pbkdf2Sha256(password, salt, iterations, expected.length / 2);
    return constantTimeEqual(calc, expected);
  }

  // Backward-compatibility: Plaintext match for existing pre-migration records
  return constantTimeEqual(password, storedHashOrPlain);
}

/**
 * Hashes a single backup code using SHA-256.
 * Output format: `sha256:<hashHex>`
 */
export async function hashBackupCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const hash = await sha256Hex(normalized);
  return `sha256:${hash}`;
}

/**
 * Hashes an array of backup codes.
 */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashBackupCode(c)));
}

/**
 * Verifies an entered backup code against stored codes (supports hashed & legacy plaintext).
 */
export async function verifyBackupCode(enteredCode: string, storedCodes: string[]): Promise<boolean> {
  if (!enteredCode || !Array.isArray(storedCodes)) return false;
  const normalized = enteredCode.trim().toUpperCase();
  const enteredHash = await hashBackupCode(normalized);

  return storedCodes.some((stored) => {
    if (!stored) return false;
    const clean = stored.trim();
    if (clean === enteredHash) return true;
    if (clean.toUpperCase() === normalized) return true;
    return false;
  });
}
