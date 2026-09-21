// Public map route (spec 014 phase 1)
// GET /public/events/:eventId/map — published map, no-cache, ETag.

import { Router } from 'express';
import mapService from '../../services/MapService.js';

const router = Router();

router.get('/events/:eventId/map', async (req, res, next) => {
  try {
    const data = await mapService.publicMap(req.params.eventId);
    res.set('Cache-Control', 'no-store');
    res.set('ETag', `"${data.updatedAt.getTime()}"`);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;