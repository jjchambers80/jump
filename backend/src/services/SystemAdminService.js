// System administration (/admin/system): platform-wide, SYSTEM_ADMIN only.
//
// Nothing here is org-scoped and nothing reads X-Jump-Org. Every mutation is
// audited with SecurityEventService: user events on the target user with
// meta.actorId, organization events on the actor with meta.organizationId.

import { prisma } from '@jump/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import userService from './UserService.js';
import organizationService from './OrganizationService.js';
import onboardingService from './OnboardingService.js';
import memberService from './MemberService.js';
import domainService from './DomainService.js';
import sessionService from './SessionService.js';
import securityEventService from './SecurityEventService.js';
import emailService from './EmailService.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const membershipInclude = {
  memberships: {
    orderBy: { createdAt: 'asc' },
    select: { role: true, organization: { select: { id: true, name: true } } },
  },
};

function coded(error, code) {
  error.code = code;
  return error;
}

class SystemAdminService {
  async overview() {
    const [orgByStatus, pendingOrgs, users, activeUsers, systemAdmins, funnel, recent] = await Promise.all([
      prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.organization.count({ where: { onboardingCompletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      prisma.user.count({ where: { deletedAt: null, isActive: true, role: 'SYSTEM_ADMIN' } }),
      onboardingService.funnel(),
      prisma.platformCustomer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          createdAt: true,
          plan: true,
          organization: { select: { id: true, name: true, slug: true, status: true, onboardingCompletedAt: true } },
          owner: { select: { id: true, email: true, name: true } },
        },
      }),
    ]);
    const byStatus = Object.fromEntries(orgByStatus.map((r) => [r.status, r._count._all]));
    return {
      organizations: {
        total: orgByStatus.reduce((sum, r) => sum + r._count._all, 0),
        active: byStatus.ACTIVE ?? 0,
        inactive: byStatus.INACTIVE ?? 0,
        pending: pendingOrgs,
      },
      users: { total: users, active: activeUsers, inactive: users - activeUsers, systemAdmins },
      onboarding: funnel,
      recentSignups: recent.map((c) => ({ ...c.organization, plan: c.plan, signedUpAt: c.createdAt, owner: c.owner })),
    };
  }

  async getOrganization(id) {
    const organization = await organizationService.getSystemOrganization(id);
    if (!organization) throw new NotFoundError('Organization not found');
    return { organization, members: await memberService.list(id) };
  }

  /** Persist Organization.status. Enforcement of INACTIVE lives in the request paths. */
  async setOrganizationStatus(actor, id, status, req) {
    const existing = await prisma.organization.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new NotFoundError('Organization not found');
    if (existing.status !== status) {
      await prisma.organization.update({ where: { id }, data: { status } });
      domainService.clearCache();
      await securityEventService.record(actor.id, status === 'INACTIVE' ? 'ORG_SUSPENDED' : 'ORG_REACTIVATED', {
        req,
        meta: { organizationId: id },
      });
      logger.info('Organization status changed', { event: 'organization_status_changed', organizationId: id, status, actorId: actor.id });
    }
    return organizationService.getSystemOrganization(id);
  }

