# Add-ons

**Status**: Implemented — phase 1 (product + ticket checkout), phase 2 (application tiers) and phase 3 (sales report, purchasers CSV, digest counts) 2026-09-17. Saved add-ons backend (spec 037 phase 4) 2026-09-26. Specs: `specs/012-add-ons/`, `specs/037-event-workspace/plan.md` §4.2.
**Last Updated**: 2026-09-26

## Overview

Optional **products sold with a ticket tier or an application tier**: parking passes and VIP lounge access with tickets; booth power, extra vendor badges, tables and chairs with vendor applications. An add-on is event-scoped, has a listed price, optional stock, a per-order maximum and its own taxable flag, and is offered on every tier of its scope or only on the tiers it is attached to. Buyers pick quantities under the tier list; applicants pick them under the chosen tier on the apply form. Money follows the parent checkout's rule (tickets all-in PASS; applications the form's PASS / ABSORB), capacity uses the same conditional update as price tiers, and organizers see sales per add-on on the analytics page, per-line on orders and applications, and as CSV columns.

Derived from the 2026-09-15 Eventeny organizer interview pain point #6 (add-ons invoiced after approval, fees split by hand).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `AddOn`, `PriceTierAddOn`, `ApplicationTierAddOn`, `OrderAddOn`, `Refund.orderAddOnId`, `ApplicationAction.ADD_ONS_CHANGED` |
| `backend/src/services/AddOnProductService.js` | Saved add-ons (spec 037): list / search / suggestions, create, update with shared-field write-through, archive, find-or-create, advisory-locked case-insensitive names |
| `backend/src/api/routes/savedAddOns.js` | `/organizations/:orgId/saved-add-ons` |
| `backend/src/services/AddOnService.js` | CRUD + attachments, `attach` (spec 037), `validateOrderLines` / `validateApplicationLines`, capacity (`reserve` / `commit` / `release` / `unsell`), `copyForEvent`, `sales`, `purchasersCsv`, serializers |
| `backend/src/api/routes/addOns.js` | `/organizations/:orgId/events/:eventId/add-ons` — list, presets, create / update / activate / deactivate / delete / reorder, `sales`, `purchasers.csv` |
| `backend/src/services/FeeService.js`, `frontend/src/lib/fees.ts` | `computeOrderFees` items take `taxable` (tax only on taxable listed value, fees on the whole subtotal; drift lands on the largest taxable line) |
| `backend/src/services/OrderService.js` | Add-on lines on `POST /orders`: validation, reservation after the tiers, Stripe line items, `OrderAddOn` rows from the fee breakdown, rollback |
| `backend/src/services/PaymentService.js` | `commit` on checkout completion, `release` on failure / expiry |
| `backend/src/services/RefundService.js` | `refundAddOnLine`, full-order refunds cover open lines |
| `backend/src/services/ApplicationFormService.js` | `applicationAmounts(lines, form, event, org)` (PASS / ABSORB across tier + add-on lines), tier offers in admin and public form payloads, `setTierAddOns`, `copyForms` tier id map |
| `backend/src/services/ApplicationService.js` | Lines at submission, `_takeCapacity` / `_releaseCapacity` covering add-ons, `updateAddOns`, `addOnsEditable`, list filter, CSV columns, pricing check |
| `backend/src/services/ApplicationPaymentService.js` | Itemised Checkout / pay-now line items, PaymentIntent description, `_markPaid` commits, overdue sweep releases, `expireSession` |
| `backend/src/services/ApplicationDigestService.js` | Per-form "Add-ons requested" totals and per-row lines in the daily digest |
| `backend/src/config/applications.js` | `ADD_ONS_CHANGED` template, `{{addOns.summary}}` merge field |
| `frontend/src/lib/addOns.ts` | Types (`AddOn`, `AdminAddOn`, `OrderAddOnLine`, `AddOnSales`), `offeredAddOns`, `addOnAllInPrice`, `addOnMaxQuantity`, `parseAddOnLines` |
| `frontend/src/components/AddOnPicker.tsx` | Quantity steppers shared by the event page, apply form and the admin edit dialog |
| `frontend/src/app/events/[eventId]/page.tsx`, `checkout/[eventId]/page.tsx`, `orders/[orderId]/page.tsx` | Storefront picker, `?addOns=` cart lines, checkout, confirmation |
| `frontend/src/app/events/[eventId]/apply/[formSlug]/page.tsx`, `apply/status/[applicationId]/page.tsx` | Apply-form picker + estimated total, itemised status page |
| `frontend/src/app/admin/events/[eventId]/edit/AddOnsSection.tsx` | Admin add-ons section (presets, dialog, activate / reorder) — saves through the API immediately |
| `frontend/src/app/admin/events/[eventId]/applications/EditAddOnsDialog.tsx`, `[applicationId]/page.tsx`, `page.tsx`, `forms/[formId]/page.tsx` | Application lines + pre-payment edit, list column + filter, tier "Add-ons offered" |
| `frontend/src/app/admin/events/[eventId]/analytics/page.tsx` | Add-on sales table + purchasers CSV |
| `backend/tests/contract/addOns.test.js`, `applicationsAddOns.test.js` | Contract tests (phase 1; phases 2–3) |
| `backend/tests/contract/savedAddOns.test.js`, `savedAddOnsBackfill.test.js` | Saved add-on API, attach, D9, duplication, receipt snapshot; dedupe backfill rules + idempotency (spec 037) |
| `frontend/e2e/add-ons.spec.ts`, `applications-add-ons.spec.ts`, `add-ons-analytics.spec.ts` | Playwright with the backend mocked |

