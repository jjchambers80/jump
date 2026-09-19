import { ValidationError } from '../../middleware/errorHandler.js';

function shape(body, { partial }) {
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!['fromPath', 'toPath'].includes(key))
      errors.push({ field: key, message: `${key} is not an editable field` });
  }
  for (const key of ['fromPath', 'toPath']) {
    if (body[key] === undefined) {
      if (!partial) errors.push({ field: key, message: `${key} is required` });
    } else if (typeof body[key] !== 'string') {
      errors.push({ field: key, message: `${key} must be a string` });
    }
  }
  if (partial && Object.keys(body).length === 0)
    errors.push({ field: 'body', message: 'Nothing to update' });
  return errors;
}

export function validateCreateRedirect(req, res, next) {
  const errors = shape(req.body || {}, { partial: false });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateUpdateRedirect(req, res, next) {
  const errors = shape(req.body || {}, { partial: true });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateBulkRedirectIds(req, res, next) {
  const { ids } = req.body || {};
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== 'string' || !id)
  ) {
    return next(
      new ValidationError('Validation failed', [
        { field: 'ids', message: 'ids must be 1–200 redirect ids' },
      ])
    );
  }
  next();
}
