// Spec 033 phase 3: the venue backfill against real rows.
//
// The planner's rules are unit-tested; this checks the part that only a
// database can show — that the writes land, that a second run is a no-op, and
// that a deliberate pre-033 choice survives contact with it.

import { prisma } from '@jump/db';
import { planVenueBackfill } from '../../src/scripts/backfill-venue-time-zones.js';

/** What `npm run db:backfill:033 -- --apply` does, minus the console output. */
async function runBackfill(organizationId) {
  const venues = await prisma.venue.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      country: true,
      state: true,
      postalCode: true,
      timezone: true,
      timezoneSource: true,
    },
    orderBy: { name: 'asc' },
  });
  const plan = planVenueBackfill(venues);
  for (const p of plan.filter((x) => x.action !== 'SKIP')) {
    await prisma.venue.update({
      where: { id: p.id },
      data: { timezone: p.to, timezoneSource: p.source },
    });
  }
  return plan;
}

describe('Venue time-zone backfill (spec 033 phase 3)', () => {
  let orgId;
  const ids = {};

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Venue Backfill Org', status: 'ACTIVE' },
    });
    orgId = org.id;

    // Every row below is shaped like a pre-033 venue: the migration gave them
    // all `timezoneSource: DEFAULT` whatever their zone says.
    const rows = [
      // Never touched, address resolves elsewhere — the set worth fixing.
      { key: 'denver', name: 'A Denver Venue', address: '1510 Clarkson St', state: 'CO', postalCode: '80218', timezone: 'America/New_York' },
      // Never touched, address agrees with the default.
      { key: 'raleigh', name: 'B Raleigh Venue', address: '500 S Salisbury St', state: 'NC', postalCode: '27601', timezone: 'America/New_York' },
      // A non-default zone: somebody set this on purpose before spec 033.
      { key: 'chosen', name: 'C Chosen Venue', address: '1 Pier St', state: 'CO', postalCode: '80218', timezone: 'America/Los_Angeles' },
      // No address to go on.
      { key: 'bare', name: 'D Bare Venue', address: '1 Nowhere Rd', timezone: 'America/New_York' },
    ];
    for (const { key, ...data } of rows) {
      const venue = await prisma.venue.create({
        data: { organizationId: orgId, timezoneSource: 'DEFAULT', ...data },
      });
      ids[key] = venue.id;
    }
  });

  afterAll(async () => {
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('derives, protects and skips in one pass', async () => {
    await runBackfill(orgId);

    const after = Object.fromEntries(
      (
        await prisma.venue.findMany({
          where: { organizationId: orgId },
          select: { id: true, timezone: true, timezoneSource: true },
        })
      ).map((v) => [v.id, v])
    );

    // The one that actually moves.
    expect(after[ids.denver]).toMatchObject({ timezone: 'America/Denver', timezoneSource: 'DERIVED' });

    // Same zone, but now recorded as derived rather than "nobody decided".
    expect(after[ids.raleigh]).toMatchObject({ timezone: 'America/New_York', timezoneSource: 'DERIVED' });

    // The deliberate choice survives, and is now protected from address edits.
    expect(after[ids.chosen]).toMatchObject({ timezone: 'America/Los_Angeles', timezoneSource: 'MANUAL' });

    // Nothing to derive from: left alone so a later address edit resolves it.
    expect(after[ids.bare]).toMatchObject({ timezone: 'America/New_York', timezoneSource: 'DEFAULT' });
  });

  it('is idempotent — a second run writes nothing', async () => {
    const before = await prisma.venue.findMany({
      where: { organizationId: orgId },
      select: { id: true, timezone: true, timezoneSource: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });

    const plan = await runBackfill(orgId);
    expect(plan.every((p) => p.action === 'SKIP')).toBe(true);

    const after = await prisma.venue.findMany({
      where: { organizationId: orgId },
      select: { id: true, timezone: true, timezoneSource: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('leaves a backfilled MANUAL venue pinned when its address later changes', async () => {
    const { default: venueService } = await import('../../src/services/VenueService.js');
    const moved = await venueService.updateVenue(orgId, ids.chosen, { state: 'NC', postalCode: '27601' });
    expect(moved.timezone).toBe('America/Los_Angeles');
    expect(moved.timezoneSource).toBe('MANUAL');
  });
});
