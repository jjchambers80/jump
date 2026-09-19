# Implementation Plan: Abuse protection and edge security (spec 020)

**Status**: Planned 2026-09-18. Not built.
**Spec**: [spec.md](./spec.md). Depends on spec 007 (`clientIpForRateLimit`, signed `X-Jump-Client-Ip`), spec 011 (`submitLimiter` pattern), guest checkout (`OrderService.createOrder` / `failOrder`), the Stripe webhook handler.
**Reference**: Transcript reviewed 2026-09-18 (Cloudflare rate-limiting / bot-management / WAF talk) and the vault note `jump--decision--edge-abuse-protection-spec.md`.
**Branches**: plan on `plan/020-abuse-protection`; phases on `feat/020-abuse-protection-phase-1` → `-phase-2` → `-phase-3`, each merged to `main` alone (spec 012 lesson: never merge a phase branch that contains an unmerged earlier phase). Phase 3 only exists if the §7.1 decision is "Cloudflare".

---

## 0. Why this is app-level first

The transcript says "configure the wall you are paying for". Jump is not paying for one: production is Railway-only, and the custom-domain flow (spec 007 phase 3, spec 008) hands every organization a CNAME that points at the Railway frontend host. Introducing Cloudflare changes that CNAME for every organization and moves certificate issuance off Railway — so it is a decision, not a config task, and it has to be made before the first real storefront domain is published (§7.1).

None of the actual holes need an edge layer to close. The worst one — free inventory holds through `POST /orders` — is closed by two counters inside the existing order transaction. Phases 1–2 therefore ship regardless of §7.1, and phase 3 is the edge work if and only if the answer is yes.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Per-IP limiter keyed on the signed client IP | `routes/buyerAuth.js` `requestLimiter`, `clientIpForRateLimit`; `routes/applications.js` `submitLimiter` | Both become calls to one factory in `middleware/rateLimit.js`; behaviour and numbers unchanged |
| Signed client IP from the Next proxy | `frontend/src/lib/buyerSession.ts` `backendBuyerFetch({ clientIp })`, `clientIpFrom(req)` | Unchanged; browser-direct routes (`/orders`, `/domains/*`, `/tickets/*`) key on `req.ip` through the same helper's fallback |
| `trust proxy` = 1 in production | `api/server.js:43` | Unchanged for phases 1–2; §6 phase 3 revisits |
| Atomic tier reservation | `OrderService.createOrder` step 2 (`UPDATE … WHERE available >= $1`) | The per-email `PENDING` count is added inside the same transaction, before the tier update |
| Release on failure | `OrderService.failOrder(orderId, reason)` — no-op unless `PENDING` | The new sweep calls it; idempotent with the webhook |
| Stripe session expiry | `createOrder` sets `expires_at = now + 1800` | Sweep threshold = 1800 s + `ORDER_SWEEP_GRACE_MS` |
| Sweep timers | `server.js:172-189` (domain + application sweeps, `unref()`, skipped under test) | Third timer, same shape |
| Scanner auth | `middleware/scannerAuth.js` `requireScannerOrStaff`, `scannerKeyMatches` | Wrapped by a failure-counting limiter; unchanged internally |
| Security headers | `server.js:86-92` (four headers by hand) | Replaced by `helmet()` configured to emit the same four plus its defaults |
| Prom metrics | `utils/metrics.js` (`promClient.Counter`, `recordHttpMetric`) | New `rateLimitedCounter{route}` |
| Auth.js route | `frontend/src/app/api/auth/[...nextauth]/route.ts` re-exports `handlers` | `POST` is wrapped; `GET` untouched |
| Env-driven toggles with test defaults | `DOMAIN_VERIFY_COOLDOWN_MS` (tests set 0) | Every limit reads `RATE_LIMIT_*`; under `NODE_ENV=test` the factory returns a pass-through unless `RATE_LIMIT_ENFORCE_IN_TESTS=1` |
| Launch checklist | `docs/wiki/config/production-launch-checklist.md` | Gains a "Abuse protection" section and the §7.1 decision line |

---

## 2. Design

### 2.1 Limiter factory (backend)

`backend/src/middleware/rateLimit.js`:

