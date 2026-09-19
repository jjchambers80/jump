# Abuse protection (spec 020 phase 1)

**Status**: Phase 1 shipped 2026-09-19 — per-IP limits on every unauthenticated money path, a per-buyer hold cap, an abandoned-checkout sweep. Phases 2 (magic-link guard, helmet, CSP) and 3 (edge layer) open. Spec: `specs/020-abuse-protection/`.
**Last Updated**: 2026-09-19

## Overview

`POST /orders` is unauthenticated and reserves tier inventory for 30 minutes before payment, so before this a script could hold a whole tier for free. Phase 1 closes that at the app layer (production is Railway-only, no edge): one limiter factory keyed on the real client IP, tight windows on the money paths, a cap on open checkouts per email per event, and a sweep that releases holds whose Checkout session died without the webhook.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/middleware/rateLimit.js` | `makeLimiter(name, opts)` — `express-rate-limit` keyed on `clientIpForRateLimit` (signed `X-Jump-Client-Ip` from the Next proxy, else `req.ip`), `RATE_LIMIT_<NAME>_LIMIT` / `_WINDOW_MS` overrides, `rate_limited_total{route}` metric + warn log on 429, `countStatuses` (count only e.g. 401/403), pass-through under `NODE_ENV=test` unless `RATE_LIMIT_ENFORCE_IN_TESTS=1`; `LIMITS` defaults; `baselineSkip` |
| `backend/src/api/server.js` | `BASELINE` limiter after the correlation id (600 / 5 min; skips `/health`, `/metrics`, `/webhooks/*`); abandoned-checkout sweep timer |
| `backend/src/api/routes/orders.js` | `ORDER_CREATE` (10 / 15 min, `skipFailedRequests` so 400s are free), `ORDER_LOOKUP` (10 / 15 min), `ORDER_VERIFY` (60 / 15 min) |
| `backend/src/api/routes/tickets.js` | `SCANNER_AUTH` before `requireScannerOrStaff` on `/scan` and `/redeem`: 10 failed sign-ins (401/403) / 15 min; successful scans and unknown barcodes never count |
| `backend/src/api/routes/domains.js` | `DOMAIN_RESOLVE` on `/resolve` and `/owner` (120 / min) |
| `backend/src/api/routes/buyerAuth.js`, `applications.js` | the pre-existing limiters (`BUYER_AUTH_REQUEST` 20 / h, `APPLICATION_SUBMIT` 30 / h) now come from the factory |
| `backend/src/services/OrderService.js` | hold cap inside `createOrder` before any reservation (`ORDER_MAX_PENDING_PER_CONTACT`, default 3, 409 "You already have tickets on hold for this event…"); `sweepAbandoned()` |
| `backend/src/utils/metrics.js` | `rate_limited_total` counter |
| `packages/db/prisma/migrations/20260930200000_order_abuse_indexes` | `Order(status, createdAt)` for the sweep, `Order(contactId, eventId, status)` for the cap |

## How It Works

1. **Limiter key.** Browser traffic reaches the backend through the Next route handlers, so `req.ip` would be the frontend's egress for every buyer. The proxy forwards the real address in `X-Jump-Client-Ip` signed with `AUTH_SECRET` (`utils/clientIp.js`); unsigned or mis-signed headers fall back to `req.ip`. The store is in-memory: one backend replica in production (plan §8 records the scale-out condition).
2. **Counting.** `ORDER_CREATE` counts created orders (`skipFailedRequests`), so validation failures never exhaust a buyer's budget. `SCANNER_AUTH` counts only 401/403 (`countStatuses`), so a wrong key from a stolen reader is capped while a valid reader scanning unknown barcodes is not. A 429 carries `{ error }` plus the draft-7 `RateLimit-*` headers and bumps `rate_limited_total{route}`.
3. **Hold cap.** Inside `createOrder`'s transaction, before the tier `UPDATE`, count PENDING ticket orders for this email (per organization contact) on this event; at `ORDER_MAX_PENDING_PER_CONTACT` → 409 and nothing is reserved. Failed, completed and cancelled orders do not count; another event is its own cap.
4. **Sweep.** `OrderService.sweepAbandoned()` (every `ORDER_SWEEP_INTERVAL_MS`, first run 60 s after boot) looks at PENDING ticket orders older than 30 min + `ORDER_SWEEP_GRACE_MS` with a Stripe session, up to 100 per run: `checkout.sessions.retrieve` → expired, or open past `expires_at` → `failOrder` (releases tiers and add-ons; the same path as `checkout.session.expired`, a no-op unless still PENDING); `complete` / `paid` → `verifyAndCompleteOrder` (the webhook was missed). Orders without a session are skipped (`createOrder` rolled those back itself).
5. **Tests only.** Every limiter is a pass-through under `NODE_ENV=test` unless `RATE_LIMIT_ENFORCE_IN_TESTS=1`, so suites that fire hundreds of requests never trip one by accident.

## Gotchas

- Tune, don't redeploy: every limit and window is an env var (`RATE_LIMIT_<NAME>_*`). Check `rate_limited_total` on `/metrics` and the `rate_limited` warn log before lowering one.
- The Next proxy must keep signing `X-Jump-Client-Ip` (spec 007); without it every buyer shares one key and the first busy event 429s everyone.
- The sweep needs Stripe: with `STRIPE_SECRET_KEY` wrong it logs and skips; holds then expire only through the webhook.
- Adding a second backend replica moves the store to Redis (plan §8) — the counters are per process.

## Testing

- `backend/tests/unit/rateLimitFactory.test.js` — pass-through vs enforced, per-IP budgets, signed-IP key, env overrides, `skipSuccessfulRequests` / `skipFailedRequests`, defaults and baseline skips.
- `backend/tests/contract/abuseProtection.test.js` (`RATE_LIMIT_ENFORCE_IN_TESTS=1`, tiny limits) — `POST /orders` cap counts orders not 400s and reserves nothing on 429; per-buyer hold cap incl. release on FAILED and per-event scope; the sweep (expired, open-past-expiry, paid-but-missed, young, idempotent rerun) against a mocked Stripe; lookup / verify-payment windows; scanner failures capped while successes are free; domains window; baseline exemptions for `/health` and `/webhooks/stripe`.

## Related

- [Guest checkout](guest-checkout.md), [QR code scanning](qr-code-scanning.md), [Custom domains](custom-domains.md), [Observability](observability.md), launch checklist `docs/wiki/config/production-launch-checklist.md`
