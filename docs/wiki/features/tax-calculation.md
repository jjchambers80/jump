# Tax Calculation

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Venue-based tax rates are determined via the Stripe Tax API. TaxService looks up the applicable rate using the venue's address and postal code with tax code `txcd_20060057` (event admissions). The rate is cached on the Event model to avoid repeated API calls and is applied per-ticket in the fee breakdown.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/TaxService.js` | Tax rate lookup and caching via Stripe Tax API |
| `backend/src/services/FeeService.js` | Applies cached tax rate in fee calculation |

## Configuration

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key (same key used for Tax API and payments) |

## How It Works

1. When fees are calculated for an event, TaxService checks if a tax rate is already cached on the Event model.
2. If no cached rate exists, TaxService calls the Stripe Tax API with:
   - Venue address and postal code.
   - Tax code `txcd_20060057` (event admissions).
3. The returned rate is stored on the Event model for future lookups.
4. FeeService uses the cached rate to calculate per-ticket tax in the fee breakdown.

## Gotchas

- Tax rate is determined by venue location, not customer location.
- Rate is cached on first calculation — if the venue address changes, the cached rate must be invalidated manually.
- Uses the same `STRIPE_SECRET_KEY` as payment processing; no separate Tax API key.
- Tax code `txcd_20060057` is specific to event admissions — other product types would need different codes.

## Related Features

- [Fee Calculation](fee-calculation.md) — consumes the tax rate for all-in pricing.
