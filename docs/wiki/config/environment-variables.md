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
