// Contract tests for Venue endpoints
// Tests: GET/POST /organizations/:orgId/venues, GET/PATCH/DELETE /organizations/:orgId/venues/:id
// Per FR-049, FR-010: org-scoped access, 409 on delete with linked events

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';

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
  let publicVenueId;
  let emptyVenueId;
  let privateVenueId;
  let inactiveVenueId;
  let inactiveOrgId;

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

    const publicVenue = await prisma.venue.create({
      data: {
        organizationId: testOrgId,
        name: 'Public Contract Venue',
        address: '10 Public Plaza',
        timezone: 'America/New_York',
        isPublic: true,
        logoUrl: '/uploads/logos/public-venue.webp',
      },
    });
    publicVenueId = publicVenue.id;

    const emptyVenue = await prisma.venue.create({
      data: {
        organizationId: testOrgId,
        name: 'Empty Public Venue',
        address: '11 Public Plaza',
        isPublic: true,
      },
    });
    emptyVenueId = emptyVenue.id;

    const privateVenue = await prisma.venue.create({
      data: {
        organizationId: testOrgId,
        name: 'Private Contract Venue',
        address: '12 Private Plaza',
        isPublic: false,
      },
    });
    privateVenueId = privateVenue.id;

    const inactiveOrg = await prisma.organization.create({
      data: { name: 'Inactive Venue Contract Org', status: 'INACTIVE' },
    });
    inactiveOrgId = inactiveOrg.id;
    const inactiveVenue = await prisma.venue.create({
      data: {
        organizationId: inactiveOrgId,
        name: 'Inactive Organization Venue',
        address: '13 Inactive Plaza',
        isPublic: true,
      },
    });
    inactiveVenueId = inactiveVenue.id;

    await prisma.event.create({
      data: {
        venueId: publicVenueId,
        name: 'Later Published Event',
        date: new Date('2027-08-15T19:00:00.000Z'),
        capacity: 100,
        category: 'music',
        status: 'PUBLISHED',
        priceTiers: {
          create: [
            {
              name: 'General Admission',
              price: 25,
              quantityTotal: 50,
              quantitySold: 8,
              quantityReserved: 2,
              isActive: true,
            },
            {
              name: 'VIP',
              price: 75,
              quantityTotal: 20,
              quantitySold: 5,
              quantityReserved: 0,
              isActive: true,
            },
            {
              name: 'Hidden Tier',
              price: 5,
              quantityTotal: 30,
              isActive: false,
            },
          ],
        },
      },
    });

    await prisma.event.createMany({
      data: [
        {
          venueId: publicVenueId,
          name: 'Earlier Published Event',
          date: new Date('2027-07-15T19:00:00.000Z'),
          capacity: 30,
          category: 'theater',
          status: 'PUBLISHED',
        },
        {
          venueId: publicVenueId,
          name: 'Draft Event',
          date: new Date('2027-06-15T19:00:00.000Z'),
          capacity: 30,
          status: 'DRAFT',
        },
        {
          venueId: publicVenueId,
          name: 'Cancelled Event',
          date: new Date('2027-05-15T19:00:00.000Z'),
          capacity: 30,
          status: 'CANCELLED',
        },
      ],
    });
  });

  afterAll(async () => {
    const organizationIds = [testOrgId, inactiveOrgId].filter(Boolean);
    await prisma.priceTier.deleteMany({
      where: { event: { venue: { organizationId: { in: organizationIds } } } },
    });
    await prisma.event.deleteMany({
      where: { venue: { organizationId: { in: organizationIds } } },
    });
    await prisma.venue.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  });

  describe('GET /venues/:venueId (public)', () => {
    it('returns only public venue fields without authentication', async () => {
      const res = await request(app).get(`/venues/${publicVenueId}`).expect(200);

      expect(res.body.venue).toEqual({
        id: publicVenueId,
        name: 'Public Contract Venue',
        address: '10 Public Plaza',
        timezone: 'America/New_York',
        logoUrl: '/uploads/logos/public-venue.webp',
        brandColor: null,
      });
      expect(res.body.venue).not.toHaveProperty('organizationId');
    });

    it('exposes the owning organization brand color', async () => {
      await prisma.organization.update({ where: { id: testOrgId }, data: { brandColor: '#047857' } });
      try {
        const res = await request(app).get(`/venues/${publicVenueId}`).expect(200);
        expect(res.body.venue.brandColor).toBe('#047857');
      } finally {
        await prisma.organization.update({ where: { id: testOrgId }, data: { brandColor: null } });
      }
    });

    it('returns only published events for the venue in date order', async () => {
      const res = await request(app).get(`/venues/${publicVenueId}`).expect(200);

      expect(res.body.events.map((event) => event.name)).toEqual([
        'Earlier Published Event',
        'Later Published Event',
      ]);
      expect(res.body.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            date: expect.any(String),
            venue: {
              id: publicVenueId,
              name: 'Public Contract Venue',
              address: '10 Public Plaza',
            },
            category: expect.anything(),
            status: 'PUBLISHED',
            availableTickets: expect.any(Number),
          }),
        ])
      );

      const pricedEvent = res.body.events.find((event) => event.name === 'Later Published Event');
      expect(pricedEvent.priceRange).toEqual({ min: 25, max: 75 });
      expect(pricedEvent.availableTickets).toBe(55);
    });

    it.each([
      ['unknown', 'missing-venue-id'],
      ['private', () => privateVenueId],
      ['owned by an inactive organization', () => inactiveVenueId],
    ])('returns 404 for a %s venue', async (_label, venueId) => {
      const id = typeof venueId === 'function' ? venueId() : venueId;
      const res = await request(app).get(`/venues/${id}`).expect(404);
      expect(res.body.message).toBe('Venue not found');
    });

    it('returns an empty event list for a public venue with no published events', async () => {
      const res = await request(app).get(`/venues/${emptyVenueId}`).expect(200);
      expect(res.body.events).toEqual([]);
    });
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

    it('rejects oversized fields and arbitrary logo URLs', async () => {
      const oversized = await request(app)
        .patch(`/organizations/${testOrgId}/venues/${publicVenueId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'x'.repeat(256) });
      expect(oversized.status).toBe(400);

      const logoUrl = await request(app)
        .patch(`/organizations/${testOrgId}/venues/${publicVenueId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ logoUrl: 'https://untrusted.example/logo.png' });
      expect(logoUrl.status).toBe(400);
    });

    it('does not update a venue through another organization URL', async () => {
      const res = await request(app)
        .patch(`/organizations/${inactiveOrgId}/venues/${publicVenueId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Cross Organization Rename' });
      expect(res.status).toBe(404);
    });
  });

  describe('venue logo management', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );

    it('uploads, replaces, and removes a venue logo', async () => {
      const upload = await request(app)
        .post(`/organizations/${testOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .attach('logo', png, { filename: 'venue.png', contentType: 'image/png' });
      expect(upload.status).toBe(200);
      expect(upload.body.logoUrl).toMatch(/^\/uploads\/logos\/[a-f0-9-]+\.png$/);

      const replacement = await request(app)
        .post(`/organizations/${testOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .attach('logo', png, { filename: 'replacement.png', contentType: 'image/png' });
      expect(replacement.status).toBe(200);
      expect(replacement.body.logoUrl).not.toBe(upload.body.logoUrl);

      const removal = await request(app)
        .delete(`/organizations/${testOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`);
      expect(removal.status).toBe(200);
      expect(removal.body.logoUrl).toBeNull();
    });

    it('rejects missing and invalid files', async () => {
      const missing = await request(app)
        .post(`/organizations/${testOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`);
      expect(missing.status).toBe(400);

      const invalid = await request(app)
        .post(`/organizations/${testOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .attach('logo', Buffer.from('not an image'), {
          filename: 'venue.txt',
          contentType: 'text/plain',
        });
      expect(invalid.status).toBe(400);
    });

    it('denies logo changes through another organization URL', async () => {
      const upload = await request(app)
        .post(`/organizations/${inactiveOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .attach('logo', png, { filename: 'venue.png', contentType: 'image/png' });
      expect(upload.status).toBe(404);

      const removal = await request(app)
        .delete(`/organizations/${inactiveOrgId}/venues/${emptyVenueId}/logo`)
        .set('Authorization', `Bearer ${organizerToken}`);
      expect(removal.status).toBe(404);
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

    it('returns 409 when deleting a venue with linked events', async () => {
      const res = await request(app)
        .delete(`/organizations/${testOrgId}/venues/${publicVenueId}`)
        .set('Authorization', `Bearer ${organizerToken}`);
      expect(res.status).toBe(409);
    });

    it('does not delete a venue through another organization URL', async () => {
      const res = await request(app)
        .delete(`/organizations/${inactiveOrgId}/venues/${emptyVenueId}`)
        .set('Authorization', `Bearer ${organizerToken}`);
      expect(res.status).toBe(404);
    });
  });
});
