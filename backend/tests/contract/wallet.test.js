// Contract tests for wallet pass routes
// Tests: GET /wallet/apple/:ticketId.pkpass, GET /wallet/google/:ticketId
//
// Scenarios:
// - 200 .pkpass for a valid wallet token
// - 200 .pkpass for the signed-in ticket owner without a token
// - 403 for a wrong token / wrong user
// - 410 for a ticket that is no longer VALID
// - 404 for an unknown ticket
// - 302 to pay.google.com for Google (REST sync mocked)
// - wallet links appear on GET /orders/:orderId

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/wallet');
const AUTH_SECRET = process.env.AUTH_SECRET;

process.env.BACKEND_URL = 'https://api.example.com';
process.env.APPLE_PASS_TYPE_ID = 'pass.events.jump.test';
process.env.APPLE_TEAM_ID = 'TESTTEAM01';
process.env.APPLE_PASS_CERT_PEM = fs.readFileSync(path.join(fixtures, 'signerCert.pem'), 'utf8');
process.env.APPLE_PASS_KEY_PEM = fs.readFileSync(path.join(fixtures, 'signerKey.pem'), 'utf8');
process.env.APPLE_WWDR_PEM = fs.readFileSync(path.join(fixtures, 'wwdr.pem'), 'utf8');
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000012345678';
process.env.GOOGLE_WALLET_SA_EMAIL = 'wallet@test-project.iam.gserviceaccount.com';
process.env.GOOGLE_WALLET_SA_PRIVATE_KEY = process.env.APPLE_PASS_KEY_PEM;

