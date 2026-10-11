// Special guest lineup routes (spec 050 §7.6, card 050-Q)
// Nested under /organizations/:orgId/events/:eventId/guests. ORGANIZER and up,
// membership-guarded, like every other event route (the Events feature is locked on).

import express from 'express';
import eventGuestService from '../../services/EventGuestService.js';
import imageService from '../../services/ImageService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';
import { uploadImage } from '../../middleware/imageUpload.js';

const router = express.Router({ mergeParams: true });

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const member = [requireAuth, requireOrganizer, requireOrgMembership()];

router.get('/', ...member, wrap(async (req, res) => {
  res.json({ data: await eventGuestService.list(req.params.orgId, req.params.eventId) });
}));

router.post('/', ...member, wrap(async (req, res) => {
  res.status(201).json(await eventGuestService.create(req.params.orgId, req.params.eventId, req.body || {}));
}));

router.post('/reorder', ...member, wrap(async (req, res) => {
  res.json({ data: await eventGuestService.reorder(req.params.orgId, req.params.eventId, req.body?.ids) });
}));

router.patch('/:guestId', ...member, wrap(async (req, res) => {
  const { orgId, eventId, guestId } = req.params;
  res.json(await eventGuestService.update(orgId, eventId, guestId, req.body || {}));
}));

router.delete('/:guestId', ...member, wrap(async (req, res) => {
  const { orgId, eventId, guestId } = req.params;
  await eventGuestService.remove(orgId, eventId, guestId);
  res.status(204).end();
}));

router.post('/:guestId/image', ...member, uploadImage, wrap(async (req, res) => {
  const { orgId, eventId, guestId } = req.params;
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  // Scope check before storing anything.
  await eventGuestService._requireGuest(orgId, eventId, guestId);
  const image = await imageService.processUpload(req.file.buffer, req.file.originalname, req.file.mimetype, 'event_guest');
  res.json(await eventGuestService.setImage(orgId, eventId, guestId, image.id));
}));

router.delete('/:guestId/image', ...member, wrap(async (req, res) => {
  const { orgId, eventId, guestId } = req.params;
  res.json(await eventGuestService.setImage(orgId, eventId, guestId, null));
}));

export default router;
