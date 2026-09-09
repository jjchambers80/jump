// User input validators
// Validation for user management endpoints per FR-003, FR-056

import { ValidationError } from '../../middleware/errorHandler.js';

const VALID_ROLES = ['CUSTOMER', 'ORGANIZER', 'ADMIN', 'SYSTEM_ADMIN'];

/**
 * Validate PATCH /users/:id body
 */
export const validateUpdateUser = (req, res, next) => {
  const { role, isActive, organizationId } = req.body;

  // At least one field must be provided
  if (role === undefined && isActive === undefined && organizationId === undefined) {
    return next(
      new ValidationError('At least one field (role, isActive, organizationId) must be provided')
    );
  }

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) {
      return next(new ValidationError(`role must be one of: ${VALID_ROLES.join(', ')}`));
    }
  }

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      return next(new ValidationError('isActive must be a boolean'));
    }
  }

  if (organizationId !== undefined && organizationId !== null) {
    if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
      return next(new ValidationError('organizationId must be a non-empty string or null'));
    }
  }

  next();
};
