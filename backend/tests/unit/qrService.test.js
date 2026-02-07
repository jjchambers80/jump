// Unit tests for QRService
// Tests JWT generation, signature verification, QR code image generation

import { jest } from '@jest/globals';

// Mock metrics and logger
jest.unstable_mockModule('../../src/utils/metrics.js', () => ({
  recordQRGeneration: jest.fn(),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { default: QRService } = await import('../../src/services/QRService.js');
const { recordQRGeneration } = await import('../../src/utils/metrics.js');

describe('QRService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateQRCodeJWT', () => {
    it('should generate a valid JWT token with correct payload', async () => {
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Test Concert',
        new Date('2026-06-15T20:00:00Z'),
        'Test Arena'
      );

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // JWT has 3 parts separated by dots
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include all required fields in JWT payload', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Test Concert',
        eventDate,
        'Test Arena'
      );

      const decoded = QRService.decodeQRCode(token);

      expect(decoded.ticket_id).toBe('tkt-1');
      expect(decoded.event_id).toBe('evt-1');
      expect(decoded.customer_email).toBe('user@test.com');
      expect(decoded.event_name).toBe('Test Concert');
      expect(decoded.venue).toBe('Test Arena');
      expect(decoded.event_date).toBe(eventDate.toISOString());
      expect(decoded.issued_at).toBeTruthy();
    });

    it('should record success metric on generation', async () => {
      await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Test Concert',
        new Date('2026-06-15T20:00:00Z'),
        'Test Arena'
      );

      expect(recordQRGeneration).toHaveBeenCalledWith('success');
    });

    it('should generate different tokens for different tickets', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');

      const token1 = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );
      const token2 = await QRService.generateQRCodeJWT(
        'tkt-2',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      expect(token1).not.toBe(token2);
    });

    it('should set JWT expiration to 24 hours after event date', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      const decoded = QRService.decodeQRCode(token);

      // JWT exp should be roughly 24 hours after event date
      const expectedExp = new Date(eventDate);
      expectedExp.setHours(expectedExp.getHours() + 24);
      const expDate = new Date(decoded.exp * 1000);

      // Allow some tolerance for processing time
      expect(Math.abs(expDate.getTime() - expectedExp.getTime())).toBeLessThan(5000);
    });
  });

  describe('verifyQRCode', () => {
    it('should verify and decode a valid JWT token', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      const decoded = QRService.verifyQRCode(token);

      expect(decoded.ticket_id).toBe('tkt-1');
      expect(decoded.event_id).toBe('evt-1');
      expect(decoded.customer_email).toBe('user@test.com');
    });

    it('should throw error for invalid JWT token', () => {
      expect(() => QRService.verifyQRCode('invalid-token')).toThrow('Invalid QR code');
    });

    it('should throw error for tampered JWT token', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      // Tamper with the token by changing a character in the signature
      const parts = token.split('.');
      parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
      const tamperedToken = parts.join('.');

      expect(() => QRService.verifyQRCode(tamperedToken)).toThrow('Invalid QR code');
    });
  });

  describe('generateQRCodeImage', () => {
    it('should generate a data URL PNG from JWT token', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      const dataUrl = await QRService.generateQRCodeImage(token);

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('should generate non-empty image data', async () => {
      const dataUrl = await QRService.generateQRCodeImage('test-data');

      expect(dataUrl.length).toBeGreaterThan(100);
    });
  });

  describe('decodeQRCode', () => {
    it('should decode JWT without verification', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT(
        'tkt-1',
        'evt-1',
        'user@test.com',
        'Concert',
        eventDate,
        'Arena'
      );

      const decoded = QRService.decodeQRCode(token);

      expect(decoded.ticket_id).toBe('tkt-1');
    });

    it('should return null for invalid token', () => {
      const result = QRService.decodeQRCode('not-a-jwt');

      expect(result).toBeNull();
    });
  });
});
