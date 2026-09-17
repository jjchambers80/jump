// Add-on Routes (spec 012)
// Nested under /organizations/:orgId/events/:eventId/add-ons
// Reads: any member. Writes: ADMIN (configuration), membership-guarded.

import express from 'express';
import addOnService from '../../services/AddOnService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin, requireOrganizer } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';

const router = express.Router({ mergeParams: true });

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const member = [requireAuth, requireOrganizer, requireOrgMembership()];
const admin = [requireAuth, requireAdmin, requireOrgMembership()];

/** GET / — every add-on of the event with attachments and sales counts. */
router.get('/', ...member, wrap(async (req, res) => {
  res.json(await addOnService.list(req.params.orgId, req.params.eventId));
}));

/** GET /presets — one-click starting points (power, badge, table, parking, VIP). */
router.get('/presets', ...member, wrap(async (req, res) => {
  res.json(addOnService.presets());
}));

/** GET /sales — per add-on sold / held / remaining / revenue, split by tickets vs applications (spec 012 phase 3). */
router.get('/sales', ...member, wrap(async (req, res) => {
  res.json(await addOnService.sales(req.params.orgId, req.params.eventId));
}));

/** GET /purchasers.csv — one row per add-on line (orders and applications). */
router.get('/purchasers.csv', ...member, wrap(async (req, res) => {
  const csv = await addOnService.purchasersCsv(req.params.orgId, req.params.eventId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="add-on-purchasers-${req.params.eventId}.csv"`);
  res.send(csv);
}));

router.post('/', ...admin, wrap(async (req, res) => {
  res.status(201).json(await addOnService.create(req.params.orgId, req.params.eventId, req.body || {}));
}));

router.post('/reorder', ...admin, wrap(async (req, res) => {
  res.json(await addOnService.reorder(req.params.orgId, req.params.eventId, req.body?.addOnIds));
}));

router.patch('/:addOnId', ...admin, wrap(async (req, res) => {
  const { orgId, eventId, addOnId } = req.params;
  res.json(await addOnService.update(orgId, eventId, addOnId, req.body || {}));
}));

router.post('/:addOnId/activate', ...admin, wrap(async (req, res) => {
  const { orgId, eventId, addOnId } = req.params;
  res.json(await addOnService.setActive(orgId, eventId, addOnId, true));
}));

router.post('/:addOnId/deactivate', ...admin, wrap(async (req, res) => {
  const { orgId, eventId, addOnId } = req.params;
  res.json(await addOnService.setActive(orgId, eventId, addOnId, false));
}));

/** DELETE — only while nothing has been sold (409 otherwise: deactivate). */
router.delete('/:addOnId', ...admin, wrap(async (req, res) => {
  const { orgId, eventId, addOnId } = req.params;
  res.json(await addOnService.remove(orgId, eventId, addOnId));
}));

export default router;
