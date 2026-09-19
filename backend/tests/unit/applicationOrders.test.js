// Unit tests for the spec 024 pure helpers: the application → order status
// mapping, order-line math (buyer line totals under PASS / ABSORB, adjustment
// totals), the order data a tier + add-ons + adjustments produce, and the
// money view read from an order.

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { orderStatusFor, MONEY_MOVED } =
  await import('../../src/services/applicationOrderStatus.js');
const { adjustmentTotal, adjustmentItems, buyerLineTotal, tierItem } =
  await import('../../src/services/orderLines.js');
const { default: orderLineService } = await import('../../src/services/OrderLineService.js');
const { moneyOf } = await import('../../src/services/applicationMoney.js');

describe('orderStatusFor', () => {
  test.each([
    ['DRAFT', 'AWAITING_CARD', 'PENDING'],
    ['SUBMITTED', 'CARD_ON_FILE', 'PENDING'],
    ['APPROVED', 'PROCESSING', 'PENDING'],
    ['APPROVED', 'PAYMENT_DUE', 'PENDING'],
    ['APPROVED', 'PAID', 'COMPLETED'],
    ['APPROVED', 'PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'],
    ['APPROVED', 'REFUNDED', 'REFUNDED'],
    ['APPROVED', 'NOT_REQUIRED', 'COMPLETED'], // waived
    ['REJECTED', 'CARD_ON_FILE', 'CANCELLED'],
    ['WITHDRAWN', 'PAYMENT_DUE', 'CANCELLED'],
    ['WITHDRAWN', 'AWAITING_CARD', 'CANCELLED'],
    ['WITHDRAWN', 'PAID', 'COMPLETED'], // money moved: the review outcome does not cancel the order
    ['REJECTED', 'PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'],
  ])('%s + %s → %s', (status, paymentStatus, expected) => {
    expect(orderStatusFor({ status, paymentStatus })).toBe(expected);
  });

  test('MONEY_MOVED names the three paid states', () => {
    expect([...MONEY_MOVED].sort()).toEqual(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
  });
});

describe('order line helpers', () => {
  const line = { unitPrice: 15, quantity: 2, platformFee: 1.5, processingFee: 0.9, tax: 2.18 };

  test('PASS: the buyer pays the listed price plus the fee and tax shares', () => {
    expect(buyerLineTotal(line, 'PASS')).toBe(34.58);
  });

  test('ABSORB: the buyer pays the listed price plus tax; tax-inclusive drops the tax', () => {
    expect(buyerLineTotal(line, 'ABSORB')).toBe(32.18);
    expect(buyerLineTotal(line, 'ABSORB', { taxInclusive: true })).toBe(30);
  });

  test('adjustmentTotal sums ADJUSTMENT lines only; a WAIVER is a record', () => {
    const items = [
      { kind: 'APPLICATION_TIER', unitPrice: 250 },
      { kind: 'ADJUSTMENT', unitPrice: -25 },
      { kind: 'ADJUSTMENT', unitPrice: 10 },
      { kind: 'WAIVER', unitPrice: -235 },
    ];
    expect(adjustmentTotal(items)).toBe(-15);
    expect(
      adjustmentItems({ items: items.map((i, n) => ({ ...i, createdAt: new Date(n) })) }).map(
        (i) => i.kind
      )
    ).toEqual(['ADJUSTMENT', 'ADJUSTMENT', 'WAIVER']);
    expect(tierItem({ items })).toMatchObject({ unitPrice: 250 });
  });
});

describe('OrderLineService.applicationOrderData', () => {
  const tier = { id: 't1', name: '10x10', price: 250 };
  const form = { feeMode: 'PASS', taxable: true };
  const event = { taxRate: 0.0725 };
  const org = { taxInclusivePricing: false };
  const power = { addOn: { id: 'a1', name: 'Power', price: 15, taxable: false }, quantity: 2 };

  test('tier line, add-on lines and adjustment lines; every per-line column sums to the totals', () => {
    const { amounts, items, addOns } = orderLineService.applicationOrderData(
      tier,
      form,
      [power],
      [
        {
          id: 'adj1',
          kind: 'ADJUSTMENT',
          unitPrice: -25,
          description: 'Returning vendor',
          createdById: 'u1',
        },
      ],
      event,
      org
    );
    expect(items.map((i) => i.kind)).toEqual(['APPLICATION_TIER', 'ADJUSTMENT']);
    expect(items[0]).toMatchObject({
      applicationTierId: 't1',
      description: '10x10',
      quantity: 1,
      unitPrice: 250,
    });
    expect(items[1]).toMatchObject({
      id: 'adj1',
      unitPrice: -25,
      description: 'Returning vendor',
      createdById: 'u1',
      quantity: 1,
    });
    expect(addOns).toHaveLength(1);
    expect(addOns[0]).toMatchObject({ addOnId: 'a1', quantity: 2, unitPrice: 15, tax: 0 });
    // The adjustment folds into the tier line for fee math: subtotal = 225 + 30
    expect(amounts.subtotal).toBe(255);
    const sum = (col) => [items[0], ...addOns].reduce((s, l) => s + Number(l[col]), 0);
    expect(sum('platformFee')).toBeCloseTo(amounts.platformFee, 2);
    expect(sum('processingFee')).toBeCloseTo(amounts.processingFee, 2);
    expect(sum('tax')).toBeCloseTo(amounts.tax, 2);
    // Buyer totals of the lines reproduce applicantPays
    const buyer =
      buyerLineTotal({ ...items[0], unitPrice: 225 }, 'PASS') +
      addOns.reduce((s, l) => s + buyerLineTotal(l, 'PASS'), 0);
    expect(buyer).toBeCloseTo(amounts.applicantPays, 2);
    expect(orderLineService.totalsData(amounts)).toMatchObject({
      totalAmount: amounts.applicantPays,
      orgReceives: 255,
      feeMode: 'PASS',
    });
  });

  test('ABSORB: orgReceives is the subtotal less fees and the buyer pays the listed prices plus tax', () => {
    const { amounts, addOns } = orderLineService.applicationOrderData(
      tier,
      { feeMode: 'ABSORB', taxable: false },
      [power],
      [],
      event,
      org
    );
    expect(amounts.feeMode).toBe('ABSORB');
    expect(amounts.applicantPays).toBe(280);
    expect(amounts.orgReceives).toBeCloseTo(280 - amounts.platformFee - amounts.processingFee, 2);
    expect(buyerLineTotal(addOns[0], 'ABSORB')).toBe(30);
  });

  test('describe() summarises both kinds', () => {
    expect(
      orderLineService.describe({
        kind: 'TICKET',
        items: [{ quantity: 2, priceTier: { name: 'GA' } }],
        addOns: [{}],
      })
    ).toBe('2 × GA + 1 add-on');
    expect(
      orderLineService.describe({
        kind: 'APPLICATION',
        items: [
          { kind: 'APPLICATION_TIER', description: '10x10' },
          { kind: 'ADJUSTMENT', unitPrice: -5, createdAt: new Date() },
        ],
        addOns: [{ addOn: { name: 'Power' }, quantity: 1 }],
      })
    ).toBe('10x10 + Power ×1 (adjusted)');
  });
});

describe('moneyOf', () => {
  test('no order: zeros with the form fee mode', () => {
    expect(moneyOf({ form: { feeMode: 'ABSORB' } })).toMatchObject({
      orderRef: null,
      applicantPays: 0,
      feeMode: 'ABSORB',
      paymentSource: 'STRIPE',
      refunds: [],
      addOns: [],
      adjustments: [],
    });
  });

  test('reads totals, payment, refunds, lines and adjustments from the order', () => {
    const order = {
      id: 'o1',
      orderRef: 'JMP-ABC234',
      status: 'PARTIALLY_REFUNDED',
      totalAmount: '281.50',
      subtotalAmount: '255.00',
      platformFeeAmount: '12.75',
      processingFeeAmount: '1.00',
      taxAmount: '12.75',
      orgReceives: '255.00',
      feeMode: 'PASS',
      currency: 'usd',
      paidAt: new Date('2026-09-02'),
      dueAt: null,
      payment: {
        stripePaymentIntentId: 'pi_1',
        stripeAccountId: 'acct_1',
        applicationFee: '26.50',
        source: 'STRIPE',
        offlineMethod: null,
      },
      refunds: [
        { amount: '10.00', status: 'SUCCEEDED' },
        { amount: '5.00', status: 'FAILED' },
      ],
      items: [
        { id: 'i1', kind: 'APPLICATION_TIER', unitPrice: '250', createdAt: new Date(1) },
        {
          id: 'adj',
          kind: 'ADJUSTMENT',
          unitPrice: '-25.00',
          description: 'Loyal',
          createdById: 'u1',
          createdAt: new Date(2),
        },
      ],
      addOns: [
        {
          id: 'l1',
          addOnId: 'a1',
          addOn: { name: 'Power' },
          quantity: 2,
          unitPrice: '15.00',
          platformFee: '1.50',
          processingFee: '0.90',
          tax: '0',
        },
      ],
    };
    const m = moneyOf({ order });
    expect(m).toMatchObject({
      orderId: 'o1',
      orderRef: 'JMP-ABC234',
      orderStatus: 'PARTIALLY_REFUNDED',
      applicantPays: 281.5,
      orgReceives: 255,
      stripePaymentIntentId: 'pi_1',
      stripeAccountId: 'acct_1',
      applicationFee: 26.5,
      paymentSource: 'STRIPE',
      offlinePayment: null,
      refundedTotal: 10,
    });
    expect(m.addOns[0]).toMatchObject({
      id: 'l1',
      name: 'Power',
      quantity: 2,
      unitPrice: 15,
      applicantPays: 32.4,
    });
    expect(m.adjustments).toEqual([
      {
        id: 'adj',
        kind: 'ADJUSTMENT',
        amount: -25,
        reason: 'Loyal',
        createdById: 'u1',
        createdAt: new Date(2),
      },
    ]);
  });

  test('offline payment and waived balances read as OFFLINE', () => {
    const base = { totalAmount: 0, items: [], addOns: [], refunds: [] };
    expect(
      moneyOf({
        order: {
          ...base,
          payment: {
            source: 'OFFLINE',
            offlineMethod: 'CHEQUE',
            offlineReference: '#1',
            recordedById: 'u1',
          },
        },
      })
    ).toMatchObject({
      paymentSource: 'OFFLINE',
      offlinePayment: { method: 'CHEQUE', reference: '#1', recordedById: 'u1' },
    });
    expect(
      moneyOf({
        order: {
          ...base,
          payment: null,
          items: [{ kind: 'WAIVER', unitPrice: -10, createdAt: new Date() }],
        },
      })
    ).toMatchObject({ paymentSource: 'OFFLINE', offlinePayment: null });
  });
});
