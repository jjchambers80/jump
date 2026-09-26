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
import PaymentSettingsService from './PaymentSettingsService.js';
import addOnService from './AddOnService.js';
import { confirmationUrl, eventUrl } from '../utils/storefrontUrl.js';
import orderLineService, { ORDER_INCLUDE } from './OrderLineService.js';
import legalAcceptanceService from './LegalAcceptanceService.js';
import { checkoutAcceptanceRequired } from '../config/legal.js';

/** Include for org-wide order rows (spec 024 phase 2): enough to describe either kind without a second query. */
const LIST_INCLUDE = {
  event: { select: { id: true, name: true, date: true, venue: { select: { timezone: true, organization: { select: { id: true, name: true } } } } } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  payment: { select: { source: true, stripePaymentIntentId: true, stripeAccountId: true, status: true } },
  items: { select: { kind: true, quantity: true, description: true, unitPrice: true, priceTier: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  addOns: { select: { quantity: true, addOn: { select: { name: true } } } },
  refunds: { where: { status: 'SUCCEEDED' }, select: { id: true, amount: true, stripeRefundId: true, manual: true, disputeId: true, createdAt: true } },
  // Spec 037: a chargeback's money-out is a Refund row, so `refunded` / `net`
  // are already right — this is what tells the row apart from a refund.
  disputes: { select: { id: true, state: true, amount: true, reason: true, fundsWithdrawn: true, inquiry: true, openedAt: true }, orderBy: { openedAt: 'desc' } },
  application: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      stripeCheckoutSessionId: true,
      profile: { select: { businessName: true } },
      tier: { select: { name: true } },
      form: { select: { name: true } },
    },
  },
};

const APPLICATION_PAYMENT_LABEL = {
  AWAITING_CARD: 'Awaiting card',
  CARD_ON_FILE: 'Card on file',
  PROCESSING: 'Processing',
  PAYMENT_DUE: 'Payment due',
  NOT_REQUIRED: 'Waived',
};

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Stripe Checkout sessions are created with a 30-minute expiry (createOrder). */
const SESSION_TTL_MS = 30 * 60 * 1000;
const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? Math.floor(n) : fallback;
};
/** Open (PENDING) ticket checkouts one email may hold on one event (spec 020). */
export const maxPendingPerContact = () => envInt('ORDER_MAX_PENDING_PER_CONTACT', 3);
/** How long after a session's expiry the sweep waits before releasing a hold. */
export const sweepGraceMs = () => envInt('ORDER_SWEEP_GRACE_MS', 5 * 60 * 1000);

class OrderService {
  /**
   * Get the scannable QR payload for a ticket.
   * If stored value is already jump:// format, use it directly.
   * If stored value is legacy JWT, regenerate as jump:// format.
   */
  _getQrPayload(ticket, eventId) {
    if (ticket.qrCodeJwt && qrService.isJumpPayload(ticket.qrCodeJwt)) {
      return ticket.qrCodeJwt;
    }
    const eid = ticket.eventId || eventId;
    if (ticket.barcode && eid) {
      return qrService.generateQRPayload(ticket.id, eid, ticket.barcode);
    }
    return ticket.qrCodeJwt || null;
  }

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

  /** A fresh orderRef that no order holds, checked inside `tx`. */
  async _uniqueOrderRef(tx) {
    let orderRef = this._generateOrderRef();
    while (await tx.order.findUnique({ where: { orderRef }, select: { id: true } }))
      orderRef = this._generateOrderRef();
    return orderRef;
  }

