// Contract tests for Stripe Connect routing and the Connect webhook (spec 010 phase 2)
// - POST /orders becomes a destination charge only for an organization with an
//   active connected account in the current mode, and the ledger records it
// - the flag off / no account / transfers inactive all keep the platform account
// - POST /webhooks/stripe/connect syncs, disconnects and records payouts
// - GET /admin/settings/payments carries the `connect` block
// Stripe is mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const mockSessionsCreate = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsCreate = jest.fn();
const mockAccountsUpdate = jest.fn();
const mockCreateLoginLink = jest.fn();
const mockAccountLinksCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let n = 0;
  mockSessionsCreate.mockImplementation((params) => {
    n += 1;
    return Promise.resolve({ id: `cs_connect_${n}`, url: `https://checkout.stripe.com/pay/cs_connect_${n}`, payment_intent: `pi_connect_${n}`, metadata: params.metadata });
  });
  return {
    default: {
      checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn() } },
      accounts: { retrieve: mockAccountsRetrieve, create: mockAccountsCreate, update: mockAccountsUpdate, createLoginLink: mockCreateLoginLink },
      accountLinks: { create: mockAccountLinksCreate },
      webhooks: { constructEvent: mockConstructEvent },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');

const TAG = 'connect-ct';
const ACCT = 'acct_connect_ct_1';

// No live Stripe: pin the platform account status (same as payments.test.js).
paymentSettingsService._statusCache = {
  value: {
    provider: 'STRIPE',
    mode: 'test',
    charges: 'active',
    statementDescriptorPrefix: 'JUMP',
    capabilities: { link: 'active', cashapp: 'active', affirm: null, klarna: null, afterpay_clearpay: null },
    manageUrl: 'https://dashboard.stripe.com/test/',
    radarUrl: 'https://dashboard.stripe.com/test/radar/rules',
    error: null,
  },
  expiresAt: Number.POSITIVE_INFINITY,
};

const stripeAccount = (over = {}) => ({
  id: ACCT,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  default_currency: 'usd',
  capabilities: { card_payments: 'active', transfers: 'active' },
  requirements: { disabled_reason: null, currently_due: [] },
  external_accounts: { data: [{ bank_name: 'Wells Fargo', last4: '3544', currency: 'usd', default_for_currency: true }] },
  settings: { payouts: { schedule: { interval: 'daily', delay_days: 2 }, statement_descriptor: 'CONNECT CT' } },
  ...over,
});

async function placeOrder(eventId, tierId, email) {
  return request(app)
    .post('/orders')
    .send({ eventId, priceTierId: tierId, quantity: 2, contact: { email, firstName: 'Con', lastName: 'Nect' } });
}

