# Application orders — one ledger under Orders

**Status**: Phase 1 implemented 2026-09-19 (ledger migration, services, reporting over one ledger). Phase 2 implemented 2026-09-19 (order-level Orders page with a Tickets toggle, CSV export, order detail for application orders with amount-based refunds, order number on every application surface and template, buyer order list, receipt email). Phase 3 (apply-form account, consent, `LegalAcceptance`) not built. Spec: `specs/024-application-orders/`.
**Last Updated**: 2026-09-19

## Overview

A PAID-form application is an **Order** from the moment it is submitted. The order (`kind: APPLICATION`, `applicationId`, a `JMP-XXXXXX` reference) carries the amount snapshot as real lines, the Stripe payment (`PaymentTransaction`) and every refund (`Refund`); the `Application` keeps what is about review — form, answers, profile, status, capacity slot, card on file, decision log, tags, check-in. FREE forms create no order. The separate application ledger of specs 011/012/018 (`Application` money columns, `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationAddOn`) was migrated into the order tables and dropped, so Customers, event analytics, the dashboard and the tax report each run one query family over `Order`.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `Order.kind / applicationId / feeMode / orgReceives / paidAt / dueAt`, `OrderStatus.CANCELLED`, `OrderItem.kind` (`TICKET_TIER` / `APPLICATION_TIER` / `ADJUSTMENT` / `WAIVER`) + `applicationTierId / description / tax / createdById`, `PaymentTransaction.source / offlineMethod / offlineReference / recordedById`, `Refund.manual`, `Application.order` |
| `packages/db/prisma/migrations/20260930000000_application_orders_enums`, `…0001_application_orders` | Enum values first (Postgres cannot use a new enum value in the transaction that adds it), then add columns → SQL backfill (one order per PAID-form application: lines, payment, refunds; ticket orders get `orgReceives` / `paidAt`) → drop the old tables and columns |
| `backend/src/scripts/backfill-application-orders.js` (`npm run db:backfill:024`) | For `db push` databases: applies the same two migration files through `prisma db execute`, idempotent; run **before** `db push` |
| `backend/src/services/applicationOrderStatus.js` | `orderStatusFor(application)` — the one mapping from `status` + `paymentStatus` to `Order.status` |
| `backend/src/services/orderLines.js`, `OrderLineService.js` | Pure line math (`buyerLineTotal`, `adjustmentTotal`, `adjustmentItems`, `tierItem`) and `applicationOrderData` / `rewriteApplicationOrder` / `describe`; `ORDER_INCLUDE` |
| `backend/src/services/applicationMoney.js` | `moneyOf(application)` — the money view every serializer, template, digest and CSV reads from `application.order` |
| `backend/src/services/OrderService.js` | `createApplicationOrder(tx, …)`, `_uniqueOrderRef`, `kind` / `orgReceives` / `paidAt` on ticket orders, detail carries `kind`, item kinds, payment source and an `application` panel |
| `backend/src/services/ApplicationService.js` | `submit` creates the order; `_transition` writes both statuses; corrections rewrite the order (`_orderData` / `_rewriteOrder`); `refund` delegates to `RefundService`; serializers add `orderId` / `orderRef` |
| `backend/src/services/ApplicationPaymentService.js` | Stripe line items from order lines, `metadata.orderId / orderRef`, `_upsertPayment` on sessions / charges / declines / settlements, `_markPaid` sets `paidAt`, `_markPaymentDue` sets `dueAt`, sweep reads `order.dueAt`; refund code removed |
| `backend/src/services/RefundService.js` | `refundOrder` branches on `kind` (`_refundApplicationOrder`: amount-based, manual for offline); `handleExternalRefund` branches on `kind`; `_recomputeApplicationOrderStatus` |
| `backend/src/services/AddOnService.js` | `serializeOrderLine(line, feeMode)`; sales / purchasers read application lines from `OrderAddOn` where `order.kind = APPLICATION` |
| `backend/src/services/CustomerService.js`, `EventService.js`, `TaxService.js`, `api/routes/admin.js` (dashboard) | One ledger: `PAID_ORDER_STATUSES` over both kinds; tax report by `paidAt` (fallback `createdAt`), application orders only on taxable forms |
| `backend/src/api/routes/webhooks.js` | `charge.refunded` always goes to `RefundService`; application dispatch stays on `metadata.applicationId` for card / charge events |
| `backend/src/api/routes/admin.js` | `POST /admin/orders/:orderId/refund { amount? }` — partial amount honoured on application orders only |
| `backend/tests/helpers/applicationRow.js` | `appRow` (application flattened with its order's money), `attachOrder` (fixture order for a raw application), `setDueAt`, `cleanupApplicationOrders` |
| `backend/src/api/validators/orderValidators.js` (`validateOrderListQuery`) | Phase 2: `GET /admin/orders` / `export.csv` query — page, limit (≤ 100), kind, status list, eventId, from / to (ISO or date-only), search, sort, dir |
| `backend/src/services/OrderService.js` (`getOrdersByOrganization`, `_orgOrdersWhere`, `_formatOrderRow`, `exportOrdersCsv`, `listOrders`) | Phase 2: one list for both kinds; `statusDetail` (the application's fine state while PENDING, or "Waived"), `description`, `businessName`, `refunded` / `net`, `paymentSource`; CSV streamed in pages of 500 with a `refund` line per succeeded refund; buyer `GET /buyer/me/orders` returns the same rows (FAILED / CANCELLED hidden) |
| `backend/src/services/EmailService.js` (`sendApplicationReceipt`), `ApplicationPaymentService.sendReceipt` | Phase 2: Jump's receipt once per completion (Stripe or offline), after `_markPaid` / `recordOfflinePayment`; buyer line totals, order number, card brand + last 4 when Stripe answers, offline method otherwise; none for waived or FREE |
| `backend/src/config/applications.js` | Phase 2: `{{order.ref}}` merge field; RECEIVED / APPROVED / PAYMENT_DUE / OFFLINE_PAID defaults mention the order number |
| `frontend/src/app/admin/orders/page.tsx`, `OrdersListView.tsx`, `TicketRowsView.tsx` | Phase 2: the shell with the **Orders / Tickets** toggle (remembered in `localStorage`), the order-level list (search, kind / status / event / date filters, CSV, kind chip, status chip with the due date), the pre-024 ticket-row view moved as-is |
| `frontend/src/app/admin/orders/[orderId]/page.tsx` | Phase 2: kind chip, Application panel (business, form · tier, review status, payment, "Open application"), tier / adjustment / waiver lines, "You receive", payment source and Stripe id, amount-based refund dialog for application orders (manual wording for offline), refund history marks recorded refunds |
| `frontend/src/lib/orders.ts` | Phase 2: `OrderRow`, `OrderListQuery`, status / kind labels, `orderStatusLabel` |
| `SubmissionsTable.tsx`, application detail page, applicant status page, buyer `ApplicationsSection`, buyer account orders list, customer detail | Phase 2: order number (linked to `/admin/orders/:id` on staff pages); application orders in the buyer's order list link to the Applications section; customer orders carry an Application chip |

## Data model

```
Order (kind APPLICATION, applicationId, orderRef, totals, orgReceives, feeMode, status, paidAt, dueAt)
 ├─ OrderItem  APPLICATION_TIER (applicationTierId, description = tier name, unitPrice = tier price, fee/tax shares)
 ├─ OrderItem  ADJUSTMENT | WAIVER (unitPrice signed, description = reason, createdById)
 ├─ OrderAddOn (addOnId, quantity, unitPrice, fee/tax shares)
 ├─ PaymentTransaction (one per order; STRIPE intent or OFFLINE method / reference / recordedById)
 └─ Refund[]   (manual = recorded without Stripe)
Application (status, paymentStatus, capacitySlot, stripeCheckoutSessionId, stripePaymentMethodId, chargeAttempts, overdue, …) ── order
```

`Order.status` ← `orderStatusFor`: `AWAITING_CARD / CARD_ON_FILE / PROCESSING / PAYMENT_DUE → PENDING`; `PAID → COMPLETED`; `REFUNDED / PARTIALLY_REFUNDED` as-is; `NOT_REQUIRED` on a PAID form (waived) → `COMPLETED` at total 0 with a `WAIVER` line and no payment row; `REJECTED / WITHDRAWN` before money moved → `CANCELLED`. A replaced DRAFT is withdrawn (`withdrawReason: 'replaced'`), never deleted.

`buyerLineTotal(line, feeMode)`: PASS = listed + fee shares + tax; ABSORB = listed + tax (no tax when the organization prices tax-inclusive). The tier line of a Stripe charge is `Order.totalAmount − Σ add-on buyer totals`, so adjustments ride on the tier line as before.

## Payment flow (what changed)

| Moment | Writes |
|---|---|
| Submission (PAID form) | `Order PENDING` + tier line (+ add-on lines); Stripe session metadata gains `orderId`, `orderRef` |
| Payment-mode session (charge at submission, pay-now) | `PaymentTransaction PENDING` (routing recorded) |
| Approval charge succeeds | `PaymentTransaction SUCCEEDED` + intent id; `Order COMPLETED`, `paidAt` |
| Approval charge declined | `PaymentTransaction FAILED` + failed intent id + `failureReason`; `Order.dueAt` = due date; `Order` stays `PENDING` |
| Pay-now paid (webhook) | payment row overwritten with the settled intent; `Order COMPLETED`, `dueAt` cleared |
| Offline payment | `PaymentTransaction { source OFFLINE, offlineMethod, offlineReference, recordedById }`, no Stripe id; `Order COMPLETED` |
| Waive | `WAIVER` item, totals 0, `Order COMPLETED`; no payment row |
| Refund (either route) | `Refund` row (`manual` when offline); `Order.status` and `paymentStatus` move together |
| Reject / withdraw before a charge | `Order CANCELLED` |
| Overdue sweep | reads `order.dueAt`; WITHDRAW policy cancels the order |

## Reporting

Customers: a contact with a paid order of either kind; `orders[]` on the detail carries `kind` / `applicationId`, `applications[]` is kept in its spec 018 shape (now with `orderRef`). Analytics `revenue.applications` = Σ `totalAmount` of paid APPLICATION orders, `applicationRefunds` = Σ their succeeded refunds. Dashboard `revenue { orders, applications, gross }` splits on `kind`. Tax report: one loop over paid orders in the period (`paidAt`, `createdAt` for pre-024 rows), `source` = `order` / `application`; application orders count only when the form is taxable. Add-on sales / purchasers CSV: application lines are `OrderAddOn` rows whose order is an APPLICATION order.

## Orders page (phase 2)

`/admin/orders` is the one money surface. **Orders** (default) lists one row per order, newest first: order number → detail, customer (business name on application orders), kind chip, event, description ("2 × General + 1 add-on" / "10x10 + Power ×1 (adjusted)"), total with the refunded amount beneath, status chip ("Paid", "Payment due · Sep 26", "Card on file", "Waived"…), date. Search matches order number, name, email, business name, or — when the term starts with `pi_`, `re_`, `pyr_` or `cs_` — a Stripe id by equality. Filters: kind, status (the default hides FAILED and CANCELLED; picking one shows it), event, from / to. **Export CSV** honours the filters and adds fee / tax columns, Stripe ids and a `refund` line per succeeded refund; SYSTEM_ADMIN without an org gets an `organization` column. **Tickets** is the ticket-level view the page had before (purchaser / attendee / barcode / resend / check-in), unchanged; the choice is remembered per browser.

The order detail renders an application order with its lines, "You receive", the payment (Stripe id or offline method + reference), the refund history and an **Application** panel linking to the review page. ADMIN refunds by amount (partial or the remainder) through `POST /admin/orders/:orderId/refund { amount?, reason? }`; on an offline-paid order the dialog records the refund without a Stripe call. Ticket orders keep per-ticket / per-line / full refunds.

## Receipt email (phase 2)

`ApplicationPaymentService.sendReceipt(applicationId)` runs after the PAID transition (`_markPaid`, so approval charge, pay-now and charge-at-submission) and after an offline payment. It sends `EmailService.sendApplicationReceipt`: subject `Receipt for {event} ({orderRef})`, the business, form and tier, buyer line totals (tier line carries adjustments, "(adjusted)"), total paid, the payment method (card brand + last 4 from `paymentIntents.retrieve(…, { expand: ['payment_method'] })` when available, else "Card"; offline method + reference otherwise), a link to the status page and — when the contact has an account — to the account page; reply-to is the organization's email. Waived balances and FREE forms send none. The organizer's own templated emails (APPROVED, OFFLINE_PAID) still go out; they carry `{{order.ref}}`.

## Testing

- `backend/tests/contract/applicationOrders.test.js` — order at submission (PAID) and none (FREE), every status transition incl. CANCELLED, payment rows on charge / decline / pay-now / offline, refunds through `/admin/orders/:id/refund` and the application route, admin order list + detail, customers / dashboard / analytics over the ledger.
- `backend/tests/contract/applicationOrdersBackfill.test.js` — replays every migration before the cutover on a scratch database, seeds every pre-024 money shape, applies the two 024 migrations and asserts orders, lines, payments, refunds, the ticket-side backfill and the dropped tables (~70 s: it runs 49 migration files).
- `backend/tests/contract/applicationOrdersReporting.test.js` (was `transactionsReporting`) — customers, analytics, dashboard, tax report fixtures written as orders.
- `backend/tests/unit/applicationOrders.test.js` — `orderStatusFor` table, line math, `applicationOrderData` sums, `moneyOf`.
- `backend/tests/contract/ordersList.test.js` (phase 2) — both kinds newest first with descriptions and `statusDetail`, every filter and 400s, every search key incl. Stripe ids by equality, sort + paging, org scope / ORGANIZER read / SYSTEM_ADMIN organization column and `X-Jump-Org`, CSV rows + refund lines + headers, buyer order list.
- Receipt: `applicationOrders.test.js` (once per completion, none for waived / FREE, lines and total in the text), `applicationPayments.test.js` and `applicationCorrections.test.js` (receipt precedes the organizer's template email; cheque method).
- `frontend/e2e/admin-orders.spec.ts` (phase 2) — list rows and chips, kind filter, search, Tickets toggle remembered across reloads, application order detail with the Application panel, lines and payment, refund by amount (ADMIN) and its absence for ORGANIZER.
- Existing suites (`applicationPayments`, `applicationCorrections`, `applicationsAddOns`, `applicationsPhase3`, `participants*`, `applications`) run unchanged in their assertions through `tests/helpers/applicationRow.js`.
- `frontend/e2e/application-orders-reporting.spec.ts` (was `transactions-reporting`). Note: `applications-payments.spec.ts` "payment due shows pay-now" / "abandoned checkout can be resumed" fail on `main` before this work (status-page mocks), unrelated.

## Follow-ups

- Phase 3: apply-form account opt-in, marketing provenance, `LegalAcceptance` on apply and checkout.
- The buyer's order list links an application order to the Applications section of the account page (anchor), not to a dedicated order page — the status page stays the applicant's detail view.
- Plan decision 7.1: one `PaymentTransaction` per order; a declined attempt's intent id survives only until the next attempt overwrites it (the decision log keeps the history).

## Related

- [Applications](applications.md), [Add-ons](add-ons.md), [Application payments — reporting and corrections](application-payments-reporting.md) (spec 018 history), [Stripe integration](stripe-integration.md), [Tax settings](tax-settings.md), [Database architecture](database-architecture.md)