function generateToken(overrides = {}) {
  const payload = {
    sub: overrides.id || 'wallet-test-user-id',
    email: overrides.email || 'buyer@wallet-test.com',
    role: overrides.role || 'CUSTOMER',
    name: overrides.name || 'Wallet Buyer',
  };
  return jwt.sign(payload, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

// Mock Stripe (server import pulls it in)
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: walletTokenService } = await import('../../src/services/wallet/WalletTokenService.js');
const { default: googleWalletService } = await import('../../src/services/wallet/GoogleWalletService.js');

describe('Wallet pass routes', () => {
  let orgId, venueId, eventId, tierId, contactId, orderId;
  let validTicketId, validBarcode, redeemedTicketId;

  const futureDate = new Date('2027-06-01T20:00:00Z');

  beforeAll(async () => {
    // Fixtures go straight through Prisma — the wallet routes are what is
    // under test here, not the admin APIs.
    const org = await prisma.organization.create({
      data: { name: 'Wallet Test Org', brandColor: '#10b981' },
    });
    orgId = org.id;

    const venue = await prisma.venue.create({
      data: { organizationId: orgId, name: 'Wallet Venue', address: '1 Pass St', timezone: 'America/New_York' },
    });
    venueId = venue.id;

    const event = await prisma.event.create({
      data: {
        name: 'Wallet Concert',
        venueId,
        date: futureDate,
        capacity: 10,
        status: 'PUBLISHED',
        priceTiers: {
          create: [{ name: 'GA', price: 2500, quantityTotal: 10, quantitySold: 0, quantityReserved: 0, displayOrder: 1 }],
        },
      },
      include: { priceTiers: true },
    });
    eventId = event.id;
    tierId = event.priceTiers[0].id;

    const contact = await prisma.contact.upsert({
      where: { email: 'buyer@wallet-test.com' },
      update: {},
      create: { email: 'buyer@wallet-test.com', firstName: 'Wallet', lastName: 'Buyer' },
    });
    contactId = contact.id;

    const order = await prisma.order.create({
      data: {
        eventId,
        contactId,
        orderRef: `WALLET-${Date.now()}`,
        totalAmount: 5000,
        quantity: 2,
        status: 'COMPLETED',
      },
    });
    orderId = order.id;

    const stamp = Date.now().toString(36).toUpperCase().slice(-6);
    validBarcode = `JUMP-WALLET${stamp}`;
    const valid = await prisma.ticket.create({
      data: {
        orderId,
        eventId,
        priceTierId: tierId,
        contactId,
        ticketNumber: 1,
        pricePaid: 2500,
        barcode: validBarcode,
        status: 'VALID',
      },
    });
    validTicketId = valid.id;

    const redeemed = await prisma.ticket.create({
      data: {
        orderId,
        eventId,
        priceTierId: tierId,
        contactId,
        ticketNumber: 2,
        pricePaid: 2500,
        barcode: `JUMP-WALLTR${stamp}`,
        status: 'REDEEMED',
        redeemedAt: new Date(),
      },
    });
    redeemedTicketId = redeemed.id;
  });

  afterAll(async () => {
    if (contactId) await prisma.ticket.deleteMany({ where: { contactId } });
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (eventId) {
      await prisma.priceTier.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
    }
    if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  // ===== Apple =====

  test('200 — serves a .pkpass for a valid wallet token', async () => {
    const t = walletTokenService.issue(validTicketId);
    const res = await request(app)
      .get(`/wallet/apple/${validTicketId}.pkpass?t=${t}`)
      .buffer()
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(res.headers['content-disposition']).toContain(`ticket-${validBarcode}.pkpass`);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(res.body).subarray(0, 2).toString()).toBe('PK');
  });

  test('200 — serves a .pkpass to the signed-in ticket owner without a token', async () => {
    const res = await request(app)
      .get(`/wallet/apple/${validTicketId}.pkpass`)
      .set('Authorization', `Bearer ${generateToken()}`)
      .buffer();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');
  });

  test('403 — rejects a wrong token', async () => {
    const wrong = walletTokenService.issue(redeemedTicketId);
    const res = await request(app).get(`/wallet/apple/${validTicketId}.pkpass?t=${wrong}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  test('403 — rejects a signed-in user who does not own the ticket', async () => {
    const res = await request(app)
      .get(`/wallet/apple/${validTicketId}.pkpass`)
      .set('Authorization', `Bearer ${generateToken({ email: 'someone-else@wallet-test.com' })}`);
    expect(res.status).toBe(403);
  });

  test('403 — rejects a missing token for anonymous requests', async () => {
    const res = await request(app).get(`/wallet/apple/${validTicketId}.pkpass`);
    expect(res.status).toBe(403);
  });

  test('410 — refuses tickets that are no longer VALID', async () => {
    const t = walletTokenService.issue(redeemedTicketId);
    const res = await request(app).get(`/wallet/apple/${redeemedTicketId}.pkpass?t=${t}`);
    expect(res.status).toBe(410);
    expect(res.body.status).toBe('REDEEMED');
  });

  test('404 — unknown ticket', async () => {
    const res = await request(app).get(`/wallet/apple/does-not-exist.pkpass?t=${walletTokenService.issue('does-not-exist')}`);
    expect(res.status).toBe(404);
  });

  // ===== Google =====

  test('302 — redirects to the Google Wallet save URL', async () => {
    const upsert = jest.spyOn(googleWalletService, '_upsert').mockResolvedValue({});
    try {
      const t = walletTokenService.issue(validTicketId);
      const res = await request(app).get(`/wallet/google/${validTicketId}?t=${t}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[A-Za-z0-9_.-]+$/);
      expect(res.headers.location.length).toBeLessThan(1800);
      // class + object were synced through the REST API
      expect(upsert).toHaveBeenCalledWith('eventTicketClass', expect.objectContaining({ id: `3388000000012345678.event-${eventId}` }));
      expect(upsert).toHaveBeenCalledWith('eventTicketObject', expect.objectContaining({ id: `3388000000012345678.ticket-${validTicketId}` }));

      const ticket = await prisma.ticket.findUnique({ where: { id: validTicketId } });
      expect(ticket.googleObjectId).toBe(`3388000000012345678.ticket-${validTicketId}`);
      const event = await prisma.event.findUnique({ where: { id: eventId } });
      expect(event.googleClassId).toBe(`3388000000012345678.event-${eventId}`);
    } finally {
      upsert.mockRestore();
    }
  });

  test('302 — still redirects (fat JWT) when the Google REST API is unavailable', async () => {
    const upsert = jest.spyOn(googleWalletService, '_upsert').mockRejectedValue(new Error('network down'));
    try {
      // Fresh ticket so no cached object id short-circuits the sync
      await prisma.ticket.update({ where: { id: validTicketId }, data: { googleObjectId: null } });
      await prisma.event.update({ where: { id: eventId }, data: { googleClassSyncedAt: null } });
      const t = walletTokenService.issue(validTicketId);
      const res = await request(app).get(`/wallet/google/${validTicketId}?t=${t}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    } finally {
      upsert.mockRestore();
    }
  });

  test('410 — Google link refuses non-VALID tickets', async () => {
    const t = walletTokenService.issue(redeemedTicketId);
    const res = await request(app).get(`/wallet/google/${redeemedTicketId}?t=${t}`);
    expect(res.status).toBe(410);
  });

  // ===== Links in order detail =====

  test('GET /orders/:orderId exposes wallet links only for VALID tickets', async () => {
    const res = await request(app).get(`/orders/${orderId}`);
    expect(res.status).toBe(200);

    const valid = res.body.tickets.find((t) => t.id === validTicketId);
    const redeemed = res.body.tickets.find((t) => t.id === redeemedTicketId);

    expect(valid.wallet.apple).toBe(
      `https://api.example.com/wallet/apple/${validTicketId}.pkpass?t=${walletTokenService.issue(validTicketId)}`
    );
    expect(valid.wallet.google).toBe(
      `https://api.example.com/wallet/google/${validTicketId}?t=${walletTokenService.issue(validTicketId)}`
    );
    expect(redeemed.wallet).toEqual({ apple: null, google: null });
  });
});
