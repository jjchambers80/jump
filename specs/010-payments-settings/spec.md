# Feature Specification: Settings › Payments (Shopify-style Payment Configuration)

**Feature Branch**: `feat/010-payments-phase-1`, `plan/010-payments-settings`  
**Created**: 2026-09-14  
**Status**: Implemented — phase 1 on origin/main  
**Post-spec changes**: Phase 2 (Stripe Connect payouts) not started — gated on §5 decisions; §5.5 (platform prefix) moved to the launch checklist; SettingsNav moved to its own component.  
**Input**: "Do some research about the existing Stripe payments service that we have in our system and under the Settings menu create a new menu item called Payments. On the page have a similar configuration as seen on these Shopify screens. Determine whether these are settings and features we need in our system; if not exclude, if so include, and put together a proper implementation plan."  
**Builds on**: spec 001 Stripe Checkout flow, spec 007 tenant identity, spec 008/009 Settings UI patterns

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organization views Stripe payment status (Priority: P1)

An organization admin navigates to Settings > Payments and sees a "Stripe" provider card. The card shows whether the platform is accepting payments (green "Accepting payments" when `charges_enabled`). If the Stripe key is in test mode, an amber "Test mode — cards are not charged" badge appears under this card. A "Manage" link (SYSTEM_ADMIN) opens the Stripe dashboard. "Receiving payouts" is shown as "Set up payouts" (placeholder for phase 2).

**Why this priority**: Organizations previously had zero visibility into Stripe's status. This card is the first thing an admin sees and needs to confirm the payment pipeline is live.

**Independent Test**: Call `GET /admin/settings/payments` with a live Stripe key. Verify the response includes `provider.charges === 'active'`. Verify the UI renders the green pill and no test-mode badge. Swap to a `sk_test_` key and verify the test-mode badge appears.

**Acceptance Scenarios**:
1. **Given** a live Stripe key with `charges_enabled: true`, **When** an admin loads Settings > Payments, **Then** the Stripe card shows a green "Accepting payments" pill.
2. **Given** a test-mode Stripe key (`sk_test_…`), **When** the page loads, **Then** a "Test mode — cards are not charged" badge appears under the Stripe card.
3. **Given** a Stripe account that is unavailable (API error), **When** the page loads, **Then** the card shows a grey "Unavailable" pill.
4. **Given** a SYSTEM_ADMIN, **When** they click "Manage," **Then** a new tab opens to the Stripe dashboard (mode-aware: `/test/` prefix for test keys).

---

### User Story 2 — Organization sets customer billing statement descriptor (Priority: P1)

An organization admin clicks "Edit" on the Customer billing statement card. A dialog shows the Trade name (read-only, linked to General), the Statement descriptor suffix with a character counter and live preview, and the Support phone (read-only, linked to General). The admin enters or changes the suffix, sees the preview update in real time (e.g., "JUMP* ROMAN SKIN"), and saves. Validation enforces: Latin letters/digits/spaces only, at least one letter, and total length prefix + " * " + suffix ≤ 22.

**Why this priority**: Unrecognised card statement descriptors are the top cause of payment disputes. This is the single highest-value, lowest-cost item on the Payments page.

**Independent Test**: Open the billing statement dialog, enter a valid suffix, verify the live preview. Attempt to submit an invalid suffix (too long, special chars, empty) and verify server-side rejection.

**Acceptance Scenarios**:
1. **Given** the Customer billing statement card, **When** an ADMIN clicks "Edit," **Then** a dialog opens showing the current statement descriptor suffix (or a derived default from Organization.name), a character counter, and a live preview "JUMP* [SUFFIX]."
2. **Given** the dialog, **When** the admin types a new suffix, **Then** the preview updates in real time and the remaining characters are recalculated (total must be ≤ 22 including "JUMP* ").
3. **Given** the admin enters "VIP EVENTS" and saves, **When** the next Checkout Session is created, **Then** `payment_intent_data.statement_descriptor_suffix` is "VIP EVENTS" and the buyer sees "JUMP* VIP EVENTS" on their card statement.
4. **Given** the admin clears the suffix to empty, **When** they save, **Then** the system falls back to a sanitised default derived from the first `22 - prefix.length - 2` characters of `Organization.name`.
5. **Given** the admin attempts to save a suffix containing `*` or `<`, **When** they submit, **Then** the server rejects with a validation error; the dialog stays open.

