// Unit tests for EventReadinessService.evaluate (spec 050 §7.2): every
// blocker and warning code, RSVP skipping the tier checks.

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
const { evaluate, stepForForm } = await import('../../src/services/EventReadinessService.js');

const now = new Date('2027-01-01T00:00:00.000Z');
const tier = (extra = {}) => ({ isActive: true, price: 10, quantityTotal: 50, ...extra });
const form = (extra = {}) => ({ id: 'f1', name: 'Vendors', kind: 'FREE', status: 'DRAFT', spaceSelection: 'TIERS', _count: { questions: 2 }, ...extra });
const ready = (extra = {}) => ({
  name: 'Show',
  venue: { id: 'v1' },
  date: '2027-02-01T18:00:00.000Z',
  endDate: null,
  admissionMode: 'TICKETED',
  capacity: 100,
  priceTiers: [tier()],
  description: '<p>Fun</p>',
  logoUrl: '/images/x',
  applicationForms: [],
  floorMap: null,
  ...extra,
});
const codes = (list) => list.map((i) => i.code);
const run = (event, ctx = {}) => evaluate(event, { now, ...ctx });

describe('EventReadinessService.evaluate', () => {
  it('a complete ticketed event is ready with nothing to warn about', () => {
    expect(run(ready())).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  it.each([
    ['NAME_MISSING', 'name', { name: '  ' }],
    ['VENUE_MISSING', 'venue', { venue: null }],
    ['DATE_IN_PAST', 'date', { date: '2026-12-31T18:00:00.000Z' }],
    ['END_BEFORE_START', 'date', { endDate: '2027-02-01T17:00:00.000Z' }],
    ['CAPACITY_MISSING', 'tickets', { capacity: null }],
    ['NO_ACTIVE_TIER', 'tickets', { priceTiers: [tier({ isActive: false })] }],
    ['NO_ACTIVE_TIER', 'tickets', { priceTiers: [] }],
    ['TIERS_EXCEED_CAPACITY', 'tickets', { capacity: 60, priceTiers: [tier(), tier({ isActive: false, quantityTotal: 20 })] }],
  ])('blocks with %s (step %s)', (code, step, patch) => {
    const result = run(ready(patch));
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([expect.objectContaining({ code, step, message: expect.any(String) })]);
  });

  it('blocks paid tickets when the organization cannot take payments, not free ones', () => {
    expect(codes(run(ready(), { paymentsUnavailable: true }).blockers)).toEqual(['PAYMENTS_UNAVAILABLE']);
    expect(run(ready({ priceTiers: [tier({ price: 0 })] }), { paymentsUnavailable: true }).ready).toBe(true);
  });

  it('RSVP events skip the tier, capacity and payments checks', () => {
    const result = run(ready({ admissionMode: 'RSVP', capacity: null, priceTiers: [] }), { paymentsUnavailable: true });
    expect(result).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  it.each([
    ['NO_DESCRIPTION', 'description', { description: '<p> &nbsp;</p>' }],
    ['NO_IMAGE', 'image', { logoUrl: null, imageId: null }],
  ])('warns with %s (step %s) without blocking', (code, step, patch) => {
    const result = run(ready(patch));
    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code, step })]);
  });

  it('warns per PAID form while the payments gate is off, never blocking', () => {
    const forms = [form({ id: 'p1', kind: 'PAID' }), form({ id: 'p2', kind: 'PAID' }), form({ id: 'free' })];
    const off = run(ready({ applicationForms: forms }));
    expect(off.ready).toBe(true);
    expect(off.warnings.filter((w) => w.code === 'PAID_FORMS_DISABLED').map((w) => [w.formId, w.step])).toEqual([
      ['p1', 'vendors'],
      ['p2', 'vendors'],
    ]);
    expect(codes(run(ready({ applicationForms: forms }), { paymentsEnabled: true }).warnings)).toEqual([]);
  });

  it('warns for a form without questions, ignoring closed forms', () => {
    const result = run(ready({ applicationForms: [form({ _count: { questions: 0 } }), form({ id: 'c', status: 'CLOSED', _count: { questions: 0 } })] }));
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'FORM_HAS_NO_QUESTIONS', formId: 'f1' })]);
  });

  it('warns when a MAP form has no published floor map', () => {
    const mapForm = form({ kind: 'PAID', spaceSelection: 'MAP' });
    const ctx = { paymentsEnabled: true };
    expect(codes(run(ready({ applicationForms: [mapForm] }), ctx).warnings)).toEqual(['MAP_FORM_WITHOUT_PUBLISHED_MAP']);
    expect(codes(run(ready({ applicationForms: [mapForm], floorMap: { status: 'DRAFT' } }), ctx).warnings)).toEqual(['MAP_FORM_WITHOUT_PUBLISHED_MAP']);
    expect(run(ready({ applicationForms: [mapForm], floorMap: { status: 'PUBLISHED' } }), ctx).warnings).toEqual([]);
  });

  it('warns when the tax rate could not be resolved', () => {
    const result = run(ready(), { taxError: 'No Stripe Tax registration for North Carolina' });
    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'TAX_RATE_UNRESOLVED', step: 'review' })]);
  });

  it('places forms in their wizard step by purpose', () => {
    expect(stepForForm({})).toBe('vendors');
    expect(stepForForm({ purpose: 'SPECIAL_GUEST' })).toBe('special-guests');
    expect(stepForForm({ purpose: 'VOLUNTEER' })).toBe('volunteers');
    expect(stepForForm({ purpose: 'SPONSOR' })).toBe('other-applications');
  });
});