## Configuration

No new environment variables. Application add-ons run inside the spec 011 flag:

| Variable | Required | Description |
|----------|----------|-------------|
| `APPLICATIONS_PAYMENTS_ENABLED` | No | PAID application forms (and therefore application add-ons) only accept submissions when `true` |

## How It Works

### Product
1. Staff with `addOns.manage` (ADMIN and ORGANIZER by default, spec 050-E) create add-ons on **Admin › Event › Edit › Add-ons** (or from a preset: Booth power, Extra vendor badge, Table & chairs, Parking pass, VIP lounge). Fields: name, description, price, `scope` (TICKET / APPLICATION / BOTH), `allTiers` or explicit tier attachments, `quantityTotal` (null = unlimited), `maxPerOrder`, `taxable`.
2. Ticket-tier attachments are picked in the add-on dialog. Application-tier attachments are picked in the **form editor's tier edit row** ("Add-ons offered"): `allTiers` add-ons are shown as included on every option; restricted ones are checkboxes saved with `PUT …/application-forms/:formId/tiers/:tierId/add-ons`.
3. Delete only while nothing has been sold (409 otherwise — deactivate). Event duplicate copies add-ons and remaps both kinds of attachment.

### Tickets
1. `GET /events/:id` carries `addOns[]` with `priceTierIds` (null when `allTiers`); the event page shows `AddOnPicker` once a ticket that offers an add-on is in the cart and passes lines to checkout as `?addOns=[{addOnId,quantity}]`.
2. `POST /orders` validates lines (scope, attachment to a cart tier, active, `maxPerOrder`), reserves add-ons **after** the tier reservations, adds them as items to the one `computeOrderFees` call with `taxable: addOn.taxable`, writes `OrderAddOn` rows from the per-item breakdown (own fee / tax allocation so a line refund is exact) and appends Stripe line items.
3. Checkout completion commits reservations to sold; failure / expiry / Stripe error release them. Tickets come from `OrderItem` only — add-on lines never create tickets or count in `Order.quantity`.
4. Refunds: per line (`POST /admin/orders/:orderId/add-ons/:orderAddOnId/refund`, all-in line amount, `unsell`) or whole order. Scan / redeem responses carry `addOns: [{ name, quantity }]` so venue staff can hand over the parking pass.

