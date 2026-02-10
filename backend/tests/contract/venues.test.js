// Contract tests for Venue endpoints
// Tests: GET/POST /organizations/:orgId/venues, GET/PATCH/DELETE /organizations/:orgId/venues/:id
// Per FR-049, FR-010: org-scoped access, 409 on delete with linked events

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-user-id',
    email: overrides.email || 'organizer@test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Venue Contract Tests', () => {
  let adminToken;
  let organizerToken;
  let customerToken;
  let testOrgId;

  beforeAll(async () => {
    adminToken = generateToken({ role: 'ADMIN', email: 'admin@test.com' });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@test.com' });
    customerToken = generateToken({ role: 'CUSTOMER', email: 'customer@test.com' });

    // Create a test organization for venue tests
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Venue Test Org' });

    testOrgId = orgRes.body.id;
  });

  describe('POST /organizations/:orgId/venues', () => {
    it('should return 201 when organizer creates a venue', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Test Venue',
          address: '123 Test St, Test City, TC 12345',
          timezone: 'America/New_York',
          isPublic: true,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Venue');
      expect(res.body.organizationId).toBe(testOrgId);
    });

    it('should return 201 when admin creates a venue', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin Venue',
          address: '456 Admin Ave, Admin City, AC 67890',
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Admin Venue');
    });

    it('should return 403 when customer tries to create venue', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Unauthorized Venue',
          address: '789 Unauth St',
        });

      expect(res.status).toBe(403);
    });

    it('should return 400/422 when required fields are missing', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'No Address Venue' });

      expect([400, 422]).toContain(res.status);
    });
  });

  describe('GET /organizations/:orgId/venues', () => {
    it('should return 200 with venue list scoped to organization', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // All returned venues should belong to the org
      res.body.forEach((venue) => {
        expect(venue.organizationId).toBe(testOrgId);
      });
    });
  });

  describe('GET /organizations/:orgId/venues/:id', () => {
    it('should return 200 with venue details', async () => {
      // Create a venue first
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Detail Venue',
          address: '100 Detail Blvd',
        });

      const venueId = createRes.body.id;

      const res = await request(app)
        .get(`/organizations/${testOrgId}/venues/${venueId}`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(venueId);
      expect(res.body.name).toBe('Detail Venue');
    });

    it('should return 404 for non-existent venue', async () => {
      const res = await request(app)
        .get(`/organizations/${testOrgId}/venues/nonexistent-id`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /organizations/:orgId/venues/:id', () => {
    it('should return 200 when organizer updates venue', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Old Venue Name',
          address: '200 Old St',
        });

      const venueId = createRes.body.id;

      const res = await request(app)
        .patch(`/organizations/${testOrgId}/venues/${venueId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'New Venue Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Venue Name');
    });
  });

  describe('DELETE /organizations/:orgId/venues/:id', () => {
    it('should return 204 when deleting venue with no linked events', async () => {
      const createRes = await request(app)
        .post(`/organizations/${testOrgId}/venues`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Deletable Venue',
          address: '300 Delete Dr',
        });

      const venueId = createRes.body.id;

      const res = await request(app)
        .delete(`/organizations/${testOrgId}/venues/${venueId}`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(204);
    });

    // Note: 409 on delete with linked events will be tested after events are implemented (US1)
  });
});
