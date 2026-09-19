// Contract tests for Jump subscription billing (spec 022 phase 2)
// - the subscribe step is 409 until BILLING_ENABLED + JUMP_STARTER_PRICE_ID
// - POST /signup/:orgId/subscribe creates a Stripe customer + embedded Checkout
// - confirm records the subscription; resume moves past the subscribe step
// - Settings › Plan status / checkout / portal
// - POST /webhooks/stripe/billing mirrors subscription events; order events are ignored there
//   and billing events are ignored on the platform endpoint
// Stripe is mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';

const mockPricesRetrieve = jest.fn();
const mockCustomersCreate = jest.fn();
const mockSessionsCreate = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockSubscriptionsRetrieve = jest.fn();
const mockPortalCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    prices: { retrieve: mockPricesRetrieve },
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockSessionsCreate, retrieve: mockSessionsRetrieve } },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    billingPortal: { sessions: { create: mockPortalCreate } },
    webhooks: { constructEvent: mockConstructEvent },
    accounts: { retrieve: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { staffToken, joinOrgByToken, cleanupStaff } = await import('../helpers/staff.js');

const OWNER_EMAIL = 'owner@billing-test.com';
const ORGANIZER_EMAIL = 'organizer@billing-test.com';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PRICE = 'price_starter_test';

const subscription = (over = {}) => ({
  id: 'sub_test_1',
  status: 'trialing',
  trial_end: 1_900_000_000,
  current_period_end: 1_900_000_000,
  metadata: {},
  items: { data: [{ price: { id: PRICE }, current_period_end: 1_900_000_000 }] },
  ...over,
});

describe('Jump subscription billing (spec 022 phase 2)', () => {
  let ownerToken;
  let organizerToken;
  let pendingId;
  let completedId;
  const prevEnv = {};

  beforeAll(async () => {
    for (const key of ['BILLING_ENABLED', 'JUMP_STARTER_PRICE_ID', 'BILLING_TRIAL_DAYS']) prevEnv[key] = process.env[key];
    ownerToken = await staffToken({ role: 'ADMIN', email: OWNER_EMAIL });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: ORGANIZER_EMAIL });

    mockPricesRetrieve.mockResolvedValue({ id: PRICE, unit_amount: 3900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: 'prod_x' });
    mockCustomersCreate.mockImplementation((params) => Promise.resolve({ id: `cus_${params.metadata.organizationId.slice(-6)}`, ...params }));
    mockSessionsCreate.mockImplementation((params) => Promise.resolve({ id: 'cs_billing_1', client_secret: 'cs_billing_1_secret_abc', ...params }));
    mockPortalCreate.mockImplementation((params) => Promise.resolve({ url: `https://billing.stripe.com/session/${params.customer}` }));
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.organization.deleteMany({ where: { name: { startsWith: 'Billing Test' } } }).catch(() => {});
    await cleanupStaff([OWNER_EMAIL, ORGANIZER_EMAIL]);
  });

  const enable = () => {
    process.env.BILLING_ENABLED = 'true';
    process.env.JUMP_STARTER_PRICE_ID = PRICE;
    process.env.BILLING_TRIAL_DAYS = '30';
  };
  const disable = () => {
    process.env.BILLING_ENABLED = 'false';
  };

  it('while billing is off, signup skips the subscribe step and the routes 409', async () => {
    disable();
    const res = await request(app).post('/signup').set(auth(ownerToken)).send({ name: 'Billing Test Off' });
    expect(res.status).toBe(201);
    expect(res.body.step).toBe('survey');
    const sub = await request(app).post(`/signup/${res.body.id}/subscribe`).set(auth(ownerToken));
    expect(sub.status).toBe(409);
    const plan = await request(app).get('/admin/settings/plan').set(auth(ownerToken)).set('X-Jump-Org', res.body.id);
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ enabled: false, plan: 'FREE', hasSubscription: false, offer: null });
    await request(app).delete(`/signup/${res.body.id}`).set(auth(ownerToken));
  });

  it('with billing on, a new signup resumes at the subscribe step', async () => {
    enable();
    const res = await request(app).post('/signup').set(auth(ownerToken)).send({ name: 'Billing Test On', source: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.step).toBe('subscribe');
    pendingId = res.body.id;
    const current = await request(app).get('/signup/current').set(auth(ownerToken));
    expect(current.body.billingEnabled).toBe(true);
    expect(current.body.organization.step).toBe('subscribe');
  });

  it('creates a Stripe customer once and an embedded subscription Checkout with the trial', async () => {
    enable();
    const res = await request(app).post(`/signup/${pendingId}/subscribe`).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('cs_billing_1_secret_abc');
    expect(res.body.offer).toMatchObject({ trialDays: 30, unitAmount: 3900, currency: 'usd', interval: 'month' });

    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockCustomersCreate.mock.calls[0][0]).toMatchObject({ name: 'Billing Test On', metadata: { organizationId: pendingId } });
    const params = mockSessionsCreate.mock.calls.at(-1)[0];
    expect(params).toMatchObject({
      mode: 'subscription',
      ui_mode: 'embedded',
      line_items: [{ price: PRICE, quantity: 1 }],
      subscription_data: { trial_period_days: 30, metadata: { organizationId: pendingId } },
      metadata: { organizationId: pendingId, billing: 'subscription' },
    });
    expect(params.return_url).toMatch(new RegExp(`/signup/${pendingId}/subscribe/return\\?session_id=\\{CHECKOUT_SESSION_ID\\}$`));

    // Second call reuses the customer
    await request(app).post(`/signup/${pendingId}/subscribe`).set(auth(ownerToken));
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    const row = await prisma.platformCustomer.findUnique({ where: { organizationId: pendingId } });
    expect(row.stripeCustomerId).toMatch(/^cus_/);
  });

  it('confirm records the subscription and moves the signup to the survey', async () => {
    enable();
    mockSessionsRetrieve.mockResolvedValueOnce({ id: 'cs_billing_1', status: 'open', metadata: { organizationId: pendingId }, subscription: null });
    const notYet = await request(app).post(`/signup/${pendingId}/subscribe/confirm`).set(auth(ownerToken)).send({ sessionId: 'cs_billing_1' });
    expect(notYet.status).toBe(200);
    expect(notYet.body.subscribed).toBe(false);
    expect(notYet.body.organization.step).toBe('subscribe');

    mockSessionsRetrieve.mockResolvedValueOnce({ id: 'cs_billing_1', status: 'complete', metadata: { organizationId: pendingId }, subscription: subscription() });
    const done = await request(app).post(`/signup/${pendingId}/subscribe/confirm`).set(auth(ownerToken)).send({ sessionId: 'cs_billing_1' });
    expect(done.status).toBe(200);
    expect(done.body.subscribed).toBe(true);
    expect(done.body.organization.step).toBe('survey');

    const row = await prisma.platformCustomer.findUnique({ where: { organizationId: pendingId } });
    expect(row).toMatchObject({ plan: 'STARTER', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_test_1' });
    expect(row.trialEndsAt).toEqual(new Date(1_900_000_000 * 1000));
    expect(row.onboarding.subscribedAt).toBeDefined();

    // A session for another organization is not accepted
    mockSessionsRetrieve.mockResolvedValueOnce({ id: 'cs_other', status: 'complete', metadata: { organizationId: 'someone-else' }, subscription: subscription() });
    const foreign = await request(app).post(`/signup/${pendingId}/subscribe/confirm`).set(auth(ownerToken)).send({ sessionId: 'cs_other' });
    expect(foreign.status).toBe(404);

    // Finish onboarding so the org appears and Settings › Plan can read it
    const complete = await request(app).post(`/signup/${pendingId}/complete`).set(auth(ownerToken));
    expect(complete.status).toBe(200);
    completedId = pendingId;
  });

  it('subscribe refuses an organization that already has a subscription', async () => {
    enable();
    const res = await request(app).post('/admin/settings/plan/checkout').set(auth(ownerToken)).set('X-Jump-Org', completedId);
    expect(res.status).toBe(409);
  });

  it('Settings › Plan reports the plan; ORGANIZER reads, ADMIN manages; portal links the customer', async () => {
    enable();
    await joinOrgByToken(organizerToken, completedId, 'ORGANIZER');
    const asOrganizer = await request(app).get('/admin/settings/plan').set(auth(organizerToken)).set('X-Jump-Org', completedId);
    expect(asOrganizer.status).toBe(200);
    expect(asOrganizer.body).toMatchObject({ enabled: true, plan: 'STARTER', subscriptionStatus: 'trialing', hasSubscription: true, canManage: true, canEdit: false });
    expect(asOrganizer.body.offer).toMatchObject({ unitAmount: 3900 });

    const portalForbidden = await request(app).post('/admin/settings/plan/portal').set(auth(organizerToken)).set('X-Jump-Org', completedId);
    expect(portalForbidden.status).toBe(403);

    const portal = await request(app).post('/admin/settings/plan/portal').set(auth(ownerToken)).set('X-Jump-Org', completedId);
    expect(portal.status).toBe(200);
    expect(portal.body.url).toMatch(/^https:\/\/billing\.stripe\.com\/session\/cus_/);
    expect(mockPortalCreate.mock.calls.at(-1)[0].return_url).toMatch(/\/admin\/settings\/plan$/);
  });

  it('billing webhook mirrors subscription updates and deletions', async () => {
    enable();
    const updated = { type: 'customer.subscription.updated', data: { object: subscription({ status: 'past_due', metadata: { organizationId: completedId } }) } };
    const res = await request(app).post('/webhooks/stripe/billing').set('Content-Type', 'application/json').send(JSON.stringify(updated));
    expect(res.status).toBe(200);
    let row = await prisma.platformCustomer.findUnique({ where: { organizationId: completedId } });
    expect(row.subscriptionStatus).toBe('past_due');
    expect(row.plan).toBe('STARTER');

    // Without metadata the subscription id is enough
    const deleted = { type: 'customer.subscription.deleted', data: { object: subscription({ status: 'canceled', metadata: {} }) } };
    await request(app).post('/webhooks/stripe/billing').set('Content-Type', 'application/json').send(JSON.stringify(deleted));
    row = await prisma.platformCustomer.findUnique({ where: { organizationId: completedId } });
    expect(row.subscriptionStatus).toBe('canceled');
    expect(row.plan).toBe('FREE');

    // Unknown organization: acknowledged, nothing written
    const unknown = { type: 'customer.subscription.updated', data: { object: subscription({ id: 'sub_nobody', metadata: { organizationId: 'nope' } }) } };
    const ack = await request(app).post('/webhooks/stripe/billing').set('Content-Type', 'application/json').send(JSON.stringify(unknown));
    expect(ack.status).toBe(200);
  });

  it('checkout.session.completed on the billing endpoint retrieves the subscription', async () => {
    enable();
    mockSubscriptionsRetrieve.mockResolvedValueOnce(subscription({ status: 'active', metadata: { organizationId: completedId } }));
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_billing_1', mode: 'subscription', subscription: 'sub_test_1', metadata: { organizationId: completedId } } } };
    const res = await request(app).post('/webhooks/stripe/billing').set('Content-Type', 'application/json').send(JSON.stringify(event));
    expect(res.status).toBe(200);
    const row = await prisma.platformCustomer.findUnique({ where: { organizationId: completedId } });
    expect(row).toMatchObject({ subscriptionStatus: 'active', plan: 'STARTER' });
  });

  it('events posted to the wrong endpoint are acknowledged and ignored', async () => {
    enable();
    const orderEvent = { type: 'checkout.session.completed', data: { object: { id: 'cs_order', mode: 'payment', payment_status: 'paid', metadata: {} } } };
    const onBilling = await request(app).post('/webhooks/stripe/billing').set('Content-Type', 'application/json').send(JSON.stringify(orderEvent));
    expect(onBilling.status).toBe(200);
    expect(onBilling.body.ignored).toBe(true);

    const before = await prisma.platformCustomer.findUnique({ where: { organizationId: completedId } });
    const billingEvent = { type: 'customer.subscription.updated', data: { object: subscription({ status: 'trialing', metadata: { organizationId: completedId } }) } };
    const onPlatform = await request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(billingEvent));
    expect(onPlatform.status).toBe(200);
    expect(onPlatform.body.ignored).toBe(true);
    const after = await prisma.platformCustomer.findUnique({ where: { organizationId: completedId } });
    expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
  });
});
