// Spec 039 card 039A: per-booth prices. A booth's own price replaces its
// tier's everywhere the vendor's space is priced (the order the selection
// opens, the adjustment floor, the public map), is locked once a vendor holds
// or owns the booth, and travels with event duplication. Stripe is mocked;
// every path here stops before a charge.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn().mockResolvedValue({}) } },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn().mockResolvedValue({}) },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const { default: mapService } = await import('../../src/services/MapService.js');

const TAG = `booth-price-${Date.now()}`;
const STAFF_EMAIL = `${TAG}-organizer@test.local`;

describe('Per-booth prices (spec 039)', () => {
  let organization;
  let event;
  let copyEvent;
  let form;
  let tier;
  let map;
  let corner;
  let aisle;
  const applications = [];
  let organizerToken;

  const layoutBooths = (overrides = {}) =>
    [corner, aisle].map((b) => ({ label: b.label, kind: 'BOOTH', x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, tierId: tier.id, ...(overrides[b.label] ?? {}) }));

  const putLayout = (booths) =>
    request(app)
      .put(`/admin/maps/${map.id}/layout`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id)
      .send({ elements: [], booths });

  const select = (i, body) =>
    request(app)
      .post(`/applications/${applications[i].id}/select`)
      .query({ token: statusToken(applications[i].id) })
      .send({ addOns: [], ...body });

  const tierLine = async (i) => {
    const order = await prisma.order.findFirst({ where: { application: { id: applications[i].id } }, include: { items: true } });
    return order.items.find((item) => item.kind === 'APPLICATION_TIER');
  };

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    organizerToken = await staffToken({ email: STAFF_EMAIL, role: 'ORGANIZER' });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    const venue = await prisma.venue.create({
      data: { organizationId: organization.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 100 },
    });
    copyEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo copy`, date: new Date(Date.now() + 2 * 86_400_000), status: 'DRAFT', capacity: 100 },
    });
    // ABSORB with no tax: the all-in price is the listed price, so the
    // assertions read as plain dollars.
    form = await prisma.applicationForm.create({
      data: { eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-vendors`, feeMode: 'ABSORB', spaceSelection: 'MAP' },
    });
    tier = await prisma.applicationTier.create({ data: { formId: form.id, name: 'Booth', price: 200, quantityTotal: 2, quantityReserved: 2 } });
    map = await prisma.floorMap.create({
      data: { organizationId: organization.id, eventId: event.id, name: 'Hall', status: 'PUBLISHED', width: 50, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() },
    });
    corner = await prisma.booth.create({ data: { mapId: map.id, label: 'A1', x: 0, y: 0, w: 8, h: 8, tierId: tier.id } });
    aisle = await prisma.booth.create({ data: { mapId: map.id, label: 'A2', x: 10, y: 0, w: 8, h: 8, tierId: tier.id } });

    for (let i = 0; i < 2; i += 1) {
      const contact = await prisma.contact.create({ data: { organizationId: organization.id, email: `v${i}@${TAG}.test`, firstName: 'V', lastName: String(i) } });
      const profile = await prisma.applicantProfile.create({ data: { organizationId: organization.id, contactId: contact.id, businessName: `${TAG} V${i}` } });
      applications.push(
        await prisma.application.create({
          data: {
            eventId: event.id,
            organizationId: organization.id,
            formId: form.id,
            tierId: tier.id,
            contactId: contact.id,
            profileId: profile.id,
            status: 'APPROVED',
            paymentStatus: 'AWAITING_SELECTION',
            capacitySlot: 'RESERVED',
            submittedAt: new Date(),
            decidedAt: new Date(),
            statusTokenHash: `${TAG}-hash-${i}`,
          },
        })
      );
    }
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.booth.deleteMany({ where: { map: { eventId: { in: [event.id, copyEvent.id] } } } });
    await prisma.floorMap.deleteMany({ where: { eventId: { in: [event.id, copyEvent.id] } } });
    await prisma.order.deleteMany({ where: { application: { organizationId: organization.id } } });
    await prisma.application.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: organization.id } });
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } });
    await prisma.event.deleteMany({ where: { id: { in: [event.id, copyEvent.id] } } });
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await cleanupStaff([STAFF_EMAIL]);
  });

  describe('map builder save', () => {
    it('stores a booth price and returns it as a number', async () => {
      const res = await putLayout(layoutBooths({ A1: { price: 349.99 } }));
      expect(res.status).toBe(200);
      const saved = res.body.booths.find((b) => b.label === 'A1');
      expect(saved.price).toBe(349.99);
      expect(res.body.booths.find((b) => b.label === 'A2').price).toBeNull();
    });

    it('keeps the stored price when a save leaves price out', async () => {
      const res = await putLayout(layoutBooths());
      expect(res.status).toBe(200);
      expect(res.body.booths.find((b) => b.label === 'A1').price).toBe(349.99);
    });

    it.each([[-1], [1.234], ['abc'], [100_001]])('refuses price %p', async (price) => {
      const res = await putLayout(layoutBooths({ A1: { price } }));
      expect(res.status).toBe(400);
      expect((await prisma.booth.findUnique({ where: { id: corner.id } })).price.toString()).toBe('349.99');
    });

    it('clears with null and sets again', async () => {
      expect((await putLayout(layoutBooths({ A1: { price: null } }))).body.booths.find((b) => b.label === 'A1').price).toBeNull();
      expect((await putLayout(layoutBooths({ A1: { price: 350 } }))).body.booths.find((b) => b.label === 'A1').price).toBe(350);
    });

    it('returns the price on the admin map read', async () => {
      const res = await request(app).get(`/admin/maps/${map.id}`).set('Authorization', `Bearer ${organizerToken}`).set('X-Jump-Org', organization.id);
      expect(res.status).toBe(200);
      expect(res.body.booths.find((b) => b.label === 'A1').price).toBe(350);
    });
  });

  describe('public map', () => {
    it('sends each booth its all-in price and the tier its price range', async () => {
      const res = await request(app).get(`/events/${event.id}/map`);
      expect(res.status).toBe(200);
      expect(res.body.booths.find((b) => b.label === 'A1').price).toBe(350);
      expect(res.body.booths.find((b) => b.label === 'A2').price).toBe(200);
      // Before fees and tax, for the vendor screen's exact totals with extras.
      expect(res.body.booths.find((b) => b.label === 'A1').listedPrice).toBe(350);
      expect(res.body.booths.find((b) => b.label === 'A2').listedPrice).toBe(200);
      expect(res.body.legend).toEqual([expect.objectContaining({ tierId: tier.id, price: 200, priceFrom: 200, priceTo: 350 })]);
    });
  });

  describe('choosing a priced booth', () => {
    it("charges the booth's own price and names it on the order line", async () => {
      const res = await select(0, { boothId: corner.id });
      expect(res.status).toBe(200);
      const line = await tierLine(0);
      expect(Number(line.unitPrice)).toBe(350);
      expect(line.description).toBe('Booth · A1');
      const order = await prisma.order.findFirst({ where: { application: { id: applications[0].id } } });
      expect(Number(order.subtotalAmount)).toBe(350);
    });

    it('charges the tier price for a booth without its own price', async () => {
      const res = await select(1, { boothId: aisle.id });
      expect(res.status).toBe(200);
      const line = await tierLine(1);
      expect(Number(line.unitPrice)).toBe(200);
      expect(line.description).toBe('Booth · A2');
    });

    it('refuses to reprice a booth a vendor holds, and saves an unchanged price', async () => {
      const locked = await putLayout(layoutBooths({ A1: { price: 400 } }));
      expect(locked.status).toBe(409);
      expect(locked.body.code ?? locked.body.error?.code).toBe('BOOTH_PRICE_LOCKED');
      expect(Number((await prisma.booth.findUnique({ where: { id: corner.id } })).price)).toBe(350);
      expect((await putLayout(layoutBooths({ A1: { price: 350 } }))).status).toBe(200);
    });

    it('floors adjustments at the booth price, not the tier price', async () => {
      const adjust = (amount) =>
        request(app)
          .post(`/admin/events/${event.id}/applications/${applications[0].id}/adjustments`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .set('X-Jump-Org', organization.id)
          .send({ amount, reason: 'Corner discount' });
      // $300 off a $350 booth is fine even though the tier is only $200.
      const ok = await adjust(-300);
      expect(ok.status).toBe(201);
      const line = await tierLine(0);
      expect(Number(line.unitPrice)).toBe(350);
      const order = await prisma.order.findFirst({ where: { application: { id: applications[0].id } } });
      expect(Number(order.subtotalAmount)).toBe(50);
      // A further $100 would take the space below zero.
      expect((await adjust(-100)).status).toBe(400);
    });
  });

  describe('event duplication', () => {
    it('copies booth prices onto the new map', async () => {
      await prisma.$transaction((tx) => mapService.copyForEvent(tx, event.id, copyEvent.id, { applicationTierIdMap: new Map() }));
      const copied = await prisma.booth.findMany({ where: { map: { eventId: copyEvent.id } }, orderBy: { label: 'asc' } });
      expect(copied.map((b) => [b.label, b.price === null ? null : Number(b.price), b.status])).toEqual([
        ['A1', 350, 'AVAILABLE'],
        ['A2', null, 'AVAILABLE'],
      ]);
    });
  });
});
