// Spec 033 phase 3: the rules the venue backfill applies to pre-033 rows.
//
// `planVenueBackfill` is pure on purpose — these rules decide whether an
// organizer's deliberate choice survives, so they are worth testing without a
// database in the way.

import { planVenueBackfill } from '../../src/scripts/backfill-venue-time-zones.js';

const base = {
  id: 'v1',
  name: 'Test Venue',
  country: 'US',
  state: null,
  postalCode: null,
  timezone: 'America/New_York',
  timezoneSource: 'DEFAULT',
};

const plan = (venue) => planVenueBackfill([{ ...base, ...venue }])[0];

describe('planVenueBackfill', () => {
  it('derives for a never-touched row whose address resolves', () => {
    const result = plan({ state: 'CO', postalCode: '80218' });
    expect(result).toMatchObject({
      action: 'DERIVE',
      from: 'America/New_York',
      to: 'America/Denver',
      source: 'DERIVED',
      confident: true,
    });
  });

  it('leaves a never-touched row alone when the address resolves to the same zone', () => {
    const result = plan({ state: 'NC', postalCode: '27601' });
    // Still a write — the point is to record DERIVED — but the zone does not move.
    expect(result).toMatchObject({ action: 'DERIVE', from: 'America/New_York', to: 'America/New_York' });
  });

  it('protects a non-default zone as a deliberate choice', () => {
    // Nothing recorded who set this, but nobody gets "America/Los_Angeles" by
    // accident: the schema default is Eastern.
    const result = plan({ timezone: 'America/Los_Angeles', state: 'CO', postalCode: '80218' });
    expect(result).toMatchObject({
      action: 'MARK_MANUAL',
      from: 'America/Los_Angeles',
      to: 'America/Los_Angeles',
      source: 'MANUAL',
      reason: 'NON_DEFAULT_VALUE_WAS_CHOSEN',
    });
  });

  it('leaves a row with nothing to derive from as DEFAULT', () => {
    const result = plan({});
    expect(result).toMatchObject({ action: 'SKIP', source: 'DEFAULT', reason: 'UNKNOWN' });
  });

  it('leaves a non-US row as DEFAULT rather than guessing', () => {
    const result = plan({ country: 'CA', postalCode: 'M5V 3L9' });
    expect(result).toMatchObject({ action: 'SKIP', source: 'DEFAULT', reason: 'NON_US' });
  });

  it('never touches a row that already has a decision', () => {
    for (const timezoneSource of ['DERIVED', 'MANUAL']) {
      const result = plan({ timezoneSource, state: 'CO', postalCode: '80218' });
      expect(result).toMatchObject({ action: 'SKIP', reason: 'ALREADY_DECIDED', source: timezoneSource });
    }
  });

  it('flags a low-confidence derivation so the report can ask for confirmation', () => {
    const result = plan({ state: 'AZ', postalCode: '85004' });
    expect(result.action).toBe('DERIVE');
    expect(result.confident).toBe(false);
  });

  it('is idempotent — a second pass over its own output changes nothing', () => {
    const venues = [
      { ...base, id: 'a', state: 'CO', postalCode: '80218' },
      { ...base, id: 'b', timezone: 'America/Los_Angeles' },
      { ...base, id: 'c' },
    ];
    const first = planVenueBackfill(venues);
    const applied = venues.map((v, i) => ({
      ...v,
      timezone: first[i].to,
      timezoneSource: first[i].source,
    }));
    for (const result of planVenueBackfill(applied)) {
      expect(result.action).toBe('SKIP');
    }
  });
});
