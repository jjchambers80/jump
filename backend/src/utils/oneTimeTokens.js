// One-time tokens over the Auth.js VerificationToken table (spec 030 B).
// The raw token goes to the user (link, code); only sha256(raw) is stored.
// `identifier` is "<purpose>:<subject>", so a purpose can be listed or
// cleared per user. Codes and tokens are single use.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '@jump/db';

export function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

export function identifierFor(purpose, subject) {
  return `${purpose}:${subject}`;
}

/** Replace any token for this purpose+subject with a fresh one. Returns the raw token. */
export async function issueToken(purpose, subject, ttlMs, { kind = 'token' } = {}) {
  const raw = kind === 'code' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : randomBytes(32).toString('base64url');
  const identifier = identifierFor(purpose, subject);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: hashToken(raw), expires: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return raw;
}

/**
 * Consume a token whose subject is unknown (links): find by hash under the
 * purpose prefix. Returns { subject } or null; the row is always removed.
 */
export async function consumeToken(purpose, raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const prefix = `${purpose}:`;
  const row = await prisma.verificationToken.findFirst({
    where: { token: hashToken(raw), identifier: { startsWith: prefix } },
  });
  if (!row) return null;
  await prisma.verificationToken.deleteMany({ where: { identifier: row.identifier } });
  if (row.expires < new Date()) return { subject: row.identifier.slice(prefix.length), expired: true };
  return { subject: row.identifier.slice(prefix.length), expired: false };
}

/**
 * Check a code against a known subject (step-up email codes). Constant-time
 * compare; a wrong code does NOT consume the row (the caller rate-limits),
 * a right one does.
 */
export async function consumeCode(purpose, subject, raw) {
  if (typeof raw !== 'string' || !raw) return false;
  const identifier = identifierFor(purpose, subject);
  const row = await prisma.verificationToken.findFirst({ where: { identifier } });
  if (!row) return false;
  const a = Buffer.from(row.token, 'utf8');
  const b = Buffer.from(hashToken(raw), 'utf8');
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) return false;
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  return row.expires >= new Date();
}

export async function clearTokens(purpose, subject) {
  await prisma.verificationToken.deleteMany({ where: { identifier: identifierFor(purpose, subject) } });
}
