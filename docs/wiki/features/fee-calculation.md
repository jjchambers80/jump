# Fee Calculation

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Implements FTC all-in pricing. FeeService calculates the full cost breakdown: subtotal (tier price times quantity), platform fee (percentage of subtotal), processing fee (Stripe percentage plus fixed per-transaction), and tax (venue-based via Stripe Tax API). OrderItems store per-unit breakdowns so every line item is fully transparent.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/FeeService.js` | Fee calculation logic (platform fee, processing fee) |
| `backend/src/services/TaxService.js` | Tax rate lookup via Stripe Tax API |
| `backend/src/services/OrderService.js` | Order creation with fee breakdown persistence |

## How It Works

1. Customer selects tickets (tier and quantity).
2. FeeService calculates:
   - **Subtotal**: tier price x quantity.
   - **Platform fee**: percentage of subtotal.
   - **Processing fee**: Stripe percentage of total + fixed per-transaction amount.
   - **Tax**: venue-based rate from TaxService applied to subtotal.
3. OrderItems are created with per-unit price breakdown fields:
   - `unitPrice` — base ticket price.
   - `unitPlatformFee` — platform fee per ticket.
   - `unitProcessingFee` — processing fee per ticket.
   - `unitTax` — tax per ticket.
4. The total displayed to the customer is the all-in price including all fees and tax.

## Gotchas

- All prices displayed to the customer include fees — no hidden charges (FTC all-in pricing compliance).
- Tax rate is cached per event from Stripe Tax API — see [Tax Calculation](tax-calculation.md).
- Processing fee has both a percentage component and a fixed per-transaction component.
- Per-unit fee storage means rounding is applied at the unit level.

## Related Features

- [Tax Calculation](tax-calculation.md) — provides the venue-based tax rate used in fee breakdown.
