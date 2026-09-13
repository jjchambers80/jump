// Contract tests for per-organization buyer identity (spec 007, phase 1)
//
// The same buyer email at two organizations is two Contact rows. Staff of one
// organization must never see the other organization's row, note, consent
// flag, or orders. Staff scoping comes from OrganizationMember, not
// User.organizationId.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Stripe is never reached for real in tests; createOrder writes Contact/Order first.
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_tenant_iso',
          url: 'https://checkout.stripe.com/pay/cs_tenant_iso',
          payment_intent: null,
          metadata: {},
        }),
      },
    },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: orderService } = await import('../../src/services/OrderService.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'tenant-iso';
const SHARED_EMAIL = `buyer@${TAG}.test`;
const staffEmails = [`admin-a@${TAG}.test`, `admin-b@${TAG}.test`, `both@${TAG}.test`, `sys@${TAG}.test`];

function tokenFor(user, extra = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: 'Tenant Test', ...extra },
    AUTH_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function createOrgWithOrder(name, contactFields) {
  const org = await prisma.organization.create({ data: { name } });
  const venue = await prisma.venue.create({
    data: { organizationId: org.id, name: `${name} Venue`, address: '1 Test St' },
  });
  const event = await prisma.event.create({
    data: {
      venueId: venue.id,
      name: `${name} Event`,
      date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      capacity: 100,
      status: 'PUBLISHED',
    },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      email: SHARED_EMAIL,
      firstName: 'Shared',
      lastName: 'Buyer',
      ...contactFields,
    },
  });
  const order = await prisma.order.create({
    data: {
      eventId: event.id,
      contactId: contact.id,
      orderRef: `${TAG}-${org.id.slice(-6)}`,
      totalAmount: 10,
      subtotalAmount: 10,
      quantity: 1,
      status: 'COMPLETED',
    },
  });
  return { org, venue, event, contact, order };
}

