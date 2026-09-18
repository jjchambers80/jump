# Feature Specification: Transactions — unified view of ticket orders and application payments

**Feature Branch**: `plan/018-transactions`  
**Created**: 2026-09-17  
**Status**: Proposed — no plan yet  
**Input**: Production smoke test of paid applications, 2026-09-17 (session [01158zLwVnUE4g159VJBFE7w](https://claude.ai/code/session_01158zLwVnUE4g159VJBFE7w)): admins need to find, reference, refund and correct application charges the same way they do ticket orders. Hand-off from spec 011 §Assumptions (post-payment changes) and spec 012 phase 3 (per-event add-on sales only).  
**Builds on**: spec 003 (`Order`, `PaymentTransaction`, `Refund`, `orderRef`), spec 009 (collected tax report), spec 010 (Stripe Connect routing, `stripeAccountId`, `applicationFee`), spec 011 (`Application` amount snapshot, `ApplicationRefund`, charge at approval, pay-now), spec 012 (`OrderAddOn`, `ApplicationAddOn`, add-on sales report).

## Problem

Spec 011 deliberately did not model an application as an `Order` ("no tickets, different lifecycle, one line" — `011-applications/plan.md` §Reuse). The consequence is that money collected through applications is invisible everywhere admins look for money:

- `/admin/orders` lists ticket orders only. There is no org-wide place to find an application charge by email, business name, amount or Stripe id; the only route is event → Applications → row.
- `/admin/customers` defines a customer as a contact with a completed order. A vendor who paid $420 for a booth and never bought a ticket is not a customer, and a contact who did both shows only their ticket spend.
- Event analytics, the dashboard stats and the Settings › Tax collected-tax report sum `Order` rows only. Application revenue and application tax (forms can be `taxable`) are missing from every total, so the tax report under-reports what was collected.
- Refunds on applications exist (`ApplicationRefund`) but have no history list across the organization and no place in a finance reconciliation.
- Nothing about an application's money can be corrected after submission except add-on lines (spec 012 FR-010) and refunds. Moving an applicant to a different tier, recording a payment taken outside Stripe (cheque, cash, comped), or waiving the balance on a `PAYMENT_DUE` application all require the organizer to reject and ask the vendor to apply again.

This spec closes those gaps without changing the data model decision: an application stays an `Application`, and a new **Transactions** surface reads both models. Converting applications into orders (option B in the discussion) remains a possible later refactor if order-style editing grows beyond what phase 3 here allows.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Admin finds any charge from one place (Priority: P1)

An ORGANIZER opens **Transactions** in the admin sidebar and sees every money event for the organization in one list, newest first: ticket orders and application payments side by side. Each row shows date, type (Order / Application), a reference (`orderRef` or the application id), customer name and email, business name for applications, event, a one-line description (tier × quantity, add-ons count), gross, refunded, net, payment status, and a link to the existing detail page. A search box matches email, name, business name, `orderRef`, Stripe payment-intent, charge or refund id. Filters: type, status, event, date range. The list can be exported as CSV with the same columns plus the Stripe ids and the fee/tax breakdown.

**Why this priority**: This is the request that triggered the spec — support and finance questions start with "who paid $27.31 on the 17th?" and today the answer requires knowing which event and which form.

**Independent Test**: Create one completed order and one paid application for the same contact; `GET /admin/transactions?search=<email>` returns two rows with the correct type, amounts and detail links; `?type=APPLICATION&status=PAID` returns one; the CSV has two data rows.

**Acceptance Scenarios**:
1. **Given** a vendor paid at approval, **When** the admin searches the vendor's business name, **Then** the application row appears with gross `applicantPays`, refunded total from `ApplicationRefund`, and a link to `/admin/events/:eventId/applications/:id`.
2. **Given** a Stripe dispute email quoting `pi_…`, **When** the admin pastes the id into search, **Then** the matching order or application row is the only result.
3. **Given** a `PAYMENT_DUE` application, **When** filtered by status "Payment due", **Then** the row shows gross 0 collected, amount due, and the due date.
4. **Given** an ORGANIZER of org A, **When** they list transactions, **Then** only org A rows appear; SYSTEM_ADMIN sees all with an organization column.
5. **Given** 5,000 orders and 2,000 applications, **When** the list loads, **Then** the first page returns in under 500 ms (p95) — the union is paginated in the database, not in memory.

---

### User Story 2 — Refund and refund history from the transaction (Priority: P1)

From a transaction row the admin can open a refund dialog for either type without leaving the list: partial or full, with a reason. The existing services do the work (`RefundService` for orders, `ApplicationPaymentService.refund` for applications). Each row expands to show its refund history — amount, reason, initiator, Stripe refund id, status — pulled from `Refund` or `ApplicationRefund`. A **Refunds** filter lists only transactions with refunds, and the CSV export includes refund rows.

**Why this priority**: Refunds are the most common post-payment action and are already implemented per type; this only makes them reachable and auditable in one place.

**Independent Test**: Refund $5 of a paid application from the transactions endpoint; the application's `paymentStatus` becomes `PARTIALLY_REFUNDED`, an `ApplicationRefund` row exists with `initiatedBy` set, and the transaction row shows refunded 5.00 / net 22.31.

**Acceptance Scenarios**:
1. **Given** an ORGANIZER (not ADMIN), **When** they open the refund dialog, **Then** it is disabled with the same message as the application detail page (refunds are ADMIN).
2. **Given** a refund issued in the Stripe dashboard, **When** `charge.refunded` arrives, **Then** the transaction row reflects it within the webhook's processing time with no admin action.
3. **Given** an application charged through a connected account (spec 010), **When** refunded here, **Then** the transfer reversal and fee refund behave exactly as from the application detail page (same service call).

---

### User Story 3 — Customers and reports count application money (Priority: P2)

A contact who paid for an application is a customer. `/admin/customers` lists contacts with at least one completed order **or** one paid application; total spent, order count and last activity include applications. The customer detail page gains an **Applications** section (form, tier, status, payment, amount, link). Event analytics show application revenue as its own line beside ticket revenue and add-on revenue; the dashboard stats include it in gross; the Settings › Tax collected-tax report includes tax from taxable application forms with a "source" column (order / application).

**Why this priority**: Without this the organization's own numbers disagree with Stripe, and a tax filing built from the report is wrong.

**Independent Test**: A contact with one $27.31 paid application and no orders appears in `GET /admin/customers` with `totalSpent` 27.31; the tax report for a period containing a taxable application lists its tax with source `application`; event analytics `revenue.applications` equals the sum of `applicantPays` for `PAID` and `PARTIALLY_REFUNDED` applications minus refunds.

**Acceptance Scenarios**:
1. **Given** a contact with both orders and applications, **When** viewed on the customer page, **Then** both sections are present and `totalSpent` is the sum.
2. **Given** a `REFUNDED` application, **When** analytics are computed, **Then** its net contribution is zero and the refund appears in the refunds total.
3. **Given** a form with `taxable: false`, **When** the tax report runs, **Then** its applications contribute no tax rows.
4. **Given** Stripe Connect routing, **When** the payouts page (spec 010 phase 2) is shown, **Then** application charges routed to the connected account are included in the same totals as orders.

---

### User Story 4 — Correcting an application's money before and after payment (Priority: P2)

On the application detail page (and via the transaction row) an ORGANIZER can, while the application is `SUBMITTED`, `WAITLISTED`, or `APPROVED + PAYMENT_DUE`: **change the tier** (recomputes the amount snapshot at today's prices, keeps add-on lines that the new tier offers, drops the rest with a warning, writes a decision-log entry and emails the applicant, like spec 012 FR-010), **apply a manual adjustment** (a signed dollar amount with a required reason — a discount, a waived fee, a late charge — stored as its own line and included in the snapshot), or **waive the balance** (sets the amount to 0, marks `NOT_REQUIRED`, records who and why). An ADMIN can **record an offline payment** on a `PAYMENT_DUE` application (cheque, cash, bank transfer, comped — method, amount, reference, date): the application becomes `PAID` with `paymentSource: OFFLINE`, no Stripe object, the slot is confirmed, and the row is flagged as offline in Transactions, exports and reports. Once `PAID` through Stripe, tier and adjustments are read-only; changes go through refunds (decrease) or the later invoicing spec (increase).

**Why this priority**: These are the "edit the order" operations organizers expect. They are bounded so they never desynchronise the Stripe charge from the snapshot: money that has moved is only ever refunded, never re-priced.

**Independent Test**: Change the tier of a `SUBMITTED` application from $25 to $40; the snapshot's `applicantPays` recomputes with the same fee library, a decision-log row `TIER_CHANGED` exists, the applicant email is sent; approve → the charge equals the new amount. Record an offline payment of $27.31 on a `PAYMENT_DUE` application; it becomes `PAID`, the tier's `quantityReserved` moves to `quantityApproved`, no `stripePaymentIntentId` is set, and the transaction row shows method "cheque".

**Acceptance Scenarios**:
1. **Given** a `PAID` application, **When** the organizer tries to change the tier, **Then** the UI explains it is locked and offers refund or (later) invoice.
2. **Given** a manual adjustment of −$25 on a $27.31 snapshot, **When** recomputed, **Then** fees and tax are recalculated on the adjusted subtotal and `applicantPays` is never negative (400 if it would be).
3. **Given** an offline payment recorded, **When** a refund is attempted, **Then** the dialog explains there is no Stripe charge and records a manual refund note instead (amount tracked, no Stripe call).
4. **Given** an offline-paid application, **When** the tax report and analytics run, **Then** it is counted like a Stripe-paid one and flagged `offline` in the CSV.
5. **Given** a tier change to a tier with 0 remaining, **When** the application is later approved, **Then** the existing "tier is full" 409 applies; the change itself is allowed (nothing is reserved at change time).

---

### Edge Cases

- A `DRAFT` application (checkout never completed) is not a transaction; it appears nowhere in this spec's surfaces. `AWAITING_CARD` / `CARD_ON_FILE` rows are listed with gross 0 and status "Card on file" so the admin can see pending money.
- Orders in `PENDING` / `FAILED` / `EXPIRED` states are excluded by default and available through the status filter, matching `/admin/orders`.
- Currency is the platform currency (USD) for both types; no conversion.
- The union query must not require a new table: a database view or a two-query merge with a stable sort key (`(occurredAt, type, id)`) is acceptable, but pagination must be server-side. The plan decides.
- Search on Stripe ids covers `PaymentTransaction.stripePaymentIntentId`, `Refund.stripeRefundId`, `Application.stripePaymentIntentId`, `Application.stripeCheckoutSessionId`, `ApplicationRefund.stripeRefundId`.
- An offline payment never triggers Stripe; the `payment_intent.*` webhook path is untouched. Offline-paid applications are excluded from Stripe reconciliation but included in revenue.
- Manual adjustments are lines on the application, not edits to the tier price; the price-changed note (spec 011 phase 3) ignores adjustment lines.
- Tier change on an `APPROVED + PAYMENT_DUE` application keeps the reserved slot on the old tier until the new tier is reserved in the same transaction; if the new tier is full, 409 and nothing changes.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** `GET /admin/transactions` returns a paginated, org-scoped union of ticket orders and application payments with a common row shape: `type`, `id`, `reference`, `occurredAt`, `contact { name, email }`, `businessName?`, `event { id, name }`, `description`, `gross`, `refunded`, `net`, `status`, `paymentSource` (`stripe` | `offline`), `stripeAccountId?`, `detailUrl`.
- **FR-002** Query parameters: `type` (ORDER | APPLICATION), `status`, `eventId`, `from`, `to`, `search`, `hasRefunds`, `page`, `pageSize`, `sort`. Search matches contact email and name, business name, `orderRef`, application id, and every Stripe id listed in Edge Cases.
- **FR-003** `GET /admin/transactions/export.csv` streams the same rows plus fee, tax, Stripe ids and one row per refund, honouring the same filters.
- **FR-004** `POST /admin/transactions/:type/:id/refund` delegates to the existing refund services; permissions are unchanged (ADMIN). `GET /admin/transactions/:type/:id/refunds` returns the refund history.
- **FR-005** The admin sidebar gains **Transactions**; `/admin/orders` remains and links to it. The list is virtualised or paginated at 50 rows with the existing table patterns.
- **FR-006** `CustomerService` defines a customer as a contact with a completed order or a `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED` application; `totalSpent`, `orderCount` (renamed `transactionCount` in the API, alias kept) and `lastOrderDate` (alias `lastActivityAt`) include applications. `GET /admin/customers/:contactId` includes `applications[]`.
- **FR-007** Event analytics (`GET /events/:eventId/analytics`) return `revenue.tickets`, `revenue.addOns`, `revenue.applications`, `revenue.refunds`, `revenue.net`; the dashboard stats include application gross; the analytics page shows the application line.
- **FR-008** The Settings › Tax collected-tax report includes tax from taxable application forms with a `source` column and sums per region as for orders.
- **FR-009** Tier change on an application in `SUBMITTED`, `WAITLISTED` or `APPROVED + PAYMENT_DUE`: `POST /admin/events/:eventId/applications/:id/tier { tierId }` recomputes the snapshot with `FeeService`, reconciles add-on lines to the new tier's offers, writes an `ApplicationDecision` of action `TIER_CHANGED`, emails the applicant (new template action, default text in `config/applications.js`). ORGANIZER+.
- **FR-010** Manual adjustment lines: `ApplicationAdjustment { applicationId, amount (signed), reason, createdBy }`; included in the snapshot subtotal; allowed in the same states as FR-009; `applicantPays` may not go below 0. ORGANIZER+.
- **FR-011** Waive balance: sets the snapshot to 0 and `paymentStatus` to `NOT_REQUIRED` on an `APPROVED + PAYMENT_DUE` application, confirms the slot, records an adjustment line for the waived amount. ADMIN.
- **FR-012** Offline payment: `POST /admin/events/:eventId/applications/:id/offline-payment { method, amount, reference?, paidAt? }` on `PAYMENT_DUE`; sets `PAID`, `paymentSource: OFFLINE`, `paidAt`, `offlinePayment { method, reference, recordedBy }`, confirms the slot; no Stripe call. ADMIN. Refund on an offline payment records a manual refund row without a Stripe call.
- **FR-013** All new actions write to the application's decision log and appear in the existing payment timeline on the detail page.
- **FR-014** Roles: viewing Transactions is ORGANIZER+; refunds, waive and offline payment are ADMIN; SYSTEM_ADMIN is unscoped with an organization column.
- **FR-015** Contract tests cover the union pagination (interleaved dates across both types), every search key, the refund delegation, customer inclusion, analytics sums, tax-report inclusion, tier change with add-on reconciliation, adjustment floor at 0, and offline payment state transitions.

### Key Entities

- **Transaction (read model)** — projection over `Order` + `PaymentTransaction` + `Refund` and `Application` + `ApplicationRefund`; no new table for the list.
- **ApplicationAdjustment** — signed line on an application with reason and author; part of the amount snapshot.
- **Application.paymentSource / offlinePayment** — `stripe` (default) or `offline` with method, reference and recorder; `PAID` without Stripe ids is only valid with `paymentSource: offline`.
- **ApplicationDecision** — gains actions `TIER_CHANGED`, `ADJUSTED`, `WAIVED`, `OFFLINE_PAID`, `MANUAL_REFUND`.

## Success Criteria _(mandatory)_

- **SC-001** Any charge in the organization — ticket or application — is found in under 10 seconds from the admin area with only an email, a name or a Stripe id.
- **SC-002** Refunds for either type are issued from Transactions and every refund, whatever its origin (admin, application page, Stripe dashboard), is visible in the history with its Stripe id.
- **SC-003** Customers, event analytics, dashboard stats and the tax report agree with Stripe's gross and refunded totals for a period, application money included.
- **SC-004** An organizer can move an applicant to another tier, discount them, waive their balance or record a cheque without rejecting and re-collecting the application, and the charge (if any) always equals the snapshot shown to the applicant.
- **SC-005** No change to the checkout, webhook dispatch or Stripe object model: ticket orders and applications keep their own tables and services.

## Assumptions

- Applications remain their own model. If order-style editing needs grow past FR-009–FR-012 (line-item invoices, multiple charges per application, partial captures), the follow-up is either the invoicing spec named in spec 012 or a migration of applications onto `Order` (option B); this spec does not decide that.
- Phasing suggestion for the plan: **phase 1** FR-001–FR-005 (Transactions list, search, CSV, refunds); **phase 2** FR-006–FR-008 (customers, analytics, tax report); **phase 3** FR-009–FR-013 (tier change, adjustments, waive, offline payment). Each phase ships alone.
- `APPLICATIONS_PAYMENTS_ENABLED` gates nothing here: Transactions lists whatever exists, and FREE applications are simply absent (no money).
- Spec numbers 013–017 are reserved (messaging, floor map, pages/CMS, machine access, MCP); this is 018.
