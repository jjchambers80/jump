// Contract tests for spec 007 phase 4 cleanup
// - GET /organizations is membership-scoped and feeds the org switcher
// - X-Jump-Org selects the active org for multi-org staff (memberships only)
// - legacy buyer-as-User routes are gone
// - buyer self-service refund runs on the buyer session

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
    refunds: { create: jest.fn(async ({ payment_intent, amount }) => ({ id: `re_${Date.now()}`, payment_intent, amount, status: 'succeeded' })) },
  },
}));
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'p4-cleanup';
const tokenFor = (u) =>
  jwt.sign({ sub: u.id, email: u.email, role: u.role, name: 'P4' }, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

describe('Spec 007 phase 4 cleanup', () => {
  let A;
  let B;
  let adminA;
  let orgBoth;
  let sys;
  let unassigned;

  beforeAll(async () => {
    A = await prisma.organization.create({ data: { name: `${TAG} A` } });
    B = await prisma.organization.create({ data: { name: `${TAG} B` } });
    [adminA, orgBoth, sys, unassigned] = await Promise.all([
      prisma.user.create({ data: { email: `a@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: A.id, role: 'ADMIN' } } } }),
      prisma.user.create({
        data: {
          email: `both@${TAG}.test`,
          role: 'ORGANIZER',
          memberships: { create: [{ organizationId: A.id, role: 'ORGANIZER' }, { organizationId: B.id, role: 'ORGANIZER' }] },
        },
      }),
      prisma.user.create({ data: { email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' } }),
      prisma.user.create({ data: { email: `new@${TAG}.test` } }), // default role
    ]);
  });

  afterAll(async () => {
    const orgIds = [A.id, B.id];
    const where = { event: { venue: { organizationId: { in: orgIds } } } };
    await prisma.refund.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.ticket.deleteMany({ where }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.order.deleteMany({ where }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
  });

  describe('roles and columns', () => {
    it('new users default to UNASSIGNED and the legacy columns are gone', async () => {
      expect(unassigned.role).toBe('UNASSIGNED');
      expect('organizationId' in unassigned).toBe(false);
      const c = await prisma.contact.create({ data: { organizationId: A.id, email: `c@${TAG}.test`, firstName: 'C', lastName: 'C' } });
      expect('userId' in c).toBe(false);
      await prisma.contact.delete({ where: { id: c.id } });
    });

    it('PATCH /users/:id rejects CUSTOMER and accepts UNASSIGNED', async () => {
      const bad = await request(app).patch(`/users/${unassigned.id}`).set('Authorization', `Bearer ${tokenFor(sys)}`).send({ role: 'CUSTOMER' });
      expect(bad.status).toBe(400);
      const ok = await request(app).patch(`/users/${unassigned.id}`).set('Authorization', `Bearer ${tokenFor(sys)}`).send({ role: 'UNASSIGNED' });
      expect(ok.status).toBe(200);
    });
  });

  describe('GET /organizations (org switcher source)', () => {
    it('lists only the memberships for ADMIN and ORGANIZER', async () => {
      const a = await request(app).get('/organizations').set('Authorization', `Bearer ${tokenFor(adminA)}`);
      expect(a.status).toBe(200);
      expect(a.body.map((o) => o.id)).toEqual([A.id]);
      expect(a.body[0]._count).toEqual({ venues: 0, users: 2 });

      const both = await request(app).get('/organizations').set('Authorization', `Bearer ${tokenFor(orgBoth)}`);
      expect(both.status).toBe(200);
      expect(both.body.map((o) => o.id)).toEqual([A.id, B.id]);
    });

    it('lists everything for SYSTEM_ADMIN and nothing for UNASSIGNED', async () => {
      const s = await request(app).get('/organizations').set('Authorization', `Bearer ${tokenFor(sys)}`);
      expect(s.status).toBe(200);
      const ids = s.body.map((o) => o.id);
      expect(ids).toEqual(expect.arrayContaining([A.id, B.id]));
      expect((await request(app).get('/organizations').set('Authorization', `Bearer ${tokenFor(unassigned)}`)).status).toBe(403);
    });
  });

  describe('X-Jump-Org selects the active organization', () => {
    let contactA;
    let contactB;
    beforeAll(async () => {
      contactA = await prisma.contact.create({ data: { organizationId: A.id, email: `buyer@${TAG}.test`, firstName: 'A', lastName: 'A' } });
      contactB = await prisma.contact.create({ data: { organizationId: B.id, email: `buyer@${TAG}.test`, firstName: 'B', lastName: 'B' } });
    });

    const detail = (token, id, org) => {
      const r = request(app).get(`/admin/customers/${id}`).set('Authorization', `Bearer ${token}`);
      return org ? r.set('X-Jump-Org', org) : r;
    };

    it('switches a multi-org user between organizations', async () => {
      const t = tokenFor(orgBoth);
      // getCustomerById requires a completed order; use PATCH note path which only needs ownership
      const patchA = await request(app).patch(`/admin/customers/${contactA.id}`).set('Authorization', `Bearer ${t}`).set('X-Jump-Org', A.id).send({ note: 'from A' });
      expect(patchA.status).toBe(200);
      const patchBwrongOrg = await request(app).patch(`/admin/customers/${contactB.id}`).set('Authorization', `Bearer ${t}`).set('X-Jump-Org', A.id).send({ note: 'x' });
      expect(patchBwrongOrg.status).toBe(404);
      const patchB = await request(app).patch(`/admin/customers/${contactB.id}`).set('Authorization', `Bearer ${t}`).set('X-Jump-Org', B.id).send({ note: 'from B' });
      expect(patchB.status).toBe(200);
      void detail;
    });

    it('ignores X-Jump-Org for an organization the user does not belong to', async () => {
      const t = tokenFor(adminA);
      const res = await request(app).patch(`/admin/customers/${contactB.id}`).set('Authorization', `Bearer ${t}`).set('X-Jump-Org', B.id).send({ note: 'leak' });
      expect(res.status).toBe(404);
      const row = await prisma.contact.findUnique({ where: { id: contactB.id } });
      expect(row.note).toBe('from B');
    });
  });

  describe('legacy buyer-as-User routes are gone', () => {
    it('GET /orders/my and /tickets/my and POST /tickets/:id/request-refund no longer exist', async () => {
      const t = tokenFor(adminA);
      expect((await request(app).get('/orders/my').set('Authorization', `Bearer ${t}`)).status).toBe(404);
      expect((await request(app).get('/tickets/my').set('Authorization', `Bearer ${t}`)).status).toBe(404);
      expect((await request(app).post('/tickets/some-id/request-refund').set('Authorization', `Bearer ${t}`)).status).toBe(404);
    });
  });

  describe('POST /buyer/me/tickets/:id/refund', () => {
    let ticket;
    let session;
    let otherSession;

    beforeAll(async () => {
      const venue = await prisma.venue.create({ data: { organizationId: A.id, name: 'V', address: '1' } });
      const event = await prisma.event.create({ data: { venueId: venue.id, name: 'E', date: new Date(Date.now() + 86400e3), capacity: 10, status: 'PUBLISHED' } });
      const tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 10, quantitySold: 1, isRefundable: true } });
      const contact = await prisma.contact.create({ data: { organizationId: A.id, email: `refund@${TAG}.test`, firstName: 'R', lastName: 'R', accountCreatedAt: new Date() } });
      const order = await prisma.order.create({
        data: {
          eventId: event.id, contactId: contact.id, orderRef: `${TAG}-R1`, totalAmount: 20, subtotalAmount: 20, quantity: 1, status: 'COMPLETED',
          items: { create: [{ priceTierId: tier.id, quantity: 1, unitPrice: 20 }] },
          payment: { create: { stripePaymentIntentId: 'pi_p4', amount: 20, currency: 'usd', status: 'SUCCEEDED' } },
        },
      });
      ticket = await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, priceTierId: tier.id, contactId: contact.id, ticketNumber: 1, pricePaid: 20, barcode: `JUMP-${TAG}-1`, status: 'VALID' } });
      session = buyerAuthService.signSession({ contactId: contact.id, organizationId: A.id, email: contact.email });
      const other = await prisma.contact.findFirst({ where: { organizationId: B.id } });
      otherSession = buyerAuthService.signSession({ contactId: other.id, organizationId: B.id, email: other.email });
    });

    it('refuses another buyer, requires a buyer session, then refunds the owner ticket once', async () => {
      expect((await request(app).post(`/buyer/me/tickets/${ticket.id}/refund`)).status).toBe(401);
      expect((await request(app).post(`/buyer/me/tickets/${ticket.id}/refund`).set('Authorization', `Bearer ${tokenFor(adminA)}`)).status).toBe(401);
      expect((await request(app).post(`/buyer/me/tickets/${ticket.id}/refund`).set('Authorization', `Bearer ${otherSession}`)).status).toBe(403);

      const ok = await request(app).post(`/buyer/me/tickets/${ticket.id}/refund`).set('Authorization', `Bearer ${session}`);
      expect(ok.status).toBe(200);
      const after = await prisma.ticket.findUnique({ where: { id: ticket.id } });
      expect(after.status).toBe('VOIDED');

      const again = await request(app).post(`/buyer/me/tickets/${ticket.id}/refund`).set('Authorization', `Bearer ${session}`);
      expect(again.status).toBe(400);
    });
  });
});
