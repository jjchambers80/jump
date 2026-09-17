# Implementation Plan: Spec 010 Phase 2 — Stripe Connect payouts

**Status**: Planned 2026-09-16. Not started.
**Parent**: [plan.md](./plan.md) (§2.1, §3.4, §4 phase 2, §5, §6.3–6.5, §8 phase 2) and [spec.md](./spec.md). This document turns the phase 2 outline into a buildable plan; where it refines the parent (gate on the `transfers` capability, cents math by subtraction, `mode` column) this document wins.
**Decisions taken 2026-09-16** (parent §5): 5.1 **Express** accounts; 5.2 **destination charges without `on_behalf_of`** (platform stays merchant of record, spec 009 tax model unchanged); 5.3 platform keeps **platform fee + processing fee + tax**, organization receives exactly the ticket subtotal; 5.4 refunds `reverse_transfer: true`, `refund_application_fee: true`; 5.7 no cutover deadline, persistent "Set up payouts" banner.
**Why now**: every roadmap candidate after this (011 applications, 012 add-ons, fee modes) moves money for an organization. Without Connect the platform collects it and settles by hand — see [docs/research/2026-09-15-eventeny-organizer-interview.md](../../docs/research/2026-09-15-eventeny-organizer-interview.md) §7.

---

## 1. What exists (phase 1, on `main`)

| Piece | Location | Phase 2 touch |
|---|---|---|
| `PaymentSettingsService` — provider status (5-min cache), org settings, `checkoutOptionsFor(organization)` | `backend/src/services/PaymentSettingsService.js` | `checkoutOptionsFor` gains `transfer_data` + `application_fee_amount`; `getSettings` payload gains `connect` |
| `OrderService.createOrder` — spreads `checkoutOptions` into `stripe.checkout.sessions.create`, writes `PaymentTransaction` after the session | `backend/src/services/OrderService.js:231-301` | Pass `fees` + line-item cents into the options call; persist `stripeAccountId` / `applicationFee` on the ledger row |
| `RefundService._createStripeRefund(paymentIntentId, amount, reason)` | `backend/src/services/RefundService.js:424` | Add `reverse_transfer` / `refund_application_fee` when the order's transaction has `stripeAccountId` |
| Platform webhook `POST /webhooks/stripe` (`STRIPE_WEBHOOK_SECRET`) | `backend/src/api/routes/webhooks.js` | Unchanged. Destination-charge events still arrive here |
| Admin routes `GET/PATCH /admin/settings/payments` under `requireOrganizer`, writes `requireAdmin`, org via `activeOrgFor(req)` | `backend/src/api/routes/admin.js:290-316` | Add four Connect routes |
| Frontend page, dialog, methods sub-page, `usePaymentsApi`, `types.ts` | `frontend/src/app/admin/settings/payments/` | Provider card right half, `payouts/` sub-page, schedule dialog |
| Tests: `tests/unit/paymentSettingsService.test.js`, `tests/contract/payments.test.js` (pins `_statusCache`), `frontend/tests/e2e/admin-payments-settings.spec.ts` | | Extend, same mocking pattern |
| `PaymentTransaction` — append-only (no `updatedAt`), 1:1 with `Order` | `packages/db/prisma/schema.prisma:479` | Two nullable columns, set at creation only |
| `stripe@^17.3.1`, API `2024-11-20.acacia` | `backend/src/config/stripe.js` | Has `accounts.create` with `controller`, `accountLinks.create`, `accounts.createLoginLink`, `refunds.create({ reverse_transfer, refund_application_fee })` |
| `platformBaseUrl()` | `backend/src/utils/storefrontUrl.js` | Absolute return/refresh URLs for Account Links |

Production facts that shape rollout: prod still runs a **test** `STRIPE_SECRET_KEY`, no `STRIPE_WEBHOOK_SECRET`, no descriptor prefix ([launch checklist](../../docs/wiki/config/production-launch-checklist.md)). Connected accounts are per mode, so anything onboarded in test mode is void once the live key lands — hence the `mode` column (§3).

