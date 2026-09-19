// Contract tests for application orders (spec 024 phase 1): a PAID-form
// application is an Order from submission on. Covers the order at
// submission (and its absence on FREE forms), Order.status beside every
// paymentStatus transition, the PaymentTransaction written by the charge,
// decline, pay-now and offline paths, refunds through the order route, and
// the admin order list / detail exposing application orders. Stripe and
// Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: {
    emails: {
      send: jest.fn(async (msg) => {
        sentEmails.push(msg);
        return { id: 'mock' };
      }),
    },
  },
}));

const mockSessionsCreate = jest.fn();
const mockSessionsExpire = jest.fn();
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockIntentsRetrieve = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: { create: mockSessionsCreate, retrieve: jest.fn(), expire: mockSessionsExpire },
    },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: mockIntentsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    refunds: { create: mockRefundsCreate },
    webhooks: { constructEvent: jest.fn((body) => JSON.parse(body.toString())) },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } =
  await import('../../src/services/PaymentSettingsService.js');
const { orderStatusFor } = await import('../../src/services/applicationOrderStatus.js');
const { appRow: loadRow, cleanupApplicationOrders } = await import('../helpers/applicationRow.js');

const TAG = 'apporders';

paymentSettingsService._statusCache = {
  value: {
    provider: 'STRIPE',
    mode: 'test',
    charges: 'active',
    statementDescriptorPrefix: 'JUMP',
    capabilities: {},
    manageUrl: '',
    radarUrl: '',
    error: null,
  },
  expiresAt: Number.POSITIVE_INFINITY,
};

let n = 0;
function resetStripeMocks() {
  mockSessionsCreate
    .mockReset()
    .mockImplementation(async (params) => ({
      id: `cs_${TAG}_${++n}`,
      url: `https://checkout.stripe.com/c/pay/cs_${TAG}_${n}`,
      mode: params.mode,
      metadata: params.metadata,
    }));
  mockSessionsExpire.mockReset().mockResolvedValue({});
  mockCustomersCreate.mockReset().mockImplementation(async () => ({ id: `cus_${TAG}_${++n}` }));
  mockIntentsCreate
    .mockReset()
    .mockImplementation(async () => ({ id: `pi_${TAG}_${++n}`, status: 'succeeded' }));
  mockIntentsRetrieve
    .mockReset()
    .mockResolvedValue({ transfer_data: null, application_fee_amount: null });
  mockSetupIntentsRetrieve
    .mockReset()
    .mockImplementation(async (id) => ({ id, payment_method: `pm_${TAG}_${id}` }));
  mockRefundsCreate
    .mockReset()
    .mockImplementation(async (params) => ({
      id: `re_${TAG}_${++n}`,
      amount: params.amount,
      status: 'succeeded',
    }));
}

function cardDecline() {
  const err = new Error('Your card was declined.');
  err.type = 'StripeCardError';
  err.code = 'card_declined';
  err.raw = { payment_intent: { id: `pi_${TAG}_declined_${++n}` } };
  return err;
}

const webhook = (event) =>
  request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
const checkoutCompleted = (session) => ({
  id: `evt_${Math.random()}`,
  type: 'checkout.session.completed',
  data: { object: session },
});

