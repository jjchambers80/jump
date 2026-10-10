// Start–end time line for the event hero (spec 050 §8.2), in the venue's zone
// with the zone name always shown (spec 033 / gotcha 28):
//   same day      "4:00 – 8:00 PM EDT"
//   next day      "8:00 PM – Sun, Jun 2, 2031, 2:00 AM EDT"
//   DST in between "1:00 AM EDT – 3:00 AM EST"
// Built on lib/eventTime.ts so the zone rules stay in one place. Frontend-only:
// not part of the eventTime.ts ↔ eventTime.js parity pair.

import { DEFAULT_ZONE, formatEventDate, formatEventTime, zoneAbbreviation } from './eventTime';

type DateLike = Date | string | null | undefined;

const valid = (value: DateLike) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The time with its trailing zone name removed: "8:00 PM". */
const bareTime = (date: Date, zone: string | null | undefined) =>
  formatEventTime(date, zone).slice(0, -(zoneAbbreviation(date, zone).length + 1));

export function formatEventTimeRange(start: DateLike, end: DateLike, zone: string | null | undefined): string {
  const from = valid(start);
  if (!from) return '';
  const to = valid(end);
  if (!to || to <= from) return formatEventTime(from, zone);

  const fromZone = zoneAbbreviation(from, zone);
  const toZone = zoneAbbreviation(to, zone);
  const sameDay = formatEventDate(from, zone) === formatEventDate(to, zone);

  // A DST change mid-event: each end names its own zone.
  if (fromZone !== toZone) {
    const endText = sameDay ? formatEventTime(to, zone) : `${formatEventDate(to, zone)}, ${formatEventTime(to, zone)}`;
    return `${formatEventTime(from, zone)} – ${endText}`;
  }
  if (!sameDay) return `${bareTime(from, zone)} – ${formatEventDate(to, zone)}, ${formatEventTime(to, zone)}`;

  // Same day, same zone: Intl drops the shared AM/PM ("4:00 – 8:00 PM").
  // An unknown zone throws here; the fallback goes through eventTime's own guard.
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: zone || DEFAULT_ZONE, hour: 'numeric', minute: '2-digit' });
    const range = (format as Intl.DateTimeFormat & { formatRange(a: Date, b: Date): string }).formatRange(from, to);
    return `${range} ${fromZone}`;
  } catch {
    return `${bareTime(from, zone)} – ${formatEventTime(to, zone)}`;
  }
}
