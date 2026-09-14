// Payment settings validators (spec 010)
// PATCH /admin/settings/payments — shape only; the service validates values
// against the live platform prefix and capabilities.

import { ValidationError } from '../../middleware/errorHandler.js';

const FIELDS = new Set(['statementDescriptorSuffix', 'enabledPaymentMethods']);

export const validateUpdatePaymentSettings = (req, res, next) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  const unknown = keys.filter((f) => !FIELDS.has(f));
  if (unknown.length > 0) return next(new ValidationError(`Unknown field(s): ${unknown.join(', ')}`));
  if (keys.length === 0) return next(new ValidationError('Provide statementDescriptorSuffix or enabledPaymentMethods'));

  const { statementDescriptorSuffix, enabledPaymentMethods } = body;
  if (statementDescriptorSuffix !== undefined && statementDescriptorSuffix !== null && typeof statementDescriptorSuffix !== 'string') {
    return next(new ValidationError('statementDescriptorSuffix must be a string or null'));
  }
  if (enabledPaymentMethods !== undefined && !Array.isArray(enabledPaymentMethods)) {
    return next(new ValidationError('enabledPaymentMethods must be an array'));
  }
  next();
};
