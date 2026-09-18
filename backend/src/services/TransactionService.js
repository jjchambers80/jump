// Transactions — unified read model over ticket orders and application
// payments (spec 018 phase 1). No table of its own: transactionQuery.js
// projects both models into one row shape and Postgres sorts and paginates
// the union. Refunds delegate to the per-type services so Stripe behaviour
// (Connect reversal, webhook idempotency) is identical whichever page issued
// them.

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { buildListSql, buildCountSql, isStripeId } from './transactionQuery.js';
import refundService from './RefundService.js';
import applicationService from './ApplicationService.js';
import addOnService from './AddOnService.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CSV_CHUNK = 500;

const CSV_COLUMNS = [
  'kind', 'type', 'reference', 'occurredAt', 'status', 'paymentSource',
  'contactName', 'contactEmail', 'businessName', 'organization', 'event', 'description',
  'subtotal', 'platformFee', 'processingFee', 'tax', 'gross', 'refunded', 'net',
  'stripePaymentIntentId', 'stripeCheckoutSessionId', 'stripeRefundId', 'stripeAccountId', 'detailUrl',
];

const num = (v) => (v == null ? 0 : Math.round(Number(v) * 100) / 100);
const iso = (d) => (d ? new Date(d).toISOString() : null);

class TransactionService {
  /**
   * One page of transactions.
   *
   * @param {string|null} organizationId  null = unscoped (SYSTEM_ADMIN)
   * @param {Object} query  parsed by validateTransactionQuery
   * @returns {Promise<{ data: Transaction[], pagination }>}
   */
  async list(organizationId, query = {}) {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const filters = await this._filters(organizationId, query);
    const empty = { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
    if (filters === null) return empty;

    const list = buildListSql(filters, { offset: (page - 1) * pageSize, limit: pageSize });
    const count = buildCountSql(filters);
    if (!list.sql) return empty;

    const [rows, counted] = await Promise.all([
      prisma.$queryRawUnsafe(list.sql, ...list.params),
      prisma.$queryRawUnsafe(count.sql, ...count.params),
    ]);
    const total = Number(counted[0]?.count ?? 0);
    const data = await this._hydrate(rows, { unscoped: organizationId === null });
    return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  /** One transaction row by type + id, org-checked. */
  async getOne(organizationId, type, id) {
    const { sql, params } = buildListSql({ organizationId, type, ids: [id] }, { offset: 0, limit: 1 });
    const rows = sql ? await prisma.$queryRawUnsafe(sql, ...params) : [];
    if (rows.length === 0) throw new NotFoundError('Transaction not found');
    const [row] = await this._hydrate(rows, { unscoped: organizationId === null });
    return row;
  }

  /**
   * Refund history for one transaction, normalised across both ledgers.
   * @returns {Promise<Array<{ id, amount, reason, status, stripeRefundId, initiatedBy, manual, detail, createdAt }>>}
   */
  async refunds(organizationId, type, id) {
    await this.resolveOwnership(organizationId, type, id);
    if (type === 'ORDER') {
      const rows = await refundService.getRefundsForOrder(id);
      return rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        reason: r.reason,
        status: r.status,
        stripeRefundId: r.stripeRefundId,
        initiatedBy: r.initiatedBy,
        manual: false,
        detail: r.ticket ? `Ticket #${r.ticket.ticketNumber}` : r.addOn ? `${r.addOn.name ?? 'Add-on'} ×${r.addOn.quantity}` : 'Full order',
        createdAt: r.createdAt,
      }));
    }
    const rows = await prisma.applicationRefund.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      reason: r.reason,
      status: r.status,
      stripeRefundId: r.stripeRefundId,
      initiatedBy: r.initiatedBy,
      manual: r.manual === true,
      detail: null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Refund from the list. ORDER refunds are full (per-ticket and per-line
   * refunds stay on the order page where the lines are visible); APPLICATION
   * refunds take an optional partial amount.
   */
  async refund(organizationId, type, id, { amount = null, reason = null, initiatedBy = null } = {}) {
    const owned = await this.resolveOwnership(organizationId, type, id);
    if (type === 'ORDER') {
      if (amount != null) throw new ValidationError('Orders are refunded in full from Transactions; refund a ticket or add-on line from the order page');
      await refundService.refundOrder(id, { reason, initiatedBy });
    } else {
      await applicationService.refund(owned.eventId, id, organizationId, { amount, reason, initiatedBy });
    }
    logger.info('Transaction refunded', { event: 'transaction_refunded', type, id, amount, initiatedBy });
    const [transaction, refunds] = await Promise.all([this.getOne(organizationId, type, id), this.refunds(organizationId, type, id)]);
    return { transaction, refunds };
  }

