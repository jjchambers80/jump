# Application payments — reporting and corrections

**Status**: Implemented — reporting (customers, analytics, dashboard, tax report include application money) and corrections (tier change, adjustments, waived balance, offline payment, manual refunds) 2026-09-18. Spec: `specs/018-transactions/` (phases 2–3). The phase 1 org-wide **Transactions** list was removed 2026-09-18 — see *History* below.
**Last Updated**: 2026-09-18

## Overview

Application money (spec 011) shows up wherever ticket money already did — Customers, event analytics, the dashboard and the collected-tax report — and organizers can correct an application's amount before it is charged, waive it, or record a payment taken outside Stripe. Application payments themselves are managed under **Events → Applications** (see [Applications](applications.md)); there is no separate money list.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/paidStatuses.js` | `PAID_ORDER_STATUSES` / `PAID_APPLICATION_STATUSES` — the one definition of "money collected" |
| `frontend/src/app/admin/orders/[orderId]/page.tsx` | Refund buttons shown only to ADMIN (order refund routes are ADMIN, plan decision 7.1) |
| `backend/src/services/CustomerService.js` | Phase 2: customer = contact with a paid order **or** a paid application; `transactionCount` / `totalRefunded` / `lastActivityAt` (+ `orderCount` / `lastOrderDate` aliases); `applications[]` on the detail; business-name search |
| `backend/src/services/EventService.js` (`_revenueBreakdown`) | Phase 2: `revenue { tickets, addOns, applications, applicationCount, applicationRefunds, net }` on event analytics |
| `backend/src/api/routes/admin.js` (`/dashboard/stats`) | Phase 2: `revenue { orders, applications, gross }` |
| `backend/src/services/TaxService.js` (`collectedReport`, `reportToCsv`) | Phase 2: taxable application forms join the report; rows carry `count` and `sources[]`; CSV has `Source` / `Count` columns |
| `frontend/src/app/admin/customers/*`, `events/[eventId]/analytics/page.tsx`, `dashboard/page.tsx`, `settings/tax/report/page.tsx` | Phase 2 surfaces: Transactions column (orders + applications) + Applications section, revenue-by-source block, Gross Revenue card, per-source tax sub-rows |
| `packages/db/prisma/migrations/20260920000000_transactions_corrections` | Phase 3: `ApplicationAdjustment`, `Application.paymentSource` + offline columns, `ApplicationRefund.manual`, enums `PaymentSource` / `OfflinePaymentMethod` / `AdjustmentKind`, five `ApplicationAction`s |
| `backend/src/services/ApplicationService.js` | Phase 3: `amountEditable`, `changeTier`, `addAdjustment` / `removeAdjustment`, `waiveBalance`, `recordOfflinePayment`, `_lockForEdit` / `_lockForSettlement` / `_confirmHeldSlot` / `_rewriteSnapshot` / `_afterAmountChange`; serializer fields `adjustments`, `amountEditable`, `canSettleOffline`, `paymentSource`, `offlinePayment`, `payment.manualRefund` |
| `backend/src/services/ApplicationFormService.js` (`applicationLines`) | Phase 3: fourth argument `adjustmentTotal` folds adjustments into the tier line |
| `backend/src/services/ApplicationPaymentService.js` (`refund`) | Phase 3: offline-paid rows get a recorded (`manual`) refund with no Stripe call and a `MANUAL_REFUND` decision |
| `backend/src/config/applications.js` | Phase 3 templates `TIER_CHANGED`, `WAIVED`, `OFFLINE_PAID` |
| `frontend/src/app/admin/events/[eventId]/applications/CorrectionDialogs.tsx` | `ChangeTierDialog`, `AdjustmentDialog`, `WaiveDialog`, `OfflinePaymentDialog` |
| `frontend/src/app/admin/events/[eventId]/applications/[applicationId]/page.tsx` | Tier row with Change, Adjustments block, Waive / Record offline payment buttons (ADMIN, PAYMENT_DUE), offline marker on Paid, manual-refund copy, timeline labels |

## Reporting (phase 2)

- **Customers** — a contact is a customer once money was collected from them: an order in `COMPLETED / PARTIALLY_REFUNDED / REFUNDED` or an application in `PAID / PARTIALLY_REFUNDED / REFUNDED` (plan decision 7.2: a fully refunded buyer stays a customer; `totalRefunded` shows it). `totalSpent` is gross (as before). New fields `transactionCount`, `ticketOrderCount`, `applicationCount`, `totalRefunded`, `lastActivityAt`; `orderCount` and `lastOrderDate` remain as aliases. Search also matches `ApplicantProfile.businessName`. `GET /admin/customers/:contactId` adds `applications[]` (form, tier, business name, payment status, `applicantPays`, `refunded`, `paidAt`, `detailUrl`). A contact whose only application is `PAYMENT_DUE` is not a customer.
- **Event analytics** — `revenue.tickets` = the existing `totals.revenue` (sold × listed, already net of refunded tickets), `addOns` = `AddOnService.sales` listed revenue, `applications` = Σ `applicantPays` over paid applications on the event, `applicationRefunds` = Σ SUCCEEDED `ApplicationRefund`, `net = tickets + addOns + applications − applicationRefunds` (plan decision 7.7). `totals.revenue` is unchanged.
- **Dashboard** — `revenue { orders, applications, gross }` over the org scope; the dashboard shows a Gross Revenue card with the split.
- **Tax report** — `collectedReport` adds paid applications on forms with `taxable = true`, counted by `paidAt` (orders keep `createdAt` — decision 7.6). Each region row keeps its totals and gains `count` (alias `orders`) and `sources: [{ source: 'order' | 'application', count, taxableSales, taxCollected, taxRefunded, taxNet }]` for sources with activity. The page shows source sub-rows only where both kinds of money were collected; the CSV has one line per region and source with `Source` and `Count` columns.

