// Floor map admin routes (spec 014 phase 1)
// Routes: /admin/maps — mounted after requireAuth + requireOrganizer.
// Every handler follows the Content route pattern (adminScope.js activeOrgFor).

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import { validateCreateMap, validateUpdateMap } from '../validators/mapValidators.js';
import mapService from '../../services/MapService.js';
import boothService from '../../services/BoothService.js';

const router = Router();

router.use(requireAuth, requireOrganizer);

// ─── Map CRUD ────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    res.json(await mapService.list(await activeOrgFor(req)));
  } catch (error) { next(error); }
});

router.post('/', validateCreateMap, async (req, res, next) => {
  try {
    res.status(201).json(await mapService.create(await activeOrgFor(req), req.body));
  } catch (error) { next(error); }
});

router.get('/:mapId', async (req, res, next) => {
  try {
    res.json(await mapService.get(await activeOrgFor(req), req.params.mapId));
  } catch (error) { next(error); }
});

router.patch('/:mapId', validateUpdateMap, async (req, res, next) => {
  try {
    res.json(await mapService.update(await activeOrgFor(req), req.params.mapId, req.body));
  } catch (error) { next(error); }
});

router.delete('/:mapId', async (req, res, next) => {
  try {
    await mapService.remove(await activeOrgFor(req), req.params.mapId);
    res.status(204).send();
  } catch (error) { next(error); }
});

// ─── Layout (builder whole-tree save) ────────────────────────────────

router.put('/:mapId/layout', async (req, res, next) => {
  try {
    const orgId = await activeOrgFor(req);
    const mapId = req.params.mapId;
    const full = await mapService.replaceLayout(orgId, mapId, {
      elements: req.body.elements,
      booths: req.body.booths,
    });
    res.json(full);
  } catch (error) { next(error); }
});

// ─── Publish / Unpublish ─────────────────────────────────────────────

router.post('/:mapId/publish', async (req, res, next) => {
  try {
    res.json(await mapService.publish(await activeOrgFor(req), req.params.mapId));
  } catch (error) { next(error); }
});

router.post('/:mapId/unpublish', async (req, res, next) => {
  try {
    res.json(await mapService.unpublish(await activeOrgFor(req), req.params.mapId));
  } catch (error) { next(error); }
});

// ─── Booth assignment operations ─────────────────────────────────────

router.get('/:mapId/booths/:boothId/assignable', async (req, res, next) => {
  try {
    const orgId = await activeOrgFor(req);
    const results = await boothService.assignableApplications(
      orgId, req.params.mapId, req.params.boothId, req.query.q
    );
    res.json(results);
  } catch (error) { next(error); }
});

router.post('/:mapId/booths/:boothId/assign', async (req, res, next) => {
  try {
    const orgId = await activeOrgFor(req);
    const { applicationId, force } = req.body;
    if (!applicationId) return res.status(400).json({ error: 'ValidationError', message: 'applicationId is required' });
    res.json(await boothService.assign(orgId, req.params.mapId, req.params.boothId, applicationId, req.user.id, { force: !!force }));
  } catch (error) { next(error); }
});

router.post('/:mapId/booths/:boothId/unassign', async (req, res, next) => {
  try {
    res.json(await boothService.unassign(await activeOrgFor(req), req.params.mapId, req.params.boothId));
  } catch (error) { next(error); }
});

router.post('/:mapId/booths/:boothId/move', async (req, res, next) => {
  try {
    const { targetBoothId } = req.body;
    if (!targetBoothId) return res.status(400).json({ error: 'ValidationError', message: 'targetBoothId is required' });
    res.json(await boothService.move(await activeOrgFor(req), req.params.mapId, req.params.boothId, targetBoothId));
  } catch (error) { next(error); }
});

router.post('/:mapId/booths/:boothId/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'ValidationError', message: 'status is required' });
    res.json(await boothService.setStatus(await activeOrgFor(req), req.params.mapId, req.params.boothId, status));
  } catch (error) { next(error); }
});

export default router;