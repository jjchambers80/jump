# Backend — Scoped Agent Instructions

Loads when agent touches `backend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Auth Flow

1. Frontend Auth.js handles login (Google OAuth / magic link)
2. JWT callback injects `accessToken` into session
3. Frontend sends `Authorization: Bearer <token>` to backend
4. `middleware/auth.js` verifies JWT with shared `AUTH_SECRET` (HS256)
5. `req.user` populated: `{id, email, role, name, organizationId}` — `organizationId` is the preferred active org claim; scoping still verifies it against `OrganizationMember`

## Tenancy (spec 007)

- Buyers = `Contact`, one row per `(organizationId, email)`. Checkout upserts by `organizationId_email` with the event's venue org.
- Staff = `User` + `OrganizationMember(userId, organizationId, role)`. `resolveOrgScope(userId, role, preferredOrgId)` picks the active org; `requireOrgMembership(param)` guards `/organizations/:orgId/*` routes. SYSTEM_ADMIN bypasses both.
- Customer admin queries filter `Contact.organizationId` directly; never scope contacts through orders.

## Buyer Auth (spec 007 phase 2)

- Buyers sign in without passwords. `BuyerAuthService` issues single-use hashed tokens (`BuyerLoginToken`: LOGIN 15 min, WELCOME 7 days) and mints a separate HS256 JWT with `typ: 'buyer'`. `middleware/auth.js` rejects buyer tokens; `middleware/buyerAuth.js` (`requireBuyer`) rejects staff tokens.
- Routes live in `api/routes/buyerAuth.js` under `/buyer`. `POST /buyer/auth/request` always returns 202. The frontend calls these only through `frontend/src/app/api/buyer/*` route handlers, which hold the session in the httpOnly `jump_buyer` cookie.
- Checkout opt-ins: `POST /orders` accepts `createAccount` and `emailSubscribed` booleans, stored on `Order.optInAccount`/`optInMarketing`. `PaymentService.handleCheckoutCompleted` applies them to the Contact (only ever turning on) and issues the WELCOME link. Never set `accountCreatedAt` or `emailSubscribed` from an unpaid checkout.
- Rate limiting behind the Next proxy: key on `clientIpForRateLimit(req)` (signed `X-Jump-Client-Ip`), not `req.ip`.
- Storefront URLs in emails come from `utils/storefrontUrl.js` (first `FRONTEND_URL` entry).

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
- tax = subtotal × taxRate (venue-based, via Stripe Tax API)
```

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
