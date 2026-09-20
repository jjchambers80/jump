# Connect Payouts

**Status**: Implemented (spec 010 phase 2, 2026-09-16; Finance section + Payout bank account page 2026-09-19) — deploys dark behind `STRIPE_CONNECT_ENABLED`; not yet enabled in production. Plan: `specs/010-payments-settings/plan-phase-2.md`.
**Last Updated**: 2026-09-19

## Overview

Organizations receive ticket revenue in their own bank account through **Stripe Connect Express** accounts. Jump stays the merchant of record: every Checkout Session is still created on the platform Stripe account, and when the organization has an active connected account the session becomes a **destination charge** — Stripe moves the ex-tax ticket subtotal to the organization and the platform keeps the service fee, processing fee and sales tax (`application_fee_amount`). Refunds on those orders reverse the transfer and return the platform's fee pro rata. Organizations connect their bank on a Stripe-hosted onboarding page from **Settings › Payments › Payout bank account** (empty state → *Connect account*; afterwards bank name + last four, *Change bank* → Express dashboard, payout schedule), and watch balance and payout history under **Finance › Payouts** (`/admin/finance/payouts`, live from Stripe). Jump stores no bank numbers beyond a `last4` snapshot.

Until an organization finishes onboarding (or while the flag is off) nothing changes: charges land on the platform account exactly as before and the platform settles outside Jump.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/ConnectService.js` | Account lifecycle: `startOnboarding` (create Express account + Account Link), `loginLink`, `syncAccount` / `applyAccount` (Stripe Account object → row), `updatePayoutSettings`, `markDisconnected`, `recordPayout`, `destinationFor` (the routing rule), and `payoutActivity` (live `balance.retrieve` + `payouts.list` on the connected account for Finance › Payouts; `serializePayout` exported) |
| `backend/src/services/PaymentSettingsService.js` | `checkoutOptionsFor(organization, { fees, lineItems })` adds `transfer_data` + `application_fee_amount`; `applicationFeeCents` (exported, pure) |
| `backend/src/services/OrderService.js` | Builds `line_items` first, passes them to `checkoutOptionsFor`, records `stripeAccountId` / `applicationFee` on `PaymentTransaction`, logs `connect_charge_routed` |
| `backend/src/services/RefundService.js` | `_createStripeRefund(…, { connected })` → `reverse_transfer: true, refund_application_fee: true` |
| `backend/src/api/routes/webhooks.js` | `POST /webhooks/stripe/connect` (connected-account events, own secret) |
| `backend/src/api/routes/admin.js` | `connect/onboard`, `connect/login-link`, `connect/sync`, `connect/payouts`; `GET /admin/settings/payments` carries `connect`; `GET /admin/finance/payouts` |
| `backend/src/api/validators/paymentValidators.js` | `validateUpdatePayoutSettings` (shape; values validated in the service) |
| `packages/db/prisma/schema.prisma` | `OrganizationStripeAccount`; `PaymentTransaction.stripeAccountId`, `applicationFee` (migration `20260916120000_stripe_connect`) |
| `frontend/src/app/admin/settings/payments/page.tsx` | Provider card payouts half (status pill, onboarding action, Express `Manage`), `Payout bank account` row under `Payment methods` (always shown; `Coming soon` while the flag is off) |
| `frontend/src/app/admin/settings/payments/payout-bank-account/page.tsx` | Payout bank account page: empty state (`Connect account` → onboarding), bank on file (`•••• last4`, `Change bank` → Express dashboard, `Refresh`), payout schedule row, *About payouts* copy, `?onboarding=complete|refresh` handling. Old `/admin/settings/payments/payouts` 308s here (`next.config.mjs`) |
| `frontend/src/app/admin/finance/page.tsx` | Finance landing: links to Payouts, Taxes (Settings › Tax) and Payment settings (Settings › Payments) |
| `frontend/src/app/admin/finance/payouts/page.tsx` | Finance › Payouts: available / pending balance, schedule + bank card, recent payout history table; empty state links to the bank account page, never onboards itself |
| `frontend/src/components/AdminSidebar.tsx` | `Finance` main entry with nested `Payouts` |
| `frontend/src/app/admin/settings/payments/PayoutScheduleDialog.tsx` | Payout every business day / week / month + payout name |
| `frontend/src/app/admin/settings/payments/useConnectActions.ts` | onboard (full-page redirect), openDashboard (new tab), sync |
| `frontend/src/app/admin/dashboard/PayoutsBanner.tsx` | "Set up payouts" nudge while not active (session-dismissable) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_CONNECT_ENABLED` | No (default `false`) | Master gate. Off: Connect routes 404, checkout never routes, the page hides every payouts element, `GET /admin/settings/payments` returns `connect: { enabled: false }` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | With Connect | Signing secret of the Stripe **Connect** webhook endpoint (listen on connected accounts). Separate from `STRIPE_WEBHOOK_SECRET`. Unset = unverified (dev/test only) |
| `FRONTEND_URL` | Yes | First entry is the base for Account Link `return_url` / `refresh_url`. Live mode refuses to onboard unless it is `https://` |

