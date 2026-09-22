// Spec 033 phase 1: event times are formatted in the venue's zone.
//
// These cases come from backend/tests/fixtures/eventTime.fixtures.json, which
// frontend/tests/unit/eventTime.test.ts asserts too. The two implementations
// cannot drift apart without one of the suites failing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_ZONE,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
  instantToZonedInput,
  zoneAbbreviation,
  zoneOffsetMinutes,
  zonedInputToInstant,
} from '../../src/utils/eventTime.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '../fixtures/eventTime.fixtures.json'), 'utf8'));

describe('eventTime — formatting (shared fixtures)', () => {
  test.each(fixtures.format.map((f) => [f.name, f]))('%s', (_name, f) => {
    expect(formatEventDateTime(f.instant, f.zone)).toBe(f.dateTime);
    expect(formatEventDate(f.instant, f.zone)).toBe(f.date);
    expect(formatEventTime(f.instant, f.zone)).toBe(f.time);
    expect(zoneAbbreviation(f.instant, f.zone)).toBe(f.abbreviation);
  });
});

describe('eventTime — round trip (shared fixtures)', () => {
  test.each(fixtures.roundTrip.map((f) => [f.name, f]))('%s', (_name, f) => {
    const instant = zonedInputToInstant(f.local, f.zone);
    expect(instant.toISOString()).toBe(f.instant);
    expect(instantToZonedInput(instant, f.zone)).toBe(f.backToLocal);
  });
});

describe('eventTime — the abbreviation is never conditional (D6)', () => {
  it('includes the zone even when it matches the default', () => {
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', DEFAULT_ZONE)).toContain('EST');
  });

  it('tracks DST rather than labelling the zone once', () => {
    const summer = zoneAbbreviation('2026-07-04T16:00:00.000Z', 'America/New_York');
    const winter = zoneAbbreviation('2026-12-04T16:00:00.000Z', 'America/New_York');
    expect(summer).toBe('EDT');
    expect(winter).toBe('EST');
  });
});

describe('eventTime — offsets', () => {
  it('reads a negative offset west of Greenwich', () => {
    expect(zoneOffsetMinutes(new Date('2026-11-09T03:00:00.000Z'), 'America/Denver')).toBe(-420);
  });

  it('follows the transition', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-04T02:00:00.000Z'), 'America/Denver')).toBe(-360);
  });
});

describe('eventTime — bad input never throws', () => {
  it('falls back to the default zone for an unknown identifier', () => {
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', 'Mars/Olympus')).toBe(
      formatEventDateTime('2026-11-09T01:00:00.000Z', DEFAULT_ZONE)
    );
  });

  it('falls back to the default zone for a null identifier', () => {
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', null)).toContain('EST');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatEventDateTime('not a date', 'America/Denver')).toBe('');
    expect(formatEventDate(null, 'America/Denver')).toBe('');
    expect(formatEventTime(undefined, 'America/Denver')).toBe('');
    expect(zoneAbbreviation('', 'America/Denver')).toBe('');
    expect(instantToZonedInput(null, 'America/Denver')).toBe('');
  });

  it('returns null for an empty or unparseable local value', () => {
    expect(zonedInputToInstant('', 'America/Denver')).toBeNull();
    expect(zonedInputToInstant(null, 'America/Denver')).toBeNull();
    expect(zonedInputToInstant('not-a-time', 'America/Denver')).toBeNull();
  });
});

describe('eventTime — accepts a Date as well as an ISO string', () => {
  it('formats both the same way', () => {
    const iso = '2026-11-09T03:00:00.000Z';
    expect(formatEventDateTime(new Date(iso), 'America/Denver')).toBe(formatEventDateTime(iso, 'America/Denver'));
  });
});
