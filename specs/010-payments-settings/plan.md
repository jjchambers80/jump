# Implementation Plan: Settings › Payments (Shopify-style payment configuration)

**Status**: Plan drafted 2026-09-14. Nothing implemented. Phase 2 (Stripe Connect payouts) is gated on the §5 decisions.
**Input**: "Do some research about the existing Stripe payments service that we have in our system and under the Settings menu create a new menu item called Payments. On the page have a similar configuration as seen on these Shopify screens. Determine whether these are settings and features we need in our system; if not exclude, if so include, and put together a proper implementation plan."
**Reference screens** (10 screenshots, Shopify Settings › Payments for "Roman Skin Care"):
1. *Payments* — `Shopify Payments` card (`● Accepting payments` / `● Receiving payouts`, `Manage`), `Payment methods` row (card-brand icons, `+4`), `Payouts` row (`Shopify Balance ****** 3544`), plan-upgrade rate note; `Additional payment providers` (`Add provider`); `Payment configuration` list: `Payment capture method`, `Manual payment methods`, `Payment method customizations`, `Gift card expiration`, `Apple Wallet passes`.
2. *Payment capture method* dialog — radio: `Automatically at checkout` / `Automatically when the entire order is fulfilled` / `Manually`.
3. *Apple Wallet passes* dialog — pass header, card/text colours, logo, banner, "Activate Apple Wallet passes for gift cards".
4. *Shopify Payments* detail — two-step auth banner; `Payout bank account` (latest payout date, `View payouts`, bank `****** 3544 · USD`); `Payout settings` (`Payout schedule · Daily · Shopify`, `Email confirmation` toggle, "Funds available 3 business days after transactions"); `Customer billing statement details` (`Edit`); `Tap to Pay on mobile devices` (`Set up`); `Fraud prevention` (`Reduce credit and debit card fraud · CVV verification on · Automated`); `Test mode` toggle.
5. *Payout frequency and statement name* dialog — `Payout every` select (business day / week / month), `Payout name`.
6. *Allow Tap to Pay* dialog — QR to the Shopify mobile app.
7. *Reduce credit and debit card fraud* dialog — `Use automated settings` toggle.
8–9. *Customer billing statement details* — `Industry type` (description, MCC `5311 Retail — Department stores`, "contact support to change"); `Trade name`, `Name on customer statement` (`SP` prefix + name), `Support phone number`; `Show optional fields`.
10. *Payment methods* — `Managed payment methods` toggle; `Online` / `In-person` tabs; groups `Shop`, `Cards` (Visa, Mastercard, Amex, Diners, Discover), `Wallets` (Apple Pay, Google Pay, Amazon Pay *Disabled*, PayPal *Disabled*), `Crypto` (USDC *Disabled*), `Local` (ACH Direct Debit *B2B only, Disabled*); `View payment rates`.
**Builds on**: spec 001 Stripe Checkout flow, spec 007 tenant identity (`activeOrgFor` scoping), spec 008/009 Settings UI patterns (`SettingsNav`, `SettingsDialog`, `SummaryRow`, `useTaxApi`-style client hooks).

---

## 1. What already exists

Payments work end to end, but every organization is invisible to Stripe and Stripe is invisible to every organization: one platform account takes every charge, nothing on the admin side says whether payments are live or test, and there is no notion of paying an organization out.

