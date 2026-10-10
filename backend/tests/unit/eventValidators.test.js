// Unit tests for event validators — spec 050-A draft fields

import { describe, it, expect, jest } from '@jest/globals';
import {
  validateCreateEvent,
  validateUpdateEvent,
  EVENT_SETUP_STEPS,
} from '../../src/api/validators/eventValidators.js';

function validate(validator, body, headers = {}) {
  const req = { body, get: (name) => headers[name] };
  const next = jest.fn();
  validator(req, {}, next);
  const error = next.mock.calls[0]?.[0];
  return error instanceof Error ? error.details?.fields ?? error.details ?? error : null;
}

const fields = (result) => (result ? JSON.stringify(result) : '');
const date = '2027-09-01T18:00:00.000Z';

describe('validateCreateEvent', () => {
  const setup = { setup: true, name: 'E', venueId: 'v', date };

  it('setup: true needs only name, venueId and date', () => {
    expect(validate(validateCreateEvent, setup)).toBeNull();
  });

  it('setup: true still requires name, venueId and date', () => {
    const out = fields(validate(validateCreateEvent, { setup: true }));
    expect(out).toMatch(/venueId/);
    expect(out).toMatch(/name/);
    expect(out).toMatch(/date/);
  });

  it('setup: true validates optional capacity, tiers and endDate when present', () => {
    expect(fields(validate(validateCreateEvent, { ...setup, capacity: 0 }))).toMatch(/capacity/);
    expect(fields(validate(validateCreateEvent, { ...setup, priceTiers: [{ price: 1, quantityTotal: 1 }] }))).toMatch(/name/);
    expect(fields(validate(validateCreateEvent, { ...setup, endDate: date }))).toMatch(/endDate/);
    expect(fields(validate(validateCreateEvent, { ...setup, endDate: 'nope' }))).toMatch(/endDate/);
    expect(validate(validateCreateEvent, { ...setup, endDate: '2027-09-01T20:00:00.000Z' })).toBeNull();
  });

  it('refuses an empty or oversized Idempotency-Key', () => {
    expect(fields(validate(validateCreateEvent, setup, { 'Idempotency-Key': ' ' }))).toMatch(/Idempotency-Key/);
    expect(fields(validate(validateCreateEvent, setup, { 'Idempotency-Key': 'x'.repeat(256) }))).toMatch(/Idempotency-Key/);
    expect(validate(validateCreateEvent, setup, { 'Idempotency-Key': 'abc' })).toBeNull();
  });

  it('without setup: true still requires capacity and tiers for TICKETED', () => {
    const out = fields(validate(validateCreateEvent, { name: 'E', venueId: 'v', date }));
    expect(out).toMatch(/capacity/);
    expect(out).toMatch(/priceTiers/);
  });
});

describe('validateUpdateEvent', () => {
  it('accepts endDate as ISO or null, after date', () => {
    expect(validate(validateUpdateEvent, { endDate: null })).toBeNull();
    expect(validate(validateUpdateEvent, { endDate: '2027-09-01T20:00:00.000Z' })).toBeNull();
    expect(fields(validate(validateUpdateEvent, { date, endDate: date }))).toMatch(/endDate/);
    expect(fields(validate(validateUpdateEvent, { endDate: 12 }))).toMatch(/endDate/);
  });

  it('accepts only registry step keys', () => {
    for (const step of EVENT_SETUP_STEPS) expect(validate(validateUpdateEvent, { setupStep: step })).toBeNull();
    expect(fields(validate(validateUpdateEvent, { setupStep: 'attendee-questions' }))).toMatch(/setupStep/);
  });

  it('setupCompleted can only be true', () => {
    expect(validate(validateUpdateEvent, { setupCompleted: true })).toBeNull();
    expect(fields(validate(validateUpdateEvent, { setupCompleted: false }))).toMatch(/setupCompleted/);
  });

  it('capacity: null passes to the service; numbers stay in range', () => {
    expect(validate(validateUpdateEvent, { capacity: null })).toBeNull();
    expect(fields(validate(validateUpdateEvent, { capacity: 0 }))).toMatch(/capacity/);
  });
});
