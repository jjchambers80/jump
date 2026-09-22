# Venue Time Zones

**Status**: Implemented (spec 033, phases 1–3)
**Last Updated**: 2026-09-22

## Overview

A show's wall clock belongs to its venue. "Doors 8pm" means 8pm *at the venue*, no matter who is looking at the page, so every event time in Jump is formatted with the venue's IANA zone — never the viewer's browser zone, and never the server's.

The organizer is not asked for that zone. It is derived from the venue's address and shown as a line of text next to it, with a picker behind **Change** for the rare address the derivation cannot place confidently.

## The bug this fixed

Before spec 033, `Venue.timezone` was stored, validated and shipped to the client, and **nothing formatted a date with it**:

| Surface | What it did |
|---|---|
| Storefront, checkout, ticket, confirmation | `toLocaleDateString` with no `timeZone` → the **buyer's browser zone** |
| Admin date entry | `<input type="datetime-local">` read with browser-local getters → the **organizer's browser zone**, stored as a UTC instant |
| Emails | printed no event date at all |
| Venue admin card | printed the raw IANA id — the field's only consumer |

A Denver 8:00 PM show entered by a New York organizer was stored as 8pm EST = **6pm MDT**, and an LA buyer's ticket read **5:00 PM**. Three different answers for one show, none of them the time printed on the door.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/utils/eventTime.js` | Format an instant in a zone; convert a `datetime-local` value to an instant and back |
| `frontend/src/lib/eventTime.ts` | **Parity mirror** of the above — same functions, same behaviour |
| `backend/tests/fixtures/eventTime.fixtures.json` | The one fixture both suites assert, including DST boundaries |
| `backend/src/utils/usTimeZones.js` | `resolveVenueTimeZone({ country, state, postalCode })` — state table + ZIP-prefix overrides |
| `frontend/src/lib/usTimeZones.ts` | **Parity mirror** of the resolver, so the form previews exactly what the backend stores |
| `backend/tests/fixtures/usTimeZones.fixtures.json` | The one derivation fixture both suites assert |
| `frontend/src/components/VenueTimeZoneField.tsx` | The read-only "Times" line, `Change`, and the confirm prompt |
| `frontend/src/components/TimeZoneSelect.tsx` | The IANA picker — now the override, not the primary input |
| `backend/src/services/VenueService.js` | `_resolveTimeZone`, the re-derive rule, `defaultTimeZoneFor` |
| `backend/src/scripts/backfill-venue-time-zones.js` | `npm run db:backfill:033` — decides `DERIVED` / `MANUAL` for pre-033 rows |
| `backend/src/scripts/reconcile-venue-time-zones.js` | `npm run report:033` — read-only report of which events change displayed time |
| `packages/db/prisma/schema.prisma` | `Venue.country`, `Venue.timezone`, `Venue.timezoneSource`, `VenueTimeZoneSource` |

## Three zones, three jobs

Jump stores three different time zones. They are not interchangeable:

| Field | Answers | Used for |
|---|---|---|
| `Venue.timezone` | "What time does the show start?" | Event dates, tier sale windows, tickets, storefront, emails |
| `Organization.timezone` (spec 021, not built) | "When does the org's day end?" | Tax-report and dashboard day boundaries |
| `User.timeZone` (spec 030) | "When did this happen, for me?" | Admin operational timestamps via `useAccountFormat()` |

Event times use the venue's. Operational timestamps — created at, paid at, session last seen — use the viewer's account zone. Never mix them.

## How derivation works

`resolveVenueTimeZone` returns `{ timezone, confident, reason }`.

1. **Not US** (`country !== 'US'`) → returns nothing. Jump has no worldwide resolver; a non-US venue picks its zone by hand.
2. **ZIP prefix override** → the first three digits decide, for the parts of a split state that do not follow the state's majority zone.
3. **State table** → 50 states, DC and the territories.
4. **Nothing to go on** → returns nothing; the caller falls back and leaves the source `DEFAULT`.

`confident: false` is not a failure. It means "this is the best guess, ask the organizer" and the UI shows **"Confirm the time zone — this address sits near a time zone line"** with the picker already open.

### Why a table and not a ZIP database

Forty of fifty states sit in exactly one zone. A 56-entry state table plus an explicit override list for the counties that straddle a line covers the country in a few hundred auditable lines, with no 40k-row dataset and no runtime API call — with a key, latency and a failure mode — inside the venue form.

Where a ZIP prefix genuinely straddles a line there is deliberately **no override**. Michigan's Upper Peninsula shares prefix 498 with Iron Mountain (Central) *and* Escanaba (Eastern), and 499 with Ironwood (Central) *and* Houghton (Eastern), so Michigan resolves to Eastern, not confident, and the organizer confirms. A visible question beats false precision: a silently wrong zone prints a wrong time on a ticket and someone misses a show.

