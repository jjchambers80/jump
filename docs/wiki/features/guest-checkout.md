# Guest Checkout

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

Guests can purchase tickets without creating an account. `POST /orders` creates a Contact (email-based dedup), an Order with PENDING status, reserves tier inventory atomically, computes FTC all-in pricing with fee breakdown, and creates a Stripe Checkout Session. The frontend redirects to Stripe. On success, a webhook fires to complete the order and issue tickets. Guests can look up orders via `POST /orders/lookup` with email and orderRef.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/OrderService.js` | Order creation, inventory reservation, Stripe session, lookup |
| `backend/src/services/PaymentService.js` | Webhook processing (completion and failure flows) |
| `backend/src/services/FeeService.js` | Platform fee, processing fee, tax computation |
| `backend/src/api/routes/orders.js` | Order endpoints (public + authenticated) |
| `frontend/src/app/checkout/` | Checkout UI |
| `frontend/src/app/confirmation/` | Post-payment confirmation page |

## How It Works

1. **`POST /orders`** (no auth required):
   - Validates event is PUBLISHED and date is in the future.
   - Validates each tier is active, within min/max per-order limits.
   - Reserves inventory atomically via raw SQL `FOR UPDATE` (see [Price Tiers](price-tiers.md)).
   - Upserts `Contact` by `(organizationId, email)` — organization taken from `event.venue.organizationId`, email lowercased. The same email at another organization is a separate Contact ([Tenant Identity](tenant-identity.md)). Records `createAccount` / `emailSubscribed` on the Order as `optInAccount` / `optInMarketing`; they are applied to the Contact only when payment completes ([Buyer Accounts](buyer-accounts.md)).
   - Computes fee breakdown via `FeeService.computeOrderFees()` (subtotal, platformFee, processingFee, tax).
   - Generates unique `orderRef` (format: `JMP-XXXXXX`, charset excludes `0/O/1/I`).
   - Creates `Order` (status: PENDING) with `OrderItem` records including per-item fee breakdown.
   - Creates `PaymentTransaction` record (status: PENDING).
   - Creates Stripe Checkout Session (30-minute expiry) with all-in unit pricing.
   - Returns `{ orderId, orderRef, stripeCheckoutUrl, totalAmount }`.

2. **Stripe redirect**: Frontend sends user to `stripeCheckoutUrl`. Success redirects to `/confirmation?orderId=...`. Cancel redirects to `/events/:eventId?status=cancelled`.

3. **Payment completion** (webhook path): See [Stripe Integration](stripe-integration.md). `PaymentService.handleCheckoutCompleted` marks payment SUCCEEDED, creates tickets, completes order, sends confirmation email.

4. **Payment failure/expiry** (webhook path): `PaymentService.handleCheckoutFailed` releases reserved inventory, marks order FAILED.

5. **Belt-and-suspenders verification** (`POST /orders/:orderId/verify-payment`): Authenticated endpoint that checks Stripe session status directly and triggers completion if paid. Handles cases where webhook hasn't arrived yet.

6. **Guest lookup** (`POST /orders/lookup`): Matches `orderRef` (uppercased) + `contact.email` (lowercased). Returns full order detail with tickets and QR codes.

7. **My orders** (`GET /orders/my`): Authenticated endpoint returning paginated orders for the user's contact email.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/orders` | Public | Create order (guest checkout) |
| POST | `/orders/lookup` | Public | Guest order lookup (email + orderRef) |
| GET | `/orders/my` | Authenticated | Current user's orders |
| GET | `/orders/:orderId` | Authenticated | Order detail (owner or admin) |
| POST | `/orders/:orderId/verify-payment` | Authenticated | Force-verify payment with Stripe |
| GET | `/organizations/:orgId/events/:eventId/orders` | Organizer | List event orders |

## Gotchas

- **Contact is separate from User.** Guests don't need accounts. `Contact` is keyed by `(organizationId, email)`; `User` is staff. Buyers never become Users; the optional "account" is a login-enabled Contact (`accountCreatedAt`) with passwordless sign-in — see [Buyer Accounts](buyer-accounts.md).
- **OrderRef format: `JMP-XXXXXX`** using charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars). Uniqueness verified in transaction with retry loop.
- **30-minute Stripe session expiry.** If the session expires, the `checkout.session.expired` webhook releases reserved inventory.
- **Inventory rollback on Stripe API failure.** If `stripe.checkout.sessions.create` throws, order is marked FAILED and `quantityReserved` is decremented.
- **All-in pricing.** Stripe line items use computed all-in unit price (base + proportional fees). Fee breakdown stored on Order and OrderItem separately.
- **Checkout and confirmation pages render inside `BrandScope`.** Checkout uses `event.organizationBrandColor` / `organizationThemeMode` from `GET /events/:id`; the confirmation page gets the same two fields on `event` in order detail responses. Primary buttons, links, focus rings, the order-reference box and the total use the `brand` Tailwind tokens; tinted info boxes stay platform blue because the tokens have no alpha variants.
- **Confirmation page shows the organizer logo centered at the top** (`event.organizationLogoUrl` / `organizationName` on order detail responses, `max-h-20`), above the success header; the event logo sits inside the Order Details card.
- **Order detail responses include `event.logoUrl`** (`OrderService._formatOrderDetail`). The confirmation page renders it bare and left-aligned above the Order Details rows (`max-h-[65px]`), resolved via `lib/assets.resolveAssetUrl`. Local disk uploads live under `backend/uploads/` — a worktree backend serves 404 for them unless that directory is symlinked from the main checkout.
- **`POST /orders` ignores the Authorization header.** It used to write a staff JWT's `sub` onto `Contact.userId`, which failed the FK whenever that user was absent (e.g. a dev session leaking across ports). Checkout is always the same guest path; opt-ins are the only account-related input.

## Related Features

- [Price Tiers](price-tiers.md) -- inventory reservation and limits
- [Stripe Integration](stripe-integration.md) -- payment processing and webhooks
- [Ticket Issuance](ticket-issuance.md) -- tickets created after payment confirmed
- [Fee Calculation](fee-calculation.md) -- platform and processing fee computation
- [All-In Pricing](all-in-pricing.md) -- FTC-compliant price display
