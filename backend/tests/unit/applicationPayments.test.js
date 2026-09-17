// Unit tests for the application payment pieces that need no database
// (spec 011 phase 2): derived status tokens, the application-fee identity
// between the amount snapshot and spec 010's applicationFeeCents, and
// webhook dispatch on metadata.applicationId.

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: { application: { findUnique: jest.fn() } } }));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({ default: {} }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
process.env.AUTH_SECRET = 'unit-secret-that-is-long-enough-to-sign-things';

const { statusToken, verifyStatusToken, hashToken } = await import('../../src/services/applicationLinks.js');
const { tierAmounts } = await import('../../src/services/ApplicationFormService.js');
const { applicationFeeCents } = await import('../../src/services/PaymentSettingsService.js');
const { default: service, cents } = await import('../../src/services/ApplicationPaymentService.js');

describe('status token', () => {
  it('is deterministic per application and verifies in constant time', () => {
    const a = statusToken('app_1');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(statusToken('app_1')).toBe(a);
    expect(statusToken('app_2')).not.toBe(a);
    expect(verifyStatusToken('app_1', a)).toBe(true);
    expect(verifyStatusToken('app_2', a)).toBe(false);
    expect(verifyStatusToken('app_1', a.slice(0, 63))).toBe(false);
    expect(verifyStatusToken('app_1', '')).toBe(false);
    expect(hashToken(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes with the secret', () => {
    const before = statusToken('app_1');
    process.env.AUTH_SECRET = 'another-secret-that-is-long-enough-to-sign';
    expect(statusToken('app_1')).not.toBe(before);
    process.env.AUTH_SECRET = 'unit-secret-that-is-long-enough-to-sign-things';
  });
});

describe('application fee identity', () => {
  const event = { taxRate: 0.0725 };
  const org = { taxInclusivePricing: false };

  /** The charge shape ApplicationPaymentService hands to checkoutOptionsFor. */
  const chargeFor = (amounts) => ({
    fees: { subtotal: amounts.orgReceives },
    lineItems: [{ price_data: { unit_amount: cents(amounts.applicantPays) }, quantity: 1 }],
  });

  it.each([
    ['PASS, untaxed', { feeMode: 'PASS', taxable: false }, 275],
    ['PASS, taxed', { feeMode: 'PASS', taxable: true }, 275],
    ['ABSORB, untaxed', { feeMode: 'ABSORB', taxable: false }, 1000],
    ['ABSORB, taxed', { feeMode: 'ABSORB', taxable: true }, 1000],
    ['odd cents', { feeMode: 'PASS', taxable: true }, 33.33],
  ])('%s: fee cents = applicantPays − orgReceives, never null', (_label, form, price) => {
    const amounts = tierAmounts(price, form, event, org);
    const fee = applicationFeeCents(chargeFor(amounts));
    expect(fee).toBe(cents(amounts.applicantPays) - cents(amounts.orgReceives));
    expect(fee).toBeGreaterThanOrEqual(0);
  });

  it('tax-inclusive ABSORB keeps the listed price as the applicant total', () => {
    const amounts = tierAmounts(100, { feeMode: 'ABSORB', taxable: true }, event, { taxInclusivePricing: true });
    expect(amounts.applicantPays).toBe(100);
    expect(applicationFeeCents(chargeFor(amounts))).toBe(10000 - cents(amounts.orgReceives));
  });
});

describe('webhook dispatch', () => {
  const ev = (type, metadata) => ({ type, data: { object: { id: 'x', metadata } } });

  it('claims checkout / setup / payment-intent events carrying applicationId only', () => {
    expect(service.isApplicationEvent(ev('checkout.session.completed', { applicationId: 'a' }))).toBe(true);
    expect(service.isApplicationEvent(ev('setup_intent.succeeded', { applicationId: 'a' }))).toBe(true);
    expect(service.isApplicationEvent(ev('payment_intent.payment_failed', { applicationId: 'a' }))).toBe(true);
    expect(service.isApplicationEvent(ev('checkout.session.completed', { orderId: 'o' }))).toBe(false);
    expect(service.isApplicationEvent(ev('checkout.session.completed', undefined))).toBe(false);
    expect(service.isApplicationEvent(ev('charge.refunded', { applicationId: 'a' }))).toBe(false);
    expect(service.isApplicationEvent(ev('account.updated', { applicationId: 'a' }))).toBe(false);
  });

  it('cents rounds half-up on dollar snapshots', () => {
    expect(cents(275)).toBe(27500);
    expect(cents('1.005')).toBe(101);
    expect(cents(0.1 + 0.2)).toBe(30);
  });
});
