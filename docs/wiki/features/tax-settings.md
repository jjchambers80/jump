# Tax Settings

**Status**: Implemented (spec 009, phases 1–3 in production 2026-09-14)
**Last Updated**: 2026-09-14

## Overview

**Settings › Tax** (`/admin/settings/tax`) lets an organization decide, per US state it has a venue in, whether it collects sales tax and by which source — an automatic **Stripe Tax** lookup or a flat **manual rate** — and see what the last lookup produced. It also carries the organization's **tax-inclusive pricing** switch and a **collected tax report** for remittance. The page is modelled on Shopify's *Taxes and duties* screen, keeping only the sections that apply to event ticketing (no duties, customs, shipping tax or VAT on digital goods).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/admin/settings/tax/page.tsx` | Page: Stripe Tax service card, regions table, action-needed banner, report link, Additional configuration |
| `frontend/src/app/admin/settings/tax/TaxRegionsTable.tsx` | Region \| Collecting \| Tax service rows (each a button), "Needs address" row |
| `frontend/src/app/admin/settings/tax/EditTaxRegionDialog.tsx` | Collecting toggle, Stripe/Manual source, percent input, last-lookup line, **Recalculate now** |
| `frontend/src/app/admin/settings/tax/TaxInclusiveConfirmDialog.tsx` | Worked-example confirmation before flipping tax-inclusive pricing |
| `frontend/src/app/admin/settings/tax/report/page.tsx` | Collected tax report: date range, per-region table, totals, CSV download |
| `frontend/src/app/admin/settings/tax/useTaxApi.ts`, `types.ts` | API hook (org-scoped like Domains), shapes, `formatRate` / `parsePercent` / `reportToCsv` |
| `frontend/src/app/admin/settings/SettingsNav.tsx` | `Tax` section after `Domains` (every staff role) |
| `backend/src/api/routes/admin.js` | `/admin/settings/tax*` routes, scoped by `activeOrgFor(req)` |
| `backend/src/api/validators/taxValidators.js` | Region params/body, settings body, report query |
| `backend/src/services/TaxService.js` | Regions, rate resolution, Stripe Tax status, recalculation, settings, report |
| `backend/src/utils/usStates.js` | State code ↔ name; `normalizeStateCode` used by the venue validator |
| `packages/db/prisma/schema.prisma` | `TaxRegion`, `TaxSource`, `Event.taxRateSource`, `Organization.taxInclusivePricing` |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Platform Stripe key. Stripe Tax must be **activated** on this account and **registered** per state for the `STRIPE` source to return a non-zero rate; the page shows `Pending setup` / `No registration` otherwise |

No new environment variables. Stripe Tax status and registrations are read live (`stripe.tax.settings.retrieve`, `stripe.tax.registrations.list`) and cached in-process for 5 minutes.

## How It Works

### Page

1. **Tax service card** — `Stripe Tax` with a pill: `Active`, `Pending setup` (Tax not activated on the platform account) or `Unavailable` (Stripe unreachable). Shows the count of active US registrations. SYSTEM_ADMIN also gets a **Manage** link to the Stripe dashboard (`manageUrl` is only returned for that role).
2. **Tax regions** — one row per US state the organization has a venue in, alphabetical. Regions are *derived from venues*, not created by hand: add a venue in a new state to get a region. Columns: Region (+ venue count), Collecting (`Collecting` / `Not collecting` / `Not set`), Tax service (`Stripe Tax` with last rate, `Manual · 5.3%`, or `—`) with amber badges `No registration`, `Lookup failed`, `Stripe Tax inactive`.
   - **Action needed** banner lists states that have venues but no `TaxRegion` row — those events collect no tax until an admin decides.
   - **Needs address** row lists venues whose `state` is not a two-letter US code, with a link to `/admin/venues`.
3. **Edit tax region** dialog (row click; ADMIN / SYSTEM_ADMIN can save, ORGANIZER sees it read-only):
   - *Collect sales tax in X* toggle.
   - *Tax service*: **Stripe Tax (automatic)** — warns when Stripe Tax is inactive or the platform account has no registration for that state — or **Manual rate** with a percent input (0–50, stored as a fraction to 5 decimals).
   - *Last lookup* line (rate + source + date, or the error) and "N upcoming events use this region".
   - **Recalculate now** — re-runs the lookup for the region's upcoming events with the *saved* setting (disabled while the form is dirty); the outcome is shown inline and the row updates without closing.
   - Saving recalculates the cached `Event.taxRate` on every upcoming DRAFT/PUBLISHED event in that state. Orders already placed are untouched.
4. **Collected tax report** link → `/admin/settings/tax/report`.
5. **Additional configuration** — *Include sales tax in ticket prices* checkbox. Ticking it opens a confirm dialog with a worked example at one of the organization's rates (`$50.00 tier at 8.25% → $50.00 incl. $3.81 tax + $4.02 fees = $54.02; today $58.45`). Confirm PATCHes `taxInclusivePricing`; cancel restores the checkbox and focus.

### Collected tax report

Date range (default: calendar year to date; max three years), one row per state: orders, taxable sales (`Order.subtotalAmount`), tax collected (`Order.taxAmount`), **tax refunded (estimated)** and tax net, plus a totals row and **Download CSV** (built client-side with the same columns as the API's `format=csv`). Orders count when placed (`createdAt`) with status COMPLETED, PARTIALLY_REFUNDED or REFUNDED. Refunded tax is `refund ÷ order total × order tax` because `Refund` stores only an amount — the page says so.

### Where the rate goes

The region setting decides the rate cached on each event; `FeeService` applies it at checkout. Lookup details, the Stripe call, failure handling and the tax-inclusive math live in [Tax Calculation](tax-calculation.md). The admin event edit page shows the result as `Tax: 8.25% · Stripe Tax · NC` under the venue picker with a link back here.

## API Endpoints

All under `requireAuth` + `requireOrganizer`, organization resolved by `activeOrgFor(req)` (membership, `X-Jump-Org` from the switcher, or `?organizationId=` for SYSTEM_ADMIN).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/settings/tax` | Organizer+ | `{ service, regions[], needsAddress[], settings, canEdit }`. `service.manageUrl` only for SYSTEM_ADMIN |
| PUT | `/admin/settings/tax/regions/:country/:region` | Admin+ | `{ collecting, source?, manualRate? }` → `{ region, recalculatedEvents }`. Country must be `US`, region a state code; `manualRate` (fraction, 0–0.5) required for `MANUAL`, rejected for `STRIPE` |
| POST | `/admin/settings/tax/regions/:country/:region/recalculate` | Admin+ | Re-run lookups for the region's upcoming events; 404 if the region has no row |
| PATCH | `/admin/settings/tax` | Admin+ | `{ taxInclusivePricing: boolean }` |
| GET | `/admin/settings/tax/report?from&to&format=json\|csv` | Organizer+ | Tax collected per region. Dates as `YYYY-MM-DD` (inclusive) or ISO timestamps; CSV sets `Content-Disposition: attachment; filename="tax-collected-<from>_<to>.csv"` |

