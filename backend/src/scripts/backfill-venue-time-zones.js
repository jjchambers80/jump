/**
 * Spec 033 phase 3: give existing venues a real `timezoneSource`.
 *
 * The phase 2 migration added `country` and `timezoneSource` with defaults, so
 * every pre-033 venue reads as DEFAULT — "nobody ever decided this". That is
 * true but not useful: some of those rows carry a zone an organizer chose on
 * purpose, and re-deriving over it would be wrong.
 *
 * The one signal available is whether the stored zone is still the schema
 * default. Nothing recorded who set it, so:
 *
 *   stored === "America/New_York"  → nobody chose it. Derive from the address;
 *                                    write the result and mark it DERIVED.
 *   stored === anything else       → somebody chose it. Keep the value and mark
 *                                    it MANUAL so no later address edit
 *                                    overwrites it.
 *
 * The second rule is deliberately conservative. A venue in New York that was
 * never touched is indistinguishable from one an organizer set to New York on
 * purpose, so it re-derives — and for a genuinely New York venue the derivation
 * returns New York anyway. The only rows that move are ones where the address
 * disagrees with the default, which is exactly the set worth fixing.
 *
 * Usage:
 *   cd backend && npm run db:backfill:033            # dry run, prints the plan
 *   cd backend && npm run db:backfill:033 -- --apply # writes
 *
 * Idempotent: a second run finds no DEFAULT rows left to decide and does
 * nothing.
 */

import 'dotenv/config';
import { prisma } from '@jump/db';
import { resolveVenueTimeZone } from '../utils/usTimeZones.js';

const SCHEMA_DEFAULT_ZONE = 'America/New_York';

/**
 * Decide what to do with each venue. Pure, so the rules are unit-testable
 * without a database.
 *
 * @param {Array<{id: string, name: string, country?: string|null, state?: string|null, postalCode?: string|null, timezone: string, timezoneSource: string}>} venues
 * @returns {Array<{id: string, name: string, action: 'DERIVE'|'MARK_MANUAL'|'SKIP', from: string, to: string, source: string, reason: string, confident?: boolean}>}
 */
export function planVenueBackfill(venues) {
  return venues.map((venue) => {
    if (venue.timezoneSource !== 'DEFAULT') {
      return {
        id: venue.id,
        name: venue.name,
        action: 'SKIP',
        from: venue.timezone,
        to: venue.timezone,
        source: venue.timezoneSource,
        reason: 'ALREADY_DECIDED',
      };
    }

    if (venue.timezone !== SCHEMA_DEFAULT_ZONE) {
      // A non-default zone on a row nobody has touched since the migration was
      // set by hand before spec 033. Keep it, and protect it.
      return {
        id: venue.id,
        name: venue.name,
        action: 'MARK_MANUAL',
        from: venue.timezone,
        to: venue.timezone,
        source: 'MANUAL',
        reason: 'NON_DEFAULT_VALUE_WAS_CHOSEN',
      };
    }

    const derived = resolveVenueTimeZone({
      country: venue.country,
      state: venue.state,
      postalCode: venue.postalCode,
    });

    if (!derived.timezone) {
      // Nothing to go on — leave it DEFAULT so a later address edit resolves it.
      return {
        id: venue.id,
        name: venue.name,
        action: 'SKIP',
        from: venue.timezone,
        to: venue.timezone,
        source: 'DEFAULT',
        reason: derived.reason,
      };
    }

    return {
      id: venue.id,
      name: venue.name,
      action: 'DERIVE',
      from: venue.timezone,
      to: derived.timezone,
      source: 'DERIVED',
      reason: derived.reason,
      confident: derived.confident,
    };
  });
}

async function main() {
  const apply = process.argv.includes('--apply');

  const venues = await prisma.venue.findMany({
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
  const changes = plan.filter((p) => p.action !== 'SKIP');
  const moves = changes.filter((p) => p.from !== p.to);
  const unsure = changes.filter((p) => p.confident === false);

  console.log(`\nSpec 033 venue time-zone backfill — ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Venues: ${venues.length}   to change: ${changes.length}   zone actually moves: ${moves.length}\n`);

  if (changes.length > 0) {
    console.log(`${'Venue'.padEnd(34)} ${'Action'.padEnd(12)} ${'From'.padEnd(22)} ${'To'.padEnd(22)} Why`);
    console.log('-'.repeat(120));
    for (const p of changes) {
      const flag = p.confident === false ? ' (confirm)' : '';
      console.log(
        `${p.name.slice(0, 33).padEnd(34)} ${p.action.padEnd(12)} ${p.from.padEnd(22)} ${p.to.padEnd(22)} ${p.reason}${flag}`
      );
    }
    console.log();
  }

  if (moves.length > 0) {
    console.log(`${moves.length} venue(s) change zone. Event times at those venues will render differently.`);
    console.log('Run the reconciliation report (npm run report:033) to see which events move.\n');
  }

  if (unsure.length > 0) {
    console.log(`${unsure.length} venue(s) sit near a time zone line — confirm them in Settings › Venues.\n`);
  }

  if (!apply) {
    console.log('Nothing written. Re-run with --apply to write.\n');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const p of changes) {
    await prisma.venue.update({
      where: { id: p.id },
      data: { timezone: p.to, timezoneSource: p.source },
    });
    written += 1;
  }
  console.log(`Updated ${written} venue(s).\n`);
  await prisma.$disconnect();
}

// Only run when invoked directly, so the planner can be imported by tests.
if (process.argv[1] && process.argv[1].endsWith('backfill-venue-time-zones.js')) {
  main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
