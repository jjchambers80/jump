// Contract tests for Admin API endpoints
// Tests API spec compliance for admin event management
// TDD: Written FIRST per Constitution Principle III

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Admin API Contract Tests', () => {
  let adminUser;
  let adminSessionCookie;
  let customerSessionCookie;
  let createdEventId;

  const adminData = {
    email: 'admin-contract@example.com',
    name: 'Admin User',
    organization: 'Test Corp',
  };

  const customerData = {
    email: 'customer-contract@example.com',
    name: 'Customer User',
    password: 'CustomerPass123!',
  };

  beforeAll(async () => {
    // Clean up only our test data (scoped to avoid interfering with parallel tests)
    const existingAdmin = await prisma.admin.findUnique({ where: { email: adminData.email } });
    if (existingAdmin) {
      await prisma.session.deleteMany({ where: { adminId: existingAdmin.id } });
      await prisma.event.deleteMany({ where: { organizerId: existingAdmin.id } });
      await prisma.admin.delete({ where: { id: existingAdmin.id } });
    }
    const existingCustomer = await prisma.customer.findUnique({
      where: { email: customerData.email },
    });
    if (existingCustomer) {
      await prisma.session.deleteMany({ where: { customerId: existingCustomer.id } });
      await prisma.customer.delete({ where: { id: existingCustomer.id } });
    }

    // Create admin directly in DB (admins are created manually per spec)
    const passwordHash = await bcrypt.hash('AdminPass123!', 10);
    adminUser = await prisma.admin.create({
      data: {
        email: adminData.email,
        name: adminData.name,
        organization: adminData.organization,
        passwordHash,
      },
    });

    // Create admin session
    const adminSession = await prisma.session.create({
      data: {
        adminId: adminUser.id,
        userType: 'ADMIN',
        token: 'admin-contract-test-token-' + Date.now(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    adminSessionCookie = `sessionId=${adminSession.token}`;

    // Register customer and login
    await request(app).post('/auth/register').send(customerData);

    const customerLogin = await request(app)
      .post('/auth/login')
      .send({ email: customerData.email, password: customerData.password });

    const cookies = customerLogin.headers['set-cookie'];
    customerSessionCookie = Array.isArray(cookies)
      ? cookies.find((c) => c.startsWith('sessionId='))
      : cookies;
  });

  afterAll(async () => {
    // Clean up only our test data
    if (adminUser) {
      await prisma.session.deleteMany({ where: { adminId: adminUser.id } });
      await prisma.event.deleteMany({ where: { organizerId: adminUser.id } });
      await prisma.admin.delete({ where: { id: adminUser.id } }).catch(() => {});
    }
    const existingCustomer = await prisma.customer.findUnique({
      where: { email: customerData.email },
    });
    if (existingCustomer) {
      await prisma.session.deleteMany({ where: { customerId: existingCustomer.id } });
      await prisma.customer.delete({ where: { id: existingCustomer.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  // T082: POST /admin/events
  describe('POST /admin/events', () => {
    const validEvent = {
      name: 'Contract Test Event',
      date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      venue: 'Test Arena',
      capacity: 500,
      ticketPrice: 49.99,
    };

    it('should return 201 for admin user (FR-011, FR-013)', async () => {
      const response = await request(app)
        .post('/admin/events')
        .set('Cookie', adminSessionCookie)
        .send(validEvent)
        .expect(201);

      expect(response.body).toHaveProperty('event');
      expect(response.body.event).toHaveProperty('id');
      expect(response.body.event.name).toBe(validEvent.name);
      expect(response.body.event.venue).toBe(validEvent.venue);
      expect(response.body.event.capacity).toBe(validEvent.capacity);
      expect(response.body.event.status).toBe('DRAFT');

      createdEventId = response.body.event.id;
    });

    it('should return 403 for customer user (FR-013)', async () => {
      const response = await request(app)
        .post('/admin/events')
        .set('Cookie', customerSessionCookie)
        .send(validEvent)
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 for unauthenticated user', async () => {
      await request(app).post('/admin/events').send(validEvent).expect(401);
    });

    it('should return 400 for invalid capacity (FR-012)', async () => {
      await request(app)
        .post('/admin/events')
        .set('Cookie', adminSessionCookie)
        .send({ ...validEvent, capacity: 0 })
        .expect(400);
    });

    it('should return 400 for negative price (FR-012)', async () => {
      await request(app)
        .post('/admin/events')
        .set('Cookie', adminSessionCookie)
        .send({ ...validEvent, ticketPrice: -10 })
        .expect(400);
    });

    it('should return 400 for past date', async () => {
      await request(app)
        .post('/admin/events')
        .set('Cookie', adminSessionCookie)
        .send({ ...validEvent, date: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });

    it('should return 400 for missing required fields', async () => {
      await request(app)
        .post('/admin/events')
        .set('Cookie', adminSessionCookie)
        .send({ name: 'Incomplete' })
        .expect(400);
    });
  });

  // T083: PATCH /admin/events/:eventId
  describe('PATCH /admin/events/:eventId', () => {
    it('should return 200 for admin owner (FR-011)', async () => {
      const response = await request(app)
        .patch(`/admin/events/${createdEventId}`)
        .set('Cookie', adminSessionCookie)
        .send({ name: 'Updated Event Name' })
        .expect(200);

      expect(response.body).toHaveProperty('event');
      expect(response.body.event.name).toBe('Updated Event Name');
    });

    it('should return 403 for non-admin (FR-011)', async () => {
      await request(app)
        .patch(`/admin/events/${createdEventId}`)
        .set('Cookie', customerSessionCookie)
        .send({ name: 'Hack Attempt' })
        .expect(403);
    });

    it('should return 404 for non-existent event', async () => {
      await request(app)
        .patch('/admin/events/00000000-0000-0000-0000-000000000000')
        .set('Cookie', adminSessionCookie)
        .send({ name: 'Ghost Event' })
        .expect(404);
    });
  });

  // T084: POST /admin/events/:eventId/publish
  describe('POST /admin/events/:eventId/publish', () => {
    it('should return 200 and change status to PUBLISHED (FR-011)', async () => {
      const response = await request(app)
        .post(`/admin/events/${createdEventId}/publish`)
        .set('Cookie', adminSessionCookie)
        .expect(200);

      expect(response.body).toHaveProperty('event');
      expect(response.body.event.status).toBe('PUBLISHED');
    });

    it('should make event visible in customer event list after publish', async () => {
      const response = await request(app).get('/events').expect(200);

      const found = response.body.events.some((e) => e.id === createdEventId);
      expect(found).toBe(true);
    });

    it('should return 403 for non-admin', async () => {
      await request(app)
        .post(`/admin/events/${createdEventId}/publish`)
        .set('Cookie', customerSessionCookie)
        .expect(403);
    });
  });

  // T085: GET /admin/dashboard/stats
  describe('GET /admin/dashboard/stats', () => {
    it('should return 200 with real-time metrics for admin (FR-014, FR-025)', async () => {
      const response = await request(app)
        .get('/admin/dashboard/stats')
        .set('Cookie', adminSessionCookie)
        .expect(200);

      expect(response.body).toHaveProperty('totalCapacity');
      expect(response.body).toHaveProperty('ticketsSold');
      expect(response.body).toHaveProperty('remainingCapacity');
      expect(typeof response.body.totalCapacity).toBe('number');
      expect(typeof response.body.ticketsSold).toBe('number');
      expect(typeof response.body.remainingCapacity).toBe('number');
    });

    it('should return 403 for non-admin (FR-014)', async () => {
      await request(app)
        .get('/admin/dashboard/stats')
        .set('Cookie', customerSessionCookie)
        .expect(403);
    });

    it('should return 401 for unauthenticated user', async () => {
      await request(app).get('/admin/dashboard/stats').expect(401);
    });

    it('should support filtering by eventId', async () => {
      const response = await request(app)
        .get(`/admin/dashboard/stats?eventId=${createdEventId}`)
        .set('Cookie', adminSessionCookie)
        .expect(200);

      expect(response.body).toHaveProperty('totalCapacity');
    });
  });
});