describe('Application orders contract (spec 024 phase 1)', () => {
  let adminToken;
  let org;
  let eventId;
  let paidForm;
  let freeForm;
  let priceTier;
  const emails = [`admin@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const adminBase = () => `/admin/events/${eventId}`;

  const submit = (formSlug, tierId, email, extra = {}) =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({
        formSlug,
        tierId,
        contact: { email, firstName: 'Vee', lastName: 'Vendor' },
        profile: { businessName: `${email.split('@')[0]} Co` },
        answers: {},
        ...extra,
      });
  const appRow = (id) => loadRow(id, { tier: true, contact: true, decisions: true });
  const orderRow = (applicationId) =>
    prisma.order.findUnique({
      where: { applicationId },
      include: { items: true, addOns: true, payment: true, refunds: true },
    });

  async function cardOnFile(applicationId) {
    const row = await appRow(applicationId);
    const res = await webhook(
      checkoutCompleted({
        id: row.stripeCheckoutSessionId,
        mode: 'setup',
        setup_intent: `seti_${applicationId}`,
        customer: row.contact.stripeCustomerId,
        metadata: { applicationId, purpose: 'submit' },
      })
    );
    expect(res.status).toBe(200);
    return appRow(applicationId);
  }
  const decide = (id, decision) =>
    request(app)
      .post(`${adminBase()}/applications/${id}/decision`)
      .set(...auth(adminToken))
      .send({ decision, sendEmail: false });

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({
      data: { name: `${TAG} Expo Co`, email: `owner@${TAG}.test` },
    });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Hall`,
        address: '1 Main',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo`,
        date: new Date('2027-09-18T15:00:00Z'),
        status: 'PUBLISHED',
        capacity: 500,
        taxRate: 0.0725,
      },
    });
    eventId = event.id;
    priceTier = await prisma.priceTier.create({
      data: { eventId, name: 'GA', price: 20, quantityTotal: 100 },
    });
    const p = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'PAID',
        name: 'Vendors',
        chargeTiming: 'APPROVAL',
        taxable: true,
        paymentDueDays: 5,
        tiers: [{ name: '10x10', price: 250, quantityTotal: 10 }],
      });
    expect(p.status).toBe(201);
    paidForm = p.body;
    const f = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'FREE', name: 'Press', questions: [] });
    expect(f.status).toBe(201);
    freeForm = f.body;
    for (const form of [paidForm, freeForm]) {
      const opened = await request(app)
        .patch(`${adminBase()}/application-forms/${form.id}`)
        .set(...auth(adminToken))
        .send({ status: 'OPEN' });
      expect(opened.status).toBe(200);
    }
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await cleanupApplicationOrders(org.id);
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.refund.deleteMany({ where: { order: { eventId } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    resetStripeMocks();
    sentEmails.length = 0;
  });

  // ─── Order at submission ────────────────────────────────────────────────

  it('a PAID-form submission creates a PENDING order with the tier line; a FREE-form submission creates none', async () => {
    const tier = paidForm.tiers[0];
    const res = await submit(paidForm.slug, tier.id, `first@${TAG}.test`);
    expect(res.status).toBe(201);
    expect(res.body.orderRef).toMatch(/^JMP-[A-Z2-9]{6}$/);
    const order = await orderRow(res.body.applicationId);
    expect(order).toMatchObject({
      kind: 'APPLICATION',
      status: 'PENDING',
      orderRef: res.body.orderRef,
      quantity: 1,
      feeMode: 'PASS',
      paidAt: null,
      dueAt: null,
    });
    expect(order.eventId).toBe(eventId);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      kind: 'APPLICATION_TIER',
      applicationTierId: tier.id,
      description: '10x10',
      quantity: 1,
    });
    expect(Number(order.items[0].unitPrice)).toBe(250);
    expect(Number(order.subtotalAmount)).toBe(250);
    expect(Number(order.orgReceives)).toBe(250);
    expect(Number(order.totalAmount)).toBe(tier.amounts.applicantPays);
    expect(Number(order.taxAmount)).toBe(tier.amounts.tax);
    // Every column sums to the lines
    expect(Number(order.items[0].platformFee)).toBe(Number(order.platformFeeAmount));
    expect(Number(order.items[0].tax)).toBe(Number(order.taxAmount));
    expect(order.payment).toBeNull();
    // Stripe metadata carries the order too
    expect(mockSessionsCreate.mock.calls[0][0].metadata).toMatchObject({
      applicationId: res.body.applicationId,
      orderId: order.id,
      orderRef: order.orderRef,
    });

    const free = await submit(freeForm.slug, undefined, `press@${TAG}.test`);
    expect(free.status).toBe(201);
    expect(free.body.orderRef).toBeNull();
    expect(await orderRow(free.body.applicationId)).toBeNull();
    const detail = await request(app)
      .get(`${adminBase()}/applications/${free.body.applicationId}`)
      .set(...auth(adminToken));
    expect(detail.body).toMatchObject({
      orderRef: null,
      amounts: { applicantPays: 0 },
      refunds: [],
      adjustments: [],
    });
    // FREE forms: the RECEIVED email only, never a receipt (spec 024 phase 2).
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/received your application/)]);
  });

  // ─── Status mapping across the lifecycle ────────────────────────────────

  it('Order.status follows every transition: card on file, approve + charge, refund; reject before a charge cancels', async () => {
    const tier = paidForm.tiers[0];
    const created = await submit(paidForm.slug, tier.id, `lifecycle@${TAG}.test`);
    const id = created.body.applicationId;
    let row = await cardOnFile(id);
    expect(row).toMatchObject({
      status: 'SUBMITTED',
      paymentStatus: 'CARD_ON_FILE',
      orderStatus: 'PENDING',
    });

    const approved = await decide(id, 'APPROVE');
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      paymentStatus: 'PAID',
      orderRef: created.body.orderRef,
      orderId: expect.any(String),
    });
    const order = await orderRow(id);
    expect(order).toMatchObject({ status: 'COMPLETED' });
    expect(order.paidAt).toBeTruthy();
    expect(order.payment).toMatchObject({
      status: 'SUCCEEDED',
      source: 'STRIPE',
      stripePaymentIntentId: expect.stringMatching(/^pi_/),
      stripeAccountId: null,
    });
    expect(Number(order.payment.amount)).toBe(Number(order.totalAmount));
    expect(orderStatusFor({ status: 'APPROVED', paymentStatus: 'PAID' })).toBe('COMPLETED');
    // Receipt (spec 024 phase 2): once, to the applicant, with the order number and the lines.
    const receipts = sentEmails.filter((e) => /^Receipt for/.test(e.subject));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ to: [`lifecycle@${TAG}.test`], subject: `Receipt for ${TAG} Expo (${created.body.orderRef})` });
    expect(receipts[0].text).toContain('Vendors — 10x10: $');
    expect(receipts[0].text).toContain(`Total paid: $${Number(order.totalAmount).toFixed(2)}`);
    expect(receipts[0].text).toContain('Payment method: Card');

    // Partial refund from the ORDER route (amount honoured for application orders)
    const partial = await request(app)
      .post(`/admin/orders/${order.id}/refund`)
      .set(...auth(adminToken))
      .send({ amount: 40, reason: 'Smaller table' });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      amount: 40,
      status: 'SUCCEEDED',
      manual: false,
      orderRef: created.body.orderRef,
    });
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: order.payment.stripePaymentIntentId,
      amount: 4000,
      metadata: { orderId: order.id, applicationId: id },
    });
    row = await appRow(id);
    expect(row).toMatchObject({
      paymentStatus: 'PARTIALLY_REFUNDED',
      orderStatus: 'PARTIALLY_REFUNDED',
    });
    expect(row.refunds).toHaveLength(1);
    const history = await request(app)
      .get(`/admin/orders/${order.id}/refunds`)
      .set(...auth(adminToken));
    expect(history.status).toBe(200);
    expect(history.body.refunds[0]).toMatchObject({
      amount: 40,
      manual: false,
      ticket: null,
      addOn: null,
    });

    // Full refund from the application route lands on the same ledger
    const full = await request(app)
      .post(`${adminBase()}/applications/${id}/refund`)
      .set(...auth(adminToken))
      .send({});
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect((await orderRow(id)).status).toBe('REFUNDED');
    expect((await orderRow(id)).refunds).toHaveLength(2);

    // Reject before any charge → CANCELLED
    const rejected = await submit(paidForm.slug, tier.id, `rejected@${TAG}.test`);
    await cardOnFile(rejected.body.applicationId);
    expect((await decide(rejected.body.applicationId, 'REJECT')).status).toBe(200);
    expect(await orderRow(rejected.body.applicationId)).toMatchObject({ status: 'CANCELLED' });

    // Withdraw by the applicant (guest token) → CANCELLED as well
    const withdrawn = await submit(paidForm.slug, tier.id, `withdrawn@${TAG}.test`);
    await cardOnFile(withdrawn.body.applicationId);
    expect((await decide(withdrawn.body.applicationId, 'WITHDRAW')).status).toBe(200);
    expect(await orderRow(withdrawn.body.applicationId)).toMatchObject({ status: 'CANCELLED' });
  });

  it('a declined charge writes the failed payment and the due date on the order; pay-now settles it; offline payment is an OFFLINE payment row', async () => {
    const tier = paidForm.tiers[0];
    // Decline → PENDING + dueAt + FAILED payment
    const declined = await submit(paidForm.slug, tier.id, `declined@${TAG}.test`);
    const dueId = declined.body.applicationId;
    await cardOnFile(dueId);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    const res = await decide(dueId, 'APPROVE');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE' });
    let order = await orderRow(dueId);
    expect(order.status).toBe('PENDING');
    expect(order.dueAt).toBeTruthy();
    expect(order.payment).toMatchObject({
      status: 'FAILED',
      stripePaymentIntentId: expect.stringMatching(/^pi_.*declined/),
      failureReason: 'Your card was declined.',
    });
    expect(res.body.payment.paymentDueAt).toBe(order.dueAt.toISOString());

    // Pay-now session then the paid webhook: the payment row is overwritten with the settled intent
    const { statusToken } = await import('../../src/services/applicationLinks.js');
    const pay = await request(app).post(`/applications/${dueId}/pay?token=${statusToken(dueId)}`);
    expect(pay.status).toBe(200);
    const session = mockSessionsCreate.mock.calls.at(-1)[0];
    expect(session.metadata).toMatchObject({ orderId: order.id, purpose: 'pay_now' });
    expect(session.line_items[0].price_data.unit_amount).toBe(
      Math.round(Number(order.totalAmount) * 100)
    );
    const paid = await webhook(
      checkoutCompleted({
        id: (await appRow(dueId)).stripeCheckoutSessionId,
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: `pi_${TAG}_paynow`,
        metadata: { applicationId: dueId, purpose: 'pay_now' },
      })
    );
    expect(paid.status).toBe(200);
    order = await orderRow(dueId);
    expect(order).toMatchObject({ status: 'COMPLETED', dueAt: null });
    expect(order.payment).toMatchObject({
      status: 'SUCCEEDED',
      stripePaymentIntentId: `pi_${TAG}_paynow`,
      failureReason: null,
    });

    // Offline: another declined application settled by cheque
    const cheque = await submit(paidForm.slug, tier.id, `cheque@${TAG}.test`);
    const chequeId = cheque.body.applicationId;
    await cardOnFile(chequeId);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    await decide(chequeId, 'APPROVE');
    const due = (await appRow(chequeId)).applicantPays;
    const offline = await request(app)
      .post(`${adminBase()}/applications/${chequeId}/offline-payment`)
      .set(...auth(adminToken))
      .send({ method: 'CHEQUE', amount: due, reference: '#77', sendEmail: false });
    expect(offline.status).toBe(200);
    order = await orderRow(chequeId);
    expect(order).toMatchObject({ status: 'COMPLETED', dueAt: null });
    expect(order.payment).toMatchObject({
      status: 'SUCCEEDED',
      source: 'OFFLINE',
      offlineMethod: 'CHEQUE',
      offlineReference: '#77',
      stripePaymentIntentId: null,
    });
    // Manual refund through the order route: no Stripe call
    const manual = await request(app)
      .post(`/admin/orders/${order.id}/refund`)
      .set(...auth(adminToken))
      .send({ amount: 10, reason: 'Left early' });
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({ manual: true, stripeRefundId: null, amount: 10 });
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect((await appRow(chequeId)).paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('waiving a balance settles the order at 0 with a WAIVER line and no payment row', async () => {
    const tier = paidForm.tiers[0];
    const created = await submit(paidForm.slug, tier.id, `waived@${TAG}.test`);
    const id = created.body.applicationId;
    await cardOnFile(id);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    await decide(id, 'APPROVE');
    const before = await orderRow(id);
    const res = await request(app)
      .post(`${adminBase()}/applications/${id}/waive`)
      .set(...auth(adminToken))
      .send({ reason: 'Trade', sendEmail: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentStatus: 'NOT_REQUIRED',
      paymentSource: 'offline',
      amounts: { applicantPays: 0, orgReceives: 0 },
    });
    const order = await orderRow(id);
    expect(order).toMatchObject({ status: 'COMPLETED', dueAt: null });
    expect(Number(order.totalAmount)).toBe(0);
    expect(order.paidAt).toBeTruthy();
    const waiver = order.items.find((i) => i.kind === 'WAIVER');
    expect(waiver).toMatchObject({ description: 'Trade' });
    expect(Number(waiver.unitPrice)).toBe(-Number(before.totalAmount));
    expect(order.items.find((i) => i.kind === 'APPLICATION_TIER')).toBeTruthy();
    // The declined attempt's payment row is left as history; there is no SUCCEEDED payment.
    expect(order.payment?.status ?? 'FAILED').toBe('FAILED');
  });

  // ─── Admin order list and detail ─────────────────────────────────────────

  it('admin order list and detail expose application orders; ticket orders refuse a partial amount', async () => {
    const list = await request(app)
      .get(`/admin/orders?eventId=${eventId}&limit=50`)
      .set(...auth(adminToken));
    expect(list.status).toBe(200);
    const kinds = new Set(list.body.data.map((o) => o.kind));
    expect(kinds.has('APPLICATION')).toBe(true);
    const row = list.body.data.find((o) => o.status === 'REFUNDED');
    expect(row).toMatchObject({
      kind: 'APPLICATION',
      applicationId: expect.any(String),
      quantity: 1,
    });
    expect(row.paidAt).toBeTruthy();

    const detail = await request(app)
      .get(`/admin/orders/${row.id}`)
      .set(...auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      kind: 'APPLICATION',
      status: 'REFUNDED',
      tickets: [],
      feeMode: 'PASS',
      application: {
        id: row.applicationId,
        eventId,
        status: 'APPROVED',
        paymentStatus: 'REFUNDED',
        formName: 'Vendors',
        tierName: '10x10',
        businessName: 'lifecycle Co',
      },
    });
    expect(detail.body.items[0]).toMatchObject({
      kind: 'APPLICATION_TIER',
      priceTierName: '10x10',
      description: '10x10',
    });
    expect(detail.body.payment).toMatchObject({
      source: 'STRIPE',
      stripePaymentIntentId: expect.stringMatching(/^pi_/),
    });

    // A ticket order: `amount` is refused (per ticket, per line, or in full)
    const contact = await prisma.contact.create({
      data: {
        organizationId: org.id,
        email: `buyer@${TAG}.test`,
        firstName: 'B',
        lastName: 'Buyer',
      },
    });
    const ticketOrder = await prisma.order.create({
      data: {
        eventId,
        contactId: contact.id,
        orderRef: `${TAG.toUpperCase()}-T1`,
        totalAmount: 20,
        subtotalAmount: 20,
        quantity: 1,
        status: 'COMPLETED',
        paidAt: new Date(),
        items: { create: { priceTierId: priceTier.id, quantity: 1, unitPrice: 20 } },
        payment: {
          create: { stripePaymentIntentId: `pi_${TAG}_ticket`, amount: 20, status: 'SUCCEEDED' },
        },
      },
    });
    const bad = await request(app)
      .post(`/admin/orders/${ticketOrder.id}/refund`)
      .set(...auth(adminToken))
      .send({ amount: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/per ticket/);
    const ticketDetail = await request(app)
      .get(`/admin/orders/${ticketOrder.id}`)
      .set(...auth(adminToken));
    expect(ticketDetail.body).toMatchObject({ kind: 'TICKET', application: null, orgReceives: 0 });
    expect(ticketDetail.body.items[0]).toMatchObject({ kind: 'TICKET_TIER', priceTierName: 'GA' });
  });

  // ─── Reporting over the one ledger ───────────────────────────────────────

  it('customers, dashboard and analytics read application money from orders', async () => {
    const customers = await request(app)
      .get(`/admin/customers?search=${encodeURIComponent(`@${TAG}.test`)}`)
      .set(...auth(adminToken));
    expect(customers.status).toBe(200);
    const byEmail = Object.fromEntries(customers.body.data.map((c) => [c.email, c]));
    // Paid then fully refunded: still a customer (money moved); gross stays, refunded reported
    const lifecycle = byEmail[`lifecycle@${TAG}.test`];
    expect(lifecycle).toMatchObject({
      transactionCount: 1,
      ticketOrderCount: 0,
      applicationCount: 1,
    });
    expect(lifecycle.totalRefunded).toBe(lifecycle.totalSpent);
    // Cancelled before a charge: not a customer
    expect(byEmail[`rejected@${TAG}.test`]).toBeUndefined();
    // Offline cheque counts
    expect(byEmail[`cheque@${TAG}.test`]).toMatchObject({ applicationCount: 1, totalRefunded: 10 });

    const detail = await request(app)
      .get(`/admin/customers/${lifecycle.id}`)
      .set(...auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.orders[0]).toMatchObject({ kind: 'APPLICATION', status: 'REFUNDED' });
    expect(detail.body.applications[0]).toMatchObject({
      paymentStatus: 'REFUNDED',
      paymentSource: 'stripe',
      orderRef: detail.body.orders[0].orderRef,
    });

    const stats = await request(app)
      .get('/admin/dashboard/stats')
      .set(...auth(adminToken));
    expect(stats.status).toBe(200);
    expect(stats.body.revenue.applications).toBeGreaterThan(0);
    expect(stats.body.revenue.gross).toBeCloseTo(
      stats.body.revenue.orders + stats.body.revenue.applications,
      2
    );

    const analytics = await request(app)
      .get(`/organizations/${org.id}/events/${eventId}/analytics`)
      .set(...auth(adminToken));
    expect(analytics.status).toBe(200);
    const paidOrders = await prisma.order.findMany({
      where: {
        eventId,
        kind: 'APPLICATION',
        status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
      },
      select: { totalAmount: true },
    });
    const gross = paidOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    expect(analytics.body.revenue.applications).toBeCloseTo(gross, 2);
    expect(analytics.body.revenue.applicationCount).toBe(paidOrders.length);
    expect(analytics.body.revenue.net).toBeCloseTo(
      analytics.body.revenue.tickets +
        analytics.body.revenue.addOns +
        gross -
        analytics.body.revenue.applicationRefunds,
      2
    );
  });
});
