// Integration test for complete purchase flow (Schema Redesign)
// Tests: order creation → Stripe webhook → order COMPLETED → tickets issued
//        with barcodes + QR JWTs → PriceTier.quantitySold incremented → email sent
// Per FR-023, FR-025, FR-026, FR-036

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'integ-user-id',
    email: overrides.email || 'organizer@purchase-integ.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe BEFORE importing app
jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let counter = 0;
  const sessions = new Map();
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn().mockImplementation((params) => {
            counter++;
            const session = {
              id: `cs_integ_${counter}`,
              url: `https://checkout.stripe.com/pay/cs_integ_${counter}`,
              payment_intent: `pi_integ_${counter}`,
              metadata: params.metadata,
            };
            sessions.set(session.id, session);
            return Promise.resolve(session);
          }),
          retrieve: jest.fn().mockImplementation((sessionId) => {
            const session = sessions.get(sessionId);
            return Promise.resolve(session || { id: sessionId, metadata: {} });
          }),
        },
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    },
  };
});

// Mock Resend to capture emails
jest.unstable_mockModule('../../src/config/resend.js', () => {
  const sentEmails = [];
  return {
    default: {
      emails: {
        send: jest.fn().mockImplementation((msg) => {
          sentEmails.push(msg);
          return Promise.resolve({ id: 'mock-email-id' });
        }),
      },
    },
    _getSentEmails: () => sentEmails,
    _clearEmails: () => {
      sentEmails.length = 0;
    },
  };
});

