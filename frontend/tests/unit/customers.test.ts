import { describe, expect, it } from 'vitest';
import {
  customerDetailHref,
  customerListQuery,
  customerSegmentFrom,
  guestAccountNote,
  rsvpTimelineText,
  segmentBadgeClass,
} from '../../src/lib/customers';

describe('customer list navigation helpers', () => {
  it('serializes only active sort and filter values', () => {
    expect(
      customerListQuery({
        page: 2,
        search: 'Ada Lovelace',
        segment: 'Repeat',
        rsvp: 'going',
        eventId: 'event-1',
        sort: 'name',
        direction: 'asc',
      }).toString()
    ).toBe('page=2&search=Ada+Lovelace&segment=Repeat&rsvp=going&eventId=event-1&sort=name&direction=asc');
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

  it('normalizes valid segment query values and ignores invalid or missing values', () => {
    expect(customerSegmentFrom('repeat')).toBe('Repeat');
    expect(customerSegmentFrom('unknown')).toBe('');
    expect(customerSegmentFrom(null)).toBe('');
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
