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
import { resolveOrgScope } from './orgScope.js';

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

/** Sentinel scope for staff without a membership: matches no organization. */
export const NO_ORG_SCOPE = '__no-organization__';

/**
 * Organization scope for the door endpoints (spec 022): staff see only their
 * own organization's tickets. Hardware readers (shared SCANNER_API_KEY) and
 * SYSTEM_ADMIN are unscoped (`organizationId: null`). A staff user with no
 * membership gets a scope no ticket matches.
 */
export async function scannerOrgScope(req) {
  const scanner = req.scanner;
  if (!scanner || scanner.kind !== 'staff' || scanner.role === 'SYSTEM_ADMIN') return { organizationId: null };
  const scope = await resolveOrgScope(scanner.userId, scanner.role, req.get('x-jump-org') || undefined);
  return { organizationId: scope.organizationId || NO_ORG_SCOPE };
}