Stripe dashboard prerequisites (human steps) are in the [Production Launch Checklist](../config/production-launch-checklist.md#stripe-connect-spec-010-phase-2). Local webhook forwarding: `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe/connect` ([Stripe Setup](../config/stripe-setup.md)).

## How It Works

### Money flow

```
Buyer pays T on the PLATFORM account (Checkout Session, destination charge)
  T = subtotal + platformFee + processingFee + tax          FeeService invariant
  payment_intent_data.transfer_data.destination = acct_org
  payment_intent_data.application_fee_amount    = T_cents − subtotal_cents
→ Stripe transfers subtotal to acct_org; Stripe's 2.9% + 30¢ is debited from the platform balance
→ Organization is paid out on its schedule; platform remits sales tax (spec 009 unchanged)
```

`application_fee_amount` is computed **by subtraction from the exact Checkout line-item cents**, not by summing fees in dollars, so per-unit rounding of the all-in price never moves a cent between the parties. `applicationFeeCents({ fees, lineItems })` returns `null` for anything inconsistent (non-integer cents, subtotal above the charge), in which case the charge stays on the platform account and `connect_routing_skipped` is logged. The statement descriptor suffix, Stripe Tax, Radar and payment-method capabilities are all platform-level and unchanged (no `on_behalf_of`).

### Routing rule (`ConnectService.destinationFor`)

A new charge goes to the connected account only when all of:

1. `STRIPE_CONNECT_ENABLED=true`
2. the organization has an `OrganizationStripeAccount` row whose `mode` equals the current key's mode (`stripeMode()` — `sk_test_` vs live)
3. `transfersEnabled` (Stripe `capabilities.transfers === 'active'`)
4. not `disconnectedAt`

`payoutsEnabled` is **not** a condition: transfers accumulate in the connected balance and pay out once Stripe clears the bank account; blocking sales on a bank detail would cost the organization revenue (the page shows *Payouts on hold*). Orders never move between accounts after creation; `PaymentTransaction.stripeAccountId` records which account took the charge (null = platform).

### Account lifecycle

| Status | Condition (`connectStatus(row)`) | UI |
|---|---|---|
| `not_started` | no row for this mode | `Set up payouts` |
| `onboarding` | row, `detailsSubmitted` false | `Finish setup` / `Continue setup` |
| `restricted` | details submitted but transfers inactive, `disabledReason`, or `currentlyDue` non-empty | `Action required` / `Update details`, outstanding items listed |
| `active` | details submitted, transfers active, nothing disabled | `Receiving payouts`, `Manage` → Express dashboard |
| `disconnected` | `disconnectedAt` set (organization revoked the platform) | `Disconnected` / `Reconnect` (creates a fresh account) |

Row state is written only from Stripe Account objects — `syncAccount` (`accounts.retrieve` with `external_accounts` expanded) and the Connect webhook both go through `applyAccount`. Unknown accounts are ignored, never created.

### Onboarding

`startOnboarding` creates the account once (`accounts.create` with the `controller` spelling of Express: `fees.payer` and `losses.payments` = `application`, `stripe_dashboard.type = 'express'`, `requirement_collection = 'stripe'`, `card_payments` + `transfers` requested, `metadata.organizationId`/`mode`), stores the row, then mints a single-use Account Link (`type: 'account_onboarding'`) every time it is called. Stripe returns to `/admin/settings/payments/payout-bank-account?onboarding=complete` (page syncs and reports *setup complete* or *Stripe still needs: …*) or `?onboarding=refresh` (link expired; page mints a new one and redirects). A `disconnected` row is deleted and replaced on the next onboard.

### Refunds

When the order's transaction has `stripeAccountId`, `refunds.create` gets `reverse_transfer: true` and `refund_application_fee: true`. With an `amount` Stripe reverses the transfer and refunds the application fee **proportionally** — the per-ticket refund case; a full refund is the 100% case. Buyer is made whole, the organization's share is pulled back, the platform eats Stripe's non-refundable processing cost. `handleExternalRefund` is unchanged (`charge.refunded` for destination charges fires on the platform endpoint).

### Connect webhook (`POST /webhooks/stripe/connect`)

| Event | Action |
|---|---|
| `account.updated` | `applyAccount(event.account, event.data.object)` |
| `capability.updated`, `account.external_account.*` | re-retrieve the account, `applyAccount` |
| `account.application.deauthorized` | `markDisconnected` — routing off immediately |
| `payout.paid` / `payout.failed` | `lastPayoutAt` / `lastPayoutFailure` |

Same raw-body, skip-verification-when-unset, return-200-after-logging policy as the platform endpoint. Every event carries `event.account`; events without it are acknowledged and ignored. Recovery path for lost events: **Refresh** on the payouts page (`POST …/connect/sync`).

### Payout settings

`PATCH …/connect/payouts { interval, anchor?, statementDescriptor? }` → `accounts.update(acct, { settings: { payouts: { schedule, statement_descriptor } } })`, then the response is re-applied to the row so the page shows what Stripe stored. Rules: `interval ∈ daily|weekly|monthly`; weekly needs a weekday `anchor`, monthly a day `1–31`, daily forbids one; payout name ≤ 22 chars, `[A-Z0-9 ]`, at least one letter (same normaliser as the card descriptor). Refused (409) before `detailsSubmitted`.

### Finance › Payouts

`GET /admin/finance/payouts` returns `{ connect, activity, canEdit }`. `activity` is read live from Stripe **on the connected account** (`stripe.balance.retrieve` + `stripe.payouts.list({ limit: 25, expand: ['data.destination'] })`, both with `{ stripeAccount }`) and mapped to dollars; it is `null` while the flag is off, without a row, before `detailsSubmitted` or after deauthorization, so the page renders its empty state instead of an error. A Stripe outage degrades to `{ balance: null, payouts: [], error }` — the page keeps the schedule/bank card from the row and shows the message. Nothing is cached or stored: payout history is Stripe's record, Jump's ledger stays `PaymentTransaction` (spec 024). This is a **payouts** list (money leaving Stripe to the organization), not an org-wide transactions list — see AGENTS.md gotcha 17.

### Connecting the bank account — how and why

The bank account is never typed into Jump. The organization's Express account is created by the platform, then Stripe collects identity, business and bank details on its own hosted onboarding page (Account Link) and, for changes, in the Express dashboard (login link, Stripe-authenticated). Jump only reads back `external_accounts[].bank_name` / `last4` / `currency` into `OrganizationStripeAccount`. Consequences:

- **No PCI/NACHA scope for Jump** — routing/account numbers, SSNs and documents never touch Jump's servers, logs or database. The `last4` snapshot is the only bank data stored.
- **Stripe owns KYC and bank verification** (`requirement_collection: 'stripe'`): US banks are verified instantly through Stripe Financial Connections (bank login) when the user chooses it, otherwise by micro-deposits; failed verifications and requirement changes come back through `account.updated` / `account.external_account.*` webhooks.
- **Stripe owns account takeover risk** on bank changes: the Express dashboard requires the account holder's Stripe login (with Stripe's own 2FA), so a compromised Jump admin session cannot redirect payouts by itself. Stripe also pauses payouts after a bank change; the page copy says so.
- **Liability stays with Stripe/Express** for negative balances of the connected account (`losses.payments = application` only makes the platform cover chargebacks — see Gotchas).

