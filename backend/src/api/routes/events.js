// Event Routes (Schema Redesign)
// Public: GET /events, GET /events/:eventId
// Org-scoped: GET/POST /organizations/:orgId/events,
//             PATCH .../events/:eventId,
//             POST .../events/:eventId/publish, GET .../events/:eventId/readiness,
//             POST .../events/:eventId/duplicate,
//             POST .../events/:eventId/cancel
// Per FR-050, contracts/api.yaml

import express from 'express';
import { prisma } from '@jump/db';
import eventService from '../../services/EventService.js';
import eventReadinessService from '../../services/EventReadinessService.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer, requireFeature } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService from '../../services/ImageService.js';
import { validateCreateEvent, validateUpdateEvent } from '../validators/eventValidators.js';
import { gateByEventParam } from '../../middleware/storefrontGate.js';
import mapService from '../../services/MapService.js';
import eventPreviewService from '../../services/EventPreviewService.js';
import applicationFormService from '../../services/ApplicationFormService.js';
import { findByPublicIdentifier } from '../../utils/publicIdentifier.js';
import { publicOrganizationIdentity } from './organizations.js';

// ── Public routes (mounted at /events) ──
const publicRouter = express.Router();

/**
 * Staff draft preview (spec 050 F): req.eventPreview is true only when
 * X-Event-Preview verifies for this very event and its organization. The
 * cookie behind it is never trusted anywhere else.
 */
async function resolveEventPreview(req, res, next) {
  const token = req.get('X-Event-Preview');
  if (!token) return next();
  try {
    const event = await findByPublicIdentifier(prisma.event, req.params.eventId, {
      select: { id: true, venue: { select: { organizationId: true } } },
    });
    req.eventPreview = Boolean(event && eventPreviewService.verify(token, event.venue.organizationId, event.id));
    if (req.eventPreview) res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
    next();
  } catch (error) {
    next(error);
  }
}

// A verified staff preview passes a private store's password, as staff theme previews do.
const gateUnlessPreview = (req, res, next) => (req.eventPreview ? next() : gateByEventParam(req, res, next));

/**
 * GET /events
 * List published events (public, no auth required)
 */
publicRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, category, dateFrom, dateTo } = req.query;
    const result = await eventService.listPublishedEvents({
      page,
      limit,
      category,
      dateFrom,
      dateTo,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Canonical route lookup used by the frontend's permanent legacy redirect. */
publicRouter.get('/:eventId/meta', resolveEventPreview, async (req, res, next) => {
  try {
    res.json(await eventService.getPublicRoute(req.params.eventId, { preview: req.eventPreview === true }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:eventId
 * Get single published event details (public, no auth required)
 */
publicRouter.get('/:eventId', resolveEventPreview, gateUnlessPreview, async (req, res, next) => {
  try {
    const result = await eventService.getEventById(req.params.eventId, { preview: req.eventPreview === true });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:eventId/map
 * Get published floor map (public, no auth required)
 * 404 if map is not PUBLISHED; no-store + ETag + 304
 */
publicRouter.get('/:eventId/map', gateByEventParam, async (req, res, next) => {
  try {
    const data = await mapService.publicMap(req.params.eventId);
    res.set('Cache-Control', 'no-store');
    res.set('ETag', data.etag);
    if (req.headers['if-none-match'] === data.etag) {
      return res.status(304).end();
    }
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// ── Org-scoped routes (mounted at /organizations/:orgId/events) ──
const orgRouter = express.Router({ mergeParams: true });

/**
 * GET /organizations/:orgId/events/summary
 * Summary stats for org events (spec 035 §6.2)
 */
orgRouter.get('/summary', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { q, category } = req.query;
    const result = await eventService.getOrgEventsSummary(orgId, { q, category });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events
 * List all events for an organization (all statuses)
 */
orgRouter.get('/', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { page, limit, status, q, category, sort } = req.query;
    const result = await eventService.listOrgEvents(orgId, { page, limit, status, q, category, sort });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/export.csv
 * Export filtered events list as CSV (spec 035 §6.3). Same filters as the
 * list endpoint, no pagination.
 */
orgRouter.get('/export.csv', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { status, q, category, sort } = req.query;
    const csv = await eventService.exportEventsCsv(orgId, { status, q, category, sort });
    const orgSlug = (await prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } }))?.slug || orgId;
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="events-${orgSlug}-${dateStr}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events
 * Create a new event with price tiers (org-scoped). `setup: true` creates a
 * wizard DRAFT (spec 050): name, venueId, date required; capacity, tiers optional.
 */
orgRouter.post('/', requireAuth, requireOrganizer, requireOrgMembership(), validateCreateEvent, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    if (req.body.setup === true) {
      // Wizard create (spec 050 §7.1): a replay of the same Idempotency-Key returns the row, 200.
      const { event, replayed } = await eventService.createSetupEvent(orgId, req.body, req.get('Idempotency-Key'));
      return res.status(replayed ? 200 : 201).json(event);
    }
    const result = await eventService.createEvent(orgId, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:orgId/events/:eventId
 * Update an event (org-scoped)
 */
orgRouter.patch(
  '/:eventId',
  requireAuth,
  requireOrganizer,
  requireOrgMembership(),
  validateUpdateEvent,
  async (req, res, next) => {
    try {
      const { orgId, eventId } = req.params;
      const result = await eventService.updateEvent(orgId, eventId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /organizations/:orgId/events/:eventId/duplicate
 * Copy an event (tiers + application forms) as a new DRAFT on a new date
 * (spec 011 phase 3). Body: { date, name? }
 */
orgRouter.post('/:eventId/duplicate', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.duplicateEvent(orgId, eventId, req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/publish
 * Publish an event (DRAFT → PUBLISHED). 422 EVENT_NOT_READY with the readiness
 * blockers; body { openFormIds? } opens those DRAFT forms (spec 050 §7.2).
 */
orgRouter.post('/:eventId/publish', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const { openFormIds } = req.body || {};
    if (openFormIds !== undefined && (!Array.isArray(openFormIds) || openFormIds.some((id) => typeof id !== 'string'))) {
      throw new ValidationError('openFormIds must be an array of form ids');
    }
    const result = await eventService.publishEvent(orgId, eventId, { openFormIds });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/readiness
 * What blocks publishing and what to look at first (spec 050 §7.2).
 */
orgRouter.get('/:eventId/readiness', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    res.json(await eventReadinessService.check(orgId, eventId));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/cancel
 * Cancel an event (PUBLISHED → CANCELLED)
 */
orgRouter.post('/:eventId/cancel', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.cancelEvent(orgId, eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/analytics
 * Get per-tier sales, redemption, and revenue analytics (org-scoped)
 * Per FR-057, contracts/api.yaml
 */
orgRouter.get('/:eventId/analytics', requireAuth, requireFeature('analytics'), requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.getEventAnalytics(orgId, eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/workspace
 * Header + tab facts shared by every page of an event (spec 037 phase 2).
 */
orgRouter.get('/:eventId/workspace', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    res.json(await eventService.getEventWorkspace(orgId, eventId));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/overview
 * The admin Event Details page in one request (spec 037 phase 1): event,
 * money, tickets or RSVPs, add-on sales, application forms, floor map.
 */
orgRouter.get('/:eventId/overview', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    res.json(await eventService.getEventOverview(orgId, eventId));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/preview-link (spec 050 F)
 * → { url, expiresAt }: a 1 h staff link to the real, themed event page, DRAFT included.
 */
orgRouter.post('/:eventId/preview-link', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    res.json(await eventPreviewService.mint(req.params.orgId, req.params.eventId));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/preview-payload (spec 050 §7.5)
 * Public event shape whatever the status, plus what the page around it needs.
 * The wizard (050-H) overlays unsaved field values on it.
 */
orgRouter.get('/:eventId/preview-payload', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const event = await eventService.getPreviewEvent(orgId, eventId);
    const [organization, forms] = await Promise.all([
      publicOrganizationIdentity(orgId),
      // 050-B adds `purpose` to each form in ApplicationFormService._serializePublicForm.
      applicationFormService.publicForms(eventId, { anyEventStatus: true }),
    ]);
    // Ticket add-ons ride on event.addOns; application add-ons on each form's tiers.
    // ponytail: gifts (047 D1) and guests (050-Q) join this payload when those cards land.
    res.json({ event, organization, forms });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/logo
 * Upload event logo image
 */
orgRouter.post(
  '/:eventId/logo',
  requireAuth,
  requireOrganizer,
  requireOrgMembership(),
  uploadImage,
  async (req, res, next) => {
    try {
      const { orgId, eventId } = req.params;
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const image = await imageService.processUpload(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'event_logo'
      );

      const existing = await prisma.event.findUnique({ where: { id: eventId }, select: { imageId: true } });
      const result = await eventService.updateEvent(orgId, eventId, {
        logoUrl: image.urls.original,
        imageId: image.id,
      });
      if (existing?.imageId && existing.imageId !== image.id) {
        await imageService.deleteImage(existing.imageId).catch(() => {});
      }
      res.json({ ...result, image });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /organizations/:orgId/events/:eventId/logo
 * Remove event logo
 */
orgRouter.delete('/:eventId/logo', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const existing = await prisma.event.findUnique({ where: { id: eventId }, select: { imageId: true } });
    const result = await eventService.updateEvent(orgId, eventId, { logoUrl: null, imageId: null });
    if (existing?.imageId) {
      await imageService.deleteImage(existing.imageId).catch(() => {});
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default publicRouter;
export { orgRouter as orgEventsRouter };
