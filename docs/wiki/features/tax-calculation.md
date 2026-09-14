# Tax Calculation

**Status**: Implemented (spec 009)
**Last Updated**: 2026-09-14

## Overview

Sales tax is venue-based: it depends on where the event happens, not where the buyer lives. The organization's setting for the venue's state (see [Tax Settings](tax-settings.md)) decides whether tax is collected and by which source; the effective rate is computed once per event, cached on `Event.taxRate`, and applied per ticket by `FeeService` — added on top of the listed price, or backed out of it when the organization prices tax-inclusive.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/TaxService.js` | `resolveRegionForVenue`, `rateForVenue` (by source), `getTaxRateForVenue` (Stripe Tax call), `getServiceStatus`, `recalculateEvents` |
| `backend/src/services/EventService.js` | `_refreshTaxRate()` on create / venue change / publish; `tax: { rate, source, region }` on event payloads |
| `backend/src/services/VenueService.js` | `_refreshEventTaxRates()` when a venue's state or postal code changes |
| `backend/src/services/FeeService.js` | Applies the cached rate; exclusive and inclusive modes |
| `frontend/src/lib/fees.ts` | Byte-for-byte mirror of `FeeService` for the storefront cart |
| `backend/src/services/OrderService.js` | Passes `event.taxRate` and the org's `taxInclusivePricing` to `FeeService` at checkout |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Same platform key as payments. Stripe Tax must be activated and registered per state on this account for the `STRIPE` source to return a non-zero rate |

## How It Works

### Rate resolution

1. `EventService._refreshTaxRate(event)` (create, venue change, publish) and `TaxService.recalculateEvents` (region save, Recalculate now, venue location change) call `TaxService.rateForVenue(orgId, venue)`.
2. `rateForVenue` finds the `TaxRegion` for `(US, venue.state)`:
   - no row, or `collecting = false` → `{ rate: 0, source: null }`
   - `MANUAL` → `{ rate: manualRate, source: 'MANUAL' }`
   - `STRIPE` → `getTaxRateForVenue(postalCode)`
3. The outcome (rate or error) is recorded on the region (`lastRate`, `lastSource`, `lastCheckedAt`, `lastError`) for the settings page.
4. The rate and `taxRateSource` are stored on the event; every order at that event uses them.

### Stripe Tax lookup

`getTaxRateForVenue(postalCode, country = 'US')` creates one `stripe.tax.calculations.create` with a $100 reference line (`amount: 10000`, `tax_behavior: 'exclusive'`, tax code `txcd_20060057` — event admissions) and `customer_details.address_source: 'shipping'` (the venue is where the service is delivered). Rate = `tax_amount_exclusive / 10000`. One call per event lookup, never per order (Stripe bills per calculation).

### Failure handling

`getTaxRateForVenue` **throws** `StripeTaxError` instead of returning 0; callers decide what 0 means:

- Missing postal code → `Venue has no postal code` (error, not 0%).
- Stripe error → recorded as `lastError`; an event that already has a rate keeps it (`tax_rate_refresh_kept_previous`) rather than dropping to 0.
- A 0% calculation whose `tax_breakdown[].taxability_reason` includes `not_collecting` (the platform account has no registration for that state) → `No Stripe Tax registration for <State>`. A genuine 0% (`not_subject_to_tax` etc.) is a successful lookup.

`getServiceStatus()` reads `stripe.tax.settings.retrieve()` (`active` | `pending`) and `stripe.tax.registrations.list({ status: 'active' })`, caches 5 minutes, and never throws (`unavailable` on error).

### Fee math

Exclusive (default):

```
subtotal      = Σ listed × qty
tax           = subtotal × rate
platformFee   = subtotal × 5%
processingFee = (subtotal + platformFee) × 2.9% + $0.30
total         = subtotal + platformFee + processingFee + tax
```

Tax-inclusive (`Organization.taxInclusivePricing`):

```
listed   = Σ listed × qty
subtotal = listed ÷ (1 + rate)       ← ex-tax base
tax      = listed − subtotal
fees     = as above, on subtotal
total    = subtotal + fees + tax  = listed + fees
```

The invariant `total = subtotal + platformFee + processingFee + tax` holds in both modes, so `Order` columns, the cart breakdown and `OrderTotals` need no special cases — only labels change (`$50.00 incl. $3.81 tax`, `Tax (included)`). Fees and tax are allocated per line by listed value; rounding drift lands on the largest line (inside a listed price, tax drift moves net vs tax, not what is charged). Shared fixture: $50 at 8.25% inclusive → net 46.19, tax 3.81, platform 2.31, processing 1.71, total 54.02.

Fees on the **net** amount follows `specs/009-tax-settings/plan.md` §5.2 (recommendation adopted). Platform and processing fees are not themselves taxed — §5.1 is an open product decision.

## Database

`Event.taxRate Decimal(6,5)`, `Event.taxRateSource TaxSource?`, `TaxRegion` (per organization + state), `Organization.taxInclusivePricing`. See [Tax Settings](tax-settings.md) and [Database Architecture](database-architecture.md).

## Gotchas

- Tax rate is determined by venue location, not customer location.
- Rates are cached per event; they refresh on create / venue change / publish, on region saves and Recalculate now, and when the venue's `state` or `postalCode` change. Placed orders keep the amounts they were charged.
- A venue without a two-letter `state` has no region and collects no tax (`Venue has no US state`).
- Stripe Tax registrations are the **platform's**; organizations registered elsewhere use a manual rate.
- `frontend/src/lib/fees.ts` must stay identical to `FeeService.js` — change both and both fixture files together.

## Related Features

- [Tax Settings](tax-settings.md) — the Settings › Tax page, regions, report, inclusive-pricing switch
- [Fee Calculation](fee-calculation.md) — consumes the tax rate for all-in pricing
- [All-In Pricing](all-in-pricing.md), [Cart Line-Item Breakdown](cart-line-item-breakdown.md)