  /**
   * Invite a system admin by email. A new address gets a User; an existing
   * non-system user is promoted (promotion drops org memberships, as
   * UserService.updateUser does for every non-staff role).
   * @returns {{ user: object, promoted: boolean, emailSent: boolean }}
   */
  async invite(actor, { email, name }, req) {
    const { user, promoted } = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true, role: true, deletedAt: true } });
      if (existing?.deletedAt) throw coded(new ConflictError(`${email} belongs to a deleted account`), 'USER_DELETED');
      if (existing?.role === 'SYSTEM_ADMIN') throw coded(new ConflictError(`${email} is already a system admin`), 'ALREADY_SYSTEM_ADMIN');
      if (existing) {
        return { user: await userService.updateUser(existing.id, { role: 'SYSTEM_ADMIN' }, { tx }), promoted: true };
      }
      const created = await tx.user.create({
        data: { email, role: 'SYSTEM_ADMIN', ...(name ? { name } : {}) },
        include: membershipInclude,
      });
      return { user: userService._formatUser(created), promoted: false };
    });

    await securityEventService.record(user.id, 'SYSTEM_ADMIN_INVITED', { req, meta: { actorId: actor.id, promoted } });
    if (promoted) await securityEventService.record(user.id, 'SYSTEM_ROLE_GRANTED', { req, meta: { actorId: actor.id } });

    let emailSent = true;
    try {
      const inviter = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
      const query = new URLSearchParams({ callbackUrl: '/admin/system', email });
      await emailService.sendSystemAdminInvite({
        to: email,
        inviterName: inviter?.name || inviter?.email || actor.email || 'A system admin',
        signInUrl: `${platformBaseUrl()}/auth/signin?${query}`,
      });
    } catch (error) {
      // The role is granted either way; the UI shows that the email failed.
      logger.error('System admin invite email failed', { event: 'system_admin_invite_failed', error: error.message });
      emailSent = false;
    }
    return { user, promoted, emailSent };
  }

  /**
   * Grant / revoke SYSTEM_ADMIN and (de)activate any user. The last active
   * system admin can never be removed: the count runs under a global advisory
   * lock so two concurrent demotions cannot both pass.
   */
  async updateUser(actor, userId, { role, isActive }, req) {
    if (userId === actor.id) {
      throw coded(new ForbiddenError('You cannot change your own role or status'), 'CANNOT_CHANGE_SELF');
    }
    const { before, user } = await prisma.$transaction(async (tx) => {
      // ponytail: one platform-wide lock; system admin changes are rare
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('system-admins'))`;
      const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, deletedAt: true } });
      if (!target || target.deletedAt) throw new NotFoundError('User not found');
      if (role === 'UNASSIGNED' && target.role !== 'SYSTEM_ADMIN') {
        // Would silently wipe an organizer's memberships: that belongs to Settings › Users.
        throw coded(new ValidationError('Only a system admin can be set to UNASSIGNED here'), 'NOT_SYSTEM_ADMIN');
      }
      const losesAdmin =
        target.role === 'SYSTEM_ADMIN' && target.isActive && (role === 'UNASSIGNED' || isActive === false);
      if (losesAdmin && (await this._otherActiveSystemAdmins(tx, userId)) === 0) {
        throw coded(new ConflictError('There must always be at least one active system admin'), 'LAST_SYSTEM_ADMIN');
      }
      const data = {};
      if (role !== undefined) data.role = role;
      if (isActive !== undefined) data.isActive = isActive;
      return { before: target, user: await userService.updateUser(userId, data, { tx }) };
    });

    const meta = { actorId: actor.id };
    if (role !== undefined && role !== before.role) {
      await securityEventService.record(userId, role === 'SYSTEM_ADMIN' ? 'SYSTEM_ROLE_GRANTED' : 'SYSTEM_ROLE_REVOKED', { req, meta });
    }
    if (isActive !== undefined && isActive !== before.isActive) {
      await securityEventService.record(userId, isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', { req, meta });
    }
    // A deactivated or demoted user keeps a valid JWT until the next claims
    // refresh; revoking the sessions closes that window at once.
    const demoted = before.role === 'SYSTEM_ADMIN' && role === 'UNASSIGNED';
    if ((isActive === false && before.isActive) || demoted) {
      await sessionService.revokeAll(userId, isActive === false ? 'deactivated' : 'role-change');
    }
    return user;
  }

  async _otherActiveSystemAdmins(tx, excludeUserId) {
    return tx.user.count({
      where: { role: 'SYSTEM_ADMIN', isActive: true, deletedAt: null, NOT: { id: excludeUserId } },
    });
  }
}

export default new SystemAdminService();