describe('Tenant isolation contract (spec 007 phase 1)', () => {
  let a;
  let b;
  let adminA;
  let adminB;
  let adminBoth;
  let sysAdmin;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: staffEmails } } });

    a = await createOrgWithOrder(`${TAG} Org A`, { note: 'A-private', emailSubscribed: true });
    b = await createOrgWithOrder(`${TAG} Org B`, { note: 'B-private', emailSubscribed: false });

    [adminA, adminB, adminBoth, sysAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          email: staffEmails[0],
          role: 'ADMIN',
          memberships: { create: { organizationId: a.org.id, role: 'ADMIN' } },
        },
      }),
      prisma.user.create({
        data: {
          email: staffEmails[1],
          role: 'ADMIN',
          memberships: { create: { organizationId: b.org.id, role: 'ADMIN' } },
        },
      }),
      prisma.user.create({
        data: {
          email: staffEmails[2],
          role: 'ORGANIZER',
          memberships: {
            create: [
              { organizationId: a.org.id, role: 'ORGANIZER' },
              { organizationId: b.org.id, role: 'ORGANIZER' },
            ],
          },
        },
      }),
      prisma.user.create({ data: { email: staffEmails[3], role: 'SYSTEM_ADMIN' } }),
    ]);
  });

  afterAll(async () => {
    const orgIds = [a?.org.id, b?.org.id].filter(Boolean);
    await prisma.order.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: staffEmails } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
  });

  describe('schema', () => {
    it('allows the same email at two organizations but not twice at one', async () => {
      expect(a.contact.id).not.toBe(b.contact.id);
      await expect(
        prisma.contact.create({
          data: { organizationId: a.org.id, email: SHARED_EMAIL, firstName: 'Dup', lastName: 'Dup' },
        })
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('defaults emailSubscribed to false and accountCreatedAt to null', async () => {
      const c = await prisma.contact.create({
        data: { organizationId: a.org.id, email: `fresh@${TAG}.test`, firstName: 'F', lastName: 'R' },
      });
      expect(c.emailSubscribed).toBe(false);
      expect(c.accountCreatedAt).toBeNull();
      await prisma.contact.delete({ where: { id: c.id } });
    });
  });

  describe('GET /admin/customers', () => {
    it('returns only the caller organization row, with its own note and consent', async () => {
      const res = await request(app)
        .get('/admin/customers')
        .set('Authorization', `Bearer ${tokenFor(adminA)}`)
        .query({ search: SHARED_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: a.contact.id,
        email: SHARED_EMAIL,
        note: 'A-private',
        emailSubscribed: true,
        orderCount: 1,
      });
    });

    it('shows org B its own row, not org A', async () => {
      const res = await request(app)
        .get('/admin/customers')
        .set('Authorization', `Bearer ${tokenFor(adminB)}`)
        .query({ search: SHARED_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.id)).toEqual([b.contact.id]);
      expect(res.body.data[0].note).toBe('B-private');
      expect(res.body.data[0].emailSubscribed).toBe(false);
    });

    it('shows SYSTEM_ADMIN both rows', async () => {
      const res = await request(app)
        .get('/admin/customers')
        .set('Authorization', `Bearer ${tokenFor(sysAdmin)}`)
        .query({ search: SHARED_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.id).sort()).toEqual([a.contact.id, b.contact.id].sort());
    });
  });

  describe('GET/PATCH /admin/customers/:contactId', () => {
    it('404s when org A asks for org B contact', async () => {
      const res = await request(app)
        .get(`/admin/customers/${b.contact.id}`)
        .set('Authorization', `Bearer ${tokenFor(adminA)}`);
      expect(res.status).toBe(404);
    });

    it('refuses to let org A write a note on org B contact', async () => {
      const res = await request(app)
        .patch(`/admin/customers/${b.contact.id}`)
        .set('Authorization', `Bearer ${tokenFor(adminA)}`)
        .send({ note: 'leaked' });
      expect(res.status).toBe(404);

      const untouched = await prisma.contact.findUnique({ where: { id: b.contact.id } });
      expect(untouched.note).toBe('B-private');
    });

    it('lets org A unsubscribe its own row without touching org B', async () => {
      const res = await request(app)
        .patch(`/admin/customers/${a.contact.id}`)
        .set('Authorization', `Bearer ${tokenFor(adminA)}`)
        .send({ emailSubscribed: false });
      expect(res.status).toBe(200);

      const [rowA, rowB] = await Promise.all([
        prisma.contact.findUnique({ where: { id: a.contact.id } }),
        prisma.contact.findUnique({ where: { id: b.contact.id } }),
      ]);
      expect(rowA.emailSubscribed).toBe(false);
      expect(rowB.emailSubscribed).toBe(false); // was already false; unchanged, not re-flipped

      await prisma.contact.update({ where: { id: a.contact.id }, data: { emailSubscribed: true } });
    });
  });

  describe('membership-based scoping', () => {
    it('denies org A admin access to org B venues', async () => {
      const res = await request(app)
        .get(`/organizations/${b.org.id}/venues`)
        .set('Authorization', `Bearer ${tokenFor(adminA)}`);
      expect(res.status).toBe(403);
    });

    it('lets a user with two memberships reach both organizations', async () => {
      const [ra, rb] = await Promise.all([
        request(app).get(`/organizations/${a.org.id}/venues`).set('Authorization', `Bearer ${tokenFor(adminBoth)}`),
        request(app).get(`/organizations/${b.org.id}/venues`).set('Authorization', `Bearer ${tokenFor(adminBoth)}`),
      ]);
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
    });

    it('uses the organizationId JWT claim to pick the active org for a multi-org user', async () => {
      const asB = await request(app)
        .get('/admin/customers')
        .set('Authorization', `Bearer ${tokenFor(adminBoth, { organizationId: b.org.id })}`)
        .query({ search: SHARED_EMAIL });
      expect(asB.status).toBe(200);
      expect(asB.body.data.map((c) => c.id)).toEqual([b.contact.id]);

      // Claim for an org the user is not a member of falls back to the first membership (A)
      const bogus = await request(app)
        .get('/admin/customers')
        .set('Authorization', `Bearer ${tokenFor(adminBoth, { organizationId: 'not-a-member' })}`)
        .query({ search: SHARED_EMAIL });
      expect(bogus.status).toBe(200);
      expect(bogus.body.data.map((c) => c.id)).toEqual([a.contact.id]);
    });

    it('gives staff with no membership no customers at all (not every org)', async () => {
      const orphan = await prisma.user.create({ data: { email: `orphan@${TAG}.test`, role: 'ADMIN' } });
      try {
        const list = await request(app)
          .get('/admin/customers')
          .set('Authorization', `Bearer ${tokenFor(orphan)}`)
          .query({ search: SHARED_EMAIL });
        expect(list.status).toBe(200);
        expect(list.body.data).toEqual([]);

        const detail = await request(app)
          .get(`/admin/customers/${a.contact.id}`)
          .set('Authorization', `Bearer ${tokenFor(orphan)}`);
        expect(detail.status).toBe(404);

        const patch = await request(app)
          .patch(`/admin/customers/${a.contact.id}`)
          .set('Authorization', `Bearer ${tokenFor(orphan)}`)
          .send({ note: 'leaked' });
        expect(patch.status).toBe(404);
        const row = await prisma.contact.findUnique({ where: { id: a.contact.id } });
        expect(row.note).toBe('A-private');
      } finally {
        await prisma.user.delete({ where: { id: orphan.id } });
      }
    });

    it('ignores the legacy User.organizationId column', async () => {
      // Membership says A; legacy column says B. Membership must win.
      await prisma.user.update({ where: { id: adminA.id }, data: { organizationId: b.org.id } });
      const res = await request(app)
        .get(`/organizations/${b.org.id}/venues`)
        .set('Authorization', `Bearer ${tokenFor(adminA)}`);
      expect(res.status).toBe(403);
      await prisma.user.update({ where: { id: adminA.id }, data: { organizationId: null } });
    });
  });

  describe('checkout upsert', () => {
    it('creates a second Contact row when the same email buys from another org', async () => {
      // Direct service call: exercises the composite-key upsert in OrderService.createOrder
      const tier = await prisma.priceTier.create({
        data: { eventId: b.event.id, name: 'GA', price: 10, quantityTotal: 10 },
      });
      const email = `second-org@${TAG}.test`;
      await prisma.contact.create({
        data: { organizationId: a.org.id, email, firstName: 'Second', lastName: 'Org' },
      });

      const created = await orderService.createOrder({
        eventId: b.event.id,
        items: [{ priceTierId: tier.id, quantity: 1 }],
        contact: { email, firstName: 'Second', lastName: 'Org' },
      });
      expect(created.orderId).toBeTruthy();

      const rows = await prisma.contact.findMany({ where: { email }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.organizationId).sort()).toEqual([a.org.id, b.org.id].sort());

      await prisma.paymentTransaction.deleteMany({ where: { order: { contact: { email } } } });
      await prisma.orderItem.deleteMany({ where: { order: { contact: { email } } } });
      await prisma.order.deleteMany({ where: { contact: { email } } });
      await prisma.contact.deleteMany({ where: { email } });
      await prisma.priceTier.delete({ where: { id: tier.id } });
    });
  });
});
