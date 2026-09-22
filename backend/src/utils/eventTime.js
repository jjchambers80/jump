// Event times are wall-clock local to the venue (spec 033). "Doors 8pm" means
// 8pm at the venue no matter who is looking at it, so every event date is
// formatted with the venue's IANA zone and never with the viewer's.
//
// PARITY: this file and `frontend/src/lib/eventTime.ts` must behave
// identically — same rule as FeeService.js / fees.ts. Both are asserted
// against `backend/tests/fixtures/eventTime.fixtures.json`; change one side
// and the other's suite fails.
//
// Deliberately built on Intl alone: neither workspace carries a date library
// and the two directions below are the whole requirement.

const DEFAULT_ZONE = 'America/New_York';

/**
 * The offset of `zone` from UTC at a given instant, in minutes.
 * Positive east of Greenwich. Works by formatting the instant in the target
 * zone and reading the wall clock back as if it were UTC.
 */
function zoneOffsetMinutes(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const at = (type) => Number(parts.find((p) => p.type === type).value);
  // `hour` comes back as 24 at midnight under hour12:false in some runtimes.
  const asUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return (asUtc - date.getTime()) / 60000;
}

function toDate(value) {
  // `new Date(null)` is the epoch, not an error — guard explicitly so a missing
  // date renders as nothing rather than as 1 Jan 1970.
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeZone(zone) {
  if (!zone) return DEFAULT_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_ZONE;
  }
}

/**
 * The short zone name for an instant — "EST", "MDT", "AKST".
 * Tied to the instant, so it is DST-correct rather than a fixed label.
 */
export function zoneAbbreviation(value, zone) {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(zone),
    timeZoneName: 'short',
  }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * An event date rendered in the venue's zone, always carrying the zone name
 * (spec 033 D6): "Sat, Nov 8, 2026 · 8:00 PM MST".
 *
 * `options` overrides the date/time parts only — the zone name is not
 * optional, because these strings get printed, forwarded and screenshotted.
 */
export function formatEventDateTime(value, zone, options = {}) {
  const date = toDate(value);
  if (!date) return '';
  const resolved = safeZone(zone);

  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolved,
    weekday: options.weekday ?? 'short',
    year: options.year ?? 'numeric',
    month: options.month ?? 'short',
    day: options.day ?? 'numeric',
  }).format(date);

  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolved,
    hour: options.hour ?? 'numeric',
    minute: options.minute ?? '2-digit',
  }).format(date);

  return `${datePart} · ${timePart} ${zoneAbbreviation(date, resolved)}`;
}

/** Just the date, in the venue's zone: "Sat, Nov 8, 2026". */
export function formatEventDate(value, zone, options = {}) {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(zone),
    weekday: options.weekday ?? 'short',
    year: options.year ?? 'numeric',
    month: options.month ?? 'short',
    day: options.day ?? 'numeric',
  }).format(date);
}

/** Just the time, with its zone: "8:00 PM MST". */
export function formatEventTime(value, zone, options = {}) {
  const date = toDate(value);
  if (!date) return '';
  const resolved = safeZone(zone);
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolved,
    hour: options.hour ?? 'numeric',
    minute: options.minute ?? '2-digit',
  }).format(date);
  return `${timePart} ${zoneAbbreviation(date, resolved)}`;
}

/**
 * Instant → the value for an `<input type="datetime-local">` showing the
 * venue's wall clock: "2026-11-08T20:00".
 */
export function instantToZonedInput(value, zone) {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(zone),
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const at = (type) => parts.find((p) => p.type === type).value;
  const hour = String(Number(at('hour')) % 24).padStart(2, '0');
  return `${at('year')}-${at('month')}-${at('day')}T${hour}:${at('minute')}`;
}

/**
 * The value of a `<input type="datetime-local">`, read as the venue's wall
 * clock → the instant it names.
 *
 * Two passes: read the wall clock as if it were UTC, probe the zone's offset
 * at that rough instant, then re-probe at the corrected one. The second probe
 * matters only near a DST transition, where the two offsets differ.
 *
 * Two boundary cases, both intentional and both covered by the fixtures:
 *   - fall-back overlap (a wall clock that happens twice, e.g. 01:30 on
 *     2026-11-01 in New York) resolves to the first, still-DST occurrence;
 *   - spring-forward gap (a wall clock that never happens, e.g. 02:30 on
 *     2026-03-08 in New York) resolves *forward*, to 03:30 EDT. The two-pass
 *     result for a gap would land before the input rather than after it, so
 *     the round-trip is checked and the pre-transition offset kept instead.
 *     Nobody schedules a show inside the gap; landing after the missing hour
 *     is the less surprising of the two answers if they do.
 */
export function zonedInputToInstant(local, zone) {
  if (!local) return null;
  const normalized = local.length === 16 ? `${local}:00` : local;
  const naive = Date.parse(`${normalized}Z`);
  if (Number.isNaN(naive)) return null;

  const resolved = safeZone(zone);
  const firstOffset = zoneOffsetMinutes(new Date(naive), resolved) * 60000;
  const firstPass = new Date(naive - firstOffset);

  const secondOffset = zoneOffsetMinutes(firstPass, resolved) * 60000;
  if (secondOffset === firstOffset) return firstPass;

  const secondPass = new Date(naive - secondOffset);
  // A wall clock inside a spring-forward gap cannot round-trip. When it does
  // not, the second pass has walked backwards over the transition; keep the
  // first pass, which lands just after it.
  return instantToZonedInput(secondPass, resolved) === normalized.slice(0, 16) ? secondPass : firstPass;
}

export { DEFAULT_ZONE, zoneOffsetMinutes };
