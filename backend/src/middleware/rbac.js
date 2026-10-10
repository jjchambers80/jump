// Role-based access control middleware
//
// Two kinds of check:
// - requireRole / requireSystemAdmin: the account-wide User.role from the JWT.
// - requireAdmin / requireOrganizer: the OrganizationMember.role in the
//   organization the request acts on. User.role is ADMIN when *any* membership
//   is ADMIN (MemberService._syncGlobalRole), so the account-wide role must
//   never decide what someone may do inside one organization.
// SYSTEM_ADMIN has no memberships and passes every org check.

import { ForbiddenError, AuthenticationError } from './errorHandler.js';
import { resolveActiveMembership } from './orgScope.js';

/**
 * Factory middleware: requires the account-wide role to be one of `roles`.
 * Must be used AFTER requireAuth middleware.
 *
 * @param {...string} roles - Allowed roles (e.g., 'SYSTEM_ADMIN')
 * @returns {Function} Express middleware
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      if (!roles.includes(req.user.role)) {
        throw new ForbiddenError(`Access denied. Required role: ${roles.join(' or ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * The caller's role in the organization this request acts on: the route's
 * `:orgId` when it has one (exact membership only), else the active
 * organization (X-Jump-Org when they belong to it, else their first
 * membership — the same org activeOrgFor(req) resolves). 'SYSTEM_ADMIN' for
 * system admins, null when they are not a member. Memoised per request.
 *
 * @param {import('express').Request} req
 * @param {string} [param='orgId'] - Route param naming the organization, when the route has one
 * @returns {Promise<'ADMIN'|'ORGANIZER'|'SYSTEM_ADMIN'|null>}
 */
export async function orgRoleFor(req, param = 'orgId') {
  if (req.user.role === 'SYSTEM_ADMIN') return 'SYSTEM_ADMIN';
  const routeOrgId = req.params?.[param];
  const key = routeOrgId ?? '';
  req.orgRoles ??= {};
  if (!(key in req.orgRoles)) {
    req.orgRoles[key] = resolveActiveMembership(req.user.id, routeOrgId ?? req.user.organizationId).then((m) =>
      !m || (routeOrgId && m.organizationId !== routeOrgId) ? null : m.role
    );
  }
  return req.orgRoles[key];
}

/** True when the caller is an ADMIN of the organization the request acts on (or SYSTEM_ADMIN). */
export async function isOrgAdmin(req) {
  const role = await orgRoleFor(req);
  return role === 'ADMIN' || role === 'SYSTEM_ADMIN';
}

const requireOrgRole = (roles, param) => async (req, res, next) => {
  try {
    if (!req.user) throw new AuthenticationError('Authentication required');
    const role = await orgRoleFor(req, param);
    if (role !== 'SYSTEM_ADMIN' && !roles.includes(role)) {
      throw new ForbiddenError(`Access denied. Required role in this organization: ${roles.join(' or ')}`);
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** ADMIN of the organization the request acts on, or SYSTEM_ADMIN */
export const requireAdmin = requireOrgRole(['ADMIN']);

/** ADMIN of the organization named by route param `param` (e.g. organizations/:id), or SYSTEM_ADMIN */
export const requireAdminOf = (param) => requireOrgRole(['ADMIN'], param);

/** Any staff member (ORGANIZER or ADMIN) of the organization the request acts on, or SYSTEM_ADMIN */
export const requireOrganizer = requireOrgRole(['ORGANIZER', 'ADMIN']);

/** Convenience: requires SYSTEM_ADMIN role */
export const requireSystemAdmin = requireRole('SYSTEM_ADMIN');

/** Convenience: alias for requireAuth (any authenticated user) */
export { requireAuth } from './auth.js';
