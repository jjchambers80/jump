# Webhook Reliability

**Status:** Shipped · **Spec:** EVE-3 · **Owner:** payments

## Overview

Stripe webhooks are the only way an order becomes paid. Everything in this page exists because of three facts Stripe states plainly and every integration eventually forgets:

1. **Stripe delivers at least once.** The same event arrives twice, sometimes more.
2. **Stripe does not guarantee order.** An event created earlier can arrive later.
3. **An endpoint without signature verification is an unauthenticated write path.** Anyone who knows the URL can post a `checkout.session.completed` and mint tickets.

Three changes address them: the endpoints **fail closed in production**, every delivery is recorded in a **`StripeWebhookEvent` ledger** that dedups replays, and every Stripe refund now carries an **idempotency key**.

## Key Files

| File | Role |
|---|---|
| `backend/src/api/routes/webhooks.js` | The three endpoints. `readStripeEvent` verifies; `verifyAndClaim` is the shared front half of all three |
| `backend/src/services/WebhookEventService.js` | `claim` / `settle` — the delivery ledger and the dedup decision |
| `backend/src/services/stripeRefund.js` | `createStripeRefund` (requires an idempotency key) and `refundIdempotencyKey` |
| `backend/src/services/RefundService.js` | The four refund scopes and the key each one uses |
| `packages/db/prisma/schema.prisma` → `StripeWebhookEvent` | The receipt table |
| `backend/tests/contract/webhookReplay.test.js` | Duplicate, concurrent, out-of-order and fail-closed coverage |
| `backend/src/scripts/verify-stripe-testmode.js` | `npm run verify:stripe` — configuration report + test-mode charge/refund proof |
| `backend/src/scripts/verify-checkout-tax.js` | `npm run verify:checkout-tax` — end-to-end checkout with the tax line, against real Stripe test mode |

## How It Works

### Failing closed

`readStripeEvent(req, secretName, label)` verifies with `stripe.webhooks.constructEvent` when the secret is set. When it is **not** set:

- Where it does not matter it logs a warning and parses the body, so local development and the contract suite can post plain JSON.
- Where it does, it throws and the endpoint answers **500** with `{"error":"Webhook endpoint is not configured"}`.

"Where it matters" is `mustVerify()`: **`NODE_ENV === 'production'` OR a live Stripe key.** Two conditions on purpose. `NODE_ENV` is the obvious signal, but nothing in `railpack.backend.json` sets it — it comes from the platform, and a security control should not rest on that holding. A live `sk_live_` key is unambiguous: real money is moving, whatever the environment claims to be. `stripeMode()` treats anything that is not `sk_test_` as live, which is the safe direction to be wrong in.

500 rather than 400 is deliberate: the delivery was fine, our configuration is not. Stripe retries a 5xx for up to three days, so the backlog drains by itself once the secret is set — nothing is silently lost. A 400 would tell Stripe the event was bad and it would stop.

All three endpoints behave identically, including `/webhooks/stripe/connect` and `/webhooks/stripe/billing` even when those features are flagged off. An unused endpoint that trusts unsigned bodies is still a write path.

### The delivery ledger

`WebhookEventService.claim(endpoint, event)` inserts one row per delivery before any handler runs. The unique index on `(endpoint, stripeEventId)` **is the lock** — a concurrent redelivery loses the insert rather than racing a handler.

| Situation | What happens |
|---|---|
| First delivery | Row created `RECEIVED`, handler runs, `settle` marks it `PROCESSED`, `IGNORED` (unhandled type) or `FAILED` |
| Redelivery of a settled event | `deliveries` incremented, **handler skipped**, response is `{"received":true,"duplicate":true}` |
| Redelivery while the first is still in flight (`RECEIVED`) | Skipped. The in-flight one finishes; if it fails, Stripe's next retry takes the `FAILED` path |
| Redelivery of a `RECEIVED` row older than 5 minutes | **Let through.** A row that never settled means the process died mid-handler; treating that as "in flight" forever would lose the event permanently. Logs `stripe_webhook_stale_in_flight` |
| Redelivery of a `FAILED` event | **Let through.** Stripe retrying is the recovery path, and the handlers are individually idempotent |
| Same event id on two endpoints | Two rows, both processed — the endpoint is part of the key |
| Event with no id (local fixtures) | Processed, not recorded. Nothing to dedup on |

`duplicate: true` in the response is only ever produced ahead of dispatch, so it is the observable proof that no handler ran.

**The ledger fails open.** If the row cannot be written, the event is still processed and `stripe_webhook_ledger_error` is logged. The handlers remain the correctness guarantee; this is defence in depth plus the audit trail. A database hiccup must not also become a dropped payment.

### Out-of-order delivery