---

## 2. Design

### 2.1 Money flow (destination charge, no `on_behalf_of`)

```
Buyer pays total T on the PLATFORM account
  T = subtotal + platformFee + processingFee + tax          (FeeService invariant)
  transfer_data.destination = acct_org
  application_fee_amount    = T_cents − subtotal_cents      (platform keeps fees + tax)
→ Stripe moves subtotal to acct_org; Stripe's own 2.9% + 30¢ is debited from the platform balance
→ Organization is paid out on its schedule; platform remits tax (spec 009 unchanged)
```

`application_fee_amount` is computed **by subtraction from the actual Checkout line-item cents**, not by summing `platformFee + processingFee + tax` in dollars, so per-unit rounding of the all-in price never leaks a cent into or out of the organization's share. Unit test asserts `sum(unit_amount × qty) − application_fee_amount === round(fees.subtotal × 100)` for tax-exclusive, tax-inclusive, multi-tier, and single-cent edge cases.

Statement descriptor suffix keeps working (charge is on the platform; suffix appends to the platform prefix). Stripe Tax settings, Radar, capabilities: all platform-level, unchanged.

### 2.2 Routing rule

A Checkout Session is routed to the connected account only when, at session creation:

1. `STRIPE_CONNECT_ENABLED=true`, and
2. the organization has an `OrganizationStripeAccount` row whose `mode` equals the current `stripeMode()`, and
3. `transfersEnabled` is true (Stripe `capabilities.transfers === 'active'`), and
4. the row is not `disconnected`.

Otherwise the charge stays on the platform account exactly as today (`stripeAccountId = null`). `payoutsEnabled` is **not** a routing condition: transfers land in the connected balance and pay out once Stripe clears payouts; blocking sales on a bank detail would cost the organization revenue. The page shows *Payouts on hold* in that state.

Orders never move between accounts after creation. The ledger row records which account took the charge.

### 2.3 Account lifecycle

```
none ──onboard──▶ onboarding ──account.updated──▶ active
                      │  (details_submitted && transfers active)
                      ▼
                  restricted  (requirements.currently_due non-empty, or disabled_reason)
                      │
active ──account.application.deauthorized / dashboard disconnect──▶ disconnected
```

Derived `status` (server-side, single function `connectStatus(row)`):

| status | condition |
|---|---|
| `not_started` | no row for the current mode |
| `onboarding` | row exists, `detailsSubmitted` false |
| `restricted` | `detailsSubmitted` true and (`transfersEnabled` false or `disabledReason` set or `currentlyDue.length > 0`) |
| `active` | `detailsSubmitted` && `transfersEnabled` && no `disabledReason` |
| `disconnected` | `disconnectedAt` set |

State is written only by `syncAccount` (from `accounts.retrieve`) and the Connect webhook; the UI never guesses.

### 2.4 Account creation parameters

```js
stripe.accounts.create({
  country: 'US',
  email: organization.email ?? undefined,
  controller: {
    fees: { payer: 'application' },              // platform pays Stripe fees (§5.2)
    losses: { payments: 'application' },         // platform liable for disputes/negative balance
    stripe_dashboard: { type: 'express' },       // Express dashboard → login links work
    requirement_collection: 'stripe',            // Stripe-hosted onboarding collects KYC
  },
  capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  business_profile: { name: organization.name, support_phone, url: orgPageUrl },
  settings: { payouts: { statement_descriptor: deriveDescriptorSuffix(organization.name, 'JUMP') ?? undefined } },
  metadata: { organizationId, mode: stripeMode() },
})
```

