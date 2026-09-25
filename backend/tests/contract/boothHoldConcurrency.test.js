// Contract tests for the booth hold invariant (spec 014 phase 2 hardening).
//
// boothPurchases.test.js covers the happy path and the API shape. This suite
// only asks one question, four ways: **can two vendors ever end up with the
// same booth, or one vendor with two?**
//
//  - separate OS processes racing the same booth
//  - the database constraints, exercised directly with raw SQL so they are
//    proven to hold even when the service's lock order is bypassed
//  - double-submit and back-button resubmission
//  - hold expiry and reclaim, including the payment-in-flight protection
//
// plus multi-tenant scoping, because a booth reachable across events is the
// same defect wearing a different hat.
//
// Real Postgres, no Stripe: every path here stops at HELD.

import { jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn().mockResolvedValue({}) } },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const { default: boothService } = await import('../../src/services/BoothService.js');

const TAG = `booth-race-${Date.now()}`;
const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../helpers/boothRaceWorker.js');

/**
 * Run a write that must be refused by a database constraint and return the
 * Postgres SQLSTATE, wherever Prisma happened to put it. Resolving is a
 * failure: the point of each of these is that the write does not land.
 */
async function rejectedCode(promise) {
  try {
    await promise;
  } catch (error) {
    return String(error?.meta?.code ?? error?.code ?? '');
  }
  throw new Error('expected the database to refuse this write, but it succeeded');
}

/**
 * Run one contender in its own OS process. Resolves with the worker's verdict;
 * a loss is a normal result, so only a crash or silence rejects.
 */
function raceInSeparateProcess({ applicationId, boothId, startAt }) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], {
      silent: true,
      env: {
        ...process.env,
        RACE_APPLICATION_ID: applicationId,
        RACE_BOOTH_ID: boothId,
        RACE_START_AT: String(startAt),
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      const line = out.trim().split('\n').filter(Boolean).pop();
      if (!line) return reject(new Error(`contender ${applicationId} printed nothing (exit ${code}): ${err}`));
      try {
        resolve(JSON.parse(line));
      } catch (parseError) {
        reject(new Error(`contender ${applicationId} printed non-JSON: ${line}`));
      }
    });
  });
}

