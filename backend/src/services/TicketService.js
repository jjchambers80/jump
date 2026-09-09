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
   * Get the scannable QR payload for a ticket.
   * If stored value is already jump:// format, use it directly.
   * If stored value is legacy JWT, regenerate as jump:// format.
   */
  _getQrPayload(ticket) {
    if (ticket.qrCodeJwt && qrService.isJumpPayload(ticket.qrCodeJwt)) {
      return ticket.qrCodeJwt;
    }
    // Regenerate as short jump:// payload (needs ticketId, eventId, barcode)
    if (ticket.barcode && ticket.eventId) {
      return qrService.generateQRPayload(ticket.id, ticket.eventId, ticket.barcode);
    }
    // Fallback: use stored value as-is (legacy JWT)
    return ticket.qrCodeJwt || null;
  }

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

      // Get next ticket number — advisory lock prevents concurrent duplicate ticket numbers
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.eventId}))`;
      const maxResult = await tx.$queryRaw`
        SELECT COALESCE(MAX("ticketNumber"), 0) AS max_num
        FROM "Ticket"
        WHERE "eventId" = ${order.eventId}
      `;
      let nextTicketNumber = Number(maxResult[0].max_num) + 1;

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
              ticketNumber: nextTicketNumber++,
              pricePaid: item.unitPrice,
              barcode,
              status: 'VALID',
            },
          });

          const qrPayload = qrService.generateQRPayload(
            ticket.id,
            order.eventId,
            barcode
          );

          const updatedTicket = await tx.ticket.update({
            where: { id: ticket.id },
            data: { qrCodeJwt: qrPayload },
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
        priceTier: { select: { name: true, price: true, description: true, saleStartDate: true, saleEndDate: true, isRefundable: true } },
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

    const now = new Date();
    return tickets.map((ticket) => {
      const venueStr = ticket.event.venue
        ? `${ticket.event.venue.name}${ticket.event.venue.address ? ' — ' + ticket.event.venue.address : ''}`
        : '';

      // Compute sale status from tier dates
      const saleStart = ticket.priceTier?.saleStartDate ? new Date(ticket.priceTier.saleStartDate) : null;
      const saleEnd = ticket.priceTier?.saleEndDate ? new Date(ticket.priceTier.saleEndDate) : null;
      let saleStatus = 'ON_SALE';
      if (saleStart && now < saleStart) saleStatus = 'NOT_STARTED';
      else if (saleEnd && now > saleEnd) saleStatus = 'ENDED';

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        eventId: ticket.eventId,
        eventName: ticket.event.name,
        eventDate: ticket.event.date,
        venue: venueStr,
        pricePaid: Number(ticket.pricePaid),
        priceTierName: ticket.priceTier?.name,
        priceTierDescription: ticket.priceTier?.description || null,
        saleStatus,
        saleEndDate: ticket.priceTier?.saleEndDate || null,
        isRefundable: ticket.priceTier?.isRefundable ?? false,
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
        purchaseDate: ticket.order?.createdAt || ticket.createdAt,
        purchaseTime: ticket.order?.createdAt || ticket.createdAt,
        qrCodeJwt: ticket.qrCodeJwt || null,
        event: {
          name: ticket.event.name,
          date: ticket.event.date,
          venue: venueStr,
        },
      };
    });
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
        priceTier: { select: { name: true, price: true, description: true, saleStartDate: true, saleEndDate: true, isRefundable: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        order: { select: { orderRef: true, createdAt: true, subtotalAmount: true, platformFeeAmount: true, processingFeeAmount: true, taxAmount: true, totalAmount: true, quantity: true } },
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
   * Look up a ticket by barcode without redeeming it.
   * Used by the scan preview step (scan → show info → confirm).
   *
   * @param {string} barcode - JUMP-XXXXXXXXXXXX barcode
   * @param {string|null} expectedEventId - Optional event scoping
   * @returns {Promise<Object>} Ticket preview info
   */
  async lookupByBarcode(barcode, expectedEventId = null) {
    const ticket = await prisma.ticket.findUnique({
      where: { barcode },
      include: {
        event: { select: { id: true, name: true, date: true } },
        priceTier: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    if (!ticket) {
      const error = new ValidationError('Ticket not found');
      error.redemptionStatus = 'INVALID';
      error.statusCode = 400;
      throw error;
    }

    if (expectedEventId && ticket.eventId !== expectedEventId) {
      const error = new ConflictError('Ticket belongs to a different event');
      error.redemptionStatus = 'WRONG_EVENT';
      error.statusCode = 403;
      throw error;
    }

    // Lazy expiration
    if (ticket.status === 'VALID' && new Date(ticket.event.date) < new Date()) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'EXPIRED' },
      });
      ticket.status = 'EXPIRED';
    }

    return {
      ticketId: ticket.id,
      barcode: ticket.barcode,
      status: ticket.status,
      priceTierName: ticket.priceTier?.name,
      contactName: `${ticket.contact.firstName} ${ticket.contact.lastName}`,
      contactEmail: ticket.contact.email,
      eventId: ticket.event.id,
      eventName: ticket.event.name,
      eventDate: ticket.event.date,
      redeemedAt: ticket.redeemedAt,
    };
  }

  /**
   * Redeem a ticket by barcode (new format — no JWT verification needed).
   * Runs the same validation chain as redeemTicket minus JWT step.
   *
   * @param {string} barcode - JUMP-XXXXXXXXXXXX barcode
   * @param {string|null} expectedEventId - Optional event scoping
   * @returns {Promise<Object>} RedemptionResult
   */
  async redeemByBarcode(barcode, expectedEventId = null) {
    const ticket = await prisma.ticket.findUnique({
      where: { barcode },
      include: {
        event: { select: { id: true, name: true, date: true } },
        priceTier: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
      },
    });

    if (!ticket) {
      const error = new ValidationError('Ticket not found');
      error.redemptionStatus = 'INVALID';
      error.statusCode = 400;
      throw error;
    }

    if (expectedEventId && ticket.eventId !== expectedEventId) {
      const error = new ConflictError('Ticket belongs to a different event');
      error.redemptionStatus = 'WRONG_EVENT';
      error.statusCode = 403;
      throw error;
    }

    // Lazy expiration
    if (ticket.status === 'VALID' && new Date(ticket.event.date) < new Date()) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'EXPIRED' },
      });
      const error = new ConflictError('Ticket has expired (event has passed)');
      error.redemptionStatus = 'EXPIRED';
      error.ticketId = ticket.id;
      error.statusCode = 410;
      throw error;
    }

    if (ticket.status === 'REDEEMED') {
      const error = new ConflictError('Ticket has already been redeemed');
      error.redemptionStatus = 'ALREADY_REDEEMED';
      error.ticketId = ticket.id;
      error.originalRedemptionTime = ticket.redeemedAt;
      throw error;
    }

    if (ticket.status === 'EXPIRED') {
      const error = new ConflictError('Ticket has expired');
      error.redemptionStatus = 'EXPIRED';
      error.ticketId = ticket.id;
      error.statusCode = 410;
      throw error;
    }

    if (ticket.status === 'VOIDED') {
      const error = new ConflictError('Ticket has been voided');
      error.redemptionStatus = 'VOIDED';
      error.ticketId = ticket.id;
      throw error;
    }

    const now = new Date();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'REDEEMED', redeemedAt: now },
    });

    logger.info('Ticket redeemed by barcode', {
      ticketId: ticket.id,
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

  /**
   * Get full ticket detail for admin view.
   * Includes QR code image, attendee info, order details, and sibling tickets.
   *
   * @param {string} ticketId
   * @returns {Promise<Object>}
   */
  async getTicketDetailForAdmin(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          include: {
            venue: { select: { name: true, address: true } },
          },
        },
        priceTier: { select: { name: true, price: true, description: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        order: {
          include: {
            contact: { select: { firstName: true, lastName: true, email: true } },
            tickets: {
              where: { id: { not: ticketId } },
              include: {
                priceTier: { select: { name: true } },
                contact: { select: { firstName: true, lastName: true, email: true } },
              },
              orderBy: { ticketNumber: 'asc' },
            },
            payment: {
              select: {
                id: true,
                amount: true,
                currency: true,
                status: true,
                stripePaymentIntentId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    // Generate QR code image using short jump:// payload for easy scanning
    let qrCodeImage = null;
    const qrPayload = this._getQrPayload(ticket);
    if (qrPayload) {
      try {
        qrCodeImage = await qrService.generateQRCodeImage(qrPayload);
      } catch (err) {
        logger.warn('Failed to generate QR image', { ticketId, error: err.message });
      }
    }

    const venueStr = ticket.event?.venue
      ? `${ticket.event.venue.name}${ticket.event.venue.address ? ', ' + ticket.event.venue.address : ''}`
      : '';

    // Format sibling tickets
    const siblingTickets = (ticket.order?.tickets || []).map((t) => ({
      id: t.id,
      barcode: t.barcode,
      ticketNumber: t.ticketNumber,
      priceTierName: t.priceTier?.name,
      pricePaid: Number(t.pricePaid),
      status: t.status,
      attendee: t.contact,
    }));

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      barcode: ticket.barcode,
      qrCodeImage,
      priceTierName: ticket.priceTier?.name,
      pricePaid: Number(ticket.pricePaid),
      status: ticket.status,
      redeemedAt: ticket.redeemedAt,
      createdAt: ticket.createdAt,
      attendee: ticket.contact,
      purchaser: ticket.order?.contact || null,
      event: {
        id: ticket.event?.id,
        name: ticket.event?.name,
        date: ticket.event?.date,
        venue: venueStr,
      },
      order: {
        id: ticket.order?.id,
        orderRef: ticket.order?.orderRef,
        totalAmount: Number(ticket.order?.totalAmount),
        currency: ticket.order?.currency,
      },
      payment: ticket.order?.payment
        ? {
            status: ticket.order.payment.status,
            amount: Number(ticket.order.payment.amount),
            currency: ticket.order.payment.currency,
            stripePaymentIntentId: ticket.order.payment.stripePaymentIntentId,
            createdAt: ticket.order.payment.createdAt,
          }
        : null,
      siblingTickets,
    };
  }

  /**
   * Update attendee (contact) info on a ticket.
   *
   * @param {string} ticketId
   * @param {{ firstName?: string, lastName?: string, email?: string }} updates
   * @returns {Promise<Object>} Updated contact
   */
  async updateTicketAttendee(ticketId, { firstName, lastName, email }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { contactId: true },
    });

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    const data = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;
    if (email !== undefined) data.email = email;

    const updated = await prisma.contact.update({
      where: { id: ticket.contactId },
      data,
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    logger.info('Ticket attendee updated', { ticketId, contactId: updated.id });
    return updated;
  }

  /**
   * Admin check-in: set ticket status to REDEEMED.
   *
   * @param {string} ticketId
   * @returns {Promise<Object>}
   */
  async adminCheckIn(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.status === 'REDEEMED') throw new ConflictError('Ticket already checked in');
    if (ticket.status === 'VOIDED') throw new ConflictError('Cannot check in a voided ticket');
    if (ticket.status === 'EXPIRED') throw new ConflictError('Cannot check in an expired ticket');

    const now = new Date();
    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'REDEEMED', redeemedAt: now },
    });

    logger.info('Admin check-in', { ticketId });
    return { status: updated.status, redeemedAt: updated.redeemedAt };
  }

  /**
   * Admin undo check-in: revert ticket from REDEEMED to VALID.
   *
   * @param {string} ticketId
   * @returns {Promise<Object>}
   */
  async adminUndoCheckIn(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket) throw new NotFoundError('Ticket not found');
    if (ticket.status !== 'REDEEMED') throw new ConflictError('Ticket is not checked in');

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'VALID', redeemedAt: null },
    });

    logger.info('Admin undo check-in', { ticketId });
    return { status: updated.status, redeemedAt: null };
  }

  /**
   * Scan a barcode and return the full order context: the scanned ticket
   * plus all sibling tickets in the same order, for order-level check-in.
   *
   * @param {string} barcode - JUMP-XXXXXXXXXXXX barcode
   * @returns {Promise<Object>} OrderScanResult
   */
  async scanOrderByBarcode(barcode) {
    const ticket = await prisma.ticket.findUnique({
      where: { barcode },
      include: {
        event: { select: { id: true, name: true, date: true } },
        order: { select: { id: true, orderRef: true } },
      },
    });

    if (!ticket) {
      const error = new ValidationError('Ticket not found');
      error.redemptionStatus = 'INVALID';
      error.statusCode = 400;
      throw error;
    }

    const eventExpired = new Date(ticket.event.date) < new Date();

    // Lazy-expire all VALID tickets in order in one batch if event has passed
    if (eventExpired) {
      await prisma.ticket.updateMany({
        where: { orderId: ticket.order.id, status: 'VALID' },
        data: { status: 'EXPIRED' },
      });
    }

    // Fetch all tickets in the same order (after expiry so statuses are current)
    const allTickets = await prisma.ticket.findMany({
      where: { orderId: ticket.order.id },
      include: {
        priceTier: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { ticketNumber: 'asc' },
    });

    return {
      scannedTicketId: ticket.id,
      orderRef: ticket.order.orderRef,
      eventName: ticket.event.name,
      eventDate: ticket.event.date,
      eventId: ticket.event.id,
      totalTickets: allTickets.length,
      tickets: allTickets.map((t) => ({
        ticketId: t.id,
        barcode: t.barcode,
        ticketNumber: t.ticketNumber,
        status: t.status,
        priceTierName: t.priceTier?.name,
        contactName: `${t.contact?.firstName ?? ''} ${t.contact?.lastName ?? ''}`.trim(),
        contactEmail: t.contact?.email ?? '',
        redeemedAt: t.redeemedAt,
      })),
    };
  }

  // ─── Formatters ───

  async _formatTicketDetail(ticket) {
    // Generate QR code image using short jump:// payload for easy scanning
    let qrCode = null;
    const qrPayload = this._getQrPayload(ticket);
    if (qrPayload) {
      try {
        qrCode = await qrService.generateQRCodeImage(qrPayload);
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

    // Compute sale status from tier dates
    const now = new Date();
    const saleStart = ticket.priceTier?.saleStartDate ? new Date(ticket.priceTier.saleStartDate) : null;
    const saleEnd = ticket.priceTier?.saleEndDate ? new Date(ticket.priceTier.saleEndDate) : null;
    let saleStatus = 'ON_SALE';
    if (saleStart && now < saleStart) saleStatus = 'NOT_STARTED';
    else if (saleEnd && now > saleEnd) saleStatus = 'ENDED';

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      barcode: ticket.barcode,
      qrCode,
      qrCodeJwt: ticket.qrCodeJwt || null,
      priceTierName: ticket.priceTier?.name,
      priceTierDescription: ticket.priceTier?.description || null,
      pricePaid: Number(ticket.pricePaid),
      saleStatus,
      saleEndDate: ticket.priceTier?.saleEndDate || null,
      isRefundable: ticket.priceTier?.isRefundable ?? false,
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
      priceBreakdown: ticket.order ? {
        subtotal: Number(ticket.order.subtotalAmount),
        platformFee: Number(ticket.order.platformFeeAmount),
        processingFee: Number(ticket.order.processingFeeAmount),
        tax: Number(ticket.order.taxAmount),
        total: Number(ticket.order.totalAmount),
      } : null,
    };
  }
}

export default new TicketService();
