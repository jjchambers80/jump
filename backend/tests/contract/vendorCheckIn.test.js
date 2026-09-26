// Contract tests for vendor door check-in (spec 036)
//
// The door is the one surface where a retry is the normal case, not the edge
// case: staff on venue wifi double-tap, the request times out and the phone
// sends it again, and two people work the same line. These tests pin the
// behaviour that keeps that safe — one arrival stamp per vendor, no matter how
// many times or how concurrently it is asked for — plus tenant isolation and
// the scan credential.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { statusToken, hashToken } = await import('../../src/services/applicationLinks.js');
const { default: qrService } = await import('../../src/services/QRService.js');

const TAG = 'door-ct';

describe('Vendor door check-in (spec 036)', () => {
  let organizerToken;
  let otherOrgToken;
  let org;
  let orgB;
  let expo;
  let sideShow;
  let eventB;
  let form;
  let formSide;
  let formB;
  const apps = {};
  const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  let seq = 0;

  async function vendor(organizationId, eventId, formId, { businessName, status = 'APPROVED' }) {
    seq += 1;
    const contact = await prisma.contact.create({
      data: { organizationId, email: `v${seq}@${TAG}.test`, firstName: 'Val', lastName: `Vendor${seq}` },
    });
    const profile = await prisma.applicantProfile.create({ data: { organizationId, contactId: contact.id, businessName } });
    const created = await prisma.application.create({
      data: {
        formId,
        eventId,
        organizationId,
        contactId: contact.id,
        profileId: profile.id,
        status,
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: new Date(Date.UTC(2026, 8, 1 + seq)),
        statusTokenHash: `pending-${TAG}-${seq}`,
      },
    });
    // Mirror what submit() does: the stored hash is sha256 of the derived token.
    return prisma.application.update({
      where: { id: created.id },
      data: { statusTokenHash: hashToken(statusToken(created.id)) },
    });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherOrgToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Maker Collective`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Rival Fest` } });
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(otherOrgToken, orgB.id, 'ORGANIZER');

    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const venueB = await prisma.venue.create({ data: { organizationId: orgB.id, name: `${TAG} Armory`, address: '1 Main St', city: 'Durham', state: 'NC' } });
    expo = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Spring Expo`, date: new Date('2027-04-10T15:00:00Z'), status: 'PUBLISHED', capacity: 500 } });
    sideShow = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Side Show`, date: new Date('2027-06-10T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    eventB = await prisma.event.create({ data: { venueId: venueB.id, name: `${TAG} Rival Fest`, date: new Date('2027-05-01T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });

    form = await prisma.applicationForm.create({ data: { eventId: expo.id, kind: 'FREE', name: 'Vendors', slug: 'vendors' } });
    formSide = await prisma.applicationForm.create({ data: { eventId: sideShow.id, kind: 'FREE', name: 'Vendors', slug: 'vendors' } });
    formB = await prisma.applicationForm.create({ data: { eventId: eventB.id, kind: 'FREE', name: 'Vendors', slug: 'vendors' } });

    apps.clay = await vendor(org.id, expo.id, form.id, { businessName: 'Clay & Co' });
    apps.amps = await vendor(org.id, expo.id, form.id, { businessName: 'Amps Anonymous' });
    apps.waiting = await vendor(org.id, expo.id, form.id, { businessName: 'Waitlisted Wares', status: 'WAITLISTED' });
    apps.sideVendor = await vendor(org.id, sideShow.id, formSide.id, { businessName: 'Side Show Soaps' });
    apps.rival = await vendor(orgB.id, eventB.id, formB.id, { businessName: 'Rival Roasters' });
  });

  afterAll(async () => {
    for (const o of [org, orgB]) {
      await prisma.booth.deleteMany({ where: { map: { event: { venue: { organizationId: o.id } } } } }).catch(() => {});
      await prisma.floorMap.deleteMany({ where: { event: { venue: { organizationId: o.id } } } }).catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: o.id } } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: o.id } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
    }
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  /** Reset arrival state so each test starts from "nobody has arrived". */
  async function clearArrivals() {
    await prisma.application.updateMany({
      where: { organizationId: { in: [org.id, orgB.id] } },
      data: { checkedInAt: null, checkedInById: null, checkedInVia: null },
    });
  }
  beforeEach(clearArrivals);

  const roster = (token, eventId, query = '') => request(app).get(`/admin/events/${eventId}/check-in${query}`).set(...auth(token));
  const checkIn = (token, eventId, id, body = {}) => request(app).post(`/admin/events/${eventId}/check-in/${id}`).set(...auth(token)).send(body);
  const undo = (token, eventId, id) => request(app).delete(`/admin/events/${eventId}/check-in/${id}`).set(...auth(token));
  const scan = (token, eventId, payload) => request(app).post(`/admin/events/${eventId}/check-in/scan`).set(...auth(token)).send({ payload });

  describe('idempotency — the acceptance criterion', () => {
    it('a retried check-in keeps the first timestamp and reports alreadyCheckedIn', async () => {
      const first = await checkIn(organizerToken, expo.id, apps.clay.id, { via: 'SCAN' });
      expect(first.status).toBe(200);
      expect(first.body.alreadyCheckedIn).toBe(false);
      expect(first.body.vendor.checkedInAt).toBeTruthy();

      const retry = await checkIn(organizerToken, expo.id, apps.clay.id, { via: 'SCAN' });
      expect(retry.status).toBe(200);
      // The retry is not an error — it is the same answer, so the door page can
      // show "arrived 10:04" instead of leaving staff unsure.
      expect(retry.body.alreadyCheckedIn).toBe(true);
      expect(retry.body.vendor.checkedInAt).toBe(first.body.vendor.checkedInAt);

      const row = await prisma.application.findUnique({ where: { id: apps.clay.id }, select: { checkedInAt: true, checkedInVia: true } });
      expect(row.checkedInAt.toISOString()).toBe(first.body.vendor.checkedInAt);
      expect(row.checkedInVia).toBe('SCAN');
    });

    it('six concurrent check-ins on the same vendor produce exactly one stamp', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => checkIn(organizerToken, expo.id, apps.amps.id)));
      expect(results.every((r) => r.status === 200)).toBe(true);

      // Exactly one request did the writing; the rest read the winner back.
      expect(results.filter((r) => r.body.alreadyCheckedIn === false)).toHaveLength(1);
      const stamps = new Set(results.map((r) => r.body.vendor.checkedInAt));
      expect(stamps.size).toBe(1);

      const row = await prisma.application.findUnique({ where: { id: apps.amps.id }, select: { checkedInAt: true } });
      expect(row.checkedInAt.toISOString()).toBe([...stamps][0]);
    });

    it('the submissions-table toggle and a door check-in converge on one stamp', async () => {
      const door = await checkIn(organizerToken, expo.id, apps.clay.id);
      const toggle = await request(app)
        .patch(`/admin/events/${expo.id}/applications/${apps.clay.id}`)
        .set(...auth(organizerToken))
        .send({ checkedIn: true });
      expect(toggle.status).toBe(200);
      // Spec 019's checkbox writes through the same conditional update, so it
      // cannot silently move an arrival time the door already recorded.
      expect(toggle.body.checkedInAt).toBe(door.body.vendor.checkedInAt);
    });

    it('undo is idempotent and re-checking in starts a fresh stamp', async () => {
      await checkIn(organizerToken, expo.id, apps.clay.id);
      const firstUndo = await undo(organizerToken, expo.id, apps.clay.id);
      expect(firstUndo.status).toBe(200);
      expect(firstUndo.body.vendor.checkedInAt).toBeNull();

      const secondUndo = await undo(organizerToken, expo.id, apps.clay.id);
      expect(secondUndo.status).toBe(200);
      expect(secondUndo.body.vendor.checkedInAt).toBeNull();

      const again = await checkIn(organizerToken, expo.id, apps.clay.id);
      expect(again.body.alreadyCheckedIn).toBe(false);
      expect(again.body.vendor.checkedInAt).toBeTruthy();
    });
  });

  describe('arrivals view matches the records', () => {
    it('counts and rows track the underlying column, unarrived first', async () => {
      const before = await roster(organizerToken, expo.id);
      expect(before.status).toBe(200);
      expect(before.body.counts).toEqual({ expected: 2, arrived: 0, awaiting: 2 });
      // WAITLISTED vendors are not expected at the door.
      expect(before.body.data.map((v) => v.businessName).sort()).toEqual(['Amps Anonymous', 'Clay & Co']);

      await checkIn(organizerToken, expo.id, apps.clay.id);

      const after = await roster(organizerToken, expo.id);
      expect(after.body.counts).toEqual({ expected: 2, arrived: 1, awaiting: 1 });
      expect(after.body.data[0].businessName).toBe('Amps Anonymous');
      expect(after.body.data[0].checkedInAt).toBeNull();
      expect(after.body.data[1].businessName).toBe('Clay & Co');

      const stamped = await prisma.application.findUnique({ where: { id: apps.clay.id }, select: { checkedInAt: true } });
      expect(after.body.data[1].checkedInAt).toBe(stamped.checkedInAt.toISOString());
    });

    it('searching narrows the rows but leaves the counts describing the whole event', async () => {
      await checkIn(organizerToken, expo.id, apps.clay.id);
      const res = await roster(organizerToken, expo.id, '?q=amps');
      expect(res.body.data.map((v) => v.businessName)).toEqual(['Amps Anonymous']);
      expect(res.body.counts).toEqual({ expected: 2, arrived: 1, awaiting: 1 });
    });

    it('carries the booth assignment from the floor map', async () => {
      const map = await prisma.floorMap.create({
        data: { organizationId: org.id, eventId: expo.id, name: `${TAG} Main Floor`, width: 40, height: 30, layout: { version: 1, elements: [] } },
      });
      await prisma.booth.create({ data: { mapId: map.id, label: 'B12', x: 1, y: 1, w: 2, h: 2, status: 'SOLD', applicationId: apps.clay.id } });
      try {
        const res = await roster(organizerToken, expo.id);
        const clay = res.body.data.find((v) => v.businessName === 'Clay & Co');
        expect(clay.booth).toMatchObject({ label: 'B12', status: 'SOLD' });
        expect(clay.boothLabel).toBe('B12');
      } finally {
        await prisma.booth.deleteMany({ where: { mapId: map.id } });
        await prisma.floorMap.delete({ where: { id: map.id } });
      }
    });
  });

  describe('multi-tenant and per-event scoping', () => {
    it("another organization's staff cannot read or stamp this event's vendors", async () => {
      expect((await roster(otherOrgToken, expo.id)).status).toBe(404);
      expect((await checkIn(otherOrgToken, expo.id, apps.clay.id)).status).toBe(404);
      expect((await undo(otherOrgToken, expo.id, apps.clay.id)).status).toBe(404);

      const row = await prisma.application.findUnique({ where: { id: apps.clay.id }, select: { checkedInAt: true } });
      expect(row.checkedInAt).toBeNull();
    });

    it("staff working one door cannot stamp another event's vendor", async () => {
      // Same organization, wrong event id in the path.
      const res = await checkIn(organizerToken, expo.id, apps.sideVendor.id);
      expect(res.status).toBe(404);
      const row = await prisma.application.findUnique({ where: { id: apps.sideVendor.id }, select: { checkedInAt: true } });
      expect(row.checkedInAt).toBeNull();
    });

    it("a rival organization's vendor is invisible even with a valid pass", async () => {
      const pass = qrService.generateVendorQRPayload(apps.rival.id, eventB.id, statusToken(apps.rival.id));
      expect((await scan(organizerToken, expo.id, pass)).status).toBe(404);
    });

    it('an unauthenticated request never reaches the door', async () => {
      expect((await request(app).get(`/admin/events/${expo.id}/check-in`)).status).toBe(401);
      expect((await request(app).post(`/admin/events/${expo.id}/check-in/${apps.clay.id}`).send({})).status).toBe(401);
    });
  });

  describe('scanning the pass the vendor already has', () => {
    it('resolves the jump://vendor badge payload', async () => {
      const pass = qrService.generateVendorQRPayload(apps.clay.id, expo.id, statusToken(apps.clay.id));
      const res = await scan(organizerToken, expo.id, pass);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: apps.clay.id, businessName: 'Clay & Co', checkedInAt: null });
    });

    it('resolves the status URL straight out of the approval email', async () => {
      const url = `https://tickets.example.com/events/${expo.id}/apply/status/${apps.clay.id}?token=${statusToken(apps.clay.id)}`;
      const res = await scan(organizerToken, expo.id, url);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(apps.clay.id);
    });

    it('refuses a forged token and does not confirm the id exists', async () => {
      const forged = qrService.generateVendorQRPayload(apps.clay.id, expo.id, 'f'.repeat(64));
      const res = await scan(organizerToken, expo.id, forged);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('No vendor on this event matches that pass');

      const unknown = qrService.generateVendorQRPayload('cl0000000000000000000000', expo.id, 'f'.repeat(64));
      const other = await scan(organizerToken, expo.id, unknown);
      expect(other.status).toBe(404);
      expect(other.body.message).toBe(res.body.message);
    });

    it('rejects something that is not a vendor pass at all', async () => {
      expect((await scan(organizerToken, expo.id, 'jump://ticket?id=x&b=y&e=z')).status).toBe(400);
      expect((await scan(organizerToken, expo.id, '   ')).status).toBe(400);
    });
  });

  describe('only approved vendors', () => {
    it('refuses a waitlisted application with 409 and leaves it unstamped', async () => {
      const res = await checkIn(organizerToken, expo.id, apps.waiting.id);
      expect(res.status).toBe(409);
      const row = await prisma.application.findUnique({ where: { id: apps.waiting.id }, select: { checkedInAt: true } });
      expect(row.checkedInAt).toBeNull();
    });

    it('rejects an unknown method', async () => {
      expect((await checkIn(organizerToken, expo.id, apps.clay.id, { via: 'TELEPATHY' })).status).toBe(400);
    });
  });
});
