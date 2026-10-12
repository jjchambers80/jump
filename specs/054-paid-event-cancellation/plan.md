# Spec 054 — Cancelling a paid event

Status: **Planned** (2026-10-12). Found while building spec 053: cancelling a paid event only flips `Event.status` to `CANCELLED`.

## 1. Problem (as built, 2026-10-12)

`POST /organizations/:orgId/events/:eventId/cancel` → `EventService.cancelEvent` (`backend/src/services/EventService.js`):

| What | Today | Risk |
|---|---|---|
| Buyer email | None. Only RSVP guests get `rsvp.cancelled` (spec 053) | Buyers learn from social media or at the door |
| Refunds | None. Staff must open every order in `/admin/orders` and refund it by hand | Hundreds of clicks, missed orders, chargebacks |
| Tickets | Stay `VALID`; scan and check-in check the ticket's status only, never the event's | A cancelled event's tickets still scan |
| Checkouts in flight | An open Stripe Checkout session can still be paid; `PaymentService.handleCheckoutCompleted` completes a `PENDING` order without looking at the event | A buyer pays for a cancelled event and gets tickets |
| Event page | `getEventById` serves only `PUBLISHED` → **404** | Old links and emails land on "not found" |
| Vendor applications | Untouched: open holds stay held, paid application orders are not refunded, nobody is told | Vendors paid for a space at an event that is not happening |
| Guard | `requireOrganizer` only. Any ORGANIZER can cancel | One click with money consequences, no step-up |

New sales already stop (`OrderService` refuses a non-`PUBLISHED` event; applications refuse too).

## 2. Goal

Cancelling a paid event is one deliberate action that:

1. stops all new money at once (checkout, late payments, vendor holds);
2. tells every buyer and vendor, in the store's words (a spec 053 notification);
3. refunds every order automatically, which is the default, or leaves refunds to staff when they choose that explicitly;
4. shows progress and failures on the event until every order is settled;
5. leaves the event page up with a "This event was cancelled" notice instead of a 404.

Out of scope: **postponing / rescheduling** (tickets carry over to a new date; a separate spec), partial cancellation (one day of a multi-day event), store credit (spec 031 deferred it), and wallet passes (spec 006 is tabled).

## 3. Decisions to confirm (defaults in bold)

1. **Refund mode.** The dialog offers **"Refund every order now" (default, recommended)** or "I'll handle refunds myself". The second still emails buyers, with wording that says the store will be in touch. Rationale: buyers expect a refund for a cancelled event, and refunding in bulk stops chargebacks before they start. Several US states require refunds for cancelled events. The owner has no counsel yet, so the safe default is to refund everything.
2. **Who absorbs fees.** Jump's platform fee is returned with each refund (`refund_application_fee`, pro rata, already how `RefundService` works). Stripe does not return its processing fee, so the organization absorbs it. **The default is to keep both behaviours as they are**, and the dialog states the organization's cost before confirming. The alternative, Jump keeping its fee on cancellations, is a pricing decision for the owner.
3. **Self-serve refund fee** (spec 031 `feeAmount`): **never retained on a cancellation**. Buyers get the full amount paid back, including any fee kept on an earlier partial refund.
4. **Permission.** Cancelling stays `events` (staff), but **"Refund every order now" needs `orders.refund`** and a step-up (`requireRecentAuth` / `withReauth`), like other money moves. A role without `orders.refund` sees only "I'll handle refunds myself".
5. **Irreversible.** A cancelled event cannot be un-cancelled (refunds are final). The dialog says so and asks for the event name to be typed.

## 4. Design

### 4.1 Model

```prisma
model EventCancellation {
  id           String   @id @default(cuid())
  eventId      String   @unique
  mode         EventCancellationMode // REFUND_ALL | MANUAL
  message      String?  // optional note from the store, appended to the buyer email
  initiatedById String?
  createdAt    DateTime @default(now())
  completedAt  DateTime? // every item settled
  items        EventCancellationItem[]
}

model EventCancellationItem {
  id             String   @id @default(cuid())
  cancellationId String
  orderId        String   @unique
  status         EventCancellationItemStatus // PENDING | REFUNDED | SKIPPED | FAILED
  skippedReason  String?  // FREE_ORDER, ALREADY_REFUNDED, OPEN_DISPUTE, MANUAL_MODE
  refundedAmount Decimal? @db.Decimal(10, 2)
  error          String?
  attempts       Int      @default(0)
  notifiedAt     DateTime? // buyer email sent; never twice
  updatedAt      DateTime @updatedAt
}
```

