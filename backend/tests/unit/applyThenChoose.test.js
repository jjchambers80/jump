// Unit tests for spec 037 phase 5 (vendor apply-then-choose): the pure pieces
// — the approval payment clock, the live-order rule the money view uses, and
// the in-flight migration planner (`npm run db:backfill:037-applications`).

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));

const { selectionDueAt, holdsSelection } = await import('../../src/services/applicationSelection.js');
const { hasLiveOrder } = await import('../../src/services/applicationOrderStatus.js');
const { moneyOf } = await import('../../src/services/applicationMoney.js');
const { planApplicationMove } = await import('../../src/scripts/backfill-037-applications.js');

const DAY = 86_400_000;

describe('selectionDueAt (the payment clock starts at approval)', () => {
  const decidedAt = new Date('2026-10-01T12:00:00Z');

  test('choosing: approval + paymentDueDays', () => {
    const due = selectionDueAt({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', decidedAt, form: { paymentDueDays: 5 } });
    expect(due.toISOString()).toBe(new Date(decidedAt.getTime() + 5 * DAY).toISOString());
  });

  test('holding or paying: the order carries the same clock', () => {
    const orderDue = new Date('2026-10-06T12:00:00Z');
    for (const paymentStatus of ['PAYMENT_DUE', 'PROCESSING']) {
      expect(selectionDueAt({ status: 'APPROVED', paymentStatus, decidedAt, form: { paymentDueDays: 5 }, order: { dueAt: orderDue } })).toEqual(orderDue);
    }
  });

  test('no clock under review, once paid, or on a FREE approval without an order', () => {
    expect(selectionDueAt({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', decidedAt: null })).toBeNull();
    expect(selectionDueAt({ status: 'APPROVED', paymentStatus: 'PAID', decidedAt, order: { dueAt: null } })).toBeNull();
    expect(selectionDueAt({ status: 'APPROVED', paymentStatus: 'NOT_REQUIRED', decidedAt })).toBeNull();
  });

  test('holdsSelection: a running hold, or any PROCESSING hold', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(holdsSelection({ paymentStatus: 'PAYMENT_DUE', selectionHeldUntil: new Date(now.getTime() + 60_000) }, now)).toBe(true);
    expect(holdsSelection({ paymentStatus: 'PAYMENT_DUE', selectionHeldUntil: new Date(now.getTime() - 60_000) }, now)).toBe(false);
    expect(holdsSelection({ paymentStatus: 'PROCESSING', selectionHeldUntil: new Date(now.getTime() - 60_000) }, now)).toBe(true);
    expect(holdsSelection({ paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null }, now)).toBe(false);
  });
});

describe('hasLiveOrder / moneyOf', () => {
  const order = { id: 'o1', orderRef: 'JMP-AAAAAA', status: 'CANCELLED', totalAmount: 300, subtotalAmount: 275, orgReceives: 275, feeMode: 'PASS', items: [], addOns: [], refunds: [] };

  test('a cancelled order on an application still in play is not the live amount', () => {
    for (const status of ['SUBMITTED', 'WAITLISTED', 'APPROVED']) {
      const a = { status, paymentStatus: status === 'APPROVED' ? 'AWAITING_SELECTION' : 'NOT_DUE', order };
      expect(hasLiveOrder(a)).toBe(false);
      expect(moneyOf(a)).toMatchObject({ orderId: null, orderRef: null, applicantPays: 0 });
    }
  });

  test('rejected / withdrawn keep their cancelled order as history; any other order status is live', () => {
    expect(hasLiveOrder({ status: 'WITHDRAWN', order })).toBe(true);
    expect(moneyOf({ status: 'REJECTED', paymentStatus: 'NOT_DUE', order })).toMatchObject({ orderRef: 'JMP-AAAAAA', applicantPays: 300 });
    expect(hasLiveOrder({ status: 'APPROVED', order: { ...order, status: 'PENDING' } })).toBe(true);
    expect(hasLiveOrder({ status: 'APPROVED', order: null })).toBe(false);
  });
});

describe('planApplicationMove (D6 in-flight migration)', () => {
  const base = (over = {}) => ({
    status: 'SUBMITTED',
    paymentStatus: 'CARD_ON_FILE',
    capacitySlot: 'NONE',
    tierId: 't1',
    stripePaymentMethodId: 'pm_1',
    selectionHeldUntil: null,
    form: { kind: 'PAID', reserveOnApproval: true },
    order: { id: 'o1', status: 'PENDING', payment: null },
    ...over,
  });

  test.each([
    ['FREE form', base({ form: { kind: 'FREE' } }), 'SKIP'],
    ['paid', base({ status: 'APPROVED', paymentStatus: 'PAID', order: { status: 'COMPLETED' } }), 'SKIP'],
    ['refunded', base({ status: 'APPROVED', paymentStatus: 'REFUNDED' }), 'SKIP'],
    ['waived (NOT_REQUIRED, order COMPLETED)', base({ status: 'APPROVED', paymentStatus: 'NOT_REQUIRED', order: { status: 'COMPLETED' } }), 'SKIP'],
    ['a succeeded payment row', base({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', order: { status: 'PENDING', payment: { status: 'SUCCEEDED' } } }), 'SKIP'],
    ['already moved', base({ paymentStatus: 'NOT_DUE' }), 'SKIP'],
    ['already choosing', base({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION' }), 'SKIP'],
    ['rejected', base({ status: 'REJECTED' }), 'SKIP'],
    ['a charge in flight', base({ status: 'APPROVED', paymentStatus: 'PROCESSING' }), 'REPORT'],
    ['DRAFT stuck at the card step', base({ status: 'DRAFT', paymentStatus: 'AWAITING_CARD', stripePaymentMethodId: null }), 'DRAFT_TO_SUBMITTED'],
    ['DRAFT stuck at pay-at-submission', base({ status: 'DRAFT', paymentStatus: 'NOT_REQUIRED' }), 'DRAFT_TO_SUBMITTED'],
    ['submitted with a saved card', base(), 'TO_NOT_DUE'],
    ['waitlisted with a saved card', base({ status: 'WAITLISTED' }), 'TO_NOT_DUE'],
    ['approved, unpaid, slot reserved', base({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' }), 'TO_AWAITING_SELECTION'],
    ['approved without a category', base({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', tierId: null }), 'REPORT'],
  ])('%s → %s', (_label, row, action) => {
    expect(planApplicationMove(row).action).toBe(action);
  });

  test('cancels a live unpaid order; keeps the slot only when the form reserves on approval', () => {
    expect(planApplicationMove(base())).toMatchObject({ cancelOrder: true });
    expect(planApplicationMove(base({ order: { status: 'CANCELLED' } }))).toMatchObject({ cancelOrder: false });
    expect(planApplicationMove(base({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE' }))).toMatchObject({ keepSlot: true });
    expect(planApplicationMove(base({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', form: { kind: 'PAID', reserveOnApproval: false } }))).toMatchObject({ keepSlot: false });
  });
});
