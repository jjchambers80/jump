// Platform admin routes (spec 045C) — SYSTEM_ADMIN only.
// These are the one platform-wide settings page (Settings › Platform).

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireSystemAdmin } from '../../middleware/rbac.js';
import agentAccessService from '../../services/AgentAccessService.js';

const router = express.Router();

// All platform routes require SYSTEM_ADMIN
router.use(requireAuth);
router.use(requireSystemAdmin);

/** GET /admin/platform/settings — global agent access switch. */
router.get('/settings', async (req, res, next) => {
  try {
    res.json(await agentAccessService.getPlatformSetting());
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/platform/settings — toggle the global switch. Needs step-up. */
router.patch('/settings', async (req, res, next) => {
  try {
    res.json(await agentAccessService.setPlatformSetting(!!req.body.enabled, req.user.id));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/platform/stats — platform-wide grant and call counts. */
router.get('/stats', async (req, res, next) => {
  try {
    res.json(await agentAccessService.platformStats());
  } catch (error) {
    next(error);
  }
});

/** POST /admin/platform/revoke-all — revoke every grant platform-wide. Needs step-up. */
router.post('/revoke-all', async (req, res, next) => {
  try {
    const { confirmation } = req.body;
    if (confirmation !== 'REVOKE ALL GRANTS') {
      return res.status(400).json({
        message: 'Confirmation mismatch',
        code: 'INVALID_CONFIRMATION',
      });
    }
    res.json(await agentAccessService.revokeAllGrantsPlatform(req.user.id));
  } catch (error) {
    next(error);
  }
});

export default router;