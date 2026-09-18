# Transactions

**Status**: Phases 1 (org-wide list, search, CSV, refunds) and 2 (customers, analytics, dashboard, tax report include application money) implemented 2026-09-18. Phase 3 (tier change, adjustments, waive, offline payment) planned. Spec: `specs/018-transactions/`.
**Last Updated**: 2026-09-18

## Overview

One admin list of **every money event in the organization** — ticket orders and application payments side by side — so support and finance questions ("who paid $27.31 on the 17th?", "which row is this `pi_…`?") are answered from one place. There is no new table: `TransactionService` projects `Order` + `PaymentTransaction` + `Refund` and `Application` + `ApplicationRefund` into one row shape with a `UNION ALL` that Postgres sorts and paginates. Refunds issued from the list call the same per-type services as the order and application pages, so Stripe behaviour (Connect reversal, webhook idempotency) is identical whichever page issued them.

Triggered by the 2026-09-17 production smoke test of paid applications, where an application charge could not be found by email or Stripe id anywhere in the admin area.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/transactionQuery.js` | Pure SQL builder: `buildListSql` / `buildCountSql` over both halves, status map, Stripe-id short-circuit, LIKE escaping, UTC date casts. Every value is a `$n` parameter |
| `backend/src/services/TransactionService.js` | `list`, `getOne`, `refunds`, `refund`, `exportCsv`, `resolveOwnership`; `ch_` search resolved through `stripe.charges.retrieve`; descriptions from two batched reads |
| `backend/src/api/validators/transactionValidators.js` | `validateTransactionQuery` (→ `req.transactionQuery`), `validateTransactionParams`, `validateTransactionRefundBody` |
| `backend/src/api/routes/admin.js` | `/admin/transactions*` routes, `transactionsOrgFor(req)`; `requireAdmin` added to the three order refund routes |
| `packages/db/prisma/migrations/20260919120000_transactions_indexes` | `Order(createdAt)`, `Application(organizationId, paidAt)`, `Application(organizationId, submittedAt)` |
| `frontend/src/lib/transactions.ts` | Types, status labels / colours, `isRefundable`, `transactionQueryString`, `shortReference` |
| `frontend/src/app/admin/transactions/page.tsx` | The list: URL-backed filters, search, expandable refund history, refund button, CSV export |
| `frontend/src/app/admin/transactions/RefundTransactionDialog.tsx` | Full order refund / partial application refund from the list |
| `frontend/src/app/admin/transactions/useTransactionsApi.ts` | API hook |
| `frontend/src/components/AdminSidebar.tsx` | **Transactions** entry above Orders |
| `frontend/src/app/admin/orders/page.tsx`, `orders/[orderId]/page.tsx` | Banner linking to Transactions; refund buttons shown only to ADMIN |
| `backend/src/services/CustomerService.js` | Phase 2: customer = contact with a paid order **or** a paid application; `transactionCount` / `totalRefunded` / `lastActivityAt` (+ `orderCount` / `lastOrderDate` aliases); `applications[]` on the detail; business-name search |
| `backend/src/services/EventService.js` (`_revenueBreakdown`) | Phase 2: `revenue { tickets, addOns, applications, applicationCount, applicationRefunds, net }` on event analytics |
| `backend/src/api/routes/admin.js` (`/dashboard/stats`) | Phase 2: `revenue { orders, applications, gross }` |
| `backend/src/services/TaxService.js` (`collectedReport`, `reportToCsv`) | Phase 2: taxable application forms join the report; rows carry `count` and `sources[]`; CSV has `Source` / `Count` columns |
| `frontend/src/app/admin/customers/*`, `events/[eventId]/analytics/page.tsx`, `dashboard/page.tsx`, `settings/tax/report/page.tsx` | Phase 2 surfaces: Transactions column + Applications section, revenue-by-source block, Gross Revenue card, per-source tax sub-rows |

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /admin/transactions` | ORGANIZER+ | `type`, `status`, `eventId`, `from`, `to`, `hasRefunds`, `search`, `sort` (`-date` default, `date`, `-gross`, `gross`), `page`, `pageSize` (alias `limit`, max 100) |
| `GET /admin/transactions/export.csv` | ORGANIZER+ | Same filters; one row per transaction plus one `kind = refund` row per SUCCEEDED refund; streamed in 500-row chunks |
| `GET /admin/transactions/:type/:id/refunds` | ORGANIZER+ | Normalised history `{ id, amount, reason, status, stripeRefundId, initiatedBy, manual, detail, createdAt }` |
| `POST /admin/transactions/:type/:id/refund` | ADMIN | `{ amount?, reason? }`. ORDER: full refund only via `RefundService.refundOrder` (a partial amount is 400 — use the order page for tickets / lines). APPLICATION: `ApplicationService.refund` with the optional partial amount. Returns `{ transaction, refunds }` |

`:type` is `ORDER` or `APPLICATION` (case-insensitive). Cross-organization ids are 404.

### Row shape

`type`, `id`, `reference` (`orderRef` or the application id), `occurredAt` (order `createdAt`; application `paidAt ?? submittedAt ?? createdAt`), `contact { id, name, email }`, `businessName`, `event { id, name, date }`, `organization` (SYSTEM_ADMIN only), `description` ("2 × General Admission, Parking ×1" / "Vendor Space — 10x10, Power ×1"), `subtotal`, `platformFee`, `processingFee`, `tax`, `gross`, `refunded`, `net`, `amountDue` + `dueAt` (PAYMENT_DUE only), `status`, `sourceStatus`, `paymentSource` (`stripe` until phase 3), `stripeAccountId`, `stripePaymentIntentId`, `stripeCheckoutSessionId`, `detailUrl`.

### Status vocabulary

| `status` | Orders | Applications (`paymentStatus`) |
|---|---|---|
| `PENDING` | `PENDING` | `AWAITING_CARD`, `CARD_ON_FILE`, `PROCESSING` (gross 0) |
| `PAID` | `COMPLETED` | `PAID` |
| `PAYMENT_DUE` | — | `PAYMENT_DUE` (gross 0, `amountDue` set) |
| `PARTIALLY_REFUNDED` / `REFUNDED` | same | same |
| `FAILED` | `FAILED` | — |

Default view hides `PENDING` / `FAILED` orders (name the status to see them); `DRAFT` and `NOT_REQUIRED` applications never appear (no money). Gross and the fee columns on an application are 0 until it is paid so pending rows never inflate totals.

### Search

Email, first / last / full name, `orderRef`, application id and `ApplicantProfile.businessName` by `ILIKE`. A term shaped like a Stripe id (`pi_`, `cs_`, `re_`, `pyr_`, `ch_`) compares the id columns by equality only: `PaymentTransaction.stripePaymentIntentId`, `Refund.stripeRefundId`, `Application.stripePaymentIntentId`, `Application.stripeCheckoutSessionId`, `ApplicationRefund.stripeRefundId`. Charge ids are not stored, so `ch_…` is resolved to its PaymentIntent with one `charges.retrieve` call; an unknown charge yields no rows.

## Reporting (phase 2)

- **Customers** — a contact is a customer once money was collected from them: an order in `COMPLETED / PARTIALLY_REFUNDED / REFUNDED` or an application in `PAID / PARTIALLY_REFUNDED / REFUNDED` (plan decision 7.2: a fully refunded buyer stays a customer; `totalRefunded` shows it). `totalSpent` is gross (as before). New fields `transactionCount`, `ticketOrderCount`, `applicationCount`, `totalRefunded`, `lastActivityAt`; `orderCount` and `lastOrderDate` remain as aliases. Search also matches `ApplicantProfile.businessName`. `GET /admin/customers/:contactId` adds `applications[]` (form, tier, business name, payment status, `applicantPays`, `refunded`, `paidAt`, `detailUrl`). A contact whose only application is `PAYMENT_DUE` is not a customer.
- **Event analytics** — `revenue.tickets` = the existing `totals.revenue` (sold × listed, already net of refunded tickets), `addOns` = `AddOnService.sales` listed revenue, `applications` = Σ `applicantPays` over paid applications on the event, `applicationRefunds` = Σ SUCCEEDED `ApplicationRefund`, `net = tickets + addOns + applications − applicationRefunds` (plan decision 7.7). `totals.revenue` is unchanged.
- **Dashboard** — `revenue { orders, applications, gross }` over the org scope; the dashboard shows a Gross Revenue card with the split.
- **Tax report** — `collectedReport` adds paid applications on forms with `taxable = true`, counted by `paidAt` (orders keep `createdAt` — decision 7.6). Each region row keeps its totals and gains `count` (alias `orders`) and `sources: [{ source: 'order' | 'application', count, taxableSales, taxCollected, taxRefunded, taxNet }]` for sources with activity. The page shows source sub-rows only where both kinds of money were collected; the CSV has one line per region and source with `Source` and `Count` columns.

## Scoping

Members are scoped to their active organization (orders through `Event → Venue.organizationId`, applications through `Application.organizationId`). SYSTEM_ADMIN is unscoped and gets an `organization` column, or narrows with the org switcher (`X-Jump-Org`) / `?organizationId=`.

## Decisions taken while building phase 1

- **Order refunds are now ADMIN** (`POST /admin/orders/:orderId/refund`, `/tickets/:ticketId/refund`, `/orders/:orderId/add-ons/:orderAddOnId/refund`) to match application refunds and FR-014; the order detail page hides the buttons for organizers (plan decision 7.1).
- Raw SQL compares enum columns as `::text` (raw parameters arrive as text) and date parameters as `($n::timestamptz AT TIME ZONE 'UTC')` because Prisma stores `DateTime` as UTC wall-clock `timestamp(3)` — a bare parameter would be read in the session time zone.
- A row fetched by id (`getOne`, used after a refund) is never subject to the default PENDING / FAILED hiding.
- The CSV pages with `OFFSET` in 500-row chunks inside one request; a keyset cursor is a follow-up if exports outgrow that.

## Testing

- `backend/tests/unit/transactionQuery.test.js` — SQL shape and parameters for every filter, injection and LIKE escaping, status map coverage, sort tiebreaks.
- `backend/tests/contract/transactions.test.js` — interleaved pagination, row shape per type, every search key incl. `ch_`, filters, 400s, org isolation and SYSTEM_ADMIN narrowing, 404 / 403, refund history, refund delegation for both types (Stripe mocked), CSV.
- `frontend/e2e/transactions.spec.ts` — search finds both rows, refund history expands, ADMIN refunds an application, ORGANIZER sees a disabled action, filters round-trip through the URL.
- `backend/tests/contract/transactionsReporting.test.js` — customers predicate + aggregates (application-only, mixed, pending excluded, business-name search), detail `applications[]`, analytics `revenue`, dashboard `revenue`, tax report sources / date basis / CSV.
- `frontend/e2e/transactions-reporting.spec.ts` — customer detail Applications section and combined stats, analytics revenue-by-source, dashboard Gross Revenue card; `admin-tax-settings.spec.ts` covers the source sub-rows and the new CSV columns.

## Related

- [Applications](applications.md), [Add-ons](add-ons.md), [Stripe integration](stripe-integration.md), [Tax settings](tax-settings.md) (phase 2 target), [RBAC](rbac.md)
