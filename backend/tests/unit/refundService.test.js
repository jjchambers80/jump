// Unit tests for RefundService's Stripe call (spec 010 phase 2)
// Destination charges must reverse the organization's transfer and return the
// platform's application fee; platform-account charges must not send either.
// Every call also carries an idempotency key so a retry after a lost response
// resolves to the first refund instead of issuing a second one (EVE-30).

import { jest } from '@jest/globals';

const mockRefundsCreate = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: { refunds: { create: mockRefundsCreate } },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../../src/services/RefundService.js');
const { createStripeRefund, refundIdempotencyKey } = await import('../../src/services/stripeRefund.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockRefundsCreate.mockResolvedValue({ id: 're_1' });
});

const params = () => mockRefundsCreate.mock.calls.at(-1)[0];
const options = () => mockRefundsCreate.mock.calls.at(-1)[1];

describe('_createStripeRefund', () => {
  test('platform-account charge: no Connect flags', async () => {
    await service._createStripeRefund('pi_1', 12.34, null, { idempotencyKey: 'refund:order:o1:1234:after:0' });
    expect(params()).toEqual({
      payment_intent: 'pi_1',
      amount: 1234,
      metadata: { source: 'jump-platform' },
    });
    expect(options()).toEqual({ idempotencyKey: 'refund:order:o1:1234:after:0' });
  });

  test('destination charge: reverse the transfer and refund the application fee', async () => {
    await service._createStripeRefund('pi_1', 12.34, 'changed plans', { connected: true, idempotencyKey: 'refund:ticket:t1:1234:after:0' });
    expect(params()).toEqual({
      payment_intent: 'pi_1',
      amount: 1234,
      reason: 'requested_by_customer',
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { source: 'jump-platform' },
    });
    expect(options()).toEqual({ idempotencyKey: 'refund:ticket:t1:1234:after:0' });
  });

  test('Stripe failures surface as a validation error', async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error('charge_already_refunded'));
    await expect(service._createStripeRefund('pi_1', 1, null, { connected: true })).rejects.toThrow(/Stripe refund failed: charge_already_refunded/);
  });
});

describe('refundIdempotencyKey', () => {
  test('a retry of the same refund reuses the key; a genuine second one does not', () => {
    // The failed attempt left no SUCCEEDED row, so already-refunded is
    // unchanged and the retry collapses onto the first Stripe refund.
    expect(refundIdempotencyKey('order:o1', 250, 0)).toBe(refundIdempotencyKey('order:o1', 250, 0));
    // A deliberate second $250 refund sits on a moved already-refunded total.
    expect(refundIdempotencyKey('order:o1', 250, 250)).not.toBe(refundIdempotencyKey('order:o1', 250, 0));
    // Different orders never share a key.
    expect(refundIdempotencyKey('order:o2', 250, 0)).not.toBe(refundIdempotencyKey('order:o1', 250, 0));
  });

  test('amounts become integer cents, so no float ever reaches the key', () => {
    expect(refundIdempotencyKey('ticket:t1', 12.34)).toBe('refund:ticket:t1:1234:after:0');
    // 0.1 + 0.2 territory: the key must not drift with binary float error.
    expect(refundIdempotencyKey('ticket:t1', 1.005)).toBe('refund:ticket:t1:101:after:0');
  });

  // Regression (EVE-37): the key and the Stripe call must round dollars to
  // cents identically. When the key said 101 and the call sent
  // Math.round(1.005 * 100) = 100, one key stood for two different Stripe
  // amounts, and Stripe answered the second, legitimate refund with a 400
  // for the next 24 hours.
  test('the cents in the key are the cents sent to Stripe', async () => {
    for (const amount of [1.005, 12.34, 0.1 + 0.2, 275, 8.885]) {
      mockRefundsCreate.mockClear();
      await createStripeRefund({ paymentIntentId: 'pi_1', amount });
      expect(refundIdempotencyKey('order:o1', amount)).toBe(
        `refund:order:o1:${params().amount}:after:0`
      );
    }
  });
});

describe('createStripeRefund failure classification', () => {
  test('a Stripe rejection is definitive; the refund did not happen', async () => {
    const rejected = new Error('No such payment_intent');
    rejected.type = 'StripeInvalidRequestError';
    mockRefundsCreate.mockRejectedValueOnce(rejected);
    await expect(createStripeRefund({ paymentIntentId: 'pi_1', amount: 1 })).rejects.toMatchObject({
      outcomeUnknown: false,
    });
  });

  test('a lost connection leaves the outcome unknown; Stripe may hold the refund', async () => {
    const lost = new Error('Request aborted due to timeout');
    lost.type = 'StripeConnectionError';
    mockRefundsCreate.mockRejectedValueOnce(lost);
    await expect(createStripeRefund({ paymentIntentId: 'pi_1', amount: 1 })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });
});
