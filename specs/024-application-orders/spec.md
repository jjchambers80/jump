# Feature Specification: Application orders — one ledger under Orders, apply-form account and consent

**Feature Branch**: `plan/024-application-orders`  
**Created**: 2026-09-19  
**Status**: Proposed — see [plan.md](./plan.md)  
**Input**: Request 2026-09-19: "an application that is submitted and paid for is also an order, just like buying a ticket … we need to have all transactions in our system centralized underneath Orders. Last time we tried to achieve that, a new Transactions section was created and we can't have this." Second part of the same request: when a participant fills out an application, a customer record is created and they are offered an account, a subscription to updates, and asked to agree to the collection and storage of their data.  
**Builds on**: spec 003 (`Order`, `OrderItem`, `PaymentTransaction`, `Refund`, `orderRef`), spec 007 (per-organization `Contact`, checkout opt-ins applied after payment, buyer magic-link accounts), spec 010 (Connect routing), spec 011 (applications, card on file, charge at approval, pay-now), spec 012 (`OrderAddOn`, `ApplicationAddOn`), spec 018 phases 2–3 (reporting over both models; tier change, adjustments, waive, offline payment, manual refunds), spec 023 (`LegalAcceptance`, legal pages — proposed, not built).  
**Supersedes**: spec 018 §Assumptions "Applications remain their own model" (option B is now chosen), spec 018 phase 2's two-source reporting, spec 011 plan §Reuse "no tickets, different lifecycle, one line".

## Problem

Spec 011 chose not to model an application as an `Order`. Spec 018 tried to compensate with a read-only union list ("Transactions"); that surface was removed on 2026-09-18 because a second money list beside Orders was a navigation problem, not a fix. What remains is the underlying split:

- Two ledgers. Ticket money lives on `Order` + `PaymentTransaction` + `Refund`; application money lives on `Application` (`subtotal`, `platformFee`, `processingFee`, `tax`, `applicantPays`, `orgReceives`, `stripePaymentIntentId`, `paymentSource`, offline fields) + `ApplicationRefund` + `ApplicationAdjustment` + `ApplicationAddOn`. Every report (customers, dashboard, event analytics, collected tax) runs two loops and reconciles in JavaScript.
- No order number for an application. A vendor who paid $420 has no `JMP-XXXXXX` reference to quote; support finds the charge only through Event → Applications.
- The admin **Orders** page is one row per ticket. An application has no ticket, so there is no row it could ever occupy.
- The apply form asks for name, email and a marketing checkbox, but never offers an account, never records that the applicant agreed to data collection, and takes a card for an off-session charge without an explicit authorization record (spec 023 §4.5).

## Decision

**An application on a PAID form is an Order.** The `Order` row is created at submission (status `PENDING`, like a ticket checkout), carries the amount snapshot as real order lines, and is the only place money, Stripe payment objects and refunds are recorded. The `Application` keeps everything that is about *review*: form, answers, profile, review status, capacity slot, card on file, decision log, tags, check-in. FREE forms create no order — there is no transaction.

Decisions taken with the user on 2026-09-19:

| # | Decision | Chosen |
|---|---|---|
| D1 | Depth of unification | Order is the ledger: money columns, Stripe intent, refunds and offline-payment fields move to `Order` / `PaymentTransaction` / `Refund`; `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationAddOn` are migrated and dropped |
| D2 | When the order is created | At submission, `PENDING`; rejected / withdrawn / replaced before a charge becomes `CANCELLED` (new `OrderStatus`) |
| D3 | Orders page | Order-level rows (one per order, both kinds); the current ticket-row view stays as a **Tickets** toggle on the same page |
| D4 | Consent record | Build spec 023's `LegalAcceptance` now and capture on apply and checkout; legal pages stay dark until text exists |
| D5 | Account opt-in on apply | Checkbox default on; account and marketing opt-ins stored on the application and applied when it becomes `SUBMITTED` |
| D6 | Order lines | Real lines: `OrderItem` gains an application tier kind and adjustment / waiver kinds; `ApplicationAddOn` becomes `OrderAddOn` |

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Every paid application is an order with a number (Priority: P1)

