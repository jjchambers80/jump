# Spec 033 — Venue time zones: make them authoritative, then invisible

Status: **Implemented** · Written 2026-09-22 · Open decisions resolved 2026-09-22 (§9) · All three phases built 2026-09-22 (PRs #137, #138, #139) · Supersedes nothing · Related: 021 (store defaults), 030 (account time zone)

## 1. Problem

`Venue.timezone` exists, is validated, and is shipped to the frontend. **Nothing formats a date with it.**

Audit of the current code:

| Surface | File | What it actually does |
|---|---|---|
| Storefront event page | `frontend/src/app/events/[eventId]/EventDetailClient.tsx:217-226` | `toLocaleDateString` with no `timeZone` — renders in the **buyer's browser zone** |
| Event card | `frontend/src/components/EventCard.tsx:31-42` | same |
| Checkout | `frontend/src/app/checkout/[eventId]/page.tsx:333-343` | same |
| Confirmation | `frontend/src/app/confirmation/page.tsx:229-239` | same |
| Ticket | `frontend/src/components/TicketDisplay.tsx:22-32` | same |
| Admin date entry | `frontend/src/app/admin/events/new/page.tsx:335`, `[eventId]/edit/page.tsx:660` | `<input type="datetime-local">` read through `toDatetimeLocal` (`edit/page.tsx:160`, uses `getHours()`/`getDate()`) — interpreted in the **organizer's browser zone**, stored as a UTC instant |
| Receipt / cancellation email | `backend/src/services/EmailService.js:430-443, 533` | names the event but prints no event date; `order.paidAt` is hardcoded `timeZone: 'UTC'` |
| Venue admin card | `frontend/src/app/admin/venues/page.tsx:430` | prints the raw IANA id as a badge — the field's only consumer |

Consequence: a Denver 8:00 PM show entered by a New York organizer is stored as 8pm EST = **6pm MDT**, and an LA buyer's ticket reads **5:00 PM**. Three different wrong answers for one show, none of them the time printed on the door.

Ticketing is wall-clock local by nature: "doors 8pm" means 8pm *at the venue*, independent of who is looking. Without a venue zone there is no anchor to convert the stored instant back into the number on the ticket. So the column stays; the **form field** is what should go away — organizers do not think about IANA identifiers and should not have to.

## 2. Goals

1. Every event-time surface (storefront, checkout, ticket, confirmation, email, admin) renders in the venue's zone, with the zone named where it matters.
2. Event date and tier sale windows round-trip through the admin form in the venue's zone, not the organizer's browser zone.
3. The organizer never types a time zone. It is derived from the venue's postal code and state, shown as a confirmable line of text, and overridable.

## 3. Non-goals

- International *derivation*. `Venue.country` is added in phase 2 (§9.2) and derivation is gated on `US`; non-US venues fall through to the manual picker. Building a worldwide postal-code → zone resolver is out of scope.
- Per-event zone override. Events inherit the venue's zone; a venue is in exactly one place.
- Changing `Organization.timezone` (spec 021). See §8.
- Changing `User.timeZone` (spec 030). Account zone stays the right choice for operational timestamps (created at, paid at, session last seen) — those are "when did this happen to me", not "when does the show start".

## 4. Decisions

**D1. Derive and display, not derive and hide.** The resolved zone is always visible as read-only text next to the address, with a `Change` affordance:

```
Address   1510 Clarkson St, Denver, CO 80218
Times     Mountain Time (Denver)  ·  Change
```

ZIP→time zone is ~99.9% right, not 100%. Real splits exist in Arizona (Navajo Nation observes DST), Indiana, Kentucky, Tennessee, Florida's panhandle, Kansas, Nebraska, the Dakotas, Texas (El Paso/Hudspeth), Oregon (Malheur County), Idaho, Nevada (West Wendover), Michigan's western UP, and Alaska. The failure cost is asymmetric: a silently wrong zone prints a wrong time on a ticket and someone misses a show. One always-visible line of text is cheap insurance.

**D2. `TimeZoneSelect` survives.** The component merged in PR #136 becomes the override behind `Change`, not the primary input. No work is thrown away.

**D3. No date library.** The project hand-rolls `backend/src/utils/locales.js` and `frontend/src/lib/timeZones.ts` on `Intl`; neither workspace has `date-fns`, `luxon`, or a Temporal polyfill. Keep it that way — `Intl.DateTimeFormat` with an explicit `timeZone` covers formatting, and the local→instant direction is a short, testable offset-probe helper (§6.1).

**D4. Track provenance on the row.** `Venue.timezoneSource` mirrors the existing `Event.taxRateSource` pattern so a later address edit knows whether it may re-derive.

**D5. State table + ZIP overrides, not a bundled ZIP database.** Forty of fifty states are single-zone. A 50-entry state map plus an explicit override list for the split counties is a few hundred auditable lines, versus a ~40k-row dataset or a runtime API call with a key, latency, and a failure mode inside the venue form. When the state is split and the ZIP is not in the override list, fall back to the state's majority zone and mark the result **not confident** so the UI asks for confirmation instead of asserting.

**D6. The zone abbreviation is always rendered, on every surface.** "Sat, Nov 8 · 8:00 PM MST" on tickets, emails, storefront, event cards and admin rows alike — one rule, no conditional.

The obvious alternative was to hide the abbreviation when the venue zone matches the viewer's, keeping dense rows tight. It was rejected on a technical ground: "does it differ from the viewer's zone" is only answerable in the browser, and these pages server-render. Every such site would have to either hydration-mismatch or render without the abbreviation and flash it in after mount — a visible jitter on exactly the rows the conditional was meant to keep tidy. Four extra characters is the cheaper trade.

## 5. Phases

Three phases, three worktrees, merged in order. Phase 1 is the correctness fix and carries all the risk; phases 2 and 3 are the UX payoff.

---

### Phase 1 — The venue zone becomes authoritative

No change to what the organizer types yet. Only interpretation and display.

**New shared modules (parity-locked pair, same rule as `frontend/src/lib/fees.ts` ↔ `backend/src/services/FeeService.js`):**

- `backend/src/utils/eventTime.js`
- `frontend/src/lib/eventTime.ts`

Both export the same four functions over the same fixture file:

| Function | Purpose |
|---|---|
| `formatEventDateTime(iso, timeZone, options)` | "Sat, Nov 8, 2026 · 8:00 PM MST" |
| `zoneAbbreviation(iso, timeZone)` | `"MST"` — via `timeZoneName: 'short'`, DST-correct for the given instant |
| `instantToZonedInput(iso, timeZone)` | `"2026-11-08T20:00"` for a `datetime-local` value |
| `zonedInputToInstant(local, timeZone)` | `"2026-11-09T03:00:00.000Z"` |

**Backend changes**

- Include `venue.timezone` in every payload that carries an event date, not just event detail: `EventService.js` list payloads, `backend/src/utils/eventSummary.js:13`, `TicketService.js:221` and `:886`, the order serializers, and the application serializers.
- `EmailService.js`: add the event date, formatted in the venue zone with its abbreviation, to the cancellation email and the order receipt. Additive — no email prints an event date today. Leave `order.paidAt` on UTC for now; it is an operational timestamp, and changing it belongs to spec 021.
- `QRService.js:73-86` computes ticket-JWT expiry from the event date as an instant. Instant arithmetic is zone-independent, so **no change** — but confirm the grace window still covers a late show in the westernmost supported zone.
- `adminValidators.js:44` and `:168` compare `eventDate <= new Date()`. Instant comparison, correct as written. No change.
- Drive-by: `EventService.js` sets `slug` twice in the same venue object literal (~lines 729 and 731). Harmless, delete the duplicate.

**Frontend changes**

Event-time renders move to `formatEventDateTime` with the venue's zone:

- Buyer-facing: `EventCard.tsx:31-42`, `EventDetailClient.tsx:217-229`, `checkout/[eventId]/page.tsx:333-343`, `confirmation/page.tsx:229-239`, `TicketDisplay.tsx:22-32`, `orders/[orderId]/page.tsx:291`, `orders/lookup/page.tsx:200`, `organizations/[orgId]/account/page.tsx:429,466`, `account/ApplicationsSection.tsx:96`, `events/[eventId]/apply/ApplyShell.tsx:99`
- Admin: `admin/events/page.tsx:255`, `admin/dashboard/page.tsx:186`, `admin/orders/[orderId]/page.tsx:383`, `admin/orders/TicketRowsView.tsx:379`, `admin/analytics/page.tsx:241`, `admin/events/[eventId]/analytics/page.tsx:203`, `admin/customers/[contactId]/page.tsx:715`, `customers/[contactId]/UpcomingTickets.tsx:77`, `admin/participants/applications/page.tsx:134`, `components/applications/SubmissionsTable.tsx:553`, `admin/maps/page.tsx:219`

The abbreviation appears on **every** one of them (D6) — tickets, confirmation, order detail and emails because they get printed, screenshotted and forwarded and must stand alone; cards and admin rows because the alternative needs a browser-only fact on a server-rendered page. `formatEventDateTime` includes it by default, so no call site has to decide.

**The round-trip (the subtle part)**

`admin/events/new/page.tsx:335`, `admin/events/[eventId]/edit/page.tsx:660` and `:160`, `DuplicateEventDialog.tsx:60`, and the tier sale windows in `TierEditDialog.tsx:300,309` all read and write `datetime-local` through browser-local getters. Replace with `instantToZonedInput` / `zonedInputToInstant` against the selected venue's zone, and put the resolved zone in helper text under the field: *"8:00 PM Mountain Time (Denver)"*.

Sale windows are venue-local too — an organizer setting "sales end at midnight" means midnight at the venue.

**When the organizer changes the venue on an unsaved event, keep the wall-clock they typed and recompute the instant.** Someone who typed 8:00 PM and then switched from a Denver venue to a Chicago one means 8:00 PM in Chicago. Silently sliding the displayed time to 9:00 PM is the wrong read of intent and is the kind of bug that only shows up in production.

---

### Phase 2 — Derive the zone, retire the input

**Schema** (`packages/db/prisma/schema.prisma`):

```prisma
model Venue {
  // ...
  country        String              @default("US")   // ISO 3166-1 alpha-2
  timezone       String              @default("America/New_York")
  timezoneSource VenueTimeZoneSource @default(DEFAULT)
}

enum VenueTimeZoneSource {
  DERIVED   // resolved from postal code / state
  MANUAL    // organizer chose it explicitly
  DEFAULT   // never resolved — pre-033 rows
}
```

`country` is added now (§9.2) so derivation has something to gate on rather than assuming every venue is American. It is **not** a new organizer-facing field in this spec: it defaults to `US`, the migration backfills every existing row to `US`, and the venue form shows a country select only once a non-US venue is actually needed. The point is that the resolver can answer "should I even try?" instead of silently applying a US state table to a Toronto address.

**Derivation** — `backend/src/utils/usTimeZones.js` + parity mirror `frontend/src/lib/usTimeZones.ts`:

- `STATE_ZONES`: 50 states + DC + PR/VI/GU/AS/MP.
- `ZIP_OVERRIDES`: explicit 5-digit ZIPs and ZIP ranges for the split regions listed in D1.
- `resolveVenueTimeZone({ country, postalCode, state })` → `{ timezone, source, confident }`.
- `country !== 'US'` → return `{ timezone: null, confident: false }`. The UI then shows the picker directly with no guess, and the saved value is `MANUAL`.

**Service** (`backend/src/services/VenueService.js:30, 183`):

- Create with no `timezone` in the body → derive, store `DERIVED`.
- Create or update with an explicit `timezone` → store `MANUAL`.
- Address, state, postal-code or country edit → re-derive **only** when `timezoneSource !== 'MANUAL'`.
- Derivation returns nothing (non-US, or no postal code yet) → fall back per §9.4 and leave the source `DEFAULT`, so a later edit can still resolve it.

The API contract does not change: `timezone` stays an optional, `isValidTimeZone`-checked field on both venue validators (`venueValidators.js:63, 117`). `country` joins `VENUE_FIELDS` (`venueValidators.js:12`) as an optional ISO-3166 alpha-2 string. Existing integrations keep working.

**UI** (`frontend/src/components/VenueFlyout.tsx`, `frontend/src/app/admin/venues/page.tsx:292`):

- Replace the `TimeZoneSelect` field with the read-only line from D1, deriving client-side so it updates live as the ZIP is typed, before save.
- `Change` reveals the existing `TimeZoneSelect`; choosing a value marks the venue `MANUAL`.
- When `confident === false`, render *"Confirm the time zone"* with the picker already open rather than asserting a guess.
- Venue card badge (`admin/venues/page.tsx:430`) shows the friendly label — "Mountain Time (Denver)" — not the raw IANA id.

---

### Phase 3 — Backfill, reconcile, document

**Venue backfill** — `packages/db` script `db:backfill:033`:

- `timezoneSource = DEFAULT` **and** stored value is exactly the schema default `America/New_York` → treat as never-chosen: write the derived zone, set `DERIVED`.
- `timezoneSource = DEFAULT` **and** stored value is anything else → someone set it deliberately: set `MANUAL`, leave the value alone.

**Event instant reconciliation (§7.1, §9.3).** A read-only report, never a rewrite. For every future event whose venue zone differs from `America/New_York`, print the stored instant, the old browser-zone reading, and the new venue-zone reading, as a table an organizer can scan:

```
Event                    Venue            Stored (UTC)          Was shown    Now shows   Δ
Fall Market              Denver Expo      2026-11-09T01:00Z     8:00 PM EST  6:00 PM MST  -2h
```

Organizers confirm the list; anything genuinely wrong is fixed by editing the event, which now round-trips correctly. Deliberately not a migration — there is no record of the creating browser zone, so a "correction" would be a guess (§9.3).

**Already run, 2026-09-22** (§7.1). It is read-only and depends only on the venue zones, so it was run against production before any implementation started. One affected event, seed data, zero orders, zero tickets — phase 1 changes nothing a customer has seen, and the venue backfill has nothing to correct. Re-run it if production gains real events before phase 1 lands; otherwise this phase-3 item is already satisfied and only the script needs landing.

**Docs.** `/doc-feature` → `docs/wiki/features/venue-time-zones.md`. New gotcha in the root `AGENTS.md` covering the `eventTime` parity pair and the "event time is venue-local, operational timestamps are account-local" rule. Note in `backend/AGENTS.md` for `resolveVenueTimeZone` and `timezoneSource`.

## 6. Implementation notes

### 6.1 Local → instant without a library

`Intl` converts instant → zoned for free. The other direction needs one offset probe, plus a re-check because the offset at the guessed instant can differ from the offset at the true instant across a DST boundary:

```js
function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const at = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return asUtc - instant.getTime();
}

export function zonedInputToInstant(local, timeZone) {
  const naive = Date.parse(`${local}:00Z`);          // read the wall clock as if UTC
  const first = zoneOffsetMs(new Date(naive), timeZone);
  const second = zoneOffsetMs(new Date(naive - first), timeZone);
  return new Date(naive - second);
}
```

Two documented edge cases, both needing a test:

- **Spring-forward gap** (2:30 AM on 2026-03-08 in `America/New_York` does not exist) — this resolves forward to 3:30 AM EDT. Acceptable; no show is scheduled in the gap.
- **Fall-back overlap** (1:30 AM on 2026-11-01 happens twice) — resolves to the first, DST, occurrence. Also acceptable, and the convention every major library uses.

### 6.2 Parity enforcement

`frontend/src/lib/eventTime.ts` and `backend/src/utils/eventTime.js` must stay behaviourally identical, the same standing rule as the fee libraries (root `AGENTS.md` gotcha 12). Ship one shared fixture file of `(instant, zone, expected)` triples and assert it from both the Jest and the Vitest suite, so a change to one side without the other fails CI.

## 7. Risks

### 7.1 Phase 1 visibly shifts times on existing events — **measured 2026-09-22, risk retired**

Every `Event.date` currently in the database was written under the old browser-zone reading. The moment phase 1 ships, any event whose venue zone differs from its creator's browser zone renders at a different time than it did yesterday. The new reading is the correct one, but it is a user-visible change to live listings.

The reconciliation report (§5 phase 3) was run against production on 2026-09-22, read-only, ahead of any implementation. Result:

```
Events total: 4   future: 4   affected: 1

Event                  Venue         Stored (UTC)          Was shown            Now shows            Delta
Comedy Night Special   The Fillmore  2026-12-07T23:45:08Z  Dec 07, 6:45 PM EST  Dec 07, 3:45 PM PST  -3h
```

All four production events are seed rows — created within the same millisecond on 2026-09-07 at `22:45:08`, dated 30/60/90 days out at that same clock time. The single affected event, *Comedy Night Special* at The Fillmore (San Francisco), has **0 orders and 0 tickets**.

The one event with real money against it — *2026 Game and Geek Expo*, 8 orders, 9 tickets — is at a Raleigh venue on `America/New_York`, identical to the organizer's zone, so it does not move.

**Conclusion: phase 1 changes no time any customer has ever seen.** No reconciliation is needed before it merges, and no organizer has to confirm anything. Re-run the report if production gains events before phase 1 lands.

The same run also checked the phase 2 assumption: all three production venues already store the zone that derivation would produce (`27601` NC → Eastern, `10001` NY → Eastern, `94115` CA → Pacific), so the phase 3 venue backfill has nothing to correct either.

### 7.2 Derivation is wrong for a split-county venue

Mitigated by D1 (always-visible line), the `confident` flag, and `MANUAL` provenance. Worst case the organizer clicks `Change` once.

### 7.3 Scope

Phase 1 touches roughly twenty render sites. They are mechanical, but they are spread across storefront, admin, and buyer-account surfaces, and each one needs the venue zone threaded into its payload. Budget for the payload plumbing, not the formatting calls.

## 8. Relationship to spec 021

Spec 021 proposes `Organization.timezone` as a store default. These are different jobs and both should exist:

| Field | Answers | Used for |
|---|---|---|
| `Venue.timezone` | "What time does the show start?" | Event dates, sale windows, tickets, storefront, emails |
| `Organization.timezone` (021) | "When does the org's day end?" | Tax-report and dashboard day boundaries, reporting |
| `User.timeZone` (030) | "When did this happen, for me?" | Admin operational timestamps via `useAccountFormat()` |

021 must not absorb this spec, and this spec must not pre-empt 021's day-boundary work. The one live question is §9.4.

## 9. Decisions (resolved 2026-09-22)

**9.1 Abbreviation policy — always-on, everywhere.** See D6. `formatEventDateTime` emits the abbreviation by default; no call site opts in or out. The differ-only variant was rejected because the comparison needs the viewer's browser zone on server-rendered pages.

**9.2 `Venue.country` — add it now, in phase 2.** Defaults to `US`, backfilled to `US`, no new form field until a non-US venue exists. It exists so `resolveVenueTimeZone` can decline rather than misapply a US state table to a foreign address. Schema and resolver behaviour in §5 phase 2.

**9.3 Existing event instants — report only.** Phase 3 emits a read-only reconciliation report; nothing is rewritten. Auto-correction would need each event's creating browser zone, which was never recorded, so any "correction" would be a guess dressed as a migration. Organizers confirm from the report and fix outliers by editing the event.

**9.4 Default fallback — `Organization.timezone` when 021 lands, `America/New_York` until then.** Resolution order when derivation yields nothing:

```
derived from country + postal code + state
  → Organization.timezone        (once spec 021 adds it)
  → "America/New_York"           (schema default, today)
```

Implement it as a single `defaultVenueTimeZone(organization)` helper in `VenueService` now, reading only the hardcoded default. When 021 ships, that helper gains one line and nothing else in this spec changes. Note the dependency in 021's plan so it is not missed.

## 10. Test plan

**Backend unit**
- `eventTime.js` round-trips across the 2026 spring-forward and fall-back boundaries in `America/New_York` and `America/Denver`, plus `America/Phoenix` (no DST) and `America/Indiana/Indianapolis`.
- `formatEventDateTime` always includes the abbreviation (§9.1) — assert it for a same-zone case, not only a cross-zone one.
- `resolveVenueTimeZone` returns the right zone and `confident` flag for one ZIP in each split region, plus a single-zone control.
- `resolveVenueTimeZone` with `country: 'CA'` returns no zone and `confident: false` (§9.2) — it must not apply the state table to a foreign address.
- `defaultVenueTimeZone` returns `America/New_York` today (§9.4); the test is written so 021 only has to change the expectation.

**Backend contract**
- `POST /admin/venues` with a Denver ZIP and no `timezone` → `America/Denver`, `DERIVED`.
- Same with explicit `timezone` → stored verbatim, `MANUAL`.
- `PATCH` the address of a `DERIVED` venue → re-derives; of a `MANUAL` venue → does not.
- A venue with no postal code → `America/New_York`, source stays `DEFAULT` so a later edit can still resolve it (§9.4).
- Event detail, ticket, and order payloads all carry `venue.timezone`.

**Frontend Vitest**
- `lib/eventTime.ts` against the shared fixture file (§6.2).

**Playwright**
- With `timezoneId: 'America/New_York'`, create an event at a Denver venue for 8:00 PM, then load the storefront and assert it reads **8:00 PM MST** — the regression test for the whole spec.
- Venue flyout: typing a Denver ZIP updates the Times line to "Mountain Time (Denver)" without a save.

## 10a. What shipped

| Phase | PR | Contents |
|---|---|---|
| 1 | #137 | `eventTime` parity pair + shared fixture; venue zone threaded into every event-date payload; ~20 render sites; event and tier-sale-window inputs round-trip in the venue zone; event date added to the cancellation and receipt emails; duplicate `slug` key removed |
| 2 | #138 | `usTimeZones` parity pair + shared fixture; `Venue.country` + `Venue.timezoneSource` + migration `20261007100000`; `VenueTimeZoneField` replaces the picker; `timezone: null` clears an override; `defaultTimeZoneFor` fallback point |
| 3 | #139 | `db:backfill:033`, `report:033`, wiki page, agent-instruction gotchas |

Three findings worth keeping, all surfaced by the tests rather than by review:

1. **The `eventTime` fixture caught a parity bug on day one** — the backend accepted `null` where `new Date(null)` is the epoch, so a missing date would have rendered as *1 Jan 1970*. The frontend had guarded it.
2. **The contract test found a third `event:` serializer** in `TicketService` that §5's file list had missed.
3. **The derivation fixture killed a false ZIP override.** The first pass claimed Michigan prefix 499 was Central; in fact 498 holds Iron Mountain (Central) *and* Escanaba (Eastern), and 499 holds Ironwood (Central) *and* Houghton (Eastern). No prefix separates the UP cleanly, so Michigan has no override and resolves un-confidently — a visible question instead of false precision. D5's "where a prefix spans the line, leave it out" rule earned itself.

And one design gap the contract test exposed: **"Use the address instead" would have been a dead button.** The UI sent a null zone, the client omitted the key, and the backend kept the venue `MANUAL` forever — an organizer could pin a zone and never get back to the derived one. `timezone: null` now clears the override explicitly, wired through both sides.

### Deviations from the plan

- §5 phase 2 proposed ZIP overrides for Michigan's UP; they were dropped (above).
- §5 phase 1 proposed `order.paidAt` stay on UTC — unchanged, as planned.
- The reconciliation report was run **before** phase 1 was written rather than in phase 3 (§7.1 asked for exactly this); phase 3 lands the script that produced it.

## 11. Kanban

Three cards on board `jump`, one worktree each, merged in order:

- **JUMP-033A** — Phase 1, venue zone authoritative (`feat/033-venue-time-zones-phase-1`)
- **JUMP-033B** — Phase 2, derivation + read-only line (`feat/033-venue-time-zones-phase-2`, parent 033A)
- **JUMP-033C** — Phase 3, backfill + reconciliation report + docs (`feat/033-venue-time-zones-phase-3`, parent 033B)

Each card's completion contract is a PR with green required checks (backend unit + contract, frontend typecheck + unit, migration safety).