Public: `GET /events/:id` and the org event list include `taxRate`, `tax: { rate, source, region }` and `taxInclusivePricing` so the storefront can price and label tiers.

## Database

| Model / field | Notes |
|---------------|-------|
| `TaxRegion` | `organizationId`, `country` (`US`), `region` (state code), `collecting`, `source` (`TaxSource`), `manualRate` `Decimal(6,5)`, `lastRate`, `lastSource`, `lastCheckedAt`, `lastError`. Unique on `(organizationId, country, region)`; cascades with the organization |
| `TaxSource` enum | `STRIPE`, `MANUAL` |
| `Event.taxRateSource` | Which path produced the cached `taxRate`; `null` = not collecting / legacy |
| `Organization.taxInclusivePricing` | Default `false` |
| `Venue.state` | Now validated as a two-letter US code (full names accepted and converted) |

Migrations: `20260914010000_tax_regions` (table + enum + `Event.taxRateSource`; normalises `Venue.state`; **backfills** one `collecting = true, source = STRIPE` row per existing organization/state so behaviour did not change; marks existing non-zero event rates as `STRIPE`), `20260914020000_tax_inclusive_pricing`. Full schema: [Database Architecture](database-architecture.md).

## Gotchas

- Stripe Tax registrations belong to the **platform** Stripe account, not the organization. An organization registered in a state the platform is not must pick **Manual rate** — the dialog says so when no registration is found.
- Regions that appear after launch (first venue in a new state) default to **Not set**: no tax until an admin chooses. Existing organization/state pairs were backfilled as collecting via Stripe Tax.
- `Venue.state` must be a state code for the venue to belong to a region; otherwise it sits under *Needs address* and its events collect nothing.
- Region saves, **Recalculate now** and venue state/postal-code edits refresh **upcoming** DRAFT/PUBLISHED events only. Past events and placed orders keep their numbers.
- A failed Stripe lookup on an event that already has a rate keeps the old rate (`tax_rate_refresh_kept_previous`); the region row shows *Lookup failed* so it is not silent.
- `Recalculate now` is disabled while the dialog has unsaved changes — it runs with the saved setting.
- The report's refunded-tax column is an estimate; treat it as guidance for remittance, not a ledger.
- Flipping tax-inclusive pricing changes every customer-visible price but does **not** touch cached rates or orders; fees are charged on the net (ex-tax) amount — see [Tax Calculation](tax-calculation.md) and plan `specs/009-tax-settings/plan.md` §5 for the open product decisions (tax on service fees, seller of record).
- Settings pages wait for the org switcher before fetching and refetch on org change (same `useRef` gate as General); the API hook appends `?organizationId=` for SYSTEM_ADMIN like Domains.

## Tests

- `backend/tests/unit/taxService.test.js`, `backend/tests/unit/feeService.test.js`
- `backend/tests/contract/tax.test.js` — routes, RBAC, validation, org isolation, recalculation, venue normalisation, settings, inclusive checkout amounts, report JSON/CSV
- `frontend/tests/unit/fees.test.ts` — mirrors the backend fixtures
- `frontend/e2e/admin-tax-settings.spec.ts` — page + axe, dialog round-trip and focus return, Recalculate now (success / error), read-only ORGANIZER, pending-service warning, inclusive confirm, report + CSV download

## Related Features

- [Tax Calculation](tax-calculation.md) — rate resolution, Stripe Tax lookup, tax-inclusive math
- [All-In Pricing](all-in-pricing.md) and [Fee Calculation](fee-calculation.md) — where the rate is applied
- [Organization Settings](organization-settings.md) — the Settings shell (`SettingsNav`, `SettingsDialog`)
- [Org Switcher](org-switcher.md) — how admin pages are scoped to an organization
- [Venue Management](venue-management.md) — `state` / `postalCode` feed the regions
