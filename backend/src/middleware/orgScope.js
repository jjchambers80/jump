// Organization scoping utilities for role-based data access
// SYSTEM_ADMIN sees all orgs; ADMIN/ORGANIZER scoped via OrganizationMember
//
// Spec 007 phase 1: org affiliation lives in OrganizationMember, not
// User.organizationId. One user may belong to several organizations; until an
// org switcher exists the active org is the earliest membership.

import { prisma } from '@jump/db';
import { ForbiddenError } from './errorHandler.js';

/** 403 for staff of a suspended organization (status INACTIVE). */
export class OrganizationSuspendedError extends ForbiddenError {
  constructor() {
    super('This organization is suspended. Contact Eventimus support to restore access.');
    this.code = 'ORGANIZATION_SUSPENDED';
  }
}

/**
 * Lists the ACTIVE organizations a user belongs to, oldest membership first.
 * Memberships of suspended organizations grant nothing.
 *
 * @param {string} userId
 * @returns {Promise<Array<{ organizationId: string, role: 'ADMIN'|'ORGANIZER' }>>}
 */
export async function getMemberships(userId) {
  return prisma.organizationMember.findMany({
    where: { userId, organization: { status: 'ACTIVE' } },
    select: { organizationId: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** True when the user belongs to a suspended organization (`organizationId`, or any). */
async function hasSuspendedMembership(userId, organizationId) {
  const count = await prisma.organizationMember.count({
    where: { userId, ...(organizationId && { organizationId }), organization: { status: 'INACTIVE' } },
  });
  return count > 0;
}

/**
 * Resolves the user's active organization: the requested one if they are a
 * member of it, otherwise their first membership. Throws
 * OrganizationSuspendedError when the requested organization is suspended,
 * or when every organization the user belongs to is.
 *
 * @param {string} userId
 * @param {string} [preferredOrgId]
 * @returns {Promise<{ organizationId: string, role: string } | null>}
 */
export async function resolveActiveMembership(userId, preferredOrgId) {
  const memberships = await getMemberships(userId);
  if (preferredOrgId) {
    const match = memberships.find((m) => m.organizationId === preferredOrgId);
    if (match) return match;
    if (await hasSuspendedMembership(userId, preferredOrgId)) throw new OrganizationSuspendedError();
  }
  if (memberships.length === 0) {
    if (await hasSuspendedMembership(userId)) throw new OrganizationSuspendedError();
    return null;
  }
  return memberships[0];
}

/**
 * Resolves organization scope for the current user.
 * SYSTEM_ADMIN: the organization chosen in the admin switcher (X-Jump-Org)
 *   when one was sent, else no filter (access to everything). Every main-nav
 *   page shows one organization's data at a time; only the Organizations
 *   page is cross-org.
 * ADMIN/ORGANIZER: scoped to their active organization
 *
 * @param {string} userId
 * @param {string} userRole
 * @param {string} [preferredOrgId] - Org the caller wants active (must be a membership)
 * @returns {Promise<{ organizationId: string|null, venueFilter: object|undefined }>}
 */
export async function resolveOrgScope(userId, userRole, preferredOrgId) {
  if (userRole === 'SYSTEM_ADMIN') {
    if (preferredOrgId) {
      return { organizationId: preferredOrgId, venueFilter: { venue: { organizationId: preferredOrgId } } };
    }
    return { organizationId: null, venueFilter: undefined };
  }

  const membership = await resolveActiveMembership(userId, preferredOrgId);
  const orgId = membership?.organizationId || null;
  const venueFilter = orgId ? { venue: { organizationId: orgId } } : null;

  return { organizationId: orgId, venueFilter };
}

/**
 * Returns true if the scope is unrestricted (SYSTEM_ADMIN).
 */
export function isUnscoped(scope) {
  return scope.organizationId === null && scope.venueFilter === undefined;
}

/**
 * Returns true if role is ADMIN or SYSTEM_ADMIN.
 */
export function isAdminRole(role) {
  return role === 'ADMIN' || role === 'SYSTEM_ADMIN';
}

/**
 * Express middleware factory: requires the authenticated user to be a member
 * of the organization named by a route param. SYSTEM_ADMIN always passes.
 * Must run after requireAuth. Attaches req.membership on success.
 *
 * @param {string} [param='orgId'] - Route param holding the organization id
 */
export const requireOrgMembership = (param = 'orgId') => async (req, res, next) => {
  try {
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    const orgId = req.params[param];
    const membership = orgId
      ? await prisma.organizationMember.findUnique({
          where: { userId_organizationId: { userId: req.user.id, organizationId: orgId } },
          select: { organizationId: true, role: true, organization: { select: { status: true } } },
        })
      : null;

    if (!membership) {
      throw new ForbiddenError('Access denied to this organization');
    }
    if (membership.organization.status !== 'ACTIVE') throw new OrganizationSuspendedError();
    req.membership = { organizationId: membership.organizationId, role: membership.role };
    next();
  } catch (error) {
    next(error);
  }
};
