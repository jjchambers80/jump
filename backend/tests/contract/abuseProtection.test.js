// Contract tests for spec 020 phase 1: per-IP limits on the money paths
// (enforced here with tiny windows through RATE_LIMIT_ENFORCE_IN_TESTS and
// RATE_LIMIT_*_LIMIT), the per-buyer PENDING hold cap inside createOrder,
// the abandoned-checkout sweep against Stripe, and the baseline exemptions.
// Stripe mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { createHmac } from 'crypto';

process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
process.env.RATE_LIMIT_ORDER_CREATE_LIMIT = '3';
process.env.RATE_LIMIT_ORDER_LOOKUP_LIMIT = '2';
process.env.RATE_LIMIT_ORDER_VERIFY_LIMIT = '3';
process.env.RATE_LIMIT_SCANNER_AUTH_LIMIT = '2';
process.env.RATE_LIMIT_DOMAIN_RESOLVE_LIMIT = '2';
process.env.RATE_LIMIT_BASELINE_LIMIT = '40';
process.env.ORDER_MAX_PENDING_PER_CONTACT = '2';
process.env.ORDER_SWEEP_GRACE_MS = '0';

const sessions = new Map();
let sessionN = 0;
const RUN = Date.now().toString(36);
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn(async (params) => {
          sessionN += 1;
          const id = `cs_abuse_${RUN}_${sessionN}`;
          sessions.set(id, {
            id,
            status: 'open',
            payment_status: 'unpaid',
            expires_at: Math.floor(Date.now() / 1000) + 1800,
            metadata: params.metadata,
            payment_intent: null,
          });
          return {
            id,
            url: `https://checkout.stripe.com/pay/${id}`,
            payment_intent: null,
            metadata: params.metadata,
          };
        }),
        retrieve: jest.fn(
          async (id) => sessions.get(id) ?? { id, status: 'expired', payment_status: 'unpaid' }
        ),
        expire: jest.fn(),
      },
    },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: orderService } = await import('../../src/services/OrderService.js');

const TAG = 'abuse';
const sign = (ip) => createHmac('sha256', process.env.AUTH_SECRET).update(ip).digest('hex');
/** A request from a distinct proxied buyer: the signed client IP is the limiter key. */
const from = (ip, req) => req.set('X-Jump-Client-Ip', ip).set('X-Jump-Client-Ip-Sig', sign(ip));
let ipN = 0;
const freshIp = () => `203.0.113.${(ipN += 1)}`;

