// Two-step authentication (spec 030 C): authenticator app (TOTP), a
// registered passkey as security key, and single-use recovery codes.
//
// Once enabled, every sign-in — magic link and Google included — carries
// `mfa: 'pending'` until POST /account/two-step/verify succeeds and the
// frontend redeems the returned proof through useSession().update(). The
// TOTP seed is encrypted at rest (utils/secretBox.js); recovery codes and
// trusted-device tokens are stored hashed.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { generate as totpGenerate, generateSecret, generateURI, verify as totpVerify } from 'otplib';
import { prisma } from '@jump/db';
import { AuthenticationError, ValidationError } from '../middleware/errorHandler.js';
import { MFA_PROOF_TTL_S, issueMfaProof } from '../middleware/recentAuth.js';
import emailService from './EmailService.js';
import passkeyService from './PasskeyService.js';
import securityEventService from './SecurityEventService.js';
import sessionService from './SessionService.js';
import { noticeRecipients } from './SecurityService.js';
import { hashToken } from '../utils/oneTimeTokens.js';
import { open, seal } from '../utils/secretBox.js';
import logger from '../utils/logger.js';

const BOX_PURPOSE = 'totp';
const RECOVERY_CODE_COUNT = 10;
const TOTP_TOLERANCE_S = 30; // ± one step
const TRUST_DAYS = () => Number(process.env.TWO_STEP_TRUST_DAYS) || 30;
const VERIFY_MAX_FAILURES = 5;
const VERIFY_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const ISSUER = 'Jump';

function coded(error, code) {
  error.code = code;
  return error;
}

