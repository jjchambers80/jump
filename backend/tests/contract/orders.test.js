// Contract tests for Orders API endpoints (Schema Redesign)
// Tests: POST /orders (guest checkout), GET /orders/:id, POST /orders/lookup,
//        GET /orders/my, GET /events/:eventId/orders (org-scoped)
// Per FR-052, FR-053, FR-054, contracts/api.yaml

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-order-user-id',
    email: overrides.email || 'organizer@orders-test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe BEFORE importing app (ESM requires mocks before dynamic import)
jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let sessionCounter = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn().mockImplementation((params) => {
            sessionCounter++;
            return Promise.resolve({
              id: `cs_test_${sessionCounter}`,
              url: `https://checkout.stripe.com/pay/cs_test_${sessionCounter}`,
              payment_intent: `pi_test_${sessionCounter}`,
              metadata: params.metadata,
            });
          }),
          retrieve: jest.fn().mockImplementation((sessionId) => {
            return Promise.resolve({
              id: sessionId,
              metadata: { priceTierId: 'mock-tier-id' },
            });
          }),
        },
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    },
  };
});

// Dynamic imports AFTER mock setup (ESM requirement)
const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Orders API Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;
  let customer2Token;
  let testOrgId;
  let testVenueId;
  let testEventId;
  let testTierId;
  let createdOrderId;
  let createdOrderRef;

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'admin-orders-id',
      role: 'ADMIN',
      email: 'admin@orders-test.com',
    });
    organizerToken = generateToken({
      id: 'org-orders-id',
      role: 'ORGANIZER',
      email: 'organizer@orders-test.com',
    });
    customerToken = generateToken({
      id: 'cust-orders-id',
      role: 'CUSTOMER',
      email: 'customer@orders-test.com',
    });
    customer2Token = generateToken({
      id: 'cust2-orders-id',
      role: 'CUSTOMER',
      email: 'customer2@orders-test.com',
    });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Orders Test Org' });
    testOrgId = orgRes.body.id;

    // Create test venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Orders Test Venue', address: '123 Order St' });
    testVenueId = venueRes.body.id;

    // Create test event with price tier
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: testVenueId,
        name: 'Order Test Event',
        description: 'Event for order testing',
        date: '2027-08-15T19:00:00.000Z',
        capacity: 100,
        category: 'music',
        priceTiers: [
          { name: 'General Admission', price: 25.0, quantityTotal: 80 },
          { name: 'VIP', price: 75.0, quantityTotal: 20, maxPerOrder: 4 },
        ],
      });
    testEventId = eventRes.body.id;
    testTierId = eventRes.body.priceTiers[0].id;

    // Publish the event
    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`);
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    await prisma.paymentTransaction.deleteMany({
      where: { order: { eventId: testEventId } },
    });
    await prisma.ticket.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.order.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.contact.deleteMany({
      where: {
        email: {
          in: ['guest@orders-test.com', 'guest2@orders-test.com', 'customer@orders-test.com'],
        },
      },
    });
    await prisma.priceTier.deleteMany({
      where: { eventId: testEventId },
    });
    await prisma.event.deleteMany({
      where: { id: testEventId },
    });
    await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  // ─── POST /orders ────────────────────────────────────────

  describe('POST /orders', () => {
    it('should return 201 with order and Stripe session URL for guest checkout', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: testTierId,
          quantity: 2,
          contact: {
            email: 'guest@orders-test.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('orderId');
      expect(res.body).toHaveProperty('orderRef');
      expect(res.body.orderRef).toMatch(/^JMP-[A-Z0-9]{6}$/);
      expect(res.body).toHaveProperty('stripeCheckoutUrl');
      expect(res.body.stripeCheckoutUrl).toContain('https://checkout.stripe.com');

      createdOrderId = res.body.orderId;
      createdOrderRef = res.body.orderRef;
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ eventId: testEventId }));

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when contact email is invalid', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: testTierId,
          quantity: 1,
          contact: {
            email: 'not-an-email',
            firstName: 'Bad',
            lastName: 'Email',
          },
        });

      expect(res.status).toBe(400);
    });

    it('should return 404 when event does not exist', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: 'nonexistent-event-id',
          priceTierId: testTierId,
          quantity: 1,
          contact: {
            email: 'guest@orders-test.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        });

      expect(res.status).toBe(404);
    });

    it('should return 404 when price tier does not exist', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: 'nonexistent-tier-id',
          quantity: 1,
          contact: {
            email: 'guest@orders-test.com',
            firstName: 'Jane',
            lastName: 'Doe',
          },
        });

      expect(res.status).toBe(404);
    });

    it('should return 409 when requesting more than available inventory', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: testTierId,
          quantity: 999,
          contact: {
            email: 'guest2@orders-test.com',
            firstName: 'Over',
            lastName: 'Capacity',
          },
        });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('error');
    });

    it('should upsert contact when same email orders again', async () => {
      const res = await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: testTierId,
          quantity: 1,
          contact: {
            email: 'guest@orders-test.com',
            firstName: 'Jane',
            lastName: 'Updated',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('orderId');
      // Verify contact was upserted (not duplicated)
      const contacts = await prisma.contact.findMany({
        where: { email: 'guest@orders-test.com' },
      });
      expect(contacts).toHaveLength(1);
      expect(contacts[0].lastName).toBe('Updated');
    });
  });

  // ─── GET /orders/:orderId ───────────────────────────────

  describe('GET /orders/:orderId', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get(`/orders/${createdOrderId}`);
      expect(res.status).toBe(401);
    });

    it('should return 200 with order detail for admin', async () => {
      const res = await request(app)
        .get(`/orders/${createdOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', createdOrderId);
      expect(res.body).toHaveProperty('orderRef');
      expect(res.body).toHaveProperty('event');
      expect(res.body.event).toHaveProperty('name', 'Order Test Event');
      expect(res.body).toHaveProperty('contact');
      expect(res.body.contact).toHaveProperty('email', 'guest@orders-test.com');
      expect(res.body).toHaveProperty('quantity');
      expect(res.body).toHaveProperty('totalAmount');
      expect(res.body).toHaveProperty('status', 'PENDING');
      expect(res.body).toHaveProperty('tickets');
      expect(res.body).toHaveProperty('payment');
      expect(res.body).toHaveProperty('createdAt');
    });

    it('should return 403 when customer tries to access another users order', async () => {
      const res = await request(app)
        .get(`/orders/${createdOrderId}`)
        .set('Authorization', `Bearer ${customer2Token}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent order', async () => {
      const res = await request(app)
        .get('/orders/nonexistent-order-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /orders/lookup ────────────────────────────────

  describe('POST /orders/lookup', () => {
    it('should return 200 with order detail for valid email + orderRef', async () => {
      const res = await request(app).post('/orders/lookup').send({
        email: 'guest@orders-test.com',
        orderRef: createdOrderRef,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', createdOrderId);
      expect(res.body).toHaveProperty('orderRef', createdOrderRef);
      expect(res.body).toHaveProperty('event');
      expect(res.body).toHaveProperty('contact');
    });

    it('should return 404 for wrong email', async () => {
      const res = await request(app).post('/orders/lookup').send({
        email: 'wrong@email.com',
        orderRef: createdOrderRef,
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for wrong orderRef', async () => {
      const res = await request(app).post('/orders/lookup').send({
        email: 'guest@orders-test.com',
        orderRef: 'JMP-ZZZZZZ',
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 when email is missing', async () => {
      const res = await request(app)
        .post('/orders/lookup')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ orderRef: createdOrderRef }));

      expect(res.status).toBe(400);
    });

    it('should return 400 when orderRef is missing', async () => {
      const res = await request(app)
        .post('/orders/lookup')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'guest@orders-test.com' }));

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /orders/my ─────────────────────────────────────

  describe('GET /orders/my', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/orders/my');
      expect(res.status).toBe(401);
    });

    it('should return 200 with empty list for customer with no orders', async () => {
      const res = await request(app)
        .get('/orders/my')
        .set('Authorization', `Bearer ${customer2Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toEqual([]);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total', 0);
    });

    it('should return 200 with orders for authenticated customer who has ordered', async () => {
      // Create an order with the customer email
      await request(app)
        .post('/orders')
        .send({
          eventId: testEventId,
          priceTierId: testTierId,
          quantity: 1,
          contact: {
            email: 'customer@orders-test.com',
            firstName: 'Test',
            lastName: 'Customer',
          },
        });

      const res = await request(app)
        .get('/orders/my')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toHaveProperty('orderRef');
      expect(res.body.data[0]).toHaveProperty('eventName');
      expect(res.body.data[0]).toHaveProperty('totalAmount');
      expect(res.body.data[0]).toHaveProperty('status');
      expect(res.body).toHaveProperty('pagination');
    });
  });

  // ─── GET /organizations/:orgId/events/:eventId/orders ───

  describe('GET /organizations/:orgId/events/:eventId/orders', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get(
        `/organizations/${testOrgId}/events/${testEventId}/orders`
      );

      expect(res.status).toBe(401);
    });

    it('should return 403 for customer role', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/orders`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
    });

    it('should return 200 with order list for organizer', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/orders`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('totalPages');
    });

    it('should return 200 with order list for admin', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/events/${testEventId}/orders`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });
  });
});
