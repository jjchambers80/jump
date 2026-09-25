# Live Stripe Activation Runbook

**Last Updated**: 2026-09-25
**Owner of the live account**: the founder. Every step below is a founder action in the Stripe Dashboard or on Railway. Agents prepare and verify; agents never touch live mode.

This is the ordered, dependency-correct sequence for taking Jump from test mode to live mode. It complements two existing documents rather than replacing them:

- [Stripe Setup](stripe-setup.md) — what each endpoint and variable *is*.
- [Production Launch Checklist](production-launch-checklist.md) — the full per-spec backlog, including items unrelated to Stripe.

Use **this** file for the go-live sitting: the order matters, and several steps are one-way or invalidate earlier work if done out of sequence.

---

## 0. Decisions that gate everything

Do not start Phase 1 until these three are answered. Each one changes a later step's value or whether that step happens at all.

| Decision | Options | What it blocks | Default if you want to move fastest |
|---|---|---|---|
| **Statement descriptor prefix** | Any 2–10 char string, letters/numbers/spaces | Phase 2. Until set, no organization can save a statement name and buyers see the raw account name. | `JUMP` — 4 chars, leaves organizations 16 |
| **Connect model** | Express + destination charges (**built**) vs Standard OAuth (**not built**) | All of Phase 6 | Express — see §0.2 |
| **Stripe Tax** | Activate + register per state vs stay on manual rates per organization | Phase 5 | Manual rates for launch; Stripe Tax later |

### 0.1 Statement descriptor prefix — how to pick the length

Stripe caps the whole card descriptor at **22 characters**, and joins the platform prefix to each organization's suffix with `* `. So:

```
characters an organization gets = 22 − len(prefix) − 2
```

`JUMP` → organizations get **16**. A 10-character prefix leaves only 10, which truncates most real venue names. Shorter is strictly better here. This is enforced in `suffixBudget()` (`backend/src/services/PaymentSettingsService.js`), so a too-long suffix is rejected at save time rather than at Checkout.

### 0.2 Connect model — the code has already made this choice

Jump is built for **Stripe-created Express accounts with destination charges**, and that is not a dashboard toggle:

- `ConnectService._createParams()` creates accounts with `controller.stripe_dashboard.type = 'express'`, `controller.fees.payer = 'application'`, `controller.losses.payments = 'application'`, `requirement_collection: 'stripe'`.
- Onboarding is a Stripe-hosted `accountLinks` flow (`type: 'account_onboarding'`), not an OAuth "Connect with Stripe" redirect.
- Charges run on **Jump's** account with `transfer_data.destination` + `application_fee_amount` (`ApplicationPaymentService`, `OrderService`).

What that means in money terms: **Jump is merchant of record.** Jump's Stripe fees apply, Jump owns disputes and chargeback liability, Jump's descriptor is on the buyer's statement, and tax is assessed against **Jump's** registrations. Organizers receive the ex-tax subtotal; Jump keeps `application_fee_amount` (platform fee + processing + tax).

