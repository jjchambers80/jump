import { ValidationError } from '../../middleware/errorHandler.js';

const FIELDS = new Set(['buyerSignInLinks']);

/** PATCH /admin/settings/customer-accounts — partial; every present field must be valid. */
export function validateUpdateCustomerAccountSettings(req, res, next) {
  const body = req.body || {};
  req.body = body;
  const errors = [];

  const unknown = Object.keys(body).find((field) => !FIELDS.has(field));
  if (unknown) errors.push({ field: unknown, message: `Unknown field: ${unknown}` });
  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'At least one field is required' });
  }

  if (body.buyerSignInLinks !== undefined && typeof body.buyerSignInLinks !== 'boolean') {
    errors.push({ field: 'buyerSignInLinks', message: 'buyerSignInLinks must be a boolean' });
  }

  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));
  next();
}