  /**
   * Spec 024: the order for a PAID-form application, created inside the
   * submission transaction. PENDING until the charge succeeds; the lines are
   * the amount snapshot (tier, add-ons, adjustments). No inventory here — the
   * application's tier slot and add-on holds are taken at approval.
   *
   * @param {import('@prisma/client').Prisma.TransactionClient} tx
   * @param {{ application: { id, eventId, contactId }, data: { amounts, items, addOns }, currency?: string }} params
   */
  async createApplicationOrder(tx, { application, data, currency = 'usd' }) {
    const orderRef = await this._uniqueOrderRef(tx);
    return tx.order.create({
      data: {
        kind: 'APPLICATION',
        eventId: application.eventId,
        contactId: application.contactId,
        applicationId: application.id,
        orderRef,
        ...orderLineService.totalsData(data.amounts),
        currency,
        quantity: 1,
        status: 'PENDING',
        items: { create: data.items },
        addOns: { create: data.addOns },
      },
      include: ORDER_INCLUDE,
    });
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
   * @param {boolean} [params.createAccount] - Buyer opted into a login-enabled account at this org
   * @param {boolean} [params.emailSubscribed] - Buyer opted into marketing email from this org
   * @param {Array<{ document: string, version: string }>} [params.acceptances] - Legal versions the checkout showed (spec 024 phase 3)
   * @param {{ ipHash: string|null, userAgent: string|null }} [params.requestMeta]
   * @returns {Promise<{ orderId, orderRef, stripeCheckoutUrl }>}
   */
  async createOrder({ eventId, items, addOns = [], contact, createAccount = false, emailSubscribed = false, acceptances = undefined, requestMeta = { ipHash: null, userAgent: null } }) {
    // Generate order ref outside transaction to avoid retry collisions
    let orderRef = this._generateOrderRef();

    // Consent trail (spec 024 phase 3): the checkout page always sends the
    // versions it showed; a client that sends none is refused only once the
    // legal pages are live (LEGAL_ACCEPTANCE_REQUIRED), logged until then.
    let accepted = [];
    if (acceptances !== undefined || checkoutAcceptanceRequired()) {
      accepted = legalAcceptanceService.assertCurrent(acceptances, ['TERMS', 'PRIVACY']);
    } else {
      logger.warn('Checkout without legal acceptances', { event: 'legal_acceptance_missing', eventId, email: contact?.email });
    }

    // Add-on lines (spec 012): validated against scope / attachment / max
    // before the transaction; quantity is reserved inside it, after the tiers.
    const addOnLines = await addOnService.validateOrderLines(
      eventId,
      addOns,
      items.map((item) => item.priceTierId)
    );

    const result = await prisma.$transaction(async (tx) => {
      // 1. Validate event
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          venue: {
            include: {
              organization: {
                select: { id: true, name: true, taxInclusivePricing: true, statementDescriptorSuffix: true, enabledPaymentMethods: true },
              },
            },
          },
        },
      });

      if (!event) {
        throw new NotFoundError('Event not found');
      }

      if (event.admissionMode === 'RSVP') {
        const error = new ConflictError('RSVP events do not sell tickets');
        error.code = 'EVENT_NOT_TICKETED';
        throw error;
      }

      if (event.status !== 'PUBLISHED') {
        throw new ValidationError('Event is not available for purchase');
      }

      if (new Date(event.date) < new Date()) {
        throw new ValidationError('Event has already occurred');
      }

      // 1b. Per-buyer hold cap (spec 020): open (PENDING) checkouts for this
      // email on this event, before anything is reserved. Abandoned holds are
      // released by the sweep and by Stripe's session expiry.
      const holdEmail = String(contact.email || '').toLowerCase();
      const [{ open }] = await tx.$queryRaw`
        SELECT COUNT(*)::int AS open FROM "Order" o
        JOIN "Contact" c ON c."id" = o."contactId"
        WHERE o."eventId" = ${eventId} AND o."status" = 'PENDING'::"OrderStatus" AND o."kind" = 'TICKET'::"OrderKind"
          AND c."organizationId" = ${event.venue.organizationId} AND c."email" = ${holdEmail}
      `;
      if (open >= maxPendingPerContact()) {
        throw new ConflictError('You already have tickets on hold for this event. Finish that checkout or wait for it to expire.', { open, max: maxPendingPerContact() });
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

      // 2b. Reserve add-on quantities (after the tiers, fixed lock order)
      await addOnService.reserve(tx, addOnLines);

      // 3. Upsert contact — scoped to the event's organization (spec 007).
      // The same email buying from two organizations is two Contact rows.
      const organizationId = event.venue.organizationId;
      const email = contact.email.toLowerCase();
      // Opt-ins are recorded on the Order (below) and applied to the Contact
      // by PaymentService once the payment completes, never here.
      // Buyers are never linked to User (spec 007 D1); a staff session in the
      // browser must not attach itself to the buyer record.
      const contactRecord = await tx.contact.upsert({
        where: { organizationId_email: { organizationId, email } },
        update: {
          firstName: contact.firstName,
          lastName: contact.lastName,
        },
        create: {
          organizationId,
          email,
          firstName: contact.firstName,
          lastName: contact.lastName,
        },
      });

      // 4. Calculate total with fee breakdown (FTC all-in pricing)
      const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const feeItems = [
        ...items.map((item) => ({
          unitPrice: Number(tierById.get(item.priceTierId).price),
          quantity: item.quantity,
        })),
        // Add-on lines follow the tier lines; index = items.length + i
        ...addOnLines.map((line) => ({
          unitPrice: Number(line.addOn.price),
          quantity: line.quantity,
          taxable: line.addOn.taxable,
        })),
      ];
      const fees = feeService.computeOrderFees(feeItems, Number(event.taxRate || 0), {
        taxInclusive: event.venue.organization?.taxInclusivePricing === true,
      });

      // Ensure unique orderRef
      if (await tx.order.findUnique({ where: { orderRef }, select: { id: true } }))
        orderRef = await this._uniqueOrderRef(tx);

      // 5. Create order with fee breakdown
      const order = await tx.order.create({
        data: {
          kind: 'TICKET',
          eventId,
          contactId: contactRecord.id,
          orderRef,
          totalAmount: fees.total,
          subtotalAmount: fees.subtotal,
          platformFeeAmount: fees.platformFee,
          processingFeeAmount: fees.processingFee,
          taxAmount: fees.tax,
          orgReceives: fees.subtotal, // ticket fees are always passed to the buyer
          feeMode: 'PASS',
          currency: 'usd',
          quantity,
          status: 'PENDING',
          optInAccount: createAccount === true,
          optInMarketing: emailSubscribed === true,
          items: {
            create: items.map((item, idx) => ({
              kind: 'TICKET_TIER',
              priceTierId: item.priceTierId,
              description: tierById.get(item.priceTierId).name,
              quantity: item.quantity,
              unitPrice: tierById.get(item.priceTierId).price,
              platformFee: fees.itemBreakdowns[idx].platformFee,
              processingFee: fees.itemBreakdowns[idx].processingFee,
              tax: fees.itemBreakdowns[idx].tax,
            })),
          },
          addOns: {
            create: addOnLines.map((line, i) => {
              const breakdown = fees.itemBreakdowns[items.length + i];
              return {
                addOnId: line.addOn.id,
                quantity: line.quantity,
                unitPrice: line.addOn.price,
                platformFee: breakdown.platformFee,
                processingFee: breakdown.processingFee,
                tax: breakdown.tax,
              };
            }),
          },
        },
      });

      // 6. Inventory already reserved atomically in step 2 above

      if (accepted.length) {
        await legalAcceptanceService.record(
          tx,
          { subjectType: 'CONTACT', subjectId: contactRecord.id, email, organizationId, source: 'CHECKOUT', referenceType: 'Order', referenceId: order.id, ...requestMeta },
          accepted
        );
      }

      return { order, event, tiers, contactRecord, fees };
    });

