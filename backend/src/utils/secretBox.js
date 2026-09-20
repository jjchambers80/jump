// Symmetric encryption for small secrets at rest (spec 030 C: TOTP seeds).
// AES-256-GCM with a key derived from AUTH_SECRET via HKDF, so no extra env
// var is needed. Rotating AUTH_SECRET makes existing boxes unreadable —
// noted in the production launch checklist.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function key(purpose, secret = process.env.AUTH_SECRET) {
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return Buffer.from(hkdfSync('sha256', secret, 'jump-secret-box', purpose, 32));
}

/** @returns {string} "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>" */
export function seal(plaintext, purpose, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(purpose, secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Throws on tampering or a wrong key. */
export function open(box, purpose, secret) {
  const [version, iv, tag, ciphertext] = String(box).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Malformed secret box');
  const decipher = createDecipheriv('aes-256-gcm', key(purpose, secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
