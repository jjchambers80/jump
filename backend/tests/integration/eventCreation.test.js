// Integration test for event creation workflow
// admin login → create event → verify draft status → publish → verify customer visibility
// TDD: Written FIRST per Constitution Principle III

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Event Creation Workflow Integration', () => {
  let adminSessionCookie;
  let adminUser;

  const adminEmail = 'integration-admin@example.com';
  const adminPassword = 'IntegrationPass123!';

  beforeAll(async () => {
    // Clean up only our test data (scoped to avoid interfering with parallel tests)
    const existingAdmin = await prisma.admin.findUnique({ where: { email: adminEmail } });
    if (existingAdmin) {
      await prisma.session.deleteMany({ where: { adminId: existingAdmin.id } });
      await prisma.event.deleteMany({ where: { organizerId: existingAdmin.id } });
      await prisma.admin.delete({ where: { id: existingAdmin.id } });
    }
    const existingCustomer = await prisma.customer.findUnique({
      where: { email: 'customer-integration@example.com' },
    });
    if (existingCustomer) {
      await prisma.session.deleteMany({ where: { customerId: existingCustomer.id } });
      await prisma.customer.delete({ where: { id: existingCustomer.id } });
    }

    // Create admin with hashed password
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    adminUser = await prisma.admin.create({
      data: {
        email: adminEmail,
        name: 'Integration Admin',
        organization: 'Integration Corp',
        passwordHash,
      },
    });
  });

  afterAll(async () => {
    if (adminUser) {
      await prisma.session.deleteMany({ where: { adminId: adminUser.id } });
      await prisma.event.deleteMany({ where: { organizerId: adminUser.id } });
      await prisma.admin.delete({ where: { id: adminUser.id } }).catch(() => {});
    }
    const existingCustomer = await prisma.customer.findUnique({
      where: { email: 'customer-integration@example.com' },
    });
    if (existingCustomer) {
      await prisma.session.deleteMany({ where: { customerId: existingCustomer.id } });
      await prisma.customer.delete({ where: { id: existingCustomer.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('should complete full event creation workflow: login → create → publish → verify', async () => {
    // Step 1: Admin login
    const loginResponse = await request(app)
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);

    expect(loginResponse.body.userType).toBe('admin');
    const cookies = loginResponse.headers['set-cookie'];
    adminSessionCookie = Array.isArray(cookies)
      ? cookies.find((c) => c.startsWith('sessionId='))
      : cookies;
    expect(adminSessionCookie).toBeDefined();

    // Step 2: Create event (should be DRAFT)
    const eventData = {
      name: 'Integration Test Concert',
      date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days out
      venue: 'Integration Hall',
      capacity: 200,
      ticketPrice: 75.0,
    };

    const createResponse = await request(app)
      .post('/admin/events')
      .set('Cookie', adminSessionCookie)
      .send(eventData)
      .expect(201);

    const createdEvent = createResponse.body.event;
    expect(createdEvent.status).toBe('DRAFT');
    expect(createdEvent.name).toBe(eventData.name);

    // Step 3: Verify draft event is NOT visible to customers
    const eventsBeforePublish = await request(app).get('/events').expect(200);

    const draftVisible = eventsBeforePublish.body.events.some((e) => e.id === createdEvent.id);
    expect(draftVisible).toBe(false);

    // Step 4: Publish event
    const publishResponse = await request(app)
      .post(`/admin/events/${createdEvent.id}/publish`)
      .set('Cookie', adminSessionCookie)
      .expect(200);

    expect(publishResponse.body.event.status).toBe('PUBLISHED');

    // Step 5: Verify published event IS visible to customers
    const eventsAfterPublish = await request(app).get('/events').expect(200);

    const publishedVisible = eventsAfterPublish.body.events.some((e) => e.id === createdEvent.id);
    expect(publishedVisible).toBe(true);

    // Step 6: Verify event details match
    const eventDetail = await request(app).get(`/events/${createdEvent.id}`).expect(200);

    expect(eventDetail.body.event.name).toBe(eventData.name);
    expect(eventDetail.body.event.venue).toBe(eventData.venue);
    expect(eventDetail.body.event.capacity).toBe(eventData.capacity);
  });

  it('should prevent non-admin from creating events', async () => {
    // Register and login as customer
    const customerEmail = 'integration-customer@example.com';
    await prisma.customer.deleteMany({ where: { email: customerEmail } });

    await request(app)
      .post('/auth/register')
      .send({ email: customerEmail, name: 'Test Customer', password: 'CustomerPass123!' });

    const customerLogin = await request(app)
      .post('/auth/login')
      .send({ email: customerEmail, password: 'CustomerPass123!' });

    const customerCookie = Array.isArray(customerLogin.headers['set-cookie'])
      ? customerLogin.headers['set-cookie'].find((c) => c.startsWith('sessionId='))
      : customerLogin.headers['set-cookie'];

    // Attempt to create event as customer
    await request(app)
      .post('/admin/events')
      .set('Cookie', customerCookie)
      .send({
        name: 'Unauthorized Event',
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        venue: 'Nowhere',
        capacity: 100,
        ticketPrice: 10,
      })
      .expect(403);

    // Clean up
    await prisma.session.deleteMany({ where: { userType: 'CUSTOMER' } });
    await prisma.customer.deleteMany({ where: { email: customerEmail } });
  });

  it('should allow admin to update event details before publishing', async () => {
    // Create event
    const createRes = await request(app)
      .post('/admin/events')
      .set('Cookie', adminSessionCookie)
      .send({
        name: 'Original Name',
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        venue: 'Original Venue',
        capacity: 100,
        ticketPrice: 25.0,
      })
      .expect(201);

    const eventId = createRes.body.event.id;

    // Update event
    const updateRes = await request(app)
      .patch(`/admin/events/${eventId}`)
      .set('Cookie', adminSessionCookie)
      .send({ name: 'Updated Name', venue: 'New Venue' })
      .expect(200);

    expect(updateRes.body.event.name).toBe('Updated Name');
    expect(updateRes.body.event.venue).toBe('New Venue');
    // Unchanged fields should remain
    expect(updateRes.body.event.capacity).toBe(100);
  });
});
