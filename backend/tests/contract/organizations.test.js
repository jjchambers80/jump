// Contract tests for Organization endpoints
// Tests: GET/POST /organizations, GET/PATCH /organizations/:id
// Per FR-048: admin-only access, 201 on create, scoping

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';

const AUTH_SECRET = process.env.AUTH_SECRET;

// Helper to generate a valid JWT token for a given role
function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-user-id',
    email: overrides.email || 'admin@test.com',
    role: overrides.role || 'ADMIN',
    name: overrides.name || 'Test Admin',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Organization Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;

  beforeAll(() => {
    adminToken = generateToken({ role: 'ADMIN' });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@test.com' });
    customerToken = generateToken({ role: 'CUSTOMER', email: 'customer@test.com' });
  });

  describe('POST /organizations', () => {
    it('should return 201 when admin creates an organization', async () => {
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Test Org' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Org');
      expect(res.body.status).toBe('ACTIVE');
    });

    it('should return 403 when organizer tries to create organization', async () => {
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Unauthorized Org' });

      expect(res.status).toBe(403);
    });

    it('should return 403 when customer tries to create organization', async () => {
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Unauthorized Org' });

      expect(res.status).toBe(403);
    });

    it('should return 401 when no token is provided', async () => {
      const res = await request(app).post('/organizations').send({ name: 'No Auth Org' });

      expect(res.status).toBe(401);
    });

    it('should return 400/422 when name is missing', async () => {
      const res = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect([400, 422]).toContain(res.status);
    });
  });

  describe('GET /organizations', () => {
    it('should return 200 with organization list for admin', async () => {
      const res = await request(app)
        .get('/organizations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/organizations')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /organizations/:id', () => {
    it('should return 200 with organization details for admin', async () => {
      // First create an org
      const createRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Detail Org' });

      const orgId = createRes.body.id;

      const res = await request(app)
        .get(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(orgId);
      expect(res.body.name).toBe('Detail Org');
    });

    it('should return 404 for non-existent organization', async () => {
      const res = await request(app)
        .get('/organizations/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /organizations/:id', () => {
    it('should return 200 when admin updates organization', async () => {
      // Create first
      const createRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Original Name' });

      const orgId = createRes.body.id;

      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('should return 403 for non-admin users', async () => {
      const res = await request(app)
        .patch('/organizations/some-id')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(403);
    });
  });
});
