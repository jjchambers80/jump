// Price Tier Routes
// Nested under /organizations/:orgId/events/:eventId/price-tiers
// GET (public), POST/PATCH/DELETE/activate/deactivate/reorder (org-scoped)
// Per FR-051, contracts/api.yaml

import express from 'express';
import priceTierService from '../../services/PriceTierService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';
import {
  validateCreatePriceTier,
  validateUpdatePriceTier,
} from '../validators/priceTierValidators.js';

const router = express.Router({ mergeParams: true });

/**
 * GET /organizations/:orgId/events/:eventId/price-tiers
 * List price tiers for an event.
 * Public view filters by visibility and sale window.
 * Pass ?includeAll=true with org auth to see all tiers (admin view).
 */
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const includeAll = req.query.includeAll === 'true';
    const result = await priceTierService.listPriceTiers(eventId, { includeAll });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/price-tiers
 * Add a price tier to an event (org-scoped)
 */
router.post('/', requireAuth, requireOrganizer, requireOrgMembership(), validateCreatePriceTier, async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await priceTierService.createPriceTier(orgId, eventId, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:orgId/events/:eventId/price-tiers/:priceTierId
 * Update a price tier (org-scoped)
 */
router.patch(
  '/:priceTierId',
  requireAuth,
  requireOrganizer,
  requireOrgMembership(),
  validateUpdatePriceTier,
  async (req, res, next) => {
    try {
      const { orgId, eventId, priceTierId } = req.params;
      const result = await priceTierService.updatePriceTier(orgId, eventId, priceTierId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /organizations/:orgId/events/:eventId/price-tiers/:priceTierId
 * Delete an unsold tier (org-scoped); 409 TIER_IN_USE once it has orders.
 */
router.delete('/:priceTierId', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId, priceTierId } = req.params;
    await priceTierService.deletePriceTier(orgId, eventId, priceTierId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/price-tiers/:priceTierId/activate
 * Activate a price tier (org-scoped)
 */
router.post('/:priceTierId/activate', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId, priceTierId } = req.params;
    const result = await priceTierService.activatePriceTier(orgId, eventId, priceTierId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/price-tiers/:priceTierId/deactivate
 * Deactivate a price tier (org-scoped)
 */
router.post('/:priceTierId/deactivate', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId, priceTierId } = req.params;
    const result = await priceTierService.deactivatePriceTier(orgId, eventId, priceTierId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/price-tiers/reorder
 * Reorder price tiers (org-scoped)
 */
router.post('/reorder', requireAuth, requireOrganizer, requireOrgMembership(), async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const { tierIds } = req.body;
    const result = await priceTierService.reorderPriceTiers(orgId, eventId, tierIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
