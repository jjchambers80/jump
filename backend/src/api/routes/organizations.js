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
import { NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService from '../../services/ImageService.js';
import { prisma } from '@jump/db';

const router = Router();

/**
 * Verifies the authenticated user belongs to the org in :id.
 * Must run after requireAuth.
 */
const verifyOrgOwnership = async (req, res, next) => {
  try {
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { organizationId: true },
    });
    if (!user?.organizationId || user.organizationId !== req.params.id) {
      throw new ForbiddenError('Access denied to this organization');
    }
    next();
  } catch (error) {
    next(error);
  }
};

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
  verifyOrgOwnership,
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
router.post('/:id/logo', requireAuth, requireAdmin, verifyOrgOwnership, uploadImage, async (req, res, next) => {
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
    const { organization, previousLogoImageId } = await organizationService.setOrganizationLogo(
      req.params.id,
      image.urls.original,
      image.id
    );
    if (previousLogoImageId && previousLogoImageId !== image.id) {
      await imageService.deleteImage(previousLogoImageId).catch(() => {});
    }
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/logo
 * Remove organization logo (admin only)
 */
router.delete('/:id/logo', requireAuth, requireAdmin, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { organization, previousLogoImageId } = await organizationService.setOrganizationLogo(
      req.params.id,
      null,
      null
    );
    if (previousLogoImageId) {
      await imageService.deleteImage(previousLogoImageId).catch(() => {});
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/cover
 * Upload organization cover image (admin only)
 */
router.post('/:id/cover', requireAuth, requireAdmin, verifyOrgOwnership, uploadImage, async (req, res, next) => {
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
    const { organization, previousCoverImageId } = await organizationService.setOrganizationCover(
      req.params.id,
      image.urls.original,
      image.id
    );
    if (previousCoverImageId && previousCoverImageId !== image.id) {
      await imageService.deleteImage(previousCoverImageId).catch(() => {});
    }
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/cover
 * Remove organization cover image (admin only)
 */
router.delete('/:id/cover', requireAuth, requireAdmin, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { organization, previousCoverImageId } = await organizationService.setOrganizationCover(
      req.params.id,
      null,
      null
    );
    if (previousCoverImageId) {
      await imageService.deleteImage(previousCoverImageId).catch(() => {});
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

export default router;
