// Unit tests for RefundService's Stripe call (spec 010 phase 2)
// Destination charges must reverse the organization's transfer and return the
// platform's application fee; platform-account charges must not send either.

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

beforeEach(() => {
  jest.clearAllMocks();
  mockRefundsCreate.mockResolvedValue({ id: 're_1' });
});

const KEY = { idempotencyKey: 'jump:refund:ticket:tkt_1' };

describe('_createStripeRefund', () => {
  test('platform-account charge: no Connect flags', async () => {
    await service._createStripeRefund('pi_1', 12.34, null, KEY);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_1',
        amount: 1234,
        metadata: { source: 'jump-platform' },
      },
      { idempotencyKey: 'jump:refund:ticket:tkt_1' }
    );
  });

  test('destination charge: reverse the transfer and refund the application fee', async () => {
    await service._createStripeRefund('pi_1', 12.34, 'changed plans', { connected: true, ...KEY });
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_1',
        amount: 1234,
        reason: 'requested_by_customer',
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { source: 'jump-platform' },
      },
      { idempotencyKey: 'jump:refund:ticket:tkt_1' }
    );
  });

  test('Stripe failures surface as a validation error', async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error('charge_already_refunded'));
    await expect(
      service._createStripeRefund('pi_1', 1, null, { connected: true, ...KEY })
    ).rejects.toThrow(/Stripe refund failed: charge_already_refunded/);
  });

  // The guard that makes the key impossible to forget: a new refund path that
  // omits it fails here rather than double-refunding a customer on its first
  // retry in production.
  test('refuses to call Stripe without an idempotency key', async () => {
    await expect(service._createStripeRefund('pi_1', 1, null)).rejects.toThrow(
      /requires an idempotencyKey/
    );
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

describe('refund idempotency key scopes', () => {
  // Each key must be derived from the operation, not from a row id a rolled
  // back transaction would discard. These are the four scopes in RefundService.
  test('are namespaced, stable and distinct per scope', async () => {
    const { refundIdempotencyKey } = await import('../../src/services/stripeRefund.js');
    expect(refundIdempotencyKey('order:ord_1:full')).toBe('jump:refund:order:ord_1:full');
    expect(refundIdempotencyKey('ticket:tkt_1')).toBe('jump:refund:ticket:tkt_1');
    expect(refundIdempotencyKey('order-add-on:line_1')).toBe('jump:refund:order-add-on:line_1');

    const keys = new Set(
      ['order:ord_1:full', 'ticket:tkt_1', 'order-add-on:line_1', 'application-order:ord_1:rf_1'].map(
        refundIdempotencyKey
      )
    );
    expect(keys.size).toBe(4);
    // Same operation, two calls — the whole point.
    expect(refundIdempotencyKey('ticket:tkt_1')).toBe(refundIdempotencyKey('ticket:tkt_1'));
    // Stripe caps keys at 255 characters.
    expect(refundIdempotencyKey('x'.repeat(400)).length).toBe(255);
  });
});
