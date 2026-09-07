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

  if (!quantityTotal || parseInt(quantityTotal) < 1) {
    errors.push({ field: 'quantityTotal', message: 'quantityTotal must be >= 1' });
  }

  if (req.body.minPerOrder !== undefined && parseInt(req.body.minPerOrder) < 1) {
    errors.push({ field: 'minPerOrder', message: 'minPerOrder must be >= 1' });
  }

  if (req.body.maxPerOrder !== undefined && parseInt(req.body.maxPerOrder) < 1) {
    errors.push({ field: 'maxPerOrder', message: 'maxPerOrder must be >= 1' });
  }

  validateSaleWindowFields(req.body, errors);
  validateVisibilityField(req.body, errors);

  if (req.body.isRefundable !== undefined && typeof req.body.isRefundable !== 'boolean') {
    errors.push({ field: 'isRefundable', message: 'isRefundable must be a boolean' });
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

  if (quantityTotal !== undefined && parseInt(quantityTotal) < 1) {
    errors.push({ field: 'quantityTotal', message: 'quantityTotal must be >= 1' });
  }

  validateSaleWindowFields(req.body, errors);
  validateVisibilityField(req.body, errors);

  if (req.body.isRefundable !== undefined && typeof req.body.isRefundable !== 'boolean') {
    errors.push({ field: 'isRefundable', message: 'isRefundable must be a boolean' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

// ─── Shared validation helpers ───

const VALID_VISIBILITIES = ['PUBLIC', 'PRIVATE', 'HIDDEN'];

function validateSaleWindowFields(body, errors) {
  if (body.saleStartDate !== undefined && body.saleStartDate !== null) {
    const d = new Date(body.saleStartDate);
    if (isNaN(d.getTime())) {
      errors.push({ field: 'saleStartDate', message: 'saleStartDate must be a valid ISO date' });
    }
  }

  if (body.saleEndDate !== undefined && body.saleEndDate !== null) {
    const d = new Date(body.saleEndDate);
    if (isNaN(d.getTime())) {
      errors.push({ field: 'saleEndDate', message: 'saleEndDate must be a valid ISO date' });
    }
  }

  if (body.saleStartDate && body.saleEndDate) {
    const start = new Date(body.saleStartDate);
    const end = new Date(body.saleEndDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
      errors.push({ field: 'saleEndDate', message: 'saleEndDate must be after saleStartDate' });
    }
  }
}

function validateVisibilityField(body, errors) {
  if (body.visibility !== undefined && !VALID_VISIBILITIES.includes(body.visibility)) {
    errors.push({
      field: 'visibility',
      message: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
    });
  }
}