---

### User Story 3 — Organization manages payment methods (Priority: P2)

An organization admin navigates to the Payment methods sub-page. They see groups: Cards (Visa, Mastercard, Amex, Discover, Diners Club, JCB — all always on, read-only), Wallets (Apple Pay, Google Pay, Link — included with cards on Stripe Checkout, read-only), and More ways to pay (Cash App Pay, Affirm, Klarna, Afterpay/Clearpay — toggleable when the platform account has the capability, "Unavailable" when not). Each toggle saves optimistically.

**Why this priority**: Organizations may want to offer buy-now-pay-later methods for high-ticket events or limit methods to reduce confusion. This gives them control over the checkout options.

**Independent Test**: Enable "Affirm" via the toggle, create a Checkout Session, verify `payment_method_types` includes 'affirm'. Disable it, verify it is removed. Attempt to toggle a method the platform does not support and verify it shows "Unavailable" (no toggle).

**Acceptance Scenarios**:
1. **Given** the Payment methods page, **When** it loads, **Then** all card brands show as always-on read-only, wallets show as "Included with cards," and any platform-supported BNPL methods show as toggles.
2. **Given** a toggleable method like Affirm, **When** an admin enables it, **Then** the toggle saves optimistically (immediate UI update), the confirmation text "Affirm enabled" appears, and a subsequent Checkout Session includes `payment_method_types: ['card', 'affirm']`.
3. **Given** a platform account that lacks the `affirm_payments` capability, **When** the Payment methods page loads, **Then** Affirm shows "Unavailable" with no toggle and a note: "Not available on this Stripe account."
4. **Given** an ORGANIZER viewing the page, **When** they see a toggle, **Then** it is disabled with a tooltip "Ask an admin to change payment methods."

---

### User Story 4 — Organization views rates (Priority: P2)

The Rates card shows what buyers pay: Service fee (5% of ticket price, paid by buyer), Processing (2.9% + $0.30, paid by buyer), and Sales tax (per Settings > Tax). This is read-only, derived from `FEE_CONFIG`.

**Why this priority**: Organizers frequently ask what the platform charges and how fees are split. This answers that question without requiring them to read documentation.

**Independent Test**: Verify the Rates card shows the three lines with correct percentages from `FEE_CONFIG`. Verify the amounts match what a buyer would see at checkout.

**Acceptance Scenarios**:
1. **Given** the Payments page, **When** the admin scrolls to the Rates card, **Then** they see "Service fee" (5%), "Processing" (2.9% + $0.30), and "Sales tax" (per Settings > Tax).
2. **Given** a buyer purchases a $100 ticket, **When** the order totals are computed, **Then** the rates shown on the Payments page are consistent with the buyer's receipt (5.00% platform + 2.9%+$0.30 processing + tax).

---

### User Story 5 — Fraud prevention visibility (Priority: P3)

The Fraud prevention card shows "Stripe Radar screens every card payment" with an "Active" pill. A SYSTEM_ADMIN-only chevron links to the Stripe Radar rules page. No settings exist here — it is purely informational.

**Why this priority**: Organizations should know that fraud screening is active. Active fraud prevention reduces the chance of chargebacks and increases trust in the platform.

**Independent Test**: Verify the Fraud prevention card appears on the Payments page with "Active" pill. Verify the link opens Stripe dashboard Radar for SYSTEM_ADMIN only.

**Acceptance Scenarios**:
1. **Given** the Payments page, **When** the admin views the Fraud prevention card, **Then** they see "Stripe Radar screens every card payment" with a green "Active" pill.
2. **Given** a SYSTEM_ADMIN, **When** they click the Fraud prevention chevron, **Then** a new tab opens to the Stripe Radar dashboard.

### Edge Cases

