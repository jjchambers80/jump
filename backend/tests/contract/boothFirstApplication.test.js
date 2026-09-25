// Contract tests for the booth-first application flow (spec 037).
//
// boothHoldConcurrency.test.js proves the *approval-first* hold can never
// double-book. This suite asks the same question of the flow that runs before
// anyone has decided anything, plus the two things that are new:
//
//   - a booth picked on the apply form is held the instant the application
//     exists, and losing that race takes the whole submission down with it
//     (nobody ends up applied-for-nothing while somebody else has their booth)
//   - a hold that starts before the decision survives the things that used to
//     release it — specifically a declined card — and is released by the things
//     that end the application: reject, waitlist, withdraw, expiry.
//
// Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const mockSessionsCreate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockIntentsRetrieve = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn(), expire: jest.fn().mockResolvedValue({}) } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: mockIntentsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: boothService } = await import('../../src/services/BoothService.js');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');

const TAG = `boothfirst-${Date.now()}`;

let n = 0;
function resetStripeMocks() {
  mockSessionsCreate.mockReset().mockImplementation(async (params) => {
    n += 1;
    return { id: `cs_${TAG}_${n}`, url: `https://checkout.stripe.com/c/pay/cs_${n}`, mode: params.mode, metadata: params.metadata };
  });
  mockCustomersCreate.mockReset().mockImplementation(async () => ({ id: `cus_${TAG}_${++n}` }));
  mockIntentsCreate.mockReset().mockImplementation(async () => ({ id: `pi_${TAG}_${++n}`, status: 'succeeded' }));
  mockIntentsRetrieve.mockReset().mockResolvedValue({ transfer_data: null, application_fee_amount: null });
  mockSetupIntentsRetrieve.mockReset().mockImplementation(async (id) => ({ id, payment_method: `pm_${TAG}_${id}` }));
}

function cardDecline() {
  const err = new Error('Your card was declined.');
  err.type = 'StripeCardError';
  err.code = 'card_declined';
  err.raw = { payment_intent: { id: `pi_${TAG}_declined_${++n}` } };
  return err;
}

