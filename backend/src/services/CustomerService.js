// Customer Service
// Aggregated customer view: contacts who have paid the organization — through
// a ticket order or a paid application — scoped by organization. Spec 024:
// both are Order rows (kind TICKET / APPLICATION), so one predicate and one
// aggregate over `orders` cover everything.

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';
import contactOptInService from './ContactOptInService.js';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (rows, pick) => rows.reduce((total, r) => total + Number(pick(r) || 0), 0);
const latest = (dates) =>
  dates.filter(Boolean).reduce((max, d) => (!max || d > max ? d : max), null);

const ORDER_SELECT = {
  where: { status: { in: PAID_ORDER_STATUSES } },
  select: {
    id: true,
    kind: true,
    totalAmount: true,
    createdAt: true,
    paidAt: true,
    refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
  },
};

/** A customer is a contact with money collected: a paid order of either kind. */
function customerPredicate() {
  return { orders: { some: { status: { in: PAID_ORDER_STATUSES } } } };
}

/**
 * Money aggregates over a contact's paid orders. `totalSpent` is gross;
 * `totalRefunded` is reported beside it so the numbers reconcile with
 * Stripe's gross and refunded totals.
 */
function aggregates(orders) {
  const tickets = orders.filter((o) => o.kind !== 'APPLICATION');
  const applications = orders.filter((o) => o.kind === 'APPLICATION');
  const totalSpent = round(sum(orders, (o) => o.totalAmount));
  const totalRefunded = round(sum(orders, (o) => sum(o.refunds, (r) => r.amount)));
  const lastActivityAt = latest(orders.map((o) => o.paidAt || o.createdAt));
  const transactionCount = orders.length;
  return {
    orderCount: transactionCount, // alias kept for existing consumers
    transactionCount,
    ticketOrderCount: tickets.length,
    applicationCount: applications.length,
    totalSpent,
    totalRefunded,
    lastOrderDate: lastActivityAt, // alias kept for existing consumers
    lastActivityAt,
  };
}

class CustomerService {
  /**
   * List customers for an organization.
   *
   * @param {string|null} organizationId - null for system admins (unscoped)
   * @param {Object} options - { page, limit, search }
   * @returns {Promise<{ data: Customer[], pagination }>}
   */
  async getCustomersByOrganization(organizationId, { page = 1, limit = 20, search } = {}) {
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 20;

    // Contacts are rows of their own organization (spec 007), so the org filter
    // is a column match.
    const where = {
      ...(organizationId && { organizationId }),
      ...customerPredicate(),
      ...(search && {
        AND: [
          {
            OR: [
              { email: { contains: search.toLowerCase(), mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              {
                applicantProfiles: {
                  some: { businessName: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          },
        ],
      }),
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { orders: ORDER_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    const data = contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      location: c.location,
      note: c.note,
      emailSubscribed: c.emailSubscribed,
      ...aggregates(c.orders),
      createdAt: c.createdAt,
    }));

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get a single customer with their order and application history, scoped by organization.
   *
   * @param {string} contactId
   * @param {string|null} organizationId
   * @returns {Promise<Object>}
   */
  async getCustomerById(contactId, organizationId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...(organizationId && { organizationId }) },
      include: {
        orders: {
          where: { status: { in: PAID_ORDER_STATUSES } },
          include: {
            event: { select: { id: true, name: true, date: true, logoUrl: true } },
            tickets: { select: { id: true, status: true } },
            refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
            payment: { select: { source: true } },
            application: {
              select: {
                id: true,
                eventId: true,
                status: true,
                paymentStatus: true,
                submittedAt: true,
                createdAt: true,
                form: { select: { id: true, name: true, kind: true } },
                tier: { select: { id: true, name: true } },
                profile: { select: { businessName: true } },
              },
            },
          },
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    // A contact with no money collected is not a customer of this organization
    if (contact.orders.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const orders = contact.orders.map((o) => ({
      id: o.id,
      orderRef: o.orderRef,
      kind: o.kind,
      applicationId: o.applicationId ?? null,
      totalAmount: parseFloat(o.totalAmount || 0),
      refunded: round(sum(o.refunds, (r) => r.amount)),
      quantity: o.quantity,
      status: o.status,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      ticketCount: o.tickets.length,
      event: o.event,
    }));

    // Application orders in the shape the customer page has shown since spec 018.
    const applications = contact.orders
      .filter((o) => o.kind === 'APPLICATION' && o.application)
      .map((o) => ({
        id: o.application.id,
        orderId: o.id,
        orderRef: o.orderRef,
        eventId: o.application.eventId,
        form: o.application.form,
        tier: o.application.tier,
        businessName: o.application.profile?.businessName ?? null,
        status: o.application.status,
        paymentStatus: o.application.paymentStatus,
        paymentSource: o.payment?.source === 'OFFLINE' ? 'offline' : 'stripe',
        applicantPays: Number(o.totalAmount),
        refunded: round(sum(o.refunds, (r) => r.amount)),
        paidAt: o.paidAt,
        submittedAt: o.application.submittedAt,
        createdAt: o.application.createdAt,
        event: o.event,
        detailUrl: `/admin/events/${o.application.eventId}/applications/${o.application.id}`,
      }));

    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      location: contact.location,
      note: contact.note,
      emailSubscribed: contact.emailSubscribed,
      createdAt: contact.createdAt,
      ...aggregates(contact.orders),
      orders,
      applications,
    };
  }

  /**
   * Update editable customer fields (note, location, emailSubscribed).
   *
   * @param {string} contactId
   * @param {Object} updates - { note?, location?, emailSubscribed? }
   * @returns {Promise<Contact>}
   */
  async updateCustomer(contactId, organizationId, updates) {
    // organizationId null = SYSTEM_ADMIN (unscoped); otherwise the row must be this org's
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...(organizationId && { organizationId }) },
    });
    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    const allowed = {};
    if (updates.note !== undefined) allowed.note = updates.note;
    if (updates.location !== undefined) allowed.location = updates.location;
    // Marketing edits by staff carry provenance ADMIN (spec 023 LR-07 via spec 024 phase 3).
    if (updates.emailSubscribed !== undefined)
      Object.assign(allowed, contactOptInService.marketingChangeData(contact, Boolean(updates.emailSubscribed)));

    return prisma.contact.update({
      where: { id: contactId },
      data: allowed,
    });
  }
}

export default new CustomerService();