- What happens when the platform Stripe key has no statement descriptor prefix set? The statement descriptor dialog shows a SYSTEM_ADMIN-only warning: "Set a statement descriptor prefix on the Stripe account." The suffix field is disabled because Stripe rejects suffixes without a prefix.
- What happens when an admin turns off every optional payment method? Checkout falls back to `payment_method_types: ['card']` (minimum working set).
- What happens when Stripe is unavailable during page load? The provider card shows "Unavailable." The statement descriptor and rates cards still render from cached/static data.
- What happens when a new optional payment method is enabled on the platform account after the page was loaded? The `[stripe.accounts.retrieve()](<https://docs.stripe.com/api/accounts/retrieve>)` response drives the capabilities list; a page refresh picks up the new method.
- What happens when a BNPL method times out during checkout? The async payment flow already handles this via `checkout.session.async_payment_failed` webhook.
- What happens when Stripe Connect is later enabled (phase 2)? The PaymentSettingsService already returns `provider.connect.enabled`; the UI will conditionally render the Payouts card when this is true.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Settings > Payments MUST show a Stripe provider card with payment status (Accepting / Test mode / Unavailable).
- **FR-002**: The Stripe card MUST show a "Test mode" badge when the Stripe secret key is a test key.
- **FR-003**: Customer billing statement MUST show a read-only preview of the buyer-facing descriptor and an "Edit" button opening the statement dialog.
- **FR-004**: The statement descriptor suffix MUST validate: Latin letters/digits/spaces only, at least one letter, `prefix.length + 2 + suffix.length ≤ 22`.
- **FR-005**: An empty suffix MUST fall back to a sanitised default from `Organization.name`.
- **FR-006**: The Payment methods page MUST group methods into Cards (always-on, read-only), Wallets (included, read-only), and More ways to pay (toggleable when the platform account supports them).
- **FR-007**: Toggleable payment methods MUST save optimistically via `PATCH /admin/settings/payments { enabledPaymentMethods }`.
- **FR-008**: Methods the platform account cannot support MUST show as "Unavailable" with no toggle.
- **FR-009**: The Rates card MUST display Service fee (5%), Processing (2.9% + $0.30), and Sales tax (per Settings > Tax).
- **FR-010**: The Fraud prevention card MUST show "Stripe Radar · Active" with a SYSTEM_ADMIN-only link to Stripe Radar.
- **FR-011**: Statement descriptor suffix and enabled payment methods MUST be passed through to every Stripe Checkout Session.
- **FR-012**: ORGANIZER role MUST see the Payments page as read-only (no edit buttons on statement descriptor or payment method toggles).

### Key Entities

- **Organization.statementDescriptorSuffix**: String, nullable. Validated and passed as `payment_intent_data.statement_descriptor_suffix`.
- **Organization.enabledPaymentMethods**: String array. Subset of `['cashapp', 'link', 'affirm', 'klarna', 'afterpay_clearpay']` that this organization offers.
- **Organization.paymentSettingsUpdatedAt**: DateTime, tracks the last update to payment settings. Used for cache invalidation.
- **PaymentSettingsService**: Backend service serving `GET /admin/settings/payments` (provider status, current settings, platform statement prefix) and `PATCH /admin/settings/payments` (update statement descriptor suffix and payment methods).
- **Stripe provider card**: Organizational card showing Stripe acceptance status and test-mode badge.
- **StatementDescriptorDialog**: Dialog with live preview, character counter, and validation.
- **PaymentMethodsPage**: `/admin/settings/payments/methods` — sub-page with method groups and toggles.
- **SettingsNav**: Shared settings section navigation (General, Domains, Payments, Tax, Users).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An admin can find and set the statement descriptor in under 30 seconds from the Payments page.
- **SC-002**: A payment method toggle change is reflected in the next Checkout Session without a server restart.
- **SC-003**: Every buyer's card statement shows the organization's name or custom suffix, never the generic platform descriptor.
- **SC-004**: An admin who has never seen the Payments page can understand the Stripe status, fees, and fraud protection at a glance.
- **SC-005**: Stripe Connect payouts phase can be added behind the existing `provider.connect.enabled` field without breaking the phase 1 UI.

## Assumptions

- Stripe is the only payment processor; no alternative payment gateway integration.
- A single platform Stripe account serves all organizations (no Stripe Connect for phase 1).
- Stripe Checkout Sessions are the only payment method; no direct PaymentIntent or SetupIntent flows.
- All payment methods flow through Stripe Checkout; the platform never collects card numbers directly.
- `payment_method_types` is explicitly enumerated rather than using Stripe's "automatic payment methods" toggle for per-org control.
- Stripe Connect payouts (phase 2) is a future feature and not part of this spec's scope.