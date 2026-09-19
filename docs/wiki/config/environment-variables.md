# Environment Variables

**Last Updated**: 2026-09-07

Complete reference for all environment variables used by the Jump platform.

## Shared (packages/db, backend, frontend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname?schema=public`. Must be the same database across all three locations. |

## Backend (backend/.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | JWT signing secret (HS256). **Must match frontend value exactly** |
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (`whsec_...`). Get from `stripe listen` CLI output locally |
| `APPLICATIONS_PAYMENTS_ENABLED` | No | `true` lets PAID application forms (vendor / sponsor tiers) open: card on file at submission, off-session charge at approval, pay-now, refunds (spec 011 phase 2). Default off: FREE forms only |
| `APPLICATION_SWEEP_INTERVAL_MS` | No | Interval for the overdue pay-now sweep (default 1 h; first run 30 s after boot) |
| `RATE_LIMIT_<NAME>_LIMIT`, `RATE_LIMIT_<NAME>_WINDOW_MS` | No | Per-limiter overrides (spec 020): `BASELINE` (600 / 5 min, skips `/health`, `/metrics`, `/webhooks/*`), `ORDER_CREATE` (10 created orders / 15 min per IP), `ORDER_LOOKUP` (10 / 15 min), `ORDER_VERIFY` (60 / 15 min), `SCANNER_AUTH` (10 failed scanner sign-ins / 15 min), `DOMAIN_RESOLVE` (120 / min), `BUYER_AUTH_REQUEST` (20 / h), `APPLICATION_SUBMIT` (30 / h). Keyed on the signed `X-Jump-Client-Ip`, else `req.ip`; refused requests count in `rate_limited_total{route}` |
| `RATE_LIMIT_ENFORCE_IN_TESTS` | No | `1` makes the limiters real under `NODE_ENV=test` (the abuse-protection suite sets it); otherwise every limiter is a pass-through in tests |
| `ORDER_MAX_PENDING_PER_CONTACT` | No | Open (PENDING) ticket checkouts one email may hold on one event before `POST /orders` answers 409 (default 3) |
| `LEGAL_ACCEPTANCE_REQUIRED` | No | `true` makes `POST /orders` refuse a checkout without current `acceptances` (400 `LEGAL_ACCEPTANCE_REQUIRED`). Default off until the legal pages go live (spec 023 phase 1); a stale version is always refused (`LEGAL_VERSION_STALE`). The apply form always requires them |
| `LEGAL_IP_SALT` | No | Salt for the hashed IP on `LegalAcceptance` rows; falls back to `AUTH_SECRET`. The raw IP is never stored |
| `ORDER_SWEEP_INTERVAL_MS`, `ORDER_SWEEP_GRACE_MS` | No | Abandoned-checkout sweep: how often (default 5 min; first run 60 s after boot) and how long past the 30-minute Checkout session a PENDING order may sit before Stripe is asked (default 5 min); expired → `failOrder` releases the hold, paid-but-missed → completed |
| `STRIPE_CONNECT_ENABLED` | No | `true` turns on Stripe Connect payouts (spec 010 phase 2): organizations with an active connected account receive destination charges. Default off — the migration and code deploy dark |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | With Connect | Signing secret for the *Connect* webhook endpoint (`POST /webhooks/stripe/connect`, "listen to events on connected accounts"). Different from `STRIPE_WEBHOOK_SECRET`; unset = unverified (dev/test only) |
| `BILLING_ENABLED` | No | `true` turns on Jump subscriptions (spec 022 phase 2): the subscribe step in `/signup` and Settings › Plan. Needs `JUMP_STARTER_PRICE_ID`; without it billing stays off (warning at startup) |
| `JUMP_STARTER_PRICE_ID` | With billing | Stripe Price id (`price_...`) of the STARTER plan in Jump's own account |
| `BILLING_TRIAL_DAYS` | No | Free-trial length offered at signup (default 30; 0 = no trial) |
| `STRIPE_BILLING_WEBHOOK_SECRET` | With billing | Signing secret for `POST /webhooks/stripe/billing` (subscription events). Same account as `STRIPE_WEBHOOK_SECRET`, separate endpoint; unset = unverified (dev/test only) |
| `ONBOARDING_SWEEP_INTERVAL_MS` | No | Abandoned-signup sweep interval (default 1 h) |
| `ONBOARDING_ABANDON_AFTER_MS` | No | Unfinished signups older than this with no events and no subscription are deleted (default 7 d) |
| `RESEND_API_KEY` | Yes | Resend email API key (`re_...`) |
| `PORT` | No | Server port. Default: 3000. Must be set explicitly on Railway |
| `NODE_ENV` | No | `development` or `production`. Default: development |
| `FRONTEND_URL` | Production | Frontend URL for CORS and email links. e.g., `https://frontend.up.railway.app` |
| `REDIS_URL` | No | Redis connection string. Default: `redis://localhost:6379` |

## Frontend (frontend/.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (for Auth.js PrismaAdapter in server components) |
| `AUTH_SECRET` | Yes | JWT signing secret. **Must match backend value exactly** |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL. `http://localhost:3000` locally, Railway domain in production |
| `NEXT_PUBLIC_BILLING_ENABLED` | No | `true` shows Settings › **Plan** in the settings nav (must match the backend's `BILLING_ENABLED`). Build-time |
| `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` | No | `true` renders `/legal/<slug>` from `frontend/content/legal/<slug>.md` and links the consent texts on checkout / apply to `/legal/terms` and `/legal/privacy` (spec 023). Default off: those paths 404 and the texts show without links. Build-time |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | With billing | Jump's account publishable key (`pk_...`); mounts embedded Checkout on the subscribe step and Settings › Plan. Build-time |
| `AUTH_RESEND_KEY` | No | Resend key for Auth.js magic link emails |
| `AUTH_GOOGLE_ID` | No | Google OAuth client ID (for Google sign-in) |
| `AUTH_GOOGLE_SECRET` | No | Google OAuth client secret |
| `PORT` | No | Frontend port. Default: 3001. Must be set explicitly on Railway |

## Critical Constraints

1. **AUTH_SECRET** must be identical in `backend/.env` and `frontend/.env.local`. Mismatch causes silent JWT verification failures.
2. **DATABASE_URL** should point to the same PostgreSQL database in all three locations (packages/db, backend, frontend).
3. **STRIPE_WEBHOOK_SECRET** is different for local development (`stripe listen` CLI) vs production (Stripe Dashboard webhook settings).
4. **NEXT_PUBLIC_API_URL** is a Next.js public env var — baked into the client bundle at build time. Changes require a rebuild.

## Local Development Setup

```bash
# Generate secrets
openssl rand -base64 32  # Use for AUTH_SECRET

# Stripe CLI for webhook forwarding (add --forward-connect-to when testing Connect)
stripe listen --forward-to localhost:3000/webhooks/stripe \
  --forward-connect-to localhost:3000/webhooks/stripe/connect
# Copy the whsec_... output to STRIPE_WEBHOOK_SECRET (the CLI uses one secret for both)
```

## Production (Railway)

Set all variables via Railway dashboard or CLI. Additionally:
- `PORT` must be explicitly set on both services
- `FRONTEND_URL` on backend for CORS
- `NEXT_PUBLIC_API_URL` on frontend pointing to backend Railway domain