Alternatives considered (2026-09-19, research note in the vault: `jump--research--payout-bank-connection.md`):

| Option | Verdict |
|---|---|
| **Stripe Connect Express, hosted onboarding + Express dashboard** (current) | Ship. Zero bank data in Jump, Stripe authentication on changes, already built and tested |
| **Stripe Connect embedded components** (`@stripe/connect-js` + `@stripe/react-connect-js`; `account_onboarding`, `account_management` with `external_account_collection`, `payouts`, `balances`, `payouts_list`) | Recommended follow-up. Same security model (Stripe iframe + Stripe login popup for Express accounts, `disable_stripe_user_authentication` is not allowed for `requirement_collection: stripe`), but the bank form and payout list render *inside* Jump's pages instead of a new tab. Needs `POST …/connect/account-session` (returns `client_secret` for the components the user's role may see), the **platform** publishable key on the frontend, CSP `frame-src`/`script-src` for `connect-js.stripe.com` + `js.stripe.com`, and `Cross-Origin-Opener-Policy` left at `unsafe-none` |
| **Stripe Financial Connections directly** (`financial_connections.sessions` → bank account token → `external_account`) | Only worth it with Custom accounts; Express onboarding already offers the same bank-login flow |
| **Plaid Auth → Stripe processor token** | Second vendor, second contract and privacy policy, only adds value for non-Stripe rails. No |
| **Own bank form (`external_account` with raw routing/account numbers)** | Never: puts bank numbers through Jump, moves verification, fraud and liability onto Jump, and needs Custom accounts (Jump becomes responsible for all KYC updates) |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/settings/payments` | organizer+ | adds `connect: { enabled, status, account }` |
| POST | `/admin/settings/payments/connect/onboard` | admin | `{ url }` Account Link; 404 flag off; 400 live mode without https base URL |
| POST | `/admin/settings/payments/connect/login-link` | admin | `{ url }` Express dashboard; 409 before onboarding completes |
| POST | `/admin/settings/payments/connect/sync` | admin | `{ connect }` after `accounts.retrieve` |
| PATCH | `/admin/settings/payments/connect/payouts` | admin | `{ connect }`; 400 on bad values, 409 before onboarding completes |
| GET | `/admin/finance/payouts` | organizer+ | `{ connect, activity, canEdit }` — `activity` live from Stripe (`balance`, `payouts[]`, `error`) or `null` until onboarding completes |
| POST | `/webhooks/stripe/connect` | Stripe signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) | Connected-account events |

## Testing

- `backend/tests/unit/connectService.test.js` — `accountToRow` mapping, status table, routing matrix (flag off, wrong mode, transfers inactive, disconnected, payouts paused), onboarding create/reuse/replace, live-mode https guard, login link, sync, payout-settings validation, `payoutActivity` (null cases, cents → dollars, expanded destination, outage degrade).
- `backend/tests/unit/paymentSettingsService.test.js` — `applicationFeeCents` identity (`total − fee === round(subtotal × 100)`) across tax-on-top, tax-inclusive, multi-tier drift, 1¢ and free tickets; routing added to checkout options; failures keep phase 1 options.
- `backend/tests/unit/refundService.test.js` — Connect flags iff connected.
- `backend/tests/contract/connect.test.js` — real Postgres: order on the platform account until `account.updated` activates transfers, then `sessions.create` receives `transfer_data` + the exact fee and the ledger records it; `capability.updated`, `payout.failed`, `deauthorized`; bad Connect signature → 400; admin routes (flag gate, ORGANIZER 403, onboard reuse, sync → login link → payouts, validation, tenant scoping, `GET /admin/finance/payouts` for ADMIN / ORGANIZER / no account / flag off).
- `frontend/e2e/admin-payments-connect.spec.ts` — provider card states, onboard redirect, Express `Manage` in a new tab, ORGANIZER read-only, bank account page (empty state → onboarding, last four + `Change bank`, on-hold / failure), schedule dialog save/rejection, `?onboarding=complete|refresh`, Finance landing + sidebar, Finance › Payouts (empty, balance/history, outage), dashboard banner; axe clean.

## Gotchas

- **Connected accounts are per Stripe mode.** Anything onboarded under a test key is void once the live key lands; the `mode` column keeps those rows invisible instead of breaking live routing. Re-onboard every organization after go-live.
- **Two webhook secrets.** `STRIPE_WEBHOOK_SECRET` (platform endpoint) and `STRIPE_CONNECT_WEBHOOK_SECRET` (Connect endpoint) are different endpoints in the Stripe dashboard. Swapping them means signatures fail on both; the startup log line `Stripe webhook configuration` shows which are set.
- **Do not add `checkout.session.*` / `charge.refunded` to the Connect endpoint** — destination-charge events fire on the platform account.
- **Reversal can exceed the connected balance.** `losses.payments = application` lets the account go negative and Stripe recovers from later transfers; the platform is exposed in between. `payout.failed` and negative balances surface on the payouts page after a sync.
- **Deauthorized mid-sale.** Routing flips to the platform account on the webhook; an in-flight session keeps its `transfer_data` — Stripe fails the transfer, the charge still succeeds on the platform, settle manually (logged at error).
- **Account Link URLs are single-use and expire in minutes**; never store one. `?onboarding=refresh` exists for the expired case.
- **`return_url` must be https in live mode.** `startOnboarding` refuses with a 400 when `FRONTEND_URL` is not https.
- **Reconciliation**: `SELECT "stripeAccountId", "applicationFee", amount FROM "PaymentTransaction" WHERE "stripeAccountId" IS NOT NULL` against the Stripe dashboard's application fees; `connect_charge_routed` log lines carry the same numbers.
- Future per-product fee modes (absorb / pass / split) and application charges (spec 011) change the formula in `checkoutOptionsFor` / `applicationFeeCents` only — callers read the outcome back, they never compute it.

## Related Features

- [Payments Settings](payments-settings.md) — the page this extends (phase 1)
- [Stripe Integration](stripe-integration.md) — Checkout Sessions and the platform webhook
- [Fee Calculation](fee-calculation.md) — the invariant the application fee is derived from
- [Tax Settings](tax-settings.md) — tax stays on the platform account (merchant of record)
