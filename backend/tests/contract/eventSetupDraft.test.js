// Contract tests for spec 050-A: event draft fields for the setup wizard.
// POST /organizations/:orgId/events { setup: true } + Idempotency-Key,
// PATCH endDate / setupStep / setupCompleted / capacity: null,
// null-capacity tiers, duplicate shifts endDate, DB CHECK on capacity.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

describe('Event setup drafts (spec 050-A)', () => {
  let token;
  let orgId;
  let venueId;
  const base = () => `/organizations/${orgId}/events`;
  const start = '2027-09-01T18:00:00.000Z';

  const setupCreate = (body = {}, key) => {
    const req = request(app).post(base()).set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ setup: true, name: 'Wizard Event', venueId, date: start, ...body });
  };
  const patch = (id, body) =>
    request(app).patch(`${base()}/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    const adminToken = await staffToken({ role: 'ADMIN', email: 'admin@setup-draft-test.com' });
    token = adminToken;
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Setup Draft Test Org' });
    orgId = orgRes.body.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');
    const venueRes = await request(app)
      .post(`/organizations/${orgId}/venues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Setup Venue', address: '1 Wizard Way' });
    venueId = venueRes.body.id;
  });

  afterAll(async () => {
    const where = { event: { venue: { organizationId: orgId } } };
    await prisma.priceTier.deleteMany({ where });
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgId } } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  describe('create with setup: true', () => {
    it('creates a DRAFT with no tiers, null capacity and null setupCompletedAt', async () => {
      const res = await setupCreate({ endDate: '2027-09-01T22:00:00.000Z' }, `key-${Date.now()}-a`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        capacity: null,
        priceTiers: [],
        setupCompletedAt: null,
        setupStep: null,
        endDate: '2027-09-01T22:00:00.000Z',
      });
    });

    it('a replay with the same Idempotency-Key returns the same row with 200', async () => {
      const key = `key-${Date.now()}-replay`;
      const first = await setupCreate({}, key);
      const second = await setupCreate({ name: 'Different name' }, key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.name).toBe('Wizard Event');
      expect(await prisma.event.count({ where: { setupRequestId: key } })).toBe(1);
    });

    it('concurrent requests with one key create one row', async () => {
      const key = `key-${Date.now()}-race`;
      const results = await Promise.all([setupCreate({}, key), setupCreate({}, key), setupCreate({}, key)]);
      expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.event.count({ where: { setupRequestId: key } })).toBe(1);
    });

    it('still requires name, venueId and date', async () => {
      const res = await request(app)
        .post(base())
        .set('Authorization', `Bearer ${token}`)
        .send({ setup: true });
      expect(res.status).toBe(400);
    });

    it('refuses endDate at or before date', async () => {
      expect((await setupCreate({ endDate: start })).status).toBe(400);
      expect((await setupCreate({ endDate: '2027-09-01T17:00:00.000Z' })).status).toBe(400);
    });

    it('without setup: true still requires capacity and tiers, and the row is complete', async () => {
      const bad = await request(app)
        .post(base())
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Old path', venueId, date: start });
      expect(bad.status).toBe(400);

      const ok = await request(app)
        .post(base())
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Old path', venueId, date: start, capacity: 10, priceTiers: [{ name: 'GA', price: 5, quantityTotal: 10 }] });
      expect(ok.status).toBe(201);
      expect(ok.body.setupCompletedAt).not.toBeNull();
    });
  });

  describe('PATCH draft fields', () => {
    it('sets endDate, setupStep and setupCompleted once', async () => {
      const { body: draft } = await setupCreate();
      const res = await patch(draft.id, { endDate: '2027-09-02T01:00:00.000Z', setupStep: 'tickets' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ endDate: '2027-09-02T01:00:00.000Z', setupStep: 'tickets', setupCompletedAt: null });

      const done = await patch(draft.id, { setupCompleted: true });
      expect(done.body.setupCompletedAt).not.toBeNull();
      const again = await patch(draft.id, { setupCompleted: true });
      expect(again.body.setupCompletedAt).toBe(done.body.setupCompletedAt);

      const cleared = await patch(draft.id, { endDate: null });
      expect(cleared.body.endDate).toBeNull();
    });

    it('rejects an unknown setupStep and an endDate not after the date', async () => {
      const { body: draft } = await setupCreate();
      expect((await patch(draft.id, { setupStep: 'nope' })).status).toBe(400);
      expect((await patch(draft.id, { endDate: '2027-09-01T17:00:00.000Z' })).status).toBe(400);
      // Against the stored date when only endDate is sent, and the stored endDate when only date moves.
      await patch(draft.id, { endDate: '2027-09-01T20:00:00.000Z' });
      expect((await patch(draft.id, { date: '2027-09-01T21:00:00.000Z' })).status).toBe(400);
      expect((await patch(draft.id, { date: '2027-09-01T21:00:00.000Z', endDate: null })).status).toBe(200);
    });

    it('capacity: null clears a DRAFT and is 409 CAPACITY_REQUIRED once published', async () => {
      const { body: draft } = await setupCreate();
      const withCap = await patch(draft.id, { capacity: 50 });
      expect(withCap.body.capacity).toBe(50);
      const cleared = await patch(draft.id, { capacity: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.capacity).toBeNull();

      await patch(draft.id, { capacity: 50 });
      await request(app)
        .post(`${base()}/${draft.id}/price-tiers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GA', price: 10, quantityTotal: 50 });
      const pub = await request(app).post(`${base()}/${draft.id}/publish`).set('Authorization', `Bearer ${token}`);
      expect(pub.status).toBe(200);

      const res = await patch(draft.id, { capacity: null });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CAPACITY_REQUIRED');

      // Public payload carries endDate but not the wizard fields.
      const pubRes = await request(app).get(`/events/${draft.id}`);
      expect(pubRes.status).toBe(200);
      expect(pubRes.body).toHaveProperty('endDate');
      expect(pubRes.body).not.toHaveProperty('setupStep');
      expect(pubRes.body).not.toHaveProperty('setupCompletedAt');
    });
  });

  describe('null capacity readers', () => {
    it('adds tiers without a ceiling while capacity is null, then setting capacity checks the sum', async () => {
      const { body: draft } = await setupCreate();
      const tier = await request(app)
        .post(`${base()}/${draft.id}/price-tiers`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GA', price: 10, quantityTotal: 80 });
      expect(tier.status).toBe(201);
      expect((await patch(draft.id, { capacity: 50 })).status).toBe(400);
      expect((await patch(draft.id, { capacity: 80 })).status).toBe(200);
    });

    it('publish refuses a ticketed draft without capacity', async () => {
      const { body: draft } = await setupCreate({ priceTiers: [{ name: 'GA', price: 10, quantityTotal: 5 }] });
      expect(draft.capacity).toBeNull();
      const res = await request(app).post(`${base()}/${draft.id}/publish`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CAPACITY_REQUIRED');
    });

    it('the events summary and list treat null capacity as 0 / null', async () => {
      await setupCreate();
      const summary = await request(app).get(`${base()}/summary`).set('Authorization', `Bearer ${token}`);
      expect(summary.status).toBe(200);
      expect(Number.isFinite(summary.body.published.capacity)).toBe(true);
      const list = await request(app).get(base()).set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.events.some((e) => e.capacity === null)).toBe(true);
    });
  });

  it('duplicate shifts endDate by the same offset as date', async () => {
    const { body: draft } = await setupCreate({ endDate: '2027-09-01T21:30:00.000Z', capacity: 10 });
    const res = await request(app)
      .post(`${base()}/${draft.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2027-10-01T18:00:00.000Z' });
    expect(res.status).toBe(201);
    expect(res.body.endDate).toBe('2027-10-01T21:30:00.000Z');
    expect(res.body.capacity).toBe(10);
  });

  it('the DB CHECK refuses null capacity on a PUBLISHED TICKETED event', async () => {
    const { body: draft } = await setupCreate({ capacity: 10 });
    await prisma.event.update({ where: { id: draft.id }, data: { status: 'PUBLISHED' } });
    await expect(prisma.event.update({ where: { id: draft.id }, data: { capacity: null } })).rejects.toThrow(
      /Event_capacity_draft_check/
    );
    // RSVP events and drafts may hold null.
    await prisma.event.update({ where: { id: draft.id }, data: { admissionMode: 'RSVP', capacity: null } });
  });
});
