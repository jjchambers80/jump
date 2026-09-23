import { describe, expect, it } from 'vitest';
import { rsvpAnalyticsCards } from '../../src/lib/eventAnalytics';

describe('RSVP event analytics', () => {
  it('builds headcount cards without ticket or revenue metrics', () => {
    const cards = rsvpAnalyticsCards(
      { headcount: 7, rsvpCount: 4, cancelledCount: 2, remaining: 3 },
      10
    );

    expect(cards.map(({ label }) => label)).toEqual([
      'Expected headcount',
      'RSVPs',
      'Remaining',
      'Cancelled',
    ]);
    expect(cards[0]).toMatchObject({ value: 7, subtext: 'of 10 capacity' });
    expect(cards[2]).toMatchObject({ value: 3 });
    expect(cards.map(({ label }) => label)).not.toEqual(
      expect.arrayContaining(['Tickets Sold', 'Revenue'])
    );
  });

  it('describes an unlimited RSVP event without inventing remaining capacity', () => {
    const cards = rsvpAnalyticsCards(
      { headcount: 12, rsvpCount: 8, cancelledCount: 0, remaining: null },
      null
    );

    expect(cards[0].subtext).toBe('Unlimited capacity');
    expect(cards[2].value).toBe('Unlimited');
  });
});
