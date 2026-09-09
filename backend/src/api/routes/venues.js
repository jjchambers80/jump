// Venue routes
// CRUD endpoints for venue management scoped to organizations per FR-049, FR-010
// Routes: /organizations/:orgId/venues

import { Router } from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { validateCreateVenue, validateUpdateVenue } from '../validators/venueValidators.js';
import venueService from '../../services/VenueService.js';
import { ForbiddenError, NotFoundError } from '../../middleware/errorHandler.js';
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService from '../../services/ImageService.js';

/**
 * Verifies the authenticated user belongs to the org in :orgId.
 * Must run after requireAuth.
 */
const verifyOrgOwnership = async (req, res, next) => {
  try {
    // SYSTEM_ADMIN can access any organization
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { organizationId: true },
    });
    if (!user?.organizationId || user.organizationId !== req.params.orgId) {
      throw new ForbiddenError('Access denied to this organization');
    }
    next();
  } catch (error) {
    next(error);
  }
};

const publicRouter = Router();
const orgRouter = Router({ mergeParams: true });

publicRouter.get('/:venueId', async (req, res, next) => {
  try {
    const result = await venueService.getPublicVenueById(req.params.venueId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/venues
 * Create a venue within an organization (organizer/admin)
 */
orgRouter.post('/', requireAuth, requireOrganizer, verifyOrgOwnership, validateCreateVenue, async (req, res, next) => {
  try {
    const venue = await venueService.createVenue(req.params.orgId, req.body);
    res.status(201).json(venue);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/venues
 * List venues for an organization (organizer/admin)
 */
orgRouter.get('/', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const venues = await venueService.listVenuesByOrganization(req.params.orgId);
    res.json(venues);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/venues/:id
 * Get venue details (organizer/admin)
 */
orgRouter.get('/:id', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueById(req.params.orgId, req.params.id);
    if (!venue) {
      throw new NotFoundError('Venue not found');
    }
    res.json(venue);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:orgId/venues/:id
 * Update venue details (organizer/admin)
 */
orgRouter.patch('/:id', requireAuth, requireOrganizer, verifyOrgOwnership, validateUpdateVenue, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueById(req.params.orgId, req.params.id);
    if (!venue) {
      throw new NotFoundError('Venue not found');
    }
    const updated = await venueService.updateVenue(req.params.orgId, req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:orgId/venues/:id
 * Delete a venue (organizer/admin, FR-010: blocked if events exist)
 */
orgRouter.post('/:id/logo', requireAuth, requireOrganizer, verifyOrgOwnership, uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const image = await imageService.processUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'venue_logo'
    );

    const logoUrl = image.urls.original;
    const { venue } = await venueService.setVenueLogo(
      req.params.orgId,
      req.params.id,
      logoUrl,
      image.id
    );
    res.json({ ...venue, image });
  } catch (error) {
    next(error);
  }
});

orgRouter.delete('/:id/logo', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { venue } = await venueService.setVenueLogo(
      req.params.orgId,
      req.params.id,
      null,
      null
    );
    res.json(venue);
  } catch (error) {
    next(error);
  }
});

orgRouter.delete('/:id', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueById(req.params.orgId, req.params.id);
    if (!venue) {
      throw new NotFoundError('Venue not found');
    }
    await venueService.deleteVenue(req.params.orgId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default publicRouter;
export { orgRouter as orgVenuesRouter };
