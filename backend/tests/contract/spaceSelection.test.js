// Spec 039 card 039B: how an approved vendor chooses their space, per form.
//   MAP   — the organizer approves into a category; the vendor must pick a
//           spot of that category on the published floor map (D2, D7).
//   TIERS — no map; approving with `tierId: null` lets the vendor pick a
//           tier at selection (D4, D6), which a release gives back.
// Plus the form setting's own rules: mid-selection lock (D8) and the map
// prerequisites checked when a MAP form is open (D9). Stripe is mocked;
// every path stops before a charge.

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
const { default: applicationFormService } = await import('../../src/services/ApplicationFormService.js');
const { default: applicationTemplateService } = await import('../../src/services/ApplicationTemplateService.js');

const TAG = `space-sel-${Date.now()}`;
const STAFF_EMAIL = `${TAG}-admin@test.local`;

describe('Vendor space selection modes (spec 039)', () => {
  let organization;
  let event;
  let copyEvent;
  let mapForm;
  let tiersForm;
  let truck;
  let table;
  let booth10;
  let corner;
  let big;
  let map;
  let truckSpot;
  let tableSpot;
  let token;
  let n = 0;

  const auth = (req) => req.set('Authorization', `Bearer ${token}`).set('X-Jump-Org', organization.id);
  const patchForm = (form, body) => auth(request(app).patch(`/admin/events/${event.id}/application-forms/${form.id}`)).send(body);
  const decide = (id, body) => auth(request(app).post(`/admin/events/${event.id}/applications/${id}/decision`)).send({ decision: 'APPROVE', sendEmail: false, ...body });
  const select = (id, body) => request(app).post(`/applications/${id}/select`).query({ token: statusToken(id) }).send({ addOns: [], ...body });
  const release = (id) => request(app).post(`/applications/${id}/release`).query({ token: statusToken(id) });
  const status = (id) => request(app).get(`/applications/${id}/status`).query({ token: statusToken(id) });
  const row = (id) => prisma.application.findUnique({ where: { id } });
  const tierRow = (id) => prisma.applicationTier.findUnique({ where: { id } });

  async function submitted(form) {
    n += 1;
    const contact = await prisma.contact.create({ data: { organizationId: organization.id, email: `v${n}@${TAG}.test`, firstName: 'V', lastName: String(n) } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: organization.id, contactId: contact.id, businessName: `${TAG} V${n}` } });
    return prisma.application.create({
      data: {
        eventId: event.id,
        organizationId: organization.id,
        formId: form.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'SUBMITTED',
        paymentStatus: 'NOT_DUE',
        submittedAt: new Date(),
        statusTokenHash: `${TAG}-hash-${n}`,
      },
    });
  }

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    token = await staffToken({ email: STAFF_EMAIL, role: 'ADMIN' });
    await joinOrgByToken(token, organization.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: organization.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.now() + 30 * 86_400_000), status: 'PUBLISHED', capacity: 100 } });
    copyEvent = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Copy`, date: new Date(Date.now() + 60 * 86_400_000), status: 'DRAFT', capacity: 100 } });

    mapForm = await prisma.applicationForm.create({ data: { organizationId: organization.id, eventId: event.id, kind: 'PAID', name: 'Map vendors', slug: `${TAG}-map`, feeMode: 'ABSORB' } });
    truck = await prisma.applicationTier.create({ data: { formId: mapForm.id, name: 'Food truck', price: 300, quantityTotal: 5, displayOrder: 0 } });
    table = await prisma.applicationTier.create({ data: { formId: mapForm.id, name: 'Table', price: 100, quantityTotal: 5, displayOrder: 1 } });

    tiersForm = await prisma.applicationForm.create({ data: { organizationId: organization.id, eventId: event.id, kind: 'PAID', name: 'Tier vendors', slug: `${TAG}-tiers`, feeMode: 'ABSORB', status: 'OPEN' } });
    booth10 = await prisma.applicationTier.create({ data: { formId: tiersForm.id, name: '10x10', price: 200, quantityTotal: 3, displayOrder: 0 } });
    corner = await prisma.applicationTier.create({ data: { formId: tiersForm.id, name: 'Corner', price: 350, quantityTotal: 1, displayOrder: 1 } });
    big = await prisma.applicationTier.create({ data: { formId: tiersForm.id, name: '20x20', price: 500, quantityTotal: 1, displayOrder: 2, isActive: false } });

    map = await prisma.floorMap.create({ data: { organizationId: organization.id, eventId: event.id, name: 'Hall', status: 'DRAFT', width: 50, height: 40, layout: { version: 1, elements: [] } } });
    truckSpot = await prisma.booth.create({ data: { mapId: map.id, label: 'T1', x: 0, y: 0, w: 8, h: 8, tierId: truck.id, price: 450 } });
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    const events = [event.id, copyEvent.id];
    await prisma.booth.deleteMany({ where: { map: { eventId: { in: events } } } });
    await prisma.floorMap.deleteMany({ where: { eventId: { in: events } } });
    await prisma.order.deleteMany({ where: { application: { organizationId: organization.id } } });
    await prisma.applicationDecision.deleteMany({ where: { application: { organizationId: organization.id } } });
    await prisma.application.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: organization.id } });
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: { in: events } } });
    await prisma.event.deleteMany({ where: { id: { in: events } } });
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await cleanupStaff([STAFF_EMAIL]);
  });

  describe('form setting', () => {
    it('defaults to TIERS, refuses unknown values and FREE forms', async () => {
      const read = await auth(request(app).get(`/admin/events/${event.id}/application-forms`));
      expect(read.status).toBe(200);
      expect(read.body.data.find((f) => f.id === mapForm.id).spaceSelection).toBe('TIERS');
      expect((await patchForm(mapForm, { spaceSelection: 'BOTH' })).status).toBe(400);
      const free = await prisma.applicationForm.create({ data: { organizationId: organization.id, eventId: event.id, kind: 'FREE', name: 'Press', slug: `${TAG}-press` } });
      expect((await patchForm(free, { spaceSelection: 'MAP' })).status).toBe(400);
    });

    it('lets a draft form switch to MAP before the map is ready, but not open', async () => {
      const set = await patchForm(mapForm, { spaceSelection: 'MAP' });
      expect(set.status).toBe(200);
      expect(set.body.spaceSelection).toBe('MAP');
      const open = await patchForm(mapForm, { status: 'OPEN' });
      expect(open.status).toBe(400);
      expect(open.body.code).toBe('MAP_NOT_READY');
    });

    it('opens only once the published map has spots on every active tier', async () => {
      await prisma.floorMap.update({ where: { id: map.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
      const missing = await patchForm(mapForm, { status: 'OPEN' });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('MAP_NOT_READY');
      expect(missing.body.details.tiers).toEqual([{ id: table.id, name: 'Table' }]);

      tableSpot = await prisma.booth.create({ data: { mapId: map.id, label: 'A1', x: 10, y: 0, w: 5, h: 5, tierId: table.id } });
      expect((await patchForm(mapForm, { status: 'OPEN' })).status).toBe(200);
    });

    it('refuses switching an open form to MAP when the map is not ready', async () => {
      const res = await patchForm(tiersForm, { spaceSelection: 'MAP' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MAP_NOT_READY');
    });
  });

  describe('MAP form', () => {
    let app1;

    it('requires a category on approval', async () => {
      app1 = await submitted(mapForm);
      const res = await decide(app1.id, { tierId: null });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_REQUIRED');
    });

    it('refuses a category with no spots on the published map', async () => {
      await prisma.floorMap.update({ where: { id: map.id }, data: { status: 'DRAFT' } });
      const res = await decide(app1.id, { tierId: truck.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NO_SPOTS_IN_CATEGORY');
      await prisma.floorMap.update({ where: { id: map.id }, data: { status: 'PUBLISHED' } });
    });

    it('approves into a category and shows its spots with their price range', async () => {
      expect((await decide(app1.id, { tierId: truck.id })).status).toBe(200);
      const view = await status(app1.id);
      expect(view.status).toBe(200);
      expect(view.body.selection).toMatchObject({
        mode: 'MAP',
        state: 'CHOOSE',
        tierLocked: true,
        categories: null,
        category: expect.objectContaining({ id: truck.id, name: 'Food truck' }),
        map: { available: true, pending: false, mapId: map.id, boothsAvailable: 1, priceFrom: 450, priceTo: 450 },
        pricing: { feeMode: 'ABSORB', taxable: false, taxRate: 0, taxInclusive: false },
      });
      expect(view.body.selection.category).toMatchObject({ price: 300, listedPrice: 300 });
    });

    it('shows a waiting state while the map is unpublished', async () => {
      await prisma.floorMap.update({ where: { id: map.id }, data: { status: 'DRAFT' } });
      const view = await status(app1.id);
      expect(view.body.selection.map).toMatchObject({ available: false, pending: true });
      await prisma.floorMap.update({ where: { id: map.id }, data: { status: 'PUBLISHED' } });
    });

    it('refuses a category-only purchase and a spot of another category', async () => {
      const noBooth = await select(app1.id, {});
      expect(noBooth.status).toBe(400);
      expect(noBooth.body.code).toBe('BOOTH_REQUIRED');
      const wrong = await select(app1.id, { boothId: tableSpot.id });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('BOOTH_TIER_MISMATCH');
    });

    it("holds a spot of the vendor's category at the spot's price", async () => {
      const res = await select(app1.id, { boothId: truckSpot.id });
      expect(res.status).toBe(200);
      const order = await prisma.order.findFirst({ where: { application: { id: app1.id } }, include: { items: true } });
      expect(Number(order.items.find((i) => i.kind === 'APPLICATION_TIER').unitPrice)).toBe(450);
    });

    it('locks the mode while a vendor is mid-selection', async () => {
      const res = await patchForm(mapForm, { spaceSelection: 'TIERS' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SPACE_SELECTION_LOCKED');
      expect(res.body.details).toEqual({ choosing: 1 });
    });
  });

  describe('TIERS form, vendor chooses', () => {
    let app2;

    it('approves without a category and takes no slot', async () => {
      app2 = await submitted(tiersForm);
      const res = await decide(app2.id, { tierId: null });
      expect(res.status).toBe(200);
      expect(await row(app2.id)).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', tierId: null, capacitySlot: 'NONE', tierChosenByVendor: false });
      expect((await tierRow(booth10.id)).quantityReserved).toBe(0);
    });

    it('lists the active tiers to choose from, no map', async () => {
      const view = await status(app2.id);
      expect(view.body.selection).toMatchObject({ mode: 'TIERS', state: 'CHOOSE', tierLocked: false, category: null, map: { available: false, pending: false } });
      expect(view.body.selection.categories.map((c) => [c.name, c.applicantPays, c.spacesLeft])).toEqual([
        ['10x10', 200, 3],
        ['Corner', 350, 1],
      ]);
      expect(view.body.selection.categories[0].addOns).toEqual([]);
    });

    it('refuses a booth, a missing tier and a tier the form does not offer', async () => {
      expect((await select(app2.id, { boothId: truckSpot.id })).body.code).toBe('BOOTH_NOT_OFFERED');
      expect((await select(app2.id, {})).body.code).toBe('TIER_REQUIRED');
      expect((await select(app2.id, { tierId: big.id })).body.code).toBe('TIER_NOT_OFFERED');
      expect((await select(app2.id, { tierId: truck.id })).body.code).toBe('TIER_NOT_OFFERED');
    });

    it('takes the picked tier and its slot with the hold', async () => {
      const res = await select(app2.id, { tierId: corner.id });
      expect(res.status).toBe(200);
      expect(await row(app2.id)).toMatchObject({ paymentStatus: 'PAYMENT_DUE', tierId: corner.id, tierChosenByVendor: true, capacitySlot: 'RESERVED' });
      expect((await tierRow(corner.id)).quantityReserved).toBe(1);
      const view = await status(app2.id);
      expect(view.body.selection).toMatchObject({ state: 'HELD', tierLocked: false, category: expect.objectContaining({ id: corner.id }) });
    });

    it('gives the tier and slot back on release', async () => {
      expect((await release(app2.id)).status).toBe(200);
      expect(await row(app2.id)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', tierId: null, tierChosenByVendor: false, capacitySlot: 'NONE' });
      expect((await tierRow(corner.id)).quantityReserved).toBe(0);
    });

    it('emails "pick the space type" with no single price and no map', async () => {
      const application = await prisma.application.findUnique({
        where: { id: app2.id },
        include: { contact: true, profile: true, tier: true, form: true, event: { select: { id: true, name: true, date: true, taxRate: true, venue: { select: { organizationId: true, organization: true } } } }, order: true },
      });
      const { body } = await applicationTemplateService.render(organization.id, 'CHOOSE_SPACE', application);
      expect(body).toContain('Pick the space type that fits you');
      expect(body).toContain('choose your space and pay to confirm it');
      expect(body).not.toContain('floor map');
    });

    it('is first come: a full tier is refused', async () => {
      const other = await submitted(tiersForm);
      await decide(other.id, { tierId: null });
      expect((await select(other.id, { tierId: corner.id })).status).toBe(200);
      const res = await select(app2.id, { tierId: corner.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOLD_OUT');
      expect((await row(app2.id)).tierId).toBeNull();
    });

    it('cannot be settled offline before a tier is chosen', async () => {
      const res = await auth(request(app).post(`/admin/events/${event.id}/applications/${app2.id}/waive`)).send({ reason: 'Sponsor' });
      // canSettleOffline: nothing to settle until a category exists.
      expect(res.status).toBe(409);
      expect((await row(app2.id)).paymentStatus).toBe('AWAITING_SELECTION');
    });

    it('an organizer tier change locks the tier and takes the slot a reserving approval would', async () => {
      const res = await auth(request(app).post(`/admin/events/${event.id}/applications/${app2.id}/tier`)).send({ tierId: booth10.id, sendEmail: false });
      expect(res.status).toBe(200);
      expect(await row(app2.id)).toMatchObject({ tierId: booth10.id, tierChosenByVendor: false, capacitySlot: 'RESERVED' });
      expect((await tierRow(booth10.id)).quantityReserved).toBe(1);
      const view = await status(app2.id);
      expect(view.body.selection).toMatchObject({ tierLocked: true, categories: null, category: expect.objectContaining({ id: booth10.id }) });
    });
  });

  describe('TIERS form, organizer locks the tier', () => {
    it('refuses another tier at selection', async () => {
      const locked = await submitted(tiersForm);
      expect((await decide(locked.id, { tierId: booth10.id })).status).toBe(200);
      const res = await select(locked.id, { tierId: corner.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TIER_LOCKED');
      expect((await select(locked.id, { tierId: booth10.id })).status).toBe(200);
    });
  });

  describe('templates and duplication', () => {
    it('carry the mode', async () => {
      expect(applicationFormService.snapshotForm({ ...mapForm, spaceSelection: 'MAP', tiers: [], questions: [] }).spaceSelection).toBe('MAP');
      await prisma.$transaction((tx) => applicationFormService.copyForms(event.id, copyEvent.id, tx));
      const copies = await prisma.applicationForm.findMany({ where: { eventId: copyEvent.id, kind: 'PAID' }, orderBy: { name: 'asc' } });
      expect(copies.map((f) => [f.name, f.spaceSelection, f.status])).toEqual([
        ['Map vendors', 'MAP', 'DRAFT'],
        ['Tier vendors', 'TIERS', 'DRAFT'],
      ]);
    });
  });
});
