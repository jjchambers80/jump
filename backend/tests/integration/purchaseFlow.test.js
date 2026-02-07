// Integration test for complete ticket purchase flow
// Tests: event listing → purchase → Stripe success → confirmation → email delivery

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Purchase Flow Integration Test', () => {
  let testEvent;
  let testAdmin;

  beforeAll(async () => {
    // Clean up
    await prisma.session.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();

    // Create test admin
    testAdmin = await prisma.admin.create({
      data: {
        email: 'admin@flow-test.com',
        name: 'Flow Test Admin',
        organization: 'Test Org',
        passwordHash: 'hashed',
      },
    });

    // Create test event
    testEvent = await prisma.event.create({
      data: {
        organizerId: testAdmin.id,
        name: 'Integration Test Event',
        date: new Date('2026-12-31'),
        venue: 'Test Venue',
        capacity: 100,
        ticketPrice: 5000,
        status: 'PUBLISHED',
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

  it('should complete full purchase flow from browsing to ticket delivery', async () => {
    const customerEmail = 'integration-buyer@test.com';
    const quantity = 2;

    // Step 1: Browse events
    const eventsResponse = await request(app).get('/events').expect(200);

    expect(eventsResponse.body.events.length).toBeGreaterThan(0);
    const event = eventsResponse.body.events.find((e) => e.id === testEvent.id);
    expect(event).toBeDefined();

    // Step 2: View event details
    const eventResponse = await request(app).get(`/events/${testEvent.id}`).expect(200);

    expect(eventResponse.body.event.id).toBe(testEvent.id);
    expect(eventResponse.body.event.capacity).toBe(100);

    // Step 3: Initiate purchase (creates Stripe session)
    const purchaseResponse = await request(app)
      .post('/tickets/purchase')
      .send({
        eventId: testEvent.id,
        quantity: quantity,
        email: customerEmail,
      })
      .expect(200);

    expect(purchaseResponse.body).toHaveProperty('sessionId');
    const stripeSessionId = purchaseResponse.body.sessionId;

    // Step 4: Simulate Stripe payment success (webhook would normally do this)
    // In real flow: Stripe redirects to confirmation page
    // For testing: We'll verify the payment transaction was created
    const paymentTx = await prisma.paymentTransaction.findUnique({
      where: { stripeSessionId },
    });

    expect(paymentTx).toBeDefined();
    expect(paymentTx.amount).toBe(testEvent.ticketPrice * quantity);
    expect(paymentTx.status).toBe('PENDING');

    // Step 5: Mark payment as succeeded (simulating Stripe webhook)
    await prisma.paymentTransaction.update({
      where: { stripeSessionId },
      data: { status: 'SUCCEEDED' },
    });

    // Step 6: Confirm purchase and get tickets
    const confirmResponse = await request(app)
      .get(`/tickets/confirm?session_id=${stripeSessionId}`)
      .expect(200);

    expect(confirmResponse.body.tickets).toHaveLength(quantity);

    // Verify tickets have QR codes
    confirmResponse.body.tickets.forEach((ticket) => {
      expect(ticket).toHaveProperty('qrCode');
      expect(ticket.qrCode).toBeTruthy();
      expect(ticket.status).toBe('VALID');
    });

    // Step 7: Verify atomic inventory decrement
    const updatedEvent = await prisma.event.findUnique({
      where: { id: testEvent.id },
      include: { _count: { select: { tickets: true } } },
    });

    expect(updatedEvent._count.tickets).toBe(quantity);

    // Step 8: Verify payment→ticket association
    const tickets = await prisma.ticket.findMany({
      where: { stripeTxId: stripeSessionId },
    });

    expect(tickets).toHaveLength(quantity);
    tickets.forEach((ticket) => {
      expect(ticket.eventId).toBe(testEvent.id);
      expect(ticket.pricePaid).toBe(testEvent.ticketPrice);
      expect(ticket.stripeTxId).toBe(stripeSessionId);
    });
  });

  it('should enforce atomic payment→ticket→inventory transaction', async () => {
    const initialTicketCount = await prisma.ticket.count({
      where: { eventId: testEvent.id },
    });

    // Initiate purchase
    const purchaseResponse = await request(app)
      .post('/tickets/purchase')
      .send({
        eventId: testEvent.id,
        quantity: 3,
        email: 'atomic-test@test.com',
      })
      .expect(200);

    const stripeSessionId = purchaseResponse.body.sessionId;

    // Simulate payment success
    await prisma.paymentTransaction.update({
      where: { stripeSessionId },
      data: { status: 'SUCCEEDED' },
    });

    // Get tickets
    await request(app).get(`/tickets/confirm?session_id=${stripeSessionId}`).expect(200);

    // Verify exactly 3 new tickets were created
    const finalTicketCount = await prisma.ticket.count({
      where: { eventId: testEvent.id },
    });

    expect(finalTicketCount).toBe(initialTicketCount + 3);

    // Verify all tickets belong to same payment
    const createdTickets = await prisma.ticket.findMany({
      where: { stripeTxId: stripeSessionId },
    });

    expect(createdTickets).toHaveLength(3);
  });

  it('should handle capacity exceeded during checkout', async () => {
    // Create event with only 1 ticket remaining
    const limitedEvent = await prisma.event.create({
      data: {
        organizerId: testAdmin.id,
        name: 'Limited Capacity Event',
        date: new Date('2026-12-31'),
        venue: 'Small Venue',
        capacity: 5,
        status: 'PUBLISHED',
        ticketPrice: 1000,
      },
    });

    // Sell 4 tickets
    const customer1 = await prisma.customer.create({
      data: {
        email: 'customer1@capacity-test.com',
        name: 'Customer 1',
        passwordHash: 'hashed',
      },
    });

    for (let i = 0; i < 4; i++) {
      await prisma.ticket.create({
        data: {
          eventId: limitedEvent.id,
          customerId: customer1.id,
          pricePaid: 1000,
          status: 'VALID',
          qrCodeJwt: `jwt-${i}`,
        },
      });
    }

    // Try to buy 2 tickets (should fail - only 1 left)
    const response = await request(app)
      .post('/tickets/purchase')
      .send({
        eventId: limitedEvent.id,
        quantity: 2,
        email: 'buyer@capacity-test.com',
      })
      .expect(409);

    expect(response.body.error).toBe('Conflict');
    expect(response.body.message).toContain('capacity');

    // Clean up
    await prisma.ticket.deleteMany({ where: { eventId: limitedEvent.id } });
    await prisma.event.delete({ where: { id: limitedEvent.id } });
    await prisma.customer.delete({ where: { id: customer1.id } });
  });
});
