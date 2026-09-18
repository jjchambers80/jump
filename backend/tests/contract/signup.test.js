// Contract tests for the /signup onboarding flow (spec 022 phase 1)
// - UNASSIGNED users can start; the pending org is hidden from GET /organizations
// - survey answers are validated against config/onboarding.js
// - complete stamps the org, creates PlatformCustomer, promotes the owner
// - discard removes the pending org; non-members 404; pending cap 409
// - check-in scan/redeem are scoped to the caller's organization

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken, cleanupStaff, signToken } from '../helpers/staff.js';
import { ONBOARDING_SURVEY, MAX_PENDING_ORGANIZATIONS } from '../../src/config/onboarding.js';

const OWNER_EMAIL = 'owner@signup-test.com';
const OTHER_EMAIL = 'other@signup-test.com';
const SYS_EMAIL = 'sys@signup-test.com';
const SCAN_A_EMAIL = 'scan-a@signup-test.com';
const SCAN_B_EMAIL = 'scan-b@signup-test.com';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Signup onboarding (spec 022)', () => {
  let ownerToken;
  let ownerId;
  let otherToken;
  let sysToken;
  const created = [];

  beforeAll(async () => {
    ownerToken = await staffToken({ role: 'UNASSIGNED', email: OWNER_EMAIL, name: 'New Owner' });
    ownerId = (await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })).id;
    otherToken = await staffToken({ role: 'ADMIN', email: OTHER_EMAIL });
    sysToken = await staffToken({ role: 'SYSTEM_ADMIN', email: SYS_EMAIL });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { name: { startsWith: 'Signup Test' } } }).catch(() => {});
    await cleanupStaff([OWNER_EMAIL, OTHER_EMAIL, SYS_EMAIL, SCAN_A_EMAIL, SCAN_B_EMAIL]);
  });

  const start = async (token, name = 'Signup Test Org') => {
    const res = await request(app).post('/signup').set(auth(token)).send({ name, source: 'admin' });
    if (res.body?.id) created.push(res.body.id);
    return res;
  };

  describe('GET /signup/current', () => {
    it('returns null with no pending organization', async () => {
      const res = await request(app).get('/signup/current').set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.organization).toBeNull();
      expect(res.body.billingEnabled).toBe(false);
    });

    it('requires a session', async () => {
      const res = await request(app).get('/signup/current');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /signup', () => {
    let orgId;

    it('lets an UNASSIGNED user start and hides the org until complete', async () => {
      const res = await start(ownerToken);
      expect(res.status).toBe(201);
      expect(res.body.slug).toMatch(/^signup-test-org(-\d+)?$/);
      expect(res.body.step).toBe('survey');
      orgId = res.body.id;

      const member = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: ownerId, organizationId: orgId } },
      });
      expect(member?.role).toBe('ADMIN');

      // Still UNASSIGNED: the org list is ORGANIZER+ and the org itself is pending
      const list = await request(app).get('/organizations').set(auth(sysToken));
      expect(list.body.some((o) => o.id === orgId)).toBe(false);
      const withPending = await request(app).get('/organizations?includePending=1').set(auth(sysToken));
      expect(withPending.body.some((o) => o.id === orgId)).toBe(true);

      const current = await request(app).get('/signup/current').set(auth(ownerToken));
      expect(current.body.organization.id).toBe(orgId);
      expect(current.body.organization.step).toBe('survey');
    });

    it('rejects a missing name', async () => {
      const res = await request(app).post('/signup').set(auth(ownerToken)).send({ name: '   ' });
      expect(res.status).toBe(400);
    });

    it('validates survey answers against the allowlist and merges partial patches', async () => {
      const bad = await request(app)
        .patch(`/signup/${orgId}/survey`)
        .set(auth(ownerToken))
        .send({ goals: ['sell_online', 'sell_everything'] });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/unknown option/);

      const badSingle = await request(app)
        .patch(`/signup/${orgId}/survey`)
        .set(auth(ownerToken))
        .send({ eventsPerYear: 'lots' });
      expect(badSingle.status).toBe(400);

      const unknownKey = await request(app)
        .patch(`/signup/${orgId}/survey`)
        .set(auth(ownerToken))
        .send({ revenue: 'big' });
      expect(unknownKey.status).toBe(400);
      expect(unknownKey.body.message).toMatch(/Unknown field: revenue/);

      const one = await request(app)
        .patch(`/signup/${orgId}/survey`)
        .set(auth(ownerToken))
        .send({ goals: ['sell_online', 'vendor_applications', 'sell_online'] });
      expect(one.status).toBe(200);
      expect(one.body.onboarding.goals).toEqual(['sell_online', 'vendor_applications']);

      const two = await request(app)
        .patch(`/signup/${orgId}/survey`)
        .set(auth(ownerToken))
        .send({ eventsPerYear: 'two_to_five', attendance: '500_2000' });
      expect(two.status).toBe(200);
      expect(two.body.onboarding).toMatchObject({
        version: 1,
        source: 'admin',
        goals: ['sell_online', 'vendor_applications'],
        eventsPerYear: 'two_to_five',
        attendance: '500_2000',
      });
    });

    it('refuses another user (even an ADMIN) and non-pending ids', async () => {
      const res = await request(app).patch(`/signup/${orgId}/survey`).set(auth(otherToken)).send({ goals: [] });
      expect(res.status).toBe(404);
      const missing = await request(app).post(`/signup/nope/complete`).set(auth(ownerToken));
      expect(missing.status).toBe(404);
    });

    it('returns 409 for the subscribe step while billing is off', async () => {
      const res = await request(app).post(`/signup/${orgId}/subscribe`).set(auth(ownerToken));
      expect(res.status).toBe(409);
    });

    it('completes: stamps the org, creates PlatformCustomer, promotes the owner, idempotent', async () => {
      const res = await request(app).post(`/signup/${orgId}/complete`).set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(orgId);
      expect(res.body._count).toEqual({ venues: 0, users: 1 });

      const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { platformCustomer: true } });
      expect(org.onboardingCompletedAt).not.toBeNull();
      expect(org.platformCustomer.ownerUserId).toBe(ownerId);
      expect(org.platformCustomer.plan).toBe('FREE');
      expect(org.platformCustomer.onboarding.surveyCompletedAt).toBeDefined();

      const user = await prisma.user.findUnique({ where: { id: ownerId } });
      expect(user.role).toBe('ADMIN');

      // Now visible in the switcher for the owner (with the promoted role)
      const promotedToken = signToken({ ...user });
      const list = await request(app).get('/organizations').set(auth(promotedToken));
      expect(list.status).toBe(200);
      expect(list.body.map((o) => o.id)).toEqual([orgId]);

      const again = await request(app).post(`/signup/${orgId}/complete`).set(auth(promotedToken));
      expect(again.status).toBe(200);

      // Completed orgs are no longer pending: the signup routes 404 on them
      const survey = await request(app).patch(`/signup/${orgId}/survey`).set(auth(promotedToken)).send({ goals: [] });
      expect(survey.status).toBe(404);
      const current = await request(app).get('/signup/current').set(auth(promotedToken));
      expect(current.body.organization).toBeNull();
    });

    it('does not downgrade an existing global role on completion', async () => {
      const res = await start(otherToken, 'Signup Test Other');
      const done = await request(app).post(`/signup/${res.body.id}/complete`).set(auth(otherToken));
      expect(done.status).toBe(200);
      const user = await prisma.user.findUnique({ where: { email: OTHER_EMAIL } });
      expect(user.role).toBe('ADMIN');
    });

    it('skip survey records the decision and complete keeps it', async () => {
      const res = await start(ownerToken, 'Signup Test Skip');
      const skipped = await request(app).post(`/signup/${res.body.id}/survey/skip`).set(auth(ownerToken));
      expect(skipped.status).toBe(200);
      expect(skipped.body.step).toBe('done');
      await request(app).post(`/signup/${res.body.id}/complete`).set(auth(ownerToken));
      const pc = await prisma.platformCustomer.findUnique({ where: { organizationId: res.body.id } });
      expect(pc.onboarding.surveySkippedAt).toBeDefined();
      expect(pc.onboarding.surveyCompletedAt).toBeUndefined();
    });

    it('discards a pending organization (membership and customer row cascade)', async () => {
      const res = await start(ownerToken, 'Signup Test Discard');
      const del = await request(app).delete(`/signup/${res.body.id}`).set(auth(ownerToken));
      expect(del.status).toBe(204);
      expect(await prisma.organization.findUnique({ where: { id: res.body.id } })).toBeNull();
      expect(await prisma.platformCustomer.findUnique({ where: { organizationId: res.body.id } })).toBeNull();
      const again = await request(app).delete(`/signup/${res.body.id}`).set(auth(ownerToken));
      expect(again.status).toBe(404);
    });

    it('caps unfinished organizations per user', async () => {
      const ids = [];
      for (let i = 0; i < MAX_PENDING_ORGANIZATIONS; i += 1) {
        const res = await start(ownerToken, `Signup Test Cap ${i}`);
        expect(res.status).toBe(201);
        ids.push(res.body.id);
      }
      const over = await start(ownerToken, 'Signup Test Cap Over');
      expect(over.status).toBe(409);
      for (const id of ids) await request(app).delete(`/signup/${id}`).set(auth(ownerToken));
    });

    it('lets SYSTEM_ADMIN act on any pending organization', async () => {
      const res = await start(ownerToken, 'Signup Test Sys');
      const skipped = await request(app).post(`/signup/${res.body.id}/survey/skip`).set(auth(sysToken));
      expect(skipped.status).toBe(200);
      const del = await request(app).delete(`/signup/${res.body.id}`).set(auth(sysToken));
      expect(del.status).toBe(204);
    });
  });

  describe('POST /organizations (legacy create)', () => {
    it('adds the creating ADMIN as a member so the org shows in their switcher', async () => {
      const res = await request(app).post('/organizations').set(auth(otherToken)).send({ name: 'Signup Test Legacy' });
      expect(res.status).toBe(201);
      created.push(res.body.id);
      const list = await request(app).get('/organizations').set(auth(otherToken));
      expect(list.body.some((o) => o.id === res.body.id)).toBe(true);
      const org = await prisma.organization.findUnique({ where: { id: res.body.id } });
      expect(org.onboardingCompletedAt).not.toBeNull();
    });
  });

  describe('survey option ids are the frontend mirror', () => {
    it('keeps config/onboarding.js and lib/onboarding.ts in step', async () => {
      const { readFileSync } = await import('fs');
      const { fileURLToPath } = await import('url');
      const path = await import('path');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(path.join(here, '../../../frontend/src/lib/onboarding.ts'), 'utf8');
      for (const [key, ids] of Object.entries(ONBOARDING_SURVEY)) {
        for (const id of ids) {
          expect(src).toContain(`id: '${id}'`);
        }
        expect(src).toContain(`key: '${key}'`);
      }
    });
  });

  describe('check-in scan scope', () => {
    let tokenA;
    let tokenB;
    let barcode;
    let ticketId;
    let eventId;
    let orgA;
    let orgB;

    beforeAll(async () => {
      tokenA = await staffToken({ role: 'ORGANIZER', email: SCAN_A_EMAIL });
      tokenB = await staffToken({ role: 'ORGANIZER', email: SCAN_B_EMAIL });
      orgA = await prisma.organization.create({ data: { name: 'Signup Test Scan A' } });
      orgB = await prisma.organization.create({ data: { name: 'Signup Test Scan B' } });
      created.push(orgA.id, orgB.id);
      await joinOrgByToken(tokenA, orgA.id, 'ORGANIZER');
      await joinOrgByToken(tokenB, orgB.id, 'ORGANIZER');

      const venue = await prisma.venue.create({ data: { name: 'Scan Venue', address: '1 St', timezone: 'America/New_York', organizationId: orgA.id } });
      const event = await prisma.event.create({ data: { name: 'Scan Event', date: new Date('2027-01-01T20:00:00Z'), capacity: 10, status: 'PUBLISHED', venueId: venue.id } });
      const tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 10, displayOrder: 1 } });
      const contact = await prisma.contact.create({ data: { organizationId: orgA.id, email: 'buyer@signup-test.com', firstName: 'Buy', lastName: 'Er' } });
      const order = await prisma.order.create({
        data: { orderRef: `SIGNUP-${Date.now()}`, eventId: event.id, contactId: contact.id, quantity: 1, totalAmount: 10, status: 'COMPLETED' },
      });
      barcode = `JUMP-SIGNUP${Date.now().toString().slice(-6)}`;
      const ticket = await prisma.ticket.create({
        data: { barcode, orderId: order.id, eventId: event.id, priceTierId: tier.id, contactId: contact.id, status: 'VALID', ticketNumber: 1, pricePaid: 10 },
      });
      ticketId = ticket.id;
      eventId = event.id;
    });

    it('staff of another organization cannot preview or redeem the ticket', async () => {
      const payload = `jump://ticket?id=${ticketId}&b=${barcode}&e=${eventId}`;
      const otherScan = await request(app).post('/tickets/scan').set(auth(tokenB)).send({ payload });
      expect(otherScan.status).toBe(400);
      expect(otherScan.body.status).toBe('INVALID');

      const otherRedeem = await request(app).post('/tickets/redeem').set(auth(tokenB)).send({ barcode });
      expect(otherRedeem.status).toBe(400);

      const ownScan = await request(app).post('/tickets/scan').set(auth(tokenA)).send({ payload });
      expect(ownScan.status).toBe(200);
      expect(ownScan.body.barcode).toBe(barcode);

      const ownRedeem = await request(app).post('/tickets/redeem').set(auth(tokenA)).send({ barcode });
      expect(ownRedeem.status).toBe(200);
      expect(ownRedeem.body.status).toBe('REDEEMED');
    });
  });
});
