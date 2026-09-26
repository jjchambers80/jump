# Stripe Integration

**Status:** Active
**Last Updated:** 2026-09-25

## Overview

Jump uses Stripe SDK v17 (API version `2024-11-20.acacia`) for payment processing. Checkout Sessions handle payment collection. A webhook endpoint at `POST /webhooks/stripe` processes `checkout.session.completed`, `checkout.session.expired`, and async payment events. Signature verification is required everywhere unless a local developer explicitly opts out with `STRIPE_WEBHOOK_ALLOW_UNSIGNED=true`. All webhook handlers are idempotent. Tax rates are computed via Stripe Tax API (see [Tax Calculation](tax-calculation.md)).

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/stripe.js` | Stripe SDK initialization with API version lock |
| `backend/src/services/PaymentService.js` | Webhook processing: checkout completed/failed flows |
| `backend/src/services/OrderService.js` | Checkout Session creation, order management |
| `backend/src/services/TaxService.js` | Tax rate lookup via Stripe Tax Calculations API |
| `backend/src/services/PaymentSettingsService.js` | Per-organization checkout options (payment methods, statement descriptor suffix); platform account status |
| `backend/src/api/routes/webhooks.js` | Webhook endpoint with signature verification |

## Configuration

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Required. Stripe secret API key. Throws on startup if missing. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret. If unset, every event on `POST /webhooks/stripe` is refused with 500 — see [Signature verification](#signature-verification-webhooksjs). |
| `STRIPE_WEBHOOK_ALLOW_UNSIGNED` | `true` accepts an unsigned body when no signing secret is set. **Local development only** — never on a deployed service. |
| `STRIPE_CONNECT_ENABLED` | `true` routes charges for organizations with an active Connect account as destination charges — [Connect Payouts](connect-payouts.md). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for `POST /webhooks/stripe/connect` (connected-account events). Separate endpoint and secret. |
| `AUTH_SECRET` | Used for QR JWT signing, not Stripe-specific. |

## How It Works

### Checkout Session Creation (OrderService)

1. After order and inventory reservation, `stripe.checkout.sessions.create` is called with:
   - `mode: 'payment'`, plus `PaymentSettingsService.checkoutOptionsFor(organization, { fees, lineItems })` — `payment_method_types` (`card` + the organization's enabled optional methods), `payment_intent_data.statement_descriptor_suffix` (see [Payments Settings](payments-settings.md)) and, for an organization with an active Connect account, `payment_intent_data.transfer_data.destination` + `application_fee_amount` making it a **destination charge** (see [Connect Payouts](connect-payouts.md))
   - `customer_email` from Contact
   - `line_items` with all-in unit pricing per tier
   - `metadata: { orderId, orderRef, eventId }`
   - `success_url` -> `/confirmation?orderId=...`
   - `cancel_url` -> `/events/:eventId?status=cancelled`
   - `expires_at` -> 30 minutes from creation
2. Session ID stored on Order (`stripeSessionId`).
3. `PaymentTransaction` record created with PENDING status, plus `stripeAccountId` / `applicationFee` when the charge was routed to a connected account (null = platform account).

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
- **No signing secret configured → the event is refused with 500**, on all three endpoints (`/webhooks/stripe`, `/stripe/connect`, `/stripe/billing`). An endpoint that parses an unverified body is an unauthenticated write path into the ledger: a forged `checkout.session.completed` issues tickets for free, and the same body carrying `metadata.applicationId` confirms a vendor booth for free.
  - The only way back to the permissive parse is `STRIPE_WEBHOOK_ALLOW_UNSIGNED=true`, and it must be exactly `true`. The guard is **not** keyed on `NODE_ENV`: nothing guarantees a deployed service sets `NODE_ENV=production`, and a guard that is inert in exactly the environment it protects is not a guard. This one fails closed everywhere the flag is absent.
  - It answers 500 rather than 400 because a missing secret is our misconfiguration, not a malformed request — and 5xx is the only reply that leaves a genuine event on Stripe's retry schedule, so fixing the variable inside the retry window recovers the event instead of losing the order it carried.
- On verification failure (bad signature, tampered body), returns 400.
- **On an unexpected processing error, returns 500** so Stripe retries. Handlers are idempotent, so replaying a partly-succeeded event is safe. A 200 here used to tell Stripe the event was handled, which permanently lost the transition it carried — `OrderService.sweepAbandoned` happened to cover ticket orders, but application payments and `charge.refunded` have no equivalent sweep.
- Events deliberately ignored still return 200 (a billing event registered on the platform endpoint, a Connect event with no `account`, a non-billing event on the billing endpoint). Those are not failures, and acknowledging them stops Stripe retrying something that will never be processed there.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/stripe` | Stripe signature | Handle Stripe webhook events (platform account, including destination charges) |
| POST | `/webhooks/stripe/connect` | Stripe signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) | Connected-account events: `account.updated`, `capability.updated`, `account.application.deauthorized`, external accounts, `payout.paid/failed` |

## Gotchas

- **Never trust client-side payment status.** Always verify via webhook or direct Stripe API check (`verifyAndCompleteOrder`).
- **Raw body required for signature verification.** The webhook route uses `express.raw()`, not `express.json()`. Ensure no global JSON parser intercepts `/webhooks/stripe`.
- **Webhook returns 500 on an unexpected processing error**, so Stripe retries. It returns 200 only for events it deliberately ignores. It used to answer 200 on every error, which silently discarded the transition the event carried.
- **Idempotent handlers.** Both completed and failed handlers check order status before processing. Safe to receive duplicate webhook events.
- **30-minute session expiry.** Stripe fires `checkout.session.expired` after timeout, which triggers inventory release.
- **Stripe SDK version locked to `2024-11-20.acacia`** in `backend/src/config/stripe.js`. Upgrading requires checking for breaking API changes.
- **`STRIPE_SECRET_KEY` is required at import time** -- app crashes on startup if missing (fail-fast).
- **Destination-charge events stay on the platform endpoint.** `checkout.session.*` and `charge.refunded` for routed orders fire on the platform account; only account/capability/payout events go to `/webhooks/stripe/connect`. The startup log `Stripe webhook configuration` shows which secrets are set.

## Related Features

- [Guest Checkout](guest-checkout.md) -- order creation and Checkout Session flow
- [Ticket Issuance](ticket-issuance.md) -- tickets created on checkout.session.completed
- [Tax Calculation](tax-calculation.md) -- venue tax rates via Stripe Tax API
- [Fee Calculation](fee-calculation.md) -- fee breakdown in Stripe line items
- [Payments Settings](payments-settings.md) -- Settings › Payments: statement descriptor, optional payment methods
