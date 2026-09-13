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
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', new Date('2026-06-15T20:00:00Z'));

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // JWT has 3 parts separated by dots
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include all required fields in JWT payload', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

      const decoded = QRService.decodeQRCode(token);

      // Current payload is minimal: { sub, eventId, barcode } + iat/exp
      expect(decoded.sub).toBe('tkt-1');
      expect(decoded.eventId).toBe('evt-1');
      expect(decoded.barcode).toBe('JUMP-TEST00000001');
      expect(decoded.iat).toBeTruthy();
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });

    it('should record success metric on generation', async () => {
      await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', new Date('2026-06-15T20:00:00Z'));

      expect(recordQRGeneration).toHaveBeenCalledWith('success');
    });

    it('should generate different tokens for different tickets', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');

      const token1 = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);
      const token2 = await QRService.generateQRCodeJWT('tkt-2', 'evt-1', 'JUMP-TEST00000001', eventDate);

      expect(token1).not.toBe(token2);
    });

    it('should set JWT expiration to 24 hours after event date', async () => {
      // Must be in the future: past events get the 24h-from-now floor instead
      const eventDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

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
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

      const decoded = QRService.verifyQRCode(token);

      expect(decoded.sub).toBe('tkt-1');
      expect(decoded.eventId).toBe('evt-1');
      expect(decoded.barcode).toBe('JUMP-TEST00000001');
    });

    it('should throw error for invalid JWT token', () => {
      expect(() => QRService.verifyQRCode('invalid-token')).toThrow('Invalid QR code');
    });

    it('should throw error for tampered JWT token', async () => {
      const eventDate = new Date('2026-06-15T20:00:00Z');
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

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
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

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
      const token = await QRService.generateQRCodeJWT('tkt-1', 'evt-1', 'JUMP-TEST00000001', eventDate);

      const decoded = QRService.decodeQRCode(token);

      expect(decoded.sub).toBe('tkt-1');
    });

    it('should return null for invalid token', () => {
      const result = QRService.decodeQRCode('not-a-jwt');

      expect(result).toBeNull();
    });
  });
});
