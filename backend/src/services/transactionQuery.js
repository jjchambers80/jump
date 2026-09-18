// Transactions read model — SQL builder (spec 018 phase 1)
//
// One UNION ALL over ticket orders and application payments, sorted and
// paginated in Postgres. Pure: takes parsed filters, returns { sql, params }
// for prisma.$queryRawUnsafe. Every value is a $n parameter; nothing from the
// request is interpolated into the SQL text. Column names equal Prisma field
// names (the schema uses no @@map). Enum columns are cast to text before a
// parameter comparison: raw parameters arrive typed as text and Postgres has
// no enum = text operator.

export const TRANSACTION_TYPES = ['ORDER', 'APPLICATION'];
export const TRANSACTION_STATUSES = ['PENDING', 'PAID', 'PAYMENT_DUE', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'];
export const TRANSACTION_SORTS = ['-date', 'date', '-gross', 'gross'];
export const PAYMENT_SOURCES = ['stripe', 'offline'];

/** Order statuses that count as money collected. */
export const PAID_ORDER_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
/** Application payment statuses that count as money collected. */
export const PAID_APPLICATION_STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

// TransactionStatus → source statuses per half. PENDING applications are the
// card-on-file states: money is expected but nothing has been charged.
const ORDER_STATUS_MAP = {
  PENDING: ['PENDING'],
  PAID: ['COMPLETED'],
  PAYMENT_DUE: [],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED'],
  REFUNDED: ['REFUNDED'],
  FAILED: ['FAILED'],
};
const APPLICATION_STATUS_MAP = {
  PENDING: ['AWAITING_CARD', 'CARD_ON_FILE', 'PROCESSING'],
  PAID: ['PAID', 'NOT_REQUIRED'], // NOT_REQUIRED rows only exist here when settled OFFLINE (waived)
  PAYMENT_DUE: ['PAYMENT_DUE'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED'],
  REFUNDED: ['REFUNDED'],
  FAILED: [],
};

// Default view hides orders that never became money (matches /admin/orders'
// default of "everything but noise" for finance questions). Applications hide
// nothing except DRAFT and NOT_REQUIRED, which are filtered structurally.
const DEFAULT_HIDDEN_ORDER_STATUSES = ['PENDING', 'FAILED'];

const STRIPE_ID_PREFIX = /^(pi|cs|re|pyr|ch)_[A-Za-z0-9_]+$/;

/** A search term that is a Stripe object id: only the id columns are compared. */
export function isStripeId(term) {
  return STRIPE_ID_PREFIX.test(term || '');
}

/**
 * Collects positional parameters while the SQL text is assembled.
 * `p(value)` returns the `$n` placeholder for that value.
 */
class Params {
  constructor() {
    this.values = [];
  }

  p(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  list(values) {
    return values.map((v) => this.p(v)).join(', ');
  }
}

const ORDER_STATUS_CASE = `CASE o."status"
      WHEN 'COMPLETED' THEN 'PAID'
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'FAILED' THEN 'FAILED'
      WHEN 'REFUNDED' THEN 'REFUNDED'
      WHEN 'PARTIALLY_REFUNDED' THEN 'PARTIALLY_REFUNDED'
    END`;

const APPLICATION_STATUS_CASE = `CASE a."paymentStatus"
      WHEN 'PAID' THEN 'PAID'
      WHEN 'PAYMENT_DUE' THEN 'PAYMENT_DUE'
      WHEN 'REFUNDED' THEN 'REFUNDED'
      WHEN 'PARTIALLY_REFUNDED' THEN 'PARTIALLY_REFUNDED'
      ELSE 'PENDING'
    END`;

const APPLICATION_PAID = `a."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

/**
 * ORDER half of the union. Money columns come straight from Order; refunded is
 * a correlated sum so the row never needs a GROUP BY.
 */
function orderSelect(filters, params) {
  if (filters.paymentSource === 'offline') return null; // orders are always Stripe
  const where = [];
  if (filters.organizationId) where.push(`v."organizationId" = ${params.p(filters.organizationId)}`);
  if (filters.ids?.length) where.push(`o."id" IN (${params.list(filters.ids)})`);
  if (filters.eventId) where.push(`o."eventId" = ${params.p(filters.eventId)}`);
  if (filters.from) where.push(`o."createdAt" >= ${utc(params.p(filters.from.toISOString()))}`);
  if (filters.to) where.push(`o."createdAt" <= ${utc(params.p(filters.to.toISOString()))}`);

  if (filters.status) {
    const statuses = ORDER_STATUS_MAP[filters.status];
    if (statuses.length === 0) return null;
    where.push(`o."status"::text IN (${params.list(statuses)})`);
  } else if (!filters.ids?.length) {
    // A row fetched by id is never hidden; only the browse view drops noise.
    where.push(`o."status"::text NOT IN (${params.list(DEFAULT_HIDDEN_ORDER_STATUSES)})`);
  }

  if (filters.hasRefunds === true) where.push(`EXISTS (SELECT 1 FROM "Refund" r WHERE r."orderId" = o."id" AND r."status" = 'SUCCEEDED')`);
  if (filters.hasRefunds === false) where.push(`NOT EXISTS (SELECT 1 FROM "Refund" r WHERE r."orderId" = o."id" AND r."status" = 'SUCCEEDED')`);

  if (filters.search) {
    const term = filters.search;
    if (isStripeId(term)) {
      const id = params.p(term);
      where.push(`(pt."stripePaymentIntentId" = ${id} OR EXISTS (SELECT 1 FROM "Refund" r WHERE r."orderId" = o."id" AND r."stripeRefundId" = ${id}))`);
    } else {
      const like = params.p(`%${escapeLike(term)}%`);
      where.push(`(o."orderRef" ILIKE ${like} OR c."email" ILIKE ${like} OR c."firstName" ILIKE ${like} OR c."lastName" ILIKE ${like} OR (c."firstName" || ' ' || c."lastName") ILIKE ${like})`);
    }
  }

  return `SELECT
      'ORDER'::text AS "type",
      o."id" AS "id",
      o."orderRef" AS "reference",
      o."createdAt" AS "occurredAt",
      o."status"::text AS "sourceStatus",
      ${ORDER_STATUS_CASE} AS "status",
      c."id" AS "contactId",
      c."firstName" AS "firstName",
      c."lastName" AS "lastName",
      c."email" AS "email",
      NULL::text AS "businessName",
      e."id" AS "eventId",
      e."name" AS "eventName",
      e."date" AS "eventDate",
      v."organizationId" AS "organizationId",
      org."name" AS "organizationName",
      o."totalAmount" AS "gross",
      o."subtotalAmount" AS "subtotal",
      o."platformFeeAmount" AS "platformFee",
      o."processingFeeAmount" AS "processingFee",
      o."taxAmount" AS "tax",
      COALESCE((SELECT SUM(r."amount") FROM "Refund" r WHERE r."orderId" = o."id" AND r."status" = 'SUCCEEDED'), 0) AS "refunded",
      NULL::numeric AS "amountDue",
      NULL::timestamp AS "dueAt",
      pt."stripePaymentIntentId" AS "stripePaymentIntentId",
      NULL::text AS "stripeCheckoutSessionId",
      pt."stripeAccountId" AS "stripeAccountId",
      'stripe'::text AS "paymentSource"
    FROM "Order" o
    JOIN "Contact" c ON c."id" = o."contactId"
    JOIN "Event" e ON e."id" = o."eventId"
    JOIN "Venue" v ON v."id" = e."venueId"
    JOIN "Organization" org ON org."id" = v."organizationId"
    LEFT JOIN "PaymentTransaction" pt ON pt."orderId" = o."id"
    WHERE ${where.join('\n      AND ')}`;
}

/**
 * APPLICATION half. Gross and the fee columns are zero until money has moved
 * so pending rows never inflate totals; the snapshot is shown as amountDue.
 */
function applicationSelect(filters, params) {
  // NOT_REQUIRED is no money (FREE forms) — except a waived balance (spec 018
  // phase 3), which is settled OFFLINE and stays auditable as a $0 row.
  const where = [`a."status" <> 'DRAFT'`, `(a."paymentStatus" <> 'NOT_REQUIRED' OR a."paymentSource" = 'OFFLINE')`];
  if (filters.organizationId) where.push(`a."organizationId" = ${params.p(filters.organizationId)}`);
  if (filters.ids?.length) where.push(`a."id" IN (${params.list(filters.ids)})`);
  if (filters.eventId) where.push(`a."eventId" = ${params.p(filters.eventId)}`);
  const occurredAt = `COALESCE(a."paidAt", a."submittedAt", a."createdAt")`;
  if (filters.from) where.push(`${occurredAt} >= ${utc(params.p(filters.from.toISOString()))}`);
  if (filters.to) where.push(`${occurredAt} <= ${utc(params.p(filters.to.toISOString()))}`);

  if (filters.status) {
    const statuses = APPLICATION_STATUS_MAP[filters.status];
    if (statuses.length === 0) return null;
    where.push(`a."paymentStatus"::text IN (${params.list(statuses)})`);
  }

  if (filters.paymentSource === 'offline') where.push(`a."paymentSource" = 'OFFLINE'`);
  if (filters.paymentSource === 'stripe') where.push(`a."paymentSource" = 'STRIPE'`);

  if (filters.hasRefunds === true) where.push(`EXISTS (SELECT 1 FROM "ApplicationRefund" r WHERE r."applicationId" = a."id" AND r."status" = 'SUCCEEDED')`);
  if (filters.hasRefunds === false) where.push(`NOT EXISTS (SELECT 1 FROM "ApplicationRefund" r WHERE r."applicationId" = a."id" AND r."status" = 'SUCCEEDED')`);

  if (filters.search) {
    const term = filters.search;
    if (isStripeId(term)) {
      const id = params.p(term);
      where.push(`(a."stripePaymentIntentId" = ${id} OR a."stripeCheckoutSessionId" = ${id} OR EXISTS (SELECT 1 FROM "ApplicationRefund" r WHERE r."applicationId" = a."id" AND r."stripeRefundId" = ${id}))`);
    } else {
      const exact = params.p(term);
      const like = params.p(`%${escapeLike(term)}%`);
      where.push(`(a."id" = ${exact} OR c."email" ILIKE ${like} OR c."firstName" ILIKE ${like} OR c."lastName" ILIKE ${like} OR (c."firstName" || ' ' || c."lastName") ILIKE ${like} OR p."businessName" ILIKE ${like})`);
    }
  }

  return `SELECT
      'APPLICATION'::text AS "type",
      a."id" AS "id",
      a."id" AS "reference",
      ${occurredAt} AS "occurredAt",
      a."paymentStatus"::text AS "sourceStatus",
      CASE WHEN a."paymentStatus" = 'NOT_REQUIRED' THEN 'PAID' ELSE ${APPLICATION_STATUS_CASE} END AS "status",
      c."id" AS "contactId",
      c."firstName" AS "firstName",
      c."lastName" AS "lastName",
      c."email" AS "email",
      p."businessName" AS "businessName",
      e."id" AS "eventId",
      e."name" AS "eventName",
      e."date" AS "eventDate",
      a."organizationId" AS "organizationId",
      org."name" AS "organizationName",
      CASE WHEN ${APPLICATION_PAID} THEN a."applicantPays" ELSE 0 END AS "gross",
      CASE WHEN ${APPLICATION_PAID} THEN a."subtotal" ELSE 0 END AS "subtotal",
      CASE WHEN ${APPLICATION_PAID} THEN a."platformFee" ELSE 0 END AS "platformFee",
      CASE WHEN ${APPLICATION_PAID} THEN a."processingFee" ELSE 0 END AS "processingFee",
      CASE WHEN ${APPLICATION_PAID} THEN a."tax" ELSE 0 END AS "tax",
      COALESCE((SELECT SUM(r."amount") FROM "ApplicationRefund" r WHERE r."applicationId" = a."id" AND r."status" = 'SUCCEEDED'), 0) AS "refunded",
      CASE WHEN a."paymentStatus" = 'PAYMENT_DUE' THEN a."applicantPays" ELSE NULL END AS "amountDue",
      a."paymentDueAt" AS "dueAt",
      a."stripePaymentIntentId" AS "stripePaymentIntentId",
      a."stripeCheckoutSessionId" AS "stripeCheckoutSessionId",
      a."stripeAccountId" AS "stripeAccountId",
      CASE WHEN a."paymentSource" = 'OFFLINE' THEN 'offline' ELSE 'stripe' END AS "paymentSource"
    FROM "Application" a
    JOIN "Contact" c ON c."id" = a."contactId"
    JOIN "ApplicantProfile" p ON p."id" = a."profileId"
    JOIN "Event" e ON e."id" = a."eventId"
    JOIN "Organization" org ON org."id" = a."organizationId"
    WHERE ${where.join('\n      AND ')}`;
}

/**
 * Prisma stores DateTime as `timestamp(3)` holding UTC wall-clock values. A
 * bound parameter compared directly would be read in the session time zone,
 * so the ISO string is parsed as timestamptz and shifted to UTC explicitly.
 */
function utc(placeholder) {
  return `(${placeholder}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Escape LIKE metacharacters so a literal `%` or `_` in the term matches itself. */
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * The union body (no ORDER BY / LIMIT). Returns null when the filters select
 * no half at all (e.g. `type=ORDER&status=PAYMENT_DUE`).
 */
function unionBody(filters, params) {
  const halves = [];
  if (!filters.type || filters.type === 'ORDER') {
    const sql = orderSelect(filters, params);
    if (sql) halves.push(sql);
  }
  if (!filters.type || filters.type === 'APPLICATION') {
    const sql = applicationSelect(filters, params);
    if (sql) halves.push(sql);
  }
  if (halves.length === 0) return null;
  return halves.map((h) => `(${h})`).join('\n    UNION ALL\n    ');
}

function orderBy(sort) {
  switch (sort) {
    case 'date':
      return `t."occurredAt" ASC, t."type" ASC, t."id" ASC`;
    case 'gross':
      return `t."gross" ASC, t."occurredAt" DESC, t."type" ASC, t."id" ASC`;
    case '-gross':
      return `t."gross" DESC, t."occurredAt" DESC, t."type" ASC, t."id" ASC`;
    case '-date':
    default:
      return `t."occurredAt" DESC, t."type" ASC, t."id" ASC`;
  }
}

/**
 * @typedef {Object} TransactionFilters
 * @property {string|null} organizationId  null = unscoped (SYSTEM_ADMIN)
 * @property {'ORDER'|'APPLICATION'} [type]
 * @property {string} [status]              one of TRANSACTION_STATUSES
 * @property {string} [eventId]
 * @property {Date} [from]
 * @property {Date} [to]
 * @property {boolean} [hasRefunds]
 * @property {'stripe'|'offline'} [paymentSource]
 * @property {string} [search]
 * @property {string[]} [ids]               restrict to these row ids (either type)
 * @property {string} [sort]                one of TRANSACTION_SORTS
 */

/**
 * List page. `{ sql: null }` means the filters cannot match anything.
 * @param {TransactionFilters} filters
 * @param {{ offset: number, limit: number }} page
 */
export function buildListSql(filters, { offset, limit }) {
  const params = new Params();
  const body = unionBody(filters, params);
  if (!body) return { sql: null, params: [] };
  const sql = `SELECT t.* FROM (\n    ${body}\n  ) t\n  ORDER BY ${orderBy(filters.sort)}\n  LIMIT ${params.p(limit)} OFFSET ${params.p(offset)}`;
  return { sql, params: params.values };
}

/** Total row count for the same filters. */
export function buildCountSql(filters) {
  const params = new Params();
  const body = unionBody(filters, params);
  if (!body) return { sql: null, params: [] };
  return { sql: `SELECT COUNT(*)::int AS "count" FROM (\n    ${body}\n  ) t`, params: params.values };
}
