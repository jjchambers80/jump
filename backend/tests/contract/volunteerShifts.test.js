// Contract tests for volunteer shifts (spec 050 §6.4, card 050-R): shift
// CRUD (role, org and purpose guards), the public payload, submitting with
// picks (full shifts still pickable), approval assigning within capacity
// under concurrency, the CSV column, the admin detail, export and erasure.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');
const { default: buyerDataExportService } = await import('../../src/services/BuyerDataExportService.js');
const { default: contactErasureService } = await import('../../src/services/ContactErasureService.js');

const TAG = `vol-shifts-${process.pid}-${Date.now()}`;
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `unassigned@${TAG}.test`, `outsider@${TAG}.test`];
const pinRoles = (value) => {
  permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [], ...value } };
};

describe('Volunteer shifts (spec 050 §6.4)', () => {
  const tokens = {};
  let org;
  let otherOrg;
  let eventId;
  let volunteer;
  let other;
  const shifts = {};
  let seq = 0;

  const call = (method, path, token, body) => {
    const req = request(app)[method](path).set('Authorization', `Bearer ${token}`).set('X-Jump-Org', org.id);
    return body === undefined ? req : req.send(body);
  };
  const base = (formId = volunteer.id) => `/admin/events/${eventId}/application-forms/${formId}/shifts`;
  const submit = (shiftIds, email = `v${seq++}@${TAG}.test`) =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug: volunteer.slug, contact: { email, firstName: 'Val', lastName: 'Unteer' }, acceptances: allAcceptances(), answers: {}, shiftIds });
  const approve = (applicationId, shiftIds) =>
    call('post', `/admin/events/${eventId}/applications/${applicationId}/decision`, tokens.ORGANIZER, { decision: 'APPROVE', sendEmail: false, shiftIds });

  beforeAll(async () => {
    tokens.ADMIN = await staffToken({ email: emails[0], role: 'ADMIN' });
    tokens.ORGANIZER = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    tokens.UNASSIGNED = await staffToken({ email: emails[2], role: 'UNASSIGNED' });
    tokens.OUTSIDER = await staffToken({ email: emails[3], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(tokens.ADMIN, org.id, 'ADMIN');
    await joinOrgByToken(tokens.ORGANIZER, org.id, 'ORGANIZER');
    await joinOrgByToken(tokens.OUTSIDER, otherOrg.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } })).id;
    const v = await call('post', `/admin/events/${eventId}/application-forms`, tokens.ADMIN, { kind: 'FREE', purpose: 'VOLUNTEER', name: 'Crew', questions: [], collectBusiness: false });
    const o = await call('post', `/admin/events/${eventId}/application-forms`, tokens.ADMIN, { kind: 'FREE', purpose: 'PRESS', name: 'Press', questions: [], collectBusiness: false });
    expect([v.status, o.status]).toEqual([201, 201]);
    volunteer = v.body;
    other = o.body;
  });

  beforeEach(() => pinRoles({}));

  afterAll(async () => {
    permissionService.clearCache();
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contactComment.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.erasureSuppression.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  describe('CRUD', () => {
    it('ORGANIZER creates, lists, updates and deletes shifts', async () => {
      const gate = await call('post', base(), tokens.ORGANIZER, {
        name: 'Gate',
        startsAt: '2027-09-18T13:00:00.000Z',
        endsAt: '2027-09-18T17:00:00.000Z',
        capacity: 1,
        description: 'Scan tickets',
      });
      expect(gate.status).toBe(201);
      expect(gate.body).toMatchObject({ name: 'Gate', capacity: 1, assigned: 0, remaining: 1, displayOrder: 0, startsAt: '2027-09-18T13:00:00.000Z' });
      const roam = await call('post', base(), tokens.ORGANIZER, { name: 'Runner' });
      expect(roam.status).toBe(201);
      expect(roam.body).toMatchObject({ startsAt: null, endsAt: null, capacity: null, remaining: null, displayOrder: 1 });
      const temp = await call('post', base(), tokens.ORGANIZER, { name: 'Temp', capacity: 3 });
      shifts.gate = gate.body;
      shifts.roam = roam.body;

      const patched = await call('patch', `${base()}/${temp.body.id}`, tokens.ORGANIZER, { name: 'Teardown', capacity: null });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ name: 'Teardown', capacity: null });
      const list = await call('get', base(), tokens.ORGANIZER);
      expect(list.body.data.map((s) => s.name)).toEqual(['Gate', 'Runner', 'Teardown']);
      expect((await call('delete', `${base()}/${temp.body.id}`, tokens.ORGANIZER)).status).toBe(204);
    });

    it('validates times and capacity', async () => {
      const bad = [
        { name: 'x', startsAt: '2027-09-18T17:00:00Z', endsAt: '2027-09-18T13:00:00Z' },
        { name: 'x', startsAt: '2027-09-18T13:00:00Z', endsAt: '2027-09-18T13:00:00Z' },
        { name: 'x', endsAt: '2027-09-18T13:00:00Z' },
        { name: 'x', startsAt: 'tomorrow' },
        { name: 'x', capacity: 0 },
        { name: 'x', capacity: 1.5 },
        { name: '' },
        { name: 'x'.repeat(81) },
      ];
      for (const body of bad) expect([body, (await call('post', base(), tokens.ORGANIZER, body)).status]).toEqual([body, 400]);
      const earlier = await call('patch', `${base()}/${shifts.gate.id}`, tokens.ORGANIZER, { endsAt: '2027-09-18T12:00:00Z' });
      expect(earlier.status).toBe(400);
    });

    it('only VOLUNTEER forms have shifts (400 NOT_VOLUNTEER_FORM)', async () => {
      const res = await call('post', base(other.id), tokens.ORGANIZER, { name: 'Desk' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_VOLUNTEER_FORM');
    });

    it('UNASSIGNED and a denied ORGANIZER get 403; another org gets 403 or 404', async () => {
      expect((await call('post', base(), tokens.UNASSIGNED, { name: 'x' })).status).toBe(403);
      pinRoles({ ORGANIZER: { 'applications.forms': false } });
      expect((await call('post', base(), tokens.ORGANIZER, { name: 'x' })).status).toBe(403);
      pinRoles({});
      expect([403, 404]).toContain((await call('post', base(), tokens.OUTSIDER, { name: 'x' })).status);
      expect([403, 404]).toContain((await call('delete', `${base()}/${shifts.gate.id}`, tokens.OUTSIDER)).status);
    });
  });

  describe('apply and approve', () => {
    const apps = [];

    it('the public form lists shifts with the venue zone and what is left', async () => {
      expect((await call('patch', `/admin/events/${eventId}/application-forms/${volunteer.id}`, tokens.ADMIN, { status: 'OPEN' })).status).toBe(200);
      const res = await request(app).get(`/events/${eventId}/applications/forms/${volunteer.slug}`);
      expect(res.status).toBe(200);
      expect(res.body.timezone).toBe('America/New_York');
      expect(res.body.shifts).toEqual([
        { id: shifts.gate.id, name: 'Gate', description: 'Scan tickets', startsAt: '2027-09-18T13:00:00.000Z', endsAt: '2027-09-18T17:00:00.000Z', remaining: 1, full: false },
        { id: shifts.roam.id, name: 'Runner', description: null, startsAt: null, endsAt: null, remaining: null, full: false },
      ]);
    });

    it('submits with picks; unknown ids and picks on other forms are 400', async () => {
      for (let i = 0; i < 3; i += 1) {
        const res = await submit([shifts.gate.id, shifts.roam.id, shifts.gate.id]);
        expect([res.status, res.body.message]).toEqual([201, undefined]);
        apps.push(res.body.applicationId);
      }
      const rows = await prisma.applicationShift.findMany({ where: { applicationId: apps[0] } });
      expect(rows.map((r) => [r.shiftId, r.assigned]).sort()).toEqual([[shifts.gate.id, false], [shifts.roam.id, false]].sort());
      expect((await submit(['cl0000000000000000000000'])).status).toBe(400);
      await call('patch', `/admin/events/${eventId}/application-forms/${other.id}`, tokens.ADMIN, { status: 'OPEN' });
      const press = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({ formSlug: other.slug, contact: { email: `p@${TAG}.test`, firstName: 'P', lastName: 'R' }, acceptances: allAcceptances(), answers: {}, shiftIds: [shifts.gate.id] });
      expect([press.status, press.body.code]).toEqual([400, 'NOT_VOLUNTEER_FORM']);
    });

    it('concurrent approvals of the last spot: one wins, the other is 409 SHIFT_FULL', async () => {
      const [a, b] = await Promise.all([approve(apps[0], [shifts.gate.id, shifts.roam.id]), approve(apps[1], [shifts.gate.id])]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('SHIFT_FULL');
      expect(await prisma.applicationShift.count({ where: { shiftId: shifts.gate.id, assigned: true } })).toBe(1);
      // The loser is still SUBMITTED and can be approved into the unlimited shift.
      const loserId = a.status === 409 ? apps[0] : apps[1];
      const retry = await approve(loserId, [shifts.roam.id]);
      expect(retry.status).toBe(200);
      expect(retry.body.shifts.find((s) => s.id === shifts.roam.id)).toMatchObject({ picked: true, assignedToApplication: true });
    });

    it('a full shift shows as Full but stays pickable; a picked shift cannot be deleted', async () => {
      const pub = await request(app).get(`/events/${eventId}/applications/forms/${volunteer.slug}`);
      expect(pub.body.shifts[0]).toMatchObject({ remaining: 0, full: true });
      expect((await submit([shifts.gate.id])).status).toBe(201);
      const lower = await call('patch', `${base()}/${shifts.gate.id}`, tokens.ORGANIZER, { capacity: null });
      expect(lower.status).toBe(200);
      const back = await call('patch', `${base()}/${shifts.gate.id}`, tokens.ORGANIZER, { capacity: 1 });
      expect(back.status).toBe(200);
      expect((await call('delete', `${base()}/${shifts.gate.id}`, tokens.ORGANIZER)).body.code).toBe('SHIFT_HAS_PICKS');
    });

    it('withdrawing an approved volunteer hands the shift back', async () => {
      const holder = await prisma.applicationShift.findFirst({ where: { shiftId: shifts.gate.id, assigned: true } });
      const res = await call('post', `/admin/events/${eventId}/applications/${holder.applicationId}/decision`, tokens.ORGANIZER, { decision: 'WITHDRAW', sendEmail: false });
      expect(res.status).toBe(200);
      expect(await prisma.applicationShift.count({ where: { shiftId: shifts.gate.id, assigned: true } })).toBe(0);
      expect((await approve(apps[2], [shifts.gate.id])).status).toBe(200);
    });

    it('the CSV has a shifts column and the detail lists every shift', async () => {
      const csv = await call('get', `/admin/events/${eventId}/applications/export.csv`, tokens.ORGANIZER);
      expect(csv.status).toBe(200);
      const [header, ...lines] = csv.text.split('\r\n');
      const col = header.split(',').indexOf('shifts');
      expect(col).toBeGreaterThan(-1);
      const row = lines.find((l) => l.startsWith(apps[2]));
      expect(row.split(',')[col]).toBe('Gate (assigned); Runner');
      const detail = await call('get', `/admin/events/${eventId}/applications/${apps[2]}`, tokens.ORGANIZER);
      expect(detail.body.shifts.map((s) => [s.name, s.picked, s.assignedToApplication])).toEqual([
        ['Gate', true, true],
        ['Runner', true, false],
      ]);
      expect(detail.body.event.timezone).toBe('America/New_York');
    });

    it('PAID-form or non-approve decisions refuse shiftIds', async () => {
      const res = await call('post', `/admin/events/${eventId}/applications/${apps[0]}/decision`, tokens.ORGANIZER, { decision: 'REJECT', shiftIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('data rights', () => {
    it('export lists shift picks; erasure removes them', async () => {
      const email = `rights@${TAG}.test`;
      const res = await submit([shifts.roam.id], email);
      expect(res.status).toBe(201);
      const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email } } });
      const data = await buyerDataExportService.build(org.id, contact.id);
      expect(data.applications[0].shifts).toEqual([{ name: 'Runner', startsAt: null, endsAt: null, assigned: false }]);
      await contactErasureService.erase(contact.id, { organizationId: org.id });
      expect(await prisma.applicationShift.count({ where: { application: { contactId: contact.id } } })).toBe(0);
    });
  });
});
