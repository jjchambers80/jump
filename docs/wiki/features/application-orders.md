# Application orders — one ledger under Orders

**Status**: Phase 1 implemented 2026-09-19 (ledger migration, services, reporting over one ledger). Phases 2 (Orders surface, order number everywhere, receipt email) and 3 (apply-form account, consent, `LegalAcceptance`) not built. Spec: `specs/024-application-orders/`.
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

## Testing

- `backend/tests/contract/applicationOrders.test.js` — order at submission (PAID) and none (FREE), every status transition incl. CANCELLED, payment rows on charge / decline / pay-now / offline, refunds through `/admin/orders/:id/refund` and the application route, admin order list + detail, customers / dashboard / analytics over the ledger.
- `backend/tests/contract/applicationOrdersBackfill.test.js` — replays every migration before the cutover on a scratch database, seeds every pre-024 money shape, applies the two 024 migrations and asserts orders, lines, payments, refunds, the ticket-side backfill and the dropped tables (~70 s: it runs 49 migration files).
- `backend/tests/contract/applicationOrdersReporting.test.js` (was `transactionsReporting`) — customers, analytics, dashboard, tax report fixtures written as orders.
- `backend/tests/unit/applicationOrders.test.js` — `orderStatusFor` table, line math, `applicationOrderData` sums, `moneyOf`.
- Existing suites (`applicationPayments`, `applicationCorrections`, `applicationsAddOns`, `applicationsPhase3`, `participants*`, `applications`) run unchanged in their assertions through `tests/helpers/applicationRow.js`.
- `frontend/e2e/application-orders-reporting.spec.ts` (was `transactions-reporting`). Note: `applications-payments.spec.ts` "payment due shows pay-now" / "abandoned checkout can be resumed" fail on `main` before this work (status-page mocks), unrelated.

## Follow-ups

- Phase 2: order-level `/admin/orders` with a Tickets toggle, order detail for application orders, order number on every application surface and template, CSV, `GET /me/orders` including application orders (today `getOrdersForContact` filters `kind: TICKET`), receipt email.
- Phase 3: apply-form account opt-in, marketing provenance, `LegalAcceptance` on apply and checkout.
- Plan decision 7.1: one `PaymentTransaction` per order; a declined attempt's intent id survives only until the next attempt overwrites it (the decision log keeps the history).

## Related

- [Applications](applications.md), [Add-ons](add-ons.md), [Application payments — reporting and corrections](application-payments-reporting.md) (spec 018 history), [Stripe integration](stripe-integration.md), [Tax settings](tax-settings.md), [Database architecture](database-architecture.md)