| Layer | Exists today | File |
|-------|--------------|------|
| SDK | `stripe@17.7.0` (`apiVersion: '2024-11-20.acacia'`), one client from `STRIPE_SECRET_KEY`; throws at import when unset. | `backend/src/config/stripe.js` |
| Checkout | `stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], customer_email, line_items (one all-in `unit_amount` per tier), metadata { orderId, orderRef, eventId }, success_url, cancel_url, expires_at: +30 min })`. No `payment_intent_data` at all — so no statement descriptor, no capture method, no transfer/destination, no `on_behalf_of`. | `backend/src/services/OrderService.js:221-254` |
| Ledger | `Order.stripeSessionId`, `PaymentTransaction { stripePaymentIntentId, amount, currency, status }` (append-only), `Refund { stripeRefundId }` (append-only). Nothing records *which Stripe account* took the money. | `packages/db/prisma/schema.prisma:388-510` |
| Webhooks | `POST /webhooks/stripe` — `checkout.session.completed` (only when `payment_status === 'paid'`), `async_payment_succeeded/failed`, `checkout.session.expired`, `charge.refunded`. Signature verified with `STRIPE_WEBHOOK_SECRET` (skipped when unset). Returns 200 on handler errors. | `backend/src/api/routes/webhooks.js` |
| Completion | `PaymentService.handleCheckoutCompleted` → PaymentTransaction SUCCEEDED → tickets → order COMPLETED → opt-ins → confirmation email. Idempotent on order status. `OrderService.verifyAndCompleteOrder` is the redirect-time fallback. | `backend/src/services/PaymentService.js` |
| Refunds | `RefundService` full-order and per-ticket refunds via `stripe.refunds.create({ payment_intent, amount })`; external refunds reconciled from `charge.refunded`. | `backend/src/services/RefundService.js` |
| Fees | `FEE_CONFIG = { platformFeePercent: 0.05, stripeFeePercent: 0.029, stripeFeeFixed: 0.30 }`; buyer pays base + 5% platform + 2.9%+30¢ processing (+ tax). Mirrored in `frontend/src/lib/fees.ts`. | `backend/src/config/fees.js` |
| Tax | Stripe Tax on the platform account (spec 009); per-org regions; `Organization.taxInclusivePricing`. | `backend/src/services/TaxService.js` |
| Org identity | `Organization { name, companyName, email, phoneCountryCode, phoneNumber, addressLine1…, ein, logo…, brandColor }` edited on Settings › General. | `schema.prisma:116-155`, `OrganizationService.js` |
| Wallet passes | Apple + Google **ticket** passes, spec 006 phase 1, paused until certificates exist (branch `worktree-plan-wallet-passes`, PR #15). | memory `project_wallet_passes_tabled` |
| Settings shell | `SettingsNav` (`General`, `Domains`, `Tax`, `Users`), `SettingsDialog`, `SummaryRow`, `icons.tsx`; admin routes under `activeOrgFor(req)`; `canEdit` = ADMIN / SYSTEM_ADMIN, ORGANIZER read-only (spec 009 pattern). | `frontend/src/app/admin/settings/*`, `backend/src/api/routes/admin.js:36-45` |
| Tests | `tests/contract/orders.test.js`, `tests/integration/purchaseFlow.test.js` (Stripe mocked), `tests/contract/tax.test.js`; e2e `admin-tax-settings.spec.ts`, `admin-settings.spec.ts`. | |
| Docs | `docs/wiki/features/stripe-integration.md`, `docs/wiki/config/stripe-setup.md`, `fee-calculation.md`, `all-in-pricing.md`. | |

**Verdict**: keep Checkout Sessions, the webhook, and the ledger. Add (1) an organization-level payment configuration that Checkout reads at session creation, (2) a page that shows the organization what Stripe is doing for it, and (3) — behind an explicit decision — Stripe Connect so organizations receive payouts at all.

---

## 2. Research findings that change the design

### 2.1 "Receiving payouts" does not exist here, and cannot without Stripe Connect

Shopify Payments is a per-merchant account: the merchant's bank, the merchant's payout schedule, the merchant's statement descriptor. Jump has one platform Stripe account for every organization. Every charge settles to the platform's balance; how an organization gets its share is outside the system. So the `Payouts` row, `Payout bank account`, `Payout settings`, `View payouts`, and "Receiving payouts" status have **no backing object today**.

The only way to give an organization those screens is Stripe Connect: each organization gets a connected account, Checkout creates a **destination charge** (`payment_intent_data.transfer_data.destination = acct_…`, `application_fee_amount = platform fee + processing fee` in cents), and Stripe pays the organization out on its own schedule. Everything else on the Shopify detail page then maps 1:1 onto connected-account fields (`settings.payouts.schedule`, `settings.payouts.statement_descriptor`, `external_accounts`, `payouts_enabled`, `charges_enabled`, `requirements`).

This is a business decision (money movement, merchant of record, 1099-K), not a UI decision — see §5.1/§5.2. **Plan**: phase 1 ships everything that is true on the platform account; phase 2 adds Connect behind the decision; orgs without a connected account keep charging on the platform account, unchanged.

Verified against the installed SDK (`backend/node_modules/stripe/types`, 17.7.0): `Checkout.SessionCreateParams.payment_intent_data.{ capture_method, statement_descriptor_suffix, transfer_data, application_fee_amount, on_behalf_of }`, `payment_method_configuration`, and `Accounts`, `AccountLinks`, `AccountSessions`, `Payouts`, `Balance`, `PaymentMethodConfigurations` resources all exist. Pin exact field names again before building (same caution as spec 009 §2.1).

### 2.2 Statement descriptor is the highest-value, lowest-cost item on the page

Buyers today see the platform Stripe account's descriptor on their card statement, not the organization or event they bought from. Unrecognised descriptors are the top cause of "I don't recognise this charge" disputes. Stripe supports a per-charge **dynamic suffix**: `statement_descriptor_suffix` on the PaymentIntent, rendered as `<account prefix>* <suffix>`, ≤ 22 characters combined, Latin letters/digits/spaces, at least one letter, none of `< > \ ' " *`. The prefix is the platform account's `settings.card_payments.statement_descriptor_prefix` (readable via `stripe.accounts.retrieve()`; SYSTEM_ADMIN sets it in the dashboard). Shopify's `Name on customer statement` (`SP Roman Skin`) is exactly this.

**Include in phase 1**: `Organization.statementDescriptorSuffix`, validated server-side against the prefix length, previewed live in the dialog, passed on every Checkout Session. Falls back to a suffix derived from `Organization.name` when unset so every organization benefits immediately. Under Connect destination charges (no `on_behalf_of`) the same suffix keeps working.

### 2.3 Payment methods: Stripe-hosted Checkout already gives wallets for free; the setting is an allowlist

With `payment_method_types: ['card']`, Stripe-hosted Checkout already shows Apple Pay and Google Pay (device permitting) and Link (if enabled on the account) — no domain registration is needed for the hosted page. So the Shopify `Cards` + `Wallets` groups are true today; nothing to build except showing it.

Shopify's `Managed payment methods` toggle is Stripe's "automatic payment methods" (omit `payment_method_types`, let the dashboard decide). Flipping today's explicit `['card']` to that would silently enable whatever the platform dashboard has on (often Klarna, Affirm, ACH, Cash App by default) for every organization. **Exclude the managed toggle**; keep an explicit allowlist: platform defines the permitted set, the organization opts into extras. Candidates that make sense for event admissions and settle fast enough for instant ticket issuance: `cashapp`, `link`, `affirm`, `klarna`, `afterpay_clearpay` (BNPL for high-ticket events). Exclude: `us_bank_account` (ACH — days to settle, Shopify itself marks it B2B only), crypto/USDC (Shopify-only), Amazon Pay / PayPal (not on Stripe Checkout in the US without extra contracts), `Shop Pay` (Shopify-only), `In-person` tab (no POS).

Async methods (BNPL) already flow through `checkout.session.async_payment_succeeded/failed` handlers, so ticket issuance stays webhook-driven. Note: BNPL availability also depends on Stripe account approval per method; the page must show `Unavailable` (not a toggle) when the platform account lacks the capability (`stripe.accounts.retrieve().capabilities`).

### 2.4 Capture method: automatic only

Tickets are delivered the instant payment succeeds; "capture when fulfilled" is meaningless. Manual capture would hold the buyer's card up to 7 days, need a capture UI, and break `PaymentService.handleCheckoutCompleted`, which keys on `payment_status === 'paid'`. **Exclude.** Revisit only if an "approve orders before issuing tickets" feature is specified; note it in §10.

### 2.5 Test mode is a platform fact, not an organization toggle

Live vs test is the `STRIPE_SECRET_KEY` prefix (`sk_test_` / `sk_live_`) — one setting for the whole deployment. A per-organization toggle would need two keys and per-request routing; that is how orders get silently placed in the wrong mode. **Include a read-only `Test mode` badge** so an admin understands why cards are fake; **exclude the toggle**.

### 2.6 Shopify's sections, mapped to ticketing

| Shopify item | Purpose there | Applies to Jump? | Decision |
|--------------|---------------|------------------|----------|
| Provider card `● Accepting payments` / `● Receiving payouts` + `Manage` | Is the merchant account live and paid out | Yes — org needs to know whether checkout works and (with Connect) whether payouts flow | **Include.** Phase 1: `Stripe` card, `Accepting payments` from the platform account (`charges_enabled`, key mode), `Receiving payouts` shown as `Set up payouts` CTA (phase 2) or hidden when Connect is not enabled. `Manage`: SYSTEM_ADMIN → Stripe dashboard; ADMIN with connected account → Express dashboard login link (phase 2). |
| `Payment methods` row (brand icons, `+4`) → Payment methods page | Which methods the checkout offers | Yes | **Include** (§3.2). Cards + wallets shown as always-on; allowlisted extras as toggles; `Unavailable` when the platform account lacks the capability. |
| `Managed payment methods` toggle | Provider auto-adds methods | Would enable methods no one chose (§2.3) | **Exclude.** |
| `Online` / `In-person` tabs | POS | No POS | **Exclude** (online only). |
| `View payment rates` | What the merchant pays per transaction | Yes — organizers ask what fees buyers pay and what the platform keeps | **Include** as a read-only `Rates` card from `FEE_CONFIG` (5% platform, 2.9% + $0.30 processing, who pays what). |
| `Payouts` row (`****** 3544`), `Payout bank account`, `View payouts` | Where money goes | Only with Connect | **Include in phase 2** behind §5.1. Bank last4/currency from `external_accounts`; `View payouts` = Express dashboard login link (`stripe.accounts.createLoginLink`) rather than rebuilding a payouts table. |
| `Payout schedule` (daily / weekly / monthly) + `Payout name` dialog | Cadence and bank-statement label | Only with Connect | **Include in phase 2**: `accounts.update({ settings: { payouts: { schedule, statement_descriptor } } })`. |
| `Email confirmation` for every payout | Notify merchant | Stripe Express already emails payout notices | **Exclude** (phase 3 candidate via `payout.paid` on the Connect webhook if organizations ask). |
| "Funds available 3 business days after transactions" | Info | Stripe Express default is 2 business days (US) | **Include** as informational text on the payouts card (phase 2), value from `settings.payouts.schedule.delay_days`. |
| Plan-upgrade rate note | Shopify plans | No plans | **Exclude.** |
| `Additional payment providers` / `Add provider` | Offsite processors | Stripe is the only processor; no roadmap for others | **Exclude** (no placeholder — nothing to promise). |
| `Payment capture method` | Auth-then-capture | §2.4 | **Exclude.** |
| `Manual payment methods` (COD, bank deposit) | Offline payment recorded by merchant | Plausible later as "box-office / invoice / comp orders", but that is an *orders* feature with its own issuance rules, not a Stripe setting | **Exclude**; list in §10 as a separate future spec. |
| `Payment method customizations` (Shopify Functions) | Hide/rename/reorder methods by rule | Covered by the allowlist | **Exclude.** |
| `Gift card expiration` | Gift cards | No gift cards | **Exclude.** |
| `Apple Wallet passes` (gift-card pass branding) | Wallet pass look for gift cards | Jump has **ticket** wallet passes (spec 006). Pass branding already derives from org logo/brand colour; this row belongs with branding, not payments | **Exclude from Payments.** When spec 006 resumes, any pass-branding controls go under Settings › General branding. |
| Two-step authentication banner | Account security | Auth.js concern, not payments | **Exclude.** |
| `Customer billing statement details`: `Trade name`, `Name on customer statement`, `Support phone` | Descriptor on buyer's card statement | Yes — §2.2 | **Include** (§3.3). Trade name = `Organization.name` (read-only link to General). Support phone = `Organization.phoneNumber` (read-only link to General; with Connect also pushed to `business_profile.support_phone`). |
| `Industry type` (description, MCC, "contact support to change") | Card-network category | Platform account fact; per-org only with Connect (set during onboarding) | **Exclude** from the page (phase 2 onboarding collects it). |
| `Tap to Pay on mobile devices` | Contactless POS via native app | Needs Stripe Terminal + a native app; Jump has scanners, not POS | **Exclude.** |
| `Fraud prevention` (`Automated`, `CVV verification on`) | Radar posture | Stripe Radar runs on every card charge already; rules are account-level | **Include** as one read-only row (`Stripe Radar · Active`, SYSTEM_ADMIN link to Radar rules). No settings. |
| `Test mode` toggle | Fake orders | §2.5 | **Include badge, exclude toggle.** |

Sources: Stripe docs — Checkout Sessions API (`payment_intent_data`), Statement descriptors (`docs.stripe.com/get-started/account/statement-descriptors`), Connect destination charges, Express accounts & payout schedules, Account Links / login links, Payment method integration options; Shopify Help — "Shopify Payments", "Payouts", "Customer billing statement"; existing code as cited in §1; SDK types as cited in §2.1.

---

## 3. UX specification

Route: `/admin/settings/payments`. Nav item **Payments**, placed between `Domains` and `Tax` (Shopify order: Payments before Taxes). Visible to every staff role that sees Settings; editing requires ADMIN or SYSTEM_ADMIN (`canEdit`), ORGANIZER read-only — same rule as Tax.

```
Settings
Manage your organization and business information.

[General] [Domains] [Payments] [Tax] [Users]
                                        ┌──────────────────────────────────────────────┐
                                        │ 💳 Payments                                   │
                                        │                                               │
                                        │ Stripe                             [Manage]* │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ ● Accepting payments │ ○ Set up payouts   │ │  ← right half only when Connect enabled (phase 2)
                                        │ ├───────────────────────────────────────────┤ │
                                        │ │ 💳 Payment methods   VISA MC AMEX  +3    ›│ │
                                        │ │ 🏦 Payouts           Not set up          ›│ │  ← phase 2
                                        │ └───────────────────────────────────────────┘ │
                                        │ ⚠ Test mode — cards are not charged. (badge, only when sk_test_) │
                                        │                                               │
                                        │ Customer billing statement            [Edit] │
                                        │ How your organization appears on a buyer's    │
                                        │ card statement.                               │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ JUMP* ROMAN SKIN                           │ │
                                        │ │ Support phone +1 919-463-9575  (General ›) │ │
                                        │ └───────────────────────────────────────────┘ │
                                        │                                               │
                                        │ Rates                                         │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ Service fee   5% of ticket price  (buyer) │ │
                                        │ │ Processing    2.9% + $0.30        (buyer) │ │
                                        │ │ Sales tax     per Settings › Tax          │ │
                                        │ └───────────────────────────────────────────┘ │
                                        │                                               │
                                        │ Fraud prevention                              │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ 🛡 Stripe Radar screens every card payment │ │
                                        │ │                              ● Active   ›* │ │
                                        │ └───────────────────────────────────────────┘ │
                                        └──────────────────────────────────────────────┘
* Manage / Radar link: SYSTEM_ADMIN only (Stripe dashboard). With a connected account (phase 2), Manage opens the org's Express dashboard for ADMIN too.
```

### 3.1 Provider card (`Stripe`)

- `Accepting payments` pill from `GET /admin/settings/payments` → `provider.charges`:
  - `active` (key present, platform `charges_enabled`) → green `Accepting payments`
  - `test` → green pill + amber `Test mode` badge under the card: "Stripe is in test mode. Use test cards; no real money moves."
  - `unavailable` (API error) → grey `Unavailable` — "Stripe could not be reached. Checkout may fail."
- `Receiving payouts` half (phase 2, only when `provider.connect.enabled`): `Set up payouts` (no account) · `Continue setup` (account with `requirements.currently_due`) · green `Receiving payouts` (`payouts_enabled`) · red `Action required` (`requirements.past_due` / `disabled_reason`).
- Rows: `Payment methods` (icon strip of enabled brands + `+n`, chevron → §3.2), `Payouts` (phase 2: `<bank name> •••• 3544` or `Not set up`, chevron → §3.4).
- `Manage`: SYSTEM_ADMIN → `https://dashboard.stripe.com/` (test-mode aware: `/test/`). Phase 2: ADMIN with an active connected account → `POST /admin/settings/payments/connect/login-link` → Express dashboard.

### 3.2 Payment methods (sub-page `/admin/settings/payments/methods`)

Groups, Shopify style, online only:

| Group | Rows | Control |
|-------|------|---------|
| Cards | Visa, Mastercard, American Express, Discover, Diners Club, JCB | Always on (one `card` type). Read-only. |
| Wallets | Apple Pay, Google Pay, Link | "Included with cards on Stripe Checkout" — read-only `On`. Link shows `Off` if the platform account has Link disabled (`capabilities.link_payments`). |
| More ways to pay | Cash App Pay, Affirm, Klarna, Afterpay / Clearpay | Toggle per row when `canEdit`; `Unavailable` pill (no toggle) when the platform account lacks the capability (`capabilities.<x>_payments !== 'active'`). Row help text: "Buyers pay in instalments; you receive the full amount." |

- Saving is per toggle (`PATCH /admin/settings/payments { enabledPaymentMethods }`), optimistic with rollback on error, `role="status"` confirmation.
- Footer: "Only methods enabled on the platform's Stripe account are shown." + `View rates` link to the Rates card.
- Excluded: `Managed payment methods`, `In-person`, Shop Pay, Amazon Pay, PayPal, USDC, ACH.

### 3.3 Customer billing statement (dialog, `SettingsDialog` shell)

```
┌ Customer billing statement ───────────────────── Cancel  Save ┐
│ Trade name                                                     │
│ Roman Skin Care                          (edit on General ›)   │
│                                                                │
│ Name on customer statement                                     │
│ [JUMP* ] [ROMAN SKIN            ]   11 of 17 characters left   │
│ Helps buyers recognise the charge on their bank statement.     │
│ Letters, numbers and spaces only.                              │
│                                                                │
│ Preview   JUMP* ROMAN SKIN                                     │
│                                                                │
│ Support phone number                                           │
│ +1 919-463-9575                          (edit on General ›)   │
└────────────────────────────────────────────────────────────────┘
```

- Prefix is read from the platform account (`settings.card_payments.statement_descriptor_prefix`, cached 5 min like Tax status). If the platform has no prefix set, the dialog shows a SYSTEM_ADMIN-only warning ("Set a statement descriptor prefix on the Stripe account") and the suffix is disabled — Stripe rejects a suffix without a prefix.
- Validation (server and client): after uppercasing/trimming, `^[A-Z0-9 ]+$`, at least one letter, `prefix.length + 2 + suffix.length ≤ 22` (Stripe joins with `* `). Empty = fall back to the derived default (first 22 − prefix − 2 characters of `Organization.name`, sanitised).
- Trade name / support phone are read-only here and link to Settings › General (`SummaryRow` pattern) — one source of truth.
- Phase 2: with a connected account, Save also pushes `business_profile.support_phone` and `business_profile.name`.

### 3.4 Payouts (phase 2, sub-page `/admin/settings/payments/payouts`)

```
Payout bank account                                        [View payouts]
Latest payout on Sep 12, 2026.
┌──────────────────────────────────────────────┐
│ Wells Fargo •••• 3544                     ⋯  │   ⋯ → "Update bank account" (Express dashboard)
│ US Dollar (USD $)                            │
└──────────────────────────────────────────────┘

Payout settings
┌──────────────────────────────────────────────┐
│ Payout schedule      Daily · JUMP* ROMAN   › │  → dialog: Payout every [business day ▾ | week (Mon…) | month (1–31)]
│                                              │            Payout name [JUMP* ROMAN SKIN]  (bank statement label)
└──────────────────────────────────────────────┘
Funds are available 2 business days after a transaction.
```

- No account yet: empty state with `Set up payouts` → `POST /admin/settings/payments/connect/onboard` → redirect to Stripe Account Link (Express onboarding); return URLs `/admin/settings/payments/payouts?onboarding=complete|refresh`.
- `View payouts` / bank-account changes → Express dashboard via login link. Jump does **not** store bank details; it stores `last4`, `bankName`, `currency` snapshots from `external_accounts` for display.
- Payout schedule dialog writes `settings.payouts.schedule { interval, weekly_anchor, monthly_anchor }` and `settings.payouts.statement_descriptor` (≤ 22 chars, same charset rule).

### 3.5 Rates and Fraud prevention cards

Read-only. Rates from `FEE_CONFIG` via the API (so the page never drifts from the backend), with a line "Sales tax: per Settings › Tax". Fraud row: static `Stripe Radar screens every card payment · ● Active`; SYSTEM_ADMIN chevron → `https://dashboard.stripe.com/radar/rules`. Radar has no API to read its status; if the platform has Radar disabled the row is simply wrong, so the copy says "screens" not "blocks".

---

## 4. Data model

### Phase 1 — three columns on `Organization` (same approach as `taxInclusivePricing`)

```prisma
model Organization {
  …
  // Spec 010 phase 1: what buyers see on their card statement (suffix after the
  // platform prefix) and which optional Stripe payment methods this org offers.
  statementDescriptorSuffix String?   // uppercase, validated against the platform prefix; null = derived from name
  enabledPaymentMethods     String[]  @default([]) // subset of PAYMENT_METHOD_ALLOWLIST, e.g. ["cashapp","affirm"]
  paymentSettingsUpdatedAt  DateTime?
}
```

No backfill needed: null suffix derives from `name`; empty array means cards + wallets only — exactly today's behaviour.

`PaymentTransaction` gains nothing in phase 1. (It is append-only; adding a nullable `stripeAccountId` in phase 2 is additive.)

### Phase 2 — `OrganizationStripeAccount` (1:1), additive columns on the ledger

```prisma
// Spec 010 phase 2: the organization's Stripe Connect (Express) account that
// receives destination-charge transfers and pays out to its bank.
model OrganizationStripeAccount {
  id                 String   @id @default(cuid())
  organizationId     String   @unique
  stripeAccountId    String   @unique          // acct_…
  chargesEnabled     Boolean  @default(false)
  payoutsEnabled     Boolean  @default(false)
  detailsSubmitted   Boolean  @default(false)
  disabledReason     String?                   // requirements.disabled_reason
  currentlyDue       String[] @default([])     // requirements.currently_due (field names only)
  bankName           String?                   // display snapshot from external_accounts
  bankLast4          String?
  currency           String?
  payoutInterval     String?                   // daily | weekly | monthly | manual
  payoutAnchor       String?                   // weekly_anchor or monthly_anchor
  payoutDelayDays    Int?
  payoutDescriptor   String?                   // settings.payouts.statement_descriptor
  lastPayoutAt       DateTime?
  lastSyncedAt       DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

model PaymentTransaction {
  …
  stripeAccountId String?   // acct_… the charge was routed to; null = platform account (pre-Connect orders)
  applicationFee  Decimal?  @db.Decimal(10, 2) // platform + processing fee kept by the platform on destination charges
}
```

Rule: a charge is routed to the connected account only when `chargesEnabled` is true at session creation; otherwise it stays on the platform account and `stripeAccountId` is null. Orders never move between accounts after creation.

---

## 5. Open decisions (need the user / finance)

| # | Decision | Recommendation |
|---|----------|----------------|
| 5.1 | **Adopt Stripe Connect so organizations receive payouts?** Without it the `Payouts` half of the Shopify screen cannot exist and the platform settles with organizations outside the system. | **Yes, Express accounts** — Stripe-hosted onboarding and Express dashboard (bank, payouts, 1099) so Jump stores no bank details. Standard accounts push too much on organizers; Custom means Jump builds KYC UI. |
| 5.2 | **Charge type and merchant of record.** Destination charges *without* `on_behalf_of`: platform is merchant of record, pays Stripe's fee from the processing fee it already collects, statement descriptor = platform prefix + org suffix, Stripe Tax stays on the platform account (spec 009 unchanged). With `on_behalf_of`: the org becomes settlement merchant (its MCC/descriptor, Stripe fees on the org, tax registrations would have to be the org's). | **Destination charges, no `on_behalf_of`** — keeps today's fee economics and the spec 009 tax model intact. Revisit with a tax professional alongside spec 009 §5.4 (seller of record). |
| 5.3 | **What the platform keeps per order** on a destination charge. The buyer-paid platform fee and processing fee clearly stay with the platform (Stripe's actual 2.9% + 30¢ comes out of the processing fee). Sales tax is the open part: if the platform is merchant of record (5.2), the platform remits it, so tax must stay on the platform too; if the org remits, tax must be transferred with the subtotal. | **`application_fee_amount = platformFee + processingFee + tax`** (cents) so the platform keeps what it must remit and pay Stripe; the org receives exactly the ticket subtotal. Confirm with finance — this line decides who files sales tax. |
| 5.4 | **Refund economics.** Destination-charge refunds need `reverse_transfer: true` (pull the org's share back) and `refund_application_fee: true|false` (does the platform return its fee?). | `reverse_transfer: true`, `refund_application_fee: true` for full refunds (buyer made whole, platform eats Stripe's non-refundable fee), proportional for per-ticket refunds. Matches today's "refund the whole `pricePaid`" behaviour. |
| 5.5 | **Statement descriptor prefix** on the platform Stripe account (currently whatever the account's business name is). Every org suffix is limited to `22 − len(prefix) − 2`. | Set a short prefix (e.g. `JUMP`, 4 chars → 16 chars for the org) in the Stripe dashboard before phase 1 ships. Record in `docs/wiki/config/production-launch-checklist.md`. |
| 5.6 | **Platform-wide payment method allowlist** — which of Cash App Pay / Affirm / Klarna / Afterpay the platform is willing to offer (each needs capability approval and has its own dispute/refund rules; BNPL refunds can take days). | Ship phase 1 with `cashapp` and `link` only; add BNPL after the platform account's capabilities are approved and finance accepts BNPL refund timing. |
| 5.7 | **Cutover for existing organizations.** Orgs keep charging on the platform account until they finish onboarding; is there a deadline after which unconnected orgs cannot publish events? | No deadline in phase 2; show a persistent `Set up payouts` banner on the admin dashboard. Decide a policy once the first orgs are connected. |

---

## 6. Backend

### 6.1 `PaymentSettingsService` (new, `backend/src/services/PaymentSettingsService.js`)

Keeps `PaymentService` (webhooks) untouched; this is configuration.

- `getProviderStatus()` — cached 5 min (`utils/cache.js`, same TTL as `TaxService.getServiceStatus`): `{ mode: 'live'|'test', charges: 'active'|'unavailable', statementDescriptorPrefix, capabilities: { link, cashapp, affirm, klarna, afterpay_clearpay }, manageUrl }` from `stripe.accounts.retrieve()` (platform). `mode` from `STRIPE_SECRET_KEY.startsWith('sk_test_')`.
- `getSettings(organizationId)` → `{ statementDescriptorSuffix, effectiveDescriptor, enabledPaymentMethods, rates: FEE_CONFIG-derived }`.
- `updateSettings(organizationId, { statementDescriptorSuffix?, enabledPaymentMethods? })` — validation per §3.3 and against `PAYMENT_METHOD_ALLOWLIST` ∩ platform capabilities; logs `payment_settings_updated` with changed keys.
- `checkoutOptionsFor(organizationId)` → `{ payment_method_types, payment_intent_data: { statement_descriptor_suffix } }` — the one function `OrderService.createOrder` calls. Pure and cheap (one org read); never throws on a bad stored value (falls back to `['card']` + derived suffix and logs), because checkout must not break on configuration.
- `deriveDescriptorSuffix(name, prefixLength)` — exported pure helper, unit-tested.

Phase 2 adds `ConnectService` (`onboard(organizationId)` → `accounts.create({ type: 'express', … })` + `accountLinks.create`; `syncAccount(stripeAccountId)` from `account.updated`; `loginLink`; `updatePayoutSchedule`) and `checkoutOptionsFor` grows `transfer_data`, `application_fee_amount` per §5.3.

### 6.2 `OrderService.createOrder`

Replace the hardcoded `payment_method_types: ['card']` with `...await paymentSettings.checkoutOptionsFor(event.venue.organizationId)`; record `stripeAccountId` / `applicationFee` on `PaymentTransaction` in phase 2. Everything else unchanged.

### 6.3 `RefundService` (phase 2)

When the order's `PaymentTransaction.stripeAccountId` is set, refunds pass `reverse_transfer: true` and `refund_application_fee` per §5.4. `handleExternalRefund` unchanged (events arrive on the platform account for destination charges).

### 6.4 Webhooks (phase 2)

Destination-charge events (`checkout.session.*`, `charge.refunded`) keep arriving on the platform endpoint — no change. Connected-account events need a **Connect webhook endpoint**: `POST /webhooks/stripe/connect` verified with `STRIPE_CONNECT_WEBHOOK_SECRET`, handling `account.updated` (→ `syncAccount`), `payout.paid` / `payout.failed` (→ `lastPayoutAt`, optional email in phase 3). New env vars documented in `CLAUDE.md` and `docs/wiki/config/environment-variables.md`.

### 6.5 Admin routes (`backend/src/api/routes/admin.js`, all via `activeOrgFor(req)`)

| Method | Path | Role | Phase |
|--------|------|------|-------|
| GET | `/admin/settings/payments` | organizer+ | 1 — `{ provider, settings, connect?, canEdit }`; `provider.manageUrl` and Radar link only for SYSTEM_ADMIN (same masking as tax) |
| PATCH | `/admin/settings/payments` | admin | 1 — `{ statementDescriptorSuffix?, enabledPaymentMethods? }` (`validators/paymentValidators.js`) |
| POST | `/admin/settings/payments/connect/onboard` | admin | 2 — creates/reuses account, returns Account Link URL |
| POST | `/admin/settings/payments/connect/login-link` | admin | 2 — Express dashboard URL (only when `detailsSubmitted`) |
| POST | `/admin/settings/payments/connect/sync` | admin | 2 — pull account state now (used on `?onboarding=complete` return) |
| PATCH | `/admin/settings/payments/connect/payouts` | admin | 2 — `{ interval, anchor?, statementDescriptor? }` |

### 6.6 Config

`backend/src/config/payments.js`: `PAYMENT_METHOD_ALLOWLIST = ['cashapp', 'link', 'affirm', 'klarna', 'afterpay_clearpay']` with display metadata (label, group, help text), `STATEMENT_DESCRIPTOR_MAX = 22`. Phase 2: `STRIPE_CONNECT_ENABLED` (boolean; when off, Connect routes 404 and the page hides the payouts half) so phase 2 can deploy dark.

---

## 7. Frontend

`frontend/src/app/admin/settings/payments/`:

| File | Role |
|------|------|
| `page.tsx` | Provider card, test-mode badge, statement card + dialog trigger, Rates card, Fraud row. Same load gate as Tax (`useOrg`, `loadedForOrg`). |
| `usePaymentsApi.ts` | `get`, `updateSettings`, phase 2 `onboard`, `loginLink`, `sync`, `updatePayouts` — `useTaxApi` shape, `X-Jump-Org` + `?organizationId=` for SYSTEM_ADMIN. |
| `types.ts` | `PaymentsSettingsResponse`, `PaymentMethodRow`, `ConnectStatus`, pill label/style maps. |
| `StatementDescriptorDialog.tsx` | §3.3; live preview, counter, client-side charset check mirroring the server. |
| `methods/page.tsx` + `PaymentMethodsList.tsx` | §3.2 grouped list with brand icons (add to `../icons.tsx`) and per-row toggles. |
| `payouts/page.tsx` + `PayoutScheduleDialog.tsx` | Phase 2, §3.4. |
| `../SettingsNav.tsx` | Add `{ href: '/admin/settings/payments', label: 'Payments' }` between Domains and Tax. |

Buyer-facing: nothing changes visually; Checkout now shows the extra methods an org enabled and the buyer's statement reads `PREFIX* SUFFIX`.

---

## 8. Phases

### Phase 1 — Page, statement descriptor, payment methods (no Connect)

1. Migration: 3 `Organization` columns (§4). `npm run db:generate`.
2. `config/payments.js`, `PaymentSettingsService` (status cache, settings, validation, `checkoutOptionsFor`, `deriveDescriptorSuffix`).
3. `OrderService.createOrder` reads `checkoutOptionsFor`. Existing `purchaseFlow` / `orders` tests must pass unchanged with an org that has no settings (asserting `payment_method_types: ['card']` and a derived suffix on the mocked `sessions.create` call).
4. Routes + validators (§6.5, phase 1 rows).
5. Frontend page, dialog, methods sub-page, nav item.
6. Tests: unit (`deriveDescriptorSuffix`, validation edge cases: prefix missing, 22-char boundary, disallowed characters, lowercase input, non-allowlisted method, method without capability); contract (`tests/contract/payments.test.js`: GET masking by role, PATCH 403 for ORGANIZER, 400s, tenant isolation via `X-Jump-Org`); e2e (`admin-payments-settings.spec.ts`: page renders pills, edit descriptor round-trips preview, toggle a method).
7. Docs: `docs/wiki/features/payments-settings.md`, update `stripe-integration.md` (checkout options), `organization-settings.md` (nav), `production-launch-checklist.md` (§5.5 prefix). `/doc-feature`.
8. Ops before ship: set the platform statement descriptor prefix (§5.5); confirm `cashapp` / `link` capabilities on the live account.

### Phase 2 — Stripe Connect payouts (gated on §5.1–5.4, 5.7)

1. Migration: `OrganizationStripeAccount`, `PaymentTransaction.stripeAccountId/applicationFee`.
2. `ConnectService`; Connect webhook endpoint + `STRIPE_CONNECT_WEBHOOK_SECRET`; `STRIPE_CONNECT_ENABLED` gate.
3. `checkoutOptionsFor` adds `transfer_data` / `application_fee_amount` when `chargesEnabled`; `RefundService` adds `reverse_transfer` / `refund_application_fee`.
4. Payouts sub-page, provider-card right half, `Manage` → login link, payout schedule dialog.
5. Tests: contract for onboard/sync/login-link (Stripe mocked), refund path with `reverse_transfer`, webhook `account.updated` sync; e2e onboarding return states (`?onboarding=complete|refresh`).
6. Docs: `connect-payouts.md` wiki page; env vars; launch checklist (Connect platform settings: branding, 1099 enablement, Express dashboard features).
7. Verify in Stripe test mode with a test Express account end to end (onboard → charge → payout schedule → refund) before enabling `STRIPE_CONNECT_ENABLED` in prod.

### Phase 3 — Polish (only on demand)

Payout email confirmation (`payout.paid`), embedded payouts list via Account Sessions instead of the Express dashboard link, BNPL methods after §5.6, `business_profile` sync on General edits.

### Explicitly out of scope

Payment capture method (auth/capture), manual/offline payment methods, additional processors, gift cards, Apple Wallet gift-card passes (ticket passes stay spec 006), Tap to Pay / POS / in-person, per-organization test mode, Radar rule configuration, industry/MCC editing, two-step authentication, Shopify-only methods (Shop Pay, Shop Pay Installments), ACH, crypto, Amazon Pay, PayPal.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Stripe rejects the Checkout Session because the suffix + prefix exceeds 22 chars or the prefix is unset → checkout fails for every buyer of that org. | Validate against the *live* prefix on save; `checkoutOptionsFor` re-validates and drops the suffix (logs `statement_descriptor_dropped`) rather than throwing. Contract test covers it. |
| Enabling a payment method the platform account is not approved for → `sessions.create` 400. | Allowlist ∩ `capabilities === 'active'` enforced on save *and* at checkout; unavailable methods are filtered, never sent. |
| Async methods (Cash App, BNPL) complete after redirect → buyer lands on confirmation before tickets exist. | Already handled: `verifyAndCompleteOrder` + `async_payment_succeeded`; confirmation page already polls. Add an e2e with a mocked async session. |
| Phase 2: destination charges change where money sits; a mis-set `application_fee_amount` silently under/over-pays organizations. | Unit test the cents math against `FeeService.computeOrderFees` for every combination (tax-inclusive on/off, per-ticket refund); record `applicationFee` on the ledger for reconciliation; roll out per org behind `chargesEnabled`. |
| Phase 2: Connect webhook secret confusion (platform vs Connect endpoint) → account status never syncs. | Separate route and env var; `POST …/connect/sync` button on the page as the manual fallback; startup log lists which webhook secrets are configured. |
| Provider status call adds latency to page load. | 5-minute cache, `Promise.all` with settings read; page renders settings even when status is `unavailable`. |
| Statement descriptor derived from `Organization.name` produces something odd (`THE 2026 GALA CO`). | Preview on the page; ADMIN can override; derivation strips non-alphanumerics and collapses spaces. |

---

## 10. Follow-ups noted, not planned

- "Approve orders before issuing tickets" (would reopen §2.4 manual capture — verify `checkout.session.completed` `payment_status` semantics under `capture_method: 'manual'` first).
- Offline / box-office / comp orders as a separate orders spec (Shopify's *Manual payment methods*).
- Wallet-pass branding controls under Settings › General when spec 006 resumes.
- Multi-currency (everything is `usd`; Connect accounts outside the US would need it).
