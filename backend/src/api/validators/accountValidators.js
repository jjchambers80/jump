// Validators for the signed-in user's own account (spec 030).
//
// PATCH /account is partial: only keys present in the body are validated and
// written, so each General card saves just its own fields. The subject is
// always req.user — a user id in the body is an unknown field, not a target.

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { ValidationError } from '../../middleware/errorHandler.js';
import { isSupportedLocale, isValidTimeZone, SUPPORTED_LOCALES } from '../../utils/locales.js';

const ACCOUNT_FIELDS = new Set(['firstName', 'lastName', 'phone', 'locale', 'timeZone']);
const NAME_MAX = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

const hasField = (body, field) => Object.prototype.hasOwnProperty.call(body, field);

function normalizeName(body, field, label) {
  const value = body[field];
  if (value === null || value === '') {
    body[field] = null;
    return;
  }
  if (typeof value !== 'string') throw new ValidationError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed) {
    body[field] = null;
    return;
  }
  if (trimmed.length > NAME_MAX) throw new ValidationError(`${label} must be ${NAME_MAX} characters or fewer`);
  body[field] = trimmed;
}

/** E.164 or null. Exported for the service's own use. */
export function normalizePhone(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('Phone number must be text');
  const parsed = parsePhoneNumberFromString(value.trim(), 'US');
  if (!parsed || !parsed.isValid()) throw new ValidationError('Enter a valid phone number');
  return parsed.number;
}

export function normalizeEmail(value, label = 'Email') {
  if (typeof value !== 'string') throw new ValidationError(`${label} is required`);
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${label} must be a valid email address`);
  }
  return email;
}

export const validateUpdateAccount = (req, res, next) => {
  try {
    const body = req.body || {};
    req.body = body;
    const fields = Object.keys(body);
    const unknownField = fields.find((field) => !ACCOUNT_FIELDS.has(field));
    if (unknownField) throw new ValidationError(`Unknown field: ${unknownField}`);
    if (fields.length === 0) throw new ValidationError('At least one field is required');

    if (hasField(body, 'firstName')) normalizeName(body, 'firstName', 'First name');
    if (hasField(body, 'lastName')) normalizeName(body, 'lastName', 'Last name');
    if (hasField(body, 'phone')) body.phone = normalizePhone(body.phone);

    if (hasField(body, 'locale')) {
      if (!isSupportedLocale(body.locale)) {
        throw new ValidationError(
          `Language must be one of: ${SUPPORTED_LOCALES.map((locale) => locale.code).join(', ')}`
        );
      }
    }

    if (hasField(body, 'timeZone')) {
      if (body.timeZone === null || body.timeZone === '') body.timeZone = null;
      else if (!isValidTimeZone(body.timeZone)) throw new ValidationError('Time zone must be a valid IANA identifier');
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const validateEmailChange = (req, res, next) => {
  try {
    req.body = req.body || {};
    req.body.email = normalizeEmail(req.body.email, 'New email');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateEmailConfirm = (req, res, next) => {
  const token = req.body?.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
    return next(new ValidationError('Confirmation token is invalid'));
  }
  next();
};
