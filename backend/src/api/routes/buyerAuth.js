// Buyer routes (spec 007 phase 2)
// Passwordless sign-in and self-service for org-scoped buyers.
//
//   POST /buyer/auth/request   { organizationId, email }  -> 202 always
//   POST /buyer/auth/verify    { token }                  -> { sessionToken, organizationId }
//   GET  /buyer/me                                        -> profile + org branding
//   GET  /buyer/me/orders                                 -> this org's orders only
//   GET  /buyer/me/tickets                                -> this org's tickets only
//   POST /buyer/me/tickets/:ticketId/refund               -> self-service refund of an owned ticket
//
// The frontend proxies these through Next route handlers so the session lives
// in a first-party httpOnly cookie; browsers never hold the bearer token.

import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import buyerAuthService from '../../services/BuyerAuthService.js';
import orderService from '../../services/OrderService.js';
import ticketService from '../../services/TicketService.js';
import refundService from '../../services/RefundService.js';
import emailService from '../../services/EmailService.js';
import applicationService from '../../services/ApplicationService.js';
import applicantProfileService from '../../services/ApplicantProfileService.js';
import { requireBuyer } from '../../middleware/buyerAuth.js';
import { ForbiddenError, ValidationError } from '../../middleware/errorHandler.js';
import { buyerVerifyUrl } from '../../utils/storefrontUrl.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client IP for rate limiting. Browser traffic reaches this route through the
 * Next route handler (server-to-server), so req.ip would be the frontend's
 * egress for every buyer. The proxy forwards the real address in
 * X-Jump-Client-Ip signed with the shared AUTH_SECRET; anything unsigned or
 * mis-signed falls back to req.ip.
 */
export function clientIpForRateLimit(req) {
  const ip = req.get('x-jump-client-ip');
  const sig = req.get('x-jump-client-ip-sig');
  const secret = process.env.AUTH_SECRET;
  if (ip && sig && secret) {
    const expected = createHmac('sha256', secret).update(ip).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return ip;
  }
  return req.ip;
}

// Per-IP cap on sign-in requests; the per-email cap lives in BuyerAuthService.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIpForRateLimit(req)),
  message: { error: 'Too many sign-in requests. Try again later.' },
});

/** POST /buyer/auth/request — email a sign-in link. Never reveals account existence. */
router.post('/auth/request', requestLimiter, async (req, res, next) => {
  try {
    const { organizationId, email } = req.body || {};
    if (!organizationId || typeof organizationId !== 'string') {
      throw new ValidationError('organizationId is required');
    }
    if (!email || !EMAIL_RE.test(email)) {
      throw new ValidationError('A valid email is required');
    }

    const result = await buyerAuthService.requestLogin(organizationId, email);
    if (result.issued) {
      // Fire-and-forget; the response must not depend on (or time) the send.
      emailService
        .sendBuyerLoginEmail({
          contact: result.contact,
          organization: result.contact.organization,
          loginUrl: await buyerVerifyUrl(organizationId, result.rawToken),
        })
        .catch((error) => {
          logger.error('Buyer login email failed', { contactId: result.contact.id, error: error.message });
        });
    }

    res.status(202).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/auth/verify — exchange a magic-link token for a session. */
router.post('/auth/verify', async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const buyer = await buyerAuthService.consumeToken(token);
    const sessionToken = buyerAuthService.signSession(buyer);

    logger.info('Buyer signed in', {
      event: 'buyer_signed_in',
      contactId: buyer.contactId,
      organizationId: buyer.organizationId,
      purpose: buyer.purpose,
    });

    res.json({ sessionToken, organizationId: buyer.organizationId });
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me — profile for the signed-in buyer. */
router.get('/me', requireBuyer, async (req, res, next) => {
  try {
    const contact = await buyerAuthService.getProfile(req.buyer.contactId);
    res.json({
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      emailSubscribed: contact.emailSubscribed,
      organization: contact.organization,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/orders — orders belonging to this buyer at this organization. */
router.get('/me/orders', requireBuyer, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await orderService.getOrdersForContact(req.buyer.contactId, { page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/tickets — tickets belonging to this buyer at this organization. */
router.get('/me/tickets', requireBuyer, async (req, res, next) => {
  try {
    const tickets = await ticketService.getTicketsForContact(req.buyer.contactId);
    res.json({ data: tickets });
  } catch (error) {
    next(error);
  }
});

// ─── Applications (spec 011) ──────────────────────────────────────────────

/** GET /buyer/me/applicant-profile — business profile at this organization (null when none). */
router.get('/me/applicant-profile', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicantProfileService.getForContact(req.buyer.organizationId, req.buyer.contactId));
  } catch (error) {
    next(error);
  }
});

/** PATCH /buyer/me/applicant-profile — update business name, description, website, socials. */
router.patch('/me/applicant-profile', requireBuyer, async (req, res, next) => {
  try {
    await applicantProfileService.upsert(req.buyer.organizationId, req.buyer.contactId, req.body || {});
    res.json(await applicantProfileService.getForContact(req.buyer.organizationId, req.buyer.contactId));
  } catch (error) {
    next(error);
  }
});

/** DELETE /buyer/me/applicant-profile/photos/:imageId */
router.delete('/me/applicant-profile/photos/:imageId', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicantProfileService.removePhoto(req.buyer.organizationId, req.buyer.contactId, req.params.imageId));
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/applications — this buyer's applications at this organization. */
router.get('/me/applications', requireBuyer, async (req, res, next) => {
  try {
    res.json({ data: await applicationService.listForContact(req.buyer.organizationId, req.buyer.contactId) });
  } catch (error) {
    next(error);
  }
});

router.get('/me/applications/:id', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicationService.getForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/applications/:id/withdraw — while SUBMITTED or WAITLISTED. */
router.post('/me/applications/:id/withdraw', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicationService.withdrawByApplicant(req.buyer.organizationId, req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/tickets/:ticketId/refund — refund a refundable, VALID ticket this buyer owns. */
router.post('/me/tickets/:ticketId/refund', requireBuyer, async (req, res, next) => {
  try {
    const ticket = await ticketService.getTicketById(req.params.ticketId);
    if (ticket.contactId !== req.buyer.contactId) {
      throw new ForbiddenError('You do not have access to this ticket');
    }
    if (!ticket.isRefundable) {
      throw new ValidationError('This ticket is not eligible for refund');
    }
    if (ticket.status !== 'VALID') {
      throw new ValidationError(`Cannot refund a ticket with status: ${ticket.status}`);
    }
    const result = await refundService.refundTicket(ticket.id, {
      reason: 'Customer requested refund',
      initiatedBy: null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
