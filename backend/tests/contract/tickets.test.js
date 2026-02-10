// Contract tests for Ticket Redemption API endpoint (Schema Redesign)
// Tests: POST /tickets/redeem
// Per FR-032, FR-033, FR-034, FR-035, FR-055, contracts/api.yaml
//
// Scenarios:
// - 200 green verdict for valid ticket
// - 409 for already-redeemed (with originalRedemptionTime)
// - 400 for invalid/forged QR
// - 403 for wrong event
// - 410 for expired (past event date)
// - 409 for voided ticket

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-redeem-user-id',
    email: overrides.email || 'organizer@redeem-test.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'Test Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

/**
 * Generate a valid QR code JWT for a ticket.
 * Mirrors QRService.generateQRCodeJWT() logic.
 */
function generateQRPayload(ticketId, eventId, barcode, eventDate) {
  const payload = { sub: ticketId, eventId, barcode };
  const expDate = new Date(eventDate);
  expDate.setHours(expDate.getHours() + 24);
  const expiresIn = Math.max(Math.floor((expDate.getTime() - Date.now()) / 1000), 86400);
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn });
}

// Mock Stripe
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_redeem_test',
          url: 'https://checkout.stripe.com/pay/cs_redeem_test',
          payment_intent: `pi_redeem_${Date.now()}`,
          metadata: {},
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_redeem_test',
          metadata: { priceTierId: 'mock-tier' },
        }),
      },
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Ticket Redemption API Contract Tests — POST /tickets/redeem', () => {
  let adminToken;
  let testOrgId, testVenueId, testEventId, testEventId2;
  let testTierId;
  let testContactId, testOrderId, expiredOrderId;
  let validTicketId, validTicketBarcode;
  let redeemedTicketId, redeemedTicketBarcode;
  let voidedTicketId, voidedTicketBarcode;
  let expiredEventId, expiredTicketId, expiredTicketBarcode;

  const futureDate = new Date('2026-12-31T20:00:00Z');
  const pastDate = new Date('2024-01-01T20:00:00Z');

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'admin-redeem-id',
      role: 'ADMIN',
      email: 'admin@redeem-test.com',
    });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Redemption Test Org' });
    testOrgId = orgRes.body.id;

    // Create venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Redemption Venue', address: '123 Scan St', timezone: 'America/New_York' });
    testVenueId = venueRes.body.id;

    // Create future event (with required price tier)
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Redemption Concert',
        venueId: testVenueId,
        date: futureDate.toISOString(),
        capacity: 100,
        priceTiers: [{ name: 'GA', price: 2500, quantityTotal: 100, displayOrder: 1 }],
      });
    testEventId = eventRes.body.id;
    testTierId = eventRes.body.priceTiers[0].id;

    // Create second event (for wrong-event test)
    const event2Res = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Other Event',
        venueId: testVenueId,
        date: futureDate.toISOString(),
        capacity: 50,
        priceTiers: [{ name: 'GA2', price: 2000, quantityTotal: 50, displayOrder: 1 }],
      });
    testEventId2 = event2Res.body.id;

    // Create expired event (date in past) — insert directly via Prisma to bypass validation
    const expiredEvent = await prisma.event.create({
      data: {
        name: 'Expired Event',
        date: pastDate,
        capacity: 100,
        status: 'PUBLISHED',
        venueId: testVenueId,
      },
    });
    expiredEventId = expiredEvent.id;

    // Publish both future events
    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);
    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId2}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Create price tier for expired event
    const expTier = await prisma.priceTier.create({
      data: {
        name: 'GA Expired',
        price: 2500,
        quantityTotal: 100,
        quantitySold: 0,
        quantityReserved: 0,
        displayOrder: 1,
        eventId: expiredEventId,
      },
    });

    // Create a contact
    const contact = await prisma.contact.upsert({
      where: { email: 'scanner@redeem-test.com' },
      update: {},
      create: { email: 'scanner@redeem-test.com', firstName: 'Scanner', lastName: 'Tester' },
    });
    testContactId = contact.id;

    // Create a dummy order for main event tickets
    const order = await prisma.order.create({
      data: {
        eventId: testEventId,
        contactId: testContactId,
        orderRef: `REDEEM-TEST-${Date.now()}`,
        totalAmount: 10000,
        quantity: 3,
        status: 'COMPLETED',
      },
    });
    testOrderId = order.id;

    // Create a dummy order for expired event tickets
    const expOrder = await prisma.order.create({
      data: {
        eventId: expiredEventId,
        contactId: testContactId,
        orderRef: `REDEEM-EXP-${Date.now()}`,
        totalAmount: 2500,
        quantity: 1,
        status: 'COMPLETED',
      },
    });
    expiredOrderId = expOrder.id;

    // Create test tickets directly (bypass order flow for contract testing)
    // 1. Valid ticket (status: VALID)
    const validTicket = await prisma.ticket.create({
      data: {
        orderId: testOrderId,
        eventId: testEventId,
        priceTierId: testTierId,
        contactId: testContactId,
        pricePaid: 2500,
        barcode: `JUMP-VALIDTKT001`,
        status: 'VALID',
      },
    });
    validTicketId = validTicket.id;
    validTicketBarcode = validTicket.barcode;

    // 2. Already-redeemed ticket
    const redeemedTicket = await prisma.ticket.create({
      data: {
        orderId: testOrderId,
        eventId: testEventId,
        priceTierId: testTierId,
        contactId: testContactId,
        pricePaid: 2500,
        barcode: `JUMP-REDEEMEDTK`,
        status: 'REDEEMED',
        redeemedAt: new Date('2025-06-01T10:00:00Z'),
      },
    });
    redeemedTicketId = redeemedTicket.id;
    redeemedTicketBarcode = redeemedTicket.barcode;

    // 3. Voided ticket
    const voidedTicket = await prisma.ticket.create({
      data: {
        orderId: testOrderId,
        eventId: testEventId,
        priceTierId: testTierId,
        contactId: testContactId,
        pricePaid: 2500,
        barcode: `JUMP-VOIDEDTKT1`,
        status: 'VOIDED',
      },
    });
    voidedTicketId = voidedTicket.id;
    voidedTicketBarcode = voidedTicket.barcode;

    // 4. Ticket for expired event
    const expiredTicket = await prisma.ticket.create({
      data: {
        orderId: expiredOrderId,
        eventId: expiredEventId,
        priceTierId: expTier.id,
        contactId: testContactId,
        pricePaid: 2500,
        barcode: `JUMP-EXPIREDTKT`,
        status: 'VALID',
      },
    });
    expiredTicketId = expiredTicket.id;
    expiredTicketBarcode = expiredTicket.barcode;
  });

  afterAll(async () => {
    // Clean up: tickets → price tiers → events → venue → organization
    if (testContactId) await prisma.ticket.deleteMany({ where: { contactId: testContactId } });
    const orderIds = [testOrderId, expiredOrderId].filter(Boolean);
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    const eventIds = [testEventId, testEventId2, expiredEventId].filter(Boolean);
    if (eventIds.length) {
      await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (testVenueId) await prisma.venue.deleteMany({ where: { id: testVenueId } });
    if (testOrgId) await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  // ===== VALID REDEMPTION =====

  test('200 — redeems a valid ticket with correct QR payload', async () => {
    const qrPayload = generateQRPayload(validTicketId, testEventId, validTicketBarcode, futureDate);

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REDEEMED');
    expect(res.body.ticketId).toBe(validTicketId);
    expect(res.body.barcode).toBe(validTicketBarcode);
    expect(res.body.priceTierName).toBe('GA');
    expect(res.body.contactName).toBe('Scanner Tester');
    expect(res.body.redeemedAt).toBeDefined();
  });

  // ===== ALREADY REDEEMED =====

  test('409 — rejects already-redeemed ticket with originalRedemptionTime', async () => {
    // The validTicket was just redeemed in the previous test, try again
    const qrPayload = generateQRPayload(validTicketId, testEventId, validTicketBarcode, futureDate);

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('ALREADY_REDEEMED');
    expect(res.body.ticketId).toBe(validTicketId);
    expect(res.body.originalRedemptionTime).toBeDefined();
  });

  test('409 — rejects ticket that was pre-set as REDEEMED', async () => {
    const qrPayload = generateQRPayload(
      redeemedTicketId,
      testEventId,
      redeemedTicketBarcode,
      futureDate
    );

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('ALREADY_REDEEMED');
    expect(res.body.originalRedemptionTime).toBeDefined();
  });

  // ===== INVALID / FORGED QR =====

  test('400 — rejects completely invalid QR payload', async () => {
    const res = await request(app)
      .post('/tickets/redeem')
      .send({ qrPayload: 'not-a-valid-jwt-string' });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('INVALID');
    expect(res.body.message).toBeDefined();
  });

  test('400 — rejects QR signed with wrong secret', async () => {
    const forgedPayload = jwt.sign(
      { sub: validTicketId, eventId: testEventId, barcode: validTicketBarcode },
      'wrong-secret-key-that-is-long-enough',
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const res = await request(app).post('/tickets/redeem').send({ qrPayload: forgedPayload });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('INVALID');
  });

  test('400 — rejects missing qrPayload field', async () => {
    const res = await request(app).post('/tickets/redeem').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  // ===== WRONG EVENT =====

  test('403 — rejects ticket scanned at wrong event', async () => {
    // Ticket belongs to testEventId, but we claim it's for testEventId2
    const qrPayload = generateQRPayload(
      redeemedTicketId,
      testEventId,
      redeemedTicketBarcode,
      futureDate
    );

    const res = await request(app)
      .post('/tickets/redeem')
      .send({ qrPayload, eventId: testEventId2 });

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('WRONG_EVENT');
  });

  // ===== EXPIRED (PAST EVENT DATE) =====

  test('410 — rejects ticket for expired event (lazy expiration)', async () => {
    // Use a QR that is NOT expired (signed with long expiry) but the event date has passed
    // The JWT itself might be expired due to pastDate, so sign with a long expiry manually
    const payload = {
      sub: expiredTicketId,
      eventId: expiredEventId,
      barcode: expiredTicketBarcode,
    };
    const qrPayload = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '365d' });

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(410);
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.ticketId).toBe(expiredTicketId);

    // Verify ticket status was lazily updated to EXPIRED in DB
    const ticket = await prisma.ticket.findUnique({ where: { id: expiredTicketId } });
    expect(ticket.status).toBe('EXPIRED');
  });

  // ===== VOIDED =====

  test('409 — rejects voided ticket', async () => {
    const payload = { sub: voidedTicketId, eventId: testEventId, barcode: voidedTicketBarcode };
    const qrPayload = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '365d' });

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('VOIDED');
    expect(res.body.ticketId).toBe(voidedTicketId);
  });
});
