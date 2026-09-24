// Contract tests for Events API endpoints (Schema Redesign)
// Tests: GET /events (public), GET /events/:id (public),
//        GET/POST /organizations/:orgId/events (org-scoped),
//        PATCH /organizations/:orgId/events/:id,
//        POST .../events/:id/publish, POST .../events/:id/cancel
// Per FR-050, contracts/api.yaml

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-user-id',
    email: overrides.email || 'organizer@events-test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Events API Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;
  let testOrgId;
  let testVenueId;
  let publishedEventId;
  let draftEventId;
  let searchOrgId;

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: 'admin@events-test.com' });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: 'organizer@events-test.com' });
    customerToken = generateToken({ role: 'UNASSIGNED', email: 'customer@events-test.com' });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Events Test Org' });
    testOrgId = orgRes.body.id;
    await joinOrgByToken(adminToken, testOrgId, 'ADMIN');
    await joinOrgByToken(organizerToken, testOrgId, 'ORGANIZER');

    // Create test venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Event Test Venue', address: '123 Event St' });
    testVenueId = venueRes.body.id;
  });

  afterAll(async () => {
    // Clean up test data in reverse dependency order
    await prisma.priceTier.deleteMany({
      where: { event: { venue: { organizationId: testOrgId } } },
    });
    await prisma.event.deleteMany({
      where: { venue: { organizationId: testOrgId } },
    });
    await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  describe('POST /organizations/:orgId/events', () => {
    it('should return 201 when organizer creates an event with price tiers', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Summer Concert',
          description: 'A great summer concert',
          date: '2027-07-15T19:00:00.000Z',
          capacity: 500,
          category: 'music',
          priceTiers: [
            { name: 'General Admission', price: 25.0, quantityTotal: 400 },
            { name: 'VIP', price: 75.0, quantityTotal: 100, maxPerOrder: 4 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Summer Concert');
      expect(res.body.status).toBe('DRAFT');
      expect(res.body).toMatchObject({ slug: 'summer-concert', slugCustomized: false });
      expect(res.body).toHaveProperty('venue');
      expect(res.body.venue.id).toBe(testVenueId);
      expect(res.body).toHaveProperty('priceTiers');
      expect(res.body.priceTiers).toHaveLength(2);

      draftEventId = res.body.id;
    });

    it('accepts a custom slug and rejects a duplicate custom slug', async () => {
      const slug = `custom-event-${Date.now()}`;
      const body = {
        venueId: testVenueId,
        name: 'Custom URL Event',
        slug,
        date: '2027-07-16T19:00:00.000Z',
        capacity: 10,
        priceTiers: [{ name: 'GA', price: 10, quantityTotal: 10 }],
      };
      const first = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send(body);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ slug, slugCustomized: true });

      const duplicate = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ ...body, name: 'Duplicate URL Event', date: '2027-07-17T19:00:00.000Z' });
      expect(duplicate.status).toBe(409);
    });

    it('should return 201 when admin creates an event', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          venueId: testVenueId,
          name: 'Admin Created Event',
          date: '2027-08-20T18:00:00.000Z',
          capacity: 200,
          priceTiers: [{ name: 'Standard', price: 30.0, quantityTotal: 200 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Admin Created Event');
    });

    it('should return 403 when customer tries to create event', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Unauthorized Event',
          date: '2027-09-01T18:00:00.000Z',
          capacity: 100,
          priceTiers: [{ name: 'GA', price: 10.0, quantityTotal: 100 }],
        });

      expect(res.status).toBe(403);
    });

    it('should return 401 when no token is provided', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            venueId: testVenueId,
            name: 'No Auth Event',
            date: '2027-09-01T18:00:00.000Z',
            capacity: 100,
            priceTiers: [{ name: 'GA', price: 10.0, quantityTotal: 100 }],
          })
        );

      expect(res.status).toBe(401);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Incomplete Event' });

      expect([400, 422]).toContain(res.status);
    });

    it('should return 400 when price tier quantities exceed event capacity', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Overcapacity Event',
          date: '2027-10-01T18:00:00.000Z',
          capacity: 100,
          priceTiers: [
            { name: 'GA', price: 10.0, quantityTotal: 80 },
            { name: 'VIP', price: 50.0, quantityTotal: 30 },
          ],
        });

      expect([400, 422]).toContain(res.status);
    });
  });

  describe('GET /events (public)', () => {
    beforeAll(async () => {
      // Publish an event for public listing
      if (draftEventId) {
        await request(app)
          .post(`/organizations/${testOrgId}/events/${draftEventId}/publish`)
          .set('Authorization', `Bearer ${organizerToken}`);
        publishedEventId = draftEventId;
      }
    });

    it('should return 200 with published events only (no auth required)', async () => {
      const res = await request(app).get('/events').expect(200);

      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.events)).toBe(true);

      // All returned events should be PUBLISHED
      res.body.events.forEach((event) => {
        expect(event.status).toBe('PUBLISHED');
      });
    });

    it('should return events with venue info', async () => {
      const res = await request(app).get('/events').expect(200);

      if (res.body.events.length > 0) {
        const event = res.body.events[0];
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('date');
        expect(event).toHaveProperty('venue');
        expect(event).toHaveProperty('status');
      }
    });

    it('should support pagination', async () => {
      const res = await request(app).get('/events?page=1&limit=5').expect(200);

      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('page');
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('totalPages');
    });
  });

  describe('GET /events/:eventId (public)', () => {
    it('should return 200 with event details including venue and price tiers', async () => {
      if (!publishedEventId) return;

      const res = await request(app).get(`/events/${publishedEventId}`).expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body.id).toBe(publishedEventId);
      expect(res.body).toHaveProperty('venue');
      expect(res.body).toHaveProperty('priceTiers');
      expect(Array.isArray(res.body.priceTiers)).toBe(true);
    });

    it('should include the organization brand color', async () => {
      if (!publishedEventId) return;

      await prisma.organization.update({ where: { id: testOrgId }, data: { brandColor: '#4338ca' } });
      try {
        const res = await request(app).get(`/events/${publishedEventId}`).expect(200);
        expect(res.body.organizationId).toBe(testOrgId);
        expect(res.body.organizationBrandColor).toBe('#4338ca');
      } finally {
        await prisma.organization.update({ where: { id: testOrgId }, data: { brandColor: null } });
      }
    });

    it('should include the organization logo for the storefront header', async () => {
      if (!publishedEventId) return;

      await prisma.organization.update({ where: { id: testOrgId }, data: { logoUrl: '/uploads/org-logo.png' } });
      try {
        const res = await request(app).get(`/events/${publishedEventId}`).expect(200);
        expect(res.body.organizationLogoUrl).toBe('/uploads/org-logo.png');
      } finally {
        await prisma.organization.update({ where: { id: testOrgId }, data: { logoUrl: null } });
      }
    });

    it('should include the organization theme mode', async () => {
      if (!publishedEventId) return;

      await prisma.organization.update({ where: { id: testOrgId }, data: { themeMode: 'DARK' } });
      try {
        const res = await request(app).get(`/events/${publishedEventId}`).expect(200);
        expect(res.body.organizationThemeMode).toBe('DARK');
      } finally {
        await prisma.organization.update({ where: { id: testOrgId }, data: { themeMode: 'SYSTEM' } });
      }
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app).get('/events/clnonexistent000000').expect(404);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 for draft events (not publicly visible)', async () => {
      // Create a draft event
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Hidden Draft',
          date: '2027-11-01T18:00:00.000Z',
          capacity: 50,
          priceTiers: [{ name: 'GA', price: 10.0, quantityTotal: 50 }],
        });

      const draftId = createRes.body.id;
      const res = await request(app).get(`/events/${draftId}`).expect(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /organizations/:orgId/events (org-scoped)', () => {
    it('should return 200 with all events (all statuses) for organizer', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThan(0);
    });

    it('should return 403 for customers', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
    });

    it('should support status filter', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events?status=DRAFT`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      res.body.events.forEach((event) => {
        expect(event.status).toBe('DRAFT');
      });
    });
  });

  describe('PATCH /organizations/:orgId/events/:id', () => {
    it('should return 200 when organizer updates event', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Updatable Event',
          date: '2027-12-01T18:00:00.000Z',
          capacity: 200,
          priceTiers: [{ name: 'GA', price: 15.0, quantityTotal: 200 }],
        });

      const eventId = createRes.body.id;

      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${eventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Updated Event Name', capacity: 300 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Event Name');
      expect(res.body.capacity).toBe(300);
    });

    it('should return 403 for customers', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/some-id`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /organizations/:orgId/events/:id/publish', () => {
    it('should return 200 and transition DRAFT → PUBLISHED', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Publishable Event',
          date: '2027-12-15T18:00:00.000Z',
          capacity: 100,
          priceTiers: [{ name: 'GA', price: 20.0, quantityTotal: 100 }],
        });

      const eventId = createRes.body.id;

      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('should return 409 when publishing already published event', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Already Published',
          date: '2027-12-20T18:00:00.000Z',
          capacity: 50,
          priceTiers: [{ name: 'GA', price: 10.0, quantityTotal: 50 }],
        });

      const eventId = createRes.body.id;

      await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(409);
    });
  });

  describe('POST /organizations/:orgId/events/:id/cancel', () => {
    it('should return 200 and transition PUBLISHED → CANCELLED', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Cancellable Event',
          date: '2027-12-25T18:00:00.000Z',
          capacity: 100,
          priceTiers: [{ name: 'GA', price: 20.0, quantityTotal: 100 }],
        });

      const eventId = createRes.body.id;

      await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('should return 409 when cancelling a DRAFT event', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Draft Cancel Attempt',
          date: '2027-12-30T18:00:00.000Z',
          capacity: 50,
          priceTiers: [{ name: 'GA', price: 10.0, quantityTotal: 50 }],
        });

      const eventId = createRes.body.id;

      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(409);
    });
  });

  describe('JUMP-035A: Events list — search, category, sort', () => {
    let searchVenueId;
    const searchOrgName = '035A Search Org';

    beforeAll(async () => {
      const orgRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: searchOrgName });
      searchOrgId = orgRes.body.id;
      await joinOrgByToken(adminToken, searchOrgId, 'ADMIN');
      await joinOrgByToken(organizerToken, searchOrgId, 'ORGANIZER');

      const venueRes = await request(app)
        .post(`/organizations/${searchOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: '035A Search Venue', address: '1 Search St' });
      searchVenueId = venueRes.body.id;
    });

    afterAll(async () => {
      await prisma.eventRsvp.deleteMany({ where: { event: { venue: { organizationId: searchOrgId } } } });
      await prisma.order.deleteMany({ where: { event: { venue: { organizationId: searchOrgId } } } });
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: searchOrgId } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: searchOrgId } } });
      await prisma.venue.deleteMany({ where: { organizationId: searchOrgId } });
      await prisma.organization.deleteMany({ where: { id: searchOrgId } });
    });

    async function createEvent(name, overrides = {}) {
      const res = await request(app)
        .post(`/organizations/${searchOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: searchVenueId,
          name,
          date: overrides.date || '2027-07-15T19:00:00.000Z',
          capacity: overrides.capacity || 100,
          category: overrides.category || null,
          admissionMode: overrides.admissionMode || 'TICKETED',
          ...(overrides.admissionMode === 'RSVP' ? {} : { priceTiers: overrides.priceTiers || [{ name: 'GA', price: 25, quantityTotal: 100 }] }),
          ...overrides,
        });
      return res.body;
    }

    describe('search (q)', () => {
      beforeAll(async () => {
        await createEvent('Alpha Show', { date: '2027-08-01T19:00:00.000Z', category: 'music' });
        await createEvent('Beta Concert', { date: '2027-08-02T19:00:00.000Z', category: 'music' });
        await createEvent('Gamma Night', { date: '2027-08-03T19:00:00.000Z', category: 'tech' });
      });

      it('filters by event name (case-insensitive substring)', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?q=alpha`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events).toHaveLength(1);
        expect(res.body.events[0].name).toBe('Alpha Show');
      });

      it('returns all events when q matches multiple names', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?q=a`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events.length).toBeGreaterThan(1);
      });

      it('returns empty list when q matches nothing', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?q=zzzzzznonexistent`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events).toHaveLength(0);
        expect(res.body.pagination.total).toBe(0);
      });
    });

    describe('category filter', () => {
      it('filters by category', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?category=music`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events.length).toBeGreaterThan(0);
        res.body.events.forEach((e) => {
          expect(e.category).toBe('music');
        });
      });

      it('returns empty list for non-existent category', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?category=nonexistent`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events).toHaveLength(0);
      });
    });

    describe('sort', () => {
      it('rejects unknown sort with 400', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?sort=invalid_sort`)
          .set('Authorization', `Bearer ${organizerToken}`);

        expect(res.status).toBe(400);
      });

      it('defaults to upcoming sort', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        expect(res.body.events.length).toBeGreaterThan(0);
      });

      it('sorts by date_desc', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?sort=date_desc`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        const dates = res.body.events.map((e) => new Date(e.date).getTime());
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
        }
      });

      it('sorts by name_asc', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?sort=name_asc`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        const names = res.body.events.map((e) => e.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
      });

      it('sorts by created_desc', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events?sort=created_desc`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        const createdAt = res.body.events.map((e) => new Date(e.createdAt).getTime());
        for (let i = 1; i < createdAt.length; i++) {
          expect(createdAt[i - 1]).toBeGreaterThanOrEqual(createdAt[i]);
        }
      });
    });

    describe('rsvpGoingCount', () => {
      let rsvpEventId;

      beforeAll(async () => {
        const event = await createEvent('RSVP Party', {
          admissionMode: 'RSVP',
          rsvpLimit: 50,
          rsvpMaxPartySize: 5,
          priceTiers: undefined,
          date: '2027-09-01T19:00:00.000Z',
        });
        rsvpEventId = event.id;

        await request(app)
          .post(`/organizations/${searchOrgId}/events/${rsvpEventId}/publish`)
          .set('Authorization', `Bearer ${organizerToken}`);
      });

      it('includes rsvpGoingCount for RSVP events', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        const rsvpEvent = res.body.events.find((e) => e.id === rsvpEventId);
        expect(rsvpEvent).toBeDefined();
        expect(rsvpEvent.rsvpGoingCount).toBe(0);
        expect(rsvpEvent.admissionMode).toBe('RSVP');
      });

      it('returns null rsvpGoingCount for ticketed events', async () => {
        const res = await request(app)
          .get(`/organizations/${searchOrgId}/events`)
          .set('Authorization', `Bearer ${organizerToken}`)
          .expect(200);

        const ticketedEvent = res.body.events.find((e) => e.admissionMode === 'TICKETED');
        expect(ticketedEvent).toBeDefined();
        expect(ticketedEvent.rsvpGoingCount).toBeNull();
      });
    });
  });

  describe('JUMP-035A: Events summary', () => {
    let summaryOrgId;
    let summaryVenueId;
    let summaryPublishedEventId;
    let summarySecondPublishedId;
    let summaryRsvpEventId;

    beforeAll(async () => {
      const orgRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '035A Summary Org' });
      summaryOrgId = orgRes.body.id;
      await joinOrgByToken(adminToken, summaryOrgId, 'ADMIN');
      await joinOrgByToken(organizerToken, summaryOrgId, 'ORGANIZER');

      const venueRes = await request(app)
        .post(`/organizations/${summaryOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: '035A Summary Venue', address: '2 Summary St' });
      summaryVenueId = venueRes.body.id;

      // Create TICKETED published event with sales
      const pub1 = await request(app)
        .post(`/organizations/${summaryOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: summaryVenueId,
          name: 'Summary Published Concert',
          date: '2027-08-15T19:00:00.000Z',
          capacity: 500,
          category: 'music',
          priceTiers: [{ name: 'GA', price: 25, quantityTotal: 400 }, { name: 'VIP', price: 75, quantityTotal: 100 }],
        });
      summaryPublishedEventId = pub1.body.id;
      await request(app)
        .post(`/organizations/${summaryOrgId}/events/${summaryPublishedEventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      // Another published event
      const pub2 = await request(app)
        .post(`/organizations/${summaryOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: summaryVenueId,
          name: 'Summary Tech Talk',
          date: '2027-09-01T18:00:00.000Z',
          capacity: 200,
          category: 'tech',
          priceTiers: [{ name: 'Standard', price: 10, quantityTotal: 200 }],
        });
      summarySecondPublishedId = pub2.body.id;
      await request(app)
        .post(`/organizations/${summaryOrgId}/events/${summarySecondPublishedId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      // Create a draft (TICKETED)
      const draft = await request(app)
        .post(`/organizations/${summaryOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: summaryVenueId,
          name: 'Summary Draft Event',
          date: '2027-10-01T18:00:00.000Z',
          capacity: 100,
          category: 'music',
          priceTiers: [{ name: 'GA', price: 10, quantityTotal: 100 }],
        });
      // Leave as DRAFT

      // Create an RSVP event and publish it
      const rsvp = await request(app)
        .post(`/organizations/${summaryOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: summaryVenueId,
          name: 'Summary RSVP Party',
          admissionMode: 'RSVP',
          rsvpLimit: 50,
          rsvpMaxPartySize: 5,
          date: '2027-09-15T20:00:00.000Z',
          category: 'tech',
        });
      summaryRsvpEventId = rsvp.body.id;
      await request(app)
        .post(`/organizations/${summaryOrgId}/events/${summaryRsvpEventId}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      // Create a cancelled event (publish then cancel)
      const canc = await request(app)
        .post(`/organizations/${summaryOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: summaryVenueId,
          name: 'Summary Cancelled Event',
          date: '2027-11-01T18:00:00.000Z',
          capacity: 50,
          category: 'sports',
          priceTiers: [{ name: 'GA', price: 5, quantityTotal: 50 }],
        });
      await request(app)
        .post(`/organizations/${summaryOrgId}/events/${canc.body.id}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);
      await request(app)
        .post(`/organizations/${summaryOrgId}/events/${canc.body.id}/cancel`)
        .set('Authorization', `Bearer ${organizerToken}`);
    });

    afterAll(async () => {
      await prisma.eventRsvp.deleteMany({ where: { event: { venue: { organizationId: summaryOrgId } } } });
      await prisma.order.deleteMany({ where: { event: { venue: { organizationId: summaryOrgId } } } });
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: summaryOrgId } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: summaryOrgId } } });
      await prisma.venue.deleteMany({ where: { organizationId: summaryOrgId } });
      await prisma.organization.deleteMany({ where: { id: summaryOrgId } });
    });

    it('returns summary with counts, published, drafts, registered, inventory, and categories', async () => {
      const res = await request(app)
        .get(`/organizations/${summaryOrgId}/events/summary`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('counts');
      expect(res.body.counts).toMatchObject({
        all: expect.any(Number),
        DRAFT: expect.any(Number),
        PUBLISHED: expect.any(Number),
        CANCELLED: expect.any(Number),
      });
      expect(res.body.counts.DRAFT).toBeGreaterThanOrEqual(1);
      expect(res.body.counts.PUBLISHED).toBeGreaterThanOrEqual(3); // 2 ticketed + 1 RSVP
      expect(res.body.counts.CANCELLED).toBeGreaterThanOrEqual(1);

      expect(res.body).toHaveProperty('published');
      expect(res.body.published.count).toBeGreaterThanOrEqual(3);
      expect(res.body.published.capacity).toBeGreaterThan(0);

      expect(res.body).toHaveProperty('drafts');
      expect(res.body.drafts.count).toBeGreaterThanOrEqual(1);

      expect(res.body).toHaveProperty('registered');
      expect(res.body.registered).toMatchObject({
        tickets: expect.any(Number),
        rsvps: expect.any(Number),
      });

      expect(res.body).toHaveProperty('inventory');
      expect(res.body.inventory).toMatchObject({
        available: expect.any(Number),
        tiers: expect.any(Number),
      });
      expect(res.body.inventory.tiers).toBe(3); // 2 published ticketed events with 2+1 tiers

      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories).toContain('music');
      expect(res.body.categories).toContain('tech');
    });

    it('respects category filter — categories reflect unfiltered set', async () => {
      const res = await request(app)
        .get(`/organizations/${summaryOrgId}/events/summary?category=tech`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      // Counts honor the filter: only tech events
      expect(res.body.counts.PUBLISHED).toBeGreaterThanOrEqual(2); // Tech Talk + RSVP Party
      // Categories come from the unfiltered set (spec §6.2)
      expect(res.body.categories).toContain('music');
      expect(res.body.categories).toContain('tech');
    });

    it('respects q filter', async () => {
      const res = await request(app)
        .get(`/organizations/${summaryOrgId}/events/summary?q=concert`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      expect(res.body.counts.all).toBeGreaterThanOrEqual(1);
      expect(res.body.categories).toContain('music');
    });

    it('does not count another org events', async () => {
      const res = await request(app)
        .get(`/organizations/${searchOrgId}/events/summary`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      // searchOrgId has the 035A search events but not the summary events
      expect(res.body.counts.all).toBeGreaterThanOrEqual(0);
      expect(res.body.counts.all).toBeLessThan(10);
    });
  });

  describe('JUMP-035D: Events CSV export', () => {
    let csvOrgId;
    let csvVenueId;

    beforeAll(async () => {
      const orgRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '035D CSV Org' });
      csvOrgId = orgRes.body.id;
      await joinOrgByToken(adminToken, csvOrgId, 'ADMIN');
      await joinOrgByToken(organizerToken, csvOrgId, 'ORGANIZER');

      const venueRes = await request(app)
        .post(`/organizations/${csvOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'CSV Venue', address: '1 CSV St' });
      csvVenueId = venueRes.body.id;

      // TICKETED published event
      const ticketedRes = await request(app)
        .post(`/organizations/${csvOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: csvVenueId,
          name: 'CSV Concert',
          date: '2027-08-15T19:00:00.000Z',
          capacity: 300,
          category: 'music',
          priceTiers: [
            { name: 'GA', price: 25, quantityTotal: 200 },
            { name: 'VIP', price: 75, quantityTotal: 100 },
          ],
        });
      await request(app)
        .post(`/organizations/${csvOrgId}/events/${ticketedRes.body.id}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      // RSVP published event
      const rsvpRes = await request(app)
        .post(`/organizations/${csvOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: csvVenueId,
          name: 'CSV RSVP Party',
          admissionMode: 'RSVP',
          rsvpLimit: 50,
          rsvpMaxPartySize: 5,
          date: '2027-09-01T20:00:00.000Z',
        });
      await request(app)
        .post(`/organizations/${csvOrgId}/events/${rsvpRes.body.id}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);

      // Draft event with formula-injection-prone name
      await request(app)
        .post(`/organizations/${csvOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: csvVenueId,
          name: '=SUM(A1:A10)',
          date: '2027-10-01T18:00:00.000Z',
          capacity: 100,
          category: 'tech',
          priceTiers: [{ name: 'GA', price: 10, quantityTotal: 100 }],
        });
    });

    afterAll(async () => {
      await prisma.eventRsvp.deleteMany({ where: { event: { venue: { organizationId: csvOrgId } } } });
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: csvOrgId } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: csvOrgId } } });
      await prisma.venue.deleteMany({ where: { organizationId: csvOrgId } });
      await prisma.organization.deleteMany({ where: { id: csvOrgId } });
    });

    it('returns CSV with expected headers and rows', async () => {
      const res = await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment;/);
      expect(res.headers['content-disposition']).toMatch(/events-csv-org-.*\.csv/);

      const lines = res.text.split('\r\n').filter(Boolean);
      // Header + 3 events
      expect(lines.length).toBeGreaterThanOrEqual(4);

      const header = lines[0].split(',');
      expect(header).toContain('name');
      expect(header).toContain('status');
      expect(header).toContain('admissionMode');
      expect(header).toContain('date');
      expect(header).toContain('venue');
      expect(header).toContain('category');
      expect(header).toContain('tiers');

      // Find the ticketed CSV Concert row
      const concertLine = lines.find((l) => l.startsWith('CSV Concert'));
      expect(concertLine).toBeDefined();
      expect(concertLine).toContain('PUBLISHED');
      expect(concertLine).toContain('TICKETED');
      expect(concertLine).toContain('CSV Venue');
      expect(concertLine).toContain('music');
      // should contain tier names
      expect(concertLine).toContain('GA; VIP');

      // Find the RSVP event row
      const rsvpLine = lines.find((l) => l.startsWith('CSV RSVP Party'));
      expect(rsvpLine).toBeDefined();
      expect(rsvpLine).toContain('RSVP');
      // RSVP events should have empty tiers and rsvpsGoing=0
      const rsvpCells = rsvpLine.split(',');
      const tiersIdx = header.indexOf('tiers');
      const rsvpGoingIdx = header.indexOf('rsvpsGoing');
      expect(rsvpCells[tiersIdx]).toBe(''); // empty tiers column
      expect(rsvpCells[rsvpGoingIdx]).toBe('0'); // rsvps going at 0
    });

    it('escapes formula-injection cells starting with =', async () => {
      const res = await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      const formulaLine = lines.find((l) => l.includes('SUM'));
      expect(formulaLine).toBeDefined();
      // Name starts with =SUM, so the cell should be escaped with leading '
      expect(formulaLine).toMatch(/^'=SUM/);
    });

    it('honors status filter', async () => {
      const res = await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv?status=DRAFT`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      // Header + draft events only
      const dataLines = lines.slice(1);
      expect(dataLines.length).toBeGreaterThanOrEqual(1);
      for (const line of dataLines) {
        expect(line).toContain('DRAFT');
      }
      // No published events
      const publishedLine = dataLines.find((l) => l.includes('PUBLISHED'));
      expect(publishedLine).toBeUndefined();
    });

    it('honors category filter', async () => {
      const res = await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv?category=music`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      const dataLines = lines.slice(1);
      expect(dataLines.length).toBeGreaterThanOrEqual(1);
      for (const line of dataLines) {
        expect(line).toContain('music');
      }
      // No non-music events
      const techLine = dataLines.find((l) => l.includes('tech'));
      expect(techLine).toBeUndefined();
    });

    it('respects org isolation — another org is empty', async () => {
      // searchOrgId from 035A has events but not csvOrgId's events
      const res = await request(app)
        .get(`/organizations/${searchOrgId}/events/export.csv?status=PUBLISHED`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      // searchOrgId has its own events; they should not show csv org's events
      const csvConcertLine = lines.find((l) => l.startsWith('CSV Concert'));
      expect(csvConcertLine).toBeUndefined();
    });

    it('requires auth', async () => {
      await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv`)
        .expect(401);
    });

    it('returns 400 for invalid sort', async () => {
      await request(app)
        .get(`/organizations/${csvOrgId}/events/export.csv?sort=invalid`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .expect(400);
    });
  });
});
