// Integration test for customer purchase history (T120)
// Verifies GET /tickets/my returns all customer tickets with correct details per FR-017

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Purchase History Integration Tests', () => {
  let customerA;
  let customerB;
  let event1;
  let event2;
  let event3; // past event
  let cookieA;
  let cookieB;

  const testEmails = ['history-integ-a@test.com', 'history-integ-b@test.com'];

  beforeAll(async () => {
    // Scoped cleanup
    const existingCustomers = await prisma.customer.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const customerIds = existingCustomers.map((c) => c.id);
    if (customerIds.length > 0) {
      await prisma.session.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.ticket.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }

    // Clean up test events
    await prisma.ticket.deleteMany({
      where: { event: { name: { startsWith: 'HistInteg' } } },
    });
    await prisma.event.deleteMany({
      where: { name: { startsWith: 'HistInteg' } },
    });

    const passwordHash = await bcrypt.hash('TestPass123!', 10);

    // Create two customers
    customerA = await prisma.customer.create({
      data: {
        email: 'history-integ-a@test.com',
        name: 'Customer A',
        passwordHash,
      },
    });

    customerB = await prisma.customer.create({
      data: {
        email: 'history-integ-b@test.com',
        name: 'Customer B',
        passwordHash,
      },
    });

    // Get or create admin for events
    let admin = await prisma.admin.findFirst();
    if (!admin) {
      admin = await prisma.admin.create({
        data: {
          email: 'histinteg-admin@test.com',
          name: 'HistInteg Admin',
          organization: 'Test',
          passwordHash: 'hashed',
        },
      });
    }

    // Create events with different dates
    event1 = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'HistInteg Event 1',
        date: new Date('2027-03-15'),
        venue: 'Venue Alpha',
        capacity: 100,
        ticketPrice: 5000,
        status: 'PUBLISHED',
      },
    });

    event2 = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'HistInteg Event 2',
        date: new Date('2027-09-20'),
        venue: 'Venue Beta',
        capacity: 200,
        ticketPrice: 7500,
        status: 'PUBLISHED',
      },
    });

    event3 = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'HistInteg Past Event',
        date: new Date('2022-06-01'),
        venue: 'Venue Gamma',
        capacity: 50,
        ticketPrice: 3000,
        status: 'PUBLISHED',
      },
    });

    // Create tickets: Customer A has 3 tickets across 3 events
    await prisma.ticket.createMany({
      data: [
        {
          eventId: event1.id,
          customerId: customerA.id,
          pricePaid: 5000,
          status: 'VALID',
          stripeTxId: 'cs_test_hist_a1',
          qrCodeJwt: 'jwt-hist-a1',
        },
        {
          eventId: event2.id,
          customerId: customerA.id,
          pricePaid: 7500,
          status: 'VALID',
          stripeTxId: 'cs_test_hist_a2',
          qrCodeJwt: 'jwt-hist-a2',
        },
        {
          eventId: event3.id,
          customerId: customerA.id,
          pricePaid: 3000,
          status: 'VALID',
          stripeTxId: 'cs_test_hist_a3',
          qrCodeJwt: 'jwt-hist-a3',
        },
      ],
    });

    // Create tickets: Customer B has 1 ticket
    await prisma.ticket.create({
      data: {
        eventId: event1.id,
        customerId: customerB.id,
        pricePaid: 5000,
        status: 'VALID',
        stripeTxId: 'cs_test_hist_b1',
        qrCodeJwt: 'jwt-hist-b1',
      },
    });

    // Login both customers
    const loginA = await request(app)
      .post('/auth/login')
      .send({ email: 'history-integ-a@test.com', password: 'TestPass123!' });
    const cookiesA = loginA.headers['set-cookie'];
    cookieA = Array.isArray(cookiesA) ? cookiesA.find((c) => c.startsWith('sessionId=')) : cookiesA;

    const loginB = await request(app)
      .post('/auth/login')
      .send({ email: 'history-integ-b@test.com', password: 'TestPass123!' });
    const cookiesB = loginB.headers['set-cookie'];
    cookieB = Array.isArray(cookiesB) ? cookiesB.find((c) => c.startsWith('sessionId=')) : cookiesB;
  });

  afterAll(async () => {
    // Scoped cleanup
    const existingCustomers = await prisma.customer.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const customerIds = existingCustomers.map((c) => c.id);
    if (customerIds.length > 0) {
      await prisma.session.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.ticket.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    await prisma.ticket.deleteMany({
      where: { event: { name: { startsWith: 'HistInteg' } } },
    });
    await prisma.event.deleteMany({
      where: { name: { startsWith: 'HistInteg' } },
    });
    await prisma.$disconnect();
  });

  it('should return all tickets for Customer A with event details', async () => {
    const response = await request(app).get('/tickets/my').set('Cookie', cookieA).expect(200);

    expect(response.body.tickets).toHaveLength(3);

    // All tickets should have event details
    response.body.tickets.forEach((ticket) => {
      expect(ticket).toHaveProperty('id');
      expect(ticket).toHaveProperty('status');
      expect(ticket).toHaveProperty('pricePaid');
      expect(ticket).toHaveProperty('purchaseTime');
      expect(ticket.event).toHaveProperty('name');
      expect(ticket.event).toHaveProperty('date');
      expect(ticket.event).toHaveProperty('venue');
      expect(ticket.customerId).toBe(customerA.id);
    });
  });

  it('should return only 1 ticket for Customer B', async () => {
    const response = await request(app).get('/tickets/my').set('Cookie', cookieB).expect(200);

    expect(response.body.tickets).toHaveLength(1);
    expect(response.body.tickets[0].customerId).toBe(customerB.id);
  });

  it('should order tickets by event date descending', async () => {
    const response = await request(app).get('/tickets/my').set('Cookie', cookieA).expect(200);

    const dates = response.body.tickets.map((t) => new Date(t.event.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('should mark past event tickets as EXPIRED (FR-018)', async () => {
    const response = await request(app).get('/tickets/my').set('Cookie', cookieA).expect(200);

    const pastTicket = response.body.tickets.find((t) => t.event.name === 'HistInteg Past Event');
    expect(pastTicket).toBeDefined();
    expect(pastTicket.status).toBe('EXPIRED');
  });

  it('should keep future event tickets as VALID', async () => {
    const response = await request(app).get('/tickets/my').set('Cookie', cookieA).expect(200);

    const futureTickets = response.body.tickets.filter(
      (t) => t.event.name !== 'HistInteg Past Event'
    );
    futureTickets.forEach((ticket) => {
      expect(ticket.status).toBe('VALID');
    });
  });

  it('should not expose other customers tickets', async () => {
    const responseA = await request(app).get('/tickets/my').set('Cookie', cookieA).expect(200);

    const responseB = await request(app).get('/tickets/my').set('Cookie', cookieB).expect(200);

    // Ensure no overlap
    const idsA = responseA.body.tickets.map((t) => t.id);
    const idsB = responseB.body.tickets.map((t) => t.id);
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
