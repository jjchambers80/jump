// Organization an admin request acts on. Shared by routes/admin.js and the
// Content routers (files, blog, menus) so every admin page follows the same
// rule: members get the org the switcher sent as X-Jump-Org when they belong
// to it, else their first membership; SYSTEM_ADMIN (no memberships) gets the
// switcher header, then an explicit ?organizationId= / body.organizationId.

import { resolveOrgScope, isUnscoped } from '../../middleware/orgScope.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

export async function activeOrgFor(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  const orgId = isUnscoped(scope)
    ? req.user.organizationId || req.query.organizationId || req.body?.organizationId
    : scope.organizationId;
  if (!orgId) throw new NotFoundError('No organization is assigned to this user');
  return orgId;
}
