# Backend — Scoped Agent Instructions

Loads when agent touches `backend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Auth Flow

1. Frontend Auth.js handles login (Google OAuth / magic link)
2. JWT callback injects `accessToken` into session
3. Frontend sends `Authorization: Bearer <token>` to backend
4. `middleware/auth.js` verifies JWT with shared `AUTH_SECRET` (HS256)
5. `req.user` populated: `{sub, email, role, name}`

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
