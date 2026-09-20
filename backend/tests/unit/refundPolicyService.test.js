// Unit tests for the self-serve refund policy (spec 031 phase 2).

import { evaluateRefundPolicy, refundDeadline, refundFee } from '../../src/services/RefundPolicyService.js';

const HOUR = 3600 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const eventDate = new Date(NOW.getTime() + 48 * HOUR);

const open = { selfServeRefundsEnabled: true, selfServeRefundCutoffHours: null, selfServeRefundFeeType: 'NONE', selfServeRefundFeeValue: null };
const ticket = (overrides = {}) => ({ status: 'VALID', pricePaid: 20, priceTier: { isRefundable: true }, event: { date: eventDate }, ...overrides });

describe('refundFee', () => {
  it('is zero for NONE, a capped flat amount for FIXED, a rounded share for PERCENT', () => {
    expect(refundFee(open, 20)).toBe(0);
    expect(refundFee({ ...open, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 2.5 }, 20)).toBe(2.5);
    expect(refundFee({ ...open, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 30 }, 20)).toBe(20);
    expect(refundFee({ ...open, selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 12.5 }, 19.99)).toBe(2.5);
    expect(refundFee({ ...open, selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 100 }, 19.99)).toBe(19.99);
    expect(refundFee({ ...open, selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 10 }, 0)).toBe(0);
  });
});

describe('refundDeadline', () => {
  it('is the event start with no cutoff and moves back by the cutoff hours', () => {
    expect(refundDeadline(open, eventDate)).toEqual(eventDate);
    expect(refundDeadline({ ...open, selfServeRefundCutoffHours: 24 }, eventDate)).toEqual(new Date(eventDate.getTime() - 24 * HOUR));
    expect(refundDeadline({ ...open, selfServeRefundCutoffHours: 0 }, eventDate)).toEqual(eventDate);
    expect(refundDeadline(open, 'not a date')).toBeNull();
  });
});

describe('evaluateRefundPolicy', () => {
  it('passes a valid refundable ticket before the deadline with the full amount', () => {
    expect(evaluateRefundPolicy(open, ticket(), NOW)).toEqual({ eligible: true, reason: null, deadline: eventDate, fee: 0, refundAmount: 20 });
  });

  it('checks the gates in order: policy, tier, status, window, amount', () => {
    expect(evaluateRefundPolicy({ ...open, selfServeRefundsEnabled: false }, ticket(), NOW).reason).toBe('DISABLED');
    expect(evaluateRefundPolicy(open, ticket({ priceTier: { isRefundable: false } }), NOW).reason).toBe('TIER');
    expect(evaluateRefundPolicy(open, ticket({ status: 'VOIDED' }), NOW).reason).toBe('STATUS');
    expect(evaluateRefundPolicy(open, ticket({ status: 'REDEEMED' }), NOW).reason).toBe('STATUS');
    expect(evaluateRefundPolicy({ ...open, selfServeRefundCutoffHours: 72 }, ticket(), NOW).reason).toBe('WINDOW_CLOSED');
    expect(evaluateRefundPolicy({ ...open, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 20 }, ticket(), NOW).reason).toBe('ZERO');
  });

  it('closes exactly at the deadline, not one millisecond before', () => {
    const policy = { ...open, selfServeRefundCutoffHours: 48 };
    expect(evaluateRefundPolicy(policy, ticket(), new Date(NOW.getTime() - 1)).eligible).toBe(true);
    expect(evaluateRefundPolicy(policy, ticket(), NOW).reason).toBe('WINDOW_CLOSED');
  });

  it('reports the fee and net amount for a percent policy', () => {
    const result = evaluateRefundPolicy({ ...open, selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 10 }, ticket({ pricePaid: 19.99 }), NOW);
    expect(result).toMatchObject({ eligible: true, fee: 2, refundAmount: 17.99 });
  });

  it('still reports deadline and fee when ineligible so the account page can explain', () => {
    const result = evaluateRefundPolicy({ ...open, selfServeRefundCutoffHours: 72, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 1 }, ticket(), NOW);
    expect(result).toEqual({ eligible: false, reason: 'WINDOW_CLOSED', deadline: new Date(eventDate.getTime() - 72 * HOUR), fee: 1, refundAmount: 19 });
  });
});
