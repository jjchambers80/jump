# Stripe Live Activation Runbook

**Status:** Pending the founder · **Issue:** EVE-3 · **Owner:** founder (Stripe account holder)

Every step here is a **live-mode** change, which means only the founder can make it. This document is the ordered list: exact page, exact setting, exact value, how to verify it took, how to undo it.

Work top to bottom. Step 1 and Step 2 are the only ones that block taking real money; the rest can follow.

> **Ground truth as of 2026-09-25**, read from the Stripe API with the test key in `backend/.env` (`npm run verify:stripe`):
> platform account `acct_1SyHzN1UMiqINVj5` (US/USD) · `charges_enabled: NO` · `payouts_enabled: NO` · statement descriptor prefix unset · Stripe Tax `pending` (missing `head_office`) · 0 tax registrations · 0 connected accounts · 0 recurring prices · one webhook endpoint registered, in **test** mode, pointing at the production backend.

---

## 0. Before anything: the account is not activated

`charges_enabled` and `payouts_enabled` are both **false** on `acct_1SyHzN1UMiqINVj5`. Until they are true, no live charge will succeed at all, in any configuration below.

| | |
|---|---|
| **Page** | <https://dashboard.stripe.com/settings/account> → **Activate your account** |
| **Do** | Complete the business profile: legal entity, EIN/SSN, business address, industry (**Event ticketing / 7999**), support phone + email, bank account for payouts |
| **Verify** | `curl https://api.stripe.com/v1/account -u sk_live_…:` → `"charges_enabled": true, "payouts_enabled": true` |
| **Undo** | Not reversible, and should not be. You can pause payouts at <https://dashboard.stripe.com/settings/payouts> |

---

## 1. Live webhook endpoint + signing secret — **blocks all real money**

This is the sharpest item in the launch audit. `POST /webhooks/stripe` is the only path that marks an order paid. Since EVE-3 the endpoint **fails closed**: with no `STRIPE_WEBHOOK_SECRET` in production it answers 500 and refuses to trust the body, so a forged event can no longer mint tickets — but it also means **no order will ever complete until this step is done**.

### 1a. Register the endpoint

| | |
|---|---|
| **Page** | <https://dashboard.stripe.com/webhooks> (make sure the **test-mode toggle is OFF**) → **Add endpoint** |
| **URL** | `https://backend-production-7d5c.up.railway.app/webhooks/stripe` |
| **Listen to** | *Events on your account* |
| **Events** | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `setup_intent.succeeded`, `setup_intent.setup_failed` |
| **API version** | Leave at the account default |
| **Verify** | The endpoint row shows **Enabled**. `npm run verify:stripe` against a live key would list it — do not run that with a live key; read it off the dashboard instead |
| **Undo** | Delete the endpoint. Orders stop completing until it or another is restored |

> The `setup_intent.*` pair is for application card-on-file (spec 011). Harmless if applications stay off.

### 1b. Set the secret in Railway

| | |
|---|---|
| **Where** | Reveal the signing secret (`whsec_…`) on the endpoint page → Railway → **backend** service → **Variables** |
| **Variable** | `STRIPE_WEBHOOK_SECRET` |
| **Value** | The `whsec_…` from 1a. **Never paste it into a Paperclip comment, a document, a commit or a chat message** — put it in Railway directly, and register it as a Paperclip secret only through a secret proposal |
| **Verify** | Redeploy, then check the boot log for `Stripe webhook configuration` → `platformSecret: true`. Then in the Stripe dashboard click **Send test webhook** → `checkout.session.completed` and confirm a **200**. A **500** with `Webhook endpoint is not configured` means the variable did not land |
| **Undo** | Delete the variable. Webhooks then 500 (by design) and orders stop completing |

### 1c. Switch the live secret key

