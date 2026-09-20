// The signed-in user's own account (spec 030 feature A).
//
// Everything here is keyed on the authenticated user id; callers never pass a
// user id from the request body. Profile fields, the verified email change and
// the uploaded photo live on User — never on an organization, membership or
// Contact.

import { createHash, randomBytes } from 'crypto';
import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import emailService from './EmailService.js';
import imageService from './ImageService.js';
import logger from '../utils/logger.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import { SUPPORTED_LOCALES } from '../utils/locales.js';

export const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_PREFIX = 'email-change:';

const accountInclude = {
  avatarImage: { include: { file: true } },
  accounts: { select: { provider: true, createdAt: true } },
};

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/** Error with a machine-readable `code` the error handler puts on the response. */
function coded(error, code) {
  error.code = code;
  return error;
}

/** "First Last" from the parts; null when both are empty. */
export function displayName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(' ') || null;
}

class AccountService {
  async _load(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: accountInclude });
    if (!user || user.deletedAt) throw new NotFoundError('Account not found');
    return user;
  }

  /** Public shape of an account. Never includes provider tokens. */
  toJson(user) {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      pendingEmail: user.pendingEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      phone: user.phone,
      locale: user.locale,
      timeZone: user.timeZone,
      avatar: user.avatarImage ? imageService.formatImageResponse(user.avatarImage) : null,
      imageFallbackUrl: user.image || null,
      providers: (user.accounts || []).map((account) => ({
        provider: account.provider,
        connectedAt: account.createdAt,
      })),
      supportedLocales: SUPPORTED_LOCALES,
      createdAt: user.createdAt,
    };
  }

  async get(userId) {
    return this.toJson(await this._load(userId));
  }

  /**
   * Partial profile update. `patch` is already validated/normalized by
   * validateUpdateAccount (E.164 phone, supported locale, IANA time zone).
   */
  async update(userId, patch) {
    const current = await this._load(userId);
    const data = { ...patch };
    if ('firstName' in patch || 'lastName' in patch) {
      const firstName = 'firstName' in patch ? patch.firstName : current.firstName;
      const lastName = 'lastName' in patch ? patch.lastName : current.lastName;
      data.name = displayName(firstName, lastName);
    }
    const user = await prisma.user.update({ where: { id: userId }, data, include: accountInclude });
    logger.info('Account updated', { event: 'account_updated', userId, fields: Object.keys(patch) });
    return this.toJson(user);
  }

  // ---- Email change (verified, pending until the new address confirms) ----

  async requestEmailChange(userId, email) {
    const user = await this._load(userId);
    if (email === user.email) throw new ValidationError('That is already your email address');
    await this._assertEmailFree(email, userId);

    const rawToken = randomBytes(32).toString('base64url');
    const identifier = `${EMAIL_CHANGE_PREFIX}${userId}`;
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier } }),
      prisma.verificationToken.create({
        data: { identifier, token: hashToken(rawToken), expires: new Date(Date.now() + EMAIL_CHANGE_TTL_MS) },
      }),
      prisma.user.update({ where: { id: userId }, data: { pendingEmail: email } }),
    ]);

    await emailService.sendEmailChangeConfirmation({
      to: email,
      currentEmail: user.email,
      confirmUrl: `${platformBaseUrl()}/auth/confirm-email?token=${encodeURIComponent(rawToken)}`,
    });
    logger.info('Email change requested', { event: 'account_email_change_requested', userId });
    return this.get(userId);
  }

  async resendEmailChange(userId) {
    const user = await this._load(userId);
    if (!user.pendingEmail) throw new ValidationError('No email change is pending');
    return this.requestEmailChange(userId, user.pendingEmail);
  }

  async cancelEmailChange(userId) {
    await this._load(userId);
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier: `${EMAIL_CHANGE_PREFIX}${userId}` } }),
      prisma.user.update({ where: { id: userId }, data: { pendingEmail: null } }),
    ]);
    return this.get(userId);
  }

  /**
   * Confirm from the link in the new address's inbox. Unauthenticated: the
   * token identifies the user. Returns the new email.
   */
  async confirmEmailChange(rawToken) {
    const record = await prisma.verificationToken.findFirst({
      where: { token: hashToken(rawToken), identifier: { startsWith: EMAIL_CHANGE_PREFIX } },
    });
    if (!record) throw coded(new ValidationError('This confirmation link is invalid or has already been used'), 'TOKEN_INVALID');
    const userId = record.identifier.slice(EMAIL_CHANGE_PREFIX.length);
    const invalidate = () =>
      prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } });

    if (record.expires < new Date()) {
      await invalidate();
      throw coded(new ValidationError('This confirmation link has expired. Request a new one from your account settings.'), 'TOKEN_EXPIRED');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || !user.pendingEmail) {
      await invalidate();
      throw coded(new ValidationError('This confirmation link is no longer valid'), 'TOKEN_INVALID');
    }
    await this._assertEmailFree(user.pendingEmail, userId);

    const oldEmail = user.email;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { email: user.pendingEmail, emailVerified: new Date(), pendingEmail: null },
      }),
      prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } }),
    ]);
    emailService
      .sendEmailChangedNotice({ to: oldEmail, newEmail: user.pendingEmail })
      .catch((error) => logger.warn('Email changed notice failed', { userId, error: error.message }));
    logger.info('Email changed', { event: 'account_email_changed', userId });
    return { email: user.pendingEmail };
  }

  async _assertEmailFree(email, userId) {
    const taken = await prisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } });
    if (taken) throw coded(new ConflictError('That email address is already in use'), 'EMAIL_TAKEN');
  }

  // ---- Photo ----

  /** Point the account at a new Image (or none). Returns the previous image id for cleanup. */
  async setAvatar(userId, imageId) {
    const current = await this._load(userId);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarImageId: imageId },
      include: accountInclude,
    });
    return { account: this.toJson(user), previousAvatarImageId: current.avatarImageId };
  }
}

export default new AccountService();
