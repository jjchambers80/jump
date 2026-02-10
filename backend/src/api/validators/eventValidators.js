// Event validators
// Request validation for event creation and update
// Per FR-012, contracts/api.yaml

import { ValidationError } from '../../middleware/errorHandler.js';

/**
 * Validate POST /organizations/:orgId/events body
 */
export const validateCreateEvent = (req, res, next) => {
  const errors = [];
  const { venueId, name, date, capacity, priceTiers } = req.body;

  if (!venueId) errors.push({ field: 'venueId', message: 'venueId is required' });
  if (!name) errors.push({ field: 'name', message: 'name is required' });
  if (name && name.length > 255)
    errors.push({ field: 'name', message: 'name must be 255 characters or less' });
  if (!date) errors.push({ field: 'date', message: 'date is required' });
  if (capacity === undefined || capacity === null) {
    errors.push({ field: 'capacity', message: 'capacity is required' });
  } else {
    const cap = parseInt(capacity);
    if (isNaN(cap) || cap < 1 || cap > 100000) {
      errors.push({ field: 'capacity', message: 'capacity must be between 1 and 100,000' });
    }
  }

  if (!priceTiers || !Array.isArray(priceTiers) || priceTiers.length === 0) {
    errors.push({ field: 'priceTiers', message: 'At least one price tier is required' });
  } else {
    priceTiers.forEach((tier, i) => {
      if (!tier.name)
        errors.push({ field: `priceTiers[${i}].name`, message: 'Tier name is required' });
      if (tier.price === undefined || tier.price === null || Number(tier.price) < 0) {
        errors.push({ field: `priceTiers[${i}].price`, message: 'Tier price must be >= 0' });
      }
      if (!tier.quantityTotal || parseInt(tier.quantityTotal) < 1) {
        errors.push({
          field: `priceTiers[${i}].quantityTotal`,
          message: 'Tier quantityTotal must be >= 1',
        });
      }
    });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

/**
 * Validate PATCH /organizations/:orgId/events/:eventId body
 */
export const validateUpdateEvent = (req, res, next) => {
  const errors = [];
  const { name, date, capacity } = req.body;

  if (name !== undefined && (!name || name.length > 255)) {
    errors.push({ field: 'name', message: 'name must be between 1 and 255 characters' });
  }

  if (date !== undefined) {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      errors.push({ field: 'date', message: 'Invalid date format' });
    }
  }

  if (capacity !== undefined) {
    const cap = parseInt(capacity);
    if (isNaN(cap) || cap < 1 || cap > 100000) {
      errors.push({ field: 'capacity', message: 'capacity must be between 1 and 100,000' });
    }
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};
