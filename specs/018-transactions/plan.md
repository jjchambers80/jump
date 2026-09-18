# Implementation Plan: Transactions (spec 018)

**Status**: Planned 2026-09-17. Phases 1–2 built and merged 2026-09-18 (PRs #65, #66). Phase 3 built 2026-09-18 on `feat/018-transactions-phase-3`.
**Spec**: [spec.md](./spec.md). Depends on spec 011 (all phases on `main`), spec 012 (all phases on `main`), spec 009 (collected tax report), spec 010 phase 2 (Connect routing, dark).
**Branches**: plan on `plan/018-transactions` (PR #64); phases on `feat/018-transactions-phase-1` → `-phase-2` → `-phase-3`, each merged to `main` alone.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Org-wide order list with search on `orderRef`, contact email / first / last name, status + event filters, Prisma pagination | `OrderService.getOrdersByOrganization`, `GET /admin/orders` | Column set and filter semantics are the template for the ORDER half of the union; the route stays and links to Transactions |
| Org scoping (`resolveOrgScope`, `isUnscoped`, `venueFilter`) | `backend/src/middleware/orgScope.js`, every `/admin/*` route | Orders scope through `event.venue.organizationId`; applications carry `organizationId` directly. SYSTEM_ADMIN is unscoped |
| Order refunds: full, per ticket, per add-on line; external refund webhook; refund history | `RefundService.refundOrder / refundTicket / refundAddOnLine / handleExternalRefund / getRefundsForOrder`; `POST /admin/orders/:orderId/refund`, `GET /admin/orders/:orderId/refunds` | Delegation target for `type = ORDER` |
| Application refunds (amount-based, Connect-aware), refund status recompute, `charge.refunded` idempotency | `ApplicationPaymentService.refund`, `_recomputeRefundStatus`, `_onChargeRefunded`; `ApplicationService.refund`; `POST /admin/events/:eventId/applications/:id/refund` (ADMIN) | Delegation target for `type = APPLICATION`; gains the offline / manual branch in phase 3 |
| Amount snapshot from lines through `FeeService` (PASS / ABSORB, per-line `taxable`, per-line `applicantPays`) | `ApplicationFormService.applicationAmounts`, `applicationLines`; `ApplicationService._addOnRows` | Tier change and adjustments recompute through the same function; nothing new in fee math |
| Pre-payment line edit pattern: `FOR UPDATE` lock, editability rule, capacity re-hold, snapshot rewrite, decision row, session expiry, templated email | `ApplicationService.updateAddOns`, `addOnsEditable`, `applicationPaymentService.expireSession`, `applicationTemplateService.send` | Tier change (FR-009) and adjustments (FR-010) are the same shape with a different line set; `addOnsEditable` generalises to `amountEditable` |
| Capacity helpers: take / release tier slot with add-on holds in a fixed lock order | `ApplicationService._takeCapacity / _releaseCapacity`; `AddOnService.reserve / release / commit / unsell` | Tier change moves a RESERVED slot between tiers inside one transaction |
| Mark paid: slot RESERVED → APPROVED, add-on holds → sold, `paidAt`, idempotent | `ApplicationPaymentService._markPaid(applicationId, paymentIntentId, { source })` | Offline payment calls it with `paymentIntentId = null` and `source: 'offline'`; only the `paymentSource` columns are new |
| Decision log + templates (`TEMPLATE_ACTIONS`, defaults in `config/applications.js`), payment timeline on the detail page | `ApplicationDecision`, `ApplicationTemplateService`, `_serializeAdmin.decisions` | New actions append to the same log; the timeline renders them with no structural change |
| Customers as contacts with a COMPLETED order; per-customer orders | `CustomerService.getCustomersByOrganization / getCustomerById` | Predicate and aggregates widen to applications |
| Event analytics (per tier sold × price), add-on sales report | `EventService.getEventAnalytics`, `AddOnService.sales`, `GET /organizations/:orgId/events/:eventId/analytics` | Gains a `revenue` object with the application line |
| Collected tax report by venue region, proportional refund estimate, CSV | `TaxService.collectedReport / reportToCsv`, `GET /admin/settings/tax/report` | Second source loop over applications, `source` on rows |
| Admin table / filter / CSV patterns, `AdminSidebar` | `frontend/src/app/admin/orders/page.tsx`, `frontend/src/components/AdminSidebar.tsx` | Transactions page copies the orders page and adds type / refunds filters and row expansion |

---

## 2. Design

### 2.1 Transaction read model

A `Transaction` is a projection, not a table. `TransactionService.list(orgId | null, query)` builds one `UNION ALL` in Postgres over two `SELECT`s that project the common row shape (FR-001), sorts on `(occurredAt DESC, type, id)`, and paginates with `LIMIT / OFFSET` **in the database**. A companion `SELECT COUNT(*)` over the same union gives `total`. Two Prisma queries merged in memory were rejected: correct interleaving needs `page × pageSize` rows from each side and the total is still two counts; a view was rejected because Prisma migrations carry it awkwardly and it adds nothing over one SQL string in a service.

The SQL is built by a small tagged-template builder (`backend/src/services/transactionQuery.js`) that takes the parsed filters and returns `{ sql, params }` for `prisma.$queryRawUnsafe` — every value is a `$n` parameter, never interpolated. Both halves apply the same filters so the union stays cheap:

| Filter | ORDER half | APPLICATION half |
|---|---|---|
| org scope | `Event ⨝ Venue.organizationId = $org` | `Application.organizationId = $org` |
| `type` | drop the other half entirely | |
| `status` | `Order.status` | `Application.paymentStatus` (mapped, see 2.2) |
| `eventId` | `Order.eventId` | `Application.eventId` |
| `from` / `to` | `occurredAt` | `occurredAt` |
| `hasRefunds` | `EXISTS Refund … status = 'SUCCEEDED'` | `EXISTS ApplicationRefund … status = 'SUCCEEDED'` |
| `search` | `orderRef ILIKE`, contact email / first / last `ILIKE`, `PaymentTransaction.stripePaymentIntentId =`, `EXISTS Refund.stripeRefundId =` | `Application.id =`, contact email / first / last `ILIKE`, `ApplicantProfile.businessName ILIKE`, `stripePaymentIntentId =`, `stripeCheckoutSessionId =`, `EXISTS ApplicationRefund.stripeRefundId =` |

Stripe ids match by equality (they are unique, indexed columns); text fields by `ILIKE '%…%'`. A search term starting with `pi_`, `cs_`, `re_`, `pyr_` or `ch_` skips the `ILIKE` branches. `ch_` ids are not stored on either side; the plan resolves them through Stripe (`charges.retrieve → payment_intent`) only when the search term is a `ch_` id, one API call, cached for the request.

Default exclusions match `/admin/orders`: orders in `PENDING` / `FAILED` are hidden unless `status` names them; applications in `DRAFT` never appear; `AWAITING_CARD` / `CARD_ON_FILE` / `PROCESSING` appear with gross 0 (spec Edge Cases).

### 2.2 Row shape

```ts
type Transaction = {
  type: 'ORDER' | 'APPLICATION';
  id: string;                       // orderId | applicationId
  reference: string;                // orderRef | application id (short form in the UI)
  occurredAt: string;               // ORDER: Order.createdAt; APPLICATION: paidAt ?? submittedAt ?? createdAt
  contact: { id: string; name: string; email: string };
  businessName: string | null;      // ApplicantProfile.businessName
  event: { id: string; name: string; date: string };
  organization?: { id: string; name: string }; // SYSTEM_ADMIN only
  description: string;              // "2 × General, 1 add-on" | "Vendor booth — 10×10, Power ×1"
  gross: number;                    // Order.totalAmount | Application.applicantPays (0 unless PAID/PARTIALLY_REFUNDED/REFUNDED)
  refunded: number;                 // Σ SUCCEEDED refunds
  net: number;                      // gross − refunded
  amountDue: number | null;         // APPLICATION in PAYMENT_DUE: applicantPays; else null
  dueAt: string | null;
  status: TransactionStatus;        // see below
  paymentSource: 'stripe' | 'offline';   // always 'stripe' until phase 3
  stripeAccountId: string | null;
  stripePaymentIntentId: string | null;
  detailUrl: string;                // /admin/orders/:id | /admin/events/:eventId/applications/:id
};
```

`status` is one vocabulary over both models so the filter has one option list:

| `TransactionStatus` | ORDER | APPLICATION (`paymentStatus`) |
|---|---|---|
| `PENDING` | `PENDING` | `AWAITING_CARD`, `CARD_ON_FILE`, `PROCESSING` |
| `PAID` | `COMPLETED` | `PAID` |
| `PAYMENT_DUE` | — | `PAYMENT_DUE` |
| `PARTIALLY_REFUNDED` | `PARTIALLY_REFUNDED` | `PARTIALLY_REFUNDED` |
| `REFUNDED` | `REFUNDED` | `REFUNDED` |
| `FAILED` | `FAILED` | — |

The raw source status is returned too (`sourceStatus`) for the detail link tooltip. `NOT_REQUIRED` applications (FREE forms, waived) are not transactions — no money — except a waived application (phase 3) which is listed as `PAID` with gross 0 and `paymentSource: 'offline'`, so the waiver is auditable from the list.

Description strings are built in JS from two batched Prisma reads after the page is known (`OrderItem ⨝ PriceTier`, `OrderAddOn`; `ApplicationTier`, `ApplicationAddOn ⨝ AddOn`) — the union returns ids and money only, so the SQL stays flat.

### 2.3 Refunds from the list

`POST /admin/transactions/:type/:id/refund { amount?, reason? }` (ADMIN) and `GET /admin/transactions/:type/:id/refunds` (ORGANIZER+) are thin: they resolve org ownership the way the existing routes do, then call `refundService.refundOrder` (ORDER — full refund only; per-ticket and per-line refunds stay on the order detail page where the lines are visible) or `applicationService.refund(eventId, id, orgId, { amount, reason, initiatedBy })`. History rows are normalised to `{ id, amount, reason, status, stripeRefundId, initiatedBy, manual, createdAt }` from `Refund` or `ApplicationRefund`. Nothing about the Stripe calls, Connect reversal or webhook idempotency changes (spec SC-005).

### 2.4 CSV

`GET /admin/transactions/export.csv` runs the same builder without `LIMIT`, streams rows in pages of 500 (cursor on the sort key) and writes one line per transaction plus one indented line per SUCCEEDED refund (`kind = refund`). Columns: `kind, type, reference, occurredAt, status, paymentSource, contactName, contactEmail, businessName, organization?, event, description, subtotal, platformFee, processingFee, tax, gross, refunded, net, stripePaymentIntentId, stripeCheckoutSessionId, stripeRefundId, stripeAccountId, detailUrl`. Fee and tax come from `Order.*Amount` and `Application.subtotal / platformFee / processingFee / tax`.

### 2.5 Customers, analytics, tax (phase 2)

- **Customers.** `CustomerService` predicate becomes `OR: [{ orders: { some: { status: { in: PAID_ORDER } } } }, { applications: { some: { paymentStatus: { in: PAID_APP } } } }]` with `PAID_ORDER = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED']` and `PAID_APP = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']`. Aggregates: `totalSpent` = Σ `Order.totalAmount` + Σ `Application.applicantPays` (gross, as today); new `totalRefunded`; `transactionCount` (with `orderCount` kept as an alias equal to the same number — the frontend switches to `transactionCount`); `lastActivityAt` (alias `lastOrderDate`). `getCustomerById` returns `applications[]` (form, tier, status, paymentStatus, applicantPays, refunded, paidAt, link). Including refunded orders in the predicate changes today's list slightly (a fully refunded buyer becomes a customer) — decision 7.2.
- **Event analytics.** `getEventAnalytics` gains `revenue: { tickets, addOns, applications, applicationRefunds, net }`. `tickets` is the existing `totals.revenue` (sold × listed price — already net of refunded tickets because refunds decrement `quantitySold`); `addOns` is `AddOnService.sales(eventId).totals.revenue`; `applications` is Σ `applicantPays` over `PAID_APP` rows on the event; `applicationRefunds` is Σ SUCCEEDED `ApplicationRefund.amount`; `net = tickets + addOns + applications − applicationRefunds`. Order refunds are not listed separately because the ticket and add-on lines already exclude refunded lines — decision 7.7. `totals.revenue` is unchanged so existing consumers do not move.
- **Dashboard stats.** `GET /admin/dashboard/stats` gains `revenue: { orders, applications, gross }` over the org scope (`COMPLETED / PARTIALLY_REFUNDED / REFUNDED` orders' `totalAmount`; `PAID_APP` applications' `applicantPays`). The dashboard card shows gross with the two-line split on hover.
- **Tax report.** `collectedReport` adds a second loop over `Application` rows with `paymentStatus IN PAID_APP`, `form.taxable = true`, `paidAt` in range, org match; region from `event.venue.state` through `resolveRegionForVenue`; `taxableSales += subtotal`, `taxCollected += tax`, `taxRefunded` proportional as for orders. Rows become `{ region, name, source: 'order' | 'application', count, taxableSales, taxCollected, taxRefunded, taxNet }` — one row per (region, source) that has activity, sorted by name then source; `totals` is unchanged in shape and sums both sources. `reportToCsv` and the frontend copy in `settings/tax/types.ts` gain a `Source` column and rename `Orders` → `Count`. Date basis differs per source (orders `createdAt`, applications `paidAt`) — decision 7.6.
- **Connect payouts page** (spec US3 scenario 4): application charges routed to the connected account already carry `stripeAccountId` / `applicationFee`; the payouts page reads Stripe balance transactions, not our tables, so nothing changes there. Noted so the acceptance scenario is closed by inspection, not code.

### 2.6 Corrections on applications (phase 3)

One rule, shared with spec 012 §2.5: **money that has moved is only refunded, never re-priced.** All four actions are refused once `paymentStatus ∈ {PAID, PROCESSING, REFUNDED, PARTIALLY_REFUNDED}`; `addOnsEditable(application)` is renamed `amountEditable(application)` and used by add-on edits, tier change, adjustments and waive. Offline payment has its own gate (`APPROVED + PAYMENT_DUE`).

- **Tier change** — `ApplicationService.changeTier(eventId, applicationId, orgId, tierId, { byUserId })`: lock the row `FOR UPDATE`; `amountEditable`; new tier must belong to the same form, be active, and differ; reconcile add-on lines: keep lines whose add-on is `allTiers` or attached to the new tier, drop the rest (returned as `droppedAddOns` and named in the note); if `capacitySlot = RESERVED`, hold the new tier with the `_takeCapacity` conditional update **before** releasing the old (409 "This tier is full" leaves everything unchanged), then release the old tier and re-hold add-ons through `AddOnService.release / reserve`; recompute the snapshot with `applicationAmounts(applicationLines(newTier, form, keptLines) + adjustments)`; write `TIER_CHANGED` with note `Tier: A → B. Total $X → $Y. Dropped add-ons: …`; expire a pending pay-now session; send the `TIER_CHANGED` template. ORGANIZER+.
- **Adjustments** — `ApplicationAdjustment { applicationId, amount (signed), reason, createdById }`. `addAdjustment(…, { amount, reason })` and `removeAdjustment(…, adjustmentId)`; both recompute. For fee math the adjustment total is folded into the tier line: `applicationLines` gains a fourth parameter and emits the tier line as `{ price: tier.price + Σadjustments, quantity: 1, taxable: form.taxable }`; every add-on line is untouched so per-line `applicantPays` (Stripe line items, status page) stays exact. Constraint: `tier.price + Σadjustments ≥ 0`, else 400 `"Adjustment exceeds the tier price ($25.00); edit add-ons instead"`. This is stricter than the spec's `applicantPays ≥ 0` floor and is what keeps FeeService away from negative items — decision 7.4. Decision row `ADJUSTED` with `note = "+$10.00 late fee" | "−$25.00 sponsor discount"`. The price-changed note (spec 011 phase 3) compares tier and add-on listed prices only and ignores adjustments. ORGANIZER+.
- **Waive** — `waiveBalance(…, { reason })` on `APPROVED + PAYMENT_DUE`: records an `ApplicationAdjustment` of `−applicantPays` with `kind = WAIVER`, sets every money column to 0, `paymentStatus = NOT_REQUIRED`, `paymentSource = OFFLINE`, `paymentDueAt = null`, `overdue = false`; moves the slot RESERVED → APPROVED and commits add-on holds (same statements as `_markPaid`); expires the pay-now session; decision `WAIVED`; sends a new `WAIVED` template ("your balance has been waived"). ADMIN.
- **Offline payment** — `recordOfflinePayment(…, { method, amount, reference?, paidAt? })` on `APPROVED + PAYMENT_DUE`: `amount` must equal the current `applicantPays` (partial offline payments are out of scope — decision 7.5); `method ∈ {CHEQUE, CASH, BANK_TRANSFER, COMPED, OTHER}`; calls `applicationPaymentService._markPaid(applicationId, null, { source: 'offline' })` (made public as `markPaidOffline`) inside the same transaction that sets `paymentSource = OFFLINE`, `offlinePaymentMethod`, `offlinePaymentReference`, `offlinePaymentRecordedById`, `paidAt = body.paidAt ?? now`; expires the pay-now session; decision `OFFLINE_PAID` with `note = "Cheque #1042, $27.31"`; sends a new `OFFLINE_PAID` template with a default body (Stripe-paid applications rely on Stripe's receipt, so no existing template fits). ADMIN.
- **Manual refund** — `ApplicationPaymentService.refund` branches on `paymentSource`: OFFLINE → create `ApplicationRefund { manual: true, status: SUCCEEDED, stripeRefundId: null }`, no Stripe call, `_recomputeRefundStatus`, decision `MANUAL_REFUND`. The dialog (detail page and Transactions) shows "No Stripe charge — this records a refund you made outside Jump" when the row is offline.
- **Serialisation** — `_serializeAdmin` adds `adjustments[]`, `paymentSource`, `offlinePayment { method, reference, recordedBy }`, `amountEditable { allowed, reason }`, `tierChangeable` (same object), `offlinePaymentAllowed`; `_serializeApplicant` adds `adjustments[]` (reason + amount) so the status page explains a discounted total. `_chargeDescription` appends `(adjusted)` when adjustments exist.

Webhooks are untouched: an offline-paid application has no Stripe objects, so `payment_intent.*` and `charge.refunded` never reference it; `isApplicationRefundEvent` keeps matching on `stripePaymentIntentId` only.

---

## 3. Data model

Phase 1 and 2 add **no schema**. Phase 3:

```prisma
enum PaymentSource { STRIPE OFFLINE }
enum OfflinePaymentMethod { CHEQUE CASH BANK_TRANSFER COMPED OTHER }
enum AdjustmentKind { ADJUSTMENT WAIVER }

model ApplicationAdjustment {
  id            String         @id @default(cuid())
  applicationId String
  kind          AdjustmentKind @default(ADJUSTMENT)
  amount        Decimal        @db.Decimal(10, 2)   // signed; negative = discount
  reason        String
  createdById   String?
  createdAt     DateTime       @default(now())
  // NO updatedAt — remove and re-add instead of editing

  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([applicationId])
}

model Application {
  // …existing…
  paymentSource               PaymentSource         @default(STRIPE)
  offlinePaymentMethod        OfflinePaymentMethod?
  offlinePaymentReference     String?
  offlinePaymentRecordedById  String?
  adjustments                 ApplicationAdjustment[]
}

model ApplicationRefund {
  // …existing…
  manual Boolean @default(false)   // true = recorded, no Stripe refund (offline-paid application)
}

enum ApplicationAction {
  // …existing…
  TIER_CHANGED
  ADJUSTED
  WAIVED
  OFFLINE_PAID
  MANUAL_REFUND
}
```

Migration `20260920000000_transactions_corrections`. No backfill: every existing application is `STRIPE` with no adjustments. `ApplicationRefund.stripeRefundId` is already nullable, so `manual` is a flag, not a schema change to the ledger.

Indexes for the union (phase 1, migration `20260919120000_transactions_indexes`, indexes only): `Application(organizationId, paidAt)`, `Application(organizationId, submittedAt)`, `Order(createdAt)`. `ApplicantProfile.businessName` and contact name fields stay on `ILIKE` without an index; `pg_trgm` is a follow-up if p95 exceeds the 500 ms target at 5k + 2k rows (spec US1 scenario 5, measured in the contract test with seeded volume).

---

## 4. Backend

### 4.1 Services

- `TransactionService.js` — `list(orgId, query)`, `count(orgId, query)`, `exportCsv(orgId, query, res)`, `refund(orgId, type, id, { amount, reason, initiatedBy })`, `refunds(orgId, type, id)`, `resolveOwnership(orgId, type, id)` (throws `NotFoundError` on a cross-org id). Uses `transactionQuery.js` for SQL and `_describe(rows)` for the two batched description reads.
- `transactionQuery.js` — pure: `buildListSql(filters, { offset, limit, unscoped })`, `buildCountSql(filters, …)`, `parseFilters(query)` (validates enums, dates, page ≤ 1000, pageSize ≤ 100, coerces `search`). Unit-tested against fixtures for every filter permutation, including the `type` short-circuit and the Stripe-id-prefix branch.
- `CustomerService` — widened predicate and aggregates (phase 2). `getCustomerById` adds `applications[]` through `applicationService.listForContact(orgId, contactId)` reshaped to the customer view.
- `EventService.getEventAnalytics` — `revenue` object (phase 2); reads `AddOnService.sales` and one `application.aggregate` + one `applicationRefund.aggregate`.
- `TaxService.collectedReport` — application loop, `source` on rows (phase 2).
- `ApplicationService` — `changeTier`, `addAdjustment`, `removeAdjustment`, `waiveBalance`, `recordOfflinePayment`; `amountEditable`; serialisers (phase 3). `applicationLines(tier, form, addOnLines, adjustmentTotal = 0)`.
- `ApplicationPaymentService` — `markPaidOffline` (public wrapper of `_markPaid` with `source: 'offline'`), manual-refund branch in `refund` (phase 3).
- `config/applications.js` — `TEMPLATE_ACTIONS` += `TIER_CHANGED`, `WAIVED`, `OFFLINE_PAID`, with default subject / body (phase 3).

### 4.2 Routes

| Route | Auth | Phase | Purpose |
|---|---|---|---|
| `GET /admin/transactions` | ORGANIZER+ | 1 | union list; query per FR-002 |
| `GET /admin/transactions/export.csv` | ORGANIZER+ | 1 | streamed CSV, same filters |
| `GET /admin/transactions/:type/:id/refunds` | ORGANIZER+ | 1 | normalised refund history |
| `POST /admin/transactions/:type/:id/refund` | ADMIN | 1 | delegate to `RefundService.refundOrder` / `ApplicationService.refund` |
| `GET /admin/customers`, `GET /admin/customers/:contactId` | ORGANIZER+ | 2 | widened (no path change) |
| `GET /organizations/:orgId/events/:eventId/analytics` | member | 2 | `revenue` object |
| `GET /admin/dashboard/stats` | ORGANIZER+ | 2 | `revenue` object |
| `GET /admin/settings/tax/report(.csv)` | ORGANIZER+ | 2 | `source` rows |
| `POST /admin/events/:eventId/applications/:id/tier` | ORGANIZER+ | 3 | `{ tierId }` |
| `POST /admin/events/:eventId/applications/:id/adjustments` | ORGANIZER+ | 3 | `{ amount, reason }` |
| `DELETE /admin/events/:eventId/applications/:id/adjustments/:adjustmentId` | ORGANIZER+ | 3 | |
| `POST /admin/events/:eventId/applications/:id/waive` | ADMIN | 3 | `{ reason }` |
| `POST /admin/events/:eventId/applications/:id/offline-payment` | ADMIN | 3 | `{ method, amount, reference?, paidAt? }` |
| `POST /admin/events/:eventId/applications/:id/refund` | ADMIN | 3 | unchanged path; manual branch for offline rows |

Validators: `transactionValidators.js` (`validateTransactionQuery`, `validateTransactionRefundBody`, `:type` ∈ `ORDER | APPLICATION`), `applicationValidators.js` gains `validateTierChangeBody`, `validateAdjustmentBody` (amount ≠ 0, |amount| ≤ 10 000, reason 1–200 chars), `validateWaiveBody`, `validateOfflinePaymentBody`.

`/admin/orders/:orderId/refund`, `/tickets/:ticketId/refund` and `/orders/:orderId/add-ons/:orderAddOnId/refund` currently run on `requireOrganizer` only, while application refunds require ADMIN. Phase 1 adds `requireAdmin` to the three order refund routes so FR-014 holds for both types from one place — decision 7.1; the orders page already hides the button for non-admins.

### 4.3 Webhooks

None added or changed.

---

## 5. Frontend

### 5.1 Phase 1 — Transactions page

- `frontend/src/app/admin/transactions/page.tsx` — copied from `admin/orders/page.tsx`: search box (debounced, placeholder "Email, name, business, order ref or Stripe id"), filter row (Type, Status, Event, From / To, "Has refunds" toggle), 50-row pages, columns per FR-001 with a Type pill and a Source pill (Stripe / Offline, phase 3), row expansion loading `…/refunds` lazily, per-row **Refund** button (disabled with the ADMIN message for organizers), **Export CSV** button honouring current filters. SYSTEM_ADMIN sees an Organization column. `useSearchParams` in a `<Suspense>` boundary; filters live in the URL so a filtered view is linkable.
- `RefundTransactionDialog.tsx` — amount (prefilled with remaining, editable for applications, fixed full for orders), reason; on success refetches the row.
- `AdminSidebar.tsx` — **Transactions** entry above Orders. `admin/orders/page.tsx` gains a one-line banner "Looking for application payments? See Transactions".
- `frontend/src/lib/transactions.ts` — `Transaction`, `TransactionStatus`, `TransactionRefund` types, status label / colour maps, `describeTransaction` helpers; `useTransactionsApi.ts`.

### 5.2 Phase 2 — Reports

- `admin/customers/page.tsx` — column "Transactions" (was "Orders"), "Last activity"; `customers/[contactId]/page.tsx` — **Applications** section under Orders with form, tier, status, payment, amount, link.
- `admin/events/[eventId]/analytics/page.tsx` — revenue card becomes a stacked breakdown: Tickets / Add-ons / Applications / Application refunds / Net.
- `admin/dashboard/page.tsx` — Gross revenue stat with the orders / applications split.
- `admin/settings/tax/` — report table grouped by region with a Source sub-row; CSV copy in `types.ts` updated to match the backend columns.

### 5.3 Phase 3 — Corrections

- `admin/events/[eventId]/applications/[applicationId]/page.tsx` — **Amount** card gains: tier row with **Change tier** (dialog: tier picker, live total preview from `applicationAmounts` mirrored in `lib/fees.ts`, warning listing add-ons that will be dropped); **Adjustments** list with add / remove (dialog: signed amount, reason); **Waive balance** and **Record offline payment** buttons (ADMIN, only in `PAYMENT_DUE`; dialog: method, amount prefilled and locked, reference, date). Every button disabled with `amountEditable.reason` when locked. Timeline renders the five new actions with icons; refund dialog shows the manual-refund copy for offline rows.
- Transactions and the applications list show the Source pill and a `paymentSource` filter.
- Status page (`events/[eventId]/apply/status/[applicationId]/page.tsx`) — adjustments listed under the tier line with their reasons.

---

## 6. Phases

### Phase 1 — Transactions list, search, CSV, refunds (FR-001–FR-005, FR-014)

`transactionQuery.js` + unit fixtures; `TransactionService`; four routes + validators; index migration; `requireAdmin` on order refund routes; Transactions page, refund dialog, sidebar entry, orders banner. Tests: `backend/tests/unit/transactionQuery.test.js`; `backend/tests/contract/transactions.test.js` — interleaved pagination across both types (seed 6 orders and 6 applications with alternating timestamps, assert page 1 / 2 order and `total`), every search key including `pi_` / `re_` / `cs_` equality and business name, each filter, `hasRefunds`, org isolation (org B sees nothing; SYSTEM_ADMIN sees both with `organization`), refund delegation for each type with `initiatedBy`, ORGANIZER refund → 403, CSV header + row count + refund rows, and a 5 000 + 2 000 row timing check under `describe.skip` unless `TRANSACTIONS_PERF=1`. Frontend e2e `transactions.spec.ts`: search by email finds both rows; refund an application from the list.

Built 2026-09-18. Decisions taken while building:

- The builder is `$queryRawUnsafe` with a `Params` collector rather than a tagged template, so both halves can be assembled conditionally; enum columns are compared as `::text` and date parameters as `($n::timestamptz AT TIME ZONE 'UTC')` (a bare parameter against Prisma's `timestamp(3)` is read in the session time zone — the contract test caught a 4-hour shift locally).
- `occurredAt` for applications is `COALESCE(paidAt, submittedAt, createdAt)` (decision 7.3 as recommended). Application gross and fee columns are 0 until paid so pending rows never inflate totals; `amountDue` carries the snapshot for `PAYMENT_DUE`.
- A row fetched by id (`getOne`, returned after a refund) is exempt from the default PENDING / FAILED hiding.
- SYSTEM_ADMIN narrows with `X-Jump-Org` or `?organizationId=` (unlike `/admin/orders`, which ignores the switcher); unscoped rows carry `organization`.
- ORDER refunds from the list are full refunds only (a partial `amount` is 400) — per-ticket and per-line refunds stay on the order page where the lines are visible. The order detail page now hides refund buttons for organizers.
- CSV pages with `OFFSET` in 500-row chunks inside one request; keyset pagination deferred.
- The perf gate (5 000 + 2 000 rows) was not added as a test; the indexes in `20260919120000_transactions_indexes` are in place and `pg_trgm` remains the documented next step.

### Phase 2 — Customers, analytics, dashboard, tax report (FR-006–FR-008)

`CustomerService` predicate + aggregates + `applications[]`; `getEventAnalytics.revenue`; dashboard `revenue`; `collectedReport` application loop + `source`; four frontend surfaces. Tests: `backend/tests/contract/transactionsReporting.test.js` — application-only contact appears in customers with `totalSpent`; mixed contact sums; `revenue.applications` and `applicationRefunds` after a partial refund; REFUNDED application nets to zero; tax report: taxable form contributes a row with `source: application`, `taxable: false` form contributes nothing, totals sum both sources; existing `analytics.test.js` and `tax.test.js` assertions on `totals` unchanged.

Built 2026-09-18. Decisions taken while building:

- Tax report rows stay one per region (the e2e test ids and the `rows.find(region)` consumers keep working) and gain `count` + `sources[]` instead of splitting into (region, source) rows as §2.5 sketched; the CSV is the flat per-(region, source) form with `Source` / `Count` columns. `orders` is kept as an alias of `count` on rows and totals.
- Customers search also matches `ApplicantProfile.businessName`, since a vendor is usually looked up by business.
- `revenue.applicationCount` was added to the analytics object so the page can label the applications line ("3 paid").
- Dashboard `revenue` is gross only (no refunds) — the dashboard has no refund concept today and the Transactions page is one click away.
- Decisions 7.2 (refunded orders count as customers), 7.6 (applications by `paidAt`) and 7.7 (`applicationRefunds` only) taken as recommended.

### Phase 3 — Corrections: tier change, adjustments, waive, offline payment (FR-009–FR-013)

Schema migration; `amountEditable`; five service methods; six routes + validators; three templates; serialisers; detail-page dialogs; status-page adjustments; Source pill and filter. Tests: `backend/tests/contract/applicationCorrections.test.js` — tier change on SUBMITTED recomputes `applicantPays` and writes `TIER_CHANGED` + email; tier change on `PAYMENT_DUE` moves the reserved slot (old tier `quantityReserved` −1, new +1) and 409s with nothing changed when the new tier is full; tier change drops an add-on not offered on the new tier and names it; adjustment −$25 on a $25 tier passes, −$25.01 → 400, add-on lines' `applicantPays` unchanged; adjustment on PAID → 409; waive: money columns 0, `NOT_REQUIRED`, slot APPROVED, adjustment `WAIVER` row, listed in Transactions with gross 0 and `offline`; offline payment: `PAID`, `paymentSource: OFFLINE`, no `stripePaymentIntentId`, slot APPROVED, add-on holds committed, amount mismatch → 400, wrong state → 409, ORGANIZER → 403; manual refund on offline row creates `manual: true` with no Stripe call (Stripe mock asserts zero calls) and `PARTIALLY_REFUNDED`; approval after a tier change charges the new amount (extends `applicationPayments.test.js`). e2e: change tier → approve → PAID at the new amount.

Built 2026-09-18. Decisions taken while building:

- Waive and offline payment share `_lockForSettlement` (APPROVED + PAYMENT_DUE) and `_confirmHeldSlot` (the RESERVED → APPROVED move from `_markPaid`, including add-on holds → sold) rather than making `_markPaid` public: the offline path also has to write the `paymentSource` columns in the same transaction, and `_markPaid` opens its own.
- A waived application is `paymentStatus = NOT_REQUIRED` + `paymentSource = OFFLINE`, and the Transactions union includes NOT_REQUIRED rows only when OFFLINE (decision 7.9 as recommended: a $0 `PAID` row with the Offline pill).
- Add-on lines are rewritten on every recompute so each line's `applicantPays` is exact; because FeeService allocates the fixed processing component proportionally, a line's share can move by a cent when the tier line changes — the tests assert ≤ 2¢, not equality.
- Adjustments do not email the applicant; tier change, waive and offline payment do (`TIER_CHANGED`, `WAIVED`, `OFFLINE_PAID` templates). The applicant status page shows adjustments as "Includes …" under the tier line because the tier line is already net of them.
- `_afterAmountChange` only expires a Checkout session on APPROVED + PAYMENT_DUE rows (a SUBMITTED row's stored session is the completed setup session and must stay).
- `offlinePayment.paidAt` may be back-dated (≤ 1 day in the future is rejected); the tax report's `paidAt` basis therefore honours the cheque date.
- Not built: a "settle offline instead of charging" option at approval — approving a CARD_ON_FILE application still charges the card, so an organizer accepting a cheque for a submitted application approves, lets the charge fail (or has the applicant remove the card), then records the payment. Follow-up if it comes up.

### Explicitly out of scope

Migrating applications onto `Order` (option B); invoices / additional charges on PAID applications (spec 012 §7.3); partial offline payments; per-ticket / per-line refunds from the Transactions list (use the order page); Stripe balance / payout reconciliation beyond what the Connect payouts page shows; multi-currency; editing an adjustment in place (remove + add).

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 7.1 | Order refund routes are ORGANIZER today; application refunds are ADMIN | Add `requireAdmin` to the three order refund routes in phase 1 so FR-014 is one rule. The orders UI already hides the button for organizers, so no visible regression |
| 7.2 | Customers predicate: today `COMPLETED` only; a fully refunded buyer is not a customer | Widen to `COMPLETED / PARTIALLY_REFUNDED / REFUNDED` orders alongside paid applications; a refund does not un-make a customer, and `totalRefunded` shows it |
| 7.3 | `occurredAt` for applications | `paidAt ?? submittedAt ?? createdAt`: paid rows sort by when money moved, pending rows by when the applicant committed |
| 7.4 | Adjustments in fee math | Fold Σ adjustments into the tier line and require `tier.price + Σadj ≥ 0`. Keeps FeeService free of negative items and add-on `applicantPays` exact; an organizer who needs a deeper discount removes add-ons or waives |
| 7.5 | Offline payment amount | Must equal the current `applicantPays`; partial offline payments would need a balance ledger (invoices spec) |
| 7.6 | Tax report date basis | Orders keep `createdAt` (unchanged numbers); applications use `paidAt` (a `PAYMENT_DUE` application paid a month after approval is taxed when paid). Documented in the report header |
| 7.7 | `revenue.refunds` semantics | Report `applicationRefunds` only; ticket and add-on lines are already net of refunded lines because `quantitySold` is decremented on refund. `net = tickets + addOns + applications − applicationRefunds` |
| 7.8 | `ch_` search | Resolve through one `charges.retrieve` call; alternatively store `stripeChargeId` on both models from the webhooks — deferred until someone pastes a charge id |
| 7.9 | Waived applications in Transactions | List them (`PAID`, gross 0, `offline`) so the waiver is auditable; alternative is to hide them like FREE forms |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Raw SQL drifts from the Prisma schema (renamed column, new enum value) | One builder file, unit fixtures, contract tests seeded through Prisma so any drift fails CI; `@@map` is not used anywhere in the schema so column names equal field names |
| `ILIKE '%…%'` on five text columns across two tables at volume | Stripe-id searches short-circuit to indexed equality; perf test gate; `pg_trgm` GIN indexes as the documented next step |
| Refund from the list bypasses a per-type rule | Routes call the same service methods as the existing per-type routes; contract test asserts identical state after refunding via either path |
| Tier change on `PAYMENT_DUE` loses the slot if the new tier is full | New tier is held first with the conditional update; failure throws before the old tier is touched; test asserts both counters unchanged after 409 |
| Adjustment pushes fees negative or breaks Stripe line items | Floor at the tier line (7.4); `applicationAmounts` fixture with a negative tier delta; Stripe line items assert Σ lines = `applicantPays` |
| Offline-paid application reaches a Stripe path (`chargeOnApproval`, pay-now, refund) | Every Stripe path checks `paymentSource` first; `_markPaid` idempotency already refuses a second PAID; contract test with the Stripe mock asserting zero calls |
| `_markPaid` made public changes existing behaviour | Wrapper only; the private method and its callers are untouched |
| Customers list changes for existing organizations (7.2) | Release note in the wiki page; the count difference is fully refunded buyers only |
| Tax report rows change shape (`source`) and break the frontend CSV copy | Backend and frontend CSV are updated in the same PR; `tax.test.js` extended for `totals` equality between sources summed and the old single-source number on a no-application fixture |

---

## 9. Follow-ups noted, not planned

`stripeChargeId` on `PaymentTransaction` and `Application` from the webhooks (7.8); `pg_trgm` indexes for name / email search; invoices for post-payment additions (spec 012 §7.3) which would reuse `ApplicationAdjustment` as its line model; option B (applications as orders) if order-style editing keeps growing; a Transactions export scheduled to email (spec 013 messaging).
