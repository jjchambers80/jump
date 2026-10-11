// Contract tests for spec 050-C: GET …/events/:id/readiness and publish
// through it (422 EVENT_NOT_READY, openFormIds, setupCompletedAt).

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const EMAILS = ['organizer@readiness-test.com', 'outsider@readiness-test.com'];

describe('Event readiness and publish (spec 050-C)', () => {
  let token;
  let outsiderToken;
  let orgId;
  let venueId;
  const base = () => `/organizations/${orgId}/events`;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  const readiness = (id, t = token) => request(app).get(`${base()}/${id}/readiness`).set('Authorization', `Bearer ${t}`);
  const publish = (id, body) => auth(request(app).post(`${base()}/${id}/publish`)).send(body);
  const draft = async (body = {}) =>
    (await auth(request(app).post(base())).send({ setup: true, name: 'Ready Event', venueId, date: '2027-09-01T18:00:00.000Z', ...body })).body;
  const form = (eventId, data) =>
    prisma.applicationForm.create({ data: { organizationId: orgId, eventId, kind: 'FREE', name: 'Vendors', slug: `f-${Math.random().toString(36).slice(2)}`, ...data } });

  beforeAll(async () => {
    const admin = await staffToken({ role: 'ADMIN', email: 'admin@readiness-test.com' });
    const org = await request(app).post('/organizations').set('Authorization', `Bearer ${admin}`).send({ name: 'Readiness Test Org' });
    orgId = org.body.id;
    // ORGANIZER is enough for readiness and publish.
    token = await staffToken({ role: 'ORGANIZER', email: EMAILS[0] });
    await joinOrgByToken(token, orgId, 'ORGANIZER');
    outsiderToken = await staffToken({ role: 'ORGANIZER', email: EMAILS[1] });
    await joinOrgByToken(admin, orgId, 'ADMIN');
    const venue = await request(app).post(`/organizations/${orgId}/venues`).set('Authorization', `Bearer ${admin}`).send({ name: 'Ready Venue', address: '1 Ready Rd' });
    venueId = venue.body.id;
  });

  afterAll(async () => {
    await prisma.applicationForm.deleteMany({ where: { organizationId: orgId } });
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: orgId } } } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgId } } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await cleanupStaff([...EMAILS, 'admin@readiness-test.com']);
  });

  it('lists the ticketed blockers of a fresh setup draft with steps', async () => {
    const event = await draft();
    const res = await readiness(event.id);
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.blockers).toEqual([
      { code: 'CAPACITY_MISSING', step: 'tickets', message: expect.any(String) },
      { code: 'NO_ACTIVE_TIER', step: 'tickets', message: expect.any(String) },
    ]);
    expect(res.body.warnings.map((w) => w.code)).toEqual(['NO_DESCRIPTION', 'NO_IMAGE']);
  });

  it('is scoped to members of the organization', async () => {
    const event = await draft();
    expect((await readiness(event.id, outsiderToken)).status).toBe(403);
    expect((await readiness('missing-event')).status).toBe(404);
  });

  it('reports a past date and tiers over capacity', async () => {
    const event = await draft({ capacity: 10, priceTiers: [{ name: 'GA', price: 5, quantityTotal: 10 }] });
    await prisma.event.update({ where: { id: event.id }, data: { date: new Date('2020-01-01T00:00:00Z'), capacity: 5 } });
    const res = await readiness(event.id);
    expect(res.body.blockers.map((b) => b.code)).toEqual(['DATE_IN_PAST', 'TIERS_EXCEED_CAPACITY']);
  });

  it('RSVP events skip the tier and capacity checks', async () => {
    const event = await draft({ admissionMode: 'RSVP' });
    await prisma.event.update({ where: { id: event.id }, data: { admissionMode: 'RSVP' } });
    const res = await readiness(event.id);
    expect(res.body.ready).toBe(true);
    expect(res.body.blockers).toEqual([]);
  });

  it('publish answers 422 EVENT_NOT_READY with the same blockers', async () => {
    const event = await draft();
    const res = await publish(event.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('EVENT_NOT_READY');
    expect(res.body.details.blockers).toEqual((await readiness(event.id)).body.blockers);
    expect((await prisma.event.findUnique({ where: { id: event.id } })).status).toBe('DRAFT');
  });

  it('opens only the listed DRAFT forms, refuses PAID per form while the gate is off, and sets setupCompletedAt', async () => {
    const prev = process.env.APPLICATIONS_PAYMENTS_ENABLED;
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    try {
      const event = await draft({ capacity: 10, priceTiers: [{ name: 'GA', price: 5, quantityTotal: 10 }] });
      expect(event.setupCompletedAt).toBeNull();
      const listed = await form(event.id, {});
      const unlisted = await form(event.id, {});
      const paid = await form(event.id, { kind: 'PAID', name: 'Paid booths' });
      const closed = await form(event.id, { status: 'CLOSED' });

      const ready = await readiness(event.id);
      expect(ready.body.warnings.filter((w) => w.code === 'PAID_FORMS_DISABLED').map((w) => w.formId)).toEqual([paid.id]);

      const res = await publish(event.id, { openFormIds: [listed.id, paid.id, closed.id] });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PUBLISHED');
      expect(res.body.setupCompletedAt).not.toBeNull();
      expect(res.body.formResults).toEqual([
        { formId: listed.id, status: 'OPEN' },
        { formId: paid.id, status: 'REFUSED', code: 'PAID_FORMS_DISABLED', message: expect.any(String) },
        { formId: closed.id, status: 'REFUSED', code: 'FORM_NOT_DRAFT', message: expect.any(String) },
      ]);
      const statuses = Object.fromEntries(
        (await prisma.applicationForm.findMany({ where: { eventId: event.id } })).map((f) => [f.id, f.status])
      );
      expect(statuses).toEqual({ [listed.id]: 'OPEN', [unlisted.id]: 'DRAFT', [paid.id]: 'DRAFT', [closed.id]: 'CLOSED' });
    } finally {
      if (prev === undefined) delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
      else process.env.APPLICATIONS_PAYMENTS_ENABLED = prev;
    }
  });

  it('keeps an existing setupCompletedAt and refuses a malformed openFormIds', async () => {
    const created = await auth(request(app).post(base())).send({
      name: 'Old path', venueId, date: '2027-09-01T18:00:00.000Z', capacity: 5, priceTiers: [{ name: 'GA', price: 5, quantityTotal: 5 }],
    });
    expect((await publish(created.body.id, { openFormIds: 'nope' })).status).toBe(400);
    const res = await publish(created.body.id, {});
    expect(res.status).toBe(200);
    expect(res.body.setupCompletedAt).toBe(created.body.setupCompletedAt);
    expect(res.body.formResults).toEqual([]);
  });
});
