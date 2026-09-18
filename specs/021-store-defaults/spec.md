# Feature Specification: Settings › General › Store defaults

**Feature Branch**: `plan/021-store-defaults` (not yet created)  
**Created**: 2026-09-18  
**Status**: Proposed — not planned, not built  
**Input**: Organizer request 2026-09-18 (session [01158zLwVnUE4g159VJBFE7w](https://claude.ai/code/session_01158zLwVnUE4g159VJBFE7w)): add a **Store defaults** section to Settings › General, placed under **Store contact details**, modelled on the Shopify "Store defaults" card (reference screenshot: `docs/research/shopify-store-defaults.png`, captured 2026-09-18 from Shopify admin › Settings › General). **Unit system** and **Default weight unit** are excluded — Jump ships nothing physical. **Currency display** is fixed to US Dollar (USD $) because the MVP does not sell outside the United States.  
**Builds on**: spec 004 admin area (Settings), spec 007 tenant identity (`Organization` business details, `X-Jump-Org` scope), spec 009 tax report, spec 011 phase 3 daily digest, Settings UI patterns from specs 008–010.

## Problem

Settings › General today holds **Business details** and **Store contact details** (`frontend/src/app/admin/settings/page.tsx`). Nothing on the page says which currency the store sells in, which region its settings are for, or which clock the store keeps. Those defaults exist, but they are scattered and implicit:

- **Currency** is hard-coded to `'usd'` at every Stripe call site (`OrderService.js`, `ApplicationPaymentService.js`, `TaxService.js`) and to `en-US` / `USD` in every admin `formatCurrency` helper. Organizers cannot see this anywhere.
- **Region** is only inferable from the business address `countryCode` (locked to `US`, spec 007). There is no store-level statement of "settings for customers apply as if they were in the United States".
- **Time zone** is per venue (`Venue.timezone`, default `America/New_York`) and used for event times only. Everything organization-wide runs on UTC: the tax report's date-only `from` / `to` bounds are parsed as `T00:00:00Z` / `T23:59:59.999Z` (`taxValidators.js`), CSV export filenames stamp the UTC date (`admin.js`), the daily application digest window is a rolling 24 h from the last send, and admin lists render timestamps in whatever zone the viewer's browser is in. An organizer in Raleigh pulling "September 1 – September 30" gets a report that starts at 8 pm on August 31 local time and two staff in different zones see different order times for the same order.

Shopify solves this with one card that names the currency, the backup region and the store time zone. Jump needs the same card, minus the physical-goods fields, with the currency locked for the MVP.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organizer sees the store's defaults (Priority: P1)

An ORGANIZER opens Settings › General and, below **Store contact details**, sees a **Store defaults** card with three rows: **Currency display** (read-only pill "US Dollar (USD $)" with the helper "Jump sells in US dollars. Other currencies are not available yet."), **Backup region** (select, "United States", helper "Determines settings for customers outside of your markets"), and **Time zone** (select, "(GMT-05:00) Eastern Time (US & Canada)", helper "Sets the time for when orders and analytics are recorded"). The card loads with the rest of the page from `GET /admin/settings/business-details`.

**Why this priority**: This is the request. The card makes the existing defaults visible before anything about them changes.

**Independent Test**: `GET /admin/settings/business-details` returns `currency: 'usd'`, `backupRegion: 'US'`, `timezone: 'America/New_York'` for a fresh organization. The page renders the three rows with those values; the currency row has no editor.

**Acceptance Scenarios**:
1. **Given** a fresh organization, **When** the organizer opens Settings › General, **Then** the Store defaults card sits directly under Store contact details and shows USD, United States and Eastern Time.
2. **Given** the currency row, **When** the organizer looks for a way to change it, **Then** there is none: no menu, no dialog, and the helper text explains why.
3. **Given** the Store defaults card, **When** the page is opened on a 375 px viewport, **Then** the selects stack full-width and nothing overflows horizontally (matches the existing mobile test in `frontend/e2e/admin-settings.spec.ts`).

---

### User Story 2 — Organizer sets the store time zone (Priority: P1)

The organizer changes **Time zone** to "(GMT-08:00) Pacific Time (US & Canada)" and clicks **Save**. The save bar appears when a value differs from what was loaded, disables while saving, and disappears after success with a polite live-region announcement ("Store defaults saved."). Reloading the page shows the new zone. The tax report, the dashboard's day boundaries and the daily digest now use that zone.

**Why this priority**: Time zone is the only default in the card that has a real effect the organizer can feel today (the tax report bug in *Problem*), and it is the field the screenshot puts last for a reason: it is the one that is wrong when left unset.

**Independent Test**: `PATCH /admin/settings/business-details { timezone: 'America/Los_Angeles' }` returns the updated details; `PATCH { timezone: 'Mars/Olympus' }` returns 400 "Time zone must be a valid IANA time zone"; `GET /admin/settings/tax/report?from=2026-09-01&to=2026-09-30` afterwards uses `2026-09-01T07:00:00.000Z` … `2026-10-01T06:59:59.999Z` as its bounds (`report.from` / `report.to` in the JSON).

**Acceptance Scenarios**:
1. **Given** the time zone select, **When** it is opened, **Then** it lists the IANA zones the platform supports, labelled with their current UTC offset and a friendly name (`(GMT-05:00) Eastern Time (US & Canada)`), US and territories first, then the rest of the IANA list grouped by region.
2. **Given** a changed value, **When** the organizer navigates away without saving, **Then** the same "Discard unsaved changes?" confirmation used by the store contact dialog appears.
3. **Given** the tax report page, **When** the organizer picks September 1 – 30 in a store set to Pacific Time, **Then** the JSON and CSV cover local midnight to local end of day, and the CSV filename stamps the local dates.
4. **Given** the dashboard stats, **When** "today" and "last 7 days" are computed, **Then** the day boundaries are local to the store time zone, not UTC.
5. **Given** a new venue created without a `timezone`, **When** it is saved, **Then** it defaults to the store time zone rather than the hard-coded `America/New_York`.
6. **Given** admin order, application and customer lists, **When** timestamps render, **Then** they render in the store time zone with the zone abbreviation on hover (title), so two staff in different zones see the same time.

---

### User Story 3 — Organizer sets the backup region (Priority: P2)

The organizer opens **Backup region**, sees **United States** as the only option, and leaves it. The value is stored so that when markets or a second region arrive it already has a home, and the tax and payment code has one place to read "which region's rules apply when nothing more specific matches".

**Why this priority**: The organizer asked for the field. Its only MVP value is `US`; the point of shipping it now is to reserve the concept and the column, not to enable a choice.

**Independent Test**: `PATCH /admin/settings/business-details { backupRegion: 'us' }` normalises to `'US'`; `{ backupRegion: 'CA' }` returns 400 "Backup region must be US"; `GET` echoes `backupRegion: 'US'`.

**Acceptance Scenarios**:
1. **Given** the select, **When** opened, **Then** exactly one option (United States) is listed and the control is not disabled (disabled selects read as broken; a single option reads as "not yet").
2. **Given** an organization whose business address `countryCode` is `US`, **When** business details are read, **Then** `backupRegion` is independent of `countryCode` — changing one never changes the other.

---

### Edge Cases

- **Time zone validation**: accept only zones `Intl.supportedValuesOf('timeZone')` reports on the backend's Node runtime (Node 18+), so a value that saves can always be formatted. Aliases (`US/Eastern`) are rejected; the picker never offers them.
- **Existing organizations**: the migration backfills `timezone` to `America/New_York` (today's implicit behaviour) and `backupRegion` to `US`. No organization changes behaviour on deploy.
- **Venues already created**: keep their own `timezone`; the store time zone only seeds new venues. Event-facing times (storefront, tickets, emails) keep using the venue zone — a festival in Denver run by a Raleigh organizer still shows Mountain Time to buyers.
- **Digest**: the daily digest keeps its rolling window; the change is that the email's date headings and "since" line render in the store zone rather than UTC.
- **Partial PATCH**: like every other Settings card, only the keys sent are validated and written (`validateUpdateBusinessDetails`). `currency` is not accepted on PATCH — sending it returns 400 "Unknown field: currency".
- **SYSTEM_ADMIN**: edits whichever organization the switcher has selected, like the rest of General.
- **Currency display in the future**: the pill and the `currency` field are read from `Organization.currency` (new column, default `usd`) so that turning on a second currency later is a validator change and a Stripe call-site refactor, not a UI change. Nothing in this spec writes any value other than `usd`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** `Organization` gains `currency String @default("usd")`, `backupRegion String @default("US")`, `timezone String @default("America/New_York")`. The migration backfills all existing rows with the defaults.
- **FR-002** `GET /admin/settings/business-details` returns `currency`, `backupRegion`, `timezone` alongside the existing fields.
- **FR-003** `PATCH /admin/settings/business-details` accepts `backupRegion` (ISO 3166-1 alpha-2, MVP allowlist `US`, case-normalised) and `timezone` (IANA, must be in `Intl.supportedValuesOf('timeZone')`), partial like every other key. `currency` is rejected as an unknown field.
- **FR-004** Settings › General renders a **Store defaults** card directly under **Store contact details** with: Currency display (read-only pill, helper text, no control), Backup region (select), Time zone (select with helper), and a save bar that appears only when a value differs from the loaded one. Saving sends only the changed keys.
- **FR-005** The time zone option list is generated on the frontend from `Intl.supportedValuesOf('timeZone')`, labelled `(GMT±HH:MM) <friendly name>` where a curated map supplies friendly names for US zones (`America/New_York` → "Eastern Time (US & Canada)", `America/Chicago` → "Central Time (US & Canada)", `America/Denver` → "Mountain Time (US & Canada)", `America/Phoenix` → "Arizona", `America/Los_Angeles` → "Pacific Time (US & Canada)", `America/Anchorage` → "Alaska", `Pacific/Honolulu` → "Hawaii", `America/Puerto_Rico` → "Puerto Rico", `Pacific/Guam` → "Guam", `Pacific/Pago_Pago` → "American Samoa") and every other zone falls back to its IANA name with underscores replaced. US zones are listed first, in the order above; offsets are computed for the current date so DST is reflected.
- **FR-006** Backend surfaces that derive a calendar day from an instant use the store time zone: the tax report's date-only `from` / `to` bounds and CSV filename stamp (`taxValidators.js`, `admin.js`), the dashboard's "today" / "last N days" boundaries (`GET /admin/dashboard/stats`), the participants and other CSV export filename stamps, and date headings in the application digest email. Instants stay UTC in the database and in JSON.
- **FR-007** `VenueService.createVenue` defaults `timezone` to the organization's `timezone` when the request omits it.
- **FR-008** Admin list and detail pages that display order, payment, application and check-in timestamps format them in the store time zone via one shared helper (`frontend/src/lib/dates.ts`, new) that takes the zone from the organization loaded by `OrgContext`; the element's `title` carries the full timestamp with zone abbreviation. Storefront and buyer-facing pages are unchanged (venue zone).
- **FR-009** Roles: ORGANIZER+ reads and edits the card, matching the rest of `PATCH /admin/settings/business-details`.

### Non-functional

- **NFR-001** The card adds no request: it reads from the existing business-details response.
- **NFR-002** The time zone select is a native `<select>` (keyboard, screen reader and mobile behaviour for free); the option list is built once per page load (~420 zones) and memoised.
- **NFR-003** Every date helper that switches from UTC to the store zone is covered by a unit test with a fixed instant and two zones on either side of midnight.

## Assumptions

- The Shopify footer "To change your user level time zone and language visit your account settings" is dropped: Jump has no user-level time zone or language preference. If one is added later it overrides the store zone for that user's admin display only, never for reports or exports.
- "Backup region" keeps the Shopify name and helper text even though Jump has no Markets yet, so the card reads the same when Markets arrive; the plan may shorten the helper to "Determines settings for customers outside the United States" if the word "markets" tests badly with organizers.
- Currency stays a display-only row until a real second currency is scoped. Turning it on is a separate spec: it touches Stripe Checkout `currency`, price tiers, tax, refunds, add-ons, application payments and every `formatCurrency`.
- Venue `timezone` remains the source of truth for event times; this spec does not introduce a per-event zone.
- The card sits in General, not in a new Settings page, because it holds three fields and the screenshot places it there.
