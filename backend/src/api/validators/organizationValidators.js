// Organization validators
// Input validation for organization endpoints per FR-048

import { ValidationError } from '../../middleware/errorHandler.js';

/**
 * Validate organization creation payload
 */
export const validateCreateOrganization = (req, res, next) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new ValidationError('Organization name is required'));
  }

  if (name.trim().length > 255) {
    return next(new ValidationError('Organization name must be 255 characters or less'));
  }

  // Normalize
  req.body.name = name.trim();

  next();
};

/**
 * Validate organization update payload
 */
export const validateUpdateOrganization = (req, res, next) => {
  const { name, status } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return next(new ValidationError('Organization name must be a non-empty string'));
    }
    if (name.trim().length > 255) {
      return next(new ValidationError('Organization name must be 255 characters or less'));
    }
    req.body.name = name.trim();
  }

  if (status !== undefined) {
    const validStatuses = ['ACTIVE', 'INACTIVE'];
    if (!validStatuses.includes(status)) {
      return next(new ValidationError(`Status must be one of: ${validStatuses.join(', ')}`));
    }
  }

  next();
};
