// Buyer Auth Service (spec 007 phase 2)
// Passwordless sign-in for org-scoped buyers (Contact rows).
//
// - Tokens are 32 random bytes, base64url. Only sha256(token) is stored.
// - Single use, short lived: LOGIN 15 min (requested from the storefront),
//   WELCOME 7 days (issued at purchase when the buyer opted into an account).
// - A buyer session is its own HS256 JWT with typ 'buyer'. Staff middleware
//   rejects it and this service rejects staff tokens, so the two principals
//   never cross.
// - Spec 031 phase 3: an organization may use a six-digit CODE instead of
//   (well, alongside) the link. Codes live in the same table with purpose
//   CODE, 10-minute TTL, hashed with the org + email so a code is only good
//   for the address it was sent to, and die after 5 wrong guesses.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { AuthenticationError } from '../middleware/errorHandler.js';

const TOKEN_TTL_MS = {
  LOGIN: 15 * 60 * 1000,
  WELCOME: 7 * 24 * 60 * 60 * 1000,
  CODE: 10 * 60 * 1000,
  DELETE_CONFIRM: 10 * 60 * 1000, // spec 040 card D
};

export const CODE_LENGTH = 6;
export const CODE_MAX_ATTEMPTS = 5;

export const BUYER_SESSION_TYP = 'buyer';
const SESSION_TTL = '30d';

// Per-email issuance cap for LOGIN tokens: at most 3 in any 15-minute window.
const LOGIN_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_REQUESTS_PER_WINDOW = 3;

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** A code is bound to the organization and address it was sent to. */
function hashCode(organizationId, email, code) {
  return hashToken(`code:${organizationId}:${normalizeEmail(email)}:${code}`);
}

function isCodeShaped(value) {
  return typeof value === 'string' && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value);
}

class BuyerAuthService {
  /**
   * Issue a single-use token for a contact. Returns the raw token exactly once.
   * @param {{ id: string, organizationId: string }} contact
   * @param {'LOGIN'|'WELCOME'} purpose
   * @returns {Promise<{ rawToken: string, expiresAt: Date }>}
   */
  async issueToken(contact, purpose) {
    const ttl = TOKEN_TTL_MS[purpose];
    if (!ttl) throw new Error(`Unknown buyer token purpose: ${purpose}`);

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttl);

    await prisma.buyerLoginToken.create({
      data: {
        contactId: contact.id,
        organizationId: contact.organizationId,
        tokenHash: hashToken(rawToken),
        purpose,
        expiresAt,
      },
    });

