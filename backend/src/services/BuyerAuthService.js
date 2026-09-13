// Buyer Auth Service (spec 007 phase 2)
// Passwordless sign-in for org-scoped buyers (Contact rows).
//
// - Tokens are 32 random bytes, base64url. Only sha256(token) is stored.
// - Single use, short lived: LOGIN 15 min (requested from the storefront),
//   WELCOME 7 days (issued at purchase when the buyer opted into an account).
// - A buyer session is its own HS256 JWT with typ 'buyer'. Staff middleware
//   rejects it and this service rejects staff tokens, so the two principals
//   never cross.

import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { AuthenticationError } from '../middleware/errorHandler.js';

const TOKEN_TTL_MS = {
  LOGIN: 15 * 60 * 1000,
  WELCOME: 7 * 24 * 60 * 60 * 1000,
};

export const BUYER_SESSION_TYP = 'buyer';
const SESSION_TTL = '30d';

// Per-email issuance cap for LOGIN tokens: at most 3 in any 15-minute window.
const LOGIN_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_REQUESTS_PER_WINDOW = 3;

function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
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
   * @returns {Promise<{ issued: boolean, contact?: object, rawToken?: string }>}
   */
  async requestLogin(organizationId, email) {
    const contact = await prisma.contact.findUnique({
      where: { organizationId_email: { organizationId, email: email.toLowerCase() } },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        accountCreatedAt: true,
        organization: { select: { name: true, logoUrl: true } },
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
    return { issued: true, contact, rawToken };
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
  signSession(buyer) {
    return jwt.sign(
      {
        sub: buyer.contactId,
        org: buyer.organizationId,
        email: buyer.email,
        typ: BUYER_SESSION_TYP,
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
    return { contactId: decoded.sub, organizationId: decoded.org, email: decoded.email };
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
