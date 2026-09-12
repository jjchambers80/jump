# All-In Pricing

**Status**: Implemented
**Last Updated**: 2026-09-12

## Overview

Jump displays FTC-compliant all-in pricing to customers. The price shown on event pages includes all fees and taxes — no hidden charges at checkout. This follows FTC junk fee regulations requiring transparent pricing.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/FeeService.js` | Calculates fee breakdown (platform + processing + tax) |
| `backend/src/services/TaxService.js` | Venue-based tax rate lookup via Stripe Tax API |
| `backend/src/services/OrderService.js` | Applies fee calculation during order creation |
| `frontend/src/app/events/[eventId]/page.tsx` | Displays all-in price to customers |
| `frontend/src/lib/fees.ts` | Frontend mirror of `FeeService` (order totals + per-line allocation) used by the event cart and checkout |

## How It Works

1. Event page fetches tier prices from API
2. Backend calculates all-in price per tier:
   - **Subtotal**: tier base price × quantity
   - **Platform fee**: percentage of subtotal (configurable)
   - **Processing fee**: Stripe rate × (subtotal + platform fee) + fixed per-transaction
   - **Tax**: subtotal × venue tax rate (cached from Stripe Tax API)
3. Customer sees total including all fees
4. Fee breakdown stored per OrderItem (unitPrice, unitPlatformFee, unitProcessingFee, unitTax)

## Gotchas

- Tax rate is venue-based, not customer-based
- Fee breakdown is stored at purchase time — rate changes don't affect existing orders
- All-in price display is a frontend concern; backend always returns fee components separately

## Related Features

- [Fee Calculation](fee-calculation.md) — Detailed fee math
- [Tax Calculation](tax-calculation.md) — Stripe Tax API integration
- [Price Tiers](price-tiers.md) — Base pricing configuration
- [Cart Line-Item Breakdown](cart-line-item-breakdown.md) — Per-line accordion showing these components in the cart
