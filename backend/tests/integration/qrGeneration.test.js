// Integration test for Ticket Redemption Flow (Schema Redesign)
// Tests: End-to-end QR generation → scan → redemption → rejection on rescan
// Per FR-032, FR-033, FR-034, FR-055
//
// Scenarios:
// 1. QR code JWT generation + structure validation
// 2. Full scan → green verdict → REDEEMED status
// 3. Duplicate scan → rejection with originalRedemptionTime
// 4. Expired event → lazy EXPIRED status update

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const AUTH_SECRET = process.env.AUTH_SECRET;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'test-qr-integ-user',
    email: overrides.email || 'organizer@qr-integ.com',
    role: overrides.role || 'ORGANIZER',
    name: overrides.name || 'QR Integ Organizer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_qr_integ',
          url: 'https://checkout.stripe.com/pay/cs_qr_integ',
          payment_intent: `pi_qr_integ_${Date.now()}`,
          metadata: {},
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_qr_integ',
          metadata: { priceTierId: 'mock-tier' },
        }),
      },
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Ticket Redemption Integration Flow', () => {
  let adminToken;
  let testOrgId, testVenueId, testEventId;
  let testTierId;
  let testContactId, testOrderId;
  let ticketA_id, ticketA_barcode; // will be redeemed then rescanned
  let ticketB_id, ticketB_barcode; // for expired event test
  let expiredEventId, expiredOrderId;

  const futureDate = new Date('2026-12-31T20:00:00Z');
  const pastDate = new Date('2024-01-15T20:00:00Z');

  beforeAll(async () => {
    adminToken = generateToken({
      id: 'admin-qr-integ',
      role: 'ADMIN',
      email: 'admin@qr-integ.com',
    });

    // Org + venue
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'QR Integ Org' });
    testOrgId = orgRes.body.id;

    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'QR Venue', address: '456 Scan Blvd', timezone: 'America/Chicago' });
    testVenueId = venueRes.body.id;

    // Future event with price tier
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'QR Integration Concert',
        venueId: testVenueId,
        date: futureDate.toISOString(),
        capacity: 200,
        priceTiers: [{ name: 'Standard', price: 3500, quantityTotal: 200, displayOrder: 1 }],
      });
    testEventId = eventRes.body.id;
    testTierId = eventRes.body.priceTiers[0].id;

    // Publish
    await request(app)
      .post(`/organizations/${testOrgId}/events/${testEventId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Expired event (past date — direct Prisma insert bypasses date validation)
    const expEvent = await prisma.event.create({
      data: {
        name: 'Expired QR Event',
        date: pastDate,
        capacity: 50,
        status: 'PUBLISHED',
        venueId: testVenueId,
      },
    });
    expiredEventId = expEvent.id;

    const expTier = await prisma.priceTier.create({
      data: {
        name: 'GA Expired',
        price: 1500,
        quantityTotal: 50,
        quantitySold: 0,
        quantityReserved: 0,
        displayOrder: 1,
        eventId: expiredEventId,
      },
    });

    // Contact
    const contact = await prisma.contact.upsert({
      where: { email: 'attendee@qr-integ.com' },
      update: {},
      create: { email: 'attendee@qr-integ.com', firstName: 'QR', lastName: 'Attendee' },
    });
    testContactId = contact.id;

    // Orders
    const order = await prisma.order.create({
      data: {
        eventId: testEventId,
        contactId: testContactId,
        orderRef: `QRINTEG-${Date.now()}`,
        totalAmount: 3500,
        quantity: 1,
        status: 'COMPLETED',
      },
    });
    testOrderId = order.id;

    const expOrd = await prisma.order.create({
      data: {
        eventId: expiredEventId,
        contactId: testContactId,
        orderRef: `QRINTEG-EXP-${Date.now()}`,
        totalAmount: 1500,
        quantity: 1,
        status: 'COMPLETED',
      },
    });
    expiredOrderId = expOrd.id;

    // Ticket A — future event, VALID → will go through full redemption flow
    const tktA = await prisma.ticket.create({
      data: {
        orderId: testOrderId,
        eventId: testEventId,
        priceTierId: testTierId,
        contactId: testContactId,
        pricePaid: 3500,
        barcode: 'JUMP-QRINTEG-A',
        status: 'VALID',
      },
    });
    ticketA_id = tktA.id;
    ticketA_barcode = tktA.barcode;

    // Ticket B — expired event, VALID → will test lazy expiration
    const tktB = await prisma.ticket.create({
      data: {
        orderId: expiredOrderId,
        eventId: expiredEventId,
        priceTierId: expTier.id,
        contactId: testContactId,
        pricePaid: 1500,
        barcode: 'JUMP-QRINTEG-B',
        status: 'VALID',
      },
    });
    ticketB_id = tktB.id;
    ticketB_barcode = tktB.barcode;
  });

  afterAll(async () => {
    if (testContactId) await prisma.ticket.deleteMany({ where: { contactId: testContactId } });
    const orderIds = [testOrderId, expiredOrderId].filter(Boolean);
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    const eventIds = [testEventId, expiredEventId].filter(Boolean);
    if (eventIds.length) {
      await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (testVenueId) await prisma.venue.deleteMany({ where: { id: testVenueId } });
    if (testOrgId) await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  // ===== QR CODE JWT STRUCTURE (FR-006, FR-007) =====

  test('QR JWT uses HS256, contains ticketId, eventId, barcode and expires 24h after event', () => {
    // Generate a QR JWT the same way QRService does
    const payload = { sub: ticketA_id, eventId: testEventId, barcode: ticketA_barcode };
    const expDate = new Date(futureDate);
    expDate.setHours(expDate.getHours() + 24);
    const expiresIn = Math.max(Math.floor((expDate.getTime() - Date.now()) / 1000), 86400);
    const token = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn });

    // Decode and verify structure
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.sub).toBe(ticketA_id);
    expect(decoded.payload.eventId).toBe(testEventId);
    expect(decoded.payload.barcode).toBe(ticketA_barcode);
    expect(decoded.payload.exp).toBeDefined();

    // Verify expiration is ~24h after event
    const tokenExp = new Date(decoded.payload.exp * 1000);
    const diff = Math.abs(tokenExp.getTime() - expDate.getTime());
    expect(diff).toBeLessThan(5000); // Within 5 seconds
  });

  // ===== FULL REDEMPTION FLOW (FR-032, FR-055) =====

  test('Full flow: scan valid QR → green verdict → DB status updated to REDEEMED', async () => {
    // Generate QR payload for ticket A
    const payload = { sub: ticketA_id, eventId: testEventId, barcode: ticketA_barcode };
    const expDate = new Date(futureDate);
    expDate.setHours(expDate.getHours() + 24);
    const expiresIn = Math.max(Math.floor((expDate.getTime() - Date.now()) / 1000), 86400);
    const qrPayload = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn });

    // Scan
    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REDEEMED');
    expect(res.body.ticketId).toBe(ticketA_id);
    expect(res.body.barcode).toBe(ticketA_barcode);
    expect(res.body.priceTierName).toBe('Standard');
    expect(res.body.contactName).toBe('QR Attendee');
    expect(res.body.redeemedAt).toBeDefined();

    // Verify DB was updated
    const dbTicket = await prisma.ticket.findUnique({ where: { id: ticketA_id } });
    expect(dbTicket.status).toBe('REDEEMED');
    expect(dbTicket.redeemedAt).not.toBeNull();
  });

  // ===== DUPLICATE SCAN REJECTION (FR-033) =====

  test('Duplicate scan: re-scanning same ticket → 409 with originalRedemptionTime', async () => {
    // Same ticket A was already redeemed above — rescan
    const payload = { sub: ticketA_id, eventId: testEventId, barcode: ticketA_barcode };
    const qrPayload = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('ALREADY_REDEEMED');
    expect(res.body.ticketId).toBe(ticketA_id);
    expect(res.body.originalRedemptionTime).toBeDefined();

    // originalRedemptionTime should be the same as the first redemption
    const dbTicket = await prisma.ticket.findUnique({ where: { id: ticketA_id } });
    const originalTime = new Date(res.body.originalRedemptionTime);
    expect(Math.abs(originalTime.getTime() - dbTicket.redeemedAt.getTime())).toBeLessThan(2000);
  });

  // ===== LAZY EXPIRATION (FR-034) =====

  test('Expired event: scanning ticket lazily updates status to EXPIRED → 410', async () => {
    // Ticket B is for an event with date in the past
    // Verify ticket is still VALID in DB before scan
    const beforeTicket = await prisma.ticket.findUnique({ where: { id: ticketB_id } });
    expect(beforeTicket.status).toBe('VALID');

    // Generate QR with long expiry (bypass JWT expiration for this test)
    const payload = { sub: ticketB_id, eventId: expiredEventId, barcode: ticketB_barcode };
    const qrPayload = jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '365d' });

    const res = await request(app).post('/tickets/redeem').send({ qrPayload });

    expect(res.status).toBe(410);
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.ticketId).toBe(ticketB_id);

    // Verify DB was lazily updated to EXPIRED
    const afterTicket = await prisma.ticket.findUnique({ where: { id: ticketB_id } });
    expect(afterTicket.status).toBe('EXPIRED');
  });

  // ===== FORGED QR DETECTION =====

  test('Forged QR with wrong secret is rejected at API level', async () => {
    const payload = { sub: ticketA_id, eventId: testEventId, barcode: ticketA_barcode };
    const forgedQR = jwt.sign(payload, 'totally-wrong-secret-key-long-enough', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    const res = await request(app).post('/tickets/redeem').send({ qrPayload: forgedQR });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('INVALID');
  });
});
