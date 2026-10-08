// Settings › Users validators (add users, edit a member)

import { ValidationError } from '../../middleware/errorHandler.js';

const MEMBER_ROLES = ['ADMIN', 'ORGANIZER'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wrap = (check) => (req, res, next) => {
  try {
    check(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

/** POST /admin/settings/users */
export const validateInviteMembers = wrap((body) => {
  const { emails, role, requireTwoStep } = body || {};
  if (!Array.isArray(emails) || emails.length === 0 || emails.length > 20) {
    throw new ValidationError('Enter between 1 and 20 email addresses');
  }
  const bad = emails.filter((e) => typeof e !== 'string' || !EMAIL_RE.test(e.trim()) || e.length > 254);
  if (bad.length) throw new ValidationError(`Invalid email address: ${bad.slice(0, 3).join(', ')}`);
  if (!MEMBER_ROLES.includes(role)) throw new ValidationError('Role must be ADMIN or ORGANIZER');
  if (requireTwoStep !== undefined && typeof requireTwoStep !== 'boolean') {
    throw new ValidationError('requireTwoStep must be a boolean');
  }
});

/** PATCH /admin/settings/users/:userId — only the keys present are checked */
export const validateUpdateMember = wrap((body) => {
  const allowed = ['role', 'requireTwoStep', 'isActive'];
  const keys = Object.keys(body || {});
  if (keys.length === 0 || keys.some((k) => !allowed.includes(k))) {
    throw new ValidationError(`Body may only contain ${allowed.join(', ')}`);
  }
  if (body.role !== undefined && !MEMBER_ROLES.includes(body.role)) {
    throw new ValidationError('Role must be ADMIN or ORGANIZER');
  }
  for (const k of ['requireTwoStep', 'isActive']) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') throw new ValidationError(`${k} must be a boolean`);
  }
});
