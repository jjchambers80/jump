// Ticket Routes
// POST /tickets/redeem - Redeem a ticket via QR code JWT
// GET /tickets/:ticketId - Get single ticket details
// Per FR-032, FR-055, contracts/api.yaml

import express from 'express';
import ticketService from '../../services/TicketService.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

/**
 * POST /tickets/redeem
 * Redeem a ticket by scanning its QR code.
 * Public endpoint (door attendant may not need full auth, just the QR payload).
 *
 * Body: { qrPayload: string, eventId?: string }
 * 200 → RedemptionResult (REDEEMED)
 * 400 → invalid/forged QR
 * 403 → wrong event
 * 409 → already redeemed / voided
 * 410 → expired
 */
router.post('/redeem', async (req, res, next) => {
  try {
    const { qrPayload, eventId } = req.body;

    if (!qrPayload) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'qrPayload is required',
      });
    }

    const result = await ticketService.redeemTicket(qrPayload, eventId || null);
    res.json(result);
  } catch (error) {
    // Map redemption-specific errors to correct HTTP status codes
    if (error.redemptionStatus) {
      const statusCode = error.statusCode || 409;
      return res.status(statusCode).json({
        status: error.redemptionStatus,
        ticketId: error.ticketId || null,
        message: error.message,
        ...(error.originalRedemptionTime && {
          originalRedemptionTime: error.originalRedemptionTime,
        }),
      });
    }
    next(error);
  }
});

/**
 * GET /tickets/my
 * Get all tickets belonging to the authenticated user.
 * Returns tickets grouped with event info for the My Tickets page.
 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const tickets = await ticketService.getMyTickets(req.user.email);
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tickets/:ticketId
 * Get single ticket details (requires authentication).
 */
router.get('/:ticketId', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.getTicketById(req.params.ticketId);

    // Authorization: contact email must match, or ADMIN
    if (req.user.role !== 'ADMIN' && ticket.contact?.email !== req.user.email) {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: 'You do not have access to this ticket',
      });
    }

    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

export default router;
