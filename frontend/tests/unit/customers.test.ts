import { describe, expect, it } from 'vitest';
import {
  customerDetailHref,
  customerListQuery,
  segmentBadgeClass,
} from '../../src/lib/customers';

describe('customer list navigation helpers', () => {
  it('serializes only active sort and filter values', () => {
    expect(
      customerListQuery({
        page: 2,
        search: 'Ada Lovelace',
        segment: 'Repeat',
        sort: 'name',
        direction: 'asc',
      }).toString()
    ).toBe('page=2&search=Ada+Lovelace&segment=Repeat&sort=name&direction=asc');
  });

  it('preserves the list query when opening another customer', () => {
    const query = new URLSearchParams('search=ada&segment=New&sort=name&direction=asc');
    expect(customerDetailHref('contact/one', query)).toBe(
      '/admin/customers/contact%2Fone?search=ada&segment=New&sort=name&direction=asc'
    );
  });

  it('returns distinct accessible badge classes for every segment', () => {
    const segments = ['Prospect', 'New', 'Repeat', 'Lapsed'] as const;
    expect(new Set(segments.map(segmentBadgeClass)).size).toBe(4);
  });
});
