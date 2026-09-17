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

describe('_createStripeRefund', () => {
  test('platform-account charge: no Connect flags', async () => {
    await service._createStripeRefund('pi_1', 12.34, null);
    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_1',
      amount: 1234,
      metadata: { source: 'jump-platform' },
    });
  });

  test('destination charge: reverse the transfer and refund the application fee', async () => {
    await service._createStripeRefund('pi_1', 12.34, 'changed plans', { connected: true });
    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_1',
      amount: 1234,
      reason: 'requested_by_customer',
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { source: 'jump-platform' },
    });
  });

  test('Stripe failures surface as a validation error', async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error('charge_already_refunded'));
    await expect(service._createStripeRefund('pi_1', 1, null, { connected: true })).rejects.toThrow(/Stripe refund failed: charge_already_refunded/);
  });
});