describe('Booth holds under concurrency', () => {
  let organization;
  let event;
  let form;
  let tier;
  let map;
  let booths;
  let applications;

  // A second organizer running their own event, used for the scoping tests.
  let otherOrg;
  let otherEvent;
  let otherApplication;
  let otherBooth;

  /** Put every fixture booth back in the pool between tests. */
  async function resetBooths() {
    await prisma.booth.updateMany({
      where: { mapId: map.id },
      data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdExpiresAt: null, assignedById: null },
    });
  }

  async function seedEvent(prefix, org) {
    const venue = await prisma.venue.create({
      data: { organizationId: org.id, name: `${prefix} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' },
    });
    const seededEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `${prefix} Expo`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 100 },
    });
    const seededForm = await prisma.applicationForm.create({
      data: { eventId: seededEvent.id, kind: 'PAID', name: 'Vendors', slug: `${prefix}-vendors`, chargeTiming: 'APPROVAL', feeMode: 'ABSORB' },
    });
    const seededTier = await prisma.applicationTier.create({
      data: { formId: seededForm.id, name: '10x10', price: 275, quantityTotal: 20, quantityReserved: 20, mapBound: true },
    });
    const seededMap = await prisma.floorMap.create({
      data: {
        organizationId: org.id,
        eventId: seededEvent.id,
        name: 'Vendor Hall',
        status: 'PUBLISHED',
        width: 100,
        height: 40,
        layout: { version: 1, elements: [] },
        publishedAt: new Date(),
      },
    });
    return { venue, event: seededEvent, form: seededForm, tier: seededTier, map: seededMap };
  }

  /** An APPROVED, payment-due applicant on `seededTier` — ready to choose a booth. */
  async function seedApplicant(prefix, org, seededEvent, seededForm, seededTier, index) {
    const contact = await prisma.contact.create({
      data: { organizationId: org.id, email: `vendor-${index}@${prefix}.test`, firstName: 'Vendor', lastName: String(index) },
    });
    const profile = await prisma.applicantProfile.create({
      data: { organizationId: org.id, contactId: contact.id, businessName: `${prefix} Vendor ${index}` },
    });
    return prisma.application.create({
      data: {
        eventId: seededEvent.id,
        organizationId: org.id,
        formId: seededForm.id,
        tierId: seededTier.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'APPROVED',
        paymentStatus: 'PAYMENT_DUE',
        capacitySlot: 'RESERVED',
        submittedAt: new Date(),
        statusTokenHash: `${prefix}-hash-${index}`,
        order: {
          create: {
            kind: 'APPLICATION',
            eventId: seededEvent.id,
            contactId: contact.id,
            orderRef: `JMP-${prefix.slice(-6).toUpperCase()}${index}`,
            totalAmount: 275,
            subtotalAmount: 275,
            orgReceives: 275,
            feeMode: 'ABSORB',
            quantity: 1,
            status: 'PENDING',
            items: { create: { kind: 'APPLICATION_TIER', applicationTierId: seededTier.id, description: '10x10', quantity: 1, unitPrice: 275 } },
          },
        },
      },
    });
  }

  beforeAll(async () => {
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    ({ event, form, tier, map } = await seedEvent(TAG, organization));

    booths = [];
    for (const [index, label] of ['A1', 'A2', 'A3', 'A4'].entries()) {
      booths.push(await prisma.booth.create({
        data: { mapId: map.id, label, x: index * 10, y: 0, w: 8, h: 8, tierId: tier.id },
      }));
    }

    applications = [];
    for (let i = 0; i < 6; i += 1) {
      applications.push(await seedApplicant(TAG, organization, event, form, tier, i));
    }

    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    const other = await seedEvent(`${TAG}-other`, otherOrg);
    otherEvent = other.event;
    otherBooth = await prisma.booth.create({
      data: { mapId: other.map.id, label: 'Z9', x: 0, y: 0, w: 8, h: 8, tierId: other.tier.id },
    });
    otherApplication = await seedApplicant(`${TAG}-other`, otherOrg, other.event, other.form, other.tier, 0);
  });

  afterAll(async () => {
    for (const org of [organization, otherOrg]) {
      await prisma.booth.deleteMany({ where: { map: { organizationId: org.id } } });
      await prisma.floorMap.deleteMany({ where: { organizationId: org.id } });
      await prisma.order.deleteMany({ where: { application: { organizationId: org.id } } });
      await prisma.application.deleteMany({ where: { organizationId: org.id } });
      await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } });
      await prisma.contact.deleteMany({ where: { organizationId: org.id } });
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: org.id } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } });
      await prisma.venue.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
  });

  beforeEach(resetBooths);

  // ─── The database is the backstop ────────────────────────────────────────
  // These bypass BoothService entirely. If they ever start passing silently,
  // the constraints have been dropped and only the lock order is left.

  describe('Postgres refuses a double-booking even when the service is bypassed', () => {
    it('refuses to hold a second booth for an application that already holds one', async () => {
      await boothService.chooseBooth(applications[0].id, booths[0].id);

      // Exactly the write a caller that forgot to lock Application first would make.
      const code = await rejectedCode(prisma.$executeRawUnsafe(
        `UPDATE "Booth" SET "status" = 'HELD', "holdApplicationId" = $1, "holdExpiresAt" = now() + interval '15 minutes' WHERE "id" = $2`,
        applications[0].id,
        booths[1].id
      ));
      expect(code).toBe('23505'); // unique_violation on Booth_holdApplicationId_key

      const held = await prisma.booth.findMany({ where: { holdApplicationId: applications[0].id } });
      expect(held).toHaveLength(1);
      expect(held[0].id).toBe(booths[0].id);
    });

    it('refuses a HELD booth with no holder or no deadline', async () => {
      // HELD with no holder at all: the sweep could never reclaim it.
      expect(await rejectedCode(prisma.$executeRawUnsafe(
        `UPDATE "Booth" SET "status" = 'HELD' WHERE "id" = $1`,
        booths[0].id
      ))).toBe('23514');

      // A holder but no deadline: a hold that never expires leaks the booth.
      expect(await rejectedCode(prisma.$executeRawUnsafe(
        `UPDATE "Booth" SET "status" = 'HELD', "holdApplicationId" = $1 WHERE "id" = $2`,
        applications[0].id,
        booths[0].id
      ))).toBe('23514');

      // A holder parked on a booth that is not HELD — how the unique index
      // above would otherwise be sidestepped.
      expect(await rejectedCode(prisma.$executeRawUnsafe(
        `UPDATE "Booth" SET "holdApplicationId" = $1, "holdExpiresAt" = now() WHERE "id" = $2`,
        applications[0].id,
        booths[0].id
      ))).toBe('23514');

      const booth = await prisma.booth.findUnique({ where: { id: booths[0].id } });
      expect(booth).toMatchObject({ status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null });
    });
  });

  // ─── The race ────────────────────────────────────────────────────────────

  it('gives the booth to exactly one of six vendors racing from six separate processes', async () => {
    const contenders = applications.slice(0, 6);
    const startAt = Date.now() + 1500; // every worker boots, warms its pool, then fires together

    const results = await Promise.all(contenders.map((application) => raceInSeparateProcess({
      applicationId: application.id,
      boothId: booths[2].id,
      startAt,
    })));

    const winners = results.filter((result) => result.won);
    expect(winners).toHaveLength(1);
    expect(winners[0].status).toBe('HELD');

    // Every loser gets the actionable conflict, not a crash or a 500.
    for (const loser of results.filter((result) => !result.won)) {
      expect(loser.crashed).toBeUndefined();
      expect(loser.code).toBe('BOOTH_TAKEN');
    }

    // And the database agrees: one booth, one holder.
    const held = await prisma.booth.findMany({ where: { mapId: map.id, status: 'HELD' } });
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe(booths[2].id);
    expect(held[0].holdApplicationId).toBe(winners[0].applicationId);
  }, 60_000);

  it('gives one booth, not two, when a single vendor fires two choices at once', async () => {
    const startAt = Date.now() + 1500;

    // Double-submit at its worst: the same applicant, two different booths, at
    // the same instant, from two processes. The Application row lock is what
    // decides this one, with the unique index behind it.
    const results = await Promise.all([booths[0], booths[1]].map((booth) => raceInSeparateProcess({
      applicationId: applications[0].id,
      boothId: booth.id,
      startAt,
    })));

    expect(results.filter((result) => result.won)).toHaveLength(1);
    expect(results.find((result) => !result.won).code).toBe('ALREADY_HOLDING_BOOTH');

    const held = await prisma.booth.findMany({ where: { holdApplicationId: applications[0].id } });
    expect(held).toHaveLength(1);
  }, 60_000);

  // ─── Double-submit and the back button ───────────────────────────────────

  it('treats a double-submitted request as a conflict, not a second booth', async () => {
    const application = applications[1];
    const choose = () => request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[0].id });

    expect((await choose()).status).toBe(200);

    const replay = await choose();
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('ALREADY_HOLDING_BOOTH');

    const held = await prisma.booth.findMany({ where: { holdApplicationId: application.id } });
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe(booths[0].id);
  });

  it('keeps the original booth when the vendor goes back and picks another', async () => {
    const application = applications[2];
    const first = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[0].id });
    expect(first.status).toBe(200);

    // Back button, then a different booth: the vendor must release the first
    // one deliberately, never silently accumulate a second.
    const second = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[1].id });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ALREADY_HOLDING_BOOTH');

    expect(await prisma.booth.findMany({ where: { holdApplicationId: application.id } })).toHaveLength(1);
    expect(await prisma.booth.findUnique({ where: { id: booths[1].id } })).toMatchObject({ status: 'AVAILABLE' });
  });

  // ─── Expiry and reclaim ──────────────────────────────────────────────────

  it('returns an abandoned booth to the pool and lets the next vendor take it', async () => {
    const abandoner = applications[3];
    const nextVendor = applications[4];

    await boothService.chooseBooth(abandoner.id, booths[0].id);

    // The vendor walks away. Wind the deadline back rather than waiting 15 min.
    await prisma.booth.update({
      where: { id: booths[0].id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    // Before the sweep the booth is still theirs — an expired hold is not a
    // free booth until something reclaims it.
    await expect(boothService.chooseBooth(nextVendor.id, booths[0].id)).rejects.toMatchObject({ code: 'BOOTH_TAKEN' });

    expect(await boothService.sweepExpiredHolds()).toMatchObject({ released: expect.any(Number) });

    const reclaimed = await prisma.booth.findUnique({ where: { id: booths[0].id } });
    expect(reclaimed).toMatchObject({ status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null });

    const hold = await boothService.chooseBooth(nextVendor.id, booths[0].id);
    expect(hold).toMatchObject({ boothId: booths[0].id, status: 'HELD' });

    // The vendor who walked away can no longer pay for it.
    await expect(boothService.beginPayment(abandoner.id)).rejects.toMatchObject({ code: 'BOOTH_HOLD_MISSING' });
  });

  it('never reclaims a booth while its payment may still settle', async () => {
    const application = applications[5];
    await boothService.chooseBooth(application.id, booths[0].id);
    await prisma.booth.update({
      where: { id: booths[0].id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    for (const paymentStatus of ['PROCESSING', 'PAID']) {
      await prisma.application.update({ where: { id: application.id }, data: { paymentStatus } });

      const outcome = await boothService.sweepExpiredHolds();
      expect(outcome.protected).toBeGreaterThanOrEqual(1);

      expect(await prisma.booth.findUnique({ where: { id: booths[0].id } })).toMatchObject({
        status: 'HELD',
        holdApplicationId: application.id,
      });
    }

    await prisma.application.update({ where: { id: application.id }, data: { paymentStatus: 'PAYMENT_DUE' } });
  });

  // ─── Multi-tenant scoping ────────────────────────────────────────────────

  describe('scoping', () => {
    it('refuses a booth that belongs to another organizer', async () => {
      // A real booth id, a real approved application — they just belong to two
      // different organizers. This must read as "no such booth", not as a tier
      // mismatch, and it must never hold anything.
      await expect(boothService.chooseBooth(otherApplication.id, booths[0].id))
        .rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(boothService.chooseBooth(applications[0].id, otherBooth.id))
        .rejects.toMatchObject({ name: 'NotFoundError' });

      expect(await prisma.booth.findMany({ where: { status: { not: 'AVAILABLE' } }, select: { id: true } }))
        .toEqual(expect.not.arrayContaining([{ id: otherBooth.id }, { id: booths[0].id }]));
    });

    it('refuses a booth on another event run by the same organizer', async () => {
      const sibling = await seedEvent(`${TAG}-sibling`, organization);
      const siblingBooth = await prisma.booth.create({
        data: { mapId: sibling.map.id, label: 'S1', x: 0, y: 0, w: 8, h: 8, tierId: sibling.tier.id },
      });

      await expect(boothService.chooseBooth(applications[0].id, siblingBooth.id))
        .rejects.toMatchObject({ name: 'NotFoundError' });

      expect(await prisma.booth.findUnique({ where: { id: siblingBooth.id } })).toMatchObject({ status: 'AVAILABLE' });
    });

    it('never shows another event\'s booths or vendors on the public map', async () => {
      const response = await request(app).get(`/events/${event.id}/map`);

      expect(response.status).toBe(200);
      const ids = response.body.booths.map((booth) => booth.id);
      expect(ids).toEqual(expect.arrayContaining(booths.map((booth) => booth.id)));
      expect(ids).not.toContain(otherBooth.id);
      expect(response.body.vendors.map((vendor) => vendor.id)).not.toContain(otherApplication.id);

      // Open vs. taken is public; who is holding what is not.
      for (const booth of response.body.booths) {
        expect(booth.status).toEqual(expect.stringMatching(/^(AVAILABLE|HELD|SOLD|RESERVED|BLOCKED)$/));
        expect(booth).not.toHaveProperty('applicationId');
        expect(booth).not.toHaveProperty('holdApplicationId');
      }
    });

    it('shows a held booth as taken to the next visitor', async () => {
      const before = await request(app).get(`/events/${event.id}/map`);
      expect(before.body.booths.find((booth) => booth.id === booths[0].id).status).toBe('AVAILABLE');

      await boothService.chooseBooth(applications[0].id, booths[0].id);

      const after = await request(app).get(`/events/${event.id}/map`);
      expect(after.body.booths.find((booth) => booth.id === booths[0].id).status).toBe('HELD');
      // A hold is not a sale: the holder's name stays private until they pay.
      expect(after.body.booths.find((booth) => booth.id === booths[0].id).vendorName).toBeNull();
    });
  });
});