A vendor submits a paid application. The system creates an order `JMP-K7M2PQ` for it in the same transaction. The status page, the RECEIVED / APPROVED / PAYMENT_DUE emails, the organizer's application detail page and the Participants list all show the order number. When the card is charged at approval, the order becomes `COMPLETED`, a `PaymentTransaction` records the Stripe payment intent, and the charge appears under **Orders** like any ticket sale.

**Independent Test**: `POST /events/:eventId/applications` on a PAID form returns `{ applicationId, orderRef }`; `GET /admin/orders?search=JMP-…` returns one row with `kind: 'APPLICATION'`, `status: 'PENDING'`, `totalAmount` equal to the snapshot; after the approval charge succeeds the same row is `COMPLETED` and `GET /admin/orders/:id` shows the payment intent id.

**Acceptance Scenarios**:
1. **Given** a PAID form with charge-at-approval, **When** the applicant saves a card, **Then** the order stays `PENDING` and the application row shows "Card on file"; the order total equals what the Stripe page will charge.
2. **Given** a FREE form, **When** an application is submitted, **Then** no order exists and nothing changes under Orders.
3. **Given** an application `WITHDRAWN` or `REJECTED` before any charge, **When** the decision is recorded, **Then** its order becomes `CANCELLED`, is hidden by default under Orders, and is found by the status filter.
4. **Given** a DRAFT replaced by a new submission on the same form, **When** the new one is created, **Then** the old application is marked `WITHDRAWN` (system) and its order `CANCELLED`; neither row is deleted.
5. **Given** an offline payment recorded by an ADMIN, **When** the order is opened, **Then** its payment shows source `OFFLINE`, the method and the reference, and no Stripe id.

---

### User Story 2 — Orders is the one place for money (Priority: P1)

The admin sidebar's **Orders** page lists orders, one row each: order number, customer (business name for applications), kind, event, description, total, status, date. A search box matches order number, email, name, business name and Stripe payment-intent / refund ids. Filters: kind, status, event, date range. A **Tickets** toggle shows the existing ticket-row view (purchaser / attendee / barcode) for check-in style work. The order detail page renders an application order with its lines (tier, add-ons, adjustments), payment, refund history, and a panel linking to the application review page. Refunds on application orders are issued from the order detail page with the same amount-based dialog the application page uses; both call one service.

**Independent Test**: With one completed ticket order and one paid application for the same contact, `GET /admin/orders?search=<email>` returns two rows in date order with the right kinds; `GET /admin/orders?kind=APPLICATION` returns one; refunding $5 through `POST /admin/orders/:orderId/refund { amount: 5 }` on the application order creates a `Refund` row and sets both `Order.status` and `Application.paymentStatus` to `PARTIALLY_REFUNDED`.

**Acceptance Scenarios**:
1. **Given** a Stripe dispute email quoting `pi_…`, **When** the id is pasted into the Orders search, **Then** the matching order (either kind) is the only result.
2. **Given** an ORGANIZER of org A, **When** they open Orders, **Then** only org A's orders appear; SYSTEM_ADMIN sees all with an organization column.
3. **Given** `charge.refunded` for an application charge issued from the Stripe dashboard, **When** the webhook arrives, **Then** a `Refund` row appears on the order and the application's payment status updates, with no admin action.
4. **Given** the Tickets toggle, **When** selected, **Then** the ticket-row list behaves exactly as today (search, filters, resend confirmation, check-in links).
5. **Given** `/admin/orders`, **Then** there is no other sidebar entry for money; the removed Transactions list is not reintroduced.

---

### User Story 3 — Reports read one ledger (Priority: P2)

Customers, dashboard stats, event analytics and the Settings › Tax collected-tax report read `Order` rows only, with `kind` as the split. A contact with a paid application is a customer because they have a completed order. The customer detail page shows one order history with kind chips. The buyer account page's "My orders" includes application orders, linking to the application status page.

**Independent Test**: A contact with one $27.31 paid application and no ticket orders appears in `GET /admin/customers` with `totalSpent` 27.31 and `applicationCount` 1; the tax report for a period containing a taxable application lists its tax with source `application`; `GET /events/:eventId/analytics` `revenue.applications` equals the sum of completed application orders' `totalAmount` minus their refunds — and every one of those numbers is produced by a query over `Order`.

