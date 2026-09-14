// Contract tests for Settings › Tax (spec 009)
// Org scoping via memberships / X-Jump-Org / ?organizationId=, RBAC on writes,
// validator errors, and event rate recalculation on region save.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: taxService } = await import('../../src/services/TaxService.js');
const { default: stripe } = await import('../../src/config/stripe.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'tax-ct';
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: 'Tax Test' }, AUTH_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// No live Stripe in tests: pin the service status and the rate lookup.
const serviceStatus = {
  provider: 'STRIPE_TAX',
  status: 'active',
  registrations: [{ country: 'US', region: 'NC' }],
  manageUrl: 'https://dashboard.stripe.com/settings/tax',
  error: null,
};
taxService._statusCache = { value: serviceStatus, expiresAt: Number.POSITIVE_INFINITY };
const stripeLookup = jest.spyOn(taxService, 'getTaxRateForVenue');

describe('Settings › Tax contract (spec 009)', () => {
  let orgA;
  let orgB;
  let adminA;
  let organizerA;
  let adminB;
  let sysAdmin;
  let ncVenue;
  let txVenue;
  let event;

  beforeAll(async () => {
    const stale = await prisma.organization.findMany({ where: { name: { startsWith: `${TAG} ` } }, select: { id: true } });
    if (stale.length) {
      const ids = stale.map((o) => o.id);
      const orderWhere = { event: { venue: { organizationId: { in: ids } } } };
      await prisma.refund.deleteMany({ where: { order: orderWhere } }).catch(() => {});
      await prisma.ticket.deleteMany({ where: { order: orderWhere } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order: orderWhere } }).catch(() => {});
      await prisma.order.deleteMany({ where: orderWhere }).catch(() => {});
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: ids } } } } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: { in: ids } } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: { in: ids } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: { in: ids } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    }
    orgA = await prisma.organization.create({ data: { name: `${TAG} A` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} B` } });
    [adminA, organizerA, adminB, sysAdmin] = await Promise.all([
      prisma.user.create({ data: { email: `admin-a@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgA.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `org-a@${TAG}.test`, role: 'ORGANIZER', memberships: { create: { organizationId: orgA.id, role: 'ORGANIZER' } } } }),
      prisma.user.create({ data: { email: `admin-b@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgB.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' } }),
    ]);
    ncVenue = await prisma.venue.create({ data: { organizationId: orgA.id, name: `${TAG} NC`, address: '1 Main St', state: 'NC', postalCode: '27601' } });
    txVenue = await prisma.venue.create({ data: { organizationId: orgA.id, name: `${TAG} TX`, address: '2 Main St', state: 'TX', postalCode: '73301' } });
    await prisma.venue.create({ data: { organizationId: orgA.id, name: `${TAG} nowhere`, address: '3 Main St' } });
    await prisma.venue.create({ data: { organizationId: orgB.id, name: `${TAG} B VA`, address: '4 Main St', state: 'VA', postalCode: '22201' } });
    event = await prisma.event.create({
      data: { venueId: txVenue.id, name: `${TAG} event`, date: new Date(Date.now() + 7 * 86400000), capacity: 100, status: 'PUBLISHED' },
    });
  });

  afterAll(async () => {
    const orderWhere = { event: { venue: { organizationId: { in: [orgA.id, orgB.id] } } } };
    await prisma.refund.deleteMany({ where: { order: orderWhere } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { order: orderWhere } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: orderWhere } }).catch(() => {});
    await prisma.order.deleteMany({ where: orderWhere }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: [orgA.id, orgB.id] } } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: [orgA.id, orgB.id] } } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    taxService._invalidate();
    stripeLookup.mockRestore();
  });

  beforeEach(() => {
    stripeLookup.mockReset();
  });

  it('GET /admin/settings/tax lists the org regions, unset ones included, and venues without a state', async () => {
    const res = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({ provider: 'STRIPE_TAX', status: 'active' });
    expect(res.body.service.manageUrl).toBeUndefined();
    expect(res.body.canEdit).toBe(true);
    expect(res.body.regions.map((r) => r.region)).toEqual(['NC', 'TX']);
    expect(res.body.regions[0]).toMatchObject({ name: 'North Carolina', venueCount: 1, configured: false, collecting: false, registrationFound: true });
    expect(res.body.regions[1]).toMatchObject({ name: 'Texas', configured: false, registrationFound: false });
    expect(res.body.needsAddress).toEqual([{ id: expect.any(String), name: `${TAG} nowhere` }]);
  });

  it('ORGANIZER can read but not edit', async () => {
    const read = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(organizerA)}`);
    expect(read.status).toBe(200);
    expect(read.body.canEdit).toBe(false);

    const write = await request(app)
      .put('/admin/settings/tax/regions/US/NC')
      .set('Authorization', `Bearer ${tokenFor(organizerA)}`)
      .send({ collecting: true, source: 'STRIPE' });
    expect(write.status).toBe(403);
  });

  it('PUT validates the region and body', async () => {
    const auth = ['Authorization', `Bearer ${tokenFor(adminA)}`];
    const cases = [
      ['/admin/settings/tax/regions/CA/ON', { collecting: true }, /Only US/],
      ['/admin/settings/tax/regions/US/ZZ', { collecting: true }, /two-letter/],
      ['/admin/settings/tax/regions/US/NC', { collecting: 'yes' }, /boolean/],
      ['/admin/settings/tax/regions/US/NC', { collecting: true, source: 'BASIC' }, /STRIPE or MANUAL/],
      ['/admin/settings/tax/regions/US/NC', { collecting: true, source: 'MANUAL' }, /manualRate is required/],
      ['/admin/settings/tax/regions/US/NC', { collecting: true, source: 'MANUAL', manualRate: 8.25 }, /between 0 and 0.5/],
      ['/admin/settings/tax/regions/US/NC', { collecting: false, source: 'MANUAL', manualRate: 0.05 }, /only applies when collecting/],
      ['/admin/settings/tax/regions/US/NC', { collecting: true, source: 'STRIPE', manualRate: 0.05 }, /only allowed when source is MANUAL/],
      ['/admin/settings/tax/regions/US/NC', { collecting: true, bogus: 1 }, /Unknown field/],
    ];
    for (const [path, body, message] of cases) {
      const res = await request(app).put(path).set(...auth).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    }
  });

  it('PUT with a manual rate saves the region and recalculates upcoming events there', async () => {
    const res = await request(app)
      .put('/admin/settings/tax/regions/us/tx')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ collecting: true, source: 'MANUAL', manualRate: '0.0625' });
    expect(res.status).toBe(200);
    expect(res.body.recalculatedEvents).toBe(1);
    expect(res.body.region).toMatchObject({ region: 'TX', configured: true, collecting: true, source: 'MANUAL', manualRate: 0.0625, lastRate: 0.0625, lastSource: 'MANUAL', lastError: null });
    expect(stripeLookup).not.toHaveBeenCalled();

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(Number(updated.taxRate)).toBe(0.0625);
    expect(updated.taxRateSource).toBe('MANUAL');
  });

  it('PUT with Stripe Tax looks the rate up per event and records the outcome', async () => {
    stripeLookup.mockResolvedValue(0.0825);
    const res = await request(app)
      .put('/admin/settings/tax/regions/US/TX')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ collecting: true, source: 'STRIPE' });
    expect(res.status).toBe(200);
    expect(stripeLookup).toHaveBeenCalledWith('73301', 'US');
    expect(res.body.region).toMatchObject({ source: 'STRIPE', manualRate: null, lastRate: 0.0825, lastSource: 'STRIPE' });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(Number(updated.taxRate)).toBe(0.0825);
    expect(updated.taxRateSource).toBe('STRIPE');
  });

  it('turning collecting off zeroes upcoming events in the region', async () => {
    const res = await request(app)
      .put('/admin/settings/tax/regions/US/TX')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ collecting: false });
    expect(res.status).toBe(200);
    expect(res.body.region).toMatchObject({ configured: true, collecting: false });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(Number(updated.taxRate)).toBe(0);
    expect(updated.taxRateSource).toBeNull();
  });

  it('POST …/recalculate re-runs lookups on demand and 404s for an unconfigured region', async () => {
    stripeLookup.mockResolvedValue(0.07);
    await request(app)
      .put('/admin/settings/tax/regions/US/TX')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ collecting: true, source: 'STRIPE' });
    stripeLookup.mockReset();
    stripeLookup.mockResolvedValue(0.0725);

    const res = await request(app)
      .post('/admin/settings/tax/regions/US/TX/recalculate')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.recalculatedEvents).toBe(1);
    expect(res.body.region).toMatchObject({ region: 'TX', upcomingEventCount: 1, lastRate: 0.0725, lastSource: 'STRIPE' });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(Number(updated.taxRate)).toBe(0.0725);

    // The admin event payload explains where the rate came from.
    const detail = await request(app).get(`/organizations/${orgA.id}/events?limit=100`).set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.events.find((e) => e.id === event.id).tax).toEqual({ rate: 0.0725, source: 'STRIPE', region: 'TX' });

    const missing = await request(app).post('/admin/settings/tax/regions/US/NC/recalculate').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(missing.status).toBe(404);
    const forbidden = await request(app).post('/admin/settings/tax/regions/US/TX/recalculate').set('Authorization', `Bearer ${tokenFor(organizerA)}`);
    expect(forbidden.status).toBe(403);
  });

  it('PATCH /admin/settings/tax toggles tax-inclusive pricing and GET reports it', async () => {
    const before = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(before.body.settings).toEqual({ taxInclusivePricing: false });

    const bad = await request(app).patch('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminA)}`).send({ taxInclusivePricing: 'yes' });
    expect(bad.status).toBe(400);
    const forbidden = await request(app).patch('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(organizerA)}`).send({ taxInclusivePricing: true });
    expect(forbidden.status).toBe(403);

    const on = await request(app).patch('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminA)}`).send({ taxInclusivePricing: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ taxInclusivePricing: true });
    const after = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(after.body.settings).toEqual({ taxInclusivePricing: true });

    // Public event payload carries the flag so the storefront can label prices "incl. tax".
    const pub = await request(app).get(`/events/${event.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.taxInclusivePricing).toBe(true);
  });

  it('checkout backs tax out of the listed price when the org is tax-inclusive', async () => {
    // TX collects a manual 6.25% (set above); make sure the event carries it.
    await request(app).put('/admin/settings/tax/regions/US/TX').set('Authorization', `Bearer ${tokenFor(adminA)}`).send({ collecting: true, source: 'MANUAL', manualRate: 0.0625 });
    const tier = await prisma.priceTier.create({ data: { eventId: event.id, name: `${TAG} GA`, price: 50, quantityTotal: 10, displayOrder: 0, isActive: true } });
    const sessions = jest.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: `cs_${TAG}_${RUN}`, url: 'https://checkout.stripe.com/pay/x', payment_intent: null });
    try {
      const res = await request(app)
        .post('/orders')
        .send({ eventId: event.id, priceTierId: tier.id, quantity: 1, contact: { email: `buyer@${TAG}.test`, firstName: 'Tax', lastName: 'Buyer' } });
      expect(res.status).toBe(201);
      const order = await prisma.order.findUnique({ where: { id: res.body.orderId } });
      // $50 incl. 6.25%: net 47.06, tax 2.94; fees on the net; total = 50 + fees
      expect(Number(order.subtotalAmount)).toBe(47.06);
      expect(Number(order.taxAmount)).toBe(2.94);
      expect(Number(order.platformFeeAmount)).toBe(2.35);
      expect(Number(order.processingFeeAmount)).toBe(1.73);
      expect(Number(order.totalAmount)).toBe(54.08);
      expect(sessions.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(5408);
    } finally {
      sessions.mockRestore();
    }
  });

  it('GET /admin/settings/tax/report groups collected tax by region with estimated refunds', async () => {
    const ncTier = await prisma.priceTier.create({ data: { eventId: event.id, name: `${TAG} report`, price: 10, quantityTotal: 10, displayOrder: 1, isActive: true } });
    const contact = await prisma.contact.create({ data: { organizationId: orgA.id, email: `report@${TAG}.test`, firstName: 'R', lastName: 'P' } });
    const mk = (ref, status, amounts, refunds = []) =>
      prisma.order.create({
        data: {
          orderRef: ref,
          eventId: event.id,
          contactId: contact.id,
          status,
          quantity: 1,
          currency: 'usd',
          ...amounts,
          items: { create: [{ priceTierId: ncTier.id, quantity: 1, unitPrice: 10 }] },
          refunds: { create: refunds.map((amount) => ({ amount, status: 'SUCCEEDED' })) },
        },
      });
    await mk(`JMP-${RUN}1`, 'COMPLETED', { subtotalAmount: 100, platformFeeAmount: 5, processingFeeAmount: 3.35, taxAmount: 8, totalAmount: 116.35 });
    await mk(`JMP-${RUN}2`, 'PARTIALLY_REFUNDED', { subtotalAmount: 200, platformFeeAmount: 10, processingFeeAmount: 6.39, taxAmount: 16, totalAmount: 232.39 }, [116.195]);
    await mk(`JMP-${RUN}3`, 'PENDING', { subtotalAmount: 999, platformFeeAmount: 0, processingFeeAmount: 0, taxAmount: 99, totalAmount: 1098 });

    const res = await request(app).get('/admin/settings/tax/report').set('Authorization', `Bearer ${tokenFor(organizerA)}`);
    expect(res.status).toBe(200);
    const tx = res.body.rows.find((r) => r.region === 'TX');
    expect(tx).toMatchObject({ name: 'Texas', orders: expect.any(Number) });
    expect(tx.orders).toBeGreaterThanOrEqual(2);
    expect(tx.taxCollected).toBeGreaterThanOrEqual(24);
    expect(tx.taxRefunded).toBeCloseTo(8, 2);
    expect(res.body.totals.taxNet).toBeCloseTo(res.body.totals.taxCollected - res.body.totals.taxRefunded, 2);
    expect(res.body.rows.some((r) => r.taxCollected === 99)).toBe(false); // PENDING excluded

    const csv = await request(app).get('/admin/settings/tax/report?format=csv&from=2026-01-01').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/tax-collected-2026-01-01_/);
    expect(csv.text.split('\n')[0]).toBe('"Region","State","Orders","Taxable sales","Tax collected","Tax refunded (est.)","Tax net"');
    expect(csv.text).toMatch(/"Total"/);

    const badRange = await request(app).get('/admin/settings/tax/report?from=2026-05-01&to=2026-01-01').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(badRange.status).toBe(400);
    const other = await request(app).get('/admin/settings/tax/report').set('Authorization', `Bearer ${tokenFor(adminB)}`);
    expect(other.body.rows).toEqual([]);
  });

  it('is isolated per organization and honours X-Jump-Org / ?organizationId= for SYSTEM_ADMIN', async () => {
    const other = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(adminB)}`);
    expect(other.status).toBe(200);
    expect(other.body.regions.map((r) => r.region)).toEqual(['VA']);
    expect(other.body.needsAddress).toEqual([]);

    const viaHeader = await request(app)
      .get('/admin/settings/tax')
      .set('Authorization', `Bearer ${tokenFor(sysAdmin)}`)
      .set('X-Jump-Org', orgA.id);
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.regions.map((r) => r.region)).toEqual(['NC', 'TX']);
    expect(viaHeader.body.service.manageUrl).toBe('https://dashboard.stripe.com/settings/tax');

    const viaQuery = await request(app)
      .get(`/admin/settings/tax?organizationId=${orgB.id}`)
      .set('Authorization', `Bearer ${tokenFor(sysAdmin)}`);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.body.regions.map((r) => r.region)).toEqual(['VA']);

    const none = await request(app).get('/admin/settings/tax').set('Authorization', `Bearer ${tokenFor(sysAdmin)}`);
    expect(none.status).toBe(404);
  });

  it('venue state is normalised to a code and a location change refreshes event rates', async () => {
    stripeLookup.mockResolvedValue(0.07);
    await request(app)
      .put('/admin/settings/tax/regions/US/NC')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ collecting: true, source: 'MANUAL', manualRate: 0.0475 });

    // Move the TX event's venue to North Carolina by full name; the event should pick up NC's manual rate.
    const res = await request(app)
      .patch(`/organizations/${orgA.id}/venues/${txVenue.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ state: 'north carolina', postalCode: '28202' });
    expect(res.status).toBe(200);
    expect(res.body.state ?? res.body.venue?.state).toBe('NC');
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(Number(updated.taxRate)).toBe(0.0475);
    expect(updated.taxRateSource).toBe('MANUAL');

    const bad = await request(app).patch(`/organizations/${orgA.id}/venues/${txVenue.id}`).set('Authorization', `Bearer ${tokenFor(adminA)}`).send({ state: 'Ontario' });
    expect(bad.status).toBe(400);
  });
});
