// Ticket Routes
// POST /tickets/purchase - Initiate ticket purchase
// GET /tickets/confirm - Confirm purchase and get tickets
// GET /tickets/my - Get customer's purchase history

import express from 'express';
import PaymentService from '../../services/PaymentService.js';
import TicketService from '../../services/TicketService.js';
import QRService from '../../services/QRService.js';
import EmailService from '../../services/EmailService.js';
import { validatePurchaseRequest, validateConfirmRequest } from '../validators/ticketValidators.js';
import { requireAuth } from '../../middleware/auth.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /tickets/my
 * Get authenticated customer's purchase history (FR-017)
 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const correlationId = req.id;

    logger.info('Fetching customer ticket history', {
      customerId,
      correlationId,
    });

    const tickets = await TicketService.getCustomerTickets(customerId);

    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tickets/purchase
 * Initiate ticket purchase with Stripe checkout
 */
router.post('/purchase', validatePurchaseRequest, async (req, res, next) => {
  try {
    const { eventId, quantity, email } = req.body;
    const correlationId = req.id;

    logger.info('Ticket purchase initiated', {
      eventId,
      quantity,
      email,
      correlationId,
    });

    // Create Stripe checkout session
    const result = await PaymentService.createStripeCheckoutSession(
      eventId,
      quantity,
      email,
      correlationId
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tickets/confirm
 * Confirm purchase after Stripe success and issue tickets
 */
router.get('/confirm', validateConfirmRequest, async (req, res, next) => {
  try {
    const { session_id } = req.query;
    const correlationId = req.id;

    logger.info('Confirming ticket purchase', {
      sessionId: session_id,
      correlationId,
    });

    // Get payment details
    const payment = await PaymentService.getPaymentBySessionId(session_id);

    // Check if payment succeeded
    if (payment.status !== 'SUCCEEDED') {
      return res.status(400).json({
        error: 'PaymentNotComplete',
        message: 'Payment has not been completed yet',
        status: payment.status,
      });
    }

    // Check if tickets already created (idempotency)
    let tickets = await TicketService.getTicketsByStripeTransaction(session_id).catch(() => null);

    if (!tickets) {
      // Calculate quantity from payment amount
      const quantity = Math.floor(payment.amount / payment.event.ticketPrice);

      // Create tickets atomically
      tickets = await TicketService.createTicketsAfterPayment(
        payment.id,
        payment.eventId,
        payment.customerId,
        quantity,
        session_id,
        correlationId
      );

      // Generate QR codes for each ticket
      for (const ticket of tickets) {
        const qrJwt = await QRService.generateQRCodeJWT(
          ticket.id,
          payment.event.id,
          payment.customer.email,
          payment.event.name,
          payment.event.date,
          payment.event.venue
        );

        // Update ticket with QR code
        await TicketService.updateTicketQRCode(ticket.id, qrJwt);

        // Generate QR image
        ticket.qrCode = await QRService.generateQRCodeImage(qrJwt);
        ticket.qrCodeJwt = qrJwt;
      }

      // Send email with tickets (async, don't block response)
      EmailService.sendTicketEmail(
        payment.customer.email,
        tickets.map((t) => ({
          ...t,
          event: payment.event,
        })),
        correlationId
      ).catch((error) => {
        logger.error('Failed to send ticket email', {
          error: error.message,
          correlationId,
        });
      });
    } else {
      // Tickets already exist, regenerate QR images for display
      for (const ticket of tickets) {
        if (ticket.qrCodeJwt) {
          ticket.qrCode = await QRService.generateQRCodeImage(ticket.qrCodeJwt);
        }
      }
    }

    res.json({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        status: ticket.status,
        qrCode: ticket.qrCode,
        event: ticket.event || payment.event,
        pricePaid: ticket.pricePaid,
        purchaseTime: ticket.purchaseTime,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tickets/:ticketId
 * Get single ticket details (requires authentication)
 */
router.get('/:ticketId', requireAuth, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const customerId = req.user.id;

    const ticket = await TicketService.getTicketById(ticketId);

    // Ensure the ticket belongs to the authenticated customer
    if (ticket.customerId !== customerId && req.user.type !== 'ADMIN') {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: 'You do not have access to this ticket',
      });
    }

    // Apply expiration logic for the single ticket
    if (ticket.status === 'VALID' && ticket.event?.date) {
      const expirationTime = new Date(new Date(ticket.event.date).getTime() + 60 * 60 * 1000);
      if (expirationTime < new Date()) {
        ticket.status = 'EXPIRED';
        // Update in database
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        await prisma.ticket.update({
          where: { id: ticketId },
          data: { status: 'EXPIRED' },
        });
        await prisma.$disconnect();
      }
    }

    // Generate QR code image if JWT exists
    if (ticket.qrCodeJwt) {
      ticket.qrCode = await QRService.generateQRCodeImage(ticket.qrCodeJwt);
    }

    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

export default router;
