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

### Tax Configuration

Tax rates are fetched automatically via Stripe Tax API using venue postal codes. Tax code `txcd_20060057` (event admissions) is used. No manual tax configuration needed.

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
