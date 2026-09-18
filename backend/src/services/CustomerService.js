// Customer Service
// Aggregated customer view: contacts who have paid the organization — through
// a ticket order or a paid application (spec 018 phase 2) — scoped by organization.

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { PAID_ORDER_STATUSES, PAID_APPLICATION_STATUSES } from './transactionQuery.js';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (rows, pick) => rows.reduce((total, r) => total + Number(pick(r) || 0), 0);
const latest = (dates) => dates.filter(Boolean).reduce((max, d) => (!max || d > max ? d : max), null);

const ORDER_SELECT = {
  where: { status: { in: PAID_ORDER_STATUSES } },
  select: { id: true, totalAmount: true, createdAt: true, refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } } },
};
const APPLICATION_SELECT = {
  where: { paymentStatus: { in: PAID_APPLICATION_STATUSES } },
  select: { id: true, applicantPays: true, paidAt: true, submittedAt: true, createdAt: true, refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } } },
};

/** A customer is a contact with money collected: a paid order or a paid application. */
function customerPredicate() {
  return {
    OR: [{ orders: { some: { status: { in: PAID_ORDER_STATUSES } } } }, { applications: { some: { paymentStatus: { in: PAID_APPLICATION_STATUSES } } } }],
  };
}

/**
 * Money aggregates over a contact's paid orders and applications. `totalSpent`
 * is gross (as before spec 018); `totalRefunded` is reported beside it so the
 * numbers reconcile with Stripe's gross and refunded totals.
 */
function aggregates(orders, applications) {
  const totalSpent = round(sum(orders, (o) => o.totalAmount) + sum(applications, (a) => a.applicantPays));
  const totalRefunded = round(sum(orders, (o) => sum(o.refunds, (r) => r.amount)) + sum(applications, (a) => sum(a.refunds, (r) => r.amount)));
  const lastActivityAt = latest([...orders.map((o) => o.createdAt), ...applications.map((a) => a.paidAt || a.submittedAt || a.createdAt)]);
  const transactionCount = orders.length + applications.length;
  return {
    orderCount: transactionCount, // alias kept for existing consumers
    transactionCount,
    ticketOrderCount: orders.length,
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
              { applicantProfiles: { some: { businessName: { contains: search, mode: 'insensitive' } } } },
            ],
          },
        ],
      }),
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { orders: ORDER_SELECT, applications: APPLICATION_SELECT },
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
      ...aggregates(c.orders, c.applications),
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
          },
          orderBy: { createdAt: 'desc' },
        },
        applications: {
          where: { paymentStatus: { in: PAID_APPLICATION_STATUSES } },
          include: {
            event: { select: { id: true, name: true, date: true, logoUrl: true } },
            form: { select: { id: true, name: true, kind: true } },
            tier: { select: { id: true, name: true } },
            profile: { select: { businessName: true } },
            refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
          },
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    // A contact with no money collected is not a customer of this organization
    if (contact.orders.length === 0 && contact.applications.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const orders = contact.orders.map((o) => ({
      id: o.id,
      orderRef: o.orderRef,
      totalAmount: parseFloat(o.totalAmount || 0),
      refunded: round(sum(o.refunds, (r) => r.amount)),
      quantity: o.quantity,
      status: o.status,
      createdAt: o.createdAt,
      ticketCount: o.tickets.length,
      event: o.event,
    }));

    const applications = contact.applications.map((a) => ({
      id: a.id,
      eventId: a.eventId,
      form: a.form,
      tier: a.tier,
      businessName: a.profile?.businessName ?? null,
      status: a.status,
      paymentStatus: a.paymentStatus,
      paymentSource: 'stripe',
      applicantPays: Number(a.applicantPays),
      refunded: round(sum(a.refunds, (r) => r.amount)),
      paidAt: a.paidAt,
      submittedAt: a.submittedAt,
      createdAt: a.createdAt,
      event: a.event,
      detailUrl: `/admin/events/${a.eventId}/applications/${a.id}`,
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
      ...aggregates(contact.orders, contact.applications),
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
    if (updates.emailSubscribed !== undefined) allowed.emailSubscribed = Boolean(updates.emailSubscribed);

    return prisma.contact.update({
      where: { id: contactId },
      data: allowed,
    });
  }
}

export default new CustomerService();
