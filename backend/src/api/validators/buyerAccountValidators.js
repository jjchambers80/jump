// Buyer account validators (spec 040): what a signed-in buyer may change on
// their own Contact. Partial like `validateUpdateBusinessDetails`: only keys
// present in the body are checked, and anything outside the whitelist is
// refused — never email, note, tags or marketing through the profile PATCH.

import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeEmail } from '../../utils/normalizeEmail.js';

const PROFILE_FIELDS = new Set(['firstName', 'lastName', 'phone', 'location']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredName(body, key, label) {
  if (typeof body[key] !== 'string' || body[key].trim().length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  body[key] = body[key].trim();
  if (body[key].length > 100) throw new ValidationError(`${label} must be 100 characters or less`);
}

/** Empty string clears the field (null). */
function optionalText(body, key, label, max) {
  if (body[key] === null) return;
  if (typeof body[key] !== 'string') throw new ValidationError(`${label} must be text`);
  const value = body[key].trim();
  if (value.length > max) throw new ValidationError(`${label} must be ${max} characters or less`);
  body[key] = value || null;
}

/** PATCH /buyer/me */
export function validateUpdateBuyerProfile(req, res, next) {
  try {
    const body = req.body || {};
    const fields = Object.keys(body);
    const unknown = fields.find((field) => !PROFILE_FIELDS.has(field));
    if (unknown) throw new ValidationError(`Unknown field: ${unknown}`);
    if (fields.length === 0) throw new ValidationError('At least one field is required');
    if ('firstName' in body) requiredName(body, 'firstName', 'First name');
    if ('lastName' in body) requiredName(body, 'lastName', 'Last name');
    if ('phone' in body) {
      optionalText(body, 'phone', 'Phone', 50);
      if (body.phone && !/^[+\d][\d\s().-]{5,}$/.test(body.phone)) {
        throw new ValidationError('Enter a phone number with digits, spaces, dashes or a leading +');
      }
    }
    if ('location' in body) optionalText(body, 'location', 'City or region', 200);
    req.body = body;
    next();
  } catch (error) {
    next(error);
  }
}

/** POST /buyer/me/email */
export function validateEmailChange(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.newEmail);
    if (!email || !EMAIL_REGEX.test(email) || email.length > 254) {
      throw new ValidationError('Enter a valid email address');
    }
    req.body = { newEmail: email };
    next();
  } catch (error) {
    next(error);
  }
}

/** PATCH /buyer/me/preferences */
export function validatePreferences(req, res, next) {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).find((field) => field !== 'emailSubscribed');
    if (unknown) throw new ValidationError(`Unknown field: ${unknown}`);
    if (typeof body.emailSubscribed !== 'boolean') throw new ValidationError('emailSubscribed must be true or false');
    req.body = { emailSubscribed: body.emailSubscribed };
    next();
  } catch (error) {
    next(error);
  }
}
