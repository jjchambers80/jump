# Backend — Scoped Agent Instructions

Loads when agent touches `backend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Auth Flow

1. Frontend Auth.js handles login (Google OAuth / magic link)
2. JWT callback injects `accessToken` into session
3. Frontend sends `Authorization: Bearer <token>` to backend
4. `middleware/auth.js` verifies JWT with shared `AUTH_SECRET` (HS256)
5. `req.user` populated: `{id, email, role, name, organizationId}` — `organizationId` is the `X-Jump-Org` header (admin org switcher) or the sign-in claim; scoping always verifies it against `OrganizationMember`. Roles: `UNASSIGNED | ORGANIZER | ADMIN | SYSTEM_ADMIN`

## Tenancy (spec 007)

- Buyers = `Contact`, one row per `(organizationId, email)`. Checkout upserts by `organizationId_email` with the event's venue org.
- Staff = `User` + `OrganizationMember(userId, organizationId, role)`. `resolveOrgScope(userId, role, preferredOrgId)` picks the active org; `requireOrgMembership(param)` guards `/organizations/:orgId/*` routes. SYSTEM_ADMIN bypasses both.
- Customer admin queries filter `Contact.organizationId` directly; never scope contacts through orders.
- `POST /tickets/scan` and `/redeem` require a staff session (ORGANIZER+) or `X-Scanner-Key: $SCANNER_API_KEY` (`middleware/scannerAuth.js`). The admin check-in page uses the org-scoped `/admin/tickets/*` routes instead.
- There is no buyer surface on staff auth: `/orders/my`, `/tickets/my`, `/tickets/:id`, `/tickets/:id/request-refund` were removed in phase 4. Buyer self-service (orders, tickets, refunds) is under `/buyer/me/*` with `requireBuyer`.

## Buyer Auth (spec 007 phase 2)

- Buyers sign in without passwords. `BuyerAuthService` issues single-use hashed tokens (`BuyerLoginToken`: LOGIN 15 min, WELCOME 7 days) and mints a separate HS256 JWT with `typ: 'buyer'`. `middleware/auth.js` rejects buyer tokens; `middleware/buyerAuth.js` (`requireBuyer`) rejects staff tokens.
- Routes live in `api/routes/buyerAuth.js` under `/buyer`. `POST /buyer/auth/request` always returns 202. The frontend calls these only through `frontend/src/app/api/buyer/*` route handlers, which hold the session in the httpOnly `jump_buyer` cookie.
- Checkout opt-ins: `POST /orders` accepts `createAccount` and `emailSubscribed` booleans, stored on `Order.optInAccount`/`optInMarketing`. `PaymentService.handleCheckoutCompleted` applies them to the Contact (only ever turning on) and issues the WELCOME link. Never set `accountCreatedAt` or `emailSubscribed` from an unpaid checkout.
- Rate limiting behind the Next proxy: key on `clientIpForRateLimit(req)` (signed `X-Jump-Client-Ip`), not `req.ip`.
- Storefront URLs in emails and Stripe redirects come from `utils/storefrontUrl.js`, which is async and per organization: an ACTIVE custom domain (`DomainService.primaryHostname`) wins, else the first `FRONTEND_URL` entry. On a custom host the org page is `/` and the buyer account page is `/account`.

## Custom Domains (spec 007 phase 3)

- `OrganizationDomain` rows: PENDING → VERIFIED → ACTIVE → FAILED. `DomainService.verifyDomain` checks `TXT _jump-verify.<host>` and the CNAME; with `lib/railwayDomains.js` configured it also waits for the certificate, otherwise DNS proof activates. `server.js` sweeps every 10 min (active domains daily) with an unref'd timer.
- `GET /domains/resolve?host=` (public, cached 60s) is what `frontend/src/middleware.ts` calls to map a tenant host to an organization. Only ACTIVE hosts resolve.
- Admin routes: `/admin/settings/domains` (GET/POST), `/:id/verify`, `/:id/primary`, `DELETE`. Scoped via `resolveOrgScope`; SYSTEM_ADMIN passes `?organizationId=`.
- Hostnames must be subdomains (no apex), never platform hosts. `normalizeHostname` is the single validator.

## Payment Flow (WHY: Stripe is source of truth, not the client)

1. `POST /orders` → creates Order + Contact + reserves tier inventory
2. Backend creates Stripe Checkout Session → returns URL to frontend
3. Customer pays on Stripe-hosted page
4. `POST /webhooks/stripe` receives `checkout.session.completed`
5. PaymentService: marks order COMPLETED → creates tickets → sends email
6. **Never** update payment status from client requests — only from webhook

## Capacity Enforcement (WHY: prevents overselling under concurrent load)

```sql
SELECT * FROM "PriceTier" WHERE id = ? FOR UPDATE  -- row-level lock
-- quantityTotal - quantitySold - quantityReserved >= requested
-- Reserve first, move reserved → sold after payment confirmation
```

## Fee Calculation (FTC All-In Pricing)

```
total = subtotal + platformFee + processingFee + tax
- platformFee = subtotal × 0.05
- processingFee = (subtotal + platformFee) × stripeRate + fixedFee
- tax = subtotal × taxRate, or backed out of the listed price when `Organization.taxInclusivePricing` (then subtotal = listed ÷ (1 + rate)) (venue-based; `Event.taxRate` is resolved from the organization's `TaxRegion` for the venue's state — not collecting → 0, MANUAL → flat rate, STRIPE → Stripe Tax lookup by postal code. See `docs/wiki/features/tax-calculation.md`)
```

## Tests

- `npm test` is self-sufficient: `tests/globalSetup.js` derives the test DB from `backend/.env` `DATABASE_URL` (database renamed to `jump_test`), creates it if missing and runs `prisma migrate deploy`. Override with `TEST_DATABASE_URL`; skip provisioning with `SKIP_TEST_DB_SETUP=1`.
- Suites run in parallel against one database. Every suite must use its own email/orderRef/barcode namespace and clean up in `afterAll` in dependency order — `Contact` before `Organization` (RESTRICT FK).
- Staff fixtures: `tests/helpers/staff.js` — `staffToken({ email, role })` creates a real `User`, `joinOrgByToken(token, orgId, role)` adds the `OrganizationMember`. Never sign a JWT for a user that does not exist: org-scoped routes resolve access through memberships and will 403.
- Non-staff (`UNASSIGNED`) tokens may still be fabricated; they only exercise 403 paths.
- Mock `@jump/db`, never `@prisma/client`; use `@jest/globals`, never `vitest`, in `backend/tests`.

## File Layout

```
src/api/routes/       # Express route handlers (10 files)
src/api/validators/   # Request validation (express-validator)
src/api/server.js     # App setup + middleware + route registration
src/config/           # Stripe, database, logging config
src/middleware/        # Auth, RBAC, error handling, file uploads
src/services/         # Business logic (13 domain services)
src/utils/            # Logger, metrics, barcode generation
```
