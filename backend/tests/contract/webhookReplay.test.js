// Stripe webhook replay safety (EVE-3).
//
// Stripe delivers at least once, in no guaranteed order, and retries for three
// days. This suite proves the three things that follow from that:
//
//   1. A redelivered event is recognised and never reaches a handler twice.
//   2. Inventory moves exactly once no matter how many times the event lands.
//   3. A missing signing secret in production is refused, not trusted.
//
// Fixtures are written straight to Postgres; Stripe is mocked and never called
// over the network (CI runs this suite with no Stripe key and no egress).
// Signatures use the real `stripe` signing helper, so a middleware-order
// regression that stops the raw body reaching constructEvent fails here.

import { jest } from '@jest/globals';
import request from 'supertest';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_webhook_replay';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'whreplay';
const SECRET = 'whsec_replay_platform';
const CONNECT_SECRET = 'whsec_replay_connect';
const BILLING_SECRET = 'whsec_replay_billing';

// Unique per run so a re-run against the same database is not itself a replay.
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const evtId = (name) => `evt_${TAG}_${RUN}_${name}`;

const sign = (payload, secret) => Stripe.webhooks.generateTestHeaderString({ payload, secret });

function post(path, event, secret) {
  const payload = JSON.stringify(event);
  const req = request(app).post(path).set('Content-Type', 'application/json');
  if (secret) req.set('stripe-signature', sign(payload, secret));
  return req.send(payload);
}

/** `created` is Stripe's own ordering clock, in seconds. */
function expiredEvent(id, sessionId, created) {
  return {
    id,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created,
    type: 'checkout.session.expired',
    data: { object: { id: sessionId, object: 'checkout.session', payment_status: 'unpaid' } },
  };
}

const ledgerRow = (stripeEventId, endpoint = 'PLATFORM') =>
  prisma.stripeWebhookEvent.findUnique({ where: { endpoint_stripeEventId: { endpoint, stripeEventId } } });

const reservedOn = async (tierId) =>
  (await prisma.priceTier.findUnique({ where: { id: tierId } })).quantityReserved;

