// Contract tests for approved-vendor self-serve booth selection (spec 014 phase
// 2), as a space selection since spec 037 phase 5 (apply-then-choose): an
// approved vendor is AWAITING_SELECTION; choosing a booth holds it and the
// category slot for 15 minutes and opens the order (PAYMENT_DUE). A tier is
// map-bound because the published map has booths on it (derived, no flag).
// Postgres is real; most tests stop at HELD so no Stripe call is needed — the
// card-on-file decline test below is the one path that reaches paymentIntents.create.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

// Only the cancel-checkout path and the card-on-file decline test reach Stripe.
const mockSessionsExpire = jest.fn().mockResolvedValue({});
const mockPaymentIntentsCreate = jest.fn();
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: mockSessionsExpire } },
    customers: { create: jest.fn() },
    paymentIntents: { create: mockPaymentIntentsCreate, retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { default: applicationPaymentService } = await import('../../src/services/ApplicationPaymentService.js');
const { default: applicationTemplateService } = await import('../../src/services/ApplicationTemplateService.js');

const TAG = `booth-buy-${Date.now()}`;
const STAFF_EMAIL = `${TAG}-organizer@test.local`;

describe('Approved vendor booth purchase API', () => {
  let organization;
  let event;
  let form;
  let tier;
  let map;
  let booths;
  let applications;
  let contacts;
  let organizerToken;

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
    form = await prisma.applicationForm.create({
      data: { eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-vendors`, chargeTiming: 'APPROVAL', feeMode: 'ABSORB' },
    });
    tier = await prisma.applicationTier.create({
      data: { formId: form.id, name: '10x10', price: 275, quantityTotal: 5, quantityReserved: 4 },
    });
    map = await prisma.floorMap.create({
      data: { organizationId: organization.id, eventId: event.id, name: 'Vendor Hall', status: 'PUBLISHED', width: 50, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() },
    });
    booths = await Promise.all(['A1', 'A2', 'A3', 'A4', 'A5'].map((label, index) => prisma.booth.create({
      data: { mapId: map.id, label, x: index * 10, y: 0, w: 8, h: 8, tierId: tier.id },
    })));

    contacts = [];
    applications = [];
    for (let i = 0; i < 5; i += 1) {
      const contact = await prisma.contact.create({
        data: { organizationId: organization.id, email: `vendor-${i}@${TAG}.test`, firstName: 'Vendor', lastName: String(i) },
      });
      const profile = await prisma.applicantProfile.create({
        data: { organizationId: organization.id, contactId: contact.id, businessName: `${TAG} Vendor ${i}` },
      });
      const row = await prisma.application.create({
        data: {
          eventId: event.id,
          organizationId: organization.id,
          formId: form.id,
          tierId: tier.id,
          contactId: contact.id,
          profileId: profile.id,
          // Approved (reserving form: the slot is held) and choosing a space;
          // vendor 3 is still under review.
          status: i === 3 ? 'SUBMITTED' : 'APPROVED',
          paymentStatus: i === 3 ? 'NOT_DUE' : 'AWAITING_SELECTION',
          capacitySlot: i === 3 ? 'NONE' : 'RESERVED',
          submittedAt: new Date(),
          decidedAt: i === 3 ? null : new Date(),
          statusTokenHash: `${TAG}-hash-${i}`,
        },
      });
      contacts.push(contact);
      applications.push(row);
    }
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.booth.deleteMany({ where: { mapId: map.id } });
    await prisma.floorMap.deleteMany({ where: { id: map.id } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { application: { organizationId: organization.id } } } });
    await prisma.order.deleteMany({ where: { application: { organizationId: organization.id } } });
    await prisma.application.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: organization.id } });
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } });
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await cleanupStaff([STAFF_EMAIL]);
  });

  it('requires a valid guest status token', async () => {
    const response = await request(app)
      .post(`/applications/${applications[0].id}/booth`)
      .send({ boothId: booths[0].id });

    expect(response.status).toBe(403);
  });

  it('holds a booth for an approved guest and returns an actionable conflict to the next vendor', async () => {
    const first = await request(app)
      .post(`/applications/${applications[0].id}/booth`)
      .query({ token: statusToken(applications[0].id) })
      .send({ boothId: booths[0].id });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ boothId: booths[0].id, status: 'HELD', paymentStatus: 'PAYMENT_DUE', orderRef: expect.stringMatching(/^JMP-/) });
    expect(new Date(first.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // The selection opened the order and holds the space as long as the booth.
    const row = await prisma.application.findUnique({ where: { id: applications[0].id }, include: { order: true } });
    expect(row).toMatchObject({ paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
    expect(row.order.status).toBe('PENDING');
    expect(row.selectionHeldUntil.getTime()).toBe(new Date(first.body.holdExpiresAt).getTime());

    const second = await request(app)
      .post(`/applications/${applications[1].id}/booth`)
      .query({ token: statusToken(applications[1].id) })
      .send({ boothId: booths[0].id });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BOOTH_TAKEN');
  });

  it('exposes the held booth, the hold deadline and the card state on the status view (phase 2 UI)', async () => {
    const response = await request(app)
      .get(`/applications/${applications[0].id}/status`)
      .query({ token: statusToken(applications[0].id) });

    expect(response.status).toBe(200);
    expect(response.body.tier).toMatchObject({ id: tier.id, mapBound: true });
    expect(response.body.hasCardOnFile).toBe(false);
    expect(response.body.canPay).toBe(true);
    expect(response.body.booth).toMatchObject({ id: booths[0].id, label: 'A1', status: 'HELD', w: 8, h: 8 });
    expect(new Date(response.body.booth.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(response.body.selection).toMatchObject({ state: 'HELD', map: { available: true } });

    // A vendor with no hold has no booth at all, and can choose on the map or from the list.
    const bare = await request(app)
      .get(`/applications/${applications[2].id}/status`)
      .query({ token: statusToken(applications[2].id) });
    expect(bare.body.booth).toBeNull();
    expect(bare.body.selection).toMatchObject({ state: 'CHOOSE', category: { name: '10x10', guaranteed: true }, map: { available: true, mapId: map.id, boothsAvailable: 4 } });
  });

  it('lists the Booth column and the "Booth not chosen" filter for organizers', async () => {
    const all = await request(app)
      .get(`/admin/events/${event.id}/applications`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id);
    expect(all.status).toBe(200);
    const held = all.body.data.find((row) => row.id === applications[0].id);
    expect(held).toMatchObject({ mapBound: true, booth: { label: 'A1', status: 'HELD' } });

    const notChosen = await request(app)
      .get(`/admin/events/${event.id}/applications`)
      .query({ booth: 'none' })
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id);
    expect(notChosen.status).toBe(200);
    const ids = notChosen.body.data.map((row) => row.id);
    // Approved on the map-bound tier, nothing owned yet: the vendor still
    // holding A1 counts, the SUBMITTED one does not.
    expect(ids).toEqual(expect.arrayContaining([applications[0].id, applications[1].id, applications[2].id]));
    expect(ids).not.toContain(applications[3].id);
  });

  it('renders the choose-your-space email with the map option while the vendor has not chosen', async () => {
    const application = await prisma.application.findUnique({
      where: { id: applications[2].id },
      include: { contact: true, profile: true, tier: true, form: true, event: { select: { id: true, name: true, date: true, taxRate: true, venue: { select: { organizationId: true, organization: true } } } }, order: true },
    });
    const { subject, body } = await applicationTemplateService.render(organization.id, 'CHOOSE_SPACE', application);
    expect(subject).toMatch(/choose your space/);
    expect(body).toContain('as 10x10');
    expect(body).toContain('pay $275.00'); // ABSORB: the listed price
    expect(body).toContain('pick your exact spot on the floor map');
    expect(body).toContain(`/events/${event.id}/apply/status/${application.id}`);
    expect(body).not.toContain('Your booth:');
  });

  it('authorizes the buyer-session endpoint by contact ownership', async () => {
    const session = buyerAuthService.signSession({
      contactId: contacts[1].id,
      organizationId: organization.id,
      email: contacts[1].email,
    });
    const response = await request(app)
      .post(`/buyer/me/applications/${applications[1].id}/booth`)
      .set('Authorization', `Bearer ${session}`)
      .send({ boothId: booths[1].id });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ boothId: booths[1].id, status: 'HELD' });

    const wrongOwner = await request(app)
      .post(`/buyer/me/applications/${applications[2].id}/booth`)
      .set('Authorization', `Bearer ${session}`)
      .send({ boothId: booths[2].id });
    expect(wrongOwner.status).toBe(404);
  });

  it('allows exactly one winner when two approved vendors race for a booth', async () => {
    // Vendor 1 gives its booth back (the release endpoint) to race for another one.
    const released = await request(app).post(`/applications/${applications[1].id}/release`).query({ token: statusToken(applications[1].id) });
    expect(released.body).toMatchObject({ released: true, paymentStatus: 'AWAITING_SELECTION' });
    expect(await prisma.booth.findUnique({ where: { id: booths[1].id } })).toMatchObject({ status: 'AVAILABLE', holdApplicationId: null });
    const contenders = [applications[1], applications[2]];
    const responses = await Promise.all(contenders.map((application) => request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[2].id })));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409).body.code).toBe('BOOTH_TAKEN');
  });

  it('refuses pay-now before a space is chosen', async () => {
    const application = applications[3];
    await prisma.application.update({
      where: { id: application.id },
      data: { status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', decidedAt: new Date() },
    });

    const response = await request(app)
      .post(`/applications/${application.id}/pay`)
      .query({ token: statusToken(application.id) });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/no outstanding balance/);
  });

  it('rejects an application that is not approved', async () => {
    await prisma.application.update({
      where: { id: applications[3].id },
      data: { status: 'SUBMITTED', paymentStatus: 'NOT_DUE' },
    });
    const response = await request(app)
      .post(`/applications/${applications[3].id}/booth`)
      .query({ token: statusToken(applications[3].id) })
      .send({ boothId: booths[3].id });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('APPLICATION_NOT_APPROVED');
  });

  it('moves the held booth to SOLD in the same successful-payment transition', async () => {
    const application = applications[4];
    const selectedBooth = booths[4];
    const held = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: selectedBooth.id });
    expect(held.status).toBe(200);

    await applicationPaymentService._markPaidTx(application.id, `pi_${TAG}`, { source: 'test' });
    expect(await prisma.applicationTier.findUnique({ where: { id: tier.id } })).toMatchObject({ quantityApproved: 1 });

    const [updatedApplication, soldBooth] = await Promise.all([
      prisma.application.findUnique({ where: { id: application.id } }),
      prisma.booth.findUnique({ where: { id: selectedBooth.id } }),
    ]);
    expect(updatedApplication).toMatchObject({ paymentStatus: 'PAID', boothLabel: 'A5', capacitySlot: 'APPROVED', selectionHeldUntil: null });
    expect(soldBooth).toMatchObject({ status: 'SOLD', applicationId: application.id, holdApplicationId: null, holdExpiresAt: null });

    // The status view now names the sold booth without a hold deadline …
    const status = await request(app)
      .get(`/applications/${application.id}/status`)
      .query({ token: statusToken(application.id) });
    expect(status.body.booth).toMatchObject({ label: 'A5', status: 'SOLD', holdExpiresAt: null });
    expect(status.body.canPay).toBe(false);

    // … the organizer's list drops it from "Booth not chosen" …
    const notChosen = await request(app)
      .get(`/admin/events/${event.id}/applications`)
      .query({ booth: 'none' })
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id);
    expect(notChosen.body.data.map((row) => row.id)).not.toContain(application.id);

    // … the order detail carries the booth for its line description …
    const orderRow = await prisma.order.findFirst({ where: { applicationId: application.id }, select: { id: true } });
    const order = await request(app)
      .get(`/admin/orders/${orderRow.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id);
    expect(order.status).toBe(200);
    expect(order.body.application.booth).toMatchObject({ label: 'A5', w: 8, h: 8, status: 'SOLD' });

    // … and the APPROVED email names the booth with a map deep link.
    const full = await prisma.application.findUnique({
      where: { id: application.id },
      include: { contact: true, profile: true, tier: true, form: true, event: { select: { id: true, name: true, date: true, venue: { select: { organizationId: true, organization: true } } } }, order: true },
    });
    const { body } = await applicationTemplateService.render(organization.id, 'APPROVED', full);
    expect(body).toContain('Your booth: A5 8\u00d78');
    expect(body).toContain(`/map?booth=A5`);
    expect(body).not.toContain('Choose your booth');
    expect((await applicationTemplateService.contextFor(full)).space.chooseRequired).toBe(false);
  });

  // ─── Review findings on 32b3b1e: money paths must be idempotent ────────

  /** Put an application back to "approved, choosing a space" with every hold released. */
  async function resetToChoosing(application, booth) {
    await prisma.booth.updateMany({
      where: { OR: [{ holdApplicationId: application.id }, { applicationId: application.id }, { id: booth.id }] },
      data: { status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null, applicationId: null, assignedById: null },
    });
    await prisma.order.updateMany({ where: { applicationId: application.id }, data: { status: 'CANCELLED' } });
    await prisma.application.update({
      where: { id: application.id },
      data: { status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', selectionHeldUntil: null, boothLabel: null, stripeCheckoutSessionId: null },
    });
  }

  it('a replayed Pay on a settled application is a plain 409 and changes nothing', async () => {
    const application = applications[4]; // PAID with booth A5 from the previous test
    const before = await prisma.application.findUnique({ where: { id: application.id } });
    const res = await request(app)
      .post(`/applications/${application.id}/pay`)
      .query({ token: statusToken(application.id) });
    expect(res.status).toBe(409);
    const after = await prisma.application.findUnique({ where: { id: application.id } });
    expect(after).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', boothLabel: before.boothLabel });
    const booth = await prisma.booth.findUnique({ where: { id: booths[4].id } });
    expect(booth).toMatchObject({ status: 'SOLD', applicationId: application.id });
  });

  it('the PAID transition never fails on booth state: money in, no hold → paid without a booth', async () => {
    const application = applications[3];
    // Approved, never chose a booth (or the hold expired and was released).
    await prisma.application.update({ where: { id: application.id }, data: { status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION' } });
    await applicationPaymentService._markPaidTx(application.id, `pi_${TAG}_nohold`, { source: 'test' });
    const row = await prisma.application.findUnique({ where: { id: application.id } });
    expect(row.paymentStatus).toBe('PAID');
    expect(await prisma.booth.findUnique({ where: { applicationId: application.id } })).toBeNull();
  });

  it('a stale Checkout session expiring does not reset a newer in-flight payment', async () => {
    const application = applications[2];
    await resetToChoosing(application, booths[2]);
    const held = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[2].id });
    expect(held.status).toBe(200);
    await prisma.application.update({
      where: { id: application.id },
      data: { paymentStatus: 'PROCESSING', stripeCheckoutSessionId: `cs_${TAG}_live` },
    });
    await applicationPaymentService.handleEvent({
      type: 'checkout.session.expired',
      data: { object: { id: `cs_${TAG}_stale`, mode: 'payment', metadata: { applicationId: application.id, purpose: 'pay_now' } } },
    });
    const row = await prisma.application.findUnique({ where: { id: application.id } });
    expect(row.paymentStatus).toBe('PROCESSING');
    expect(await prisma.booth.findUnique({ where: { id: booths[2].id } })).toMatchObject({ status: 'HELD', holdApplicationId: application.id });

    // A card decline inside that hosted session is retried on Stripe's page: no release here either.
    await applicationPaymentService.handleEvent({
      type: 'payment_intent.payment_failed',
      data: { object: { id: `pi_${TAG}_declined`, status: 'requires_payment_method', metadata: { applicationId: application.id, purpose: 'pay_now' } } },
    });
    expect((await prisma.application.findUnique({ where: { id: application.id } })).paymentStatus).toBe('PROCESSING');

    // The live session expiring is what releases the hold: the vendor chooses again.
    await applicationPaymentService.handleEvent({
      type: 'checkout.session.expired',
      data: { object: { id: `cs_${TAG}_live`, mode: 'payment', metadata: { applicationId: application.id, purpose: 'pay_now' } } },
    });
    expect(await prisma.application.findUnique({ where: { id: application.id } })).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null, capacitySlot: 'RESERVED' });
    expect((await prisma.booth.findUnique({ where: { id: booths[2].id } })).status).toBe('AVAILABLE');
    expect((await prisma.order.findFirst({ where: { applicationId: application.id } })).status).toBe('CANCELLED');
  });

  it('backing out of hosted Checkout expires the session and keeps the booth while the hold runs; after it lapses the booth goes back', async () => {
    const application = applications[2];
    await resetToChoosing(application, booths[2]);
    await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[2].id })
      .expect(200);
    await prisma.application.update({
      where: { id: application.id },
      data: { paymentStatus: 'PROCESSING', stripeCheckoutSessionId: `cs_${TAG}_walkaway` },
    });
    const res = await request(app)
      .post(`/applications/${application.id}/cancel-checkout`)
      .query({ token: statusToken(application.id) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true, paymentStatus: 'PAYMENT_DUE' });
    expect(mockSessionsExpire).toHaveBeenCalledWith(`cs_${TAG}_walkaway`);
    expect((await prisma.booth.findUnique({ where: { id: booths[2].id } })).status).toBe('HELD');
    // Idempotent: a second cancel is a no-op.
    const again = await request(app)
      .post(`/applications/${application.id}/cancel-checkout`)
      .query({ token: statusToken(application.id) });
    expect(again.body).toEqual({ cancelled: false, paymentStatus: 'PAYMENT_DUE' });

    // Back out again once the hold has lapsed: the booth goes back and the vendor chooses again.
    await prisma.application.update({
      where: { id: application.id },
      data: { paymentStatus: 'PROCESSING', stripeCheckoutSessionId: `cs_${TAG}_late`, selectionHeldUntil: new Date(Date.now() - 1000) },
    });
    const late = await request(app)
      .post(`/applications/${application.id}/cancel-checkout`)
      .query({ token: statusToken(application.id) });
    expect(late.body).toEqual({ cancelled: true, paymentStatus: 'AWAITING_SELECTION' });
    expect((await prisma.booth.findUnique({ where: { id: booths[2].id } })).status).toBe('AVAILABLE');
  });

  it('the hold sweep releases a lapsed booth selection as a whole; the booth sweep leaves selections to it', async () => {
    const application = applications[2];
    await resetToChoosing(application, booths[2]);
    await request(app).post(`/applications/${application.id}/booth`).query({ token: statusToken(application.id) }).send({ boothId: booths[2].id }).expect(200);
    const past = new Date(Date.now() - 1000);
    await prisma.application.update({ where: { id: application.id }, data: { selectionHeldUntil: past } });
    await prisma.booth.update({ where: { id: booths[2].id }, data: { holdExpiresAt: past } });

    const { default: boothService } = await import('../../src/services/BoothService.js');
    await boothService.sweepExpiredHolds();
    expect((await prisma.booth.findUnique({ where: { id: booths[2].id } })).status).toBe('HELD');

    expect((await applicationPaymentService.sweepExpiredSelections()).released).toBeGreaterThanOrEqual(1);
    expect((await prisma.booth.findUnique({ where: { id: booths[2].id } })).status).toBe('AVAILABLE');
    expect(await prisma.application.findUnique({ where: { id: application.id } })).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null, capacitySlot: 'RESERVED' });
    expect((await prisma.order.findFirst({ where: { applicationId: application.id } })).status).toBe('CANCELLED');
  });

  it('staff cannot assign a second booth to an application whose hold is settling', async () => {
    const application = applications[1];
    await resetToChoosing(application, booths[1]);
    await prisma.booth.update({ where: { id: booths[0].id }, data: { status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null, applicationId: null } });
    const held = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[1].id });
    expect(held.status).toBe(200);
    const res = await request(app)
      .post(`/admin/maps/${map.id}/booths/${booths[0].id}/assign`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', organization.id)
      .send({ applicationId: application.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/APPLICATION_HAS_BOOTH/);
  });

  it('a declined card on the hold request releases the booth and lets the vendor choose again', async () => {
    const application = applications[1];
    await resetToChoosing(application, booths[1]);
    await prisma.contact.update({ where: { id: contacts[1].id }, data: { stripeCustomerId: `cus_${TAG}_1` } });
    await prisma.application.update({ where: { id: application.id }, data: { stripePaymentMethodId: `pm_${TAG}_1` } });
    const declineError = new Error('Your card was declined.');
    declineError.type = 'StripeCardError';
    declineError.code = 'card_declined';
    declineError.raw = { payment_intent: { id: `pi_${TAG}_declined_1` } };
    mockPaymentIntentsCreate.mockRejectedValueOnce(declineError);

    const res = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[1].id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ boothId: booths[1].id, status: 'AVAILABLE', paymentStatus: 'AWAITING_SELECTION' });

    const row = await prisma.application.findUnique({ where: { id: application.id } });
    expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null });
    const booth = await prisma.booth.findUnique({ where: { id: booths[1].id } });
    expect(booth).toMatchObject({ status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null, applicationId: null });

    // The vendor can immediately pick the same (now-available) booth again;
    // a successful charge this time sells it.
    mockPaymentIntentsCreate.mockResolvedValueOnce({ id: `pi_${TAG}_retry_1`, status: 'succeeded' });
    const retry = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[1].id });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'SOLD', paymentStatus: 'PAID' });
  });

  it('chargeTiming no longer gates a map-bound form (every PAID form sells its space after approval)', async () => {
    const adminToken = await staffToken({ email: `admin-${TAG}@test.com`, role: 'ADMIN' });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    const res = await request(app)
      .patch(`/admin/events/${event.id}/application-forms/${form.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', organization.id)
      .send({ chargeTiming: 'SUBMIT' });
    expect(res.status).toBe(200);
    await cleanupStaff([`admin-${TAG}@test.com`]);
  });
});
