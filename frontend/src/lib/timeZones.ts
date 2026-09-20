// IANA time-zone options for the account time-zone picker (spec 030).

export interface TimeZoneOption {
  id: string;
  /** "America/New_York" → "New York" */
  city: string;
  /** "America/New_York" → "America" */
  region: string;
  /** "GMT-04:00" at the given instant. */
  offset: string;
  /** Minutes east of UTC, for sorting. */
  offsetMinutes: number;
}

const FALLBACK_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/** Every zone the runtime knows, or a short fallback list on older engines. */
export function listTimeZoneIds(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const ids = intl.supportedValuesOf?.('timeZone');
    if (ids && ids.length) return ids;
  } catch {
    // fall through
  }
  return FALLBACK_ZONES;
}

/** Offset in minutes east of UTC for `zone` at `at`. */
export function offsetMinutesFor(zone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${hh}:${mm}`;
}

export function describeTimeZone(id: string, at: Date = new Date()): TimeZoneOption {
  const [region, ...rest] = id.split('/');
  const city = (rest.length ? rest.join(' / ') : id).replace(/_/g, ' ');
  let offsetMinutes = 0;
  try {
    offsetMinutes = offsetMinutesFor(id, at);
  } catch {
    // unknown zone: leave at 0
  }
  return { id, city, region: rest.length ? region : 'Other', offset: formatOffset(offsetMinutes), offsetMinutes };
}

/** Options sorted by offset then name. */
export function timeZoneOptions(at: Date = new Date()): TimeZoneOption[] {
  return listTimeZoneIds()
    .map((id) => describeTimeZone(id, at))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id));
}

/** The browser's zone, or null when unavailable. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** "New York (GMT-04:00)" for display in summaries. */
export function timeZoneLabel(id: string, at: Date = new Date()): string {
  const option = describeTimeZone(id, at);
  return `${option.city} (${option.offset})`;
}
