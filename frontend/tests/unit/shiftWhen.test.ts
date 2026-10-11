// Spec 050 §6.4: shift times in the venue zone; a shift past midnight names its end date.
import { describe, expect, it } from 'vitest';
import { shiftWhen } from '@/lib/applications';

const zone = 'America/New_York';

describe('shiftWhen', () => {
  it('same day: one date, both times', () => {
    expect(shiftWhen({ startsAt: '2027-09-18T13:00:00.000Z', endsAt: '2027-09-18T17:00:00.000Z' }, zone)).toBe('Sat, Sep 18, 2027 · 9:00 AM EDT – 1:00 PM EDT');
  });

  it('past midnight at the venue: the end date too', () => {
    expect(shiftWhen({ startsAt: '2027-09-19T02:00:00.000Z', endsAt: '2027-09-19T06:00:00.000Z' }, zone)).toBe('Sat, Sep 18, 2027 · 10:00 PM EDT – Sun, Sep 19, 2027 · 2:00 AM EDT');
  });

  it('no end, or no time at all', () => {
    expect(shiftWhen({ startsAt: '2027-09-18T13:00:00.000Z', endsAt: null }, zone)).toBe('Sat, Sep 18, 2027 · 9:00 AM EDT');
    expect(shiftWhen({ startsAt: null, endsAt: null }, zone)).toBeNull();
  });
});
