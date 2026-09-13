// Contract tests for buyer sign-in and self-service (spec 007 phase 2)
//
// Covers: checkout opt-ins land on the org-scoped Contact, the welcome link is
// issued on payment completion, LOGIN requests never leak account existence,
// tokens are single use, buyer sessions are scoped to one organization, and
// buyer/staff tokens do not cross.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn(async () => ({
          id: `cs_buyer_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          url: 'https://checkout.stripe.com/pay/cs_buyer',
          payment_intent: null,
          metadata: {},
        })),
      },
    },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentService } = await import('../../src/services/PaymentService.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'buyer-auth';

function tokenFromEmail(msg) {
  const m = String(msg.html).match(/\/account\/verify\?token=([A-Za-z0-9_%-]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name } });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${name} Venue`, address: '1 St' } });
  const event = await prisma.event.create({
    data: {
      venueId: venue.id,
      name: `${name} Event`,
      date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      capacity: 100,
      status: 'PUBLISHED',
    },
  });
  const tier = await prisma.priceTier.create({
    data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 50 },
  });
  return { org, venue, event, tier };
}

async function checkout(orgFixture, email, extra = {}) {
  const res = await request(app)
    .post('/orders')
    .send({
      eventId: orgFixture.event.id,
      items: [{ priceTierId: orgFixture.tier.id, quantity: 1 }],
      contact: { email, firstName: 'Buyer', lastName: 'Test' },
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Buyer auth contract (spec 007 phase 2)', () => {
  let A;
  let B;
  const optInEmail = `optin@${TAG}.test`;
  const guestEmail = `guest@${TAG}.test`;

  beforeAll(async () => {
    A = await createOrg(`${TAG} Org A`);
    B = await createOrg(`${TAG} Org B`);
  });

  afterAll(async () => {
    const orgIds = [A?.org.id, B?.org.id].filter(Boolean);
    const where = { event: { venue: { organizationId: { in: orgIds } } } };
    await prisma.paymentTransaction.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.ticket.deleteMany({ where }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.order.deleteMany({ where }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  describe('checkout opt-ins', () => {
    const complete = async (orderId) => {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      await paymentService.handleCheckoutCompleted(order.stripeSessionId);
    };
    const contactAt = (fixture, email) =>
      prisma.contact.findUnique({
        where: { organizationId_email: { organizationId: fixture.org.id, email } },
      });

    it('rejects non-boolean opt-in fields', async () => {
      const res = await request(app).post('/orders').send({
        eventId: A.event.id,
        items: [{ priceTierId: A.tier.id, quantity: 1 }],
        contact: { email: optInEmail, firstName: 'B', lastName: 'T' },
        createAccount: 'yes',
      });
      expect(res.status).toBe(400);
    });

    it('records opt-ins on the order but does not touch the contact until payment completes', async () => {
      const { orderId } = await checkout(A, optInEmail, { createAccount: true, emailSubscribed: true });
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order.optInAccount).toBe(true);
      expect(order.optInMarketing).toBe(true);

      // Abandoned / unpaid checkout: no account, no consent for this email
      const pending = await contactAt(A, optInEmail);
      expect(pending.accountCreatedAt).toBeNull();
      expect(pending.emailSubscribed).toBe(false);

      await complete(orderId);
      const paid = await contactAt(A, optInEmail);
      expect(paid.accountCreatedAt).toBeInstanceOf(Date);
      expect(paid.emailSubscribed).toBe(true);
    });

    it('guest checkout leaves accountCreatedAt null and emailSubscribed false after completion', async () => {
      const { orderId } = await checkout(A, guestEmail, { createAccount: false, emailSubscribed: false });
      await complete(orderId);
      const c = await contactAt(A, guestEmail);
      expect(c.accountCreatedAt).toBeNull();
      expect(c.emailSubscribed).toBe(false);
    });

    it('a later completed guest checkout never revokes the account or flips consent off', async () => {
      const before = await contactAt(A, optInEmail);
      const { orderId } = await checkout(A, optInEmail, { createAccount: false, emailSubscribed: false });
      await complete(orderId);
      const after = await contactAt(A, optInEmail);
      expect(after.accountCreatedAt.getTime()).toBe(before.accountCreatedAt.getTime());
      expect(after.emailSubscribed).toBe(true);
    });

    it('account at org A does not create one at org B for the same email', async () => {
      const { orderId } = await checkout(B, optInEmail, { createAccount: false });
      await complete(orderId);
      const b = await contactAt(B, optInEmail);
      expect(b.accountCreatedAt).toBeNull();
    });
  });

  describe('welcome link on payment completion', () => {
    let welcomeToken;

    it('confirmation email carries a single-use manage-tickets link for account buyers', async () => {
      const { orderId } = await checkout(A, optInEmail, { createAccount: true });
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      await paymentService.handleCheckoutCompleted(order.stripeSessionId);

      const confirmation = sentEmails.find((m) => /Order Confirmed/.test(m.subject));
      expect(confirmation).toBeTruthy();
      expect(confirmation.html).toContain('Manage your tickets');
      welcomeToken = tokenFromEmail(confirmation);
      expect(welcomeToken).toBeTruthy();

      const row = await prisma.buyerLoginToken.findFirst({
        where: { organizationId: A.org.id, purpose: 'WELCOME' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).toBeTruthy();
      expect(row.tokenHash).not.toBe(welcomeToken);
    });

    it('confirmation email for a guest has no manage-tickets link', async () => {
      const { orderId } = await checkout(A, guestEmail, { createAccount: false });
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      await paymentService.handleCheckoutCompleted(order.stripeSessionId);

      const confirmation = sentEmails.find((m) => /Order Confirmed/.test(m.subject));
      expect(confirmation.html).not.toContain('Manage your tickets');
    });

    it('verify exchanges the welcome token for a buyer session, once', async () => {
      const first = await request(app).post('/buyer/auth/verify').send({ token: welcomeToken });
      expect(first.status).toBe(200);
      expect(first.body.organizationId).toBe(A.org.id);
      const decoded = jwt.verify(first.body.sessionToken, AUTH_SECRET);
      expect(decoded.typ).toBe('buyer');
      expect(decoded.org).toBe(A.org.id);

      const second = await request(app).post('/buyer/auth/verify').send({ token: welcomeToken });
      expect(second.status).toBe(401);
    });
  });

  describe('POST /buyer/auth/request', () => {
    it('returns 202 and sends nothing for an unknown email', async () => {
      const res = await request(app)
        .post('/buyer/auth/request')
        .send({ organizationId: A.org.id, email: `nobody@${TAG}.test` });
      expect(res.status).toBe(202);
      expect(sentEmails).toHaveLength(0);
    });

    it('returns 202 and sends nothing for a guest contact', async () => {
      const res = await request(app)
        .post('/buyer/auth/request')
        .send({ organizationId: A.org.id, email: guestEmail });
      expect(res.status).toBe(202);
      expect(sentEmails).toHaveLength(0);
    });

    it('returns 202 and sends nothing for the account email at an org where it is a guest', async () => {
      const res = await request(app)
        .post('/buyer/auth/request')
        .send({ organizationId: B.org.id, email: optInEmail });
      expect(res.status).toBe(202);
      expect(sentEmails).toHaveLength(0);
    });

    it('validates input', async () => {
      expect((await request(app).post('/buyer/auth/request').send({ email: optInEmail })).status).toBe(400);
      expect((await request(app).post('/buyer/auth/request').send({ organizationId: A.org.id, email: 'x' })).status).toBe(400);
    });

    it('emails a sign-in link for an account holder and caps at 3 per 15 minutes', async () => {
      let loginToken;
      for (let i = 0; i < 3; i++) {
        sentEmails.length = 0;
        const res = await request(app)
          .post('/buyer/auth/request')
          .send({ organizationId: A.org.id, email: optInEmail.toUpperCase() });
        expect(res.status).toBe(202);
        // send is fire-and-forget; give the mocked promise a tick to settle
        await new Promise((r) => setImmediate(r));
        expect(sentEmails).toHaveLength(1);
        expect(sentEmails[0].to).toEqual([optInEmail]);
        loginToken = tokenFromEmail(sentEmails[0]);
        expect(loginToken).toBeTruthy();
      }

      sentEmails.length = 0;
      const fourth = await request(app)
        .post('/buyer/auth/request')
        .send({ organizationId: A.org.id, email: optInEmail });
      expect(fourth.status).toBe(202);
      await new Promise((r) => setImmediate(r));
      expect(sentEmails).toHaveLength(0);

      // The last issued token still works
      const verify = await request(app).post('/buyer/auth/verify').send({ token: loginToken });
      expect(verify.status).toBe(200);
    });
  });

  describe('buyer session routes', () => {
    let sessionToken;

    beforeAll(async () => {
      const contact = await prisma.contact.findUnique({
        where: { organizationId_email: { organizationId: A.org.id, email: optInEmail } },
      });
      const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
      sessionToken = buyerAuthService.signSession({
        contactId: contact.id,
        organizationId: A.org.id,
        email: optInEmail,
      });
    });

    it('GET /buyer/me returns the profile with org branding', async () => {
      const res = await request(app).get('/buyer/me').set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(optInEmail);
      expect(res.body.organization.id).toBe(A.org.id);
    });

    it('GET /buyer/me/orders returns only this organization orders', async () => {
      const res = await request(app).get('/buyer/me/orders').set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const eventIds = new Set(res.body.data.map((o) => o.event?.id ?? o.eventId));
      // The same email also bought at org B; none of those orders may appear.
      const orgBOrders = await prisma.order.findMany({
        where: { contact: { email: optInEmail, organizationId: B.org.id } },
        select: { id: true },
      });
      expect(orgBOrders.length).toBeGreaterThan(0);
      const returnedIds = new Set(res.body.data.map((o) => o.id));
      for (const o of orgBOrders) expect(returnedIds.has(o.id)).toBe(false);
      void eventIds;
    });

    it('GET /buyer/me/tickets returns only this organization tickets', async () => {
      const res = await request(app).get('/buyer/me/tickets').set('Authorization', `Bearer ${sessionToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const t of res.body.data) expect(t.eventId).toBe(A.event.id);
    });

    it('rejects a staff token on buyer routes and a buyer token on staff routes', async () => {
      const staff = jwt.sign({ sub: 'user-x', role: 'SYSTEM_ADMIN', email: 's@x.test' }, AUTH_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
      });
      expect((await request(app).get('/buyer/me').set('Authorization', `Bearer ${staff}`)).status).toBe(401);
      expect((await request(app).get('/admin/customers').set('Authorization', `Bearer ${sessionToken}`)).status).toBe(401);
      expect((await request(app).get('/buyer/me')).status).toBe(401);
    });
  });
});
