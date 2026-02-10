// Organization routes
// CRUD endpoints for organization management per FR-048
// All routes require ADMIN role

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/rbac.js';
import {
  validateCreateOrganization,
  validateUpdateOrganization,
} from '../validators/organizationValidators.js';
import organizationService from '../../services/OrganizationService.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router();

/**
 * POST /organizations
 * Create a new organization (admin only)
 */
router.post('/', requireAuth, requireAdmin, validateCreateOrganization, async (req, res, next) => {
  try {
    const organization = await organizationService.createOrganization(req.body);
    res.status(201).json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations
 * List all organizations (admin only)
 */
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const organizations = await organizationService.listOrganizations();
    res.json(organizations);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:id
 * Get organization details (admin only)
 */
router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const organization = await organizationService.getOrganizationById(req.params.id);
    if (!organization) {
      throw new NotFoundError('Organization not found');
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:id
 * Update organization details (admin only)
 */
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validateUpdateOrganization,
  async (req, res, next) => {
    try {
      const organization = await organizationService.getOrganizationById(req.params.id);
      if (!organization) {
        throw new NotFoundError('Organization not found');
      }
      const updated = await organizationService.updateOrganization(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
