// Spec 030 C: secret box, recovery-code normalization, MFA proof, pending gate.

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { open, seal } from '../../src/utils/secretBox.js';
import { issueMfaProof } from '../../src/middleware/recentAuth.js';
import { requireAuth, requireAuthAllowPending } from '../../src/middleware/auth.js';
import { normalizeRecoveryCode } from '../../src/services/TwoStepService.js';

const SECRET = process.env.AUTH_SECRET;

describe('secret box', () => {
  it('round-trips and detects tampering or a different key', () => {
    const box = seal('JBSWY3DPEHPK3PXP', 'totp', 'k1');
    expect(box.startsWith('v1.')).toBe(true);
    expect(open(box, 'totp', 'k1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => open(box, 'other-purpose', 'k1')).toThrow();
    expect(() => open(box, 'totp', 'k2')).toThrow();
    const parts = box.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    expect(() => open(parts.join('.'), 'totp', 'k1')).toThrow();
    expect(() => open('garbage', 'totp', 'k1')).toThrow(/Malformed/);
  });

  it('never repeats ciphertext for the same secret', () => {
    expect(seal('x', 'totp', 'k')).not.toBe(seal('x', 'totp', 'k'));
  });
});

describe('recovery code normalization', () => {
  it('ignores case, dashes and spaces', () => {
    expect(normalizeRecoveryCode(' AbCdE-fGhJk ')).toBe('abcdefghjk');
    expect(normalizeRecoveryCode(null)).toBe('');
  });
});

describe('mfa proof', () => {
  it('is an HS256 token with typ mfa and a jti', () => {
    const decoded = jwt.verify(issueMfaProof('u1', 'jti-1'), SECRET);
    expect(decoded).toMatchObject({ typ: 'mfa', sub: 'u1', jti: 'jti-1' });
    expect(decoded.exp - decoded.iat).toBe(120);
  });
});

describe('pending two-step gate', () => {
  const token = (extra) => jwt.sign({ sub: 'u1', email: 'a@b.c', role: 'ADMIN', ...extra }, SECRET, { algorithm: 'HS256' });
  const run = async (middleware, bearer) => {
    const req = { headers: { authorization: `Bearer ${bearer}` }, get: () => undefined };
    const next = jest.fn();
    await middleware(req, {}, next);
    return { error: next.mock.calls[0]?.[0], req };
  };

  it('requireAuth refuses a pending token with TWO_STEP_REQUIRED', async () => {
    const { error } = await run(requireAuth, token({ mfa: 'pending' }));
    expect(error?.code).toBe('TWO_STEP_REQUIRED');
    expect(error?.statusCode).toBe(401);
  });

  it('requireAuth passes ok and legacy tokens', async () => {
    expect((await run(requireAuth, token({ mfa: 'ok' }))).error).toBeUndefined();
    expect((await run(requireAuth, token({}))).error).toBeUndefined();
  });

  it('requireAuthAllowPending lets the pending token through and flags it', async () => {
    const { error, req } = await run(requireAuthAllowPending, token({ mfa: 'pending' }));
    expect(error).toBeUndefined();
    expect(req.user.twoStepPending).toBe(true);
  });
});
