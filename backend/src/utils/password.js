// Password hashing with Node's scrypt (spec 030 B): no native dependency, so
// it builds the same under Railpack as locally. Stored as
// "scrypt$N$r$p$<salt b64>$<hash b64>"; parameters travel with the hash so
// they can be raised later without rehashing everyone at once.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const hash = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${Buffer.from(hash).toString('base64')}`;
}

/** Constant-time compare. A malformed or missing stored hash is simply false. */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  try {
    const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
    return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), expected);
  } catch {
    return false;
  }
}
