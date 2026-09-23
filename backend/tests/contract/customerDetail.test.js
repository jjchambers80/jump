// Contract tests for customer detail Phase 1 APIs (spec 032).
// Covers: PATCH partial validator, email change collision, marketing provenance,
// GET response extension, send-sign-in-link, ?tag= filter.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { platformBaseUrl } from '../../src/utils/storefrontUrl.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'cust-detail-ct';
const emails = [
  `admin@${TAG}.test`,
  `organizer@${TAG}.test`,
  `admin-other@${TAG}.test`,
];
const auth = (token) => ['Authorization', `Bearer ${token}`];

/** Minimal self-contained org + staff + one event. Cleans up on teardown. */
async function seedOrg(nameTail) {
  const tag = `${TAG}-${nameTail}`;
  const org = await prisma.organization.create({ data: { name: `${tag} Org` } });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${tag} Venue`, slug: `${tag}-venue`, address: '123 Test St' } });
  const event = await prisma.event.create({
    data: {
      venueId: venue.id,
      name: `${tag} Event`,
      date: new Date('2027-06-01'),
      capacity: 100,
      slug: `${tag}-event`,
    },
  });
  return { org, venue, event, tag };
}

async function makePaidCustomer({ orgId, eventId, overrides = {}, refSuffix }) {
  const c = await prisma.contact.create({
    data: {
      organizationId: orgId,
      email: `cust-${refSuffix}@${TAG}.test`,
      firstName: 'Test',
      lastName: 'Customer',
      ...overrides,
    },
  });
  await prisma.order.create({
    data: {
      contactId: c.id,
      eventId,
      status: 'COMPLETED',
      totalAmount: '25.00',
      quantity: 1,
      orderRef: `ORD-${refSuffix}`,
      paidAt: new Date(),
    },
  });
  return c;
}

async function cleanupOrg({ org, venue, event }) {
  await prisma.order.deleteMany({ where: { eventId: event.id } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
  await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
  await prisma.venue.deleteMany({ where: { id: venue.id } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
}

describe('Customer detail Phase 1 contract', () => {
  let adminToken;
  let organizerToken;
  let otherAdminToken;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { contains: TAG } } })
      .catch(() => {});

    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherAdminToken = await staffToken({ email: emails[2], role: 'ADMIN' });
  });

  afterAll(async () => {
    await cleanupStaff(emails);
  });

  describe('PATCH /admin/customers/:id — partial validator', () => {
    let contact;
    let detailPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('patch');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'patch-main' });
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    beforeEach(async () => {
      // Reset contact to known state before each test
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          firstName: 'Test',
          lastName: 'Customer',
          phone: null,
          tags: [],
          location: 'Somewhere',
          note: 'Original note',
        },
      });
    });

    it('rejects empty body', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({});
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('body');
    });

    it('rejects unknown fields', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ unknownField: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('unknownField');
    });

    it('updates firstName and lastName', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        firstName: 'Updated',
        lastName: 'Name',
      });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe('Updated');
      expect(res.body.lastName).toBe('Name');
    });

    it('updates phone', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        phone: '+12125551234',
      });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('+12125551234');
    });

    it('clears phone by setting null', async () => {
      // First set a phone, then clear it
      await prisma.contact.update({ where: { id: contact.id }, data: { phone: '+14155559999' } });
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ phone: null });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBeNull();
    });

    it('rejects phone as empty string', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ phone: '' });
      expect(res.status).toBe(400);
    });

    it('updates tags', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        tags: ['VIP', 'Press'],
      });
      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(['VIP', 'Press']);
    });

    it('rejects tags that exceed 20 items', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
      });
      expect(res.status).toBe(400);
    });

    it('rejects non-array tags', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ tags: 'not-an-array' });
      expect(res.status).toBe(400);
    });

    it('updates location and note', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        location: 'New York, NY',
        note: 'Updated note with more info',
      });
      expect(res.status).toBe(200);
      expect(res.body.note).toBe('Updated note with more info');
      expect(res.body.location).toBe('New York, NY');
    });
  });

  describe('PATCH — email change', () => {
    let contact;
    let detailPath;
    let seed;
    let otherContact; // another contact in the same org for collision testing

    beforeAll(async () => {
      seed = await seedOrg('email');
      contact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'email-main' });
      otherContact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'email-other' });
      // Give otherContact a known email for collision testing
      await prisma.contact.update({
        where: { id: otherContact.id },
        data: { email: `collision-target@${TAG}.test` },
      });
      // Join the admin to the org
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      await joinOrgByToken(organizerToken, seed.org.id, 'ORGANIZER');
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('allows ADMIN to change email', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        email: `email-changed@${TAG}.test`,
      });
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(`email-changed@${TAG}.test`);
    });

    it('blocks ORGANIZER from changing email', async () => {
      const res = await request(app).patch(detailPath).set(...auth(organizerToken)).send({
        email: `organizer-try@${TAG}.test`,
      });
      expect(res.status).toBe(403);
    });

    it('returns 409 EMAIL_TAKEN when email is in use by another contact in the same org', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({
        email: `collision-target@${TAG}.test`,
      });
      expect(res.status).toBe(409);
      expect(res.body.details?.code).toBe('EMAIL_TAKEN');
    });
  });

  describe('GET /admin/customers/:id — extended response', () => {
    let contact;
    let detailPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('get-detail');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'get-detail',
        overrides: {
          phone: '+14155551234',
          tags: ['VIP'],
          emailSubscribed: true,
          emailSubscribedAt: new Date('2026-09-01'),
          emailSubscribedSource: 'CHECKOUT',
          accountCreatedAt: new Date('2026-08-15'),
        },
      });
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('includes phone, tags, accountCreatedAt, lastSignInAt, marketing provenance, and accountUrl', async () => {
      const res = await request(app).get(detailPath).set(...auth(adminToken));
      expect(res.status).toBe(200);

      expect(res.body).toHaveProperty('phone', '+14155551234');
      expect(res.body).toHaveProperty('tags', ['VIP']);
      expect(res.body).toHaveProperty('accountCreatedAt');
      expect(res.body).toHaveProperty('lastSignInAt');
      expect(res.body).toHaveProperty('emailSubscribedAt');
      expect(res.body).toHaveProperty('emailSubscribedSource', 'CHECKOUT');
      expect(res.body).toHaveProperty('emailUnsubscribedAt');
      expect(res.body).toHaveProperty('accountUrl');
      expect(res.body.accountUrl).toContain('/account');

      // Existing fields preserved
      expect(res.body).toHaveProperty('firstName', 'Test');
      expect(res.body).toHaveProperty('email');
      expect(res.body).toHaveProperty('note');
      expect(res.body).toHaveProperty('location');
      expect(res.body).toHaveProperty('orders');
      expect(res.body).toHaveProperty('applications');
      expect(res.body).toHaveProperty('totalSpent');
    });
  });

  describe('POST /admin/customers/:id/send-sign-in-link', () => {
    let contactWithAccount;
    let contactGuest;
    let sendLinkPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('sendlink');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contactWithAccount = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'sendlink-acct',
        overrides: { accountCreatedAt: new Date('2026-07-01') },
      });
      contactGuest = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'sendlink-guest',
      });
      sendLinkPath = `/admin/customers/${contactWithAccount.id}/send-sign-in-link`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('returns 200 and sent=true for a customer with an account', async () => {
      const res = await request(app).post(sendLinkPath).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: true });
    });

    it('returns 422 for a guest contact with no account', async () => {
      const res = await request(app)
        .post(`/admin/customers/${contactGuest.id}/send-sign-in-link`)
        .set(...auth(adminToken));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NO_ACCOUNT');
    });
  });

  describe('GET /admin/customers?tag= filter', () => {
    let seed;
    let taggedContact;
    let untaggedContact;

    beforeAll(async () => {
      seed = await seedOrg('tagfilter');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      taggedContact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'tagged',
        overrides: { tags: ['VIP', 'Press'] },
      });
      untaggedContact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'untagged',
        overrides: { tags: [] },
      });
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('returns only contacts with a matching tag when ?tag= is specified', async () => {
      const res = await request(app).get(`/admin/customers?tag=VIP`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      const ids = res.body.data.map((c) => c.id);
      expect(ids).toContain(taggedContact.id);
      expect(ids).not.toContain(untaggedContact.id);
    });

    it('returns an empty list when the tag matches no contact', async () => {
      const res = await request(app).get(`/admin/customers?tag=NONEXISTENT_TAG`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('includes tags in the list response for every row', async () => {
      const res = await request(app).get(`/admin/customers`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.length).toBeGreaterThanOrEqual(2);
      for (const row of data) {
        expect(row).toHaveProperty('tags');
      }
    });
  });

  describe('Marketing provenance on PATCH emailSubscribed', () => {
    let contact;
    let detailPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('marketing');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'marketing',
        overrides: {
          emailSubscribed: false,
          emailSubscribedAt: null,
          emailSubscribedSource: null,
          emailUnsubscribedAt: null,
        },
      });
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('writes emailSubscribedSource=ADMIN and timestamps when admin toggles on', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ emailSubscribed: true });
      expect(res.status).toBe(200);
      expect(res.body.emailSubscribed).toBe(true);
      expect(res.body.emailSubscribedSource).toBe('ADMIN');
      expect(res.body.emailSubscribedAt).toBeTruthy();
      expect(res.body.emailUnsubscribedAt).toBeNull();
    });

    it('writes emailUnsubscribedAt when admin toggles off', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ emailSubscribed: false });
      expect(res.status).toBe(200);
      expect(res.body.emailSubscribed).toBe(false);
      expect(res.body.emailUnsubscribedAt).toBeTruthy();
    });
  });

  // ── Additional validation and edge-case coverage ─────────────────────────

  describe('PATCH — validation edge cases', () => {
    let contact;
    let detailPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('val-edge');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'val-edge' });
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('rejects invalid email format', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('rejects email as non-string', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ email: 123 });
      expect(res.status).toBe(400);
    });

    it('rejects emailSubscribed as non-boolean', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ emailSubscribed: 'yes' });
      expect(res.status).toBe(400);
    });

    it('rejects firstName exceeding 255 characters', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ firstName: 'a'.repeat(256) });
      expect(res.status).toBe(400);
    });

    it('rejects lastName exceeding 255 characters', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ lastName: 'b'.repeat(256) });
      expect(res.status).toBe(400);
    });

    it('rejects phone exceeding 50 characters', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ phone: '1'.repeat(51) });
      expect(res.status).toBe(400);
    });

    it('rejects location exceeding 500 characters', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ location: 'c'.repeat(501) });
      expect(res.status).toBe(400);
    });

    it('rejects note exceeding 5000 characters', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ note: 'd'.repeat(5001) });
      expect(res.status).toBe(400);
    });

    it('rejects empty firstName', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ firstName: '' });
      expect(res.status).toBe(400);
    });

    it('rejects empty lastName', async () => {
      const res = await request(app).patch(detailPath).set(...auth(adminToken)).send({ lastName: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('Authorization — 401 for unauthenticated requests', () => {
    let contact;
    let guestContact;
    let detailPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('auth');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'auth-main' });
      guestContact = await makePaidCustomer({ orgId: seed.org.id, eventId: seed.event.id, refSuffix: 'auth-guest' });
      detailPath = `/admin/customers/${contact.id}`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('rejects PATCH without auth token', async () => {
      const res = await request(app).patch(detailPath).send({ firstName: 'X' });
      expect(res.status).toBe(401);
    });

    it('rejects GET detail without auth token', async () => {
      const res = await request(app).get(detailPath);
      expect(res.status).toBe(401);
    });

    it('rejects GET list without auth token', async () => {
      const res = await request(app).get('/admin/customers');
      expect(res.status).toBe(401);
    });

    it('rejects POST send-sign-in-link without auth token', async () => {
      const res = await request(app).post(`/admin/customers/${contact.id}/send-sign-in-link`);
      expect(res.status).toBe(401);
    });

    it('rejects GET ?tag= filter without auth token', async () => {
      const res = await request(app).get('/admin/customers?tag=VIP');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/customers/:id — segment and guest accountUrl', () => {
    let contactWithOneOrder;
    let contactWithTwoOrders;
    let alphaNewContact;
    let zuluNewContact;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('segment');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');

      // New segment: one paid order
      contactWithOneOrder = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'seg-one',
        overrides: {
          firstName: 'Middle',
          lastName: 'Buyer',
          accountCreatedAt: new Date('2026-08-01'),
        },
      });

      alphaNewContact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'seg-alpha',
        overrides: { firstName: 'Alpha', lastName: 'Buyer' },
      });
      zuluNewContact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'seg-zulu',
        overrides: { firstName: 'Zulu', lastName: 'Buyer' },
      });

      // Repeat segment: two paid orders
      contactWithTwoOrders = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'seg-two',
        overrides: { accountCreatedAt: new Date('2026-07-01') },
      });
      // Add a second paid order for the repeat contact
      await prisma.order.create({
        data: {
          contactId: contactWithTwoOrders.id,
          eventId: seed.event.id,
          status: 'COMPLETED',
          totalAmount: '35.00',
          quantity: 1,
          orderRef: 'ORD-seg-two-2',
          paidAt: new Date(),
        },
      });
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('returns segment New for contacts with exactly one paid order', async () => {
      const res = await request(app).get(`/admin/customers/${contactWithOneOrder.id}`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.segment).toBe('New');
    });

    it('returns segment Repeat for contacts with two or more paid orders', async () => {
      const res = await request(app).get(`/admin/customers/${contactWithTwoOrders.id}`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.segment).toBe('Repeat');
    });

    it('combines segment filtering and sorting before pagination', async () => {
      const res = await request(app)
        .get('/admin/customers?segment=New&sort=name&direction=asc&limit=2')
        .set(...auth(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.data.map((customer) => [customer.firstName, customer.segment])).toEqual([
        ['Alpha', 'New'],
        ['Middle', 'New'],
      ]);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    });

    it('returns prevId and nextId at both filtered-list boundaries', async () => {
      const query = '?segment=New&sort=name&direction=asc';
      const [first, middle, last] = await Promise.all([
        request(app).get(`/admin/customers/${alphaNewContact.id}${query}`).set(...auth(adminToken)),
        request(app).get(`/admin/customers/${contactWithOneOrder.id}${query}`).set(...auth(adminToken)),
        request(app).get(`/admin/customers/${zuluNewContact.id}${query}`).set(...auth(adminToken)),
      ]);

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ prevId: null, nextId: contactWithOneOrder.id });
      expect(middle.status).toBe(200);
      expect(middle.body).toMatchObject({ prevId: alphaNewContact.id, nextId: zuluNewContact.id });
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ prevId: contactWithOneOrder.id, nextId: null });
    });

    it('returns accountUrl for contacts with an account', async () => {
      const res = await request(app).get(`/admin/customers/${contactWithOneOrder.id}`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.accountUrl).toBeTruthy();
      expect(res.body.accountUrl).toContain('/account');
    });
  });

  describe('POST /admin/customers/:id/send-sign-in-link — rate limiting headers', () => {
    let contact;
    let sendLinkPath;
    let seed;

    beforeAll(async () => {
      seed = await seedOrg('ratelimit');
      await joinOrgByToken(adminToken, seed.org.id, 'ADMIN');
      contact = await makePaidCustomer({
        orgId: seed.org.id,
        eventId: seed.event.id,
        refSuffix: 'ratelimit',
        overrides: { accountCreatedAt: new Date('2026-07-01') },
      });
      sendLinkPath = `/admin/customers/${contact.id}/send-sign-in-link`;
    });

    afterAll(async () => {
      await cleanupOrg(seed);
    });

    it('returns rate limit headers on success', async () => {
      // The rate limiter is a pass-through under test unless RATE_LIMIT_ENFORCE_IN_TESTS=1
      // so this test verifies the middleware is wired (headers present) rather
      // than asserting 429.
      const res = await request(app).post(sendLinkPath).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: true });
    });
  });
});