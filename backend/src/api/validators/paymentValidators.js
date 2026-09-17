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

// PATCH /admin/settings/payments/connect/payouts (spec 010 phase 2) — shape only;
// ConnectService validates interval/anchor combinations and the descriptor.
const PAYOUT_FIELDS = new Set(['interval', 'anchor', 'statementDescriptor']);

export const validateUpdatePayoutSettings = (req, res, next) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  const unknown = keys.filter((f) => !PAYOUT_FIELDS.has(f));
  if (unknown.length > 0) return next(new ValidationError(`Unknown field(s): ${unknown.join(', ')}`));
  if (body.interval === undefined && body.statementDescriptor === undefined) {
    return next(new ValidationError('Provide interval or statementDescriptor'));
  }
  if (body.interval !== undefined && typeof body.interval !== 'string') {
    return next(new ValidationError('interval must be a string'));
  }
  if (body.anchor !== undefined && body.anchor !== null && !['string', 'number'].includes(typeof body.anchor)) {
    return next(new ValidationError('anchor must be a string or number'));
  }
  if (body.statementDescriptor !== undefined && typeof body.statementDescriptor !== 'string') {
    return next(new ValidationError('statementDescriptor must be a string'));
  }
  next();
};
