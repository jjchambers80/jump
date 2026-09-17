# Implementation Plan: Add-ons (spec 012)

**Status**: Planned 2026-09-17. Not started.
**Spec**: [spec.md](./spec.md). Depends on spec 011 (all phases on `main` 2026-09-17) and spec 010 phase 2 (Connect routing, on `main`, dark).

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Fee math, tax-inclusive mode, proportional allocation with drift fix | `backend/src/services/FeeService.js`, mirrored in `frontend/src/lib/fees.ts` | Add-on lines are items in the same call; one change: per-item `taxable` |
| Conditional `UPDATE … RETURNING` reservation on `PriceTier` | `OrderService.createOrder` step 2 | Same statement against `AddOn` |
| Order → Stripe Checkout with all-in line items, Connect routing via `checkoutOptionsFor` | `OrderService.createOrder`, `PaymentSettingsService` | Add-on lines join `line_items`; `fees.subtotal` already drives `application_fee_amount` |
| Order completion, failure, expiry, ticket creation | `PaymentService.handleCheckoutCompleted/Failed`, `TicketService.createTicketsForOrder` | Tickets iterate `order.items` only; add-on lines live on a separate table so this code is untouched |
| Refund per ticket / full order, external refund webhook | `RefundService` | New `refundAddOnLine`; `Refund.orderAddOnId` |
| Application amount snapshot, fee mode PASS/ABSORB, `taxable` per form | `ApplicationFormService.tierAmounts`, `ApplicationService.submit` | Generalised to `applicationAmounts(lines, form, event, org)` |
| Approval reservation on `ApplicationTier` (`quantityReserved` → `quantityApproved`), release on withdraw / overdue | `ApplicationService.decide`, `ApplicationPaymentService` | Add-on reservation in the same transaction and lock order |
| Price-changed note, CSV export, event duplicate + `copyForms`, status page, templates | spec 011 phase 3 | Each extended with lines |
| Tier presets | `TierPresetService`, `routes/tierPresets.js` | Add-on presets are a static list, not a table |
| Scan / redeem responses | `routes/tickets.js`, `TicketService` | Add `order.addOns` to the scan result |

---

## 2. Design

### 2.1 Product model

`AddOn` is an event-scoped product, independent of any tier. Scope (`TICKET`, `APPLICATION`, `BOTH`) says which checkout it can appear in; `allTiers = true` (default) offers it on every tier of that scope, otherwise explicit attachment rows restrict it. This keeps the common case ("power on every booth") a one-step setup and the restricted case ("VIP lounge only with VIP tickets") expressible without duplicating the add-on per tier.

### 2.2 Quantity semantics

Quantity is per order / per application. `maxPerOrder` caps it (default none; UI caps at 10 like tiers). Per-ticket add-ons are out of scope (spec Edge Cases).

### 2.3 Money

One rule: an add-on line is priced exactly like a tier line in the same checkout.

- Tickets: PASS (all-in). `computeOrderFees([...tierItems, ...addOnItems], taxRate, { taxInclusive })`; add-on items carry `taxable: addOn.taxable` and the tier items `taxable: true`. Tax is computed only on taxable listed value; platform and processing fees on the whole ex-tax subtotal; allocation across all lines proportional to listed value as today. The fixed processing component stays once per order.
- Applications: `applicationAmounts(lines, form, event, organization)` where `lines = [{ price: tier.price, quantity: 1, taxable: form.taxable }, ...addOns.map(a => ({ price, quantity, taxable: a.taxable }))]`, then PASS / ABSORB exactly as `tierAmounts` does today. `Application.subtotal … orgReceives` remain the totals; per-line detail lives on `ApplicationAddOn`.
- Fee mode is inherited (spec Assumptions). Per-add-on mode → open decision 7.1.

### 2.4 Capacity

`AddOn.quantityTotal` nullable (null = unlimited). When set: `quantitySold` and `quantityReserved` with the same conditional update as `PriceTier`.

- Orders: reserve at `createOrder` (after tier reservations, in `displayOrder`), `sold` on completion, release on failure / expiry / Stripe error / refund of the line.
- Applications: nothing held at submission (matches the tier). At approval the decision transaction reserves the tier slot **then** each add-on in `displayOrder`; any failure throws 409 `{ addOnId, name, remaining }` and rolls back the tier reservation. `quantityReserved` → `quantitySold` when the charge succeeds (same place the tier moves `quantityReserved` → `quantityApproved`); release on withdraw / overdue / refund-driven withdraw, in the tier's transaction.