  /**
   * Streams the CSV for the same filters as list(): one line per transaction
   * plus one line per SUCCEEDED refund (`kind = refund`).
   */
  async exportCsv(organizationId, query, res) {
    const filters = await this._filters(organizationId, query);
    res.write(CSV_COLUMNS.map(csvEscape).join(',') + '\n');
    if (filters === null) return;
    const unscoped = organizationId === null;
    for (let offset = 0; ; offset += CSV_CHUNK) {
      const { sql, params } = buildListSql(filters, { offset, limit: CSV_CHUNK });
      if (!sql) return;
      const rows = await prisma.$queryRawUnsafe(sql, ...params);
      if (rows.length === 0) return;
      const data = await this._hydrate(rows, { unscoped });
      const refundsById = await this._refundsFor(data);
      for (const t of data) {
        res.write(csvLine(this._csvRow(t, 'transaction', null)));
        for (const r of refundsById.get(`${t.type}:${t.id}`) || []) {
          res.write(csvLine(this._csvRow(t, 'refund', r)));
        }
      }
      if (rows.length < CSV_CHUNK) return;
    }
  }

  /**
   * Confirms the row exists inside the caller's organization. SYSTEM_ADMIN
   * (organizationId null) may reach any row.
   * @returns {Promise<{ id: string, eventId: string }>}
   */
  async resolveOwnership(organizationId, type, id) {
    const row =
      type === 'ORDER'
        ? await prisma.order.findFirst({ where: { id, ...(organizationId && { event: { venue: { organizationId } } }) }, select: { id: true, eventId: true } })
        : await prisma.application.findFirst({ where: { id, status: { not: 'DRAFT' }, ...(organizationId && { organizationId }) }, select: { id: true, eventId: true } });
    if (!row) throw new NotFoundError('Transaction not found');
    return row;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Query → builder filters. A `ch_` search is resolved to its PaymentIntent
   * through Stripe (charge ids are not stored); an unknown charge yields null,
   * i.e. no rows.
   */
  async _filters(organizationId, query) {
    const filters = {
      organizationId,
      type: query.type,
      status: query.status,
      eventId: query.eventId,
      from: query.from,
      to: query.to,
      hasRefunds: query.hasRefunds,
      paymentSource: query.paymentSource,
      search: query.search,
      sort: query.sort,
    };
    if (filters.search && filters.search.startsWith('ch_') && isStripeId(filters.search)) {
      try {
        const charge = await stripe.charges.retrieve(filters.search);
        const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (!intent) return null;
        filters.search = intent;
      } catch (error) {
        logger.warn('Transaction search: charge lookup failed', { event: 'transaction_charge_lookup_failed', chargeId: filters.search, error: error.message });
        return null;
      }
    }
    return filters;
  }

  /**
   * Raw union rows → API rows. Descriptions need the line items, which are
   * read in two batched queries after the page is known so the SQL stays flat.
   */
  async _hydrate(rows, { unscoped }) {
    const orderIds = rows.filter((r) => r.type === 'ORDER').map((r) => r.id);
    const applicationIds = rows.filter((r) => r.type === 'APPLICATION').map((r) => r.id);
    const [orders, applications] = await Promise.all([
      orderIds.length
        ? prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, items: { select: { quantity: true, priceTier: { select: { name: true } } } }, addOns: { select: { quantity: true, addOn: { select: { name: true } } } } },
          })
        : [],
      applicationIds.length
        ? prisma.application.findMany({
            where: { id: { in: applicationIds } },
            select: { id: true, form: { select: { name: true } }, tier: { select: { name: true } }, addOns: { select: { quantity: true, addOn: { select: { name: true } } } } },
          })
        : [],
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const applicationById = new Map(applications.map((a) => [a.id, a]));

    return rows.map((r) => {
      const gross = num(r.gross);
      const refunded = num(r.refunded);
      const description = r.type === 'ORDER' ? describeOrder(orderById.get(r.id)) : describeApplication(applicationById.get(r.id));
      return {
        type: r.type,
        id: r.id,
        reference: r.reference,
        occurredAt: iso(r.occurredAt),
        contact: { id: r.contactId, name: `${r.firstName} ${r.lastName}`.trim(), email: r.email },
        businessName: r.businessName ?? null,
        event: { id: r.eventId, name: r.eventName, date: iso(r.eventDate) },
        ...(unscoped && { organization: { id: r.organizationId, name: r.organizationName } }),
        description,
        subtotal: num(r.subtotal),
        platformFee: num(r.platformFee),
        processingFee: num(r.processingFee),
        tax: num(r.tax),
        gross,
        refunded,
        net: Math.round((gross - refunded) * 100) / 100,
        amountDue: r.amountDue == null ? null : num(r.amountDue),
        dueAt: iso(r.dueAt),
        status: r.status,
        sourceStatus: r.sourceStatus,
        paymentSource: r.paymentSource,
        stripeAccountId: r.stripeAccountId ?? null,
        stripePaymentIntentId: r.stripePaymentIntentId ?? null,
        stripeCheckoutSessionId: r.stripeCheckoutSessionId ?? null,
        detailUrl: r.type === 'ORDER' ? `/admin/orders/${r.id}` : `/admin/events/${r.eventId}/applications/${r.id}`,
      };
    });
  }

