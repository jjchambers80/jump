// Contract tests for Event Analytics API (Schema Redesign — T106)
// Tests: GET /organizations/:orgId/events/:eventId/analytics
// Per FR-057: org-scoped access, per-tier breakdown of sold/redeemed/remaining/revenue

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// Mock Stripe before importing app
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn(() => ({
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  })),
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'analytics-user-id',
    email: overrides.email || 'organizer@analytics-test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Analytics Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Event Analytics API Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;
  let testOrgId;
  let testVenueId;
  let testEventId;
  let testTierVipId;
  let testTierGaId;

  beforeAll(async () => {
    adminToken = generateToken({ role: 'ADMIN', email: 'admin@analytics-test.com' });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@analytics-test.com' });
    customerToken = generateToken({ role: 'CUSTOMER', email: 'customer@analytics-test.com' });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Analytics Test Org' });
    testOrgId = orgRes.body.id;

    // Create venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Analytics Venue', address: '123 Analytics Ave' });
    testVenueId = venueRes.body.id;

    // Create event with two price tiers
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: testVenueId,
        name: 'Analytics Concert',
        date: futureDate,
        capacity: 200,
        priceTiers: [
          { name: 'VIP', price: 10000, quantityTotal: 50 },
          { name: 'General Admission', price: 3500, quantityTotal: 150 },
        ],
      });
    testEventId = eventRes.body.id;

    // Get price tier IDs
    const tiers = eventRes.body.priceTiers;
    testTierVipId = tiers.find((t) => t.name === 'VIP').id;
    testTierGaId = tiers.find((t) => t.name === 'General Admission').id;

    // Publish event
    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`);

    // Create some orders to generate sold tickets
    // Contact for orders
    const contact = await prisma.contact.create({
      data: {
        email: 'buyer@analytics-test.com',
        firstName: 'Analytics',
        lastName: 'Buyer',
      },
    });

    // Create VIP order: 3 tickets sold
    const vipOrder = await prisma.order.create({
      data: {
        eventId: testEventId,
        contactId: contact.id,
        orderRef: 'ANA-VIP001',
        totalAmount: 30000,
        currency: 'usd',
        quantity: 3,
        status: 'COMPLETED',
      },
    });

    // Create 3 VIP tickets: 1 redeemed, 2 valid
    const vipTickets = [];
    for (let i = 0; i < 3; i++) {
      const ticket = await prisma.ticket.create({
        data: {
          orderId: vipOrder.id,
          eventId: testEventId,
          priceTierId: testTierVipId,
          contactId: contact.id,
          pricePaid: 10000,
          barcode: `ANA-VIP-${i + 1}`,
          status: i === 0 ? 'REDEEMED' : 'VALID',
          redeemedAt: i === 0 ? new Date() : null,
        },
      });
      vipTickets.push(ticket);
    }

    // Create GA order: 5 tickets sold
    const gaOrder = await prisma.order.create({
      data: {
        eventId: testEventId,
        contactId: contact.id,
        orderRef: 'ANA-GA001',
        totalAmount: 17500,
        currency: 'usd',
        quantity: 5,
        status: 'COMPLETED',
      },
    });

    // Create 5 GA tickets: 2 redeemed, 3 valid
    for (let i = 0; i < 5; i++) {
      await prisma.ticket.create({
        data: {
          orderId: gaOrder.id,
          eventId: testEventId,
          priceTierId: testTierGaId,
          contactId: contact.id,
          pricePaid: 3500,
          barcode: `ANA-GA-${i + 1}`,
          status: i < 2 ? 'REDEEMED' : 'VALID',
          redeemedAt: i < 2 ? new Date() : null,
        },
      });
    }

    // Update quantitySold on price tiers to match
    await prisma.priceTier.update({
      where: { id: testTierVipId },
      data: { quantitySold: 3 },
    });
    await prisma.priceTier.update({
      where: { id: testTierGaId },
      data: { quantitySold: 5 },
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    await prisma.ticket.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.order.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.priceTier.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.event.deleteMany({
      where: { id: testEventId },
    });
    await prisma.venue.deleteMany({
      where: { organizationId: testOrgId },
    });
    await prisma.contact.deleteMany({
      where: { email: 'buyer@analytics-test.com' },
    });
    await prisma.organization.deleteMany({
      where: { id: testOrgId },
    });
    await prisma.$disconnect();
  });

  // ─── GET /organizations/:orgId/events/:eventId/analytics ───

  describe('GET /organizations/:orgId/events/:eventId/analytics', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get(
        `/organizations/${testOrgId}/events/${testEventId}/analytics`
      );
      expect(res.status).toBe(401);
    });

    it('should return 403 for customer role', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/analytics`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with per-tier analytics for organizer', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/analytics`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);

      // Event info
      expect(res.body).toHaveProperty('event');
      expect(res.body.event).toHaveProperty('id', testEventId);
      expect(res.body.event).toHaveProperty('name', 'Analytics Concert');
      expect(res.body.event).toHaveProperty('status', 'PUBLISHED');
      expect(res.body.event).toHaveProperty('capacity', 200);
      expect(res.body.event).toHaveProperty('venue');

      // Totals
      expect(res.body).toHaveProperty('totals');
      expect(res.body.totals).toHaveProperty('sold', 8); // 3 VIP + 5 GA
      expect(res.body.totals).toHaveProperty('redeemed', 3); // 1 VIP + 2 GA
      expect(res.body.totals).toHaveProperty('remaining'); // depends on reserved
      expect(res.body.totals).toHaveProperty('revenue');
      // Revenue: (3 × 100.00) + (5 × 35.00) = 300 + 175 = 475
      expect(res.body.totals.revenue).toBe(47500);

      // Per-tier breakdown
      expect(res.body).toHaveProperty('tiers');
      expect(res.body.tiers).toHaveLength(2);

      // VIP tier
      const vipTier = res.body.tiers.find((t) => t.name === 'VIP');
      expect(vipTier).toBeDefined();
      expect(vipTier.sold).toBe(3);
      expect(vipTier.redeemed).toBe(1);
      expect(vipTier.remaining).toBe(47); // 50 - 3 sold
      expect(vipTier.revenue).toBe(30000); // 3 × 10000
      expect(vipTier.price).toBe(10000);
      expect(vipTier.quantityTotal).toBe(50);

      // GA tier
      const gaTier = res.body.tiers.find((t) => t.name === 'General Admission');
      expect(gaTier).toBeDefined();
      expect(gaTier.sold).toBe(5);
      expect(gaTier.redeemed).toBe(2);
      expect(gaTier.remaining).toBe(145); // 150 - 5 sold
      expect(gaTier.revenue).toBe(17500); // 5 × 3500
    });

    it('should return 200 with analytics for admin', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('event');
      expect(res.body).toHaveProperty('totals');
      expect(res.body).toHaveProperty('tiers');
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/nonexistent-id/analytics`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(404);
    });
  });
});
