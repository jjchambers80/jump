// Server-only helpers behind the spec 030 B Credentials providers.

import { createHash, createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

function clientIpFrom(request: Request | undefined): string | null {
  if (!request) return null;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim() || null;
  return request.headers.get('x-real-ip');
}

/**
 * Ask the backend to check an email + password. The browser's address is
 * forwarded signed so the backend can rate-limit per client, and the
 * shared secret proves the call comes from the frontend.
 */
export async function verifyPasswordWithBackend(
  email: string,
  password: string,
  request?: Request
): Promise<{ id: string; email: string; name: string | null } | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Jump-Internal': secret };
  const ip = clientIpFrom(request);
  if (ip) {
    headers['X-Jump-Client-Ip'] = ip;
    headers['X-Jump-Client-Ip-Sig'] = createHmac('sha256', secret).update(ip).digest('hex');
  }
  const ua = request?.headers.get('user-agent');
  if (ua) headers['User-Agent'] = ua;
  try {
    const res = await fetch(`${API_URL}/auth/password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id: string; email: string; name: string | null };
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

/**
 * Consume a one-time bridge token (VerificationToken identifier
 * "bridge:<userId>", token = sha256(raw)) — same table and hash the backend
 * writes. Single use; expired rows are deleted and refused.
 */
export async function consumeBridgeToken(
  raw: string
): Promise<{ id: string; email: string; name: string | null; mfaSatisfied: boolean } | null> {
  const hash = createHash('sha256').update(raw).digest('hex');
  const row = await prisma.verificationToken.findFirst({ where: { token: hash, identifier: { startsWith: 'bridge:' } } });
  if (!row) return null;
  await prisma.verificationToken.deleteMany({ where: { identifier: row.identifier } });
  if (row.expires < new Date()) return null;
  // "bridge:<userId>" or "bridge:<userId>:uv" (user-verified passkey = two factors, spec 030 C)
  const subject = row.identifier.slice('bridge:'.length);
  const mfaSatisfied = subject.endsWith(':uv');
  const userId = mfaSatisfied ? subject.slice(0, -':uv'.length) : subject;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, deletedAt: true, isActive: true } });
  if (!user || user.deletedAt || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, mfaSatisfied };
}

/**
 * Redeem a two-step completion proof (spec 030 C): HS256 `typ: 'mfa'` for
 * this user with a single-use jti the backend recorded as
 * "mfa-proof:<jti>". Returns true once; the row is deleted either way.
 */
export async function consumeMfaProof(proof: unknown, userId: string): Promise<boolean> {
  if (typeof proof !== 'string' || !proof || !process.env.AUTH_SECRET) return false;
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(proof, process.env.AUTH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    return false;
  }
  if (decoded.typ !== 'mfa' || decoded.sub !== userId || typeof decoded.jti !== 'string') return false;
  const identifier = `mfa-proof:${decoded.jti}`;
  const deleted = await prisma.verificationToken.deleteMany({
    where: { identifier, token: createHash('sha256').update(decoded.jti).digest('hex') },
  });
  return deleted.count === 1;
}

export async function recordSecurityEvent(userId: string, type: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    await prisma.securityEvent.create({ data: { userId, type, meta: meta ? JSON.parse(JSON.stringify(meta)) : undefined } });
  } catch {
    // The audit row must never break sign-in
  }
}

/**
 * Two-step state for the token (spec 030 C).
 *
 * - Fresh sign-in on a 2FA account: 'pending' — unless the sign-in itself was
 *   two factors (user-verified passkey via the token-bridge provider).
 * - update({ mfaProof }): a valid single-use proof flips 'pending' → 'ok'.
 * - Refresh: a token with no state on a 2FA account (signed in before 2FA
 *   was turned on) becomes 'pending'; the enabling browser redeems the proof
 *   the enable endpoint returned, other devices were signed out.
 * - 2FA off: no state.
 */
export async function resolveMfaState(
  current: unknown,
  { userId, twoStepEnabled, signIn, mfaSatisfied, proof }: { userId: string; twoStepEnabled: boolean; signIn: boolean; mfaSatisfied: boolean; proof: unknown }
): Promise<'pending' | 'ok' | undefined> {
  if (!twoStepEnabled) return undefined;
  if (proof !== undefined && (await consumeMfaProof(proof, userId))) return 'ok';
  if (signIn) return mfaSatisfied ? 'ok' : 'pending';
  return current === 'ok' ? 'ok' : 'pending';
}
