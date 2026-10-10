// System administration validators (/admin/system)

import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeEmail } from '../../utils/normalizeEmail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ROLES = ['UNASSIGNED', 'ORGANIZER', 'ADMIN', 'SYSTEM_ADMIN'];

const wrap = (check) => (req, res, next) => {
  try {
    check(req);
    next();
  } catch (error) {
    next(error);
  }
};

/** Shared list query: q (≤100 chars), page (positive int). Writes req.listQuery. */
function listQuery(query) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length > 100) throw new ValidationError('q must be 100 characters or less');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1) throw new ValidationError('page must be a positive integer');
  return { q: q || undefined, page };
}

/** GET /admin/system/organizations?q&status&page */
export const validateOrganizationListQuery = wrap((req) => {
  const { status } = req.query;
  if (status !== undefined && !['ACTIVE', 'INACTIVE', 'PENDING'].includes(status)) {
    throw new ValidationError('status must be ACTIVE, INACTIVE or PENDING');
  }
  req.listQuery = { ...listQuery(req.query), status };
});

/** GET /admin/system/users?q&role&status&page */
export const validateUserListQuery = wrap((req) => {
  const { role, status } = req.query;
  if (role !== undefined && !USER_ROLES.includes(role)) {
    throw new ValidationError(`role must be one of: ${USER_ROLES.join(', ')}`);
  }
  if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) {
    throw new ValidationError('status must be ACTIVE or INACTIVE');
  }
  req.listQuery = { ...listQuery(req.query), role, isActive: status === undefined ? undefined : status === 'ACTIVE' };
});

/** PATCH /admin/system/organizations/:id/status */
export const validateOrganizationStatus = wrap((req) => {
  const { status } = req.body || {};
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new ValidationError('status must be ACTIVE or INACTIVE');
});

/** POST /admin/system/users/invite — normalizes email and trims name in place */
export const validateSystemAdminInvite = wrap((req) => {
  const { email, name } = req.body || {};
  const normalized = normalizeEmail(email);
  if (typeof email !== 'string' || !EMAIL_RE.test(normalized) || normalized.length > 254) {
    throw new ValidationError('Enter a valid email address');
  }
  if (name !== undefined && name !== null && (typeof name !== 'string' || name.trim().length > 255)) {
    throw new ValidationError('name must be a string of 255 characters or less');
  }
  req.body = { email: normalized, name: typeof name === 'string' && name.trim() ? name.trim() : undefined };
});

/** PATCH /admin/system/users/:id — only role and isActive, at least one */
export const validateSystemUserUpdate = wrap((req) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !['role', 'isActive'].includes(k))) {
    throw new ValidationError('Body may only contain role and isActive');
  }
  if (body.role !== undefined && !['SYSTEM_ADMIN', 'UNASSIGNED'].includes(body.role)) {
    throw new ValidationError('role must be SYSTEM_ADMIN or UNASSIGNED');
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    throw new ValidationError('isActive must be a boolean');
  }
});

/** PUT /admin/system/roles — { roles: { ADMIN?: {key: bool}, ORGANIZER?: {…} }, disabled: string[] }. Keys are checked by PermissionService. */
export const validateRolesUpdate = wrap((req) => {
  const { roles, disabled } = req.body ?? {};
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) throw new ValidationError('roles must be an object');
  for (const value of Object.values(roles)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('each role must map permissions to true or false');
  }
  if (!Array.isArray(disabled) || disabled.some((k) => typeof k !== 'string')) {
    throw new ValidationError('disabled must be a list of feature keys');
  }
  req.body = { roles, disabled };
});
