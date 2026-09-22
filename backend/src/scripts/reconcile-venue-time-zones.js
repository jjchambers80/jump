/**
 * Spec 033 phase 3: the event-instant reconciliation report. READ ONLY.
 *
 * Every `Event.date` written before spec 033 phase 1 came from an
 * `<input type="datetime-local">` read with browser-local getters, so the
 * stored instant means "the wall clock the organizer typed, in the organizer's
 * own zone". Phase 1 reinterprets and redisplays that same instant in the
 * VENUE's zone. For an event whose venue zone differs from the zone its
 * organizer was sitting in, the displayed time changes.
 *
 * This report shows exactly which events those are. It is deliberately NOT a
 * migration: nothing recorded the creating browser's zone, so any "correction"
 * would be a guess dressed up as a fix. Organizers read the list and edit the
 * few that are genuinely wrong — the event form now round-trips correctly.
 *
 * Run it BEFORE phase 1 reaches production. It depends only on venue zones, so
 * it is valid ahead of the deploy, and an empty result means phase 1 changes no
 * time any customer has seen.
 *
 * Usage:
 *   cd backend && npm run report:033
 *   cd backend && VIEWER_ZONE=America/Chicago npm run report:033
 *   cd backend && npm run report:033 -- --all       # include past events
 *
 * Against production, where DATABASE_URL points at an internal host:
 *   railway ssh --service backend "node backend/src/scripts/reconcile-venue-time-zones.js"
 */

import 'dotenv/config';
import { prisma } from '@jump/db';
import { zoneOffsetMinutes } from '../utils/eventTime.js';

// The zone the organizers were most likely sitting in when they typed the
// dates — i.e. what the old code would have used. Override per organization.
const VIEWER_ZONE = process.env.VIEWER_ZONE || 'America/New_York';

function fmt(date, zone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function deltaLabel(date, venueZone) {
  const mins = zoneOffsetMinutes(date, venueZone) - zoneOffsetMinutes(date, VIEWER_ZONE);
  if (mins === 0) return '—';
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${Math.floor(abs / 60)}h${abs % 60 ? `${abs % 60}m` : ''}`;
}

async function main() {
  const includePast = process.argv.includes('--all');

  const events = await prisma.event.findMany({
    select: {
      id: true,
      name: true,
      date: true,
      status: true,
      venue: { select: { name: true, timezone: true, state: true, postalCode: true } },
      _count: { select: { orders: true, tickets: true } },
    },
    orderBy: { date: 'asc' },
  });

  const now = new Date();
  const considered = includePast ? events : events.filter((e) => e.date > now);
  const affected = considered.filter((e) => e.venue && e.venue.timezone !== VIEWER_ZONE);
  const withMoney = affected.filter((e) => e._count.orders > 0 || e._count.tickets > 0);

  console.log('\nSpec 033 — event instant reconciliation (READ ONLY, nothing is written)');
  console.log(`Organizer zone assumed: ${VIEWER_ZONE}`);
  console.log(
    `Events: ${events.length}   ${includePast ? 'considered (incl. past)' : 'upcoming'}: ${considered.length}   affected: ${affected.length}   of those with orders or tickets: ${withMoney.length}\n`
  );

  const byZone = new Map();
  for (const e of events) {
    const zone = e.venue?.timezone ?? '(no venue)';
    byZone.set(zone, (byZone.get(zone) || 0) + 1);
  }
  console.log('Events by venue zone (all events):');
  for (const [zone, count] of [...byZone].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${zone}`);
  }

  if (affected.length === 0) {
    console.log(`\nNo event sits in a venue zone other than ${VIEWER_ZONE}.`);
    console.log('Phase 1 changes no displayed event time. Nothing to reconcile.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(
    `\n${'Event'.padEnd(34)} ${'Venue'.padEnd(24)} ${'Stored (UTC)'.padEnd(22)} ${'Was shown'.padEnd(26)} ${'Now shows'.padEnd(26)} ${'Delta'.padEnd(6)} Sold`
  );
  console.log('-'.repeat(160));
  for (const e of affected) {
    const sold = e._count.orders > 0 || e._count.tickets > 0 ? `${e._count.orders}o/${e._count.tickets}t` : '—';
    console.log(
      `${e.name.slice(0, 33).padEnd(34)} ${e.venue.name.slice(0, 23).padEnd(24)} ` +
        `${`${e.date.toISOString().slice(0, 19)}Z`.padEnd(22)} ` +
        `${fmt(e.date, VIEWER_ZONE).padEnd(26)} ${fmt(e.date, e.venue.timezone).padEnd(26)} ` +
        `${deltaLabel(e.date, e.venue.timezone).padEnd(6)} ${sold}`
    );
  }

  console.log('\nThese instants are NOT rewritten — there is no record of the zone each');
  console.log('organizer typed in, so a "correction" would be a guess. Confirm the list and');
  console.log('edit any that are genuinely wrong; the event form now round-trips correctly.');
  if (withMoney.length > 0) {
    console.log(`\n${withMoney.length} affected event(s) already have orders or tickets — check those first.`);
  }
  console.log();

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
