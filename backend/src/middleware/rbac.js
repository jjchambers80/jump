// Role-based access control middleware
//
// Two kinds of check:
// - requireRole / requireSystemAdmin: the account-wide User.role from the JWT.
// - requireOrganizer: any OrganizationMember.role in the organization the
//   request acts on. User.role is ADMIN when *any* membership
//   is ADMIN (MemberService._syncGlobalRole), so the account-wide role must
//   never decide what someone may do inside one organization.
// SYSTEM_ADMIN has no memberships and passes every org check.
// - requireFeature / requirePermission: the same org role, then the catalog
//   (backend/src/permissions/catalog.js) as configured in System › Roles.

import { ForbiddenError, AuthenticationError, NotFoundError } from './errorHandler.js';
import { resolveActiveMembership } from './orgScope.js';
import { FEATURE_KEYS, ACTION_KEYS } from '../permissions/catalog.js';
import permissionService from '../services/PermissionService.js';

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

/**
 * True when the caller may use `key` (a catalog feature or action) in the
 * organization the request acts on. Use for handler-level checks (`canEdit`).
 */
export async function can(req, key, param) {
  const { granted } = await permissionService.effective(await orgRoleFor(req, param));
  return granted.has(key);
}

const guard = (key, { param, kind }) => {
  const known = kind === 'feature' ? FEATURE_KEYS : ACTION_KEYS;
  if (!known.has(key)) throw new Error(`Unknown permission ${kind} "${key}" — add it to permissions/catalog.js`);
  return async (req, res, next) => {
    try {
      if (!req.user) throw new AuthenticationError('Authentication required');
      const role = await orgRoleFor(req, param);
      if (!role) throw new ForbiddenError('Access denied. You are not a member of this organization');
      const { granted, disabled } = await permissionService.effective(role);
      if (disabled.has(key)) throw new NotFoundError('This feature is turned off');
      if (!granted.has(key)) throw new ForbiddenError('Your role does not have access to this');
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * A catalog feature (customers, maps, …) visible to the caller's role in the
 * organization the request acts on. 403 when hidden for the role, 404 when
 * turned off platform-wide. Implies requireOrganizer.
 */
export const requireFeature = (key, { param } = {}) => guard(key, { param, kind: 'feature' });

/**
 * A catalog action (orders.refund, settings.tax, …) granted to the caller's
 * role in the organization the request acts on. Implies requireOrganizer.
 */
export const requirePermission = (key, { param } = {}) => guard(key, { param, kind: 'action' });

/** Any staff member (ORGANIZER or ADMIN) of the organization the request acts on, or SYSTEM_ADMIN */
export const requireOrganizer = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthenticationError('Authentication required');
    if (!(await orgRoleFor(req))) throw new ForbiddenError('Access denied. You are not a member of this organization');
    next();
  } catch (error) {
    next(error);
  }
};

/** Convenience: requires SYSTEM_ADMIN role */
export const requireSystemAdmin = requireRole('SYSTEM_ADMIN');

/** Convenience: alias for requireAuth (any authenticated user) */
export { requireAuth } from './auth.js';
