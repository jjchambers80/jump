// Spec 024 backfill: the two application-orders migrations run against a
// scratch database at the pre-024 schema, seeded with every shape of
// application money the old ledger could hold. Asserts the orders, lines,
// payments and refunds they produce, and that the same SQL is what the
// `db push` helper script applies. Real Postgres; nothing mocked.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@jump/db';
import { resolveTestDatabaseUrl, maintenanceUrl, withDatabaseName } from '../testDatabase.js';
import {
  alreadyApplied,
  executeSqlFile,
  migrationFile,
} from '../../src/scripts/backfill-application-orders.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/prisma/migrations'
);
const CUTOVER = '20260930000000_application_orders_enums';
const SCRATCH_DB = 'jump_test_024_backfill';

const T = (day, hour = 12) =>
  `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;

describe('Application orders backfill (spec 024 migrations)', () => {
  const testUrl = resolveTestDatabaseUrl();
  const scratchUrl = withDatabaseName(testUrl, SCRATCH_DB);
  // A second client for the scratch database only — the shared `@jump/db`
  // client is bound to the test database and its schema.
  let db;

  const execute = (sql) =>
    execFileSync(
      'npx',
      ['prisma', 'db', 'execute', '--stdin', '--url', maintenanceUrl(scratchUrl)],
      {
        cwd: path.resolve(migrationsDir, '../..'),
        input: sql,
        env: { ...process.env, DATABASE_URL: scratchUrl },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

  beforeAll(async () => {
    execute(`DROP DATABASE IF EXISTS "${SCRATCH_DB}";`);
    execute(`CREATE DATABASE "${SCRATCH_DB}";`);
    // Every migration before the cutover, in order: the pre-024 schema.
    const names = fs
      .readdirSync(migrationsDir)
      .filter((n) => /^\d{14}_/.test(n))
      .sort();
    for (const name of names) {
      if (name >= CUTOVER) break;
      executeSqlFile(path.join(migrationsDir, name, 'migration.sql'), scratchUrl);
    }
    db = new PrismaClient({ datasourceUrl: scratchUrl });
    try {
      await seed(db);
    } catch (error) {
      throw new Error(`seed failed: ${JSON.stringify(error.meta ?? error.message).slice(0, 1200)}`);
    }
  }, 180_000);

  afterAll(async () => {
    await db?.$disconnect();
    execute(`DROP DATABASE IF EXISTS "${SCRATCH_DB}";`);
  });

  it('pre-024 schema is seeded and the helper reports nothing applied', async () => {
    expect(await alreadyApplied(db)).toBe(false);
    const [{ count }] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "Application"`
    );
    expect(count).toBe(7);
  });

  it('applies both migrations and turns every PAID-form application into an order', async () => {
    executeSqlFile(migrationFile(CUTOVER), scratchUrl);
    executeSqlFile(migrationFile('20260930000001_application_orders'), scratchUrl);
    expect(await alreadyApplied(db)).toBe(true);

    const orders = await db.$queryRawUnsafe(`
      SELECT o.*, a."status" AS app_status, a."paymentStatus" AS app_payment
      FROM "Order" o LEFT JOIN "Application" a ON a."id" = o."applicationId"
      ORDER BY o."orderRef"`);
    const byApp = Object.fromEntries(
      orders.filter((o) => o.applicationId).map((o) => [o.applicationId, o])
    );

    // One order per application on a PAID form; the FREE one has none.
    expect(orders.filter((o) => o.kind === 'APPLICATION')).toHaveLength(6);
    expect(byApp.app_free).toBeUndefined();
    for (const o of Object.values(byApp)) {
      expect(o.orderRef).toMatch(/^JMP-[A-Z2-9]{6}$/);
      expect(o.quantity).toBe(1);
    }

    // Status mapping
    expect(byApp.app_paid).toMatchObject({ status: 'PARTIALLY_REFUNDED', feeMode: 'PASS' });
    expect(Number(byApp.app_paid.totalAmount)).toBe(281.5);
    expect(Number(byApp.app_paid.orgReceives)).toBe(255);
    expect(byApp.app_paid.paidAt.toISOString()).toBe('2026-09-02T12:00:00.000Z');
    expect(byApp.app_due).toMatchObject({ status: 'PENDING' });
    expect(byApp.app_due.dueAt.toISOString()).toBe('2026-09-12T12:00:00.000Z');
    expect(byApp.app_withdrawn).toMatchObject({ status: 'CANCELLED' });
    expect(byApp.app_offline).toMatchObject({ status: 'COMPLETED' });
    expect(byApp.app_waived).toMatchObject({ status: 'COMPLETED' });
    expect(Number(byApp.app_waived.totalAmount)).toBe(0);
    expect(byApp.app_draft).toMatchObject({ status: 'PENDING' });

    // Lines: tier line + add-on line + adjustment on the paid one; fees sum to the order
    const items = await db.$queryRawUnsafe(
      `SELECT * FROM "OrderItem" WHERE "orderId" = $1 ORDER BY "kind"`,
      byApp.app_paid.id
    );
    expect(items.map((i) => i.kind).sort()).toEqual(['ADJUSTMENT', 'APPLICATION_TIER']);
    const tierLine = items.find((i) => i.kind === 'APPLICATION_TIER');
    expect(tierLine).toMatchObject({
      applicationTierId: 'tier_booth',
      description: '10x10',
      quantity: 1,
    });
    expect(Number(tierLine.unitPrice)).toBe(250);
    const adjustment = items.find((i) => i.kind === 'ADJUSTMENT');
    expect(adjustment).toMatchObject({
      id: 'adj_1',
      description: 'Returning vendor',
      createdById: 'user_1',
    });
    expect(Number(adjustment.unitPrice)).toBe(-25);
    const addOnLines = await db.$queryRawUnsafe(
      `SELECT * FROM "OrderAddOn" WHERE "orderId" = $1`,
      byApp.app_paid.id
    );
    expect(addOnLines).toHaveLength(1);
    expect(addOnLines[0]).toMatchObject({ id: 'aal_1', addOnId: 'addon_power', quantity: 2 });
    expect(Number(addOnLines[0].unitPrice)).toBe(15);
    const sumFees = (rows, col) => rows.reduce((s, r) => s + Number(r[col]), 0);
    expect(sumFees([...items, ...addOnLines], 'platformFee')).toBeCloseTo(
      Number(byApp.app_paid.platformFeeAmount),
      2
    );
    expect(sumFees([...items, ...addOnLines], 'processingFee')).toBeCloseTo(
      Number(byApp.app_paid.processingFeeAmount),
      2
    );
    expect(sumFees([...items, ...addOnLines], 'tax')).toBeCloseTo(
      Number(byApp.app_paid.taxAmount),
      2
    );
    // A non-taxable add-on carries no tax; the tier line carries it all.
    expect(Number(addOnLines[0].tax)).toBe(0);

    // Waiver line on the waived order
    const waiver = await db.$queryRawUnsafe(
      `SELECT * FROM "OrderItem" WHERE "orderId" = $1 AND "kind" = 'WAIVER'`,
      byApp.app_waived.id
    );
    expect(waiver).toHaveLength(1);
    expect(Number(waiver[0].unitPrice)).toBe(-215.5);

    // Payments
    const payments = await db.$queryRawUnsafe(
      `SELECT * FROM "PaymentTransaction" WHERE "orderId" = ANY($1) ORDER BY "orderId"`,
      Object.values(byApp).map((o) => o.id)
    );
    const payByApp = Object.fromEntries(
      payments.map((p) => [Object.values(byApp).find((o) => o.id === p.orderId).applicationId, p])
    );
    expect(payByApp.app_paid).toMatchObject({
      stripePaymentIntentId: 'pi_paid',
      status: 'SUCCEEDED',
      source: 'STRIPE',
      stripeAccountId: 'acct_x',
    });
    expect(Number(payByApp.app_paid.applicationFee)).toBe(26.5);
    expect(payByApp.app_due).toMatchObject({
      stripePaymentIntentId: 'pi_declined',
      status: 'FAILED',
      source: 'STRIPE',
    });
    expect(payByApp.app_offline).toMatchObject({
      stripePaymentIntentId: null,
      status: 'SUCCEEDED',
      source: 'OFFLINE',
      offlineMethod: 'CHEQUE',
      offlineReference: '#1042',
      recordedById: 'user_1',
    });
    expect(payByApp.app_withdrawn).toBeUndefined();
    expect(payByApp.app_waived).toBeUndefined();
    expect(payByApp.app_draft).toBeUndefined();

    // Refunds moved with their ids and flags
    const refunds = await db.$queryRawUnsafe(
      `SELECT * FROM "Refund" WHERE "orderId" = $1`,
      byApp.app_paid.id
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      id: 'aref_1',
      stripeRefundId: 're_1',
      status: 'SUCCEEDED',
      manual: false,
      initiatedBy: 'user_1',
    });
    expect(Number(refunds[0].amount)).toBe(10);
    const manual = await db.$queryRawUnsafe(
      `SELECT * FROM "Refund" WHERE "orderId" = $1`,
      byApp.app_offline.id
    );
    expect(manual[0]).toMatchObject({ manual: true, stripeRefundId: null });

    // Ticket orders: orgReceives and paidAt filled, kind defaulted
    const ticket = orders.find((o) => o.orderRef === 'JMP-TICKET');
    expect(ticket).toMatchObject({ kind: 'TICKET', status: 'COMPLETED' });
    expect(Number(ticket.orgReceives)).toBe(40);
    expect(ticket.paidAt.toISOString()).toBe('2026-09-01T12:30:00.000Z');
    const ticketItems = await db.$queryRawUnsafe(
      `SELECT "kind", "priceTierId" FROM "OrderItem" WHERE "orderId" = $1`,
      ticket.id
    );
    expect(ticketItems).toEqual([{ kind: 'TICKET_TIER', priceTierId: 'ptier_ga' }]);

    // The application-side ledger is gone
    const tables = await db.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('ApplicationRefund', 'ApplicationAdjustment', 'ApplicationAddOn')`
    );
    expect(tables).toEqual([]);
    const columns = await db.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Application' AND column_name IN ('applicantPays', 'stripePaymentIntentId', 'paymentDueAt', 'paymentSource')`
    );
    expect(columns).toEqual([]);
  }, 120_000);
});

