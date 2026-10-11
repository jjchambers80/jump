// Contract tests for the shift roster (spec 050 §6.4, card 050-S): the
// submissions list scope takes a `shift` filter (anyone who picked the shift
// or is assigned to it), rows carry their shifts with the assigned flag, and
// the same filter narrows the org-wide list and the CSV export.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

const TAG = `shift-roster-${process.pid}-${Date.now()}`;
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `outsider@${TAG}.test`];

describe('Shift roster filter (spec 050 §6.4, 050-S)', () => {
  const tokens = {};
  let org;
  let otherOrg;
  let eventId;
  let form;
  let gate;
  let setup;
  const apps = {};

  const call = (method, path, token = tokens.ORGANIZER, orgId = org.id) =>
    request(app)[method](path).set('Authorization', `Bearer ${token}`).set('X-Jump-Org', orgId);
  const submit = (shiftIds, email) =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug: form.slug, contact: { email, firstName: 'Val', lastName: email.split('@')[0] }, acceptances: allAcceptances(), answers: {}, shiftIds });

  beforeAll(async () => {
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [] } };
    tokens.ADMIN = await staffToken({ email: emails[0], role: 'ADMIN' });
    tokens.ORGANIZER = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    tokens.OUTSIDER = await staffToken({ email: emails[2], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(tokens.ADMIN, org.id, 'ADMIN');
    await joinOrgByToken(tokens.ORGANIZER, org.id, 'ORGANIZER');
    await joinOrgByToken(tokens.OUTSIDER, otherOrg.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } })).id;
    const f = await call('post', `/admin/events/${eventId}/application-forms`, tokens.ADMIN).send({ kind: 'FREE', purpose: 'VOLUNTEER', name: 'Crew', questions: [], collectBusiness: false });
    expect(f.status).toBe(201);
    form = f.body;
    await call('patch', `/admin/events/${eventId}/application-forms/${form.id}`, tokens.ADMIN).send({ status: 'OPEN' });
    const shiftsBase = `/admin/events/${eventId}/application-forms/${form.id}/shifts`;
    gate = (await call('post', shiftsBase).send({ name: 'Gate', capacity: 5 })).body;
    setup = (await call('post', shiftsBase).send({ name: 'Setup' })).body;

    for (const [key, picks] of Object.entries({ gateOnly: [gate.id], both: [gate.id, setup.id], setupOnly: [setup.id], none: [] })) {
      const r = await submit(picks, `${key.toLowerCase()}@${TAG}.test`);
      expect(r.status).toBe(201);
      apps[key] = r.body.applicationId;
    }
    // Approve "setupOnly" onto Gate: an organizer assignment without a pick still lands on the roster.
    const d = await call('post', `/admin/events/${eventId}/applications/${apps.setupOnly}/decision`).send({ decision: 'APPROVE', sendEmail: false, shiftIds: [gate.id] });
    expect(d.status).toBe(200);
  });

  afterAll(async () => {
    permissionService.clearCache();
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  const ids = (res) => res.body.data.map((r) => r.id).sort();

  it('narrows the event list to the shift and keeps the status chips over the whole scope', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications?shift=${gate.id}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([apps.gateOnly, apps.both, apps.setupOnly].sort());
    expect(res.body.total).toBe(3);
    expect(Object.values(res.body.summary).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('rows carry their shifts in display order with the assigned flag', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications`);
    const row = (id) => res.body.data.find((r) => r.id === id);
    expect(row(apps.both).shifts).toEqual([
      { id: gate.id, name: 'Gate', assigned: false },
      { id: setup.id, name: 'Setup', assigned: false },
    ]);
    expect(row(apps.setupOnly).shifts).toEqual([
      { id: gate.id, name: 'Gate', assigned: true },
      { id: setup.id, name: 'Setup', assigned: false },
    ]);
    expect(row(apps.none).shifts).toEqual([]);
  });

  it('combines with the status filter (the assigned roster)', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications?shift=${gate.id}&status=APPROVED`);
    expect(ids(res)).toEqual([apps.setupOnly]);
  });

  it('applies on the org-wide list and the CSV export', async () => {
    const list = await call('get', `/admin/applications?shift=${setup.id}`);
    expect(list.status).toBe(200);
    expect(ids(list)).toEqual([apps.both, apps.setupOnly].sort());
    const csv = await call('get', `/admin/events/${eventId}/applications/export.csv?shift=${setup.id}`);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\n')).toHaveLength(3);
  });

  it("another organization's member sees nothing for this shift", async () => {
    const res = await call('get', `/admin/applications?shift=${gate.id}`, tokens.OUTSIDER, otherOrg.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('an unknown shift id matches nothing', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications?shift=nope`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
