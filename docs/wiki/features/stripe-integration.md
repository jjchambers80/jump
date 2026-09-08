# Stripe Integration

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

Jump uses Stripe SDK v17 (API version `2024-11-20.acacia`) for payment processing. Checkout Sessions handle payment collection. A webhook endpoint at `POST /webhooks/stripe` processes `checkout.session.completed`, `checkout.session.expired`, and async payment events. Signature verification is required in production. All webhook handlers are idempotent. Tax rates are computed via Stripe Tax API (see [Tax Calculation](tax-calculation.md)).

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/stripe.js` | Stripe SDK initialization with API version lock |
| `backend/src/services/PaymentService.js` | Webhook processing: checkout completed/failed flows |
| `backend/src/services/OrderService.js` | Checkout Session creation, order management |
| `backend/src/services/TaxService.js` | Tax rate lookup via Stripe Tax Calculations API |
| `backend/src/api/routes/webhooks.js` | Webhook endpoint with signature verification |

## Configuration

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Required. Stripe secret API key. Throws on startup if missing. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret. If unset, signature verification is skipped (dev only). |
| `AUTH_SECRET` | Used for QR JWT signing, not Stripe-specific. |

## How It Works

### Checkout Session Creation (OrderService)

1. After order and inventory reservation, `stripe.checkout.sessions.create` is called with:
   - `mode: 'payment'`, `payment_method_types: ['card']`
   - `customer_email` from Contact
   - `line_items` with all-in unit pricing per tier
   - `metadata: { orderId, orderRef, eventId }`
   - `success_url` -> `/confirmation?orderId=...`
   - `cancel_url` -> `/events/:eventId?status=cancelled`
   - `expires_at` -> 30 minutes from creation
2. Session ID stored on Order (`stripeSessionId`).
3. `PaymentTransaction` record created with PENDING status.

### Webhook Processing (PaymentService)

1. **`checkout.session.completed`** (payment_status === 'paid'):
   - Look up order by `stripeSessionId`
   - Skip if already COMPLETED (idempotent)
   - Skip if not PENDING
   - Update `PaymentTransaction` -> SUCCEEDED
   - Create tickets via `TicketService.createTicketsForOrder()`
   - Mark order COMPLETED
   - Send confirmation email (fire-and-forget, non-blocking)

2. **`checkout.session.expired`**:
   - Look up order by `stripeSessionId`
   - Skip if already FAILED (idempotent)
   - Update `PaymentTransaction` -> FAILED
   - Release reserved inventory (`quantityReserved` decremented per item)
   - Mark order FAILED

3. **`checkout.session.async_payment_succeeded`**: Same as completed flow.
4. **`checkout.session.async_payment_failed`**: Same as expired flow.

### Signature Verification (webhooks.js)

- Uses `express.raw({ type: 'application/json' })` to receive raw body.
- Calls `stripe.webhooks.constructEvent(req.body, sig, webhookSecret)`.
- If `STRIPE_WEBHOOK_SECRET` is unset, verification is skipped with a warning log (development only).
- On verification failure, returns 400.
- On processing error, still returns 200 to prevent Stripe retries.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/stripe` | Stripe signature | Handle Stripe webhook events |

## Gotchas

- **Never trust client-side payment status.** Always verify via webhook or direct Stripe API check (`verifyAndCompleteOrder`).
- **Raw body required for signature verification.** The webhook route uses `express.raw()`, not `express.json()`. Ensure no global JSON parser intercepts `/webhooks/stripe`.
- **Webhook returns 200 even on processing errors** to prevent Stripe from retrying and creating duplicate processing.
- **Idempotent handlers.** Both completed and failed handlers check order status before processing. Safe to receive duplicate webhook events.
- **30-minute session expiry.** Stripe fires `checkout.session.expired` after timeout, which triggers inventory release.
- **Stripe SDK version locked to `2024-11-20.acacia`** in `backend/src/config/stripe.js`. Upgrading requires checking for breaking API changes.
- **`STRIPE_SECRET_KEY` is required at import time** -- app crashes on startup if missing (fail-fast).

## Related Features

- [Guest Checkout](guest-checkout.md) -- order creation and Checkout Session flow
- [Ticket Issuance](ticket-issuance.md) -- tickets created on checkout.session.completed
- [Tax Calculation](tax-calculation.md) -- venue tax rates via Stripe Tax API
- [Fee Calculation](fee-calculation.md) -- fee breakdown in Stripe line items
