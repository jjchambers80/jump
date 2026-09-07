// Order Service
// Handles order creation, lookup, and management
// Per FR-023, FR-024, FR-052, FR-053, FR-054, contracts/api.yaml

import { prisma } from '@jump/db';
import { randomBytes } from 'crypto';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler.js';
import qrService from './QRService.js';
import feeService from './FeeService.js';

class OrderService {
  /**
   * Generate a unique order reference (JMP-XXXXXX).
   * Uses alphanumeric uppercase characters (no 0/O/1/I).
   *
   * @returns {string} Order reference like JMP-A3BK7N
   */
  _generateOrderRef() {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += charset[bytes[i] % charset.length];
    }
    return `JMP-${code}`;
  }

  /**
   * Create a new order with atomic inventory reservation.
   *
   * Flow:
   * 1. Validate event is PUBLISHED
   * 2. Validate price tier exists, is active, has sufficient inventory
   * 3. Upsert Contact by email
   * 4. Create Order with PENDING status
   * 5. Reserve inventory (increment quantityReserved on PriceTier)
   * 6. Create Stripe Checkout session
   * 7. Return order + Stripe checkout URL
   *
   * @param {Object} params
   * @param {string} params.eventId
   * @param {{priceTierId: string, quantity: number}[]} params.items
   * @param {Object} params.contact - { email, firstName, lastName }
   * @param {string|null} params.userId - Authenticated user ID (if logged in)
   * @returns {Promise<{ orderId, orderRef, stripeCheckoutUrl }>}
   */
  async createOrder({ eventId, items, contact, userId = null }) {
    // Generate order ref outside transaction to avoid retry collisions
    let orderRef = this._generateOrderRef();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Validate event
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          venue: true,
        },
      });

      if (!event) {
        throw new NotFoundError('Event not found');
      }

      if (event.status !== 'PUBLISHED') {
        throw new ValidationError('Event is not available for purchase');
      }

      if (new Date(event.date) < new Date()) {
        throw new ValidationError('Event has already occurred');
      }

      // 2. Validate each price tier and reserve its inventory atomically
      const tiers = await tx.priceTier.findMany({
        where: {
          id: { in: items.map((item) => item.priceTierId) },
          eventId,
        },
        orderBy: { displayOrder: 'asc' },
      });

      if (tiers.length !== items.length) {
        throw new NotFoundError('Price tier not found for this event');
      }

      const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
      for (const item of items) {
        const tier = tierById.get(item.priceTierId);

        if (!tier.isActive) {
          throw new ValidationError(`${tier.name} is not active`);
        }
        if (tier.minPerOrder && item.quantity < tier.minPerOrder) {
          throw new ValidationError(
            `Minimum quantity per order for ${tier.name} is ${tier.minPerOrder}`
          );
        }
        if (tier.maxPerOrder && item.quantity > tier.maxPerOrder) {
          throw new ValidationError(
            `Maximum quantity per order for ${tier.name} is ${tier.maxPerOrder}`
          );
        }

        const reserved = await tx.$queryRawUnsafe(
          `UPDATE "PriceTier"
           SET "quantityReserved" = "quantityReserved" + $1
           WHERE "id" = $2
             AND ("quantityTotal" - "quantitySold" - "quantityReserved") >= $1
           RETURNING *`,
          item.quantity,
          item.priceTierId
        );

        if (!reserved || reserved.length === 0) {
          const current = await tx.priceTier.findUnique({ where: { id: item.priceTierId } });
          const available = current
            ? current.quantityTotal - current.quantitySold - current.quantityReserved
            : 0;
          throw new ConflictError(`Insufficient inventory for ${tier.name}`, {
            priceTierId: item.priceTierId,
            available,
            requested: item.quantity,
          });
        }
      }

      // 3. Upsert contact
      const contactRecord = await tx.contact.upsert({
        where: { email: contact.email.toLowerCase() },
        update: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...(userId && { userId }),
        },
        create: {
          email: contact.email.toLowerCase(),
          firstName: contact.firstName,
          lastName: contact.lastName,
          ...(userId && { userId }),
        },
      });

      // 4. Calculate total with fee breakdown (FTC all-in pricing)
      const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const feeItems = items.map((item) => ({
        unitPrice: Number(tierById.get(item.priceTierId).price),
        quantity: item.quantity,
      }));
      const fees = feeService.computeOrderFees(feeItems);

      // Ensure unique orderRef
      let existingRef = await tx.order.findUnique({ where: { orderRef } });
      while (existingRef) {
        orderRef = this._generateOrderRef();
        existingRef = await tx.order.findUnique({ where: { orderRef } });
      }

      // 5. Create order with fee breakdown
      const order = await tx.order.create({
        data: {
          eventId,
          contactId: contactRecord.id,
          orderRef,
          totalAmount: fees.total,
          subtotalAmount: fees.subtotal,
          platformFeeAmount: fees.platformFee,
          processingFeeAmount: fees.processingFee,
          taxAmount: fees.tax,
          currency: 'usd',
          quantity,
          status: 'PENDING',
          items: {
            create: items.map((item, idx) => ({
              priceTierId: item.priceTierId,
              quantity: item.quantity,
              unitPrice: tierById.get(item.priceTierId).price,
              platformFee: fees.itemBreakdowns[idx].platformFee,
              processingFee: fees.itemBreakdowns[idx].processingFee,
            })),
          },
        },
      });

      // 6. Inventory already reserved atomically in step 2 above

      return { order, event, tiers, contactRecord, fees };
    });

    const { order, event, tiers, contactRecord, fees } = result;
    const itemByTierId = new Map(items.map((item, idx) => [item.priceTierId, { ...item, feeIdx: idx }]));

    // 7. Create Stripe Checkout session (outside transaction — external call)
    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: contactRecord.email,
        line_items: tiers.map((tier) => {
          const itemWithIdx = itemByTierId.get(tier.id);
          const breakdown = fees.itemBreakdowns[itemWithIdx.feeIdx];
          // All-in unit price: base + proportional fees per ticket
          const allInUnitCents = Math.round((breakdown.lineTotal / breakdown.quantity) * 100);
          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${event.name} — ${tier.name}`,
                description: `Tickets for ${event.name} at ${event.venue.name}`,
              },
              unit_amount: allInUnitCents,
            },
            quantity: itemWithIdx.quantity,
          };
        }),
        metadata: {
          orderId: order.id,
          orderRef: order.orderRef,
          eventId: event.id,
        },
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/confirmation?orderId=${order.id}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/events/${event.id}?status=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
      });
    } catch (stripeError) {
      // Roll back reservation if Stripe fails
      logger.error('Stripe session creation failed, rolling back reservation', {
        orderId: order.id,
        error: stripeError.message,
      });
      await prisma.$transaction([
        ...items.map((item) =>
          prisma.priceTier.update({
            where: { id: item.priceTierId },
            data: { quantityReserved: { decrement: item.quantity } },
          })
        ),
        prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        }),
      ]);
      throw stripeError;
    }

    // Link Stripe session to order
    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: stripeSession.id },
    });

    // Create payment transaction record
    await prisma.paymentTransaction.create({
      data: {
        orderId: order.id,
        stripePaymentIntentId: stripeSession.payment_intent || null,
        amount: order.totalAmount,
        currency: order.currency,
        status: 'PENDING',
      },
    });

    logger.info('Order created', {
      orderId: order.id,
      orderRef: order.orderRef,
      eventId: event.id,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
    });

    return {
      orderId: order.id,
      orderRef: order.orderRef,
      stripeCheckoutUrl: stripeSession.url,
      totalAmount: Number(order.totalAmount),
    };
  }

  /**
   * Get order by ID with full details (event, contact, tickets, payment).
   *
   * @param {string} orderId
   * @returns {Promise<Object>} OrderDetail
   */
  async getOrderById(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: {
          include: {
            venue: {
              select: { id: true, name: true, address: true },
            },
          },
        },
        contact: {
          select: { firstName: true, lastName: true, email: true },
        },
        tickets: {
          include: {
            priceTier: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        items: {
          include: { priceTier: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    return await this._formatOrderDetail(order);
  }

  /**
   * Get orders for a contact by email (authenticated user's orders).
   *
   * @param {string} email - User email
   * @param {Object} pagination
   * @returns {Promise<{ data: OrderSummary[], pagination }>}
   */
  async getMyOrders(email, { page = 1, limit = 20 } = {}) {
    const contact = await prisma.contact.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!contact) {
      return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { contactId: contact.id },
        include: {
          event: {
            select: { name: true, date: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({
        where: { contactId: contact.id },
      }),
    ]);

    return {
      data: orders.map((o) => this._formatOrderSummary(o)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lookup order by email + orderRef (guest lookup).
   *
   * @param {string} email
   * @param {string} orderRef
   * @returns {Promise<Object>} OrderDetail
   */
  async lookupOrder(email, orderRef) {
    const order = await prisma.order.findFirst({
      where: {
        orderRef: orderRef.toUpperCase(),
        contact: { email: email.toLowerCase() },
      },
      include: {
        event: {
          include: {
            venue: {
              select: { id: true, name: true, address: true },
            },
          },
        },
        contact: {
          select: { firstName: true, lastName: true, email: true },
        },
        tickets: {
          include: {
            priceTier: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        items: {
          include: { priceTier: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    return await this._formatOrderDetail(order);
  }

  /**
   * Get all orders for an event (org-scoped).
   *
   * @param {string} eventId
   * @param {Object} pagination
   * @returns {Promise<{ data: OrderSummary[], pagination }>}
   */
  async getOrdersByEvent(eventId, { page = 1, limit = 20 } = {}) {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { eventId },
        include: {
          event: {
            select: { name: true, date: true },
          },
          contact: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({
        where: { eventId },
      }),
    ]);

    return {
      data: orders.map((o) => this._formatOrderSummary(o)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Complete an order after successful payment.
   * Called by webhook handler.
   *
   * @param {string} orderId
   */
  async completeOrder(orderId) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED' },
    });

    logger.info('Order completed', { orderId });
  }

  /**
   * Fail an order (release reserved inventory).
   * Called by webhook handler on payment failure or session expiry.
   *
   * @param {string} orderId
   * @param {string} reason
   */
  async failOrder(orderId, reason) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order || order.status !== 'PENDING') {
      logger.warn('Cannot fail order — not in PENDING status', {
        orderId,
        currentStatus: order?.status,
      });
      return;
    }

    let orderItems = order.items;
    if (orderItems.length === 0 && order.stripeSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        if (session.metadata?.priceTierId) {
          orderItems = [{ priceTierId: session.metadata.priceTierId, quantity: order.quantity }];
        }
      } catch {
        logger.warn('Could not retrieve Stripe session for legacy inventory release', { orderId });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'FAILED' },
      });

      // Release reserved inventory for every cart item
      for (const item of orderItems) {
        await tx.priceTier.update({
          where: { id: item.priceTierId },
          data: {
            quantityReserved: { decrement: item.quantity },
          },
        });
      }
    });

    logger.info('Order failed — inventory released', {
      orderId,
      reason,
      quantity: order.quantity,
    });
  }

  /**
   * Verify payment with Stripe and complete the order if paid.
   * This is a belt-and-suspenders approach alongside webhooks.
   * Idempotent: if already COMPLETED, returns the order as-is.
   *
   * @param {string} orderId
   * @returns {Promise<Object>} Updated order detail
   */
  async verifyAndCompleteOrder(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { event: true, contact: true },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Already completed — return formatted detail
    if (order.status === 'COMPLETED') {
      return this.getOrderById(orderId);
    }

    // Only verify PENDING orders
    if (order.status !== 'PENDING' || !order.stripeSessionId) {
      return this.getOrderById(orderId);
    }

    // Check Stripe session status directly
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);

    if (session.payment_status === 'paid') {
      // Delegate to PaymentService for the full completion flow
      // (update payment transaction, create tickets, send email)
      const PaymentService = (await import('./PaymentService.js')).default;
      await PaymentService.handleCheckoutCompleted(order.stripeSessionId, session.payment_intent);
      logger.info('Order verified and completed via direct Stripe check', {
        orderId: order.id,
        orderRef: order.orderRef,
      });
    }

    return this.getOrderById(orderId);
  }

  /**
   * Get order by Stripe session ID.
   * Used by webhook handler.
   *
   * @param {string} stripeSessionId
   * @returns {Promise<Object|null>}
   */
  async getOrderByStripeSession(stripeSessionId) {
    return prisma.order.findUnique({
      where: { stripeSessionId },
      include: {
        event: true,
        contact: true,
      },
    });
  }

  // ─── Formatters ─────────────────────────────────────────

  async _formatOrderDetail(order) {
    // Generate QR code data URL images from JWT tokens
    const tickets = [];
    for (const t of order.tickets || []) {
      let qrCodeDataUrl = null;
      if (t.qrCodeJwt) {
        try {
          qrCodeDataUrl = await qrService.generateQRCodeImage(t.qrCodeJwt);
        } catch (err) {
          logger.warn('Failed to generate QR image for order detail', {
            ticketId: t.id,
            error: err.message,
          });
        }
      }
      tickets.push({
        id: t.id,
        barcode: t.barcode,
        qrCodeDataUrl,
        priceTierName: t.priceTier?.name,
        pricePaid: Number(t.pricePaid),
        status: t.status,
        redeemedAt: t.redeemedAt,
        createdAt: t.createdAt,
      });
    }

    return {
      id: order.id,
      orderRef: order.orderRef,
      event: {
        id: order.event.id,
        name: order.event.name,
        date: order.event.date,
        venue: order.event.venue
          ? {
              id: order.event.venue.id,
              name: order.event.venue.name,
              address: order.event.venue.address,
            }
          : undefined,
      },
      contact: order.contact,
      quantity: order.quantity,
      items: (order.items || []).map((item) => ({
        priceTierId: item.priceTierId,
        priceTierName: item.priceTier?.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        platformFee: Number(item.platformFee),
        processingFee: Number(item.processingFee),
        lineTotal: Number(item.unitPrice) * item.quantity + Number(item.platformFee) + Number(item.processingFee),
      })),
      subtotalAmount: Number(order.subtotalAmount),
      platformFeeAmount: Number(order.platformFeeAmount),
      processingFeeAmount: Number(order.processingFeeAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      currency: order.currency,
      status: order.status,
      tickets,
      payment: order.payment
        ? {
            id: order.payment.id,
            amount: Number(order.payment.amount),
            currency: order.payment.currency,
            status: order.payment.status,
            failureReason: order.payment.failureReason,
            createdAt: order.payment.createdAt,
          }
        : null,
      createdAt: order.createdAt,
    };
  }

  _formatOrderSummary(order) {
    return {
      id: order.id,
      orderRef: order.orderRef,
      eventName: order.event?.name,
      eventDate: order.event?.date,
      quantity: order.quantity,
      subtotalAmount: Number(order.subtotalAmount),
      platformFeeAmount: Number(order.platformFeeAmount),
      processingFeeAmount: Number(order.processingFeeAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      currency: order.currency,
      status: order.status,
      contact: order.contact
        ? {
            firstName: order.contact.firstName,
            lastName: order.contact.lastName,
            email: order.contact.email,
          }
        : undefined,
      createdAt: order.createdAt,
    };
  }
}

export default new OrderService();
