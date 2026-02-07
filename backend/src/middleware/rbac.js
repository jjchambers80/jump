// Role-based access control middleware
// Enforces admin-only access per FR-013

import { ForbiddenError } from './errorHandler.js';

export const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    if (req.user.type !== 'ADMIN') {
      throw new ForbiddenError('Admin access required');
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireCustomer = (req, res, next) => {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required');
    }

    if (req.user.type !== 'CUSTOMER') {
      throw new ForbiddenError('Customer access required');
    }

    next();
  } catch (error) {
    next(error);
  }
};
