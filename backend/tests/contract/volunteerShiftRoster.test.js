// Contract tests for the shift roster (spec 050 §6.4, card 050-S): the
// submissions list scope takes a `shift` filter (anyone who picked the shift
// or is assigned to it), rows carry their shifts with the assigned flag, and
// the same filter narrows the org-wide list and the CSV export.
// `shiftMode=assigned` keeps only volunteers assigned to the shift.

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
  let otherShift;
  let otherApp;
  const apps = {};

  const call = (method, path, token = tokens.ORGANIZER, orgId = org.id) =>
    request(app)[method](path).set('Authorization', `Bearer ${token}`).set('X-Jump-Org', orgId);
  const submit = (shiftIds, email, target = { eventId, slug: null }) =>
    request(app)
      .post(`/events/${target.eventId}/applications`)
      .send({ formSlug: target.slug ?? form.slug, contact: { email, firstName: 'Val', lastName: email.split('@')[0] }, acceptances: allAcceptances(), answers: {}, shiftIds });

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
    // ("setupOnly" picked Setup but works Gate: the assigned Setup roster must leave them out.)
    const d = await call('post', `/admin/events/${eventId}/applications/${apps.setupOnly}/decision`).send({ decision: 'APPROVE', sendEmail: false, shiftIds: [gate.id] });
    expect(d.status).toBe(200);
    // "both" picked Gate and Setup and is assigned to Setup only.
    const d2 = await call('post', `/admin/events/${eventId}/applications/${apps.both}/decision`).send({ decision: 'APPROVE', sendEmail: false, shiftIds: [setup.id] });
    expect(d2.status).toBe(200);

    // The other organization has its own volunteer form, shift and application.
    const otherVenue = await prisma.venue.create({ data: { organizationId: otherOrg.id, name: `${TAG} Barn`, address: '2 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    const otherEventId = (await prisma.event.create({ data: { venueId: otherVenue.id, name: `${TAG} Other Expo`, date: new Date('2027-09-19T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } })).id;
    const of = await call('post', `/admin/events/${otherEventId}/application-forms`, tokens.OUTSIDER, otherOrg.id).send({ kind: 'FREE', purpose: 'VOLUNTEER', name: 'Other crew', questions: [], collectBusiness: false });
    expect(of.status).toBe(201);
    await call('patch', `/admin/events/${otherEventId}/application-forms/${of.body.id}`, tokens.OUTSIDER, otherOrg.id).send({ status: 'OPEN' });
    otherShift = (await call('post', `/admin/events/${otherEventId}/application-forms/${of.body.id}/shifts`, tokens.OUTSIDER, otherOrg.id).send({ name: 'Gate' })).body;
    const oa = await submit([otherShift.id], `other@${TAG}.test`, { eventId: otherEventId, slug: of.body.slug });
    expect(oa.status).toBe(201);
    otherApp = oa.body.applicationId;
  });

  afterAll(async () => {
    permissionService.clearCache();
    const orgs = { in: [org.id, otherOrg.id] };
    await prisma.application.deleteMany({ where: { organizationId: orgs } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: orgs } }).catch(() => {});
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: orgs } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: orgs } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgs } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: orgs } }).catch(() => {});
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
      { id: setup.id, name: 'Setup', assigned: true },
    ]);
    expect(row(apps.setupOnly).shifts).toEqual([
      { id: gate.id, name: 'Gate', assigned: true },
      { id: setup.id, name: 'Setup', assigned: false },
    ]);
    expect(row(apps.none).shifts).toEqual([]);
  });

  it('combines with the status filter', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications?shift=${gate.id}&status=APPROVED`);
    // "both" is approved and picked Gate, though it works Setup: picks count in the default mode.
    expect(ids(res)).toEqual([apps.setupOnly, apps.both].sort());
  });

  it('shiftMode=assigned is the assigned roster: picks without an assignment are left out', async () => {
    const setupRoster = await call('get', `/admin/events/${eventId}/applications?shift=${setup.id}&shiftMode=assigned`);
    expect(setupRoster.status).toBe(200);
    // "setupOnly" is approved and picked Setup but is assigned to Gate.
    expect(ids(setupRoster)).toEqual([apps.both]);
    const gateRoster = await call('get', `/admin/events/${eventId}/applications?shift=${gate.id}&shiftMode=assigned`);
    expect(ids(gateRoster)).toEqual([apps.setupOnly]);
    const csv = await call('get', `/admin/events/${eventId}/applications/export.csv?shift=${setup.id}&shiftMode=assigned`);
    expect(csv.text.trim().split('\n')).toHaveLength(2);
  });

  it('the org-wide forms list carries volunteer shifts for the filter', async () => {
    const res = await call('get', '/admin/application-forms');
    expect(res.status).toBe(200);
    expect(res.body.data.find((f) => f.id === form.id).shifts).toEqual([{ id: gate.id, name: 'Gate' }, { id: setup.id, name: 'Setup' }]);
    expect(res.body.data.some((f) => f.shifts?.some((s) => s.id === otherShift.id))).toBe(false);
  });

  it('applies on the org-wide list and the CSV export', async () => {
    const list = await call('get', `/admin/applications?shift=${setup.id}`);
    expect(list.status).toBe(200);
    expect(ids(list)).toEqual([apps.both, apps.setupOnly].sort());
    const csv = await call('get', `/admin/events/${eventId}/applications/export.csv?shift=${setup.id}`);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\n')).toHaveLength(3);
  });

  it('the filter never crosses organizations', async () => {
    // The other org's member: their own shift finds their own volunteer, ours finds nothing.
    const own = await call('get', `/admin/applications?shift=${otherShift.id}`, tokens.OUTSIDER, otherOrg.id);
    expect(own.status).toBe(200);
    expect(ids(own)).toEqual([otherApp]);
    const ours = await call('get', `/admin/applications?shift=${gate.id}`, tokens.OUTSIDER, otherOrg.id);
    expect(ours.status).toBe(200);
    expect(ours.body.data).toEqual([]);
    // And our member cannot reach their volunteer through their shift id.
    const theirs = await call('get', `/admin/applications?shift=${otherShift.id}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data).toEqual([]);
  });

  it('an unknown shift id matches nothing', async () => {
    const res = await call('get', `/admin/events/${eventId}/applications?shift=nope`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
