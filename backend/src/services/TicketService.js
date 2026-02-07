// Ticket Service
// Handles ticket creation with atomic inventory management per FR-004, FR-009

import { PrismaClient } from '@prisma/client';
import { NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { recordTicketSale } from '../utils/metrics.js';
import { logTicketPurchase } from '../utils/logger.js';

const prisma = new PrismaClient();

class TicketService {
  /**
   * Create tickets after successful payment with atomic transaction
   * @param {string} paymentTransactionId - UUID of payment transaction
   * @param {string} eventId - UUID of the event
   * @param {string} customerId - UUID of the customer
   * @param {number} quantity - Number of tickets to create
   * @param {string} stripeTxId - Stripe transaction ID
   * @param {string} correlationId - Request correlation ID
   * @returns {Promise<Array>} Created tickets
   */
  async createTicketsAfterPayment(
    paymentTransactionId,
    eventId,
    customerId,
    quantity,
    stripeTxId,
    correlationId
  ) {
    // Use Prisma transaction for atomic operation
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get event with current ticket count (FOR UPDATE to lock row)
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          _count: {
            select: { tickets: true },
          },
        },
      });

      if (!event) {
        throw new NotFoundError('Event not found');
      }

      // 2. Check capacity (atomic check)
      const soldTickets = event._count.tickets;
      const availableTickets = event.capacity - soldTickets;

      if (availableTickets < quantity) {
        throw new ConflictError(
          `Insufficient capacity. Only ${availableTickets} tickets available.`,
          { requested: quantity, available: availableTickets }
        );
      }

      // 3. Create tickets
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticket = await tx.ticket.create({
          data: {
            eventId,
            customerId,
            pricePaid: event.ticketPrice,
            status: 'VALID',
            stripeTxId,
            qrCodeJwt: '', // Will be set later by QRService
          },
        });
        tickets.push(ticket);
      }

      return { tickets, event };
    });

    // Record metrics
    result.tickets.forEach(() => {
      recordTicketSale(eventId);
    });

    // Log purchase
    logTicketPurchase({
      customerId,
      eventId,
      ticketIds: result.tickets.map((t) => t.id),
      amount: result.event.ticketPrice * quantity,
      stripeTxId,
      correlationId,
    });

    return result.tickets;
  }

  /**
   * Get tickets by Stripe transaction ID
   * @param {string} stripeTxId - Stripe transaction ID
   * @returns {Promise<Array>} Tickets with event details
   */
  async getTicketsByStripeTransaction(stripeTxId) {
    const tickets = await prisma.ticket.findMany({
      where: { stripeTxId },
      include: {
        event: {
          select: {
            name: true,
            date: true,
            venue: true,
          },
        },
        customer: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    if (tickets.length === 0) {
      throw new NotFoundError('Tickets not found for this transaction');
    }

    return tickets;
  }

  /**
   * Update ticket with QR code
   * @param {string} ticketId - UUID of the ticket
   * @param {string} qrCodeJwt - JWT token for QR code
   * @returns {Promise<Object>} Updated ticket
   */
  async updateTicketQRCode(ticketId, qrCodeJwt) {
    return await prisma.ticket.update({
      where: { id: ticketId },
      data: { qrCodeJwt },
    });
  }

  /**
   * Get ticket by ID
   * @param {string} ticketId - UUID of the ticket
   * @returns {Promise<Object>} Ticket with event and customer details
   */
  async getTicketById(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        customer: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    return ticket;
  }

  /**
   * Get tickets by customer ID with expiration logic
   * Orders by event date descending per FR-017
   * Marks tickets as EXPIRED when event.date + 1 hour < NOW() per FR-018
   * @param {string} customerId - UUID of the customer
   * @returns {Promise<Array>} Customer's tickets with event details
   */
  async getCustomerTickets(customerId) {
    const tickets = await prisma.ticket.findMany({
      where: { customerId },
      include: {
        event: {
          select: {
            name: true,
            date: true,
            venue: true,
          },
        },
      },
      orderBy: {
        event: {
          date: 'desc',
        },
      },
    });

    // Apply expiration logic: mark EXPIRED when event.date + 1 hour < NOW()
    const now = new Date();
    const expiredTicketIds = [];

    for (const ticket of tickets) {
      if (ticket.status === 'VALID' && ticket.event?.date) {
        const expirationTime = new Date(ticket.event.date.getTime() + 60 * 60 * 1000);
        if (expirationTime < now) {
          expiredTicketIds.push(ticket.id);
          ticket.status = 'EXPIRED';
        }
      }
    }

    // Batch update expired tickets in database
    if (expiredTicketIds.length > 0) {
      await prisma.ticket.updateMany({
        where: { id: { in: expiredTicketIds } },
        data: { status: 'EXPIRED' },
      });
    }

    return tickets;
  }

  /**
   * Get tickets by customer ID (legacy - orders by purchaseTime)
   * @param {string} customerId - UUID of the customer
   * @returns {Promise<Array>} Customer's tickets
   */
  async getTicketsByCustomer(customerId) {
    return await prisma.ticket.findMany({
      where: { customerId },
      include: {
        event: {
          select: {
            name: true,
            date: true,
            venue: true,
          },
        },
      },
      orderBy: {
        purchaseTime: 'desc',
      },
    });
  }

  /**
   * Mark ticket as redeemed
   * @param {string} ticketId - UUID of the ticket
   * @returns {Promise<Object>} Updated ticket
   */
  async redeemTicket(ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    if (ticket.status === 'REDEEMED') {
      throw new ConflictError('Ticket already redeemed');
    }

    if (ticket.status === 'EXPIRED') {
      throw new ConflictError('Ticket has expired');
    }

    return await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'REDEEMED' },
    });
  }
}

export default new TicketService();
