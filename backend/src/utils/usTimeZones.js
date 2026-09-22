// Resolve a US venue's IANA time zone from its state and postal code (spec 033
// phase 2), so an organizer never has to type one.
//
// PARITY: this file and `frontend/src/lib/usTimeZones.ts` must behave
// identically — the venue form previews the result before saving and the
// backend stores it. Both are asserted against
// `backend/tests/fixtures/usTimeZones.fixtures.json`.
//
// WHY a state table and not a 40k-row ZIP dataset: forty of fifty states sit in
// exactly one zone, so the table below plus an explicit list of the counties
// that straddle a line covers the country in a few hundred auditable lines,
// with no runtime dependency inside the venue form. Where a state is split and
// the ZIP is not in the override list, the result is the state's majority zone
// marked NOT confident, and the UI asks the organizer to confirm rather than
// asserting a guess.

const DEFAULT_ZONE = 'America/New_York';

const EASTERN = 'America/New_York';
const CENTRAL = 'America/Chicago';
const MOUNTAIN = 'America/Denver';
const ARIZONA = 'America/Phoenix'; // Mountain standard time all year
const PACIFIC = 'America/Los_Angeles';
const ALASKA = 'America/Anchorage';
const HAWAII = 'Pacific/Honolulu';

/** The single or majority zone for each state, DC and the territories. */
const STATE_ZONES = {
  AL: CENTRAL, AK: ALASKA, AZ: ARIZONA, AR: CENTRAL, CA: PACIFIC,
  CO: MOUNTAIN, CT: EASTERN, DE: EASTERN, DC: EASTERN, FL: EASTERN,
  GA: EASTERN, HI: HAWAII, ID: MOUNTAIN, IL: CENTRAL, IN: EASTERN,
  IA: CENTRAL, KS: CENTRAL, KY: EASTERN, LA: CENTRAL, ME: EASTERN,
  MD: EASTERN, MA: EASTERN, MI: EASTERN, MN: CENTRAL, MS: CENTRAL,
  MO: CENTRAL, MT: MOUNTAIN, NE: CENTRAL, NV: PACIFIC, NH: EASTERN,
  NJ: EASTERN, NM: MOUNTAIN, NY: EASTERN, NC: EASTERN, ND: CENTRAL,
  OH: EASTERN, OK: CENTRAL, OR: PACIFIC, PA: EASTERN, RI: EASTERN,
  SC: EASTERN, SD: CENTRAL, TN: CENTRAL, TX: CENTRAL, UT: MOUNTAIN,
  VT: EASTERN, VA: EASTERN, WA: PACIFIC, WV: EASTERN, WI: CENTRAL,
  WY: MOUNTAIN,
  // Territories
  PR: 'America/Puerto_Rico',
  VI: 'America/St_Thomas',
  GU: 'Pacific/Guam',
  MP: 'Pacific/Saipan',
  AS: 'Pacific/Pago_Pago',
};

/**
 * States whose territory crosses a zone boundary. A venue in one of these is
 * only `confident` when its ZIP prefix appears in `ZIP_PREFIX_OVERRIDES`.
 */
const SPLIT_STATES = new Set([
  'AK', 'AZ', 'FL', 'ID', 'IN', 'KS', 'KY', 'MI', 'NE', 'ND', 'NV', 'OR', 'SD', 'TN', 'TX',
]);

/**
 * ZIP-prefix → zone for the parts of a split state that do NOT follow the
 * state's majority zone, plus the prefixes that confirm the majority side.
 * Keyed on the first three digits, which is how US ZIP geography is organised;
 * a prefix that spans the line is deliberately absent so the result stays
 * un-confident and the organizer confirms.
 */