**Acceptance Scenarios**:
1. **Given** a `REFUNDED` application order, **When** analytics run, **Then** its net contribution is zero and the refund is in the refunds total.
2. **Given** a form with `taxable: false`, **When** the tax report runs, **Then** its orders contribute no tax rows.
3. **Given** the 018 phase 2 contract tests, **When** run against the new implementation, **Then** they pass unchanged in their assertions (only fixtures change).

---

### User Story 4 — Applicants get an account, a subscription choice and a consent record (Priority: P2)

The apply form's "Your details" section offers: **Create an account with {organizer} to manage your applications** (default on, magic link, no password), **Email me about future events from {organizer}** (existing, default off), and a required **I agree to {organizer} and Jump collecting and storing the information in this application** with a link to the Privacy Policy once it exists. On PAID forms that charge at approval, a required authorization checkbox states the amount, the trigger ("only if my application is approved"), the window (`paymentDueDays`) and how to update the card. Every acceptance is written as a `LegalAcceptance` row (document, version, presented text for the card authorization, hashed IP, user agent, reference to the application). The account and marketing opt-ins are applied to the `Contact` when the application becomes `SUBMITTED`; the RECEIVED email carries a sign-in link when an account was created. The same `LegalAcceptance` capture is added to ticket checkout (`TERMS`, `PRIVACY`, source `CHECKOUT`, reference `Order`).

**Independent Test**: Submitting with `optInAccount: true`, `optInMarketing: true`, and current `acceptances` creates the application, then — for a FREE form immediately, for a PAID form after the card is saved — sets `Contact.accountCreatedAt`, `Contact.emailSubscribed` with `emailSubscribedSource = 'APPLY'`, issues a WELCOME token, and leaves three `LegalAcceptance` rows (`PRIVACY`, `TERMS`, `CARD_AUTHORIZATION` for PAID + APPROVAL). A stale version returns `400 LEGAL_VERSION_STALE` and creates nothing.

**Acceptance Scenarios**:
1. **Given** a PAID application abandoned at the Stripe page, **When** the sweep or a resubmission cancels it, **Then** no account and no marketing flag were ever applied.
2. **Given** an applicant who already has an account at this organization, **When** they apply again with the checkbox on, **Then** nothing changes on the contact and no duplicate welcome email is sent.
3. **Given** `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` off, **When** the apply form renders, **Then** the consent label has no link and the acceptance is still recorded with the current version.
4. **Given** a checkout, **When** the buyer pays, **Then** `LegalAcceptance` rows with `source = CHECKOUT` exist for the order's email even if the payment later fails.

---

### Edge Cases

