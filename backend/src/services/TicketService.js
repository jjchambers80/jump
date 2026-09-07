// Ticket Service
// Handles ticket creation (after payment), retrieval, and redemption
// Per FR-025, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035

import { prisma } from '@jump/db';
import { generateBarcodes } from '../utils/barcode.js';
import qrService from './QRService.js';
import logger from '../utils/logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler.js';

class TicketService {
  /**
   * Create individual Ticket records for a completed order.
   * Called by PaymentService.handleCheckoutCompleted() after successful payment.
   *
   * For each ticket:
   * 1. Generate unique barcode (JUMP-XXXXXXXXXXXX)
   * 2. Generate QR code JWT { sub: ticketId, eventId, barcode }
   * 3. Snapshot pricePaid from the PriceTier.price
   *
   * Also moves inventory from quantityReserved → quantitySold on the PriceTier.
   *
   * @param {string} orderId
   * @returns {Promise<Object[]>} Created tickets with QR data
   */
  async createTicketsForOrder(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        contact: true,
        items: {
          include: { priceTier: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    let orderItems = order.items;
    if (orderItems.length === 0 && order.stripeSessionId) {
      const stripeModule = await import('../config/stripe.js');
      const session = await stripeModule.default.checkout.sessions.retrieve(order.stripeSessionId);
      const legacyTierId = session.metadata?.priceTierId;
      const legacyTier = legacyTierId
        ? await prisma.priceTier.findUnique({ where: { id: legacyTierId } })
        : null;

      if (legacyTier) {
        orderItems = [
          {
            priceTierId: legacyTier.id,
            quantity: order.quantity,
            unitPrice: legacyTier.price,
          },
        ];
      }
    }

    if (orderItems.length === 0) {
      throw new ValidationError('Order has no ticket items');
    }

    // Generate unique barcodes
    const barcodes = generateBarcodes(order.quantity);

    // Create tickets in a transaction
    const tickets = await prisma.$transaction(async (tx) => {
      const created = [];

      let barcodeIndex = 0;
      for (const item of orderItems) {
        for (let i = 0; i < item.quantity; i++) {
          const barcode = barcodes[barcodeIndex++];
          const ticket = await tx.ticket.create({
            data: {
              orderId: order.id,
              eventId: order.eventId,
              priceTierId: item.priceTierId,
              contactId: order.contactId,
              pricePaid: item.unitPrice,
              barcode,
              status: 'VALID',
            },
          });

          const qrJwt = qrService.generateQRCodeJWT(
            ticket.id,
            order.eventId,
            barcode,
            order.event.date
          );

          const updatedTicket = await tx.ticket.update({
            where: { id: ticket.id },
            data: { qrCodeJwt: qrJwt },
            include: {
              priceTier: { select: { name: true } },
            },
          });

          created.push(updatedTicket);
        }

        // Move inventory for this tier: reserved → sold
        await tx.priceTier.update({
          where: { id: item.priceTierId },
          data: {
            quantitySold: { increment: item.quantity },
            quantityReserved: { decrement: item.quantity },
          },
        });
      }

      return created;
    });

    logger.info('Tickets created for order', {
      orderId,
      ticketCount: tickets.length,
      priceTierIds: orderItems.map((item) => item.priceTierId),
    });

    return tickets;
  }

  /**
   * Get all tickets for a user by their contact email.
   *
   * @param {string} email - User's email address
   * @returns {Promise<Object[]>} Formatted ticket list
   */
  async getMyTickets(email) {
    const contact = await prisma.contact.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!contact) {
      return [];
    }

    const tickets = await prisma.ticket.findMany({
      where: { contactId: contact.id },
      include: {
        event: {
          include: {
            venue: { select: { name: true, address: true } },
          },
        },
        priceTier: { select: { name: true, price: true } },
        order: { select: { orderRef: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Lazy expiration for past events
    for (const ticket of tickets) {
      if (ticket.status === 'VALID' && new Date(ticket.event.date) < new Date()) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: 'EXPIRED' },
        });
        ticket.status = 'EXPIRED';
      }
    }

    return tickets.map((ticket) => ({
      id: ticket.id,
      barcode: ticket.barcode,
      eventId: ticket.eventId,
      eventName: ticket.event.name,
      eventDate: ticket.event.date,
      venue: ticket.event.venue
        ? `${ticket.event.venue.name}${ticket.event.venue.address ? ' — ' + ticket.event.venue.address : ''}`
        : '',
      pricePaid: Number(ticket.pricePaid),
      priceTierName: ticket.priceTier?.name,
      status: ticket.status,
      redeemedAt: ticket.redeemedAt,
      purchaseDate: ticket.order?.createdAt || ticket.createdAt,
      purchaseTime: ticket.order?.createdAt || ticket.createdAt,
      qrCodeJwt: ticket.qrCodeJwt || null,
      event: {
        name: ticket.event.name,
        date: ticket.event.date,
        venue: ticket.event.venue
          ? `${ticket.event.venue.name}${ticket.event.venue.address ? ' — ' + ticket.event.venue.address : ''}`
          : '',
      },
    }));
  }

  /**
   * Get a single ticket by ID.
   *
   * @param {string} ticketId
   * @returns {Promise<Object>}
   */
  async getTicketById(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          include: {
            venue: { select: { name: true, address: true } },
          },
        },
        priceTier: { select: { name: true, price: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        order: { select: { orderRef: true, createdAt: true } },
      },
    });

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    // Lazy expiration check
    if (ticket.status === 'VALID' && new Date(ticket.event.date) < new Date()) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'EXPIRED' },
      });
      ticket.status = 'EXPIRED';
    }

    return await this._formatTicketDetail(ticket);
  }

  /**
   * Redeem a ticket via QR code JWT payload.
   *
   * Validation chain:
   * 1. Verify JWT signature + expiration
   * 2. Look up ticket by sub (ticketId)
   * 3. Check event association (if eventId provided)
   * 4. Lazy expiration (if event.date < now)
   * 5. Check for duplicate redemption
   * 6. Atomically set status → REDEEMED + redeemedAt
   *
   * @param {string} qrPayload - Raw JWT string from QR code scan
   * @param {string|null} expectedEventId - Optional event ID for cross-event validation
   * @returns {Promise<Object>} RedemptionResult or throws with RedemptionRejection info
   */
  async redeemTicket(qrPayload, expectedEventId = null) {
    // 1. Verify JWT
    let decoded;
    try {
      decoded = qrService.verifyQRCode(qrPayload);
    } catch (error) {
      if (error.code === 'QR_EXPIRED') {
        const expiredError = new ValidationError('QR code has expired');
        expiredError.redemptionStatus = 'EXPIRED';
        throw expiredError;
      }
      const invalidError = new ValidationError('Invalid or forged QR code');
      invalidError.redemptionStatus = 'INVALID';
      invalidError.statusCode = 400;
      throw invalidError;
    }

    const ticketId = decoded.sub;

    // 2. Look up ticket
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: { select: { id: true, name: true, date: true } },
        priceTier: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
      },
    });

    if (!ticket) {
      const notFoundError = new ValidationError('Ticket not found');
      notFoundError.redemptionStatus = 'INVALID';
      notFoundError.statusCode = 400;
      throw notFoundError;
    }

    // 3. Event association check
    if (expectedEventId && ticket.eventId !== expectedEventId) {
      const wrongEventError = new ConflictError('Ticket belongs to a different event');
      wrongEventError.redemptionStatus = 'WRONG_EVENT';
      wrongEventError.statusCode = 403;
      throw wrongEventError;
    }

    // 4. Lazy expiration
    if (ticket.status === 'VALID' && new Date(ticket.event.date) < new Date()) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'EXPIRED' },
      });

      const expiredError = new ConflictError('Ticket has expired (event has passed)');
      expiredError.redemptionStatus = 'EXPIRED';
      expiredError.ticketId = ticketId;
      expiredError.statusCode = 410;
      throw expiredError;
    }

    // 5. Check current status
    if (ticket.status === 'REDEEMED') {
      const dupError = new ConflictError('Ticket has already been redeemed');
      dupError.redemptionStatus = 'ALREADY_REDEEMED';
      dupError.ticketId = ticketId;
      dupError.originalRedemptionTime = ticket.redeemedAt;
      throw dupError;
    }

    if (ticket.status === 'EXPIRED') {
      const expiredError = new ConflictError('Ticket has expired');
      expiredError.redemptionStatus = 'EXPIRED';
      expiredError.ticketId = ticketId;
      expiredError.statusCode = 410;
      throw expiredError;
    }

    if (ticket.status === 'VOIDED') {
      const voidedError = new ConflictError('Ticket has been voided');
      voidedError.redemptionStatus = 'VOIDED';
      voidedError.ticketId = ticketId;
      throw voidedError;
    }

    // 6. Redeem
    const now = new Date();
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'REDEEMED',
        redeemedAt: now,
      },
    });

    logger.info('Ticket redeemed', {
      ticketId,
      eventId: ticket.eventId,
      barcode: ticket.barcode,
    });

    return {
      status: 'REDEEMED',
      ticketId: ticket.id,
      barcode: ticket.barcode,
      priceTierName: ticket.priceTier.name,
      contactName: `${ticket.contact.firstName} ${ticket.contact.lastName}`,
      redeemedAt: now,
    };
  }

  // ─── Formatters ───

  async _formatTicketDetail(ticket) {
    // Generate a real QR code data URL image from the JWT
    let qrCode = null;
    if (ticket.qrCodeJwt) {
      try {
        const { default: qrService } = await import('./QRService.js');
        qrCode = await qrService.generateQRCodeImage(ticket.qrCodeJwt);
      } catch (err) {
        logger.warn('Failed to generate QR image for ticket detail', {
          ticketId: ticket.id,
          error: err.message,
        });
      }
    }

    const venueStr = ticket.event?.venue
      ? `${ticket.event.venue.name}${ticket.event.venue.address ? ' — ' + ticket.event.venue.address : ''}`
      : '';

    const purchaseTimestamp = ticket.order?.createdAt || ticket.createdAt;

    return {
      id: ticket.id,
      barcode: ticket.barcode,
      qrCode,
      qrCodeJwt: ticket.qrCodeJwt || null,
      priceTierName: ticket.priceTier?.name,
      pricePaid: Number(ticket.pricePaid),
      status: ticket.status,
      redeemedAt: ticket.redeemedAt,
      createdAt: ticket.createdAt,
      purchaseDate: purchaseTimestamp,
      purchaseTime: purchaseTimestamp,
      event: {
        id: ticket.event?.id,
        name: ticket.event?.name,
        date: ticket.event?.date,
        status: ticket.event?.status,
        venue: venueStr,
      },
      venue: venueStr,
      contact: ticket.contact,
      orderRef: ticket.order?.orderRef,
    };
  }
}

export default new TicketService();