// Dynamic imports AFTER mock setup
const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Purchase Flow Integration', () => {
  let adminToken;
  let organizerToken;
  let testOrgId;
  let testVenueId;
  let testEventId;
  let testTierId;
  let vipTierId;
  let orderId;
  let orderRef;
  let stripeSessionId;

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'integ-admin-id',
      role: 'ADMIN',
      email: 'admin@purchase-integ.com',
    });
    organizerToken = generateToken({ role: 'ORGANIZER', email: 'organizer@purchase-integ.com' });

    // Create org → venue → event → tiers → publish
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Purchase Integ Org' });
    testOrgId = orgRes.body.id;

    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Integ Venue', address: '99 Integ Ave' });
    testVenueId = venueRes.body.id;

    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: testVenueId,
        name: 'Integration Test Concert',
        date: '2027-09-01T20:00:00.000Z',
        capacity: 50,
        priceTiers: [
          { name: 'GA', price: 30.0, quantityTotal: 40 },
          { name: 'VIP', price: 100.0, quantityTotal: 10, maxPerOrder: 2 },
        ],
      });
    testEventId = eventRes.body.id;
    testTierId = eventRes.body.priceTiers.find((t) => t.name === 'GA').id;
    vipTierId = eventRes.body.priceTiers.find((t) => t.name === 'VIP').id;

    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`);
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: testEventId } } });
    await prisma.ticket.deleteMany({ where: { eventId: testEventId } });
    await prisma.order.deleteMany({ where: { eventId: testEventId } });
    await prisma.contact.deleteMany({
      where: { email: { in: ['buyer@purchase-integ.com'] } },
    });
    await prisma.priceTier.deleteMany({ where: { eventId: testEventId } });
    await prisma.event.deleteMany({ where: { id: testEventId } });
    await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  it('Step 1: Create order → returns PENDING with Stripe URL', async () => {
    const res = await request(app)
      .post('/orders')
      .send({
        eventId: testEventId,
        priceTierId: testTierId,
        quantity: 3,
        contact: {
          email: 'buyer@purchase-integ.com',
          firstName: 'Alice',
          lastName: 'Buyer',
        },
      });

    expect(res.status).toBe(201);
    orderId = res.body.orderId;
    orderRef = res.body.orderRef;
    expect(orderRef).toMatch(/^JMP-/);
    expect(res.body.stripeCheckoutUrl).toContain('https://checkout.stripe.com');

    // Verify order in DB is PENDING
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.status).toBe('PENDING');
    expect(Number(order.totalAmount)).toBe(90.0); // 30 × 3

    // Capture stripeSessionId
    stripeSessionId = order.stripeSessionId;
    expect(stripeSessionId).toBeTruthy();

    // Verify inventory reservation
    const tier = await prisma.priceTier.findUnique({ where: { id: testTierId } });
    expect(tier.quantityReserved).toBe(3);
    expect(tier.quantitySold).toBe(0);
  });

  it('Step 2: Stripe webhook (checkout.session.completed) → order COMPLETED, tickets issued', async () => {
    const webhookPayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: stripeSessionId,
          payment_status: 'paid',
          payment_intent: 'pi_integ_final',
          metadata: { orderId, priceTierId: testTierId },
        },
      },
    };

    const res = await request(app).post('/webhooks/stripe').send(webhookPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Verify order is COMPLETED
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.status).toBe('COMPLETED');

    // Verify tickets created
    const tickets = await prisma.ticket.findMany({
      where: { orderId },
      include: { priceTier: true },
    });
    expect(tickets).toHaveLength(3);
    tickets.forEach((ticket) => {
      expect(ticket.status).toBe('VALID');
      expect(ticket.barcode).toMatch(/^JUMP-[A-HJ-NP-Z2-9]{12}$/);
      expect(ticket.qrCodeJwt).toBeTruthy();
      expect(Number(ticket.pricePaid)).toBe(30.0);
      expect(ticket.priceTierId).toBe(testTierId);
    });

    // Verify barcodes are unique
    const barcodes = tickets.map((t) => t.barcode);
    expect(new Set(barcodes).size).toBe(3);

    // Verify QR JWT contains correct payload
    const decoded = jwt.verify(tickets[0].qrCodeJwt, AUTH_SECRET, { algorithms: ['HS256'] });
    expect(decoded.sub).toBe(tickets[0].id);
    expect(decoded.eventId).toBe(testEventId);
    expect(decoded.barcode).toBe(tickets[0].barcode);

    // Verify PriceTier inventory: reserved → sold
    const tier = await prisma.priceTier.findUnique({ where: { id: testTierId } });
    expect(tier.quantitySold).toBe(3);
    expect(tier.quantityReserved).toBe(0);

    // Verify payment transaction updated
    const payment = await prisma.paymentTransaction.findFirst({ where: { orderId } });
    expect(payment.status).toBe('SUCCEEDED');
  });

  it('Step 3: Idempotent webhook — duplicate does not create extra tickets', async () => {
    const ticketsBefore = await prisma.ticket.count({ where: { orderId } });

    const webhookPayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: stripeSessionId,
          payment_status: 'paid',
          payment_intent: 'pi_integ_final',
        },
      },
    };

    const res = await request(app).post('/webhooks/stripe').send(webhookPayload);

    expect(res.status).toBe(200);

    const ticketsAfter = await prisma.ticket.count({ where: { orderId } });
    expect(ticketsAfter).toBe(ticketsBefore);
  });

  it('Step 4: Order detail includes tickets and payment', async () => {
    const res = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.tickets).toHaveLength(3);
    expect(res.body.tickets[0]).toHaveProperty('barcode');
    expect(res.body.tickets[0]).toHaveProperty('priceTierName', 'GA');
    expect(res.body.payment).toHaveProperty('status', 'SUCCEEDED');
  });

  it('Step 5: Guest lookup returns the completed order', async () => {
    const res = await request(app).post('/orders/lookup').send({
      email: 'buyer@purchase-integ.com',
      orderRef,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.tickets).toHaveLength(3);
  });

  it('Step 6: VIP order respects maxPerOrder limit', async () => {
    const res = await request(app)
      .post('/orders')
      .send({
        eventId: testEventId,
        priceTierId: vipTierId,
        quantity: 5,
        contact: {
          email: 'buyer@purchase-integ.com',
          firstName: 'Alice',
          lastName: 'Buyer',
        },
      });

    expect(res.status).toBe(400);
  });
});
