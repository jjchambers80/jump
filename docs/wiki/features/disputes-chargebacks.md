# Disputes and chargebacks (spec 037)

When a buyer disputes a card payment, Stripe pulls the money out of Jump's
balance and sends the `charge.dispute.*` family. Before spec 037 none of it was
handled: the order stayed `COMPLETED` and kept counting as money collected, no
`Refund` row was written so reconciliation against Stripe drifted by the
disputed amount, the disputing buyer's ticket still scanned, and the organizer
found out from their payout.

## What happens now

| Stripe event | Jump |
|---|---|
| `charge.dispute.created` | `Dispute` row written against the order; organizer emailed. Money and tickets move only if the payload says the funds are already gone (a real US card chargeback) — an inquiry (`warning_*`) touches neither |
| `charge.dispute.funds_withdrawn` | One `Refund` row (`disputeId` set, `stripeRefundId` null) for the disputed amount; enough tickets voided cheapest-first to cover it; tier `quantitySold` released; add-on lines closed when the chargeback took the whole order; `Order.status` recomputed |
| `charge.dispute.updated` | State re-derived. Nothing moves unless the ledger on the dispute changed |
| `charge.dispute.closed` (lost) | `state: LOST`, `closedAt` stamped, money stays out, organizer emailed |
| `charge.dispute.closed` (won) / `charge.dispute.funds_reinstated` | The dispute's `Refund` row goes `FAILED` so the SUCCEEDED aggregates stop counting it; exactly the tickets and add-on lines this dispute closed are restored, with their prior status (a `REDEEMED` ticket comes back `REDEEMED`); `Order.status` back to `COMPLETED`; organizer emailed |

Everything lands on one handler, `DisputeService.applyFromEvent`, through the
existing signature-verified `POST /webhooks/stripe` route. There is no second
write path into the ledger.

## Idempotency and ordering

Stripe redelivers these events and does **not** guarantee order — `.closed` can
arrive before `.funds_withdrawn`. Two rules make that safe, and they are the
reason the handler looks the way it does:

1. **Full state, not a delta.** Every `charge.dispute.*` event carries the whole
   dispute object, so the handler derives everything it needs from the payload.
   `fundsWithdrawn` comes from `dispute.status` plus the sign of
   Σ `dispute.balance_transactions` — never from the event type. Running the same
   event twice is therefore a no-op.
2. **`Dispute.lastEventAt` is monotonic.** An event whose `created` is strictly
   older than the newest one already applied is logged and ignored, so a late
   `.funds_withdrawn` cannot take money back out of a dispute Jump won.

`Refund.disputeId` is `@unique`, so "one money-out row per dispute" is enforced
by the database rather than by a read-then-write in the handler. The organizer
email fires only on a real transition (new dispute, or one that just closed), so
a redelivery never re-sends it.

## Why there is no DISPUTED OrderStatus

Money out is money out, and the existing `REFUNDED` / `PARTIALLY_REFUNDED` pair
already means it — which is what keeps `refunded` / `net`, the analytics, the
dashboard, the CSV export and the tax report correct with no changes. A new
`OrderStatus` value would have to be taught to every consumer of
`PAID_ORDER_STATUSES` (`backend/src/services/paidStatuses.js`) and every
frontend status map, for no extra information.

What makes a chargeback legible instead:

- the `Dispute` row on the order (`state`, `reason`, `inquiry`,
  `fundsWithdrawn`, `evidenceDueBy`), surfaced as `dispute` on every
  `/admin/orders` row;
- `Refund.disputeId` on the money-out line, surfaced as `dispute` in
  `RefundService.getRefundsForOrder`, so a chargeback is never read as a refund
  Jump issued.

## Reconciliation

`npm run report:disputes` (read-only; `ORGANIZATION_ID=<id>` to scope) counts
both directions and exits non-zero on drift:

- every `Dispute` → exactly one `Order`, and the distinct-order count beside it;
- every dispute holding money → exactly one SUCCEEDED `Refund` of the same
  amount (`missingProjection` is the drift this feature exists to prevent);
- every dispute money-out row → a dispute that is still holding the money
  (`orphanProjections`), plus `danglingRefunds` and duplicate dispute ids.

`DisputeService.reconcile()` is the same function the contract test asserts on.

## Application orders

A PAID-form application **is** an order (spec 024), so a vendor booth chargeback
runs the same path: `Application.paymentStatus` and `Order.status` move together
through the shared application projection (which also releases the booth on a
full chargeback), and a won dispute puts both back to `PAID` / `COMPLETED`.
Application orders have no tickets, so nothing is voided.

## Limits

- **Responding to a dispute happens in Stripe, not in Jump.** Jump records it
  and tells the organizer; there is no evidence-submission UI.
- A **partial** dispute voids tickets cheapest-first to cover the amount,
  because Stripe does not say which line the buyer disputed — the same rule as
  an externally-initiated partial refund. Add-on lines are closed only when the
  chargeback took the whole order.
- A dispute on a payment Jump never recorded is answered 200 and logged at
  `error` (`dispute_unresolved`) rather than written, so an unrelated charge can
  never create a ledger row.

## Files

- `backend/src/services/DisputeService.js` — the whole projection
- `backend/src/api/routes/webhooks.js` — `charge.dispute.*` dispatch
- `backend/src/scripts/reconcile-disputes.js` — `npm run report:disputes`
- `backend/tests/contract/disputes.test.js` — every fixture replayed twice
- `packages/db/prisma/migrations/20261009100000_disputes/`