- `Application.paymentStatus` remains the fine-grained state machine (`AWAITING_CARD`, `CARD_ON_FILE`, `PROCESSING`, `PAID`, `PAYMENT_DUE`, `REFUNDED`, `PARTIALLY_REFUNDED`, `NOT_REQUIRED`). `Order.status` is the coarse money state and is written in the same transaction as every `paymentStatus` change: `AWAITING_CARD | CARD_ON_FILE | PROCESSING | PAYMENT_DUE → PENDING`; `PAID → COMPLETED`; `REFUNDED / PARTIALLY_REFUNDED → same`; review outcome `REJECTED / WITHDRAWN` while `PENDING → CANCELLED`. A waived balance is a `COMPLETED` order with total 0 and a `WAIVER` line; it has no `PaymentTransaction`.
- A `PENDING` application order shows the fine-grained state as its status chip ("Awaiting card", "Card on file", "Processing", "Payment due · due Sep 26") so pending money is visible without a second list.
- Default Orders filter hides `FAILED` and `CANCELLED` only. `PENDING` ticket orders (30-minute checkout window, swept by spec 020) show briefly; `PENDING` application orders are legitimately open money and stay listed.
- One `PaymentTransaction` per order is kept (`orderId` stays unique). A declined off-session charge records the failed intent id and `failureReason` on that row; a later pay-now success overwrites the intent id and status. The decision log keeps the history of attempts (existing `PAYMENT_DUE` rows). The Stripe dashboard link uses the current intent.
- `PaymentTransaction` gains `source` (`STRIPE | OFFLINE`), `offlineMethod`, `offlineReference`, `recordedById`. Offline rows have no Stripe id and are excluded from Stripe reconciliation, included in revenue, and flagged `offline` in CSVs — unchanged from spec 018 phase 3.
- `Refund` gains `manual` (recorded refund on an offline-paid order, no Stripe call). Application refunds are amount-based and never release capacity or void anything; ticket refunds keep their ticket / add-on line semantics. Both are `Refund` rows on the order.
- `OrderItem` gains `kind` (`TICKET_TIER | APPLICATION_TIER | ADJUSTMENT | WAIVER`), `applicationTierId`, `description`, `tax`, `createdById`; `priceTierId` becomes optional. The unique `(orderId, priceTierId)` constraint is kept (nulls do not collide). Adjustment lines are signed `unitPrice × 1`; the fee-math rule from spec 018 (adjustments fold into the tier line so `tier.price + Σadjustments ≥ 0`) is unchanged.
- `OrderAddOn` serves both kinds. Under `feeMode = ABSORB` the buyer-facing line total is `unitPrice × quantity`; under `PASS` it is that plus the line's fees and tax. One helper computes it; `serializeOrderLine` uses it.
- `Order.feeMode` (default `PASS`) and `Order.orgReceives` are added so an application order's "you receive" is stored, not recomputed. Ticket orders backfill `orgReceives = subtotalAmount`.
- `Order.paidAt` is added for both kinds (completion time) and becomes the date basis for the tax report and customer "last activity", closing spec 018 decision 7.6.
- `Order.dueAt` replaces `Application.paymentDueAt`; `Application.overdue` stays (review-facing flag set by the sweep).
- Stripe metadata on application sessions and intents gains `orderId` and `orderRef`; webhook dispatch still keys on `metadata.applicationId` for card-on-file flows, but `charge.refunded` for either kind resolves through `PaymentTransaction.stripePaymentIntentId` in `RefundService.handleExternalRefund`, which now branches on `order.kind`.
- Chargebacks / disputes: out of scope, as today.
- Currency: platform currency (USD) for both kinds; `Application.currency` moves to `Order.currency`.
- Backfill: every existing application on a PAID form gets an order (status from the mapping above, `paidAt` from `Application.paidAt`, lines rebuilt from tier / `ApplicationAddOn` / `ApplicationAdjustment`), a `PaymentTransaction` where a Stripe intent or an offline payment exists, and its `ApplicationRefund` rows become `Refund` rows. `DRAFT` applications with no card get a `PENDING` order like new submissions. Idempotent and re-runnable.
- Existing apply-form marketing opt-in was applied at submission before any proof; it now waits for `SUBMITTED` (same moment for FREE forms, after the card step for PAID forms).
- Consent versions live in `backend/src/config/legal.js` (`LEGAL_VERSIONS = { terms, privacy, cardAuthorization }`, shared with the frontend through `GET /legal/versions`); the pages themselves are spec 023 phase 1 and stay dark.

## Requirements _(mandatory)_

### Functional Requirements

