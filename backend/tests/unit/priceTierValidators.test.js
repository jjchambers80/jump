// Unit tests for PriceTier validators — new fields
// Tests saleStartDate, saleEndDate, visibility, isRefundable validation

import { describe, it, expect, vi } from 'vitest';
import {
  validateCreatePriceTier,
  validateUpdatePriceTier,
} from '../../src/api/validators/priceTierValidators.js';

function validate(validator, body) {
  const req = { body };
  const res = {};
  const next = vi.fn();

  validator(req, res, next);

  const error = next.mock.calls[0]?.[0];
  return error instanceof Error ? error : null;
}

describe('priceTierValidators', () => {
  const validBase = {
    name: 'GA',
    price: 25,
    quantityTotal: 100,
  };

  describe('validateCreatePriceTier — sale window', () => {
    it('accepts valid saleStartDate', () => {
      const error = validate(validateCreatePriceTier, {
        ...validBase,
        saleStartDate: '2026-12-01T00:00:00Z',
      });
      expect(error).toBeNull();
    });

    it('rejects invalid saleStartDate', () => {
      const error = validate(validateCreatePriceTier, {
        ...validBase,
        saleStartDate: 'not-a-date',
      });
      expect(error).not.toBeNull();
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'saleStartDate' }),
        ])
      );
    });

    it('rejects saleEndDate before saleStartDate', () => {
      const error = validate(validateCreatePriceTier, {
        ...validBase,
        saleStartDate: '2026-12-15T00:00:00Z',
        saleEndDate: '2026-12-01T00:00:00Z',
      });
      expect(error).not.toBeNull();
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'saleEndDate' }),
        ])
      );
    });

    it('accepts saleEndDate after saleStartDate', () => {
      const error = validate(validateCreatePriceTier, {
        ...validBase,
        saleStartDate: '2026-12-01T00:00:00Z',
        saleEndDate: '2026-12-15T00:00:00Z',
      });
      expect(error).toBeNull();
    });

    it('accepts null sale dates', () => {
      const error = validate(validateCreatePriceTier, {
        ...validBase,
        saleStartDate: null,
        saleEndDate: null,
      });
      expect(error).toBeNull();
    });
  });

  describe('validateCreatePriceTier — visibility', () => {
    it('accepts PUBLIC', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, visibility: 'PUBLIC' });
      expect(error).toBeNull();
    });

    it('accepts PRIVATE', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, visibility: 'PRIVATE' });
      expect(error).toBeNull();
    });

    it('accepts HIDDEN', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, visibility: 'HIDDEN' });
      expect(error).toBeNull();
    });

    it('rejects invalid visibility', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, visibility: 'SECRET' });
      expect(error).not.toBeNull();
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'visibility' }),
        ])
      );
    });
  });

  describe('validateCreatePriceTier — isRefundable', () => {
    it('accepts boolean true', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, isRefundable: true });
      expect(error).toBeNull();
    });

    it('accepts boolean false', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, isRefundable: false });
      expect(error).toBeNull();
    });

    it('rejects non-boolean', () => {
      const error = validate(validateCreatePriceTier, { ...validBase, isRefundable: 'yes' });
      expect(error).not.toBeNull();
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'isRefundable' }),
        ])
      );
    });
  });

  describe('validateUpdatePriceTier — new fields', () => {
    it('accepts partial update with visibility only', () => {
      const error = validate(validateUpdatePriceTier, { visibility: 'HIDDEN' });
      expect(error).toBeNull();
    });

    it('accepts partial update with sale dates only', () => {
      const error = validate(validateUpdatePriceTier, {
        saleStartDate: '2026-12-01T00:00:00Z',
        saleEndDate: '2026-12-31T00:00:00Z',
      });
      expect(error).toBeNull();
    });

    it('rejects invalid visibility in update', () => {
      const error = validate(validateUpdatePriceTier, { visibility: 'INVISIBLE' });
      expect(error).not.toBeNull();
    });

    it('rejects invalid isRefundable in update', () => {
      const error = validate(validateUpdatePriceTier, { isRefundable: 1 });
      expect(error).not.toBeNull();
    });
  });
});
