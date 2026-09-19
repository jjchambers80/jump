import { ValidationError } from '../../middleware/errorHandler.js';
import {
  SEO_TITLE_MAX,
  SEO_DESCRIPTION_MAX,
  STOREFRONT_MESSAGE_MAX,
  STOREFRONT_PASSWORD_MIN,
  STOREFRONT_PASSWORD_MAX,
} from '../../utils/pageLimits.js';

const FIELDS = new Set([
  'storefrontPrivate',
  'password',
  'storefrontMessage',
  'seoTitle',
  'seoDescription',
  'autoRedirectLanguage',
]);

function checkOptionalText(errors, body, field, max) {
  const value = body[field];
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} must be a string` });
  } else if (value.trim().length > max) {
    errors.push({ field, message: `${field} must be ${max} characters or less` });
  }
}

/** PATCH /admin/online-store/preferences — partial; every present field must be valid. */
export function validateUpdateStorefrontPreferences(req, res, next) {
  const body = req.body || {};
  req.body = body;
  const errors = [];

  const unknown = Object.keys(body).find((field) => !FIELDS.has(field));
  if (unknown) errors.push({ field: unknown, message: `Unknown field: ${unknown}` });
  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'At least one field is required' });
  }

  for (const field of ['storefrontPrivate', 'autoRedirectLanguage']) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      errors.push({ field, message: `${field} must be a boolean` });
    }
  }

  if (body.password !== undefined && body.password !== null) {
    if (typeof body.password !== 'string') {
      errors.push({ field: 'password', message: 'password must be a string or null' });
    } else if (
      body.password.length < STOREFRONT_PASSWORD_MIN ||
      body.password.length > STOREFRONT_PASSWORD_MAX
    ) {
      errors.push({
        field: 'password',
        message: `password must be ${STOREFRONT_PASSWORD_MIN}-${STOREFRONT_PASSWORD_MAX} characters`,
      });
    }
  }

  checkOptionalText(errors, body, 'storefrontMessage', STOREFRONT_MESSAGE_MAX);
  checkOptionalText(errors, body, 'seoTitle', SEO_TITLE_MAX);
  checkOptionalText(errors, body, 'seoDescription', SEO_DESCRIPTION_MAX);

  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));
  next();
}

/** POST /organizations/:id/storefront-access */
export function validateStorefrontUnlock(req, res, next) {
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length === 0) {
    return next(new ValidationError('password is required'));
  }
  next();
}