This is the `controller` spelling of an Express account (what Stripe's current docs generate); `type: 'express'` produces the same account on this API version and is the fallback if the SDK typings complain. One account per organization per mode; `onboard` reuses the row when it exists and only mints a new Account Link.

Account Link: `stripe.accountLinks.create({ account, type: 'account_onboarding', return_url, refresh_url })` with `return_url = ${platformBaseUrl()}/admin/settings/payments/payouts?onboarding=complete` and `refresh_url = …?onboarding=refresh`. Links expire in minutes and are single-use, so they are minted per click, never stored.

Login link: `stripe.accounts.createLoginLink(accountId)` — only when `detailsSubmitted`; Stripe rejects it earlier.

### 2.5 Payout settings write

`PATCH /admin/settings/payments/connect/payouts { interval, anchor?, statementDescriptor? }` →

```js
stripe.accounts.update(acct, { settings: { payouts: {
  schedule: { interval, weekly_anchor?, monthly_anchor? },   // manual excluded from the UI
  statement_descriptor,                                       // ≤ 22, [A-Z0-9 ], ≥ 1 letter (reuse normalizeDescriptorText)
}}})
```

Validation server-side: `interval ∈ {daily, weekly, monthly}`; `weekly` requires `anchor ∈ {monday…sunday}`; `monthly` requires `1 ≤ anchor ≤ 31`; `daily` forbids `anchor`. Stripe's minimum `delay_days` for the account applies; the response is re-synced into the row so the page shows what Stripe actually stored.

### 2.6 Refunds

`_createStripeRefund(paymentIntentId, amount, reason, { connected })` adds `reverse_transfer: true, refund_application_fee: true` when `connected`. Both callers (`refundOrder`, `refundTicket`) already load the transaction; they pass `connected = Boolean(payment.stripeAccountId)`. With an `amount`, Stripe reverses the transfer and refunds the application fee **proportionally**, which is exactly the per-ticket case in §5.4; a full refund is the 100% case. Net effect: buyer made whole, organization's share pulled back, platform eats Stripe's non-refundable processing cost. `handleExternalRefund` unchanged — `charge.refunded` for destination charges fires on the platform account.

If the organization's connected balance cannot cover the reversal, `losses.payments = application` lets the account go negative and Stripe recovers from later transfers; the platform is on the hook meanwhile (risk table).

### 2.7 Webhooks

New endpoint `POST /webhooks/stripe/connect`, verified with `STRIPE_CONNECT_WEBHOOK_SECRET` (a *Connect* endpoint in the Stripe dashboard: "Listen to events on connected accounts"). Same raw-body + skip-verification-when-unset pattern as the platform route, same "return 200 after logging" error policy.

| Event | Action |
|---|---|
| `account.updated` | `ConnectService.applyAccount(event.account, event.data.object)` → row fields, `lastSyncedAt` |
| `capability.updated` | same as above (retrieve account, apply) |
| `account.application.deauthorized` | set `disconnectedAt`, `transfersEnabled=false`; log `connect_account_disconnected` |
| `payout.paid` | `lastPayoutAt = arrival_date` |
| `payout.failed` | log warn with `failure_code`; `lastPayoutFailure` text on the row (surfaces on the page) |
| `account.external_account.created/updated/deleted` | refresh bank snapshot |

Events on `webhooks.js` (`checkout.session.*`, `charge.refunded`) are untouched. Local dev: `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe/connect`.

Fallback when the secret is missing or events are lost: `POST …/connect/sync` (page button and automatic on `?onboarding=complete`). No polling sweep — account state only changes on Stripe-initiated events or the organization's own actions, both of which have a sync path.

### 2.8 Feature flag and dark deploy

`STRIPE_CONNECT_ENABLED` (default `false`). When off: Connect routes return 404, `checkoutOptionsFor` never routes, `GET /admin/settings/payments` returns `connect: { enabled: false }` and the page renders exactly as phase 1. This lets the migration and code ship to prod before the live Stripe key and Connect platform settings exist.

---

## 3. Data model

```prisma
// Spec 010 phase 2: the organization's Stripe Connect (Express) account that
// receives destination-charge transfers and pays out to its bank. One row per
// organization per Stripe mode; rows for the other mode are ignored.
model OrganizationStripeAccount {
  id                 String    @id @default(cuid())
  organizationId     String
  mode               String                        // 'test' | 'live' — stripeMode() when created
  stripeAccountId    String    @unique              // acct_…
  chargesEnabled     Boolean   @default(false)
  transfersEnabled   Boolean   @default(false)      // capabilities.transfers === 'active' — the routing gate
  payoutsEnabled     Boolean   @default(false)
  detailsSubmitted   Boolean   @default(false)
  disabledReason     String?                        // requirements.disabled_reason
  currentlyDue       String[]  @default([])         // requirements.currently_due (field names only)
  bankName           String?                        // display snapshot from external_accounts (default_for_currency)
  bankLast4          String?
  currency           String?
  payoutInterval     String?                        // daily | weekly | monthly | manual
  payoutAnchor       String?                        // weekly_anchor or monthly_anchor
  payoutDelayDays    Int?
  payoutDescriptor   String?                        // settings.payouts.statement_descriptor
  lastPayoutAt       DateTime?
  lastPayoutFailure  String?
  disconnectedAt     DateTime?
  lastSyncedAt       DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, mode])
  @@index([stripeAccountId])
}

model PaymentTransaction {
  // … existing …
  stripeAccountId String?                       // acct_… the charge was routed to; null = platform account
  applicationFee  Decimal?  @db.Decimal(10, 2)  // dollars kept by the platform on a destination charge
}
```

`Organization` gains `stripeAccounts OrganizationStripeAccount[]`. Migration `20260916XXXXXX_stripe_connect` is additive; no backfill (every existing transaction is a platform-account charge, `null` is correct). Jump stores no bank numbers beyond `last4`.

---

## 4. Backend

### 4.1 `ConnectService` (new, `backend/src/services/ConnectService.js`)

```
enabled()                                   → STRIPE_CONNECT_ENABLED === 'true'
accountFor(organizationId)                  → row for current mode or null
statusFor(organizationId)                   → { enabled, status, account: serialized|null }   (page payload)
startOnboarding(organizationId, actorId)    → { url }   create account if none, mint Account Link
loginLink(organizationId)                   → { url }   requires detailsSubmitted
syncAccount(organizationId)                 → serialized  accounts.retrieve + applyAccount
applyAccount(stripeAccountId, account)      → row        pure mapping from a Stripe Account object (used by sync + webhook)
updatePayoutSettings(organizationId, body)  → serialized  validate, accounts.update, applyAccount
destinationFor(organization)                → { stripeAccountId } | null   routing rule §2.2 (sync read, no Stripe call)
markDisconnected(stripeAccountId)           → row
```

`applyAccount` mapping: `charges_enabled`, `payouts_enabled`, `details_submitted`, `capabilities.transfers`, `requirements.disabled_reason`, `requirements.currently_due`, `settings.payouts.schedule.{interval,weekly_anchor,monthly_anchor,delay_days}`, `settings.payouts.statement_descriptor`, bank snapshot from `external_accounts.data.find(a => a.default_for_currency)` (`bank_name`, `last4`, `currency`). `accounts.retrieve(id)` must request `external_accounts` (`expand: ['external_accounts']`).

Logging events: `connect_onboarding_started`, `connect_account_synced` (with status transition), `connect_payout_settings_updated`, `connect_account_disconnected`, `connect_charge_routed` (orderId, acct, applicationFee — the reconciliation breadcrumb).

### 4.2 `PaymentSettingsService.checkoutOptionsFor(organization, charge)`

Signature grows a second argument `{ fees, lineItems }` where `lineItems` are the Checkout `line_items` already built in `OrderService` (so the cents are the exact ones Stripe will charge). Returns, in addition to phase 1 fields:

```js
payment_intent_data: {
  statement_descriptor_suffix,                 // phase 1, when it fits
  transfer_data: { destination: acct },        // only when destinationFor(org) resolves
  application_fee_amount: totalCents − subtotalCents,
},
metadata: { …, stripeAccountId: acct }         // merged by the caller into session metadata
```

and a side value `{ stripeAccountId, applicationFee }` for the ledger. Still never throws: if `destinationFor` or the math fails, log `connect_routing_skipped` and return platform-account options. Rule: routing is decided once, here; `OrderService` only records what was decided.

`getSettings` payload adds `connect: ConnectService.statusFor(orgId)`.

### 4.3 `OrderService.createOrder`

- Build `line_items` before calling `checkoutOptionsFor` (move the map above the call; pure reorder).
- `stripe.checkout.sessions.create({ ..., ...checkoutOptions.session })`.
- `paymentTransaction.create({ ..., stripeAccountId, applicationFee })`.
- Rollback path unchanged.

### 4.4 `RefundService`

§2.6. Both refund paths read `stripeAccountId` from the transaction they already join/include. Unit test on `_createStripeRefund` asserts the two flags are present iff connected.

### 4.5 Routes (`backend/src/api/routes/admin.js`, after the existing payments routes)

| Method | Path | Role | Response |
|---|---|---|---|
| POST | `/admin/settings/payments/connect/onboard` | admin | `{ url }` — 404 when flag off; 409 when `disconnected` (must re-onboard: creates a new account) |
| POST | `/admin/settings/payments/connect/login-link` | admin | `{ url }` — 409 before `detailsSubmitted` |
| POST | `/admin/settings/payments/connect/sync` | admin | `{ connect }` |
| PATCH | `/admin/settings/payments/connect/payouts` | admin | `{ connect }` — `validators/paymentValidators.js#validateUpdatePayoutSettings` |

`GET /admin/settings/payments` gains `connect` (already in `settings`, duplicated at top level for the provider card). `requireAdmin` on all four; ORGANIZER can read status only.

### 4.6 Webhook route

`backend/src/api/routes/webhooks.js` gains `router.post('/stripe/connect', express.raw(...), …)` per §2.7. Startup log in `server.js` lists which of `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` are set (parent §9 mitigation).

### 4.7 Config / env

| Var | Default | Purpose |
|---|---|---|
| `STRIPE_CONNECT_ENABLED` | `false` | Master gate (§2.8) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | unset | Connect endpoint signing secret; unset = unverified (dev/test only) |

Document in root `CLAUDE.md` env table, `docs/wiki/config/environment-variables.md`, `docs/wiki/config/stripe-setup.md` (Connect endpoint + `--forward-connect-to`).

---

## 5. Frontend

All under `frontend/src/app/admin/settings/payments/`.

### 5.1 Provider card (`page.tsx`)

Right half appears when `connect.enabled`:

| status | pill | action |
|---|---|---|
| `not_started` | `○ Set up payouts` | button → `POST …/onboard` → `window.location.assign(url)` |
| `onboarding` | `◐ Finish setup` (amber) | same button, label "Continue setup" |
| `restricted` | `● Action required` (red) | "Update details" → onboard (Account Link of type `account_onboarding` re-collects `currently_due`) |
| `active` | `● Receiving payouts` (green) | `Manage` → `POST …/login-link` → open in new tab |
| `disconnected` | `● Disconnected` (grey) | "Reconnect" → onboard |

`Manage` for ADMIN uses the login link; SYSTEM_ADMIN keeps the platform dashboard link from phase 1 plus a second `Express dashboard` link when active.

### 5.2 Payouts sub-page (`payouts/page.tsx`)

Layout per parent §3.4. Handles `?onboarding=complete` (call `sync`, show "Setup complete" or "Almost there — Stripe still needs: <currentlyDue>" toast) and `?onboarding=refresh` (call `onboard` again automatically once; Stripe sends here when a link expired). Empty state when `not_started`. `Payouts on hold` note when `active` but `payoutsEnabled=false`. `lastPayoutFailure` renders as a red row with a "Fix in Stripe" login-link button.

### 5.3 `PayoutScheduleDialog.tsx`

`SettingsDialog` shell (same as `StatementDescriptorDialog`). Fields: `Payout every` select (Every business day / Weekly on <day> / Monthly on day <n>), conditional anchor, `Payout name` with the same character rules and a live preview. Submits `PATCH …/connect/payouts`; re-renders from the returned `connect`.

### 5.4 Dashboard banner (§5.7)

`frontend/src/app/admin/page.tsx`: when `connect.enabled && status !== 'active'`, a dismissible-per-session banner "Set up payouts to receive ticket revenue" linking to the payouts page. Reads the same `GET /admin/settings/payments`; no new endpoint.

### 5.5 Types / hook

`types.ts`: `ConnectStatus`, `ConnectAccount`, `ConnectState = { enabled: boolean; status: ConnectStatus; account: ConnectAccount | null }`; `UpdatePayoutSettingsBody`. `usePaymentsApi`: `onboard()`, `loginLink()`, `sync()`, `updatePayouts(body)`.

---

## 6. Tests

| Layer | File | Cases |
|---|---|---|
| Unit | `tests/unit/connectService.test.js` | `applyAccount` mapping (active / onboarding / restricted / deauthorized shapes); `connectStatus` table; `destinationFor` routing rule (flag off, wrong mode, transfers inactive, disconnected, happy path); payout-settings validation matrix |
| Unit | `tests/unit/paymentSettingsService.test.js` | `application_fee_amount` cents identity for tax-exclusive, tax-inclusive, 3-tier with rounding drift, $0.01 ticket; options fall back to platform on any error |
| Unit | `tests/unit/refundService.test.js` (extend or create) | `_createStripeRefund` sends both Connect flags iff `connected` |
| Contract | `tests/contract/payments.test.js` (extend) | onboard/login-link/sync/payouts: 404 when flag off, 403 ORGANIZER, 409 states, tenant isolation via `X-Jump-Org`; `GET` includes `connect`; Stripe calls stubbed by `jest.spyOn` on `ConnectService` internals or the `stripe` module like phase 1 |
| Contract | `tests/contract/webhooks-connect.test.js` | `account.updated` syncs row; `account.application.deauthorized` marks disconnected; `payout.failed` records failure; bad signature → 400 when secret set |
| Contract | `tests/contract/orders.test.js` (extend) | With an active connected org, `sessions.create` receives `transfer_data` + `application_fee_amount` and the ledger row has `stripeAccountId`; org without account → unchanged phase 1 assertions |
| E2E | `frontend/tests/e2e/admin-payments-settings.spec.ts` (extend) | Provider card states from mocked API; payouts page `?onboarding=complete` and `refresh` flows; schedule dialog round-trip |

Existing `purchaseFlow` / `orders` / `refund` tests must pass unchanged with `STRIPE_CONNECT_ENABLED` unset.

---

## 7. Docs

- `docs/wiki/features/connect-payouts.md` (new): money flow diagram, routing rule, lifecycle, env, ops runbook (disconnect, negative balance, re-onboard), reconciliation query (`PaymentTransaction.stripeAccountId`, `applicationFee`).
- Update `payments-settings.md`, `stripe-integration.md` (destination charges, Connect webhook), `fee-calculation.md` (what the platform keeps), `environment-variables.md`, `stripe-setup.md`.
- `production-launch-checklist.md` — new "Stripe Connect" section (§8 ops items).
- `specs/010-payments-settings/spec.md` — phase 2 user story + SC entries; `specs/STATUS.md` note.
- `/doc-feature` after phase lands.

---

## 8. Ops before enabling in production

Human steps, in order (add to the launch checklist):

1. Live `STRIPE_SECRET_KEY` + platform `STRIPE_WEBHOOK_SECRET` (existing todo) — Connect accounts created under the test key are unusable live.
2. Stripe Dashboard › Connect › **Get started** on the live account: platform profile, business type "marketplace/platform", accept Connect terms.
3. Connect › Settings › **Branding** (name, icon, colour) — this is what organizers see on Express onboarding and their dashboard.
4. Connect › Settings › **Express dashboard features**: payouts, bank account editing on; payment details visible.
5. Connect › **Tax forms**: enable 1099-K filing by Stripe (platform is merchant of record; Stripe files for Express accounts when enabled).
6. Add a **Connect webhook endpoint** `https://<backend>/webhooks/stripe/connect` (listen on *connected accounts*) with the §2.7 events; set `STRIPE_CONNECT_WEBHOOK_SECRET`.
7. Set `STRIPE_CONNECT_ENABLED=true`, redeploy backend.
8. Verify with one internal organization: onboard → test charge → refund → payout schedule change, checking the ledger row and the Express dashboard.

---

## 9. Build sequence

Branch `feat/010-connect-phase-2`, PRs sized so CI review stays useful.

1. **PR A — data + service + routing (backend only, flag off)**: migration, `ConnectService`, `checkoutOptionsFor` extension, `OrderService` ledger fields, `RefundService` flags, Connect webhook route, env docs, unit + contract tests. Deployable dark.
2. **PR B — admin API + page**: four routes, validator, provider-card right half, payouts sub-page, schedule dialog, dashboard banner, e2e. Still dark until the flag flips.
3. **PR C — docs + checklist**: wiki page, spec/STATUS updates, launch-checklist section (§8).
4. Test-mode end-to-end on Railway staging or local with `stripe listen --forward-connect-to`, using a test Express account: onboard → charge → per-ticket refund → full refund → payout schedule. Confirm `application_fee_amount` in the Stripe dashboard equals fees + tax and the connected balance equals the subtotal.
5. Flip `STRIPE_CONNECT_ENABLED` in prod only after §8 steps 1–6.

Estimate: PR A ~2 days, PR B ~2 days, PR C + verification ~1 day.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Wrong `application_fee_amount` silently over/under-pays organizations. | Cents-identity unit tests (§6); `connect_charge_routed` log and `applicationFee` on the ledger for reconciliation; Stripe dashboard check in step 9.4. |
| Test-mode accounts left in the table when prod goes live. | `mode` column; rows for the other mode are invisible to routing and the page; no deletion needed. |
| Refund reversal exceeds the organization's connected balance. | `losses.payments = application` lets Stripe recover from future transfers; document in the runbook; `payout.failed` and negative balance surface on the page via sync. |
| Organization disconnects the platform from their Express dashboard mid-sale. | `account.application.deauthorized` flips routing to the platform account immediately; in-flight sessions keep their `transfer_data` (Stripe fails the transfer, charge still succeeds on the platform — funds stay with the platform, settle manually; log at error). |
| Connect webhook secret confused with the platform secret → status never updates. | Separate route + var; startup log; manual `Sync` button; `?onboarding=complete` triggers sync. |
| Account Link `return_url` must be `https` in live mode. | `platformBaseUrl()` is `https` in prod; guard: refuse to onboard in live mode when the base URL is not `https` (400 with a clear message). |
| Express onboarding asks the organizer for SSN/EIN and bank details — friction. | Expected; Stripe collects, Jump stores none of it. Banner copy explains why. |
| Future fee modes (absorb / pass / split) or 011 applications change what the platform keeps. | All routing and fee math live in `checkoutOptionsFor` + one pure function; later specs change the formula there, not in callers. |

---

## 11. Out of scope (phase 3 or later specs)

Payout email confirmations (`payout.paid` → org email), embedded payouts list via Account Sessions, instant payouts, multi-currency / non-US accounts, `on_behalf_of` charges, Standard or Custom account types, moving historical orders, platform-side balance/transfer reports, per-product fee modes (roadmap "fee modes"), application/invoice charges (spec 011).