### Applications
1. Public form tiers carry `addOns` with a per-unit `applicantPays` under the form's fee mode; the apply form renders the picker for the chosen tier, shows an estimated total, and sends `addOns` in the submission.
2. `applicationAmounts(lines, form, event, org)` prices tier + add-on lines together (tier line taxable when the form is; each add-on its own flag). The totals live on the application's `Order` (spec 024); each add-on is an `OrderAddOn` line with its allocated fee / tax share, and `buyerLineTotal(line, feeMode)` (`services/orderLines.js`) is what the applicant pays for it, so Checkout / pay-now line items and the status page itemise exactly: the tier line is `Order.totalAmount − Σ lines`.
3. **Nothing is held at submission.** Approval takes the tier slot, then reserves add-ons in display order inside the same transaction; a sold-out add-on returns 409 `{ addOnId, name, remaining, requested, suggestion: 'EDIT_ADD_ONS' }` and the tier reservation rolls back. `capacitySlot` covers both: RESERVED (charge in flight / PAYMENT_DUE) holds them, APPROVED means sold; `_markPaid` commits, withdraw / applicant withdraw / overdue sweep release or unsell.
4. **Line edits before money moves**: `PATCH /admin/events/:eventId/applications/:id/add-ons` (ORGANIZER+) with the full desired set, allowed in SUBMITTED, WAITLISTED and APPROVED + PAYMENT_DUE (`addOnsEditable` in the admin payload carries the reason otherwise). Recomputes the snapshot at today's prices (so the price-changed note clears), moves held reservations, expires a pending pay-now session, writes an `ADD_ONS_CHANGED` decision (before → after and totals in `note`) and emails the `ADD_ONS_CHANGED` template. After PAID: refund an amount, never edit lines.
5. Organizer views: detail lines table + "Edit add-ons", list column + "Has <add-on>" filter (`?addOn=`, saved views carry it), CSV `addon:<name>` column per active-or-sold add-on, daily digest "Add-ons requested" totals per form.

### Saved add-ons (spec 037 phase 4)
An organization's add-ons are **saved add-ons** (`AddOnProduct`); an event's `AddOn` is its **offering** of one (`AddOn.productId`). The UI never calls them a "library": the event's add-on picker searches saved add-ons and offers "Create '<typed name>'" only when nothing matches case-insensitively (D2).

| Owned by the saved add-on (edit once) | Owned by the offering (per event) |
|---|---|
| name, description, scope, taxable | price (starts at `defaultPrice`), quantityTotal / Sold / Reserved, maxPerOrder, isActive, displayOrder, `allTiers` + tier attachments |

1. Shared fields are copied onto every offering (the `AddOn` columns stay until phase 6), whether edited through `PATCH /saved-add-ons/:id` or through the event's `PATCH …/add-ons/:addOnId`. **Price is never propagated** (D9): a new `defaultPrice` only seeds future attachments.
2. Names are unique per organization case-insensitively (trimmed), enforced in `AddOnProductService` under a per-organization advisory lock.
3. Every new offering has a product: `attach` (by `productId`, or `savedAddOn` to create one), the legacy `POST …/add-ons` (finds-or-creates by name; an explicit different scope / taxable is 409 `SAVED_ADD_ON_CONFLICT`), and event duplication (`copyForEvent` keeps `productId`, never creates products). One offering per saved add-on per event (409 `ADD_ON_ALREADY_ON_EVENT`).
4. Archive hides a saved add-on from the picker and its preset suggestion; its offerings keep selling. Attaching an archived one restores it.
5. The five presets (Booth power, Extra vendor badge, Table & chairs, Parking pass, VIP lounge) come back as `suggestions` on the list until a saved add-on uses the name.
6. **Receipt snapshot**: `OrderAddOn.name` is written at purchase (and at a pre-payment application rewrite); confirmations, emails, receipts, order detail, CSVs, the digest, scan results and refunds read it, so renaming a saved add-on never rewrites a past order.

