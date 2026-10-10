# Stripe Test Mode: Direct Charges Runbook

**Status**: Runbook (spec 047 D0-S)
**Last Updated**: 2026-10-09

How to reproduce, on a laptop and in Stripe **test mode only**, the end-to-end check of direct charges on an organization's own Stripe account: onboarding, a ticket purchase, the application fee, the refund, and the paused-account refusal. Background: [Connect Payouts](../features/connect-payouts.md).

## 0. Prerequisites (once per Stripe sandbox)

- `backend/.env` `STRIPE_SECRET_KEY` starts with `sk_test_`. Stop if it does not.
- **Connect is enabled on the platform's test account.** Without it, *Create a Stripe account* fails with Stripe's "You can only create new accounts if you've signed up for Connect". Fix: <https://dashboard.stripe.com/test/connect/accounts/overview> → *Get started* (platform profile; connected accounts use the full Stripe dashboard). Only the account owner can accept this.
- Stripe CLI installed (`stripe version`).

## 1. Private database

Never use the shared dev database for this. Base it on `backend/.env` `DATABASE_URL` with another database name:

```bash
DB=postgresql://<user>@localhost:5433/jump_047s_dev     # same host/user as backend/.env
psql "${DB%/*}/postgres" -c 'CREATE DATABASE jump_047s_dev'
(cd packages/db && DATABASE_URL=$DB npx prisma migrate deploy)
DATABASE_URL=$DB npm run db:seed                          # org "Jump Events Co.", admin@jump.events
```

## 2. Webhooks

```bash
stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret        # → whsec_… (keep it out of git)
stripe listen --api-key "$STRIPE_SECRET_KEY" \
  --forward-to localhost:3012/webhooks/stripe \
  --forward-connect-to localhost:3012/webhooks/stripe/connect
```

One `stripe listen` session signs both forwards with the same secret, so it goes into both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`.

## 3. Servers (free ports; env overrides only, never edit the `.env` files)

```bash
# backend/
PORT=3012 DATABASE_URL=$DB STRIPE_CONNECT_ENABLED=true \
STRIPE_WEBHOOK_SECRET=$WHSEC STRIPE_CONNECT_WEBHOOK_SECRET=$WHSEC \
FRONTEND_URL=http://localhost:3013 BACKEND_URL=http://localhost:3012 \
RESEND_API_KEY=re_disabled APPLICATIONS_PAYMENTS_ENABLED=true \
node src/api/server.js

# frontend/
DATABASE_URL=$DB NEXT_PUBLIC_API_URL=http://localhost:3012 AUTH_URL=http://localhost:3013 \
npx next dev -p 3013
```

`RESEND_API_KEY=re_disabled` keeps receipts from going out (sends fail and are logged). Leave `STRIPE_CONNECT_CLIENT_ID` unset unless you test OAuth: then only *Create a Stripe account* is offered. To test OAuth too, Stripe's documented test client id is `ca_FkyHCg7X8mlvCUdMDao4mMxagUfhIwXb`, or use the sandbox's own one from Connect › Settings › OAuth with `http://localhost:3013/admin/settings/payments/payout-bank-account` as a redirect URI.

