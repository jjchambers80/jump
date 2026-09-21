import { describe, expect, it } from '@jest/globals';
import {
  customerSegment,
  filterAndSortCustomers,
  customerNavigation,
} from '../../src/services/CustomerService.js';

const now = new Date('2026-09-20T12:00:00.000Z');
const paidOrder = (paidAt) => ({
  id: `order-${paidAt}`,
  kind: 'TICKET',
  totalAmount: 25,
  paidAt: new Date(paidAt),
  createdAt: new Date(paidAt),
  refunds: [],
});

const customer = (id, firstName, orders, createdAt = '2026-01-01T00:00:00.000Z') => ({
  id,
  firstName,
  lastName: 'Buyer',
  email: `${id}@example.test`,
  location: null,
  note: null,
  emailSubscribed: false,
  createdAt: new Date(createdAt),
  orders,
});

describe('customer segmentation', () => {
  it('classifies zero, one, and multiple paid orders', () => {
    expect(customerSegment([], now)).toBe('Prospect');
    expect(customerSegment([paidOrder('2026-09-01T00:00:00.000Z')], now)).toBe('New');
    expect(
      customerSegment(
        [paidOrder('2026-09-01T00:00:00.000Z'), paidOrder('2026-08-01T00:00:00.000Z')],
        now
      )
    ).toBe('Repeat');
  });

  it('gives Lapsed precedence over New and Repeat when all paid orders are older than 18 months', () => {
    expect(customerSegment([paidOrder('2025-03-19T23:59:59.999Z')], now)).toBe('Lapsed');
    expect(
      customerSegment(
        [paidOrder('2024-01-01T00:00:00.000Z'), paidOrder('2025-03-01T00:00:00.000Z')],
        now
      )
    ).toBe('Lapsed');
  });

  it('treats a paid order exactly at the 18-month cutoff as active', () => {
    expect(customerSegment([paidOrder('2025-03-20T12:00:00.000Z')], now)).toBe('New');
  });

  it('clamps the cutoff to the last day of a shorter month', () => {
    const monthEnd = new Date('2026-08-31T12:00:00.000Z');
    expect(customerSegment([paidOrder('2025-02-28T12:00:00.000Z')], monthEnd)).toBe('New');
  });
});

describe('customer list filtering and navigation', () => {
  const rows = [
    customer('alpha', 'Alpha', [paidOrder('2026-09-01T00:00:00.000Z')]),
    customer('charlie', 'Charlie', [paidOrder('2026-09-02T00:00:00.000Z'), paidOrder('2026-09-03T00:00:00.000Z')]),
    customer('bravo', 'Bravo', [paidOrder('2024-01-01T00:00:00.000Z')]),
  ];

  it('filters by segment before pagination and sorts stably by name', () => {
    const result = filterAndSortCustomers(rows, {
      segment: 'Repeat',
      sort: 'name',
      direction: 'asc',
      now,
    });

    expect(result.map((row) => [row.id, row.segment])).toEqual([['charlie', 'Repeat']]);
  });

  it('returns null at navigation boundaries and preserves the filtered sort order', () => {
    const options = { sort: 'name', direction: 'asc', now };
    expect(customerNavigation(rows, 'alpha', options)).toEqual({ prevId: null, nextId: 'bravo' });
    expect(customerNavigation(rows, 'bravo', options)).toEqual({ prevId: 'alpha', nextId: 'charlie' });
    expect(customerNavigation(rows, 'charlie', options)).toEqual({ prevId: 'bravo', nextId: null });
  });

  it('returns stable null neighbors when the current customer is excluded by a filter', () => {
    expect(customerNavigation(rows, 'alpha', { segment: 'Repeat', now })).toEqual({
      prevId: null,
      nextId: null,
    });
  });
});
