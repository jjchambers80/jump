// Spec 055: the automatic-list filter validator (pure; no database).

import { describe, expect, it } from '@jest/globals';
import { normalizeFilters, FILTER_KEYS } from '../../src/services/contactListFilters.js';

const fieldsOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.details.map((d) => d.field);
  }
  throw new Error('expected a ValidationError');
};

describe('normalizeFilters', () => {
  it('drops empty values, trims strings and rounds money to cents', () => {
    expect(normalizeFilters({ tag: '  VIP ', source: '', minSpent: 49.999, rsvpEventId: null })).toEqual({
      tag: 'VIP',
      minSpent: 50,
    });
    expect(normalizeFilters(undefined)).toEqual({});
  });

  it('accepts every documented key', () => {
    const all = {
      scope: 'customers',
      source: 'form',
      formId: 'form-1',
      rsvpEventId: 'event-1',
      ticketEventId: 'event-2',
      tag: 'VIP',
      minSpent: 10,
      activeWithinDays: 90,
    };
    expect(Object.keys(all).sort()).toEqual([...FILTER_KEYS].sort());
    expect(normalizeFilters(all)).toEqual(all);
  });

  it('refuses unknown keys, bad values and formId without source form', () => {
    expect(fieldsOf(() => normalizeFilters({ segment: 'New' }))).toEqual(['filters.segment']);
    expect(fieldsOf(() => normalizeFilters({ scope: 'all', minSpent: 0, activeWithinDays: 1.5 }))).toEqual([
      'filters.scope',
      'filters.minSpent',
      'filters.activeWithinDays',
    ]);
    expect(fieldsOf(() => normalizeFilters({ formId: 'f' }))).toEqual(['filters.formId']);
    expect(fieldsOf(() => normalizeFilters(['tag']))).toEqual(['filters']);
  });
});