Each item row is one order's **work queue entry, idempotency record and progress line**: the sweep resumes after a crash, the event page counts statuses, and `notifiedAt` makes sure each buyer is emailed once. Add both models to `audit/features.js` (gotcha 35). Neither holds buyer personal data, so spec 040 export and erasure do not change.

### 4.2 Cancel (synchronous, one transaction)

`EventService.cancelEvent(orgId, eventId, { mode, message, actor })`:

1. Lock the event (`FOR UPDATE`), check that it is `PUBLISHED`, and set it to `CANCELLED` with `cancelledAt`.
2. Create the `EventCancellation` and one item for every `TICKET` order in `COMPLETED` or `PARTIALLY_REFUNDED` (status `PENDING`, or `SKIPPED` / `MANUAL_MODE` in manual mode). A zero-total order is `SKIPPED` / `FREE_ORDER`.
3. RSVP events keep today's path (`rsvp.cancelled`) and create no items.

After the commit:

- **Expire open Checkout sessions.** For every `PENDING` ticket order of the event that has a `stripeSessionId`, call `checkout.sessions.expire` on the order's account (`onAccount(PaymentTransaction.stripeAccountId)`, gotcha 13), then mark the order `FAILED` and release reservations through the existing abandoned-checkout release path (`AddOnService.release` included, gotcha 16). An expire that fails is logged; 4.4 is the backstop.
- Wake the sweep (4.3) instead of waiting for its interval.

### 4.3 Refund sweep — `EventCancellationService.sweep`

This is a background job (gotcha 35: `auditLogService.runAsSystem`) on a short interval (`EVENT_CANCELLATION_SWEEP_INTERVAL_MS`, default 1 min). It claims `PENDING` items in batches of 25 with a conditional `updateMany`, so two backend instances never take the same item, the same pattern as the digest:

- `REFUND_ALL`: call `RefundService.refundOrder(orderId, { reason: 'Event cancelled', initiatedBy })`. Its idempotency key `order:<id>:full` (gotcha 29) makes a retry after a crash safe. Record `refundedAmount`, set `REFUNDED`, then send the email (4.5).
  - An order with an **open dispute** is `SKIPPED` / `OPEN_DISPUTE`; the dispute flow owns that money (spec 037).
  - A Stripe failure, typically an insufficient balance on the connected account under direct charges, sets `FAILED` with the error. It is retried up to 3 times with backoff, then left `FAILED` for staff.
- `MANUAL`: nothing to refund. Send the email and keep `SKIPPED`.
- When no item is `PENDING`, set `completedAt` and send staff one Eventimus-branded summary (gotcha 34): refunded count and total, skipped, and failed with links.

Stripe rate limits: batches of 25 with sequential refunds stay well under Stripe's 100 requests per second, so no extra throttle is needed.

### 4.4 Late payments and scans

- `PaymentService.handleCheckoutCompleted`: when the order's event is `CANCELLED`, it does not issue tickets. It completes the payment record, refunds the full amount at once (`refundOrder` path, same idempotency key) and sends the cancellation email in refunded wording. This covers a session that was paid before the expire landed.
- Ticket scan, redeem and door check-in refuse a ticket whose event is `CANCELLED`, with `redemptionStatus: 'EVENT_CANCELLED'` and its own scanner message. Tickets are not voided at cancel time: a refund voids them as it does today, and in `MANUAL` mode the event status alone blocks entry, so a later manual refund still works.

### 4.5 Emails (spec 053 registry)

New key **`order.event_cancelled`** (group *Orders & tickets*), edited in Settings › Notifications:

- merge fields `buyer.firstName`, `event.name`, `event.date`, `order.ref`, `organization.name`, plus section flags `refund.issued` / `refund.manual` so one template covers both modes;
- default: *"We're sorry: {{event.name}} on {{event.date}} has been cancelled. {{#refund.issued}}We've refunded your order {{order.ref}}…{{/refund.issued}}{{#refund.manual}}{{organization.name}} will contact you about your order {{order.ref}}.{{/refund.manual}}"*;
- system blocks: the order card (tickets, total), and in refund mode the amount refunded, the card it goes back to and "5–10 business days";
- the store's optional `message` from the cancel dialog is appended as its own paragraph (escaped plain text);
- `reply_to` is the store's email.

Sent once per order (`notifiedAt`), after the refund succeeds in refund mode so the amount is real. A `FAILED` item sends nothing until it is refunded or staff mark it handled.

Vendors (4.7) get **`application.event.EVENT_CANCELLED`** (group *Event applications*).

### 4.6 Admin UI

