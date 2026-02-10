// Price Tier validators
// Request validation for price tier creation and update
// Per FR-014, FR-016, contracts/api.yaml

import { ValidationError } from '../../middleware/errorHandler.js';

/**
 * Validate POST /organizations/:orgId/events/:eventId/price-tiers body
 */
export const validateCreatePriceTier = (req, res, next) => {
  const errors = [];
  const { name, price, quantityTotal } = req.body;

  if (!name) errors.push({ field: 'name', message: 'name is required' });
  if (name && name.length > 255) {
    errors.push({ field: 'name', message: 'name must be 255 characters or less' });
  }

  if (price === undefined || price === null) {
    errors.push({ field: 'price', message: 'price is required' });
  } else if (Number(price) < 0) {
    errors.push({ field: 'price', message: 'price must be >= 0' });
  }

  if (!quantityTotal || parseInt(quantityTotal) < 1) {
    errors.push({ field: 'quantityTotal', message: 'quantityTotal must be >= 1' });
  }

  if (req.body.minPerOrder !== undefined && parseInt(req.body.minPerOrder) < 1) {
    errors.push({ field: 'minPerOrder', message: 'minPerOrder must be >= 1' });
  }

  if (req.body.maxPerOrder !== undefined && parseInt(req.body.maxPerOrder) < 1) {
    errors.push({ field: 'maxPerOrder', message: 'maxPerOrder must be >= 1' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

/**
 * Validate PATCH body for price tier update
 */
export const validateUpdatePriceTier = (req, res, next) => {
  const errors = [];
  const { name, price, quantityTotal } = req.body;

  if (name !== undefined && (!name || name.length > 255)) {
    errors.push({ field: 'name', message: 'name must be between 1 and 255 characters' });
  }

  if (price !== undefined && Number(price) < 0) {
    errors.push({ field: 'price', message: 'price must be >= 0' });
  }

  if (quantityTotal !== undefined && parseInt(quantityTotal) < 1) {
    errors.push({ field: 'quantityTotal', message: 'quantityTotal must be >= 1' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};