    return { rawToken, expiresAt };
  }

  /**
   * Issue a six-digit sign-in code for a contact (spec 031). Returns it once.
   * @returns {Promise<{ rawCode: string, expiresAt: Date }>}
   */
  async issueCode(contact) {
    const rawCode = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS.CODE);
    await prisma.buyerLoginToken.create({
      data: {
        contactId: contact.id,
        organizationId: contact.organizationId,
        tokenHash: hashCode(contact.organizationId, contact.email, rawCode),
        purpose: 'CODE',
        expiresAt,
      },
    });
    return { rawCode, expiresAt };
  }

  /**
   * Six-digit code that confirms an action on a signed-in account (spec 040:
   * DELETE_CONFIRM). Bound to the contact and purpose; issuing one retires the
   * previous live code for the same purpose.
   * @returns {Promise<{ rawCode: string, expiresAt: Date }>}
   */
  async issueContactCode(contact, purpose) {
    const ttl = TOKEN_TTL_MS[purpose];
    if (!ttl) throw new Error(`Unknown buyer token purpose: ${purpose}`);
    const rawCode = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const expiresAt = new Date(Date.now() + ttl);
    await prisma.$transaction([
      prisma.buyerLoginToken.updateMany({ where: { contactId: contact.id, purpose, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.buyerLoginToken.create({
        data: {
          contactId: contact.id,
          organizationId: contact.organizationId,
          tokenHash: hashToken(`${purpose}:${contact.id}:${rawCode}`),
          purpose,
          expiresAt,
        },
      }),
    ]);
    return { rawCode, expiresAt };
  }

  /**
   * Check and spend a code from `issueContactCode`. Same lockout as sign-in
   * codes: five wrong guesses kill it. Returns false on any failure.
   */
  async consumeContactCode(contactId, purpose, code) {
    if (!isCodeShaped(code)) return false;
    const now = new Date();
    const token = await prisma.buyerLoginToken.findFirst({
      where: { contactId, purpose, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true, attempts: true },
    });
    if (!token) return false;
    const expected = Buffer.from(token.tokenHash, 'hex');
    const actual = Buffer.from(hashToken(`${purpose}:${contactId}:${code}`), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = token.attempts + 1;
      await prisma.buyerLoginToken.update({
        where: { id: token.id },
        data: { attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { usedAt: now } : {}) },
      });
      return false;
    }
    const claimed = await prisma.buyerLoginToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: now } });
    return claimed.count === 1;
  }

  /**
   * Whether a contact has hit the LOGIN token issuance cap.
   * @param {string} contactId
   */
  async isLoginRateLimited(contactId) {
    const since = new Date(Date.now() - LOGIN_REQUEST_WINDOW_MS);
    const recent = await prisma.buyerLoginToken.count({
      where: { contactId, purpose: 'LOGIN', createdAt: { gte: since } },
    });
    return recent >= LOGIN_REQUESTS_PER_WINDOW;
  }

  /**
   * Storefront sign-in request. Always resolves (never reveals whether the
   * email exists or has an account); a token is issued only for a
   * login-enabled contact at this organization that is under the rate cap.
   *
   * @param {string} organizationId
   * @param {string} email
   * When the organization signs buyers in by CODE, a six-digit code is issued
   * alongside the link and returned as `rawCode`.
   *
   * @returns {Promise<{ issued: boolean, contact?: object, rawToken?: string, rawCode?: string|null }>}
   */
  async requestLogin(organizationId, email) {
    const contact = await prisma.contact.findUnique({
      where: { organizationId_email: { organizationId, email: normalizeEmail(email) } },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        accountCreatedAt: true,
        organization: { select: { id: true, name: true, logoUrl: true, buyerSignInMethod: true } },
      },
    });

    if (!contact?.accountCreatedAt) {
      return { issued: false };
    }
    if (await this.isLoginRateLimited(contact.id)) {
      logger.warn('Buyer login request rate limited', { contactId: contact.id, organizationId });
      return { issued: false };
    }

    const { rawToken } = await this.issueToken(contact, 'LOGIN');
    const rawCode = contact.organization?.buyerSignInMethod === 'CODE' ? (await this.issueCode(contact)).rawCode : null;
    return { issued: true, contact, rawToken, rawCode };
  }

  /**
   * Consume a six-digit code typed on the account page (spec 031). The newest
   * live code for the address is checked; a wrong guess counts against it and
   * the fifth kills it. Every failure is the same 401 so nothing leaks.
   *
   * @returns {Promise<{ contactId: string, organizationId: string, email: string, purpose: 'CODE' }>}
   */
  async consumeCode(organizationId, email, code) {
    const invalid = () => new AuthenticationError('This code is incorrect or has expired');
    if (!organizationId || typeof email !== 'string' || !isCodeShaped(code)) throw invalid();

    const now = new Date();
    const normalizedEmail = normalizeEmail(email);
    const token = await prisma.buyerLoginToken.findFirst({
      where: {
        organizationId,
        purpose: 'CODE',
        usedAt: null,
        expiresAt: { gt: now },
        contact: { email: normalizedEmail },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true, attempts: true, contact: { select: { id: true, organizationId: true, email: true } } },
    });
    if (!token) throw invalid();

    const expected = Buffer.from(token.tokenHash, 'hex');
    const actual = Buffer.from(hashCode(organizationId, normalizedEmail, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = token.attempts + 1;
      await prisma.buyerLoginToken.update({
        where: { id: token.id },
        data: { attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { usedAt: now } : {}) },
      });
      if (attempts >= CODE_MAX_ATTEMPTS) {
        logger.warn('Buyer sign-in code locked after repeated failures', { contactId: token.contact.id, organizationId });
      }
      throw invalid();
    }

    // Single use: the predicate loses to a concurrent claim or the attempt lockout above.
    const claimed = await prisma.buyerLoginToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalid();

    return { contactId: token.contact.id, organizationId: token.contact.organizationId, email: token.contact.email, purpose: 'CODE' };
  }

  /**
   * Consume a token: marks it used and returns the buyer identity.
   * Throws AuthenticationError for unknown, used, or expired tokens.
   *
   * @param {string} rawToken
   * @returns {Promise<{ contactId: string, organizationId: string, email: string, purpose: string }>}
   */
  async consumeToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new AuthenticationError('Invalid sign-in link');
    }

    const now = new Date();
    const tokenHash = hashToken(rawToken);
    // Claim and load inside one transaction: the updateMany predicate makes
    // single use atomic (two concurrent verifies cannot both win), and a
    // failure loading the contact rolls the claim back so the link stays usable.
    const token = await prisma.$transaction(async (tx) => {
      const claimed = await tx.buyerLoginToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      return tx.buyerLoginToken.findUnique({
        where: { tokenHash },
        select: {
          purpose: true,
          contact: { select: { id: true, organizationId: true, email: true } },
        },
      });
    });
    if (!token) {
      throw new AuthenticationError('This sign-in link is invalid or has expired');
    }

    return {
      contactId: token.contact.id,
      organizationId: token.contact.organizationId,
      email: token.contact.email,
      purpose: token.purpose,
    };
  }

  /**
   * Mint a buyer session JWT.
   * @param {{ contactId: string, organizationId: string, email: string }} buyer
   */
  signSession(buyer, { issuedAt = null } = {}) {
    return jwt.sign(
      {
        sub: buyer.contactId,
        org: buyer.organizationId,
        email: buyer.email,
        typ: BUYER_SESSION_TYP,
        // Spec 040: a session minted right after "sign out of all devices" must
        // not fall in the same second as the cut-off, so round `iat` up past it.
        ...(issuedAt && { iat: Math.ceil(issuedAt.getTime() / 1000) }),
      },
      process.env.AUTH_SECRET,
      { algorithm: 'HS256', expiresIn: SESSION_TTL }
    );
  }

  /**
   * Verify a buyer session JWT. Rejects staff (Auth.js) tokens.
   * @param {string} token
   * @returns {{ contactId: string, organizationId: string, email: string }}
   */
  verifySession(token) {
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.AUTH_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new AuthenticationError('Invalid or expired session');
    }
    if (decoded.typ !== BUYER_SESSION_TYP || !decoded.sub || !decoded.org) {
      throw new AuthenticationError('Not a buyer session');
    }
    return { contactId: decoded.sub, organizationId: decoded.org, email: decoded.email, issuedAt: decoded.iat ?? null };
  }

  /**
   * Refuse a session issued before the buyer's "sign out of all devices"
   * (spec 040). One indexed read per buyer request.
   * @param {{ contactId: string, issuedAt: number|null }} buyer
   */
  async assertSessionCurrent(buyer) {
    const contact = await prisma.contact.findUnique({
      where: { id: buyer.contactId },
      select: { buyerSessionsValidAfter: true },
    });
    if (!contact) throw new AuthenticationError('Account not found');
    const cutoff = contact.buyerSessionsValidAfter?.getTime();
    if (cutoff && (!buyer.issuedAt || buyer.issuedAt * 1000 < cutoff)) {
      const error = new AuthenticationError('This session was signed out');
      error.code = 'SESSION_REVOKED';
      throw error;
    }
  }

  /**
   * Current buyer profile for a session.
   * @param {string} contactId
   */
  async getProfile(contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        emailSubscribed: true,
        accountCreatedAt: true,
        organization: { select: { id: true, name: true, logoUrl: true, brandColor: true, themeMode: true } },
      },
    });
    if (!contact?.accountCreatedAt) {
      throw new AuthenticationError('Account not found');
    }
    return contact;
  }
}

export default new BuyerAuthService();