**Ledger**
- **FR-001** `Order` gains `kind` (`TICKET | APPLICATION`, default `TICKET`), `applicationId` (unique, nullable), `feeMode`, `orgReceives`, `paidAt`, `dueAt`. `OrderStatus` gains `CANCELLED`.
- **FR-002** `OrderItem` gains `kind`, `applicationTierId`, `description`, `tax`, `createdById`; `priceTierId` nullable. `OrderAddOn` is used for application add-on lines. `PaymentTransaction` gains `source`, `offlineMethod`, `offlineReference`, `recordedById`. `Refund` gains `manual`.
- **FR-003** `Application` loses `subtotal`, `platformFee`, `processingFee`, `tax`, `applicantPays`, `orgReceives`, `feeMode`, `currency`, `stripePaymentIntentId`, `stripeAccountId`, `applicationFee`, `paidAt`, `paymentDueAt`, `paymentSource`, `offlinePaymentMethod`, `offlinePaymentReference`, `offlinePaymentRecordedById`, and the relations `refunds`, `addOns`, `adjustments`; gains `order Order?`, `optInAccount`, `optInMarketing`, `optInsAppliedAt`. `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationAddOn` are dropped after backfill. `AdjustmentKind`, `PaymentSource`, `OfflinePaymentMethod` enums are reused on the order side.
- **FR-004** `ApplicationService.submit` creates the order and its lines inside the submission transaction for PAID forms and returns `orderRef`. Every later amount change (add-on edit, tier change, adjustment, waive) rewrites the order lines and totals through one function.
- **FR-005** `ApplicationPaymentService` builds Stripe line items from order lines, writes `PaymentTransaction` on charge (approval) or on Checkout session creation (charge at submission / pay-now), and updates `Order.status` in the same transaction as `paymentStatus`.
- **FR-006** `RefundService` handles application orders: `refundOrder(orderId, { amount?, reason, initiatedBy })` accepts a partial amount when `kind = APPLICATION`, creates `Refund` (manual when the payment is offline), recomputes both statuses. `ApplicationService.refund` delegates to it and writes the decision-log row. `handleExternalRefund` branches on kind.
- **FR-007** Backfill migration (SQL, part of the schema migration) plus an idempotent Node script for `db push` environments produce the same result.

**Orders surface**
- **FR-008** `GET /admin/orders` returns order-level rows for both kinds with `kind`, `description`, `businessName`, `applicationId`, `application { status, paymentStatus, dueAt }` and supports `kind`, `status` (multi), `eventId`, `from`, `to`, `search` (order ref, email, first / last name, business name, Stripe payment-intent and refund ids), `page`, `limit`. Default excludes `FAILED` and `CANCELLED`. Org-scoped; SYSTEM_ADMIN unscoped with `organization`.
- **FR-009** `GET /admin/orders/export.csv` streams the same rows plus fee / tax breakdown, Stripe ids, payment source and one row per succeeded refund.
- **FR-010** `/admin/orders` renders order rows with a **Orders | Tickets** toggle; the Tickets view is today's page moved into a component, unchanged. Row click opens `/admin/orders/[orderId]`.
- **FR-011** `/admin/orders/[orderId]` renders application orders: lines, payment (source / method / reference / intent link), refund history, refund action (ADMIN, amount-based), an **Application** panel (form, tier, review status, payment chip, business name, link to the review page). Ticket orders render as today.
- **FR-012** The order number appears on the application review page, the Participants / per-event Applications lists (column, linked), the applicant status page, the buyer account Applications section, and in the `RECEIVED`, `APPROVED`, `PAYMENT_DUE`, `OFFLINE_PAID` template context (`{{orderRef}}`).
- **FR-013** Customer detail shows one orders table with kind; the buyer account page's orders list includes application orders.
- **FR-013a** A receipt email is sent when an application order is paid (Stripe or offline): order number, lines, totals, payment method, link to the status page. Same shell as the ticket confirmation; no tickets; none for waived balances or FREE forms.

**Reporting**
- **FR-014** `CustomerService`, dashboard stats, `EventService.getEventAnalytics` and `TaxService.collectedReport` query `Order` only; `PAID_APPLICATION_STATUSES` is deleted; response shapes are unchanged (`applicationCount`, `revenue.applications`, tax `source`).

