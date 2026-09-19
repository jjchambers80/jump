# Stripe Setup

**Last Updated**: 2026-09-07

## Overview

Jump uses Stripe for payment processing. Stripe Checkout Sessions handle the payment UI. Webhooks confirm payment completion. Stripe Tax API provides venue-based tax rates.

## API Version

- **Stripe SDK**: v17.3.1
- **API Version**: 2024-11-20.acacia

## Local Development

### 1. Get Test API Keys

1. Create/login to [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle to **Test mode**
3. Go to Developers → API keys
4. Copy `sk_test_...` to `STRIPE_SECRET_KEY` in `backend/.env`

### 2. Set Up Webhook Forwarding

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local backend
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the `whsec_...` output to `STRIPE_WEBHOOK_SECRET` in `backend/.env`.

Keep this terminal running while developing.

Testing Stripe Connect (spec 010 phase 2) locally also needs connected-account events:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe \
  --forward-connect-to localhost:3000/webhooks/stripe/connect
```

and `STRIPE_CONNECT_ENABLED=true` in `backend/.env`. The CLI signs both streams with the same `whsec_...`; set it as `STRIPE_CONNECT_WEBHOOK_SECRET` too (or leave it unset locally to skip verification).

### Two accounts: Jump's and the organization's (spec 022)

Production has **Jump's Stripe account** (subscriptions, the platform fee, and the Connect platform) and **each organization's own Stripe account** connected to it. Test mirrors that with a **Jump sandbox** and a **client sandbox**: `STRIPE_SECRET_KEY` in `backend/.env` is the Jump sandbox key; the client sandbox is only ever reached through Connect (`OrganizationStripeAccount.stripeAccountId`) and never has a key in Jump.

Jump's own subscriptions (spec 022 phase 2) use the same key but a separate webhook endpoint so subscription events never touch the order dispatch:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe/billing \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed
```

Set the `whsec_...` as `STRIPE_BILLING_WEBHOOK_SECRET` (or leave it unset locally). Then in the Jump sandbox create a recurring Product/Price and set `BILLING_ENABLED=true`, `JUMP_STARTER_PRICE_ID=price_...`, `BILLING_TRIAL_DAYS=30` (backend) and `NEXT_PUBLIC_BILLING_ENABLED=true`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...` (frontend, the Jump sandbox's publishable key — embedded Checkout mounts with it). Enable the customer portal under Settings › Billing › Customer portal.

### 3. Test Cards

| Card Number | Scenario |
|------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 3220` | 3D Secure authentication required |
| `4000 0000 0000 0002` | Card declined |

Use any future expiry date and any 3-digit CVC.

## Production

### Webhook Configuration

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-backend-domain.up.railway.app/webhooks/stripe`
3. Select events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`; with application payments (spec 011, `APPLICATIONS_PAYMENTS_ENABLED`) also `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` on Railway

### Connect Webhook Configuration (spec 010 phase 2)

Only when `STRIPE_CONNECT_ENABLED=true`. Connected-account events arrive on a second endpoint with its own secret:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint, choose **Listen to events on Connected accounts**
2. Endpoint: `https://your-backend-domain.up.railway.app/webhooks/stripe/connect`
3. Events: `account.updated`, `capability.updated`, `account.application.deauthorized`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.paid`, `payout.failed`
4. Copy the signing secret to `STRIPE_CONNECT_WEBHOOK_SECRET` on Railway

Destination-charge events (`checkout.session.*`, `charge.refunded`) keep arriving on the platform endpoint above; do not add them here. The backend logs which secrets are configured at startup (`Stripe webhook configuration`).

### Billing Webhook Configuration (spec 022 phase 2)

Only when `BILLING_ENABLED=true`. Jump's subscription events arrive on a third endpoint on the **same** Jump account:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint (events on your account)
2. Endpoint: `https://your-backend-domain.up.railway.app/webhooks/stripe/billing`
3. Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the signing secret to `STRIPE_BILLING_WEBHOOK_SECRET` on Railway

An order event posted here is acknowledged and ignored, and a subscription event posted to the platform endpoint is ignored there (`BillingService.isBillingEvent`); registering the subscription events on the platform endpoint as well is harmless but pointless.

### Tax Configuration

Tax rates are fetched via the Stripe Tax API using venue postal codes (tax code `txcd_20060057`, event admissions) for regions an organization sets to *Stripe Tax* on Settings › Tax. **Stripe Tax must be activated on the platform account and registered per state**, otherwise lookups fail and new events get 0% (existing cached rates are kept). Organizations can use a manual rate per state instead. See [Production Launch Checklist](production-launch-checklist.md) and [Tax Settings](../features/tax-settings.md).

## Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Mark order COMPLETED, create tickets, send confirmation email. With `metadata.applicationId`: card on file (setup mode) or application PAID (payment mode) — see [Applications](../features/applications.md) |
| `checkout.session.expired` | Mark order FAILED, release reserved tier inventory (application DRAFTs stay resumable) |
| `payment_intent.succeeded` / `payment_failed` / `canceled` | Application off-session charge outcome (`metadata.applicationId` only; ticket orders ignore these) |
| `charge.refunded` | Reconcile refunds made in the dashboard — orders via `RefundService`, applications via `ApplicationPaymentService` |
| `customer.subscription.created` / `updated` / `deleted`, `checkout.session.completed` (`mode: subscription`), `invoice.payment_failed` — **billing endpoint only** | Mirror the Jump subscription onto `PlatformCustomer` (`plan`, `subscriptionStatus`, `trialEndsAt`, `currentPeriodEndsAt`) — see [Organization Onboarding](../features/organization-onboarding.md) |

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/stripe.js` | Stripe SDK initialization |
| `backend/src/services/PaymentService.js` | Webhook processing, order completion |
| `backend/src/services/OrderService.js` | Checkout Session creation |
| `backend/src/services/TaxService.js` | Stripe Tax API rate lookup |
| `backend/src/api/routes/webhooks.js` | Webhook endpoint |
