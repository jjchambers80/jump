# Payments Settings

**Status**: Implemented (spec 010 phase 1, 2026-09-14; phase 2 Stripe Connect payouts 2026-09-16, dark behind `STRIPE_CONNECT_ENABLED` — see [Connect Payouts](connect-payouts.md)).
**Last Updated**: 2026-09-16

## Overview

**Settings › Payments** (`/admin/settings/payments`) shows an organization what the platform's Stripe account is doing for it and lets it configure the two things Checkout reads per organization: the **name buyers see on their card statement** (a dynamic suffix after the platform prefix, e.g. `JUMP* ROMAN SKIN`) and which **optional payment methods** checkout offers beyond cards and wallets. It also shows the buyer-paid **rates** and the **fraud screening** posture. Modelled on Shopify's *Payments* screens, keeping only what applies to a ticketing platform (no capture method, manual payment methods, gift cards, Tap to Pay or per-org test mode). With Stripe Connect enabled the provider card also shows whether the organization is **receiving payouts** and links to the Payouts page — [Connect Payouts](connect-payouts.md).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/admin/settings/payments/page.tsx` | Page: Stripe provider card (charges pill, test-mode badge, Payment methods row), Customer billing statement card, Rates, Fraud prevention |
| `frontend/src/app/admin/settings/payments/StatementDescriptorDialog.tsx` | Prefix + suffix input with live preview and counter; trade name / support phone read-only (link to General) |
| `frontend/src/app/admin/settings/payments/methods/page.tsx` | Payment methods: Cards and Wallets (always on), optional rows with per-row switch or `Unavailable` pill |
| `frontend/src/app/admin/settings/payments/payouts/page.tsx`, `PayoutScheduleDialog.tsx`, `useConnectActions.ts` | Phase 2 payouts page, schedule dialog and Connect actions — [Connect Payouts](connect-payouts.md) |
| `frontend/src/app/admin/settings/payments/BrandBadge.tsx` | Text-only brand badges |
| `frontend/src/app/admin/settings/payments/usePaymentsApi.ts`, `types.ts` | API hook (org-scoped like Tax), shapes, client-side `descriptorError` mirror |
| `frontend/src/app/admin/settings/SettingsNav.tsx` | `Payments` between `Domains` and `Tax` |
| `backend/src/api/routes/admin.js` | `GET`/`PATCH /admin/settings/payments`, scoped by `activeOrgFor(req)` |
| `backend/src/api/validators/paymentValidators.js` | Body shape; values are validated in the service against live Stripe state |
| `backend/src/services/PaymentSettingsService.js` | Provider status (cached 5 min), settings, validation, `checkoutOptionsFor` |
| `backend/src/config/payments.js` | `PAYMENT_METHOD_ALLOWLIST` (type, label, group, Stripe capability), descriptor limits |
| `backend/src/services/OrderService.js` | `createOrder` spreads `checkoutOptionsFor(organization)` into `stripe.checkout.sessions.create` |
| `packages/db/prisma/schema.prisma` | `Organization.statementDescriptorSuffix`, `enabledPaymentMethods`, `paymentSettingsUpdatedAt` (migration `20260914030000_payment_settings`) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Platform key. `sk_test_` → the page shows a **Test mode** badge. The account's **statement descriptor prefix** (`settings.card_payments.statement_descriptor_prefix`) must be set in the Stripe dashboard before any organization can choose a statement name — see [Production Launch Checklist](../config/production-launch-checklist.md) |

No new environment variables. Platform account state is read live (`stripe.accounts.retrieve()`) and cached in-process for 5 minutes.

## How It Works

### Page

1. **Stripe card** — `Accepting payments` (platform `charges_enabled`) or `Unavailable`; amber `Test mode` badge on a test key. SYSTEM_ADMIN gets **Manage** (Stripe dashboard); `manageUrl`/`radarUrl` are stripped for other roles. `Payment methods` row shows brand badges for everything enabled (`+n` overflow) and links to the methods page. When `connect.enabled` the right half shows the payouts status pill (`Set up payouts` … `Receiving payouts`) with the onboarding action, **Manage** opens the organization's Express dashboard, and a `Payouts` row links to the payouts page.
2. **Customer billing statement** — the effective descriptor (`PREFIX* SUFFIX`), whether it is derived from the trade name, and the support phone (edited on General). **Edit** opens the dialog; ORGANIZER sees **View** (read-only).
3. **Rates** — from `FEE_CONFIG` via the API so the page never drifts from `FeeService`: service fee 5%, processing 2.9% + $0.30, sales tax → Settings › Tax.
4. **Fraud prevention** — static `Stripe Radar screens every card payment · Active` row; SYSTEM_ADMIN link to Radar rules. Radar has no status API, so the copy says "screens", not "blocks".

### Statement descriptor

- Stripe limits the full card descriptor to **22 characters**: `prefix + "* " + suffix`. The budget for the suffix is `22 − len(prefix) − 2` (16 with a 4-character prefix).
- Server rule (`_validateSuffix`): uppercase, `[A-Z0-9 ]` only, at least one letter, within budget, prefix must exist on the platform account. `null`/empty clears the override.
- **Derived default**: with no override, `deriveDescriptorSuffix(Organization.name, prefix)` sanitises the name and cuts it to the budget, so every organization gets a recognisable descriptor without doing anything.
- **At checkout** (`checkoutOptionsFor`): a stored suffix that no longer fits (prefix changed) is dropped with a `statement_descriptor_dropped` warning and the derived one is used; with no platform prefix nothing is sent. Checkout never fails because of a descriptor.

### Payment methods

- `card` is always sent; Stripe-hosted Checkout adds Apple Pay / Google Pay itself (no domain registration needed for the hosted page).
- Optional methods are the intersection of `PAYMENT_METHOD_ALLOWLIST` (`link`, `cashapp`, `affirm`, `klarna`, `afterpay_clearpay`) and the platform account's **active capabilities**. A method without the capability renders as `Unavailable` and is rejected on save; `checkoutOptionsFor` re-filters at session time so a capability lost later cannot break checkout.
- Shopify's *Managed payment methods* (Stripe "automatic payment methods") is deliberately not offered: it would silently enable whatever the dashboard has on for every organization.
- Async methods (Cash App, BNPL) already complete through `checkout.session.async_payment_succeeded/failed`.

### Roles

Every staff role can open the page. `canEdit` (ADMIN, SYSTEM_ADMIN) gates the PATCH (`requireAdmin`) and the UI controls. SYSTEM_ADMIN sends `?organizationId=` from the org switcher; members are scoped by `X-Jump-Org` / membership.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/settings/payments` | organizer+ | `{ provider, settings, connect, canEdit }` — dashboard URLs only for SYSTEM_ADMIN; `connect` is `{ enabled: false, … }` until `STRIPE_CONNECT_ENABLED` |
| PATCH | `/admin/settings/payments` | admin | `{ statementDescriptorSuffix?: string\|null, enabledPaymentMethods?: string[] }` → updated `settings` |
| — | `/admin/settings/payments/connect/*` | admin | Onboarding, login link, sync, payout settings — [Connect Payouts](connect-payouts.md#api-endpoints) |

## Testing

- `backend/tests/unit/paymentSettingsService.test.js` — derivation, budget, validation edge cases, allowlist ∩ capabilities, checkout options fallbacks.
- `backend/tests/contract/payments.test.js` — role masking, ORGANIZER 403, validator 400s, tenant isolation with a foreign `X-Jump-Org`, and the options Checkout receives after a save.
- `frontend/e2e/admin-payments-settings.spec.ts` — page, test-mode badge, dialog preview/validation/save/focus return, no-prefix state, ORGANIZER read-only, methods toggles with optimistic rollback, axe.

## Gotchas

- **Set the platform prefix first.** Without `statement_descriptor_prefix` on the Stripe account the dialog is disabled and nothing is sent to Checkout. Keep the prefix short (4 characters leaves 16 for organizations).
- **Provider status is cached 5 minutes** per backend process; a capability enabled in Stripe shows as `Unavailable` until the cache rolls (or restart).
- **Contract tests pin the cache** (`paymentSettingsService._statusCache`) instead of mocking the Stripe module, because `server.js` is imported once per suite.
- With `STRIPE_CONNECT_ENABLED` off (or an older backend without `connect` in the payload) the page renders exactly as phase 1 and says the platform settles with organizations outside Jump.

## Related Features

- [Connect Payouts](connect-payouts.md) — phase 2: Express accounts, destination charges, payouts page
- [Stripe Integration](stripe-integration.md) — Checkout Session creation and webhooks
- [Tax Settings](tax-settings.md) — sibling Settings page and the pattern this one follows
- [Fee Calculation](fee-calculation.md) — where the Rates card values come from
- [Organization Settings](organization-settings.md) — trade name and support phone
