// QR Code Service
// Generates JWT-based QR codes per FR-006, FR-007

import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { recordQRGeneration } from '../utils/metrics.js';
import logger from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

class QRService {
  /**
   * Generate QR code JWT for ticket
   * @param {string} ticketId - UUID of the ticket
   * @param {string} eventId - UUID of the event
   * @param {string} customerEmail - Customer email
   * @param {string} eventName - Event name
   * @param {Date} eventDate - Event date
   * @param {string} venue - Event venue
   * @returns {Promise<string>} JWT token
   */
  async generateQRCodeJWT(ticketId, eventId, customerEmail, eventName, eventDate, venue) {
    try {
      // JWT payload with all required information per FR-006
      const payload = {
        ticket_id: ticketId,
        event_id: eventId,
        customer_email: customerEmail,
        event_name: eventName,
        event_date: eventDate.toISOString(),
        venue,
        issued_at: new Date().toISOString(),
      };

      // Calculate expiration: 24 hours after event date per FR-007
      const expirationDate = new Date(eventDate);
      expirationDate.setHours(expirationDate.getHours() + 24);

      const expiresInSeconds = Math.floor((expirationDate - new Date()) / 1000);

      // Sign JWT with HMAC-SHA256
      const token = jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: expiresInSeconds > 0 ? expiresInSeconds : 86400, // At least 24 hours
      });

      // Record success metric
      recordQRGeneration('success');

      logger.info('QR code JWT generated', {
        ticketId,
        eventId,
        expiresAt: expirationDate.toISOString(),
      });

      return token;
    } catch (error) {
      // Record failure metric
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
   * Generate QR code image as Data URL
   * @param {string} jwtToken - JWT token to encode
   * @returns {Promise<string>} Data URL of QR code image
   */
  async generateQRCodeImage(jwtToken) {
    try {
      // Generate QR code as data URL (base64 PNG)
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
   * Verify and decode QR code JWT
   * @param {string} token - JWT token from QR code
   * @returns {Object} Decoded payload
   */
  verifyQRCode(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      logger.info('QR code verified', {
        ticketId: decoded.ticket_id,
        eventId: decoded.event_id,
      });

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        logger.warn('QR code expired', {
          expiredAt: error.expiredAt,
        });
        throw new Error('QR code has expired');
      }

      if (error.name === 'JsonWebTokenError') {
        logger.warn('Invalid QR code', {
          error: error.message,
        });
        throw new Error('Invalid QR code');
      }

      throw error;
    }
  }

  /**
   * Decode QR code without verification (for display purposes)
   * @param {string} token - JWT token
   * @returns {Object} Decoded payload
   */
  decodeQRCode(token) {
    return jwt.decode(token);
  }
}

export default new QRService();
