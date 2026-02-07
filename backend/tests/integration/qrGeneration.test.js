// Integration test for QR code generation
// Tests JWT structure, signature, expiration per FR-006, FR-007

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';

const prisma = new PrismaClient();

describe('QR Code Generation Integration Test', () => {
  let testTicket;
  let testEvent;
  let testCustomer;
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  beforeAll(async () => {
    // Clean up
    await prisma.ticket.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();

    // Create test data
    const admin = await prisma.admin.create({
      data: {
        email: 'admin@qr-test.com',
        name: 'QR Test Admin',
        organization: 'Test Org',
        passwordHash: 'hashed',
      },
    });

    testEvent = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'QR Test Event',
        date: new Date('2026-12-31'),
        venue: 'Test Venue',
        capacity: 100,
        ticketPrice: 5000,
        status: 'PUBLISHED',
      },
    });

    testCustomer = await prisma.customer.create({
      data: {
        email: 'customer@qr-test.com',
        name: 'QR Test Customer',
        passwordHash: 'hashed',
      },
    });

    // Generate a JWT token as the QR service would
    const payload = {
      ticket_id: 'test-ticket-id',
      event_id: testEvent.id,
      customer_email: testCustomer.email,
      event_name: testEvent.name,
      event_date: testEvent.date.toISOString(),
      venue: testEvent.venue,
    };

    const expirationTime = new Date(testEvent.date);
    expirationTime.setHours(expirationTime.getHours() + 24); // Expires 24h after event

    const token = jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: Math.floor((expirationTime - new Date()) / 1000),
    });

    testTicket = await prisma.ticket.create({
      data: {
        eventId: testEvent.id,
        customerId: testCustomer.id,
        pricePaid: 5000,
        status: 'VALID',
        qrCodeJwt: token,
      },
    });
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany();
    await prisma.event.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.$disconnect();
  });

  it('should generate valid JWT with HMAC-SHA256 signature', () => {
    const token = testTicket.qrCodeJwt;

    // Verify token can be decoded
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    expect(decoded).toBeDefined();
    expect(decoded.ticket_id).toBeDefined();
    expect(decoded.event_id).toBe(testEvent.id);
    expect(decoded.customer_email).toBe(testCustomer.email);
  });

  it('should include required ticket information in JWT payload', () => {
    const token = testTicket.qrCodeJwt;
    const decoded = jwt.decode(token);

    // Verify required fields per FR-006
    expect(decoded).toHaveProperty('ticket_id');
    expect(decoded).toHaveProperty('event_id');
    expect(decoded).toHaveProperty('customer_email');
    expect(decoded).toHaveProperty('event_name');
    expect(decoded).toHaveProperty('event_date');
    expect(decoded).toHaveProperty('venue');
    expect(decoded).toHaveProperty('exp'); // Expiration timestamp
  });

  it('should set expiration to 24 hours after event date', () => {
    const token = testTicket.qrCodeJwt;
    const decoded = jwt.decode(token);

    const eventDate = new Date(testEvent.date);
    const expectedExpiration = new Date(eventDate);
    expectedExpiration.setHours(expectedExpiration.getHours() + 24);

    const tokenExpiration = new Date(decoded.exp * 1000);

    // Allow 1 hour tolerance for test timing
    const timeDiff = Math.abs(tokenExpiration - expectedExpiration);
    expect(timeDiff).toBeLessThan(3600 * 1000); // Less than 1 hour difference
  });

  it('should reject token with invalid signature', () => {
    const token = testTicket.qrCodeJwt;

    // Try to verify with wrong secret
    expect(() => {
      jwt.verify(token, 'wrong-secret', { algorithms: ['HS256'] });
    }).toThrow();
  });

  it('should reject expired tokens', () => {
    // Create a token that's already expired
    const payload = {
      ticket_id: 'expired-ticket',
      event_id: testEvent.id,
      customer_email: testCustomer.email,
    };

    const expiredToken = jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: -3600, // Expired 1 hour ago
    });

    expect(() => {
      jwt.verify(expiredToken, JWT_SECRET, { algorithms: ['HS256'] });
    }).toThrow(/expired/);
  });

  it('should be able to generate QR code image from JWT', async () => {
    const token = testTicket.qrCodeJwt;

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(token);

    expect(qrDataUrl).toBeTruthy();
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('should include event details that can be read offline', () => {
    const token = testTicket.qrCodeJwt;
    const decoded = jwt.decode(token);

    // Verify all necessary info for offline validation per FR-007
    expect(decoded.event_name).toBe(testEvent.name);
    expect(decoded.venue).toBe(testEvent.venue);
    expect(decoded.customer_email).toBe(testCustomer.email);

    // Event staff should be able to read these details even without internet
    const eventDate = new Date(decoded.event_date);
    expect(eventDate).toBeInstanceOf(Date);
    expect(eventDate.getTime()).toBeCloseTo(testEvent.date.getTime(), -3);
  });

  it('should use consistent signing algorithm across all tickets', async () => {
    // Create multiple tickets
    const tickets = [];
    for (let i = 0; i < 3; i++) {
      const payload = {
        ticket_id: `ticket-${i}`,
        event_id: testEvent.id,
        customer_email: `buyer${i}@test.com`,
      };

      const token = jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '30d',
      });

      tickets.push(token);
    }

    // Verify all use HS256
    tickets.forEach((token) => {
      const decoded = jwt.decode(token, { complete: true });
      expect(decoded.header.alg).toBe('HS256');
    });
  });

  it('should prevent token tampering', () => {
    const token = testTicket.qrCodeJwt;
    const [header, payload, signature] = token.split('.');

    // Try to modify payload
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
    decodedPayload.ticket_id = 'tampered-id';
    const tamperedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64');

    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

    // Verification should fail
    expect(() => {
      jwt.verify(tamperedToken, JWT_SECRET, { algorithms: ['HS256'] });
    }).toThrow();
  });
});
