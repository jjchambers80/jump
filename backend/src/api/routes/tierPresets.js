// Tier Preset Routes
// Nested under /organizations/:orgId/tier-presets
// All endpoints org-scoped (requireAuth + requireOrganizer)

import express from 'express';
import { prisma } from '@jump/db';
import tierPresetService from '../../services/TierPresetService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { ForbiddenError } from '../../middleware/errorHandler.js';
import {
  validateCreateTierPreset,
  validateUpdateTierPreset,
} from '../validators/tierPresetValidators.js';

const router = express.Router({ mergeParams: true });

const verifyOrgOwnership = async (req, res, next) => {
  try {
    if (req.user.role === 'SYSTEM_ADMIN') return next();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { organizationId: true },
    });
    if (!user?.organizationId || user.organizationId !== req.params.orgId) {
      throw new ForbiddenError('Access denied to this organization');
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * GET /organizations/:orgId/tier-presets
 * List all tier presets for an organization
 */
router.get('/', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
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
router.get('/:presetId', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
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
  verifyOrgOwnership,
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
  verifyOrgOwnership,
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
router.delete('/:presetId', requireAuth, requireOrganizer, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { orgId, presetId } = req.params;
    const result = await tierPresetService.deletePreset(orgId, presetId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