**Backfill (history)**: phase 4 shipped a one-off dedupe script (`db:backfill:037-add-ons`), run on production 2026-09-26: 1 legacy add-on linked, 0 conflicts, 0 same-event duplicates. Phase 6 retired it: migration `20261012100000_spec037_cleanup` links any remaining unlinked row (one saved add-on per organization + exact name), then makes `AddOn.productId` NOT NULL, adds `@@unique([eventId, productId])` and turns the FK into `RESTRICT`. The shared fields stay copied on each offering on purpose — checkout, fee math and the capacity SQL read the offering without a join; `AddOnProductService` writes them through.

### Reporting
`GET …/add-ons/sales` returns per add-on `sold`, `reserved`, `remaining`, `revenue` (listed price × quantity of sold lines) split into `orders` (completed, unrefunded lines) and `applications` (paid, slot sold; plus `held` and `pending` counts). `…/add-ons/purchasers.csv` is one row per line across both sources. Both appear on **Admin › Event › Analytics**.

### Admin picker (spec 037 D2)

The event's Sales editor (`/admin/events/:id/edit/sales` › Add-ons) has one combobox, `SavedAddOnPicker` (`frontend/src/components/events/SavedAddOnPicker.tsx`), in place of the old preset menu and "+ Add Add-on":

