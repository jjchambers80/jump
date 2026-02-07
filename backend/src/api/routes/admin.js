// Admin Routes
// POST /admin/events - Create event (FR-011)
// PATCH /admin/events/:eventId - Update event (FR-011)
// POST /admin/events/:eventId/publish - Publish event (FR-011)
// GET /admin/events - List admin's events
// GET /admin/dashboard/stats - Dashboard statistics (FR-014)

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/rbac.js';
import AdminEventService from '../../services/AdminEventService.js';
import { validateEventCreate, validateEventUpdate } from '../validators/adminValidators.js';
import { cacheInvalidate } from '../../utils/cache.js';

const router = express.Router();

// All admin routes require authentication + admin role
router.use(requireAuth);
router.use(requireAdmin);

/**
 * POST /admin/events
 * Create a new event in DRAFT status
 */
router.post('/events', validateEventCreate, async (req, res, next) => {
  try {
    const event = await AdminEventService.createEvent(req.user.id, req.body);

    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/events
 * List admin's own events
 */
router.get('/events', async (req, res, next) => {
  try {
    const events = await AdminEventService.getAdminEvents(req.user.id);

    res.json({ events });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/events/:eventId
 * Update event details
 */
router.patch('/events/:eventId', validateEventUpdate, async (req, res, next) => {
  try {
    const { eventId } = req.params;

    const event = await AdminEventService.updateEvent(eventId, req.user.id, req.body);

    res.json({ event });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/events/:eventId/publish
 * Publish event (make visible to customers)
 */
router.post('/events/:eventId/publish', async (req, res, next) => {
  try {
    const { eventId } = req.params;

    const event = await AdminEventService.publishEvent(eventId, req.user.id);

    // Invalidate events list cache since a new event is now published
    await cacheInvalidate('events:*');

    res.json({ event });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/dashboard/stats
 * Get real-time dashboard statistics (FR-014)
 */
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const { eventId } = req.query;

    const stats = await AdminEventService.getDashboardStats(req.user.id, eventId || null);

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

export default router;
