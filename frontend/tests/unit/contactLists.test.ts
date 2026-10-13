import { describe, expect, it } from 'vitest';
import { cleanFilters, contactListHref, csvLine, describeFilters } from '../../src/lib/contactLists';
import { formatRelative } from '../../src/app/admin/contacts/lists/listUi';

describe('contact list helpers (spec 055)', () => {
  it('describes filters in plain words, naming events and forms', () => {
    expect(describeFilters({})).toBe('Everyone');
    expect(describeFilters(null)).toBe('Everyone');
    expect(
      describeFilters(
        { scope: 'customers', ticketEventId: 'e1', minSpent: 50, activeWithinDays: 90 },
        { events: [{ id: 'e1', name: 'Spring Market' }] }
      )
    ).toBe('Paying contacts · Bought tickets to Spring Market · spent at least $50 · active in the last 90 days');
    expect(describeFilters({ source: 'form', formId: 'f1' }, { forms: [{ id: 'f1', name: 'Become a vendor' }] })).toBe(
      'Submitted Become a vendor'
    );
    expect(describeFilters({ rsvpEventId: 'gone', tag: 'VIP' })).toBe("RSVP'd to an event · Tagged “VIP”");
    expect(describeFilters({ minSpent: 12.5 })).toBe('Spent at least $12.50');
  });

  it('drops empty filter values and a form without source form', () => {
    expect(cleanFilters({ tag: '', minSpent: undefined, source: 'tickets', formId: 'f1' })).toEqual({ source: 'tickets' });
    expect(cleanFilters({ source: 'form', formId: 'f1', activeWithinDays: NaN })).toEqual({ source: 'form', formId: 'f1' });
  });

  it('encodes built-in ids in links', () => {
    expect(contactListHref('builtin:all')).toBe('/admin/contacts/lists/builtin%3Aall');
  });

  it('formats last activity relative to now', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(formatRelative('2026-10-12T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-10T12:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-02-12T12:00:00Z', now)).toBe('8 months ago');
  });

  it('writes CSV lines with quoting and formula neutralizing', () => {
    expect(csvLine([3, 'a,b', 'say "hi"', '=HYPERLINK("x")', null])).toBe(`3,"a,b","say ""hi""","'=HYPERLINK(""x"")",`);
  });
});