Nothing is reordered — the handlers resolve state from the Stripe object, and the guards that matter are already in place (`OrderService.failOrder` refuses an order that is not `PENDING`, so a late `checkout.session.expired` cannot fail a completed order). What was missing was *visibility*. Each row stores `objectId` (`event.data.object.id`) and `stripeCreatedAt` (`event.created`, Stripe's own clock). When an event arrives whose `created` predates one already seen for the same object, `stripe_webhook_out_of_order` is logged with both event ids.

### Debugging a missed event

```sql
-- Did it ever arrive?
SELECT * FROM "StripeWebhookEvent" WHERE "objectId" = 'cs_test_…';

-- Everything that failed, newest first
SELECT "type", "stripeEventId", "error", "receivedAt"
FROM "StripeWebhookEvent" WHERE "status" = 'FAILED' ORDER BY "receivedAt" DESC;

-- Events Stripe had to retry
SELECT * FROM "StripeWebhookEvent" WHERE "deliveries" > 1;
```

Log events to grep for: `stripe_webhook_received`, `stripe_webhook_duplicate`, `stripe_webhook_out_of_order`, `stripe_webhook_failed`, `stripe_webhook_not_configured`, `stripe_webhook_ledger_error`.

### Why the platform endpoint still answers 200 on a handler error

`/webhooks/stripe` catches handler errors, records `FAILED` and answers 200. That is not laziness: `OrderService.sweepAbandoned` and `ApplicationPaymentService.sweepOverdue` already reconcile orders whose webhook never landed, and a retry storm against a handler that is failing deterministically is worse than a swept order. The `FAILED` row is how you find it. `/webhooks/stripe/billing` is the exception — it has no sweep, so it answers 500 and leans on Stripe's retry, which the `FAILED` path above lets back in.

### Refund idempotency

`createStripeRefund` **requires** an `idempotencyKey` and throws without one, so a refund path added later cannot quietly ship without protection.

The window being closed: Stripe refunds the money, then the transaction rolls back or the process dies before the `Refund` row commits. An operator retries and — with no key — the customer is refunded twice, with nothing in the ledger saying so. Keys are therefore derived from the **operation**, not from a row id a rollback would discard:

| Refund scope | Key | Why |
|---|---|---|
| Full ticket order | `jump:refund:order:<orderId>:full` | "Refund the rest of this order" happens once |
| Per ticket | `jump:refund:ticket:<ticketId>` | The ticket is VOIDED, so it refunds once |
| Add-on line | `jump:refund:order-add-on:<lineId>` | `refundedAt` is stamped, so it refunds once |
| Application order (partial) | `jump:refund:application-order:<orderId>:<refundId>` | Amounts are caller-chosen and two equal partials are legitimate. Safe here because the `Refund` row is committed *before* Stripe is called and is marked `FAILED`, not deleted, on failure |

Stripe expires idempotency keys after 24 h, so this covers retries and double-clicks, not a refund reissued a week later. The database checks (`alreadyRefunded`, refund-exceeds-total, order status) cover that longer window.

## Testing

```bash
cd backend && npm test                                     # includes webhookReplay + webhookSignature
npx jest tests/contract/webhookReplay.test.js              # 14 cases: duplicate, concurrent, stale, out-of-order, fail-closed
npx jest tests/unit/refundService.test.js                  # key scopes + the "no key" guard
```

`webhookReplay.test.js` signs its payloads with the real `stripe` helper, so a middleware-order regression that stops the raw body reaching `constructEvent` fails there. It never reaches the network.

Manual, against Stripe test mode (never in CI — the suite stays offline and deterministic):

```bash
cd backend
npm run verify:stripe                 # Connect / Tax / billing / endpoint configuration report
npm run verify:stripe -- --charge     # real test-mode charge, refunded twice on one key
npm run verify:checkout-tax           # real Checkout Session; order total == Stripe amount_total
```

Both scripts refuse to run against a key that is not `sk_test_`.

## Gotchas

- **Contract tests must namespace their Stripe event ids per run.** A fixed id makes the second run of a suite a *duplicate* and changes the response. `webhookSignature.test.js` and `webhookReplay.test.js` both suffix ids with a run token and clear their rows in `afterAll`.
- **Never dispatch a handler before `verifyAndClaim` returns.** It is what makes the dedup real.
- **Do not "fix" the 200-on-error behaviour of the platform endpoint** without also removing the order sweeps — see above.
- **A missing secret in production, or on a live key, is now a 500 — not a silent success.** If webhooks stop after a deploy, check `stripe_webhook_not_configured` before anything else.
- **The ledger is not a reconciliation source.** It records deliveries, not money. `Order` / `PaymentTransaction` / `Refund` remain the ledger (spec 024).

## Related Features

- [Connect Payouts](connect-payouts.md) — destination charges and the liability table
- [Application Orders](application-orders.md) — the one money ledger
- [Tax Settings](tax-settings.md) — what a 0% Stripe Tax rate actually means
- `docs/wiki/config/stripe-live-activation.md` — the founder's live-mode runbook