    const { order, event, tiers, contactRecord, fees } = result;
    const itemByTierId = new Map(items.map((item, idx) => [item.priceTierId, { ...item, feeIdx: idx }]));

    // 7. Create Stripe Checkout session (outside transaction — external call).
    const lineItems = tiers.map((tier) => {
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
    });
    addOnLines.forEach((line, i) => {
      const breakdown = fees.itemBreakdowns[items.length + i];
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${event.name} — ${line.addOn.name}`,
            ...(line.addOn.description && { description: line.addOn.description }),
          },
          unit_amount: Math.round((breakdown.lineTotal / breakdown.quantity) * 100),
        },
        quantity: line.quantity,
      });
    });

    // Payment methods and the statement descriptor come from the organization's
    // Settings › Payments (spec 010); defaults to cards only. With an active
    // Connect account (phase 2) the same call turns this into a destination
    // charge; the routing outcome is read back below for the ledger.
    const checkoutOptions = await PaymentSettingsService.checkoutOptionsFor(event.venue.organization, {
      fees,
      lineItems,
    });
    const routedTo = checkoutOptions.payment_intent_data?.transfer_data?.destination || null;
    const applicationFeeCents = checkoutOptions.payment_intent_data?.application_fee_amount;
    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...checkoutOptions,
        customer_email: contactRecord.email,
        line_items: lineItems,
        metadata: {
          orderId: order.id,
          orderRef: order.orderRef,
          eventId: event.id,
          ...(routedTo && { stripeAccountId: routedTo }),
        },
        // Return the buyer to the storefront they started on (custom domain when active)
        success_url: await confirmationUrl(order.id, event.venue.organizationId),
        cancel_url: await eventUrl(event.id, event.venue.organizationId, '?status=cancelled'),
        expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
      });
    } catch (stripeError) {
      // Roll back reservation if Stripe fails
      logger.error('Stripe session creation failed, rolling back reservation', {
        orderId: order.id,
        error: stripeError.message,
      });
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          await tx.priceTier.update({
            where: { id: item.priceTierId },
            data: { quantityReserved: { decrement: item.quantity } },
          });
        }
        await addOnService.release(tx, addOnLines.map((line) => ({ addOnId: line.addOn.id, quantity: line.quantity })));
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        });
      });
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
        stripeAccountId: routedTo,
        applicationFee: routedTo ? applicationFeeCents / 100 : null,
      },
    });

    if (routedTo) {
      logger.info('Order charge routed to connected account', {
        event: 'connect_charge_routed',
        orderId: order.id,
        stripeAccountId: routedTo,
        applicationFee: applicationFeeCents / 100,
        subtotal: fees.subtotal,
      });
    }

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
              select: {
                id: true,
                name: true,
                address: true,
                timezone: true,
                organization: { select: { id: true, name: true, logoUrl: true, brandColor: true, themeMode: true } },
              },
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
          include: {
            priceTier: { select: { name: true } },
            applicationTier: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        addOns: {
          include: { addOn: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        payment: true,
        application: {
          select: {
            id: true,
            eventId: true,
            status: true,
            paymentStatus: true,
            capacitySlot: true,
            form: { select: { id: true, name: true, kind: true } },
            tier: { select: { id: true, name: true } },
            profile: { select: { businessName: true } },
            // Spec 014 phase 2: the booth this order bought (SOLD / RESERVED holder)
            booth: { select: { id: true, label: true, w: true, h: true, status: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    return await this._formatOrderDetail(order);
  }

  /**
   * Orders owned by one org-scoped Contact (buyer session).
   * @param {string} contactId
   * @param {Object} pagination
   */
  async getOrdersForContact(contactId, pagination = {}) {
    // Both kinds (spec 024 phase 2): application orders link to the status page through `applicationId`.
    return this.listOrders({ contactId, status: { notIn: ['FAILED', 'CANCELLED'] } }, pagination);
  }

  /**
   * Shared paginated order summary listing.
   * @param {Object} where - Prisma Order where clause
   * @param {Object} pagination - { page, limit }
   */
  async listOrders(where, { page = 1, limit = 20 } = {}) {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this._formatOrderRow(o)),
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
              select: {
                id: true,
                name: true,
                address: true,
                timezone: true,
                organization: { select: { id: true, name: true, logoUrl: true, brandColor: true, themeMode: true } },
              },
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
   * Get all orders across an organization's events.
   *
   * @param {string} organizationId
   * @param {Object} options - { page, limit, status, eventId, search }
   * @returns {Promise<{ data: OrderSummary[], pagination }>}
   */
  async getOrdersByOrganization(organizationId, query = {}) {
    const { page = 1, limit = 20, sort = 'createdAt', dir = 'desc' } = query;
    const where = this._orgOrdersWhere(organizationId, query);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ [sort]: sort === 'paidAt' ? { sort: dir, nulls: 'last' } : dir }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this._formatOrderRow(o, { unscoped: !organizationId })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Prisma `where` for the org-wide order list (spec 024 phase 2). Both kinds
   * scope through `event.venue.organizationId`. `status` omitted hides FAILED
   * and CANCELLED; a Stripe id (`pi_`, `re_`, `pyr_`, `cs_`) is matched by
   * equality against the payment, the refunds and the Checkout sessions, any
   * other search term by ILIKE on the order ref, the contact and the business.
   */
  _orgOrdersWhere(organizationId, { kind, status, eventId, from, to, search } = {}) {
    const where = {
      ...(organizationId && { event: { venue: { organizationId } } }),
      ...(kind && { kind }),
      status: status && status.length ? { in: status } : { notIn: ['FAILED', 'CANCELLED'] },
      ...(eventId && { eventId }),
      ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
    };
    if (search) {
      const term = search.trim();
      if (/^(pi|re|pyr|cs)_/.test(term)) {
        where.OR = [
          { payment: { stripePaymentIntentId: term } },
          { refunds: { some: { stripeRefundId: term } } },
          { stripeSessionId: term },
          { application: { stripeCheckoutSessionId: term } },
        ];
      } else {
        where.OR = [
          { orderRef: { contains: term.toUpperCase(), mode: 'insensitive' } },
          { contact: { email: { contains: term.toLowerCase(), mode: 'insensitive' } } },
          { contact: { firstName: { contains: term, mode: 'insensitive' } } },
          { contact: { lastName: { contains: term, mode: 'insensitive' } } },
          { application: { profile: { businessName: { contains: term, mode: 'insensitive' } } } },
        ];
      }
    }
    return where;
  }

  /**
   * CSV of the same rows plus the fee / tax breakdown, Stripe ids and one
   * `refund` line per succeeded refund. Streams pages of 500 through
   * `onChunk(text)`; honours every list filter, ignores paging.
   */
  async exportOrdersCsv(organizationId, query, onChunk) {
    const unscoped = !organizationId;
    const where = this._orgOrdersWhere(organizationId, query);
    const header = [
      'line', 'orderRef', 'kind', 'status', 'statusDetail', 'paymentSource', 'contactName', 'contactEmail', 'businessName',
      ...(unscoped ? ['organization'] : []),
      'event', 'eventDate', 'description', 'quantity', 'subtotal', 'platformFee', 'processingFee', 'tax', 'total', 'refunded', 'net',
      'stripePaymentIntentId', 'stripeCheckoutSessionId', 'stripeRefundId', 'stripeAccountId', 'createdAt', 'paidAt', 'applicationId',
    ];
    onChunk(`${header.map(csvCell).join(',')}\r\n`);
    const PAGE = 500;
    let cursor = null;
    for (;;) {
      const rows = await prisma.order.findMany({
        where,
        include: { ...LIST_INCLUDE, refunds: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (rows.length === 0) break;
      const lines = [];
      for (const o of rows) {
        const row = this._formatOrderRow(o, { unscoped });
        const base = [
          row.orderRef, row.kind, row.status, row.statusDetail?.label ?? '', row.paymentSource,
          `${row.contact?.firstName ?? ''} ${row.contact?.lastName ?? ''}`.trim(), row.contact?.email ?? '', row.businessName ?? '',
          ...(unscoped ? [row.organization?.name ?? ''] : []),
          row.eventName ?? '', o.event?.date?.toISOString() ?? '', row.description, row.quantity,
        ];
        lines.push([
          'order', ...base,
          row.subtotalAmount.toFixed(2), row.platformFeeAmount.toFixed(2), row.processingFeeAmount.toFixed(2), row.taxAmount.toFixed(2), row.totalAmount.toFixed(2), row.refunded.toFixed(2), row.net.toFixed(2),
          o.payment?.stripePaymentIntentId ?? '', o.stripeSessionId ?? o.application?.stripeCheckoutSessionId ?? '', '', o.payment?.stripeAccountId ?? '',
          o.createdAt.toISOString(), o.paidAt?.toISOString() ?? '', o.applicationId ?? '',
        ]);
        for (const r of o.refunds || []) {
          lines.push([
            'refund', ...base,
            '', '', '', '', '', Number(r.amount).toFixed(2), '',
            o.payment?.stripePaymentIntentId ?? '', '', r.stripeRefundId ?? (r.manual ? 'manual' : ''), o.payment?.stripeAccountId ?? '',
            r.createdAt.toISOString(), '', o.applicationId ?? '',
          ]);
        }
      }
      onChunk(`${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`);
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1].id;
    }
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
            select: { name: true, date: true, venue: { select: { timezone: true } } },
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
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', paidAt: new Date() },
      });
      // Add-on reservations → sold (tiers move in TicketService.createTicketsForOrder)
      const addOns = await tx.orderAddOn.findMany({ where: { orderId }, select: { addOnId: true, quantity: true } });
      await addOnService.commit(tx, addOns);
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
      include: { items: true, addOns: true },
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
      await addOnService.release(tx, order.addOns);
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
   * Abandoned-checkout sweep (spec 020). PENDING ticket orders older than the
   * Checkout session lifetime plus a grace period are checked against Stripe:
   * an expired session (or an open one past its expiry) releases the hold
   * through failOrder — the same path the webhook takes, a no-op unless still
   * PENDING; a session that completed while the webhook was missed goes
   * through the completion path. Orders without a session are skipped
   * (createOrder rolled those back itself).
   *
   * @returns {Promise<{ scanned: number, failed: number, completed: number, skipped: number }>}
   */
  async sweepAbandoned(now = new Date()) {
    const cutoff = new Date(now.getTime() - SESSION_TTL_MS - sweepGraceMs());
    const stale = await prisma.order.findMany({
      where: { status: 'PENDING', kind: 'TICKET', createdAt: { lt: cutoff }, stripeSessionId: { not: null } },
      select: { id: true, orderRef: true, stripeSessionId: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const result = { scanned: stale.length, failed: 0, completed: 0, skipped: 0 };
    for (const order of stale) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        const expired = session.status === 'expired' || (session.status === 'open' && Number(session.expires_at || 0) * 1000 < now.getTime());
        if (session.status === 'complete' || session.payment_status === 'paid') {
          await this.verifyAndCompleteOrder(order.id);
          result.completed += 1;
        } else if (expired) {
          await this.failOrder(order.id, 'Abandoned — session expired');
          result.failed += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.skipped += 1;
        logger.warn('Abandoned-order sweep could not settle an order', { orderId: order.id, orderRef: order.orderRef, error: error.message });
      }
    }
    if (stale.length) logger.info('Abandoned-order sweep', { event: 'order_sweep', ...result });
    return result;
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

  /**
   * Get all tickets across an organization's events (ticket-level rows for admin list).
   *
   * @param {string} organizationId
   * @param {Object} options - { page, limit, status, eventId, search }
   * @returns {Promise<{ data: TicketRow[], pagination }>}
   */
  async getTicketsByOrganization(organizationId, { page = 1, limit = 20, status, eventId, search } = {}) {
    const where = {
      ...(organizationId && { event: { venue: { organizationId } } }),
      order: { status: 'COMPLETED' },
      ...(status && { status }),
      ...(eventId && { eventId }),
      ...(search && {
        OR: [
          { barcode: { contains: search.toUpperCase(), mode: 'insensitive' } },
          { order: { orderRef: { contains: search.toUpperCase(), mode: 'insensitive' } } },
          { contact: { email: { contains: search.toLowerCase(), mode: 'insensitive' } } },
          { contact: { firstName: { contains: search, mode: 'insensitive' } } },
          { contact: { lastName: { contains: search, mode: 'insensitive' } } },
          { order: { contact: { email: { contains: search.toLowerCase(), mode: 'insensitive' } } } },
          { order: { contact: { firstName: { contains: search, mode: 'insensitive' } } } },
          { order: { contact: { lastName: { contains: search, mode: 'insensitive' } } } },
        ],
      }),
    };

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          order: {
            include: {
              contact: { select: { firstName: true, lastName: true, email: true } },
            },
          },
          contact: { select: { firstName: true, lastName: true, email: true } },
          priceTier: { select: { name: true } },
          event: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ]);

    return {
      data: tickets.map((t) => ({
        id: t.id,
        barcode: t.barcode,
        ticketNumber: t.ticketNumber,
        priceTierName: t.priceTier?.name,
        pricePaid: Number(t.pricePaid),
        status: t.status,
        redeemedAt: t.redeemedAt,
        createdAt: t.createdAt,
        eventName: t.event?.name,
        orderRef: t.order?.orderRef,
        orderId: t.orderId,
        purchaser: t.order?.contact || null,
        attendee: t.contact || null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Formatters ─────────────────────────────────────────

  async _formatOrderDetail(order) {
    // Generate QR code images using short jump:// payload for easy scanning
    const tickets = [];
    for (const t of order.tickets || []) {
      let qrCodeDataUrl = null;
      const qrPayload = this._getQrPayload(t, order.eventId);
      if (qrPayload) {
        try {
          qrCodeDataUrl = await qrService.generateQRCodeImage(qrPayload);
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
        logoUrl: order.event.logoUrl ?? null,
        // Org branding so checkout/confirmation pages can render inside a BrandScope
        organizationId: order.event.venue?.organization?.id || null,
        organizationName: order.event.venue?.organization?.name || null,
        organizationLogoUrl: order.event.venue?.organization?.logoUrl || null,
        organizationBrandColor: order.event.venue?.organization?.brandColor || null,
        organizationThemeMode: order.event.venue?.organization?.themeMode || 'SYSTEM',
        venue: order.event.venue
          ? {
              id: order.event.venue.id,
              name: order.event.venue.name,
              address: order.event.venue.address,
              // Spec 033: the zone the event's wall clock belongs to.
              timezone: order.event.venue.timezone ?? null,
            }
          : undefined,
      },
      contact: order.contact,
      kind: order.kind,
      quantity: order.quantity,
      items: (order.items || []).map((item) => ({
        id: item.id,
        kind: item.kind,
        priceTierId: item.priceTierId,
        priceTierName: item.priceTier?.name ?? item.applicationTier?.name ?? null,
        applicationTierId: item.applicationTierId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        platformFee: Number(item.platformFee),
        processingFee: Number(item.processingFee),
        tax: Number(item.tax),
        lineTotal:
          Number(item.unitPrice) * item.quantity +
          Number(item.platformFee) +
          Number(item.processingFee),
        createdById: item.createdById,
        createdAt: item.createdAt,
      })),
      // Add-on lines (spec 012) — never tickets, never in `quantity`
      addOns: (order.addOns || []).map((line) =>
        addOnService.serializeOrderLine(line, order.feeMode)
      ),
      subtotalAmount: Number(order.subtotalAmount),
      platformFeeAmount: Number(order.platformFeeAmount),
      processingFeeAmount: Number(order.processingFeeAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      orgReceives: Number(order.orgReceives),
      feeMode: order.feeMode,
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt,
      dueAt: order.dueAt,
      tickets,
      payment: order.payment
        ? {
            id: order.payment.id,
            amount: Number(order.payment.amount),
            currency: order.payment.currency,
            status: order.payment.status,
            failureReason: order.payment.failureReason,
            source: order.payment.source,
            offlineMethod: order.payment.offlineMethod,
            offlineReference: order.payment.offlineReference,
            stripePaymentIntentId: order.payment.stripePaymentIntentId,
            createdAt: order.payment.createdAt,
          }
        : null,
      // Spec 024: the application behind an APPLICATION order
      application: order.application
        ? {
            id: order.application.id,
            eventId: order.application.eventId,
            status: order.application.status,
            paymentStatus: order.application.paymentStatus,
            capacitySlot: order.application.capacitySlot,
            formName: order.application.form?.name ?? null,
            formKind: order.application.form?.kind ?? null,
            tierName: order.application.tier?.name ?? null,
            businessName: order.application.profile?.businessName ?? null,
            booth: order.application.booth
              ? { id: order.application.booth.id, label: order.application.booth.label, w: order.application.booth.w, h: order.application.booth.h, status: order.application.booth.status }
              : null,
          }
        : null,
      createdAt: order.createdAt,
    };
  }

  /**
   * Org-wide list row (spec 024 phase 2): the summary plus what tells the two
   * kinds apart — description, business name, the application's fine-grained
   * payment state while the order is PENDING, refunded / net, payment source.
   */
  _formatOrderRow(order, { unscoped = false } = {}) {
    const refunded = (order.refunds || []).reduce((sum, r) => sum + Number(r.amount), 0);
    const total = Number(order.totalAmount);
    const application = order.application || null;
    const pendingDetail =
      order.kind === 'APPLICATION' && order.status === 'PENDING' && application
        ? { paymentStatus: application.paymentStatus, label: APPLICATION_PAYMENT_LABEL[application.paymentStatus] || application.paymentStatus, dueAt: order.dueAt }
        : null;
    const waived = order.kind === 'APPLICATION' && application?.paymentStatus === 'NOT_REQUIRED' && order.status === 'COMPLETED';
    return {
      ...this._formatOrderSummary(order),
      eventId: order.eventId,
      description: orderLineService.describe(order),
      businessName: application?.profile?.businessName ?? null,
      statusDetail: pendingDetail || (waived ? { paymentStatus: 'NOT_REQUIRED', label: 'Waived', dueAt: null } : null),
      paymentSource: order.payment?.source === 'OFFLINE' || waived ? 'offline' : 'stripe',
      refunded: Math.round(refunded * 100) / 100,
      net: Math.round((total - refunded) * 100) / 100,
      // Spec 037: null unless the order has a dispute. The money already shows
      // in `refunded` / `net`; this says a chargeback took it, not a refund.
      dispute: (order.disputes || []).length
        ? (() => {
            const d = order.disputes[0];
            return { id: d.id, state: d.state, amount: Number(d.amount), reason: d.reason, fundsWithdrawn: d.fundsWithdrawn, inquiry: d.inquiry, openedAt: d.openedAt };
          })()
        : null,
      application: application ? { id: application.id, status: application.status, paymentStatus: application.paymentStatus, formName: application.form?.name ?? null, tierName: application.tier?.name ?? null } : null,
      ...(unscoped && order.event?.venue?.organization ? { organization: order.event.venue.organization } : {}),
    };
  }

  _formatOrderSummary(order) {
    return {
      id: order.id,
      orderRef: order.orderRef,
      kind: order.kind,
      applicationId: order.applicationId ?? null,
      eventName: order.event?.name,
      eventDate: order.event?.date,
      // Spec 033: event times are wall-clock local to the venue.
      eventTimezone: order.event?.venue?.timezone ?? null,
      quantity: order.quantity,
      subtotalAmount: Number(order.subtotalAmount),
      platformFeeAmount: Number(order.platformFeeAmount),
      processingFeeAmount: Number(order.processingFeeAmount),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt ?? null,
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
