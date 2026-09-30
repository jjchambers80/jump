// Buyer routes (spec 007 phase 2)
// Passwordless sign-in and self-service for org-scoped buyers.
//
//   POST /buyer/auth/request   { organizationId, email }  -> 202 always
//   POST /buyer/auth/verify    { token }                  -> { sessionToken, organizationId }
//   POST /buyer/auth/verify-code { organizationId, email, code } -> same (spec 031, CODE organizations)
//   GET  /buyer/me                                        -> profile + org branding
//   GET  /buyer/me/orders                                 -> this org's orders only
//   GET  /buyer/me/tickets                                -> this org's tickets only
//   POST /buyer/me/tickets/:ticketId/refund               -> self-service refund of an owned ticket
//   PATCH /buyer/me, /me/email*, /me/rsvps*, /me/orders/:id/receipt,
//   /me/preferences, /me/sessions/revoke-all, /unsubscribe  -> patron account (spec 040)
//
// The frontend proxies these through Next route handlers so the session lives
// in a first-party httpOnly cookie; browsers never hold the bearer token.

import express from 'express';
import { clientIpForRateLimit } from '../../utils/clientIp.js';
import multer from 'multer';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import buyerAuthService from '../../services/BuyerAuthService.js';
import orderService from '../../services/OrderService.js';
import ticketService from '../../services/TicketService.js';
import refundService from '../../services/RefundService.js';
import emailService from '../../services/EmailService.js';
import applicationService from '../../services/ApplicationService.js';
import applicantProfileService from '../../services/ApplicantProfileService.js';
import buyerAccountService from '../../services/BuyerAccountService.js';
import buyerDataExportService from '../../services/BuyerDataExportService.js';
import { validateEmailChange, validatePreferences, validateUpdateBuyerProfile } from '../validators/buyerAccountValidators.js';
import { contactIdFromUnsubscribeToken, verifyUnsubscribeToken } from '../../utils/unsubscribeToken.js';
import { validateSelectionBody } from '../validators/applicationValidators.js';
import { requireBuyer } from '../../middleware/buyerAuth.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { buyerVerifyUrl } from '../../utils/storefrontUrl.js';
import { evaluateRefundPolicy, REFUND_POLICY_MESSAGES, REFUND_POLICY_SELECT } from '../../services/RefundPolicyService.js';
import { prisma } from '@jump/db';
import { MAX_PHOTO_MB, MAX_PROFILE_PHOTOS } from '../../config/applications.js';
import logger from '../../utils/logger.js';
import { normalizeEmail } from '../../utils/normalizeEmail.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `clientIpForRateLimit` lives in utils/clientIp.js (spec 024 phase 3: services need it too); re-exported for the routes that import it from here.
export { clientIpForRateLimit };

// Per-IP cap on sign-in requests (spec 020 factory); the per-email cap lives in BuyerAuthService.
const requestLimiter = makeLimiter('BUYER_AUTH_REQUEST', LIMITS.BUYER_AUTH_REQUEST);
const verifyLimiter = makeLimiter('BUYER_AUTH_VERIFY', LIMITS.BUYER_AUTH_VERIFY);
const boothLimiter = makeLimiter('BOOTH_CHOOSE', LIMITS.BOOTH_CHOOSE);
// Unsubscribe links carry an unguessable HMAC; the limiter only blunts scanning.
const unsubscribeLimiter = makeLimiter('BUYER_AUTH_VERIFY', LIMITS.BUYER_AUTH_VERIFY);

/** POST /buyer/auth/request — email a sign-in link. Never reveals account existence. */
router.post('/auth/request', requestLimiter, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};
    const email = normalizeEmail(req.body?.email);
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
          code: result.rawCode || null,
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

/** POST /buyer/auth/verify-code — exchange a six-digit code for a session (spec 031). */
router.post('/auth/verify-code', verifyLimiter, async (req, res, next) => {
  try {
    const { organizationId, email, code } = req.body || {};
    const buyer = await buyerAuthService.consumeCode(organizationId, email, code);
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
    const profile = await buyerAccountService.profile(contact.id);
    res.json({ ...profile, organization: contact.organization });
  } catch (error) {
    next(error);
  }
});

