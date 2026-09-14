# Tax Calculation

**Status:** Implemented (spec 009 phases 1–2)
**Last Updated:** 2026-09-14

## Overview

Sales tax is venue-based: it depends on where the event happens, not where the buyer lives. Each organization decides, per US state it has a venue in, whether it collects tax there and by which source — an automatic Stripe Tax lookup or a flat manual rate. The effective rate is computed once per event, cached on `Event.taxRate`, and applied per ticket in the fee breakdown. Organizations manage this on **Settings › Tax** (`/admin/settings/tax`), a page modelled on Shopify's Taxes and duties screen.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/TaxService.js` | Region resolution, rate resolution by source, Stripe Tax lookup, service status |
| `backend/src/services/EventService.js` | `_refreshTaxRate()` on create / venue change / publish |
| `backend/src/services/VenueService.js` | Refreshes upcoming events when a venue's state or postal code changes |
| `backend/src/services/FeeService.js` | Applies the cached rate (`tax = subtotal × taxRate`) |
| `backend/src/api/routes/admin.js` | `GET /admin/settings/tax`, `PUT /admin/settings/tax/regions/:country/:region` |
| `backend/src/api/validators/taxValidators.js` | Region / body validation |
| `backend/src/utils/usStates.js` | State code ↔ name, input normalisation |
| `packages/db/prisma/schema.prisma` | `TaxRegion`, `TaxSource`, `Event.taxRateSource` |
| `frontend/src/app/admin/settings/tax/` | Page, regions table, edit dialog, API hook |

## Data Model

```
TaxRegion (unique per organizationId + country + region)
  collecting   Boolean   — false = no tax in this state
  source       STRIPE | MANUAL
  manualRate   Decimal   — fraction (0.0825), only when MANUAL
  lastRate / lastSource / lastCheckedAt / lastError — outcome of the last lookup, shown on the page

Event.taxRate        Decimal — cached effective rate
Event.taxRateSource  STRIPE | MANUAL | null — which path produced it (null = not collecting / legacy)
```

Regions are *derived* from venues: the page lists every state the organization has a venue in, joined to its `TaxRegion` row. A state with venues but no row is **Not set** and collects nothing until an admin configures it. Venues without a two-letter `state` cannot be placed in a region and appear under **Needs address**.

## How It Works

1. `EventService._refreshTaxRate(event)` calls `TaxService.rateForVenue(orgId, venue)`.
2. `rateForVenue` finds the `TaxRegion` for `(US, venue.state)`:
   - no row or `collecting = false` → `{ rate: 0, source: null }`
   - `MANUAL` → `{ rate: manualRate, source: 'MANUAL' }`
   - `STRIPE` → `getTaxRateForVenue(postalCode)`: one `stripe.tax.calculations.create` with a $100 reference line, tax code `txcd_20060057` (event admissions), `address_source: 'shipping'`; rate = `tax_amount_exclusive / 10000`.
3. The outcome (rate or error) is written to the region's `last*` columns so the settings page can show it.
4. The rate is stored on the event with `taxRateSource`; `FeeService` uses it for every order at that event.
5. Saving a region on Settings › Tax recalculates every upcoming DRAFT/PUBLISHED event in that state (`recalculateEvents`). Orders already placed keep the amounts they were charged.

### Failure handling

`getTaxRateForVenue` **throws** `StripeTaxError` instead of returning 0. Callers decide what 0 means:

- A Stripe error on an event that already has a rate keeps the previous rate (`tax_rate_refresh_kept_previous`) rather than dropping to 0.
- A calculation whose `tax_breakdown[].taxability_reason` includes `not_collecting` (the platform Stripe account has no registration for that state) is recorded as `lastError: "No Stripe Tax registration for <State>"`; the region row shows a **No registration** badge and the dialog suggests a manual rate.
- A missing postal code is an error (`Venue has no postal code`), not a silent 0.

### Stripe Tax service status

`getServiceStatus()` calls `stripe.tax.settings.retrieve()` (`active` | `pending`) and `stripe.tax.registrations.list({ status: 'active' })`, cached in-process for 5 minutes, and never throws (`unavailable` on error). The page shows the pill and, for SYSTEM_ADMIN only, a **Manage** link to the Stripe dashboard.

## API

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/admin/settings/tax` | organizer+ | `{ service, regions[], needsAddress[], canEdit }`; scoped by `activeOrgFor(req)` (X-Jump-Org / `?organizationId=` for SYSTEM_ADMIN) |
| PUT | `/admin/settings/tax/regions/:country/:region` | admin+ | `{ collecting, source?, manualRate? }` → `{ region, recalculatedEvents }`. `manualRate` is a fraction 0–0.5, required for MANUAL, rejected otherwise |
| POST | `/admin/settings/tax/regions/:country/:region/recalculate` | admin+ | Re-runs the lookup for the region's upcoming events with the saved setting ("Recalculate now"); 404 when the region has no row |

Region rows carry `upcomingEventCount` (DRAFT/PUBLISHED, future date) so the dialog can say what a save will touch. Event payloads (`_formatEventDetail`) include `tax: { rate, source, region }`; the admin event edit page renders it as `Tax: 8.25% · Stripe Tax · NC` under the venue picker with a link to Settings › Tax.

## Configuration

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Platform Stripe key (payments and Stripe Tax). Stripe Tax must be activated and registered per state on this account for the STRIPE source to return a non-zero rate |

## Migration notes

`20260914010000_tax_regions` backfilled one `TaxRegion` per existing (organization, state) with `collecting = true, source = STRIPE`, so behaviour did not change for existing organizations. It also normalised full state names in `Venue.state` to two-letter codes; the venue validator now enforces codes (full names are accepted and converted).

## Gotchas

- Stripe Tax registrations belong to the **platform** account, not the organization. An organization that is registered in a state the platform is not must use a manual rate.
- New regions (a venue in a state the organization had none in) default to **Not set** — an amber banner on the page until an admin decides.
- Rates are cached per event; region saves and venue location changes refresh upcoming events only. Past events and placed orders are untouched.
- Platform and processing fees are not taxed (`tax = subtotal × rate`). Whether service charges should be taxable is an open decision in `specs/009-tax-settings/plan.md` §5.
- One Stripe Tax calculation per event lookup (billed per calculation) — never per order.

## Tests

- `backend/tests/unit/taxService.test.js` — region resolution, every source path, Stripe failure / `not_collecting`, status cache, list and upsert.
- `backend/tests/contract/tax.test.js` — routes, RBAC, validation, org isolation, event recalculation, venue state normalisation.
- `frontend/e2e/admin-tax-settings.spec.ts` — page, banner, dialog round-trip, focus return, read-only for ORGANIZER, pending-service warning, Recalculate now (success + lookup error).

## Related Features

- [Fee Calculation](fee-calculation.md) — consumes the tax rate for all-in pricing.
- [All-In Pricing](all-in-pricing.md)
- [Org Switcher](org-switcher.md) — how Settings pages are scoped to the active organization.