describe('Stripe webhook replay safety (EVE-3)', () => {
  const previous = {
    platform: process.env.STRIPE_WEBHOOK_SECRET,
    connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    billing: process.env.STRIPE_BILLING_WEBHOOK_SECRET,
    nodeEnv: process.env.NODE_ENV,
  };

  let org;
  let tier;
  let order;
  const sessionId = `cs_test_${TAG}_${RUN}`;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = BILLING_SECRET;

    org = await prisma.organization.create({
      data: { name: `${TAG} ${RUN} Co`, email: `owner@${TAG}${RUN}.test` },
    });
    const venue = await prisma.venue.create({
      data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' },
    });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.UTC(2026, 11, 1, 18)), status: 'PUBLISHED', capacity: 100 },
    });
    // Two seats held by an open checkout, exactly as OrderService.createOrder leaves it.
    tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 100, quantityReserved: 2 },
    });
    const contact = await prisma.contact.create({
      data: { organizationId: org.id, email: `bea@${TAG}${RUN}.test`, firstName: 'Bea', lastName: 'Buyer' },
    });
    order = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG.toUpperCase()}-${RUN}`.slice(0, 40),
        totalAmount: 40,
        subtotalAmount: 40,
        orgReceives: 40,
        quantity: 2,
        status: 'PENDING',
        stripeSessionId: sessionId,
        items: { create: { kind: 'TICKET_TIER', priceTierId: tier.id, description: 'GA', quantity: 2, unitPrice: 20 } },
        payment: { create: { amount: 40, status: 'PENDING' } },
      },
    });
  });

  afterAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = previous.platform ?? '';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous.connect ?? '';
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = previous.billing ?? '';
    process.env.NODE_ENV = previous.nodeEnv;

    await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: { startsWith: `evt_${TAG}_${RUN}_` } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
  });

  describe('duplicate delivery', () => {
    const id = () => evtId('expired');

    it('processes the first delivery and releases the held seats exactly once', async () => {
      expect(await reservedOn(tier.id)).toBe(2);

      const res = await post('/webhooks/stripe', expiredEvent(id(), sessionId, 1_800_000_000), SECRET);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('FAILED');
      expect(await reservedOn(tier.id)).toBe(0);

      const row = await ledgerRow(id());
      expect(row).toMatchObject({
        endpoint: 'PLATFORM',
        type: 'checkout.session.expired',
        objectId: sessionId,
        status: 'PROCESSED',
        deliveries: 1,
      });
      expect(row.processedAt).not.toBeNull();
      // Stripe's clock, not ours — this is what ordering is judged on.
      expect(row.stripeCreatedAt.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());
    });

    it('recognises a redelivery of the same event and does not re-run the handler', async () => {
      const before = await ledgerRow(id());

      const res = await post('/webhooks/stripe', expiredEvent(id(), sessionId, 1_800_000_000), SECRET);
      expect(res.status).toBe(200);
      // `duplicate: true` is only ever returned ahead of dispatch, so this
      // response *is* the proof that no handler ran.
      expect(res.body).toEqual({ received: true, duplicate: true });

      const after = await ledgerRow(id());
      expect(after.deliveries).toBe(2);
      // Untouched: the outcome is still the first delivery's.
      expect(after.processedAt.toISOString()).toBe(before.processedAt.toISOString());
      expect(after.status).toBe('PROCESSED');

      // The money assertion: two seats released, not four.
      expect(await reservedOn(tier.id)).toBe(0);
    });

    it('survives ten concurrent redeliveries without a second release', async () => {
      const event = expiredEvent(id(), sessionId, 1_800_000_000);
      const results = await Promise.all(Array.from({ length: 10 }, () => post('/webhooks/stripe', event, SECRET)));
      expect(results.every((r) => r.status === 200)).toBe(true);

      expect(await reservedOn(tier.id)).toBe(0);
      expect((await ledgerRow(id())).deliveries).toBe(12);
    });

    it('does not dedup a genuinely different event id — the handler guard is the second layer', async () => {
      // Stripe can emit a *new* event about the same object. The ledger must
      // let it through; `OrderService.failOrder` refusing a non-PENDING order
      // is what keeps inventory correct.
      const res = await post('/webhooks/stripe', expiredEvent(evtId('expired2'), sessionId, 1_800_000_060), SECRET);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      expect(await reservedOn(tier.id)).toBe(0);
      expect((await ledgerRow(evtId('expired2'))).status).toBe('PROCESSED');
    });

    it('scopes the dedup key to the endpoint, so the same id on two endpoints is two deliveries', async () => {
      const id2 = evtId('cross');
      const platform = { id: id2, object: 'event', created: 1_800_000_100, type: 'ping.contract_test', data: { object: { id: 'x' } } };
      const connect = { ...platform, account: 'acct_replay', type: 'ping.contract_test' };

      expect((await post('/webhooks/stripe', platform, SECRET)).body).toEqual({ received: true });
      expect((await post('/webhooks/stripe/connect', connect, CONNECT_SECRET)).body).toEqual({ received: true });

      expect((await ledgerRow(id2, 'PLATFORM')).status).toBe('IGNORED');
      expect((await ledgerRow(id2, 'CONNECT')).status).toBe('IGNORED');
    });
  });

  describe('a delivery that never settled', () => {
    it('lets a retry through once the in-flight row goes stale, instead of swallowing it forever', async () => {
      // A row is stamped RECEIVED before the handler runs. If the process dies
      // in between — OOM, a restart mid-request — it never settles. Treating
      // that as "a concurrent delivery is in flight" forever would lose the
      // event permanently, so past the 5-minute window a retry may claim it.
      const id = evtId('stuck');
      const objectId = `cs_test_${TAG}_${RUN}_stuck`;
      await prisma.stripeWebhookEvent.create({
        data: {
          endpoint: 'PLATFORM',
          stripeEventId: id,
          type: 'ping.contract_test',
          objectId,
          status: 'RECEIVED',
          receivedAt: new Date(Date.now() - 6 * 60 * 1000),
        },
      });

      const res = await post('/webhooks/stripe', { id, object: 'event', created: 1_800_003_000, type: 'ping.contract_test', data: { object: { id: objectId } } }, SECRET);
      expect(res.status).toBe(200);
      // Processed, not skipped — no `duplicate: true`.
      expect(res.body).toEqual({ received: true });

      const row = await ledgerRow(id);
      expect(row.status).toBe('IGNORED');
      expect(row.deliveries).toBe(2);
      expect(row.processedAt).not.toBeNull();
    });

    it('still skips a retry while the first delivery is genuinely in flight', async () => {
      const id = evtId('inflight');
      await prisma.stripeWebhookEvent.create({
        data: { endpoint: 'PLATFORM', stripeEventId: id, type: 'ping.contract_test', status: 'RECEIVED' },
      });

      const res = await post('/webhooks/stripe', { id, object: 'event', created: 1_800_003_100, type: 'ping.contract_test', data: { object: { id: 'x' } } }, SECRET);
      expect(res.body).toEqual({ received: true, duplicate: true });
      expect((await ledgerRow(id)).status).toBe('RECEIVED');
    });
  });

  describe('out-of-order delivery', () => {
    it('records both deliveries with Stripe\'s clock so the late one is identifiable', async () => {
      // B was created after A, but arrives first — the ordering Stripe makes no
      // promise about. Nothing is reordered; the receipts make it debuggable,
      // and the handlers resolve state from the object either way.
      const objectId = `cs_test_${TAG}_${RUN}_ooo`;
      const later = { ...expiredEvent(evtId('ooo_b'), objectId, 1_800_001_000), type: 'ping.contract_test' };
      const earlier = { ...expiredEvent(evtId('ooo_a'), objectId, 1_800_000_500), type: 'ping.contract_test' };

      expect((await post('/webhooks/stripe', later, SECRET)).status).toBe(200);
      expect((await post('/webhooks/stripe', earlier, SECRET)).status).toBe(200);

      const rows = await prisma.stripeWebhookEvent.findMany({
        where: { objectId },
        orderBy: { receivedAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      // Received newest-first: receipt order is the reverse of Stripe's order.
      expect(rows[0].stripeEventId).toBe(evtId('ooo_b'));
      expect(rows[1].stripeEventId).toBe(evtId('ooo_a'));
      expect(rows[1].stripeCreatedAt.getTime()).toBeLessThan(rows[0].stripeCreatedAt.getTime());
    });
  });

  describe('failing closed in production', () => {
    afterEach(() => {
      process.env.NODE_ENV = previous.nodeEnv;
      process.env.STRIPE_WEBHOOK_SECRET = SECRET;
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
      process.env.STRIPE_BILLING_WEBHOOK_SECRET = BILLING_SECRET;
    });

    it.each([
      ['/webhooks/stripe', 'STRIPE_WEBHOOK_SECRET'],
      ['/webhooks/stripe/connect', 'STRIPE_CONNECT_WEBHOOK_SECRET'],
      ['/webhooks/stripe/billing', 'STRIPE_BILLING_WEBHOOK_SECRET'],
    ])('refuses an unverified event on %s when its secret is unset', async (path, secretName) => {
      process.env.NODE_ENV = 'production';
      delete process.env[secretName];

      const id = evtId(`prod_${secretName}`);
      const res = await post(path, { id, object: 'event', created: 1_800_002_000, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid' } } }, null);

      // 500, not 400: the delivery was fine, our configuration is not. Stripe
      // retries for three days, so the backlog drains once the secret is set.
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Webhook endpoint is not configured' });
      // Nothing was trusted, so nothing was recorded or dispatched.
      expect(await ledgerRow(id, 'PLATFORM')).toBeNull();
    });

    it('still accepts a correctly signed event in production', async () => {
      process.env.NODE_ENV = 'production';
      const id = evtId('prod_signed');
      const res = await post('/webhooks/stripe', { id, object: 'event', created: 1_800_002_100, type: 'ping.contract_test', data: { object: { id: 'x' } } }, SECRET);
      expect(res.status).toBe(200);
      expect((await ledgerRow(id)).status).toBe('IGNORED');
    });

    it('rejects a forged body in production rather than trusting it', async () => {
      process.env.NODE_ENV = 'production';
      const forged = JSON.stringify({ id: evtId('forged'), object: 'event', created: 1_800_002_200, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid' } } });
      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=deadbeef')
        .send(forged);
      expect(res.status).toBe(400);
      expect(await ledgerRow(evtId('forged'))).toBeNull();
    });
  });
});
