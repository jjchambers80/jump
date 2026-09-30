// Buyer session middleware (spec 007 phase 2)
// Verifies a buyer JWT (typ 'buyer') from Authorization: Bearer <token> and
// attaches req.buyer = { contactId, organizationId, email, issuedAt }; refuses a
// session issued before the buyer signed out everywhere (spec 040).
// Distinct from middleware/auth.js, which is for staff; neither accepts the
// other's tokens.

import buyerAuthService from '../services/BuyerAuthService.js';
import { AuthenticationError } from './errorHandler.js';

export const requireBuyer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No buyer session');
    }
    const buyer = buyerAuthService.verifySession(authHeader.slice(7));
    // Spec 040: "Sign out of all devices" revokes every session issued before it.
    await buyerAuthService.assertSessionCurrent(buyer);
    req.buyer = buyer;
    next();
  } catch (error) {
    next(error);
  }
};
