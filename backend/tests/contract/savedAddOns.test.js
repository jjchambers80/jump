// Contract tests for saved add-ons (spec 037 phase 4): the org-level saved
// add-on API, attaching to an event (existing or "Create '<typed name>'"),
// find-or-create from the per-event endpoint, shared-field propagation without
// price changes (D9), event duplication reusing products, and the OrderAddOn
// name snapshot surviving a rename.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let counter = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn(async (params) => {
            counter++;
            return { id: `cs_saved_${counter}`, url: `https://checkout.stripe.com/pay/cs_saved_${counter}`, payment_intent: `pi_saved_${counter}`, metadata: params.metadata };
          }),
          retrieve: jest.fn(async (id) => ({ id, metadata: {} })),
        },
      },
      refunds: { create: jest.fn(async (params) => ({ id: `re_saved_${++counter}`, amount: params.amount, status: 'succeeded' })) },
      webhooks: { constructEvent: jest.fn() },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentService } = await import('../../src/services/PaymentService.js');

const TAG = 'saved-addons-037';

describe('Saved add-ons (spec 037 phase 4)', () => {
  let adminToken;
  let organizerToken;
  let outsiderToken;
  let orgId;
  let venueId;
  let eventId;
  let otherEventId;
  let gaTierId;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const saved = () => `/organizations/${orgId}/saved-add-ons`;
  const eventAddOns = (id = eventId) => `/organizations/${orgId}/events/${id}/add-ons`;

  const createEvent = async (name) => {
    const res = await request(app)
      .post(`/organizations/${orgId}/events`)
      .set(auth(adminToken))
      .send({
        venueId,
        name,
        date: '2027-11-01T19:00:00.000Z',
        capacity: 100,
        category: 'music',
        priceTiers: [{ name: 'GA', price: 20, quantityTotal: 80 }],
      });
    expect(res.status).toBe(201);
    return res.body;
  };

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: `admin@${TAG}.test` });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: `organizer@${TAG}.test` });
    outsiderToken = await staffToken({ role: 'ADMIN', email: `outsider@${TAG}.test` });
    const org = await request(app).post('/organizations').set(auth(adminToken)).send({ name: `${TAG} Org` });
    orgId = org.body.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');
    await joinOrgByToken(organizerToken, orgId, 'ORGANIZER');
    const venue = await request(app).post(`/organizations/${orgId}/venues`).set(auth(adminToken)).send({ name: `${TAG} Venue`, address: '1 Saved Way' });
    venueId = venue.body.id;
    const event = await createEvent(`${TAG} Event`);
    eventId = event.id;
    gaTierId = event.priceTiers[0].id;
    await prisma.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });
    otherEventId = (await createEvent(`${TAG} Other`)).id;
  });

  afterAll(async () => {
    const events = await prisma.event.findMany({ where: { venue: { organizationId: orgId } }, select: { id: true } });
    const eventIds = events.map((e) => e.id);
    await prisma.refund.deleteMany({ where: { order: { eventId: { in: eventIds } } } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.addOnProduct.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  let power; // saved add-on

  describe('saved add-on API', () => {
    it('creates a saved add-on; a case-insensitive duplicate is 409', async () => {
      const res = await request(app)
        .post(saved())
        .set(auth(adminToken))
        .send({ name: '  Booth Power ', description: 'One drop', defaultPrice: 125, scope: 'APPLICATION', taxable: false });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Booth Power', description: 'One drop', defaultPrice: 125, scope: 'APPLICATION', taxable: false, isArchived: false, eventCount: 0 });
      power = res.body;

      const dup = await request(app).post(saved()).set(auth(adminToken)).send({ name: 'booth power', defaultPrice: 1 });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('SAVED_ADD_ON_EXISTS');
      expect(dup.body.details).toMatchObject({ savedAddOnId: power.id, name: 'Booth Power' });

      const bad = await request(app).post(saved()).set(auth(adminToken)).send({ name: '', defaultPrice: -1 });
      expect(bad.status).toBe(400);
    });

    it('lists with suggestions for presets not yet saved; searches case-insensitively', async () => {
      const all = await request(app).get(saved()).set(auth(organizerToken));
      expect(all.status).toBe(200);
      expect(all.body.savedAddOns.map((s) => s.id)).toEqual([power.id]);
      // "Booth power" preset is taken (case-insensitive), the other four are suggested.
      expect(all.body.suggestions.map((s) => s.key).sort()).toEqual(['badge', 'parking', 'table', 'vip']);
      expect(all.body.suggestions.find((s) => s.key === 'parking')).toMatchObject({ name: 'Parking pass', defaultPrice: 15, scope: 'TICKET' });
      expect(all.body).not.toHaveProperty('canCreate');

      const q = await request(app).get(`${saved()}?q=BOOTH`).set(auth(organizerToken));
      expect(q.body.savedAddOns.map((s) => s.id)).toEqual([power.id]);
      expect(q.body.canCreate).toBe(true); // "BOOTH" is not an exact name

      const exact = await request(app).get(`${saved()}?q=booth%20power`).set(auth(organizerToken));
      expect(exact.body.canCreate).toBe(false);
      expect(exact.body.exactMatch).toMatchObject({ id: power.id });

      const ticketScope = await request(app).get(`${saved()}?scope=TICKET`).set(auth(organizerToken));
      expect(ticketScope.body.savedAddOns).toHaveLength(0);
      expect(ticketScope.body.suggestions.map((s) => s.key).sort()).toEqual(['parking', 'vip']);

      const badScope = await request(app).get(`${saved()}?scope=NOPE`).set(auth(organizerToken));
      expect(badScope.status).toBe(400);
    });

    it('ORGANIZER reads but cannot write; non-members get 403', async () => {
      expect((await request(app).post(saved()).set(auth(organizerToken)).send({ name: 'x', defaultPrice: 1 })).status).toBe(403);
      expect((await request(app).get(saved()).set(auth(outsiderToken))).status).toBe(403);
      expect((await request(app).patch(`${saved()}/${power.id}`).set(auth(organizerToken)).send({ name: 'y' })).status).toBe(403);
    });

    it('archives out of the picker and back', async () => {
      const a = await request(app).post(`${saved()}/${power.id}/archive`).set(auth(adminToken));
      expect(a.status).toBe(200);
      expect(a.body.isArchived).toBe(true);
      const list = await request(app).get(saved()).set(auth(adminToken));
      expect(list.body.savedAddOns).toHaveLength(0);
      // an archived name still blocks its preset suggestion and duplicates
      expect(list.body.suggestions.map((s) => s.key)).not.toContain('power');
      const withArchived = await request(app).get(`${saved()}?includeArchived=1`).set(auth(adminToken));
      expect(withArchived.body.savedAddOns.map((s) => s.id)).toEqual([power.id]);
      const dup = await request(app).post(saved()).set(auth(adminToken)).send({ name: 'BOOTH POWER', defaultPrice: 1 });
      expect(dup.status).toBe(409);
      expect(dup.body.details.isArchived).toBe(true);

      const u = await request(app).post(`${saved()}/${power.id}/unarchive`).set(auth(adminToken));
      expect(u.body.isArchived).toBe(false);
    });
  });

  describe('attaching to events', () => {
    let offering;

    it('attaches a saved add-on at its default price; twice on one event is 409', async () => {
      const res = await request(app).post(`${eventAddOns()}/attach`).set(auth(adminToken)).send({ productId: power.id, quantityTotal: 10 });
      expect(res.status).toBe(201);
      expect(res.body.createdSavedAddOn).toBe(false);
      expect(res.body.addOn).toMatchObject({ productId: power.id, name: 'Booth Power', price: 125, scope: 'APPLICATION', taxable: false, quantityTotal: 10 });
      offering = res.body.addOn;

      const again = await request(app).post(`${eventAddOns()}/attach`).set(auth(adminToken)).send({ productId: power.id });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ADD_ON_ALREADY_ON_EVENT');
      expect(again.body.details.addOnId).toBe(offering.id);

      const other = await request(app).post(`${eventAddOns(otherEventId)}/attach`).set(auth(adminToken)).send({ productId: power.id, price: 99 });
      expect(other.status).toBe(201);
      expect(other.body.addOn.price).toBe(99); // offering price overrides the default

      const listed = await request(app).get(`${saved()}?eventId=${eventId}`).set(auth(adminToken));
      expect(listed.body.savedAddOns[0]).toMatchObject({ id: power.id, onEvent: offering.id, eventCount: 2 });
    });

    it('creates and attaches when the typed name has no match; refuses an existing name', async () => {
      const res = await request(app)
        .post(`${eventAddOns()}/attach`)
        .set(auth(adminToken))
        .send({ savedAddOn: { name: 'Parking pass', defaultPrice: 15, scope: 'TICKET' }, maxPerOrder: 2 });
      expect(res.status).toBe(201);
      expect(res.body.createdSavedAddOn).toBe(true);
      expect(res.body.savedAddOn).toMatchObject({ name: 'Parking pass', defaultPrice: 15, scope: 'TICKET', taxable: true });
      expect(res.body.addOn).toMatchObject({ productId: res.body.savedAddOn.id, price: 15, maxPerOrder: 2 });

      const taken = await request(app)
        .post(`${eventAddOns(otherEventId)}/attach`)
        .set(auth(adminToken))
        .send({ savedAddOn: { name: 'PARKING PASS', defaultPrice: 20 } });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('SAVED_ADD_ON_EXISTS');

      const both = await request(app).post(`${eventAddOns()}/attach`).set(auth(adminToken)).send({ productId: power.id, savedAddOn: { name: 'x', defaultPrice: 1 } });
      expect(both.status).toBe(400);
      const foreign = await request(app).post(`${eventAddOns()}/attach`).set(auth(adminToken)).send({ productId: 'nope' });
      expect(foreign.status).toBe(404);
    });

    it('the per-event create endpoint finds or creates the saved add-on', async () => {
      const created = await request(app).post(eventAddOns(otherEventId)).set(auth(adminToken)).send({ name: 'Table & chairs', price: 40, scope: 'APPLICATION', taxable: false });
      expect(created.status).toBe(201);
      expect(created.body.productId).toBeTruthy();
      const product = await prisma.addOnProduct.findUnique({ where: { id: created.body.productId } });
      expect(product).toMatchObject({ name: 'Table & chairs', scope: 'APPLICATION', taxable: false });
      expect(Number(product.defaultPrice)).toBe(40);

      // Same name, other spelling, on another event → the same saved add-on, its own price.
      const reused = await request(app).post(eventAddOns()).set(auth(adminToken)).send({ name: 'table & CHAIRS', price: 45 });
      expect(reused.status).toBe(201);
      expect(reused.body.productId).toBe(created.body.productId);
      expect(reused.body).toMatchObject({ name: 'Table & chairs', price: 45, scope: 'APPLICATION', taxable: false });

      // An explicit different scope is a conflict, not a silent relink.
      const mismatch = await request(app).post(eventAddOns()).set(auth(adminToken)).send({ name: 'booth power', price: 1, scope: 'TICKET' });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.code).toBe('SAVED_ADD_ON_CONFLICT');
    });

    it('editing the saved add-on updates shared fields on every event but never prices (D9)', async () => {
      const res = await request(app)
        .patch(`${saved()}/${power.id}`)
        .set(auth(adminToken))
        .send({ name: 'Booth electricity', description: '110V drop', defaultPrice: 150 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Booth electricity', defaultPrice: 150 });
      const offerings = await prisma.addOn.findMany({ where: { productId: power.id }, orderBy: { createdAt: 'asc' } });
      expect(offerings.map((o) => o.name)).toEqual(['Booth electricity', 'Booth electricity']);
      expect(offerings.map((o) => o.description)).toEqual(['110V drop', '110V drop']);
      expect(offerings.map((o) => Number(o.price))).toEqual([125, 99]);

      const clash = await request(app).patch(`${saved()}/${power.id}`).set(auth(adminToken)).send({ name: 'parking PASS' });
      expect(clash.status).toBe(409);

      const detail = await request(app).get(`${saved()}/${power.id}`).set(auth(organizerToken));
      expect(detail.status).toBe(200);
      expect(detail.body.offerings.map((o) => o.price).sort()).toEqual([125, 99].sort());
    });

    it('a shared-field edit through the event endpoint goes to the saved add-on', async () => {
      const res = await request(app).patch(`${eventAddOns()}/${offering.id}`).set(auth(adminToken)).send({ description: 'Power drop', price: 130 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ description: 'Power drop', price: 130 });
      const other = await prisma.addOn.findFirst({ where: { productId: power.id, eventId: otherEventId } });
      expect(other.description).toBe('Power drop');
      expect(Number(other.price)).toBe(99);
      const product = await prisma.addOnProduct.findUnique({ where: { id: power.id } });
      expect(product.description).toBe('Power drop');
      expect(Number(product.defaultPrice)).toBe(150);
    });

    it('event duplication offers the same saved add-ons without new ones', async () => {
      const before = await prisma.addOnProduct.count({ where: { organizationId: orgId } });
      const dup = await request(app).post(`/organizations/${orgId}/events/${eventId}/duplicate`).set(auth(adminToken)).send({ date: '2028-01-01T19:00:00.000Z' });
      expect(dup.status).toBe(201);
      const source = await prisma.addOn.findMany({ where: { eventId }, orderBy: { displayOrder: 'asc' } });
      const copied = await prisma.addOn.findMany({ where: { eventId: dup.body.id }, orderBy: { displayOrder: 'asc' } });
      expect(copied.map((a) => a.productId)).toEqual(source.map((a) => a.productId));
      expect(copied.every((a) => a.productId)).toBe(true);
      expect(await prisma.addOnProduct.count({ where: { organizationId: orgId } })).toBe(before);
    });
  });

  describe('receipt snapshot', () => {
    it('renaming a saved add-on never changes a past order line', async () => {
      const parking = await prisma.addOn.findFirst({ where: { eventId, name: 'Parking pass' } });
      const res = await request(app)
        .post('/orders')
        .send({
          eventId,
          items: [{ priceTierId: gaTierId, quantity: 1 }],
          addOns: [{ addOnId: parking.id, quantity: 1 }],
          contact: { email: `buyer@${TAG}.test`, firstName: 'Sam', lastName: 'Buyer' },
        });
      expect(res.status).toBe(201);
      const order = await prisma.order.findUnique({ where: { id: res.body.orderId }, include: { addOns: true } });
      expect(order.addOns[0].name).toBe('Parking pass');
      await paymentService.handleCheckoutCompleted(order.stripeSessionId, 'pi_saved_done');

      const rename = await request(app).patch(`${saved()}/${parking.productId}`).set(auth(adminToken)).send({ name: 'Car park' });
      expect(rename.status).toBe(200);
      expect((await prisma.addOn.findUnique({ where: { id: parking.id } })).name).toBe('Car park');

      const line = await prisma.orderAddOn.findFirst({ where: { orderId: order.id } });
      expect(line.name).toBe('Parking pass');

      const detail = await request(app).get(`/admin/orders/${order.id}`).set(auth(adminToken));
      expect(detail.status).toBe(200);
      expect(detail.body.addOns[0].name).toBe('Parking pass');

      const csv = await request(app).get(`${eventAddOns()}/purchasers.csv`).set(auth(adminToken));
      expect(csv.text).toContain('Parking pass');
      expect(csv.text).not.toContain('Car park');
    });
  });
});
