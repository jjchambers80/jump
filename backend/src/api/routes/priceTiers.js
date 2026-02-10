// Price Tier Routes
// Nested under /organizations/:orgId/events/:eventId/price-tiers
// GET (public), POST/PATCH/activate/deactivate/reorder (org-scoped)
// Per FR-051, contracts/api.yaml

import express from 'express';
import priceTierService from '../../services/PriceTierService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import {
  validateCreatePriceTier,
  validateUpdatePriceTier,
} from '../validators/priceTierValidators.js';

const router = express.Router({ mergeParams: true });

/**
 * GET /organizations/:orgId/events/:eventId/price-tiers
 * List price tiers for an event (public, no auth)
 */
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const result = await priceTierService.listPriceTiers(eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/price-tiers
 * Add a price tier to an event (org-scoped)
 */
router.post('/', requireAuth, requireOrganizer, validateCreatePriceTier, async (req, res, next) => {
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
 * POST /organizations/:orgId/events/:eventId/price-tiers/:priceTierId/activate
 * Activate a price tier (org-scoped)
 */
router.post('/:priceTierId/activate', requireAuth, requireOrganizer, async (req, res, next) => {
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
router.post('/:priceTierId/deactivate', requireAuth, requireOrganizer, async (req, res, next) => {
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
router.post('/reorder', requireAuth, requireOrganizer, async (req, res, next) => {
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
