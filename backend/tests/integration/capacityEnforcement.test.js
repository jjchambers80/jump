// Integration test for capacity enforcement under concurrent load
// Simulates concurrent purchase requests to verify atomic inventory management

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Capacity Enforcement Integration Tests', () => {
  let testEvent;
  let testAdmin;

  beforeAll(async () => {
    // Clean up existing test data
    await prisma.session.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();

    // Create test admin
    testAdmin = await prisma.admin.create({
      data: {
        email: 'load-test-admin@test.com',
        name: 'Load Test Admin',
        organization: 'Test Org',
        passwordHash: 'hashed',
      },
    });
  });

  afterAll(async () => {
    await prisma.session.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.$disconnect();
  });

  describe('Concurrent purchase load test', () => {
    it('should prevent overselling under concurrent load (10 requests for 5 capacity)', async () => {
      // Create event with capacity of 5
      const event = await prisma.event.create({
        data: {
          organizerId: testAdmin.id,
          name: 'Limited Capacity Event',
          date: new Date('2026-12-31'),
          venue: 'Small Venue',
          capacity: 5,
          ticketPrice: 1000, // $10.00
          status: 'PUBLISHED',
        },
      });

      // Simulate 10 concurrent purchase requests for 1 ticket each
      const purchasePromises = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post('/tickets/purchase')
          .send({
            eventId: event.id,
            quantity: 1,
            email: `buyer${i}@test.com`,
          })
      );

      // Execute all requests concurrently
      const responses = await Promise.allSettled(purchasePromises);

      // Count successful and failed purchases
      const successfulPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200
      );
      const failedPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 409
      );

      // Verify exactly 5 succeeded (matching capacity)
      expect(successfulPurchases.length).toBe(5);

      // Verify exactly 5 failed with 409 Conflict
      expect(failedPurchases.length).toBe(5);

      // Verify all failed purchases have correct error message
      failedPurchases.forEach((result) => {
        if (result.status === 'fulfilled') {
          expect(result.value.body.error).toBe('ConflictError');
          expect(result.value.body.message).toContain('capacity');
        }
      });

      // Verify database state: exactly 0 Stripe sessions created (capacity check happens before Stripe)
      const ticketCount = await prisma.ticket.count({
        where: { eventId: event.id },
      });

      // No tickets created yet because we only called purchase (which creates Stripe session)
      // Tickets are created in /tickets/confirm after payment success
      expect(ticketCount).toBe(0);

      // Clean up
      await prisma.event.delete({ where: { id: event.id } });
    });

    it('should prevent overselling when multiple requests exceed remaining capacity', async () => {
      // Create event with capacity of 10
      const event = await prisma.event.create({
        data: {
          organizerId: testAdmin.id,
          name: 'Medium Capacity Event',
          date: new Date('2026-12-31'),
          venue: 'Medium Venue',
          capacity: 10,
          ticketPrice: 2000,
          status: 'PUBLISHED',
        },
      });

      // Simulate 5 concurrent purchase requests for 3 tickets each (total 15 tickets requested)
      const purchasePromises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/tickets/purchase')
          .send({
            eventId: event.id,
            quantity: 3,
            email: `bulk-buyer${i}@test.com`,
          })
      );

      const responses = await Promise.allSettled(purchasePromises);

      // Count successful purchases
      const successfulPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200
      );
      const failedPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 409
      );

      // At most 3 purchases should succeed (3 * 3 = 9 tickets),
      // or possibly 4 if timing allows (but would leave 2 remaining)
      // The key is that total allocated should not exceed 10
      const totalTicketsAllocated = successfulPurchases.length * 3;
      expect(totalTicketsAllocated).toBeLessThanOrEqual(10);

      // At least 2 should fail (since 5 * 3 = 15 > 10)
      expect(failedPurchases.length).toBeGreaterThanOrEqual(2);

      // Clean up
      await prisma.event.delete({ where: { id: event.id } });
    });

    it('should handle race condition when last tickets are purchased simultaneously', async () => {
      // Create event with 3 tickets remaining
      const event = await prisma.event.create({
        data: {
          organizerId: testAdmin.id,
          name: 'Nearly Sold Out Event',
          date: new Date('2026-12-31'),
          venue: 'Tiny Venue',
          capacity: 3,
          ticketPrice: 1500,
          status: 'PUBLISHED',
        },
      });

      // Simulate 3 concurrent purchases for 2 tickets each (total 6 requested, only 3 available)
      const purchasePromises = Array.from({ length: 3 }, (_, i) =>
        request(app)
          .post('/tickets/purchase')
          .send({
            eventId: event.id,
            quantity: 2,
            email: `race-buyer${i}@test.com`,
          })
      );

      const responses = await Promise.allSettled(purchasePromises);

      const successfulPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200
      );
      const failedPurchases = responses.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 409
      );

      // At most 1 purchase should succeed (2 tickets allocated)
      expect(successfulPurchases.length).toBeLessThanOrEqual(1);

      // At least 2 should fail
      expect(failedPurchases.length).toBeGreaterThanOrEqual(2);

      // Clean up
      await prisma.event.delete({ where: { id: event.id } });
    });
  });
});
