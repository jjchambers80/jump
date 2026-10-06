// Org-level agent access management (spec 045C). ADMIN controls the store
// switch, lists and revokes grants, and views the audit trail. Platform-level
// methods (system-wide switch, stats, global revocation) live here too.
//
// Every route using this service must guard with requireOrgMembership or
// requireSystemAdmin; the service methods trust the caller.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';

class AgentAccessService {
  // ── Org-level settings ──

  async getSettings(organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { agentAccessEnabled: true },
    });
    return { agentAccessEnabled: !!org?.agentAccessEnabled };
  }

  async toggleSettings(organizationId, enabled, userId) {
    const data = await prisma.organization.update({
      where: { id: organizationId },
      data: { agentAccessEnabled: enabled },
      select: { agentAccessEnabled: true },
    });
    logger.warn('Agent access setting changed', {
      event: 'agent_access_toggled',
      organizationId,
      enabled,
      userId,
    });
    return { agentAccessEnabled: data.agentAccessEnabled };
  }

  // ── Grant listing ──

  async listGrants(organizationId) {
    const rows = await prisma.oAuthGrant.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        client: { select: { name: true, clientId: true, kind: true } },
      },
    });
    return rows.map((g) => ({
      id: g.id,
      userId: g.userId,
      member: { name: g.user.name ?? g.user.email, email: g.user.email },
      client: { name: g.client.name, clientId: g.client.clientId, kind: g.client.kind },
      scopes: g.scopes,
      createdAt: g.createdAt.toISOString(),
      lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
      revokedAt: g.revokedAt?.toISOString() ?? null,
      revokedReason: g.revokedReason,
    }));
  }

  /** Admin: list grants visible to the calling user (own grants across orgs). */
  async listMyGrants(userId) {
    const rows = await prisma.oAuthGrant.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        client: { select: { name: true, clientId: true, kind: true } },
      },
    });
    return rows.map((g) => ({
      id: g.id,
      organizationId: g.organizationId,
      organizationName: g.organization.name,
      client: { name: g.client.name, clientId: g.client.clientId, kind: g.client.kind },
      scopes: g.scopes,
      createdAt: g.createdAt.toISOString(),
      lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
      revokedAt: g.revokedAt?.toISOString() ?? null,
    }));
  }

  // ── Revocation ──

  async revokeGrant(organizationId, grantId, reason = 'org_admin') {
    const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.organizationId !== organizationId) {
      return null;
    }
    if (grant.revokedAt) return { id: grantId, revokedAt: grant.revokedAt.toISOString() };
    const now = new Date();
    await prisma.oAuthGrant.update({
      where: { id: grantId },
      data: { revokedAt: now, revokedReason: reason },
    });
    return { id: grantId, revokedAt: now.toISOString() };
  }

  async revokeAllGrants(organizationId, reason = 'org_admin') {
    const now = new Date();
    const { count } = await prisma.oAuthGrant.updateMany({
      where: { organizationId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return { count };
  }

  /** Connected apps (my grants): the user revokes their own grant by id. */
  async revokeMyGrant(userId, grantId) {
    const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.userId !== userId) return null;
    if (grant.revokedAt) return { id: grantId, revokedAt: grant.revokedAt.toISOString() };
    const now = new Date();
    await prisma.oAuthGrant.update({
      where: { id: grantId },
      data: { revokedAt: now, revokedReason: 'user' },
    });
    return { id: grantId, revokedAt: now.toISOString() };
  }

  // ── Audit log ──

  async listAuditLog(organizationId, { grantId, tool, offset = 0, limit = 50 } = {}) {
    const where = { organizationId };
    if (grantId) where.grantId = grantId;
    if (tool) where.tool = tool;

    const [total, rows] = await Promise.all([
      prisma.agentAuditLog.count({ where }),
      prisma.agentAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    return {
      total,
      offset,
      limit,
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        user: { name: r.user.name ?? r.user.email, email: r.user.email },
        grantId: r.grantId,
        clientName: r.clientName,
        tool: r.tool,
        summary: r.summary,
        outcome: r.outcome,
        targetType: r.targetType,
        targetId: r.targetId,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ── Platform-level ──

  async getPlatformSetting() {
    const setting = await prisma.platformSetting.findUnique({
      where: { key: 'agentAccessEnabled' },
    });
    return { agentAccessEnabled: setting?.value === true || setting?.value?.enabled === true };
  }

  async setPlatformSetting(enabled, userId) {
    const value = { enabled };
    await prisma.platformSetting.upsert({
      where: { key: 'agentAccessEnabled' },
      create: { key: 'agentAccessEnabled', value, updatedBy: userId },
      update: { value, updatedBy: userId },
    });
    logger.warn('Platform agent access setting changed', {
      event: 'platform_agent_access_toggled',
      enabled,
      userId,
    });
    return { agentAccessEnabled: enabled };
  }

  async platformStats() {
    const [grantCount, callCount, currentTokens] = await Promise.all([
      prisma.oAuthGrant.count({ where: { revokedAt: null } }),
      prisma.agentAuditLog.count(),
      prisma.oAuthToken.count({ where: { kind: 'ACCESS' } }),
    ]);
    return { grantCount, callCount, currentTokens };
  }

  async revokeAllGrantsPlatform(adminUserId, reason = 'system_admin') {
    const now = new Date();
    const { count } = await prisma.oAuthGrant.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    logger.warn('All agent grants revoked by system admin', {
      event: 'platform_all_grants_revoked',
      count,
      adminUserId,
    });
    return { count };
  }
}

export default new AgentAccessService();