describe('Abuse protection (spec 020 phase 1)', () => {
  let org;
  let event;
  let tier;
  const body = (email, quantity = 1) => ({
    eventId: event.id,
    items: [{ priceTierId: tier.id, quantity }],
    contact: { email, firstName: 'Bea', lastName: 'Buyer' },
  });

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    org = await prisma.organization.create({
      data: { name: `${TAG} Expo Co`, email: `owner@${TAG}.test` },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Hall`,
        address: '1 Main',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo`,
        date: new Date('2027-09-18T15:00:00Z'),
        status: 'PUBLISHED',
        capacity: 500,
      },
    });
    tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 100 },
    });
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.refund.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.paymentTransaction
      .deleteMany({ where: { order: { eventId: event.id } } })
      .catch(() => {});
    await prisma.order.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    for (const k of [
      'RATE_LIMIT_ENFORCE_IN_TESTS',
      'RATE_LIMIT_ORDER_CREATE_LIMIT',
      'RATE_LIMIT_ORDER_LOOKUP_LIMIT',
      'RATE_LIMIT_ORDER_VERIFY_LIMIT',
      'RATE_LIMIT_SCANNER_AUTH_LIMIT',
      'RATE_LIMIT_DOMAIN_RESOLVE_LIMIT',
      'RATE_LIMIT_BASELINE_LIMIT',
      'ORDER_MAX_PENDING_PER_CONTACT',
      'ORDER_SWEEP_GRACE_MS',
    ])
      delete process.env[k];
  });

  const reserved = async () =>
    (await prisma.priceTier.findUnique({ where: { id: tier.id } })).quantityReserved;

  it('POST /orders: the per-IP cap counts created orders, not rejected requests; a 429 reserves nothing', async () => {
    const ip = freshIp();
    const before = await reserved();
    // Validation failures do not burn the budget
    for (let i = 0; i < 4; i += 1)
      expect((await from(ip, request(app).post('/orders')).send({ nope: true })).status).toBe(400);
    for (let i = 0; i < 3; i += 1) {
      const res = await from(ip, request(app).post('/orders')).send(
        body(`ip-cap-${i}@${TAG}.test`)
      );
      expect(res.status).toBe(201);
    }
    const fourth = await from(ip, request(app).post('/orders')).send(body(`ip-cap-4@${TAG}.test`));
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/Too many checkouts/);
    expect(fourth.headers['ratelimit-limit'] ?? fourth.headers['ratelimit']).toBeDefined();
    expect(await reserved()).toBe(before + 3);
    // Another address is unaffected
    expect(
      (await from(freshIp(), request(app).post('/orders')).send(body(`ip-cap-other@${TAG}.test`)))
        .status
    ).toBe(201);
  });

  it('per-buyer hold cap: open checkouts for one email on one event are capped; failed or completed ones do not count', async () => {
    const email = `holds@${TAG}.test`;
    const before = await reserved();
    const first = await from(freshIp(), request(app).post('/orders')).send(body(email));
    const second = await from(freshIp(), request(app).post('/orders')).send(body(email));
    expect([first.status, second.status]).toEqual([201, 201]);
    const third = await from(freshIp(), request(app).post('/orders')).send(body(email));
    expect(third.status).toBe(409);
    expect(third.body.message).toMatch(/already have tickets on hold/);
    expect(await reserved()).toBe(before + 2); // the refused checkout reserved nothing
    // A completed or failed order frees the slot
    await prisma.order.update({ where: { id: first.body.orderId }, data: { status: 'FAILED' } });
    const again = await from(freshIp(), request(app).post('/orders')).send(body(email));
    expect(again.status).toBe(201);
    // Another event is its own cap
    const other = await prisma.event.create({
      data: {
        venueId: event.venueId,
        name: `${TAG} Other`,
        date: new Date('2027-10-18T15:00:00Z'),
        status: 'PUBLISHED',
        capacity: 50,
      },
    });
    const otherTier = await prisma.priceTier.create({
      data: { eventId: other.id, name: 'GA', price: 10, quantityTotal: 10 },
    });
    const elsewhere = await from(freshIp(), request(app).post('/orders')).send({
      eventId: other.id,
      items: [{ priceTierId: otherTier.id, quantity: 1 }],
      contact: { email, firstName: 'Bea', lastName: 'Buyer' },
    });
    expect(elsewhere.status).toBe(201);
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: other.id } } });
    await prisma.order.deleteMany({ where: { eventId: other.id } });
    await prisma.priceTier.delete({ where: { id: otherTier.id } });
    await prisma.event.delete({ where: { id: other.id } });
  });

  it('abandoned-checkout sweep: expired sessions release the hold, a paid-but-missed one completes, young holds are left alone; rerun is a no-op', async () => {
    const email = `sweep@${TAG}.test`;
    const mk = async () =>
      (await from(freshIp(), request(app).post('/orders')).send(body(`${sessionN}-${email}`))).body
        .orderId;
    const staleExpired = await mk();
    const staleOpenPast = await mk();
    const stalePaid = await mk();
    const young = await mk();
    const old = new Date(Date.now() - 31 * 60 * 1000);
    await prisma.order.updateMany({
      where: { id: { in: [staleExpired, staleOpenPast, stalePaid] } },
      data: { createdAt: old },
    });
    const sessionOf = async (id) =>
      (await prisma.order.findUnique({ where: { id }, select: { stripeSessionId: true } }))
        .stripeSessionId;
    sessions.get(await sessionOf(staleExpired)).status = 'expired';
    Object.assign(sessions.get(await sessionOf(staleOpenPast)), {
      status: 'open',
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    Object.assign(sessions.get(await sessionOf(stalePaid)), {
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_abuse_paid',
    });
    const before = await reserved();

    const result = await orderService.sweepAbandoned();
    expect(result).toMatchObject({ scanned: 3, failed: 2, completed: 1, skipped: 0 });
    const statuses = Object.fromEntries(
      (
        await prisma.order.findMany({
          where: { id: { in: [staleExpired, staleOpenPast, stalePaid, young] } },
          select: { id: true, status: true },
        })
      ).map((o) => [o.id, o.status])
    );
    expect(statuses).toEqual({
      [staleExpired]: 'FAILED',
      [staleOpenPast]: 'FAILED',
      [stalePaid]: 'COMPLETED',
      [young]: 'PENDING',
    });
    // Two holds released, one moved to sold (completion), the young one still held
    expect(await reserved()).toBe(before - 3);
    expect(
      (await prisma.priceTier.findUnique({ where: { id: tier.id } })).quantitySold
    ).toBeGreaterThanOrEqual(1);
    const again = await orderService.sweepAbandoned();
    expect(again).toMatchObject({ scanned: 0, failed: 0, completed: 0 });
  });

  it('POST /orders/lookup and verify-payment have their own per-IP windows', async () => {
    const ip = freshIp();
    for (let i = 0; i < 2; i += 1)
      expect(
        (
          await from(ip, request(app).post('/orders/lookup')).send({
            email: `x@${TAG}.test`,
            orderRef: 'JMP-NOPE00',
          })
        ).status
      ).toBe(404);
    expect(
      (
        await from(ip, request(app).post('/orders/lookup')).send({
          email: `x@${TAG}.test`,
          orderRef: 'JMP-NOPE00',
        })
      ).status
    ).toBe(429);
    const ip2 = freshIp();
    for (let i = 0; i < 3; i += 1)
      expect(
        (await from(ip2, request(app).post('/orders/does-not-exist/verify-payment'))).status
      ).toBe(404);
    expect(
      (await from(ip2, request(app).post('/orders/does-not-exist/verify-payment'))).status
    ).toBe(429);
  });

  it('scanner: failed sign-ins are capped per IP, successful scans never count', async () => {
    const prev = process.env.SCANNER_API_KEY;
    process.env.SCANNER_API_KEY = `key-${TAG}`;
    try {
      const ip = freshIp();
      const bad = () =>
        from(ip, request(app).post('/tickets/scan'))
          .set('X-Scanner-Key', 'wrong')
          .send({ barcode: 'nope' });
      const good = () =>
        from(ip, request(app).post('/tickets/scan'))
          .set('X-Scanner-Key', `key-${TAG}`)
          .send({ barcode: 'nope' });
      for (let i = 0; i < 5; i += 1) expect((await good()).status).not.toBe(429); // 404 / 400 for an unknown barcode, never limited
      expect((await bad()).status).toBe(401);
      expect((await bad()).status).toBe(401);
      expect((await bad()).status).toBe(429);
      // A valid key from the same address is now refused too until the window passes (the limiter sits before auth)
      expect((await good()).status).toBe(429);
    } finally {
      if (prev === undefined) delete process.env.SCANNER_API_KEY;
      else process.env.SCANNER_API_KEY = prev;
    }
  });

  it('GET /domains/resolve and /owner share a per-IP window', async () => {
    const ip = freshIp();
    expect(
      (await from(ip, request(app).get('/domains/resolve')).query({ host: `nope-${TAG}.example` }))
        .status
    ).toBe(404);
    expect(
      (await from(ip, request(app).get('/domains/owner')).query({ host: `nope-${TAG}.example` }))
        .status
    ).not.toBe(429);
    expect(
      (await from(ip, request(app).get('/domains/resolve')).query({ host: `nope-${TAG}.example` }))
        .status
    ).toBe(429);
  });

  it('baseline: /health and the Stripe webhook are never counted', async () => {
    const ip = freshIp();
    for (let i = 0; i < 50; i += 1)
      expect((await from(ip, request(app).get('/health'))).status).toBe(200);
    for (let i = 0; i < 50; i += 1)
      expect(
        (
          await from(ip, request(app).post('/webhooks/stripe'))
            .set('Content-Type', 'application/json')
            .send('{}')
        ).status
      ).not.toBe(429);
    // …while ordinary routes are
    let last = 0;
    for (let i = 0; i < 45; i += 1)
      last = (await from(ip, request(app).get('/legal/versions'))).status;
    expect(last).toBe(429);
  });
});