- Empty query: the organization's saved add-ons (those already on the event are listed but disabled, "on this event") and the five suggestions.
- Typing searches `GET /organizations/:orgId/saved-add-ons?q=&eventId=`; **Create "<name>"** appears only when no saved add-on has that name (case-insensitive). It opens the add-on dialog, whose Create posts to the event's add-ons endpoint, which finds or creates the saved add-on.
- Picking a saved add-on or a suggestion calls `POST …/events/:eventId/add-ons/attach` at the saved default price; price, stock, per-order max and tiers are then edited per event.
- Each saved option has **Edit** (`SavedAddOnFlyout`: name, description, default price, scope, taxable — shared fields reach every event that offers it, price never does) and **Archive** (leaves the picker; events keep their offering). There is no saved add-ons page.
- Keyboard: ↑/↓ move, Enter picks, Escape closes (`role="combobox"` + `listbox`, `aria-activedescendant`).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations/:orgId/events/:eventId/add-ons` | member | Admin list with attachments and sales counters |
| GET | `…/add-ons/presets` | member | Static presets (kept for the current editor; the picker uses `suggestions`) |
| POST | `…/add-ons/attach` | `addOns.manage` (ADMIN, ORGANIZER) | Put a saved add-on on the event: `{ productId }` or `{ savedAddOn: { name, description?, defaultPrice, scope?, taxable? } }` plus offering fields → 201 `{ addOn, savedAddOn, createdSavedAddOn }` |
| GET | `/organizations/:orgId/saved-add-ons` | member | `?q=` (case-insensitive), `?scope=` (TICKET / APPLICATION also return BOTH), `?includeArchived=1`, `?eventId=` (adds `onEvent`) → `{ savedAddOns, suggestions, exactMatch?, canCreate? }` |
| GET | `/organizations/:orgId/saved-add-ons/:id` | member | One saved add-on with its `offerings[]` (event, price, sold) |
| POST / PATCH | `/organizations/:orgId/saved-add-ons[/:id]` | `addOns.manage` (ADMIN, ORGANIZER) | Create (409 `SAVED_ADD_ON_EXISTS`) / update name, description, defaultPrice, scope, taxable |
| POST | `/organizations/:orgId/saved-add-ons/:id/archive`, `/unarchive` | `addOns.manage` (ADMIN, ORGANIZER) | |
| POST / PATCH / DELETE | `…/add-ons[/:addOnId]` | `addOns.manage` (ADMIN, ORGANIZER) | Create / update (fields + `priceTierIds` / `applicationTierIds`) / delete (409 once sold) |
| POST | `…/add-ons/:addOnId/activate`, `/deactivate`, `…/add-ons/reorder` | `addOns.manage` (ADMIN, ORGANIZER) | |
| GET | `…/add-ons/sales` | member | Sales report (phase 3) |
| GET | `…/add-ons/purchasers.csv` | member | One row per line (phase 3) |
| PUT | `/admin/events/:eventId/application-forms/:formId/tiers/:tierId/add-ons` | `applications.forms` (ADMIN, ORGANIZER) | Restricted add-ons offered on a tier |
| PATCH | `/admin/events/:eventId/applications/:id/add-ons` | ORGANIZER+ | Replace lines before payment |
| POST | `/admin/orders/:orderId/add-ons/:orderAddOnId/refund` | ADMIN | Refund one line |
| POST | `/orders` | none | Body gains `addOns: [{ addOnId, quantity }]` |
| POST | `/events/:eventId/applications` | none | Body gains `addOns: [{ addOnId, quantity }]` |
| GET | `/events/:id`, `/events/:eventId/applications/forms/:slug` | none | Add-ons per event / per tier |

## Database

`AddOnProduct` (spec 037: org-scoped saved add-on — name, description, defaultPrice, scope, taxable, isArchived; unique on organization + name, case-insensitive in the service) → `AddOn` (event-scoped offering, nullable `productId`: scope, allTiers, price, quantityTotal / quantitySold / quantityReserved, maxPerOrder, taxable, isActive, displayOrder) → `PriceTierAddOn` / `ApplicationTierAddOn` (attachment rows) → `OrderAddOn` (unique on order + add-on; `name` snapshot (spec 037), immutable `unitPrice` plus allocated `platformFee` / `processingFee` / `tax`, `refundedAt`), used by ticket and application orders alike. `Refund.orderAddOnId` alongside `ticketId`. Migrations `20260918000000_add_ons`, `20260919000000_add_ons_applications`, `20261010100000_saved_add_ons` (spec 037: `AddOnProduct`, `AddOn.productId`, `OrderAddOn.name` backfilled from `AddOn.name`). See [Database Architecture](database-architecture.md).

## Gotchas

- Add-on lines are **never `OrderItem`s**: `Order.quantity` is the ticket count, `TicketService.createTicketsForOrder` and ticket analytics do not see them.
- Every path that releases tier reservations must also release add-on reservations (`AddOnService.release`); for applications `_releaseCapacity` and the overdue sweep do both.
- Lock order is fixed — tier, then add-ons by `displayOrder` — so concurrent approvals cannot deadlock. Keep it when adding paths.
- `quantityReserved` is counted for unlimited add-ons too (the conditional update only gates when `quantityTotal` is set), so sales reports see in-flight checkouts.
- Stripe ticket line items keep per-unit cent rounding (a ×2 line can drift a cent from the order total, as tiers already do); the order ledger is exact. Application line items use `buyerLineTotal` per line with quantity 1, so they sum exactly.
- The apply form's total is an estimate from per-unit figures; the server allocates fees across the real lines and can differ by cents.
- The ticket-tier attachment picker in the add-on dialog only lists **saved** tiers (unsaved tiers have no id yet); the form editor sets application-tier attachments because that page has no `orgId` in its URL.
- Fee mode is inherited from the parent (tickets PASS, applications the form's mode). Per-add-on fee mode, per-ticket add-ons, required add-ons and post-payment additions are out of scope (see `specs/012-add-ons/plan.md` §7).
- `updateAddOns` refuses a no-op with 400 and PAID / PROCESSING / REJECTED / WITHDRAWN with 409; it clears `stripeCheckoutSessionId` after expiring the session so the status page mints a fresh pay-now.
- The analytics page formats API amounts as dollars; before phase 3 it divided by 100 (a pre-schema-redesign leftover).

## Related Features

- [Applications](applications.md) — forms, tiers, approval charge, templates that add-ons extend
- [Price Tiers](price-tiers.md) — the capacity pattern add-ons reuse
- [Fee Calculation](fee-calculation.md) / [All-In Pricing](all-in-pricing.md) — per-item `taxable`
- [Guest Checkout](guest-checkout.md) — `POST /orders` lines
- [Email Notifications](email-notifications.md) — order confirmation lines, `ADD_ONS_CHANGED` template, digest
- [QR Code Scanning](qr-code-scanning.md) — hand-over box on scan results
