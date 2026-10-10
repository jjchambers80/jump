// Developer tokens for the Jump CLI (spec 043). The CLI signs in the way
// `shopify theme dev` and `gh auth login` do: it opens /admin/cli/authorize in
// the browser, the signed-in staff member approves, and a one-time code comes
// back to a loopback listener. The CLI trades the code plus its PKCE verifier
// for a `jmp_` token bound to one organization and a list of scopes.
//
// Only the sha256 of codes and tokens is stored. Tokens work only on routers
// mounted with allowDeveloperToken(scope); requireAuth refuses them.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { prisma } from '@jump/db';
import { AuthenticationError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';
import logger from '../utils/logger.js';

export const TOKEN_PREFIX = 'jmp_';
export const SCOPES = Object.freeze(['themes']);
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const NAME_MAX = 80;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** RFC 8252 loopback redirect: plain http to 127.0.0.1 / localhost / [::1] with an explicit port. */
export function isLoopbackRedirect(uri) {
  try {
    const url = new URL(uri);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.port !== '' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
function pkceMatches(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

class DeveloperTokenService {
  /** Theme access: SYSTEM_ADMIN, or an ORGANIZER / ADMIN member of the organization. */
  async canUse(userId, role, organizationId) {
    if (role === 'SYSTEM_ADMIN') return true;
    const member = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    return Boolean(member);
  }

  /** The store the CLI asked for, by slug or id, if this user may approve for it. */
  async organizationFor(user, store) {
    const organization =
      typeof store === 'string' && store
        ? await findByPublicIdentifier(prisma.organization, store, {
            where: { status: 'ACTIVE' },
            select: { id: true, name: true, slug: true },
          })
        : null;
    if (!organization) throw new NotFoundError('Store not found');
    if (!(await this.canUse(user.id, user.role, organization.id))) {
      throw new ForbiddenError('You are not a member of this store');
    }
    return organization;
  }

  /** The browser approved: a one-time code for the CLI's loopback listener. */
  async createCode(user, { store, codeChallenge, redirectUri, name }) {
    if (!isLoopbackRedirect(redirectUri)) throw new ValidationError('The CLI must listen on a loopback address');
    if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      throw new ValidationError('A PKCE S256 code challenge is required');
    }
    const organization = await this.organizationFor(user, store);
    const code = randomBytes(32).toString('base64url');
    await prisma.developerAuthCode.create({
      data: {
        codeHash: sha256(code),
        codeChallenge,
        redirectUri,
        userId: user.id,
        organizationId: organization.id,
        name: (typeof name === 'string' && name.trim() ? name.trim() : 'Jump CLI').slice(0, NAME_MAX),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return { code, organization };
  }

  /** The CLI trades code + verifier for a token, once. */
  async exchange({ code, codeVerifier, redirectUri }) {
    const refused = () => new AuthenticationError('This sign-in code is invalid or has expired');
    if (typeof code !== 'string' || !code) throw refused();
    const now = new Date();
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    // Claim first, outside any transaction: a failed check below still burns
    // the code, and only one of two racing exchanges can flip usedAt.
    const claimed = await prisma.developerAuthCode.updateMany({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw refused();
    const row = await prisma.developerAuthCode.findUnique({ where: { codeHash: sha256(code) } });
    if (row.redirectUri !== redirectUri || !pkceMatches(codeVerifier, row.codeChallenge)) throw refused();
    if (!(await this._stillAllowed(prisma, row.userId, row.organizationId))) throw refused();
    const issued = await prisma.developerToken.create({
      data: {
        organizationId: row.organizationId,
        userId: row.userId,
        name: row.name,
        tokenHash: sha256(token),
        prefix: token.slice(0, TOKEN_PREFIX.length + 6),
        scopes: [...SCOPES],
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      },
      include: { organization: { select: { id: true, name: true, slug: true } }, user: { select: { email: true } } },
    });
    // ponytail: stale codes are swept here, not by a timer; add a sweep if the table ever grows.
    await prisma.developerAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
    logger.info('Developer token issued', { event: 'developer_token_issued', organizationId: issued.organizationId, userId: issued.userId, tokenId: issued.id });
    return {
      token,
      expiresAt: issued.expiresAt,
      scopes: issued.scopes,
      organization: issued.organization,
      user: { email: issued.user.email },
    };
  }

  async _stillAllowed(db, userId, organizationId) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return false;
    if (user.role === 'SYSTEM_ADMIN') return true;
    return Boolean(
      await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } }),
    );
  }

  /**
   * req.user for a valid token carrying `scope`, else null. Checked on every
   * request: revoking a token or removing the member takes effect at once.
   */
  async authenticate(token, scope) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;
    const row = await prisma.developerToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= new Date() || !row.scopes.includes(scope)) return null;
    if (!(await this._stillAllowed(prisma, row.userId, row.organizationId))) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      prisma.developerToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.user.role,
      sid: null,
      twoStepPending: false,
      organizationId: row.organizationId,
      developerTokenId: row.id,
    };
  }

  /** Settings › Developers: `user.manageAll` (developer.manageAll) sees every token of the organization, others their own. */
  async list(organizationId, user) {
    const mine = !user.manageAll;
    const rows = await prisma.developerToken.findMany({
      where: { organizationId, revokedAt: null, expiresAt: { gt: new Date() }, ...(mine && { userId: user.id }) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      user: { id: r.user.id, name: r.user.name ?? r.user.email },
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
    }));
  }

  async revoke(organizationId, user, tokenId) {
    const row = await prisma.developerToken.findFirst({ where: { id: tokenId, organizationId, revokedAt: null } });
    const admin = user.manageAll;
    if (!row || (!admin && row.userId !== user.id)) throw new NotFoundError('Token not found');
    await prisma.developerToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    logger.info('Developer token revoked', { event: 'developer_token_revoked', organizationId, tokenId, by: user.id });
  }

  /** `jump logout`: the token revokes itself. */
  async revokeSelf(tokenId) {
    await prisma.developerToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  }
}

export default new DeveloperTokenService();
