import { ValidationError } from '../../middleware/errorHandler.js';
import { FILE_ALT_MAX, FILE_NAME_MAX } from '../../utils/fileLimits.js';

const UPDATE_KEYS = new Set(['name', 'altText', 'focalX', 'focalY']);

/** PATCH /admin/files/:fileId — only keys present are validated (whitelist). */
export function validateUpdateStoreFile(req, res, next) {
  const errors = [];
  const body = req.body || {};
  for (const key of Object.keys(body)) {
    if (!UPDATE_KEYS.has(key))
      errors.push({ field: key, message: `${key} is not an editable field` });
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push({ field: 'name', message: 'name is required' });
    } else if (body.name.trim().length > FILE_NAME_MAX) {
      errors.push({ field: 'name', message: `name must be ${FILE_NAME_MAX} characters or less` });
    } else if (/[\\/]/.test(body.name)) {
      errors.push({ field: 'name', message: 'name cannot contain slashes' });
    }
  }
  if (body.altText !== undefined && body.altText !== null) {
    if (typeof body.altText !== 'string') {
      errors.push({ field: 'altText', message: 'altText must be a string' });
    } else if (body.altText.trim().length > FILE_ALT_MAX) {
      errors.push({
        field: 'altText',
        message: `altText must be ${FILE_ALT_MAX} characters or less`,
      });
    }
  }
  for (const key of ['focalX', 'focalY']) {
    if (body[key] !== undefined) {
      if (
        typeof body[key] !== 'number' ||
        Number.isNaN(body[key]) ||
        body[key] < 0 ||
        body[key] > 1
      ) {
        errors.push({ field: key, message: `${key} must be a number between 0 and 1` });
      }
    }
  }
  if (Object.keys(body).length === 0) errors.push({ field: 'body', message: 'Nothing to update' });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateFromUrl(req, res, next) {
  const { url } = req.body || {};
  if (typeof url !== 'string' || url.trim().length === 0 || url.trim().length > 2048) {
    return next(
      new ValidationError('Validation failed', [{ field: 'url', message: 'url is required' }])
    );
  }
  req.body.url = url.trim();
  next();
}

export function validateBulkIds(req, res, next) {
  const { ids } = req.body || {};
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== 'string' || !id)
  ) {
    return next(
      new ValidationError('Validation failed', [
        { field: 'ids', message: 'ids must be 1–200 file ids' },
      ])
    );
  }
  next();
}
