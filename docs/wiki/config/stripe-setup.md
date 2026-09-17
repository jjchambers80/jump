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
3. Select events: `checkout.session.completed`, `checkout.session.expired`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` on Railway

### Connect Webhook Configuration (spec 010 phase 2)

Only when `STRIPE_CONNECT_ENABLED=true`. Connected-account events arrive on a second endpoint with its own secret:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint, choose **Listen to events on Connected accounts**
2. Endpoint: `https://your-backend-domain.up.railway.app/webhooks/stripe/connect`
3. Events: `account.updated`, `capability.updated`, `account.application.deauthorized`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.paid`, `payout.failed`
4. Copy the signing secret to `STRIPE_CONNECT_WEBHOOK_SECRET` on Railway

Destination-charge events (`checkout.session.*`, `charge.refunded`) keep arriving on the platform endpoint above; do not add them here. The backend logs which secrets are configured at startup (`Stripe webhook configuration`).

### Tax Configuration

Tax rates are fetched via the Stripe Tax API using venue postal codes (tax code `txcd_20060057`, event admissions) for regions an organization sets to *Stripe Tax* on Settings › Tax. **Stripe Tax must be activated on the platform account and registered per state**, otherwise lookups fail and new events get 0% (existing cached rates are kept). Organizations can use a manual rate per state instead. See [Production Launch Checklist](production-launch-checklist.md) and [Tax Settings](../features/tax-settings.md).

## Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Mark order COMPLETED, create tickets, send confirmation email |
| `checkout.session.expired` | Mark order FAILED, release reserved tier inventory |

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/stripe.js` | Stripe SDK initialization |
| `backend/src/services/PaymentService.js` | Webhook processing, order completion |
| `backend/src/services/OrderService.js` | Checkout Session creation |
| `backend/src/services/TaxService.js` | Stripe Tax API rate lookup |
| `backend/src/api/routes/webhooks.js` | Webhook endpoint |
