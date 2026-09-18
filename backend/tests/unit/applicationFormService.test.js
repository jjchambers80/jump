// Unit tests for ApplicationFormService pure helpers (spec 011): fee modes,
// slugs, acceptance windows.

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { default: service, tierAmounts, slugify, paymentsEnabled, applicationAmounts, applicationLines } = await import('../../src/services/ApplicationFormService.js');
const { default: feeService } = await import('../../src/services/FeeService.js');

describe('tierAmounts', () => {
  const event = { taxRate: 0.0725 };
  const org = { taxInclusivePricing: false };

  test('PASS: applicant pays fees on top; organization receives the listed price; booths untaxed by default', () => {
    const a = tierAmounts(275, { feeMode: 'PASS', taxable: false }, event, org);
    const fees = feeService.computeOrderFees([{ unitPrice: 275, quantity: 1 }], 0);
    expect(a).toMatchObject({ subtotal: 275, tax: 0, applicantPays: fees.total, orgReceives: 275, feeMode: 'PASS' });
    expect(a.applicantPays).toBeGreaterThan(275);
  });

  test('ABSORB: applicant pays the listed price; fees come out of the organization share', () => {
    const a = tierAmounts(275, { feeMode: 'ABSORB', taxable: false }, event, org);
    expect(a.applicantPays).toBe(275);
    expect(a.orgReceives).toBeCloseTo(275 - a.platformFee - a.processingFee, 2);
    expect(a.orgReceives).toBeLessThan(275);
  });

  test('taxable forms add the event tax; tax-inclusive orgs back it out', () => {
    const taxed = tierAmounts(100, { feeMode: 'PASS', taxable: true }, event, org);
    expect(taxed.tax).toBeCloseTo(7.25, 2);
    expect(taxed.applicantPays).toBeCloseTo(taxed.subtotal + taxed.platformFee + taxed.processingFee + taxed.tax, 2);
    const inclusive = tierAmounts(100, { feeMode: 'ABSORB', taxable: true }, event, { taxInclusivePricing: true });
    expect(inclusive.subtotal + inclusive.tax).toBeCloseTo(100, 2);
    expect(inclusive.applicantPays).toBeCloseTo(100, 2);
  });

  test('free tier', () => {
    const a = tierAmounts(0, { feeMode: 'PASS', taxable: false }, event, org);
    expect(a.orgReceives).toBe(0);
  });
});

describe('applicationLines with adjustments (spec 018 phase 3)', () => {
  const event = { taxRate: 0.1 };
  const org = { taxInclusivePricing: false };
  const form = { feeMode: 'PASS', taxable: true };
  const tier = { price: 275 };
  const power = { addOn: { id: 'power', price: 125, taxable: false }, quantity: 1 };

  test('a signed adjustment folds into the tier line; add-on lines move by at most the proportional-fee cent', () => {
    const base = applicationAmounts(applicationLines(tier, form, [power]), form, event, org);
    const discounted = applicationAmounts(applicationLines(tier, form, [power], -25), form, event, org);
    expect(applicationLines(tier, form, [power], -25)[0]).toEqual({ price: 250, quantity: 1, taxable: true });
    expect(applicationLines(tier, form, [power], -25)[1]).toMatchObject({ addOnId: 'power', price: 125, quantity: 1, taxable: false });
    expect(discounted.subtotal).toBeCloseTo(base.subtotal - 25, 2);
    expect(discounted.tax).toBeCloseTo(25, 2); // 10% of the adjusted taxable tier line only
    expect(discounted.applicantPays).toBeLessThan(base.applicantPays);
    // Fees are allocated proportionally across lines, so the add-on share can drift by a cent.
    expect(Math.abs(discounted.lines[1].applicantPays - base.lines[1].applicantPays)).toBeLessThanOrEqual(0.02);
  });

  test('an adjustment equal to the tier price zeroes the tier line but keeps the add-on line', () => {
    const lines = applicationLines(tier, form, [power], -275);
    expect(lines[0].price).toBe(0);
    const amounts = applicationAmounts(lines, form, event, org);
    expect(amounts.subtotal).toBeCloseTo(125, 2);
    expect(amounts.applicantPays).toBeGreaterThan(125);
  });

  test('cents are rounded once on the tier line', () => {
    expect(applicationLines({ price: 10.1 }, form, [], -0.055)[0].price).toBeCloseTo(10.05, 2);
  });
});

describe('slugify / acceptance / flag', () => {
  test('slugify', () => {
    expect(slugify('Press & Media!')).toBe('press-media');
    expect(slugify('  Vendor   Space 2027 ')).toBe('vendor-space-2027');
    expect(slugify('***')).toBe('');
  });

  test('acceptance follows status and window', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    expect(service.acceptance({ status: 'DRAFT' }, now)).toEqual({ open: false, reason: 'not_published' });
    expect(service.acceptance({ status: 'CLOSED' }, now)).toEqual({ open: false, reason: 'closed' });
    expect(service.acceptance({ status: 'OPEN', opensAt: new Date('2026-10-01') }, now)).toMatchObject({ open: false, reason: 'not_yet_open' });
    expect(service.acceptance({ status: 'OPEN', closesAt: new Date('2026-09-01') }, now)).toMatchObject({ open: false, reason: 'closed' });
    expect(service.acceptance({ status: 'OPEN', opensAt: new Date('2026-09-01'), closesAt: new Date('2026-10-01') }, now)).toEqual({ open: true, reason: null });
  });

  test('paymentsEnabled reads the flag each call', () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    expect(paymentsEnabled()).toBe(false);
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    expect(paymentsEnabled()).toBe(true);
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
  });
});