Choosing **Standard OAuth instead is a development project, not a configuration change** — new onboarding UI, new account linking, and (if charges should also run on the organizer's account as *direct* charges) a different liability, tax, descriptor and refund model throughout. Do not pick it as part of a go-live sitting. If the goal is only "let organizers use their existing Stripe account," note that destination charges to a Standard account keep Jump as merchant of record and change *only* the onboarding flow — still unbuilt, but much smaller.

Recommendation: **ship Express.** Revisit Standard only if organizers actually refuse Express onboarding.

### 0.3 Stripe Tax — what activation actually buys

As of the last production check the platform account had `tax.settings.status = pending` and **zero registrations**. With destination charges the registrations must be on the **platform** account, so activating Stripe Tax means Jump asserts it is registered to collect in those states.

- Activated + registered → `TaxService.getTaxRateForVenue()` returns a real rate per venue postal code (tax code `txcd_20060057`, event admissions).
- Not activated → that lookup throws, **new** events in Stripe-Tax regions start at **0%**, and existing events keep their last cached rate. Nothing crashes; it silently under-collects.
- Manual rate per state per organization needs no activation at all and is the current NC setup (7.25%).

A wrong tax rate is the organizer's legal exposure, not a rounding error. If there is no tax professional sign-off on which states Jump is registered in, **use manual rates for launch** and leave Stripe Tax for later. Do not activate Stripe Tax to "get it out of the way."

---

## 1. Activate the live Stripe account

Nothing else works until the account itself can take charges.

1. Dashboard → toggle **off** Test mode (top right) so you are in live mode for the rest of this runbook.
2. Complete **Settings → Business → Account details**: legal entity, EIN/SSN, address, industry, support contact.
3. Add the **payout bank account** under Settings → Business → Bank accounts and payout schedule.
4. Wait for the account to clear review.

**Verify**: Settings → Business shows no outstanding requirements. Do not proceed while any "Provide required information" banner is up — `charges_enabled` gates the Settings › Payments page in live mode (`PaymentSettingsService.getProviderStatus()` reports `charges: 'unavailable'` with the reason).

**Rollback**: none needed; activating an account is not destructive.

---

## 2. Set the statement descriptor prefix

**Page**: Dashboard (live) → Settings → Business → **Public details** → *Statement descriptor* / shortened descriptor.

**Value**: the string chosen in §0.1, e.g. `JUMP`.

**Verify**: after Phase 3 (once the live key is deployed), Settings › Payments in Jump shows a statement name section that is enabled rather than *Not available*, and the character budget shown equals `22 − len(prefix) − 2`. The value is read live from the account via `account.settings.card_payments.statement_descriptor_prefix` and cached for 5 minutes, so allow that long.

**Rollback**: change the value back. Harmless — it only affects descriptors on charges created after the change.

---

## 3. Register the three webhook endpoints — **before** flipping the key

Do this before Phase 4. The moment the live key is deployed, live events start arriving; if an endpoint or secret is missing at that moment the event is rejected (see the note at the end of this phase) and you are relying on Stripe's retries.

All three live on the **same** live account, as three separate endpoint registrations with three separate signing secrets. Dashboard → Developers → **Webhooks** → Add endpoint.

Backend host is the Railway backend service domain, e.g. `https://backend-production-7d5c.up.railway.app`. Confirm the current value on Railway before pasting.

### 3a. Platform endpoint (orders + vendor/sponsor application payments)

- **URL**: `https://<backend>/webhooks/stripe`
- **Type**: events on your account
- **Events** — this is the full set the handler actually dispatches:
  | Event | Why |
  |---|---|
  | `checkout.session.completed` | order paid → tickets issued; application card-on-file / paid |
  | `checkout.session.async_payment_succeeded` | **required** for Cash App / Klarna / Affirm / Afterpay — these settle asynchronously |
  | `checkout.session.async_payment_failed` | the matching failure |
  | `checkout.session.expired` | release reserved tier inventory |
  | `charge.refunded` | reconcile refunds issued in the Stripe dashboard |
  | `payment_intent.succeeded` | off-session application charge at approval |
  | `payment_intent.processing` | off-session charge not yet settled |
  | `payment_intent.payment_failed` | declined application charge → *Payment due* |
  | `payment_intent.canceled` | abandoned application charge |
- **Secret** → `STRIPE_WEBHOOK_SECRET`

> The two `async_payment_*` events and `payment_intent.processing` are missing from the older event list in [Stripe Setup](stripe-setup.md) and the launch checklist. They matter as soon as any organization enables a non-card method from `PAYMENT_METHOD_ALLOWLIST` (Cash App, Affirm, Klarna, Afterpay): without `checkout.session.async_payment_succeeded`, a buyer who pays with one of those is charged and **never gets a ticket**. Subscribe to all nine now even if only cards are enabled at launch.

### 3b. Connect endpoint (only if doing Phase 6)

- **URL**: `https://<backend>/webhooks/stripe/connect`
- **Type**: **Listen to events on Connected accounts** — this is a different radio button, not a different URL pattern
- **Events**: `account.updated`, `capability.updated`, `account.application.deauthorized`, `account.external_account.created`, `account.external_account.updated`, `account.external_account.deleted`, `payout.paid`, `payout.failed`
- **Secret** → `STRIPE_CONNECT_WEBHOOK_SECRET`
- **Do not** add `checkout.session.*` or `charge.refunded` here. Destination-charge events belong on the platform endpoint; duplicating them here means the Connect handler sees events it has no case for.

### 3c. Billing endpoint (only if turning on subscriptions, Phase 7)

- **URL**: `https://<backend>/webhooks/stripe/billing`
- **Type**: events on your account
- **Events**: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- **Secret** → `STRIPE_BILLING_WEBHOOK_SECRET`

The two `checkout.session.completed` registrations (3a and 3c) do not conflict: `BillingService.isBillingEvent()` claims only sessions with `mode: 'subscription'`, and each endpoint ignores and acknowledges the other's events.

**Verify**: three endpoints listed in live mode, each showing its own signing secret. Copy each secret straight into Railway — never into a comment, commit, or document.

> **Behaviour when a secret is missing.** In production, an endpoint with no configured signing secret now rejects every event with **503** and logs `webhook_secret_missing`. It used to accept the unsigned body, which made it an unauthenticated write path into the ledger. 503 is deliberate: Stripe retries for days, so events survive until the secret is set — but they are **not** processed in the meantime. Set each secret in the same Railway change as the key.

---

## 4. Swap to the live key

**Page**: Railway → backend service → Variables.

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | live secret key (`sk_live_…` or a restricted live key) |
| `STRIPE_WEBHOOK_SECRET` | secret from 3a |

Set both in **one** change, then redeploy.

There is no separate "live mode" flag. `stripeMode()` derives the mode purely from whether the key starts with `sk_test_`, and every dashboard deep link, the mode badge on Settings › Payments, and the `charges_enabled` gate follow from that automatically.

If the frontend is showing the embedded billing card form, also set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the live **publishable** key and redeploy the frontend — it is baked in at build time.

**Verify** — all four:

1. Backend startup log line `Stripe webhook configuration` shows `platformSecret: true`.
2. Settings › Payments in Jump shows **Live mode**, not Test mode, and a statement name section that is enabled.
3. Dashboard → Developers → Webhooks → the platform endpoint → **Send test webhook** → the attempt shows `200`.
4. No `webhook_secret_missing` lines in the backend logs.

**Rollback**: put the test key and test webhook secret back and redeploy. Safe at this point because no live charge exists yet. After Phase 6 this is no longer a clean rollback — connected accounts are per-mode.

---

## 5. Live end-to-end payment test

This is the step that proves money behaves. Do it before any real on-sale, with a real card, for a real (small) amount.

1. Create a throwaway published event with one ticket tier at the **lowest amount that is not free** — $1.00. Keep it unlisted / obscure.
2. Buy one ticket as a buyer, with a real personal card, on the live storefront.
3. Check, in order:
   - Stripe → Payments: the charge is `Succeeded`, amount `$1.00`, and the **card statement descriptor** shows the prefix from Phase 2.
   - Jump → Orders: exactly one order, `COMPLETED`, amount matching the charge to the cent.
   - The confirmation email arrived and the ticket QR resolves.
   - Developers → Webhooks → platform endpoint: `checkout.session.completed` delivered `200` on the first attempt.
4. Refund it: Jump admin → the order → refund in full.
   - Stripe → the payment shows the refund, full amount.
   - Jump → Orders: the order reads `REFUNDED`, refunded total equals the charge.
   - No duplicate refund appears in Stripe.
5. Unpublish / delete the throwaway event.

**Both directions must reconcile**: one Stripe charge ↔ one Orders row, one Stripe refund ↔ one refund record. Matching totals alone is not enough.

If tax is expected on this transaction, confirm the tax line on the order equals the rate the venue's state is configured for — a code read is not proof.

**Rollback**: the refund in step 4 *is* the rollback. Note that the buyer still sees a $1.00 debit and a $1.00 credit on their statement; a refund is not the same as never having charged.

---

## 6. Stripe Tax (only if §0.3 chose activation)

1. Dashboard (live) → **Settings → Tax** (`https://dashboard.stripe.com/settings/tax`) → complete the origin address and activate.
2. Add a **registration** for every state where an organization collects. Registrations are the platform's, not the organization's.
3. In Jump → Settings › Tax, set each region to *Stripe Tax* (or leave on *Manual rate*).
4. **Review the backfill**: migration `20260914010000_tax_regions` marked every existing organization/state as *Collecting via Stripe Tax*. Confirm each is genuinely registered; set *Not collecting* where it is not. This is the item most likely to over-collect silently.

**Verify**: Settings › Tax shows the service pill as *Active* (5-minute cache) and each region shows a concrete rate, not *Lookup failed*. Then run one more $1.00 live purchase in a taxed state and confirm the tax line on the order matches the registered rate.

**Rollback**: switch the affected regions back to *Manual rate* with the previously used percentage. Orders already placed keep the amounts they were charged — recalculation only touches upcoming DRAFT/PUBLISHED events.

---

## 7. Stripe Connect (Express)

Do this **after** Phase 4. Connected accounts are per Stripe mode: anything onboarded under the test key is void in live mode and must be onboarded again.

1. Dashboard (live) → **Connect → Get started**: platform profile, business type *platform / marketplace*, accept the Connect terms.
2. **Connect → Settings → Branding**: name, icon, brand colour. This is what organizers see on the hosted onboarding page and in their Express dashboard.
3. **Connect → Settings → Express dashboard**: payouts and bank-account editing on, payment details visible. Jump deep-links organizers here.
4. **Connect → Tax forms**: enable 1099-K filing by Stripe for Express accounts. Jump is merchant of record, so this is Jump's filing obligation to delegate — confirm with an accountant alongside §0.3.
5. Register the Connect webhook endpoint from **3b** if not already done, and set `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. Railway → `STRIPE_CONNECT_ENABLED=true` → redeploy.

**Verify**: startup log `Stripe webhook configuration` shows `platformSecret: true, connectSecret: true, connectEnabled: true`. Then, with one internal organization:

- Settings › Payments → *Set up payouts* → complete Express onboarding → status reaches **Receiving payouts**.
- Place one $1.00 live order for that organization's event. In Stripe, the payment shows `application_fee_amount` = platform fee + processing + tax, and the connected account's balance received the ex-tax subtotal.
- Change the payout schedule from Jump and confirm it changed on the account.
- Refund that order and confirm both the **transfer reversal** and the **application-fee refund** appear, and that Jump's Orders row reads `REFUNDED`.

**Rollback**: `STRIPE_CONNECT_ENABLED=false` + redeploy. Routing stops immediately and the Payments page renders as pre-Connect; already-onboarded accounts are untouched and resume when re-enabled. Charges already routed are not reversed by this flag.

---

## 8. Subscription billing (optional, independent)

Nothing about taking ticket money depends on this. Skip it for launch unless charging organizers on day one is the plan.

1. Decide the STARTER price. Create the recurring **Product + Price in the live account** — a test-mode `price_…` will not work with a live key, and `billing.js` keeps billing off entirely if `JUMP_STARTER_PRICE_ID` is unset. The product name is shown as the plan name on Settings › Plan.
2. Settings → Billing → **Customer portal**: enable cancel, payment-method update, invoice history.
3. Register the billing endpoint from **3c**, set `STRIPE_BILLING_WEBHOOK_SECRET`.
4. Railway backend: `BILLING_ENABLED=true`, `JUMP_STARTER_PRICE_ID=price_…` (live), `BILLING_TRIAL_DAYS=30`. Frontend: `NEXT_PUBLIC_BILLING_ENABLED=true` and the live publishable key. Redeploy both.

**Verify**: startup log shows `billingSecret: true, billingEnabled: true`. Create an organization → the subscribe screen shows the trial ledger → subscribe → Settings › Plan shows *Free trial* with the end date → *Manage billing* opens the portal → cancel there → the plan flips to Free once `customer.subscription.deleted` arrives.

**Rollback**: `BILLING_ENABLED=false` + redeploy hides the subscribe step and Settings › Plan. Existing subscriptions keep billing in Stripe — cancel them in the dashboard separately.

---

## Order of operations, condensed

```
0. Decide: prefix, Connect model, tax posture
1. Activate live account (business details + bank)
2. Set statement descriptor prefix
3. Register 3 webhook endpoints, collect 3 secrets   ← before the key
4. Railway: live STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET, redeploy
5. Live $1 purchase + refund, reconcile both directions
6. Stripe Tax (only if chosen)  →  re-verify a taxed $1 purchase
7. Connect: platform setup → secret → STRIPE_CONNECT_ENABLED=true → onboard 1 org → $1 routed order + refund
8. Billing (optional): live price → portal → secret → BILLING_ENABLED=true
```

## Things that bite if done out of order

- **Connect before the live key** — connected accounts are per-mode; test-mode onboarding is void live and has to be redone.
- **Key before webhook secrets** — every live event is rejected with 503 until the secret lands. Stripe's retries cover it, but orders sit incomplete in the meantime.
- **Test-mode price id with a live key** — billing silently stays off (`billing.js` logs a warning and returns false).
- **A long descriptor prefix** — a 10-character prefix leaves organizations 10 characters; changing it later does not rewrite descriptors on existing charges.
- **Activating Stripe Tax without reviewing the backfill** — every pre-existing organization/state is already marked *Collecting via Stripe Tax*, so activation starts collecting in states Jump may not be registered in.

## Related

- [Stripe Setup](stripe-setup.md) · [Production Launch Checklist](production-launch-checklist.md) · [Environment Variables](environment-variables.md)
- [Connect Payouts](../features/connect-payouts.md) · [Payments Settings](../features/payments-settings.md) · [Tax Settings](../features/tax-settings.md)
