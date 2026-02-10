// User management routes
// GET /users (admin-only): list users with filters
// PATCH /users/:id (admin-only): update role, status, organization
// Per FR-056

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/rbac.js';
import { validateUpdateUser } from '../validators/userValidators.js';
import userService from '../../services/UserService.js';

const router = Router();

/**
 * GET /users
 * List all users with optional filters (admin only)
 * Query params: role, organizationId, page, limit
 */
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { role, organizationId, page, limit } = req.query;
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
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;