```js
export function makeLimiter(name, { windowMs, limit, skip, skipSuccessfulRequests = false, message }) {
  const enforce = process.env.NODE_ENV !== 'test' || process.env.RATE_LIMIT_ENFORCE_IN_TESTS === '1';
  if (!enforce) return (req, res, next) => next();
  return rateLimit({
    windowMs: envMs(`RATE_LIMIT_${name}_WINDOW_MS`, windowMs),
    limit: envInt(`RATE_LIMIT_${name}_LIMIT`, limit),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIpForRateLimit(req)),
    skip,
    skipSuccessfulRequests,
    skipFailedRequests: name === 'ORDER_CREATE',
    handler: (req, res) => {
      rateLimitedCounter.inc({ route: name });
      logger.warn('Rate limited', { route: name, ip: clientIpForRateLimit(req), correlationId: req.id });
      res.status(429).json({ error: message });
    },
  });
}
```

`clientIpForRateLimit` moves from `routes/buyerAuth.js` to this module (re-exported from `buyerAuth.js` so `applications.js` and the unit test keep importing). `ipKeyGenerator` (express-rate-limit ≥ 7.4) normalises IPv6.

| Name | Mounted on | Default | Notes |
|---|---|---|---|
| `BASELINE` | `app.use` after the correlation-id middleware, before routes | 600 / 5 min | `skip`: `/health`, `/metrics`, `/webhooks/*` |
| `ORDER_CREATE` | `POST /orders` | 10 / 15 min | Counts orders, not requests: `skipFailedRequests: true` so validation 400s do not burn the budget |
| `ORDER_LOOKUP` | `POST /orders/lookup` | 10 / 15 min | |
| `ORDER_VERIFY` | `POST /orders/:orderId/verify-payment` | 60 / 15 min | Confirmation page polls this |
| `SCANNER_AUTH` | `POST /tickets/scan`, `/redeem` — mounted **before** `requireScannerOrStaff` | 10 failures / 15 min | `skipSuccessfulRequests: true`; the 401/403 from `requireScannerOrStaff` counts, a 200/404/409 from the scan itself does not |
| `DOMAIN_RESOLVE` | `GET /domains/resolve`, `/owner` | 120 / min | |
| `BUYER_AUTH_REQUEST` | existing | 20 / h | unchanged |
| `APPLICATION_SUBMIT` | existing | 30 / h | unchanged |

Memory store. Railway runs one backend replica; §8 records the scale-out condition.

### 2.2 Per-email hold cap and the reservation sweep

Inside `createOrder`'s transaction, after the contact is resolved and before the tier `UPDATE`:

```sql
SELECT count(*) FROM "Order" WHERE "contactId" = $1 AND "eventId" = $2 AND status = 'PENDING'
```

`>= ORDER_MAX_PENDING_PER_CONTACT` (default 3) → `ConflictError('You already have tickets on hold for this event. Finish that checkout or wait for it to expire.')` → 409. Frontend `checkout/[eventId]/page.tsx` already surfaces `error` bodies; the copy comes from the backend.

`OrderService.sweepAbandoned()`:

1. `findMany` `PENDING` orders with `createdAt < now - (1800 s + ORDER_SWEEP_GRACE_MS)` (default grace 5 min), `stripeSessionId` not null, limit 100.
2. For each: `stripe.checkout.sessions.retrieve(id)`; if `status === 'expired'`, or `status === 'open'` and `expires_at * 1000 < now`, call `failOrder(id, 'Abandoned — session expired')`. If `status === 'complete'`, call the completion path instead (the webhook was missed) — `verifyAndCompleteOrder(orderId)` already does this.
3. Orders with no `stripeSessionId` (Stripe create failed after reservation; `createOrder` rolls those back itself) are skipped.

Timer in `server.js`: first run 60 s after boot, then every `ORDER_SWEEP_INTERVAL_MS` (default 5 min), `unref()`, skipped under test. Idempotent with `checkout.session.expired`: both go through `failOrder`, which is a no-op unless `PENDING`.

A composite index `Order(status, createdAt)` makes the sweep query cheap; the per-contact count uses the existing `contactId` FK plus `eventId` — add `@@index([contactId, eventId, status])`.

### 2.3 Staff magic-link guard (frontend)

`frontend/src/app/api/auth/[...nextauth]/route.ts`:

```ts
export const GET = handlers.GET;
export async function POST(req: NextRequest) {
  if (isMagicLinkRequest(req)) {          // pathname ends with /signin/resend
    const verdict = await guardMagicLink(req); // reads a cloned form body for `email`
    if (verdict !== 'send') return magicLinkAcceptedRedirect(req); // same redirect Auth.js issues
  }
  return handlers.POST(req);
}
```

`frontend/src/lib/magicLinkGuard.ts`:

