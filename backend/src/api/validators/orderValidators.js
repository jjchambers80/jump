// Order validators
// Request validation for order creation and lookup
// Per FR-052, contracts/api.yaml

import { ValidationError } from '../../middleware/errorHandler.js';

/**
 * Validate POST /orders body
 */
export const validateCreateOrder = (req, res, next) => {
  const errors = [];
  const { eventId, items, priceTierId, quantity, contact } = req.body;

  if (!eventId) {
    errors.push({ field: 'eventId', message: 'eventId is required' });
  }

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      errors.push({ field: 'items', message: 'items must contain at least one ticket type' });
    } else {
      const tierIds = new Set();
      items.forEach((item, index) => {
        if (!item?.priceTierId) {
          errors.push({
            field: `items[${index}].priceTierId`,
            message: 'priceTierId is required',
          });
        } else if (tierIds.has(item.priceTierId)) {
          errors.push({ field: 'items', message: 'price tiers must be unique' });
        } else {
          tierIds.add(item.priceTierId);
        }

        if (!Number.isInteger(item?.quantity) || item.quantity < 1) {
          errors.push({
            field: `items[${index}].quantity`,
            message: 'quantity must be an integer >= 1',
          });
        }
      });
    }
  } else {
    if (!priceTierId) {
      errors.push({ field: 'priceTierId', message: 'priceTierId is required' });
    }

    if (!quantity || parseInt(quantity) < 1) {
      errors.push({ field: 'quantity', message: 'quantity must be >= 1' });
    }
  }

  if (!contact) {
    errors.push({ field: 'contact', message: 'contact is required' });
  } else {
    if (!contact.email) {
      errors.push({ field: 'contact.email', message: 'contact.email is required' });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      errors.push({ field: 'contact.email', message: 'contact.email must be a valid email' });
    }

    if (!contact.firstName || !contact.firstName.trim()) {
      errors.push({ field: 'contact.firstName', message: 'contact.firstName is required' });
    }

    if (!contact.lastName || !contact.lastName.trim()) {
      errors.push({ field: 'contact.lastName', message: 'contact.lastName is required' });
    }
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

/**
 * Validate POST /orders/lookup body
 */
export const validateOrderLookup = (req, res, next) => {
  const errors = [];
  const { email, orderRef } = req.body;

  if (!email) {
    errors.push({ field: 'email', message: 'email is required' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: 'email', message: 'email must be a valid email' });
  }

  if (!orderRef) {
    errors.push({ field: 'orderRef', message: 'orderRef is required' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};
