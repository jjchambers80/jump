// Shared tier form helpers (spec 050 §8.1) and the wizard's steps 4–6
// payloads (050-J): one mapping for the event editor and the wizard.

import { describe, expect, test } from 'vitest';
import {
  capacityOverflow, duplicateTierForm, tierCreateBody, tierErrors, tierPatchBody, tierToForm, type ApiTier,
} from '@/components/events/tierForm';
import { DESCRIBE_STEP, TICKETS_STEP, salesFieldsFromSaved } from '@/components/event-setup/contentSteps';
import { stepByKey, type SavedEvent, type StepCtx } from '@/components/event-setup/steps';

const ZONE = 'America/New_York';
const tier = (patch: Partial<ApiTier> = {}): ApiTier => ({
  id: 't1', name: 'GA', description: null, price: 25, quantityTotal: 100, quantitySold: 0, quantityReserved: 0,
  displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true,
  saleStartDate: '2031-05-01T14:00:00.000Z', saleEndDate: null, visibility: 'PUBLIC', isRefundable: false, ...patch,
});

describe('tierForm', () => {
  test('sale windows round-trip through the venue zone', () => {
    const form = tierToForm(tier(), ZONE);
    expect(form.saleStartDate).toBe('2031-05-01T10:00'); // 14:00Z = 10:00 EDT
    expect(tierCreateBody(form, ZONE).saleStartDate).toBe('2031-05-01T14:00:00.000Z');
    expect(tierPatchBody(form, tier(), ZONE)).toEqual({});
  });

  test('the patch body carries only what changed', () => {
    const form = { ...tierToForm(tier(), ZONE), price: '30', saleEndDate: '2031-05-31T23:00', maxPerOrder: '' };
    expect(tierPatchBody(form, tier(), ZONE)).toEqual({ price: 30, saleEndDate: '2031-06-01T03:00:00.000Z', maxPerOrder: null });
  });

  test('a duplicate is a new, unsold copy', () => {
    const copy = duplicateTierForm(tierToForm(tier({ quantitySold: 7, quantityReserved: 2 }), ZONE));
    expect(copy).toMatchObject({ isNew: true, name: 'GA (copy)', quantitySold: 0, quantityReserved: 0, price: '25' });
    expect(copy.key).not.toBe('t1');
  });

  test('tierErrors: name, price, quantity floor and sale window order', () => {
    const form = tierToForm(tier({ quantitySold: 5 }), ZONE);
    expect(tierErrors(form, ZONE)).toEqual([]);
    expect(tierErrors({ ...form, name: ' ', price: '', quantityTotal: '3', saleEndDate: '2031-04-01T00:00' }, ZONE)).toEqual([
      'Enter a tier name', 'Enter a price of 0 or more', 'Quantity must be at least 5 (sold + reserved)', 'Sale end must be after the sale start',
    ]);
  });

  test('capacityOverflow warns only when a set capacity is exceeded', () => {
    expect(capacityOverflow('100', [{ quantityTotal: '60' }, { quantityTotal: 50 }])).toEqual({ capacity: 100, total: 110 });
    expect(capacityOverflow('', [{ quantityTotal: '60' }])).toBeNull();
    expect(capacityOverflow(200, [{ quantityTotal: '60' }])).toBeNull();
  });
});

const row = (patch: Partial<SavedEvent> = {}): SavedEvent => ({
  id: 'e1', name: 'Fair', slug: 'fair', venueId: 'v1', date: '2031-06-01T20:00:00.000Z', endDate: null, status: 'DRAFT',
  admissionMode: 'TICKETED', setupStep: null, setupCompletedAt: null, description: null, capacity: null, category: null,
  rsvpLimit: null, rsvpMaxPartySize: 1, ...patch,
});
const ctxFor = (saved: SavedEvent, fields: Partial<StepCtx['fields']> = {}): StepCtx => ({
  saved, zone: ZONE, savedZone: ZONE,
  fields: { name: saved.name, slug: saved.slug, venueId: saved.venueId, date: '', endDate: '', ...salesFieldsFromSaved(saved), ...fields },
});

describe('steps 4–6 payloads', () => {
  test('nothing to save right after load', () => {
    for (const saved of [row(), row({ admissionMode: 'RSVP', capacity: 0, rsvpLimit: 40, rsvpMaxPartySize: 2 }), row({ capacity: 200, description: '<p>Hi</p>' })]) {
      expect(DESCRIBE_STEP.payload!(ctxFor(saved))).toBeNull();
      expect(TICKETS_STEP.payload!(ctxFor(saved))).toBeNull();
    }
  });

  test('description, and category on the Name step', () => {
    expect(DESCRIBE_STEP.payload!(ctxFor(row(), { description: '<p>Bring a chair</p>' }))).toEqual({ description: '<p>Bring a chair</p>' });
    expect(stepByKey('name')!.payload!(ctxFor(row(), { category: ' Music ' }))).toEqual({ category: 'Music' });
    expect(DESCRIBE_STEP.payload!(ctxFor(row({ description: '<p>x</p>' }), { description: '' }))).toEqual({ description: null });
  });

  test('ticketed capacity, including clearing it on a draft', () => {
    expect(TICKETS_STEP.payload!(ctxFor(row(), { capacity: '150' }))).toEqual({ capacity: 150 });
    expect(TICKETS_STEP.payload!(ctxFor(row({ capacity: 150 }), { capacity: '' }))).toEqual({ capacity: null });
    expect(TICKETS_STEP.validate!(ctxFor(row(), { capacity: '0' }))).toHaveLength(1);
    // A live event cannot drop its capacity (409 CAPACITY_REQUIRED).
    expect(TICKETS_STEP.validate!(ctxFor(row({ status: 'PUBLISHED', capacity: 150 }), { capacity: '' }))).toHaveLength(1);
  });

  test('switching to RSVP sends the mode and RSVP settings, never a ticket capacity', () => {
    const ctx = ctxFor(row({ capacity: 150 }), { admissionMode: 'RSVP', rsvpLimitEnabled: true, rsvpLimit: '80', rsvpMaxPartySize: '4' });
    expect(TICKETS_STEP.payload!(ctx)).toEqual({ admissionMode: 'RSVP', rsvpLimit: 80, rsvpMaxPartySize: 4 });
    expect(TICKETS_STEP.validate!(ctxFor(row(), { admissionMode: 'RSVP', rsvpLimitEnabled: true, rsvpLimit: '' }))).toHaveLength(1);
  });

  test('RSVP back to ticketed with a blank capacity sends only the mode', () => {
    const ctx = ctxFor(row({ admissionMode: 'RSVP', capacity: 0 }), { admissionMode: 'TICKETED' });
    expect(TICKETS_STEP.payload!(ctx)).toEqual({ admissionMode: 'TICKETED' });
  });

  test('tickets is complete for RSVP, or with capacity and a tier (gotcha 29)', () => {
    expect(TICKETS_STEP.complete(ctxFor(row({ admissionMode: 'RSVP' })))).toBe(true);
    expect(TICKETS_STEP.complete(ctxFor(row({ capacity: 10 })))).toBe(false);
    expect(TICKETS_STEP.complete(ctxFor(row({ capacity: 10, tierCount: 1 })))).toBe(true);
  });
});