- Per-IP window (`clientIpFrom(req)`, default 5 / 15 min) and per-address window (lower-cased email, default 3 / 15 min) in an in-process `Map` with lazy expiry. Env `AUTH_MAGIC_LINK_IP_LIMIT`, `AUTH_MAGIC_LINK_EMAIL_LIMIT`, `AUTH_MAGIC_LINK_WINDOW_MS`.
- Existence check: `prisma.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } })`; missing or deleted → `'skip'`. This also stops the adapter from creating `UNASSIGNED` users for strangers (spec assumption: staff are invited through Settings › People, never self-registered).
- `'skip'` responds with the redirect Auth.js would have produced (`/auth/signin?...` "check your email" state) so the two outcomes are indistinguishable to the caller. The sign-in page's `signIn('resend', { redirect: false })` reads `result.ok`; keep that true.

Google OAuth (`/signin/google`, `/callback/google`) and the dev-only credentials provider are not touched.

### 2.4 Headers

Backend: `app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))` replaces the hand-written block. `crossOriginResourcePolicy` must stay `cross-origin` — storefronts on custom hosts load `/images/:id/:hash/:variant` from the backend origin. HSTS value stays `max-age=31536000; includeSubDomains`. The API is JSON-only, so CSP is not set on Express.

Frontend `next.config.mjs` `headers()`:

| Header | Value |
|---|---|
| `Content-Security-Policy-Report-Only` (phase 2) → `Content-Security-Policy` (follow-up) | built by `frontend/src/lib/csp.ts`: `default-src 'self'`; `script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com` (Next inline runtime; nonce-based is a follow-up); `connect-src 'self' ${NEXT_PUBLIC_API_URL} https://api.stripe.com`; `img-src 'self' data: blob: ${NEXT_PUBLIC_API_URL} https://lh3.googleusercontent.com`; `frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com`; `form-action 'self' https://checkout.stripe.com https://accounts.google.com`; `base-uri 'self'`; `frame-ancestors 'none'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), geolocation=(), microphone=()` (camera stays for the QR scanner page) |
| `X-Content-Type-Options` | `nosniff` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

`img-src` must also allow whatever `BUCKET_PUBLIC_URL` is when set. Custom storefront hosts serve the same Next app, so the header applies there too; `connect-src` therefore lists the backend URL, not the storefront host.

### 2.5 Turnstile (optional, FR-012)

