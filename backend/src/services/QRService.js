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
   * Generate the door QR payload for a vendor application (spec 036).
   * Format: jump://vendor?id={applicationId}&e={eventId}&t={statusToken}
   *
   * The token is `applicationLinks.statusToken()` — the same HMAC already in
   * every approval email, so a vendor's existing status link is a valid
   * credential and no new one has to be issued.
   *
   * @param {string} applicationId - Application CUID
   * @param {string} eventId - Event CUID
   * @param {string} token - Status token (HMAC of the application id)
   * @returns {string} QR payload string
   */
  generateVendorQRPayload(applicationId, eventId, token) {
    return `jump://vendor?id=${encodeURIComponent(applicationId)}&e=${encodeURIComponent(eventId)}&t=${encodeURIComponent(token)}`;
  }

  /**
   * Parse whatever the door scanner read into { applicationId, eventId, token }.
   *
   * Accepts three shapes, because a vendor at the door may present any of them:
   *   - `jump://vendor?id=…&e=…&t=…` (the badge QR above)
   *   - the storefront status URL `…/events/{eventId}/apply/status/{id}?token=…`
   *     straight out of the approval email
   *   - a bare `{applicationId}:{token}` pair (typed in, or a reader that
   *     strips the scheme)
   *
   * Returns null when the string is not a vendor credential at all. Never
   * validates the token — that is the service's job, against the stored hash.
   *
   * @param {string} payload - Raw string from the scanner or manual entry
   * @returns {{ applicationId: string, eventId: string|null, token: string } | null}
   */
  parseVendorPayload(payload) {
    const raw = typeof payload === 'string' ? payload.trim() : '';
    if (!raw) return null;

    if (raw.startsWith('jump://vendor?')) {
      try {
        const url = new URL(raw.replace('jump://', 'https://'));
        const applicationId = url.searchParams.get('id');
        const token = url.searchParams.get('t');
        if (!applicationId || !token) return null;
        return { applicationId, eventId: url.searchParams.get('e') || null, token };
      } catch {
        return null;
      }
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const url = new URL(raw);
        const token = url.searchParams.get('token');
        // /events/{eventId}/apply/status/{applicationId} — also matches the
        // custom-domain shortening /apply/status/{applicationId}.
        const parts = url.pathname.split('/').filter(Boolean);
        const statusAt = parts.lastIndexOf('status');
        const applicationId = statusAt >= 0 ? parts[statusAt + 1] : null;
        if (!applicationId || !token) return null;
        const eventsAt = parts.indexOf('events');
        return { applicationId, eventId: eventsAt >= 0 ? parts[eventsAt + 1] || null : null, token };
      } catch {
        return null;
      }
    }

    // Bare `{applicationId}:{token}` — deliberately strict, because a colon
    // appears in every other payload too. Without the shape check a ticket QR
    // held up at the vendor door parses as id `jump`, and staff get "no vendor
    // matches" instead of "that is a ticket".
    const pair = raw.match(/^([a-z0-9]{8,32}):([a-f0-9]{64})$/i);
    if (pair) return { applicationId: pair[1], eventId: null, token: pair[2] };
    return null;
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
