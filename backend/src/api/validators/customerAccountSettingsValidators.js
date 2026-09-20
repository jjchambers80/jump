import { ValidationError } from '../../middleware/errorHandler.js';

const FIELDS = new Set([
  'buyerSignInLinks',
  'selfServeRefundsEnabled',
  'selfServeRefundCutoffHours',
  'selfServeRefundFeeType',
  'selfServeRefundFeeValue',
]);
const FEE_TYPES = new Set(['NONE', 'FIXED', 'PERCENT']);
// One year: a cutoff further out than that means "never", which is what the toggle is for.
const CUTOFF_MAX_HOURS = 8760;

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

  for (const field of ['buyerSignInLinks', 'selfServeRefundsEnabled']) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      errors.push({ field, message: `${field} must be a boolean` });
    }
  }

  const cutoff = body.selfServeRefundCutoffHours;
  if (cutoff !== undefined && cutoff !== null) {
    if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > CUTOFF_MAX_HOURS) {
      errors.push({ field: 'selfServeRefundCutoffHours', message: `selfServeRefundCutoffHours must be a whole number of hours from 0 to ${CUTOFF_MAX_HOURS}, or null` });
    }
  }

  if (body.selfServeRefundFeeType !== undefined && !FEE_TYPES.has(body.selfServeRefundFeeType)) {
    errors.push({ field: 'selfServeRefundFeeType', message: 'selfServeRefundFeeType must be NONE, FIXED or PERCENT' });
  }

  const fee = body.selfServeRefundFeeValue;
  if (fee !== undefined && fee !== null) {
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || Math.abs(Math.round(fee * 100) - fee * 100) > 1e-6) {
      errors.push({ field: 'selfServeRefundFeeValue', message: 'selfServeRefundFeeValue must be a non-negative amount with at most two decimals, or null' });
    } else if (body.selfServeRefundFeeType === 'PERCENT' && fee > 100) {
      errors.push({ field: 'selfServeRefundFeeValue', message: 'A percentage fee cannot exceed 100' });
    }
  }

  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));
  next();
}
