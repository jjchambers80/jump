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

  beforeAll(async () => {
    adminToken = generateToken({ role: 'ADMIN', email: 'admin@events-test.com' });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@events-test.com' });
    customerToken = generateToken({ role: 'CUSTOMER', email: 'customer@events-test.com' });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Events Test Org' });
    testOrgId = orgRes.body.id;

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
      expect(res.body).toHaveProperty('venue');
      expect(res.body.venue.id).toBe(testVenueId);
      expect(res.body).toHaveProperty('priceTiers');
      expect(res.body.priceTiers).toHaveLength(2);

      draftEventId = res.body.id;
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

    it('should include the organization theme mode', async () => {
      if (!publishedEventId) return;

      await prisma.organization.update({ where: { id: testOrgId }, data: { themeMode: 'DARK' } });
      try {
        const res = await request(app).get(`/events/${publishedEventId}`).expect(200);
        expect(res.body.organizationThemeMode).toBe('DARK');
      } finally {
        await prisma.organization.update({ where: { id: testOrgId }, data: { themeMode: 'USER' } });
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
});
