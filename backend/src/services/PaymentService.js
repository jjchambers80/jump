// Payment Service
// Handles Stripe payment integration per FR-003

import { PrismaClient } from '@prisma/client';
import stripe from '../config/stripe.js';
import { NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import EventService from './EventService.js';
import { recordPaymentStatus } from '../utils/metrics.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

class PaymentService {
  /**
   * Create Stripe Checkout Session for ticket purchase
   * @param {string} eventId - UUID of the event
   * @param {number} quantity - Number of tickets (1-10)
   * @param {string} customerEmail - Customer email address
   * @param {string} correlationId - Request correlation ID
   * @returns {Promise<{sessionId: string, checkoutUrl: string}>}
   */
  async createStripeCheckoutSession(eventId, quantity, customerEmail, correlationId) {
    const log = logger;

    // Get event details and check availability
    const event = await EventService.getEventWithTicketCount(eventId);

    // Check if event is published
    if (event.status !== 'PUBLISHED') {
      throw new NotFoundError('Event not found');
    }

    // Check capacity
    if (event.availableTickets < quantity) {
      log.warn('Insufficient capacity', {
        eventId,
        requested: quantity,
        available: event.availableTickets,
        correlationId,
      });
      throw new ConflictError(
        `Insufficient capacity. Only ${event.availableTickets} tickets available.`,
        { requested: quantity, available: event.availableTickets }
      );
    }

    // Calculate total amount (convert Prisma Decimal to Number, then to cents for Stripe)
    const unitPriceDollars = Number(event.ticketPrice);
    const unitPriceCents = Math.round(unitPriceDollars * 100);
    const totalAmount = unitPriceDollars * quantity;

    // Create or find customer
    let customer = await prisma.customer.findUnique({
      where: { email: customerEmail },
    });

    if (!customer) {
      // Create new customer
      customer = await prisma.customer.create({
        data: {
          email: customerEmail,
          name: customerEmail.split('@')[0], // Temporary name
          passwordHash: '', // Empty for now, will be set on registration
        },
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: event.name,
              description: `${quantity} ticket(s) for ${event.name} at ${event.venue}`,
              metadata: {
                eventId: event.id,
                eventDate: event.date.toISOString(),
                venue: event.venue,
              },
            },
            unit_amount: unitPriceCents,
          },
          quantity,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/events/${eventId}`,
      customer_email: customerEmail,
      metadata: {
        eventId: event.id,
        customerId: customer.id,
        quantity: quantity.toString(),
        correlationId,
      },
    });

    // Create payment transaction record (PENDING status)
    await prisma.paymentTransaction.create({
      data: {
        stripeSessionId: session.id,
        customerId: customer.id,
        eventId: event.id,
        amount: totalAmount,
        currency: 'USD',
        status: 'PENDING',
      },
    });

    log.info('Stripe checkout session created', {
      sessionId: session.id,
      eventId,
      customerId: customer.id,
      quantity,
      amount: totalAmount,
      correlationId,
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
    };
  }

  /**
   * Update payment transaction status (called by webhook)
   * @param {string} stripeSessionId - Stripe checkout session ID
   * @param {string} status - Payment status (SUCCEEDED, FAILED)
   * @param {string} failureReason - Optional failure reason
   */
  async updatePaymentStatus(stripeSessionId, status, failureReason = null) {
    const payment = await prisma.paymentTransaction.findUnique({
      where: { stripeSessionId },
    });

    if (!payment) {
      throw new NotFoundError('Payment transaction not found');
    }

    // Prevent duplicate processing
    if (payment.status === status) {
      logger.info('Payment status already updated', { stripeSessionId, status });
      return payment;
    }

    // Update status
    const updated = await prisma.paymentTransaction.update({
      where: { stripeSessionId },
      data: {
        status,
        failureReason,
      },
    });

    // Record metrics
    recordPaymentStatus(status.toLowerCase());

    logger.info('Payment status updated', {
      stripeSessionId,
      status,
      failureReason,
    });

    return updated;
  }

  /**
   * Get payment transaction by Stripe session ID
   * @param {string} stripeSessionId - Stripe checkout session ID
   * @returns {Promise<Object>} Payment transaction
   */
  async getPaymentBySessionId(stripeSessionId) {
    const payment = await prisma.paymentTransaction.findUnique({
      where: { stripeSessionId },
      include: {
        customer: true,
        event: true,
      },
    });

    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    return payment;
  }
}

export default new PaymentService();
