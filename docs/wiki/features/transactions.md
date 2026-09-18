# Transactions

**Status**: Phase 1 implemented 2026-09-18 (org-wide list, search, CSV, refunds). Phases 2 (customers / analytics / tax report) and 3 (tier change, adjustments, waive, offline payment) planned. Spec: `specs/018-transactions/`.
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

## Related

- [Applications](applications.md), [Add-ons](add-ons.md), [Stripe integration](stripe-integration.md), [Tax settings](tax-settings.md) (phase 2 target), [RBAC](rbac.md)
