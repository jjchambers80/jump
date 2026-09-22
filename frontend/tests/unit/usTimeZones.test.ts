// Spec 033 phase 2 parity: the venue form previews the derived zone before
// saving and the backend stores it, so both implementations read the same
// fixture file (which lives in the backend workspace on purpose).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveVenueTimeZone, STATE_ZONES, SPLIT_STATES } from '@/lib/usTimeZones';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '../../../backend/tests/fixtures/usTimeZones.fixtures.json'), 'utf8')
) as {
  cases: {
    name: string;
    address: { country?: string; state?: string; postalCode?: string };
    timezone: string | null;
    confident: boolean;
    reason: string;
  }[];
};

describe('resolveVenueTimeZone (shared fixtures)', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      expect(resolveVenueTimeZone(c.address)).toEqual({
        timezone: c.timezone,
        confident: c.confident,
        reason: c.reason,
      });
    });
  }
});

describe('resolveVenueTimeZone — table sanity', () => {
  it('covers all 50 states, DC and the territories', () => {
    expect(Object.keys(STATE_ZONES)).toHaveLength(56);
  });

  it('marks every split state as needing confirmation without a ZIP', () => {
    for (const state of SPLIT_STATES) {
      expect(resolveVenueTimeZone({ state }).confident).toBe(false);
    }
  });
});
