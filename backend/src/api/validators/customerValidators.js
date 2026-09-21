// Customer Detail Validators (spec 032 phase 1)
// PATCH /admin/customers/:id — partial update; every present field must be valid.

import { ValidationError } from '../../middleware/errorHandler.js';

const ALLOWED_FIELDS = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'location',
  'note',
  'emailSubscribed',
  'tags',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PATCH /admin/customers/:id — partial update validator.
 * Whitelists known fields, validates types, enforces ADMIN-only email changes
 * in the route layer, and bounds string lengths.
 */
export function validateUpdateCustomer(req, res, next) {
  const body = req.body || {};
  const errors = [];

  const unknown = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field));
  if (unknown) errors.push({ field: unknown, message: `Unknown field: ${unknown}` });
  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'At least one field is required' });
  }

  // firstName: optional string, ≤ 255 chars
  if (body.firstName !== undefined) {
    if (typeof body.firstName !== 'string' || body.firstName.trim().length === 0) {
      errors.push({ field: 'firstName', message: 'firstName cannot be empty' });
    } else if (body.firstName.length > 255) {
      errors.push({ field: 'firstName', message: 'firstName must be 255 characters or less' });
    }
  }

  // lastName: optional string, ≤ 255 chars
  if (body.lastName !== undefined) {
    if (typeof body.lastName !== 'string' || body.lastName.trim().length === 0) {
      errors.push({ field: 'lastName', message: 'lastName cannot be empty' });
    } else if (body.lastName.length > 255) {
      errors.push({ field: 'lastName', message: 'lastName must be 255 characters or less' });
    }
  }

  // email: optional string, valid format; ADMIN-only enforcement is in the route
  if (body.email !== undefined) {
    if (typeof body.email !== 'string' || body.email.trim().length === 0) {
      errors.push({ field: 'email', message: 'Email cannot be empty' });
    } else if (!EMAIL_REGEX.test(body.email.trim())) {
      errors.push({ field: 'email', message: 'Email must be a valid email address' });
    }
  }

  // phone: optional string, stored as free text (E.164-normalised by upstream caller)
  if (body.phone !== undefined && body.phone !== null) {
    if (typeof body.phone !== 'string' || body.phone.trim().length === 0) {
      errors.push({ field: 'phone', message: 'phone cannot be empty' });
    } else if (body.phone.length > 50) {
      errors.push({ field: 'phone', message: 'phone must be 50 characters or less' });
    }
  }

  // location: optional string
  if (body.location !== undefined && body.location !== null) {
    if (typeof body.location !== 'string') {
      errors.push({ field: 'location', message: 'location must be a string' });
    } else if (body.location.length > 500) {
      errors.push({ field: 'location', message: 'location must be 500 characters or less' });
    }
  }

  // note: optional string
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') {
      errors.push({ field: 'note', message: 'note must be a string' });
    } else if (body.note.length > 5000) {
      errors.push({ field: 'note', message: 'note must be 5000 characters or less' });
    }
  }

  // emailSubscribed: optional boolean
  if (body.emailSubscribed !== undefined && typeof body.emailSubscribed !== 'boolean') {
    errors.push({ field: 'emailSubscribed', message: 'emailSubscribed must be a boolean' });
  }

  // tags: optional array of strings, each ≤ 50 chars, max 20 tags
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      errors.push({ field: 'tags', message: 'tags must be an array' });
    } else if (body.tags.length > 20) {
      errors.push({ field: 'tags', message: 'tags must have at most 20 entries' });
    } else {
      for (let i = 0; i < body.tags.length; i++) {
        if (typeof body.tags[i] !== 'string' || body.tags[i].trim().length === 0) {
          errors.push({ field: `tags[${i}]`, message: 'Each tag must be a non-empty string' });
        } else if (body.tags[i].length > 50) {
          errors.push({ field: `tags[${i}]`, message: 'Each tag must be 50 characters or less' });
        }
      }
    }
  }

  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));

  // Normalise strings before they reach the service
  if (body.firstName !== undefined) body.firstName = body.firstName.trim();
  if (body.lastName !== undefined) body.lastName = body.lastName.trim();
  if (body.email !== undefined) body.email = body.email.trim().toLowerCase();
  if (body.phone !== undefined && body.phone !== null) body.phone = body.phone.trim();
  if (body.tags !== undefined) body.tags = body.tags.map((t) => t.trim());

  next();
}