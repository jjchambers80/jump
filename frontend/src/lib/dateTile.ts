import { formatEventDate } from './eventTime';

export interface DateTile {
  weekday: string;
  month: string;
  day: string;
  year: string;
}

/**
 * "Sat, Dec 26, 2026" → calendar-tile parts, in the venue's zone (spec 033).
 * Shared by the RSVP pass and the storefront event stubs.
 */
export function dateTile(date: string, zone?: string | null): DateTile | null {
  const match = formatEventDate(date, zone, { weekday: 'short', month: 'short' }).match(
    /^(\w+), (\w+) (\d+), (\d+)$/
  );
  return match ? { weekday: match[1], month: match[2], day: match[3], year: match[4] } : null;
}