/** The pre-024 world: one organization, a PAID and a FREE form, seven applications, one ticket order. */
async function seed(db) {
  const now = T(1);
  const q = (sql, ...params) => db.$executeRawUnsafe(sql, ...params);
  await q(
    `INSERT INTO "Organization" ("id", "name", "slug", "updatedAt") VALUES ('org_1', 'Backfill Co', 'backfill-co', $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "Venue" ("id", "organizationId", "name", "address", "updatedAt") VALUES ('venue_1', 'org_1', 'Hall', '1 Main', $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "Event" ("id", "venueId", "name", "date", "capacity", "status", "taxRate", "updatedAt") VALUES ('event_1', 'venue_1', 'Expo', $1, 100, 'PUBLISHED'::"EventStatus", 0.0725, $1)`,
    new Date(T(30))
  );
  await q(
    `INSERT INTO "PriceTier" ("id", "eventId", "name", "price", "quantityTotal", "updatedAt") VALUES ('ptier_ga', 'event_1', 'GA', 20, 100, $1)`,
    new Date(now)
  );
  for (const [id, email] of [
    ['c_paid', 'paid@x.test'],
    ['c_due', 'due@x.test'],
    ['c_wd', 'wd@x.test'],
    ['c_off', 'off@x.test'],
    ['c_waived', 'waived@x.test'],
    ['c_free', 'free@x.test'],
    ['c_draft', 'draft@x.test'],
    ['c_buyer', 'buyer@x.test'],
  ]) {
    await q(
      `INSERT INTO "Contact" ("id", "organizationId", "email", "firstName", "lastName", "updatedAt") VALUES ($1, 'org_1', $2, 'A', 'B', $3)`,
      id,
      email,
      new Date(now)
    );
    if (id !== 'c_buyer')
      await q(
        `INSERT INTO "ApplicantProfile" ("id", "organizationId", "contactId", "businessName", "updatedAt") VALUES ($1, 'org_1', $2, $3, $4)`,
        `p_${id}`,
        id,
        `${id} Co`,
        new Date(now)
      );
  }
  await q(
    `INSERT INTO "ApplicationForm" ("id", "eventId", "kind", "name", "slug", "status", "taxable", "updatedAt") VALUES ('form_paid', 'event_1', 'PAID'::"ApplicationFormKind", 'Vendors', 'vendors', 'OPEN'::"ApplicationFormStatus", true, $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "ApplicationForm" ("id", "eventId", "kind", "name", "slug", "status", "updatedAt") VALUES ('form_free', 'event_1', 'FREE'::"ApplicationFormKind", 'Press', 'press', 'OPEN'::"ApplicationFormStatus", $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "ApplicationTier" ("id", "formId", "name", "price", "quantityTotal", "updatedAt") VALUES ('tier_booth', 'form_paid', '10x10', 250, 10, $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "AddOn" ("id", "eventId", "name", "price", "taxable", "updatedAt") VALUES ('addon_power', 'event_1', 'Power', 15, false, $1)`,
    new Date(now)
  );

  const app = (id, contact, form, fields) =>
    q(
      `INSERT INTO "Application" ("id", "formId", "eventId", "organizationId", "contactId", "profileId", "tierId", "status", "paymentStatus", "capacitySlot",
        "subtotal", "platformFee", "processingFee", "tax", "applicantPays", "orgReceives", "feeMode", "currency",
        "stripePaymentIntentId", "stripeAccountId", "applicationFee", "paidAt", "paymentDueAt", "paymentSource", "offlinePaymentMethod", "offlinePaymentReference", "offlinePaymentRecordedById",
        "submittedAt", "statusTokenHash", "createdAt", "updatedAt")
       VALUES ($1, $3, 'event_1', 'org_1', $2, $4, $5, $6::"ApplicationStatus", $7::"ApplicationPayment", $8::"CapacitySlot", $9, $10, $11, $12, $13, $14, $15::"FeeMode", 'usd', $16, $17, $18, $19, $20, $21::"PaymentSource", $22::"OfflinePaymentMethod", $23, $24, $25, $26, $27, $27)`,
      id,
      contact,
      form,
      `p_${contact}`,
      form === 'form_paid' ? 'tier_booth' : null,
      fields.status,
      fields.paymentStatus,
      fields.capacitySlot ?? 'NONE',
      fields.subtotal ?? 0,
      fields.platformFee ?? 0,
      fields.processingFee ?? 0,
      fields.tax ?? 0,
      fields.applicantPays ?? 0,
      fields.orgReceives ?? 0,
      fields.feeMode ?? 'PASS',
      fields.intent ?? null,
      fields.account ?? null,
      fields.applicationFee ?? null,
      fields.paidAt ? new Date(fields.paidAt) : null,
      fields.dueAt ? new Date(fields.dueAt) : null,
      fields.source ?? 'STRIPE',
      fields.method ?? null,
      fields.reference ?? null,
      fields.recordedBy ?? null,
      fields.submittedAt ? new Date(fields.submittedAt) : null,
      `hash_${id}`,
      new Date(fields.createdAt ?? now)
    );

  // Paid (Stripe, Connect-routed), add-on ×2, −25 adjustment, 10 refunded: subtotal 255 (250 − 25 + 30), fee 13.75 + 1 = 14.75 (say), tax on tier only 16.31
  await app('app_paid', 'c_paid', 'form_paid', {
    status: 'APPROVED',
    paymentStatus: 'PARTIALLY_REFUNDED',
    capacitySlot: 'APPROVED',
    subtotal: 255,
    platformFee: 12.75,
    processingFee: 1,
    tax: 12.75,
    applicantPays: 281.5,
    orgReceives: 255,
    intent: 'pi_paid',
    account: 'acct_x',
    applicationFee: 26.5,
    paidAt: T(2),
    submittedAt: T(1),
    createdAt: T(1),
  });
  await q(
    `INSERT INTO "ApplicationAddOn" ("id", "applicationId", "addOnId", "quantity", "unitPrice", "applicantPays", "updatedAt") VALUES ('aal_1', 'app_paid', 'addon_power', 2, 15, 31.62, $1)`,
    new Date(now)
  );
  await q(
    `INSERT INTO "ApplicationAdjustment" ("id", "applicationId", "kind", "amount", "reason", "createdById") VALUES ('adj_1', 'app_paid', 'ADJUSTMENT'::"AdjustmentKind", -25, 'Returning vendor', 'user_1')`
  );
  await q(
    `INSERT INTO "ApplicationRefund" ("id", "applicationId", "amount", "reason", "status", "stripeRefundId", "initiatedBy", "manual") VALUES ('aref_1', 'app_paid', 10, 'Smaller booth', 'SUCCEEDED'::"RefundStatus", 're_1', 'user_1', false)`
  );
  // Declined → PAYMENT_DUE with the failed intent and a due date
  await app('app_due', 'c_due', 'form_paid', {
    status: 'APPROVED',
    paymentStatus: 'PAYMENT_DUE',
    capacitySlot: 'RESERVED',
    subtotal: 250,
    platformFee: 12.5,
    processingFee: 1,
    tax: 18.13,
    applicantPays: 281.63,
    orgReceives: 250,
    intent: 'pi_declined',
    dueAt: T(12),
    submittedAt: T(3),
    createdAt: T(3),
  });
  // Withdrawn before any charge
  await app('app_withdrawn', 'c_wd', 'form_paid', {
    status: 'WITHDRAWN',
    paymentStatus: 'CARD_ON_FILE',
    subtotal: 250,
    platformFee: 12.5,
    processingFee: 1,
    tax: 18.13,
    applicantPays: 281.63,
    orgReceives: 250,
    submittedAt: T(4),
    createdAt: T(4),
  });
  // Offline cheque, then a manual refund
  await app('app_offline', 'c_off', 'form_paid', {
    status: 'APPROVED',
    paymentStatus: 'PAID',
    capacitySlot: 'APPROVED',
    subtotal: 250,
    platformFee: 12.5,
    processingFee: 1,
    tax: 18.13,
    applicantPays: 281.63,
    orgReceives: 250,
    paidAt: T(5),
    source: 'OFFLINE',
    method: 'CHEQUE',
    reference: '#1042',
    recordedBy: 'user_1',
    submittedAt: T(4),
    createdAt: T(4),
  });
  await q(
    `INSERT INTO "ApplicationRefund" ("id", "applicationId", "amount", "reason", "status", "stripeRefundId", "initiatedBy", "manual") VALUES ('aref_2', 'app_offline', 20, 'Left early', 'SUCCEEDED'::"RefundStatus", NULL, 'user_1', true)`
  );
  // Waived balance: zero snapshot, WAIVER row, settled offline
  await app('app_waived', 'c_waived', 'form_paid', {
    status: 'APPROVED',
    paymentStatus: 'NOT_REQUIRED',
    capacitySlot: 'APPROVED',
    source: 'OFFLINE',
    submittedAt: T(5),
    createdAt: T(5),
  });
  await q(
    `INSERT INTO "ApplicationAdjustment" ("id", "applicationId", "kind", "amount", "reason", "createdById") VALUES ('adj_w', 'app_waived', 'WAIVER'::"AdjustmentKind", -215.5, 'Sponsor trade', 'user_1')`
  );
  // FREE form: no money, no order
  await app('app_free', 'c_free', 'form_free', {
    status: 'SUBMITTED',
    paymentStatus: 'NOT_REQUIRED',
    submittedAt: T(6),
    createdAt: T(6),
  });
  // Abandoned DRAFT on the paid form
  await app('app_draft', 'c_draft', 'form_paid', {
    status: 'DRAFT',
    paymentStatus: 'AWAITING_CARD',
    subtotal: 250,
    platformFee: 12.5,
    processingFee: 1,
    tax: 18.13,
    applicantPays: 281.63,
    orgReceives: 250,
    createdAt: T(7),
  });

  // A ticket order with its payment, to check the ticket-side backfill
  await q(
    `INSERT INTO "Order" ("id", "eventId", "contactId", "orderRef", "totalAmount", "subtotalAmount", "platformFeeAmount", "processingFeeAmount", "taxAmount", "quantity", "status", "createdAt", "updatedAt")
     VALUES ('order_t', 'event_1', 'c_buyer', 'JMP-TICKET', 44.9, 40, 2, 1, 1.9, 2, 'COMPLETED'::"OrderStatus", $1, $1)`,
    new Date(T(1))
  );
  await q(
    `INSERT INTO "OrderItem" ("id", "orderId", "priceTierId", "quantity", "unitPrice") VALUES ('oi_t', 'order_t', 'ptier_ga', 2, 20)`
  );
  await q(
    `INSERT INTO "PaymentTransaction" ("id", "orderId", "stripePaymentIntentId", "amount", "status", "createdAt") VALUES ('pt_t', 'order_t', 'pi_ticket', 44.9, 'SUCCEEDED'::"PaymentStatus", $1)`,
    new Date('2026-09-01T12:30:00Z')
  );
}
