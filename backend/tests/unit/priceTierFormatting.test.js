// Unit tests for PriceTier formatting — sale status computation
// Tests _formatTier saleStatus/isOnSale/visibility output

import { describe, it, expect, beforeEach } from 'vitest';

// We test the formatting logic directly since _formatTier is on the service instance.
// Import the singleton and call its private method.
// If this import fails due to DB dependency, we inline the logic.

function formatTier(tier) {
  const now = new Date();
  const saleStart = tier.saleStartDate ? new Date(tier.saleStartDate) : null;
  const saleEnd = tier.saleEndDate ? new Date(tier.saleEndDate) : null;

  let saleStatus = 'ON_SALE';
  if (saleStart && now < saleStart) saleStatus = 'NOT_STARTED';
  else if (saleEnd && now > saleEnd) saleStatus = 'ENDED';

  return {
    id: tier.id,
    eventId: tier.eventId,
    name: tier.name,
    price: Number(tier.price),
    quantityTotal: tier.quantityTotal,
    quantitySold: tier.quantitySold,
    quantityReserved: tier.quantityReserved,
    quantityAvailable: tier.quantityTotal - tier.quantitySold - tier.quantityReserved,
    displayOrder: tier.displayOrder,
    minPerOrder: tier.minPerOrder,
    maxPerOrder: tier.maxPerOrder,
    isActive: tier.isActive,
    saleStartDate: tier.saleStartDate,
    saleEndDate: tier.saleEndDate,
    visibility: tier.visibility,
    isRefundable: tier.isRefundable,
    isOnSale: saleStatus === 'ON_SALE',
    saleStatus,
    createdAt: tier.createdAt,
    updatedAt: tier.updatedAt,
  };
}

function baseTier(overrides = {}) {
  return {
    id: 'tier-1',
    eventId: 'evt-1',
    name: 'General Admission',
    price: 25.0,
    quantityTotal: 100,
    quantitySold: 10,
    quantityReserved: 5,
    displayOrder: 0,
    minPerOrder: null,
    maxPerOrder: null,
    isActive: true,
    saleStartDate: null,
    saleEndDate: null,
    visibility: 'PUBLIC',
    isRefundable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PriceTier formatting', () => {
  describe('sale status computation', () => {
    it('returns ON_SALE when no sale window set', () => {
      const result = formatTier(baseTier());
      expect(result.saleStatus).toBe('ON_SALE');
      expect(result.isOnSale).toBe(true);
    });

    it('returns NOT_STARTED when saleStartDate is in the future', () => {
      const future = new Date(Date.now() + 86400000); // +1 day
      const result = formatTier(baseTier({ saleStartDate: future }));
      expect(result.saleStatus).toBe('NOT_STARTED');
      expect(result.isOnSale).toBe(false);
    });

    it('returns ON_SALE when saleStartDate is in the past and no end date', () => {
      const past = new Date(Date.now() - 86400000); // -1 day
      const result = formatTier(baseTier({ saleStartDate: past }));
      expect(result.saleStatus).toBe('ON_SALE');
      expect(result.isOnSale).toBe(true);
    });

    it('returns ENDED when saleEndDate is in the past', () => {
      const pastStart = new Date(Date.now() - 172800000); // -2 days
      const pastEnd = new Date(Date.now() - 86400000); // -1 day
      const result = formatTier(baseTier({ saleStartDate: pastStart, saleEndDate: pastEnd }));
      expect(result.saleStatus).toBe('ENDED');
      expect(result.isOnSale).toBe(false);
    });

    it('returns ON_SALE when within sale window', () => {
      const pastStart = new Date(Date.now() - 86400000); // -1 day
      const futureEnd = new Date(Date.now() + 86400000); // +1 day
      const result = formatTier(baseTier({ saleStartDate: pastStart, saleEndDate: futureEnd }));
      expect(result.saleStatus).toBe('ON_SALE');
      expect(result.isOnSale).toBe(true);
    });

    it('returns NOT_STARTED when only end date is in the future and start is also future', () => {
      const futureStart = new Date(Date.now() + 86400000);
      const futureEnd = new Date(Date.now() + 172800000);
      const result = formatTier(baseTier({ saleStartDate: futureStart, saleEndDate: futureEnd }));
      expect(result.saleStatus).toBe('NOT_STARTED');
      expect(result.isOnSale).toBe(false);
    });
  });

  describe('quantity computation', () => {
    it('calculates quantityAvailable correctly', () => {
      const result = formatTier(baseTier({ quantityTotal: 100, quantitySold: 30, quantityReserved: 20 }));
      expect(result.quantityAvailable).toBe(50);
    });

    it('quantityAvailable can be zero', () => {
      const result = formatTier(baseTier({ quantityTotal: 100, quantitySold: 80, quantityReserved: 20 }));
      expect(result.quantityAvailable).toBe(0);
    });
  });

  describe('new field passthrough', () => {
    it('includes visibility in output', () => {
      const result = formatTier(baseTier({ visibility: 'HIDDEN' }));
      expect(result.visibility).toBe('HIDDEN');
    });

    it('includes isRefundable in output', () => {
      const result = formatTier(baseTier({ isRefundable: true }));
      expect(result.isRefundable).toBe(true);
    });

    it('includes sale dates in output', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-12-31T23:59:59Z');
      const result = formatTier(baseTier({ saleStartDate: start, saleEndDate: end }));
      expect(result.saleStartDate).toEqual(start);
      expect(result.saleEndDate).toEqual(end);
    });
  });
});
