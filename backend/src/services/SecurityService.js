// Sign-in methods for the signed-in user (spec 030 B): step-up proofs,
// password, connected providers, secondary email and recovery. Every
// method takes the authenticated user id; nothing here trusts a user id
// from a request body. Secrets are hashed (scrypt / sha256) and never
// logged; every change writes a SecurityEvent and emails a notice.

import { prisma } from '@jump/db';
import { AuthenticationError, ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { issueReauthProof } from '../middleware/recentAuth.js';
import emailService from './EmailService.js';
import passkeyService from './PasskeyService.js';
import securityEventService from './SecurityEventService.js';
import sessionService from './SessionService.js';
import logger from '../utils/logger.js';
import { clearTokens, consumeCode, consumeToken, issueToken } from '../utils/oneTimeTokens.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { isBreachedPassword, passwordRuleError } from '../utils/passwordPolicy.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';

const REAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const BRIDGE_TTL_MS = 2 * 60 * 1000;
const SECONDARY_EMAIL_TTL_MS = 60 * 60 * 1000;
const RECOVERY_TTL_MS = 15 * 60 * 1000;
const REAUTH_MAX_FAILURES = 5;
const REAUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;

function coded(error, code) {
  error.code = code;
  return error;
}

/** Recipients for a security notice: the primary and, once verified, the secondary address. */
export function noticeRecipients(user) {
  return [user.email, user.secondaryEmailVerifiedAt ? user.secondaryEmail : null].filter(Boolean);
}

class SecurityService {
  async _user(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundError('Account not found');
    return user;
  }

  async _notify(user, title, body) {
    await emailService.sendSecurityNotice({ to: noticeRecipients(user), title, body }).catch((error) =>
      logger.warn('Security notice failed', { userId: user.id, error: error.message })
    );
  }

  /** What Security shows: never the hashes or provider tokens. */
  async overview(userId) {
    const user = await this._user(userId);
    const [passkeys, accounts] = await Promise.all([
      passkeyService.list(userId),
      prisma.account.findMany({ where: { userId }, select: { provider: true, providerAccountId: true, createdAt: true } }),
    ]);
    return {
      password: { set: Boolean(user.passwordHash), updatedAt: user.passwordUpdatedAt },
      passkeys,
      providers: accounts.map((a) => ({
        provider: a.provider,
        // Enough to recognize the account, never the whole id
        accountIdHint: a.providerAccountId.length > 6 ? `…${a.providerAccountId.slice(-4)}` : null,
        connectedAt: a.createdAt,
      })),
      secondaryEmail: user.secondaryEmail
        ? { email: user.secondaryEmail, verified: Boolean(user.secondaryEmailVerifiedAt) }
        : null,
      reauthMethods: this._reauthMethods(user, passkeys.length),
    };
  }

  _reauthMethods(user, passkeyCount) {
    const methods = [];
    if (passkeyCount > 0) methods.push('passkey');
    if (user.passwordHash) methods.push('password');
    methods.push('email');
    return methods;
  }

  // ---- Step-up ----

  async reauthStart(userId, { method } = {}) {
    const user = await this._user(userId);
    const methods = this._reauthMethods(user, await passkeyService.count(userId));
    const result = { methods };
    if (method === 'email') {
      const code = await issueToken('reauth', userId, REAUTH_CODE_TTL_MS, { kind: 'code' });
      await emailService.sendReauthCode({ to: user.email, code }).catch((error) => {
        logger.warn('Reauth code email failed', { userId, error: error.message });
        throw error;
      });
      result.sentTo = user.email;
    } else if (method === 'passkey') {
      const { options } = await passkeyService.authenticationOptions({ subject: `reauth-${userId}` });
      result.passkeyOptions = options;
    }
    return result;
  }

  async _tooManyFailures(userId) {
    const since = new Date(Date.now() - REAUTH_FAILURE_WINDOW_MS);
    const failures = await prisma.securityEvent.count({ where: { userId, type: 'REAUTH_FAILED', createdAt: { gte: since } } });
    return failures >= REAUTH_MAX_FAILURES;
  }

  /** Verify one factor and return a 10-minute proof. */
  async reauth(userId, body, req) {
    const user = await this._user(userId);
    if (await this._tooManyFailures(userId)) {
      throw coded(new AuthenticationError('Too many attempts. Try again in a few minutes.'), 'REAUTH_LOCKED');
    }
    let ok = false;
    let method = null;
    if (typeof body.password === 'string') {
      method = 'password';
      ok = Boolean(user.passwordHash) && (await verifyPassword(body.password, user.passwordHash));
    } else if (typeof body.code === 'string') {
      method = 'email';
      ok = await consumeCode('reauth', userId, body.code.trim());
    } else if (body.passkey && typeof body.passkey === 'object') {
      method = 'passkey';
      try {
        await passkeyService.verifyAuthentication({
          challengeId: `reauth-${userId}`,
          response: body.passkey,
          origin: req?.get('origin'),
          expectUserId: userId,
        });
        ok = true;
      } catch {
        ok = false;
      }
    } else {
      throw new ValidationError('Provide a password, a code or a passkey');
    }

    if (!ok) {
      await securityEventService.record(userId, 'REAUTH_FAILED', { req, meta: { method } });
      throw coded(new AuthenticationError(method === 'email' ? 'That code is wrong or expired' : 'That didn’t match'), 'REAUTH_FAILED');
    }
    await securityEventService.record(userId, 'REAUTH_OK', { req, meta: { method } });
    return issueReauthProof(userId);
  }

  // ---- Password ----

  async setPassword(userId, password, req) {
    const user = await this._user(userId);
    const ruleError = passwordRuleError(password, { email: user.email });
    if (ruleError) throw new ValidationError(ruleError);
    if (await isBreachedPassword(password)) {
      throw new ValidationError('That password has appeared in a data breach. Choose a different one.');
    }
    const changing = Boolean(user.passwordHash);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), passwordUpdatedAt: new Date() },
    });
    await securityEventService.record(userId, changing ? 'PASSWORD_CHANGED' : 'PASSWORD_SET', { req });
    const others = await sessionService.revokeOthers(userId, req?.user?.sid ?? null, 'password-change');
    // Spec 030 C: a new password also forgets "remembered" two-step devices
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    await this._notify(
      user,
      changing ? 'Your password was changed' : 'A password was added to your account',
      `${changing ? 'The password on' : 'A password was added to'} your Jump account (${user.email})${others.revoked ? `, and ${others.revoked} other device${others.revoked === 1 ? ' was' : 's were'} signed out` : ''}. If this wasn't you, sign in and review Account › Security.`
    );
    return { set: true, updatedAt: new Date(), otherDevicesSignedOut: others.revoked };
  }

  async removePassword(userId, req) {
    const user = await this._user(userId);
    if (!user.passwordHash) throw new ValidationError('No password is set');
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null, passwordUpdatedAt: null } });
    await securityEventService.record(userId, 'PASSWORD_REMOVED', { req });
    await this._notify(user, 'Your password was removed', `The password on your Jump account (${user.email}) was removed. You can still sign in with an email link, Google or a passkey.`);
    return { set: false };
  }

  /**
   * Password sign-in (called by the frontend Credentials provider). A user
   * without a password fails exactly like a wrong password.
   */
  async verifyPasswordSignIn(email, password, req) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const user = normalized ? await prisma.user.findUnique({ where: { email: normalized } }) : null;
    const ok = Boolean(user && !user.deletedAt && user.isActive && user.passwordHash && (await verifyPassword(password, user.passwordHash)));
    if (!ok) {
      if (user) await securityEventService.record(user.id, 'SIGN_IN_FAILED', { req, meta: { method: 'password' } });
      throw new AuthenticationError('Wrong email or password');
    }
    await securityEventService.record(user.id, 'SIGN_IN', { req, meta: { method: 'password' } });
    return { id: user.id, email: user.email, name: user.name };
  }

  // ---- Bridge tokens (passkey sign-in, recovery) ----

  async issueBridgeToken(userId, meta = {}) {
    // The frontend `token-bridge` Credentials provider consumes this row
    // (same table, same sha256) and mints the Auth.js session. A passkey
    // assertion with user verification is two factors already (spec 030 C):
    // the subject carries ":uv" so that session skips the second step.
    const subject = meta.userVerified ? `${userId}:uv` : userId;
    const raw = await issueToken('bridge', subject, BRIDGE_TTL_MS);
    logger.info('Bridge token issued', { event: 'bridge_token_issued', userId, ...meta });
    return raw;
  }

  // ---- Connected providers ----

  async disconnectProvider(userId, provider, req) {
    const user = await this._user(userId);
    const account = await prisma.account.findFirst({ where: { userId, provider } });
    if (!account) throw new NotFoundError('That account is not connected');
    await prisma.account.delete({ where: { id: account.id } });
    if (provider === 'google') await this._revokeGoogle(account).catch(() => {});
    await securityEventService.record(userId, 'PROVIDER_DISCONNECTED', { req, meta: { provider } });
    await this._notify(user, `${providerLabel(provider)} was disconnected`, `${providerLabel(provider)} sign-in was disconnected from your Jump account (${user.email}). You can still sign in with an email link${user.passwordHash ? ', your password' : ''}.`);
  }

  async _revokeGoogle(account) {
    const token = account.refresh_token || account.access_token;
    if (!token) return;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(3000),
    });
  }

  // ---- Secondary email ----

  async setSecondaryEmail(userId, email, req) {
    const user = await this._user(userId);
    if (email === user.email) throw new ValidationError('That is already your primary email');
    const clash = await prisma.user.findFirst({
      where: { NOT: { id: userId }, OR: [{ email }, { secondaryEmail: email, secondaryEmailVerifiedAt: { not: null } }] },
      select: { id: true },
    });
    if (clash) throw coded(new ConflictError('That email address is already in use'), 'EMAIL_TAKEN');
    await prisma.user.update({ where: { id: userId }, data: { secondaryEmail: email, secondaryEmailVerifiedAt: null } });
    await this._sendSecondaryVerification(userId, email);
    await securityEventService.record(userId, 'SECONDARY_EMAIL_ADDED', { req });
    return { email, verified: false };
  }

  async _sendSecondaryVerification(userId, email) {
    const raw = await issueToken('secondary-email', userId, SECONDARY_EMAIL_TTL_MS);
    await emailService.sendSecondaryEmailVerification({
      to: email,
      confirmUrl: `${platformBaseUrl()}/auth/confirm-secondary-email?token=${encodeURIComponent(raw)}`,
    });
  }

  async resendSecondaryVerification(userId) {
    const user = await this._user(userId);
    if (!user.secondaryEmail || user.secondaryEmailVerifiedAt) throw new ValidationError('No secondary email is awaiting verification');
    await this._sendSecondaryVerification(userId, user.secondaryEmail);
  }

  async confirmSecondaryEmail(rawToken) {
    const result = await consumeToken('secondary-email', rawToken);
    if (!result) throw coded(new ValidationError('This link is invalid or has already been used'), 'TOKEN_INVALID');
    if (result.expired) throw coded(new ValidationError('This link has expired. Send a new one from Account › Security.'), 'TOKEN_EXPIRED');
    const user = await prisma.user.findUnique({ where: { id: result.subject } });
    if (!user || user.deletedAt || !user.secondaryEmail) throw coded(new ValidationError('This link is no longer valid'), 'TOKEN_INVALID');
    await prisma.user.update({ where: { id: user.id }, data: { secondaryEmailVerifiedAt: new Date() } });
    await securityEventService.record(user.id, 'SECONDARY_EMAIL_VERIFIED');
    await this._notify({ ...user, secondaryEmailVerifiedAt: new Date() }, 'Secondary email verified', `${user.secondaryEmail} can now be used to restore access to your Jump account (${user.email}) and receives security notices.`);
    return { email: user.secondaryEmail };
  }

  async removeSecondaryEmail(userId, req) {
    const user = await this._user(userId);
    if (!user.secondaryEmail) throw new ValidationError('No secondary email is set');
    const removed = user.secondaryEmail;
    await prisma.user.update({ where: { id: userId }, data: { secondaryEmail: null, secondaryEmailVerifiedAt: null } });
    await clearTokens('secondary-email', userId);
    await securityEventService.record(userId, 'SECONDARY_EMAIL_REMOVED', { req });
    // Tell both addresses: the one losing access too.
    await emailService.sendSecurityNotice({ to: [user.email, removed], title: 'Secondary email removed', body: `${removed} was removed as the secondary email on your Jump account (${user.email}).` }).catch(() => {});
  }

  // ---- Recovery via the verified secondary address ----

  /**
   * Always resolves the same way (no enumeration). A verified secondary
   * address gets a one-time link that signs into the primary account.
   */
  async requestRecovery(email, req) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalized) return;
    const user = await prisma.user.findFirst({
      where: { secondaryEmail: normalized, secondaryEmailVerifiedAt: { not: null }, deletedAt: null, isActive: true },
    });
    if (!user) return;
    const raw = await issueToken('recovery', user.id, RECOVERY_TTL_MS);
    await emailService.sendRecoveryLink({
      to: normalized,
      primaryEmail: user.email,
      recoverUrl: `${platformBaseUrl()}/auth/recover/complete?token=${encodeURIComponent(raw)}`,
    });
    await securityEventService.record(user.id, 'RECOVERY_REQUESTED', { req });
  }

  /** Swap the recovery link for a bridge token the frontend signs in with. */
  async completeRecovery(rawToken, req) {
    const result = await consumeToken('recovery', rawToken);
    if (!result || result.expired) throw coded(new AuthenticationError('This recovery link is invalid or expired'), 'TOKEN_INVALID');
    const user = await prisma.user.findUnique({ where: { id: result.subject } });
    if (!user || user.deletedAt || !user.isActive) throw coded(new AuthenticationError('This recovery link is no longer valid'), 'TOKEN_INVALID');
    await securityEventService.record(user.id, 'RECOVERY_USED', { req });
    return { bridgeToken: await this.issueBridgeToken(user.id, { via: 'recovery' }) };
  }
}

export function providerLabel(provider) {
  return provider === 'google' ? 'Google' : provider;
}

export default new SecurityService();
