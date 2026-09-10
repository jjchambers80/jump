// Tier Preset validators
// Request validation for tier preset creation and update

import { ValidationError } from '../../middleware/errorHandler.js';

const VALID_VISIBILITIES = ['PUBLIC', 'PRIVATE', 'HIDDEN'];

/**
 * Validate POST /organizations/:orgId/tier-presets body
 */
export const validateCreateTierPreset = (req, res, next) => {
  const errors = [];
  const { name, price } = req.body;

  if (!name) errors.push({ field: 'name', message: 'name is required' });
  if (name && name.length > 255) {
    errors.push({ field: 'name', message: 'name must be 255 characters or less' });
  }

  if (req.body.description !== undefined && req.body.description !== null) {
    if (typeof req.body.description !== 'string') {
      errors.push({ field: 'description', message: 'description must be a string' });
    } else if (req.body.description.length > 500) {
      errors.push({ field: 'description', message: 'description must be 500 characters or less' });
    }
  }

  if (price === undefined || price === null) {
    errors.push({ field: 'price', message: 'price is required' });
  } else if (Number(price) < 0) {
    errors.push({ field: 'price', message: 'price must be >= 0' });
  }

  if (req.body.minPerOrder !== undefined && parseInt(req.body.minPerOrder) < 1) {
    errors.push({ field: 'minPerOrder', message: 'minPerOrder must be >= 1' });
  }

  if (req.body.maxPerOrder !== undefined && parseInt(req.body.maxPerOrder) < 1) {
    errors.push({ field: 'maxPerOrder', message: 'maxPerOrder must be >= 1' });
  }

  if (req.body.visibility !== undefined && !VALID_VISIBILITIES.includes(req.body.visibility)) {
    errors.push({
      field: 'visibility',
      message: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
    });
  }

  if (req.body.isRefundable !== undefined && typeof req.body.isRefundable !== 'boolean') {
    errors.push({ field: 'isRefundable', message: 'isRefundable must be a boolean' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

/**
 * Validate PATCH body for tier preset update
 */
export const validateUpdateTierPreset = (req, res, next) => {
  const errors = [];
  const { name, price } = req.body;

  if (name !== undefined && (!name || name.length > 255)) {
    errors.push({ field: 'name', message: 'name must be between 1 and 255 characters' });
  }

  if (req.body.description !== undefined && req.body.description !== null) {
    if (typeof req.body.description !== 'string') {
      errors.push({ field: 'description', message: 'description must be a string' });
    } else if (req.body.description.length > 500) {
      errors.push({ field: 'description', message: 'description must be 500 characters or less' });
    }
  }

  if (price !== undefined && Number(price) < 0) {
    errors.push({ field: 'price', message: 'price must be >= 0' });
  }

  if (req.body.minPerOrder !== undefined && parseInt(req.body.minPerOrder) < 1) {
    errors.push({ field: 'minPerOrder', message: 'minPerOrder must be >= 1' });
  }

  if (req.body.maxPerOrder !== undefined && parseInt(req.body.maxPerOrder) < 1) {
    errors.push({ field: 'maxPerOrder', message: 'maxPerOrder must be >= 1' });
  }

  if (req.body.visibility !== undefined && !VALID_VISIBILITIES.includes(req.body.visibility)) {
    errors.push({
      field: 'visibility',
      message: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
    });
  }

  if (req.body.isRefundable !== undefined && typeof req.body.isRefundable !== 'boolean') {
    errors.push({ field: 'isRefundable', message: 'isRefundable must be a boolean' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};
