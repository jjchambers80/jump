// Contract tests for Floor Maps (spec 014 phase 1).
// CRUD, org scoping, layout round-trip, publish/unpublish, booth assignment.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'maps-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`, `admin@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Maps contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let adminToken;
  let venue;
  let event;
  let otherEvent;
  let form;
  let tier;
  let application;
  let otherApplication;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Expo` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    venue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: `${TAG} Hall`,
        address: '1 St',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo`,
        date: new Date(Date.now() + 86_400_000),
        status: 'PUBLISHED',
        capacity: 100,
      },
    });
    otherEvent = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Other Event`,
        date: new Date(Date.now() + 86_400_000),
        status: 'PUBLISHED',
        capacity: 100,
      },
    });
    // Create an application form with a PAID tier for booth tests
    form = await prisma.applicationForm.create({
      data: {
        eventId: event.id,
        name: `${TAG} Vendor Form`,
        slug: `${TAG}-vendor`,
        kind: 'PAID',
        chargeTiming: 'APPROVAL',
        feeMode: 'ABSORB',
      },
    });
    tier = await prisma.applicationTier.create({
      data: {
        formId: form.id,
        name: 'Standard',
        price: 5000,
        quantityTotal: 20,
        quantityApproved: 10,
        quantityReserved: 10,
      },
    });
    // Create a contact and application for booth assignment
    const contact = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        email: `vendor@${TAG}.test`,
        firstName: 'Vendor',
        lastName: 'One',
      },
    });
    const profile = await prisma.applicantProfile.create({
      data: {
        organizationId: organization.id,
        contactId: contact.id,
        businessName: `${TAG} Vendor Co`,
      },
    });
    const testRunId = Date.now();
    application = await prisma.application.create({
      data: {
        eventId: event.id,
        organizationId: organization.id,
        formId: form.id,
        tierId: tier.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'APPROVED',
        capacitySlot: 'APPROVED',
        submittedAt: new Date(),
        statusTokenHash: `${TAG}-${testRunId}-hash-1`,
      },
    });
    otherApplication = await prisma.application.create({
      data: {
        eventId: event.id,
        organizationId: organization.id,
        formId: form.id,
        tierId: tier.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'APPROVED',
        publicProfile: false,
        capacitySlot: 'APPROVED',
        submittedAt: new Date(),
        statusTokenHash: `${TAG}-${testRunId}-hash-2`,
      },
    });
    // Approved vendor in another event: public directory queries must not leak
    // it into this event even though the organization/profile are shared.
    const otherForm = await prisma.applicationForm.create({
      data: {
        eventId: otherEvent.id,
        name: `${TAG} Other Vendor Form`,
        slug: `${TAG}-other-vendor`,
        kind: 'PAID',
        chargeTiming: 'APPROVAL',
      },
    });
    const otherTier = await prisma.applicationTier.create({
      data: { formId: otherForm.id, name: 'Other Event Booth', price: 25, quantityTotal: 1 },
    });
    await prisma.application.create({
      data: {
        eventId: otherEvent.id,
        organizationId: organization.id,
        formId: otherForm.id,
        tierId: otherTier.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'APPROVED',
        capacitySlot: 'APPROVED',
        submittedAt: new Date(),
        statusTokenHash: `${TAG}-${testRunId}-hash-other-event`,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  // ─── Map CRUD ────────────────────────────────────────────────────

  it('creates a map for the event', async () => {
    const res = await request(app)
      .post('/admin/maps')
      .set(...auth(organizerToken))
      .send({ eventId: event.id, name: 'Floor Plan' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Floor Plan');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.width).toBe(50);
    expect(res.body.eventId).toBe(event.id);
  });

  it('lists maps for the org', async () => {
    const res = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('gets a map by id', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(mapId);
    expect(res.body.booths).toEqual([]);
    expect(res.body.tiers).toBeDefined();
  });

  it('prevents another org from accessing the map', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(otherToken));
    expect(res.status).toBe(404);
  });

  // ─── Layout round-trip ──────────────────────────────────────────

  it('replaces layout with booths', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .put(`/admin/maps/${mapId}/layout`)
      .set(...auth(organizerToken))
      .send({
        elements: [],
        booths: [
          { label: 'A1', kind: 'BOOTH', x: 0, y: 0, w: 10, h: 10, rotation: 0, tierId: null },
          { label: 'A2', kind: 'BOOTH', x: 12, y: 0, w: 10, h: 10, rotation: 0, tierId: null },
          { label: 'A3', kind: 'TABLE', x: 0, y: 12, w: 10, h: 10, rotation: 0, tierId: null },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.booths.length).toBe(3);
  });

  // ─── Booth assignment ───────────────────────────────────────────

  it('assigns an APPROVED application to an AVAILABLE booth', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.label === 'A1');

    const res = await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/assign`)
      .set(...auth(organizerToken))
      .send({ applicationId: application.id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SOLD');
  });

  it('lists assignable applications for a booth, tier-match first', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.label === 'A2');

    const res = await request(app)
      .get(`/admin/maps/${mapId}/booths/${booth.id}/assignable`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should not include the already-assigned application
    expect(res.body.find((a) => a.id === application.id)).toBeUndefined();
  });

  it('moves a holder from A1 to A2 (swap)', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const fromBooth = map.body.booths.find((b) => b.label === 'A1');
    const toBooth = map.body.booths.find((b) => b.label === 'A2');

    const res = await request(app)
      .post(`/admin/maps/${mapId}/booths/${fromBooth.id}/move`)
      .set(...auth(organizerToken))
      .send({ targetBoothId: toBooth.id });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('A2');
  });

  it('unassigns a booth', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.label === 'A2');

    const res = await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/unassign`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AVAILABLE');
  });

  it('sets booth status to RESERVED and back to AVAILABLE', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.status === 'AVAILABLE');

    const res = await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/status`)
      .set(...auth(organizerToken))
      .send({ status: 'RESERVED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESERVED');

    const res2 = await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/status`)
      .set(...auth(organizerToken))
      .send({ status: 'AVAILABLE' });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('AVAILABLE');
  });

  // ─── Publish / Unpublish ────────────────────────────────────────

  it('publishes the map (requires at least 1 booth)', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .post(`/admin/maps/${mapId}/publish`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
  });

  // ─── Public map (spec 014 §4.3) ─────────────────────────────────

  it('serves the published map publicly with no-store, an ETag and 304', async () => {
    const list = await request(app).get('/admin/maps').set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app).get(`/admin/maps/${mapId}`).set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.label === 'A1');
    await prisma.booth.update({ where: { id: booth.id }, data: { tierId: tier.id } });
    await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/assign`)
      .set(...auth(organizerToken))
      .send({ applicationId: application.id })
      .expect(200);

    const res = await request(app).get(`/events/${event.id}/map`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeTruthy();
    expect(res.body.legend.length).toBeGreaterThan(0);
    expect(res.body.legend[0]).toMatchObject({ tierId: tier.id, swatch: 0 });
    expect(res.body.legend[0].price).toBeGreaterThan(0);
    const sold = res.body.booths.find((b) => b.label === 'A1');
    expect(sold).toMatchObject({ status: 'SOLD', vendorName: `${TAG} Vendor Co` });
    expect(res.body.vendors).toEqual([
      expect.objectContaining({
        id: application.id,
        name: `${TAG} Vendor Co`,
        category: `${TAG} Vendor Form`,
        booth: { id: booth.id, label: 'A1' },
      }),
    ]);
    expect(res.body.vendors[0]).not.toHaveProperty('contact');
    expect(res.body.vendors[0]).not.toHaveProperty('email');
    const available = res.body.booths.find((b) => b.label !== 'A1');
    expect(available.vendorName).toBeNull();
    // Only the SOLD booth exposes its holder; nothing internal leaks.
    expect(sold.applicationId).toBeUndefined();

    const again = await request(app).get(`/events/${event.id}/map`).set('If-None-Match', res.headers.etag);
    expect(again.status).toBe(304);

    // Any booth write changes the ETag (no stale map, ever).
    await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/unassign`)
      .set(...auth(organizerToken))
      .expect(200);
    const after = await request(app).get(`/events/${event.id}/map`).set('If-None-Match', res.headers.etag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(res.headers.etag);
    expect(after.body.booths.find((b) => b.label === 'A1').vendorName).toBeNull();
    expect(after.body.vendors.find((vendor) => vendor.id === application.id).booth).toBeNull();
  });

  it('gates the public map behind a private storefront', async () => {
    await prisma.organization.update({ where: { id: organization.id }, data: { storefrontPrivate: true } });
    try {
      const res = await request(app).get(`/events/${event.id}/map`);
      expect(res.status).toBe(403); // same answer as every other storefront read behind the gate
    } finally {
      await prisma.organization.update({ where: { id: organization.id }, data: { storefrontPrivate: false } });
    }
  });

  it('does not expose an ungated copy of the public map', async () => {
    const res = await request(app).get(`/public/events/${event.id}/map`);
    expect(res.status).toBe(404);
  });

  it('unpublishes the map', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .post(`/admin/maps/${mapId}/unpublish`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
    const pub = await request(app).get(`/events/${event.id}/map`);
    expect(pub.status).toBe(404);
  });

  // ─── Application detail includes booth ──────────────────────────

  it('GET /admin/applications/:id includes booth when assigned', async () => {
    // Re-assign to a booth first
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const map = await request(app)
      .get(`/admin/maps/${mapId}`)
      .set(...auth(organizerToken));
    const booth = map.body.booths.find((b) => b.status === 'AVAILABLE' || b.label === 'A3');
    if (!booth) throw new Error('No available booth for assignment');

    await request(app)
      .post(`/admin/maps/${mapId}/booths/${booth.id}/assign`)
      .set(...auth(organizerToken))
      .send({ applicationId: otherApplication.id });

    const res = await request(app)
      .get(`/admin/events/${event.id}/applications/${otherApplication.id}`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.booth).toBeDefined();
    expect(res.body.booth.id).toBe(booth.id);
    expect(res.body.booth.label).toBe(booth.label);
    expect(res.body.booth.mapId).toBe(mapId);
  });

  // ─── 409 BOOTH_IN_USE on layout replace ─────────────────────────

  it('refuses layout replace that would delete a SOLD booth', async () => {
    const list = await request(app)
      .get('/admin/maps')
      .set(...auth(organizerToken));
    const mapId = list.body[0].id;
    const res = await request(app)
      .put(`/admin/maps/${mapId}/layout`)
      .set(...auth(organizerToken))
      .send({
        elements: [],
        booths: [
          // Only include A2 and A3 — A1 is SOLD and would be deleted
          { label: 'A2', kind: 'BOOTH', x: 12, y: 0, w: 10, h: 10, rotation: 0, tierId: null },
          { label: 'A3', kind: 'TABLE', x: 0, y: 12, w: 10, h: 10, rotation: 0, tierId: null },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/BOOTH_IN_USE/);
  });

  // ─── Event map deep-link ────────────────────────────────────────

  it('GET /admin/events/:eventId/map returns the map id', async () => {
    const res = await request(app)
      .get(`/admin/events/${event.id}/map`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.mapId).toBeDefined();
  });

  it('GET /admin/events/:eventId/map returns 404 for event without map', async () => {
    const res = await request(app)
      .get(`/admin/events/${otherEvent.id}/map`)
      .set(...auth(organizerToken));
    expect(res.status).toBe(404);
  });
});