  /** SUCCEEDED refunds for a page of rows, keyed `type:id`. */
  async _refundsFor(data) {
    const orderIds = data.filter((t) => t.type === 'ORDER').map((t) => t.id);
    const applicationIds = data.filter((t) => t.type === 'APPLICATION').map((t) => t.id);
    const [orderRefunds, applicationRefunds] = await Promise.all([
      orderIds.length ? prisma.refund.findMany({ where: { orderId: { in: orderIds }, status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } }) : [],
      applicationIds.length ? prisma.applicationRefund.findMany({ where: { applicationId: { in: applicationIds }, status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } }) : [],
    ]);
    const map = new Map();
    const push = (key, r) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    };
    for (const r of orderRefunds) push(`ORDER:${r.orderId}`, r);
    for (const r of applicationRefunds) push(`APPLICATION:${r.applicationId}`, r);
    return map;
  }

  _csvRow(t, kind, refund) {
    const money = (v) => Number(v).toFixed(2);
    return [
      kind,
      t.type,
      t.reference,
      kind === 'refund' ? iso(refund.createdAt) : t.occurredAt,
      kind === 'refund' ? refund.status : t.status,
      t.paymentSource,
      t.contact.name,
      t.contact.email,
      t.businessName ?? '',
      t.organization?.name ?? '',
      t.event.name,
      kind === 'refund' ? refund.reason ?? '' : t.description,
      kind === 'refund' ? '' : money(t.subtotal),
      kind === 'refund' ? '' : money(t.platformFee),
      kind === 'refund' ? '' : money(t.processingFee),
      kind === 'refund' ? '' : money(t.tax),
      kind === 'refund' ? '' : money(t.gross),
      kind === 'refund' ? money(refund.amount) : money(t.refunded),
      kind === 'refund' ? '' : money(t.net),
      t.stripePaymentIntentId ?? '',
      t.stripeCheckoutSessionId ?? '',
      kind === 'refund' ? refund.stripeRefundId ?? '' : '',
      t.stripeAccountId ?? '',
      t.detailUrl,
    ];
  }
}

function describeOrder(order) {
  if (!order) return '';
  const tiers = order.items.map((i) => `${i.quantity} × ${i.priceTier?.name ?? 'Ticket'}`).join(', ');
  const addOns = order.addOns.length ? `, ${addOnService.summarizeLines(order.addOns)}` : '';
  return `${tiers}${addOns}`;
}

function describeApplication(application) {
  if (!application) return '';
  const head = application.tier ? `${application.form.name} — ${application.tier.name}` : application.form.name;
  const addOns = application.addOns.length ? `, ${addOnService.summarizeLines(application.addOns)}` : '';
  return `${head}${addOns}`;
}

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function csvLine(values) {
  return values.map(csvEscape).join(',') + '\n';
}

export default new TransactionService();
