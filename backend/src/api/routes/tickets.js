// Ticket Routes
// POST /tickets/scan - Preview ticket info from QR payload (no redeem)
// POST /tickets/redeem - Redeem a ticket via QR code (JWT or barcode)
// GET /tickets/:ticketId - Get single ticket details
// Per FR-032, FR-055, contracts/api.yaml

import express from 'express';
import ticketService from '../../services/TicketService.js';
import qrService from '../../services/QRService.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

/**
 * Helper: map redemption errors to HTTP responses.
 */
function handleRedemptionError(error, res, next) {
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

/**
 * POST /tickets/scan
 * Preview ticket info from a QR payload without redeeming.
 * Supports both jump:// query-string and legacy JWT formats.
 * Public endpoint.
 *
 * Body: { payload: string }
 * 200 → ticket preview info
 */
router.post('/scan', async (req, res, next) => {
  try {
    const { payload } = req.body;

    if (!payload) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'payload is required',
      });
    }

    let result;
    if (qrService.isJumpPayload(payload)) {
      const parsed = qrService.parseQRPayload(payload);
      if (!parsed) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid QR code format',
        });
      }
      result = await ticketService.lookupByBarcode(parsed.barcode, null);
    } else {
      // Legacy JWT — verify and look up
      let decoded;
      try {
        decoded = qrService.verifyQRCode(payload);
      } catch (qrError) {
        if (qrError.code === 'QR_EXPIRED') {
          return res.status(410).json({
            status: 'EXPIRED',
            message: 'QR code has expired',
          });
        }
        return res.status(400).json({
          status: 'INVALID',
          message: 'Invalid or forged QR code',
        });
      }
      result = await ticketService.lookupByBarcode(
        decoded.barcode,
        null
      );
    }

    res.json(result);
  } catch (error) {
    handleRedemptionError(error, res, next);
  }
});

/**
 * POST /tickets/redeem
 * Redeem a ticket by scanning its QR code.
 * Supports both jump:// query-string and legacy JWT formats.
 * Public endpoint (door attendant may not need full auth, just the QR payload).
 *
 * Body: { qrPayload: string, eventId?: string, barcode?: string }
 * 200 → RedemptionResult (REDEEMED)
 * 400 → invalid/forged QR
 * 403 → wrong event
 * 409 → already redeemed / voided
 * 410 → expired
 */
router.post('/redeem', async (req, res, next) => {
  try {
    const { qrPayload, barcode, eventId } = req.body;

    // Direct barcode redemption (from scan preview flow)
    if (barcode) {
      const result = await ticketService.redeemByBarcode(barcode, eventId || null);
      return res.json(result);
    }

    if (!qrPayload) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'qrPayload or barcode is required',
      });
    }

    // Auto-detect format
    if (qrService.isJumpPayload(qrPayload)) {
      const parsed = qrService.parseQRPayload(qrPayload);
      if (!parsed) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid QR code format',
        });
      }
      const result = await ticketService.redeemByBarcode(parsed.barcode, eventId || parsed.eventId);
      return res.json(result);
    }

    // Legacy JWT format
    const result = await ticketService.redeemTicket(qrPayload, eventId || null);
    res.json(result);
  } catch (error) {
    handleRedemptionError(error, res, next);
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
