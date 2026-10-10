// Event validators
// Request validation for event creation and update

import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeCustomSlug } from '../../utils/slug.js';

function normalizeSlug(req, next) {
  try {
    if (req.body.slug !== undefined) req.body.slug = normalizeCustomSlug(req.body.slug);
    return true;
  } catch (error) {
    next(error);
    return false;
  }
}

/**
 * Spec 050 §5.1: the wizard step keys an event may record as `setupStep`.
 * Mirrors `frontend/src/components/event-setup/steps.ts` (reserved keys excluded).
 */
export const EVENT_SETUP_STEPS = [
  'name', 'venue', 'date', 'description', 'image', 'tickets', 'collect-more', 'vendors',
  'floor-map', 'special-guests', 'volunteers', 'other-applications', 'review', 'done',
];

const isInstant = (value) => typeof value === 'string' && !isNaN(new Date(value).getTime());

/** `endDate`: ISO or null, after `date` when both are known (spec 050 §6.1). */
function validateEndDate(endDate, date, errors) {
  if (endDate === undefined || endDate === null) return;
  if (!isInstant(endDate)) return errors.push({ field: 'endDate', message: 'endDate must be an ISO date or null' });
  if (isInstant(date) && new Date(endDate) <= new Date(date))
    errors.push({ field: 'endDate', message: 'endDate must be after the start date' });
}

function validateCapacityValue(capacity, errors) {
  const cap = parseInt(capacity);
  if (isNaN(cap) || cap < 1 || cap > 100000)
    errors.push({ field: 'capacity', message: 'capacity must be between 1 and 100,000' });
}

function validateTiers(priceTiers, errors) {
  priceTiers.forEach((tier, i) => {
    if (!tier.name) errors.push({ field: `priceTiers[${i}].name`, message: 'Tier name is required' });
    if (tier.price === undefined || tier.price === null || Number(tier.price) < 0)
      errors.push({ field: `priceTiers[${i}].price`, message: 'Tier price must be >= 0' });
    if (!tier.quantityTotal || parseInt(tier.quantityTotal) < 1)
      errors.push({ field: `priceTiers[${i}].quantityTotal`, message: 'Tier quantityTotal must be >= 1' });
  });
}

function validateAdmission(body, errors) {
  const { admissionMode, rsvpLimit, rsvpMaxPartySize } = body;
  if (admissionMode !== undefined && !['TICKETED', 'RSVP'].includes(admissionMode))
    errors.push({ field: 'admissionMode', message: 'admissionMode must be TICKETED or RSVP' });
  if (rsvpLimit !== undefined && rsvpLimit !== null && (!Number.isInteger(rsvpLimit) || rsvpLimit < 1 || rsvpLimit > 100000))
    errors.push({ field: 'rsvpLimit', message: 'rsvpLimit must be null or an integer between 1 and 100,000' });
  if (rsvpMaxPartySize !== undefined && (!Number.isInteger(rsvpMaxPartySize) || rsvpMaxPartySize < 1 || rsvpMaxPartySize > 10))
    errors.push({ field: 'rsvpMaxPartySize', message: 'rsvpMaxPartySize must be an integer between 1 and 10' });
}

export const validateCreateEvent = (req, res, next) => {
  const errors = [];
  const { venueId, name, date, capacity, priceTiers, admissionMode = 'TICKETED' } = req.body;
  if (!venueId) errors.push({ field: 'venueId', message: 'venueId is required' });
  if (!name) errors.push({ field: 'name', message: 'name is required' });
  if (name && name.length > 255) errors.push({ field: 'name', message: 'name must be 255 characters or less' });
  if (!date) errors.push({ field: 'date', message: 'date is required' });
  validateAdmission(req.body, errors);

  if (req.body.setup === true) {
    // Wizard create (spec 050 §7.1): a DRAFT with name, venue and date; the rest comes later.
    if (capacity !== undefined && capacity !== null) validateCapacityValue(capacity, errors);
    if (priceTiers !== undefined && !Array.isArray(priceTiers))
      errors.push({ field: 'priceTiers', message: 'priceTiers must be an array' });
    else if (priceTiers) validateTiers(priceTiers, errors);
    validateEndDate(req.body.endDate, date, errors);
    const key = req.get('Idempotency-Key');
    if (key !== undefined && (!key.trim() || key.length > 255))
      errors.push({ field: 'Idempotency-Key', message: 'Idempotency-Key must be 1 to 255 characters' });
  } else if (admissionMode === 'TICKETED') {
    if (capacity === undefined || capacity === null) {
      errors.push({ field: 'capacity', message: 'capacity is required' });
    } else {
      validateCapacityValue(capacity, errors);
    }
    if (!priceTiers || !Array.isArray(priceTiers) || priceTiers.length === 0) {
      errors.push({ field: 'priceTiers', message: 'At least one price tier is required' });
    } else {
      validateTiers(priceTiers, errors);
    }
  }

  if (errors.length) return next(new ValidationError('Validation failed', errors));
  if (!normalizeSlug(req, next)) return;
  next();
};

export const validateUpdateEvent = (req, res, next) => {
  const errors = [];
  const { name, date, capacity, endDate, setupStep, setupCompleted } = req.body;
  if (name !== undefined && (!name || name.length > 255))
    errors.push({ field: 'name', message: 'name must be between 1 and 255 characters' });
  if (date !== undefined && isNaN(new Date(date).getTime()))
    errors.push({ field: 'date', message: 'Invalid date format' });
  // capacity: null clears it on a DRAFT (the service answers 409 otherwise).
  if (capacity !== undefined && capacity !== null) validateCapacityValue(capacity, errors);
  // Against the new date here; against the stored date in EventService.updateEvent.
  validateEndDate(endDate, date, errors);
  if (setupStep !== undefined && setupStep !== null && !EVENT_SETUP_STEPS.includes(setupStep))
    errors.push({ field: 'setupStep', message: `setupStep must be one of ${EVENT_SETUP_STEPS.join(', ')}` });
  if (setupCompleted !== undefined && setupCompleted !== true)
    errors.push({ field: 'setupCompleted', message: 'setupCompleted can only be true' });
  validateAdmission(req.body, errors);
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  if (!normalizeSlug(req, next)) return;
  next();
};
