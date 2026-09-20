import { describe, expect, it } from 'vitest';
import { describeTimeZone, formatOffset, offsetMinutesFor, timeZoneLabel, timeZoneOptions } from '@/lib/timeZones';
import { formatDateTime } from '@/lib/accountFormat';

// A fixed winter instant (no DST in the northern hemisphere)
const JAN = new Date('2026-01-15T12:00:00Z');
// A fixed summer instant
const JUL = new Date('2026-07-15T12:00:00Z');

describe('offsets', () => {
  it('computes standard and daylight offsets', () => {
    expect(offsetMinutesFor('America/New_York', JAN)).toBe(-300);
    expect(offsetMinutesFor('America/New_York', JUL)).toBe(-240);
    expect(offsetMinutesFor('Asia/Kolkata', JAN)).toBe(330);
    expect(offsetMinutesFor('UTC', JAN)).toBe(0);
  });

  it('formats as GMT±hh:mm', () => {
    expect(formatOffset(-300)).toBe('GMT-05:00');
    expect(formatOffset(330)).toBe('GMT+05:30');
    expect(formatOffset(0)).toBe('GMT+00:00');
  });
});

describe('describeTimeZone', () => {
  it('splits region and city and humanizes underscores', () => {
    expect(describeTimeZone('America/New_York', JAN)).toEqual({
      id: 'America/New_York',
      city: 'New York',
      region: 'America',
      offset: 'GMT-05:00',
      offsetMinutes: -300,
    });
    expect(describeTimeZone('UTC', JAN).region).toBe('Other');
    expect(timeZoneLabel('Europe/Berlin', JUL)).toBe('Berlin (GMT+02:00)');
  });

  it('lists options sorted by offset then id', () => {
    const options = timeZoneOptions(JAN);
    expect(options.length).toBeGreaterThan(10);
    for (let i = 1; i < options.length; i += 1) {
      const a = options[i - 1];
      const b = options[i];
      expect(a.offsetMinutes < b.offsetMinutes || (a.offsetMinutes === b.offsetMinutes && a.id <= b.id)).toBe(true);
    }
  });
});

describe('formatDateTime', () => {
  it('honours the account time zone and falls back to the browser zone when null', () => {
    const inNY = formatDateTime(JAN, { locale: 'en-US', timeZone: 'America/New_York' }, { hour: 'numeric', hour12: true });
    expect(inNY).toBe('7 AM');
    const inTokyo = formatDateTime(JAN, { locale: 'en-US', timeZone: 'Asia/Tokyo' }, { hour: 'numeric', hour12: true });
    expect(inTokyo).toBe('9 PM');
    expect(formatDateTime('not a date', { locale: 'en-US', timeZone: null })).toBe('');
  });

  it('survives an unknown zone by falling back to the default locale', () => {
    expect(formatDateTime(JAN, { locale: 'en-US', timeZone: 'Nowhere/Land' }, { year: 'numeric' })).toBe('2026');
  });
});