## Corrections (phase 3)

One rule: **money that has moved is only refunded, never re-priced.** `amountEditable(application)` (which `addOnsEditable` now wraps) allows tier / adjustment / add-on changes only in `SUBMITTED`, `WAITLISTED` or `APPROVED + PAYMENT_DUE`, and never once `PAID / PROCESSING / REFUNDED / PARTIALLY_REFUNDED` or settled offline.

| Action | Route | Role | What happens |
|---|---|---|---|
| Change tier | `POST /admin/events/:eventId/applications/:id/tier { tierId }` | ORGANIZER+ | Same form, active, different tier. Add-on lines the new tier does not offer are dropped and named in the note. A `PAYMENT_DUE` row's slot and add-on holds are released and re-taken on the new tier inside one transaction (full tier → 409, nothing changes). Snapshot recomputed with adjustments; pending pay-now session expired; `TIER_CHANGED` decision + email |
| Add adjustment | `POST …/adjustments { amount (signed), reason }` | ORGANIZER+ | `ApplicationAdjustment` row; Σ adjustments fold into the tier line for fee math (`applicationLines(tier, form, lines, total)`), so `tier.price + Σ ≥ 0` or 400 — deeper discounts remove add-ons or waive. Add-on shares move by at most the proportional-fee cent. `ADJUSTED` decision, no email |
| Remove adjustment | `DELETE …/adjustments/:adjustmentId` | ORGANIZER+ | Recompute; a `WAIVER` row cannot be removed (409) |
| Waive balance | `POST …/waive { reason }` | ADMIN | `APPROVED + PAYMENT_DUE` only. `WAIVER` adjustment of `−applicantPays`, every money column 0, `paymentStatus = NOT_REQUIRED`, `paymentSource = OFFLINE`, slot RESERVED → APPROVED with add-on holds sold, `WAIVED` decision + email |
| Record offline payment | `POST …/offline-payment { method, amount, reference?, paidAt? }` | ADMIN | `APPROVED + PAYMENT_DUE` only; `amount` must equal `applicantPays` (adjust first to change it); `method ∈ CHEQUE, CASH, BANK_TRANSFER, COMPED, OTHER`. `PAID`, `paymentSource = OFFLINE`, offline columns, `paidAt`, slot confirmed, `OFFLINE_PAID` decision + email. No Stripe object is created; a declined intent id from the approval attempt stays as history |
| Refund an offline row | existing `POST …/refund` | ADMIN | `ApplicationRefund { manual: true, status: SUCCEEDED, stripeRefundId: null }`, `MANUAL_REFUND` decision, status recomputed; the dialogs say the money is returned by hand |

A waived application stays `NOT_REQUIRED` + `paymentSource: OFFLINE` with a `WAIVER` adjustment, so the write-off is auditable on the application detail page. The applicant status page lists adjustments as "Includes …" under the tier line. Customers, analytics and the tax report count offline payments like Stripe ones.

Approving a `CARD_ON_FILE` application still charges the saved card; to accept a cheque for a submitted application the organizer approves, lets the charge fail or asks the applicant to remove the card, then records the payment — a "settle offline instead of charging" approval option is a follow-up.

## History

Phase 1 of spec 018 shipped an org-wide **Transactions** page (`/admin/transactions`, sidebar entry, `TransactionService` + a raw-SQL `UNION ALL` over orders and applications, CSV export, refunds from the list) in PR #65. It was removed the same day: a second money list beside Orders and the per-event Applications tab confused the navigation more than it helped. The removal dropped the routes, service, validators, page, e2e / contract / unit tests and the three indexes it added (`20260921000000_drop_transactions_indexes`). Two decisions from phase 1 stay:

- **Order refunds are ADMIN** (`POST /admin/orders/:orderId/refund`, `/tickets/:ticketId/refund`, `/orders/:orderId/add-ons/:orderAddOnId/refund`) to match application refunds and FR-014; the order detail page hides the buttons for organizers (plan decision 7.1).
- `PAID_ORDER_STATUSES` / `PAID_APPLICATION_STATUSES` (now `backend/src/services/paidStatuses.js`) remain the single definition of money collected.

## Testing

- `backend/tests/contract/transactionsReporting.test.js` — customers predicate + aggregates (application-only, mixed, pending excluded, business-name search), detail `applications[]`, analytics `revenue`, dashboard `revenue`, tax report sources / date basis / CSV.
- `frontend/e2e/transactions-reporting.spec.ts` — customer detail Applications section and combined stats, analytics revenue-by-source, dashboard Gross Revenue card; `admin-tax-settings.spec.ts` covers the source sub-rows and the new CSV columns.
- `backend/tests/contract/applicationCorrections.test.js` — tier change on SUBMITTED (recompute, dropped add-on, email, approval charges the new amount) and on PAYMENT_DUE (holds move, full tier 409 leaves counters unchanged, session expired); adjustments (floor, add-on shares, removal, locked after PAID); waive (zero snapshot, slot confirmed, WAIVER row, ORGANIZER 403); offline payment (state / amount / role guards, no Stripe calls, slot + add-on holds confirmed, manual refund, customers count it); role matrix. `tests/unit/applicationFormService.test.js` pins the adjustment fold.
- `frontend/e2e/applications-corrections.spec.ts` — change tier with the dropped-add-on warning, add / remove adjustment, ADMIN waive, ADMIN offline payment then a recorded refund.

## Related

- [Applications](applications.md), [Add-ons](add-ons.md), [Stripe integration](stripe-integration.md), [Tax settings](tax-settings.md) (phase 2 target), [RBAC](rbac.md)
