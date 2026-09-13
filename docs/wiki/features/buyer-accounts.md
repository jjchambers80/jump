# Buyer Accounts (Checkout Opt-In + Passwordless Sign-In)

**Status**: Implemented (spec 007 phases 2 + 4, shipped 2026-09-13)
**Last Updated**: 2026-09-13

## Overview

At checkout a buyer can tick "Create an account with `<Org>` to manage your tickets" (pre-checked) and, separately, "Email me about future events" (never pre-checked). If they paid with the account box ticked, the confirmation email carries a one-time **Manage your tickets** link that signs them in on that organization's account page. Returning buyers enter their email on the account page and receive a fresh sign-in link. There are no passwords, no OAuth, and buyers are never `User` rows.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/BuyerAuthService.js` | Issue/consume single-use hashed tokens; sign/verify buyer session JWT (`typ: 'buyer'`); per-email rate cap |
| `backend/src/api/routes/buyerAuth.js` | `/buyer/*` routes; per-IP limiter keyed on the signed client IP (`clientIpForRateLimit`) |
| `backend/src/middleware/buyerAuth.js` | `requireBuyer` — accepts only buyer sessions, sets `req.buyer` |
| `backend/src/middleware/auth.js` | Staff `requireAuth`/`optionalAuth` reject buyer tokens |
| `backend/src/services/OrderService.js` | `createOrder` records `optInAccount` / `optInMarketing` on the Order; `getOrdersForContact` |
| `backend/src/services/PaymentService.js` | On `checkout.session.completed`: `_applyOptIns` (turns on `accountCreatedAt` / `emailSubscribed`), `_welcomeLinkForOrder` (WELCOME token) |
| `backend/src/services/TicketService.js` | `getTicketsForContact`; shared `listTickets` |
| `backend/src/services/EmailService.js` | Confirmation gains the manage-tickets block; `sendBuyerLoginEmail` |
| `backend/src/utils/storefrontUrl.js` | `storefrontBaseUrl` (first `FRONTEND_URL` entry), `orderUrl`, `buyerAccountUrl`, `buyerVerifyUrl` |
| `backend/src/api/validators/orderValidators.js` | `createAccount` / `emailSubscribed` must be booleans when present |
| `frontend/src/lib/buyerSession.ts` | Server-only: `jump_buyer` cookie helpers, `backendBuyerFetch`, `clientIpFrom` |
| `frontend/src/app/api/buyer/{request,verify,logout,me,me/orders,me/tickets}/route.ts` | Same-origin proxies; the only place the buyer bearer token exists in the browser tier (inside the httpOnly cookie) |
| `frontend/src/app/organizations/[orgId]/account/page.tsx` | Email form ↔ this org's orders and tickets |
| `frontend/src/app/organizations/[orgId]/account/verify/page.tsx` | Consumes `?token=` once (ref-guarded), redirects to the account page |
| `frontend/src/app/checkout/[eventId]/page.tsx` | The two checkboxes; posts `createAccount`, `emailSubscribed` |
| `backend/tests/unit/buyerAuthService.test.js`, `tests/unit/buyerRateLimitKey.test.js`, `tests/contract/buyerAuth.test.js` | 35 tests: token hashing/TTL/single-use, rate caps, opt-ins on completion, welcome link through the real webhook path, org scoping, principal separation |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_SECRET` | Yes (existing) | Signs buyer session JWTs and the `X-Jump-Client-Ip` HMAC between frontend and backend. Must match in `backend/.env` and `frontend/.env.local` |
| `FRONTEND_URL` | Yes (existing) | First comma-separated entry is the base for links in emails (`storefrontBaseUrl`) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Yes (existing) | Sign-in and confirmation emails |
| `NEXT_PUBLIC_API_URL` | Yes (existing) | Route handlers call the backend at this URL server-side |

No new variables. In production the backend sets `app.set('trust proxy', 1)`.

## How It Works

1. **Checkout.** Two independent checkboxes. `createAccount` defaults to `true` (account creation for a purchased ticket rests on contract performance, so pre-ticking is allowed); `emailSubscribed` defaults to `false` (consent must be affirmative under GDPR/ePrivacy/CASL). `POST /orders` stores them on `Order.optInAccount` / `Order.optInMarketing` and does **not** touch the Contact.
2. **Payment completes.** `PaymentService.handleCheckoutCompleted` (idempotent on order status) issues tickets, marks the order COMPLETED, then `_applyOptIns`: sets `Contact.accountCreatedAt` if the order opted in and it is still null; sets `emailSubscribed = true` if opted in. Both only ever turn on. Then `_welcomeLinkForOrder` issues a WELCOME token (7-day TTL) if the contact is now login-enabled and passes the verify URL to `sendOrderConfirmation`, which renders the **Manage your tickets** block.
3. **Tokens.** 32 random bytes, base64url; only `sha256(raw)` is stored in `BuyerLoginToken` with `purpose` (`WELCOME` 7 d, `LOGIN` 15 min), `expiresAt`, `usedAt`. `consumeToken` claims with `updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } } })` and loads the contact in the same transaction, so a token can be redeemed exactly once and a failure after the claim rolls it back.
4. **Sessions.** `signSession` mints `{ sub: contactId, org: organizationId, email, typ: 'buyer' }`, HS256 with `AUTH_SECRET`, 30 days. `verifySession` requires `typ === 'buyer'`; staff `requireAuth` throws on `typ === 'buyer'`. The two principals cannot cross even though they share a secret.
5. **Frontend cookie.** The verify page POSTs to `/api/buyer/verify`, which calls the backend and sets `jump_buyer` (httpOnly, SameSite=Lax, Secure in production, 30 days). `/api/buyer/me`, `/me/orders`, `/me/tickets` read the cookie server-side and forward it as a bearer token. The browser never holds the JWT, and the cookie is first-party, which is what lets this work unchanged on custom domains later.
6. **Sign-in request.** The account page POSTs email → `/api/buyer/request` → `POST /buyer/auth/request`, which always returns 202. A LOGIN token is issued only if a login-enabled contact exists for that org + email and fewer than 3 LOGIN tokens were issued for it in the last 15 minutes; the email send is fire-and-forget. Unknown emails, guests, and rate-limited requests all look identical to the caller.
7. **Per-IP limit behind the proxy.** Browser traffic reaches the backend from the Next server, so `req.ip` is one address for everyone. The route handler forwards the real client IP as `X-Jump-Client-Ip` with `X-Jump-Client-Ip-Sig = HMAC-SHA256(AUTH_SECRET, ip)`; `clientIpForRateLimit` verifies the signature (timing-safe) and keys `express-rate-limit` (20/hour) on it, falling back to `req.ip`. `X-Forwarded-For` is deliberately not used: the hop depth through Railway's edge would make it spoofable.
8. **Account page.** Loads org branding from `GET /organizations/:id/public`, then `/api/buyer/me`. A session for a different organization is treated as signed out on this page. Signed in: `GET /api/buyer/me/orders` and `/me/tickets`, both scoped by `contactId` (which is org-scoped by construction).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/orders` | None | Existing; now accepts `createAccount?: boolean`, `emailSubscribed?: boolean` (400 if non-boolean). No longer reads the Authorization header |
| POST | `/buyer/auth/request` | None (rate-limited) | `{ organizationId, email }` → always `202 { ok: true }` |
| POST | `/buyer/auth/verify` | None | `{ token }` → `200 { sessionToken, organizationId }`; `401` if unknown/used/expired |
| GET | `/buyer/me` | Buyer | Profile + `organization { id, name, logoUrl, brandColor, themeMode }` |
| GET | `/buyer/me/orders` | Buyer | Paginated order summaries for this contact (`?page&limit`, limit ≤ 100) |
| GET | `/buyer/me/tickets` | Buyer | `{ data: Ticket[] }` for this contact |
| POST | `/buyer/me/tickets/:ticketId/refund` | Buyer | Self-service refund of a refundable, VALID ticket owned by this contact (403 otherwise); runs `RefundService.refundTicket` |

