// Organization scoping utilities for role-based data access
// SYSTEM_ADMIN sees all orgs; ADMIN/ORGANIZER scoped to their organizationId

import { prisma } from '@jump/db';

/**
 * Resolves organization scope for the current user.
 * SYSTEM_ADMIN: no filter (access to everything)
 * ADMIN/ORGANIZER: scoped to their organizationId
 *
 * @param {string} userId
 * @param {string} userRole
 * @returns {Promise<{ organizationId: string|null, venueFilter: object|undefined }>}
 */
export async function resolveOrgScope(userId, userRole) {
  if (userRole === 'SYSTEM_ADMIN') {
    return { organizationId: null, venueFilter: undefined };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });

  const orgId = user?.organizationId || null;
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
