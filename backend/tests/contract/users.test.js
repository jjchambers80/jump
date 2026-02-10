// Contract tests for User Management endpoints (T089)
// Tests: GET /users (admin-only list), PATCH /users/:id (role update, deactivation)
// Per FR-056

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-user-mgmt',
    email: overrides.email || 'admin@user-test.com',
    role: overrides.role || 'ADMIN',
    name: overrides.name || 'User Test Admin',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe (required by server.js dependency chain)
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_user_test',
          url: 'https://checkout.stripe.com/pay/cs_user_test',
          payment_intent: `pi_user_test_${Date.now()}`,
          metadata: {},
        }),
        retrieve: jest.fn().mockResolvedValue({ id: 'cs_user_test', metadata: {} }),
      },
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('User Management Contract Tests', () => {
  let adminToken, customerToken;
  let testOrgId;
  let testUserId;

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'admin-user-test',
      role: 'ADMIN',
      email: 'admin@user-contract.com',
    });
    customerToken = generateToken({
      id: 'cust-user-test',
      role: 'CUSTOMER',
      email: 'customer@user-contract.com',
    });

    // Create an org for assignment tests
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'User Test Org' });
    testOrgId = orgRes.body.id;

    // Create a test user directly via Prisma
    const user = await prisma.user.create({
      data: {
        email: `testuser-${Date.now()}@user-contract.com`,
        name: 'Test Subject',
        firstName: 'Test',
        lastName: 'Subject',
        role: 'CUSTOMER',
        isActive: true,
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } });
    if (testOrgId) await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  // ===== GET /users =====

  describe('GET /users', () => {
    test('200: admin can list users', async () => {
      const res = await request(app).get('/users').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);

      // Verify UserSummary shape
      const user = res.body.users.find((u) => u.id === testUserId);
      expect(user).toBeDefined();
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('isActive');
      expect(user).toHaveProperty('createdAt');
    });

    test('200: filter by role', async () => {
      const res = await request(app)
        .get('/users?role=CUSTOMER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.users.forEach((u) => expect(u.role).toBe('CUSTOMER'));
    });

    test('401: no auth token → rejected', async () => {
      const res = await request(app).get('/users');
      expect(res.status).toBe(401);
    });

    test('403: customer role → forbidden', async () => {
      const res = await request(app).get('/users').set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ===== PATCH /users/:id =====

  describe('PATCH /users/:id', () => {
    test('200: admin can update user role', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ORGANIZER' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testUserId);
      expect(res.body.role).toBe('ORGANIZER');

      // Verify DB update
      const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(dbUser.role).toBe('ORGANIZER');
    });

    test('200: admin can deactivate user', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    test('200: admin can reactivate and assign to organization', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true, organizationId: testOrgId });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
      expect(res.body.organizationId).toBe(testOrgId);
      expect(res.body.organizationName).toBe('User Test Org');
    });

    test('400: invalid role value → validation error', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'SUPERUSER' });

      expect(res.status).toBe(400);
    });

    test('400: no fields → validation error', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    test('404: nonexistent user → not found', async () => {
      const res = await request(app)
        .patch('/users/nonexistent-user-id-12345')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(404);
    });

    test('403: customer cannot update users', async () => {
      const res = await request(app)
        .patch(`/users/${testUserId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
    });
  });
});
