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
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService from '../../services/ImageService.js';

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

/**
 * GET /organizations/:id/public
 * Get public organization info with published events (no auth)
 */
router.get('/:id/public', async (req, res, next) => {
  try {
    const result = await organizationService.getPublicOrganization(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/logo
 * Upload organization logo (admin only)
 */
router.post('/:id/logo', requireAuth, requireAdmin, uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const image = await imageService.processUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'org_logo'
    );
    const { organization } = await organizationService.setOrganizationLogo(
      req.params.id,
      image.urls.original,
      image.id
    );
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/logo
 * Remove organization logo (admin only)
 */
router.delete('/:id/logo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { organization } = await organizationService.setOrganizationLogo(
      req.params.id,
      null,
      null
    );
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/cover
 * Upload organization cover image (admin only)
 */
router.post('/:id/cover', requireAuth, requireAdmin, uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const image = await imageService.processUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'org_cover'
    );
    const { organization } = await organizationService.setOrganizationCover(
      req.params.id,
      image.urls.original,
      image.id
    );
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/cover
 * Remove organization cover image (admin only)
 */
router.delete('/:id/cover', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { organization } = await organizationService.setOrganizationCover(
      req.params.id,
      null,
      null
    );
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

export default router;
