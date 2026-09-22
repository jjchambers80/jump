// Spec 033 phase 2: a venue's time zone is derived from its address.
//
// The cases come from backend/tests/fixtures/usTimeZones.fixtures.json, which
// frontend/tests/unit/usTimeZones.test.ts asserts too — the venue form previews
// the derivation client-side and the backend stores it, so a divergence would
// show an organizer one zone and save another.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveVenueTimeZone, STATE_ZONES, SPLIT_STATES } from '../../src/utils/usTimeZones.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '../fixtures/usTimeZones.fixtures.json'), 'utf8'));

describe('resolveVenueTimeZone (shared fixtures)', () => {
  test.each(fixtures.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(resolveVenueTimeZone(c.address)).toEqual({
      timezone: c.timezone,
      confident: c.confident,
      reason: c.reason,
    });
  });
});

describe('resolveVenueTimeZone — table sanity', () => {
  it('covers all 50 states, DC and the territories', () => {
    expect(Object.keys(STATE_ZONES)).toHaveLength(56);
  });

  it('only ever returns a zone the runtime knows', () => {
    for (const zone of Object.values(STATE_ZONES)) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
    }
  });

  it('marks every split state as needing confirmation without a ZIP', () => {
    for (const state of SPLIT_STATES) {
      const result = resolveVenueTimeZone({ state });
      expect(result.confident).toBe(false);
      expect(result.timezone).toBe(STATE_ZONES[state]);
    }
  });

  it('never throws on junk input', () => {
    for (const address of [null, undefined, {}, { state: 123 }, { postalCode: {} }, { state: 'ZZ' }]) {
      expect(() => resolveVenueTimeZone(address ?? undefined)).not.toThrow();
    }
  });
});
