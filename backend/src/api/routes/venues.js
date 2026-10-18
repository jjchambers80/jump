// Venue routes
// CRUD endpoints for venue management scoped to organizations per FR-049, FR-010
// Routes: /organizations/:orgId/venues

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { can, requireFeature, requireOrganizer } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';
import { validateCreateVenue, validateUpdateVenue } from '../validators/venueValidators.js';
import venueService from '../../services/VenueService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService from '../../services/ImageService.js';
import { isValidTimeZone } from '../../utils/locales.js';
import { gateByVenueParam } from '../../middleware/storefrontGate.js';

const verifyOrgOwnership = requireOrgMembership('orgId');

const publicRouter = Router();
const orgRouter = Router({ mergeParams: true });

publicRouter.get('/:venueId/meta', async (req, res, next) => {
  try {
    res.json(await venueService.getPublicRoute(req.params.venueId));
  } catch (error) {
    next(error);
  }
});

publicRouter.get('/:venueId', gateByVenueParam, async (req, res, next) => {
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
orgRouter.post('/', requireAuth, requireFeature('venues'), verifyOrgOwnership, validateCreateVenue, async (req, res, next) => {
  try {
    const venue = await venueService.createVenue(req.params.orgId, req.body);
    res.status(201).json(venue);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/venues/from-address
 * The event wizard's location when Venues is off or hidden for the role: the
 * organization's venue at this address, else a new private one (no public
 * venue page). Events keep a venue either way, because time zone, tax region
 * and tenancy all come from it. Not feature-gated on purpose.
 */
orgRouter.post('/from-address', requireAuth, requireOrganizer, verifyOrgOwnership, validateCreateVenue, async (req, res, next) => {
  try {
    // The state or ZIP is what sets the time zone; without either it would
    // silently fall back to Eastern.
    if (!req.body.state && !req.body.postalCode) throw new ValidationError('Enter the state or ZIP code: it sets the time zone');
    res.json(await venueService.venueForAddress(req.params.orgId, req.body));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /organizations/:orgId/venues/:id/time-zone
 * The event wizard's "When is it?" check: confirm or correct a venue's zone
 * when it was guessed (DEFAULT, or derived near a zone line). The zone becomes
 * MANUAL. Venues on: any venue. Venues off: only the private venues the
 * wizard's address step creates, since a public venue belongs to Venues.
 */
orgRouter.put('/:id/time-zone', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { timezone } = req.body ?? {};
    if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) throw new ValidationError('Choose a valid time zone');
    const venue = await venueService.getVenueById(req.params.orgId, req.params.id);
    if (!venue) throw new NotFoundError('Venue not found');
    if (venue.isPublic && !(await can(req, 'venues'))) throw new ForbiddenError('Your role does not have access to this');
    res.json(await venueService.updateVenue(req.params.orgId, req.params.id, { timezone }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/venues
 * List venues for an organization (organizer/admin). Not feature-gated: the
 * event wizard reads it for the event's location and time zone.
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
 * Get venue details with the events held there (organizer/admin)
 */
orgRouter.get('/:id', requireAuth, requireFeature('venues'), verifyOrgOwnership, async (req, res, next) => {
  try {
    const venue = await venueService.getVenueDetails(req.params.orgId, req.params.id);
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
orgRouter.patch('/:id', requireAuth, requireFeature('venues'), verifyOrgOwnership, validateUpdateVenue, async (req, res, next) => {
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
orgRouter.post('/:id/logo', requireAuth, requireFeature('venues'), verifyOrgOwnership, uploadImage, async (req, res, next) => {
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

orgRouter.delete('/:id/logo', requireAuth, requireFeature('venues'), verifyOrgOwnership, async (req, res, next) => {
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

orgRouter.delete('/:id', requireAuth, requireFeature('venues'), verifyOrgOwnership, async (req, res, next) => {
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