Split regions covered: Arizona (the Navajo Nation observes DST), Indiana, Kentucky, Tennessee, the Florida panhandle, Kansas, Nebraska, the Dakotas, Texas (El Paso / Hudspeth), Oregon (Malheur County), Idaho (the panhandle), Nevada (West Wendover), Alaska, Michigan.

## Provenance: `timezoneSource`

| Value | Meaning | On an address edit |
|---|---|---|
| `DERIVED` | Resolved from the address | **Re-derives** |
| `MANUAL` | The organizer chose it | **Never** overwritten |
| `DEFAULT` | Never resolved — pre-033 rows, or nothing to resolve from | Re-derives once there is an address |

- Sending an explicit `timezone` marks the venue `MANUAL`.
- Sending `timezone: null` on a PATCH **drops the override and re-derives** — this is what the form's "Use the address instead" sends. Without it an organizer could pin a zone and never get back to the derived one.
- `country` defaults to `US` and is not an organizer-facing field. It exists so the resolver can decline rather than apply the US state table to a Toronto postcode.

`VenueService.defaultTimeZoneFor(organization)` is the single fallback point. When spec 021 adds `Organization.timezone` (its FR-007), that helper reads it and nothing else in this feature changes.

## The round trip

`<input type="datetime-local">` has no zone of its own — it is a wall clock. The event and tier-sale-window inputs read and write theirs through `instantToZonedInput` / `zonedInputToInstant` against the **selected venue's** zone, with the resolved zone in helper text under the field.

When the organizer changes the venue on an unsaved event, the typed wall clock is kept and the instant recomputed. Someone who types 8:00 PM and switches from a Denver venue to a Chicago one means 8:00 PM in Chicago; sliding the display to 9:00 PM would be the wrong read of intent.

Two DST edge cases, both fixture-covered:

- **Spring-forward gap** — 02:30 on 2026-03-08 in New York never happens; it resolves *forward* to 03:30 EDT.
- **Fall-back overlap** — 01:30 on 2026-11-01 happens twice; it resolves to the first, still-DST occurrence.

## Parity rule

Two pairs of files must stay behaviourally identical, the same standing rule as the fee libraries:

- `backend/src/utils/eventTime.js` ↔ `frontend/src/lib/eventTime.ts`
- `backend/src/utils/usTimeZones.js` ↔ `frontend/src/lib/usTimeZones.ts`

Each pair is asserted from **both** Jest and Vitest against one shared fixture file in `backend/tests/fixtures/`. Change one side without the other and a suite fails. This is not ceremony: the venue form previews the derived zone client-side and the backend stores it, so a divergence would show an organizer one zone and save another.

## Scripts

```bash
cd backend && npm run report:033              # read-only: which events change displayed time
cd backend && npm run db:backfill:033         # dry run: what the backfill would do
cd backend && npm run db:backfill:033 -- --apply
```

**`report:033`** exists because phase 1 reinterprets instants that were written under the old behaviour. Nothing recorded which browser zone each organizer typed in, so there is no safe automatic correction — the report lists the affected events and organizers edit the few that are genuinely wrong. Run it *before* deploying phase 1; it depends only on venue zones, so it is valid ahead of the deploy.

Against production, where `DATABASE_URL` points at an internal host and Railway's Postgres has no public proxy, run it inside the service:

```bash
railway ssh --service backend "node backend/src/scripts/reconcile-venue-time-zones.js"
```

**`db:backfill:033`** decides `DERIVED` vs `MANUAL` for pre-033 rows. The only signal available is whether the stored zone is still the schema default (`America/New_York`): if it is, nobody chose it, so derive; if it is not, somebody did, so keep the value and mark it `MANUAL`. Dry run by default; idempotent.

> A `db push` development database needs the phase-2 columns before either script will run (`P2022: Venue.country`). Run `npm run db:push` (or `db:migrate`) first.

## Production impact

The reconciliation report was run against production on 2026-09-22, before any of this shipped. All four production events were seed rows; the single event whose displayed time moved had **0 orders and 0 tickets**, and the only event with money against it was at a Raleigh venue on `America/New_York` and did not move. No customer had seen a time that phase 1 changed.

The same run confirmed all three production venues already stored the zone derivation would produce (`27601` NC → Eastern, `10001` NY → Eastern, `94115` CA → Pacific), so the venue backfill had nothing to correct either.

## Related

- [Tax Settings](tax-settings.md) — also keyed off the venue's state and postal code
- [Account Settings](account-settings.md) — `User.timeZone` and `useAccountFormat()`
- `specs/033-venue-time-zones/plan.md` — the plan, decisions and their reasoning
