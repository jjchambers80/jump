# Connect Payouts

**Status**: Implemented (spec 010 phase 2, 2026-09-16; Finance section + Payout bank account page 2026-09-19; **direct charges on the organization's own account, spec 047 D0-S, 2026-10-09**) — deploys dark behind `STRIPE_CONNECT_ENABLED`; not yet enabled in production. Plans: `specs/047-donations/plan-d0.md` §3 (current model), `specs/010-payments-settings/plan-phase-2.md` (history).
**Last Updated**: 2026-10-09

## Overview

Each organization takes payments on **its own Stripe account** (spec 047 option C). It either connects an existing Stripe account ("Connect existing Stripe account", Connect OAuth) or creates a new one it owns with the full Stripe dashboard ("Create a Stripe account", Stripe-hosted onboarding). From then on every charge for that organization — ticket checkout, application card setup and charges — is a **direct charge** created on the organization's account with the request option `{ stripeAccount }`; Jump takes its platform fee as `application_fee_amount`. Money never passes through Jump's balance. The organization is the merchant on the buyer's card statement, owns refunds and disputes in its own Stripe dashboard, pays Stripe's processing fees, is the seller of record for sales tax, and is paid out on its own schedule.

Organizations connect from **Settings › Payments › Payout bank account**, and watch balance and payout history under **Finance › Payouts** (`/admin/finance/payouts`, live from Stripe). Bank changes happen in the organization's Stripe dashboard (`account.dashboardUrl`); Jump stores no bank numbers beyond a `last4` snapshot.

Until an organization has a connected account that can take charges (or while the flag is off) nothing changes: charges land on the platform account exactly as before (`PaymentTransaction.stripeAccountId = null`).

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/ConnectService.js` | Account lifecycle: `startOnboarding` (create a full-dashboard account + Account Link), `oauthUrl` / `completeOAuth` (Connect OAuth, signed `state`), `syncAccount` / `applyAccount` (Stripe Account object → row, incl. `activeCapabilities`), `updatePayoutSettings`, `markDisconnected`, `recordPayout`, `chargeAccountFor` (the routing rule), `payoutActivity`; `dashboardUrl`, `signOAuthState` / `readOAuthState` exported |
| `backend/src/services/stripeAccount.js` | `onAccount(acct)` → trailing `{ stripeAccount }` request option (empty for the platform); `sameAccount(paymentAccount, eventAccount)` for webhook checks |
| `backend/src/services/PaymentSettingsService.js` | `checkoutOptionsFor(organization, { fees, lineItems })` returns `stripeAccount` + `payment_intent_data.application_fee_amount`; `applicationFeeCents` (exported, pure: the platform fee in cents) |
| `backend/src/services/OrderService.js` | Creates the Checkout Session on the account, records `stripeAccountId` / `applicationFee` on `PaymentTransaction`; session reads (verify, sweep) use the order's account |
| `backend/src/services/ApplicationPaymentService.js` | Customers, setup / payment Checkout, off-session PaymentIntents, session expiry and receipts on the account (`_chargeAccount`, `_sessionAccount`, `ensureCustomer(contact, account)`) |
| `backend/src/services/stripeRefund.js` | `createStripeRefund({ stripeAccountId })` → refund on the account with `refund_application_fee: true` |
| `backend/src/services/DisputeService.js`, `ContactErasureService.js`, `TaxService.js` | `charges.retrieve`, `customers.del`, Stripe Tax on the account |
| `backend/src/api/routes/webhooks.js` | `dispatchMoneyEvent` (shared by the platform and Connect endpoints); `POST /webhooks/stripe/connect` |
| `backend/src/api/routes/admin.js` | `connect/onboard`, `connect/oauth`, `connect/oauth/complete`, `connect/sync`, `connect/payouts`; `GET /admin/settings/payments` carries `connect`; `GET /admin/finance/payouts` |
| `packages/db/prisma/schema.prisma` | `OrganizationStripeAccount` (+ `activeCapabilities`, migration `20261030100000_connect_active_capabilities`); `PaymentTransaction.stripeAccountId`, `applicationFee`; `Contact.stripeCustomerAccountId` (`20261030110000_contact_stripe_customer_account`) |
| `frontend/src/app/admin/settings/payments/page.tsx` | Provider card payouts half (status pill, *Connect Stripe* → bank account page, *Continue setup*, *Stripe dashboard* link) |
| `frontend/src/app/admin/settings/payments/payout-bank-account/page.tsx` | Empty state with *Connect existing Stripe account* (OAuth, only when `connect.oauthAvailable`) and *Create a Stripe account*; bank on file (`•••• last4`, *Change bank* → Stripe dashboard, *Refresh*); payout schedule; handles `?onboarding=complete|refresh` and the OAuth return `?code=&state=` / `?error=` |
| `frontend/src/app/admin/finance/payouts/page.tsx` | Finance › Payouts; *View in Stripe* links the organization's dashboard |
| `frontend/src/app/admin/settings/payments/useConnectActions.ts` | `onboard`, `connectExisting` (OAuth redirect), `completeOAuth`, `sync` |
| `frontend/src/app/admin/dashboard/PayoutsBanner.tsx` | "Set up payouts" nudge while not active (session-dismissable) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_CONNECT_ENABLED` | No (default `false`) | Master gate. Off: Connect routes 404, checkout never routes, the page hides every payouts element, `GET /admin/settings/payments` returns `connect: { enabled: false }` |
| `STRIPE_CONNECT_CLIENT_ID` | No | Platform Connect client id (`ca_…`) for OAuth. Unset: only *Create a Stripe account* is offered (`connect.oauthAvailable: false`) and `POST …/connect/oauth` is 404. Register `<first FRONTEND_URL>/admin/settings/payments/payout-bank-account` as an OAuth redirect URI (Connect › Settings › Onboarding options › OAuth) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | With Connect | Signing secret of the Stripe **Connect** webhook endpoint (listen on connected accounts). Separate from `STRIPE_WEBHOOK_SECRET`. Unset = unverified (dev/test only) |
| `FRONTEND_URL` | Yes | First entry is the base for Account Link URLs and the OAuth redirect URI. Live mode refuses to onboard unless it is `https://` |
| `AUTH_SECRET` | Yes | Signs the OAuth `state` (organization + user + 30-minute expiry) |

Stripe dashboard prerequisites (human steps) are in the [Production Launch Checklist](../config/production-launch-checklist.md#stripe-connect-spec-047-d0-s-direct-charges). Local webhook forwarding: `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe/connect` ([Stripe Setup](../config/stripe-setup.md)). Manual check against Stripe test mode: `npm run verify:stripe -- --direct acct_…`.

## How It Works

### Money flow

```
Buyer pays T on the ORGANIZATION's account (Checkout Session, Stripe-Account: acct_org)
  T = subtotal + platformFee + processingFee + tax − absorbedFees     FeeService (spec 047 D0-B)
  payment_intent_data.application_fee_amount = platformFee cents       (omitted when 0: Stripe requires > 0)
  no transfer_data, no on_behalf_of
→ Stripe sends platformFee to Jump; Stripe's actual processing fee is debited from the organization
→ The organization keeps the rest, including the tax it collected and must remit
```

`processingFee` in the fee libraries is an **estimate** (2.9% + 30¢) of what a PASS buyer covers; Stripe's actual fee on the organization's account can differ (nonprofit rate, international cards) and the organization keeps or bears the difference.

### Who holds what, who owes what, who is liable

| | Organization (its own Stripe account) | Platform (Jump) |
|---|---|---|
| **Merchant of record / card statement** | Yes — the charge is created on its account with its descriptor | No |
| **Who holds the funds** | Yes, from the start | Only the application fee |
| **Platform fee** | Pays it | `application_fee_amount` = platform fee |
| **Stripe processing fees** | Pays them (`controller.fees.payer = account` on accounts Jump creates; its own pricing on OAuth accounts) | No |
| **Sales tax** | Seller of record: collects it in the charge and remits it; Stripe Tax uses its registrations | No |
| **Refunds** | The refund is created on its account; Jump returns its fee pro rata (`refund_application_fee: true`) | Loses the refunded share of its fee |
| **Chargebacks** | Its dispute, its loss; Jump mirrors it into `Dispute` rows and alerts the organizer | No (`losses.payments = stripe` on accounts Jump creates) |
| **KYC, bank, 1099-K** | Stripe collects and files (`requirement_collection: stripe`) | No |

### Routing rule (`ConnectService.chargeAccountFor`)

A new charge is created on the organization's account only when all of:

1. `STRIPE_CONNECT_ENABLED=true`
2. the organization has an `OrganizationStripeAccount` row whose `mode` equals the current key's mode
3. `chargesEnabled` (Stripe `charges_enabled`)
4. not `disconnectedAt`

`payoutsEnabled` and the `transfers` capability are **not** conditions. Optional payment methods are filtered by the connected account's own `activeCapabilities` (and Jump's allowlist), not the platform's; no statement descriptor suffix is sent (the account's own descriptor applies). Orders never move between accounts after creation: `PaymentTransaction.stripeAccountId` records the account (null = platform) and every later call for that payment — session reads, refunds, dispute lookups, receipts — uses it.