/** "abcde-fghij" — 10 lowercase alphanumerics, unambiguous alphabet. */
function newRecoveryCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normalizeRecoveryCode(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

class TwoStepService {
  async _user(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new AuthenticationError('Account not found');
    return user;
  }

  async _notify(user, title, body) {
    await emailService.sendSecurityNotice({ to: noticeRecipients(user), title, body }).catch((error) =>
      logger.warn('Two-step notice failed', { userId: user.id, error: error.message })
    );
  }

  async status(userId) {
    const user = await this._user(userId);
    const [passkeyCount, codes, trusted] = await Promise.all([
      passkeyService.count(userId),
      prisma.recoveryCode.findMany({ where: { userId }, select: { usedAt: true } }),
      prisma.trustedDevice.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' } }),
    ]);
    const enabled = Boolean(user.twoStepEnabledAt);
    return {
      enabled,
      enabledAt: user.twoStepEnabledAt,
      methods: { app: enabled, securityKey: enabled && passkeyCount > 0, passkeyCount },
      recoveryCodes: enabled ? { total: codes.length, remaining: codes.filter((c) => !c.usedAt).length } : null,
      trustedDevices: trusted.map((t) => ({ id: t.id, userAgent: t.userAgent, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt })),
      setupPending: !enabled && Boolean(user.totpSecretEnc),
    };
  }

  // ---- Setup / enable / disable ----

  /** Create (or reuse) an unconfirmed secret and return what the app needs to scan. */
  async setup(userId) {
    const user = await this._user(userId);
    if (user.twoStepEnabledAt) throw new ValidationError('Two-step authentication is already on');
    let secret = user.totpSecretEnc ? open(user.totpSecretEnc, BOX_PURPOSE) : null;
    if (!secret) {
      secret = generateSecret();
      await prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: seal(secret, BOX_PURPOSE) } });
    }
    const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    return { otpauthUrl, qrDataUrl, secret };
  }

  async _issueRecoveryCodes(userId, tx = prisma) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashToken(normalizeRecoveryCode(code)) })),
    });
    return codes;
  }

  /** Confirm the app works, switch on, hand out recovery codes once, sign out other devices. */
  async enable(userId, code, req) {
    const user = await this._user(userId);
    if (user.twoStepEnabledAt) throw new ValidationError('Two-step authentication is already on');
    if (!user.totpSecretEnc) throw new ValidationError('Set up an authenticator app first');
    const secret = open(user.totpSecretEnc, BOX_PURPOSE);
    if (!(await this._checkTotp(secret, code))) {
      await securityEventService.record(userId, 'TWO_STEP_FAILED', { req, meta: { stage: 'enable' } });
      throw coded(new ValidationError('That code didn’t match. Check the app and try again.'), 'CODE_INVALID');
    }
    const recoveryCodes = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { twoStepEnabledAt: new Date() } });
      return this._issueRecoveryCodes(userId, tx);
    });
    await securityEventService.record(userId, 'TWO_STEP_ENABLED', { req });
    const others = await sessionService.revokeOthers(userId, req?.user?.sid ?? null, 'two-step');
    await this._notify(
      user,
      'Two-step authentication is on',
      `Two-step authentication was turned on for your Jump account (${user.email})${others.revoked ? `, and ${others.revoked} other device${others.revoked === 1 ? ' was' : 's were'} signed out` : ''}. If this wasn't you, sign in and review Account › Security.`
    );
    // The enabling browser's own session predates 2FA; give it a proof so it stays signed in.
    const proof = await this._issueProof(userId);
    return { recoveryCodes, proof, otherDevicesSignedOut: others.revoked };
  }

  async disable(userId, { code, recoveryCode }, req) {
    const user = await this._user(userId);
    if (!user.twoStepEnabledAt) throw new ValidationError('Two-step authentication is not on');
    const ok = await this._verifySecondFactor(user, { code, recoveryCode }, req);
    if (!ok) throw coded(new ValidationError('That code didn’t match.'), 'CODE_INVALID');
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { twoStepEnabledAt: null, totpSecretEnc: null } }),
      prisma.recoveryCode.deleteMany({ where: { userId } }),
      prisma.trustedDevice.deleteMany({ where: { userId } }),
    ]);
    await securityEventService.record(userId, 'TWO_STEP_DISABLED', { req });
    await this._notify(user, 'Two-step authentication is off', `Two-step authentication was turned off for your Jump account (${user.email}). If this wasn't you, sign in and turn it back on under Account › Security.`);
  }

  async regenerateRecoveryCodes(userId, req) {
    const user = await this._user(userId);
    if (!user.twoStepEnabledAt) throw new ValidationError('Two-step authentication is not on');
    const codes = await this._issueRecoveryCodes(userId);
    await securityEventService.record(userId, 'RECOVERY_CODES_REGENERATED', { req });
    await this._notify(user, 'New recovery codes were generated', `A new set of recovery codes was generated for your Jump account (${user.email}). The old codes no longer work.`);
    return { recoveryCodes: codes };
  }

  // ---- Second step ----

  async _checkTotp(secret, code) {
    const token = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) return false;
    const result = await totpVerify({ secret, token, epochTolerance: TOTP_TOLERANCE_S });
    return Boolean(result.valid);
  }

  async _consumeRecoveryCode(userId, raw) {
    const normalized = normalizeRecoveryCode(raw);
    if (normalized.length !== 10) return false;
    const target = hashToken(normalized);
    const codes = await prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
    const match = codes.find((c) => c.codeHash.length === target.length && timingSafeEqual(Buffer.from(c.codeHash), Buffer.from(target)));
    if (!match) return false;
    const claimed = await prisma.recoveryCode.updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: new Date() } });
    return claimed.count === 1;
  }

  async _tooManyFailures(userId) {
    const since = new Date(Date.now() - VERIFY_FAILURE_WINDOW_MS);
    const failures = await prisma.securityEvent.count({ where: { userId, type: 'TWO_STEP_FAILED', createdAt: { gte: since } } });
    return failures >= VERIFY_MAX_FAILURES;
  }

  /** @returns {Promise<false | 'app' | 'recovery' | 'passkey'>} */
  async _verifySecondFactor(user, { code, recoveryCode, passkey }, req) {
    if (typeof code === 'string' && user.totpSecretEnc) {
      return (await this._checkTotp(open(user.totpSecretEnc, BOX_PURPOSE), code)) ? 'app' : false;
    }
    if (typeof recoveryCode === 'string') {
      return (await this._consumeRecoveryCode(user.id, recoveryCode)) ? 'recovery' : false;
    }
    if (passkey && typeof passkey === 'object') {
      try {
        await passkeyService.verifyAuthentication({ challengeId: `mfa-${user.id}`, response: passkey, origin: req?.get('origin'), expectUserId: user.id });
        return 'passkey';
      } catch {
        return false;
      }
    }
    throw new ValidationError('Provide an authenticator code, a recovery code or a passkey');
  }

  async passkeyOptions(userId) {
    const { options } = await passkeyService.authenticationOptions({ subject: `mfa-${userId}`, userVerification: 'discouraged' });
    return options;
  }

  async _issueProof(userId) {
    const jti = randomUUID();
    await prisma.verificationToken.create({
      data: { identifier: `mfa-proof:${jti}`, token: hashToken(jti), expires: new Date(Date.now() + MFA_PROOF_TTL_S * 1000) },
    });
    return issueMfaProof(userId, jti);
  }

  /**
   * Complete the second step for a pending session. Returns the proof and,
   * when asked, a trusted-device token the frontend stores in a cookie.
   */
  async verify(userId, body, req) {
    const user = await this._user(userId);
    if (!user.twoStepEnabledAt) {
      // Nothing to verify (turned off between sign-in and now): let them through.
      return { proof: await this._issueProof(userId), method: null };
    }
    if (await this._tooManyFailures(userId)) {
      throw coded(new AuthenticationError('Too many attempts. Wait a few minutes, then check your phone’s clock and try again.'), 'TWO_STEP_LOCKED');
    }
    const method = await this._verifySecondFactor(user, body, req);
    if (!method) {
      await securityEventService.record(userId, 'TWO_STEP_FAILED', { req, meta: { stage: 'verify' } });
      throw coded(new AuthenticationError('That code didn’t match.'), 'CODE_INVALID');
    }
    await securityEventService.record(userId, method === 'recovery' ? 'RECOVERY_CODE_USED' : 'TWO_STEP_VERIFIED', { req, meta: { method } });
    if (method === 'recovery') {
      const remaining = await prisma.recoveryCode.count({ where: { userId, usedAt: null } });
      await this._notify(user, 'A recovery code was used', `A recovery code was used to sign in to your Jump account (${user.email}). ${remaining} code${remaining === 1 ? '' : 's'} remain. If this wasn't you, sign in and review Account › Security.`);
    }
    const result = { proof: await this._issueProof(userId), method };
    if (body.rememberDevice === true) result.trustToken = await this._trustDevice(userId, req);
    return result;
  }

  // ---- Trusted devices ----

  async _trustDevice(userId, req) {
    const raw = randomBytes(32).toString('base64url');
    await prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        userAgent: (req?.get('user-agent') || '').slice(0, 512) || null,
        expiresAt: new Date(Date.now() + TRUST_DAYS() * 24 * 60 * 60 * 1000),
      },
    });
    await securityEventService.record(userId, 'TRUSTED_DEVICE_ADDED', { req });
    return raw;
  }

  /** A valid trusted-device token completes the second step without a code. */
  async trustedCheck(userId, raw, req) {
    if (typeof raw !== 'string' || !raw) return { proof: null };
    const row = await prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row || row.userId !== userId || row.expiresAt < new Date()) return { proof: null };
    await prisma.trustedDevice.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    await securityEventService.record(userId, 'TWO_STEP_VERIFIED', { req, meta: { method: 'trusted-device' } });
    return { proof: await this._issueProof(userId) };
  }

  async revokeTrustedDevice(userId, id, req) {
    const result = await prisma.trustedDevice.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw new ValidationError('That device is no longer trusted');
    await securityEventService.record(userId, 'TRUSTED_DEVICE_REVOKED', { req, meta: { id } });
  }

  async clearTrustedDevices(userId) {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
  }

  /** Test helper: current code for a secret. */
  async currentCode(secret) {
    return totpGenerate({ secret });
  }
}

export { TRUST_DAYS };
export default new TwoStepService();
