// Authorization choke point for every agent tool (spec 045). Opaque bearer
// tokens are looked up only by a peppered HMAC; current switches, membership,
// role, scope and limits are re-checked on every call.

import { createHmac } from 'node:crypto';
import { prisma } from '@jump/db';
import { limiterConfig } from '../middleware/rateLimit.js';
import { cacheIncrement } from '../utils/cache.js';

export const AGENT_RESOURCE = 'https://mcp.eventimus.net/mcp';
export const AGENT_ACCESS_SETTING = 'agentAccessEnabled';

const GRANT_LIMIT = Object.freeze({ windowMs: 60_000, limit: 120 });
const ORG_LIMIT = Object.freeze({ windowMs: 60_000, limit: 1_200 });

export class AgentAuthorizationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'AgentAuthorizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const denied = () => new AgentAuthorizationError('invalid_token', 'The access token is invalid or expired', 401);

/** The only representation of an OAuth bearer token that may reach Prisma. */
export function hashOAuthToken(token, pepper = process.env.OAUTH_TOKEN_PEPPER) {
  if (typeof token !== 'string' || !token || typeof pepper !== 'string' || !pepper) return null;
  return createHmac('sha256', pepper).update(token).digest('hex');
}

function settingEnabled(setting) {
  return setting?.value === true || setting?.value?.enabled === true;
}

function requiredScopes(scope) {
  return [...new Set((Array.isArray(scope) ? scope : [scope]).filter((item) => typeof item === 'string' && item))];
}

class AgentAuthService {
  async _takeLimit(name, key, defaults) {
    const config = limiterConfig(name, defaults);
    const count = await cacheIncrement(`agent-limit:${name.toLowerCase()}:${key}`, config.windowMs);
    // Redis is a security dependency for production agent access. Fail closed.
    if (count === null || count > config.limit) {
      throw new AgentAuthorizationError('rate_limited', 'Agent request limit exceeded', 429);
    }
  }

  // Deliberate no-op insertion point for a future paid-plan decision (§8 Q3).
  async _assertPlanAllows(_organizationId) {}

  async agentAuthorize(token, { scope, audience = AGENT_RESOURCE } = {}) {
    if (process.env.AGENT_ACCESS_ENABLED !== 'true') {
      throw new AgentAuthorizationError('agent_access_disabled', 'Agent access is disabled', 403);
    }

    const globalSetting = await prisma.platformSetting.findUnique({ where: { key: AGENT_ACCESS_SETTING } });
    if (!settingEnabled(globalSetting)) {
      throw new AgentAuthorizationError('agent_access_disabled', 'Agent access is disabled', 403);
    }

    const tokenHash = hashOAuthToken(token);
    if (!tokenHash) throw denied();
    const row = await prisma.oAuthToken.findUnique({
      where: { tokenHash },
      include: {
        grant: {
          include: {
            client: { select: { name: true } },
            organization: { select: { agentAccessEnabled: true, status: true } },
            user: { select: { isActive: true, deletedAt: true } },
          },
        },
      },
    });

    // The org switch is available only after the opaque token lookup, but is
    // checked before any token validity detail is exposed or tool work begins.
    // A suspended store (status INACTIVE) is closed to agents like it is to staff.
    if (row && (!row.grant.organization.agentAccessEnabled || row.grant.organization.status === 'INACTIVE')) {
      throw new AgentAuthorizationError('agent_access_disabled', 'Agent access is disabled for this store', 403);
    }
    if (row) await this._assertPlanAllows(row.grant.organizationId);

    const now = new Date();
    if (
      !row ||
      row.kind !== 'ACCESS' ||
      row.expiresAt <= now ||
      row.audience !== audience ||
      row.grant.revokedAt
    ) throw denied();

    const membership = row.grant.user.isActive && !row.grant.user.deletedAt
      ? await prisma.organizationMember.findUnique({
          where: {
            userId_organizationId: {
              userId: row.grant.userId,
              organizationId: row.grant.organizationId,
            },
          },
          select: { role: true },
        })
      : null;
    if (membership?.role !== 'ADMIN') {
      await prisma.oAuthGrant.updateMany({
        where: { id: row.grant.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'member_removed' },
      });
      throw denied();
    }

    const required = requiredScopes(scope);
    if (required.length === 0) {
      throw new AgentAuthorizationError('insufficient_scope', 'A required scope must be specified', 403);
    }
    const missing = required.filter((requiredScope) => !row.grant.scopes.includes(requiredScope));
    if (missing.length) {
      const error = new AgentAuthorizationError('insufficient_scope', 'The grant does not include the required scope', 403);
      error.requiredScopes = missing;
      throw error;
    }

    await this._takeLimit('AGENT_GRANT', row.grant.id, GRANT_LIMIT);
    await this._takeLimit('AGENT_ORG', row.grant.organizationId, ORG_LIMIT);
    await prisma.oAuthGrant.update({ where: { id: row.grant.id }, data: { lastUsedAt: now } });

    return {
      userId: row.grant.userId,
      organizationId: row.grant.organizationId,
      grantId: row.grant.id,
      clientName: row.grant.client.name,
      scopes: row.grant.scopes,
      expiresAt: row.expiresAt,
    };
  }
}

export default new AgentAuthService();
