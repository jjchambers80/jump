// Admin Routes (Legacy — kept for backward compatibility)
// Event management routes have moved to /organizations/:orgId/events
// Dashboard stats route still handled here

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/rbac.js';

const router = express.Router();

// All admin routes require authentication + admin role
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /admin/dashboard/stats
 * Placeholder for dashboard statistics (FR-014)
 * Will be reimplemented in Phase 9 (US7 Analytics)
 */
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    res.json({
      message:
        'Dashboard stats will be available via /organizations/:orgId/events/:eventId/analytics',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