**Apply-form account and consent**
- **FR-015** `POST /events/:eventId/applications` accepts `optInAccount`, `optInMarketing`, `acceptances: [{ document, version }]`; rejects with `400 LEGAL_VERSION_STALE` when any version is not current; requires `PRIVACY` and `TERMS`, plus `CARD_AUTHORIZATION` on PAID forms with `chargeTiming = APPROVAL`.
- **FR-016** New model `LegalAcceptance` per spec 023 §8.1 (append-only). Rows are written inside the submit transaction (source `APPLY`, reference `Application`) and inside `OrderService.createOrder` (source `CHECKOUT`, reference `Order`), with `ipHash = sha256(ip + daily salt)`, `userAgent` truncated to 255, `presentedText` for `CARD_AUTHORIZATION`.
- **FR-017** `Contact` gains `emailSubscribedAt`, `emailSubscribedSource` (`CHECKOUT | APPLY | ADMIN | IMPORT`), `emailUnsubscribedAt`. Existing checkout opt-in application sets source `CHECKOUT`; the customer-edit path sets `ADMIN`.
- **FR-018** Opt-ins on an application are applied once, when it first reaches `SUBMITTED` (`optInsAppliedAt`); only ever turn flags on; a WELCOME `BuyerLoginToken` is issued when an account was just created and the RECEIVED email includes the sign-in link (`{{accountUrl}}`).
- **FR-019** The apply form shows the three checkboxes and, on PAID + APPROVAL forms, the card-authorization checkbox with the exact amount, trigger and window; the Privacy Policy link renders only when `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` is on. `GET /legal/versions` (public) returns the current versions so the client sends what it showed.
- **FR-020** Roles unchanged: viewing Orders ORGANIZER+; refunds, offline payment, waive ADMIN; SYSTEM_ADMIN unscoped.
- **FR-021** Contract tests cover: order creation at submission (PAID) and absence (FREE); status mapping on every transition including `CANCELLED`; line rewrite on add-on edit / tier change / adjustment / waive; charge at approval writing `PaymentTransaction`; pay-now; offline payment; refunds (partial, full, manual, external webhook) on application orders; Orders list search by every key and kind / status filters; CSV; customers / analytics / dashboard / tax over the single ledger; backfill script idempotence against a fixture that mirrors pre-migration rows; opt-in timing for FREE and PAID; `LegalAcceptance` rows and the stale-version 400 on apply and checkout.

### Key Entities

- **Order (kind APPLICATION)** — the transaction for an application: lines, totals, `feeMode`, `orgReceives`, `paidAt`, `dueAt`, `orderRef`, status.
- **OrderItem** — ticket tier line, application tier line, or a signed adjustment / waiver line.
- **OrderAddOn** — add-on line for either kind.
- **PaymentTransaction** — one per order; Stripe or offline.
- **Refund** — ticket, add-on line, or amount-based application refund; `manual` when no Stripe call was made.
- **Application** — review state, capacity, card on file, opt-ins; `order` relation.
- **LegalAcceptance** — who accepted which document version, when, from where (spec 023).

## Success Criteria _(mandatory)_

- **SC-001** Any charge — ticket or application — is found under **Orders** in under 10 seconds with an email, a name, a business name, an order number or a Stripe id. No other money list exists.
- **SC-002** Every application charge and refund is a row in `Order` / `PaymentTransaction` / `Refund`; no money column remains on `Application`.
- **SC-003** Customers, dashboard, analytics and the tax report each run one query family over `Order` and agree with Stripe's gross and refunded totals.
- **SC-004** Every applicant is offered an account and a subscription, and every submission and checkout has a `LegalAcceptance` trail; no account or marketing flag is set for an email that never completed a submission.
- **SC-005** The Stripe object model and webhook endpoints are unchanged; existing application flows (card on file, charge at approval, pay-now, overdue sweep, corrections) behave as before from the applicant's and organizer's point of view.

## Assumptions

- Production holds only smoke-test application rows (2026-09-17); the backfill is still written to be correct for any volume and re-runnable.
- `APPLICATIONS_PAYMENTS_ENABLED` gates nothing here; FREE forms are simply orderless.
- Legal text is not part of this spec. `LEGAL_VERSIONS` start at `2026-09-19-draft`; the checkbox labels are engineering copy to be replaced by counsel's wording (spec 023). Because a consent row without a readable document is weak evidence, the version bump and the page publication happen together in spec 023 phase 1; this spec builds the capture so that day is a config change.
- Phasing (see plan): **phase 1** ledger migration and services, reports collapse (backend, no UI change beyond serializers); **phase 2** Orders surface, order detail, order number everywhere, CSV, customer / buyer pages, receipt email; **phase 3** apply-form account, marketing provenance, `LegalAcceptance` capture on apply and checkout. Each ships alone.
- Spec numbers 013–017 remain reserved; 023 is legal compliance; this is 024.
