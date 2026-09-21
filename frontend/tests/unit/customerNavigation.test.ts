import { describe, expect, it } from 'vitest';
import {
  customerDetailHref,
  customerListHref,
  customerScopeFrom,
  withCustomerScope,
} from '@/lib/customerNavigation';

describe('customer navigation state', () => {
  it('defaults missing and invalid scope values to customers', () => {
    expect(customerScopeFrom(new URLSearchParams())).toBe('customers');
    expect(customerScopeFrom(new URLSearchParams('scope=prospects'))).toBe('customers');
  });

  it('accepts the all-contacts scope', () => {
    expect(customerScopeFrom(new URLSearchParams('scope=all'))).toBe('all');
  });

  it('updates scope without dropping other list state', () => {
    const params = withCustomerScope(
      new URLSearchParams('search=ada&tag=vip&scope=customers'),
      'all'
    );

    expect(params.toString()).toBe('search=ada&tag=vip&scope=all');
  });

  it('carries list state to detail and back links', () => {
    const params = new URLSearchParams('scope=all&tag=vip');

    expect(customerDetailHref('contact/1', params)).toBe(
      '/admin/customers/contact%2F1?scope=all&tag=vip'
    );
    expect(customerListHref(params)).toBe('/admin/customers?scope=all&tag=vip');
  });
});
