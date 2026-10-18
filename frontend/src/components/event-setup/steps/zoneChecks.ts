// Time-zone checks for the wizard's Where / When steps (spec 033 follow-up,
// docs/research/2026-10-18-automatic-event-time-zones.md). The zone is set
// from the address without asking; these say when it is worth a look.

import { formatEventDate, formatEventDateTime, formatEventTime, instantToZonedInput, zonedInputToInstant } from '@/lib/eventTime';
import { resolveVenueTimeZone } from '@/lib/usTimeZones';
import type { SetupVenue } from './types';

/**
 * True when the venue's zone is a guess: the address resolved nothing
 * (DEFAULT, Eastern) or sits near a zone line. A zone the organizer chose
 * (MANUAL) or an unknown source (an older payload) is never flagged.
 */
export function zoneNeedsCheck(venue: SetupVenue | null | undefined): boolean {
  if (!venue?.timezoneSource || venue.timezoneSource === 'MANUAL') return false;
  if (venue.timezoneSource === 'DEFAULT') return true;
  return !resolveVenueTimeZone({ country: venue.country ?? 'US', state: venue.state ?? '', postalCode: venue.postalCode ?? '' }).confident;
}

/** "That's 11:27 AM CDT your time", only when the viewer's clock reads differently. */
export function viewerTimeLine(instant: Date, zone: string, viewerZone: string | null): string | null {
  if (!viewerZone || viewerZone === zone) return null;
  const theirs = formatEventDateTime(instant, viewerZone);
  const venues = formatEventDateTime(instant, zone);
  if (theirs === venues) return null;
  const sameDay = formatEventDate(instant, viewerZone) === formatEventDate(instant, zone);
  return `That's ${sameDay ? formatEventTime(instant, viewerZone) : theirs} your time.`;
}

export function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function duration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes % 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/**
 * The hard warning for a venue change that moves the real start time of an
 * event people already hold tickets or RSVPs for: the typed wall-clock time
 * stays and moves into the new zone (steps.ts, venue payload).
 */
export function zoneMoveNotice(
  saved: { date: string | null; holders?: number } | null,
  savedZone: string | null,
  nextZone: string | null
): string | null {
  const holders = saved?.holders ?? 0;
  if (!saved?.date || !holders || !savedZone || !nextZone || savedZone === nextZone) return null;
  const before = new Date(saved.date);
  const after = zonedInputToInstant(instantToZonedInput(before, savedZone), nextZone);
  if (!after || after.getTime() === before.getTime()) return null;
  const who = holders === 1 ? '1 person already has' : `${holders} people already have`;
  const shift = after.getTime() - before.getTime();
  return `${who} this event at ${formatEventDateTime(before, savedZone)}. Here it becomes ${formatEventDateTime(after, nextZone)}, ${duration(shift)} ${shift > 0 ? 'later' : 'earlier'} for them. Let them know when you save.`;
}
