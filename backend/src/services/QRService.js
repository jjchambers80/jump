// QR Code Service
// Generates QR codes for ticket verification
// Supports both new query-string format and legacy JWT format

import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { recordQRGeneration } from '../utils/metrics.js';
import logger from '../utils/logger.js';

const AUTH_SECRET = process.env.AUTH_SECRET;

class QRService {
  /**
   * Generate a simple query-string QR payload for a ticket.
   * Format: jump://ticket?id={ticketId}&b={barcode}&e={eventId}
   *
   * @param {string} ticketId - Ticket CUID
   * @param {string} eventId - Event CUID
   * @param {string} barcode - Unique ticket barcode (JUMP-XXXXXXXXXXXX)
   * @returns {string} QR payload string
   */
  generateQRPayload(ticketId, eventId, barcode) {
    const payload = `jump://ticket?id=${encodeURIComponent(ticketId)}&b=${encodeURIComponent(barcode)}&e=${encodeURIComponent(eventId)}`;
    recordQRGeneration('success');
    logger.info('QR payload generated', { ticketId, eventId, barcode });
    return payload;
  }

  /**
   * Parse a query-string QR payload.
   * Returns { ticketId, barcode, eventId } or null if not a valid jump:// payload.
   *
   * @param {string} payload - Raw string from QR scan
   * @returns {{ ticketId: string, barcode: string, eventId: string } | null}
   */
  parseQRPayload(payload) {
    if (!payload || !payload.startsWith('jump://ticket?')) {
      return null;
    }
    try {
      const url = new URL(payload.replace('jump://', 'https://'));
      const ticketId = url.searchParams.get('id');
      const barcode = url.searchParams.get('b');
      const eventId = url.searchParams.get('e');
      if (!ticketId || !barcode || !eventId) return null;
      return { ticketId, barcode, eventId };
    } catch {
      return null;
    }
  }

  /**
   * Check if a payload is a jump:// format vs legacy JWT.
   * @param {string} payload
   * @returns {boolean}
   */
  isJumpPayload(payload) {
    return payload && payload.startsWith('jump://');
  }

  /**
   * Generate QR code JWT for a ticket (legacy format).
   * Payload: { sub: ticketId, eventId, barcode, iat, exp }
   * Signed with HS256 using AUTH_SECRET.
   * Expires 24 hours after the event date.
   *
   * @param {string} ticketId - Ticket CUID
   * @param {string} eventId - Event CUID
   * @param {string} barcode - Unique ticket barcode (JUMP-XXXXXXXXXXXX)
   * @param {Date} eventDate - Event date (used to compute expiry)
   * @returns {string} JWT token
   */
  generateQRCodeJWT(ticketId, eventId, barcode, eventDate) {
    try {
      if (!AUTH_SECRET) {
        throw new Error('AUTH_SECRET environment variable is required for QR code generation');
      }

      const payload = {
        sub: ticketId,
        eventId,
        barcode,
      };

      // Expiration: 24 hours after event date
      const expirationDate = new Date(eventDate);
      expirationDate.setHours(expirationDate.getHours() + 24);

      const expiresInSeconds = Math.max(
        Math.floor((expirationDate.getTime() - Date.now()) / 1000),
        86400 // At least 24 hours from now
      );

      const token = jwt.sign(payload, AUTH_SECRET, {
        algorithm: 'HS256',
        expiresIn: expiresInSeconds,
      });

      recordQRGeneration('success');

      logger.info('QR code JWT generated', { ticketId, eventId, barcode });

      return token;
    } catch (error) {
      recordQRGeneration('failure');
      logger.error('QR code generation failed', {
        ticketId,
        eventId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generate QR code image as Data URL (base64 PNG).
   *
   * @param {string} jwtToken - JWT token to encode in QR code
   * @returns {Promise<string>} Data URL of QR code PNG
   */
  async generateQRCodeImage(jwtToken) {
    try {
      const dataUrl = await QRCode.toDataURL(jwtToken, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2,
      });
      return dataUrl;
    } catch (error) {
      logger.error('QR code image generation failed', {
        error: error.message,
      });
      throw new Error('Failed to generate QR code image');
    }
  }

  /**
   * Verify and decode QR code JWT.
   * Returns the decoded payload { sub, eventId, barcode, iat, exp }.
   *
   * @param {string} token - JWT string from scanned QR code
   * @returns {Object} Decoded payload
   * @throws {Error} If token is expired or invalid
   */
  verifyQRCode(token) {
    try {
      if (!AUTH_SECRET) {
        throw new Error('AUTH_SECRET environment variable is required');
      }

      const decoded = jwt.verify(token, AUTH_SECRET, {
        algorithms: ['HS256'],
      });

      logger.info('QR code verified', {
        ticketId: decoded.sub,
        eventId: decoded.eventId,
        barcode: decoded.barcode,
      });

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        logger.warn('QR code expired', { expiredAt: error.expiredAt });
        const expiredError = new Error('QR code has expired');
        expiredError.code = 'QR_EXPIRED';
        throw expiredError;
      }

      if (error.name === 'JsonWebTokenError') {
        logger.warn('Invalid QR code', { error: error.message });
        const invalidError = new Error('Invalid QR code');
        invalidError.code = 'QR_INVALID';
        throw invalidError;
      }

      throw error;
    }
  }

  /**
   * Decode QR code without verification (for display / debugging).
   *
   * @param {string} token - JWT token
   * @returns {Object|null} Decoded payload or null
   */
  decodeQRCode(token) {
    return jwt.decode(token);
  }
}

export default new QRService();
