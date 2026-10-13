# Cancelling a Paid Event

**Status**: Implemented (spec 054: PRs #458, #472, #473, #474)
**Last Updated**: 2026-10-13

## Overview
Cancelling a published event is one deliberate admin action that stops new money, refunds every paid order (or leaves refunds to the store), closes every vendor application, and tells every buyer and vendor once. A cancelled event keeps its public page with a "cancelled" banner, and its Overview shows refund progress with Retry and Mark handled for anything Stripe refused.

## Visibility setting
- Catalog action **`events.cancel`** (feature `events`, ADMIN by default, editable in System › Roles): the Cancel event menu item, the dialog's preview endpoints, Retry and Mark handled.
- **`orders.refund`** (feature `orders`, ADMIN) is also needed to choose "Refund every order now" and to Retry a failed refund. A role with `events.cancel` alone can only cancel with "I'll handle refunds myself".
- Every cancel, and every Retry, needs a step-up (`requireRecentAuth` / `withReauth`).

## Key Files
| File | Purpose |
|------|---------|
| `backend/src/services/EventService.js` (`cancelEvent`, `_expireOpenCheckouts`, `_wakeCancellationSweep`) | The cancel transaction: lock the event, set `CANCELLED`, cancel RSVPs, create the `EventCancellation` and one `PENDING` item per paid order; after commit, expire open Checkout sessions, close applications, wake the sweep |
| `backend/src/services/EventCancellationService.js` | The refund sweep (`sweep`, claim, settle, notify, close + staff summary), late payments (`settleLatePayment`), vendor applications (`closeApplications`, `_withdraw`, `_emailVendor`), and the admin reads/actions (`preview`, `previewEmail`, `status`, `retry`, `markHandled`) |
| `backend/src/services/PaymentService.js` (`_refundLatePayment`) | A `checkout.session.completed` for a cancelled event issues no usable tickets and goes to `settleLatePayment` |
| `backend/src/services/TicketService.js` | Scan, redeem and door check-in refuse a cancelled event's tickets (`redemptionStatus: 'EVENT_CANCELLED'`); buyer tickets carry `eventCancelled` |
| `backend/src/api/routes/events.js` | Cancel route (`REFUND_ALL` checks `orders.refund`), preview, email preview, status, retry, handled |
| `backend/src/config/notifications.js`, `config/applications.js` | `order.event_cancelled` (buyer) and `application.event.EVENT_CANCELLED` (vendor) registry entries and defaults |
| `backend/src/services/EmailService.js` (`buildEventCancelled`, `sendEventCancelled`) | Buyer email: store wording, then the store's note, the order card and the refund line |
| `backend/src/api/server.js` | Sweep timer (`EVENT_CANCELLATION_SWEEP_INTERVAL_MS`) through `auditLogService.runAsSystem` |
| `frontend/src/components/events/CancelEventDialog.tsx` | Counts, refund choice, note, email preview, typed-name confirm |
| `frontend/src/components/events/CancellationPanel.tsx` | Overview refunds panel: progress, counts, failed list with Retry / Mark handled; polls while running |
| `frontend/src/app/events/[eventId]/EventCancelledNotice.tsx` | Public "This event was cancelled" banner |
| `frontend/src/components/events/EventListCard.tsx`, `components/account/TicketStubs.tsx`, `app/organizations/[orgId]/account/(member)/orders/page.tsx` | "Cancelled · refunding" list badge; buyer account labels |

## Configuration
| Variable | Required | Description |
|----------|----------|-------------|
| `EVENT_CANCELLATION_SWEEP_INTERVAL_MS` | No | Refund sweep interval (default 60 000 ms). Cancelling an event also starts the sweep at once (never under `NODE_ENV=test`) |

Refunds of direct charges (spec 047) come out of the organization's own Stripe balance. A store already paid out may not have enough: those refunds show as failed with Stripe's message.

## How It Works

### 1. Cancel (one transaction, then cleanup)
1. `POST …/events/:id/cancel { mode, message }` locks the event row and refuses anything not `PUBLISHED` (409). It sets `CANCELLED`, and RSVP events cancel their GOING RSVPs (`rsvp.cancelled` email, unchanged).
2. Every paid order of the event becomes an `EventCancellationItem` with status `PENDING`. That covers ticket orders and vendor (application) orders that are `COMPLETED` or `PARTIALLY_REFUNDED`, plus vendor orders whose payment is still `PROCESSING`. With no paid order, the cancellation is created already complete.
3. After the commit:
   - every open ticket Checkout session is expired on the order's account, and its hold is released;
   - `closeApplications` withdraws every other live vendor application;
   - the sweep is woken.

### 2. Refund sweep (`EventCancellationService.sweep`)
- **Claiming.** It takes `PENDING` items whose backoff has passed, in batches of 25, for up to about 50 s per run. A conditional update on the item's `updatedAt` claims each one, so two backend instances never take the same item.
- **`REFUND_ALL`.** `RefundService.refundOrder` returns the full remaining amount. For an application order it routes to `_refundApplicationOrder`. Its idempotency key `order:<id>:full` makes a repeated Stripe call a no-op.
- **Skipped orders.** An item is marked `SKIPPED` with a reason:
  - `FREE_ORDER`: a zero total;
  - `OPEN_DISPUTE`: the dispute flow owns that money;
  - `ALREADY_REFUNDED`: staff refunded it before the sweep reached it;
  - `NOT_PAID`: a vendor payment that never landed; the application is withdrawn;
  - `MANUAL_MODE`: in manual mode nothing is refunded.
- **Crash recovery.** If an earlier attempt refunded the order and died before recording it, the re-run finds the order `REFUNDED` and records the item as `REFUNDED`.
- **Failures.** A Stripe failure is retried after 1 and 2 minutes, then left `FAILED` with Stripe's message. A vendor payment still settling is retried the same way.
- **Emails.** Each buyer is emailed once (`notifiedAt`), and in refund mode only after the refund succeeds, so the amount is real. A `FAILED` item emails nobody until staff retry it or mark it handled.
- **Closing.** When nothing is `PENDING`, `completedAt` is set and the organization's staff get one Eventimus-branded summary: refunded count and total, skipped by reason, and failed order refs.

### 3. Late payments
A checkout that completes after the cancel (Stripe could not expire it in time) issues no usable tickets. `settleLatePayment` refunds it whatever the mode, never retries (`FAILED` for staff), and tells the buyer it was refunded.

### 4. Vendor applications (054-D)
- **Not paid.** Submitted, waitlisted, approved-but-unpaid and already-refunded applications are withdrawn through `ApplicationService.decide(WITHDRAW, sendEmail: false, note: 'Event cancelled')`, the same path as a staff withdrawal. It releases the approval slot, a held space, held add-ons and an open payment session, and sends no "withdrawn" email.
- **Paid.** Paid vendors are sweep items and are refunded first.
- **Email.** Every affected vendor gets one `application.event.EVENT_CANCELLED` email, with `{{#refund.issued}}` / `{{#refund.manual}}` sections and `{{refund.amount}}`.
- **Left alone.** Rejected and already withdrawn applications get nothing.

### 5. Admin interface
- **Cancel dialog.** It counts paid orders, tickets, money collected, open checkouts, live applications and paid vendors (or RSVP guests). You choose **Refund every order now** (the default with `orders.refund`) or **I'll handle refunds myself**. You can add an optional note to buyers and **Preview the buyer email**, which renders the real template for this event with a sample buyer in a sandboxed iframe. You confirm by typing the event name, and the confirm button reads "Cancel and refund everyone" in refund mode.
- **Refunds panel.** It shows on a cancelled event's Overview whenever the cancellation has items: a progress bar, counts, and the failed list with **Retry** and **Mark handled**. **Retry** resets the item to `PENDING` with fresh attempts, reopens the cancellation and wakes the sweep. **Mark handled** sets `SKIPPED` / `HANDLED_BY_STAFF` and the buyer gets the "we'll be in touch" wording. The panel polls every 5 s until `completedAt` is set.
- **Labels.** The Events list shows "Cancelled · refunding" until the sweep finishes, then "Cancelled". In the buyer account, orders show "Cancelled · Refunded $X", tickets show "Cancelled" or "Cancelled · Refunded", and self-serve refund is hidden.
- **Storefront.** `GET /events/:id` serves a cancelled event with `cancelled: true`: a banner and no tickets, apply or map actions. It drops out of event lists. The page is not marked `noindex`.

## API Endpoints
All under `/organizations/:orgId/events/:eventId`. Each needs a staff session and membership of the organization.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/cancel` | `events.cancel` + step-up; `REFUND_ALL` also `orders.refund` | `{ mode: 'REFUND_ALL'\|'MANUAL', message? }` (default MANUAL); 409 unless PUBLISHED |
| GET | `/cancellation-preview` | `events.cancel` | `{ status, admissionMode, orders, tickets, collected, openCheckouts, vendorsPaid, applications, rsvps }` |
| POST | `/cancellation-preview/email` | `events.cancel` | `{ mode, message? }` → `{ subject, html }` (sample buyer) |
| GET | `/cancellation` | any staff | `{ cancellation: null \| { mode, completedAt, total, counts, refundedTotal, failed[] } }` |
| POST | `/cancellation/items/:itemId/retry` | `events.cancel` + `orders.refund` + step-up | FAILED → PENDING (409 otherwise) |
| POST | `/cancellation/items/:itemId/handled` | `events.cancel` | FAILED → SKIPPED / HANDLED_BY_STAFF + buyer email (409 otherwise) |

## Database
Migration `20261115120000_event_cancellations`; both models are mapped in `backend/src/audit/features.js`.
- `EventCancellation`: one per cancelled event (`eventId` unique), with `mode` (`REFUND_ALL` / `MANUAL`), `message`, `initiatedById` and `completedAt` (null while the sweep has work).
- `EventCancellationItem`: one per paid order (`orderId` unique), with `status` (`PENDING` / `REFUNDED` / `SKIPPED` / `FAILED`), `skippedReason`, `refundedAmount`, `error`, `attempts` and `notifiedAt`. Each item is the order's work-queue entry, its idempotency record and its progress line.

Neither model holds buyer personal data, so spec 040 export and erasure are unchanged. See [database architecture](database-architecture.md).

## Gotchas
- **The sweep is the only thing that settles items.** Never refund a cancellation item somewhere else. Staff may still refund an order in Orders, and the sweep then records it as `ALREADY_REFUNDED`.
- **Tickets are not voided at cancel time.** The event status alone blocks entry (scan, redeem, check-in return `EVENT_CANCELLED`), so a later manual refund still works. A refund voids the tickets as usual.
- **Emails go once.** `notifiedAt` is claimed with a conditional update before sending and cleared again if the send fails. A failed item emails nobody until it is retried or marked handled.
- **Backoff uses one clock per run.** A retried item that fails again waits for the next run, not the same loop.
- **The wake-up is skipped under test** (`NODE_ENV=test`). Suites call `eventCancellationService.sweep()` themselves; pass `now` to step past the backoff.
- **No undo.** Refunds cannot be reversed. The dialog says so and asks for the event name and a step-up.

## Related Features
- [Disputes and chargebacks](disputes-chargebacks.md): open disputes are skipped.
- [Notifications](notifications.md): `order.event_cancelled`, `application.event.EVENT_CANCELLED`.
- [Webhook reliability](webhook-reliability.md): refund idempotency keys.
- [Application orders](application-orders.md): vendor refunds.
- [Vendor space selection](vendor-space-selection.md)
- [RSVP events](rsvp-events.md)
- [Roles & permissions](rbac.md)
- Spec: `specs/054-paid-event-cancellation/plan.md`