describe('Stripe Connect contract (spec 010 phase 2)', () => {
  let adminToken;
  let org;
  let eventId;
  let tierId;
  const emails = [`admin@${TAG}.test`];

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Venue`, address: '1 Test St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Event`,
        date: new Date('2027-10-01T19:00:00Z'),
        status: 'PUBLISHED',
        capacity: 50,
        taxRate: 0.0725,
        priceTiers: { create: [{ name: 'GA', price: 25, quantityTotal: 50, displayOrder: 0 }] },
      },
      include: { priceTiers: true },
    });
    eventId = event.id;
    tierId = event.priceTiers[0].id;
  });

  afterAll(async () => {
    delete process.env.STRIPE_CONNECT_ENABLED;
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {}); // cascades the Connect row
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    mockSessionsCreate.mockClear();
    process.env.STRIPE_CONNECT_ENABLED = 'true';
  });

  it('GET /admin/settings/payments reports connect disabled when the flag is off', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    const res = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.connect).toEqual({ enabled: false, status: 'not_started', account: null });
  });

  it('flag on, no account: not_started and the order charges on the platform account', async () => {
    const res = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.connect).toEqual({ enabled: true, status: 'not_started', account: null });

    const order = await placeOrder(eventId, tierId, `platform@${TAG}.test`);
    expect(order.status).toBe(201);
    const params = mockSessionsCreate.mock.calls[0][0];
    expect(params.payment_intent_data).toEqual({ statement_descriptor_suffix: 'CONNECT CT ORG' });
    expect(params.metadata.stripeAccountId).toBeUndefined();
    const tx = await prisma.paymentTransaction.findUnique({ where: { orderId: order.body.orderId } });
    expect(tx.stripeAccountId).toBeNull();
    expect(tx.applicationFee).toBeNull();
  });

  describe('admin routes', () => {
    let organizerToken;
    let adminBToken;
    let orgB;

    beforeAll(async () => {
      emails.push(`organizer@${TAG}.test`, `admin-b@${TAG}.test`);
      organizerToken = await staffToken({ email: `organizer@${TAG}.test`, role: 'ORGANIZER' });
      await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
      orgB = await prisma.organization.create({ data: { name: `${TAG} Org B` } });
      adminBToken = await staffToken({ email: `admin-b@${TAG}.test`, role: 'ADMIN' });
      await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    });

    afterAll(async () => {
      await prisma.organizationStripeAccount.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: orgB.id } }).catch(() => {});
    });

    it('404 for every Connect route while the flag is off', async () => {
      process.env.STRIPE_CONNECT_ENABLED = 'false';
      const auth = ['Authorization', `Bearer ${adminToken}`];
      for (const call of [
        request(app).post('/admin/settings/payments/connect/onboard').set(...auth),
        request(app).post('/admin/settings/payments/connect/login-link').set(...auth),
        request(app).post('/admin/settings/payments/connect/sync').set(...auth),
        request(app).patch('/admin/settings/payments/connect/payouts').set(...auth).send({ interval: 'daily' }),
      ]) {
        expect((await call).status).toBe(404);
      }
    });

    it('ORGANIZER is refused (403) on every Connect route', async () => {
      const auth = ['Authorization', `Bearer ${organizerToken}`];
      expect((await request(app).post('/admin/settings/payments/connect/onboard').set(...auth)).status).toBe(403);
      expect((await request(app).post('/admin/settings/payments/connect/login-link').set(...auth)).status).toBe(403);
      expect((await request(app).post('/admin/settings/payments/connect/sync').set(...auth)).status).toBe(403);
      expect((await request(app).patch('/admin/settings/payments/connect/payouts').set(...auth).send({ interval: 'daily' })).status).toBe(403);
    });

    it('onboard creates the account once and returns a fresh Account Link each time', async () => {
      mockAccountsCreate.mockResolvedValueOnce(stripeAccount({ id: 'acct_onboard_ct', details_submitted: false, capabilities: { transfers: 'pending' } }));
      mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/acct_onboard_ct/link' });
      const auth = ['Authorization', `Bearer ${adminToken}`];

      const first = await request(app).post('/admin/settings/payments/connect/onboard').set(...auth);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ url: 'https://connect.stripe.com/setup/e/acct_onboard_ct/link' });
      expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
      expect(mockAccountsCreate.mock.calls[0][0]).toMatchObject({
        controller: { stripe_dashboard: { type: 'express' } },
        metadata: { organizationId: org.id, mode: 'test' },
      });

      const second = await request(app).post('/admin/settings/payments/connect/onboard').set(...auth);
      expect(second.status).toBe(200);
      expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
      expect(mockAccountLinksCreate).toHaveBeenCalledTimes(2);

      const status = await request(app).get('/admin/settings/payments').set(...auth);
      expect(status.body.connect).toMatchObject({ enabled: true, status: 'onboarding', account: { stripeAccountId: 'acct_onboard_ct' } });

      // Before onboarding completes: no login link, no payout settings
      expect((await request(app).post('/admin/settings/payments/connect/login-link').set(...auth)).status).toBe(409);
      expect((await request(app).patch('/admin/settings/payments/connect/payouts').set(...auth).send({ interval: 'daily' })).status).toBe(409);
    });

    it('sync pulls the account from Stripe; login link and payout settings work once details are submitted', async () => {
      const auth = ['Authorization', `Bearer ${adminToken}`];
      mockAccountsRetrieve.mockResolvedValueOnce(stripeAccount({ id: 'acct_onboard_ct' }));
      const synced = await request(app).post('/admin/settings/payments/connect/sync').set(...auth);
      expect(synced.status).toBe(200);
      expect(synced.body.connect.status).toBe('active');
      expect(synced.body.connect.account.bank).toEqual({ name: 'Wells Fargo', last4: '3544', currency: 'usd' });

      mockCreateLoginLink.mockResolvedValueOnce({ url: 'https://connect.stripe.com/express/acct_onboard_ct/login' });
      const login = await request(app).post('/admin/settings/payments/connect/login-link').set(...auth);
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ url: 'https://connect.stripe.com/express/acct_onboard_ct/login' });
      expect(mockCreateLoginLink).toHaveBeenCalledWith('acct_onboard_ct');

      mockAccountsUpdate.mockImplementationOnce((id, params) =>
        Promise.resolve(stripeAccount({ id, settings: { payouts: { ...params.settings.payouts } } }))
      );
      const payouts = await request(app)
        .patch('/admin/settings/payments/connect/payouts')
        .set(...auth)
        .send({ interval: 'weekly', anchor: 'friday', statementDescriptor: 'connect ct' });
      expect(payouts.status).toBe(200);
      expect(mockAccountsUpdate).toHaveBeenCalledWith('acct_onboard_ct', {
        settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'friday' }, statement_descriptor: 'CONNECT CT' } },
      });
      expect(payouts.body.connect.account.payouts).toMatchObject({ interval: 'weekly', anchor: 'friday', statementDescriptor: 'CONNECT CT' });
    });

    it('PATCH payouts validates the shape and the values', async () => {
      const auth = ['Authorization', `Bearer ${adminToken}`];
      const cases = [
        [{}, /Provide interval or statementDescriptor/],
        [{ bogus: 1 }, /Unknown field/],
        [{ interval: 7 }, /interval must be a string/],
        [{ interval: 'weekly', anchor: {} }, /anchor must be a string or number/],
        [{ statementDescriptor: null }, /statementDescriptor must be a string/],
        [{ interval: 'hourly' }, /daily, weekly or monthly/],
        [{ interval: 'monthly', anchor: 40 }, /day of month/],
        [{ statementDescriptor: 'A*B' }, /letters, numbers and spaces/],
      ];
      for (const [body, message] of cases) {
        const res = await request(app).patch('/admin/settings/payments/connect/payouts').set(...auth).send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(message);
      }
      expect(mockAccountsUpdate).toHaveBeenCalledTimes(1); // only the earlier valid call
    });

    it('members are scoped to their own organization even with a foreign X-Jump-Org', async () => {
      const res = await request(app)
        .post('/admin/settings/payments/connect/sync')
        .set('Authorization', `Bearer ${adminBToken}`)
        .set('X-Jump-Org', org.id);
      // Org B has no account → 404, never org A's account
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/No Stripe Connect account/);
      const status = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${adminBToken}`).set('X-Jump-Org', org.id);
      expect(status.body.connect.status).toBe('not_started');
    });
  });

  it('Connect webhook account.updated creates nothing for an unknown account', async () => {
    const res = await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'account.updated', account: 'acct_stranger', data: { object: stripeAccount({ id: 'acct_stranger' }) } }));
    expect(res.status).toBe(200);
    expect(await prisma.organizationStripeAccount.count({ where: { stripeAccountId: 'acct_stranger' } })).toBe(0);
  });

  it('an onboarding row becomes active via account.updated and routes the next order', async () => {
    await prisma.organizationStripeAccount.create({
      data: { organizationId: org.id, mode: 'test', stripeAccountId: ACCT, detailsSubmitted: false },
    });

    // Transfers not yet active → still the platform account
    const before = await placeOrder(eventId, tierId, `onboarding@${TAG}.test`);
    expect(before.status).toBe(201);
    expect(mockSessionsCreate.mock.calls[0][0].payment_intent_data.transfer_data).toBeUndefined();

    const hook = await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'account.updated', account: ACCT, data: { object: stripeAccount() } }));
    expect(hook.status).toBe(200);
    expect(hook.body).toEqual({ received: true });

    const status = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.connect.status).toBe('active');
    expect(status.body.connect.account).toMatchObject({
      stripeAccountId: ACCT,
      transfersEnabled: true,
      bank: { name: 'Wells Fargo', last4: '3544', currency: 'usd' },
      payouts: { interval: 'daily', statementDescriptor: 'CONNECT CT' },
    });

    mockSessionsCreate.mockClear();
    const routed = await placeOrder(eventId, tierId, `routed@${TAG}.test`);
    expect(routed.status).toBe(201);
    const params = mockSessionsCreate.mock.calls[0][0];
    const totalCents = params.line_items.reduce((s, i) => s + i.price_data.unit_amount * i.quantity, 0);
    const order = await prisma.order.findUnique({ where: { id: routed.body.orderId } });
    const subtotalCents = Math.round(Number(order.subtotalAmount) * 100);
    expect(params.payment_intent_data).toEqual({
      statement_descriptor_suffix: 'CONNECT CT ORG',
      transfer_data: { destination: ACCT },
      application_fee_amount: totalCents - subtotalCents,
    });
    expect(params.metadata.stripeAccountId).toBe(ACCT);

    const tx = await prisma.paymentTransaction.findUnique({ where: { orderId: routed.body.orderId } });
    expect(tx.stripeAccountId).toBe(ACCT);
    expect(Number(tx.applicationFee)).toBeCloseTo((totalCents - subtotalCents) / 100, 2);
    // What the platform keeps is fees + tax, within per-unit rounding
    const expectedKeep = Number(order.platformFeeAmount) + Number(order.processingFeeAmount) + Number(order.taxAmount);
    expect(Math.abs(Number(tx.applicationFee) - expectedKeep)).toBeLessThanOrEqual(0.02);
  });

  it('capability.updated re-reads the account; payout.failed is recorded', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(stripeAccount({ capabilities: { transfers: 'inactive' } }));
    await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'capability.updated', account: ACCT, data: { object: { id: 'transfers', status: 'inactive' } } }));
    expect(mockAccountsRetrieve).toHaveBeenCalledWith(ACCT, { expand: ['external_accounts'] });
    let row = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: ACCT } });
    expect(row.transfersEnabled).toBe(false);

    await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payout.failed', account: ACCT, data: { object: { status: 'failed', failure_code: 'account_closed', failure_message: 'Bank account closed' } } }));
    row = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: ACCT } });
    expect(row.lastPayoutFailure).toBe('Bank account closed');

    // Restricted account → platform account again
    const order = await placeOrder(eventId, tierId, `restricted@${TAG}.test`);
    expect(order.status).toBe(201);
    expect(mockSessionsCreate.mock.calls[0][0].payment_intent_data.transfer_data).toBeUndefined();
  });

  it('account.application.deauthorized disconnects and stops routing', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(stripeAccount());
    await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'capability.updated', account: ACCT, data: { object: {} } }));
    let row = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: ACCT } });
    expect(row.transfersEnabled).toBe(true);

    await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'account.application.deauthorized', account: ACCT, data: { object: { id: 'ca_x' } } }));
    row = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: ACCT } });
    expect(row.disconnectedAt).toBeInstanceOf(Date);
    expect(row.transfersEnabled).toBe(false);

    const status = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.connect.status).toBe('disconnected');

    const order = await placeOrder(eventId, tierId, `deauth@${TAG}.test`);
    expect(mockSessionsCreate.mock.calls[0][0].payment_intent_data.transfer_data).toBeUndefined();
    expect(order.status).toBe(201);
  });

  it('rejects a bad signature when a Connect secret is configured', async () => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const res = await request(app)
      .post('/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=bad')
      .send(JSON.stringify({ type: 'account.updated', account: ACCT, data: { object: {} } }));
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Webhook Error/);
    expect(mockConstructEvent).toHaveBeenCalledWith(expect.anything(), 't=1,v1=bad', 'whsec_connect_test');
  });
});
