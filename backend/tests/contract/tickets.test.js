// Contract tests for Tickets API endpoints
// Tests API spec compliance for POST /tickets/purchase, GET /tickets/confirm, GET /tickets/my

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Tickets API Contract Tests', () => {
  let testEvent;
  let smallCapacityEvent;
  let testCustomer;

  beforeAll(async () => {
    // Clean up existing test data
    await prisma.session.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();

    // Create test admin
    const admin = await prisma.admin.create({
      data: {
        email: 'test-admin@test.com',
        name: 'Test Admin',
        organization: 'Test Org',
        passwordHash: 'hashed',
      },
    });

    // Create test customer
    testCustomer = await prisma.customer.create({
      data: {
        email: 'test-customer@test.com',
        name: 'Test Customer',
        passwordHash: 'hashed',
      },
    });

    // Create a published event with good capacity
    testEvent = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'Test Concert',
        date: new Date('2026-12-31'),
        venue: 'Test Arena',
        capacity: 1000,
        ticketPrice: 5000, // $50.00
        status: 'PUBLISHED',
      },
    });

    // Create event with small capacity for oversell testing
    smallCapacityEvent = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'Small Event',
        date: new Date('2026-12-31'),
        venue: 'Small Venue',
        capacity: 2,
        ticketPrice: 1000,
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

  describe('POST /tickets/purchase', () => {
    it('should return 200 with Stripe session ID for valid request', async () => {
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: testEvent.id,
          quantity: 2,
          email: 'buyer@test.com',
        })
        .expect(200);

      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('checkoutUrl');
      expect(typeof response.body.sessionId).toBe('string');
      expect(response.body.sessionId).toMatch(/^cs_test_/); // Stripe test session ID format
    });

    it('should return 400 for invalid quantity (0)', async () => {
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: testEvent.id,
          quantity: 0,
          email: 'buyer@test.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('quantity');
    });

    it('should return 400 for invalid quantity (> 10)', async () => {
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: testEvent.id,
          quantity: 11,
          email: 'buyer@test.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('quantity');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: testEvent.id,
          quantity: 2,
          email: 'invalid-email',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('email');
    });

    it('should return 400 for invalid eventId UUID', async () => {
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: 'not-a-uuid',
          quantity: 2,
          email: 'buyer@test.com',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent event', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: fakeId,
          quantity: 2,
          email: 'buyer@test.com',
        })
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('not found');
    });

    it('should return 409 for insufficient capacity', async () => {
      // Try to buy 3 tickets when only 2 are available
      const response = await request(app)
        .post('/tickets/purchase')
        .send({
          eventId: smallCapacityEvent.id,
          quantity: 3,
          email: 'buyer@test.com',
        })
        .expect(409);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('capacity');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app).post('/tickets/purchase').send({}).expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /tickets/confirm', () => {
    let validStripeSessionId;

    beforeAll(async () => {
      // Create a successful payment transaction
      const payment = await prisma.paymentTransaction.create({
        data: {
          stripeSessionId: 'cs_test_valid_session_123',
          customerId: testCustomer.id,
          eventId: testEvent.id,
          amount: 10000, // $100.00
          currency: 'USD',
          status: 'SUCCEEDED',
        },
      });

      validStripeSessionId = payment.stripeSessionId;

      // Create tickets for this payment
      await prisma.ticket.create({
        data: {
          eventId: testEvent.id,
          customerId: testCustomer.id,
          pricePaid: 5000,
          status: 'VALID',
          stripeTxId: validStripeSessionId,
          qrCodeJwt: 'fake-jwt-token',
        },
      });
    });

    it('should return 200 with ticket and QR code for valid session', async () => {
      const response = await request(app)
        .get(`/tickets/confirm?session_id=${validStripeSessionId}`)
        .expect(200);

      expect(response.body).toHaveProperty('tickets');
      expect(Array.isArray(response.body.tickets)).toBe(true);
      expect(response.body.tickets.length).toBeGreaterThan(0);

      const ticket = response.body.tickets[0];
      expect(ticket).toHaveProperty('id');
      expect(ticket).toHaveProperty('qrCode');
      expect(ticket).toHaveProperty('event');
      expect(ticket.status).toBe('VALID');
    });

    it('should return 404 for non-existent session ID', async () => {
      const response = await request(app)
        .get('/tickets/confirm?session_id=cs_test_nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('not found');
    });

    it('should return 400 for missing session_id parameter', async () => {
      const response = await request(app).get('/tickets/confirm').expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('session_id');
    });

    it('should include event details in ticket response', async () => {
      const response = await request(app)
        .get(`/tickets/confirm?session_id=${validStripeSessionId}`)
        .expect(200);

      const ticket = response.body.tickets[0];
      expect(ticket.event).toHaveProperty('name');
      expect(ticket.event).toHaveProperty('date');
      expect(ticket.event).toHaveProperty('venue');
    });
  });

  // T119: GET /tickets/my - Customer purchase history (FR-017)
  describe('GET /tickets/my', () => {
    let customerSessionCookie;
    let historyCustomer;
    let futureEvent;
    let pastEvent;

    beforeAll(async () => {
      // Create a customer with a real password hash for login
      const passwordHash = await bcrypt.hash('TestPass123!', 10);
      historyCustomer = await prisma.customer.create({
        data: {
          email: 'history-customer@test.com',
          name: 'History Customer',
          passwordHash,
        },
      });

      // Create a future event
      futureEvent = await prisma.event.create({
        data: {
          organizerId: (await prisma.admin.findFirst()).id,
          name: 'Future Concert',
          date: new Date('2027-06-15'),
          venue: 'Future Arena',
          capacity: 500,
          ticketPrice: 7500,
          status: 'PUBLISHED',
        },
      });

      // Create a past event
      pastEvent = await prisma.event.create({
        data: {
          organizerId: (await prisma.admin.findFirst()).id,
          name: 'Past Concert',
          date: new Date('2023-01-15'),
          venue: 'Past Arena',
          capacity: 500,
          ticketPrice: 5000,
          status: 'PUBLISHED',
        },
      });

      // Create tickets for the history customer
      await prisma.ticket.create({
        data: {
          eventId: futureEvent.id,
          customerId: historyCustomer.id,
          pricePaid: 7500,
          status: 'VALID',
          stripeTxId: 'cs_test_history_future',
          qrCodeJwt: 'jwt-future-ticket',
        },
      });

      await prisma.ticket.create({
        data: {
          eventId: pastEvent.id,
          customerId: historyCustomer.id,
          pricePaid: 5000,
          status: 'VALID',
          stripeTxId: 'cs_test_history_past',
          qrCodeJwt: 'jwt-past-ticket',
        },
      });

      // Login as the customer to get session cookie
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'history-customer@test.com', password: 'TestPass123!' });

      const cookies = loginRes.headers['set-cookie'];
      customerSessionCookie = Array.isArray(cookies)
        ? cookies.find((c) => c.startsWith('sessionId='))
        : cookies;
    });

    it('should return 200 with customer tickets ordered by event date (FR-017)', async () => {
      const response = await request(app)
        .get('/tickets/my')
        .set('Cookie', customerSessionCookie)
        .expect(200);

      expect(response.body).toHaveProperty('tickets');
      expect(Array.isArray(response.body.tickets)).toBe(true);
      expect(response.body.tickets.length).toBe(2);

      // Verify tickets are ordered by event date descending
      const dates = response.body.tickets.map((t) => new Date(t.event.date).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
    });

    it('should include event details in each ticket', async () => {
      const response = await request(app)
        .get('/tickets/my')
        .set('Cookie', customerSessionCookie)
        .expect(200);

      const ticket = response.body.tickets[0];
      expect(ticket).toHaveProperty('id');
      expect(ticket).toHaveProperty('status');
      expect(ticket).toHaveProperty('pricePaid');
      expect(ticket).toHaveProperty('purchaseTime');
      expect(ticket.event).toHaveProperty('name');
      expect(ticket.event).toHaveProperty('date');
      expect(ticket.event).toHaveProperty('venue');
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/tickets/my').expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return empty array for customer with no tickets', async () => {
      // Create another customer with no tickets
      const noTicketHash = await bcrypt.hash('NoTickets123!', 10);
      await prisma.customer.create({
        data: {
          email: 'no-tickets@test.com',
          name: 'No Tickets Customer',
          passwordHash: noTicketHash,
        },
      });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'no-tickets@test.com', password: 'NoTickets123!' });

      const cookies = loginRes.headers['set-cookie'];
      const noTicketCookie = Array.isArray(cookies)
        ? cookies.find((c) => c.startsWith('sessionId='))
        : cookies;

      const response = await request(app)
        .get('/tickets/my')
        .set('Cookie', noTicketCookie)
        .expect(200);

      expect(response.body.tickets).toEqual([]);
    });

    it('should only return tickets belonging to the authenticated customer', async () => {
      const response = await request(app)
        .get('/tickets/my')
        .set('Cookie', customerSessionCookie)
        .expect(200);

      // All tickets should belong to the history customer
      response.body.tickets.forEach((ticket) => {
        expect(ticket.customerId).toBe(historyCustomer.id);
      });
    });

    it('should mark past event tickets as EXPIRED (FR-018)', async () => {
      const response = await request(app)
        .get('/tickets/my')
        .set('Cookie', customerSessionCookie)
        .expect(200);

      // Find the ticket for the past event
      const pastTicket = response.body.tickets.find((t) => t.event.name === 'Past Concert');

      expect(pastTicket).toBeDefined();
      expect(pastTicket.status).toBe('EXPIRED');
    });
  });
});
