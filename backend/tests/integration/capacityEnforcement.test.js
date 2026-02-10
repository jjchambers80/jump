// Integration test for capacity enforcement under concurrent load (Schema Redesign)
// Simulates concurrent order requests to verify inventory reservation prevents overselling
// Per FR-023, FR-025: quantitySold + quantityReserved ≤ quantityTotal

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'cap-user-id',
    email: overrides.email || 'organizer@capacity-integ.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Cap Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe BEFORE importing app
jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let counter = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn().mockImplementation((params) => {
            const id = `cs_cap_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
            return Promise.resolve({
              id,
              url: `https://checkout.stripe.com/pay/${id}`,
              payment_intent: `pi_cap_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`,
              metadata: params.metadata,
            });
          }),
          retrieve: jest.fn().mockImplementation((sessionId) => {
            return Promise.resolve({ id: sessionId, metadata: {} });
          }),
        },
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    },
  };
});

// Dynamic imports AFTER mock setup
const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Capacity Enforcement Integration Tests', () => {
  let adminToken;
  let organizerToken;
  let testOrgId;

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'cap-admin-id',
      role: 'ADMIN',
      email: 'admin@capacity-integ.com',
    });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@capacity-integ.com' });

    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Capacity Integ Org' });
    testOrgId = orgRes.body.id;
  });

  afterAll(async () => {
    // Final cleanup — remove any leftover data from failed tests
    if (testOrgId) {
      // Delete in dependency order
      await prisma.paymentTransaction.deleteMany({
        where: { order: { event: { venue: { organizationId: testOrgId } } } },
      });
      await prisma.ticket.deleteMany({
        where: { event: { venue: { organizationId: testOrgId } } },
      });
      await prisma.order.deleteMany({
        where: { event: { venue: { organizationId: testOrgId } } },
      });
      await prisma.priceTier.deleteMany({
        where: { event: { venue: { organizationId: testOrgId } } },
      });
      await prisma.event.deleteMany({
        where: { venue: { organizationId: testOrgId } },
      });
      await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
      await prisma.organization.deleteMany({ where: { id: testOrgId } });
      // Note: Contacts are intentionally not deleted here to avoid FK violations
      // with orders from other test suites sharing the same contact emails.
    }
  });

  /**
   * Helper: create a venue + event with given tier capacity, then publish.
   */
  async function createPublishedEvent(tierQuantity, { maxPerOrder } = {}) {
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: `Cap Venue ${Date.now()}`, address: '1 Cap St' });

    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: venueRes.body.id,
        name: `Cap Event ${Date.now()}`,
        date: '2027-11-15T18:00:00.000Z',
        capacity: tierQuantity + 50,
        priceTiers: [
          {
            name: 'GA',
            price: 10.0,
            quantityTotal: tierQuantity,
            ...(maxPerOrder && { maxPerOrder }),
          },
        ],
      });

    const eventId = eventRes.body.id;
    const tierId = eventRes.body.priceTiers[0].id;
    const venueId = venueRes.body.id;

    await request(app)
      .post(`/organizations/${testOrgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`);

    return { eventId, tierId, venueId };
  }

  /**
   * Helper: clean up event + related data.
   * Note: Contacts are not deleted here to avoid FK issues with shared contacts
   * across tests. The afterAll handles full org-level cleanup.
   */
  async function cleanupEvent(eventId, venueId) {
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.priceTier.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
  }

  it('should prevent overselling under concurrent load (10 requests for 5 capacity)', async () => {
    const { eventId, tierId, venueId } = await createPublishedEvent(5);

    // 10 concurrent single-ticket orders
    const orderPromises = Array.from({ length: 10 }, (_, i) =>
      request(app)
        .post('/orders')
        .send({
          eventId,
          priceTierId: tierId,
          quantity: 1,
          contact: {
            email: `buyer${i}@cap-test.com`,
            firstName: `Buyer`,
            lastName: `${i}`,
          },
        })
    );

    const responses = await Promise.allSettled(orderPromises);

    const successful = responses.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    const rejected = responses.filter((r) => r.status === 'fulfilled' && r.value.status !== 201);

    // At most 5 succeed — never oversell; some may fail from serialisation retries
    expect(successful.length).toBeLessThanOrEqual(5);
    // Combined should account for all 10 requests
    expect(successful.length + rejected.length).toBe(10);

    // Verify tier inventory never exceeds capacity
    const tier = await prisma.priceTier.findUnique({ where: { id: tierId } });
    expect(tier.quantityReserved).toBeLessThanOrEqual(5);
    expect(tier.quantityReserved).toBe(successful.length);
    expect(tier.quantitySold).toBe(0);

    // Verify DB has correct number of orders
    const orderCount = await prisma.order.count({ where: { eventId } });
    expect(orderCount).toBe(successful.length);

    // Cleanup
    await cleanupEvent(eventId, venueId);
  });

  it('should prevent overselling when bulk requests exceed remaining capacity', async () => {
    const { eventId, tierId, venueId } = await createPublishedEvent(10);

    // 5 concurrent requests for 3 tickets each (15 total, only 10 available)
    const orderPromises = Array.from({ length: 5 }, (_, i) =>
      request(app)
        .post('/orders')
        .send({
          eventId,
          priceTierId: tierId,
          quantity: 3,
          contact: {
            email: `bulk${i}@cap-test.com`,
            firstName: 'Bulk',
            lastName: `${i}`,
          },
        })
    );

    const responses = await Promise.allSettled(orderPromises);

    const successful = responses.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    const failed = responses.filter((r) => r.status === 'fulfilled' && r.value.status === 409);

    // At most 3 succeed (3 × 3 = 9 ≤ 10); 4th request for 3 would exceed
    const totalReserved = successful.length * 3;
    expect(totalReserved).toBeLessThanOrEqual(10);
    expect(failed.length).toBeGreaterThanOrEqual(2);

    // Cleanup
    await cleanupEvent(eventId, venueId);
  });

  it('should release inventory when order fails (webhook expired)', async () => {
    const { eventId, tierId, venueId } = await createPublishedEvent(5);

    // Create order (reserves 2)
    const res = await request(app)
      .post('/orders')
      .send({
        eventId,
        priceTierId: tierId,
        quantity: 2,
        contact: {
          email: 'release@cap-test.com',
          firstName: 'Release',
          lastName: 'Test',
        },
      });

    expect(res.status).toBe(201);
    const failOrderId = res.body.orderId;

    // Verify reserved=2
    let tier = await prisma.priceTier.findUnique({ where: { id: tierId } });
    expect(tier.quantityReserved).toBe(2);

    // Retrieve the order to get stripeSessionId
    const order = await prisma.order.findUnique({ where: { id: failOrderId } });

    // Update stripe mock to return priceTierId metadata for this session
    const stripeMod = await import('../../src/config/stripe.js');
    stripeMod.default.checkout.sessions.retrieve.mockImplementation(() =>
      Promise.resolve({
        id: order.stripeSessionId,
        metadata: { priceTierId: tierId, orderId: failOrderId },
      })
    );

    // Simulate Stripe expired webhook
    const webhookPayload = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: order.stripeSessionId,
        },
      },
    };

    const webhookRes = await request(app).post('/webhooks/stripe').send(webhookPayload);

    expect(webhookRes.status).toBe(200);

    // Verify order is FAILED
    const failedOrder = await prisma.order.findUnique({ where: { id: failOrderId } });
    expect(failedOrder.status).toBe('FAILED');

    // Verify inventory released (reserved → 0)
    tier = await prisma.priceTier.findUnique({ where: { id: tierId } });
    expect(tier.quantityReserved).toBe(0);
    expect(tier.quantitySold).toBe(0);

    // Now a new order for 5 should succeed (all capacity freed)
    const newRes = await request(app)
      .post('/orders')
      .send({
        eventId,
        priceTierId: tierId,
        quantity: 5,
        contact: {
          email: 'release@cap-test.com',
          firstName: 'Release',
          lastName: 'Test',
        },
      });

    expect(newRes.status).toBe(201);

    // Cleanup
    await cleanupEvent(eventId, venueId);
  });
});
