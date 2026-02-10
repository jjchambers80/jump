// Venue routes
// CRUD endpoints for venue management scoped to organizations per FR-049, FR-010
// Routes: /organizations/:orgId/venues

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { validateCreateVenue, validateUpdateVenue } from '../validators/venueValidators.js';
import venueService from '../../services/VenueService.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router({ mergeParams: true }); // mergeParams to access :orgId

/**
 * POST /organizations/:orgId/venues
 * Create a venue within an organization (organizer/admin)
 */
router.post('/', requireAuth, requireOrganizer, validateCreateVenue, async (req, res, next) => {
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
router.get('/', requireAuth, requireOrganizer, async (req, res, next) => {
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
router.get('/:id', requireAuth, requireOrganizer, async (req, res, next) => {
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
router.patch('/:id', requireAuth, requireOrganizer, validateUpdateVenue, async (req, res, next) => {
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
router.delete('/:id', requireAuth, requireOrganizer, async (req, res, next) => {
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

export default router;
