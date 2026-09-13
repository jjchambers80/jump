// Scanner authentication for the door endpoints (POST /tickets/scan, /redeem).
//
// Accepts either:
//   - a staff session (Authorization: Bearer <Auth.js JWT>, ORGANIZER or above), or
//   - a reader device key (X-Scanner-Key: <SCANNER_API_KEY>) for hardware
//     scanners that have no user session (spec 006 NFC/VAS readers).
//
// Closed by default: with SCANNER_API_KEY unset only staff sessions pass.
// Previously these endpoints were open, which let anyone holding a QR payload
// redeem (void) a ticket remotely.

import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthenticationError, ForbiddenError } from './errorHandler.js';

const STAFF_ROLES = new Set(['ORGANIZER', 'ADMIN', 'SYSTEM_ADMIN']);

export function scannerKeyMatches(presented) {
  const expected = process.env.SCANNER_API_KEY;
  if (!expected || !presented) return false;
  const a = Buffer.from(String(presented), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const requireScannerOrStaff = (req, res, next) => {
  try {
    if (scannerKeyMatches(req.get('x-scanner-key'))) {
      req.scanner = { kind: 'device' };
      return next();
    }

    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ') && process.env.AUTH_SECRET) {
      let decoded;
      try {
        decoded = jwt.verify(header.slice(7), process.env.AUTH_SECRET, { algorithms: ['HS256'] });
      } catch {
        throw new AuthenticationError('Invalid or expired token');
      }
      if (decoded.typ === 'buyer') throw new AuthenticationError('Buyer sessions cannot scan tickets');
      if (!STAFF_ROLES.has(decoded.role)) throw new ForbiddenError('Staff role required to scan tickets');
      req.scanner = { kind: 'staff', userId: decoded.sub, role: decoded.role };
      return next();
    }

    throw new AuthenticationError('Scanner key or staff sign-in required');
  } catch (error) {
    next(error);
  }
};
