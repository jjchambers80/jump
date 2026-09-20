// Spec 030 B: password hashing/policy, step-up proofs, one-time tokens.

import { jest } from '@jest/globals';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';
import { isBreachedPassword, passwordRuleError } from '../../src/utils/passwordPolicy.js';
import { issueReauthProof, requireRecentAuth, verifyReauthProof } from '../../src/middleware/recentAuth.js';

const SECRET = 'test-secret-key-must-be-at-least-32-chars';

describe('scrypt password hashing', () => {
  it('verifies the right password and rejects others, tampering and junk', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything', stored.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(false);
  });

  it('salts: two hashes of the same password differ', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });
});

describe('password rules', () => {
  it('enforces length and forbids the email', () => {
    expect(passwordRuleError('short')).toMatch(/at least 12/);
    expect(passwordRuleError('x'.repeat(129))).toMatch(/128/);
    expect(passwordRuleError('Ada@Example.com', { email: 'ada@example.com' })).toMatch(/email/);
    expect(passwordRuleError('adalovelace1', { email: 'adalovelace1@example.com' })).toMatch(/email/);
    expect(passwordRuleError('a perfectly fine phrase', { email: 'ada@example.com' })).toBeNull();
    expect(passwordRuleError(42)).toMatch(/required/);
  });

  it('HIBP: matches a suffix from the range response, fails open on errors, honours HIBP_CHECK=false', async () => {
    // sha1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const hit = async () => ({ ok: true, text: async () => 'ABCDEF:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\n' });
    expect(await isBreachedPassword('password', { fetchImpl: hit })).toBe(true);
    const miss = async () => ({ ok: true, text: async () => 'ABCDEF:1\n' });
    expect(await isBreachedPassword('password', { fetchImpl: miss })).toBe(false);
    const boom = async () => { throw new Error('offline'); };
    expect(await isBreachedPassword('password', { fetchImpl: boom })).toBe(false);
    process.env.HIBP_CHECK = 'false';
    expect(await isBreachedPassword('password', { fetchImpl: hit })).toBe(false);
    delete process.env.HIBP_CHECK;
  });
});

describe('recent-auth proof', () => {
  it('round-trips for the same user and rejects other users, wrong typ and expiry', () => {
    const { reauthToken } = issueReauthProof('u1', { secret: SECRET });
    expect(verifyReauthProof(reauthToken, 'u1', { secret: SECRET })).toBe(true);
    expect(verifyReauthProof(reauthToken, 'u2', { secret: SECRET })).toBe(false);
    expect(verifyReauthProof(reauthToken, 'u1', { secret: 'other' })).toBe(false);
    const expired = issueReauthProof('u1', { secret: SECRET, ttlSeconds: -1 }).reauthToken;
    expect(verifyReauthProof(expired, 'u1', { secret: SECRET })).toBe(false);
    expect(verifyReauthProof(undefined, 'u1', { secret: SECRET })).toBe(false);
  });

  it('middleware passes with a proof and 401s with code REAUTH_REQUIRED without', () => {
    const { reauthToken } = issueReauthProof('u1');
    const next = jest.fn();
    requireRecentAuth({ user: { id: 'u1' }, get: () => reauthToken }, {}, next);
    expect(next).toHaveBeenCalledWith();
    const deny = jest.fn();
    requireRecentAuth({ user: { id: 'u1' }, get: () => undefined }, {}, deny);
    expect(deny.mock.calls[0][0].code).toBe('REAUTH_REQUIRED');
    expect(deny.mock.calls[0][0].statusCode).toBe(401);
  });
});
