// Spec 033 phase 1: event times are formatted in the venue's zone.
//
// The fixture file lives in the backend workspace on purpose — this suite and
// backend/tests/unit/eventTime.test.js read the same one, so the parity pair
// (frontend/src/lib/eventTime.ts ↔ backend/src/utils/eventTime.js) cannot
// drift apart silently. Same arrangement as the fee libraries.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZONE,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
  instantToZonedInput,
  zoneAbbreviation,
  zoneOffsetMinutes,
  zonedInputToInstant,
  zonedInputToIso,
} from '@/lib/eventTime';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '../../../backend/tests/fixtures/eventTime.fixtures.json'), 'utf8')
) as {
  format: { name: string; instant: string; zone: string; dateTime: string; date: string; time: string; abbreviation: string }[];
  roundTrip: { name: string; local: string; zone: string; instant: string; backToLocal: string }[];
};

describe('eventTime — formatting (shared fixtures)', () => {
  for (const f of fixtures.format) {
    it(f.name, () => {
      expect(formatEventDateTime(f.instant, f.zone)).toBe(f.dateTime);
      expect(formatEventDate(f.instant, f.zone)).toBe(f.date);
      expect(formatEventTime(f.instant, f.zone)).toBe(f.time);
      expect(zoneAbbreviation(f.instant, f.zone)).toBe(f.abbreviation);
    });
  }
});

describe('eventTime — round trip (shared fixtures)', () => {
  for (const f of fixtures.roundTrip) {
    it(f.name, () => {
      const instant = zonedInputToInstant(f.local, f.zone);
      expect(instant?.toISOString()).toBe(f.instant);
      expect(instantToZonedInput(instant, f.zone)).toBe(f.backToLocal);
      expect(zonedInputToIso(f.local, f.zone)).toBe(f.instant);
    });
  }
});

describe('eventTime — the abbreviation is never conditional (D6)', () => {
  it('includes the zone even when it matches the default', () => {
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', DEFAULT_ZONE)).toContain('EST');
  });

  it('tracks DST rather than labelling the zone once', () => {
    expect(zoneAbbreviation('2026-07-04T16:00:00.000Z', 'America/New_York')).toBe('EDT');
    expect(zoneAbbreviation('2026-12-04T16:00:00.000Z', 'America/New_York')).toBe('EST');
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
  it('falls back to the default zone for an unknown or missing identifier', () => {
    const expected = formatEventDateTime('2026-11-09T01:00:00.000Z', DEFAULT_ZONE);
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', 'Mars/Olympus')).toBe(expected);
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', null)).toBe(expected);
    expect(formatEventDateTime('2026-11-09T01:00:00.000Z', undefined)).toBe(expected);
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
    expect(zonedInputToIso('', 'America/Denver')).toBeNull();
  });
});
