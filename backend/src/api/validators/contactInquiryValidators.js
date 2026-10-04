// Spec 042: storefront contact-form submission body.

import { ValidationError } from '../../middleware/errorHandler.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = {
  name: { max: 100, required: true },
  email: { max: 254, required: true },
  phone: { max: 40 },
  subject: { max: 150 },
  message: { max: 5000, required: true },
};

/**
 * Normalizes `req.body` to trimmed strings (optional fields → null). A filled
 * honeypot (`website`, hidden from people) marks the request as a bot:
 * `req.contactHoneypot` lets the route answer 202 without sending.
 */
export function validateContactInquiry(req, res, next) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.website === 'string' && body.website.trim()) {
    req.contactHoneypot = true;
    return next();
  }
  const errors = [];
  const clean = {};
  for (const [field, rule] of Object.entries(FIELDS)) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push({ field, message: `${field} must be text` });
      continue;
    }
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (rule.required && !trimmed) errors.push({ field, message: `${field} is required` });
    else if (trimmed.length > rule.max) errors.push({ field, message: `${field} must be ${rule.max} characters or less` });
    clean[field] = trimmed || null;
  }
  if (clean.email && !EMAIL_RE.test(clean.email)) {
    errors.push({ field: 'email', message: 'Enter a valid email address' });
  }
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  clean.email = clean.email.toLowerCase();
  req.body = clean;
  next();
}
