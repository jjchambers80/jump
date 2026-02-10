// Role-based access control middleware
// Uses req.user.role from JWT claims (set by auth.js middleware)
// Supports: CUSTOMER, ORGANIZER, ADMIN roles per UserRole enum

import { ForbiddenError, AuthenticationError } from './errorHandler.js';

/**
 * Factory middleware: requires the authenticated user to have one of the specified roles.
 * Must be used AFTER requireAuth middleware.
 *
 * @param {...string} roles - Allowed roles (e.g., 'ADMIN', 'ORGANIZER')
 * @returns {Function} Express middleware
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      if (!roles.includes(req.user.role)) {
        throw new ForbiddenError(`Access denied. Required role: ${roles.join(' or ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/** Convenience: requires ADMIN role */
export const requireAdmin = requireRole('ADMIN');

/** Convenience: requires ORGANIZER or ADMIN role */
export const requireOrganizer = requireRole('ORGANIZER', 'ADMIN');

/** Convenience: alias for requireAuth (any authenticated user) */
export { requireAuth } from './auth.js';