const ZIP_PREFIX_OVERRIDES = {
  // ── Florida: the panhandle west of the Apalachicola River is Central ──
  323: EASTERN, // Tallahassee is Eastern, but 323 reaches the Apalachicola line → see SPANNING
  324: CENTRAL, // Panama City
  325: CENTRAL, // Pensacola
  326: EASTERN, // Gainesville
  327: EASTERN, // Orlando
  328: EASTERN, 329: EASTERN, 330: EASTERN, 331: EASTERN, 333: EASTERN,
  334: EASTERN, 335: EASTERN, 336: EASTERN, 337: EASTERN, 338: EASTERN,
  339: EASTERN, 341: EASTERN, 342: EASTERN, 344: EASTERN, 346: EASTERN,
  347: EASTERN, 349: EASTERN, 320: EASTERN, 321: EASTERN, 322: EASTERN,

  // ── Indiana: most of the state is Eastern; the northwest corner
  // (Gary/Hammond, Lake + Porter counties) and the southwest (Evansville)
  // are Central. Indiana also has Eastern zones with their own IANA ids,
  // but America/Indiana/Indianapolis matches America/New_York since 2006. ──
  463: CENTRAL, 464: CENTRAL, // Gary, Hammond
  474: CENTRAL, // Evansville
  460: EASTERN, 461: EASTERN, 462: EASTERN, 465: EASTERN, 466: EASTERN,
  467: EASTERN, 468: EASTERN, 469: EASTERN, 470: EASTERN, 471: EASTERN,
  472: EASTERN, 473: EASTERN, 475: EASTERN, 476: EASTERN, 477: EASTERN,
  478: EASTERN, 479: EASTERN,

  // ── Kentucky: eastern half Eastern, western half Central ──
  400: EASTERN, 401: EASTERN, 402: EASTERN, 403: EASTERN, 404: EASTERN,
  405: EASTERN, 406: EASTERN, 407: EASTERN, 408: EASTERN, 409: EASTERN,
  410: EASTERN, 411: EASTERN, 412: EASTERN, 413: EASTERN, 414: EASTERN,
  415: EASTERN, 416: EASTERN, 417: EASTERN, 418: EASTERN,
  420: CENTRAL, 421: CENTRAL, 422: CENTRAL, 423: CENTRAL, 424: CENTRAL,
  425: CENTRAL, 426: CENTRAL,
  427: EASTERN, // Somerset / Pulaski County is Eastern, and 427 reaches the line

  // ── Tennessee: east Tennessee is Eastern, middle and west are Central ──
  377: EASTERN, 378: EASTERN, 379: EASTERN, // Knoxville, Chattanooga
  370: CENTRAL, 371: CENTRAL, 372: CENTRAL, // Nashville
  373: CENTRAL, 374: CENTRAL, 376: CENTRAL,
  380: CENTRAL, 381: CENTRAL, 382: CENTRAL, 383: CENTRAL, 384: CENTRAL, 385: CENTRAL,

  // ── Texas: El Paso and Hudspeth counties are Mountain ──
  798: MOUNTAIN, 799: MOUNTAIN, // El Paso
  885: MOUNTAIN, // El Paso PO boxes

  // ── Kansas: four western counties are Mountain ──
  677: MOUNTAIN, 679: MOUNTAIN,

  // ── Nebraska: the western panhandle is Mountain ──
  691: MOUNTAIN, 693: MOUNTAIN,

  // ── North Dakota: the southwest corner is Mountain ──
  586: MOUNTAIN,

  // ── South Dakota: west river is Mountain ──
  577: MOUNTAIN, // Rapid City

  // ── Idaho: the panhandle north of the Salmon River is Pacific ──
  838: PACIFIC, // Coeur d'Alene, Moscow

  // ── Oregon: most of Malheur County is Mountain ──
  979: MOUNTAIN, // Ontario, Nyssa

  // ── Nevada: West Wendover follows Mountain ──
  898: MOUNTAIN,

  // ── Michigan: the four western Upper Peninsula counties are Central, but no
  // ZIP prefix separates them cleanly — 498 holds both Iron Mountain (Central)
  // and Escanaba (Eastern), 499 both Ironwood (Central) and Houghton (Eastern).
  // So Michigan has no override: an UP venue resolves to Eastern, not confident,
  // and the organizer confirms. Better a visible question than a wrong guess. ──

  // ── Arizona: the Navajo Nation observes DST, so it is Mountain proper ──
  865: MOUNTAIN, // Window Rock, Chinle — Navajo Nation

  // ── Alaska: the far west Aleutians are Hawaii-Aleutian ──
  995: ALASKA, 996: ALASKA, 997: ALASKA, 998: ALASKA,
  999: ALASKA, // Ketchikan etc. — Adak (99546) is Aleutian, see SPANNING
};

/**
 * ZIP prefixes known to straddle a zone line. Never confident, whatever the
 * table above says, because the answer genuinely depends on the street address.
 */
const SPANNING_PREFIXES = new Set([
  323, // Tallahassee area — the Apalachicola River runs through it
  474, // Evansville sits near the line
  427, // south-central Kentucky
  865, // parts of the Navajo/Hopi boundary keep Arizona time
  995, // Anchorage is Alaska time but 99546 Adak is Aleutian
]);

function normalizeState(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function zipPrefix(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length >= 3 ? Number(digits.slice(0, 3)) : null;
}

/**
 * Resolve a venue's time zone.
 *
 * @param {{ country?: string|null, state?: string|null, postalCode?: string|null }} venue
 * @returns {{ timezone: string|null, confident: boolean, reason: string }}
 *   `timezone` is null when nothing can be said — the caller falls back to the
 *   organization's zone and leaves the source DEFAULT. `confident` false means
 *   "this is a guess, ask the organizer to confirm".
 */
export function resolveVenueTimeZone({ country, state, postalCode } = {}) {
  const iso = normalizeState(country) || 'US';
  if (iso !== 'US') {
    // Deliberately no worldwide resolver: a non-US venue picks its zone by hand.
    return { timezone: null, confident: false, reason: 'NON_US' };
  }

  const prefix = zipPrefix(postalCode);
  const st = normalizeState(state);
  const stateZone = STATE_ZONES[st] ?? null;

  if (prefix !== null && Object.prototype.hasOwnProperty.call(ZIP_PREFIX_OVERRIDES, prefix)) {
    const zone = ZIP_PREFIX_OVERRIDES[prefix];
    // A state given alongside a ZIP that contradicts it means one of them is
    // wrong; trust neither without a look.
    if (st && stateZone && !SPLIT_STATES.has(st) && zone !== stateZone) {
      return { timezone: stateZone, confident: false, reason: 'ZIP_STATE_CONFLICT' };
    }
    if (SPANNING_PREFIXES.has(prefix)) {
      return { timezone: zone, confident: false, reason: 'ZIP_SPANS_BOUNDARY' };
    }
    return { timezone: zone, confident: true, reason: 'ZIP' };
  }

  if (stateZone) {
    if (SPLIT_STATES.has(st)) {
      // Right for most of the state, but this one needs a human.
      return { timezone: stateZone, confident: false, reason: 'SPLIT_STATE' };
    }
    return { timezone: stateZone, confident: true, reason: 'STATE' };
  }

  return { timezone: null, confident: false, reason: 'UNKNOWN' };
}

export { DEFAULT_ZONE, STATE_ZONES, SPLIT_STATES };
