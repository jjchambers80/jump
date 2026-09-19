// Online Store › Preferences: store access (private mode + password), the
// storefront homepage's search engine listing, and automatic language
// redirection. Settings live on Organization; the password is stored as a
// scrypt hash and never leaves the server.
//
// Visitors unlock a private storefront with POST /organizations/:id/storefront-access
// and then send the returned token as X-Storefront-Access. The token is an
// HS256 JWT (AUTH_SECRET) bound to a fingerprint of the current hash, so
// changing the password or clearing it invalidates every issued token.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import { AuthenticationError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const ACCESS_TOKEN_TTL = '30d';
const SCRYPT_KEYLEN = 64;

/** Optional text field: trims, and stores an empty string as null. */
function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Short fingerprint of the stored hash; tokens carry it so a password change revokes them. */
function fingerprint(storedHash) {
  return createHash('sha256').update(storedHash).digest('hex').slice(0, 16);
}

export function serializePreferences(org) {
  return {
    storefrontPrivate: org.storefrontPrivate,
    hasPassword: Boolean(org.storefrontPasswordHash),
    storefrontMessage: org.storefrontMessage,
    seoTitle: org.seoTitle,
    seoDescription: org.seoDescription,
    autoRedirectLanguage: org.autoRedirectLanguage,
  };
}

class StorefrontPreferencesService {
  async get(organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      omit: { storefrontPasswordHash: false },
    });
    if (!org) throw new NotFoundError('Organization not found');
    return serializePreferences(org);
  }

  /**
   * Partial update. `password`: a string sets a new password, null clears it.
   * Private mode needs a password (already set or in the same request), and
   * the password cannot be cleared while the store is private.
   */
  async update(organizationId, data) {
    const existing = await prisma.organization.findUnique({
      where: { id: organizationId },
      omit: { storefrontPasswordHash: false },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const patch = {};
    if (data.password !== undefined) {
      patch.storefrontPasswordHash = data.password === null ? null : hashPassword(data.password);
    }
    if (data.storefrontPrivate !== undefined) patch.storefrontPrivate = data.storefrontPrivate;
    if (data.storefrontMessage !== undefined)
      patch.storefrontMessage = optionalText(data.storefrontMessage);
    if (data.seoTitle !== undefined) patch.seoTitle = optionalText(data.seoTitle);
    if (data.seoDescription !== undefined) patch.seoDescription = optionalText(data.seoDescription);
    if (data.autoRedirectLanguage !== undefined)
      patch.autoRedirectLanguage = data.autoRedirectLanguage;

    const willBePrivate = patch.storefrontPrivate ?? existing.storefrontPrivate;
    const willHavePassword =
      patch.storefrontPasswordHash !== undefined
        ? Boolean(patch.storefrontPasswordHash)
        : Boolean(existing.storefrontPasswordHash);
    if (willBePrivate && !willHavePassword) {
      throw new ValidationError('Set a password before turning on private mode', [
        { field: 'password', message: 'A password is required while private mode is on' },
      ]);
    }

    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: patch,
      omit: { storefrontPasswordHash: false },
    });
    logger.info('Storefront preferences updated', {
      event: 'storefront_preferences_updated',
      organizationId,
      changes: Object.keys(patch),
    });
    return serializePreferences(org);
  }

  /** Exchange the storefront password for an access token; 401 on mismatch. */
  async unlock(organizationId, password) {
    const org = await prisma.organization.findFirst({
      where: { id: organizationId, status: 'ACTIVE' },
      select: { id: true, storefrontPrivate: true, storefrontPasswordHash: true },
    });
    if (!org) throw new NotFoundError('Organization not found');
    if (!org.storefrontPrivate || !verifyPassword(password, org.storefrontPasswordHash)) {
      throw new AuthenticationError('Incorrect password');
    }
    return { token: this.accessToken(org) };
  }

  accessToken(org) {
    return jwt.sign(
      { sub: org.id, typ: 'storefront', ph: fingerprint(org.storefrontPasswordHash) },
      process.env.AUTH_SECRET,
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL }
    );
  }

  /** True when the store is public, or the token unlocks this org's current password. */
  hasAccess(org, token) {
    if (!org.storefrontPrivate) return true;
    if (!token || !org.storefrontPasswordHash) return false;
    try {
      const claims = jwt.verify(token, process.env.AUTH_SECRET, { algorithms: ['HS256'] });
      return (
        claims.typ === 'storefront' &&
        claims.sub === org.id &&
        claims.ph === fingerprint(org.storefrontPasswordHash)
      );
    } catch {
      return false;
    }
  }
}

export default new StorefrontPreferencesService();
