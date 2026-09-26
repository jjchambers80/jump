// Saved add-on Routes (spec 037 phase 4)
// Nested under /organizations/:orgId/saved-add-ons
// Reads: any member (ORGANIZER+). Writes: ADMIN. Membership-guarded like the
// per-event add-ons router; putting one on an event is
// POST /organizations/:orgId/events/:eventId/add-ons/attach.

import express from 'express';
import addOnProductService from '../../services/AddOnProductService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin, requireOrganizer } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';

const router = express.Router({ mergeParams: true });

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const member = [requireAuth, requireOrganizer, requireOrgMembership()];
const admin = [requireAuth, requireAdmin, requireOrgMembership()];

const truthy = (v) => v === '1' || v === 'true';

/**
 * GET / — saved add-ons for the picker.
 * Query: `q` (case-insensitive substring), `scope` (TICKET | APPLICATION | BOTH;
 * TICKET and APPLICATION also return BOTH), `includeArchived=1`, `eventId`
 * (adds `onEvent`: the event's offering id or null).
 * → `{ savedAddOns[], suggestions[], exactMatch?, canCreate? }`
 */
router.get('/', ...member, wrap(async (req, res) => {
  const { q, scope, includeArchived, eventId } = req.query;
  res.json(
    await addOnProductService.list(req.params.orgId, {
      q: typeof q === 'string' ? q : undefined,
      scope: typeof scope === 'string' && scope ? scope : undefined,
      includeArchived: truthy(includeArchived),
      eventId: typeof eventId === 'string' && eventId ? eventId : undefined,
    })
  );
}));

/** GET /:id — one saved add-on with the events that offer it. */
router.get('/:id', ...member, wrap(async (req, res) => {
  res.json(await addOnProductService.get(req.params.orgId, req.params.id));
}));

/** POST / — create (409 SAVED_ADD_ON_EXISTS on a case-insensitive duplicate). */
router.post('/', ...admin, wrap(async (req, res) => {
  res.status(201).json(await addOnProductService.create(req.params.orgId, req.body || {}));
}));

/**
 * PATCH /:id — name / description / defaultPrice / scope / taxable. Shared
 * fields are copied to every offering; defaultPrice never changes an event.
 */
router.patch('/:id', ...admin, wrap(async (req, res) => {
  res.json(await addOnProductService.update(req.params.orgId, req.params.id, req.body || {}));
}));

router.post('/:id/archive', ...admin, wrap(async (req, res) => {
  res.json(await addOnProductService.setArchived(req.params.orgId, req.params.id, true));
}));

router.post('/:id/unarchive', ...admin, wrap(async (req, res) => {
  res.json(await addOnProductService.setArchived(req.params.orgId, req.params.id, false));
}));

export default router;
