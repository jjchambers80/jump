// Contract tests for direct charges on the organization's own Stripe account
// (spec 047 D0-S, option C):
// - S3: money events for a direct charge arrive on POST /webhooks/stripe/connect
//   with `event.account`; they settle the order only when the account is the
//   one its payment was created on. The platform endpoint keeps settling
//   legacy orders (stripeAccountId null) and refuses direct-charge ones.
// - S4: refunds, disputes and session reads run on the order's account.
// Stripe and Resend are mocked; Postgres is real. Webhook event ids are
// namespaced per run (a fixed id makes the second run a replay).

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const mockSessionsCreate = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();
const mockChargesRetrieve = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let n = 0;
  mockSessionsCreate.mockImplementation((params) => {
    n += 1;
    const id = `cs_direct_${Date.now()}_${n}`;
    return Promise.resolve({ id, url: `https://checkout.stripe.com/pay/${id}`, payment_intent: null, metadata: params.metadata });
  });
  return {
    default: {
      checkout: { sessions: { create: mockSessionsCreate, retrieve: mockSessionsRetrieve } },
      refunds: { create: mockRefundsCreate },
      charges: { retrieve: mockChargesRetrieve },
      accounts: { retrieve: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');
const { default: orderService } = await import('../../src/services/OrderService.js');

const TAG = 'direct-ct';
const ACCT = 'acct_direct_ct_1';
const OTHER = 'acct_direct_ct_other';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let evtN = 0;
const evtId = () => `evt_${TAG}_${RUN}_${(evtN += 1)}`;

paymentSettingsService._statusCache = {
  value: {
    provider: 'STRIPE',
    mode: 'test',
    charges: 'active',
    statementDescriptorPrefix: 'JUMP',
    capabilities: {},
    manageUrl: 'https://dashboard.stripe.com/test/',
    radarUrl: 'https://dashboard.stripe.com/test/radar/rules',
    error: null,
  },
  expiresAt: Number.POSITIVE_INFINITY,
};

const post = (path, event) => request(app).post(path).set('Content-Type', 'application/json').send(JSON.stringify(event));
const connectHook = (event) => post('/webhooks/stripe/connect', event);
const platformHook = (event) => post('/webhooks/stripe', event);

const completed = (sessionId, paymentIntent, account) => ({
  id: evtId(),
  type: 'checkout.session.completed',
  ...(account && { account }),
  data: { object: { id: sessionId, object: 'checkout.session', payment_status: 'paid', payment_intent: paymentIntent } },
});

describe('Direct charges on the organization account (spec 047 D0-S)', () => {
  let adminToken;
  let org;
  let otherOrg;
  let eventId;
  let tierId;
  const emails = [`admin@${TAG}.test`];

  async function placeOrder(email, quantity = 1) {
    const res = await request(app)
      .post('/orders')
      .send({ eventId, priceTierId: tierId, quantity, contact: { email, firstName: 'Dee', lastName: 'Rect' } });
    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({ where: { id: res.body.orderId }, include: { payment: true } });
    return order;
  }

  beforeAll(async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Venue`, address: '1 Test St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Event`,
        date: new Date('2027-10-01T19:00:00Z'),
        status: 'PUBLISHED',
        capacity: 100,
        taxRate: 0.0725,
        priceTiers: { create: [{ name: 'GA', price: 40, quantityTotal: 100, displayOrder: 0 }] },
      },
      include: { priceTiers: true },
    });
    eventId = event.id;
    tierId = event.priceTiers[0].id;
    await prisma.organizationStripeAccount.create({
      data: { organizationId: org.id, mode: 'test', stripeAccountId: ACCT, chargesEnabled: true, detailsSubmitted: true, activeCapabilities: ['card_payments'] },
    });
    // The other account belongs to another organization (it could be any Stripe account).
    await prisma.organizationStripeAccount.create({
      data: { organizationId: otherOrg.id, mode: 'test', stripeAccountId: OTHER, chargesEnabled: true, detailsSubmitted: true },
    });
  });

  afterAll(async () => {
    delete process.env.STRIPE_CONNECT_ENABLED;
    const orders = await prisma.order.findMany({ where: { eventId }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.dispute.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: { startsWith: `evt_${TAG}_${RUN}` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    mockSessionsCreate.mockClear();
    mockSessionsRetrieve.mockReset();
    mockRefundsCreate.mockReset();
    mockChargesRetrieve.mockReset();
  });

  // ─── S3: webhooks ───────────────────────────────────────────────────────

  it('the order is created on the account and completes from the Connect endpoint', async () => {
    const order = await placeOrder(`connect-ok@${TAG}.test`, 2);
    expect(mockSessionsCreate.mock.calls[0][1]).toEqual({ stripeAccount: ACCT });
    expect(order.payment.stripeAccountId).toBe(ACCT);

    const res = await connectHook(completed(order.stripeSessionId, `pi_${TAG}_${RUN}_ok`, ACCT));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const after = await prisma.order.findUnique({ where: { id: order.id }, include: { tickets: true, payment: true } });
    expect(after.status).toBe('COMPLETED');
    expect(after.tickets).toHaveLength(2);
    expect(after.payment).toMatchObject({ status: 'SUCCEEDED', stripePaymentIntentId: `pi_${TAG}_${RUN}_ok`, stripeAccountId: ACCT });
  });

  it('a completion from a different account is refused', async () => {
    const order = await placeOrder(`connect-other@${TAG}.test`);
    const res = await connectHook(completed(order.stripeSessionId, `pi_${TAG}_${RUN}_other`, OTHER));
    expect(res.status).toBe(200);
    const after = await prisma.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
    expect(after.status).toBe('PENDING');
    expect(after.tickets).toHaveLength(0);
  });

  it('the platform endpoint refuses a direct-charge order but still completes a legacy one', async () => {
    const direct = await placeOrder(`platform-direct@${TAG}.test`);
    await platformHook(completed(direct.stripeSessionId, `pi_${TAG}_${RUN}_pd`, null));
    expect((await prisma.order.findUnique({ where: { id: direct.id } })).status).toBe('PENDING');

    process.env.STRIPE_CONNECT_ENABLED = 'false';
    const legacy = await placeOrder(`platform-legacy@${TAG}.test`);
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    expect(mockSessionsCreate.mock.calls.at(-1)[1]).toBeUndefined();
    expect(legacy.payment.stripeAccountId).toBeNull();

    // …and a Connect event can never settle a legacy (platform) order
    await connectHook(completed(legacy.stripeSessionId, `pi_${TAG}_${RUN}_lc`, ACCT));
    expect((await prisma.order.findUnique({ where: { id: legacy.id } })).status).toBe('PENDING');

    await platformHook(completed(legacy.stripeSessionId, `pi_${TAG}_${RUN}_pl`, null));
    expect((await prisma.order.findUnique({ where: { id: legacy.id } })).status).toBe('COMPLETED');
  });

  it('checkout.session.expired from the Connect endpoint releases the hold on the right account only', async () => {
    const order = await placeOrder(`expired@${TAG}.test`);
    const expired = (account) => ({ id: evtId(), type: 'checkout.session.expired', account, data: { object: { id: order.stripeSessionId, payment_status: 'unpaid' } } });
    await connectHook(expired(OTHER));
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PENDING');
    await connectHook(expired(ACCT));
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('FAILED');
  });

  it('verify reads the session on the order account', async () => {
    const order = await placeOrder(`verify@${TAG}.test`);
    mockSessionsRetrieve.mockResolvedValueOnce({ id: order.stripeSessionId, payment_status: 'paid', payment_intent: `pi_${TAG}_${RUN}_verify` });
    await orderService.verifyAndCompleteOrder(order.id);
    expect(mockSessionsRetrieve).toHaveBeenCalledWith(order.stripeSessionId, { stripeAccount: ACCT });
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('COMPLETED');
  });

  it('charge.refunded and charge.dispute.* are applied only from the order account', async () => {
    const order = await placeOrder(`refund-hook@${TAG}.test`);
    const pi = `pi_${TAG}_${RUN}_rh`;
    await connectHook(completed(order.stripeSessionId, pi, ACCT));
    const total = Math.round(Number(order.totalAmount) * 100);

    const refunded = (account, refundId) => ({
      id: evtId(),
      type: 'charge.refunded',
      account,
      data: { object: { id: `ch_${TAG}_${RUN}`, payment_intent: pi, refunds: { data: [{ id: refundId, amount: 500, reason: null }] } } },
    });
    await connectHook(refunded(OTHER, `re_${TAG}_${RUN}_x`));
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(0);
    await connectHook(refunded(ACCT, `re_${TAG}_${RUN}_ok`));
    expect(await prisma.refund.findFirst({ where: { orderId: order.id } })).toMatchObject({ stripeRefundId: `re_${TAG}_${RUN}_ok`, status: 'SUCCEEDED' });

    const disputed = (account, disputeId) => ({
      id: evtId(),
      type: 'charge.dispute.created',
      account,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: disputeId, charge: `ch_${TAG}_${RUN}`, payment_intent: pi, amount: total, currency: 'usd', status: 'needs_response', reason: 'fraudulent', created: Math.floor(Date.now() / 1000), balance_transactions: [] } },
    });
    await connectHook(disputed(OTHER, `dp_${TAG}_${RUN}_x`));
    expect(await prisma.dispute.count({ where: { orderId: order.id } })).toBe(0);
    await connectHook(disputed(ACCT, `dp_${TAG}_${RUN}_ok`));
    expect(await prisma.dispute.findFirst({ where: { orderId: order.id } })).toMatchObject({ stripeDisputeId: `dp_${TAG}_${RUN}_ok`, state: 'OPEN' });
  });

  it('a dispute that carries only the charge is looked up on the event account', async () => {
    const order = await placeOrder(`dispute-charge@${TAG}.test`);
    const pi = `pi_${TAG}_${RUN}_dc`;
    await connectHook(completed(order.stripeSessionId, pi, ACCT));
    mockChargesRetrieve.mockResolvedValueOnce({ id: `ch_${TAG}_${RUN}_dc`, payment_intent: pi });
    await connectHook({
      id: evtId(),
      type: 'charge.dispute.created',
      account: ACCT,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `dp_${TAG}_${RUN}_dc`, charge: `ch_${TAG}_${RUN}_dc`, amount: 100, currency: 'usd', status: 'warning_needs_response', reason: 'general', balance_transactions: [] } },
    });
    expect(mockChargesRetrieve).toHaveBeenCalledWith(`ch_${TAG}_${RUN}_dc`, { stripeAccount: ACCT });
    expect(await prisma.dispute.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('account events still work alongside money events on the Connect endpoint', async () => {
    const res = await connectHook({ id: evtId(), type: 'payout.paid', account: ACCT, data: { object: { status: 'paid', arrival_date: 1_790_000_000 } } });
    expect(res.status).toBe(200);
    expect((await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: ACCT } })).lastPayoutAt).toBeInstanceOf(Date);
    const unknown = await connectHook({ id: evtId(), type: 'customer.created', account: ACCT, data: { object: {} } });
    expect(unknown.body).toEqual({ received: true });
  });

  void adminToken;
});