| | |
|---|---|
| **Where** | Railway → backend → Variables |
| **Variable** | `STRIPE_SECRET_KEY` → the `sk_live_…` from <https://dashboard.stripe.com/apikeys> |
| **Also** | Frontend `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → the matching `pk_live_…` (build-time; the frontend must rebuild) |
| **Verify** | Buy one real ticket on a $1 tier, confirm the order reaches COMPLETED and the ticket email arrives, then refund it from `/admin/orders`. Check `SELECT status, deliveries FROM "StripeWebhookEvent" ORDER BY "receivedAt" DESC LIMIT 5;` — the rows should be `PROCESSED` |
| **Undo** | Put the `sk_test_…` key back and redeploy |

> **Order matters.** Set the webhook secret (1b) *before* the live key (1c). The other way round means live charges arrive at an endpoint that refuses them, and buyers are charged for orders that never complete until the secret lands. Stripe retries for three days, so it is recoverable, but do not choose it.

> **Also**: the one endpoint currently registered is a **test-mode** endpoint pointing at the production backend, so production is today receiving test events. Leave it — it is how you will keep a test path after cutover — but be aware that both modes hit the same URL and are told apart only by their signing secrets.

---

## 2. Statement descriptor — do this with step 1

| | |
|---|---|
| **Page** | <https://dashboard.stripe.com/settings/public> → **Public business information** → *Statement descriptor* |
| **Value** | A short prefix buyers will recognise, e.g. `EVENTIMUS` (2–10 chars, letters/numbers/spaces). Currently **unset** |
| **Why** | Jump appends a per-organization suffix (`PaymentSettingsService`). With no prefix the suffix is dropped and buyers see a generic descriptor — which is the single biggest driver of "I don't recognise this charge" disputes, and **Jump is liable for those disputes** (see the Connect table below) |
| **Verify** | `/admin/settings/payments` shows the prefix and accepts a suffix; the next live charge shows `PREFIX* SUFFIX` |
| **Undo** | Clear the field |

---

## 3. Stripe Tax — currently **cannot calculate at all**

`tax.settings.status` is `pending`, missing `head_office`. Stripe's own error on every lookup today:

> `You must have a valid head office address to enable automatic tax calculation in test mode.`

This is why the platform is running North Carolina on a **MANUAL 7.25%** rate, and why NY and CA return 0%.

**Read this before deciding:** a 0% from Stripe Tax means *"the platform is not registered in this jurisdiction"*, **not** *"this sale is tax-free"*. Jump already treats it that way — `TaxService.getTaxRateForVenue` throws instead of returning 0, and the error is stored on the `TaxRegion` row for the settings page — so nothing silently under-collects. But it also means **turning Stripe Tax on without registering somewhere changes nothing except adding an error message.**

### 3a. Head office

| | |
|---|---|
| **Page** | <https://dashboard.stripe.com/settings/tax> → **Head office** |
| **Value** | Jump's registered business address |
| **Verify** | `tax.settings.retrieve()` → `"status": "active"`, `status_details.pending.missing_fields` empty |
| **Undo** | Changing it back returns the status to `pending` |

### 3b. Registrations — the actual decision

| | |
|---|---|
| **Page** | <https://dashboard.stripe.com/settings/tax/registrations> → **Add registration** |
| **Value** | One per US state where Jump has a sales-tax obligation for admissions |
| **Verify** | `tax.registrations.list()` shows `status: active`; then in Jump set that state's region to source **STRIPE** at `/admin/settings/taxes` and confirm a non-zero rate with no `lastError` |
| **Undo** | Set the registration's `expires_at`, and put the Jump region back to MANUAL |

> **This is a tax-advisory question, not an engineering one.** Registrations follow economic nexus, which depends on where events are held and how much is sold. Do not register a state on a guess — a wrong registration is a filing obligation. **Until this is settled, MANUAL rates are the correct configuration and the first event can launch on them.** Confirmed working end-to-end in test mode: `npm run verify:checkout-tax` produced Checkout Session `cs_test_a1GCaJ…` where a $100 subtotal in Raleigh NC carried exactly $7.25 of tax and Stripe's `amount_total` matched the order total to the cent.

---

## 4. Stripe Connect — optional for the first event

Not needed to sell a ticket: with `STRIPE_CONNECT_ENABLED` unset, every charge stays on the platform account and organizers are paid outside Stripe. Turn it on when an organizer needs their own payouts.

| Step | Where | Value | Verify | Undo |
|---|---|---|---|---|
| Enable Connect | <https://dashboard.stripe.com/connect/accounts/overview> → **Get started** | Platform type: **Express** | `accounts.list()` stops erroring | Cannot fully disable once live; leave the flag off instead |
| Branding | <https://dashboard.stripe.com/settings/connect> → *Branding* | Business name, icon, brand colour | Onboarding page shows them | Clear the fields |
| Dispute liability | <https://dashboard.stripe.com/settings/connect> → *Loss liability* | See below | `accounts.retrieve(acct_…)` → `controller.losses.payments` | Switch back |
| Turn it on in Jump | Railway → backend Variables | `STRIPE_CONNECT_ENABLED=true` | An org with an active account gets a destination charge; `PaymentTransaction.stripeAccountId` is set | Unset the variable — existing orders are unaffected, new ones go back to the platform |
| Connect webhook | <https://dashboard.stripe.com/webhooks> → Add endpoint, **Events on connected accounts** | URL `…/webhooks/stripe/connect`, events `account.updated`, `capability.updated`, `account.external_account.created/updated/deleted`, `account.application.deauthorized`, `payout.paid`, `payout.failed` | Boot log `connectSecret: true`; send a test event, expect 200 | Delete the endpoint |
| Its secret | Railway | `STRIPE_CONNECT_WEBHOOK_SECRET` = that endpoint's `whsec_…` | As above | Delete — the endpoint then 500s by design |

**The money model, so there are no surprises** (full table in `docs/wiki/features/connect-payouts.md`): destination charges on the platform account. Jump is merchant of record, holds the funds first, keeps the service fee + processing fee + tax as `application_fee_amount`, pays Stripe's 2.9% + 30¢ and does **not** get it back on a refund, and remits the sales tax. The organization receives the ex-tax subtotal. A refund reverses the organization's share pro rata.

> **⚠ The decision worth making deliberately: `losses.payments = application` means Jump pays every chargeback** — after the organizer has already been paid their subtotal and possibly paid out to their bank, with no automatic clawback. At a 0.5% dispute rate on $50 tickets that is roughly $0.25 + a $15 dispute fee per disputed sale, all on Jump. Setting it to `stripe` instead puts disputes on the connected account. Decide before the first Connect organizer sells anything; changing it later does not move existing disputes.

---

## 5. Subscription billing — **blocked on a pricing decision, not on code**

The code is built and dark. `billingEnabled()` refuses to turn on without a price id, so nothing can half-ship. There are **zero** recurring prices on the account — the founder has not chosen one. See the pricing question on EVE-3; do not let anyone pick a number on your behalf.

Once the price is decided:

| Step | Where | Value | Verify | Undo |
|---|---|---|---|---|
| Create the product | <https://dashboard.stripe.com/products> → **Add product** | Name `Jump Starter`, recurring, monthly or yearly, the chosen amount | The product page shows an active price | Archive the product |
| Copy the price id | Same page | `price_…` | — | — |
| Billing webhook | <https://dashboard.stripe.com/webhooks> → Add endpoint | URL `…/webhooks/stripe/billing`, events `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` | Boot log `billingSecret: true` | Delete the endpoint |
| Railway (backend) | Variables | `BILLING_ENABLED=true`, `JUMP_STARTER_PRICE_ID=price_…`, `STRIPE_BILLING_WEBHOOK_SECRET=whsec_…`, `BILLING_TRIAL_DAYS=30` | `/signup` shows the subscribe step; Settings › Plan opens | Unset `BILLING_ENABLED` — signup returns to name → survey → done |
| Railway (frontend) | Variables | `NEXT_PUBLIC_BILLING_ENABLED=true`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` | Settings › Plan appears in the nav | Unset and rebuild |
| Dunning | <https://dashboard.stripe.com/settings/billing/automatic> | Retry schedule; what happens after the final retry (recommend **cancel**, so an unpaid org stops accruing) | A test subscription with a failing card follows the schedule | Change the setting |

