// Public domain resolution (spec 007 phase 3)
//   GET /domains/resolve?host=tickets.example.com -> { organizationId }
// Called by frontend/middleware.ts on every request to a non-platform host.
// Only ACTIVE domains resolve; unknown hosts are 404.

import express from 'express';
import domainService from '../../services/DomainService.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const router = express.Router();

router.get('/resolve', async (req, res, next) => {
  try {
    const host = String(req.query.host || '').trim().toLowerCase();
    if (!host || host.length > 253) throw new ValidationError('host is required');
    const organizationId = await domainService.resolveHost(host);
    if (!organizationId) throw new NotFoundError('Unknown storefront host');
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ organizationId });
  } catch (error) {
    next(error);
  }
});

export default router;
