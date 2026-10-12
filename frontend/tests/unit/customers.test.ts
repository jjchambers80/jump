import { describe, expect, it } from 'vitest';
import {
  customerApiQuery,
  customerDetailHref,
  customerListQuery,
  customerScopeFrom,
  guestAccountNote,
  rsvpTimelineText,
} from '../../src/lib/customers';

describe('contact list navigation helpers', () => {
  it('serializes only active sort and filter values', () => {
    expect(
      customerListQuery({
        page: 2,
        search: 'Ada Lovelace',
        scope: 'customers',
        rsvp: 'going',
        eventId: 'event-1',
        sort: 'name',
        direction: 'asc',
      }).toString()
    ).toBe('page=2&search=Ada+Lovelace&scope=customers&rsvp=going&eventId=event-1&sort=name&direction=asc');
    expect(customerListQuery({ scope: 'all' }).toString()).toBe('');
  });

  it('preserves the list query when opening another contact', () => {
    const query = new URLSearchParams('search=ada&sort=name&direction=asc');
    expect(customerDetailHref('contact/one', query)).toBe(
      '/admin/contacts/contact%2Fone?search=ada&sort=name&direction=asc'
    );
  });

  it('defaults the scope to everyone; only scope=customers narrows it', () => {
    expect(customerScopeFrom(null)).toBe('all');
    expect(customerScopeFrom('prospects')).toBe('all');
    expect(customerScopeFrom('customers')).toBe('customers');
  });

  it('always sends the scope to the detail API', () => {
    expect(customerApiQuery('search=ada')).toBe('search=ada&scope=all');
    expect(customerApiQuery('scope=customers')).toBe('scope=customers');
  });
});

describe('customer detail copy', () => {
  it('shows the party size on an RSVP only when the guest brings others', () => {
    expect(rsvpTimelineText('Open House', 1)).toBe("RSVP'd to Open House");
    expect(rsvpTimelineText('Open House', 3)).toBe("RSVP'd to Open House (party of 3)");
    expect(rsvpTimelineText(null, null)).toBe("RSVP'd to an event");
  });

  it('only mentions a purchase when the contact has a transaction', () => {
    expect(guestAccountNote({ transactions: 1, rsvps: 1 })).toMatch(/completed their purchase/);
    expect(guestAccountNote({ transactions: 0, rsvps: 2 })).toBe(
      'This contact does not have an account. They RSVP’d as a guest.'
    );
    expect(guestAccountNote({ transactions: 0, rsvps: 0 })).toBe('This contact does not have an account.');
  });
});
