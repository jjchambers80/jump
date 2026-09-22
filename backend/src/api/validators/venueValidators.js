// Venue validators
// Input validation for venue endpoints per FR-049

import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeStateCode } from '../../utils/usStates.js';
import { normalizeCustomSlug } from '../../utils/slug.js';
import { isValidTimeZone } from '../../utils/locales.js';

// Zones are checked against the runtime's own IANA database (Intl), so the
// multi-segment ids the venue form's dropdown offers — America/Argentina/
// Buenos_Aires, Etc/GMT+5, UTC — are accepted, not just Region/City.
const VENUE_FIELDS = new Set(['name', 'slug', 'address', 'city', 'state', 'postalCode', 'timezone', 'isPublic']);

/**
 * Venue.state keys the organization's tax regions (spec 009), so it must be a
 * two-letter US state code. Full names are accepted and normalised; blank
 * clears the field. Returns an error message or null and writes the code back.
 */
function normalizeState(body) {
  if (body.state === undefined) return null;
  if (body.state === null || (typeof body.state === 'string' && body.state.trim() === '')) {
    body.state = null;
    return null;
  }
  const code = normalizeStateCode(body.state);
  if (!code) return 'State must be a two-letter US state code (e.g., NC)';
  body.state = code;
  return null;
}

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
    if (!isValidTimeZone(timezone)) {
      return next(
        new ValidationError('Timezone must be a valid IANA timezone (e.g., America/New_York)')
      );
    }
  }

  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    return next(new ValidationError('isPublic must be a boolean'));
  }

  const stateError = normalizeState(req.body);
  if (stateError) return next(new ValidationError(stateError));

  // Normalize
  req.body.name = name.trim();
  req.body.address = address.trim();
  try {
    if (req.body.slug !== undefined) req.body.slug = normalizeCustomSlug(req.body.slug);
  } catch (error) {
    return next(error);
  }

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
    if (!isValidTimeZone(timezone)) {
      return next(new ValidationError('Timezone must be a valid IANA timezone'));
    }
  }

  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    return next(new ValidationError('isPublic must be a boolean'));
  }

  const stateError = normalizeState(req.body);
  if (stateError) return next(new ValidationError(stateError));

  try {
    if (req.body.slug !== undefined) req.body.slug = normalizeCustomSlug(req.body.slug);
  } catch (error) {
    return next(error);
  }

  next();
};
