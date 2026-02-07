// Contract tests for Auth API endpoints
// Tests API spec compliance for POST /auth/register, POST /auth/login, POST /auth/logout, GET /auth/me
// TDD: Written FIRST per Constitution Principle III

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Auth API Contract Tests', () => {
  const testUser = {
    email: 'auth-contract-test@example.com',
    name: 'Auth Test User',
    password: 'SecurePass123!',
  };

  let sessionCookie;

  const testEmails = [testUser.email, 'duplicate@example.com', 'not-an-email', 'shortpw@test.com'];

  beforeAll(async () => {
    // Clean up only our test data (scoped to avoid interfering with parallel tests)
    const customers = await prisma.customer.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);
    if (customerIds.length > 0) {
      await prisma.session.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.ticket.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
  });

  afterAll(async () => {
    const customers = await prisma.customer.findMany({
      where: { email: { in: testEmails } },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);
    if (customerIds.length > 0) {
      await prisma.session.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    await prisma.$disconnect();
  });

  // T078: POST /auth/register
  describe('POST /auth/register', () => {
    it('should return 201 with user object on successful registration', async () => {
      const response = await request(app).post('/auth/register').send(testUser).expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.name).toBe(testUser.name);
      // Password hash should NOT be returned
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.user).not.toHaveProperty('password_hash');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'not-an-email', name: 'Test', password: 'SecurePass123!' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@test.com' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for password shorter than 8 characters', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'shortpw@test.com', name: 'Test', password: 'short' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 409 for duplicate email (FR-024)', async () => {
      const response = await request(app).post('/auth/register').send(testUser).expect(409);

      expect(response.body).toHaveProperty('error');
    });
  });

  // T079: POST /auth/login
  describe('POST /auth/login', () => {
    it('should return 200 with session cookie on successful login (FR-021)', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body).toHaveProperty('userType');

      // Check for Set-Cookie header
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const sessionCookieStr = Array.isArray(cookies)
        ? cookies.find((c) => c.startsWith('sessionId='))
        : cookies;
      expect(sessionCookieStr).toBeDefined();
      expect(sessionCookieStr).toContain('HttpOnly');

      // Save cookie for subsequent tests
      sessionCookie = sessionCookieStr;
    });

    it('should return 401 for invalid credentials (FR-021)', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: testUser.email, password: 'WrongPassword123!' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 for non-existent email', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'SomePass123!' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for missing email or password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: testUser.email })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  // T081: GET /auth/me
  describe('GET /auth/me', () => {
    it('should return 200 with user info when authenticated (FR-021)', async () => {
      const response = await request(app).get('/auth/me').set('Cookie', sessionCookie).expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email');
      expect(response.body.user).toHaveProperty('name');
      expect(response.body).toHaveProperty('userType');
    });

    it('should return 401 when not authenticated (FR-021)', async () => {
      const response = await request(app).get('/auth/me').expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 with invalid session token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Cookie', 'sessionId=invalid-token-12345')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  // T080: POST /auth/logout
  describe('POST /auth/logout', () => {
    it('should return 204 and invalidate session (FR-023)', async () => {
      // First login to get a fresh session
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      const logoutCookie = Array.isArray(loginRes.headers['set-cookie'])
        ? loginRes.headers['set-cookie'].find((c) => c.startsWith('sessionId='))
        : loginRes.headers['set-cookie'];

      // Logout
      await request(app).post('/auth/logout').set('Cookie', logoutCookie).expect(204);

      // Verify session is invalidated - /auth/me should now fail
      await request(app).get('/auth/me').set('Cookie', logoutCookie).expect(401);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app).post('/auth/logout').expect(401);
    });
  });
});
