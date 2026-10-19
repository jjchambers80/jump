// Contract test for registration events (spec 057): an event is LIVE or
// REGISTRATION; a registration event holds one application form, may link to
// a LIVE event of its organization, publishes without tickets, and sells the
// spaces of the linked live event's floor map.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');
const { default: boothService } = await import('../../src/services/BoothService.js');
const { default: mapService } = await import('../../src/services/MapService.js');

const TAG = 'registration-events-ct';

describe('Registration events (spec 057)', () => {
  let token;
  let otherToken;
  let org;
  let otherOrg;
  let venueId;
  let liveId;
  let otherLiveId;
  const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
  const auth = (t = token) => ['Authorization', `Bearer ${t}`];
  const events = (o = org) => `/organizations/${o.id}/events`;
  const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const createRegistration = (body = {}, key = `${TAG}-${Math.random()}`) =>
    request(app)
      .post(events())
      .set(...auth())
      .set('Idempotency-Key', key)
      .send({ setup: true, type: 'REGISTRATION', name: 'Vendors', venueId, date: future(30), ...body });

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    token = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(token, org.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrg.id, 'ORGANIZER');
    venueId = (await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } })).id;
    const otherVenue = await prisma.venue.create({ data: { organizationId: otherOrg.id, name: `${TAG} Elsewhere`, address: '2 Main St', city: 'Raleigh', state: 'NC' } });
    liveId = (await prisma.event.create({ data: { venueId, name: `${TAG} Market`, date: future(30), status: 'PUBLISHED', capacity: 100 } })).id;
    otherLiveId = (await prisma.event.create({ data: { venueId: otherVenue.id, name: `${TAG} Fair`, date: future(30), status: 'DRAFT', capacity: 50 } })).id;
  });

  afterEach(() => permissionService.clearCache());

  afterAll(async () => {
    const ids = { in: [org.id, otherOrg.id] };
    await prisma.application.deleteMany({ where: { organizationId: ids } }).catch(() => {});
    await prisma.floorMap.deleteMany({ where: { organizationId: ids } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: ids } }).catch(() => {});
    await prisma.event.updateMany({ where: { venue: { organizationId: ids } }, data: { linkedEventId: null } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: ids } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: ids } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: ids } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('creates a registration event linked to a live event, with no capacity or tickets', async () => {
    const res = await createRegistration({ linkedEventId: liveId, capacity: 40, priceTiers: [{ name: 'GA', price: 5, quantityTotal: 10 }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'REGISTRATION', linkedEventId: liveId, capacity: null, priceTiers: [] });
  });

  it('links only a registration event, and only to a live event of the same organization', async () => {
    expect((await createRegistration({ linkedEventId: otherLiveId })).status).toBe(400);
    const registration = await createRegistration();
    expect((await createRegistration({ linkedEventId: registration.body.id })).status).toBe(400);
    const live = await request(app).post(events()).set(...auth()).set('Idempotency-Key', `${TAG}-live`).send({ setup: true, name: 'Live', venueId, date: future(30), linkedEventId: liveId });
    expect(live.status).toBe(400);
    expect((await createRegistration({ type: 'PARTY' })).status).toBe(400);
  });

  it('keeps type fixed and refuses admission settings on a registration event', async () => {
    const { body } = await createRegistration();
    const patch = (b) => request(app).patch(`${events()}/${body.id}`).set(...auth()).send(b);
    expect((await patch({ type: 'LIVE' })).status).toBe(400);
    expect((await patch({ admissionMode: 'RSVP' })).status).toBe(400);
    expect((await patch({ capacity: 10 })).status).toBe(400);
    const linked = await patch({ linkedEventId: liveId });
    expect(linked.status).toBe(200);
    expect(linked.body.linkedEventId).toBe(liveId);
    expect((await patch({ linkedEventId: null })).body.linkedEventId).toBeNull();
  });

  it('holds exactly one form', async () => {
    const { body } = await createRegistration();
    const forms = `/admin/events/${body.id}/application-forms`;
    expect((await request(app).post(forms).set(...auth()).send({ kind: 'FREE', name: 'Vendors', setup: true })).status).toBe(201);
    const second = await request(app).post(forms).set(...auth()).send({ kind: 'FREE', name: 'Helpers', setup: true });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('FORM_EXISTS');
  });

  it("renames its form with the event, and leaves a live event's forms alone", async () => {
    const { body } = await createRegistration({ description: '<p>What we look for</p>' });
    expect(body.description).toBe('<p>What we look for</p>');
    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: body.id, kind: 'FREE', name: 'Vendors', slug: `${TAG}-renamed` } });
    const patch = (id, b) => request(app).patch(`${events()}/${id}`).set(...auth()).send(b);
    expect((await patch(body.id, { name: 'Spring makers' })).status).toBe(200);
    expect((await prisma.applicationForm.findUnique({ where: { id: form.id } })).name).toBe('Spring makers');
    await patch(body.id, { name: 'X' });
    expect((await prisma.applicationForm.findUnique({ where: { id: form.id } })).name).toBe('X registration');

    const liveForm = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: liveId, kind: 'FREE', name: 'Old vendors', slug: `${TAG}-live-form` } });
    expect((await patch(liveId, { name: `${TAG} Market renamed` })).status).toBe(200);
    expect((await prisma.applicationForm.findUnique({ where: { id: liveForm.id } })).name).toBe('Old vendors');
    await prisma.applicationForm.delete({ where: { id: liveForm.id } });
  });

  it('publishes on its form, without ticket checks', async () => {
    const { body } = await createRegistration({ description: '<p>Bring a table.</p>' });
    const readiness = async () => (await request(app).get(`${events()}/${body.id}/readiness`).set(...auth())).body;
    expect((await readiness()).blockers.map((b) => b.code)).toEqual(['FORM_MISSING']);
    await request(app).post(`/admin/events/${body.id}/application-forms`).set(...auth()).send({ kind: 'FREE', name: 'Makers', setup: true });
    expect((await readiness()).blockers).toEqual([]);
    const published = await request(app).post(`${events()}/${body.id}/publish`).set(...auth());
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');
  });

  it('lists by type, counts registrations, and links both ways on the workspace', async () => {
    const { body } = await createRegistration({ name: 'Counted', linkedEventId: liveId });
    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: body.id, kind: 'FREE', name: 'Counted', slug: 'counted', status: 'OPEN' } });
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `vendor@${TAG}.test`, firstName: 'Val', lastName: 'Vendor' } });
    await prisma.application.create({ data: { organizationId: org.id, eventId: body.id, formId: form.id, contactId: contact.id, status: 'SUBMITTED', submittedAt: new Date(), statusTokenHash: `${TAG}-token` } });

    const list = await request(app).get(`${events()}?type=REGISTRATION&limit=100`).set(...auth());
    expect(list.status).toBe(200);
    expect(list.body.events.every((e) => e.type === 'REGISTRATION')).toBe(true);
    expect(list.body.events.find((e) => e.id === body.id).registrationCount).toEqual({ total: 1, toReview: 1 });
    expect((await request(app).get(`${events()}?type=LIVE`).set(...auth())).body.events.map((e) => e.id)).toContain(liveId);
    expect((await request(app).get(`${events()}?type=nope`).set(...auth())).status).toBe(400);
    // The summary honours the type: registration events have no tickets or RSVPs.
    const summary = await request(app).get(`${events()}/summary?type=REGISTRATION`).set(...auth());
    expect(summary.body.registered).toEqual({ tickets: 0, rsvps: 0 });

    const live = await request(app).get(`${events()}/${liveId}/workspace`).set(...auth());
    expect(live.body).toMatchObject({ type: 'LIVE', linkedEvent: null });
    expect(live.body.registrations).toEqual(expect.arrayContaining([expect.objectContaining({ id: body.id, formStatus: 'OPEN', toReview: 1 })]));
    const registration = await request(app).get(`${events()}/${body.id}/overview`).set(...auth());
    expect(registration.body).toMatchObject({ event: { type: 'REGISTRATION' }, linkedEvent: { id: liveId }, registrations: [] });
  });

  it("offers a published registration's form on the live event's page", async () => {
    const { body } = await createRegistration({ name: 'Sponsors', linkedEventId: liveId });
    await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: body.id, kind: 'FREE', name: 'Sponsors', slug: 'sponsors', status: 'OPEN' } });
    const before = await request(app).get(`/events/${liveId}/applications/forms`);
    expect(before.body.data.map((f) => f.slug)).not.toContain('sponsors');
    await prisma.event.update({ where: { id: body.id }, data: { status: 'PUBLISHED' } });
    const after = await request(app).get(`/events/${liveId}/applications/forms`);
    expect(after.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'sponsors', eventId: body.id })]));
  });

  it("sells the linked live event's floor map", async () => {
    const { body } = await createRegistration({ name: 'Booths', linkedEventId: liveId });
    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: body.id, kind: 'PAID', name: 'Booths', slug: 'booths', spaceSelection: 'MAP' } });
    const tier = await prisma.applicationTier.create({ data: { formId: form.id, name: '10x10', price: 50, quantityTotal: 5 } });
    const map = await prisma.floorMap.create({ data: { organizationId: org.id, eventId: liveId, name: 'Hall', status: 'PUBLISHED', width: 40, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() } });
    await prisma.booth.create({ data: { mapId: map.id, label: 'A1', x: 0, y: 0, w: 5, h: 5, tierId: tier.id } });

    expect(await boothService.mapBoundTierIds(body.id)).toEqual(new Set([tier.id]));
    expect((await mapService.get(org.id, map.id)).tiers.map((t) => t.id)).toContain(tier.id);
    const publicMap = await request(app).get(`/events/${body.id}/map`);
    expect(publicMap.status).toBe(200);
    expect(publicMap.body.id).toBe(map.id);
  });

  it('needs the form permission to create a registration event', async () => {
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: { 'applications.forms': false }, disabled: [] } };
    expect((await createRegistration()).status).toBe(403);
  });
});