- **Cancel dialog** (event Overview › ⋯ › Cancel event). It shows what will happen, with live counts from a new `GET …/events/:id/cancellation-preview`: *N orders · M tickets · $X collected · K vendors with paid spaces · open checkouts*. It offers the refund-mode radio (refund-all disabled without `orders.refund`), a message textarea with a **Preview email** button that reuses the spec 053 preview, an estimated cost to the organization (processing fees not returned), and a type-the-event-name confirmation. Submitting goes through `withReauth`.
- **Cancellation panel** on the event Overview after cancel: a progress bar (*Refunded 212 of 340*), counts by status, and a failed list with the error and **Retry** (resets the item to `PENDING`) or **Mark handled** (`SKIPPED` / `HANDLED_BY_STAFF`, which sends the email). It polls while not `completedAt`.
- The Events list badge reads *Cancelled · refunding* / *Cancelled*.

### 4.7 Vendor applications (on the same event)

Inside the cancel transaction or right after it:

- release every hold (`ApplicationPaymentService.releaseSelection`, the only way a hold ends, per gotcha 15);
- `SUBMITTED` / `WAITLISTED` / approved-but-unpaid applications become `WITHDRAWN` (reason `EVENT_CANCELLED`) without the usual WITHDRAWN email;
- paid application orders become `EventCancellationItem`s too and are refunded through `RefundService.refundOrder`, which routes to `_refundApplicationOrder`;
- every affected vendor gets one `application.event.EVENT_CANCELLED` email.

### 4.8 Storefront

`getEventById` serves a `CANCELLED` event with `cancelled: true`. The page shows a "This event was cancelled" banner with no tickets, apply or map actions, `noindex`, and it is still excluded from event lists. Buyer account › Tickets and Orders show *Cancelled · Refunded $X* or *Cancelled*.

## 5. Phases / cards

| Card | Scope | Depends on |
|---|---|---|
| **054-A** | Stop the money: models + migration, cancel transaction, expire open sessions, late-payment refund, scan / check-in refusal, `orders.refund` + step-up on refund mode, cancelled public page | — |
| **054-B** | Refund sweep, `order.event_cancelled` notification (registry, builder, sample), staff summary email | A |
| **054-C** | Admin cancel dialog with preview counts and email preview; cancellation panel with progress, retry and mark handled; list badge; buyer account labels | A, B |
| **054-D** | Vendor applications: holds released, withdrawals, application refunds, `EVENT_CANCELLED` email | A, B |
| **054-E** | Wiki `docs/wiki/features/event-cancellation.md`, AGENTS gotcha, STATUS | all |

## 6. Tests

- contract: cancel creates items for paid orders only, skips free and refunded orders and open disputes, and refuses a non-`PUBLISHED` event. Refund mode without `orders.refund` → 403, without step-up → 401. The sweep refunds each order once across two concurrent runs (claim). A crash mid-refund then re-run means no double refund (idempotency key). Each buyer is emailed once. A failure is retried, then left `FAILED`; retry and mark handled work. Manual mode refunds nothing and emails everyone. A late `checkout.session.completed` for a cancelled event is refunded and no tickets are issued. Scan and check-in return `EVENT_CANCELLED`. The public payload is `cancelled: true`. Vendor holds are released and paid vendors refunded. Tests namespace Stripe event ids per run (gotcha 29).
- unit: item state machine, registry entry for `order.event_cancelled` (default renders in both modes).
- e2e (mocked): the dialog flow (counts, mode, preview, name confirm, reauth), the panel showing progress, retry and mark handled, and the cancelled event page with axe.
- `npm run verify:stripe` (outside `npm test`): one real test-mode refund on a connected account.

## 7. Risks

- **Connected-account balance.** Refunds of direct charges come out of the organization's Stripe balance. A store that has already been paid out may not have enough, and Stripe may debit its bank or fail the refund. These items show as `FAILED` with Stripe's message, and staff see them in the panel and the summary email.
- **Volume.** A 5,000-ticket event means about 2,000 refunds, roughly 200 batches. At one batch per sweep tick this is slow, so the sweep loops until it is empty or about 50 s have passed, then yields.
- **Partial refunds already made** (self-serve, staff): `refundOrder` refunds the remainder. The refunded line shows the remainder, not the order total.
- **No undo.** Refunds cannot be reversed. The dialog states it, requires the typed name and asks for step-up.

## 8. Open questions for the owner

1. Should Jump keep its platform fee on cancelled events, or return it as today?
2. Should "I'll handle refunds myself" exist at all? Removing it removes a whole branch: the email wording, the mark-handled flow and the `MANUAL` mode.
3. Should cancellation be ADMIN-only rather than any staff member (`events` feature) when the refund-all option is off?
