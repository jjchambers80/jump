// Tier Preset Routes
// Nested under /organizations/:orgId/tier-presets
// All endpoints org-scoped (requireAuth + requireOrganizer)

import express from 'express';
import tierPresetService from '../../services/TierPresetService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import {
  validateCreateTierPreset,
  validateUpdateTierPreset,
} from '../validators/tierPresetValidators.js';

const router = express.Router({ mergeParams: true });

/**
 * GET /organizations/:orgId/tier-presets
 * List all tier presets for an organization
 */
router.get('/', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const result = await tierPresetService.listPresets(orgId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/tier-presets/:presetId
 * Get a single tier preset
 */
router.get('/:presetId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, presetId } = req.params;
    const result = await tierPresetService.getPreset(orgId, presetId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/tier-presets
 * Create a tier preset
 */
router.post(
  '/',
  requireAuth,
  requireOrganizer,
  validateCreateTierPreset,
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      const result = await tierPresetService.createPreset(orgId, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /organizations/:orgId/tier-presets/:presetId
 * Update a tier preset
 */
router.patch(
  '/:presetId',
  requireAuth,
  requireOrganizer,
  validateUpdateTierPreset,
  async (req, res, next) => {
    try {
      const { orgId, presetId } = req.params;
      const result = await tierPresetService.updatePreset(orgId, presetId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /organizations/:orgId/tier-presets/:presetId
 * Delete a tier preset
 */
router.delete('/:presetId', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, presetId } = req.params;
    const result = await tierPresetService.deletePreset(orgId, presetId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
