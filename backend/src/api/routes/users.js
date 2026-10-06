// User management routes
// GET /users (admin-only): list users with filters
// PATCH /users/:id (admin-only): update role, status, organization
// Per FR-056

import { Router } from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/rbac.js';
import { ForbiddenError } from '../../middleware/errorHandler.js';
import { validateUpdateUser } from '../validators/userValidators.js';
import userService from '../../services/UserService.js';
import { activeOrgFor } from './adminScope.js';

const router = Router();

/**
 * GET /users
 * List all users with optional filters (admin only)
 * Query params: role, organizationId, page, limit
 */
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { role, page, limit } = req.query;
    // Org ADMINs see only their active organization's members; only
    // SYSTEM_ADMIN lists across organizations.
    const organizationId =
      req.user.role === 'SYSTEM_ADMIN' ? req.query.organizationId : await activeOrgFor(req);
    const result = await userService.listUsers({
      role,
      organizationId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /users/:id
 * Update user role or status (admin only)
 */
router.patch('/:id', requireAuth, requireAdmin, validateUpdateUser, async (req, res, next) => {
  try {
    // Only SYSTEM_ADMIN can assign SYSTEM_ADMIN role
    if (req.body.role === 'SYSTEM_ADMIN' && req.user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenError('Only SYSTEM_ADMIN can assign SYSTEM_ADMIN role');
    }
    if (req.user.role !== 'SYSTEM_ADMIN') {
      // Role and active status are account-wide, so an org ADMIN may change
      // only users who belong to their active organization and no other.
      // Reassigning organizations is SYSTEM_ADMIN only.
      if (req.body.organizationId !== undefined) {
        throw new ForbiddenError('Only SYSTEM_ADMIN can change organization membership');
      }
      const orgId = await activeOrgFor(req);
      const memberships = await prisma.organizationMember.findMany({
        where: { userId: req.params.id },
        select: { organizationId: true },
      });
      if (!memberships.length || memberships.some((m) => m.organizationId !== orgId)) {
        throw new ForbiddenError('Access denied to this user');
      }
    }
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;
