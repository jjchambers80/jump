import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';

const SECRET = 'test-secret-key-must-be-at-least-32-chars';
process.env.AUTH_SECRET = SECRET;

const rows = new Map<string, { token: string; expires: Date }>();
vi.mock('@jump/db', () => ({
  prisma: {
    verificationToken: {
      deleteMany: vi.fn(async ({ where }: { where: { identifier: string; token?: string } }) => {
        const row = rows.get(where.identifier);
        if (!row || (where.token && row.token !== where.token)) return { count: 0 };
        rows.delete(where.identifier);
        return { count: 1 };
      }),
      findFirst: vi.fn(async () => null),
    },
    user: { findUnique: vi.fn(async () => null) },
    securityEvent: { create: vi.fn() },
  },
}));

const { consumeMfaProof, resolveMfaState } = await import('@/lib/staffAuth');

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const proofFor = (sub: string, jti: string, extra: Record<string, unknown> = {}) =>
  jwt.sign({ typ: 'mfa', sub, jti, ...extra }, SECRET, { algorithm: 'HS256', expiresIn: 120 });
const record = (jti: string) => rows.set(`mfa-proof:${jti}`, { token: sha(jti), expires: new Date(Date.now() + 60000) });

describe('consumeMfaProof (spec 030 C)', () => {
  beforeEach(() => rows.clear());

  it('accepts a recorded proof once', async () => {
    record('j1');
    expect(await consumeMfaProof(proofFor('u1', 'j1'), 'u1')).toBe(true);
    expect(await consumeMfaProof(proofFor('u1', 'j1'), 'u1')).toBe(false);
  });

  it('rejects another user, a wrong typ, an unrecorded jti and junk', async () => {
    record('j2');
    expect(await consumeMfaProof(proofFor('u1', 'j2'), 'u2')).toBe(false);
    record('j3');
    expect(await consumeMfaProof(jwt.sign({ typ: 'reauth', sub: 'u1', jti: 'j3' }, SECRET), 'u1')).toBe(false);
    expect(await consumeMfaProof(proofFor('u1', 'never-recorded'), 'u1')).toBe(false);
    expect(await consumeMfaProof('garbage', 'u1')).toBe(false);
    expect(await consumeMfaProof(undefined, 'u1')).toBe(false);
  });
});

describe('resolveMfaState', () => {
  beforeEach(() => rows.clear());
  const base = { userId: 'u1', twoStepEnabled: true, signIn: false, mfaSatisfied: false, proof: undefined };

  it('is undefined when two-step is off', async () => {
    expect(await resolveMfaState('pending', { ...base, twoStepEnabled: false })).toBeUndefined();
  });

  it('a fresh sign-in is pending unless the sign-in was two factors already', async () => {
    expect(await resolveMfaState(undefined, { ...base, signIn: true })).toBe('pending');
    expect(await resolveMfaState(undefined, { ...base, signIn: true, mfaSatisfied: true })).toBe('ok');
  });

  it('a valid proof flips to ok; an invalid one leaves the token pending', async () => {
    record('j9');
    expect(await resolveMfaState('pending', { ...base, proof: proofFor('u1', 'j9') })).toBe('ok');
    expect(await resolveMfaState('pending', { ...base, proof: proofFor('u1', 'j9') })).toBe('pending');
  });

  it('keeps ok on refresh and makes a stateless token pending', async () => {
    expect(await resolveMfaState('ok', base)).toBe('ok');
    expect(await resolveMfaState(undefined, base)).toBe('pending');
  });
});
