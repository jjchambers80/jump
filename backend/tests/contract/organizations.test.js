// Contract tests for Organization endpoints
// Tests: GET/POST /organizations, GET/PATCH /organizations/:id
// Per FR-048: admin-only access, 201 on create, scoping

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';

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
    const patchEmails = ['patch-admin@test.com', 'patch-other-admin@test.com'];
    let orgId;
    let otherOrgId;
    let orgAdminToken;
    let otherOrgAdminToken;
    let systemAdminToken;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: patchEmails } } });

      const createRes = await request(app)
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Original Name' });
      orgId = createRes.body.id;

      const otherOrg = await prisma.organization.create({ data: { name: 'Other Patch Org' } });
      otherOrgId = otherOrg.id;

      const orgAdmin = await prisma.user.create({
        data: { email: patchEmails[0], role: 'ADMIN', organizationId: orgId },
      });
      const otherAdmin = await prisma.user.create({
        data: { email: patchEmails[1], role: 'ADMIN', organizationId: otherOrgId },
      });

      orgAdminToken = generateToken({ id: orgAdmin.id, email: orgAdmin.email, role: 'ADMIN' });
      otherOrgAdminToken = generateToken({ id: otherAdmin.id, email: otherAdmin.email, role: 'ADMIN' });
      systemAdminToken = generateToken({ role: 'SYSTEM_ADMIN', email: 'sysadmin@test.com' });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: patchEmails } } }).catch(() => {});
      await prisma.organization
        .deleteMany({ where: { id: { in: [orgId, otherOrgId].filter(Boolean) } } })
        .catch(() => {});
    });

    it('should return 200 when an admin of the org updates it', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('should return 200 when a system admin updates any org', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${systemAdminToken}`)
        .send({ name: 'Updated By Sysadmin' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated By Sysadmin');
    });

    it('should return 403 when an admin of another org updates it', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${otherOrgAdminToken}`)
        .send({ name: 'Cross Org Name' });

      expect(res.status).toBe(403);
    });

    it('should return 403 for non-admin users', async () => {
      const res = await request(app)
        .patch('/organizations/some-id')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(403);
    });

    it('sets a normalized brand color', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ brandColor: '#1D4ED8' });

      expect(res.status).toBe(200);
      expect(res.body.brandColor).toBe('#1d4ed8');
    });

    it('exposes the brand color on the public organization endpoint', async () => {
      const res = await request(app).get(`/organizations/${orgId}/public`).expect(200);

      expect(res.body.organization.brandColor).toBe('#1d4ed8');
    });

    it('clears the brand color with null', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ brandColor: null });

      expect(res.status).toBe(200);
      expect(res.body.brandColor).toBeNull();
    });

    it('returns 400 for an invalid brand color', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ brandColor: 'blue' });

      expect(res.status).toBe(400);
    });

    it('defaults themeMode to SYSTEM', async () => {
      const org = await prisma.organization.findUnique({ where: { id: otherOrgId } });

      expect(org.themeMode).toBe('SYSTEM');
    });

    it.each(['LIGHT', 'DARK', 'SYSTEM'])('sets themeMode %s', async (themeMode) => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ themeMode });

      expect(res.status).toBe(200);
      expect(res.body.themeMode).toBe(themeMode);
    });

    it('normalizes lowercase themeMode input', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ themeMode: 'dark' });

      expect(res.status).toBe(200);
      expect(res.body.themeMode).toBe('DARK');
    });

    it('exposes themeMode on the public organization endpoint', async () => {
      const res = await request(app).get(`/organizations/${orgId}/public`).expect(200);

      expect(res.body.organization.themeMode).toBe('DARK');
    });

    it('returns 400 for an invalid themeMode', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ themeMode: 'blue' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for the removed USER themeMode', async () => {
      const res = await request(app)
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .send({ themeMode: 'USER' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/settings/business-details', () => {
    const settingsEmails = [
      'settings-admin@test.com',
      'settings-organizer@test.com',
      'settings-customer@test.com',
      'settings-no-org@test.com',
    ];
    let settingsUser;
    let organizerUser;
    let customerUser;
    let noOrgUser;
    let settingsOrganization;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: settingsEmails } } });
      settingsOrganization = await prisma.organization.create({
        data: {
          name: 'Settings Company LLC',
          businessType: 'SINGLE_MEMBER_LLC',
          countryCode: 'US',
          addressLine1: '123 Main Street',
          city: 'Cary',
          state: 'NC',
          postalCode: '27511',
          phoneCountryCode: '+1',
          ein: '123456789',
        },
      });
      settingsUser = await prisma.user.create({
        data: {
          email: settingsEmails[0],
          role: 'ADMIN',
          organizationId: settingsOrganization.id,
        },
      });
      organizerUser = await prisma.user.create({
        data: {
          email: settingsEmails[1],
          role: 'ORGANIZER',
          organizationId: settingsOrganization.id,
        },
      });
      customerUser = await prisma.user.create({
        data: { email: settingsEmails[2], role: 'CUSTOMER' },
      });
      noOrgUser = await prisma.user.create({
        data: { email: settingsEmails[3], role: 'ADMIN' },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: { in: settingsEmails } } }).catch(() => {});
      if (settingsOrganization?.id) {
        await prisma.organization.deleteMany({ where: { id: settingsOrganization.id } }).catch(() => {});
      }
    });

    it('returns the organization assigned to the authenticated admin', async () => {
      const token = generateToken({
        id: settingsUser.id,
        email: settingsEmails[0],
        role: 'ADMIN',
      });

      const res = await request(app)
        .get('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: settingsOrganization.id,
        name: 'Settings Company LLC',
        hasEin: true,
        einMasked: '••-•••6789',
      });
      expect(res.body).not.toHaveProperty('ein');
    });

    it('allows an organizer assigned to the organization', async () => {
      const token = generateToken({
        id: organizerUser.id,
        email: settingsEmails[1],
        role: 'ORGANIZER',
      });

      const res = await request(app)
        .get('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(settingsOrganization.id);
    });

    it('rejects customers', async () => {
      const token = generateToken({
        id: customerUser.id,
        email: settingsEmails[2],
        role: 'CUSTOMER',
      });

      const res = await request(app)
        .get('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 when the user has no assigned organization', async () => {
      const token = generateToken({ id: noOrgUser.id, email: settingsEmails[3], role: 'ADMIN' });

      const res = await request(app)
        .get('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('updates and normalizes the assigned organization without exposing EIN', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '  Renamed Company LLC ',
          businessType: 'SINGLE_MEMBER_LLC',
          nickname: ' Renamed ',
          countryCode: 'us',
          addressLine1: ' 456 Oak Avenue ',
          addressLine2: null,
          city: ' Raleigh ',
          state: 'nc',
          postalCode: '27601',
          phoneCountryCode: '+1',
          phoneNumber: '(919) 555-1212',
          ein: '98-7654321',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Renamed Company LLC',
        nickname: 'Renamed',
        state: 'NC',
        phoneNumber: '9195551212',
        einMasked: '••-•••4321',
      });
      expect(res.body).not.toHaveProperty('ein');

      const stored = await prisma.organization.findUnique({ where: { id: settingsOrganization.id } });
      expect(stored.ein).toBe('987654321');
    });

    it('preserves EIN when it is omitted', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Renamed Company LLC',
          businessType: 'SINGLE_MEMBER_LLC',
          nickname: null,
          countryCode: 'US',
          addressLine1: '456 Oak Avenue',
          addressLine2: null,
          city: 'Raleigh',
          state: 'NC',
          postalCode: '27601',
          phoneCountryCode: '+1',
          phoneNumber: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.einMasked).toBe('••-•••4321');
    });

    it('accepts a partial store-contact payload and leaves other fields intact', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: ' Store Front ',
          email: ' Hello@Store.COM ',
          phoneCountryCode: '+1',
          phoneNumber: '(919) 555-0000',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Store Front',
        email: 'hello@store.com',
        phoneNumber: '9195550000',
        addressLine1: '456 Oak Avenue',
        city: 'Raleigh',
        einMasked: '••-•••4321',
      });
    });

    it('accepts a partial store-address payload with companyName', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({
          companyName: 'Store Front Holdings LLC',
          countryCode: 'US',
          addressLine1: '789 Pine Street',
          addressLine2: 'Suite 2',
          city: 'Durham',
          state: 'nc',
          postalCode: '27701',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Store Front',
        companyName: 'Store Front Holdings LLC',
        addressLine1: '789 Pine Street',
        addressLine2: 'Suite 2',
        city: 'Durham',
        state: 'NC',
        postalCode: '27701',
      });
    });

    it('rejects an invalid email in a partial payload', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
    });

    it('rejects unknown fields', async () => {
      const token = generateToken({ id: settingsUser.id, email: settingsEmails[0], role: 'ADMIN' });

      const res = await request(app)
        .patch('/admin/settings/business-details')
        .set('Authorization', `Bearer ${token}`)
        .send({ organizationId: 'another-organization' });

      expect(res.status).toBe(400);
    });
  });
});