Off unless `TURNSTILE_SITE_KEY` (frontend, `NEXT_PUBLIC_`) and `TURNSTILE_SECRET_KEY` (backend) are set. Widget on the checkout form, the buyer sign-in form and the application submit form; token posted as `turnstileToken`; backend `middleware/turnstile.js` verifies against `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the client IP, `403` on failure, pass-through when the secret is unset. Turnstile does not require the zone to be on Cloudflare, so this is independent of §7.1.

---

## 3. Data model

```prisma
model Order {
  // …
  @@index([status, createdAt])            // sweepAbandoned
  @@index([contactId, eventId, status])   // per-contact PENDING cap
}
```

One migration, `20260925000000_order_abuse_indexes`. No new tables. Dev DB syncs with `db push` (spec 012 note); production applies through the start command as before.

---

## 4. Backend

### 4.1 Files

| File | Change |
|---|---|
| `src/middleware/rateLimit.js` | new — `makeLimiter`, `clientIpForRateLimit`, env parsing |
| `src/utils/metrics.js` | `rateLimitedCounter` (`rate_limited_total`, label `route`) |
| `src/api/server.js` | `helmet`; `BASELINE` limiter after correlation id; order sweep timer |
| `src/api/routes/orders.js` | `ORDER_CREATE`, `ORDER_LOOKUP`, `ORDER_VERIFY` |
| `src/api/routes/tickets.js` | `SCANNER_AUTH` before `requireScannerOrStaff` on `/scan`, `/redeem` |
| `src/api/routes/domains.js` | `DOMAIN_RESOLVE` |
| `src/api/routes/buyerAuth.js`, `applications.js` | use the factory; re-export `clientIpForRateLimit` |
| `src/services/OrderService.js` | per-contact `PENDING` count in `createOrder`; `sweepAbandoned()` |
| `src/middleware/turnstile.js` | phase 2, optional |
| `package.json` | `helmet` |

### 4.2 Error contract

| Condition | Status | Body |
|---|---|---|
| Any limiter | `429` | `{ error: '<route message>' }` + `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` |
| Per-contact hold cap | `409` | `{ error: 'You already have tickets on hold for this event. Finish that checkout or wait for it to expire.' }` |
| Turnstile failed | `403` | `{ error: 'Verification failed. Reload the page and try again.' }` |

### 4.3 Tests

| Suite | Covers |
|---|---|
| `tests/unit/rateLimitFactory.test.js` | env overrides; pass-through under test unless enforced; key = signed IP else `req.ip`; `skipSuccessfulRequests` |
| `tests/unit/buyerRateLimitKey.test.js` | unchanged (import path via re-export) |
| `tests/contract/rateLimits.test.js` (`RATE_LIMIT_ENFORCE_IN_TESTS=1`, low `RATE_LIMIT_*_LIMIT`) | FR-001 IP cap on `/orders` with reservation unchanged on 429; lookup; verify-payment; scanner failures then 429, valid key after N-1 failures ok, N successes never limited; domains; baseline exempts `/health` and `/webhooks/stripe` |
| `tests/contract/orders.test.js` (extend) | per-contact cap: 3 open then 409, no reservation; a completed/failed order does not count |
| `tests/unit/orderSweep.test.js` | mocked Stripe: expired → `failOrder`; open past `expires_at` → fail; complete → completion path; young orders untouched; second run is a no-op |
| `tests/contract/securityHeaders.test.js` | helmet emits the four legacy headers + `Cross-Origin-Resource-Policy: cross-origin` on `/images/*` |

---

## 5. Frontend

| File | Change |
|---|---|
| `src/app/api/auth/[...nextauth]/route.ts` | wrap `POST` (§2.3) |
| `src/lib/magicLinkGuard.ts` | windows, existence check, redirect builder |
| `src/lib/csp.ts` | CSP string builder from env |
| `next.config.mjs` | `headers()` |
| `src/app/checkout/[eventId]/page.tsx` | show the 409 hold-cap message inline; Turnstile widget when configured |
| `src/app/organizations/[orgId]/account/page.tsx`, `src/app/events/[eventId]/apply/[formSlug]/page.tsx` | Turnstile widget when configured |
| `tests/unit/magicLinkGuard.test.ts` | IP window, email window, unknown/deleted user → skip, same redirect |
| `tests/unit/csp.test.ts` | builder includes API URL, bucket URL when set, Stripe and Google hosts |
| `e2e/abuse-protection.spec.ts` | sign-in with an unknown email shows check-your-email; checkout 409 copy renders; storefront + checkout + admin pages log no CSP violations (report-only, captured via `page.on('console')`) |

---

## 6. Phases

### Phase 1 — money paths (FR-001, 002, 004, 005, 006, 007, 008, 009, NFR-*)

Limiter factory, all backend limiters, per-contact hold cap, abandoned-order sweep, migration, metrics, backend tests, env docs in `docs/wiki/config/environment-variables.md`, launch-checklist section. **Ship before launch.**

### Phase 2 — sign-in and headers (FR-003, FR-010, FR-012)

Magic-link guard, helmet, Next headers with CSP report-only, optional Turnstile, frontend tests, e2e. Enforcing CSP (dropping report-only) is a follow-up once a week of production reports is clean.

### Phase 3 — edge layer (FR-011; only if §7.1 = Cloudflare)

- Move platform hosts and the API behind Cloudflare (proxied DNS). Origin restriction: accept only Cloudflare IP ranges at Railway is not available, so use an **Authenticated Origin Pull** or a shared `CF-Origin-Secret` header checked in Express and Next middleware, `403` otherwise.
- `trust proxy`: Express counts hops from the right; with Cloudflare + Railway it becomes 2. Replace the constant with `TRUSTED_PROXY_HOPS` env. `clientIpForRateLimit` prefers `CF-Connecting-IP` **only** when the origin-secret check passed.
- Custom hostnames → Cloudflare for SaaS: `DomainService` creates a custom hostname via the Cloudflare API instead of / in addition to `railwayDomains.js`; `STOREFRONT_CNAME_TARGET` becomes the SaaS fallback origin; the Settings › Domains DNS table shows Cloudflare's records; the sweep reads `ssl.status`. Existing ACTIVE domains need a migration path (both targets valid for a window).
- Edge rules mirroring §2.1 for `/orders`, `/buyer/auth/request`, `/api/auth/signin/*`, `/events/*/applications`; Bot Fight Mode on; managed WAF ruleset on the plan tier that includes it. App-level limiters stay as the second layer.
- Spec 008 phase C (apex domains) becomes easier under Cloudflare for SaaS (CNAME flattening) — note in that plan.

---

## 7. Open decisions

### 7.1 Edge layer (decide before the first production custom domain)

**Decision recorded 2026-09-18: Option B — Railway-only for launch.** Ship phases 1–2 and use optional Turnstile without changing DNS or adding a Cloudflare dependency. Revisit Option A (Cloudflare in front of Railway + Cloudflare for SaaS) at launch-plus-one-quarter, or sooner if `rate_limited_total` or operational evidence shows that app-level controls are insufficient. Option C is rejected because it leaves public custom-domain storefronts exposed while protecting only platform hosts.

| Option | What it buys | What it costs |
|---|---|---|
| **A. Cloudflare in front of Railway** + Cloudflare for SaaS for storefront hostnames | Edge rate limiting, bot management, managed WAF, DDoS absorption, per-hostname TLS without Railway's domain API | Phase 3 (§6): every org's CNAME target changes; `railwayDomains.js` path replaced; origin-secret plumbing; plan-tier cost for WAF managed rules and bot management (verify current pricing before deciding); one more vendor in the launch checklist |
| **B. Railway only** (phases 1–2 + optional Turnstile) — **chosen for launch** | Nothing to migrate; no new vendor | No OWASP WAF, no volumetric protection beyond Railway's; scrapers still reach the origin (cost only) |
| **C. Cloudflare for platform hosts only**, custom domains stay on Railway — **rejected** | Protects admin and the API; no custom-domain rework | Storefronts on custom domains stay unprotected — exactly where public traffic lands |

### 7.2 Numbers

**Decision recorded 2026-09-18: keep the proposed starting defaults.** `ORDER_CREATE` is 10 successful orders per IP per 15 minutes; validation failures do not consume the budget. The per-contact cap of 3 open `PENDING` orders is the primary anti-hoarding control. Monitor shared-NAT/box-office reports and raise the IP limit to 30 through its environment override if legitimate traffic demonstrates the need. Other defaults remain as listed in §2.1; they are configurable without a code change.

Defaults in §2.1 are starting points. `ORDER_CREATE` 10 / 15 min per IP vs a venue box office on one NAT: the per-contact cap does the real work, so this can be raised (30) if a box office reports it. `BASELINE` 600 / 5 min ≈ 2 req/s sustained; admin pages burst well under that.

### 7.3 Magic-link existence gate

**Decision recorded 2026-09-18: invite-first is the required staff flow.** Restrict magic-link sends to existing, non-deleted `User` rows. Staff must be created through Settings › People before they can sign in; unknown addresses receive the same success-shaped redirect but no email and no `User` row. Google OAuth remains unaffected. This intentionally stops the current adapter behavior that creates an `UNASSIGNED` user after an unknown address follows a link. The launch checklist should point staff to Settings › People for invitations.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Memory store resets on deploy and is per-replica | Acceptable at one replica; scale-out condition documented in `environment-variables.md`: add `rate-limit-redis` before `numReplicas > 1` |
| Real buyers on a shared IP hit `ORDER_CREATE` | Counts orders not requests; 409 hold-cap copy explains; `RATE_LIMIT_ORDER_CREATE_LIMIT` adjustable without deploy |
| Sweep fails an order Stripe then completes | Sweep only fails on Stripe-confirmed `expired`/past-`expires_at`; completion path is idempotent and re-reserves nothing (tickets are issued from the order's items); covered in `orderSweep.test.js` |
| CSP breaks Stripe redirect, Google sign-in or bucket images | Report-only for phase 2; e2e asserts zero violations across the three flows before enforcing |
| `helmet` default `Cross-Origin-Resource-Policy: same-origin` blocks storefront images | Explicit `cross-origin` (§2.4) + contract test |
| Existing test suites trip limiters | Factory returns pass-through under `NODE_ENV=test`; only `rateLimits.test.js` opts in |
| Magic-link guard `Map` grows | Lazy expiry on read + cap at 10 k keys with oldest-eviction |

---

## 9. Follow-ups noted, not planned

- Enforce CSP (drop report-only) after a clean week; nonce-based `script-src`.
- Per-device scanner keys (`ScannerDevice` table, revocation) instead of one shared `SCANNER_API_KEY` — spec 006 territory.
- `rate-limit-redis` when the backend scales past one replica.
- Spec 008 phase C (apex) under Cloudflare for SaaS if §7.1 = A.
- Abuse dashboard: `rate_limited_total` and sweep counts on the admin dashboard rather than only `/metrics`.
