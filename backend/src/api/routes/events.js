// Event Routes (Schema Redesign)
// Public: GET /events, GET /events/:eventId
// Org-scoped: GET/POST /organizations/:orgId/events,
//             PATCH .../events/:eventId,
//             POST .../events/:eventId/publish,
//             POST .../events/:eventId/cancel
// Per FR-050, contracts/api.yaml

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import eventService from '../../services/EventService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { validateCreateEvent, validateUpdateEvent } from '../validators/eventValidators.js';

// ── Logo upload config ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../../../uploads/logos');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const logoUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp, svg) are allowed'));
    }
  },
});

// ── Public routes (mounted at /events) ──
const publicRouter = express.Router();

/**
 * GET /events
 * List published events (public, no auth required)
 */
publicRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, category, dateFrom, dateTo } = req.query;
    const result = await eventService.listPublishedEvents({
      page,
      limit,
      category,
      dateFrom,
      dateTo,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:eventId
 * Get single published event details (public, no auth required)
 */
publicRouter.get('/:eventId', async (req, res, next) => {
  try {
    const result = await eventService.getEventById(req.params.eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── Org-scoped routes (mounted at /organizations/:orgId/events) ──
const orgRouter = express.Router({ mergeParams: true });

/**
 * GET /organizations/:orgId/events
 * List all events for an organization (all statuses)
 */
orgRouter.get('/', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { page, limit, status } = req.query;
    const result = await eventService.listOrgEvents(orgId, { page, limit, status });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events
 * Create a new event with price tiers (org-scoped)
 */
orgRouter.post('/', requireAuth, requireOrganizer, validateCreateEvent, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const result = await eventService.createEvent(orgId, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:orgId/events/:eventId
 * Update an event (org-scoped)
 */
orgRouter.patch(
  '/:eventId',
  requireAuth,
  requireOrganizer,
  validateUpdateEvent,
  async (req, res, next) => {
    try {
      const { orgId, eventId } = req.params;
      const result = await eventService.updateEvent(orgId, eventId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /organizations/:orgId/events/:eventId/publish
 * Publish an event (DRAFT → PUBLISHED)
 */
orgRouter.post('/:eventId/publish', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.publishEvent(orgId, eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/cancel
 * Cancel an event (PUBLISHED → CANCELLED)
 */
orgRouter.post('/:eventId/cancel', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.cancelEvent(orgId, eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:orgId/events/:eventId/analytics
 * Get per-tier sales, redemption, and revenue analytics (org-scoped)
 * Per FR-057, contracts/api.yaml
 */
orgRouter.get('/:eventId/analytics', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.getEventAnalytics(orgId, eventId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:orgId/events/:eventId/logo
 * Upload event logo image
 */
orgRouter.post(
  '/:eventId/logo',
  requireAuth,
  requireOrganizer,
  logoUpload.single('logo'),
  async (req, res, next) => {
    try {
      const { orgId, eventId } = req.params;
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      const logoUrl = `/uploads/logos/${req.file.filename}`;
      const result = await eventService.updateEvent(orgId, eventId, { logoUrl });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /organizations/:orgId/events/:eventId/logo
 * Remove event logo
 */
orgRouter.delete('/:eventId/logo', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { orgId, eventId } = req.params;
    const result = await eventService.updateEvent(orgId, eventId, { logoUrl: null });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default publicRouter;
export { orgRouter as orgEventsRouter };
