import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';

const ALG = 'aes-256-gcm';

/** Derive a 256-bit key from a passphrase deterministically. */
export function deriveKey(passphrase: string, salt: Buffer, _iterations = 16384): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Password verification hash (never used as the encryption key-stream; compare via digest). */
export function verifyHash(passphrase: string, salt: Buffer): Buffer {
  return createHash('sha256').update(deriveKey(passphrase, salt)).digest();
}

export function encryptText(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

export function decryptText(key: Buffer, envelope: string): string | null {
  try {
    const parsed = JSON.parse(envelope) as { v: number; iv: string; tag: string; data: string };
    if (parsed.v !== 1) return null;
    const decipher = createDecipheriv(ALG, key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function isEnvelope(value: string): boolean {
  return /^\{"v":1,/.test(value);
}
