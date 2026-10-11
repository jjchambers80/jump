// Spec 050-G: the event hero renders placeholders for unset fields in preview
// mode, and the start–end line in the venue's zone with the zone name.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EventHero from '@/app/events/[eventId]/EventHero';
import type { EventPageEvent } from '@/app/events/[eventId]/eventPage';
import { formatEventTimeRange } from '@/lib/eventTimeRange';

const squash = (text: string) => text.replace(/\s+/g, ' ');

const draft: EventPageEvent = {
  id: 'e1',
  name: '',
  description: null,
  logoUrl: null,
  date: null,
  capacity: null,
  status: 'DRAFT',
  admissionMode: 'TICKETED',
  taxRate: 0,
  venue: null,
  priceTiers: [],
};

const render = (event: EventPageEvent, preview: boolean) =>
  squash(renderToStaticMarkup(<EventHero event={event} org={{ id: 'o1', name: 'Org' }} preview={preview} />));

describe('EventHero placeholders', () => {
  it('names every unset field in text, in preview mode', () => {
    const html = render(draft, true);
    for (const text of ['Add an event name', 'Add a date', 'Add a venue', 'Add an image']) expect(html).toContain(text);
    expect(html.match(/data-placeholder/g)).toHaveLength(4);
    for (const id of ['event-hero', 'event-date', 'event-venue', 'event-hero-image']) expect(html).toContain(`id="${id}"`);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('shows no placeholders to buyers', () => {
    const html = render(draft, false);
    expect(html).not.toContain('data-placeholder');
    expect(html).not.toContain('Add a date');
  });

  it('renders set fields instead of placeholders', () => {
    const html = render(
      {
        ...draft,
        name: 'Summer Market',
        date: '2026-06-01T20:00:00.000Z',
        endDate: '2026-06-02T00:00:00.000Z',
        venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
        logoUrl: '/uploads/poster.png',
      },
      true
    );
    expect(html).not.toContain('data-placeholder');
    expect(html).toContain('Summer Market');
    expect(html).toContain('4:00 – 8:00 PM EDT');
    expect(html).toContain('id="event-hero-image"');
    // Preview opens no image dialog.
    expect(html).not.toContain('View Summer Market image');
  });
});

describe('formatEventTimeRange', () => {
  const range = (start: string, end: string | null, zone: string) => squash(formatEventTimeRange(start, end, zone));

  it('shares the meridiem and the zone on one day', () => {
    // 16:00–20:00 in Denver (MDT), whatever zone the test runner is in.
    expect(range('2026-06-01T22:00:00.000Z', '2026-06-02T02:00:00.000Z', 'America/Denver')).toBe('4:00 – 8:00 PM MDT');
    expect(range('2026-06-01T16:00:00.000Z', '2026-06-02T02:00:00.000Z', 'America/Denver')).toBe('10:00 AM – 8:00 PM MDT');
  });

  it('names the end day when the event runs past midnight at the venue', () => {
    expect(range('2026-06-02T02:00:00.000Z', '2026-06-02T08:00:00.000Z', 'America/Los_Angeles')).toBe(
      '7:00 PM – Tue, Jun 2, 2026, 1:00 AM PDT'
    );
  });

  it('uses the venue day, not UTC: same venue day across UTC midnight', () => {
    // 6–10 PM in Honolulu is 04:00–08:00 UTC the next day.
    expect(range('2026-06-02T04:00:00.000Z', '2026-06-02T08:00:00.000Z', 'Pacific/Honolulu')).toBe('6:00 – 10:00 PM HST');
  });

  it('names both zones across a DST change', () => {
    // US fall back, 2026-11-01: 1:00 AM EDT → 3:00 AM EST.
    expect(range('2026-11-01T05:00:00.000Z', '2026-11-01T08:00:00.000Z', 'America/New_York')).toBe('1:00 AM EDT – 3:00 AM EST');
  });

  it('falls back to the start time without a valid end', () => {
    expect(range('2026-06-01T22:00:00.000Z', null, 'America/Denver')).toBe('4:00 PM MDT');
    expect(range('2026-06-01T22:00:00.000Z', '2026-06-01T21:00:00.000Z', 'America/Denver')).toBe('4:00 PM MDT');
  });
});
