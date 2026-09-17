// Contract tests for add-ons (spec 012 phase 1): admin CRUD + attachments,
// public event payload, ticket checkout with add-on lines (fees, reservation,
// concurrency, failure release, completion), and refunds per line / full order.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const stripeCalls = { sessions: [], refunds: [] };
jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let counter = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn(async (params) => {
            counter++;
            stripeCalls.sessions.push(params);
            if (params.metadata?.orderRef === 'FAIL') throw new Error('stripe down');
            return { id: `cs_addon_${counter}`, url: `https://checkout.stripe.com/pay/cs_addon_${counter}`, payment_intent: `pi_addon_${counter}`, metadata: params.metadata };
          }),
          retrieve: jest.fn(async (id) => ({ id, metadata: {} })),
        },
      },
      refunds: {
        create: jest.fn(async (params) => {
          counter++;
          stripeCalls.refunds.push(params);
          return { id: `re_addon_${counter}`, amount: params.amount, status: 'succeeded' };
        }),
      },
      webhooks: { constructEvent: jest.fn() },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentService } = await import('../../src/services/PaymentService.js');
const { default: orderService } = await import('../../src/services/OrderService.js');

const TAG = 'addons-p1';

describe('Add-ons (spec 012 phase 1)', () => {
  let adminToken;
  let organizerToken;
  let outsiderToken;
  let orgId;
  let eventId;
  let gaTierId;
  let vipTierId;
  let parking; // all tiers, unlimited
  let lounge; // VIP only, limited to 2, untaxed
  let power; // APPLICATION scope — never sold with tickets

  const base = () => `/organizations/${orgId}/events/${eventId}/add-ons`;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: `admin@${TAG}.test` });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: `organizer@${TAG}.test` });
    outsiderToken = await staffToken({ role: 'ADMIN', email: `outsider@${TAG}.test` });

    const org = await request(app).post('/organizations').set(auth(adminToken)).send({ name: `${TAG} Org` });
    orgId = org.body.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');
    await joinOrgByToken(organizerToken, orgId, 'ORGANIZER');

    const venue = await request(app).post(`/organizations/${orgId}/venues`).set(auth(adminToken)).send({ name: `${TAG} Venue`, address: '1 Add-on Way' });
    const event = await request(app)
      .post(`/organizations/${orgId}/events`)
      .set(auth(adminToken))
      .send({
        venueId: venue.body.id,
        name: `${TAG} Event`,
        date: '2027-10-01T19:00:00.000Z',
        capacity: 100,
        category: 'music',
        priceTiers: [
          { name: 'GA', price: 50, quantityTotal: 80 },
          { name: 'VIP', price: 100, quantityTotal: 20 },
        ],
      });
    eventId = event.body.id;
    gaTierId = event.body.priceTiers[0].id;
    vipTierId = event.body.priceTiers[1].id;
    // 10% tax so taxable vs untaxed lines are visible in the numbers
    await prisma.event.update({ where: { id: eventId }, data: { taxRate: 0.1, status: 'PUBLISHED' } });
  });

  afterAll(async () => {
    await prisma.refund.deleteMany({ where: { order: { eventId } } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: orgId } } } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgId } } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  // ─── Admin CRUD ─────────────────────────────────────────────────────────

  describe('admin configuration', () => {
    it('ADMIN creates add-ons; presets are offered', async () => {
      const presets = await request(app).get(`${base()}/presets`).set(auth(organizerToken));
      expect(presets.status).toBe(200);
      expect(presets.body.presets.map((p) => p.key)).toEqual(expect.arrayContaining(['power', 'badge', 'parking']));

      const p = await request(app).post(base()).set(auth(adminToken)).send({ name: 'Parking pass', price: 15, scope: 'TICKET' });
      expect(p.status).toBe(201);
      expect(p.body).toMatchObject({ name: 'Parking pass', price: 15, scope: 'TICKET', allTiers: true, taxable: true, remaining: null, isActive: true });
      parking = p.body;

      const l = await request(app)
        .post(base())
        .set(auth(adminToken))
        .send({ name: 'VIP lounge', price: 40, scope: 'BOTH', allTiers: false, priceTierIds: [vipTierId], quantityTotal: 2, maxPerOrder: 2, taxable: false });
      expect(l.status).toBe(201);
      expect(l.body.priceTierIds).toEqual([vipTierId]);
      expect(l.body.remaining).toBe(2);
      lounge = l.body;

      const pw = await request(app).post(base()).set(auth(adminToken)).send({ name: 'Booth power', price: 125, scope: 'APPLICATION', taxable: false });
      expect(pw.status).toBe(201);
      power = pw.body;
    });

    it('validates fields and attachments', async () => {
      const bad = await request(app).post(base()).set(auth(adminToken)).send({ name: '', price: -1 });
      expect(bad.status).toBe(400);
      const badScope = await request(app).post(base()).set(auth(adminToken)).send({ name: 'x', price: 1, scope: 'NOPE' });
      expect(badScope.status).toBe(400);
      const foreignTier = await request(app).post(base()).set(auth(adminToken)).send({ name: 'x', price: 1, priceTierIds: ['not-a-tier'] });
      expect(foreignTier.status).toBe(400);
    });

    it('ORGANIZER can read but not write; non-members get 403', async () => {
      const list = await request(app).get(base()).set(auth(organizerToken));
      expect(list.status).toBe(200);
      expect(list.body.addOns).toHaveLength(3);

      const write = await request(app).post(base()).set(auth(organizerToken)).send({ name: 'Nope', price: 1 });
      expect(write.status).toBe(403);

      const outsider = await request(app).get(base()).set(auth(outsiderToken));
      expect(outsider.status).toBe(403);
    });

    it('updates fields and replaces attachments; reorders', async () => {
      const upd = await request(app).patch(`${base()}/${lounge.id}`).set(auth(adminToken)).send({ description: 'Lounge access', priceTierIds: [vipTierId, gaTierId] });
      expect(upd.status).toBe(200);
      expect(upd.body.priceTierIds.sort()).toEqual([gaTierId, vipTierId].sort());
      // back to VIP only for the checkout tests below
      await request(app).patch(`${base()}/${lounge.id}`).set(auth(adminToken)).send({ priceTierIds: [vipTierId] });

      const order = await request(app).post(`${base()}/reorder`).set(auth(adminToken)).send({ addOnIds: [power.id, lounge.id, parking.id] });
      expect(order.status).toBe(200);
      expect(order.body.addOns.map((a) => a.id)).toEqual([power.id, lounge.id, parking.id]);
      await request(app).post(`${base()}/reorder`).set(auth(adminToken)).send({ addOnIds: [parking.id, lounge.id, power.id] });
    });

    it('public event lists only active ticket-scope add-ons with tier restrictions', async () => {
      const res = await request(app).get(`/events/${eventId}`);
      expect(res.status).toBe(200);
      const ids = res.body.addOns.map((a) => a.id);
      expect(ids).toEqual([parking.id, lounge.id]);
      const loungePublic = res.body.addOns.find((a) => a.id === lounge.id);
      expect(loungePublic).toMatchObject({ allTiers: false, priceTierIds: [vipTierId], taxable: false, remaining: 2, soldOut: false, maxPerOrder: 2 });
      expect(res.body.addOns.find((a) => a.id === parking.id).priceTierIds).toBeNull();
    });
  });

  // ─── Ticket checkout ────────────────────────────────────────────────────

  describe('POST /orders with add-ons', () => {
    const contact = { email: `buyer@${TAG}.test`, firstName: 'Ada', lastName: 'Buyer' };

    it('rejects add-ons not offered with the cart tiers, wrong scope, or over max', async () => {
      const notOffered = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: gaTierId, quantity: 1 }], addOns: [{ addOnId: lounge.id, quantity: 1 }], contact });
      expect(notOffered.status).toBe(400);
      expect(notOffered.body.message || notOffered.body.error).toMatch(/not offered/i);

      const wrongScope = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: gaTierId, quantity: 1 }], addOns: [{ addOnId: power.id, quantity: 1 }], contact });
      expect(wrongScope.status).toBe(400);

      const overMax = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: vipTierId, quantity: 1 }], addOns: [{ addOnId: lounge.id, quantity: 3 }], contact });
      expect(overMax.status).toBe(400);

      const badShape = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: gaTierId, quantity: 1 }], addOns: [{ addOnId: parking.id, quantity: 0 }], contact });
      expect(badShape.status).toBe(400);
    });

    it('creates the order with add-on lines, correct fees/tax, Stripe line items, and reservations', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId,
          items: [{ priceTierId: vipTierId, quantity: 1 }],
          addOns: [
            { addOnId: parking.id, quantity: 2 },
            { addOnId: lounge.id, quantity: 1 },
          ],
          contact,
        });
      expect(res.status).toBe(201);

      const order = await prisma.order.findUnique({ where: { id: res.body.orderId }, include: { addOns: true, items: true } });
      // listed: 100 (VIP) + 30 (parking ×2) + 40 (lounge, untaxed) = 170
      // tax 10% on 130 = 13; platform 5% of 170 = 8.50; processing (178.50 × 2.9% + 0.30) = 5.48
      expect(Number(order.subtotalAmount)).toBe(170);
      expect(Number(order.taxAmount)).toBe(13);
      expect(Number(order.platformFeeAmount)).toBe(8.5);
      expect(Number(order.processingFeeAmount)).toBe(5.48);
      expect(Number(order.totalAmount)).toBe(196.98);
      expect(order.quantity).toBe(1); // tickets only
      expect(order.items).toHaveLength(1);
      expect(order.addOns).toHaveLength(2);
      const loungeLine = order.addOns.find((l) => l.addOnId === lounge.id);
      expect(Number(loungeLine.tax)).toBe(0);
      expect(Number(loungeLine.unitPrice)).toBe(40);

      // Stripe line items: tier + 2 add-on lines, cents sum to the order total
      const session = stripeCalls.sessions.at(-1);
      expect(session.line_items).toHaveLength(3);
      const cents = session.line_items.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
      // Per-unit cent rounding on a ×2 line can drift by a cent (pre-existing for tiers)
      expect(Math.abs(cents - 19698)).toBeLessThanOrEqual(1);
      expect(session.line_items[2].price_data.product_data.name).toMatch(/VIP lounge/);

      const loungeRow = await prisma.addOn.findUnique({ where: { id: lounge.id } });
      expect(loungeRow.quantityReserved).toBe(1);
      const parkingRow = await prisma.addOn.findUnique({ where: { id: parking.id } });
      expect(parkingRow.quantityReserved).toBe(2);

      // Completion: reservations become sold, tickets only for the tier, email lists add-ons
      await paymentService.handleCheckoutCompleted(order.stripeSessionId, 'pi_addon_done');
      const done = await prisma.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
      expect(done.status).toBe('COMPLETED');
      expect(done.tickets).toHaveLength(1);
      const loungeAfter = await prisma.addOn.findUnique({ where: { id: lounge.id } });
      expect(loungeAfter).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      const email = sentEmails.at(-1);
      expect(String(email.html)).toMatch(/2x Parking pass/);
      expect(String(email.html)).toMatch(/1x VIP lounge/);

      const detail = await request(app).get(`/orders/${order.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.addOns).toHaveLength(2);
      expect(detail.body.addOns.find((l) => l.addOnId === lounge.id)).toMatchObject({ name: 'VIP lounge', quantity: 1, unitPrice: 40, tax: 0 });

      // scan result carries the add-ons
      const t = done.tickets[0];
      const scan = await request(app)
        .post('/tickets/scan')
        .set(auth(organizerToken))
        .send({ payload: `jump://ticket?id=${t.id}&b=${t.barcode}&e=${eventId}` });
      expect(scan.status).toBe(200);
      expect(scan.body.addOns).toEqual(expect.arrayContaining([{ name: 'Parking pass', quantity: 2 }, { name: 'VIP lounge', quantity: 1 }]));

      // Public payload reflects remaining quantity
      const pub = await request(app).get(`/events/${eventId}`);
      expect(pub.body.addOns.find((a) => a.id === lounge.id).remaining).toBe(1);
    });

    it('never oversells a limited add-on under concurrent checkouts', async () => {
      // one lounge left
      const attempts = await Promise.all(
        [1, 2, 3].map((n) =>
          request(app)
            .post('/orders')
            .send({ eventId, items: [{ priceTierId: vipTierId, quantity: 1 }], addOns: [{ addOnId: lounge.id, quantity: 1 }], contact: { ...contact, email: `race${n}@${TAG}.test` } })
        )
      );
      const created = attempts.filter((r) => r.status === 201);
      const conflicts = attempts.filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
      expect(conflicts[0].body.message || conflicts[0].body.error).toMatch(/VIP lounge/);
      const vip = await prisma.priceTier.findUnique({ where: { id: vipTierId } });
      // the two losers released their VIP reservation (transaction rolled back)
      expect(vip.quantityReserved).toBe(1);

      // failing the winner releases the lounge again
      await orderService.failOrder(created[0].body.orderId, 'test expiry');
      const loungeRow = await prisma.addOn.findUnique({ where: { id: lounge.id } });
      expect(loungeRow).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      const vipAfter = await prisma.priceTier.findUnique({ where: { id: vipTierId } });
      expect(vipAfter.quantityReserved).toBe(0);
    });

    it('releases add-on reservations when Stripe session creation fails', async () => {
      const before = await prisma.addOn.findUnique({ where: { id: parking.id } });
      jest.spyOn(orderService, '_generateOrderRef').mockReturnValueOnce('FAIL');
      const res = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: gaTierId, quantity: 1 }], addOns: [{ addOnId: parking.id, quantity: 1 }], contact });
      expect(res.status).toBe(500);
      const after = await prisma.addOn.findUnique({ where: { id: parking.id } });
      expect(after.quantityReserved).toBe(before.quantityReserved);
    });

    it('cannot delete a sold add-on; deactivation hides it from the public payload', async () => {
      const del = await request(app).delete(`${base()}/${lounge.id}`).set(auth(adminToken));
      expect(del.status).toBe(409);
      const off = await request(app).post(`${base()}/${lounge.id}/deactivate`).set(auth(adminToken));
      expect(off.status).toBe(200);
      const pub = await request(app).get(`/events/${eventId}`);
      expect(pub.body.addOns.map((a) => a.id)).not.toContain(lounge.id);
      await request(app).post(`${base()}/${lounge.id}/activate`).set(auth(adminToken));

      const unsold = await request(app).post(base()).set(auth(adminToken)).send({ name: 'Temp', price: 1 });
      const delOk = await request(app).delete(`${base()}/${unsold.body.id}`).set(auth(adminToken));
      expect(delOk.status).toBe(200);
    });
  });

  // ─── Refunds ────────────────────────────────────────────────────────────

  describe('refunds', () => {
    it('refunds one add-on line (all-in amount), releases quantity, leaves tickets; full refund covers the rest', async () => {
      const order = await prisma.order.findFirst({ where: { eventId, status: 'COMPLETED' }, include: { addOns: { include: { addOn: true } } } });
      const loungeLine = order.addOns.find((l) => l.addOnId === lounge.id);

      const res = await request(app).post(`/admin/orders/${order.id}/add-ons/${loungeLine.id}/refund`).set(auth(adminToken)).send({ reason: 'changed mind' });
      expect(res.status).toBe(200);
      expect(res.body.orderAddOnId).toBe(loungeLine.id);
      // 40 + fee share (no tax): the line's lineTotal
      const expected = Math.round((40 + Number(loungeLine.platformFee) + Number(loungeLine.processingFee)) * 100) / 100;
      expect(res.body.amount).toBe(expected);
      expect(stripeCalls.refunds.at(-1).amount).toBe(Math.round(expected * 100));

      const after = await prisma.order.findUnique({ where: { id: order.id }, include: { tickets: true, addOns: true } });
      expect(after.status).toBe('PARTIALLY_REFUNDED');
      expect(after.tickets[0].status).toBe('VALID');
      expect(after.addOns.find((l) => l.id === loungeLine.id).refundedAt).not.toBeNull();
      const loungeRow = await prisma.addOn.findUnique({ where: { id: lounge.id } });
      expect(loungeRow.quantitySold).toBe(0);

      const again = await request(app).post(`/admin/orders/${order.id}/add-ons/${loungeLine.id}/refund`).set(auth(adminToken)).send({});
      expect(again.status).toBe(409);

      const history = await request(app).get(`/admin/orders/${order.id}/refunds`).set(auth(adminToken));
      expect(history.status).toBe(200);
      expect(history.body.refunds[0].addOn).toMatchObject({ id: loungeLine.id, name: 'VIP lounge', quantity: 1 });

      // Full refund: remaining amount = total − lounge line; parking line marked refunded and released
      const full = await request(app).post(`/admin/orders/${order.id}/refund`).set(auth(adminToken)).send({ reason: 'event cancelled' });
      expect(full.status).toBe(200);
      expect(full.body.amount).toBe(Math.round((196.98 - expected) * 100) / 100);
      const final = await prisma.order.findUnique({ where: { id: order.id }, include: { addOns: true } });
      expect(final.status).toBe('REFUNDED');
      expect(final.addOns.every((l) => l.refundedAt !== null)).toBe(true);
      const parkingRow = await prisma.addOn.findUnique({ where: { id: parking.id } });
      expect(parkingRow.quantitySold).toBe(0);
    });
  });

  // ─── Duplicate ──────────────────────────────────────────────────────────

  describe('event duplicate', () => {
    it('copies add-ons with remapped tier attachments', async () => {
      const dup = await request(app).post(`/organizations/${orgId}/events/${eventId}/duplicate`).set(auth(adminToken)).send({ date: '2028-01-01T19:00:00.000Z' });
      expect(dup.status).toBe(201);
      const copied = await prisma.addOn.findMany({ where: { eventId: dup.body.id }, include: { priceTiers: true }, orderBy: { displayOrder: 'asc' } });
      expect(copied.map((a) => a.name)).toEqual(['Parking pass', 'VIP lounge', 'Booth power']);
      const newVip = dup.body.priceTiers.find((t) => t.name === 'VIP');
      expect(copied[1].priceTiers.map((p) => p.priceTierId)).toEqual([newVip.id]);
      expect(copied[1].quantitySold).toBe(0);
    });
  });
});