Frontend route handlers (same origin, cookie-based): `POST /api/buyer/request`, `POST /api/buyer/verify`, `POST /api/buyer/logout`, `GET /api/buyer/me`, `GET /api/buyer/me/orders`, `GET /api/buyer/me/tickets`, `POST /api/buyer/me/tickets/:ticketId/refund`.

## Database

- `BuyerLoginToken`: `id, contactId (FK cascade), organizationId, tokenHash (unique), purpose BuyerTokenPurpose, expiresAt, usedAt?, createdAt`; indexes on `contactId`, `expiresAt`.
- `BuyerTokenPurpose` enum: `WELCOME | LOGIN`.
- `Order.optInAccount`, `Order.optInMarketing` (`Boolean @default(false)`).
- `Contact.accountCreatedAt` (null = guest, set = login-enabled) — added in phase 1.
- Migration: `20260913010000_buyer_login_tokens`.

See [Database Architecture](database-architecture.md).

## Gotchas

- **Never set `accountCreatedAt` or `emailSubscribed` from an unpaid checkout.** Anyone can start and abandon a checkout with someone else's email; the opt-ins are honored only when the Stripe webhook completes the order.
- **Opt-ins only turn on.** A later guest checkout never revokes an account and never flips marketing consent off; unsubscribe is a separate flow (admin customers PATCH today).
- **Confirmation email is fire-and-forget and retried 3×; the sign-in email is single-attempt.** A lost sign-in email is solved by requesting another, subject to the 3-per-15-min cap.
- **Rate-limit key.** Anything that adds a proxy in front of `/buyer/auth/request` must forward the signed client IP or the limit collapses to one bucket. Do not switch to `X-Forwarded-For` without re-examining the trusted hop count.
- **Buyer cookie is per host, session is per org.** On the shared Jump domain, signing in at org B replaces org A's session; the account page for org A then shows the email form. Expected until custom domains (phase 3).
- **`onboarding@resend.dev`** as `RESEND_FROM_EMAIL` only delivers to the Resend account owner's address. Use a verified sending domain before real buyers rely on sign-in emails.
- **Stripe webhook is the trigger.** Locally there is no `stripe listen` by default, so orders stay PENDING and no confirmation/welcome email fires. Contract tests call `PaymentService.handleCheckoutCompleted` directly.
- **The Auth.js buyer surface is gone** (phase 4): `/my-tickets`, `/tickets/[ticketId]`, the `/orders` list page, `GET /orders/my`, `GET /tickets/my`, `POST /tickets/:id/request-refund`, and `Contact.userId`. Staff who buy tickets use the organization's `/account` page like any buyer. `/orders/:id` accepts a buyer session and falls back to the staff gate.
- **Refunds from the account page** go through `/api/buyer/me/tickets/:id/refund`; the button shows only for `isRefundable && status === 'VALID'`.

## Related Features

- [Tenant Identity](tenant-identity.md) — the org-scoped `Contact` model this relies on
- [Guest Checkout](guest-checkout.md) — the checkout form and `POST /orders`
- [Stripe Integration](stripe-integration.md) — `checkout.session.completed` drives opt-ins and the welcome link
- [Email Notifications](email-notifications.md) — confirmation and sign-in templates
- [Auth.js Integration](authjs-integration.md) — staff auth; deliberately not used for buyers
- Plan and decision record: `specs/007-tenant-identity/{spec,plan}.md`
