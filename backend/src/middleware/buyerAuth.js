// Buyer session middleware (spec 007 phase 2)
// Verifies a buyer JWT (typ 'buyer') from Authorization: Bearer <token> and
// attaches req.buyer = { contactId, organizationId, email }.
// Distinct from middleware/auth.js, which is for staff; neither accepts the
// other's tokens.

import buyerAuthService from '../services/BuyerAuthService.js';
import { AuthenticationError } from './errorHandler.js';

export const requireBuyer = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No buyer session');
    }
    req.buyer = buyerAuthService.verifySession(authHeader.slice(7));
    next();
  } catch (error) {
    next(error);
  }
};
