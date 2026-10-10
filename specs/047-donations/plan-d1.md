# Spec 047 — Donations, phase D1: gifts at event checkout and donate-only

**Status**: Plan, 2026-10-09. Nothing built. Amended 2026-10-10 for spec 050 (§0).
**Ask**: R1–R3 from [Donation platforms](../../docs/research/2026-10-08-donation-platforms.md) §9. A buyer adds a **one-time gift** to an event ticket purchase, choosing a preset amount or a custom one. A donor can also give on an event **without a ticket**, and that works on free, RSVP and sold-out events. Every gift gets a receipt, and refunds and disputes void it. The law behind each rule is in [Donation legal compliance](../../docs/research/2026-10-08-donation-legal-compliance.md) (cited as "compliance"). D1 ships dark behind `DONATIONS_ENABLED` / `NEXT_PUBLIC_DONATIONS_ENABLED`.

**Depends on** (all assumed merged before D1 code starts):

- **D0-B / C / D**, merged and in prod. They give per-line `platformFeeRate` + `feeMode` in `FeeService.js` ↔ `fees.ts` with `backend/tests/fixtures/fees.fixtures.json`, `OrderItem.feeMode`, `Order.organizationId` + nullable `eventId` (CHECK: null only for non-TICKET/APPLICATION kinds), and the `DONATION_TERMS` / `RECURRING_GIFT` drafts.
- **D0-S** (direct charges). Every money call carries `{ stripeAccount }`, `application_fee_amount` equals `platformFee` only, money webhooks arrive on the Connect endpoint, and refunds run on the org's account with `refund_application_fee` and no `reverse_transfer`.
- **DV** (`specs/047-donations/plan-dv.md`, PR #386). It adds `Organization.deductibilityStatus`, `privacyPolicyUrl`, `stateDisclosures`, and reuses the existing `companyName` (the legal entity name; shown as "Legal name" below) and `ein` columns. DV has no `legalName` or `receiptSignatory` column (IRS Pub 1771 needs no signature). It also adds the org admin's `DONATION_TERMS` acceptance, and the flat 3% ticket rate (`Organization.platformFeeRate`). D1 reads all of these. Any name DV changes is renamed here, never duplicated.

**Owner decisions used here (2026-10-09):**

- Option C (direct charges).
- Ticket checkout offers one-time gifts only. "Make it monthly" is D3.
- Presets default to $10 / $25 / $50 / $100 + Other. They are an org default with a per-event override. Minimum $1, maximum $10,000.
- Nothing is pre-selected, the gift starts at $0, and cover-fees starts unchecked and shows its exact amount.
- The gift line has `platformFeeRate 0` and `taxable false`. Its `feeMode` is `PASS` when the donor covers and `ABSORB` otherwise.
- One shared gift picker, never forked.
- No counsel. Receipt text comes from IRS Pub 1771 plus the state legends, approved by the owner.
- CA/HI geofence (`DONATIONS_GEO_BLOCK`) at launch.
- BNPL is off for any order with a gift.
- One ledger: `OrderKind.DONATION` for donate-only. A gift inside a ticket order keeps the order `TICKET`. The line is `OrderItemKind.DONATION`.
- `GiftReceipt` is an append-only snapshot, voided on refund.
- `/admin/orders` gets a Kind filter. There is never a separate donations money list.
- Gifts never appear in the tax report.
- Event analytics shows Gifts separately.
- Customers stays the one contact list.
- Buyer email is store-branded.

## 0. Amendment, 2026-10-10: spec 050 event setup wizard

Spec 050 ([plan](../050-event-setup-wizard/plan.md) §10, merged in PR #396) changes two of the surfaces D1 builds on. Nothing in D1's data model, money rules or compliance changes. Only where the UI mounts moves.

1. **The event Donations card moves into the wizard.** 050-P deletes the Sales editor (`admin/events/[eventId]/edit/sales`), and the wizard becomes the one form for every event field (050 decision 15). D1-G therefore builds the card as a standalone component, `components/gifts/EventGiftSettings.tsx`, and mounts it in the wizard's **Collect more** step (050-K, step key `collect-more`, preview anchor `#add-ons`).
   - **D1-G lands before 050-K:** it mounts the component on the Sales tab, and 050-K moves it.
   - **050-K lands first:** D1-G mounts it in the step.
   - **Either way, one component.** The Sales tab mount goes when 050-P deletes the tab.
2. **Review suggestion.** On the wizard's Review step (050-N), an eligible org with `acceptGifts` off sees one line: "Accept donations on this event?", which links to the Collect more step. The line is hidden when the org is not eligible or gifts are already on. D1-G wires it if 050-N has merged; otherwise 050-N reads the D1 payload once D1 has merged.
3. **Wizard visibility.** The step registry shows Collect more when the event is TICKETED, **or** when `NEXT_PUBLIC_DONATIONS_ENABLED` is on and the org is eligible (Connect direct charges on, DV-verified, `DONATION_TERMS` accepted). The eligibility answer comes from the D1 settings payload (§3.8). RSVP events see the step only for gifts, because they have no add-ons.
4. **The event page is split.** 050-G breaks `EventDetailClient.tsx` into a container plus `EventPageView` and section components. If 050-G lands first, the §4.4 entries go here:
   - "Can't make it? Give without a ticket" and the sold-out box link go in `EventTickets`;
   - the RSVP entry goes in `EventRsvp`;
   - the desktop sticky cart link goes in the cart component.

   In `preview` mode (wizard preview and signed draft preview, 050-F) the links render but are inert, like checkout.
5. **Preview payload.** 050-F's `GET …/preview-payload` returns the same `gifts` block as the public event payload (§3.8), so the wizard preview shows the gift entries. D1-B adds `gifts` to both payloads.
6. **Roles.** The event gift fields (`acceptGifts`, `giftWithoutTicket`, `giftPresetAmounts`, `giftAppeal`) ride on the event PATCH, which is ORGANIZER. That matches 050's decision that every wizard step is open to organizers. Org gift settings (`/admin/organization/gift-settings`), **Refund gift** and every other money-moving action stay ADMIN, unchanged.
7. **UI rules.** D1-F and D1-G follow spec 050 §11, the UI design contract, which is mobile first and WCAG 2.1 AA. Each loads the `frontend-ui-engineering` skill first and runs an axe check and a 390px Playwright run.

## 1. What exists today (origin/main e3a35ce)

| Piece | Where | What D1 needs from it |
|---|---|---|
| Kinds | `schema.prisma:1387-1397` `OrderKind { TICKET APPLICATION }`, `OrderItemKind { TICKET_TIER APPLICATION_TIER ADJUSTMENT WAIVER }` | Add `DONATION` to both |
| Order | `schema.prisma:1065-1120` | `organizationId` required, `eventId String?`, `quantity Int` (tickets only; add-ons don't count, Gotcha 16), `feeMode`, `orgReceives` |
| OrderItem | `schema.prisma:1124-1146` | `feeMode FeeMode?` (D0-B). No `refundedAt` (add-on lines have one on `OrderAddOn`). `@@unique([orderId, priceTierId])` (NULL tier ids don't collide) |
| Refund / Dispute | `schema.prisma:1209-1240`, `:1250-1286` | `Refund.ticketId` / `orderAddOnId` say which line. `Dispute.closedAddOnIds` lets a won dispute restore lines. Neither has an order-item equivalent |
| Fee math | `frontend/src/lib/fees.ts:113-197` ↔ `FeeService.js` | Per-line rate and mode work. **Processing (incl. the fixed $0.30) is split by listed value** (`:150`), so adding an uncovered $25 gift to a $20 ticket cuts the ticket line from $21.91 to $21.72. The FTC checklist needs "the ticket's all-in price is unchanged" (§4.1) |
| Order create | `OrderService.createOrder` `:168-524` | Refuses RSVP (`:209`) and past or unpublished events. Hold cap counts `TICKET` only (`:223-235`). Fee items `:311-328`, `order.create` `:333-391` (`orgReceives: fees.subtotal`, `feeMode: 'PASS'` hard-coded), Stripe line items `:401-430`, `checkoutOptionsFor` `:435`, session `:443-465` |
| Validator | `orderValidators.js:19-21` | `items` must hold at least one ticket type |
| Payment options | `PaymentSettingsService.checkoutOptionsFor` `:210-244`; BNPL types `config/payments.js:33-53` (`affirm`, `klarna`, `afterpay_clearpay`) | No per-order filter |
| Completion | `PaymentService.handleCheckoutCompleted` `:35-103` → `TicketService.createTicketsForOrder` `:45-145` | Ticket creation loops over **every** item and moves `priceTier` inventory (`:102-139`), which would crash on a gift line. Then `completeOrder` and email |
| Fail / sweep | `OrderService.failOrder` `:957-1008` decrements `priceTier` for every item; `sweepAbandoned` `:1064` selects `kind: 'TICKET'` | Both must skip gift lines and include `DONATION` orders |
| Refunds | `RefundService.refundOrder` `:33-168` (TICKET: full only), `refundTicket` `:336`, `refundAddOnLine` `:496-575`, `handleExternalRefund` `:583-700`; `stripeRefund.js` keys | "All lines closed" checks count tickets + add-on lines in `refundTicket` (`:445-461`), `refundAddOnLine` (`:550-563`) and `DisputeService._recomputeOrderStatus` (`:373-420`) |
| Disputes | `DisputeService._withdraw` `:234-316` (add-on lines closed only on a whole-order chargeback), `_reinstate` `:322-363`, `_notifyOrganizer` `:431` (org from the order, D0-C) | Same rule for gift lines |
| Email | `EmailService.sendOrderConfirmation` `:119-235` (`fromAs(org.name)`, store-branded; subject reads `order.event?.name`) | Gets a gift block |
| Money readers | `admin.js:1083-1092` dashboard gross by kind; `DashboardService.js:58-85`; `EventService.getEventAnalytics` `:1078-1115` (groupBy kind, `gross` = TICKET + APPLICATION totals); `mcp/src/tools.js:241-247`; `TaxService.collectedReport` `:222-281` (`taxableSales += subtotalAmount`) | A gift inside a TICKET order is inside `totalAmount` and `subtotalAmount`, so every one of these over-counts ticket sales and taxable sales once gifts exist |
| Orders list | `OrderService._orgOrdersWhere` `:805-838` (already takes `kind`); `OrdersListView.tsx:206-229` (Kind chips All / Tickets / Applications), `:356-359` badge | Add Gifts |
| Order detail | `admin/orders/[orderId]/page.tsx:429-450` (add-on lines + per-line Refund) | Add the gift line the same way |
| Customers | `CustomerService.js:90` source chips (`tickets` for any paid order) | Add `gift` |
| Data rights | `BuyerDataExportService.js:42-48, 133-146` (orders + items with `kind`); `ContactErasureService.js:3` (anonymise, never delete), `:90-110` (blockers) | Add `GiftReceipt` |
| Public event | `EventService.js:1376-1454` public payload (`hideTicketInventory` for RSVP, `addOns`) | Gets a `gifts` block |
| Checkout UI | `app/checkout/[eventId]/page.tsx` | Cart from `?items=` (`:82-108`), submit `:315-345`, fee items `:436-442`, summary `:520-588`, details form `:590+`. "Your cart is empty" when there are no items |
| Event page | `EventDetailClient.tsx` | `isSoldOut` `:180`, checkout handoff `:224-230`, sold-out box `:581-587`, `AddOnPicker` `:608-620`, RSVP pass, desktop sticky cart `:626-690` |
| Confirmation | `app/confirmation/page.tsx` (`clearCheckoutDraft` `:120`) | Shows tickets only |
| Precedent | Add-ons (spec 012): `AddOnPicker.tsx`, `OrderAddOn` snapshot `name`, `refundAddOnLine`, `closedAddOnIds` | D1 follows it line for line where it can |

## 2. Data model and migration

Two migrations, because Postgres can't use an enum value in the same transaction that adds it.

**`…_donations_d1_enums`**

```sql
ALTER TYPE "OrderKind" ADD VALUE 'DONATION';
ALTER TYPE "OrderItemKind" ADD VALUE 'DONATION';
```

**`…_donations_d1`**

```prisma
model OrderItem {
  // existing …
  refundedAt DateTime?          // gift line refunded or charged back (mirrors OrderAddOn.refundedAt)
  // DONATION line: priceTierId null, quantity 1, unitPrice = gift amount,
  // feeMode PASS (donor covered processing) | ABSORB, description = "Gift to <legal name>"
}

model Refund  { orderItemId String?  /* gift line refund */  orderItem OrderItem? @relation(...) }
model Dispute { closedOrderItemIds String[] /* gift lines this chargeback closed */ }

model GiftReceipt {                       // append-only; reprints exactly as sent
  id               String   @id @default(cuid())
  organizationId   String
  contactId        String
  orderId          String
  orderItemId      String
  number           Int                   // per-org sequence, 1, 2, 3 …
  amount           Decimal  @db.Decimal(10, 2)   // see §8 Q1
  fairMarketValue  Decimal  @db.Decimal(10, 2) @default(0)
  deductibleAmount Decimal  @db.Decimal(10, 2)   // amount when DEDUCTIBLE_170C, else 0
  textVersion      String                 // GIFT_RECEIPT_TEXT_VERSION at issue
  orgSnapshot      Json                   // legalName (from companyName), ein, address,
                                          // deductibilityStatus, legends[], privacyPolicyUrl, paragraphs[]
  issuedAt         DateTime @default(now())
  emailedAt        DateTime?
  voidedAt         DateTime?
  voidReason       String?                // REFUNDED | CHARGEBACK | GEO_BLOCKED
  supersedesId     String?  @unique       // a won dispute reissues a voided receipt
  @@unique([organizationId, number])
  @@index([contactId]) @@index([orderId])
}

model Organization {
  giftReceiptSeq    Int      @default(0)            // UPDATE … RETURNING inside the issuing tx
  giftPresetAmounts Int[]    @default([10, 25, 50, 100])   // whole dollars, ≤ 6, ascending
  giftMinimum       Decimal  @db.Decimal(10, 2) @default(1)
  giftMaximum       Decimal  @db.Decimal(10, 2) @default(10000)
  giftAppeal        String?                         // ≤ 140 chars
}

model Event {
  acceptGifts           Boolean @default(false)
  giftWithoutTicket     Boolean @default(true)      // donate-only allowed on this event
  giftPresetAmounts     Int[]   @default([])        // empty = organization default
  giftAppeal            String?                     // null = organization default
}
```

Constraints, in the same migration:

- `CHECK (kind <> 'DONATION' OR ("priceTierId" IS NULL AND "applicationTierId" IS NULL AND quantity = 1 AND "unitPrice" > 0))` on `OrderItem`.
- A partial unique index `ON "OrderItem"("orderId") WHERE kind = 'DONATION'`: one gift per order.
- `CHECK ("giftMinimum" >= 1 AND "giftMaximum" <= 10000 AND "giftMinimum" <= "giftMaximum")` on Organization. $10,000 is Jump's fraud ceiling, and an org may only lower it.
- A `GiftReceipt` trigger refuses DELETE. It refuses UPDATE except `emailedAt` null → value and `voidedAt` / `voidReason` null → value (the `AuditLog` trigger pattern, spec 048).

A donor-name snapshot is deliberately left out. The receipt renders the name from the Contact, so erasure (Gotcha 30) needs no receipt rewrite: the receipt keeps the gift record and loses the name. `GiftReceipt` is added to `backend/src/audit/features.js` (Gotcha 35). No backfill: nothing exists yet.

Deferred to the phase that needs them: `GiftReceipt.kind` (ANNUAL, D4), `OrderItem.donationCampaignId` (D2), tributes (D5), `PriceTier.fairMarketValue` (D4). `coverFees` is not a column, because `feeMode` already says it.

## 3. Backend

### 3.1 Fee rule for gift lines (amends D0-B, both libraries)

Problem: a single processing fee split by listed value moves the ticket's price when a gift is added (§1). New rule, applied **only when an order mixes 0% lines with rated lines**:

- `processingFee = round((ratedSubtotal + platformFee) × 2.9% + $0.30) + Σ round(net_0% × 2.9%)`.
- Each 0% line's processing share is its own `round(net × 2.9%)`. The rated lines split the first term by listed value, as today, and drift stays on the rated lines.
- Result: a ticket line's total is **identical** with or without a gift. A gift added to tickets costs `round(G × 2.9%)` to cover. A donate-only gift is a single 0% line, so today's formula applies and gives `round(G × 2.9% + $0.30)`.

Orders where every line is rated, or every line is 0%, keep today's formula, so every existing fixture case passes unchanged. D0-B's fixture cases that contain a 0% line (3–5, and 6 if it has one) are re-expected; nothing writes such orders yet. Known limit: "0% line" stands for "gift line". If a 0%-rated ticket ever exists, add an explicit `gift` item flag. Update the header comment in both files and Gotcha 12.

### 3.2 Request shape and validation

The endpoint stays `POST /orders`. A donate-only order is the same call with `items: []`.

```js
{ eventId, items: [...] | [], addOns?, contact, acceptances,
  gift?: { amount: 25 | 12.5, coverFees: false, billingState?: 'NC' } }
```

`orderValidators.js`:

- `items` may be empty only when `gift` is present.
- `gift.amount` is a number with at most 2 decimals, `> 0`.
- `coverFees` is a boolean.
- `billingState` is a two-letter `usStates.js` code, required when the geofence is on (§3.6).
- Range and settings checks need the org, so they run in the service:
  - `GIFTS_DISABLED` (400): `DONATIONS_ENABLED` off, `event.acceptGifts` off, or the org fails DV's eligibility rule (`deductibilityStatus` ∈ {`DEDUCTIBLE_170C`, `EXEMPT_NOT_DEDUCTIBLE`} and `DONATION_TERMS` accepted). Compliance §5 #20: only a verified charity, giving to itself.
  - `GIFT_OUT_OF_RANGE` (400): amount `< giftMinimum` or `> giftMaximum`, with both bounds in `details`.
  - `GIFT_REQUIRES_TICKET` (400): empty `items` and `giftWithoutTicket` off.
  - `GIFT_STATE_BLOCKED` (422): the state is in the geofence list.

Presets are not enforced by the server. Any amount in range is valid, and the presets are only UI.

### 3.3 `createOrder` changes (`OrderService.js`)

1. **Gift lookup.** Load the gift settings once with the event (`acceptGifts`, `giftWithoutTicket`, and the org's DV fields plus `gift*`), then validate as in §3.2.
2. **Donate-only branch** (`items.length === 0`):
   - Skip the RSVP refusal (`:209`), tier validation and reservation, and add-ons. A donate-only order may carry no add-ons.
   - Keep `PUBLISHED` and "not past" (§8 Q2).
   - The hold cap (`:223`) counts the order's own kind, so open DONATION checkouts are capped like ticket ones.
   - `kind: 'DONATION'`, `quantity: 0`, `eventId` kept: the gift belongs to the event, and event analytics uses it.
3. **Fee items** (`:313`) get a final item:
   ```js
   { unitPrice: amount, quantity: 1, taxable: false, platformFeeRate: 0,
     feeMode: coverFees ? 'PASS' : 'ABSORB' }
   ```
   Ticket and add-on items carry the DV org rate. Write `orgReceives: fees.orgReceives` and stop hard-coding `fees.subtotal`. `Order.feeMode` stays `PASS` (the ticket's), and the gift's mode lives on `OrderItem.feeMode`.
4. **The gift line** goes in `items.create` with `kind: 'DONATION'`, `description: 'Gift to <companyName>'` (snapshot), `feeMode`, and its fee breakdown. It is never part of `Order.quantity`.
5. **Stripe line item.** `name: 'Gift to <companyName>'`, `unit_amount` = the line total in cents. When the donor covers, the description reads "Includes $0.73 to cover card processing". No line, anywhere, calls a fee a "donation" (compliance §2.7). Session `metadata.giftItemId`.
6. **`checkoutOptionsFor(org, charge, { gift: true })`:**
   - drops `affirm`, `klarna` and `afterpay_clearpay` (BNPL off);
   - the caller adds `billing_address_collection: 'required'`, so the completion handler can read the billing state (§3.6);
   - `application_fee_amount` is still `fees.platformFee` cents (D0-S), which the gift's 0% rate keeps unchanged.
7. **Rollback paths** (`:466-484`, `failOrder` `:983-1004`) release `priceTier` only for `TICKET_TIER` items. `sweepAbandoned` selects `kind: { in: ['TICKET', 'DONATION'] }`.

### 3.4 Completion (`PaymentService.handleCheckoutCompleted`)

Order of steps, all idempotent on `order.status` as today:

1. `TicketService.createTicketsForOrder` filters `kind: 'TICKET_TIER'` and is **skipped** for `DONATION` orders.
2. `completeOrder`, then opt-ins.
3. **Geofence** (§3.6). The handler receives the session object it already has (`webhooks.js:136-153`). The API fallback, `verifyAndCompleteOrder`, passes the retrieved session.
4. `GiftReceiptService.issue(tx, orderItem)`, for a gift line that is not blocked:
   - takes `Organization.giftReceiptSeq` under `UPDATE … RETURNING`;
   - builds the snapshot from the org's DV fields and `config/giftReceipt.js`;
   - writes the row.
   One receipt per gift line, and a redelivery finds the existing row (unique `orderItemId` where `voidedAt IS NULL`, checked in the tx).
5. Email (§3.5), which stamps `emailedAt`.

### 3.5 Receipt and email

- `backend/src/config/giftReceipt.js` holds `GIFT_RECEIPT_TEXT_VERSION` and a pure `receiptParagraphs(snapshot, gift)` returning the paragraphs of §5. The paragraphs are frozen into `orgSnapshot.paragraphs`, and every surface (email, confirmation, buyer account, admin) renders them. One text, reproducible as sent.
- `sendOrderConfirmation` gains a **Your gift receipt** block after the tickets: the receipt number, then the paragraphs.
  - For a `DONATION` order the same email is the receipt. Subject: `Thank you for your gift to <Org> — receipt #<n>`. No tickets block, no QR copy.
  - Sender `fromAs(org.name)` (store-branded, Gotcha 34). Transactional, with the existing order link (compliance §5 #15).
- `sendGiftReceiptVoided(receipt, { reason })` is the corrected acknowledgment: "Receipt #n for your $25.00 gift to <Org> on <date> is void because the gift was refunded / charged back. Do not use it for your tax records." When a dispute is reversed and a new receipt issued, the email carries the new number.
- Staff: `POST /admin/orders/:orderId/gift-receipt/resend` (ORGANIZER+) re-sends the current receipt, or the void notice.

### 3.6 Geofence (`DONATIONS_GEO_BLOCK`)

- Env: a comma-separated list of state codes. **Unset with `DONATIONS_ENABLED=true` means `CA,HI`** (fail closed, compliance L2). `none` disables it. One helper, `donationGeoBlock()` in `config/donations.js`.
- **Before payment:** the picker asks for the billing state once an amount is chosen. The server refuses a blocked state (`GIFT_STATE_BLOCKED`) and records nothing.
- **At completion** (the enforcement point; the UI answer is only a hint):
  - When `session.customer_details.address` is US and the state is blocked, the gift line is refunded through `RefundService.refundGiftLine(…, { reason: 'DONATION_GEO_BLOCKED', initiatedBy: null })`. No receipt is issued, and the email says why.
  - A `DONATION` order is refunded whole through `refundOrder`.
  - Tickets in the same order stand: the ticket purchase is not a solicitation.
  - Logged as `event: 'gift_geo_blocked'`.

### 3.7 Refunds, voiding, disputes

- **`RefundService.refundGiftLine(orderItemId, { reason, initiatedBy })`** mirrors `refundAddOnLine`:
  - order row lock, then `amount = buyerLineTotal(line, line.feeMode)`;
  - `Refund.orderItemId`, idempotency key `order-gift:<itemId>`;
  - stamp `refundedAt`, then void the receipt and send the void email after commit.
  - Route: `POST /admin/orders/:orderId/gifts/:orderItemId/refund` (`requireAdmin`, ownership via `order.organizationId`).
  - Gift lines are refunded whole; there are no partial gift refunds (§8 Q7).
- **`refundOrder`**:
  - TICKET orders: the full refund also stamps open gift lines.
  - DONATION orders: take the TICKET path (no tickets, no add-ons).
  - Both void the receipt.
- **One "lines open" helper**, `openOrderLines(tx, orderId)`: active tickets + open add-on lines + open gift lines. It replaces the three copies (`RefundService:445-461`, `:550-563`, `DisputeService:405-419`), so REFUNDED still means every line is closed and the money is back.
- **`handleExternalRefund`** (a dashboard refund on the org account):
  - DONATION order: record the refund, stamp the gift line when the refund covers it, void.
  - TICKET order: tickets are voided cheapest-first as today, and the gift line is closed only when the order is fully refunded.
- **Disputes** (`_withdraw`):
  - A whole-order chargeback closes open gift lines (`closedOrderItemIds`) and voids receipts (`CHARGEBACK`).
  - A partial chargeback leaves the gift and adds "Check the gift receipt on this order" to the organizer alert (§8 Q9).
  - `_reinstate` (won) reopens those lines and **issues a new receipt** with `supersedesId` set. The voided one stays.
  - Under D0-S the dispute is the org's on its own account, so there is no transfer reversal to do (compliance §5 #25, retargeted by option C).
- `GiftReceiptService.voidFor(tx, orderItemId, reason)` is the one void path every caller above uses.

### 3.8 Settings and public payload

- Org: `GET/PATCH /admin/organization/gift-settings` (ADMIN), a partial-PATCH validator (root AGENTS "Backend Patterns"). Presets must be unique ascending whole dollars, 1–6 of them, each within [min, max].
- Event: `acceptGifts`, `giftWithoutTicket`, `giftPresetAmounts`, `giftAppeal` on the existing event PATCH validator. Turning `acceptGifts` on needs the org to be eligible (400 `GIFTS_NOT_ELIGIBLE`).
- Public event (`EventService.js:~1454`): `gifts` is `null` unless `DONATIONS_ENABLED`, `acceptGifts` and the org is eligible. Otherwise:
  ```js
  gifts: { presets, minimum, maximum, appeal, withoutTicket,
           recipient: { legalName /* Organization.companyName */, ein, deductibilityStatus, privacyPolicyUrl, email, legends: [{ state, text }] },
           blockedStates: ['CA','HI'] }
  ```
  It is present on RSVP events as well: `hideTicketInventory` hides tiers, not gifts.

### 3.9 Reporting, export, erasure

- **Gift money** is read from DONATION lines in one helper, `giftTotals(where)` in `paidStatuses.js`'s neighbour `giftMoney.js`. It returns `{ count, gross, orgReceives, refunded }`, where gross is the line total from `buyerLineTotal` and refunded is the line total where `refundedAt` is set.
- **Ticket figures** = order totals − gift line totals:
  - `admin.js:1083-1092` (dashboard; adds `giftsGross`);
  - `DashboardService.js:58-85`;
  - `EventService.getEventAnalytics` (`gross` excludes gifts; adds `gifts`);
  - `mcp/src/tools.js:241-247`.
- **Tax report** (`TaxService.js:222-281`):
  - `kind: { in: ['TICKET','APPLICATION'] }` drops donate-only orders;
  - `taxableSales` subtracts gift lines' `unitPrice`;
  - gift-line refunds (`orderItemId` set) are left out of the refunded-tax estimate.
  - Compliance §5 #22.
- **Orders list:** a `gift=true` query matches `kind = 'DONATION'` **or** `items.some({ kind: 'DONATION' })`. The CSV gains `giftAmount`, `giftFeesCoveredBy` (donor/organization), `giftReceiptNumber` and `giftReceiptStatus`. That is the per-gift report for the charity (compliance §5 #10, #16).
- **Customers:** `CustomerService.js:90` adds a `gift` source chip when a paid order has a gift line. There is no new list.
- **Export:** `BuyerDataExportService.build` adds `giftReceipts` (number, date, amount, deductible, status). **Erasure:** receipts are kept, because they carry no PII. Pending DONATION orders already block erasure through `PENDING_ORDER` (`ContactErasureService.js:104`). Compliance §5 #23.

## 4. Frontend

### 4.1 `components/gifts/GiftPicker.tsx` (the one picker)

The picker is controlled and stateless about money. Checkout, donate-only, D3's `/donate` and D2's DonationForm section all mount it. D3 adds a `frequency` prop, and nothing forks the component.

```ts
props: { presets: number[]; minimum: number; maximum: number;
         value: { amount: number | null; coverFees: boolean; billingState: string | null };
         onChange(v): void; coverFeeAmount: number;   // parent computes with fees.ts
         orgName: string; appeal?: string | null; blockedStates: string[];
         required?: boolean /* donate-only */; idPrefix: string }
```

**Layout, mobile first:**

- A `<fieldset>` whose `<legend>` reads "Add a gift to {Org}" plus "(optional)" in checkout. The appeal sits below it as plain text.
- Native radio inputs styled as buttons: presets plus **Other**, `name={idPrefix}-amount`. Two columns under `sm`, one row from `sm`. Each target is at least 48 px tall, above the WCAG 2.2 2.5.8 minimum. **Nothing is checked initially**, and the gift is $0.
- Once an amount is chosen, a text button **Remove gift** appears, because radios can't be unchecked.
- **Other** reveals `<input inputMode="decimal" autocomplete="off">` labelled "Other amount (USD)", with a visual `$` prefix.
  - Validated on blur and on submit against min/max: `aria-invalid`, plus an error `id` in `aria-describedby`, e.g. "Enter an amount from $1.00 to $10,000.00".
  - The server repeats the check.
- **Cover fees:** a checkbox shown only when the amount is above 0, **unchecked**. Its label carries the exact amount: "Add $0.73 to cover card processing so {Org} receives the full $25.00". The figure comes from `fees.ts` for the current cart (§3.1).
- **Billing state:** when `blockedStates` is non-empty and an amount is chosen, the existing `StateSelect` (`components/StateSelect.tsx`), labelled "Billing state". A blocked state disables the gift ("{Org} can't accept gifts from California yet. Your tickets are not affected.") and removes it from the cart.
- A visually hidden `aria-live="polite"` region announces "Gift of $25.00 added. Total $46.91." on change.
- Colors come only from the `brand` tokens (Gotchas 6 and 7). Visible focus rings, `motion-reduce` respected, AA contrast in both themes, no layout shift when Other expands (space reserved).

### 4.2 `components/gifts/AboutThisGift.tsx`

The compliance §3.5 block, always visible, never collapsed. It sits under the picker on both surfaces, in compact body-size text. It is built from `gifts.recipient`:

1. Your gift is made to {Legal name} (EIN xx-xxxxxxx), not to Eventimus. Eventimus provides the payment page.
2. Deductibility (§5 copy). The §6113 sentence is its own paragraph at body size.
3. Fees: "Eventimus takes no fee on gifts." The processing amount, and whether {Org} receives the full gift, follow the cover-fees choice. "100% goes to {Org}" appears only when the box is checked.
4. Timing: "Your gift goes to {Org}'s Stripe account when you pay, and reaches its bank on {Org}'s payout schedule."
5. Data: "{Org} receives your name, email and gift details. Eventimus never sells donor data." Plus a link to `privacyPolicyUrl` when set.
6. Refunds: "Contact {Org} at {email}."
7. The enabled state legends, bordered and bold.

### 4.3 Checkout (`app/checkout/[eventId]/page.tsx`)

- **Gift with tickets:**
  - The section mounts in the details form, after name and email and before consent and Pay.
  - In the summary the gift is its own `CartLineItem` named "Gift to {Org}". It is followed by "Card processing (covered by you)" only when the donor covers. The totals label changes from "Tickets" to "Tickets & gift".
  - The ticket line amounts do not move (§3.1).
  - The gift is shown only when `event.gifts` is set and `NEXT_PUBLIC_DONATIONS_ENABLED` is on.
- **Donate-only:** `/checkout/[eventId]?gift=1` with no `items`. No new route, so Gotcha 22 doesn't apply.
  - The heading is "Give to {Org}", and the picker comes **first**, `required`.
  - Then details, then Pay: "Give $25.00".
  - The mobile summary row reads "Gift" instead of "N tickets". `CheckoutSteps` shows Gift → Details → Payment.
  - With `gifts` null it shows "Gifts aren't open for this event" and a link back.
- The checkout draft (`lib/checkoutDraft.ts`) stores `gift`, so a Stripe cancel restores it.
- Error mapping: the four codes in §3.2 become inline messages on the picker.

### 4.4 Event page (`EventDetailClient.tsx`)

> Amended (§0.4): if spec 050-G has merged, these entries go in `EventTickets`, `EventRsvp` and the cart component of `EventPageView`, and render inert in `preview` mode.

When `gifts?.withoutTicket` is set and the event isn't past, a secondary **Give to {Org}** link to `?gift=1` appears in three places:

- under the tier list, as "Can't make it? Give without a ticket";
- inside the sold-out box (`:581`);
- under the RSVP pass.

The desktop sticky cart gets a small "or give without a ticket" link. Nothing is added to the mobile floating bar, which keeps one primary action.

### 4.5 Confirmation and receipts

- **`components/gifts/GiftReceiptBlock.tsx`** renders `receipt.paragraphs`, the number and the status (a "Void" banner when voided). It is used on:
  - `confirmation/page.tsx`: for a `DONATION` order the heading is "Thank you for your gift", and the tickets section is hidden;
  - `orders/[orderId]/page.tsx`;
  - the buyer account receipt (`organizations/[orgId]/account/(member)/orders/[orderId]/receipt/page.tsx`).
- The `GET /orders/:id` payload gains `gift: { amount, coverFees, lineTotal, refundedAt, receipt: { number, issuedAt, voidedAt, paragraphs } } | null`.
- **"Make it monthly" is D3.** Its place is directly under `GiftReceiptBlock` on the confirmation page. D1 adds nothing there.

### 4.6 Admin

- **Settings › Donations** (DV's page; if DV names it differently, use that page): a "Gift amounts" card with presets as a tag-style list of number inputs, min, max and appeal. Saved through the partial PATCH.
- **Event Donations card**, `components/gifts/EventGiftSettings.tsx`, mounted in the spec 050 wizard **Collect more** step. If 050-K has not merged yet, it is mounted on the Sales tab (`admin/events/[eventId]/edit/sales`) until it has; see §0.1. The card holds:
  - **Accept donations**, disabled with a link to Settings › Donations until the org is eligible;
  - **Allow gifts without a ticket**;
  - amounts: "Use organization amounts" / "Custom for this event";
  - an appeal override.
- **Orders** (`OrdersListView.tsx:206-229`):
  - Kind chips become All / Tickets / Applications / **Gifts**. Gifts sends `gift=true`; Tickets keeps `kind=TICKET`.
  - The row badge reads "Gift" for DONATION and "Ticket + gift" for a ticket order with a gift.
- **Order detail** (`:429-450`):
  - a gift row (amount, "Fees covered by donor $0.73" or "Fees absorbed $1.03", receipt `#n` with Issued / Emailed / Void);
  - **Refund gift** (ADMIN) and **Resend receipt**;
  - refund history labels `orderItem` refunds "Gift".
- **Event analytics:** a **Gifts** card (count, gross, received, refunded) next to ticket revenue, never summed into it. The dashboard shows `giftsGross` as its own figure when it is above 0.

## 5. Copy (owner-approved before launch, D0-E3)

Receipt paragraphs (`config/giftReceipt.js`), from IRS Pub 1771 and compliance §2.2–2.4 and §3.3:

- **Header.** "Gift receipt #{n} · {Legal name} · EIN {ein} · {address}". Then "Donor: {Contact name or 'Donor'}", "Date of gift: {paidAt, Organization time zone}" and "Amount: ${amount}".
- **Goods and services.** "No goods or services were provided in exchange for this gift."
  - In a ticket order, add: "Your tickets are a separate purchase at their listed price and are not part of this gift."
  - That keeps §6115 out of scope, because the gift line itself buys nothing.
- **DEDUCTIBLE_170C.** "{Legal name} is a tax-exempt organization. Your gift is deductible as a charitable contribution to the extent allowed by law. Keep this receipt for your tax records."
- **EXEMPT_NOT_DEDUCTIBLE.** §6113 safe harbour, its own paragraph: "Contributions or gifts to {Legal name} are not deductible as charitable contributions for Federal income tax purposes." Then "Keep this receipt for your records." No deductibility wording anywhere else (compliance §5 #1, #2).
- **Recipient.** "This gift was made to {Legal name}. Eventimus processed the payment on {Legal name}'s behalf and is not the recipient."
- **Legends.** Each enabled `stateDisclosures` legend, rendered bold and bordered, at no less than body size. NC's text is per G.S. 131F-9(c) with the stored phone number.
- No SSN or TIN is ever asked for or printed.

"About this gift" block: §4.2. Void notice: §3.5. Every amount on the page and in the email uses `formatPrice`.

## 6. Compliance checklist (compliance §5 rows)

| §5 row | D1 delivers | Where |
|---|---|---|
| #1 deductible wording gated | Only `DEDUCTIBLE_170C` gets deductibility text; eligibility from DV | §3.2, §5 |
| #2 §6113 | Own paragraph, body size, picker block + receipt | §4.2, §5 |
| #3 / #4 acknowledgment | Every gift, any amount: legal name, EIN, date, amount, goods/services line, keep-for-records, no SSN, sent at completion in the charity's name | §3.4–3.5, §5 |
| #9 refunds void receipts | `voidedAt` + `supersedesId`, corrected email, CSV shows status | §3.7 |
| #10 990 data (partial) | Orders CSV gift columns; Schedule B totals → D4 | §3.9 |
| #12 FTC fees | $0 start, nothing pre-selected, cover-fees unchecked with exact amount, named line before Pay, ticket all-in unchanged (§3.1), no fee called a donation | §3.1, §3.3, §4.1 |
| #13 portal disclosures | "About this gift" on both surfaces, summarised on receipt | §4.2 |
| #15 CAN-SPAM | Receipt is transactional, store-branded | §3.5 |
| #16 AB 488 / HRS 467B | `DONATIONS_GEO_BLOCK` (fail-closed CA,HI), pre-payment refusal + refund at completion; charity per-gift CSV | §3.6, §3.9 |
| #17 state legends | From DV `stateDisclosures` on picker block and receipt | §4.2, §5 |
| #20 co-venturer | Gifts only for eligible orgs, to themselves | §3.2 |
| #22 sales tax | Gift line `taxable: false`, always optional, out of the tax report; a required "donation" must be a tier | §3.3, §3.9 |
| #23 privacy | Export + erasure; privacy URL on the page | §3.9, §4.2 |
| #25 disputes / refunds | Whole-order chargeback voids, won reissues; on the org's account under D0-S | §3.7 |
| L1–L8 | L1 Stripe answer (D0-E1); L2 geofence on (owner); L4 + L6 DV; L5 owner-approved text (E3); L7 settled by option C; L8 spec 023 phase 1 | §7 gate |

## 7. Tests, rollout, cards

### Tests

- **Unit (fixture `fees.fixtures.json`, Jest + Vitest).** Re-expect D0-B mixed cases 3–6 and add:
  - (7) ticket + gift ABSORB: the ticket line equals the ticket-only order exactly;
  - (8) ticket + gift PASS: gift processing = `round(G × 2.9%)`;
  - (9) donate-only PASS / ABSORB: `round(G × 2.9% + 0.30)`;
  - (10) DV 3% ticket + gift.
  The existing invariants run on every case.
- **Unit:** `receiptParagraphs` per deductibility status and legend set (snapshot); `donationGeoBlock()` parsing; the gift validator.
- **Contract:**
  - `POST /orders` with a gift: the line, `feeMode`, `orgReceives`, the Stripe gift line item, `application_fee_amount` unchanged by the gift, no BNPL types, `billing_address_collection`.
  - Donate-only on RSVP, sold-out and free-tier events → `DONATION`, `quantity 0`, no tickets.
  - Each 400/422 code.
  - Webhook completion issues receipt #1 then #2 per org, sequenced separately for a second org. A redelivery issues none.
  - A geofenced completion refunds the gift and issues no receipt.
  - `refundGiftLine`, full `refundOrder` and an external refund each void the receipt and send the void email. Order status goes through `openOrderLines`.
  - A whole-order dispute voids; won reissues with `supersedesId`.
  - `failOrder` / sweep on a gift order.
  - Tax report excludes gifts; analytics `gifts`; orders `gift=true` + CSV columns; export lists receipts; erasure keeps them.
  - The append-only trigger refuses UPDATE and DELETE.
  - Webhook tests namespace event ids (Stripe webhooks gotcha).
- **Playwright** (mocked API, `page.route`; admin via `signInAsStaff`, Gotcha 11):
  - the checkout picker: no preset checked, preset → summary line and CTA total, cover-fees label amount, Other validation message, Remove gift, blocked state;
  - donate-only from the RSVP event page;
  - confirmation for a DONATION order;
  - admin Orders Gifts chip, order detail gift row and refund dialog, Settings gift amounts.
  - An axe scan on the picker in light and dark themes. Assertions scoped to visible copies.

### Rollout

- `DONATIONS_ENABLED` (backend). Off means `gifts: null` everywhere, gift input gets 400 `GIFTS_DISABLED`, and settings endpoints still save.
- `NEXT_PUBLIC_DONATIONS_ENABLED` (frontend, build-time). Off hides the picker, the event-page links and the admin cards.
- `DONATIONS_GEO_BLOCK` (backend): fail-closed `CA,HI`.
- All three go in the root AGENTS.md env table.
- Production stays off until D0-S is live with Connect on, DV is shipped, the E1 Stripe answer is on file, E3 text is approved and spec 023 phase 1 is done. Test mode first, with a real connected test account: a gift with tickets, donate-only, a refund and a dispute.

### Cards (each its own PR, CI green)

| Card | What | Depends on |
|---|---|---|
| **D1-A** | Schema (§2, both migrations, trigger, audit registration) + fee rule §3.1 in both libraries + fixture cases | D0-B/C merged |
| **D1-B** | Checkout backend: validator, `createOrder` gift + donate-only, BNPL filter, billing address, ticket-only inventory paths (`TicketService`, `failOrder`, sweep), settings endpoints, public `gifts` payload (+ the 050-F preview payload if merged, §0.5), geofence pre-check | A, DV, D0-S |
| **D1-C** | Completion: receipts (`GiftReceiptService.issue`, `config/giftReceipt.js`), geofence refund at completion, confirmation/receipt email, resend route, `gift` on order payloads | B |
| **D1-D** | Refunds and disputes: `refundGiftLine` + route, `openOrderLines`, full/external refund handling, dispute close/reinstate, void email | C |
| **D1-E** | Money readers: `giftTotals`, dashboard / analytics / mcp exclusions, tax report, orders `gift` filter + CSV, customers chip, export | A (parallel with B–D) |
| **D1-F** | Donor UI: `GiftPicker`, `AboutThisGift`, checkout + donate-only, event-page entries (in `EventPageView` sections if 050-G merged, §0.4), `GiftReceiptBlock` on confirmation / order / account receipt, Playwright (390 px + axe) | B (API shape), C for receipts; rebase on 050-G if merged |
| **D1-G** | Admin UI: Settings gift amounts, `EventGiftSettings` in the wizard Collect more step (Sales tab only until 050-K merges, §0.1), the Review suggestion (§0.2), Orders Gifts chip + badges, order detail gift row/refund/resend, analytics Gifts | D, E; coordinate with 050-K / 050-N |
| **D1-H** | Docs: `docs/wiki/features/donations.md`, AGENTS Gotchas 12/16/17 + a donations gotcha, env table, launch checklist rows | F, G |

## 8. Done when, and open questions

**Done when:**

- A–H are merged with CI green.
- In test mode on a connected account:
  - a ticket + $25 gift (covered and uncovered) charges one payment, shows the gift as its own line with the ticket price unchanged, issues receipt #n in the charity's name, and sends one store-branded email;
  - donate-only works on an RSVP and a sold-out event;
  - a gift refund voids the receipt and emails the correction;
  - a CA billing address is refunded with no receipt;
  - the tax report shows no gift money, and analytics shows Gifts apart.
- Every existing fee fixture case passes unchanged.

**Open questions for the owner** (each has the default the plan builds):

1. **Receipt amount when the donor covers fees.** Default: the whole gift line (gift + covered processing), with "includes $0.73 you added to cover card processing" printed. The charity receives it and nothing is given back. The alternative is the gift amount only.
2. **Donate-only after the event.** Default: closed once the event date passes, the same as ticket sales. D3's `/donate` covers year-round giving.
3. **Gifts on application (vendor) orders.** Default: no.
4. **Geofence default.** Default: fail closed to `CA,HI` whenever donations are on.
5. **Org limits.** Default: an org may raise the minimum and lower the maximum, never above $10,000.
6. **Non-charity organizers** (`NOT_EXEMPT`, `NOT_VERIFIED`). Default: no gifts at all (§5 #20).
7. **Donor self-serve gift refunds.** Default: none. Staff refund gifts in Orders. The spec 031 policy stays tickets-only (Gotcha 23).
8. **Receipt number format.** Default: a plain per-org integer (`#1`, `#2`, …).
9. **A partial chargeback on a ticket + gift order.** Default: the gift stays receipted and the organizer alert says to check it.

**Deferred:**

- **D3:** "Make it monthly" on the confirmation page; the org-level `/donate` page; the monthly toggle on `GiftPicker`.
- **D2:** campaigns, goals and the DonationForm section (they mount the same picker).
- **D4:** gala FMV / quid-pro-quo tiers (`PriceTier.fairMarketValue`, §5 #6–8), annual statements (#5), 990 exports (#10 full), the per-org dispute-rate alert, and `refund.failed` owed-to-donor tracking.
- **D5:** tributes.
- **Not planned:** ACH for gifts; staff-entered offline gifts.
