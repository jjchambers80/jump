// Event Routes
// GET /events - List published events
// GET /events/:eventId - Get event details

import express from 'express';
import EventService from '../../services/EventService.js';
import { cacheGet, cacheSet } from '../../utils/cache.js';

const router = express.Router();

const EVENTS_CACHE_TTL = 300; // 5 minutes

/**
 * GET /events
 * List published events with pagination (cached with 5-minute TTL)
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Check cache first
    const cacheKey = `events:list:${page}:${limit}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await EventService.listPublishedEvents(page, limit);

    // Cache the result
    await cacheSet(cacheKey, result, EVENTS_CACHE_TTL);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:eventId
 * Get single event details
 */
router.get('/:eventId', async (req, res, next) => {
  try {
    const { eventId } = req.params;

    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid event ID format',
      });
    }

    const result = await EventService.getEventById(eventId);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
