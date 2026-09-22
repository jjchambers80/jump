// Request validation for public RSVP creation and cancellation.

import { ValidationError } from '../../middleware/errorHandler.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateRsvp(req, res, next) {
  const errors = [];
  const { firstName, lastName, email, partySize, marketing, acceptances } = req.body || {};
  if (typeof firstName !== 'string' || !firstName.trim() || firstName.trim().length > 100)
    errors.push({ field: 'firstName', message: 'firstName is required and must be 100 characters or less' });
  if (typeof lastName !== 'string' || !lastName.trim() || lastName.trim().length > 100)
    errors.push({ field: 'lastName', message: 'lastName is required and must be 100 characters or less' });
  if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.trim().length > 320)
    errors.push({ field: 'email', message: 'email must be a valid email' });
  if (partySize !== undefined && (!Number.isInteger(partySize) || partySize < 1))
    errors.push({ field: 'partySize', message: 'partySize must be an integer >= 1' });
  if (marketing !== undefined && typeof marketing !== 'boolean')
    errors.push({ field: 'marketing', message: 'marketing must be a boolean' });
  if (acceptances !== undefined && !Array.isArray(acceptances))
    errors.push({ field: 'acceptances', message: 'acceptances must be an array' });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  req.body.firstName = firstName.trim();
  req.body.lastName = lastName.trim();
  req.body.email = email.trim().toLowerCase();
  req.body.partySize = partySize ?? 1;
  req.body.marketing = marketing === true;
  next();
}

export function validateCancelRsvp(req, res, next) {
  if (typeof req.body?.token !== 'string' || !req.body.token)
    return next(new ValidationError('token is required'));
  next();
}
