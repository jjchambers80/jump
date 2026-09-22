// Public and admin RSVP routes (spec 034).

import express from 'express';
import { prisma } from '@jump/db';
import rsvpService from '../../services/RsvpService.js';
import { validateCancelRsvp, validateCreateRsvp } from '../validators/rsvpValidators.js';
import { requestMeta } from '../../services/LegalAcceptanceService.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { gateByEventParam } from '../../middleware/storefrontGate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';

const createLimiter = makeLimiter('RSVP_CREATE', LIMITS.RSVP_CREATE);

export const eventRsvpsRouter = express.Router({ mergeParams: true });
eventRsvpsRouter.post('/', createLimiter, validateCreateRsvp, gateByEventParam, async (req, res, next) => {
  try {
    await rsvpService.create(req.params.eventId, req.body, requestMeta(req));
    res.status(202).json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

export const rsvpsRouter = express.Router();
rsvpsRouter.post('/cancel', validateCancelRsvp, async (req, res, next) => {
  try {
    res.json(await rsvpService.cancel(req.body.token));
  } catch (error) {
    next(error);
  }
});

export const adminRsvpsRouter = express.Router();
adminRsvpsRouter.use(requireAuth, requireOrganizer);
adminRsvpsRouter.get('/events/:eventId/rsvps', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    if (req.query.format === 'csv') {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { timeZone: true },
      });
      const csv = await rsvpService.csv(organizationId, req.params.eventId, user?.timeZone || 'UTC');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rsvps-${req.params.eventId}.csv"`);
      return res.send(csv);
    }
    res.json(await rsvpService.list(organizationId, req.params.eventId));
  } catch (error) {
    next(error);
  }
});

export default rsvpsRouter;