Lock order is fixed (tier, then add-ons by `displayOrder`) so two concurrent approvals cannot deadlock.

### 2.5 Application line edits before money moves

ORGANIZER+ `PATCH …/applications/:id/add-ons` with the full desired line set, allowed in `SUBMITTED`, `WAITLISTED`, and `APPROVED` + `PAYMENT_DUE`. Recomputes the snapshot at today's prices (tier included, so the price-changed note clears), writes an `ApplicationDecision` row with action `ADD_ONS_CHANGED` and the before/after lines, emails the applicant with the new total (new template action `ADD_ONS_CHANGED`, default body provided). Refused on `PAID`, `PROCESSING`, `REJECTED`, `WITHDRAWN`. In `PAYMENT_DUE` the pending pay-now session (if any) is expired so the next pay-now uses the new amount.

### 2.6 Refunds

- Orders: `Refund.orderAddOnId` (nullable, alongside `ticketId`). `refundAddOnLine(orderAddOnId)` refunds the line's all-in amount (`unitPrice × quantity + fees + tax`), decrements `quantitySold`, marks the line `refundedAt`. `refundOrder` sums ticket lines and add-on lines. Connect: unchanged (`reverse_transfer`, `refund_application_fee`).
- Applications: unchanged amount-based partial refund. Reducing add-ons after payment = organizer issues a partial refund and edits nothing; the lines stay as sold (spec US3 scenario 5).

### 2.7 Public reads

