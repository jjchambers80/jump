// Customer Service
// Aggregated customer view: contacts who have paid the organization — through
// a ticket order or a paid application — scoped by organization. Spec 024:
// both are Order rows (kind TICKET / APPLICATION), so one predicate and one
// aggregate over `orders` cover everything.

import { prisma } from '@jump/db';
import { NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';
import contactOptInService from './ContactOptInService.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { csvLine } from '../utils/csv.js';
import { CONTACT_SOURCES, PAYING_WHERE, sourceWhere } from './contactListFilters.js';
import contactListService from './ContactListService.js';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (rows, pick) => rows.reduce((total, r) => total + Number(pick(r) || 0), 0);
const latest = (dates) =>
  dates.filter(Boolean).reduce((max, d) => (!max || d > max ? d : max), null);

const ORDER_SELECT = {
  where: { status: { in: PAID_ORDER_STATUSES } },
  select: {
    id: true,
    kind: true,
    status: true,
    totalAmount: true,
    createdAt: true,
    paidAt: true,
    refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
  },
};

/** What a list row needs: paid orders, GOING RSVPs and standing-form submissions. */
const ROW_INCLUDE = {
  orders: ORDER_SELECT,
  rsvps: { where: { status: 'GOING' }, select: { status: true } },
  applications: {
    where: { status: { not: 'DRAFT' }, form: { eventId: null } },
    select: {
      id: true,
      status: true,
      form: { select: { id: true, name: true, eventId: true } },
    },
  },
};

const SOURCE_LABELS = { tickets: 'Tickets', rsvp: 'RSVP', subscribed: 'Subscribed' };
const EXPORT_HEADERS = ['First name', 'Last name', 'Email', 'Phone', 'Tags', 'Subscribed', 'Sources', 'Total spent', 'Last activity', 'Created'];
const isoDay = (date) => (date ? new Date(date).toISOString().slice(0, 10) : '');

/** By default a customer is a contact with money collected; `all` also returns prospects (spec 032 phase 3). */
function customerPredicate(scope = 'customers') {
  return scope === 'all' ? {} : PAYING_WHERE;
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

function customerRow(contact) {
  // Source chips for the customer list (spec 044C)
  const sources = [];
  if (contact.orders?.some((o) => PAID_ORDER_STATUSES.includes(o.status))) sources.push('tickets');
  if (contact.rsvps?.some((r) => r.status === 'GOING')) sources.push('rsvp');
  if (contact.emailSubscribed) sources.push('subscribed');
  const formSources = (contact.applications || [])
    .filter((a) => a.status !== 'DRAFT' && a.form?.eventId === null)
    .map((a) => ({ id: a.form.id, name: a.form.name }));

  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    location: contact.location,
    note: contact.note,
    emailSubscribed: contact.emailSubscribed,
    tags: contact.tags,
    sources,
    formSources,
    ...aggregates(contact.orders),
    createdAt: contact.createdAt,
  };
}

function compareNullableDates(a, b) {
  const left = a ? new Date(a).getTime() : 0;
  const right = b ? new Date(b).getTime() : 0;
  return left - right;
}

/** Compute filters and aggregate-aware ordering before pagination/navigation. */
export function filterAndSortCustomers(contacts, options = {}) {
  const { sort = 'createdAt', direction = 'desc' } = options;
  const rows = contacts.map((contact) => customerRow(contact));
  const multiplier = direction === 'asc' ? 1 : -1;

  const compare = (a, b) => {
    let result;
    switch (sort) {
      case 'name':
        result = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        break;
      case 'email':
        result = a.email.localeCompare(b.email);
        break;
      case 'transactionCount':
        result = a.transactionCount - b.transactionCount;
        break;
      case 'totalSpent':
        result = a.totalSpent - b.totalSpent;
        break;
      case 'lastActivityAt':
        result = compareNullableDates(a.lastActivityAt, b.lastActivityAt);
        break;
      default:
        result = compareNullableDates(a.createdAt, b.createdAt);
    }
    return result === 0 ? a.id.localeCompare(b.id) : result * multiplier;
  };

  return rows.sort(compare);
}

export function customerNavigation(contacts, contactId, options = {}) {
  const rows = filterAndSortCustomers(contacts, options);
  const index = rows.findIndex((row) => row.id === contactId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
  };
}

function normalizedSource(source) {
  return CONTACT_SOURCES.find((candidate) => candidate.toLowerCase() === String(source || '').toLowerCase());
}

function customerWhere(organizationId, { search, tag, scope, rsvp, eventId, source, formId } = {}, listWhere = null) {
  const validatedSource = normalizedSource(source);
  // rsvp=going is kept as an alias for source=rsvp (backward compat)
  const effectiveRsvp = validatedSource === 'rsvp' ? 'going' : rsvp;

  const and = [];
  if (search) {
    and.push({
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
    });
  }
  // Spec 055: the contacts on a list (its filters or its members)
  if (listWhere) and.push(listWhere);

  return {
    ...(organizationId && { organizationId }),
    ...(validatedSource && validatedSource !== 'rsvp'
      ? sourceWhere(validatedSource, { formId })
      : effectiveRsvp === 'going'
      ? sourceWhere('rsvp', { eventId })
      : customerPredicate(scope)),
    ...(tag && { tags: { has: tag } }),
    ...(and.length && { AND: and }),
  };
}

/** `list` (spec 055) narrows any Contacts query to one list's contacts. */
async function listWhereFor(organizationId, list) {
  if (!list) return null;
  if (typeof list !== 'string' || list.length > 64 || !organizationId) throw new NotFoundError('List not found');
  return contactListService.whereFor(organizationId, list);
}

class CustomerService {
  /**
   * Every contact the Contacts list shows for these filters (or a list's, with
   * `list`), as CSV (spec 055-E), written in pages of 1,000 through `write`.
   * Cells go through the formula-safe csvCell.
   */
  async exportCsv(organizationId, options, write) {
    const where = await this.whereFor(organizationId, options);
    write(`${csvLine(EXPORT_HEADERS)}\r\n`);
    let cursor = null;
    for (;;) {
      const page = await prisma.contact.findMany({
        where,
        include: ROW_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
      });
      if (!page.length) break;
      const lines = page.map((contact) => {
        const row = customerRow(contact);
        const sources = [
          ...row.sources.map((source) => SOURCE_LABELS[source] ?? source),
          ...row.formSources.map((form) => `Form: ${form.name}`),
        ];
        return csvLine([
          row.firstName,
          row.lastName,
          row.email,
          contact.phone,
          (row.tags ?? []).join('; '),
          row.emailSubscribed ? 'Yes' : 'No',
          sources.join('; '),
          row.totalSpent.toFixed(2),
          isoDay(row.lastActivityAt),
          isoDay(row.createdAt),
        ]);
      });
      write(`${lines.join('\r\n')}\r\n`);
      cursor = page[page.length - 1].id;
      if (page.length < 1000) break;
    }
  }

  /**
   * Prisma where for the Contacts list with these filters (spec 055: "select
   * all N matching" adds exactly what the list shows).
   */
  async whereFor(organizationId, { search, tag, scope, rsvp, eventId, source, formId, list } = {}) {
    return customerWhere(
      organizationId,
      { search, tag, scope, rsvp, eventId, source, formId },
      await listWhereFor(organizationId, list)
    );
  }

  /**
   * List customers for an organization.
   *
   * @param {string|null} organizationId - null for system admins (unscoped)
   * @param {Object} options - { page, limit, search, tag, scope, rsvp, eventId, source, formId, list, sort, direction }
   * @returns {Promise<{ data: Customer[], pagination }>}
   */
  async getCustomersByOrganization(
    organizationId,
    { page = 1, limit = 20, search, tag, scope, rsvp, eventId, source, formId, list, sort = 'createdAt', direction = 'desc' } = {}
  ) {
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.max(1, parseInt(limit) || 20);

    // Aggregate sorts are derived from paid orders, so filtering and
    // ordering happen before pagination. The same helper powers detail navigation.
    const where = customerWhere(
      organizationId,
      { search, tag, scope, rsvp, eventId, source, formId },
      await listWhereFor(organizationId, list)
    );
    const normalizedDirection = direction === 'asc' ? 'asc' : 'desc';
    const databaseOrder =
      sort === 'name'
        ? [{ firstName: normalizedDirection }, { lastName: normalizedDirection }, { id: 'asc' }]
        : sort === 'email'
          ? [{ email: normalizedDirection }, { id: 'asc' }]
          : [{ createdAt: normalizedDirection }, { id: 'asc' }];
    const needsDerivedRows = ['transactionCount', 'totalSpent', 'lastActivityAt'].includes(sort);

    if (!needsDerivedRows) {
      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: ROW_INCLUDE,
          orderBy: databaseOrder,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.contact.count({ where }),
      ]);
      return {
        data: contacts.map((contact) => customerRow(contact)),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    // Aggregate filters and sorts cannot be expressed by the Contact relation
    // query; compute them before slicing so pagination totals stay correct.
    const contacts = await prisma.contact.findMany({
      where,
      include: ROW_INCLUDE,
    });
    const ordered = filterAndSortCustomers(contacts, { sort, direction });
    const total = ordered.length;
    const data = ordered.slice((page - 1) * limit, page * limit);

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
  async getCustomerById(contactId, organizationId, listOptions = {}) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...(organizationId && { organizationId }) },
      include: {
        orders: {
          where: { status: { in: PAID_ORDER_STATUSES } },
          include: {
            event: { select: { id: true, name: true, date: true, logoUrl: true } },
            tickets: { select: { id: true, ticketNumber: true, status: true, redeemedAt: true, priceTier: { select: { name: true } } } },
            refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
            payment: { select: { source: true } },
          },
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        },
        // Every application, whatever its status or form kind (spec 037 D3 /
        // C2): the customer page is where a vendor's cross-event history lives.
        applications: {
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
            event: { select: { id: true, name: true, date: true, logoUrl: true } },
            order: {
              select: {
                id: true,
                orderRef: true,
                status: true,
                totalAmount: true,
                paidAt: true,
                refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
                payment: { select: { source: true } },
              },
            },
          },
          // Newest first; a DRAFT (never submitted) sorts after submitted ones.
          orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        },
        rsvps: {
          select: {
            id: true,
            partySize: true,
            status: true,
            createdAt: true,
            cancelledAt: true,
            event: {
              select: {
                id: true,
                name: true,
                date: true,
                logoUrl: true,
                venue: { select: { timezone: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    // Last sign-in from any used buyer token (defensive against missing mock in unit tests)
    let lastSignInAt = null;
    try {
      const lastToken = await prisma.buyerLoginToken.findFirst({
        where: { contactId: contact.id, usedAt: { not: null } },
        orderBy: { usedAt: 'desc' },
        select: { usedAt: true },
      });
      lastSignInAt = lastToken?.usedAt ?? null;
    } catch {
      // buyerLoginToken may not be available in all test environments
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

    // Every application of the contact (spec 037 C2), in the shape the
    // customer page has shown since spec 018. FREE forms have no order, so
    // their money fields are empty; PAID forms read their order whatever its
    // status (pending, due, paid, cancelled) — `orderStatus` carries it.
    const applications = (contact.applications || []).map((a) => {
      const o = a.order;
      const isStanding = a.eventId === null;
      return {
        id: a.id,
        orderId: o?.id ?? null,
        orderRef: o?.orderRef ?? null,
        orderStatus: o?.status ?? null,
        eventId: a.eventId,
        form: a.form,
        tier: a.tier,
        businessName: a.profile?.businessName ?? null,
        status: a.status,
        paymentStatus: a.paymentStatus,
        paymentSource: o ? (o.payment?.source === 'OFFLINE' ? 'offline' : 'stripe') : null,
        applicantPays: o ? Number(o.totalAmount) : 0,
        refunded: o ? round(sum(o.refunds, (r) => r.amount)) : 0,
        paidAt: o?.paidAt ?? null,
        submittedAt: a.submittedAt,
        createdAt: a.createdAt,
        event: a.event,
        // Standing forms: link to Content › Forms submission detail
        detailUrl: isStanding
          ? `/admin/contacts/forms/${a.formId}/submissions/${a.id}`
          : `/admin/events/${a.eventId}/applications/${a.id}`,
      };
    });

    // Account URL: link to the buyer's account on the storefront
    const { buyerAccountUrl } = await import('../utils/storefrontUrl.js');
    const accountUrl = contact.accountCreatedAt
      ? await buyerAccountUrl(contact.organizationId).catch(() => null)
      : null;

    // Ticket rows (rather than order quantities) preserve check-in and voided
    // state. The client groups these by event for the upcoming-tickets card.
    const now = new Date();
    const upcomingTickets = contact.orders
      .filter((order) => order.event && order.event.date >= now)
      .flatMap((order) => order.tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        priceTierName: ticket.priceTier?.name ?? null,
        status: ticket.status,
        redeemedAt: ticket.redeemedAt,
        event: order.event,
      })));

    const navigationContacts = await prisma.contact.findMany({
      where: customerWhere(organizationId, listOptions, await listWhereFor(organizationId, listOptions.list)),
      include: { orders: ORDER_SELECT },
    });
    const navigation = customerNavigation(navigationContacts, contactId, listOptions);

    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      location: contact.location,
      note: contact.note,
      emailSubscribed: contact.emailSubscribed,
      emailSubscribedAt: contact.emailSubscribedAt,
      emailSubscribedSource: contact.emailSubscribedSource,
      emailUnsubscribedAt: contact.emailUnsubscribedAt,
      accountCreatedAt: contact.accountCreatedAt,
      lastSignInAt,
      accountUrl,
      tags: contact.tags,
      createdAt: contact.createdAt,
      ...aggregates(contact.orders),
      ...navigation,
      orders,
      applications,
      rsvps: (contact.rsvps || []).map((rsvp) => ({
        ...rsvp,
        event: {
          ...rsvp.event,
          timezone: rsvp.event.venue?.timezone ?? null,
          venue: undefined,
        },
      })),
      upcomingTickets,
    };
  }

  /**
   * Update editable customer fields (spec 032 phase 1: note, location, email,
   * phone, tags, emailSubscribed, firstName, lastName).
   *
   * @param {string} contactId
   * @param {Object} updates - { note?, location?, email?, phone?, tags?, emailSubscribed?, firstName?, lastName? }
   * @param {Object} [actor] - { id: string, role: string } — the staff user requesting the change
   * @returns {Promise<Contact>}
   */
  async updateCustomer(contactId, organizationId, updates, actor) {
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
    if (updates.firstName !== undefined) allowed.firstName = updates.firstName;
    if (updates.lastName !== undefined) allowed.lastName = updates.lastName;
    if (updates.phone !== undefined) allowed.phone = updates.phone;
    if (updates.tags !== undefined) allowed.tags = updates.tags;
    // Marketing edits by staff carry provenance ADMIN (spec 023 LR-07 via spec 024 phase 3).
    if (updates.emailSubscribed !== undefined)
      Object.assign(allowed, contactOptInService.marketingChangeData(contact, Boolean(updates.emailSubscribed)));

    // Email change: ADMIN-only, checked in the route layer. Here we check for
    // uniqueness on organizationId + email.
    const nextEmail = updates.email !== undefined ? normalizeEmail(updates.email) : undefined;
    if (nextEmail !== undefined && nextEmail !== contact.email) {
      // Check for collision on organizationId + email
      const existing = await prisma.contact.findUnique({
        where: { organizationId_email: { organizationId, email: nextEmail } },
        select: { id: true },
      });
      if (existing && existing.id !== contactId) {
        throw new ConflictError('Email is already in use by another contact', {
          code: 'EMAIL_TAKEN',
        });
      }
      allowed.email = nextEmail;
    }

    try {
      if (allowed.email && allowed.email !== contact.email && actor) {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.contact.update({ where: { id: contactId }, data: allowed });
          await tx.contactComment.create({
            data: {
              contactId,
              organizationId: contact.organizationId,
              authorUserId: actor.id,
              kind: 'EMAIL_CHANGED',
              body: `Email changed from ${contact.email} to ${allowed.email}`,
            },
          });
          return updated;
        });
      }
      return await prisma.contact.update({ where: { id: contactId }, data: allowed });
    } catch (error) {
      if (error?.code === 'P2002' && allowed.email) {
        const conflict = new ConflictError('A customer with that email already exists');
        conflict.code = 'EMAIL_TAKEN';
        throw conflict;
      }
      throw error;
    }
  }
}

export default new CustomerService();