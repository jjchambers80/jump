// Venue validators
// Input validation for venue endpoints per FR-049

import { ValidationError } from '../../middleware/errorHandler.js';

// Common IANA timezone patterns (basic validation)
const IANA_TZ_REGEX = /^[A-Za-z]+\/[A-Za-z_]+$/;
const VENUE_FIELDS = new Set(['name', 'address', 'city', 'state', 'postalCode', 'timezone', 'isPublic']);

function rejectUnknownFields(body, next) {
  const unknownFields = Object.keys(body).filter((field) => !VENUE_FIELDS.has(field));
  if (unknownFields.length > 0) {
    next(new ValidationError(`Unknown venue field(s): ${unknownFields.join(', ')}`));
    return true;
  }
  return false;
}

/**
 * Validate venue creation payload
 */
export const validateCreateVenue = (req, res, next) => {
  if (rejectUnknownFields(req.body, next)) return;
  const { name, address, timezone, isPublic } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new ValidationError('Venue name is required'));
  }

  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    return next(new ValidationError('Venue address is required'));
  }

  if (name.trim().length > 255) {
    return next(new ValidationError('Venue name must be 255 characters or less'));
  }

  if (address.trim().length > 500) {
    return next(new ValidationError('Address must be 500 characters or less'));
  }

  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || !IANA_TZ_REGEX.test(timezone)) {
      return next(
        new ValidationError('Timezone must be a valid IANA timezone (e.g., America/New_York)')
      );
    }
  }

  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    return next(new ValidationError('isPublic must be a boolean'));
  }

  // Normalize
  req.body.name = name.trim();
  req.body.address = address.trim();

  next();
};

/**
 * Validate venue update payload
 */
export const validateUpdateVenue = (req, res, next) => {
  if (rejectUnknownFields(req.body, next)) return;
  const { name, address, timezone, isPublic } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return next(new ValidationError('Venue name must be a non-empty string'));
    }
    if (name.trim().length > 255) {
      return next(new ValidationError('Venue name must be 255 characters or less'));
    }
    req.body.name = name.trim();
  }

  if (address !== undefined) {
    if (typeof address !== 'string' || address.trim().length === 0) {
      return next(new ValidationError('Address must be a non-empty string'));
    }
    if (address.trim().length > 500) {
      return next(new ValidationError('Address must be 500 characters or less'));
    }
    req.body.address = address.trim();
  }

  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || !IANA_TZ_REGEX.test(timezone)) {
      return next(new ValidationError('Timezone must be a valid IANA timezone'));
    }
  }

  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    return next(new ValidationError('isPublic must be a boolean'));
  }

  next();
};