describe('Booth-first application flow (spec 037)', () => {
  let adminToken;
  let org;
  let event;
  let form;
  let tier;
  let map;
  let booths;

  // A second organizer's event, to prove a booth id from elsewhere is invisible.
  let otherOrg;
  let otherBooth;

  const emails = [`admin@${TAG}.test`];
  const auth = () => ['Authorization', `Bearer ${adminToken}`];

  /** One booth-first submission. `boothId: null` omits the field entirely. */
  const submit = (email, boothId, { businessName = 'Hidden Block Games' } = {}) =>
    request(app)
      .post(`/events/${event.id}/applications`)
      .send({
        formSlug: form.slug,
        tierId: tier.id,
        ...(boothId ? { boothId } : {}),
        contact: { email, firstName: 'Vee', lastName: 'Vendor' },
        acceptances: allAcceptances(),
        profile: { businessName },
        answers: {},
      });

  const boothRow = (id) => prisma.booth.findUnique({ where: { id } });
  const appRow = (id) => prisma.application.findUnique({ where: { id }, include: { order: true } });

  const decide = (applicationId, decision) =>
    request(app)
      .post(`/admin/events/${event.id}/applications/${applicationId}/decision`)
      .set(...auth())
      .send({ decision, sendEmail: false });

  /** The applicant withdrawing themselves, from their own status page. */
  async function withdrawAsApplicant(applicationId) {
    const row = await prisma.application.findUnique({ where: { id: applicationId }, include: { contact: true } });
    const token = buyerAuthService.signSession({
      contactId: row.contactId,
      organizationId: row.organizationId,
      email: row.contact.email,
    });
    return request(app).post(`/buyer/me/applications/${applicationId}/withdraw`).set('Authorization', `Bearer ${token}`);
  }

  /** Drive a DRAFT card-on-file application to SUBMITTED through the setup webhook. */
  async function cardOnFile(applicationId) {
    const row = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { contact: true },
    });
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          id: `evt_${++n}`,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: row.stripeCheckoutSessionId,
              mode: 'setup',
              setup_intent: `seti_${applicationId}`,
              customer: row.contact.stripeCustomerId,
              metadata: { applicationId, purpose: 'submit' },
            },
          },
        })
      );
    expect(res.status).toBe(200);
    return appRow(applicationId);
  }

  /** Every fixture booth back in the pool, and every application from the last test gone. */
  async function reset() {
    await prisma.booth.updateMany({
      where: { mapId: map.id },
      data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdKind: null, holdExpiresAt: null, assignedById: null },
    });
    // Orders are RESTRICT-referenced by their transactions, so the charge rows
    // a settled approval leaves behind have to go first.
    await prisma.paymentTransaction.deleteMany({ where: { order: { application: { organizationId: org.id } } } });
    await prisma.order.deleteMany({ where: { application: { organizationId: org.id } } });
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } });
    await prisma.contact.deleteMany({ where: { organizationId: org.id } });
    resetStripeMocks();
  }

  async function seedOrg(prefix) {
    const seededOrg = await prisma.organization.create({ data: { name: `${prefix} Org`, email: `owner@${prefix}.test` } });
    const venue = await prisma.venue.create({
      data: { organizationId: seededOrg.id, name: `${prefix} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' },
    });
    const seededEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `${prefix} Expo`, date: new Date(Date.now() + 90 * 86_400_000), status: 'PUBLISHED', capacity: 500 },
    });
    const seededForm = await prisma.applicationForm.create({
      data: {
        eventId: seededEvent.id,
        kind: 'PAID',
        name: 'Vendors',
        slug: `${prefix}-vendors`,
        status: 'OPEN',
        chargeTiming: 'APPROVAL',
        feeMode: 'ABSORB',
        paymentDueDays: 7,
      },
    });
    const seededTier = await prisma.applicationTier.create({
      data: { formId: seededForm.id, name: '10x10', price: 275, quantityTotal: 20, mapBound: true },
    });
    const seededMap = await prisma.floorMap.create({
      data: {
        organizationId: seededOrg.id,
        eventId: seededEvent.id,
        name: 'Vendor Hall',
        status: 'PUBLISHED',
        width: 120,
        height: 40,
        layout: { version: 1, elements: [] },
        publishedAt: new Date(),
      },
    });
    return { org: seededOrg, event: seededEvent, form: seededForm, tier: seededTier, map: seededMap };
  }

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    ({ org, event, form, tier, map } = await seedOrg(TAG));
    await joinOrgByToken(adminToken, org.id, 'ADMIN');

    booths = [];
    for (const [index, labelText] of ['A1', 'A2', 'A3'].entries()) {
      booths.push(
        await prisma.booth.create({
          data: { mapId: map.id, label: labelText, x: index * 10, y: 0, w: 8, h: 8, tierId: tier.id },
        })
      );
    }

    const other = await seedOrg(`${TAG}-other`);
    otherOrg = other.org;
    otherBooth = await prisma.booth.create({
      data: { mapId: other.map.id, label: 'Z9', x: 0, y: 0, w: 8, h: 8, tierId: other.tier.id },
    });
  });

  afterAll(async () => {
    for (const each of [org, otherOrg]) {
      await prisma.booth.deleteMany({ where: { map: { organizationId: each.id } } });
      await prisma.floorMap.deleteMany({ where: { organizationId: each.id } });
      await prisma.order.deleteMany({ where: { application: { organizationId: each.id } } });
      await prisma.legalAcceptance.deleteMany({ where: { organizationId: each.id } }).catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: each.id } });
      await prisma.applicantProfile.deleteMany({ where: { organizationId: each.id } });
      await prisma.contact.deleteMany({ where: { organizationId: each.id } });
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: each.id } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: each.id } } });
      await prisma.venue.deleteMany({ where: { organizationId: each.id } });
      await prisma.organization.deleteMany({ where: { id: each.id } });
    }
    await cleanupStaff(emails);
  });

  beforeEach(reset);

  // ─── The booth comes with the application ────────────────────────────────

  describe('the booth is chosen on the form, not after approval', () => {
    it('refuses a submission with no booth once the map is published', async () => {
      const res = await submit(`nobooth@${TAG}.test`, null);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/choose a booth/i);
      // Nothing half-created: no application, and every booth still free.
      expect(await prisma.application.count({ where: { organizationId: org.id } })).toBe(0);
      expect(await prisma.booth.count({ where: { mapId: map.id, status: 'AVAILABLE' } })).toBe(booths.length);
    });

    it('holds the chosen booth on the APPLICATION clock as the application is created', async () => {
      const res = await submit(`vee@${TAG}.test`, booths[0].id);
      expect(res.status).toBe(201);

      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('HELD');
      expect(booth.holdApplicationId).toBe(res.body.applicationId);
      expect(booth.holdKind).toBe('APPLICATION');
      expect(booth.holdExpiresAt).toBeTruthy();

      const application = await appRow(res.body.applicationId);
      expect(application.status).toBe('DRAFT'); // card next; the booth is already theirs
      expect(application.boothLabel).toBe('A1');
    });

    it('never lets one booth reach two applications, and a loser applies for nothing', async () => {
      const contenders = 6;
      const results = await Promise.all(
        Array.from({ length: contenders }, (_, i) => submit(`racer-${i}@${TAG}.test`, booths[1].id))
      );

      const won = results.filter((r) => r.status === 201);
      const lost = results.filter((r) => r.status !== 201);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(contenders - 1);
      for (const loss of lost) {
        expect(loss.status).toBe(409);
        expect(loss.body.code).toBe('BOOTH_TAKEN');
      }

      const booth = await boothRow(booths[1].id);
      expect(booth.status).toBe('HELD');
      expect(booth.holdApplicationId).toBe(won[0].body.applicationId);

      // The losing submissions rolled back whole: exactly one application row,
      // not five vendors who applied and silently have no booth.
      expect(await prisma.application.count({ where: { organizationId: org.id } })).toBe(1);
    });

    it('cannot reach a booth belonging to another organizer', async () => {
      const res = await submit(`sneaky@${TAG}.test`, otherBooth.id);
      expect(res.status).toBe(404);
      expect((await boothRow(otherBooth.id)).status).toBe('AVAILABLE');
      expect(await prisma.application.count({ where: { organizationId: org.id } })).toBe(0);
    });

    it('lets the same applicant re-pick after abandoning their own draft', async () => {
      const first = await submit(`repick@${TAG}.test`, booths[0].id);
      expect(first.status).toBe(201);

      // Same contact, same form, different booth: the abandoned DRAFT is
      // withdrawn and must hand its booth back before the new hold is taken —
      // otherwise the applicant is blocked by themselves.
      const second = await submit(`repick@${TAG}.test`, booths[2].id);
      expect(second.status).toBe(201);
      expect(second.body.applicationId).not.toBe(first.body.applicationId);

      expect((await boothRow(booths[0].id)).status).toBe('AVAILABLE');
      const kept = await boothRow(booths[2].id);
      expect(kept.status).toBe('HELD');
      expect(kept.holdApplicationId).toBe(second.body.applicationId);
    });
  });

  // ─── The hold across the review ─────────────────────────────────────────

  describe('the hold through review', () => {
    /** A booth-first application with its card saved, waiting on the organizer. */
    async function submitted(email, boothId) {
      const res = await submit(email, boothId);
      expect(res.status).toBe(201);
      const row = await cardOnFile(res.body.applicationId);
      expect(row.status).toBe('SUBMITTED');
      return row;
    }

    it('moves the hold from the checkout clock to the review clock when the card lands', async () => {
      const res = await submit(`clock@${TAG}.test`, booths[0].id);
      const whileDraft = await boothRow(booths[0].id);
      await cardOnFile(res.body.applicationId);
      const underReview = await boothRow(booths[0].id);

      expect(underReview.holdKind).toBe('APPLICATION');
      // A DRAFT sits on the 15-minute checkout clock so an abandoned Stripe
      // session cannot park a booth for a month; review is the longer clock.
      expect(underReview.holdExpiresAt.getTime()).toBeGreaterThan(whileDraft.holdExpiresAt.getTime());
    });

    it('releases the booth when the application is rejected', async () => {
      const application = await submitted(`rejected@${TAG}.test`, booths[0].id);
      expect((await decide(application.id, 'REJECT')).status).toBe(200);

      // Every trace of the claim, not just the status: a booth left carrying a
      // rejected application's id or a stale deadline is one the next vendor
      // cannot take and the sweep will "reclaim" from nobody.
      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('AVAILABLE');
      expect(booth.applicationId).toBeNull();
      expect(booth.holdApplicationId).toBeNull();
      expect(booth.holdKind).toBeNull();
      expect(booth.holdExpiresAt).toBeNull();
      expect((await appRow(application.id)).boothLabel).toBeNull();
    });

    it('releases the booth when the applicant withdraws themselves', async () => {
      // The self-service mirror of reject: nothing in the organizer's inbox
      // triggers this, so the booth has to come back on the withdrawal itself.
      const application = await submitted(`selfwithdrew@${TAG}.test`, booths[0].id);
      const res = await withdrawAsApplicant(application.id);
      expect(res.status).toBe(200);

      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('AVAILABLE');
      expect(booth.applicationId).toBeNull();
      expect(booth.holdApplicationId).toBeNull();
      expect(booth.holdKind).toBeNull();
      expect(booth.holdExpiresAt).toBeNull();

      const row = await appRow(application.id);
      expect(row.status).toBe('WITHDRAWN');
      expect(row.withdrawnBy).toBe('APPLICANT');
      expect(row.boothLabel).toBeNull();
    });

    it('frees a self-withdrawn booth for the next vendor immediately', async () => {
      // The leak this closes is only real if somebody else can take the booth
      // back without waiting for `sweepExpiredHolds` to reach the review date.
      const application = await submitted(`abandoner@${TAG}.test`, booths[0].id);
      expect((await withdrawAsApplicant(application.id)).status).toBe(200);

      const next = await submit(`nextinline@${TAG}.test`, booths[0].id);
      expect(next.status).toBe(201);
      expect((await boothRow(booths[0].id)).holdApplicationId).toBe(next.body.applicationId);
    });

    it('releases the booth when the application is waitlisted', async () => {
      // A waitlisted vendor sitting on a specific booth is inventory the
      // organizer cannot sell to anyone they did approve.
      const application = await submitted(`waitlisted@${TAG}.test`, booths[0].id);
      expect((await decide(application.id, 'WAITLIST')).status).toBe(200);
      expect((await boothRow(booths[0].id)).status).toBe('AVAILABLE');
      expect((await appRow(application.id)).boothLabel).toBeNull();
    });

    it('releases the booth when the organizer withdraws the application', async () => {
      const application = await submitted(`withdrawn@${TAG}.test`, booths[0].id);
      expect((await decide(application.id, 'WITHDRAW')).status).toBe(200);
      expect((await boothRow(booths[0].id)).status).toBe('AVAILABLE');
    });

    it('sells the booth on approval, charging the card already on file', async () => {
      const application = await submitted(`approved@${TAG}.test`, booths[0].id);
      expect((await decide(application.id, 'APPROVE')).status).toBe(200);

      // Approval is the charge: the vendor already holds the booth, so there is
      // nothing left for them to choose.
      expect(mockIntentsCreate).toHaveBeenCalledTimes(1);
      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('SOLD');
      expect(booth.applicationId).toBe(application.id);
      expect(booth.holdKind).toBeNull();

      const row = await appRow(application.id);
      expect(row.paymentStatus).toBe('PAID');
      expect(row.boothLabel).toBe('A1');
    });

    it('keeps the booth when the approval charge is declined', async () => {
      const application = await submitted(`declined@${TAG}.test`, booths[0].id);
      mockIntentsCreate.mockRejectedValueOnce(cardDecline());
      expect((await decide(application.id, 'APPROVE')).status).toBe(200);

      const row = await appRow(application.id);
      expect(row.status).toBe('APPROVED');
      expect(row.paymentStatus).toBe('PAYMENT_DUE');

      // The old behaviour released the hold here, which would hand a booth the
      // vendor applied for and was approved for to the next person to click.
      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('HELD');
      expect(booth.holdKind).toBe('APPLICATION');
      expect(booth.holdApplicationId).toBe(application.id);
      // …but not forever: it now runs on the payment-due clock.
      expect(booth.holdExpiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      expect(row.order.dueAt).toBeTruthy();
    });

    it('reclaims an abandoned hold once its deadline passes, label and all', async () => {
      const application = await submitted(`abandoned@${TAG}.test`, booths[0].id);
      await prisma.booth.update({
        where: { id: booths[0].id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });

      const result = await boothService.sweepExpiredHolds();
      expect(result.released).toBeGreaterThanOrEqual(1);

      const booth = await boothRow(booths[0].id);
      expect(booth.status).toBe('AVAILABLE');
      expect(booth.holdKind).toBeNull();
      // The application keeps running; it just no longer names a booth somebody
      // else can now buy.
      const row = await appRow(application.id);
      expect(row.status).toBe('SUBMITTED');
      expect(row.boothLabel).toBeNull();
    });

    it('protects the hold while a charge is still settling', async () => {
      const application = await submitted(`settling@${TAG}.test`, booths[0].id);
      await prisma.application.update({ where: { id: application.id }, data: { paymentStatus: 'PROCESSING' } });
      await prisma.booth.update({
        where: { id: booths[0].id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });

      const result = await boothService.sweepExpiredHolds();
      expect(result.protected).toBeGreaterThanOrEqual(1);
      expect((await boothRow(booths[0].id)).status).toBe('HELD');
    });
  });
});
