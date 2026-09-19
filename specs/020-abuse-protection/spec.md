# Feature Specification: Abuse protection and edge security

**Feature Branch**: `plan/020-abuse-protection`  
**Created**: 2026-09-18  
**Status**: Planned 2026-09-18 — see [plan.md](./plan.md); not built  
**Input**: A talk on edge security (transcript reviewed 2026-09-18, session [015NmwW2FJfkUD5CKxNjGuR5](https://claude.ai/code/session_015NmwW2FJfkUD5CKxNjGuR5)) argued for three Cloudflare moves: rate-limiting rules on login / registration / password-reset, bot-management rules on pricing and checkout pages, and custom WAF rules for OWASP top-10 patterns. Its premise — "you already have Cloudflare in front and it is misconfigured" — is false for Jump, but the review it prompted found real, unbounded abuse paths that must close before launch.  
**Builds on**: spec 007 (buyer magic-link auth, signed client IP for rate limiting, custom domains), spec 008 (Settings › Domains, Railway TLS), spec 011 (application submit limiter), spec 001/003 (guest checkout, inventory reservation), `docs/wiki/config/production-launch-checklist.md`.

## Vocabulary

**Abuse** here means automated traffic that costs Jump or an organizer something without a legitimate buyer behind it: inventory held and never paid for, emails sent to people who did not ask, enumeration of other people's orders, brute force against a shared device key, and plain volume. **Edge** means a layer in front of Railway that sees requests before Express or Next do; Jump has none today. **App-level** means enforcement inside the Express backend or the Next.js server.

## Problem

Jump runs both services on Railway with no proxy of its own in front (`*.up.railway.app`; custom storefront hostnames CNAME straight to the Railway frontend host and Railway issues the certificate — `backend/src/lib/railwayDomains.js`). The only request throttling is app-level `express-rate-limit` on two routes: `POST /buyer/auth/request` (20 per hour per client IP, spec 007) and `POST /events/:eventId/applications` (30 per hour, spec 011). Everything else is unbounded, and the highest-value targets are the unauthenticated money paths:

1. **`POST /orders`** creates a `PENDING` order and increments `PriceTier.quantityReserved` atomically *before* the Stripe Checkout session is paid (`OrderService.createOrder`, 30-minute Stripe expiry). Nothing limits how often one client can do this. A script can reserve an entire tier for free and re-reserve it every 30 minutes; real buyers see "sold out". Released inventory depends entirely on the `checkout.session.expired` webhook arriving — there is no local sweep.
2. **Staff magic-link sign-in** (`POST /api/auth/signin/resend`, Auth.js Resend provider, `frontend/src/auth.config.ts`) has no per-IP or per-address cap and no `signIn` callback restricting it to known users. Any email address receives a message from Jump's sending domain, and clicking it creates a `User` row (role `UNASSIGNED`) through the Prisma adapter. This is a sender-reputation and quota problem, and an unbounded table.
3. **`POST /orders/lookup`** (email + orderRef) and **`POST /orders/:orderId/verify-payment`** accept unlimited guesses. The lookup is the one that reveals another person's order.
4. **`POST /tickets/scan` / `/redeem`** accept a shared static `X-Scanner-Key` (`backend/src/middleware/scannerAuth.js`, timing-safe compare) with no failure throttle, so the key is brute-forceable at wire speed.
5. **`GET /domains/resolve` / `/owner`** are public and cheap but unbounded; every unknown `Host` reaching the Next middleware turns into a backend call.
6. Express sends four security headers by hand (`server.js`); Next sends none beyond its defaults. There is no Content-Security-Policy anywhere.

The transcript's three prescriptions do not map onto Jump as written: there is no password login, registration or password reset (staff use magic link + Google OAuth, buyers use a per-organization magic link), and there is no Cloudflare zone to configure. Putting one in front is a real option but it is an infrastructure decision with consequences for spec 007/008 — every organization's published CNAME target changes — and it must be taken **before** the first real custom domain goes live, not after.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — A buyer can still buy when a bot is hammering checkout (Priority: P1)

A script posts `POST /orders` in a loop for a popular tier. After a small number of orders from one client IP in a short window the backend answers `429` and reserves nothing; after a small number of open `PENDING` orders for one email on one event, further orders from that email are refused with a clear message. Reservations from abandoned orders are released by a local sweep shortly after the Stripe session would have expired, whether or not the webhook arrives. A real buyer at the same event still checks out.

**Why this priority**: Denial-of-inventory is the canonical ticketing attack and the only one on this list that costs organizers revenue rather than Jump money.

**Independent Test**: Contract test posts `N+1` valid orders from one signed client IP inside the window: the first `N` are `201`, the next is `429` with `RateLimit-*` headers and the tier's `quantityReserved` is unchanged by it. A second test creates the per-email maximum of `PENDING` orders for one event, then one more → `409`/`429` (see plan §4.2) and no reservation. A third backdates a `PENDING` order's `createdAt` past the sweep threshold, runs the sweep once, and asserts `FAILED` + `quantityReserved` decremented.

**Acceptance Scenarios**:
1. **Given** 10 orders already created from one IP in 15 minutes, **When** an 11th `POST /orders` arrives, **Then** it is `429`, no `Order` row is created and no tier is touched.
2. **Given** 3 open `PENDING` orders for `a@example.com` on event E, **When** a 4th arrives, **Then** it is refused and the checkout page shows "You already have tickets on hold for this event — finish that checkout or wait for it to expire".
3. **Given** a `PENDING` order older than the Stripe session lifetime plus grace, **When** the sweep runs, **Then** the order is `FAILED`, inventory is released, and a later `checkout.session.expired` for the same session is a no-op.
4. **Given** the limiter is hit, **When** the same buyer retries after the window, **Then** checkout works.

### User Story 2 — Nobody can use Jump to spam a mailbox or burn the Resend quota (Priority: P1)

Staff sign-in accepts a handful of magic-link requests per IP and per address in a window and then answers with the same "check your email" page without sending. Only addresses that already have a `User` row receive mail; unknown addresses get the same page and no email (no account-existence leak). Buyer sign-in already behaves this way (spec 007) and is unchanged.

**Why this priority**: Sender reputation is shared across every organizer's confirmation and sign-in email; one abuse run can land all of it in spam.

**Independent Test**: Unit test on the sign-in guard: 6th request from one IP in 15 minutes → skipped send, same redirect; 4th request for one address in 15 minutes → skipped send; unknown address → skipped send, same redirect. E2E: sign-in page with an unknown email shows the check-your-email page.

**Acceptance Scenarios**:
1. **Given** 5 magic-link requests from one IP in 15 minutes, **When** a 6th arrives, **Then** the response is identical to a successful one and no email is sent.
2. **Given** an email with no `User` row, **When** a magic link is requested, **Then** no email is sent and no `User` row is created.
3. **Given** a real staff member who was throttled, **When** they use "Sign in with Google", **Then** it is unaffected.

### User Story 3 — Order lookup, payment verification and the scanner key cannot be guessed (Priority: P2)

`POST /orders/lookup` and `POST /orders/:orderId/verify-payment` are throttled per client IP. `POST /tickets/scan` and `/redeem` count **failed** authentications per IP and lock that IP out after a small number; successful scans from a staff session or a valid device key are never throttled, because a door scanner legitimately scans hundreds of tickets in minutes.

**Independent Test**: Contract tests for each route: `N` failures then `429`; a valid `X-Scanner-Key` after `N-1` failures still succeeds; `N` successful scans in a row from one key are all `200`.

**Acceptance Scenarios**:
1. **Given** 10 wrong `X-Scanner-Key` values from one IP in 15 minutes, **When** an 11th request arrives, **Then** it is `429` even if the key is now right.
2. **Given** a staff session scanning 300 tickets in 5 minutes, **When** every scan succeeds, **Then** none is throttled.
3. **Given** 10 wrong email/orderRef pairs from one IP in 15 minutes, **When** an 11th `POST /orders/lookup` arrives, **Then** it is `429`.

### User Story 4 — The rest of the API has a ceiling and both apps send modern security headers (Priority: P2)

Every backend route except `/health`, `/metrics` and `/webhooks/*` sits behind a generous per-IP baseline limiter. `helmet` replaces the hand-written headers on Express; Next serves `Content-Security-Policy` (report-only first), `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` and HSTS via `next.config.mjs` `headers()`. Image, Stripe, Google and Resend-hosted assets still load.

**Independent Test**: Contract test hits a cheap public route past the baseline → `429`. Unit test on the CSP builder. E2E: storefront, checkout (Stripe redirect), admin with an uploaded image and a Google sign-in button all render with zero CSP violations in the console (report-only).

**Acceptance Scenarios**:
1. **Given** the baseline limit, **When** exceeded from one IP, **Then** `429` with `RateLimit-*` headers; `/health` and `/webhooks/stripe` are never limited.
2. **Given** `helmet` is mounted, **When** any response is inspected, **Then** the four headers sent today are still present with equal or stricter values.
3. **Given** CSP is in report-only mode, **When** every E2E suite runs, **Then** no violation is reported; enforcing is a follow-up switch.

### User Story 5 — The team decides whether Jump gets an edge layer, before the first custom domain (Priority: P2, decision)

The plan lays out the options (Cloudflare in front of Railway with Cloudflare for SaaS for custom hostnames; stay Railway-only with app-level protection and Turnstile; Cloudflare for platform hosts only) with their consequences for spec 007/008, the signed-IP scheme, `trust proxy`, and cost. The decision is recorded on the production launch checklist. Nothing in phases 1–2 depends on it.

**Independent Test**: n/a (decision). The checklist entry exists and names the chosen option and date.

### Edge Cases

- **Shared NAT** (a venue box office, a university, a conference Wi-Fi): many real buyers share one IP. Per-IP order limits must be per-window counts of *orders*, not requests, and generous enough for a box office (§ plan 7 open decision, default 10 orders / 15 min); the per-email `PENDING` cap is what actually stops hoarding.
- **Behind a future proxy**: if any hop is added in front of Railway, `req.ip` becomes the proxy for everyone and every per-IP limiter collapses to one bucket. The signed `X-Jump-Client-Ip` scheme covers Next→backend hops; an edge proxy needs its own trusted-header handling (plan §6 phase 3).
- **Multiple backend replicas**: `express-rate-limit`'s default memory store is per-process. Railway currently runs one replica per service; the plan uses the memory store and records the switch to a shared store as the condition for scaling out.
- **Tests**: the existing suites create many orders quickly from one IP. Limiters must be disabled or widened under `NODE_ENV=test` except in the tests that target them (the spec 007 pattern: `DOMAIN_VERIFY_COOLDOWN_MS=0`).
- **Legit repeated `verify-payment`**: the confirmation page polls it after the Stripe redirect; the limit must exceed a slow webhook's polling count.
- **Webhook race on the sweep**: a `checkout.session.completed` arriving after the sweep failed the order must still complete it (money was taken). `handleCheckoutFailed` / completion paths are already idempotent on status; the sweep must fail an order only when Stripe confirms the session is `expired` or `open`-and-past-`expires_at`, never on age alone.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** `POST /orders` is limited per client IP (default 10 orders / 15 min) and per email per event (default 3 open `PENDING` orders); over-limit requests create nothing.
- **FR-002** A backend sweep fails `PENDING` orders whose Stripe session is expired (or past `expires_at`) and releases tier and add-on reservations; the webhook path stays the primary route and both are idempotent.
- **FR-003** Staff magic-link requests are limited per IP (default 5 / 15 min) and per address (default 3 / 15 min) and are sent only to existing `User` rows; every outcome renders the same page. Google sign-in is unaffected.
- **FR-004** `POST /orders/lookup` and `POST /orders/:orderId/verify-payment` are limited per client IP (defaults 10 / 15 min and 60 / 15 min).
- **FR-005** `POST /tickets/scan` and `/redeem` count failed authentications per IP (default 10 / 15 min) and never throttle successful ones.
- **FR-006** `GET /domains/resolve` and `/owner` are limited per client IP (default 120 / min).
- **FR-007** Every other backend route sits behind a baseline per-IP limiter (default 600 / 5 min); `/health`, `/metrics`, `/webhooks/*` are exempt.
- **FR-008** All limiters key on `clientIpForRateLimit(req)` (spec 007) so Next-proxied and browser-direct calls are both keyed on the real client; all send `RateLimit-*` (draft-7) headers and a JSON `{ error }` body.
- **FR-009** Every limit is configurable by environment variable and is effectively off under `NODE_ENV=test` unless the test opts in.
- **FR-010** Express uses `helmet` with settings that keep today's four headers; Next sends CSP (report-only in phase 2), `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, HSTS.
- **FR-011** The edge-layer decision (Cloudflare / none / split) is recorded on the launch checklist with its date; if Cloudflare is chosen, phase 3 of the plan covers custom hostnames, trusted-IP handling and the `X-Forwarded-*` contract.
- **FR-012** Optional, behind `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: a Cloudflare Turnstile challenge on checkout, buyer sign-in and application submit, verified server-side; unset means no widget and no check.

### Non-Functional Requirements

- **NFR-001** No limiter adds a database round-trip; the per-email `PENDING` cap is one indexed count inside the existing order transaction.
- **NFR-002** Throttled responses cost less than the work they replace (no Stripe call, no email, no reservation).
- **NFR-003** Limits are observable: a `rate_limited_total{route}` counter on `/metrics` and a `warn` log line with the route and keyed IP.

## Assumptions

- Railway keeps one replica per service until launch; the memory store is acceptable and is the documented scale-out trigger.
- Railway's edge is the only hop in front of Express (`trust proxy` = 1) and in front of Next (`x-forwarded-for` first entry is the client, as `clientIpFrom` already assumes). If that changes, FR-011 phase 3 applies.
- `express-rate-limit` ^8 (already a backend dependency) and `helmet` (new) are acceptable dependencies; no Redis is introduced.
- Cloudflare Turnstile is usable without moving DNS to Cloudflare (it is a standalone widget + verify endpoint); it is optional and off by default.
- The Stripe Checkout session lifetime stays 30 minutes; the sweep threshold is derived from it plus a grace, not hard-coded separately.
- Bot management and managed WAF rules are edge-only products; Jump does not attempt to replicate OWASP pattern matching in Express. Input validation (`express-validator`, Prisma parameterisation) stays the app-level defence.