// ─── Account (spec 040) ─────────────────────────────────────────────────────

/** PATCH /buyer/me — the buyer's own name, phone, city. Never email, notes, tags or marketing. */
router.patch('/me', requireBuyer, validateUpdateBuyerProfile, async (req, res, next) => {
  try {
    res.json(await buyerAccountService.updateProfile(req.buyer.contactId, req.body));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/email { newEmail } — confirmation link to the new address; nothing changes until it is used. */
router.post('/me/email', requireBuyer, requestLimiter, validateEmailChange, async (req, res, next) => {
  try {
    res.status(202).json(await buyerAccountService.requestEmailChange(req.buyer.contactId, req.body.newEmail));
  } catch (error) {
    next(error);
  }
});

/** DELETE /buyer/me/email — withdraw a pending email change. */
router.delete('/me/email', requireBuyer, async (req, res, next) => {
  try {
    res.json(await buyerAccountService.cancelEmailChange(req.buyer.contactId));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/email/confirm { token } — the emailed link; the token is the proof, no session needed. */
router.post('/me/email/confirm', verifyLimiter, async (req, res, next) => {
  try {
    res.json(await buyerAccountService.confirmEmailChange(req.body?.token));
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/rsvps — this buyer's RSVPs at this organization. */
router.get('/me/rsvps', requireBuyer, async (req, res, next) => {
  try {
    res.json({ data: await buyerAccountService.listRsvps(req.buyer.contactId) });
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/rsvps/:id/cancel */
router.post('/me/rsvps/:id/cancel', requireBuyer, async (req, res, next) => {
  try {
    res.json(await buyerAccountService.cancelRsvp(req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/orders/:orderId/receipt — printable receipt for one of the buyer's paid orders. */
router.get('/me/orders/:orderId/receipt', requireBuyer, async (req, res, next) => {
  try {
    res.json(await orderService.getReceiptForContact(req.buyer.contactId, req.params.orderId));
  } catch (error) {
    next(error);
  }
});

/** GET /buyer/me/export — "Download my data" (spec 040 PA-10): one JSON file, 3 a day. */
router.get('/me/export', requireBuyer, async (req, res, next) => {
  try {
    const data = await buyerDataExportService.exportForBuyer(req.buyer.organizationId, req.buyer.contactId);
    res.set('Content-Disposition', `attachment; filename="${buyerDataExportService.filename(data)}"`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/** PATCH /buyer/me/preferences { emailSubscribed } — marketing email from this organization. */
router.patch('/me/preferences', requireBuyer, validatePreferences, async (req, res, next) => {
  try {
    res.json(await buyerAccountService.setMarketing(req.buyer.contactId, req.body.emailSubscribed, req));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/sessions/revoke-all → { sessionToken } — every other device is signed out; this one gets a fresh session. */
router.post('/me/sessions/revoke-all', requireBuyer, async (req, res, next) => {
  try {
    res.json({ sessionToken: await buyerAccountService.revokeAllSessions(req.buyer.contactId) });
  } catch (error) {
    next(error);
  }
});

/**
 * Unsubscribe without signing in (spec 040 PA-08). GET describes what the
 * token would do (the storefront page shows it and asks for one click — link
 * scanners must not unsubscribe anyone); POST does it, including the mailbox
 * provider's RFC 8058 `List-Unsubscribe=One-Click` form post.
 */
async function contactForUnsubscribe(req) {
  const token = req.query.t || req.body?.t;
  const contactId = contactIdFromUnsubscribeToken(token);
  const contact = contactId
    ? await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, organizationId: true, email: true, emailSubscribed: true, organization: { select: { id: true, name: true } } },
      })
    : null;
  if (!verifyUnsubscribeToken(token, contact)) throw new NotFoundError('This unsubscribe link is not valid');
  return contact;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}

router.get('/unsubscribe', unsubscribeLimiter, async (req, res, next) => {
  try {
    const contact = await contactForUnsubscribe(req);
    res.json({ organization: contact.organization, email: maskEmail(contact.email), emailSubscribed: contact.emailSubscribed });
  } catch (error) {
    next(error);
  }
});

router.post('/unsubscribe', unsubscribeLimiter, express.urlencoded({ extended: false, limit: '2kb' }), async (req, res, next) => {
  try {
    const contact = await contactForUnsubscribe(req);
    await buyerAccountService.setMarketing(contact.id, false, req);
    res.json({ organization: contact.organization, email: maskEmail(contact.email), emailSubscribed: false });
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

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: MAX_PROFILE_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (PHOTO_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new ValidationError('Only JPG, PNG, GIF, and WebP images are allowed'));
  },
});

/** POST /buyer/me/applicant-profile/photos — multipart `photos`, appended up to the cap (spec 011 phase 3). */
router.post('/me/applicant-profile/photos', requireBuyer, (req, res, next) => {
  photoUpload.array('photos')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const msg = error.code === 'LIMIT_FILE_SIZE' ? `Each photo must be ${MAX_PHOTO_MB} MB or smaller` : error.code === 'LIMIT_FILE_COUNT' ? `At most ${MAX_PROFILE_PHOTOS} profile photos` : error.message;
      return next(new ValidationError(msg));
    }
    if (error) return next(error);
    applicantProfileService
      .addPhotosForContact(req.buyer.organizationId, req.buyer.contactId, req.files || [])
      .then((profile) => res.json(profile))
      .catch(next);
  });
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

/** POST /buyer/me/applications/:id/pay → { url } pay-now Checkout for an approved application with a payment due. */
router.post('/me/applications/:id/pay', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicationService.payNowForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** Back from a cancelled pay-now Checkout: release the hold, back to PAYMENT_DUE. */
router.post('/me/applications/:id/cancel-checkout', requireBuyer, boothLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.cancelCheckoutForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** Hold and purchase a booth owned by this buyer's approved application. */
router.post('/me/applications/:id/booth', requireBuyer, boothLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.chooseBoothForContact(
      req.buyer.organizationId,
      req.buyer.contactId,
      req.params.id,
      req.body?.boothId
    ));
  } catch (error) {
    next(error);
  }
});

/** Spec 037 phase 5: choose a space — `{ boothId?, addOns?, useSavedCard? }` (see the guest route). */
router.post('/me/applications/:id/select', requireBuyer, boothLimiter, validateSelectionBody, async (req, res, next) => {
  try {
    res.json(await applicationService.selectForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

/** Spec 037 phase 5: give back a held space to choose another. */
router.post('/me/applications/:id/release', requireBuyer, boothLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.releaseForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** POST /buyer/me/applications/:id/update-card → { url } setup-mode Checkout to replace the saved card. */
router.post('/me/applications/:id/update-card', requireBuyer, async (req, res, next) => {
  try {
    res.json(await applicationService.updateCardForContact(req.buyer.organizationId, req.buyer.contactId, req.params.id));
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

/**
 * POST /buyer/me/tickets/:ticketId/refund — self-serve refund of a ticket this
 * buyer owns, under the organization's refund policy (spec 031 phase 2):
 * tier must be refundable, ticket VALID, before the cutoff, and the policy fee
 * is kept by the organization. Staff refunds do not apply the policy.
 */
router.post('/me/tickets/:ticketId/refund', requireBuyer, async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.ticketId },
      select: {
        id: true,
        contactId: true,
        status: true,
        pricePaid: true,
        priceTier: { select: { isRefundable: true } },
        event: { select: { date: true, venue: { select: { organization: { select: REFUND_POLICY_SELECT } } } } },
      },
    });
    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.contactId !== req.buyer.contactId) {
      throw new ForbiddenError('You do not have access to this ticket');
    }
    const policy = evaluateRefundPolicy(ticket.event.venue.organization, ticket);
    if (!policy.eligible) {
      throw new ValidationError(REFUND_POLICY_MESSAGES[policy.reason] || 'This ticket cannot be refunded');
    }
    const result = await refundService.refundTicket(ticket.id, {
      reason: policy.fee > 0 ? `Customer requested refund (${policy.fee.toFixed(2)} fee retained)` : 'Customer requested refund',
      initiatedBy: null,
      feeAmount: policy.fee,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
