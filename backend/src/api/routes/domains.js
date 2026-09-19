// Public domain resolution (spec 007 phase 3)
//   GET /domains/resolve?host=tickets.example.com -> { organizationId }
//   GET /domains/owner?eventId=|orderId=|venueId=  -> { organizationId }
// Called by frontend/src/middleware.ts on requests to a non-platform host:
// first to map the host to an organization, then to confirm that a resource
// in the URL belongs to that organization. Only ACTIVE domains resolve;
// unknown hosts and resources are 404. Nothing here reveals more than the
// public storefront pages already do.

import express from 'express';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { prisma } from '@jump/db';
import domainService from '../../services/DomainService.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const router = express.Router();

// Spec 020: the public host → tenant lookups are cheap but unauthenticated; cap per address.
const resolveLimiter = makeLimiter('DOMAIN_RESOLVE', LIMITS.DOMAIN_RESOLVE);

router.get('/resolve', resolveLimiter, async (req, res, next) => {
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

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Organization that owns an event, order, or venue (whichever query param is given). */
router.get('/owner', resolveLimiter, async (req, res, next) => {
  try {
    const { eventId, orderId, venueId } = req.query;
    let organizationId = null;

    if (typeof eventId === 'string' && ID_RE.test(eventId)) {
      const e = await prisma.event.findUnique({ where: { id: eventId }, select: { venue: { select: { organizationId: true } } } });
      organizationId = e?.venue?.organizationId ?? null;
    } else if (typeof orderId === 'string' && ID_RE.test(orderId)) {
      const o = await prisma.order.findUnique({ where: { id: orderId }, select: { contact: { select: { organizationId: true } } } });
      organizationId = o?.contact?.organizationId ?? null;
    } else if (typeof venueId === 'string' && ID_RE.test(venueId)) {
      const v = await prisma.venue.findUnique({ where: { id: venueId }, select: { organizationId: true } });
      organizationId = v?.organizationId ?? null;
    } else {
      throw new ValidationError('eventId, orderId or venueId is required');
    }

    if (!organizationId) throw new NotFoundError('Not found');
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ organizationId });
  } catch (error) {
    next(error);
  }
});

export default router;