### Account lifecycle

| Status | Condition (`connectStatus(row)`) | UI |
|---|---|---|
| `not_started` | no row for this mode | `Not connected` / *Connect Stripe* |
| `onboarding` | row, `detailsSubmitted` false | `Finish setup` / `Continue setup` |
| `restricted` | details submitted but charges disabled, `disabledReason`, or `currentlyDue` non-empty | `Action required` / `Update details`, outstanding items listed |
| `active` | details submitted, charges enabled, nothing disabled | `Connected`, *Stripe dashboard* |
| `disconnected` | `disconnectedAt` set (the organization removed Jump in its dashboard) | `Disconnected`, connect again |

Row state is written only from Stripe Account objects — `syncAccount` and the Connect webhook both go through `applyAccount`. Unknown accounts are ignored, never created.

### Onboarding

- **Create a Stripe account** — `startOnboarding` creates the account once with `controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' }` (no capabilities requested: Stripe requests the defaults for a full-dashboard account), stores the row, then mints a single-use Account Link (`account_onboarding`) every time. Stripe returns to `…/payout-bank-account?onboarding=complete` (page syncs and reports) or `?onboarding=refresh`. Stripe refuses Account Links for an account the organization connected with OAuth; that is a 409 telling the organizer to finish in its own dashboard.
- **Connect existing Stripe account** — `oauthUrl` returns `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=…&scope=read_write&redirect_uri=…&state=…` (prefilled business name / email). Stripe redirects back with `code` + `state`; the page posts them to `connect/oauth/complete`, which verifies the `state` names this organization and user, calls `stripe.oauth.token({ grant_type: 'authorization_code', code })`, refuses a test/live mismatch and an account already connected to another organization (409), retrieves the account and stores it (replacing the organization's previous row for this mode).
- Express accounts (the spec 010 phase 2 model) are no longer created; test-mode ones are dropped, production never had any.

### Refunds, disputes, erasure

- `createStripeRefund({ stripeAccountId })`: on a direct charge `refunds.create({ payment_intent, amount, refund_application_fee: true }, { idempotencyKey, stripeAccount })` — no `reverse_transfer` (there is no transfer). A null account keeps today's platform call. Spec 031 retained fees are unchanged.
- Disputes are the organization's in Stripe. Jump still mirrors them (`DisputeService`), resolving a charge-only payload with `charges.retrieve` on the event's account.
- `ContactErasureService` deletes the applicant's Customer on `Contact.stripeCustomerAccountId`.
- The refund audit (`npm run report:refunds -- --stripe`) lists refunds on the platform and on every connected account.

### Webhooks (`POST /webhooks/stripe/connect`)

Account events:

| Event | Action |
|---|---|
| `account.updated` | `applyAccount(event.account, event.data.object)` |
| `capability.updated`, `account.external_account.*` | re-retrieve the account, `applyAccount` |
| `account.application.deauthorized` | `markDisconnected` — routing off immediately |
| `payout.paid` / `payout.failed` | `lastPayoutAt` / `lastPayoutFailure` |

Money events of direct charges arrive **here**, with `event.account`, and go through `dispatchMoneyEvent` — the same switch the platform endpoint uses: `checkout.session.completed|async_payment_succeeded|async_payment_failed|expired`, `payment_intent.succeeded|payment_failed|canceled|processing` (applications), `charge.refunded`, `charge.dispute.created|updated|funds_withdrawn|funds_reinstated|closed`. Every handler refuses an event whose account is not the one the order's payment was created on (`sameAccount`; `stripe_webhook_account_mismatch` logged at error), so one organization's account can never complete, refund or dispute another's order and a platform event never touches a direct charge. Application events additionally require the account to belong to the application's organization (card setup has no payment row yet). The platform endpoint keeps settling legacy orders (`stripeAccountId = null`). Dedup and fail-closed rules are the same on both endpoints ([Webhook Reliability](webhook-reliability.md)).

### Payout settings

`PATCH …/connect/payouts { interval, anchor?, statementDescriptor? }` → `accounts.update(acct, { settings: { payouts: { schedule, statement_descriptor } } })`, then the response is re-applied to the row so the page shows what Stripe stored. Rules: `interval ∈ daily|weekly|monthly`; weekly needs a weekday `anchor`, monthly a day `1–31`, daily forbids one; payout name ≤ 22 chars, `[A-Z0-9 ]`, at least one letter (same normaliser as the card descriptor). Refused (409) before `detailsSubmitted`.

### Finance › Payouts

`GET /admin/finance/payouts` returns `{ connect, activity, canEdit }`. `activity` is read live from Stripe **on the connected account** (`stripe.balance.retrieve` + `stripe.payouts.list({ limit: 25, expand: ['data.destination'] })`, both with `{ stripeAccount }`) and mapped to dollars; it is `null` while the flag is off, without a row, before `detailsSubmitted` or after deauthorization, so the page renders its empty state instead of an error. A Stripe outage degrades to `{ balance: null, payouts: [], error }` — the page keeps the schedule/bank card from the row and shows the message. Nothing is cached or stored: payout history is Stripe's record, Jump's ledger stays `PaymentTransaction` (spec 024). This is a **payouts** list (money leaving Stripe to the organization), not an org-wide transactions list — see AGENTS.md gotcha 17.

### Connecting the bank account — how and why

The bank account is never typed into Jump. Stripe collects identity, business and bank details on its own hosted onboarding page, and changes happen in the organization's own Stripe dashboard (its own Stripe login and 2FA). Jump only reads back `external_accounts[].bank_name` / `last4` / `currency`. Consequences:

- **No PCI/NACHA scope for Jump** — routing/account numbers, SSNs and documents never touch Jump's servers, logs or database.
- **Stripe owns KYC and bank verification** (`requirement_collection: 'stripe'`).
- **Stripe owns account takeover risk** on bank changes: a compromised Jump admin session cannot redirect payouts.
- **Stripe, not Jump, carries negative balances** (`losses.payments = stripe`) on accounts Jump creates; OAuth-connected accounts were never Jump's to begin with.

Alternatives considered (2026-09-19, research note in the vault: `jump--research--payout-bank-connection.md`):

| Option | Verdict |
|---|---|
| **Stripe Connect Express, hosted onboarding + Express dashboard** (spec 010 phase 2) | Replaced 2026-10-09 by the organization's own full-dashboard account (OAuth or created), spec 047 option C |
| **Stripe Connect embedded components** (`@stripe/connect-js` + `@stripe/react-connect-js`; `account_onboarding`, `account_management` with `external_account_collection`, `payouts`, `balances`, `payouts_list`) | Recommended follow-up. Same security model (Stripe iframe + Stripe login popup for Express accounts, `disable_stripe_user_authentication` is not allowed for `requirement_collection: stripe`), but the bank form and payout list render *inside* Jump's pages instead of a new tab. Needs `POST …/connect/account-session` (returns `client_secret` for the components the user's role may see), the **platform** publishable key on the frontend, CSP `frame-src`/`script-src` for `connect-js.stripe.com` + `js.stripe.com`, and `Cross-Origin-Opener-Policy` left at `unsafe-none` |
| **Stripe Financial Connections directly** (`financial_connections.sessions` → bank account token → `external_account`) | Only worth it with Custom accounts; Express onboarding already offers the same bank-login flow |
| **Plaid Auth → Stripe processor token** | Second vendor, second contract and privacy policy, only adds value for non-Stripe rails. No |
| **Own bank form (`external_account` with raw routing/account numbers)** | Never: puts bank numbers through Jump, moves verification, fraud and liability onto Jump, and needs Custom accounts (Jump becomes responsible for all KYC updates) |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/settings/payments` | organizer+ | adds `connect: { enabled, status, account, oauthAvailable }`; `account.dashboardUrl` |
| POST | `/admin/settings/payments/connect/onboard` | admin | `{ url }` Account Link (creates the organization's account on first call); 404 flag off; 400 live mode without https base URL; 409 when Stripe refuses a link (OAuth account) |
| POST | `/admin/settings/payments/connect/oauth` | admin | `{ url }` Connect OAuth authorize URL; 404 without `STRIPE_CONNECT_CLIENT_ID` |
| POST | `/admin/settings/payments/connect/oauth/complete` | admin | `{ code, state }` → `{ connect }`; 400 bad / foreign / expired state or mode mismatch; 409 account already used by another organization |
| POST | `/admin/settings/payments/connect/sync` | admin | `{ connect }` after `accounts.retrieve` |
| PATCH | `/admin/settings/payments/connect/payouts` | admin | `{ connect }`; 400 on bad values, 409 before onboarding completes |
| GET | `/admin/finance/payouts` | organizer+ | `{ connect, activity, canEdit }` |
| POST | `/webhooks/stripe/connect` | Stripe signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) | Account and money events of connected accounts |

`connect/login-link` (Express dashboard) was removed: full-dashboard accounts sign in to `dashboard.stripe.com` themselves.

## Testing

- `backend/tests/unit/connectService.test.js` — `accountToRow` (incl. `activeCapabilities`), status table (charges gate), routing matrix, full-dashboard `accounts.create` params, Account Link refusal → 409, OAuth state sign/verify/expiry/tamper, `oauthUrl`, `completeOAuth` (store, foreign state, other user, mode mismatch, account in use), sync, payout settings, `payoutActivity`.
- `backend/tests/unit/paymentSettingsService.test.js` — `applicationFeeCents` = `platformFee` cents for the all-PASS ticket case and the D0-B fixture cases 1–6 (`backend/tests/fixtures/fees.fixtures.json`); direct-charge options (`stripeAccount`, fee, no `transfer_data`, no suffix, methods by the account's capabilities); fallbacks.
- `backend/tests/unit/refundService.test.js` — direct-charge refund (`stripeAccount`, `refund_application_fee`, no `reverse_transfer`) vs platform.
- `backend/tests/contract/connect.test.js` — routing on `account.updated`, the session request option and fee, ledger; OAuth routes end to end; admin routes and scoping.
- `backend/tests/contract/directCharges.test.js` — Connect-endpoint completion; a different account refused; platform endpoint refuses a direct charge but completes a legacy order; expiry; verify reads the session on the account; `charge.refunded` / `charge.dispute.*` only from the order's account; charge-only dispute lookup on the account; staff refund on the account vs legacy.
- `backend/tests/contract/applicationPayments.test.js` — saved-card charge on the account with the platform fee, Customer re-created on the account, refund there, Connect refund webhook only from the account; foreign-account application event refused.
- `frontend/e2e/admin-payments-connect.spec.ts` — states, connect choice, OAuth start + return + cancel, *Stripe dashboard* / *Change bank* links, onboarding returns, schedule dialog, Finance › Payouts, banner; axe clean.

## Gotchas

- **`stripeAccount` is a request option, never a param.** `checkoutOptionsFor` returns it beside the params: destructure it out (`const { stripeAccount, ...params } = …`) and pass `...onAccount(stripeAccount)` as the last argument. Spreading it into the params sends it to Stripe as an unknown parameter.
- **Never `transfer_data` again.** Every money call for an organization with an account carries `{ stripeAccount }` and `application_fee_amount`; a call without the option looks for the object on the platform and fails with "No such …".
- **Stripe objects do not cross accounts.** A Customer, PaymentMethod or session created on the platform cannot be used on the organization's account and vice versa; `ensureCustomer` re-creates the Customer on the current account and a card saved before the switch must be collected again.
- **Connected accounts are per Stripe mode.** Rows for the other mode are invisible; re-connect every organization after go-live.
- **Two webhook endpoints, two secrets**, and since spec 047 the Connect endpoint needs the money events too (launch checklist).
- **A connected account whose charges are disabled falls back to the platform account** for new charges (the current fallback rule; Jump becomes the merchant for those orders). Revisit before gifts (D1) rely on the organization always being the merchant.
- **Account Link URLs are single-use and expire in minutes**; `?onboarding=refresh` exists for the expired case. **OAuth codes are single use and expire in 5 minutes**; redeeming one twice revokes the connection.
- **Reconciliation**: `SELECT "stripeAccountId", "applicationFee", amount FROM "PaymentTransaction" WHERE "stripeAccountId" IS NOT NULL` against Connect › Collected fees in the Stripe dashboard.

## Related Features

- [Payments Settings](payments-settings.md) — the page this extends (phase 1)
- [Stripe Integration](stripe-integration.md) — Checkout Sessions and the platform webhook
- [Fee Calculation](fee-calculation.md) — the platform fee that becomes the application fee
- [Tax Settings](tax-settings.md) — the organization is the seller of record once connected
- [Webhook Reliability](webhook-reliability.md), [Disputes](disputes-chargebacks.md)