Order matters: create the price, register the webhook, set the backend variables, then the frontend. `BILLING_ENABLED=true` without `JUMP_STARTER_PRICE_ID` logs a warning and stays off rather than breaking signup.

---

## 6. After cutover — verify money reconciles

```sql
-- Every delivery Stripe made, and what we did with it
SELECT "endpoint", "type", "status", "deliveries", "error", "receivedAt"
FROM "StripeWebhookEvent" ORDER BY "receivedAt" DESC LIMIT 50;

-- Anything that failed
SELECT * FROM "StripeWebhookEvent" WHERE "status" = 'FAILED';

-- Anything Stripe had to retry
SELECT * FROM "StripeWebhookEvent" WHERE "deliveries" > 1;
```

Then reconcile both directions — every Stripe payment/refund maps to exactly one Orders row and every Orders row to exactly one Stripe object. `/admin/orders` searches `pi_` / `re_` / `pyr_` / `cs_` ids by equality, which is the handle. That full run is EVE-9's sign-off, not this runbook's.

## Rollback in one move

If live payments misbehave: set `STRIPE_SECRET_KEY` back to the `sk_test_…` value and redeploy. Live charges stop immediately. The live webhook endpoint keeps delivering and now 500s on signature mismatch, which is correct — those events queue at Stripe for three days and replay safely once the live key returns, because every delivery is deduped by `(endpoint, stripeEventId)`.
