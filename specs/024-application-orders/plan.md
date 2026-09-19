# Implementation Plan: Application orders (spec 024)

**Status**: Planned 2026-09-19; all three phases merged to `main` and deployed to prod 2026-09-19 (PRs #92, #93, #95; prod backfill verified in #92's comments). **Phase 1 built 2026-09-19** on `feat/024-application-orders-phase-1` (PR #92: ledger migration pair, services, reporting collapse, backfill script + replay test). **Phase 2 built 2026-09-19** on `feat/024-application-orders-phase-2` (stacked on phase 1: order-level Orders page + Tickets toggle, CSV, order detail for application orders, order number everywhere, buyer order list, receipt email). **Phase 3 built 2026-09-19** on `feat/024-application-orders-phase-3` (stacked on phase 2: `LegalAcceptance` + provenance + opt-in columns, `config/legal.js`, `LegalAcceptanceService`, `ContactOptInService`, `GET /legal/versions`, apply-form checkboxes, checkout acceptances). Deviation from §2.10: checkout `acceptances` are recorded when sent and only *required* once `LEGAL_ACCEPTANCE_REQUIRED=true` (flipped with the legal pages) — a stale version is always refused; the apply form always requires them.
**Spec**: [spec.md](./spec.md). Depends on spec 011 (all phases on `main`), spec 012 (all phases), spec 018 phases 2–3 (on `main`; phase 1 removed), spec 007 (checkout opt-ins, buyer accounts). Builds the `LegalAcceptance` model from spec 023 §8.1 (spec 023 itself stays proposed).
**Branches**: plan on `plan/024-application-orders`; phases on `feat/024-application-orders-phase-1` → `-phase-2` → `-phase-3`, each merged to `main` alone (spec 012 lesson: never merge a phase branch that contains an unmerged earlier phase).
**Research**: session 2026-09-19 — read `schema.prisma` (`Order`, `OrderItem`, `OrderAddOn`, `PaymentTransaction`, `Refund`, `Application*`), `OrderService.createOrder`, `PaymentService.handleCheckoutCompleted / _applyOptIns`, `ApplicationService.submit / _rewriteSnapshot / _serializeAdmin`, `ApplicationPaymentService` (sessions, `chargeOnApproval`, `_markPaid`, `refund`), `RefundService`, `CustomerService`, spec 018 plan §2, spec 023 §6–8, `frontend/src/app/admin/orders/page.tsx` (ticket rows), the apply and checkout pages.

---

## 0. Why option B now

Spec 018 §Assumptions left "migrate applications onto `Order`" as a possible later refactor if order-style editing grew. It grew immediately: phase 3 added tier change, adjustments, waive, offline payment and manual refunds — all reimplementations of order concepts on `Application`. The read-only union (phase 1) was removed because it was a second list. The remaining honest fix is the data model: one `Order` per paid application, so **Orders** is the only money surface without any union.

The application's *review* lifecycle is untouched. What moves is exactly the set of columns and tables that duplicate the order ledger.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Order creation with atomic reservation, `orderRef` generator, fee breakdown, Stripe session, `PaymentTransaction` row, rollback on Stripe failure | `OrderService.createOrder`, `_generateOrderRef` | `_generateOrderRef` + a `_uniqueOrderRef(tx)` helper extracted; `createApplicationOrder(tx, …)` added beside `createOrder` |
| Opt-ins recorded on the order and applied after payment; welcome link in the confirmation email | `Order.optInAccount / optInMarketing`, `PaymentService._applyOptIns`, `_welcomeLinkForOrder`, `BuyerAuthService.issueToken` | Same pattern on `Application` (phase 3): `_applyOptIns` generalised to `ContactOptInService.apply(contactId, { account, marketing, source })` used by both |
| Amount snapshot from lines through `FeeService` | `ApplicationFormService.applicationLines / applicationAmounts` | Unchanged math; output written to order lines instead of application columns |
| Pre-payment line edit pattern (lock, editability, capacity re-hold, snapshot rewrite, decision row, session expiry, email) | `ApplicationService.updateAddOns / changeTier / addAdjustment / removeAdjustment / waiveBalance / recordOfflinePayment`, `_rewriteSnapshot`, `_afterAmountChange` | Same functions; `_rewriteSnapshot` becomes `OrderLineService.rewriteApplicationOrder(tx, order, …)` |
| Off-session charge, Checkout sessions (setup / payment), webhook handlers, mark-paid / payment-due / card-on-file transitions, overdue sweep | `ApplicationPaymentService` | Same functions; they read the amount from `order` and write `PaymentTransaction` + `Order.status` alongside `paymentStatus` |
| Order refunds (full, per ticket, per add-on line), external refund webhook, refund history | `RefundService` | Gains the `kind = APPLICATION` branch (amount-based, no tickets, manual for offline); `handleExternalRefund` branches on kind; application refund code in `ApplicationPaymentService.refund` is deleted |
| Stripe refund helper (Connect-aware) | `services/stripeRefund.js` `createStripeRefund` | Unchanged, now the only refund path |
| Org-wide order list with search / filters / pagination (backend, unused by the UI) | `OrderService.getOrdersByOrganization`, `GET /admin/orders` | Extended with `kind`, business name, Stripe-id search, date range, multi-status; becomes the Orders page's data source |
| Ticket-row list | `GET /admin/tickets`, `frontend/src/app/admin/orders/page.tsx` | Page body moved verbatim into `TicketRowsView.tsx`; shown under the **Tickets** toggle |
| Order detail page (items, add-ons, tickets, payment, refunds, resend) | `frontend/src/app/admin/orders/[orderId]/page.tsx`, `OrderService._formatOrderDetail` | Gains the application branch (no tickets; Application panel; amount-based refund dialog) |
| Application detail payment panel, correction dialogs, refund dialog | `admin/events/[eventId]/applications/[applicationId]/page.tsx`, `CorrectionDialogs.tsx`, `RefundDialog.tsx` | Keep working through `_serializeAdmin`, whose `amounts` / `payment` / `refunds` / `adjustments` are now derived from `a.order` — the response shape is preserved so the UI change in phase 1 is nil |
| One definition of "money collected" | `services/paidStatuses.js` | `PAID_ORDER_STATUSES` stays; `PAID_APPLICATION_STATUSES` deleted in phase 1 |
| Customers / analytics / dashboard / tax with application loops | `CustomerService`, `EventService.getEventAnalytics`, `admin.js` dashboard stats, `TaxService.collectedReport` | Loops over `Application` removed; `kind` split on the order query keeps the response shapes |
| Consent design | spec 023 §8.1 `LegalAcceptance`, §6 LR-05 capture points | Model and capture built here (phase 3); pages / versions policy stay in 023 |
| Sweep timers | `server.js` (domain, application, onboarding sweeps) | Overdue sweep reads `Order.dueAt` |

---

## 2. Design

### 2.1 Schema (one migration, phase 1)

```prisma
enum OrderKind { TICKET APPLICATION }
enum OrderStatus { PENDING COMPLETED FAILED CANCELLED REFUNDED PARTIALLY_REFUNDED }
enum OrderItemKind { TICKET_TIER APPLICATION_TIER ADJUSTMENT WAIVER }

model Order {
  // existing …
  kind          OrderKind   @default(TICKET)
  applicationId String?     @unique
  feeMode       FeeMode     @default(PASS)
  orgReceives   Decimal     @default(0) @db.Decimal(10, 2)
  paidAt        DateTime?
  dueAt         DateTime?                 // application PAYMENT_DUE clock
  application   Application? @relation(fields: [applicationId], references: [id])
  @@index([kind, status])
  @@index([createdAt])
}

model OrderItem {
  kind              OrderItemKind @default(TICKET_TIER)
  priceTierId       String?                       // was required
  applicationTierId String?
  description       String?                       // tier name snapshot / adjustment reason
  tax               Decimal @default(0) @db.Decimal(10, 2)
  createdById       String?                       // adjustment author
  applicationTier   ApplicationTier? @relation(fields: [applicationTierId], references: [id])
  // @@unique([orderId, priceTierId]) kept — NULLs do not collide; one APPLICATION_TIER line per order enforced in code
  @@index([applicationTierId])
}

model PaymentTransaction {
  source          PaymentSource         @default(STRIPE)
  offlineMethod   OfflinePaymentMethod?
  offlineReference String?
  recordedById    String?
}

model Refund {
  manual Boolean @default(false)
}

model Application {
  // removed: subtotal platformFee processingFee tax applicantPays orgReceives feeMode currency
  //          stripePaymentIntentId stripeAccountId applicationFee paidAt paymentDueAt
  //          paymentSource offlinePaymentMethod offlinePaymentReference offlinePaymentRecordedById
  //          refunds addOns adjustments
  order           Order?
  optInAccount    Boolean   @default(false)
  optInMarketing  Boolean   @default(false)
  optInsAppliedAt DateTime?
  // kept: status paymentStatus capacitySlot stripeCheckoutSessionId stripePaymentMethodId chargeAttempts overdue …
  @@index([paymentStatus])           // replaces @@index([paymentStatus, paymentDueAt])
}

model ApplicationTier { orderItems OrderItem[] }
model Contact {
  emailSubscribedAt     DateTime?
  emailSubscribedSource EmailSubscribedSource?
  emailUnsubscribedAt   DateTime?
}
enum EmailSubscribedSource { CHECKOUT APPLY ADMIN IMPORT }

model LegalAcceptance { … exactly spec 023 §8.1 … }   // phase 3 migration
enum LegalSubject { USER CONTACT ANONYMOUS_EMAIL }
enum LegalDocument { TERMS PRIVACY ORGANIZER_TERMS CARD_AUTHORIZATION SUBSCRIPTION_TERMS CONNECT_TERMS MARKETING }
enum LegalSource { CHECKOUT APPLY SIGNUP SUBSCRIBE CONNECT ACCOUNT ADMIN_INTERSTITIAL }
```

Dropped after backfill (same migration, after the copy statements): `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationAddOn`, `AdjustmentKind` is dropped (`OrderItemKind` carries ADJUSTMENT / WAIVER). `PaymentSource`, `OfflinePaymentMethod` stay (now on `PaymentTransaction`). `ApplicationAction` values are unchanged (decision log keeps `ADJUSTED`, `WAIVED`, `OFFLINE_PAID`, `MANUAL_REFUND`).

`Refund.ticketId` / `orderAddOnId` stay optional; an application refund row has neither.

### 2.2 Backfill (`packages/db/prisma/migrations/<ts>_application_orders/migration.sql`)

Order of statements inside the one migration:

1. `ALTER` adds (all new columns nullable or defaulted) — nothing breaks for existing rows.
2. `CREATE FUNCTION jump_order_ref()` (plpgsql, charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 6 chars, `JMP-` prefix) — same alphabet as `_generateOrderRef`.
3. `INSERT INTO "Order"` — one row per `Application` whose form is `PAID`, with a `DO` loop that retries on `orderRef` collision:
   - `kind = 'APPLICATION'`, `applicationId`, `eventId`, `contactId`, `quantity = 1`, `currency`
   - money: `totalAmount = applicantPays`, `subtotalAmount = subtotal`, `platformFeeAmount`, `processingFeeAmount`, `taxAmount = tax`, `feeMode`, `orgReceives`
   - `status` from `paymentStatus` (§2.3 mapping) with the review-status override (`REJECTED` / `WITHDRAWN` while unpaid → `CANCELLED`)
   - `paidAt`, `dueAt = paymentDueAt`, `createdAt = Application.createdAt`
4. `INSERT INTO "OrderItem"` — `APPLICATION_TIER` line per order (`unitPrice = tier.price`, `quantity 1`, `description = tier.name`, per-line fees and tax recomputed as `subtotal-share`: for a single tier line they are `Order.platformFeeAmount − Σ addOn.platformFee` etc.; exact because add-on lines carry their own); `ADJUSTMENT` / `WAIVER` lines from `ApplicationAdjustment` (`unitPrice = amount`, `description = reason`, `createdById`, `createdAt`).
5. `INSERT INTO "OrderAddOn"` from `ApplicationAddOn` — `unitPrice`, `quantity`; per-line `platformFee / processingFee / tax` recomputed by the same allocation `FeeService` uses (proportional to line subtotal — see §2.4; done in SQL as `round(orderFee × lineSubtotal / orderSubtotal, 2)` with the remainder on the tier line so totals sum exactly).
6. `INSERT INTO "PaymentTransaction"` where `stripePaymentIntentId IS NOT NULL` (status `SUCCEEDED` when `paymentStatus ∈ PAID/REFUNDED/PARTIALLY_REFUNDED`, `FAILED` when `PAYMENT_DUE` with an intent id, else `PENDING`; `stripeAccountId`, `applicationFee`) or `paymentSource = 'OFFLINE' AND paymentStatus = 'PAID'` (`source OFFLINE`, method, reference, `recordedById`, `stripePaymentIntentId NULL`).
7. `INSERT INTO "Refund"` from `ApplicationRefund` (`orderId` via `applicationId`, `manual`, `stripeRefundId`, `initiatedBy`, `status`, `createdAt`).
8. Ticket orders: `orgReceives = subtotalAmount`, `paidAt = COALESCE(PaymentTransaction.createdAt, Order.createdAt)` where `status ∈ PAID_ORDER_STATUSES`, `OrderItem.kind = 'TICKET_TIER'`.
9. `DROP TABLE` ×3, `ALTER TABLE "Application" DROP COLUMN` ×15, drop the function.

`backend/src/scripts/backfill-application-orders.js` (`npm run db:backfill:024`) serves `db push` environments (dev DB syncs with `db push` — memory). As built it does **not** reimplement the backfill in Prisma: a `db push` database has neither the new columns nor a migration history, so the script applies the same two migration files through `prisma db execute` (guarded: it does nothing once `Order.kind` exists) and must run *before* `db push`, which then finds nothing left to change. One implementation of the backfill, not two. Contract test `applicationOrdersBackfill.test.js` replays every migration before the cutover on a scratch database, seeds every pre-024 money shape through raw SQL, applies the two 024 files and asserts the orders, lines, payments, refunds and the dropped tables.

Built as two migrations, not one: Postgres refuses to use an enum value in the transaction that adds it (`ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED'` then the backfill writing `'CANCELLED'`), so `20260930000000_application_orders_enums` ships the enum values and `20260930000001_application_orders` the rest.

### 2.3 Status mapping — one function

```js
// services/applicationOrderStatus.js
export function orderStatusFor(application) {
  if (['REJECTED', 'WITHDRAWN'].includes(application.status) && !MONEY_MOVED.has(application.paymentStatus)) return 'CANCELLED';
  return { AWAITING_CARD: 'PENDING', CARD_ON_FILE: 'PENDING', PROCESSING: 'PENDING', PAYMENT_DUE: 'PENDING',
           PAID: 'COMPLETED', REFUNDED: 'REFUNDED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
           NOT_REQUIRED: 'COMPLETED' /* waived: total 0 */ }[application.paymentStatus];
}
```

`ApplicationService` / `ApplicationPaymentService` never write `Order.status` directly: every `tx.application.update` that touches `status` or `paymentStatus` goes through `_transition(tx, applicationId, data)` which updates the application, then `tx.order.updateMany({ where: { applicationId }, data: { status: orderStatusFor(next), paidAt?, dueAt? } })`. There are eleven such call sites today (`submit`, `decide`, `withdrawByApplicant`, `sweepOverdue`, `_markPaid`, `_markPaymentDue`, `_markCardOnFile`, `chargeOnApproval` failure branch, `waiveBalance`, `recordOfflinePayment`, `_recomputeRefundStatus`); the contract test enumerates every transition.

DRAFT replacement: `submit` no longer deletes the previous DRAFT; it runs `_transition` to `WITHDRAWN` (`withdrawnBy: SYSTEM`, `withdrawReason: 'replaced'`) so the old order becomes `CANCELLED`. `ACTIVE_STATUSES` already excludes `WITHDRAWN`, so the duplicate check is unaffected.

### 2.4 Lines and totals — `OrderLineService`

New `backend/src/services/OrderLineService.js`:

- `applicationOrderData(tier, form, addOnLines, adjustments, event, organization)` → `{ totals, items, addOns }` using `applicationLines` + `applicationAmounts` (unchanged) and `FeeService.computeOrderFees` per-line breakdown. The tier line is `{ kind: APPLICATION_TIER, applicationTierId, unitPrice: tier.price, quantity: 1, description: tier.name, platformFee, processingFee, tax }`; adjustments are `{ kind: ADJUSTMENT | WAIVER, unitPrice: signed amount, quantity: 1, description: reason, createdById }`; add-ons are `OrderAddOn` rows with per-line fees / tax. The spec 018 rule stays: for the fee math the adjustment total folds into the tier line (`tier.price + Σadjustments ≥ 0` or 400).
- `rewriteApplicationOrder(tx, orderId, data)` — delete lines, recreate, update totals; replaces `_rewriteSnapshot`. Called by `updateAddOns`, `changeTier`, `addAdjustment`, `removeAdjustment`, `waiveBalance`.
- `buyerLineTotal(line, feeMode)` — `unitPrice × quantity` (+ fees + tax under `PASS`). Used by `AddOnService.serializeOrderLine`, Stripe line items, the order detail and the status page.
- `describe(order)` — "2 × General + 1 add-on" / "Vendor booth — 10×10 + Power ×1 (adjusted)" for list rows; replaces `AddOnService.summarizeLines` callers on the application side.

`AddOnService.validateApplicationLines` is unchanged; `reserve / release / commit / unsell` take `{ addOnId, quantity }` and are unchanged; `_addOnLines(tx, applicationId)` reads `orderAddOn` through the application's order. `serializeApplicationLine` is deleted in favour of `serializeOrderLine(line, feeMode)`.

### 2.5 Payment flow changes (`ApplicationPaymentService`)

| Step | Today | After |
|---|---|---|
| `_chargeFor(application)` | tier line = `applicantPays − Σ addOn.applicantPays` | tier line = `buyerLineTotal(tierItem) + Σ adjustment lines`, add-on lines from `OrderAddOn`; `fees.subtotal = order.orgReceives` |
| session / intent metadata | `applicationId, organizationId, purpose` | + `orderId, orderRef` |
| `_paymentSession` (charge at submission, pay-now) | stores session id | also upserts `PaymentTransaction { orderId, status PENDING, amount, stripeAccountId, applicationFee }` (like `createOrder` step 7) |
| `chargeOnApproval` success | writes intent on `Application` | upserts `PaymentTransaction { stripePaymentIntentId, status SUCCEEDED, stripeAccountId, applicationFee }` then `_markPaid` |
| `chargeOnApproval` decline | `_markPaymentDue(…, intentId)` | `PaymentTransaction { stripePaymentIntentId, status FAILED, failureReason }` + `_markPaymentDue` sets `Order.dueAt` |
| `_markPaid` | `paidAt`, capacity, DRAFT → SUBMITTED | same + `Order { status COMPLETED, paidAt }`, `PaymentTransaction.status SUCCEEDED` (external intent id when it differs) |
| `_onCheckoutCompleted` (payment mode) | intent id on `Application` | intent id on `PaymentTransaction` |
| `refund` | `ApplicationRefund` + Stripe | **deleted**; `RefundService.refundOrder(orderId, { amount, reason, initiatedBy })` |
| `_recomputeRefundStatus` | reads `ApplicationRefund` | `RefundService._recomputeOrderRefundStatus(tx, orderId)` sets `Order.status`; then `_transition` mirrors to `paymentStatus` |
| `_onChargeRefunded` | matched by `Application.stripePaymentIntentId` | **deleted**; `RefundService.handleExternalRefund` finds the `PaymentTransaction`, branches on `order.kind` (APPLICATION: record `Refund`, no ticket voiding, recompute both statuses) |
| `isApplicationRefundEvent` | looks up application by intent | deleted; the webhook's `charge.refunded` case always goes to `RefundService` |
| `sweepOverdue` | `paymentDueAt` | `order.dueAt` |
| `dashboardPaymentUrl` | `Application.stripePaymentIntentId` | `order.payment.stripePaymentIntentId` |

`isApplicationEvent` (metadata.applicationId for `checkout.session.*` setup / payment and `payment_intent.*`) is unchanged, so card-on-file flows dispatch as before.

### 2.6 Refunds (`RefundService`)

- `refundOrder(orderId, { amount = null, reason, initiatedBy })`: for `kind = TICKET` unchanged (full refund, tickets voided, `amount` must be null → 400 "Ticket orders are refunded per ticket or in full"). For `kind = APPLICATION`: lock the order; remaining = `totalAmount − Σ SUCCEEDED refunds`; `amount ?? remaining`; validate > 0 and ≤ remaining; if `payment.source = OFFLINE` create `Refund { manual: true, status: SUCCEEDED }` with no Stripe call, else `Refund PENDING` → `createStripeRefund({ paymentIntentId, amount, connected: !!payment.stripeAccountId, metadata: { orderId, applicationId } })` → `SUCCEEDED` + `stripeRefundId` (or `FAILED` and rethrow); `_recomputeOrderRefundStatus`; return the refund.
- `ApplicationService.refund(eventId, applicationId, orgId, opts)` resolves ownership, calls `refundService.refundOrder(order.id, opts)`, writes the decision row (`MANUAL_REFUND` when manual, else none — today only manual refunds log; unchanged).
- `getRefundsForOrder` returns application refunds with `manual` and without ticket / line fields.
- `POST /admin/orders/:orderId/refund` accepts `{ amount?, reason? }`; `amount` only honoured for application orders. Route stays ADMIN (spec 018 decision 7.1).

### 2.7 Submission (`ApplicationService.submit`)

Inside the existing transaction, right after `application.create` (the order needs `applicationId`): for PAID forms, `orderService.createApplicationOrder(tx, { application, event, contact, data: orderLineService.applicationOrderData(…) })` creates `Order { kind APPLICATION, status PENDING, orderRef: _uniqueOrderRef(tx), optIn* false }` + lines. The returned `{ applicationId, statusUrl, next, checkoutUrl, orderRef }` gains `orderRef`. `DETAIL_INCLUDE` / `LIST_INCLUDE` gain `order: { include: { items, addOns: { include: { addOn } }, payment, refunds } }`; `_serializeAdmin`, `_serializeApplicant`, `_serializeRow`, CSV export and the digest read money from `a.order`. Serialized shapes (`amounts`, `payment`, `refunds`, `adjustments`, `addOns`, `paymentSource`, `offlinePayment`) are kept byte-compatible in phase 1 and gain `orderRef` + `orderId`; the frontend's `lib/applications.ts` types only add the two fields.

### 2.8 Reporting collapse (phase 1)

- `CustomerService`: predicate `orders.some({ status in PAID_ORDER_STATUSES })`; `ORDER_SELECT` adds `kind`; aggregates split counts by kind (`ticketOrderCount`, `applicationCount`), `lastActivityAt = max(paidAt ?? createdAt)`; `getCustomerById` returns `orders[]` with `kind`, `applicationId`, `description` and keeps `applications[]` (built from the application-kind orders joined to `application { form, tier, status, paymentStatus }`) so the customer page needs no change in phase 1.
- Dashboard stats (`admin.js`): one `groupBy(['kind'])` over paid orders.
- `EventService.getEventAnalytics`: `revenue.applications` = Σ `totalAmount` over `kind APPLICATION` paid orders on the event; `applicationRefunds` = Σ `Refund.amount SUCCEEDED` on those orders.
- `TaxService.collectedReport`: one loop over paid orders in range by `paidAt` (both kinds; `source = kind.toLowerCase()`); application rows contribute only when `order.taxAmount > 0` (a non-taxable form produces 0 tax, so the `form.taxable` join is unnecessary).

### 2.9 Orders surface (phase 2)

**Backend** — `GET /admin/orders` (`OrderService.getOrdersByOrganization`):
- query: `kind`, `status` (comma list; default `NOT IN (FAILED, CANCELLED)`), `eventId`, `from`, `to`, `search`, `page`, `limit`, `sort` (`createdAt` / `totalAmount`).
- search: `orderRef ILIKE`, contact email / first / last `ILIKE`, `application.profile.businessName ILIKE`; a term matching `/^(pi|re|pyr|cs)_/` skips ILIKE and matches `payment.stripePaymentIntentId`, `refunds.some.stripeRefundId`, `stripeSessionId`, `application.stripeCheckoutSessionId` by equality.
- row: `{ id, orderRef, kind, status, statusDetail (application paymentStatus + dueAt), eventName, eventDate, eventId, quantity, description, businessName, contact, totals…, paymentSource, createdAt, paidAt, applicationId, organization? }`.
- `GET /admin/orders/export.csv` — cursor on `(createdAt, id)`, pages of 500, one line per order plus one `kind = refund` line per succeeded refund. Columns as spec 018 §2.4 minus `type` (now `kind`).
- `GET /admin/orders/:orderId` — `_formatOrderDetail` adds `kind`, `feeMode`, `orgReceives`, `paidAt`, `dueAt`, `items[].kind / description`, `payment.source / offlineMethod / offlineReference`, `application { id, eventId, formName, tierName, status, paymentStatus, businessName, capacitySlot }` when present.

**Frontend**
- `frontend/src/app/admin/orders/page.tsx` → thin page with the header, a `ViewToggle` (`orders` | `tickets`, persisted in `localStorage`), and either `OrdersListView` (new) or `TicketRowsView` (today's body, moved unchanged).
- `OrdersListView`: search, Kind / Status / Event / Date filters, table columns Order # · Customer (name, email; business name on a second line) · Kind chip · Event · Description · Total · Status chip (`statusDetail` for pending application orders) · Date; CSV button; pagination. Row → `/admin/orders/[orderId]`.
- `[orderId]/page.tsx`: application branch — lines table (tier / add-ons / adjustments, buyer totals), payment card (source, method, reference, intent link, Connect account), refunds list, ADMIN refund button opening the amount-based `RefundDialog` (moved from `admin/events/[eventId]/applications/RefundDialog.tsx` to `components/orders/RefundDialog.tsx` and reused by the application page), **Application** panel with review status, payment chip, business name and "Open application" link. Ticket branch unchanged.
- Order number surfaces: `SubmissionsTable` column "Order #" (link), application detail header, applicant status page ("Order JMP-…"), buyer account `ApplicationsSection`, customer detail orders table (kind chip), buyer `GET /me/orders` includes application orders with `applicationId` so "My orders" links to the status page.
- Templates: `ApplicationTemplateService` context gains `orderRef`; defaults in `config/applications.js` for `RECEIVED` / `APPROVED` / `PAYMENT_DUE` / `OFFLINE_PAID` mention it.

### 2.10 Apply-form account, subscription, consent (phase 3)

- `backend/src/config/legal.js`: `LEGAL_VERSIONS = { terms: '2026-09-19-draft', privacy: '2026-09-19-draft', cardAuthorization: '2026-09-19-draft' }`; `GET /legal/versions` public. Frontend reads it once per page (SWR-free fetch in the form's loader) and echoes the versions in `acceptances`.
- `services/LegalAcceptanceService.js`: `record(tx, { subjectType, subjectId, email, organizationId, document, version, source, referenceType, referenceId, presentedText, req })` hashes the IP with a daily salt (`sha256(ip + YYYY-MM-DD + LEGAL_IP_SALT)`) and truncates the UA; `assertCurrent(acceptances, required)` throws `ValidationError('LEGAL_VERSION_STALE')` (code surfaced as `error.code` for the client).
- `POST /events/:eventId/applications`: validator gains `optInAccount`, `optInMarketing`, `acceptances[]`; required documents `PRIVACY`, `TERMS`, and `CARD_AUTHORIZATION` when `form.kind = PAID && form.chargeTiming = APPROVAL`; the presented card-authorization text is rebuilt server-side from the same template the client used (`cardAuthorizationText({ amount, paymentDueDays, orgName })` in `config/legal.js`) so the stored text is what was shown, not client-supplied.
- `submit`: stores `optInAccount / optInMarketing` on the application; the contact upsert no longer sets `emailSubscribed`. `_applyOptIns(tx, application)` runs inside `_transition` when the new status is `SUBMITTED` and `optInsAppliedAt` is null: sets `accountCreatedAt` (if null), `emailSubscribed = true` + `emailSubscribedAt` + `emailSubscribedSource = APPLY` (if not already subscribed), stamps `optInsAppliedAt`, returns `{ accountJustCreated }`. The RECEIVED send (`_sendReceived` and the submit path) issues a WELCOME token when `accountJustCreated` and passes `accountUrl` into the template context; default RECEIVED body gains a conditional line.
- `OrderService.createOrder`: `acceptances` required (`PRIVACY`, `TERMS`), rows recorded in the transaction with `source CHECKOUT`, `referenceType 'Order'`; `PaymentService._applyOptIns` sets `emailSubscribedSource = CHECKOUT` / `emailSubscribedAt`. `CustomerService` admin edit of `emailSubscribed` sets `ADMIN` and `emailUnsubscribedAt` when turning off.
- Apply page: "Your details" gains the account checkbox (default on, copy mirrors checkout: "Create an account with {org} to manage your applications — no password, we'll email you a sign-in link"), keeps the marketing checkbox, adds the required consent checkbox ("I agree to {org} and Jump collecting and storing the information in this application" + "Privacy Policy" link only when `NEXT_PUBLIC_LEGAL_PAGES_ENABLED === 'true'`), and on PAID + APPROVAL forms the required card-authorization checkbox replacing today's informational sentence. Checkout page: no new checkbox (sign-in-wrap sentence stays); it sends `acceptances`.
- Buyer account page: `ApplicationsSection` already lists applications; nothing else.

---

### 2.11 Receipt email for application orders (phase 2)

When an application order reaches `COMPLETED` through Stripe or an offline payment, `EmailService.sendApplicationReceipt(order)` sends a receipt from the same shell as the ticket order confirmation (`sendOrderConfirmation`): order number, event, organizer, business name, lines (tier, add-ons, adjustments) with buyer totals, fees and tax as shown at checkout, payment method (card brand / last 4 from the payment intent, or the offline method and reference), refund policy sentence, and a link to the application status page (or the buyer account when one exists). No tickets, no QR. A waived balance sends no receipt (nothing was paid). Refunds on application orders reuse the ticket-order refund email path (`sendRefundNotification`) with the application wording.

Trigger points: `_markPaid` (approval charge, pay-now, charge-at-submission webhook) and `recordOfflinePayment`, fire-and-forget after the transaction like the ticket path. The existing organizer-template emails (`APPROVED`, `OFFLINE_PAID`) are unchanged; the receipt is Jump's transactional email and is not editable per organization. Contract test: one receipt per completion (idempotent on `Order.status`), none for waived, none for FREE forms.

---

## 3. Files

### Phase 1 — ledger

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | §2.1 |
| `packages/db/prisma/migrations/<ts>_application_orders/migration.sql` | §2.2 |
| `backend/src/scripts/backfill-application-orders.js` | §2.2 script; `package.json` script `db:backfill:024` |
| `backend/src/services/OrderLineService.js` | new — §2.4 |
| `backend/src/services/applicationOrderStatus.js` | new — §2.3 |
| `backend/src/services/OrderService.js` | `_uniqueOrderRef(tx)`, `createApplicationOrder(tx, …)`, `_formatOrderDetail` / `_formatOrderSummary` gain `kind` & co.; `createOrder` sets `kind TICKET`, `orgReceives`, `feeMode`; `completeOrder` sets `paidAt` |
| `backend/src/services/ApplicationService.js` | `submit` (order creation, DRAFT replacement), `_transition`, `_rewriteSnapshot` → `OrderLineService`, `refund` delegation, `_addOnLines`, serializers read `a.order`, CSV, includes |
| `backend/src/services/ApplicationPaymentService.js` | §2.5; `refund`, `_recomputeRefundStatus`, `_onChargeRefunded`, `isApplicationRefundEvent` deleted |
| `backend/src/services/RefundService.js` | §2.6 |
| `backend/src/services/AddOnService.js` | `serializeApplicationLine` removed; `serializeOrderLine(line, feeMode)`; `sales` / `purchasersCsv` read application add-on sales from `OrderAddOn` where `order.kind = APPLICATION` |
| `backend/src/services/ApplicationFormService.js` | `applicationAmounts` unchanged; `adjustmentTotal` reads `OrderItem` adjustment lines |
| `backend/src/services/ApplicationDigestService.js`, `ApplicationTemplateService.js`, `config/applications.js` | money from `application.order` |
| `backend/src/services/CustomerService.js`, `EventService.js`, `TaxService.js`, `api/routes/admin.js` (dashboard) | §2.8 |
| `backend/src/services/paidStatuses.js` | drop `PAID_APPLICATION_STATUSES` |
| `backend/src/api/routes/webhooks.js` | `charge.refunded` always → `RefundService.handleExternalRefund`; application dispatch no longer consults `isApplicationRefundEvent` |
| `backend/src/api/routes/applications.js`, `admin.js` | refund route bodies unchanged; `POST /admin/orders/:orderId/refund` accepts `amount` |
| `frontend/src/lib/applications.ts` | `orderRef`, `orderId` on admin / applicant types |
| `backend/AGENTS.md`, `AGENTS.md`, `docs/wiki/features/application-payments-reporting.md` (→ `application-orders.md`), `docs/wiki/features/applications.md`, `add-ons.md`, `database-architecture.md` | document the ledger move |
| Tests | see §5 |

### Phase 2 — Orders surface

| File | Change |
|---|---|
| `backend/src/services/OrderService.js` | list filters / search / CSV (§2.9); `getOrdersForContact` includes application orders |
| `backend/src/api/routes/admin.js` | `GET /admin/orders` params, `GET /admin/orders/export.csv` |
| `backend/src/api/routes/buyerAuth.js` | `GET /me/orders` includes application orders |
| `backend/src/api/validators/orderValidators.js` | list query validator (new) |
| `frontend/src/app/admin/orders/page.tsx` | toggle shell |
| `frontend/src/app/admin/orders/TicketRowsView.tsx` | today's body, moved |
| `frontend/src/app/admin/orders/OrdersListView.tsx` | new list |
| `frontend/src/app/admin/orders/[orderId]/page.tsx` | application branch |
| `frontend/src/components/orders/RefundDialog.tsx` | moved from applications; both callers |
| `frontend/src/components/applications/SubmissionsTable.tsx`, `admin/events/[eventId]/applications/[applicationId]/page.tsx`, `events/[eventId]/apply/status/[applicationId]/page.tsx`, `organizations/[orgId]/account/ApplicationsSection.tsx`, `admin/customers/[contactId]/page.tsx` | order number / kind |
| `backend/src/config/applications.js`, `ApplicationTemplateService.js` | `{{orderRef}}` |
| `frontend/src/lib/orders.ts` | new types |
| `backend/src/services/EmailService.js`, `ApplicationPaymentService._markPaid`, `ApplicationService.recordOfflinePayment` | §2.11 receipt email |

### Phase 3 — account, subscription, consent

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` + migration `<ts>_legal_acceptance_and_opt_ins` | `LegalAcceptance`, enums, `Contact.emailSubscribed*`, `Application.optIn*` (the Application columns could ride phase 1's migration; they are kept here so phase 1 stays ledger-only) |
| `backend/src/config/legal.js` | versions + card-authorization text builder |
| `backend/src/services/LegalAcceptanceService.js` | new |
| `backend/src/services/ContactOptInService.js` | new — shared by `PaymentService._applyOptIns` and `ApplicationService._applyOptIns` |
| `backend/src/api/routes/legal.js` | `GET /legal/versions`; mounted in `server.js` |
| `backend/src/api/validators/applicationValidators.js`, `orderValidators.js` | `acceptances`, `optInAccount` |
| `backend/src/services/ApplicationService.js` | opt-in storage, `_applyOptIns`, welcome link in RECEIVED |
| `backend/src/services/OrderService.js`, `PaymentService.js` | acceptances on checkout, subscribed provenance |
| `backend/src/services/CustomerService.js` | `ADMIN` provenance on edit |
| `frontend/src/app/events/[eventId]/apply/[formSlug]/page.tsx` | three checkboxes + card authorization |
| `frontend/src/app/checkout/[eventId]/page.tsx` | sends `acceptances` |
| `frontend/src/lib/legal.ts` | versions fetch, texts |
| `docs/wiki/features/applications.md`, `guest-checkout.md`, `buyer-accounts.md`; spec 023 spec.md status note ("LR-05 model + apply/checkout capture built by 024 phase 3; LR-07 provenance built") | |

---

## 4. API summary

| Route | Phase | Change |
|---|---|---|
| `POST /events/:eventId/applications` | 1 / 3 | response `+ orderRef`; body `+ optInAccount, optInMarketing, acceptances[]` (3) |
| `POST /admin/events/:eventId/applications/:id/refund` | 1 | unchanged shape; delegates to `RefundService` |
| `POST /admin/orders/:orderId/refund` | 1 | `+ amount?` (application orders) |
| `GET /admin/orders` | 2 | `+ kind, status list, from, to, sort`; rows gain `kind`, `description`, `businessName`, `statusDetail`, `applicationId`, `paidAt` |
| `GET /admin/orders/export.csv` | 2 | new |
| `GET /admin/orders/:orderId` | 2 | `+ kind, feeMode, orgReceives, paidAt, dueAt, application`, items with `kind / description` |
| `GET /admin/customers/:contactId` | 1 | `orders[]` gain `kind`; `applications[]` kept |
| `GET /buyer/me/orders` | 2 | includes application orders (`kind`, `applicationId`) |
| `POST /orders` | 3 | body `+ acceptances[]` (required) |
| `GET /legal/versions` | 3 | new, public |

---

## 5. Tests

Phase 1 — contract: `applicationOrders.test.js` (order at submission PAID / none FREE; every `_transition` mapping incl. DRAFT replacement → `CANCELLED`; line rewrite on add-on edit, tier change, adjustment, waive with exact totals; `PaymentTransaction` on approval charge, decline, pay-now, offline; refunds partial / full / manual / external webhook and both statuses; customers / analytics / dashboard / tax over one ledger — port the assertions of `transactionsReporting.test.js` and delete it), `applicationOrdersBackfill.test.js` (script vs migration equivalence, idempotence). Unit: `orderLineService.test.js` (buyer line totals under PASS / ABSORB, allocation remainder on the tier line, adjustment floor), `applicationOrderStatus.test.js`. Existing `applicationPayments`, `applicationCorrections`, `applicationsAddOns`, `applicationsPhase3`, `participants*`, `orders`, `payments` tests: fixtures move from application columns to order rows; assertions unchanged where the serialized shape is unchanged. E2E: `applications-payments.spec.ts`, `applications-corrections.spec.ts`, `transactions-reporting.spec.ts` (renamed `application-orders-reporting.spec.ts`) re-pointed at the new mocks.

Phase 2 — contract: `ordersList.test.js` (every search key incl. Stripe ids, kind / status / date filters, default exclusion, org scope, SYSTEM_ADMIN column, CSV rows + refund lines, pagination), order detail application branch, `GET /me/orders`, `applicationReceipt.test.js` (§2.11). E2E: `admin-orders.spec.ts` (toggle, list, detail, refund dialog on an application order), updates to `applications*.spec.ts` for the order-number column.

Phase 3 — contract: `applyOptIns.test.js` (FREE applied at submit; PAID applied after card / after pay-at-submission; abandoned DRAFT never applied; existing account untouched; WELCOME token + `accountUrl` in RECEIVED), `legalAcceptance.test.js` (rows on apply and checkout with hashed IP, no raw IP anywhere; stale version 400 on both; card authorization presented text equals the server template; `GET /legal/versions`). Unit: `legalAcceptanceService.test.js`. E2E: `apply.spec.ts` checkboxes and link visibility under the flag; `checkout.spec.ts` sends acceptances.

Run: `cd backend && npm test`, `cd frontend && npm run test:unit && npx tsc --noEmit && npm run test`.

---

## 6. Rollout

1. Phase 1 PR: schema + migration + backfill script + services + tests + docs. Before merging: run `db:backfill:024` against a copy of prod (`pg_dump` → local) and diff row counts (`Order kind=APPLICATION` = PAID-form applications; `Refund` count = old `ApplicationRefund` + old `Refund`). Deploy: Railway runs `prisma migrate deploy` (migration carries the SQL backfill); dev machines run the script then `db push`.
2. Phase 2 PR: UI. No migration.
3. Phase 3 PR: migration (LegalAcceptance, provenance, opt-ins) + apply / checkout capture. `LEGAL_IP_SALT` added to `backend/.env` (documented in `CLAUDE.md` env table); `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` stays unset.
4. After all three: `/doc-feature` for `docs/wiki/features/application-orders.md`; update `specs/STATUS.md`, `docs/roadmap.md`, spec 018 plan status ("superseded by 024 for the data model; corrections retained"), memory.

---

## 7. Decisions

| # | Decision | Why |
|---|---|---|
| 7.1 | One `PaymentTransaction` per order (`orderId` unique kept); a declined approval charge and a later pay-now share the row (intent id overwritten, `failureReason` cleared on success) | Changing to a list touches every ticket-order consumer for a history the decision log already holds. Revisit if disputes need the failed intent id (it is also in Stripe under the customer) |
| 7.2 | `CANCELLED` added to `OrderStatus` rather than reusing `FAILED` | A rejected vendor is not a failed payment; the status filter must tell them apart. Ticket orders never use it (until spec 020's sweep decides otherwise) |
| 7.3 | Waived balance = `COMPLETED` order with total 0, `WAIVER` line, no `PaymentTransaction` | No money moved, so no payment row; the order still appears as settled with an auditable line |
| 7.4 | Application orders are created at DRAFT (before the card is saved) | User decision D2; mirrors ticket orders which exist before Stripe. Replaced DRAFTs are withdrawn, never deleted, so the ledger never loses a row |
| 7.5 | Opt-ins applied at `SUBMITTED`, not at payment | User decision D5. For PAID forms this is after the card step (proof comparable to a ticket order); for FREE forms it is submission — the trade-off accepted is that a forged FREE submission enables a magic-link account nobody can use and a marketing flag for that email; the unsubscribe path and spec 023's provenance make it reversible |
| 7.6 | Tax report and last-activity date basis = `Order.paidAt` for both kinds | Closes spec 018 decision 7.6; ticket orders backfill `paidAt` from the payment row |
| 7.7 | `Application.paymentStatus` kept as the fine-grained state; `Order.status` derived through one function in the same transaction | The application UI, sweep and templates key on the fine states; a single derived write keeps the two from drifting without denormalising the fine states onto `Order` |
| 7.8 | The Tickets view survives as a toggle on `/admin/orders`, not a separate sidebar entry | Check-in and attendee edits are ticket-level work; the sidebar keeps one money entry |
| 7.9 | Checkout gets no new checkbox; `LegalAcceptance` is recorded from the pay action under the existing sentence | Spec 023 LR-05 pattern; counsel decides on a checkbox for arbitration enforceability (023 §12 Q2). The apply form gets checkboxes because data collection there is broader (business profile, photos) and the card authorization needs an explicit act |
| 7.10 | Legal versions are `-draft` until spec 023 phase 1 publishes text | An acceptance without a readable document is weak evidence; capture is built now so publication is a config change |

---

## 8. Open questions — resolved 2026-09-19

1. **Prod backfill dry run** — owned by the session that builds phase 1, before the PR is marked ready: `railway run pg_dump` of prod into a local database, run `db:backfill:024`, diff counts (`Order kind=APPLICATION` = PAID-form applications; `Refund` = old `Refund` + old `ApplicationRefund`; `PaymentTransaction` = ticket rows + applications with an intent or an offline payment), record the numbers in the PR description.
2. **`GET /admin/orders` default status set** — hide `FAILED` + `CANCELLED` only, as planned; revisit if abandoned ticket checkouts make the list noisy before spec 020's sweep lands.
3. **Receipt email for application orders** — **yes** (user decision). See §2.11; phase 2.
4. **Spec 023 ownership** — LR-05 (model + apply / checkout capture) and LR-07 (provenance) are built by 024 phase 3. `specs/023-legal-compliance/spec.md` exists only on `plan/023-legal-compliance` (draft PR #82), so the note goes into that branch when it is next touched: LR-05 / LR-07 → "built by spec 024 phase 3; 023 phase 1 publishes the text, bumps `LEGAL_VERSIONS` and flips `LEGAL_ACCEPTANCE_REQUIRED` + `NEXT_PUBLIC_LEGAL_PAGES_ENABLED`".

---

## 9. Follow-ups (not in this plan)

- Partial offline payments (spec 018 decision 7.5) — still out of scope.
- Disputes / chargebacks surfacing on the order (`charge.dispute.*`).
- Multiple `PaymentTransaction` rows per order (7.1) if a payment-attempt history is ever needed on the order itself.
- Spec 023 phases 1–3 (legal text, pages, privacy requests, content reports).
- Spec 020 abandoned-order sweep should mark expired ticket checkouts `FAILED` (as today) — no change, noted for the default-filter question.