Sign in as `admin@jump.events`. Locally, the simplest way is the same HS256 cookie the e2e tests mint (`frontend/e2e/helpers/session.ts` `mintSessionToken`, with the seeded user's real id): set it as `authjs.session-token` on `localhost`. The Auth.js `jwt` callback then loads the real claims from the database.

## 4. Onboard (S1)

Settings › Payments › Payout bank account → **Create a Stripe account**. On Stripe's hosted page use the [test values](https://docs.stripe.com/connect/testing):

| Field | Value |
|---|---|
| Phone | `000 000 0000`; SMS code `000000` |
| Date of birth | `01/01/1901` |
| SSN | `000-00-0000` (last 4: `0000`) |
| Address line 1 | `address_full_match` |
| Business tax id (EIN) | `000000000` |
| Bank | routing `110000000`, account `000123456789` (`000111111116` = payouts fail) |
| Identity document | "Use test document" (`file_identity_document_success`) |

Back on the page (`?onboarding=complete`), expect **Connected**. Check:

- `stripe listen` shows `account.updated` posted to `/webhooks/stripe/connect` with `[200]`.
- `SELECT "stripeAccountId","chargesEnabled","detailsSubmitted","activeCapabilities" FROM "OrganizationStripeAccount";` → `chargesEnabled = t`.

## 5. Buy a ticket (S2/S3)

Storefront: `http://localhost:3013/events/<event slug>` → pick a tier → *Proceed to Checkout* → *Continue to payment*. On Stripe Checkout untick Link's "Save my information" (it otherwise requires a phone number).

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined (`card_declined`); the order stays PENDING until the session expires, then the sweep fails it and releases the tier |
| `4000 0000 0000 0259` | Succeeds, then opens a dispute (`charge.dispute.created` on the Connect endpoint → `Dispute` row, organizer alert) |

Any future expiry, any CVC, any ZIP. Then check:

```bash
stripe get /v1/checkout/sessions/cs_test_… --stripe-account acct_…   # session lives on the org account
stripe get /v1/payment_intents/pi_…       --stripe-account acct_…   # application_fee_amount = platform fee in cents, transfer_data null
```

- `checkout.session.completed` arrived on `/webhooks/stripe/connect` (`SELECT endpoint,type,status FROM "StripeWebhookEvent"` → endpoint `CONNECT`, `PROCESSED`).
- Order `COMPLETED`, tickets issued, `PaymentTransaction.stripeAccountId = acct_…`, `applicationFee` = the order's platform fee.
- The same purchase on the platform account (no row, or flag off) still works and records `stripeAccountId = NULL`.

## 6. Refund (S4)

`/admin/orders` → the order → **Refund Order** → **Confirm Refund**. Check:

```bash
stripe get /v1/refunds/re_… --stripe-account acct_…
stripe get /v1/application_fees/fee_…        # amount_refunded = the fee (platform side, no header)
```

Order `REFUNDED`; `charge.refunded` processed on the Connect endpoint; no `reverse_transfer` / transfer reversal (there is no transfer).

## 7. Paused account

```sql
UPDATE "OrganizationStripeAccount" SET "chargesEnabled" = false, "detailsSubmitted" = true WHERE "stripeAccountId" = 'acct_…';
```

A checkout now answers **409 `PAYMENTS_UNAVAILABLE`** and the storefront shows "This organizer can't take payments right now. Please try again later."; the order is `FAILED` and the tier's `quantityReserved` is back where it was. Restore with `"chargesEnabled" = true` (or *Refresh* on the payout page, which re-syncs from Stripe). No real account is needed for this check: a synthetic row with a fake `acct_…` id behaves the same, because the refusal happens before any Stripe call.

## 8. Paid application (S5)

With `APPLICATIONS_PAYMENTS_ENABLED=true`: create a PAID application form for an event, apply on the storefront (card `4242…` saved on the **org account's** Customer), approve in the admin, then pay / charge. Check the SetupIntent, Customer and PaymentIntent with `--stripe-account acct_…`, and `Contact.stripeCustomerAccountId = acct_…`.

## 9. Script check

```bash
cd backend && npm run verify:stripe -- --direct acct_…
```

Creates a $50 direct charge with a $2.50 application fee on the account, refunds it twice with one idempotency key, and prints PASS when the fee was returned once.

## Clean up

Stop `stripe listen` and both servers; `DROP DATABASE jump_047s_dev`. Test-mode connected accounts can be deleted in the dashboard (Connect › Accounts) or with `stripe delete /v1/accounts/acct_…`.

## Related

- [Connect Payouts](../features/connect-payouts.md), [Stripe Setup](stripe-setup.md), [Stripe Live Activation](stripe-live-activation.md)
