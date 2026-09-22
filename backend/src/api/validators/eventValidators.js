// Event validators
// Request validation for event creation and update

import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeCustomSlug } from '../../utils/slug.js';

function normalizeSlug(req, next) {
  try {
    if (req.body.slug !== undefined) req.body.slug = normalizeCustomSlug(req.body.slug);
    return true;
  } catch (error) {
    next(error);
    return false;
  }
}

function validateAdmission(body, errors) {
  const { admissionMode, rsvpLimit, rsvpMaxPartySize } = body;
  if (admissionMode !== undefined && !['TICKETED', 'RSVP'].includes(admissionMode))
    errors.push({ field: 'admissionMode', message: 'admissionMode must be TICKETED or RSVP' });
  if (rsvpLimit !== undefined && rsvpLimit !== null && (!Number.isInteger(rsvpLimit) || rsvpLimit < 1 || rsvpLimit > 100000))
    errors.push({ field: 'rsvpLimit', message: 'rsvpLimit must be null or an integer between 1 and 100,000' });
  if (rsvpMaxPartySize !== undefined && (!Number.isInteger(rsvpMaxPartySize) || rsvpMaxPartySize < 1 || rsvpMaxPartySize > 10))
    errors.push({ field: 'rsvpMaxPartySize', message: 'rsvpMaxPartySize must be an integer between 1 and 10' });
}

export const validateCreateEvent = (req, res, next) => {
  const errors = [];
  const { venueId, name, date, capacity, priceTiers, admissionMode = 'TICKETED' } = req.body;
  if (!venueId) errors.push({ field: 'venueId', message: 'venueId is required' });
  if (!name) errors.push({ field: 'name', message: 'name is required' });
  if (name && name.length > 255) errors.push({ field: 'name', message: 'name must be 255 characters or less' });
  if (!date) errors.push({ field: 'date', message: 'date is required' });
  validateAdmission(req.body, errors);

  if (admissionMode === 'TICKETED') {
    if (capacity === undefined || capacity === null) {
      errors.push({ field: 'capacity', message: 'capacity is required' });
    } else {
      const cap = parseInt(capacity);
      if (isNaN(cap) || cap < 1 || cap > 100000)
        errors.push({ field: 'capacity', message: 'capacity must be between 1 and 100,000' });
    }
    if (!priceTiers || !Array.isArray(priceTiers) || priceTiers.length === 0) {
      errors.push({ field: 'priceTiers', message: 'At least one price tier is required' });
    } else {
      priceTiers.forEach((tier, i) => {
        if (!tier.name) errors.push({ field: `priceTiers[${i}].name`, message: 'Tier name is required' });
        if (tier.price === undefined || tier.price === null || Number(tier.price) < 0)
          errors.push({ field: `priceTiers[${i}].price`, message: 'Tier price must be >= 0' });
        if (!tier.quantityTotal || parseInt(tier.quantityTotal) < 1)
          errors.push({ field: `priceTiers[${i}].quantityTotal`, message: 'Tier quantityTotal must be >= 1' });
      });
    }
  }

  if (errors.length) return next(new ValidationError('Validation failed', errors));
  if (!normalizeSlug(req, next)) return;
  next();
};

export const validateUpdateEvent = (req, res, next) => {
  const errors = [];
  const { name, date, capacity } = req.body;
  if (name !== undefined && (!name || name.length > 255))
    errors.push({ field: 'name', message: 'name must be between 1 and 255 characters' });
  if (date !== undefined && isNaN(new Date(date).getTime()))
    errors.push({ field: 'date', message: 'Invalid date format' });
  if (capacity !== undefined) {
    const cap = parseInt(capacity);
    if (isNaN(cap) || cap < 1 || cap > 100000)
      errors.push({ field: 'capacity', message: 'capacity must be between 1 and 100,000' });
  }
  validateAdmission(req.body, errors);
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  if (!normalizeSlug(req, next)) return;
  next();
};