- `GET /events/:id` → each `priceTier` gains `addOns: [{ id, name, description, price, allIn, remaining, maxPerOrder, taxable }]` (already-listed price + computed all-in via `computeTierAllInPrice`-style helper), plus event-level `addOns` for the cart block to dedupe.
- `GET /events/:eventId/applications/forms/:slug` → each tier gains `addOns` with `amounts` (per-unit applicant price for the form's fee mode).

### 2.8 Admin

- Event edit page: **Add-ons** section (list with sold / remaining / revenue, reorder, activate / deactivate, edit dialog, presets menu). ADMIN-only writes, mirrored on `requireAdmin`.
- Application form tier dialog: "Add-ons offered" multi-select (only when the add-on is restricted; `allTiers` add-ons are shown as included).
- Application detail: lines table with quantities and unit prices; "Edit add-ons" (rules in 2.5); refund unchanged.
- Applications list: filter `addOnId` ("has Booth power"), column "Add-ons" (compact `Power ×1, Badge ×2`).
- Orders detail: add-on lines with per-line Refund.
- Reports: `GET /admin/events/:eventId/add-ons/sales` and `…/add-ons/purchasers.csv`.

---

## 3. Data model

```prisma
enum AddOnScope { TICKET APPLICATION BOTH }

model AddOn {
  id               String     @id @default(cuid())
  eventId          String
  name             String
  description      String?
  price            Decimal    @db.Decimal(10, 2)
  scope            AddOnScope @default(BOTH)
  allTiers         Boolean    @default(true)
  quantityTotal    Int?                      // null = unlimited
  quantitySold     Int        @default(0)
  quantityReserved Int        @default(0)
  maxPerOrder      Int?
  taxable          Boolean    @default(true)
  isActive         Boolean    @default(true)
  displayOrder     Int        @default(0)
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  event            Event                 @relation(fields: [eventId], references: [id], onDelete: Cascade)
  priceTiers       PriceTierAddOn[]
  applicationTiers ApplicationTierAddOn[]
  orderLines       OrderAddOn[]
  applicationLines ApplicationAddOn[]

  @@index([eventId, isActive])
}

model PriceTierAddOn {
  priceTierId String
  addOnId     String
  priceTier   PriceTier @relation(fields: [priceTierId], references: [id], onDelete: Cascade)
  addOn       AddOn     @relation(fields: [addOnId], references: [id], onDelete: Cascade)
  @@id([priceTierId, addOnId])
}

model ApplicationTierAddOn {
  applicationTierId String
  addOnId           String
  tier              ApplicationTier @relation(fields: [applicationTierId], references: [id], onDelete: Cascade)
  addOn             AddOn           @relation(fields: [addOnId], references: [id], onDelete: Cascade)
  @@id([applicationTierId, addOnId])
}

model OrderAddOn {
  id            String    @id @default(cuid())
  orderId       String
  addOnId       String
  quantity      Int
  unitPrice     Decimal   @db.Decimal(10, 2)   // listed price at purchase, immutable
  platformFee   Decimal   @db.Decimal(10, 2) @default(0)
  processingFee Decimal   @db.Decimal(10, 2) @default(0)
  tax           Decimal   @db.Decimal(10, 2) @default(0)
  refundedAt    DateTime?
  createdAt     DateTime  @default(now())

  order   Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  addOn   AddOn   @relation(fields: [addOnId], references: [id])
  refunds Refund[]

  @@unique([orderId, addOnId])
  @@index([addOnId])
}

model ApplicationAddOn {
  id            String  @id @default(cuid())
  applicationId String
  addOnId       String
  quantity      Int
  unitPrice     Decimal @db.Decimal(10, 2)   // listed price in the current snapshot
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  addOn       AddOn       @relation(fields: [addOnId], references: [id])

  @@unique([applicationId, addOnId])
  @@index([addOnId])
}

// Existing models
model Refund       { orderAddOnId String?  orderAddOn OrderAddOn? @relation(...) }   // alongside ticketId
model Event        { addOns AddOn[] }
model PriceTier    { addOns PriceTierAddOn[] }
model ApplicationTier { addOns ApplicationTierAddOn[] }
model Order        { addOns OrderAddOn[] }
model Application  { addOns ApplicationAddOn[] }
enum ApplicationAction { … ADD_ONS_CHANGED }
```

Migration `20260918000000_add_ons`. No backfill. `OrderAddOn` keeps its own fee/tax allocation so a refund of the line is exact; `ApplicationAddOn` keeps only the unit price because the application snapshot is already the single source for fees.

---

## 4. Backend

### 4.1 FeeService

`computeOrderFees(items, taxRate, { taxInclusive })`: items gain optional `taxable` (default `true`). `taxableListed = Σ listed of taxable items`; tax-added mode: `tax = round(taxableSubtotal × rate)`; tax-inclusive mode: the net of taxable items is `listed / (1 + rate)`, non-taxable items are net = listed. Per-item breakdown allocates tax across taxable items only, fees across all items. Existing callers pass no `taxable` and get identical results (unit test pins the current fixtures). Mirror in `frontend/src/lib/fees.ts` with the same fixture file.

### 4.2 Services

- `AddOnService.js` — `listForEvent(eventId, { includeInactive })`, `create`, `update`, `setActive`, `reorder`, `attach(tierKind, tierId, addOnIds)`, `offeredForPriceTiers(eventId, tierIds)`, `offeredForApplicationTier(tierId)`, `reserve(tx, lines)` / `release(tx, lines)` / `commit(tx, lines)` (the three conditional updates), `sales(eventId)`, `purchasersCsv(eventId)`, `copyForEvent(tx, sourceEventId, targetEventId, tierIdMap, applicationTierIdMap)`, `presets()` (static: Booth power $125, Extra vendor badge $10 max 4, Table & chairs $40, Parking pass $15, VIP lounge $50 — all inactive until saved).
- `OrderService.createOrder({ …, addOns })` — validate each `{ addOnId, quantity }` against scope TICKET/BOTH, `isActive`, attachment to a tier in `items`, `maxPerOrder`; reserve after tiers; fee items include add-ons with `taxable`; create `OrderAddOn` rows from the breakdown; Stripe `line_items` append add-on lines named `${event.name} — ${addOn.name}`; rollback on Stripe failure releases add-ons too. `_formatOrderDetail` / `_formatOrderSummary` include `addOns`.
- `PaymentService.handleCheckoutCompleted` — `AddOnService.commit`; `handleCheckoutFailed` and the expiry path — `release`. `TicketService` untouched (tickets come from `order.items` only).
- `RefundService.refundAddOnLine(orderAddOnId)`; `refundOrder` includes unrefunded add-on lines; `handleExternalRefund` unchanged (amount-based).
- `EmailService` order confirmation — add-on lines under the ticket lines.
- `ApplicationFormService` — `applicationAmounts(lines, form, event, org)` replaces `tierAmounts` (kept as a one-line wrapper); public serializer adds `addOns` per tier with per-unit `amounts`; `copyForms` maps tier ids for `AddOnService.copyForEvent`.
- `ApplicationService.submit(…, body.addOns)` — validate against the tier's offered add-ons and `maxPerOrder`; create `ApplicationAddOn`; snapshot from `applicationAmounts`. `updateAddOns(applicationId, lines, actor)` per §2.5. `decide` APPROVE: reserve add-ons after the tier inside the existing transaction; withdraw / overdue paths release. `_serializeAdmin` / `_serializeApplicant` include `addOns` and the price-changed check recomputes with lines. `exportCsv` gains one column per active-or-sold add-on (`addon:<name>` header, quantity or blank).
- `ApplicationPaymentService` — no change to charge amounts (reads `applicantPays`); `_chargeFor` line items: tier line plus one Stripe line per add-on so the applicant's Stripe page itemises what the form showed. Charge success path calls `AddOnService.commit` where the tier moves reserved → approved.
- `EventService.duplicateEvent` — after tiers and forms, `AddOnService.copyForEvent`.
- `TicketService` scan/redeem result — `order.addOns` (name, quantity) for the scanned ticket's order.

### 4.3 Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /organizations/:orgId/events/:eventId/add-ons` | member | list (admin, includes inactive + sales counts) |
| `POST …/add-ons` | ADMIN | create |
| `PATCH …/add-ons/:addOnId` | ADMIN | update fields + `priceTierIds` / `applicationTierIds` attachments |
| `POST …/add-ons/:addOnId/activate` / `deactivate` | ADMIN | |
| `DELETE …/add-ons/:addOnId` | ADMIN | 409 if any line exists → use deactivate |
| `POST …/add-ons/reorder` | ADMIN | |
| `GET …/add-ons/presets` | member | static presets |
| `GET /admin/events/:eventId/add-ons/sales` | member | per add-on sold / reserved / remaining / revenue, tickets vs applications |
| `GET /admin/events/:eventId/add-ons/purchasers.csv` | member | one row per line |
| `PATCH /admin/events/:eventId/applications/:applicationId/add-ons` | ORGANIZER+ | §2.5 |
| `POST /admin/orders/:orderId/add-ons/:orderAddOnId/refund` | ADMIN | line refund |
| `POST /orders` | public | body gains `addOns: [{ addOnId, quantity }]` |
| `POST /events/:eventId/applications` | public | body gains `addOns: [{ addOnId, quantity }]` |
| `GET /events/:id`, `GET /events/:eventId/applications/forms/:slug` | public | add-ons per tier |

Validators: `addOnValidators.js` (create/update/attach/reorder), `orderValidators.js` (`addOns` array, unique ids, positive ints), `applicationValidators.js` (same on submission and on the PATCH).

### 4.4 Webhooks

No new events. `checkout.session.completed` → commit; `checkout.session.expired` / failure → release; `charge.refunded` unchanged.

---

## 5. Frontend

### 5.1 Storefront

- `events/[eventId]/page.tsx` — `AddOnPicker` block below the tier list, visible when the cart has ≥1 ticket; lists the union of add-ons offered on cart tiers with steppers (`maxPerOrder`, remaining), all-in price per unit via `fees.ts`; cart totals include add-on lines; the cart query carries `addOns` alongside `items`.
- `checkout/[eventId]/page.tsx` — parse `addOns` from the URL, show lines, send in `POST /orders`.
- `orders/[orderId]/page.tsx` and `TicketDisplay` — add-on lines under tickets.
- `events/[eventId]/apply/[formSlug]/page.tsx` — after tier selection, `AddOnPicker` (application flavour: per-unit applicant price for the form's fee mode); summary line "tier + add-ons = total"; `addOns` in the submission body.
- `events/[eventId]/apply/status/[applicationId]/page.tsx` — lines in the amount card.

### 5.2 Admin

- `admin/events/[eventId]/edit/page.tsx` — `AddOnsSection.tsx` + `AddOnEditDialog.tsx` (name, description, price with all-in preview for tickets and for each PAID form's fee mode, scope, quantity, max per order, taxable, "Offer on: all tiers / selected tiers" with the tier pickers), presets menu, sales counts inline.
- `admin/events/[eventId]/applications/forms/[formId]/page.tsx` — tier dialog gains "Add-ons offered".
- `admin/events/[eventId]/applications/page.tsx` — `addOnId` filter, "Add-ons" column, saved views carry the filter.
- `admin/events/[eventId]/applications/[applicationId]/page.tsx` — lines table, `EditAddOnsDialog.tsx` (rules in §2.5, disabled with reason otherwise), price-changed note covers lines.
- `admin/orders/[orderId]/page.tsx` — lines with per-line Refund.
- `admin/orders/scan/page.tsx` — add-ons on the scan result card.
- `admin/events/[eventId]/analytics/page.tsx` — "Add-on sales" table + purchasers CSV button.

### 5.3 Types / hooks

`frontend/src/lib/addOns.ts` (types, `allInAddOnPrice`, `applicantAddOnPrice`), `useAddOnsApi.ts` for the admin section; `lib/applications.ts` types gain `addOns`.

---

## 6. Phases

### Phase 1 — Product + ticket checkout

Schema + migration; `FeeService` per-item `taxable` (both libraries, fixtures); `AddOnService` CRUD, attachments, reserve/commit/release; admin add-ons section + dialog + presets; public event payload; `POST /orders` with add-ons, Stripe lines, confirmation page/email, admin order detail, per-line and full-order refund; scan result add-ons. Tests: `addOns.test.js` (CRUD, RBAC, attachments, public payload), `ordersAddOns.test.js` (fees with mixed taxable, reservation + concurrency `Promise.all`, expiry release, refunds), unit fixtures for fee math. Frontend e2e `add-ons.spec.ts` (create via UI, buy with a ticket, refund line).

### Phase 2 — Applications

Application tier attachments; public form payload; apply form picker + summary; submission lines + snapshot via `applicationAmounts`; approval reservation + 409; release paths; line edits before payment with `ADD_ONS_CHANGED` template; admin detail / list filter / CSV columns; status page and emails; price-changed note with lines; event duplicate copies add-ons. Tests: `applicationsAddOns.test.js` (snapshot math PASS/ABSORB with taxable mix, approval sold-out 409 rolls back the tier, edit rules per state, CSV columns, duplicate). e2e: apply with add-ons → approve → PAID with the itemised amount.

### Phase 3 — Reporting and polish

Sales endpoint + analytics table, purchasers CSV, "has add-on" saved views, presets in the create-event wizard (spec 005 when built), digest email add-on counts, wiki page + agent docs.

### Explicitly out of scope

Per-ticket add-ons (a meal per attendee), per-add-on fee mode (fee modes item), post-payment additions to approved applications (invoices spec), add-on-only orders without a ticket, add-on inventory shared across events, variants (sizes), required add-ons (open decision 7.4).

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 7.1 | Per-add-on fee mode (the interviewee absorbed the badge fee but split the power fee) | Inherit the parent's mode in 012; add per-product mode in the "fee modes" spec, which needs per-line fee math for tiers too |
| 7.2 | Add-on quantity per order vs per ticket | Per order; the interview's cases (power, badges, tables) are per booth / per order |
| 7.3 | Post-payment additions on approved applications | Refuse in 012; invoices spec covers "charge the saved card for a new line" with its own `ApplicationCharge` ledger |
| 7.4 | Required add-ons (mandatory cleaning fee, insurance) | Not in 012. If needed, `required = true` auto-adds quantity 1 and hides the stepper; cheap to add later |
| 7.5 | Taxable default | `true`; the booth form's `taxable=false` only governs the tier line, so an organizer with untaxed booths sets power untaxed explicitly (the dialog defaults `taxable` from the form when opened from a form tier) |
| 7.6 | Delete vs deactivate | Delete only with zero lines; otherwise deactivate — mirrors tiers |
| 7.7 | Who may edit application lines | ORGANIZER+ (a decision-adjacent action), configuration ADMIN — mirrors spec 011 §7.3 |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Fee allocation drift once tax applies to some lines only | Fixture-driven unit tests for both libraries; drift correction extended to tax across taxable lines only |
| Approval reserves the tier, then an add-on is sold out → partial state | Single transaction; add-on reservation failure throws before the charge; contract test asserts the tier's `quantityReserved` is unchanged after the 409 |
| Order failure paths forget to release add-ons | One `release(tx, lines)` called from every path that decrements tier reservations; test each path |
| Organizer edits lines while a pay-now session is open | Expire the session on edit (`checkout.sessions.expire`); the status page re-creates it with the new amount |
| Ticket code assumes every order line is a ticket | Add-ons live on `OrderAddOn`, not `OrderItem`; `Order.quantity` stays the ticket count; analytics that sum `OrderItem` are unaffected |
| Add-on shown for a tier the buyer removed from the cart | Picker recomputes from cart tiers on every change; server re-validates attachment at `POST /orders` |

---

## 9. Follow-ups noted, not planned

Fee modes per product (absorb / pass / split with preview) across tiers and add-ons; invoices for post-approval additions; per-ticket add-ons; booth assignment + map (014) reading `boothLabel` and add-on lines for the venue layout.
