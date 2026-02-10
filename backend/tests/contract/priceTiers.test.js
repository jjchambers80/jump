// Contract tests for Price Tier endpoints
// Tests: GET/POST /organizations/:orgId/events/:eventId/price-tiers,
//        PATCH /.../:priceTierId, POST activate/deactivate, POST reorder
// Per FR-051, FR-015, contracts/api.yaml

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-user-id',
    email: overrides.email || 'organizer@tiers-test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Price Tier Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;
  let testOrgId;
  let testVenueId;
  let testEventId;

  beforeAll(async () => {
    adminToken = generateToken({ role: 'ADMIN', email: 'admin@tiers-test.com' });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@tiers-test.com' });
    customerToken = generateToken({ role: 'CUSTOMER', email: 'customer@tiers-test.com' });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Tier Test Org' });
    testOrgId = orgRes.body.id;

    // Create test venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Tier Test Venue', address: '456 Tier St' });
    testVenueId = venueRes.body.id;

    // Create a test event with initial price tier (capacity 500)
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: testVenueId,
        name: 'Tier Test Event',
        date: '2027-06-15T19:00:00.000Z',
        capacity: 500,
        priceTiers: [{ name: 'Initial Tier', price: 10.0, quantityTotal: 100 }],
      });
    testEventId = eventRes.body.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.priceTier.deleteMany({
      where: { event: { venue: { organizationId: testOrgId } } },
    });
    await prisma.event.deleteMany({
      where: { venue: { organizationId: testOrgId } },
    });
    await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  describe('POST /organizations/:orgId/events/:eventId/price-tiers', () => {
    it('should return 201 when organizer adds a price tier', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'VIP',
          price: 75.0,
          quantityTotal: 50,
          displayOrder: 1,
          maxPerOrder: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('VIP');
      expect(res.body.quantityTotal).toBe(50);
      expect(res.body.isActive).toBe(true);
    });

    it('should return 201 when admin adds a price tier', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Early Bird',
          price: 15.0,
          quantityTotal: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Early Bird');
    });

    it('should return 403 when customer tries to add tier', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Hacked Tier',
          price: 1.0,
          quantityTotal: 10,
        });

      expect(res.status).toBe(403);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Incomplete Tier' });

      expect([400, 422]).toContain(res.status);
    });

    it('should return 400/422 when total tier quantities exceed event capacity', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Overflow Tier',
          price: 5.0,
          quantityTotal: 9999, // Would exceed capacity of 500
        });

      expect([400, 422]).toContain(res.status);
    });
  });

  describe('GET /organizations/:orgId/events/:eventId/price-tiers', () => {
    it('should return 200 with price tiers list', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .expect(200);

      expect(res.body).toHaveProperty('priceTiers');
      expect(Array.isArray(res.body.priceTiers)).toBe(true);
      expect(res.body.priceTiers.length).toBeGreaterThan(0);

      // Verify structure
      const tier = res.body.priceTiers[0];
      expect(tier).toHaveProperty('id');
      expect(tier).toHaveProperty('name');
      expect(tier).toHaveProperty('price');
      expect(tier).toHaveProperty('quantityTotal');
      expect(tier).toHaveProperty('isActive');
    });
  });

  describe('PATCH /organizations/:orgId/events/:eventId/price-tiers/:id', () => {
    it('should return 200 when organizer updates a price tier', async () => {
      // Get existing tiers
      const listRes = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .expect(200);

      const tierId = listRes.body.priceTiers[0].id;

      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}/price-tiers/${tierId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Updated Tier Name', price: 12.5 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Tier Name');
    });

    it('should return 404 for non-existent tier', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}/price-tiers/clnonexistent000000`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Ghost Tier' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST activate/deactivate', () => {
    let tierId;

    beforeAll(async () => {
      // Create a tier to toggle
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Toggleable Tier',
          price: 30.0,
          quantityTotal: 20,
        });
      tierId = res.body.id;
    });

    it('should deactivate a tier and return 200', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers/${tierId}/deactivate`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    it('should activate a tier and return 200', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers/${tierId}/activate`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
    });
  });

  describe('POST reorder', () => {
    it('should reorder tiers and return 200', async () => {
      // Get current tiers
      const listRes = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/price-tiers`)
        .expect(200);

      const tierIds = listRes.body.priceTiers.map((t) => t.id);
      // Reverse the order
      const reversed = [...tierIds].reverse();

      const res = await request(app)
        .post(`/organizations/${testOrgId}/events/${testEventId}/price-tiers/reorder`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ tierIds: reversed });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('priceTiers');
      // First tier should be the last from original order
      expect(res.body.priceTiers[0].id).toBe(reversed[0]);
    });
  });
});
